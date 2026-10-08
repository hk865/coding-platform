# module-target.json submodule declaration (task D follow-up, decision 40) — notes

Date: 2026-10-07. Branch feat/reliability-and-structure. Not pushed. No real model called.

## Commits
- 002e7b28 build: declare the WorkGraph submodules and their dependency direction in module-target.json (task D follow-up, decision 40)
  - docs/refactor/module-target.json only: WorkGraph gets `submodules` = target.json "submodules" (13 ids, same paths, same 41 edges, same order), plus a WorkGraph-level `note` (direction rule, notes/views not declared, pureDirectories keeps state pure) and a model-level `note` ("model 可以依赖 state（L0 内部的例外，决定 40 修法 B）；state 不依赖 WorkGraph 里的任何东西"). `updated` 2026-10-05 -> 2026-10-07. pureDirectories unchanged.
  - The checker ignores unknown keys (it reads id/path/dependencies on submodules; status/updated/document/note are documentation).
- 3f933f51 docs: module-dag §6 (new), WorkGraph module doc §2 dated note, ARCHITECTURE §5 dated note, proposal README dated header note, STATUS (done row, 剩余 renumbered, pure:true wrap-up item).

## Format decisions
- Not written into the JSON: `level`, `reserved` (notes/views — no files; checker requires declared paths to exist), `forbidden` (implied: dependencies are allowlists). Levels live in module-dag §6 and DESIGN §7.2.
- Spec §14.4 (L-8) said: after task D replace `pureDirectories` with `pure: true` on the state submodule. The checker has no `pure` support (loadSubmodules reads only id/path/dependencies), so writing `pure: true` would be silently ignored. Kept `pureDirectories` (same semantics). Recorded as an open wrap-up item in STATUS; changing it needs check-boundaries.mjs + boundaries.test.ts changes (lead decides).

## Checks (WSL slot s1)
- compare-target.mjs (scratchpad/taskd): declared 13 submodules / 41 edges == proposal 13 / 41, same ids/paths/dependency sets and same order; the only non-downward edge by the proposal's levels is model(L0) -> state(L0).
- `npm run check:architecture` (log s1-mt-1): OK. WorkGraph 101 files: model 12, state 13, persistence 9, configuration 5, materials 5, architecture 8, sessions 9, source-authority-ports 1, queries 4, tasks 31, source-authority-reader 1, evidence 2, communication 1. Observed submodule edges 40 (of 41 allowed; tasks -> architecture unused).
- Planted edges, slot copy only (scratchpad/taskd/plant.sh, logs s1-mt-plant-1/-2; restored with git checkout, nothing committed). Checker exit 1 with:
  - core/work-graph/model/task-contracts.ts:1: forbidden submodule edge WorkGraph/model -> WorkGraph/tasks
  - core/work-graph/persistence/rework-codecs.ts:1: forbidden submodule edge WorkGraph/persistence -> WorkGraph/state
  - core/work-graph/sessions/session-directory.ts:29: forbidden submodule edge WorkGraph/sessions -> WorkGraph/tasks
  - core/work-graph/state/transition.ts:1: pure directory may not import ../tasks/goal-control.js   (state -> tasks; pure rule returns before the submodule rule)
  - core/work-graph/tasks/plan-service.ts:30: forbidden submodule edge WorkGraph/tasks -> WorkGraph/evidence
  - (first attempt planted tasks -> evidence at plan-service.ts:3, inside the file's header comment, so nothing to report — moved to line 30.)
- `npm run typecheck && npx vitest run tests/architecture` (log s1-mt-tc-1): typecheck OK; 3 files, 50 tests passed (boundaries 27, production-reach 4, state-writes 19).
- No test asserts the old declaration shape: boundaries.test.ts fixture() copies the real module-target.json and deletes every module's `submodules` ("The real submodule layout belongs to the real tree"), so nothing needed updating.

## Codex review
- Clone D:/cxt/mt (shared, detached at 3f933f51). Prompt scratchpad/taskd/mt-codex.prompt.txt; output mt-codex.md, events mt-codex-events.jsonl.
- Run ~5 min, exit 0; usage 855,259 input (792,576 cached) / 5,992 output tokens.
- Q1 match (0 differences), Q2 enforced (101 files, 0 unowned, 241 cross-submodule imports, 40 edges, 0 violations; notes ignored), Q3 model -> state the only non-downward edge and documented, Q5 nothing.
- One finding, low: STATUS.md:132 said "换不换由 lead 定" for pure:true, but spec §14.4 (L-8) already adopted it for after task D. Verified: true. Fixed in d8488a80: STATUS + module-dag §6 say adopted-but-not-done (checker first, then switch); spec §14.4 got a dated note; STATUS done row records the review.

## Commits (final)
- 002e7b28 build (module-target.json)
- 3f933f51 docs (module-dag §6, work-graph.md §2 note, ARCHITECTURE note, proposal README note, STATUS)
- d8488a80 docs (Codex follow-up: pure:true wording, spec §14.4 dated note, STATUS row)

## Not done / for the lead
- pure: true for state (spec §14.4 L-8): needs check-boundaries.mjs support + tests; listed under STATUS 剩余 收尾.
- HANDOFF not touched (its task D section still says the declaration is not written; HANDOFF is append-only, lead's wrap-up).
- refs/cc-snapshot/s1-mt-* local refs left for the wrapper's batch cleanup. D:/cxt/mt left in place.
