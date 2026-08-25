import tempfile
import unittest
from pathlib import Path

from cyber_soul_gui import (
    LANGUAGE_RULESETS,
    LanguageRuleset,
    analyze_file_quality,
    attach_quality_issues,
    language_ruleset_for,
    parse_python,
    parse_swift,
    scan_project,
)


class CodeQualityScannerTests(unittest.TestCase):
    def write_source(self, root: Path, name: str, source: str) -> Path:
        path = root / name
        path.write_text(source, encoding="utf-8")
        return path

    def test_python_findings_map_to_enclosing_class(self) -> None:
        source = '''
import pickle
import subprocess

class CorruptedService:
    def execute(self, entries=[]):
        try:
            eval("1 + 1")
            subprocess.run("echo unsafe", shell=True)
            pickle.loads(b"payload")
        except:
            pass
'''
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self.write_source(root, "service.py", source)
            symbols = parse_python(path, root)
            issues = analyze_file_quality(path, root, symbols)
            attach_quality_issues(symbols, issues)

        codes = {issue.code for issue in issues}
        self.assertTrue({"CQ4.1", "CQ4.2", "CQ4.3", "CQ6.2", "CQ6.3", "CQ6.4"} <= codes)
        evidence = {issue.code: issue.evidence for issue in issues}
        self.assertIn('eval("1 + 1")', evidence["CQ6.2"])
        self.assertIn("shell=True", evidence["CQ6.3"])
        class_symbol = next(symbol for symbol in symbols if symbol.kind == "class")
        self.assertTrue(codes <= {issue.code for issue in class_symbol.quality_issues})

    def test_secret_literal_is_reported_without_exposing_its_value(self) -> None:
        variable_name = "api_" + "key"
        credential = "sk-live-" + "1234567890"
        source = f'{variable_name} = "{credential}"\n'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self.write_source(root, "settings.py", source)
            issues = analyze_file_quality(path, root, [])

        secret = next(issue for issue in issues if issue.code == "CQ6.1")
        self.assertNotIn("sk-live", secret.message)
        self.assertNotIn(credential, secret.evidence)
        self.assertIn("<redacted>", secret.evidence)

    def test_safe_secret_and_yaml_patterns_are_not_reported(self) -> None:
        source = '''
import os
import yaml

api_key = os.environ["API_KEY"]
example_password = "changeme"
data = yaml.load(payload, Loader=yaml.SafeLoader)
'''
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self.write_source(root, "safe.py", source)
            symbols = parse_python(path, root)
            issues = analyze_file_quality(path, root, symbols)

        self.assertFalse({"CQ6.1", "CQ6.4"} & {issue.code for issue in issues})

    def test_optional_rules_are_disabled_by_default_and_report_proven_patterns(self) -> None:
        source = '''
def silent_fallback():
    try:
        perform_work()
    except ValueError:
        return None

def logged_fallback(logger):
    try:
        perform_work()
    except ValueError:
        logger.exception("work failed")
        return None

def deeply_nested(items):
    if items:
        for item in items:
            if item.ready:
                return item
'''
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self.write_source(root, "optional.py", source)
            symbols = parse_python(path, root)
            core_issues = analyze_file_quality(path, root, symbols)
            optional_issues = analyze_file_quality(
                path, root, symbols,
                frozenset({"no-silent-failure", "deep-indentation"}),
            )

        self.assertFalse({issue.code for issue in core_issues} & {"OQ3.1", "OQ4.1"})
        self.assertEqual(1, sum(issue.code == "OQ4.1" for issue in optional_issues))
        self.assertEqual(1, sum(issue.code == "OQ3.1" for issue in optional_issues))
        optional_payloads = [issue.as_dict() for issue in optional_issues if issue.code.startswith("OQ")]
        self.assertTrue(all(issue["optional"] for issue in optional_payloads))
        self.assertEqual(
            {"deep-indentation", "no-silent-failure"},
            {issue["optionId"] for issue in optional_payloads},
        )

    def test_swift_failures_map_to_enclosing_type(self) -> None:
        source = '''
class ForgeService {
    func awaken() {
        do {
            try! ignite()
        } catch { }
    }
}
'''
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self.write_source(root, "ForgeService.swift", source)
            symbols = parse_swift(path, root)
            issues = analyze_file_quality(path, root, symbols)
            attach_quality_issues(symbols, issues)

        self.assertEqual({"CQ4.2", "CQ4.4"}, {issue.code for issue in issues})
        class_symbol = next(symbol for symbol in symbols if symbol.kind == "class")
        self.assertEqual({"CQ4.2", "CQ4.4"}, {issue.code for issue in class_symbol.quality_issues})

    def test_swift_optional_rules_report_silent_catch_and_deep_indentation(self) -> None:
        source = '''
class ForgeService {
    func recover() {
        do {
            try awaken()
        } catch {
            useFallback()
        }
    }

    func deeplyNested(items: [Item]) {
        if !items.isEmpty {
            for item in items {
                if item.isReady {
                    consume(item)
                }
            }
        }
    }
}
'''
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self.write_source(root, "ForgeService.swift", source)
            symbols = parse_swift(path, root)
            issues = analyze_file_quality(
                path, root, symbols,
                frozenset({"no-silent-failure", "deep-indentation"}),
            )

        self.assertEqual(1, sum(issue.code == "OQ4.1" for issue in issues))
        self.assertEqual(1, sum(issue.code == "OQ3.1" for issue in issues))

    def test_language_rulesets_abstract_parser_and_quality_dispatch(self) -> None:
        swift = language_ruleset_for(Path("Forge.swift"))
        python = language_ruleset_for(Path("forge.PY"))

        self.assertIsInstance(swift, LanguageRuleset)
        self.assertEqual("Swift", swift.language)
        self.assertIs(swift.parse_symbols, parse_swift)
        self.assertEqual("Python", python.language)
        self.assertIs(python.parse_symbols, parse_python)
        self.assertIsNone(language_ruleset_for(Path("forge.js")))
        self.assertEqual(
            {"Swift", "Python"},
            {ruleset.language for ruleset in LANGUAGE_RULESETS},
        )

    def test_syntax_error_and_payload_summary_are_exposed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_source(root, "broken.py", "def broken(:\n    pass\n")
            payload = scan_project(str(root))

        self.assertEqual(1, payload["stats"]["qualityViolations"])
        self.assertEqual("CQ7.1", payload["quality"]["files"]["broken.py"][0]["code"])
        self.assertEqual(7, payload["quality"]["files"]["broken.py"][0]["charterRule"])
        self.assertEqual("def broken(:", payload["quality"]["files"]["broken.py"][0]["evidence"])
        module = payload["layers"]["app"]["nodes"][0]
        self.assertEqual("module", module["kind"])
        self.assertEqual("CQ7.1", module["qualityIssues"][0]["code"])


if __name__ == "__main__":
    unittest.main()
