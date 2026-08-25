#!/usr/bin/env python3
"""Local GUI server for exploring a codebase as layered, editable maps."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import mimetypes
import platform
import re
import shutil
import subprocess
import threading
import webbrowser
from collections import Counter, defaultdict
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable, Iterable
from urllib.parse import parse_qs, unquote, urlparse

from generate_feature_maps import SwiftFile, categorize_by_feature


ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
LAYOUT_FILE = ROOT / ".cyber_soul_layouts.json"
FOLDER_PICKER_LOCK = threading.Lock()
IGNORED_DIRS = {
    ".git", ".build", ".next", ".venv", "venv", "node_modules", "Pods",
    "DerivedData", "dist", "build", "__pycache__", ".pytest_cache",
}

QUALITY_RULE_CATALOG = {
    "CQ3.1": (3, "Optimize for human comprehension", "File is unusually large"),
    "CQ3.2": (3, "Optimize for human comprehension", "Type is unusually large"),
    "CQ3.3": (3, "Optimize for human comprehension", "Callable is unusually large"),
    "CQ4.1": (4, "Make behavior explicit and defensive", "Bare exception handler"),
    "CQ4.2": (4, "Make behavior explicit and defensive", "Swallowed exception"),
    "CQ4.3": (4, "Make behavior explicit and defensive", "Mutable default argument"),
    "CQ4.4": (4, "Make behavior explicit and defensive", "Forced error handling"),
    "CQ6.1": (6, "Build security into normal coding", "Hard-coded secret"),
    "CQ6.2": (6, "Build security into normal coding", "Dynamic code execution"),
    "CQ6.3": (6, "Build security into normal coding", "Shell execution boundary"),
    "CQ6.4": (6, "Build security into normal coding", "Unsafe deserialization"),
    "CQ7.1": (7, "Make the toolchain enforce the easy rules", "Source syntax error"),
    "OQ3.1": (None, "Optional project rule", "Deep indentation"),
    "OQ4.1": (None, "Optional project rule", "Silent failure handling"),
}
OPTIONAL_QUALITY_RULES = {
    "deep-indentation": "No deep indentation",
    "no-silent-failure": "No silent failure",
}
OPTIONAL_CODE_TO_RULE = {
    "OQ3.1": "deep-indentation",
    "OQ4.1": "no-silent-failure",
}
FILE_LINE_LIMIT = 600
TYPE_LINE_LIMIT = 300
CALLABLE_LINE_LIMIT = 80
SECRET_ASSIGNMENT_RE = re.compile(
    r"(?i)\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|"
    r"password|private[_-]?key|secret[_-]?key)\b[^=\n]{0,40}=\s*"
    r"(?P<quote>['\"])(?P<value>[^'\"\n]{8,})(?P=quote)"
)
SECRET_PLACEHOLDERS = {
    "changeme", "example", "placeholder", "replace_me", "replace-me",
    "test-secret", "your-api-key", "your_api_key",
}


@dataclass(frozen=True)
class QualityViolation:
    code: str
    severity: str
    message: str
    file: str
    line: int
    evidence: str = ""

    def as_dict(self) -> dict:
        charter_rule, charter_title, title = QUALITY_RULE_CATALOG[self.code]
        optional_rule = OPTIONAL_CODE_TO_RULE.get(self.code)
        return {
            "code": self.code,
            "charterRule": charter_rule,
            "charterTitle": charter_title,
            "title": title,
            "severity": self.severity,
            "message": self.message,
            "file": self.file,
            "line": self.line,
            "evidence": self.evidence,
            "optional": bool(optional_rule),
            "optionId": optional_rule,
        }


@dataclass
class Symbol:
    id: str
    name: str
    kind: str
    file: str
    line: int
    category: str
    language: str
    parent: str | None = None
    signature: str = ""
    calls: set[str] = field(default_factory=set)
    dependencies: set[str] = field(default_factory=set)
    tags: set[str] = field(default_factory=set)
    end_line: int | None = None
    quality_issues: list[QualityViolation] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "file": self.file,
            "line": self.line,
            "category": self.category,
            "language": self.language,
            "parent": self.parent,
            "signature": self.signature,
            "tags": sorted(self.tags),
            "qualityIssues": [issue.as_dict() for issue in self.quality_issues],
        }


@dataclass(frozen=True)
class LanguageRuleset:
    """Language-specific parsing and deterministic source checks."""

    language: str
    extensions: frozenset[str]
    parse_symbols: Callable[[Path, Path], list[Symbol]]
    analyze_quality: Callable[[str, str, list[Symbol]], list[QualityViolation]]

    def supports(self, path: Path) -> bool:
        return path.suffix.lower() in self.extensions


LANGUAGE_RULESETS: tuple[LanguageRuleset, ...] = ()


def language_ruleset_for(path: Path) -> LanguageRuleset | None:
    """Return the registered ruleset for a source path, if one exists."""
    return next(
        (ruleset for ruleset in LANGUAGE_RULESETS if ruleset.supports(path)),
        None,
    )


def stable_id(relative_path: str, kind: str, name: str, line: int) -> str:
    seed = f"{relative_path}:{kind}:{name}:{line}".encode()
    return "n_" + hashlib.sha1(seed).hexdigest()[:12]


def quality_issue(
    code: str, severity: str, message: str, relative: str, line: int,
    evidence: str = "",
) -> QualityViolation:
    return QualityViolation(
        code, severity, message, relative, max(1, line), evidence,
    )


def quality_evidence(source_lines: list[str], issue: QualityViolation) -> str:
    """Return the offending source line without exposing credential values."""
    if issue.evidence:
        return issue.evidence
    if not 1 <= issue.line <= len(source_lines):
        return "Source line unavailable"
    excerpt = source_lines[issue.line - 1].strip() or "(blank source line)"
    if issue.code != "CQ6.1":
        return excerpt
    match = SECRET_ASSIGNMENT_RE.search(excerpt)
    if not match:
        return "Credential-like literal at this line (value redacted)"
    start, end = match.span("value")
    return f"{excerpt[:start]}<redacted>{excerpt[end:]}"


def dotted_python_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        owner = dotted_python_name(node.value)
        return f"{owner}.{node.attr}" if owner else node.attr
    return None


def analyze_python_quality(
    relative: str, source: str, tree: ast.AST,
) -> list[QualityViolation]:
    issues: list[QualityViolation] = []

    class Visitor(ast.NodeVisitor):
        def visit_ClassDef(self, node: ast.ClassDef) -> None:
            end_line = getattr(node, "end_lineno", node.lineno)
            length = end_line - node.lineno + 1
            if length > TYPE_LINE_LIMIT:
                issues.append(quality_issue(
                    "CQ3.2", "warning",
                    f"Type {node.name} spans {length} lines; split unrelated responsibilities.",
                    relative, node.lineno,
                ))
            self.generic_visit(node)

        def inspect_callable(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
            end_line = getattr(node, "end_lineno", node.lineno)
            length = end_line - node.lineno + 1
            if length > CALLABLE_LINE_LIMIT:
                issues.append(quality_issue(
                    "CQ3.3", "warning",
                    f"Callable {node.name} spans {length} lines; simplify its control flow or split it.",
                    relative, node.lineno,
                ))
            defaults = [*node.args.defaults, *[item for item in node.args.kw_defaults if item]]
            for default in defaults:
                mutable_literal = isinstance(default, (ast.List, ast.Dict, ast.Set))
                mutable_constructor = (
                    isinstance(default, ast.Call)
                    and dotted_python_name(default.func) in {"list", "dict", "set"}
                )
                if mutable_literal or mutable_constructor:
                    issues.append(quality_issue(
                        "CQ4.3", "error",
                        f"Callable {node.name} uses a mutable default; use None and create the value inside.",
                        relative, getattr(default, "lineno", node.lineno),
                    ))
            self.generic_visit(node)

        visit_FunctionDef = inspect_callable
        visit_AsyncFunctionDef = inspect_callable

        def visit_ExceptHandler(self, node: ast.ExceptHandler) -> None:
            if node.type is None:
                issues.append(quality_issue(
                    "CQ4.1", "warning",
                    "Bare except catches process-control exceptions; catch the expected exception types.",
                    relative, node.lineno,
                ))
            swallowed = len(node.body) == 1 and (
                isinstance(node.body[0], ast.Pass)
                or (
                    isinstance(node.body[0], ast.Expr)
                    and isinstance(node.body[0].value, ast.Constant)
                    and node.body[0].value.value is Ellipsis
                )
            )
            if swallowed:
                issues.append(quality_issue(
                    "CQ4.2", "error",
                    "Exception is discarded without recovery, context, or an explicit documented policy.",
                    relative, node.lineno,
                ))
            self.generic_visit(node)

        def visit_Call(self, node: ast.Call) -> None:
            name = dotted_python_name(node.func) or ""
            if name in {"eval", "exec", "builtins.eval", "builtins.exec"}:
                issues.append(quality_issue(
                    "CQ6.2", "error",
                    f"{name} executes dynamic code; replace it with a constrained parser or allow-list.",
                    relative, node.lineno,
                ))
            shell_enabled = name in {
                "subprocess.call", "subprocess.check_call", "subprocess.check_output",
                "subprocess.Popen", "subprocess.run",
            } and any(
                keyword.arg == "shell"
                and isinstance(keyword.value, ast.Constant)
                and keyword.value.value is True
                for keyword in node.keywords
            )
            if shell_enabled:
                issues.append(quality_issue(
                    "CQ6.3", "error",
                    "subprocess shell=True expands the injection surface; pass an argument list without a shell.",
                    relative, node.lineno,
                ))
            unsafe_deserializer = name in {
                "pickle.load", "pickle.loads", "dill.load", "dill.loads",
                "marshal.load", "marshal.loads",
            }
            if name in {"yaml.load", "yaml.full_load"}:
                safe_loader = any(
                    keyword.arg == "Loader"
                    and (dotted_python_name(keyword.value) or "").endswith("SafeLoader")
                    for keyword in node.keywords
                )
                unsafe_deserializer = not safe_loader
            if unsafe_deserializer:
                issues.append(quality_issue(
                    "CQ6.4", "error",
                    f"{name} can construct unsafe objects from data; use a safe, constrained serializer.",
                    relative, node.lineno,
                ))
            self.generic_visit(node)

    Visitor().visit(tree)
    return issues


def python_handler_is_empty(node: ast.ExceptHandler) -> bool:
    return len(node.body) == 1 and (
        isinstance(node.body[0], ast.Pass)
        or (
            isinstance(node.body[0], ast.Expr)
            and isinstance(node.body[0].value, ast.Constant)
            and node.body[0].value.value is Ellipsis
        )
    )


def python_handler_surfaces_failure(node: ast.ExceptHandler) -> bool:
    log_methods = {
        "debug", "info", "warning", "warn", "error", "exception", "critical",
        "log", "fatal",
    }
    for child in ast.walk(node):
        if isinstance(child, ast.Raise):
            return True
        if isinstance(child, ast.Call):
            name = dotted_python_name(child.func) or ""
            if name.rsplit(".", 1)[-1].lower() in log_methods:
                return True
    return False


def python_callable_indentation(node: ast.FunctionDef | ast.AsyncFunctionDef) -> tuple[int, int] | None:
    """Return the maximum relative statement indentation and its source line."""
    statements: list[ast.stmt] = []

    def collect(current: ast.AST) -> None:
        for child in ast.iter_child_nodes(current):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
                continue
            if isinstance(child, ast.stmt):
                statements.append(child)
            collect(child)

    for statement in node.body:
        statements.append(statement)
        collect(statement)
    if not statements:
        return None
    base_indent = min(statement.col_offset for statement in node.body)
    offsets = sorted({statement.col_offset for statement in statements if statement.col_offset >= base_indent})
    increments = [later - earlier for earlier, later in zip(offsets, offsets[1:]) if later > earlier]
    indent_width = min(increments, default=4)
    deepest = max(statements, key=lambda statement: (statement.col_offset, -statement.lineno))
    depth = max(0, (deepest.col_offset - base_indent) // max(1, indent_width))
    return depth, deepest.lineno


def analyze_python_optional_quality(
    relative: str, source: str, enabled: frozenset[str],
) -> list[QualityViolation]:
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []
    issues: list[QualityViolation] = []
    if "no-silent-failure" in enabled:
        for node in ast.walk(tree):
            if not isinstance(node, ast.ExceptHandler) or python_handler_is_empty(node):
                continue
            if not python_handler_surfaces_failure(node):
                issues.append(quality_issue(
                    "OQ4.1", "warning",
                    "Exception handler recovers or returns without raising or calling a recognized logger.",
                    relative, node.lineno,
                ))
    if "deep-indentation" in enabled:
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            measurement = python_callable_indentation(node)
            if measurement and measurement[0] >= 3:
                depth, line = measurement
                issues.append(quality_issue(
                    "OQ3.1", "warning",
                    f"Callable {node.name} reaches {depth} indentation levels; extract decisions or use guard clauses.",
                    relative, line,
                ))
    return issues


def analyze_python_source_quality(
    relative: str, source: str, symbols: list[Symbol],
) -> list[QualityViolation]:
    """Parse Python and run its language-specific deterministic checks."""
    del symbols  # Python checks use its syntax tree rather than mapped symbols.
    try:
        tree = ast.parse(source)
    except SyntaxError as error:
        return [quality_issue(
            "CQ7.1", "error", f"Python syntax error: {error.msg}.",
            relative, error.lineno or 1,
        )]
    return analyze_python_quality(relative, source, tree)


def analyze_swift_quality(
    relative: str, source: str, symbols: list[Symbol],
) -> list[QualityViolation]:
    issues: list[QualityViolation] = []
    for symbol in symbols:
        length = (symbol.end_line or symbol.line) - symbol.line + 1
        if symbol.kind in {"class", "struct", "enum", "protocol", "actor"} and length > TYPE_LINE_LIMIT:
            issues.append(quality_issue(
                "CQ3.2", "warning",
                f"Type {symbol.name} spans {length} lines; split unrelated responsibilities.",
                relative, symbol.line,
            ))
        elif symbol.kind in {"method", "function"} and length > CALLABLE_LINE_LIMIT:
            issues.append(quality_issue(
                "CQ3.3", "warning",
                f"Callable {symbol.name} spans {length} lines; simplify its control flow or split it.",
                relative, symbol.line,
            ))

    without_comments = re.sub(
        r"//[^\n]*", lambda match: " " * len(match.group()), source,
    )
    for match in re.finditer(r"\bcatch(?:\s+[^\{]+)?\s*\{\s*\}", without_comments):
        line = source.count("\n", 0, match.start()) + 1
        issues.append(quality_issue(
            "CQ4.2", "error",
            "Empty catch discards an error without recovery, context, or an explicit policy.",
            relative, line,
        ))
    for match in re.finditer(r"\btry!\s", without_comments):
        line = source.count("\n", 0, match.start()) + 1
        issues.append(quality_issue(
            "CQ4.4", "warning",
            "try! turns a recoverable failure into a crash; handle or deliberately propagate the error.",
            relative, line,
        ))
    return issues


def swift_callable_indentation(
    source_lines: list[str], symbol: Symbol,
) -> tuple[int, int] | None:
    start = symbol.line
    end = min(symbol.end_line or start, len(source_lines))
    candidates: list[tuple[int, int]] = []
    for line_number in range(start + 1, end):
        line = source_lines[line_number - 1]
        stripped = line.strip()
        if not stripped or stripped.startswith("//") or re.fullmatch(r"[}\])]+[,;]?", stripped):
            continue
        indent = len(line) - len(line.lstrip(" \t"))
        candidates.append((indent, line_number))
    if not candidates:
        return None
    offsets = sorted({indent for indent, _ in candidates})
    increments = [later - earlier for earlier, later in zip(offsets, offsets[1:]) if later > earlier]
    indent_width = min(increments, default=4)
    base_indent = min(offsets)
    deepest_indent, deepest_line = max(candidates, key=lambda item: (item[0], -item[1]))
    depth = max(0, (deepest_indent - base_indent) // max(1, indent_width))
    return depth, deepest_line


def analyze_swift_optional_quality(
    relative: str, source: str, symbols: list[Symbol], enabled: frozenset[str],
) -> list[QualityViolation]:
    issues: list[QualityViolation] = []
    if "no-silent-failure" in enabled:
        for match in re.finditer(r"\bcatch(?:\s+[^\{]+)?\s*\{", source):
            opening = source.find("{", match.start())
            block, _ = matching_brace_block(source, opening)
            body = block[1:-1].strip()
            if not body:  # The core CQ4.2 rule already reports empty catches.
                continue
            surfaces_failure = bool(re.search(
                r"\bthrow\b|\b(?:print|debugPrint|os_log)\s*\(|"
                r"\.(?:debug|info|notice|warning|error|critical|fault)\s*\(",
                body,
            ))
            if not surfaces_failure:
                line = source.count("\n", 0, match.start()) + 1
                issues.append(quality_issue(
                    "OQ4.1", "warning",
                    "Catch block handles failure without throwing or calling a recognized logger.",
                    relative, line,
                ))
    if "deep-indentation" in enabled:
        source_lines = source.splitlines()
        for symbol in symbols:
            if symbol.kind not in {"method", "function"}:
                continue
            measurement = swift_callable_indentation(source_lines, symbol)
            if measurement and measurement[0] >= 3:
                depth, line = measurement
                issues.append(quality_issue(
                    "OQ3.1", "warning",
                    f"Callable {symbol.name} reaches {depth} indentation levels; extract decisions or use guard clauses.",
                    relative, line,
                ))
    return issues


def analyze_file_quality(
    path: Path, root: Path, symbols: list[Symbol],
    optional_rules: frozenset[str] = frozenset(),
) -> list[QualityViolation]:
    relative = str(path.relative_to(root))
    source = path.read_text(encoding="utf-8", errors="replace")
    source_lines = source.splitlines()
    issues: list[QualityViolation] = []
    meaningful_lines = sum(bool(line.strip()) for line in source_lines)
    if meaningful_lines > FILE_LINE_LIMIT:
        issues.append(quality_issue(
            "CQ3.1", "warning",
            f"File contains {meaningful_lines} non-blank lines; consider separating cohesive responsibilities.",
            relative, 1,
            f"Measured {meaningful_lines} non-blank lines; configured limit is {FILE_LINE_LIMIT}.",
        ))

    for line_number, line in enumerate(source_lines, 1):
        match = SECRET_ASSIGNMENT_RE.search(line)
        if not match:
            continue
        value = match.group("value").strip().lower()
        placeholder = any(marker in value for marker in SECRET_PLACEHOLDERS)
        if not placeholder:
            issues.append(quality_issue(
                "CQ6.1", "error",
                "Credential-like variable contains a literal value; load secrets from the approved environment.",
                relative, line_number,
            ))

    ruleset = language_ruleset_for(path)
    if ruleset:
        issues.extend(ruleset.analyze_quality(relative, source, symbols))
    if path.suffix.lower() == ".py":
        issues.extend(analyze_python_optional_quality(relative, source, optional_rules))
    elif path.suffix.lower() == ".swift":
        issues.extend(analyze_swift_optional_quality(relative, source, symbols, optional_rules))
    issues = [
        replace(issue, evidence=quality_evidence(source_lines, issue))
        for issue in issues
    ]
    return sorted(issues, key=lambda issue: (issue.line, issue.code))


def attach_quality_issues(
    symbols: list[Symbol], issues: list[QualityViolation],
) -> None:
    for symbol in symbols:
        end_line = symbol.end_line or symbol.line
        symbol.quality_issues = [
            issue for issue in issues
            if issue.file == symbol.file and symbol.line <= issue.line <= end_line
        ]


def walk_source_files(root: Path) -> Iterable[Path]:
    for path in root.rglob("*"):
        if not path.is_file() or not language_ruleset_for(path):
            continue
        if any(part in IGNORED_DIRS for part in path.parts):
            continue
        yield path


def classify_tags(name: str, relative_path: str, source: str = "") -> set[str]:
    haystack = f"{name} {relative_path}".lower()
    tags = set()
    if any(word in haystack for word in (
        "view", "screen", "page", "controller", "component", "navigation",
        "router", "route", "present", "swiftui", "uikit",
    )):
        tags.add("ux")
    if re.search(r"^\s*(?:import|from)\s+(?:SwiftUI|UIKit|AppKit|tkinter|PyQt|PySide)\b", source, re.MULTILINE | re.IGNORECASE):
        tags.add("ux")
    if any(word in haystack for word in (
        "database", "repository", "persistence", "sqlite", "coredata", "model",
        "entity", "store", "cache", "schema", "query", "migration", "dao",
    )):
        tags.add("db")
    if re.search(r"^\s*(?:import|from)\s+(?:CoreData|SwiftData|sqlite3?|sqlalchemy|django\.db)\b", source, re.MULTILINE | re.IGNORECASE):
        tags.add("db")
    tags.add("app")
    return tags


def python_call_name(node: ast.Call) -> str | None:
    func = node.func
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


def parse_python(path: Path, root: Path) -> list[Symbol]:
    relative = str(path.relative_to(root))
    source = path.read_text(encoding="utf-8", errors="replace")
    lines = source.splitlines()

    def module_symbol(signature: str) -> Symbol:
        name = path.stem
        return Symbol(
            id=stable_id(relative, "module", name, 1), name=name, kind="module",
            file=relative, line=1, category="Modules", language="Python",
            signature=signature, tags=classify_tags(name, relative, source),
            end_line=max(1, len(lines)),
        )

    try:
        tree = ast.parse(source)
    except SyntaxError as error:
        return [module_symbol(f"Unparsed Python module: {error.msg}")]
    symbols: list[Symbol] = []

    class Visitor(ast.NodeVisitor):
        def __init__(self) -> None:
            self.parents: list[str] = []

        def add(self, node: ast.AST, name: str, kind: str) -> None:
            line = getattr(node, "lineno", 1)
            signature = lines[line - 1].strip() if line <= len(lines) else name
            calls = {
                called for child in ast.walk(node)
                if isinstance(child, ast.Call) and (called := python_call_name(child))
            }
            category = "Functions" if kind == "function" and not self.parents else "Modules"
            symbol = Symbol(
                id=stable_id(relative, kind, name, line), name=name, kind=kind,
                file=relative, line=line, category=category, language="Python",
                parent=self.parents[-1] if self.parents else None,
                signature=signature, calls=calls,
                tags=classify_tags(name, relative, source),
                end_line=getattr(node, "end_lineno", line),
            )
            symbols.append(symbol)

        def visit_ClassDef(self, node: ast.ClassDef) -> None:
            self.add(node, node.name, "class")
            self.parents.append(node.name)
            for child in node.body:
                self.visit(child)
            self.parents.pop()

        def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
            self.add(node, node.name, "method" if self.parents else "function")
            # Calls are collected above; nested functions still deserve their own node.
            for child in node.body:
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    self.visit(child)

        visit_AsyncFunctionDef = visit_FunctionDef

    Visitor().visit(tree)
    return symbols or [module_symbol("Python module")]


SWIFT_TYPE_RE = re.compile(r"\b(class|struct|enum|protocol|actor)\s+(\w+)")
SWIFT_EXTENSION_RE = re.compile(r"\bextension\s+(\w+)")
SWIFT_FUNC_RE = re.compile(r"\b(func\s+(\w+)|init\s*\(|subscript\s*\()")
SWIFT_UI_TYPE_RE = re.compile(
    r"(?m)^[ \t]*(?:(?:private|public|internal|fileprivate|open|final)[ \t]+)*"
    r"(struct|class)[ \t]+(\w+)[ \t]*:[ \t]*([^\n{]+)[ \t]*\{"
)
SWIFT_DATA_TYPE_RE = re.compile(
    r"(?m)^[ \t]*(?:(?:private|public|internal|fileprivate|open|final)[ \t]+)*"
    r"(class|struct|enum|actor|protocol)[ \t]+(\w+)[^\n{]*\{"
)


def swift_declaration_end_line(source: str, start: int, start_line: int) -> int:
    """Return the end line for a lightweight Swift declaration with a body."""
    opening = source.find("{", start, min(len(source), start + 1600))
    if opening < 0:
        return start_line
    prefix = source[start:opening]
    if "\n" in prefix and re.search(
        r"(?m)^\s*(?:class|struct|enum|protocol|actor|extension|func|init|subscript)\b",
        prefix.split("\n", 1)[1],
    ):
        return start_line
    _, closing = matching_brace_block(source, opening)
    return source.count("\n", 0, closing) + 1


def parse_swift(path: Path, root: Path) -> list[Symbol]:
    relative_path = path.relative_to(root)
    relative = str(relative_path)
    source = path.read_text(encoding="utf-8", errors="replace")
    swift_file = SwiftFile(path, relative_path)
    swift_file.parse(source)
    feature = categorize_by_feature(swift_file)
    symbols: list[Symbol] = []
    depth = 0
    type_stack: list[tuple[str, int]] = []
    source_offset = 0

    for line_no, line in enumerate(source.splitlines(), 1):
        stripped = line.strip()
        declaration_end = swift_declaration_end_line(source, source_offset, line_no)
        type_match = SWIFT_TYPE_RE.search(stripped)
        if type_match:
            kind, name = type_match.groups()
            parent = type_stack[-1][0] if type_stack else None
            symbols.append(Symbol(
                id=stable_id(relative, kind, name, line_no), name=name, kind=kind,
                file=relative, line=line_no, category=feature, language="Swift",
                parent=parent,
                signature=stripped, dependencies=set(swift_file.dependencies),
                tags=classify_tags(name, relative, source),
                end_line=declaration_end,
            ))
            type_stack.append((name, depth))
        else:
            extension_match = SWIFT_EXTENSION_RE.search(stripped)
            if extension_match:
                type_stack.append((extension_match.group(1), depth))

        func_match = SWIFT_FUNC_RE.search(stripped)
        if func_match and not stripped.startswith("//"):
            name = func_match.group(2) or ("init" if "init" in func_match.group(1) else "subscript")
            parent = type_stack[-1][0] if type_stack else None
            qualified = f"{parent}.{name}" if parent else name
            symbols.append(Symbol(
                id=stable_id(relative, "method" if parent else "function", qualified, line_no),
                name=name, kind="method" if parent else "function", file=relative,
                line=line_no, category=feature, language="Swift", parent=parent,
                signature=stripped.rstrip("{"), dependencies=set(swift_file.dependencies),
                tags=classify_tags(qualified, relative, source),
                end_line=declaration_end,
            ))

        # A lightweight call-site pass. Resolution happens after all files are parsed.
        if symbols and not stripped.startswith(("//", "func ")):
            calls = set(re.findall(r"\b([a-zA-Z_]\w*)\s*\(", stripped))
            calls -= {"if", "for", "while", "switch", "guard", "return", "init"}
            if calls:
                symbols[-1].calls.update(calls)

        depth += line.count("{") - line.count("}")
        while type_stack and depth <= type_stack[-1][1]:
            type_stack.pop()
        source_offset += len(line) + 1

    return symbols


LANGUAGE_RULESETS = (
    LanguageRuleset(
        language="Swift",
        extensions=frozenset({".swift"}),
        parse_symbols=parse_swift,
        analyze_quality=analyze_swift_quality,
    ),
    LanguageRuleset(
        language="Python",
        extensions=frozenset({".py"}),
        parse_symbols=parse_python,
        analyze_quality=analyze_python_source_quality,
    ),
)


def matching_brace_block(source: str, opening: int) -> tuple[str, int]:
    """Return a lightweight Swift declaration block and its closing offset."""
    depth = 0
    in_string = False
    escaped = False
    for index in range(opening, len(source)):
        char = source[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[opening:index + 1], index + 1
    return source[opening:], len(source)


def humanize_screen_name(name: str) -> str:
    if name.endswith("App"):
        return "App Launch"
    clean = re.sub(r"(ViewController|Controller|View|Screen|Page)$", "", name)
    return re.sub(r"(?<!^)(?=[A-Z])", " ", clean).replace("_", " ").strip() or name


def swift_ui_actions(block: str) -> list[str]:
    block = re.sub(r"(?m)//.*$", "", block)
    actions: list[str] = []
    patterns = (
        r"\bButton\s*\(\s*\"([^\"]+)\"",
        r"\bButton\s*\(\s*AppStrings\.text\(\s*\"([^\"]+)\"",
        r"\.accessibilityLabel\s*\(\s*\"([^\"]+)\"",
    )
    for pattern in patterns:
        actions.extend(match.group(1) for match in re.finditer(pattern, block))
    if ".onTapGesture" in block:
        actions.append("Tap content")
    return list(dict.fromkeys(actions))[:24]


def likely_swift_screen(name: str, conformance: str, block: str) -> bool:
    if re.search(r"\bApp\b", conformance):
        return True
    structural = any(marker in block for marker in (
        "NavigationStack", "NavigationSplitView", "NavigationView", "TabView",
        ".sheet(", ".fullScreenCover(", "WindowGroup", "NavigationLink",
        ".navigationDestination(",
    ))
    if structural:
        return True
    if re.search(r"(Root|Hub|Screen|Page|Detail|Sheet|Library|Selection|Handoff|Results|Lesson|Profile|Content)View$", name):
        return True
    component_words = (
        "Row", "Cell", "Button", "Label", "Header", "Bar", "Shape", "Style",
        "Component", "Bubble", "Badge", "Preview", "Representable", "Modifier",
    )
    return name.endswith(("View", "Screen", "Page")) and not any(word in name for word in component_words)


def swift_ancestor_headers(block: str, position: int) -> list[str]:
    """Return the source fragments immediately introducing enclosing closures."""
    stack: list[int] = []
    in_string = False
    escaped = False
    for index, char in enumerate(block[:position]):
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            stack.append(index)
        elif char == "}" and stack:
            stack.pop()
    return [block[max(0, opening - 180):opening] for opening in reversed(stack)]


def swift_navigation_evidence(source_name: str, item: dict, block: str, position: int, target_name: str) -> tuple[str, str, str] | None:
    """Accept only navigation constructs with explainable source evidence."""
    ancestors = swift_ancestor_headers(block, position)
    context = "\n".join(ancestors)
    if item["isApp"] and "WindowGroup" in context:
        return "launch", "WindowGroup root branch", "compiler-structural"
    if ".fullScreenCover" in context:
        return "full-screen", "fullScreenCover presentation", "compiler-structural"
    if ".sheet" in context:
        return "sheet", "sheet presentation", "compiler-structural"
    if ".popover" in context:
        return "popover", "popover presentation", "compiler-structural"
    if "NavigationLink" in context:
        return "navigate", "NavigationLink destination", "compiler-structural"
    if ".navigationDestination" in context:
        return "navigate", "navigationDestination closure", "compiler-structural"
    if source_name == "ContentView" and target_name in {"LibraryRootView", "LessonHubView", "LinguaWebView", "ProfileRootView"}:
        return "tab", f"RootScene tab: {humanize_screen_name(target_name)}", "project-convention"
    prefix = block[max(0, position - 220):position]
    cases = list(re.finditer(r"\bcase\s+\.([A-Za-z_]\w*)\s*:", prefix))
    if cases and re.search(r"\bswitch\s+", context):
        route_case = cases[-1].group(1)
        return "route", f"switch case .{route_case}", "state-route"
    return None


def swift_journey_payload(root: Path, source_files: list[Path]) -> dict:
    """Build a user-facing screen and navigation graph from Swift UI structure."""
    declarations: dict[str, dict] = {}
    for path in source_files:
        if path.suffix.lower() != ".swift":
            continue
        relative = str(path.relative_to(root))
        source = path.read_text(encoding="utf-8", errors="replace")
        for match in SWIFT_UI_TYPE_RE.finditer(source):
            declaration, name, conformance = match.groups()
            if not re.search(r"\b(?:View|App|UIViewController|NSViewController)\b", conformance) and not name.endswith(("View", "Screen", "Page", "Controller")):
                continue
            opening = source.find("{", match.start())
            block, _ = matching_brace_block(source, opening)
            line = source.count("\n", 0, match.start()) + 1
            candidate = {
                "sourceName": name,
                "declaration": declaration,
                "conformance": conformance.strip(),
                "file": relative,
                "line": line,
                "block": block,
                "initial": likely_swift_screen(name, conformance, block),
                "isApp": bool(re.search(r"\bApp\b", conformance)),
            }
            # Prefer the first non-preview declaration for duplicate type names.
            if name not in declarations or "Preview" in declarations[name]["file"]:
                declarations[name] = candidate

    promoted = {name for name, item in declarations.items() if item["initial"]}
    raw_edges: dict[tuple[str, str, str, str], dict] = {}
    for source_name, item in declarations.items():
        block = re.sub(r"(?m)//.*$", "", item["block"])
        for target_name in declarations:
            if target_name == source_name:
                continue
            for reference in re.finditer(rf"\b{re.escape(target_name)}\s*\(", block):
                evidence = swift_navigation_evidence(source_name, item, block, reference.start(), target_name)
                if not evidence:
                    continue
                transition, reason, confidence = evidence
                source_line = item["line"] + block.count("\n", 0, reference.start())
                promoted.update((source_name, target_name))
                raw_edges[(source_name, target_name, transition, reason)] = {
                    "source": source_name, "target": target_name, "type": transition,
                    "evidence": reason, "confidence": confidence,
                    "file": item["file"], "line": source_line,
                }

    entry_names = {name for name, item in declarations.items() if item["isApp"]}
    reachable = set(entry_names)
    while True:
        discovered = {
            edge["target"] for edge in raw_edges.values()
            if edge["source"] in reachable
        }
        expanded = reachable | discovered
        if expanded == reachable:
            break
        reachable = expanded
    if len(reachable) > len(entry_names):
        promoted = reachable
        raw_edges = {
            key: edge for key, edge in raw_edges.items()
            if edge["source"] in promoted and edge["target"] in promoted
        }

    modal_targets = {edge["target"] for edge in raw_edges.values() if edge["type"] in {"sheet", "full-screen"}}
    detail_targets = {edge["target"] for edge in raw_edges.values() if edge["type"] == "navigate"}
    nodes = []
    id_by_name: dict[str, str] = {}
    for name in sorted(promoted):
        item = declarations.get(name)
        if not item:
            continue
        node_id = stable_id(item["file"], "screen", name, item["line"])
        id_by_name[name] = node_id
        if item["isApp"]:
            category = "entry"
        elif name in modal_targets:
            category = "overlays"
        elif name in detail_targets or re.search(r"(Detail|Handoff|Results|Credits|Selection)", name):
            category = "details"
        elif re.search(r"(Content|Root|Hub)View$", name):
            category = "primary"
        else:
            category = "screens"
        title_match = re.search(r"\.navigationTitle\s*\(\s*\"([^\"]+)\"", item["block"])
        nodes.append({
            "id": node_id,
            "name": humanize_screen_name(name),
            "sourceName": name,
            "kind": "entry" if item["isApp"] else "screen",
            "file": item["file"],
            "line": item["line"],
            "category": category,
            "language": "Swift",
            "parent": None,
            "signature": f"{item['declaration']} {name}: {item['conformance']}",
            "title": title_match.group(1) if title_match else humanize_screen_name(name),
            "actions": swift_ui_actions(item["block"]),
            "tags": ["ux"],
        })

    edges = []
    for edge in raw_edges.values():
        if edge["source"] not in id_by_name or edge["target"] not in id_by_name:
            continue
        edges.append({
            "from": id_by_name[edge["source"]],
            "to": id_by_name[edge["target"]],
            "type": edge["type"],
            "evidence": edge["evidence"],
            "confidence": edge["confidence"],
            "file": edge["file"],
            "line": edge["line"],
        })
    categories = [
        {"id": "entry", "name": "Entry", "color": "lime"},
        {"id": "primary", "name": "Primary Navigation", "color": "cyan"},
        {"id": "screens", "name": "Screens", "color": "violet"},
        {"id": "details", "name": "Details", "color": "blue"},
        {"id": "overlays", "name": "Sheets & Modals", "color": "indigo"},
    ]
    return {"mode": "journey", "nodes": nodes, "edges": edges, "categories": categories}


def data_flow_payload(root: Path, source_files: list[Path]) -> dict:
    """Build a resource-level persistence map instead of a database-class map."""
    def production_path(path: Path) -> bool:
        relative = path.relative_to(root)
        parts = [part.lower() for part in relative.parts]
        filename = parts[-1]
        if filename.startswith(("test_", "mock_")) or filename.endswith(("tests.swift", "test.swift")):
            return False
        return not any(
            "test" in part
            or part in {"preview content", "design documents", "nonswiftscripts", "curator"}
            for part in parts[:-1]
        )

    sources: dict[str, str] = {}
    for path in source_files:
        if production_path(path):
            sources[str(path.relative_to(root))] = path.read_text(encoding="utf-8", errors="replace")
    for path in root.rglob("*.sql"):
        if path.is_file() and production_path(path) and not any(part in IGNORED_DIRS for part in path.parts):
            sources[str(path.relative_to(root))] = path.read_text(encoding="utf-8", errors="replace")

    resources: dict[tuple[str, str], dict] = {}
    table_aliases: dict[str, set[str]] = defaultdict(set)
    resource_blocks: dict[tuple[str, str], list[tuple[str, int, str]]] = defaultdict(list)

    def add_resource(kind: str, name: str, file: str, line: int, **extra) -> dict:
        key = (kind, name.lower())
        resource = resources.setdefault(key, {
            "kind": kind, "name": name, "file": file, "line": line,
            "fields": set(), "implementations": set(), "evidence": set(),
        })
        if line < resource["line"]:
            resource["file"], resource["line"] = file, line
        for field_name in extra.get("fields", []):
            resource["fields"].add(field_name)
        resource["implementations"].update(extra.get("implementations", []))
        resource["evidence"].update(extra.get("evidence", []))
        return resource

    for relative, source in sources.items():
        if relative.endswith(".swift"):
            for match in SWIFT_DATA_TYPE_RE.finditer(source):
                declaration, type_name = match.groups()
                opening = source.find("{", match.start())
                block, _ = matching_brace_block(source, opening)
                line = source.count("\n", 0, match.start()) + 1
                table_matches = list(re.finditer(
                    r"\b(?:static\s+)?(?:private\s+)?(?:let|var)\s+(\w+)\s*(?::[^=\n]+)?=\s*Table\s*\(\s*\"([^\"]+)\"",
                    block,
                ))
                expressions = {
                    expression.group(1): expression.group(2)
                    for expression in re.finditer(
                        r"\b(?:static\s+)?(?:private\s+)?(?:let|var)\s+(\w+)\s*=\s*(?:SQLite\.)?Expression\s*<[^>]+>\s*\(\s*\"([^\"]+)\"",
                        block,
                    )
                }
                for table_match in table_matches:
                    alias, table_name = table_match.groups()
                    table_line = line + block.count("\n", 0, table_match.start())
                    table_columns: set[str] = set()
                    create_match = re.search(
                        rf"\b{re.escape(alias)}\.create(?:\w*)?\s*\([^)]*\)\s*\{{\s*(\w+)\s+in",
                        block,
                    )
                    if create_match:
                        closure_opening = block.find("{", create_match.start())
                        closure, _ = matching_brace_block(block, closure_opening)
                        closure_variable = create_match.group(1)
                        referenced_columns = re.findall(
                            rf"\b{re.escape(closure_variable)}\.(?:column|primaryKey|foreignKey)\s*\(\s*(\w+)",
                            closure,
                        )
                        table_columns.update(expressions.get(column, column) for column in referenced_columns)
                    elif len(table_matches) == 1:
                        table_columns.update(expressions.values())
                    add_resource("table", table_name, relative, table_line, fields=table_columns, evidence=[f'Table("{table_name}")'])
                    table_aliases[table_name].update((alias, f"{type_name}.{alias}", table_name))

                if re.search(r"(?:Cache|CacheService)$", type_name):
                    kind, suffix = "cache", " Cache"
                    base = re.sub(r"(?:CacheService|Cache)$", "", type_name)
                elif re.search(r"Repository(?:Protocol)?$", type_name):
                    kind, suffix = "repository", " Repository"
                    base = re.sub(r"Repository(?:Protocol)?$", "", type_name)
                elif type_name.endswith("Store"):
                    kind, suffix = "store", " Store"
                    base = type_name.removesuffix("Store")
                else:
                    continue
                display = f"{humanize_screen_name(base)}{suffix}".strip()
                resource = add_resource(kind, display, relative, line, implementations=[type_name], evidence=[f"{declaration} {type_name}"])
                resource_blocks[(kind, display.lower())].append((relative, line, block))

        for create in re.finditer(r"(?is)\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[\"`\[]?([A-Za-z_]\w*)[\"`\]]?\s*\((.*?)\)", source):
            table_name, body = create.groups()
            line = source.count("\n", 0, create.start()) + 1
            fields = []
            for definition in body.split(","):
                token = definition.strip().split()
                if token and token[0].upper() not in {"PRIMARY", "FOREIGN", "UNIQUE", "CONSTRAINT", "CHECK"}:
                    fields.append(token[0].strip('"`[]'))
            add_resource("table", table_name, relative, line, fields=fields, evidence=["CREATE TABLE"])
            table_aliases[table_name].add(table_name)

    sqlite_sources = [(file, text) for file, text in sources.items() if re.search(r"\b(?:import\s+SQLite|sqlite3|Connection\s*\()", text)]
    databases: list[dict] = []
    seen_database_names: set[str] = set()
    for file, text in sqlite_sources:
        for filename in re.finditer(r"([A-Za-z_][\w.-]*\.sqlite3?)", text):
            name = filename.group(1)
            if name.lower() in seen_database_names:
                continue
            seen_database_names.add(name.lower())
            databases.append(add_resource(
                "database", name, file, text.count("\n", 0, filename.start()) + 1,
                evidence=["SQLite file"],
            ))
    if not databases and (any(resource["kind"] == "table" for resource in resources.values()) or sqlite_sources):
        db_file = sqlite_sources[0][0] if sqlite_sources else next(iter(sources), "database")
        databases.append(add_resource("database", "SQLite Database", db_file, 1, evidence=["SQLite connection"]))

    external_resources: dict[str, dict] = {}
    external_specs = {
        "UserDefaults": ("device preferences", r"\bUserDefaults\b"),
        "CloudKit": ("cloud store", r"\b(?:CloudKit|CKRecord|CKContainer)\b"),
        "Supabase": ("cloud database", r"\bSupabase\b|\bsupabase\."),
        "File System": ("file store", r"\bFileManager\b"),
    }
    for external_name, (detail, pattern) in external_specs.items():
        matches = [(file, text) for file, text in sources.items() if re.search(pattern, text)]
        if matches:
            file, text = matches[0]
            match = re.search(pattern, text)
            external_resources[external_name] = add_resource("external", external_name, file, text.count("\n", 0, match.start()) + 1, fields=[detail], evidence=[match.group(0)])

    edges: dict[tuple[tuple[str, str], tuple[str, str], str], dict] = {}

    def add_edge(source_key: tuple[str, str], target_key: tuple[str, str], flow: str, evidence: str, file: str, line: int) -> None:
        key = (source_key, target_key, flow)
        edge = edges.setdefault(key, {
            "sourceKey": source_key, "targetKey": target_key, "type": flow,
            "evidence": [], "file": file, "line": line,
        })
        if evidence not in edge["evidence"]:
            edge["evidence"].append(evidence)

    table_resources = {resource["name"]: resource for resource in resources.values() if resource["kind"] == "table"}
    if databases:
        primary_database = next(
            (item for item in databases if item["name"].lower() == "user_vocabulary.sqlite3"),
            databases[0],
        )
        database_key = (primary_database["kind"], primary_database["name"].lower())
        for table in table_resources.values():
            add_edge(database_key, ("table", table["name"].lower()), "contains", table["file"], table["file"], table["line"])

    for resource_key, blocks in resource_blocks.items():
        resource = resources[resource_key]
        for relative, block_line, block in blocks:
            for table_name, table in table_resources.items():
                aliases = table_aliases.get(table_name, {table_name})
                if relative != table["file"]:
                    aliases = {alias for alias in aliases if "." in alias}
                alias_pattern = "|".join(re.escape(alias) for alias in sorted(aliases, key=len, reverse=True))
                sql_name = re.escape(table_name)
                sql_reference = re.search(
                    rf"(?is)\b(?:FROM|JOIN|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+[\"`]?{sql_name}\b",
                    block,
                )
                alias_reference = re.search(rf"\b(?:{alias_pattern})\b", block) if alias_pattern else None
                if not sql_reference and not alias_reference:
                    continue
                writes = bool(re.search(rf"(?is)\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+[\"`]?{sql_name}\b", block))
                writes = writes or any(re.search(rf"\b{re.escape(alias)}\s*\.\s*(?:insert|update|delete)\b", block) for alias in aliases)
                reads = bool(re.search(rf"(?is)\b(?:FROM|JOIN)\s+[\"`]?{sql_name}\b", block))
                reads = reads or any(re.search(rf"\b{re.escape(alias)}\s*\.\s*(?:filter|count|select)\b|\b(?:prepare|pluck|scalar)\s*\(\s*{re.escape(alias)}\b", block) for alias in aliases)
                if resource["kind"] == "cache" and any(re.search(rf"\b{re.escape(alias)}\b", block) for alias in aliases):
                    flow = "backed-by"
                elif reads and writes:
                    flow = "reads/writes"
                elif writes:
                    flow = "writes"
                elif reads:
                    flow = "reads"
                else:
                    flow = "accesses"
                reference_positions = [match.start() for alias in aliases for match in re.finditer(rf"\b{re.escape(alias)}\b", block)]
                if sql_reference:
                    reference_positions.append(sql_reference.start())
                first_reference = min(reference_positions, default=0)
                line = block_line + block.count("\n", 0, first_reference)
                add_edge(resource_key, ("table", table["name"].lower()), flow, f"{flow} {table_name}", relative, line)

            for external_name, external in external_resources.items():
                pattern = external_specs[external_name][1]
                match = re.search(pattern, block)
                if match:
                    flow = "syncs" if external_name in {"CloudKit", "Supabase"} else "persists"
                    add_edge(resource_key, ("external", external["name"].lower()), flow, match.group(0), relative, block_line + block.count("\n", 0, match.start()))

    connected_keys = {edge[0] for edge in edges} | {edge[1] for edge in edges}
    resources = {
        key: resource for key, resource in resources.items()
        if key in connected_keys or resource["kind"] in {"database", "table"}
    }
    ordered_resources = sorted(resources.items(), key=lambda item: (
        {"database": 0, "repository": 1, "store": 2, "cache": 3, "table": 4, "external": 5}.get(item[1]["kind"], 9),
        item[1]["name"],
    ))
    id_by_key: dict[tuple[str, str], str] = {}
    nodes = []
    category_by_kind = {"database": "databases", "repository": "repositories", "store": "stores", "cache": "caches", "table": "tables", "external": "external"}
    for key, resource in ordered_resources:
        node_id = stable_id(resource["file"], resource["kind"], resource["name"], resource["line"])
        id_by_key[key] = node_id
        nodes.append({
            "id": node_id, "name": resource["name"], "sourceName": resource["name"],
            "kind": resource["kind"], "file": resource["file"], "line": resource["line"],
            "category": category_by_kind[resource["kind"]], "language": "Data",
            "parent": None, "signature": " / ".join(sorted(resource["evidence"])) or resource["name"],
            "fields": sorted(resource["fields"]),
            "implementations": sorted(resource["implementations"]), "tags": ["db"],
        })
    edge_payload = [{
        "from": id_by_key[edge["sourceKey"]], "to": id_by_key[edge["targetKey"]],
        "type": edge["type"], "evidence": " / ".join(edge["evidence"]),
        "file": edge["file"], "line": edge["line"], "confidence": "structural",
    } for edge in edges.values() if edge["sourceKey"] in id_by_key and edge["targetKey"] in id_by_key]
    categories = [
        {"id": "databases", "name": "Databases", "color": "lime"},
        {"id": "repositories", "name": "Repositories", "color": "cyan"},
        {"id": "stores", "name": "Stores", "color": "blue"},
        {"id": "caches", "name": "Caches", "color": "aqua"},
        {"id": "tables", "name": "Tables", "color": "violet"},
        {"id": "external", "name": "External Stores", "color": "indigo"},
    ]
    return {"mode": "data-flow", "nodes": nodes, "edges": edge_payload, "categories": categories}


def make_edges(symbols: list[Symbol]) -> list[dict]:
    by_name: dict[str, list[Symbol]] = defaultdict(list)
    for symbol in symbols:
        by_name[symbol.name].append(symbol)
    edges: dict[tuple[str, str, str], dict] = {}
    for symbol in symbols:
        for call in symbol.calls:
            targets = by_name.get(call, [])
            if targets:
                target = next((item for item in targets if item.file == symbol.file), targets[0])
                if target.id != symbol.id:
                    key = (symbol.id, target.id, "calls")
                    edges[key] = {"from": symbol.id, "to": target.id, "type": "calls"}
        for dependency in symbol.dependencies:
            clean = re.sub(r"\s*\(.*\)$", "", dependency)
            if clean in by_name:
                target = by_name[clean][0]
                if target.id != symbol.id:
                    key = (symbol.id, target.id, "depends")
                    edges[key] = {"from": symbol.id, "to": target.id, "type": "depends"}
    return list(edges.values())


def default_categories(layer: str, symbols: list[Symbol]) -> list[dict]:
    if layer == "ux":
        names = ["Entry", "Screens", "Components", "Navigation"]
    elif layer == "db":
        names = ["Models", "Repositories", "Storage", "Unsorted"]
    else:
        counts = Counter(symbol.category for symbol in symbols)
        names = [name for name, _ in counts.most_common()] or ["Unsorted"]
    colors = ["violet", "cyan", "lime", "blue", "indigo", "aqua"]
    return [
        {"id": re.sub(r"\W+", "-", name.lower()).strip("-"), "name": name, "color": colors[i % len(colors)]}
        for i, name in enumerate(names)
    ]


def layer_payload(layer: str, all_symbols: list[Symbol], all_edges: list[dict], saved: dict) -> dict:
    if layer == "app":
        symbols = all_symbols
    else:
        symbols = [symbol for symbol in all_symbols if layer in symbol.tags]
    ids = {symbol.id for symbol in symbols}
    edges = [edge for edge in all_edges if edge["from"] in ids and edge["to"] in ids]
    categories = saved.get("categories") or default_categories(layer, symbols)
    category_ids = {category["id"] for category in categories}
    assignments = saved.get("assignments", {})

    node_payloads = []
    for symbol in symbols:
        assigned = assignments.get(symbol.id)
        if assigned in category_ids:
            category = assigned
        elif layer == "ux":
            hint = symbol.name.lower() + " " + symbol.file.lower()
            category = (
                "navigation" if any(x in hint for x in ("nav", "route", "router")) else
                "screens" if any(x in hint for x in ("screen", "page", "view", "controller")) else
                "components"
            )
        elif layer == "db":
            hint = symbol.name.lower() + " " + symbol.file.lower()
            category = (
                "repositories" if "repositor" in hint or "dao" in hint else
                "models" if "model" in hint or "entity" in hint else
                "storage" if any(x in hint for x in ("database", "store", "cache", "persist", "sqlite")) else
                "unsorted"
            )
        else:
            match = next((c["id"] for c in categories if c["name"] == symbol.category), None)
            category = match or (categories[0]["id"] if categories else "unsorted")
        node = symbol.as_dict()
        node["category"] = category
        node_payloads.append(node)
    return {"mode": "architecture", "nodes": node_payloads, "edges": edges, "categories": categories}


def read_layouts() -> dict:
    try:
        return json.loads(LAYOUT_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def write_layouts(layouts: dict) -> None:
    temporary = LAYOUT_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(layouts, indent=2), encoding="utf-8")
    temporary.replace(LAYOUT_FILE)


def choose_source_folder() -> Path | None:
    """Open the operating system's native directory chooser."""
    system = platform.system()
    try:
        if system == "Darwin":
            output = subprocess.check_output(
                [
                    "osascript",
                    "-e",
                    'POSIX path of (choose folder with prompt "Choose a codebase to map")',
                ],
                stderr=subprocess.DEVNULL,
                text=True,
            )
        elif system == "Windows":
            script = (
                "Add-Type -AssemblyName System.Windows.Forms; "
                "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog; "
                "$dialog.Description = 'Choose a codebase to map'; "
                "if ($dialog.ShowDialog() -eq 'OK') { $dialog.SelectedPath }"
            )
            output = subprocess.check_output(
                ["powershell", "-NoProfile", "-Command", script],
                stderr=subprocess.DEVNULL,
                text=True,
            )
        elif shutil.which("zenity"):
            output = subprocess.check_output(
                ["zenity", "--file-selection", "--directory", "--title=Choose a codebase to map"],
                stderr=subprocess.DEVNULL,
                text=True,
            )
        elif shutil.which("kdialog"):
            output = subprocess.check_output(
                ["kdialog", "--getexistingdirectory", str(Path.home()), "--title", "Choose a codebase to map"],
                stderr=subprocess.DEVNULL,
                text=True,
            )
        else:
            raise RuntimeError("No native folder chooser is available on this system")
    except subprocess.CalledProcessError:
        return None

    selected = Path(output.strip()).expanduser().resolve()
    return selected if selected.is_dir() else None


def scan_project(
    raw_path: str, optional_rules: frozenset[str] = frozenset(),
) -> dict:
    root = Path(raw_path).expanduser().resolve()
    if not root.is_dir():
        raise ValueError(f"Folder does not exist: {root}")
    optional_rules = frozenset(optional_rules & OPTIONAL_QUALITY_RULES.keys())
    symbols: list[Symbol] = []
    quality_issues: list[QualityViolation] = []
    source_files = list(walk_source_files(root))
    for path in source_files:
        ruleset = language_ruleset_for(path)
        if not ruleset:
            continue
        file_symbols: list[Symbol] = []
        try:
            file_symbols = ruleset.parse_symbols(path, root)
        except (OSError, UnicodeError):
            continue
        symbols.extend(file_symbols)
        try:
            quality_issues.extend(analyze_file_quality(
                path, root, file_symbols, optional_rules,
            ))
        except (OSError, UnicodeError):
            continue
    attach_quality_issues(symbols, quality_issues)
    edges = make_edges(symbols)
    project_key = hashlib.sha1(str(root).encode()).hexdigest()[:16]
    saved_project = read_layouts().get(project_key, {})
    languages = Counter(symbol.language for symbol in symbols)
    issues_by_file: dict[str, list[dict]] = defaultdict(list)
    for issue in quality_issues:
        issues_by_file[issue.file].append(issue.as_dict())
    affected_types = {
        (symbol.file, symbol.line) for symbol in symbols
        if symbol.kind in {"class", "struct", "enum", "protocol", "actor"}
        and symbol.quality_issues
    }
    return {
        "project": str(root),
        "projectName": root.name,
        "projectKey": project_key,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "stats": {
            "files": len(source_files), "symbols": len(symbols), "relations": len(edges),
            "languages": dict(languages), "qualityViolations": len(quality_issues),
        },
        "quality": {
            "rulesDocument": "CODE_QUALITY_RULES.md",
            "scope": "Deterministic checks mapped to charter Rules 3, 4, 6, and 7",
            "optionalRules": [
                {"id": rule_id, "name": OPTIONAL_QUALITY_RULES[rule_id]}
                for rule_id in sorted(optional_rules)
            ],
            "summary": {
                "violations": len(quality_issues),
                "files": len(issues_by_file),
                "types": len(affected_types),
            },
            "files": dict(issues_by_file),
            "ruleCatalog": [
                {
                    "code": code, "charterRule": details[0],
                    "charterTitle": details[1], "title": details[2],
                    "optional": code in OPTIONAL_CODE_TO_RULE,
                    "optionId": OPTIONAL_CODE_TO_RULE.get(code),
                }
                for code, details in QUALITY_RULE_CATALOG.items()
            ],
        },
        "layers": {
            "ux": swift_journey_payload(root, source_files),
            "app": layer_payload("app", symbols, edges, saved_project.get("app", {})),
            "db": data_flow_payload(root, source_files),
        },
    }


class SoulHandler(BaseHTTPRequestHandler):
    server_version = "CyberSoul/0.1"

    def log_message(self, format: str, *args) -> None:
        print(f"[cyber-soul] {format % args}")

    def send_json(self, payload: dict, status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/scan":
            query = parse_qs(parsed.query)
            raw_path = query.get("path", [str(ROOT)])[0]
            optional_rules = frozenset(
                item for value in query.get("optional", [])
                for item in value.split(",") if item
            )
            try:
                self.send_json(scan_project(raw_path, optional_rules))
            except ValueError as error:
                self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            except Exception as error:  # Keep the local UI alive and surface scanner failures.
                self.send_json({"error": f"Scan failed: {error}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        requested = "index.html" if parsed.path == "/" else unquote(parsed.path.lstrip("/"))
        target = (STATIC / requested).resolve()
        if STATIC not in target.parents and target != STATIC:
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        if not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        body = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        route = urlparse(self.path).path
        if route == "/api/select-folder":
            if self.headers.get("X-Cyber-Soul-Action") != "select-folder":
                self.send_json({"error": "Invalid folder-picker request"}, HTTPStatus.FORBIDDEN)
                return
            if not FOLDER_PICKER_LOCK.acquire(blocking=False):
                self.send_json({"error": "A folder chooser is already open"}, HTTPStatus.CONFLICT)
                return
            try:
                selected = choose_source_folder()
                self.send_json({"path": str(selected)} if selected else {"cancelled": True})
            except RuntimeError as error:
                self.send_json({"error": str(error)}, HTTPStatus.NOT_IMPLEMENTED)
            finally:
                FOLDER_PICKER_LOCK.release()
            return
        if route != "/api/layout":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length))
            key = str(payload["projectKey"])
            layer = str(payload["layer"])
            if layer not in {"ux", "app", "db"}:
                raise ValueError("Unknown layer")
            categories = payload.get("categories", [])
            assignments = payload.get("assignments", {})
            if not isinstance(categories, list) or not isinstance(assignments, dict):
                raise ValueError("Invalid layout")
            layouts = read_layouts()
            layouts.setdefault(key, {})[layer] = {
                "categories": categories[:40],
                "assignments": {str(k): str(v) for k, v in assignments.items()},
            }
            write_layouts(layouts)
            self.send_json({"ok": True})
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)


def main() -> None:
    parser = argparse.ArgumentParser(description="Launch the Cyber Soul codebase explorer")
    parser.add_argument("path", nargs="?", default=str(ROOT), help="codebase to scan on launch")
    parser.add_argument("--port", type=int, default=8877)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), SoulHandler)
    url = f"http://127.0.0.1:{args.port}/?path={Path(args.path).expanduser().resolve()}"
    print(f"Cyber Soul is listening at {url}")
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nCyber Soul stopped.")


if __name__ == "__main__":
    main()
