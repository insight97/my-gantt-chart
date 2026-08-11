# Refactor Backlog

This backlog records follow-up work after the Allocation Timeline simplification.
The scheduling model in ADR-0001 is superseded; use [`CONTEXT.md`](../CONTEXT.md)
and [ADR-0002](./adr/0002-allocation-timeline-explicit-scheduling.md) as the current
domain contract.

## Deferred

### 1. Strengthen Task lifecycle types

`Task.start` and `Task.end` remain independently nullable, so consumers still need
to handle incomplete metadata ranges. A discriminated `BacklogTask` /
`ScheduledTask` model could make lifecycle transitions more explicit, but it would
touch persistence, timeline geometry, the editor, and drag interactions. Keep this
deferred until the current product model has settled.

### 2. Reduce ProjectPanel prop plumbing

`App` → `ProjectPanel` → `CapacityGantt` still passes many interaction callbacks.
Revisit only if another focused change makes a clear seam available; do not add a
global store solely to reduce the prop count.

### 3. Enable CSS-aware component tests

Vitest currently validates class hooks and inline geometry rather than computed
stylesheet values. Enabling CSS in the test environment would make visual assertions
more realistic, but requires reviewing existing tests and runtime cost.

## Completed by the current model

- Automatic Scheduling is centralized around the fastest-only scheduling operation.
- Task／Allocation workspace transitions are centralized in `src/workspace-operations.ts`;
  `App.tsx` remains the composition root for UI state, history, notices, and persistence.
- Allocation rebuilds discard the Task's old Allocation records; there is no automatic/
  manual source or locked field.
- Metadata, capacity, estimate edits, and timeline navigation do not implicitly
  reschedule a Task.
- Backlog is the only unscheduled area; Timeline-created Tasks are automatically
  scheduled on save, and Scheduled Tasks do not use a separate pending tray.
- Task bar date manipulation and General Mode were removed; Task-card movement and
  direct daily Allocation adjustment remain.
- Former Task bar geometry names now describe the temporary `DropPreview` only.
- Timeline navigation lifecycle is centralized in `src/timeline-navigation.ts`;
  `CapacityGantt.tsx` remains the DOM adapter while the module owns zoom anchors,
  layout continuity, pan activation, external scroll synchronization, and pointer-date mapping.
