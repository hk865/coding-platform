# C2 byte proof — one stable-window executor (book §5.3, §5.0)

Scratch root: the required root was not writable in this sandbox, so all artifacts
use `/tmp/s85-scratch/S2` (base copy: `/tmp/s85-scratch/S2/base`, result:
`/tmp/s85-scratch/S2/result-c2`, probes: `/tmp/s85-scratch/S2/probes/c2`).

Copies: `result-c2` is `cp -a base` plus only the four C2 files
(`views/activity-read-model.ts`, `views/track-read-model.ts`,
`views/task-state-timeline.ts`, new `views/activity-stable-window.ts`). No other
run's files were copied.

Probe: `apply-probe.mjs` adds `views/c2-probe.ts` (not imported by any
production entry) and wraps the record port that reaches each loop plus the
calendar's `now()` expression. Every `readMany` / `lookup` / `lookupOrdered` /
`eventAt` call and every `now()` call is appended, in call order, to
`$C2_PROBE_LOG` as `<test name>\t<tag>\t<kind>\t<args JSON>\n`. Nothing is
sorted or canonicalised at capture or comparison time.

Adapter difference (the only one): in base the loop reads the wrapped port
directly (`readWatermark(probedDeps.records)`, window called with
`probedDeps`); in result the wrapped port is handed to the executor
(`records: probedDeps.records`) and the deferred read receives `probedDeps`.
The log point is the same in both: the record object the loop uses, and the
same calendar `now()` expression.

## Probe table (base copy line numbers, calls over the 7 proof files)

| Probe (what it wraps) | File | Base line | Calls (base-run1) | base1 vs base2 | base vs result |
|---|---|---|---:|---|---|
| activity record port (calendar + Run activity list) | `src/core/work-graph/views/activity-read-model.ts` | 762 (used 773/775/777, 798/800/802) | 262 (`readMany` 158, `lookup` 38, `lookupOrdered` 64, `eventAt` 2) | identical | identical |
| calendar `now()` | `src/core/work-graph/views/activity-read-model.ts` | 763 (call at 775) | 26 | identical | identical |
| track record port | `src/core/work-graph/views/track-read-model.ts` | 1165 (used 1174/1176/1178) | 259 (`readMany` 127, `lookup` 96, `lookupOrdered` 36) | identical | identical |
| task timeline record port | `src/core/work-graph/views/task-state-timeline.ts` | 539 (used 548/550/552) | 389 (`readMany` 135, `lookup` 216, `lookupOrdered` 38) | identical | identical |

Total captured lines: 936. Zero differences in every comparison.

## Per-file comparison (raw bytes)

| Proof test file | base-run1 bytes | base-run2 bytes | result bytes | base1=base2 | base=result |
|---|---:|---:|---:|---|---|
| `S2B-activity-read-faults.test.ts` | 43436 | 43436 | 43436 | identical | identical |
| `S2B-r2-27-moving-window.test.ts` | 85324 | 85324 | 85324 | identical | identical |
| `S2B-r2-keyed-cap.test.ts` | 16020 | 16020 | 16020 | identical | identical |
| `S2B-r2-r7-keyed-read-cap.test.ts` | 19546 | 19546 | 19546 | identical | identical |
| `S2B-33-task-timeline-pagination.test.ts` | 31888 | 31888 | 31888 | identical | identical |
| `S2B-r2-r4-bound-workspace.test.ts` | 11946 | 11946 | 11946 | identical | identical |
| `S2B-35-activity-routes.test.ts` | 18393 | 18393 | 18393 | identical | identical |

Differences: 0/7 determinism, 0/7 base-vs-result. `compare.mjs` compares raw
UTF-8 buffers with `Buffer.equals`; on a mismatch it prints the first differing
byte offset, both lengths and 16 bytes on each side. All runs were
`rc=0`.

## Commands

```sh
node /tmp/s85-scratch/S2/probes/c2/apply-probe.mjs /tmp/s85-scratch/S2/base
node /tmp/s85-scratch/S2/probes/c2/apply-probe.mjs /tmp/s85-scratch/S2/result-c2
/tmp/s85-scratch/S2/probes/c2/run.sh
```

`run.sh` performs, per proof file, from `base` (twice) and `result-c2` (once):

```sh
C2_PROBE_LOG=logs/<label>/<stem>.log npx vitest run --maxWorkers=2 <file>
```

then for each file:

```sh
node compare.mjs logs/base-run1/<stem>.log logs/base-run2/<stem>.log
node compare.mjs logs/base-run1/<stem>.log logs/result-run1/<stem>.log
```

Raw artifacts: `logs/{base-run1,base-run2,result-run1}/*.log` and `*.stdout`,
`run.out`, `apply-probe.mjs`, `run.sh`, `compare.mjs`. Each proof run passed:
6, 8, 4, 4, 12, 4, 4 tests (42 total) in every copy and round.

## Replay on the final commit (c673759c75a5f7c1ad859cc513b9fb5dd1d1e0f8)

A fresh copy `result-final` was made from the base copy, overlaid with
`git archive HEAD` (the committed C2/C1/A6/B1 tree) and probed with the same
`apply-probe.mjs`. The seven proof files were run once
(`logs/final-run1/`), 42 tests passed, and each log compared with the
original `logs/base-run1/` log: 7/7 byte-identical (`compare.mjs`, raw
UTF-8 buffers), 936 captured lines, zero differences.
