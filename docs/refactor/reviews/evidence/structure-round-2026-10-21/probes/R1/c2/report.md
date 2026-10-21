# C2 byte proof (rework 1) — one stable-window executor, results recorded

Scratch root: `.dsh-scratch/R1` (inside this repo copy, git-ignored).

- base copy: `.dsh-scratch/R1/base` (`git archive s85-base`, node_modules hardlinked)
- result copy: `.dsh-scratch/R1/result-1` (`git archive HEAD` = `b35e077`, node_modules hardlinked)
- probe + logs: `.dsh-scratch/R1/probes/c2/`

S2's probe was copied here and extended. The original probe recorded only each
store call's arguments; this one also records what the call returned or, when it
threw, the thrown error, and the value each of the four loops returns. Values are
serialised with own keys in insertion order, `undefined` marked
(`\u0000undefined`), `null` distinct, arrays element by element and numbers
exact — no sorting, no canonicalisation. `compare.mjs` keeps the raw UTF-8
buffer comparison and additionally counts, per `test name + tag + kind`, the
lines captured on each side; it fails when any key required by base-run1 (and
the four `*-result` tags) captured nothing on either side.

## Determinism (book §5.0 rule 3)

Two values in the results come from the real environment, not the product:
`fs.mkdtemp()` in `tests/helpers/task-claim-fixture.ts:197` puts a random suffix
in the workspace root recorded by the Session, and
`src/core/work-graph/sessions/session-directory.ts:770,956` stamps the Session
and its create operation with `new Date().toISOString()`. Both are made
deterministic at their source, identically in base and result, by
`make-deterministic.mjs` (the test-file basename plus a per-process counter for
the directory; the fixture's fixed clock `2026-09-24T00:00:00.000Z` for the two
timestamps). Nothing is masked in the compared output, and the raw buffer is
the proof. Two base runs compare equal in all seven files and in the combined
log.

## Probe table (base copy)

| Probe (what it wraps) | File | Base line | Calls (base-run1) | base1 vs base2 | base vs result |
|---|---|---:|---:|---|---|
| activity record port — arguments + result/error | `src/core/work-graph/views/activity-read-model.ts` | 762 (used 773/775/777, 798/800/802) | 262 (`readMany` 158, `lookup` 38, `lookupOrdered` 64, `eventAt` 2) | identical | identical |
| calendar `now()` — call + result | `src/core/work-graph/views/activity-read-model.ts` | 763 (call at 775) | 26 | identical | identical |
| track record port — arguments + result/error | `src/core/work-graph/views/track-read-model.ts` | 1165 (used 1174/1176/1178) | 259 (`readMany` 127, `lookup` 96, `lookupOrdered` 36) | identical | identical |
| task timeline record port — arguments + result/error | `src/core/work-graph/views/task-state-timeline.ts` | 539 (used 548/550/552) | 389 (`readMany` 135, `lookup` 216, `lookupOrdered` 38) | identical | identical |
| calendar loop result (`readActivityCalendar` return) | `activity-read-model.ts` | factory 759, wrapper 817 | 19 | identical | identical |
| Run activity list result (`readRunActivities` return) | `activity-read-model.ts` | factory 759, wrapper 818 | 11 | identical | identical |
| track loop result (`readTrackBars` return) | `track-read-model.ts` | factory 1164, wrapper 1194 | 15 | identical | identical |
| task timeline loop result (`readTaskStateTimeline` return) | `task-state-timeline.ts` | factory 538, wrapper 567 | 37 | identical | identical |

Total captured lines per round: 1,018 (1,018 base-run1, 1,018 base-run2,
1,018 result-run1). Loop-result lines: 82 (19 + 11 + 15 + 37). No wrapped store
call threw in these seven files (`error=` lines: 0); every call's result is in
the log (`result=` lines: 1,018/1,018). Missing required probes: 0; per-probe
count mismatches: 0.

## Per-file comparison (raw UTF-8 buffers)

| Proof test file | base-run1 bytes | base-run2 bytes | result bytes | base1=base2 | base=result |
|---|---:|---:|---:|---|---|
| `S2B-activity-read-faults.test.ts` | 307,872 | 307,872 | 307,872 | identical | identical |
| `S2B-r2-27-moving-window.test.ts` | 379,980 | 379,980 | 379,980 | identical | identical |
| `S2B-r2-keyed-cap.test.ts` | 79,294 | 79,294 | 79,294 | identical | identical |
| `S2B-r2-r7-keyed-read-cap.test.ts` | 137,316 | 137,316 | 137,316 | identical | identical |
| `S2B-33-task-timeline-pagination.test.ts` | 127,064 | 127,064 | 127,064 | identical | identical |
| `S2B-r2-r4-bound-workspace.test.ts` | 55,204 | 55,204 | 55,204 | identical | identical |
| `S2B-35-activity-routes.test.ts` | 100,901 | 100,901 | 100,901 | identical | identical |
| combined (fixed file order) | 1,187,631 | 1,187,631 | 1,187,631 | identical | identical |

Differences: 0/7 determinism, 0/7 base-vs-result, 0/1 combined. The combined
comparison applies the global "all four loop-result tags captured" rule.

Tests: 42 passed in each round (6, 8, 4, 4, 12, 4, 4 per file); no
`TEST-FAIL`, no `ENOENT … bwrap`.

## Commands

```sh
# per copy (base and result-1), already done here
node .dsh-scratch/R1/probes/c2/apply-probe.mjs <copy>
node .dsh-scratch/R1/probes/c2/make-deterministic.mjs <copy>

# full proof: base twice, result once, raw compares + per-probe missing/count rule
.dsh-scratch/R1/probes/c2/run.sh /home/han001/dsh-work/slices/s9s85r1/.dsh-scratch/R1/result-1
```

Raw artifacts: `logs/{base-run1,base-run2,result-run1}/*.{log,stdout}`,
`run-deterministic.out`, `apply-probe.mjs`, `make-deterministic.mjs`,
`compare.mjs`, `run.sh`. `compare.mjs` prints `MISSING probe …` and exits
non-zero if a required key is empty on either side; its negative self-tests
(empty log → 16 MISSING; store-only log + `--require-loop-results` → four
loop-tag MISSING) were run when the rule was added.
