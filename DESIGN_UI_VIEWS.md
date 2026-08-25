# Eye of Tzeentch — Core UI Views

**Status:** Design exploration
**Purpose:** Define the near-term product surface for the existing code-analysis system and the new planning/work layer.

## Core navigation

The application should initially have two primary views/tabs:

```text
┌──────────────────────────────────────────────┐
│  CODE ANALYSIS          WORK GRAPH            │
└──────────────────────────────────────────────┘
```

### 1. Code Analysis

This is the existing Cyber Soul / Eye of Tzeentch experience.

It answers:

> **What does the codebase look like right now?**

It should retain the existing capabilities rather than being redesigned around the new planning system:

- Experience / user-journey map;
- Application / implementation map;
- Data / persistence map;
- files, symbols, and relationships;
- source evidence and source coordinates;
- deterministic code-quality findings;
- quality-rule severity and affected regions;
- breach reports and verification guidance.

The current code-analysis implementation already provides these capabilities and should remain the observation layer for the new system.

## 2. Work Graph

The new primary control surface answers:

> **What are we trying to accomplish, what are agents doing, and what should happen next?**

The graph represents hierarchical intent and execution.

Example:

```text
LinguaWeb
│
├── Conversation Practice
│   │
│   └── Build local TTS module
│       WHY: Reduce API cost / potentially offer a free learning tool
│       │
│       └── Implementation approach
│           ├── AVSpeechSynthesizer     ❌ rejected
│           ├── Kokoro                  ❌ rejected
│           └── Supertonic 3            ✅ active
│               │
│               ├── integrate model
│               ├── audio pipeline
│               └── verification
│
└── Vocabulary
    └── Sense model redesign            🔴 needs decision
```

### Node types

A node can represent:

- idea;
- goal;
- project;
- feature;
- investigation;
- implementation task;
- milestone;
- decision;
- verification;
- constraint;
- alternative/pivot path.

The system should not require every node to become a detailed task immediately. A vague idea can exist at the top level and grow as the agent investigates it.

### Node context

The reason for a node belongs to the node as metadata/context. It is not automatically another graph branch.

Minimum useful context should remain lightweight:

```text
Title
Why (optional but encouraged)
Notes (optional)
Status
Priority
```

Decisions can additionally store optional alternatives, consequences, evidence, and links. Agents may propose this enrichment rather than requiring the human to provide it.

### Branches and pivots

Branches represent alternative approaches and historical pivots.

The active path is visually emphasized. Rejected or superseded paths remain in the graph so the project history is preserved.

Rejected branches should be collapsible into compact history nodes to keep the main graph readable:

```text
Build local TTS
│
├── 2 rejected alternatives  [expand]
│
└── Supertonic 3  ✅ active
```

Expanding the history reveals the alternatives and the evidence/reasoning associated with them.

## Work state

The graph should distinguish:

- idea;
- planned;
- ready;
- active;
- waiting;
- blocked;
- needs-decision;
- verification;
- done;
- cancelled;
- superseded.

A `needs-decision` state should be visually prominent and should bubble upward when it blocks significant downstream work.

## Agent activity

The Work Graph should show what agents are doing without requiring the user to open a separate agent-management application.

A node can expose:

- current agent;
- current action;
- progress/events;
- files or code areas being changed;
- verification status;
- observations returned by Eye.

The user should be able to move between strategic overview and detailed evidence without leaving the Work Graph.

## Code-analysis feedback

The two views are connected:

```text
WORK GRAPH
   ↓
agent works
   ↓
CODEBASE changes
   ↓
CODE ANALYSIS rescans
   ↓
findings / evidence / changes
   ↓
WORK GRAPH updated
```

Existing quality findings should eventually become actionable graph signals. For example, a new deterministic quality breach may be attached to the affected work node or proposed as remediation work.

Eye should provide evidence and observations. It should not silently invent product intent.

## Near-term scope

The near-term product is deliberately small:

1. Existing **Code Analysis** view.
2. New **Work Graph** view.
3. Persistent work/intent nodes.
4. Priorities and dependencies.
5. Lightweight decisions.
6. Alternative/pivot branches.
7. One coding agent connected to the graph.
8. Feedback from code analysis into work state.

## Distant future integrations

GitHub Issues/PRs, Linear, Jira, Slack, and similar services may eventually be connected through adapters, but they are **not part of the near-term core product** and should not shape the initial architecture unnecessarily.

The core system should remain useful with only:

```text
Eye of Tzeentch
+ local repository
+ work graph
+ agent
```

External systems can be added later without changing the fundamental model.
