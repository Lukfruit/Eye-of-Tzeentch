# Work Graph Architecture

## Purpose

Keep the Work Graph predictable as it grows. The graph is a persistent project model with a browser UI layered on top.

## Core boundary

```text
workgraph.json / API
        ↓
workGraphState
        ↓
WorkGraphModel (pure derived logic)
        ↓
renderWorkGraph()
        ↓
DOM
```

User interaction flows in the opposite direction through explicit event handlers:

```text
DOM event
   ↓
state mutation
   ↓
save to disk
   ↓
explicit render
```

There should not be a second state store hidden in the DOM.

## Rules

### 1. State is authoritative

`workGraphState.nodes` is the in-memory representation of the project graph. `workgraph.json` is the persistent representation. Rendered text, classes, `data-*` attributes, and DOM structure are derived state only.

### 2. Keep model logic DOM-free

Hierarchy traversal, graph IDs, status roll-up, validation, cycle protection, and similar rules belong in `static/workgraph-model.js`.

These functions should be pure with respect to the supplied node list.

### 3. Render in one direction

`renderWorkGraph()` replaces the graph view from state. UI code should not try to infer application state by reading rendered labels back out of the DOM.

### 4. Prefer explicit events over DOM observers

Do not add a `MutationObserver` to a subtree that Work Graph code also mutates. A renderer that replaces or edits the observed subtree can create:

```text
mutation → observer → mutation → observer → …
```

Use explicit event handlers or explicit render calls instead. A DOM observer would require a separate external source of change and a proven guard against self-generated mutations.

### 5. Centralize mutations

Node edits should pass through `updateNode()` or another single mutation boundary so persistence, validation, and rendering behavior remain predictable.

### 6. Derived status is not stored twice

A node stores its source/manual status. Parent effective status is calculated from its subtree. This avoids stale duplicated state.

Current precedence:

```text
NEEDS DECISION
BLOCKED
ACTIVE / VERIFICATION
READY / WAITING
PLANNED
IDEA
```

`DONE` is derived when all children are done. Terminal historical states such as `CANCELLED` and `SUPERSEDED` should not create active work pressure in ancestors.

### 7. Traversal must fail closed

Every recursive hierarchy helper should have cycle protection. A malformed graph must produce a warning/error state rather than an infinite recursion or browser lock-up.

### 8. Persistence is debounced

Rapid field edits should not issue one disk write per keystroke. Schedule a short debounced save after state mutation.

## Tests

`tests/test_workgraph_model.js` covers:

- status propagation
- active-over-planned behavior
- completion roll-up
- hierarchical graph IDs
- cycle detection
- duplicate IDs and missing parents

Run with:

```bash
node tests/test_workgraph_model.js
```
