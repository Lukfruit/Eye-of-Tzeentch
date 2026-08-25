# Code Quality Rules for the Machine Gods

**Status:** Repository guidance  
**Scope:** Python, JavaScript, HTML/CSS, and future languages in this repository  
**Audience:** Human maintainers and coding agents  
**Last reviewed:** 2026-08-13

This document is a practical quality charter for changes made to this codebase. It
combines the most useful, language-agnostic guidance from the sources listed at the
end with project-specific operating rules.

The goal is not ornamental perfection. The goal is code that is easier to
understand, safer to change, demonstrably correct, and measurably healthier after
each change.

## The prime directive

Every accepted change must leave the codebase at least as healthy as it found it.
Prefer a small, correct improvement over a large, clever rewrite. When several
solutions are technically sound, follow the conventions already established in the
surrounding code and choose the simplest one that satisfies the requirement.

## Rules of the forge

### 1. Understand the system before editing it

- Read the repository instructions, README, relevant entry points, and nearby tests
  before changing code.
- Trace the behavior through its callers and consumers. Do not infer an interface
  from one function in isolation.
- State the intended behavior, important edge cases, and compatibility constraints
  before implementing non-trivial work.
- Preserve existing behavior unless the change explicitly requires changing it.

### 2. Keep changes focused and reversible

- Make one coherent change at a time. Avoid mixing feature work, unrelated cleanup,
  formatting churn, and broad renames.
- Keep refactors separate from behavior changes when practical.
- Prefer small, self-contained diffs that can be reviewed, tested, reverted, and
  diagnosed independently.
- Do not add speculative abstractions, unused APIs, or future-proofing without a
  current requirement.
- Do not modify unrelated files merely because they are nearby or imperfect.

### 3. Optimize for human comprehension

- Choose names that describe the domain meaning, not the implementation accident.
- Keep functions and modules cohesive. If a unit needs a long explanation to be
  understood, simplify its control flow or split its responsibilities.
- Make data flow, ownership, error paths, and side effects visible.
- Prefer straightforward code over compressed cleverness.
- Follow the project’s formatter and style guide. Consistency within the project is
  more valuable than importing a new personal preference.
- Comments must explain *why*, constraints, or non-obvious trade-offs. Update or
  delete comments that no longer match the code.
- Remove dead code, stale flags, unreachable branches, and unused imports when they
  are within the scope of the change.

### 4. Make behavior explicit and defensive

- Validate untrusted or externally supplied data at system boundaries.
- Use allow-lists and precise types/constraints where possible; do not rely on
  convenient truthiness or implicit coercion for important decisions.
- Handle expected failures deliberately. Do not swallow exceptions, return sentinel
  values without documenting them, or continue after a partially failed operation
  unless that behavior is intentional.
- Give errors useful context while avoiding secrets and sensitive user data in logs.
- Define behavior for empty input, missing data, malformed input, duplicates,
  timeouts, cancellation, and partial failure where those cases can occur.
- Keep side effects at clear boundaries so core logic can be reasoned about and
  tested independently.

### 5. Treat tests as part of the implementation

- Add or update tests in the same change as new or changed logic.
- Test the contract: normal behavior, boundaries, failure paths, and important
  regressions. Do not test implementation details when the public behavior is what
  matters.
- Every test must make a useful assertion and should fail when the behavior it
  protects is broken.
- Prefer the smallest test level that proves the behavior: unit tests for local
  logic, integration tests for boundaries, and end-to-end tests for critical user
  journeys.
- Keep tests readable and maintainable. Test code is production code for the
  maintenance team.
- Run the narrowest relevant checks first, then the broader suite when practical.
  Record what was run and what was not run.

### 6. Build security into normal coding

- Treat all external input as untrusted until validated.
- Enforce authentication and authorization at the point where access is granted;
  never assume that a caller already checked permissions.
- Use parameterized queries, safe serializers, framework escaping, and vetted
  cryptographic libraries. Do not roll custom cryptography or security protocols.
- Never commit credentials, private keys, tokens, personal data, or production
  configuration secrets. Load secrets through the project’s approved environment or
  secret-management mechanism.
- Apply least privilege to files, processes, APIs, and dependencies.
- Review dependency additions for necessity, maintenance health, licensing,
  vulnerabilities, and transitive impact. Pin or lock versions when the ecosystem
  supports it.
- For changes involving sensitive data, identity, network boundaries, file access,
  parsing, serialization, or privileged operations, perform a deliberate threat
  review before merging.
- Use automated security tooling where available, but do not treat a clean scanner
  result as proof that manual review is unnecessary.

### 7. Make the toolchain enforce the easy rules

- Use an automatic formatter and linter appropriate to each language.
- Treat type-checker, compiler, linter, test, and security-scan failures as blocking
  unless the exception is explicit, narrow, documented, and tracked.
- Keep CI checks reproducible from a clean checkout.
- Use warnings as defects when they reveal ambiguous behavior, unsafe conversions,
  resource leaks, or ignored failures.
- Prefer repository-local tool configuration so an agent and a human receive the
  same verdict.

### 8. Review like a maintainer

Before accepting a change, inspect the complete diff and the surrounding context:

- Does it solve the stated problem without changing unrelated behavior?
- Is the design simpler or clearer than the previous one?
- Are names, boundaries, error handling, and comments understandable to a new
  maintainer?
- Are tests present, meaningful, and actually exercising the changed behavior?
- Are security, privacy, dependency, performance, and concurrency consequences
  addressed where relevant?
- Does documentation, configuration, or the README need to change?
- Does the change improve overall code health rather than merely silence a symptom?

Review technical facts and project conventions before personal preference. A review
comment should explain the risk or benefit, identify the requested action, and make
clear whether it is blocking or advisory.

## Machine-agent operating procedure

Coding agents must follow this sequence for every repository change:

1. **Reconnoitre:** inspect the repository structure, instructions, relevant code,
   tests, and current working-tree state.
2. **Form a bounded plan:** identify the smallest set of files and the behavior to
   preserve or change. Ask for clarification when a missing requirement would make
   the result materially different.
3. **Implement minimally:** edit only the files needed for the requested behavior.
   Preserve existing user changes and do not rewrite unrelated code.
4. **Verify:** run formatting, linting, type checks, tests, and security checks that
   apply. Add a regression test for every bug fixed when feasible.
5. **Inspect the diff:** check for accidental edits, debug output, secrets, dead
   code, generated-file noise, and documentation drift.
6. **Report faithfully:** name the files changed, checks run, failures remaining,
   and assumptions made. Never claim a check passed if it was not run.

## Repository defaults

- Python code follows [PEP 8](https://peps.python.org/pep-0008/) and the repository’s
  existing conventions. Use the [Google Python Style Guide](https://google.github.io/styleguide/pyguide.html)
  for additional guidance where this document is silent.
- JavaScript follows the established project style and may use the
  [Google JavaScript Style Guide](https://google.github.io/styleguide/jsguide.html)
  as the baseline where no local convention exists.
- Do not open `static/index.html` directly; verify the app through its local Python
  server as described in `README.md`.
- For a Python-only edit, at minimum run a syntax/compile check for the affected
  modules and the relevant tests. For a frontend edit, exercise the affected UI
  path through the local server and inspect the browser console for errors.
- Before handoff, run `git diff --check` and review the complete diff.

## Definition of ready

A change is ready to merge when:

- the intended behavior is clear;
- the diff is focused and readable;
- relevant tests and checks pass, or their failures are explicitly recorded;
- security and dependency implications have been considered;
- user-facing or maintainer-facing documentation is current; and
- the resulting codebase is no harder to understand or safely modify.

## Sources and rationale

These rules are a synthesis, not a replacement for language- or risk-specific
standards. Consult the source that matches the change:

- [Google Engineering Practices: The Standard of Code Review](https://google.github.io/eng-practices/review/reviewer/standard.html)
  — code review exists to improve overall code health; technical facts and project
  style outrank personal preference.
- [Google Engineering Practices: Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html)
  — focused changes are easier to review, less likely to introduce bugs, easier to
  merge, and easier to roll back; related tests belong with the change.
- [Google Engineering Practices: What to Look for in a Code Review](https://google.github.io/eng-practices/review/reviewer/looking-for.html)
  — review design, complexity, names, comments, tests, context, and system-wide
  code health.
- [Google Style Guides](https://google.github.io/styleguide/) — use a project’s
  established style guide to make large codebases consistent and readable.
- [PEP 8](https://peps.python.org/pep-0008/) — Python’s official style guidance,
  including readability, naming, comments, and consistency principles.
- [OWASP Secure Code Review Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secure_Code_Review_Cheat_Sheet.html)
  — manual review remains necessary for input validation, authorization,
  deserialization, cryptography, business logic, and configuration risks that
  automation can miss.
- [OWASP Secure Coding Practices Quick Reference Guide](https://owasp.org/www-project-secure-coding-practices-quick-reference-guide/stable-en/)
  — technology-agnostic secure-coding checklist for integrating security into the
  development lifecycle.
- [NIST Secure Software Development Framework](https://csrc.nist.gov/projects/ssdf)
  — use a risk-based, continuously improving framework organized around preparing
  the organization, protecting software, producing well-secured software, and
  responding to vulnerabilities.
- [SEI CERT Coding Standards](https://wiki.sei.cmu.edu/confluence/display/seccode)
  — language-specific rules for avoiding common security and reliability defects;
  consult the relevant standard for C, C++, Java, and other supported languages.

When a law, contract, platform rule, language standard, or project-specific
instruction is stricter than this document, the stricter requirement wins.
