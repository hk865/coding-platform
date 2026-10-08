# Lead's stale-name list at H = 58ea2fdc (TASK-D-PLAN §2 step 8)

Comments and test titles under `src/` and `tests/` that name a moved file (M1–M18) by its old directory path, or by its
file name alone with `.ts` (with or without a line reference). Import/export/`vi.mock` lines and the two data files are
excluded. This is the reference that DSH's UNSPECIFIED is compared against. These lines are not part of task D (they
are the follow-up list, TASK-D-PLAN §8.6).

Method: `tools/stale-scan.sh` in the measure copy of H (raw hits in `measure-H/stale-raw-by-path.txt` and
`measure-H/stale-raw-by-name.txt`), every hit read in context. Names searched: the 13 distinct file names of the 18
moved files (`contracts.ts`, `claim-contracts.ts`, `execution-entry-contracts.ts`, `execution-read-contracts.ts`,
`execution-history-contracts.ts`, `plan-contracts.ts`, `task-index.ts`, `plan-record-codecs.ts`,
`evidence-record-codecs.ts`, `model-request-codecs.ts`, `coverage.ts`, `message-record-codecs.ts`,
`message-body-envelope.ts`). Every raw hit names a moved file; none names a same-name file that stays.

**38 lines = 14 by path + 24 by file name alone (21 with a line reference, 3 without).** Same totals as at bfb6075
(38 = 14 + 24, 3 without a line reference); the line numbers in `state/` moved.

## By old directory path (14)

| file:line | names | move |
|---|---|---|
| src/contracts/core/task-claim.ts:6 | `tasks/claim-contracts.ts` | M2 |
| src/contracts/core/session-message.ts:6 | `core/work-graph/communication/contracts.ts` | M10 |
| src/core/work-graph/state/attempt-machine.ts:32 | `tasks/claim-contracts.ts` | M2 |
| src/core/work-graph/state/message-machine.ts:6 | `communication/contracts.ts:6-11` | M10 |
| src/core/work-graph/state/message-machine.ts:43 | `communication/contracts.ts:95` | M10 |
| src/core/work-graph/state/message-machine.ts:58 | `communication/contracts.ts:36-145` | M10 |
| src/core/work-graph/state/verification-machine.ts:41 | `evidence/evidence-record-codecs.ts:57-59` | M14 |
| src/core/work-graph/state/plan-machine.ts:32 | `tasks/plan-contracts.ts:28-50` | M6 |
| src/core/work-graph/state/plan-machine.ts:61 | `tasks/plan-contracts.ts:28-50` | M6 |
| src/core/work-graph/state/session-availability.ts:32 | `sessions/contracts.ts:46` | M9 |
| src/core/work-graph/architecture/catalog-record-codecs.ts:13 | `tasks/task-index.ts` | M12 |
| src/core/work-graph/tasks/completion.ts:23 | `evidence/coverage.ts` | M16 |
| src/core/work-graph/tasks/completion.ts:24 | `evidence/evidence-record-codecs.ts` | M14 |
| tests/state/plan-machine.test.ts:298 (test title) | `tasks/plan-contracts.ts` | M6 |

## By file name alone (24)

| file:line | names | line reference | move |
|---|---|---|---|
| src/core/work-graph/state/attempt-machine.ts:48 | `claim-contracts.ts` | no | M2 |
| src/core/work-graph/state/attempt-machine.ts:58 | `claim-contracts.ts` | no | M2 |
| tests/state/attempt-machine.test.ts:705 (test title) | `claim-contracts.ts` | no | M2 |
| src/core/work-graph/state/message-machine.ts:61 | `contracts.ts:36-39` | yes | M10 (communication/contracts.ts, named at :6, :43, :58) |
| src/core/work-graph/state/message-machine.ts:67 | `contracts.ts:46-52` | yes | M10 |
| src/core/work-graph/state/message-machine.ts:76 | `contracts.ts:67-73` | yes | M10 |
| src/core/work-graph/state/message-machine.ts:85 | `contracts.ts:81-86` | yes | M10 |
| src/core/work-graph/state/message-machine.ts:95 | `contracts.ts:132-138` | yes | M10 |
| src/core/work-graph/state/message-machine.ts:104 | `contracts.ts:139-144` | yes | M10 |
| src/core/work-graph/state/message-machine.ts:112 | `contracts.ts:95-145` | yes | M10 |
| src/core/work-graph/state/message-machine.ts:155 | `contracts.ts:57-59` | yes | M10 |
| src/core/work-graph/state/verification-machine.ts:82 | `evidence-record-codecs.ts:57` | yes | M14 |
| src/core/work-graph/state/verification-machine.ts:84 | `evidence-record-codecs.ts:59` | yes | M14 |
| src/core/work-graph/state/verification-machine.ts:86 | `evidence-record-codecs.ts:44-53` | yes | M14 |
| src/core/work-graph/state/verification-machine.ts:804 | `coverage.ts:76-121` | yes | M16 |
| tests/state/verification-machine.test.ts:948 (test title) | `coverage.ts:96-101` | yes | M16 |
| src/core/work-graph/state/run-machine.ts:342 | `execution-entry-contracts.ts:30` | yes | M3 |
| src/core/work-graph/state/run-machine.ts:353 | `execution-entry-contracts.ts:35-41` | yes | M3 |
| src/core/work-graph/state/plan-machine.ts:64 | `plan-contracts.ts:28-29` | yes | M6 |
| src/core/work-graph/state/plan-machine.ts:67 | `plan-contracts.ts:30-35` | yes | M6 |
| src/core/work-graph/state/plan-machine.ts:70 | `plan-contracts.ts:37-44` | yes | M6 |
| src/core/work-graph/state/plan-machine.ts:80 | `plan-contracts.ts:45-47` and `plan-record-codecs.ts:752` | yes | M6, M13 |
| src/core/work-graph/state/plan-machine.ts:87 | `plan-contracts.ts:36-47` | yes | M6 |
| src/core/work-graph/state/goal-machine.ts:815 | `plan-contracts.ts:96-98` | yes | M6 |

## Not counted

- `src/core/work-graph/tasks/plan-validation.ts:1` says "extracted from plan-record-codecs" (the stem without `.ts`,
  no directory; M13 keeps its file name). Found with a separate `git grep` of the 11 non-generic stems without an
  extension. Outside the book's wording ("file name with `.ts`"); if DSH lists it, that is not wrong.
- Docs (`IMPLEMENTED-CAPABILITIES.md`, `modules/core/work-graph.md`, the spec and others): the follow-up doc step
  (TASK-D-PLAN §8.6), not this list.

## Compared with bfb6075 (L3/RESULTS.md, MOVE-TABLE.md §5)

The same 38 places (the same scan with `git grep … bfb6075` and the 17 moves of L3 gives 14 + 24, plan-machine.ts:84
counted once). Line numbers that moved since bfb6075: `state/plan-machine.ts` 36, 65 → 32, 61 and 68, 71, 74, 84, 91 →
64, 67, 70, 80, 87; `state/verification-machine.ts` 67 → 41, 105/107/109 → 82/84/86, 838 → 804;
`state/run-machine.ts` 359, 370 → 342, 353; `state/goal-machine.ts` 820 → 815;
`tests/state/verification-machine.test.ts` 970 → 948. Unchanged: the 8 lines of `state/message-machine.ts`, the 3
`claim-contracts.ts` lines, `session-availability.ts:32`, `catalog-record-codecs.ts:13`, `completion.ts:23-24`, the
two `src/contracts/core` lines and `tests/state/plan-machine.test.ts:298`. M18 (`message-body-envelope.ts`, new since
bfb6075) is named by no comment. No new place was added by steps 5–7, the simplification, X1 or X2.
