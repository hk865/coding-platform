# Task D follow-up: places that still name the old paths (not edited)

Made in the BringIn stage on the real worktree after the move was staged (index = the task D commit's tree; HEAD before
it = 58ea2fdc). Task D is a pure move, so none of these lines was changed (TASK-D-PLAN §0, §8.6). They are the input
for the follow-up commits. Line numbers are those of the moved tree; the move replaced lines one for one, so no line
number in any file shifted.

The move map (relative to `src/core/work-graph/`):

| id | old path | new path | file name |
|---|---|---|---|
| M1 | tasks/contracts.ts | model/task-contracts.ts | renamed |
| M2 | tasks/claim-contracts.ts | model/claim-contracts.ts | same |
| M3 | tasks/execution-entry-contracts.ts | model/execution-entry-contracts.ts | same |
| M4 | tasks/execution-read-contracts.ts | model/execution-read-contracts.ts | same |
| M5 | tasks/execution-history-contracts.ts | model/execution-history-contracts.ts | same |
| M6 | tasks/plan-contracts.ts | model/plan-contracts.ts | same |
| M7 | configuration/contracts.ts | model/configuration-contracts.ts | renamed |
| M8 | materials/contracts.ts | model/material-contracts.ts | renamed |
| M9 | sessions/contracts.ts | model/session-contracts.ts | renamed |
| M10 | communication/contracts.ts | model/communication-contracts.ts | renamed |
| M11 | evidence/contracts.ts | model/evidence-contracts.ts | renamed |
| M12 | tasks/task-index.ts | model/task-index.ts | same |
| M13 | tasks/plan-record-codecs.ts | persistence/plan-record-codecs.ts | same |
| M14 | evidence/evidence-record-codecs.ts | persistence/evidence-record-codecs.ts | same |
| M15 | persistence/model-request-codecs.ts | tasks/model-request-codecs.ts | same |
| M16 | evidence/coverage.ts | tasks/evidence-coverage.ts | renamed |
| M17 | communication/message-record-codecs.ts | sessions/message-record-codecs.ts | same |
| M18 | communication/message-body-envelope.ts | sessions/message-body-envelope.ts | same |

## 1. Comments and test titles under `src/` and `tests/`: 38 lines

The same 38 lines as the lead's list at H (`prepare/stale-list.md`) and as DSH's UNSPECIFIED in both parts. Rechecked
on the moved tree: all 38 are still there with the same text, and the scan found no other comment or test title (the
11 other hits are the data lines of `tests/architecture/state-writes.test.ts` and
`tests/architecture/production-reach-allowlist.json`, which already name the new paths or name
`architecture/contracts.ts`, which does not move).

### 1a. By old directory path: 14 lines, all wrong now

| file:line | says | should say |
|---|---|---|
| src/contracts/core/session-message.ts:6 | `core/work-graph/communication/contracts.ts` | `core/work-graph/model/communication-contracts.ts` |
| src/contracts/core/task-claim.ts:6 | `tasks/claim-contracts.ts` | `model/claim-contracts.ts` |
| src/core/work-graph/architecture/catalog-record-codecs.ts:13 | `tasks/task-index.ts` | `model/task-index.ts` |
| src/core/work-graph/state/attempt-machine.ts:32 | `tasks/claim-contracts.ts` | `model/claim-contracts.ts` |
| src/core/work-graph/state/message-machine.ts:6 | `communication/contracts.ts:6-11` | `model/communication-contracts.ts:6-11` |
| src/core/work-graph/state/message-machine.ts:43 | `communication/contracts.ts:95` | `model/communication-contracts.ts:95` |
| src/core/work-graph/state/message-machine.ts:58 | `communication/contracts.ts:36-145` | `model/communication-contracts.ts:36-145` |
| src/core/work-graph/state/plan-machine.ts:32 | `tasks/plan-contracts.ts:28-50` | `model/plan-contracts.ts:28-50` |
| src/core/work-graph/state/plan-machine.ts:61 | `tasks/plan-contracts.ts:28-50` | `model/plan-contracts.ts:28-50` |
| src/core/work-graph/state/session-availability.ts:32 | `sessions/contracts.ts:46` | `model/session-contracts.ts:46` |
| src/core/work-graph/state/verification-machine.ts:41 | `evidence/evidence-record-codecs.ts:57-59` | `persistence/evidence-record-codecs.ts:57-59` |
| src/core/work-graph/tasks/completion.ts:23 | `evidence/coverage.ts` | `tasks/evidence-coverage.ts` (same directory now: `./evidence-coverage.ts`) |
| src/core/work-graph/tasks/completion.ts:24 | `evidence/evidence-record-codecs.ts` | `persistence/evidence-record-codecs.ts` |
| tests/state/plan-machine.test.ts:298 (test title) | `tasks/plan-contracts.ts` | `model/plan-contracts.ts` |

### 1b. By file name alone, file renamed: 10 lines, wrong now

| file:line | says | should say |
|---|---|---|
| src/core/work-graph/state/message-machine.ts:61 | `contracts.ts:36-39` | `communication-contracts.ts:36-39` |
| src/core/work-graph/state/message-machine.ts:67 | `contracts.ts:46-52` | `communication-contracts.ts:46-52` |
| src/core/work-graph/state/message-machine.ts:76 | `contracts.ts:67-73` | `communication-contracts.ts:67-73` |
| src/core/work-graph/state/message-machine.ts:85 | `contracts.ts:81-86` | `communication-contracts.ts:81-86` |
| src/core/work-graph/state/message-machine.ts:95 | `contracts.ts:132-138` | `communication-contracts.ts:132-138` |
| src/core/work-graph/state/message-machine.ts:104 | `contracts.ts:139-144` | `communication-contracts.ts:139-144` |
| src/core/work-graph/state/message-machine.ts:112 | `contracts.ts:95-145` | `communication-contracts.ts:95-145` |
| src/core/work-graph/state/message-machine.ts:155 | `contracts.ts:57-59` | `communication-contracts.ts:57-59` |
| src/core/work-graph/state/verification-machine.ts:804 | `coverage.ts:76-121` | `evidence-coverage.ts:76-121` |
| tests/state/verification-machine.test.ts:948 (test title) | `coverage.ts:96-101` | `evidence-coverage.ts:96-101` |

### 1c. By file name alone, file name unchanged: 14 lines, still true by name

These name a file that moved but kept its name, so the text is still correct; only the directory is no longer the one
a reader would guess. Optional: add the directory.

| file:line | says | file is now |
|---|---|---|
| src/core/work-graph/state/attempt-machine.ts:48 | `claim-contracts.ts` | model/claim-contracts.ts |
| src/core/work-graph/state/attempt-machine.ts:58 | `claim-contracts.ts` | model/claim-contracts.ts |
| tests/state/attempt-machine.test.ts:705 (test title) | `claim-contracts.ts` | model/claim-contracts.ts |
| src/core/work-graph/state/verification-machine.ts:82 | `evidence-record-codecs.ts:57` | persistence/evidence-record-codecs.ts |
| src/core/work-graph/state/verification-machine.ts:84 | `evidence-record-codecs.ts:59` | persistence/evidence-record-codecs.ts |
| src/core/work-graph/state/verification-machine.ts:86 | `evidence-record-codecs.ts:44-53` | persistence/evidence-record-codecs.ts |
| src/core/work-graph/state/run-machine.ts:342 | `execution-entry-contracts.ts:30` | model/execution-entry-contracts.ts |
| src/core/work-graph/state/run-machine.ts:353 | `execution-entry-contracts.ts:35-41` | model/execution-entry-contracts.ts |
| src/core/work-graph/state/plan-machine.ts:64 | `plan-contracts.ts:28-29` | model/plan-contracts.ts |
| src/core/work-graph/state/plan-machine.ts:67 | `plan-contracts.ts:30-35` | model/plan-contracts.ts |
| src/core/work-graph/state/plan-machine.ts:70 | `plan-contracts.ts:37-44` | model/plan-contracts.ts |
| src/core/work-graph/state/plan-machine.ts:80 | `plan-contracts.ts:45-47` and `plan-record-codecs.ts:752` | model/plan-contracts.ts, persistence/plan-record-codecs.ts |
| src/core/work-graph/state/plan-machine.ts:87 | `plan-contracts.ts:36-47` | model/plan-contracts.ts |
| src/core/work-graph/state/goal-machine.ts:815 | `plan-contracts.ts:96-98` | model/plan-contracts.ts |

The line references inside these comments (`:46`, `:28-50`, …) were not rechecked against the current files. Task D
does not move them (no line shifted), but some may have drifted before task D.

### 1d. Not counted, optional

- `src/core/work-graph/tasks/plan-validation.ts:1` says "extracted from plan-record-codecs" (the stem, no directory,
  no `.ts`). M13 kept the file name; the sentence is still true.

## 2. Docs that are kept current: 82 lines in 13 files

Found by old directory path only (`<dir>/<file>.ts` or `.js`, the 18 old paths); a doc that names a moved file by its
bare name (`contracts.ts`, `coverage.ts`) is not in this list, because the bare names also match unrelated files. Read
each line in context: some lines describe the state before task D on purpose (for example the D-PLACEMENT lines that
explain why M6 and M11 needed fixes) and should stay as they are. Markdown links in these lines point at files that no
longer exist (e.g. `../../src/core/work-graph/tasks/contracts.ts`).

| file | lines | line numbers |
|---|---|---|
| `docs/refactor/modules/core/work-graph.md` | 23 | 41, 44, 50, 54, 57, 59, 60, 66, 305, 329, 331, 379, 383, 432, 481, 487, 497, 618, 626, 681, 719, 725, 959 |
| `docs/refactor/STATE-MACHINES-SPEC.md` | 22 | 250, 517, 525, 720, 2413, 2494, 2692, 2905, 3253, 3257, 3277, 3285, 4343, 4480, 4594, 4603, 4606, 4615, 4632, 4634, 4635, 4796 |
| `docs/refactor/IMPLEMENTED-CAPABILITIES.md` | 10 | 144, 145, 148, 149, 150, 152, 154, 155, 178, 179 |
| `docs/refactor/modules/business/workflow.md` | 5 | 75, 364, 365, 367, 370 |
| `docs/refactor/modules/core/agent-runtime.md` | 5 | 85, 102, 103, 368, 372 |
| `docs/refactor/design/orchestration-2026-10/STATE.md` | 5 | 57, 58, 77, 131, 154 |
| `docs/refactor/design/orchestration-2026-10/DESIGN.md` | 4 | 91, 117, 498, 1412 |
| `docs/refactor/design/orchestration-2026-10/D-PLACEMENT.md` | 2 | 121, 122 (before-state on purpose) |
| `docs/refactor/ORCHESTRATION-STATE-MACHINES.md` | 2 | 201, 242 |
| `docs/refactor/design/orchestration-2026-10/E3-UI-ITEMS.md` | 1 | 82 |
| `docs/refactor/IMPLEMENTATION-PLAN.md` | 1 | 88 |
| `docs/refactor/PARALLEL-COLLABORATION.md` | 1 | 128 |
| `docs/refactor/STATUS.md` | 1 | 54 |

## 3. Historical or frozen docs: leave as they are

| place | lines | files | why leave |
|---|---|---|---|
| `docs/refactor/reviews/` | 1265 | 148 | evidence of earlier batches (AGENTS.md rule 7: keep the original meaning of historical reports) |
| `docs/refactor/tasks/` | 130 | 60 | dated task books and scope files of finished batches |
| `docs/ui-reference/workbench-2026-10/` | 63 | 15 | the frozen prototype copy (decision 35); its data files are a snapshot |
| `docs/refactor/archive/` | 0 | 0 | — |

No file outside `src/`, `tests/` and `docs/` names an old path (scripts, root files, `vitest.config.ts`,
`package.json` and `docs/refactor/module-target.json` included).

## Commands

Run in the real worktree on the staged (moved) tree:

```
P='(tasks/contracts|tasks/claim-contracts|tasks/execution-entry-contracts|tasks/execution-read-contracts|tasks/execution-history-contracts|tasks/plan-contracts|configuration/contracts|materials/contracts|sessions/contracts|communication/contracts|evidence/contracts|tasks/task-index|tasks/plan-record-codecs|evidence/evidence-record-codecs|persistence/model-request-codecs|evidence/coverage|communication/message-record-codecs|communication/message-body-envelope)\.(ts|js)'
git grep --cached -n -E "(^|[^A-Za-z0-9_.-])$P"                    # whole repository: 1554 lines
git grep --cached -n -E "(^|[^A-Za-z0-9_.-])$P" -- src tests       # 14 lines
N='(^|[^A-Za-z0-9_-])(contracts|claim-contracts|execution-entry-contracts|execution-read-contracts|execution-history-contracts|plan-contracts|task-index|plan-record-codecs|evidence-record-codecs|model-request-codecs|coverage|message-record-codecs|message-body-envelope)\.ts'
git grep --cached -n -E "$N" -- src tests                           # 49 lines = 38 + 11 data lines
```

Raw outputs: `scratchpad/taskd/bringin/grep-paths-all.txt`, `grep-paths-srctests.txt`, `grep-names-srctests.txt`.
