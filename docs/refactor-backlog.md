# Refactor Backlog

Deferred findings from a `/simplify` review of the Capacity Gantt codebase (four
parallel reviewers: reuse, simplification, efficiency, altitude). The mechanical
cleanups already landed in PR #29; what follows are the items that need a design
decision or a footprint larger than that PR.

Line references were checked against `main` at commit `0f10864`. Re-verify before
editing — they drift.

**Ground rules for whoever picks this up**

- `CONTEXT.md` is the domain contract. It defines Backlog vs Scheduled, Manual vs
  Automatic Allocation, `fastest` vs `balanced`, and Pending Hours. Read it first;
  several items below exist because a rule in that document is implemented in more
  than one place.
- These are quality refactors. Behavior should not change except where an item
  explicitly says a decision is required — those need the repo owner's answer
  before you write code.
- Verify with `npm test`, `npm run lint`, `npx tsc -b`, `npm run build`. CI does not
  run on PRs here (`.github/workflows/deploy.yml` is deploy-only), so local
  verification is the only gate.
- Items are ordered by value. #1 is worth more than the rest combined; #2 and #3
  are self-contained; #4 is large and should probably wait for #1.

---

## 1. Scheduling rules are re-derived at seven call sites

**Highest value. Do this one first.**

`recalculateAutomaticAllocations` (`src/capacity.ts:269`) returns only
`{allocations, start, end}`. It does not say what the Task becomes. So every caller
independently decides the next `start`/`end`/`status`/`allocationStrategy`:

| Site                                                | What it decides                              |
| --------------------------------------------------- | -------------------------------------------- |
| `src/App.tsx:228` `saveTask` (backlog branch)       | clears dates, forces `fastest`               |
| `src/App.tsx:233-236` `saveTask` (scheduled branch) | fabricates `scheduledTask` + `fallbackStart` |
| `src/App.tsx:252-254` `autoScheduleTask`            | forces `fastest`, preserves `completed`      |
| `src/App.tsx:281-283` `scheduleTaskAtDate`          | anchors date, forces `scheduled` + `fastest` |
| `src/App.tsx:293` `moveTaskToBacklog`               | forces `backlog`, nulls dates                |
| `src/App.tsx:355-357` `rescheduleTask`              | forces `balanced`                            |
| `src/capacity.ts:380` `recalculateWorkspace`        | mutates `status` backlog → scheduled         |

The `CONTEXT.md` rule "user-set dates ⇒ `balanced`, drop/auto-schedule ⇒ `fastest`"
therefore lives in seven places.

**The concrete bug this already causes.** `src/CapacityGantt.tsx:245-254` builds the
drag drop-preview by re-implementing `scheduleTaskAtDate`'s transform. Preview and
commit are two copies of one rule, so the preview can show the user a schedule that
differs from what dropping actually produces. Any fix to one copy silently skips the
other.

**Deeper fix.** Have `capacity.ts` own the intent-level operations and return the
next `Task` alongside the allocations:

```ts
export interface ScheduleResult {
  task: Task;
  allocations: Allocation[];
}

export function scheduleTaskAt(task, allocations, capacities, date): ScheduleResult;
export function setTaskDateRange(task, allocations, capacities, start, end): ScheduleResult;
export function returnTaskToBacklog(task): ScheduleResult;
```

`AllocationResult` already carries `start`/`end`, so widening it is small. Then the
six `App.tsx` handlers shrink to "call the operation, commit the result", and
`CapacityGantt`'s preview calls the _same function it is previewing_ — which is what
makes the divergence structurally impossible rather than merely fixed.

**Scope.** `capacity.ts` plus the six call sites in `App.tsx` plus the preview in
`CapacityGantt.tsx`. Contained. Existing tests in `src/data.test.ts` cover the engine
and should keep passing unchanged; `src/App.test.tsx` covers the handlers.

**Watch out.** `saveTask` is the subtle one — it distinguishes "task entered the
Gantt", "dates changed", and "already had allocations", and only recalculates in some
combinations. Preserve that gating; don't collapse it into an unconditional
recalculation, or editing an unrelated field will silently reschedule the task.

---

## 2. One invariant, three different behaviors

`CONTEXT.md` says a Task's date range may not exclude a Manual Allocation Day. That
single rule is currently enforced three incompatible ways:

- `src/capacity.ts:135` `validateTaskDateRange` — **throws**.
- `src/App.tsx:350-353` `rescheduleTask` — **silently clamps** `start`/`end` to the
  manual dates so the throw never happens (this is the bar-drag path).
- `src/App.tsx:222-243` `saveTask` — does **not** clamp; surfaces the thrown message
  to the user (this is the dialog path).
- `src/CapacityGantt.tsx:253` — **catches** the throw and degrades the preview to a
  one-day bar.

So dragging a task bar past a manual allocation silently moves it back, while typing
the same dates into the editor produces an error. Same intent, two outcomes.

**Decision required before coding:** should the range clamp, or should it report an
error? Ask the repo owner. Then implement it once:

- _Clamp_ → export `clampRangeToManualDates(task, allocations)` from `capacity.ts`
  and call it inside `recalculateAutomaticAllocations`, so the engine stops throwing
  for this case. Remove the clamp in `App.tsx` and the `catch` in `CapacityGantt.tsx`.
- _Error_ → drop the clamp in `rescheduleTask` and let the bar drag surface the same
  message the dialog does.

**Scope.** ~10 lines in `capacity.ts`, plus deleting the clamp. Small either way.

---

## 3. Schema versioning is case-by-case

Three unrelated notions of "version" coexist, and none of them dispatches:

- `src/db.ts:6` IDB `VERSION=2`, whose `onupgradeneeded` (`src/db.ts:20-23`) is
  version-agnostic (`if (!contains) create`).
- `src/types.ts:51` the payload literal `version: 2`.
- `src/db.ts:106-109` legacy migration by sniffing for an old object store at read
  time.

`normalizeWorkspace` (`src/db.ts:93-99`) stamps `version: 2` onto whatever it read
_without inspecting the stored version_ — so a future older record gets relabeled
rather than migrated. Meanwhile the v1→v2 field additions are handled not by a
migration step but by permanently loosening the validator: `src/data.ts:71-76`
accepts `undefined` for `deadline` / `allocationStrategy` / `priority`, and
`normalizeWorkspaceData` (`src/data.ts:126`) back-fills them on every save.

**Cost.** Shipping a v3 means editing four unrelated spots (IDB upgrade, the
`version` literal, `normalizeWorkspaceData` defaults, and `validateImport`'s
`!== 2` check at `src/data.ts:98`), and every new optional field loosens the import
validator forever.

**Deeper fix.** One `migrateWorkspace(raw: unknown): WorkspaceData` in `db.ts`,
driven by a `Record<version, (data) => data>` chain, applied to **both** the IDB load
path and `importJson` (`src/App.tsx:~400`). `validTask` then validates the _current_
shape strictly, and `normalizeWorkspaceData` stops doubling as an implicit migrator.

**Scope.** `db.ts` plus the validator half of `data.ts`. Self-contained.

---

## 4. `Task` lets the type system down

`src/types.ts:8-23`: `start` and `end` are independently nullable and unrelated to
`status`. So "backlog ⇒ null dates" is maintained by hand at every producer
(`src/App.tsx:228`, `src/App.tsx:293`, `src/db.ts:~53`) and re-guarded at every
consumer (`src/timeline.ts:232` `taskRangeGeometry`, `src/data.ts:~170`
`applyTaskDrag`, `src/CapacityGantt.tsx` via `width > 0`, `src/formatters.ts:formatRange`).

A discriminated union — `BacklogTask` (no dates) | `ScheduledTask` (non-null dates) —
would let the compiler enforce what is currently convention.

**Scope: large.** Touches `types.ts`, `data.ts`, `db.ts`, `capacity.ts`,
`timeline.ts`, and both components. **Do #1 first** — centralizing the transitions
removes most of the pressure that makes this attractive, and you may find the
remaining benefit no longer justifies the churn. Treat this as direction of travel,
not a scheduled task.

---

## 5. Smaller, independent items

**5a. `recalculateWorkspace` is O(tasks × days × allocations).**
`src/capacity.ts:370-385`. Each task runs a full scheduling pass, and each pass calls
`getRemainingCapacity` per date, which does a linear `capacities.find` plus a linear
allocating `allocations.filter`. The loop also rebuilds the whole allocation array
per task (`src/capacity.ts:377`). This runs synchronously on a capacity edit
(`saveCapacity`, `src/App.tsx:~368`). With 40 tasks / 300 allocations / 270 capacity
rows that is roughly 4M inner iterations on one click. Fix: hoist
`Map<date, DailyCapacity>` and `Map<date, hours>` to the top of
`recalculateAutomaticAllocations`, thread them in from `recalculateWorkspace` so the
capacity index is built once, and accumulate into one result array. The index
builders already exist — `capacityAvailableByDate` and `allocatedHoursByDate` in
`capacity.ts`, added by PR #29.

**5b. `capacity.ts` mutates lifecycle status.**
`src/capacity.ts:380`: `if (task.status === 'backlog') task.status = 'scheduled';`
inside a _capacity_ recalculation. The engine is compensating for the UI's task
partitioning. Removing this is natural once #1 gives status transitions an owner —
do it as part of #1, not standalone, or the pending-tray behavior will shift.

**5c. Write-only fields.** `Task.owner` (`src/types.ts:19`) is set in `emptyTask`
and `migrateTask` and never read, rendered, or edited. `Allocation.locked`
(`src/types.ts:47`) is written (`src/capacity.ts:145`, `src/capacity.ts:337`) and
import-validated (`src/data.ts:121`) but never read to gate anything — `source ===
'manual'` is the real gate. Both are carried through every clone, migration, and
export. **Decision required:** drop them (this changes the export format and needs a
migration per #3) or document them as reserved. Owner's call, not the agent's.

**5d. `ProjectPanel` takes 26 props.** `src/App.tsx:~430` — all threaded manually
through `App` → `ProjectPanel` → `CapacityGantt`. Item #1 removes some by itself.
Revisit _after_ #1; don't reach for context or a store before seeing what's left.

**5e. Vitest runs with CSS disabled.** `vite.config.ts` has no `test.css`, so
`import './styles.css'` is stubbed and never reaches jsdom. Any
`getComputedStyle` assertion is therefore reading inline styles, not the stylesheet
— PR #29 hit exactly this and converted two such assertions to class-hook checks.
Setting `test: { css: true }` would make style assertions meaningful. Low priority,
but decide deliberately rather than leaving the trap for the next person.

---

## Explicitly out of scope

`CONTEXT.md` rules out cross-Task dependencies, global auto-ordering, and multi-Task
rescheduling for this phase. Do not introduce abstractions that only pay off if those
arrive.
