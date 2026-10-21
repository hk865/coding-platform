# B1 report — bounded event-codec factory (book §5.6, design 2)

Base `s85-base` = `e94d7b9` (s85 base = lead 20f64821). Working tree only; no
commit. No test, no allowlist and no file outside the three permitted paths was
edited.

## Files changed

| File | Added | Deleted | Note |
|---|---:|---:|---|
| `src/core/work-graph/persistence/event-codec-factory.ts` | 78 (wc -l) | 0 | new module |
| `src/core/work-graph/persistence/decision-record-codecs.ts` | 33 | 44 | net −11 |
| `src/core/work-graph/persistence/line-settings-codecs.ts` | 19 | 25 | net −6 |

`git diff --numstat` for the modified files:
`33  44  src/core/work-graph/persistence/decision-record-codecs.ts`
`19  25  src/core/work-graph/persistence/line-settings-codecs.ts`

The factory has the binding `EventFormat` type and `createEventCodec<T>(format)`
shape. It runs the four old stages in the old order with the same arguments and
early returns, forwards `encode` to `encodeEventEnvelope(event)` and returns the
original outer `event` from `registration.validate`. The three body checkers stay
in their files as hooks; all old named exports, signatures and return types are
kept, including the notice `DecisionChangeProofV1 | null` proof type and
`decodeNoticeOrigin`.

## Static byte proof

Root: `/tmp/s85-scratch/S2/probes/b1/`.

| Artifact | One-line summary |
|---|---|
| `side-by-side.md` | For each event: old decode vs new factory path, the same four calls/arguments, the four early returns, the three JSON labels, and unchanged body checkers. |
| `encode-validate.md` | `encode` forwards to untouched `encodeEventEnvelope`; `validate` returns the same `event` object (`value: event`, no clone); registration entries keep the same values and Goal → notice order. |
| `report.md` | This report. |

Scratch note: `$S85_SCRATCH` is unset in this session; `/tmp/s85-scratch/S2` was
in fact writable, so the artifacts are under the required path
`/tmp/s85-scratch/S2/probes/b1/`. Batch split lists are at
`/tmp/s85-scratch/S2/probes/b1-importers.txt`, `b1-remaining.txt` and
`b1-batch-00` … `b1-batch-09`.

## Tests run

Command form: `timeout 900 npx vitest run --maxWorkers=2 <files>` (≤10 files per
command, no worker count above 2). No scale test was run.

Batch 1 (the eight named start files): 8 files, 143 passed / 0 failed.
Then all 100 non-scale suites importing the two codec modules or their six test
helpers (`S5-queue-support`, `WP2-notices-fixture`, `S5-decision-fixture`,
`S5R2-c-support`, `S2C-L-line-support`, `S2C-P-pins-fixture`), in 10 batches of
10: 100 files, 993 passed / 7 failed.

| Batch | Files | Passed | Failed |
|---|---:|---:|---:|
| named start files | 8 | 143 | 0 |
| b1-batch-00 | 10 | 69 | 0 |
| b1-batch-01 | 10 | 107 | 0 |
| b1-batch-02 | 10 | 70 | 1 |
| b1-batch-03 | 10 | 97 | 0 |
| b1-batch-04 | 10 | 101 | 0 |
| b1-batch-05 | 10 | 68 | 0 |
| b1-batch-06 | 10 | 34 | 0 |
| b1-batch-07 | 10 | 158 | 0 |
| b1-batch-08 | 10 | 123 | 6 |
| b1-batch-09 | 10 | 166 | 0 |
| **total** | **108** | **1136** | **7** |

All 7 failures are the permitted environment failure, not codec regressions;
their text is `ENOENT: no such file or directory, access '/usr/bin/bwrap'`:

- `tests/runtime/S5-user-message-tools.test.ts` (batch 02): TU07 consultation
  pump, rejected run check `{"code":"unsupported","reason":"ENOENT: … bwrap"}`.
- `tests/work-graph/S3-context-inputs.test.ts` (batch 08): IN05, IN11, IN12,
  each in memory and sqlite (6 cases); fixture gate check rejected with
  `ENOENT: no such file or directory, access '/usr/bin/bwrap'`. Re-ran that file
  alone to confirm: 30 passed / 6 failed, same bwrap reason.

## UNSPECIFIED / skipped

- Nothing in the item was left unbuilt.
- `tests/work-graph/S3-context-inputs.test.ts` and the one
  `S5-user-message-tools` case could not pass in this environment for the bwrap
  reason above; no timeout was raised and no test was edited or skipped.
- `*.scale.test.ts` files were excluded as instructed, including
  `S5R2-queue-history.scale.test.ts`, `WP2-context-extensions.scale.test.ts`,
  `WP2-undelivered-notices.scale.test.ts`, `S2A-decision-routes.scale.test.ts`
  and `S2A-notices-*.scale.test.ts`.
