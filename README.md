# Cyber Soul

Cyber Soul is a local 2D cartography GUI for turning a codebase into an explorable architecture map. It builds on `generate_feature_maps.py`, scans Swift and Python symbols, and organizes feature regions, files, symbols, and their pathways into a readable drill-down interface.

## Run

On macOS, double-click **Launch Cyber Soul.command**. On Linux, run
`./launch_cyber_soul.sh`. On Windows, double-click **Launch Cyber Soul.bat**.

Or launch it directly with Python:

```bash
python3 cyber_soul_gui.py /absolute/path/to/your/project
```

The app opens at `http://127.0.0.1:8877`. Use `--no-browser` to keep it from opening a system browser automatically, or `--port 9000` to choose another port.

Click **BROWSE** beside the project path to choose a codebase with the operating system's native folder picker. Selecting a folder immediately generates its map.

### Restart after code changes

Backend scanner changes require a full server restart; refreshing the browser only
reloads the frontend files. In the terminal running Cyber Soul, press `Ctrl+C`,
then launch it again with the same command. On macOS, you can instead close the
Terminal window opened by **Launch Cyber Soul.command** and double-click the file
again. On Windows, press `Ctrl+C` in its console and reopen **Launch Cyber
Soul.bat**.

Do not open `static/index.html` directly. It is the renderer shell and requires
the local Python scanner/API. Accidental direct opens redirect to the default
local server address.

## What works

- Event-driven 2D renderer with no WebGL or permanent animation loop
- Fast switching between a user-journey Experience map, an implementation Application map, and a persistence-oriented Data map
- Dedicated SwiftUI journey extraction for app entry conditions, root tabs, direct screen flows, `NavigationLink`, sheets, and full-screen covers
- Experience nodes show user-visible screens, available actions, outgoing destinations, and transition types—not implementation classes tagged as UI
- User paths require structural evidence (`WindowGroup`, `NavigationLink`, presentation modifiers, project tab conventions, or an enclosing state-route `switch`); plain view composition is not treated as navigation
- Each journey edge retains its evidence, confidence class, and exact source coordinate for auditing
- Dedicated Data topology extraction for SQLite databases, declared tables and columns, repositories, stores, caches, and external persistence
- Data nodes are the resources themselves; implementation classes are retained only as source provenance and never presented as data locations
- Read, write, backing-store, containment, and synchronization flows require direct table/API evidence and retain exact source coordinates
- Test fixtures, mocks, preview assets, and build/curation scripts are excluded from the runtime Data plane
- High-contrast region, file, and symbol cards with persistent labels and metrics
- Region headers show quality-breach totals and affected regions sort to the front
- Red and orange are reserved for error and warning breaches; architecture entities
  and regions use a separate green, blue, cyan, indigo, and violet palette
- Pannable category map with folders distributed across a spatial surface
- Every category folder contains an ordered, scrollable list of expandable classes and types
- Methods, nested types, and other owned symbols appear inside their declaring type; free symbols use a compact module drawer
- Selected-folder connection summary with named destinations and relation weights
- Selected-folder pathways remain pinned while the pointer explores other folders
- Pathways redraw continuously while panning; off-screen endpoints become dashed edge beacons instead of disappearing
- At most four primary folder routes are drawn at once
- Progressive disclosure for large projects: regions → files → symbols
- One primary route per high-signal region pair, aggregated file routes, and local symbol paths
- Ascendable scope breadcrumb so thousands of symbols never render as one undifferentiated field
- Swift classes, structs, actors, protocols, enums, functions, and methods
- Python classes, functions, and methods
- Deterministic code-quality findings mapped to Rules 3, 4, 6, and 7 of
  `CODE_QUALITY_RULES.md`, with affected files and enclosing types marked in the map
- Exact quality-rule codes, severity, source line, and remediation guidance in the
  signal inspector, plus a safe excerpt of the offending source (credential values
  are redacted)
- Drag symbol cards onto region targets to reassign them
- Create new regions on the active architecture plane
- Persist layouts locally in `.cyber_soul_layouts.json`
- Inspect source location, signature, and resolved relationships
- Filter the current map by region, path, symbol, signature, or kind
- Focused, primary, or hidden pathway-density modes
- Hover a card to reveal only its connected pathways
- Export the active plane as Mermaid source
- Copy or download an AI-ready Markdown breach report containing every canonical
  finding, affected regions/symbols, repair guidance, and verification checklists

The previous Three.js renderer is preserved as the optional, unimported
`CyberSoulThreeMap` class in `static/three-map.js`. The production page does not
load it, so it consumes no CPU or GPU unless explicitly imported and mounted.

The UI is currently served locally in a browser for development. Its renderer and hierarchy are suitable for embedding in a cross-platform desktop shell such as Tauri; the parser remains a local process and no source code is uploaded.

The parser is intentionally lightweight. Its job is fast architectural orientation, not compiler-grade semantic analysis.

## Automated quality rules

Cyber Soul reports only charter rules that can be checked deterministically from
source. It currently detects unusually large files (over 600 non-blank lines),
types (over 300 lines), and callables (over 80 lines); bare or swallowed Python
exceptions; empty Swift `catch` blocks and `try!`; Python mutable defaults;
hard-coded credential-like literals; dynamic Python execution; `shell=True`;
unsafe Python deserialization; and Python syntax errors.

Two heuristic rules are available under **Options → Optional Quality Rules** and
are disabled by default:

- **No silent failure** reports non-empty Python `except` and Swift `catch` blocks
  that neither raise/throw nor call a recognized logging method. Empty handlers
  remain a core breach. Because custom telemetry wrappers cannot always be inferred,
  verify these findings in context.
- **No deep indentation** reports a callable once when lexical nesting reaches
  three or more levels and includes the deepest source line as evidence. It is a
  maintainability signal, not proof that the control flow is incorrect.

Optional-rule choices are stored in the browser and included in each rescan. Use
**Apply & Rescan** after changing them.

Each finding uses a stable `CQx.y` code and names the corresponding numbered
charter rule. Findings inside a method are also attached to its enclosing class,
struct, actor, enum, or protocol. The scanner does not claim to automate the
charter's process judgments, such as whether a change was focused, tests prove the
right contract, or a human review was sufficiently thorough.

Use **BREACH REPORT** after a scan to preview the complete Markdown report. Copy it
directly into an AI coding task or download the `.md` file for later use. The report
lists each underlying finding once even when that finding is propagated to an
enclosing class and method in the map.

Language support is registered through `LanguageRuleset`, which groups a
language's file extensions, symbol parser, and deterministic quality analyzer.
Swift and Python use the same dispatch path; adding another language no longer
requires branching in project discovery or scanning.
