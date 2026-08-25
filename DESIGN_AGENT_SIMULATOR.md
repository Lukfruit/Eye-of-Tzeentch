# Eye of Tzeentch — Agent Planning / Optimization Simulator

**Status:** Design exploration  
**Purpose:** Define a direction for evolving Cyber Soul from a codebase cartography tool into a command center for directing autonomous coding work.

## 1. Vision

Eye of Tzeentch should make software development feel more like managing a living simulation than issuing isolated coding prompts.

The human defines goals, projects, directions, constraints, priorities, and decisions. Agents decompose those intentions into work, execute available work, observe the resulting codebase, discover dependencies and problems, and continuously update the work state.

The human should primarily steer the system at the strategic level. The system should handle decomposition, routing, execution, observation, verification, and routine bookkeeping.

The experience should feel closer to **Cities: Skylines / RimWorld** than a traditional IDE task list:

- a living world is visible;
- goals grow into plans, plans grow into tasks;
- multiple agents can operate on different work;
- dependencies constrain what can happen next;
- discoveries change the plan;
- blocked decisions become visible;
- completed work creates new opportunities;
- the human intervenes where judgment is actually required.

This is a design direction, not a commitment to a literal game interface.

## 2. Relationship to the existing Cyber Soul

Cyber Soul already provides a useful **world model** for the codebase. It scans source, builds Experience/Application/Data views, exposes symbols and relationships, retains source evidence for important paths, and surfaces deterministic quality findings. The parser is intentionally lightweight and designed for fast architectural orientation rather than compiler-grade semantic analysis.

The proposed system should build on that foundation rather than replace it.

### Existing layer: Observation

Cyber Soul / Eye of Tzeentch answers:

> **What exists? What changed? What is connected? What looks unhealthy?**

### New layer: Intent and orchestration

The planning system answers:

> **What are we trying to accomplish? What can happen next? What is blocked? Which agent should work on it? What decision needs a human?**

The two layers should remain distinct but connected.

```text
                 HUMAN INTENT
                      │
                      ▼
             PLAN / TASK GRAPH
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
      AVAILABLE WORK        DECISIONS NEEDED
          │                       │
          ▼                       ▼
        AGENTS             BUBBLE TO TOP
          │
          ▼
       CODEBASE
          │
          ▼
    EYE OF TZEENTCH
          │
          ├── architecture
          ├── journeys
          ├── dependencies
          ├── quality signals
          └── evidence / changes
          │
          ▼
      PLAN UPDATED
```

## 3. Intent should be hierarchical

The primary human work surface should be an expandable tree/graph of intent.

Example:

```text
LinguaWeb
├── Conversation Practice
│   ├── Native TTS
│   │   ├── AVSpeech implementation       DONE
│   │   ├── interruption handling         ACTIVE
│   │   └── pronunciation feedback        PLANNED
│   └── Tutor architecture
│       ├── session state                 DONE
│       └── adaptive turn handling        PLANNED
├── Vocabulary
│   ├── Sense model redesign              BLOCKED: DECISION
│   └── SRS improvements                  PLANNED
└── Explore
    ├── speech-to-speech                   IDEA
    └── new exercise engine                IDEA
```

Depth should be unlimited in principle. The useful unit is not necessarily a conventional task. A node can represent:

- an idea;
- a direction to explore;
- a project;
- a feature;
- a milestone;
- an investigation;
- an implementation task;
- a decision;
- a verification task;
- a constraint.

The system should not force every idea into an artificially detailed task list before an agent starts exploring it.

## 4. Todo growth

The human should be able to enter a high-level intention such as:

> "Explore better pronunciation feedback."

The agent can expand that into a temporary sub-plan:

```text
Explore pronunciation feedback
├── inspect current speech pipeline
├── identify available pronunciation signals
├── compare possible scoring approaches
├── prototype option A
└── identify product decisions
```

The expansion should be reversible and editable.

A parent node should remain useful even when its children evolve. The system should preserve the distinction between:

- **human intent** — the reason the work exists;
- **agent plan** — the current proposed route;
- **execution state** — what agents are actually doing.

This allows agents to re-plan without silently rewriting the user's strategic intent.

## 5. Priority and scheduling

Work should have explicit priority, but priority alone should not determine execution order.

The scheduler should consider at least:

- human priority;
- dependency readiness;
- blocked state;
- decision requirements;
- expected value / impact;
- estimated effort;
- urgency;
- agent capability;
- confidence;
- risk of proceeding without clarification.

The exact scoring model should remain configurable rather than hard-coded into the first implementation.

## 6. Decisions are first-class state

A decision is not merely a note in documentation. It is a state in the plan.

Example:

```text
Sense model redesign
STATUS: BLOCKED
REASON: HUMAN DECISION

Question:
Should VocabularyItem reference Sense directly?

Options:
A. direct reference
B. value-owned snapshot
C. normalized join model

Waiting for: human
```

When an agent reaches such a node:

1. it records the evidence and options;
2. the decision becomes highly visible;
3. the agent stops spending capacity on work dependent on that decision;
4. it selects another ready task where possible.

The goal is that the system can continue making progress while waiting for the human.

## 7. Decision bubbling

Decision urgency should be derived from downstream impact.

A decision affecting twenty future tasks should bubble above a decision affecting one isolated task.

Possible priority signals:

```text
Decision priority ≈
  downstream blocked work
+ strategic importance
+ risk
+ agent waiting cost
```

The UI should make the reason visible rather than presenting an unexplained ranking.

## 8. Work states

A minimal state model should include:

- `idea`
- `planned`
- `ready`
- `active`
- `waiting`
- `blocked`
- `needs-decision`
- `verification`
- `done`
- `cancelled`
- `superseded`

The system should distinguish **waiting for a dependency** from **waiting for a human decision**.

## 9. Agent roles

An agent should not be thought of as a single permanent worker.

The system should eventually support capabilities such as:

- investigator — understands an area and produces findings;
- planner — expands a goal into executable work;
- implementer — changes code;
- verifier — tests and validates;
- reviewer — challenges the result;
- researcher — evaluates alternatives or external information.

Multiple agents can operate on different ready nodes in parallel when dependencies permit.

The first implementation can use one coding agent while retaining the abstraction of agent roles.

## 10. Observation → planning feedback

Eye of Tzeentch should feed observations back into the planning graph.

Examples:

### Code change

```text
Agent changes TTS code
        ↓
Eye rescans
        ↓
new dependency detected
        ↓
plan node gains dependency
```

### Quality problem

```text
Eye detects architectural / quality issue
        ↓
issue attached to affected work
        ↓
agent can create remediation work
```

### Contradiction

```text
Agent expects architecture A
        ↓
code shows architecture B
        ↓
mark observation / uncertainty
        ↓
possibly create decision
```

The observation layer should provide evidence. It should not silently decide product intent.

## 11. Knowledge and decision history

The planning system should connect to, but not replace, durable project knowledge.

There are three useful categories:

### Derived reality

Automatically produced from the codebase:

- architecture;
- dependencies;
- symbols;
- source locations;
- tests;
- quality findings;
- change history.

Owner: **Eye of Tzeentch / tooling**.

### Durable intent

Human-owned knowledge:

- product goals;
- domain definitions;
- important user flows;
- principles;
- accepted decisions.

Owner: **human**, with agents proposing changes.

### Working memory

Short-lived agent material:

- investigations;
- hypotheses;
- observations;
- partial plans;
- discarded approaches.

Owner: **agent**, and disposable unless promoted.

Promotion paths should be explicit:

```text
working observation
    ├── discard
    ├── issue
    ├── decision candidate
    ├── durable knowledge update
    └── new work item
```

## 12. Human maintenance principle

The system should optimize for **minimal human bookkeeping**.

The human should primarily maintain:

- desired direction;
- priorities;
- important constraints;
- decisions.

The system should automatically maintain:

- task execution state;
- agent status;
- dependencies discovered from work;
- evidence;
- generated architecture;
- test results;
- quality findings;
- stale / superseded execution state.

Agents may propose changes to human-owned knowledge, but should not silently rewrite it when the change alters meaning or strategy.

## 13. Human control model

The human should operate at multiple zoom levels:

```text
ZOOM 1 — WORLD
What are the major things I am trying to accomplish?

ZOOM 2 — PROJECT
How are those goals decomposed?

ZOOM 3 — WORK
What are agents doing right now?

ZOOM 4 — DECISION
What requires my judgment?

ZOOM 5 — EVIDENCE
Why is the system recommending this next step?
```

The interface should make it possible to stay at a high level without losing the ability to drill down.

## 14. Agent autonomy should be bounded by readiness

Agents should automatically continue when:

- a task is sufficiently specified;
- dependencies are satisfied;
- required decisions are already resolved;
- the agent has the required capability;
- verification criteria are known.

Agents should stop and surface a decision when continuing would require inventing product intent or violating an explicit constraint.

This creates a practical loop:

```text
SELECT READY WORK
      ↓
PLAN
      ↓
EXECUTE
      ↓
OBSERVE
      ↓
VERIFY
      ↓
UPDATE WORLD MODEL
      ↓
UNBLOCK / CREATE / REORDER WORK
      ↓
SELECT NEXT READY WORK
```

## 15. External work and communication systems

The planning graph should integrate with existing systems rather than trying to replace them.

The external system is treated as an **adapter / evidence source / execution sink**, while the Eye planning graph remains the coordination model.

### Work-system integrations

Systems such as:

- GitHub Issues / Pull Requests;
- Linear;
- Jira;
- other issue and project trackers.

These can provide existing work, status, comments, assignees, deadlines, and links. The system can also publish work outward: create or update issues, attach PRs, synchronize status, and link external work back to the internal plan node.

An external task should have a stable relationship to its internal node rather than becoming a second competing copy of the plan.

Example:

```text
Tzeentch node
   │
   ├── Linear issue
   ├── GitHub PR
   └── GitHub commit(s)
```

If external state conflicts with observed reality, show the conflict instead of silently overwriting either side.

### Communication integrations

Systems such as Slack can act primarily as **communication and evidence sources**.

Useful capabilities include:

- ingest relevant threads or messages into an investigation;
- associate conversations with plan nodes, decisions, issues, or PRs;
- surface important discussions that may affect current work;
- post agent progress or decision requests back into a chosen channel;
- notify humans when a decision blocks meaningful downstream work.

Slack should not automatically become durable product truth. A conversation becomes durable knowledge only through explicit promotion or confirmation.

### Integration design principle

All integrations should use a common adapter model:

```text
External service
      ↓
 adapter
      ↓
 normalized event / entity
      ↓
 Tzeentch graph
      ↓
 agent / human action
      ↓
 adapter
      ↓
 external service
```

This keeps Jira, Linear, GitHub, Slack, and future services interchangeable at the planning layer.

## 16. Optimization objective

The system should eventually be capable of answering:

> **Given the current goals, decisions, dependencies, agent capabilities, risk, and codebase state, what is the most valuable safe work to perform next?**

This is the core optimization problem.

The system should expose its reasoning as signals, not pretend the score is objectively correct.

Useful dimensions include:

- value toward current goals;
- amount of downstream work unlocked;
- confidence;
- risk reduction;
- estimated effort;
- dependency centrality;
- decision leverage;
- verification cost.

## 17. What this is not

This is not intended to become:

- a replacement IDE;
- a static architecture diagrammer;
- a giant documentation wiki;
- an autonomous agent that changes strategic direction without the human;
- a conventional project-management tool with an AI chat bolted on.

The distinctive goal is **strategic steering of autonomous software work through a living model of goals, work, decisions, agents, and codebase state**.

## 18. Suggested evolution path

### Stage 1 — Work graph

Add a persistent hierarchical work graph with priorities, dependencies, statuses, and human decisions.

### Stage 2 — Agent integration

Allow a coding agent to claim a ready node, report progress, create sub-work, and return verification results.

### Stage 3 — Decision handling

Add first-class decision nodes and automatic bubbling based on downstream blocked work.

### Stage 4 — Eye feedback

Feed architecture changes, quality findings, and source evidence into the work graph.

### Stage 5 — External integrations

Connect GitHub, Linear, Jira, Slack, and similar systems through adapters. Start read-only where possible, then add controlled write-back once synchronization semantics are clear.

### Stage 6 — Multi-agent orchestration

Allow multiple specialized agents to work on independent ready nodes.

### Stage 7 — Optimization

Add recommendation/ranking of next work based on measurable signals and expose why the system made each recommendation.

## 19. Design constraints for the first implementation

Keep the first implementation deliberately small.

Do not begin with a distributed orchestration platform, complex knowledge graph, or sophisticated autonomous scheduler.

The minimum useful experiment is:

```text
persistent goal tree
+ priorities
+ dependencies
+ decision nodes
+ one coding agent
+ agent progress/events
+ Eye-generated observations
+ next-work recommendation
```

External integrations should initially be optional adapters and should not be required for the core loop.

If that loop is useful, the rest can grow from observed needs.
