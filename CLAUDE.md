# CLAUDE.md

Guidance for coding agents working in this repository.

## Formatting: do not infer it from surrounding code

**This project uses Prettier. The configuration in `.prettierrc` is the authority on
formatting — not the code you happen to be reading.**

This note exists for a specific reason. Earlier in this project's history, agents
produced extremely dense code: single-space indentation, no spaces around operators,
many statements per line, JSX elements running past 1000 characters. That was never a
deliberate style choice by the repo owner — it was an artifact of how the code was
generated.

It then became self-perpetuating. Matching the surrounding style is normally correct
behavior, and it is what every agent did, so each pass made the density a little more
entrenched. Nothing in the repo declared a convention, so there was nothing to match
_except_ the artifact.

So: if you open a file and it looks unusually compact, **do not match it**. Run
Prettier. If you are adding new code, write it normally and let Prettier settle the
details.

```
npm run format        # rewrite
npm run format:check  # verify (also runs as part of npm run lint)
```

The bulk reformat is recorded in `.git-blame-ignore-revs`, so `git blame` skips it.

## Verification

There is **no CI on pull requests** — `.github/workflows/deploy.yml` is deploy-only.
Local verification is the only gate. Before proposing a change, run all four:

```
npm test          # vitest
npm run lint      # eslint + prettier --check
npx tsc -b        # typecheck
npm run build     # tsc -b && vite build
```

## Domain

`CONTEXT.md` is the domain contract — it defines Project, Task, Allocation, Daily
Capacity, the Allocation Timeline, explicit `fastest` Automatic Scheduling, and
Pending Hours. Read it before changing scheduling behavior. Several past defects
came from the same rule being implemented in more than one place.

`docs/adr/` holds architecture decision records. `docs/refactor-backlog.md` lists
known refactors worth doing, with current line references and the ones that need the
owner's decision rather than an agent's judgement.

## Architecture

- `src/types.ts` — shared data model. No local re-declarations of these types.
- `src/capacity.ts` — the scheduling and capacity engine. Owns allocation math,
  date arithmetic (`addDays`, `datesBetween`, `today`), and the date-keyed index
  builders that render paths use. Domain logic belongs here, not in components.
- `src/timeline.ts` — timeline geometry, zoom, and period bucketing.
- `src/formatters.ts` — all display strings and label tables.
- `src/data.ts` / `src/db.ts` — workspace shape, validation, persistence, migration.
- `src/App.tsx` / `src/CapacityGantt.tsx` — presentation and interaction.

Before writing a helper, check whether one of the modules above already exports it;
duplicated helpers have been a recurring problem here.

Task dragging is pointer-based (`src/task-drag.ts`). An HTML5 `dataTransfer`
implementation was removed because it could never fire — every draggable surface is
`draggable={false}`. Do not reintroduce native drag-and-drop.
