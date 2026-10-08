# Task D move table at H = 58ea2fdc (TASK-D-PLAN §2 step 1: MOVE-TABLE §1–6 regenerated)

Source data: `measure-H/` (measure.sh of the proposal without its what-if step, `tools/measure-H.sh`, on
`git archive 58ea2fdc` in WSL slot s1), and `ref-graph/` (the same graph checks on the kept reference copy
`~/dsh-work/ladder/LTd-ref`). The decisions are those of the proposal as confirmed by decision 40 (HANDOFF item 40).

## 1. What changed since the proposal's commit 4404f4dc

- WorkGraph has 101 files (`measure-H/files-since-10-02.txt`): 100 at 4404f4dc plus
  `materials/run-snapshot-decoder.ts` (X1, 58ea2fdc). Nothing was deleted. 404 file edges (135 type-only), against
  404 (136) at 4404f4dc (x12.md: X1 +1 edge, X2 −1).
- `evidence/contracts.ts` (M11) lost `EvidenceServiceDependencies` and `CheckConfigurationResolver` to
  `evidence/evidence-service.ts` (X2, d91208e3): 241 → 186 lines.
- All 18 source paths of `moves.json` exist at H; no target path exists.

## 2. Moves (pure moves; exported names unchanged)

`moves.json` = the proposal's M1–M18, unchanged (`LTd/data/moves.json`, byte-identical to
`docs/refactor/reviews/evidence/workgraph-split-2026-10-07/moves.json`). Importers / specifiers at H
(`measure-H/move-stats.txt`; same as 4404f4dc for every move):

| # | from → to | importers / specifiers | import('…') |
|---|---|---|---|
| M1 | tasks/contracts.ts → model/task-contracts.ts | 47 / 49 | 0 |
| M2 | tasks/claim-contracts.ts → model/claim-contracts.ts | 33 / 33 | 0 |
| M3 | tasks/execution-entry-contracts.ts → model/execution-entry-contracts.ts | 28 / 30 | 0 |
| M4 | tasks/execution-read-contracts.ts → model/execution-read-contracts.ts | 32 / 35 | 1 |
| M5 | tasks/execution-history-contracts.ts → model/execution-history-contracts.ts | 7 / 7 | 0 |
| M6 | tasks/plan-contracts.ts → model/plan-contracts.ts | 42 / 45 | 1 |
| M7 | configuration/contracts.ts → model/configuration-contracts.ts | 10 / 10 | 0 |
| M8 | materials/contracts.ts → model/material-contracts.ts | 14 / 14 | 0 |
| M9 | sessions/contracts.ts → model/session-contracts.ts | 23 / 25 | 0 |
| M10 | communication/contracts.ts → model/communication-contracts.ts | 34 / 37 | 3 |
| M11 | evidence/contracts.ts → model/evidence-contracts.ts | 19 / 19 | 0 |
| M12 | tasks/task-index.ts → model/task-index.ts | 3 / 3 | 0 |
| M13 | tasks/plan-record-codecs.ts → persistence/plan-record-codecs.ts | 36 / 36 | 0 |
| M14 | evidence/evidence-record-codecs.ts → persistence/evidence-record-codecs.ts | 13 / 13 | 0 |
| M15 | persistence/model-request-codecs.ts → tasks/model-request-codecs.ts | 5 / 5 | 0 |
| M16 | evidence/coverage.ts → tasks/evidence-coverage.ts | 4 / 4 | 0 |
| M17 | communication/message-record-codecs.ts → sessions/message-record-codecs.ts | 13 / 13 | 0 |
| M18 | communication/message-body-envelope.ts → sessions/message-body-envelope.ts | 2 / 2 | 0 |

Same-name files that do not move (book rule c list): `work-graph/queries/contracts.ts`,
`work-graph/architecture/contracts.ts`, `agent-runtime/contracts.ts`, `business/workflow/contracts.ts`,
`agent-runtime/execution-history-contracts.ts` (unchanged since bfb6075). No file at H has a target's new name.

## 3. Files that stay (83)

The proposal's 82 (README §3 "不动的 82 个文件") plus `materials/run-snapshot-decoder.ts` (X1; decision 40 placed it in
`materials/`). Every one is in its directory's submodule; 0 files without a submodule (`ref-graph/submodule-graph-after.txt`).

## 4. UNPLACED files (decision 40)

`communication/message-body-envelope.ts` moves (M18). The other nine stay where they are:
`persistence/rework-codecs.ts`, `sessions/session-health.ts`, `tasks/entry-plan-reader.ts`, `tasks/goal-control.ts`,
`tasks/reconcile-intents.ts`, `tasks/reconcile-reads.ts`, `tasks/requeue-service.ts`, `tasks/run-reconcile-contracts.ts`,
`tasks/run-reconcile-service.ts`. The book names all nine (plus run-snapshot-decoder) as staying.

## 5. Not part of the pure move

- X1, X2: done before H (58ea2fdc, d91208e3).
- The `submodules` fragment in `docs/refactor/module-target.json`: after D's acceptance, its own step (decision 40).
- Comments and test titles that name moved files: 38 lines (`stale-list.md`), a follow-up after D; docs mentions too.

## 6. Check of the moved tree against the target

On the reference copy (`ref-graph/`, identical to the measure copy's result):
- `target.json` (fix B, `model → state` declared): 0 submodule edges and 0 file edges outside the declared
  dependencies; `import-graph-check.mjs` violationCount 0; 0 forbidden directions used; `tasks → architecture`
  declared and unused.
- Submodule-level strongly connected components: 0 (all imports and value-only). File-level: 2, the two accepted
  type-only ones ({model/communication-contracts, model/execution-entry-contracts, model/execution-read-contracts},
  {state/control-intent-machine, state/run-machine}).
- Layer check: the one same-layer edge is `model (L0) → state (L0)`, `model/plan-contracts.ts:19`, declared (fix B).
- `check:architecture` with the fragment written into a throwaway clone's `module-target.json`: target.json exit 0
  ("next source boundaries: OK"); the strict 10-02 declaration exit 1 with exactly
  `core/work-graph/model/plan-contracts.ts:19: forbidden submodule edge WorkGraph/model -> WorkGraph/state`.
- So the violations list that is "input for the lead's later §8 step" is empty under the confirmed declaration.
