# Task D move table, measured at bfb6075 — draft of the real task-D task book

Basis: `docs/refactor/reviews/evidence/workgraph-split-2026-10-02/TARGET-DAG.md` (§2, §4, §8) and `target-proposal.json`, written for the 10-02 tree (81 files). Regenerated here for the tree at **bfb6075** (`src/core/work-graph/`: **103 files**). All measurements below were taken on throwaway WSL copies of `~/dsh-work/base` (= bfb6075) with the two vendor runtime packages added; nothing in the real repository was changed.

**Every count in this file is "measured at bfb6075".** The real tree has already moved on and will move further before task D (step 6, the simplification with decision 34's deletions, step 7). Do not hand this table, its counts, `moves.json`, `expected.json` or `baseline-full.json` to DSH as they are: regenerate all of them from the then-current HEAD first (section 9).

## 1. What changed since TARGET-DAG (10-02)

- All 81 files of 10-02 still exist at the same paths, so all 17 moves M1–M17 still apply unchanged.
- 22 files are new: the 13 files of `state/` (task A) and 9 other files (table 4).
- The tree grew: at bfb6075 the 17 moves change **358 import specifiers in 150 files** plus **15 path strings in 2 test data files**: 157 files in all = 17 moved files + 138 importer files + 2 data files, listed one by one in `data/expected.json` (TARGET-DAG estimated 271 import lines at 10-02). Import graph: 103 files, 414 edges (10-02: 81 files, 250 edges).

## 2. Moves (pure moves; exported names unchanged; only file location and name change)

Paths are relative to `src/core/work-graph/`. "importers" = files under `src/` and `tests/` that import the file directly (measured at bfb6075).

| # | from | to | lines | importers (src+tests / tests) |
|---|---|---|---:|---|
| M1 | tasks/contracts.ts | model/task-contracts.ts | 112 | 50 / 15 |
| M2 | tasks/claim-contracts.ts | model/claim-contracts.ts | 109 | 27 / 12 |
| M3 | tasks/execution-entry-contracts.ts | model/execution-entry-contracts.ts | 169 | 27 / 11 |
| M4 | tasks/execution-read-contracts.ts | model/execution-read-contracts.ts | 111 | 30 / 6 |
| M5 | tasks/execution-history-contracts.ts | model/execution-history-contracts.ts | 33 | 7 / 2 |
| M6 | tasks/plan-contracts.ts | model/plan-contracts.ts | 244 | 34 / 17 |
| M7 | configuration/contracts.ts | model/configuration-contracts.ts | 40 | 10 / 2 |
| M8 | materials/contracts.ts | model/material-contracts.ts | 37 | 18 / 5 |
| M9 | sessions/contracts.ts | model/session-contracts.ts | 60 | 23 / 5 |
| M10 | communication/contracts.ts | model/communication-contracts.ts | 273 | 30 / 7 |
| M11 | evidence/contracts.ts | model/evidence-contracts.ts | 246 | 18 / 8 |
| M12 | tasks/task-index.ts | model/task-index.ts | 78 | 3 / 1 |
| M13 | tasks/plan-record-codecs.ts | persistence/plan-record-codecs.ts | 938 | 36 / 19 |
| M14 | evidence/evidence-record-codecs.ts | persistence/evidence-record-codecs.ts | 658 | 12 / 5 |
| M15 | persistence/model-request-codecs.ts | tasks/model-request-codecs.ts | 248 | 4 / 2 |
| M16 | evidence/coverage.ts | tasks/evidence-coverage.ts | 200 | 3 / 1 |
| M17 | communication/message-record-codecs.ts | sessions/message-record-codecs.ts | 585 | 11 / 5 |

Specifier kinds that must be rewritten: `import … from`, `export … from`, inline type imports `import('…')` (for example `src/app/attention-observer.ts:438-440`, `src/app/host.ts:946`), dynamic `import()`, and `vi.mock()` paths. Inside the moved files, the relative specifiers to former siblings change too (for example `model/execution-history-contracts.ts` → `../tasks/contracts.js` before M1, `./task-contracts.js` after M1).

**Path strings in test data** (they are not imports, typecheck does not see them; `tests/architecture` fails without them):

| file | entries |
|---|---|
| `tests/architecture/production-reach-allowlist.json` (`"file"` values) | configuration/contracts.ts ×5, evidence/contracts.ts ×1, tasks/claim-contracts.ts ×1, tasks/plan-record-codecs.ts ×1 |
| `tests/architecture/state-writes.test.ts` (full paths) | tasks/claim-contracts.ts, communication/contracts.ts, tasks/plan-contracts.ts ×2 |
| `tests/architecture/state-writes.test.ts` (`ALLOWED_DECODERS`, relative paths) | tasks/plan-record-codecs.ts, communication/message-record-codecs.ts, evidence/evidence-record-codecs.ts |

## 3. Files that stay (placed by TARGET-DAG)

- The other 64 files of the 10-02 tree stay where they are, in the submodule of their directory (TARGET-DAG §2): architecture 8, communication 1 (mailbox-service), configuration 5, evidence 2 (evidence-service, verification-plan), materials 8, persistence 6, queries 4, sessions 6, tasks 22, and the two root files `source-authority-ports.ts`, `source-authority-reader.ts` (single-file submodules).
- `state/` (13 files, task A): TARGET-DAG §2 declares the `state` submodule ("任务 A 新建"); the files stay.

## 4. UNPLACED (new since 10-02; TARGET-DAG does not name them)

These stay where they are in the pure move. Which submodule they belong to is a decision for the user, not made here.

| file | lines |
|---|---:|
| persistence/rework-codecs.ts | 321 |
| sessions/session-health.ts | 136 |
| tasks/entry-plan-reader.ts | 91 |
| tasks/goal-control.ts | 219 |
| tasks/reconcile-intents.ts | 253 |
| tasks/reconcile-reads.ts | 114 |
| tasks/requeue-service.ts | 855 |
| tasks/run-reconcile-contracts.ts | 103 |
| tasks/run-reconcile-service.ts | 608 |

Observation (not a decision): if each of the nine is counted in the submodule of its current directory, none of them causes a violation in the check of section 6.

## 5. Not part of the pure move

- **X1** (TARGET-DAG §4, file split): `decodeRun`, `Decoded<T>` and the `RUN_VALIDATE` selection move from `tasks/run-state-service.ts` to a new `materials/run-snapshot-decoder.ts`. It changes code, so it is a separate step with its own review; it is excluded from the move task.
- **§8 fragment** (`submodules` in `docs/refactor/module-target.json`): cannot be written right after the moves, see section 6.
- **Comments, test titles and docs that name an old path** (unchanged by the move; follow-up list):
  - with the directory: `src/contracts/core/session-message.ts:6`, `src/contracts/core/task-claim.ts:6`, `architecture/catalog-record-codecs.ts:13`, `state/attempt-machine.ts:32`, `state/message-machine.ts:6,43,58`, `state/plan-machine.ts:36,65`, `state/session-availability.ts:32`, `state/verification-machine.ts:67`, `tasks/completion.ts:23-24`, the test title at `tests/state/plan-machine.test.ts:298`, and about 29 mentions in `docs/refactor/IMPLEMENTED-CAPABILITIES.md` and `docs/refactor/modules/core/work-graph.md`;
  - by the bare file name of a renamed file (found with a second scan for `contracts.ts` / `coverage.ts` without a directory): `state/message-machine.ts:61,67,76,85,95,104,112,155` (`contracts.ts:NN` = `communication/contracts.ts`, which becomes `model/communication-contracts.ts`), `state/verification-machine.ts:838` (`coverage.ts:76-121`, in the JSDoc of `finalizeRoundOutcome`), and the test title `tests/state/verification-machine.test.ts:970` (`coverage.ts:96-101`; M16 renames the file to `tasks/evidence-coverage.ts`); in current docs, bare-name mentions in `STATE-MACHINES-SPEC.md` (7), `modules/business/workflow.md` (4), `modules/core/agent-runtime.md` (2) and `modules/core/work-graph.md` (1) — some of these name other `contracts.ts` files, so each needs reading in context.
  - Historical evidence, task books and reports keep their text. When regenerating, scan for the directory paths AND for the basenames of every renamed file.

## 6. Check of the moved tree against the target DAG

Measured on a copy after the 17 moves (oracle of ladder L3): `node scripts/import-graph.mjs --root src/core/work-graph` then `node scripts/import-graph-check.mjs` with TARGET-DAG's submodules, the 17 moves applied, `state/*` → state and the 9 UNPLACED files → the submodule of their directory. Result: `problems=[]`, **3 violations**. Writing the §8 fragment into `module-target.json` makes `npm run check:architecture` report exactly the same three lines:

| edge | kind | submodule edge | cause |
|---|---|---|---|
| `model/evidence-contracts.ts:42 → tasks/plan-write-admission.ts` (`PlanDelegatedWriteDependencies`) | type | model → tasks | new since 10-02 |
| `model/plan-contracts.ts:19 → state/goal-machine.ts` (`GoalDisplayV1`, `GoalResumeContinuationV1`, `GoalRunControlCapabilityV1`) | type | model → state | new since 10-02 (task A) |
| `sessions/session-directory.ts:68 → tasks/run-state-service.ts` (`decodeRun`) | value | sessions → tasks | removed by X1 |

So before the §8 fragment can go in, besides X1 two new type edges need a decision (for example: declare `model → state`, which keeps the graph acyclic because `state/` imports nothing else in WorkGraph; and move or re-home `PlanDelegatedWriteDependencies`). These are not guessed here.

Sizes after the moves (files / lines): model 12 / 1,512; persistence 9 / 4,827; tasks 31 / 17,482; sessions 8 / 4,479; state 13 / 13,850; materials 8 / 2,956; architecture 8 / 2,990; configuration 5 / 3,081; queries 4 / 3,587; evidence 2 / 2,031; communication 1 / 2,263; the two root files 63 and 252.

## 7. Checks for the real task D

1. `npm run typecheck` exit 0 (needs `vendor/coding-agent/node_modules` with zod and openai; without them the unchanged tree already has 100 TS7006 errors).
2. `npm run check:architecture` OK (module level; the submodule rules come later, see section 6).
3. Full test suite: same test ids as before the move, no test that passed before fails. In the WSL copies, 60 tests fail before any change (the check sandbox is unavailable there: 24 in `tests/app`, 27 in `tests/composition`, 8 in `tests/work-graph/A2-verification-chain.test.ts`, 1 in `tests/business`); they must stay the same, not grow.
4. `git diff -M` shows every move as a rename (measured 96–100% similarity; the checker only needs git to pair it, content equality is the real test) and every other change as an import-specifier or path-string change only, each specifier spelled canonically (`path.relative` from the importing file, `./` for the same directory, `.js`).
5. Per file: every file of `expected.json` (moved files, importer files, the two data files) is right; a file left unchanged is named with the specifiers it still lacks.
6. Re-run `scripts/import-graph.mjs` and the check of section 6.

## 8. Ladder evidence

The L3 checker (`~/dsh-work/ladder/L3/check.sh`) checks exactly sections 2 and 7.1–7.5 mechanically, on a throwaway clone; its proof is in `ORACLE.md`. The same checker with `--table b1|b12` judges the batched variant after batch 1 and after batch 2.

## 9. Regenerate before task D (the counts above are pinned to bfb6075)

The tree is already different. Measured on 2026-10-07 at 42604b3 plus the uncommitted step-6 tests: 8 files that did not exist at bfb6075 (`tests/scenarios/*` and `tests/state/invariants.ts`, `invariants.test.ts`) add 16 import lines of moved files (`communication/contracts` ×2, `communication/message-record-codecs`, `evidence/evidence-record-codecs`, `persistence/model-request-codecs`, `tasks/claim-contracts` ×2, `tasks/plan-contracts`, `tasks/plan-record-codecs`, …). Decision 34 also deletes unreachable code and recomputes TARGET-DAG before the split, so the move list itself may change. At task-D time, on the then-current HEAD:

1. Recompute the move list (decision 34) and write it as `moves.json`; regenerate sections 1–6 of this file with the same scripts (`_tools/move-stats.mjs`, `_tools/importers.mjs`, `scripts/import-graph*.mjs`, and the two scans of section 5).
2. Make a new base copy of that HEAD (plus node_modules and the two vendor packages), re-run `_tools/baseline-full.sh` + `_tools/mk-baseline.sh` → `_common/baseline-full.json`, and write the failing-test sentence of the book from it (at bfb6075: exactly 8 failures in `A2-verification-chain` for the visible command, 60 in the full suite).
3. `_tools/mk-move-data.sh L3` → `expected.json` (and `b1`/`b12` if the batched form is used); `node _tools/mk-move-books.mjs` → the task books, with counts written as "about N (measured on this copy)".
4. Re-run the oracle pair (`_tools/oracle-moves-b.sh`) on the new base and only then give the book to DSH.
