# S3 (D3a) renderer byte proof — run e1

Scratch: `/tmp/s85-scratch/S3/` (the run sheet's `/home/han001/dsh-work/85-scratch/S3`
is not writable here; this is the same substitution `CONVENTIONS.md` fixes).
Repository tree untouched. Every edit below is in the scratch copies only.

## Copies and probe

| path | role |
|---|---|
| `base-e1` | fresh `git archive s85-base` + probe (recording run 1 and 2) |
| `base-e2` | fresh `git archive s85-base` + probe (second-copy replay smoke test) |
| `result-e1` | `cp -a` of `/tmp/s85-scratch/S3/result` at 22:18 + probe (interim result snapshot; hashes in `result-snapshot.sha256`) |

`node_modules` and `vendor/coding-agent/node_modules` are symlinks to the repository's
(cross-device hardlinks fail). Probe files added to a copy:

- `src/probe-hook.ts` — appends one JSON line
  `{testPath,testName,probe,index,args,out}` per call, per-worker file
  `${S85_PROBE_LOG}.<pool>.<pid>.jsonl`; `undefined` marked as `{"$probe":"undefined"}`.
- `tests/probe-setup.ts` + `setupFiles` in the copy's `vitest.config.ts`;
  `expect.getState()` gives `testPath` / `currentTestName`, counters reset per test.
- `tests/probes/edge-inputs.ts`, `tests/probes/edge.test.ts` (308 edge cases).
- `replay.mjs` writes `tests/probes/replay.generated.test.ts` into the copy it runs on.

The installer is transactional: all anchors must match before anything is written.
`--check` verified it matches both `base-e1` and the current `/tmp/s85-scratch/S3/result`
tree.

## Probe table (base lines from `git show s85-base:<file>`)

`Calls` and `diffs` are run 1; the result column is the replay on the interim
`result-e1` snapshot. All replays feed the *base-recorded* args.

| probe | symbol / file:line | calls | diffs base | diffs result |
|---|---|---|---|---|
| `brief.render` | `renderContinuationBriefZh` `src/contracts/continuation-brief.ts:382` | 30 | 0 | 0 |
| `brief.approvedMethods` | `approvedMethodLinesZh` `continuation-brief.ts:864` | 300 | 0 | 0 |
| `brief.blockedCommands` | private `blockedCommandsLinesZh` `continuation-brief.ts:517` | 47 | 0 | 0 |
| `unknownCallReview.render` | `renderUnknownCallReviewZh` `src/contracts/core/prepared-execution.ts:97` | 277 | 0 | 0 |
| `roleProfile` | `platformRoleProfile` `src/core/agent-runtime/role-profiles.ts:63` | 927 | 0 | 0 |
| `decisionResponseInput` | `formatDecisionResponseInput` `src/core/agent-runtime/execution-inputs.ts:58` | 3 | 0 | 0 |
| `architectureReminderRows` | `architectureReminderRowEntries` `src/core/agent-runtime/architecture-reminders.ts:188` | 47 | 0 | 0 |
| `noteHeader` | `renderNoteHeader` `src/contracts/note.ts:109` | 10 | 0 | 0 |
| `consultation.guidance` | expression `src/business/workflow/consultation.ts:447` | **0** | 0 | 0 |
| `scribe.reminder` | expression `src/app/host.ts:1434–1435` | 11 | 0 | 0 |
| `contextExtensions.decisionRow` | `待决定：…` `src/core/work-graph/views/context-extensions.ts:124` | 75 | 0 | 0 |
| `contextExtensions.notAvailableRow` | `待决来源尚未接入：…` `context-extensions.ts:134` | 85 | 0 | 0 |
| `contextExtensions.anomalyAnchor` | `中断，待核对：…` `context-extensions.ts:179` | 156 | 0 | 0 |
| **total** | | **1968** | **0** | **0** |

`consultation.guidance` captured nothing from the suite: every consultation test
sends `intent: 'inquiry'` (isolated path) or pre-saves the formal Answer, so the
`part='message' + action_request` branch is not reached. It is covered by 12 edge
cases (`consultation.*`) and is byte-equal between the copies.

`decisionResponseInput`'s 3 calls come from `S5-user-message-tools.test.ts`; that
file fails its later TU07 with `ENOENT ... '/usr/bin/bwrap'` on this machine in
both runs. The 3 calls are recorded before the failure; the other 19 files pass.

## Base determinism (book §5.0 rule 3)

Two full recordings: `base-run1.jsonl`, `base-run2.jsonl`, each 1,968 records.

- 1,935 / 1,968 lines are byte-identical.
- 33 differ, all matched by `(relative testPath, testName, probe, index)`:
  - 25 differ only in `args`: 24 `architectureReminderRows` (real observation
    `captureId`/digests/`observedAt`/`now`, and `autoCapture.requestedAt`) and 1
    `noteHeader` (random `noteId`/`runId` in the S4C2 fixture). Their `out` is equal.
  - 8 differ in `out`: all `unknownCallReview.render` from
    `tests/work-graph/K3-35-owner-manifest-trim.test.ts` (memory + sqlite), because
    the real Kernel `tool.started` wall-clock stamp is embedded in the rendered
    `开始时间` text. No erasing/canonicalising was done.
- The 8 are matched by test/call index and replayed with run 1's recorded args, so
  the result renderer sees the identical `startedAt` string. Replaying run 1 on
  `base-e1` gives 0/1968 differences, which is the per-record determinism proof.
- `architectureReminderRows`'s `now` is real time too; in these two runs the
  elapsed bucket stayed the same. If a future run crosses a bucket, the record is
  still replayable because the base args are replayed, not re-derived.

Machine-readable: `base-determinism.json`. Edge harness output is byte-identical
across two runs (`cmp edge-base.jsonl edge-base2.jsonl`).

## Result replay

- `base-e1`: 1,968 calls, 0 differences (`replay-base-report.json`).
- `base-e2` (second fresh copy): 0 differences; `replayed-base.jsonl` and
  `replayed-base-e2.jsonl` are byte-equal.
- `result-e1` (interim S3 snapshot): 1,968 calls, 0 differences
  (`replay-result-e1-report.json`); `replayed-result-e1.jsonl` is byte-equal to
  `replayed-base.jsonl`. Edge: 308/308 cases equal (`edge-base-vs-result-e1.json`).
- Result snapshot hashes: `result-snapshot.sha256` (before probe installation).

## Edge harness (inventory §4 item 2)

308 cases, 0 errors, 308/308 equal base vs result. `edge-inputs.ts` covers:
enum branches (5 failure classes, 3 actor classes, 5 tool results, 3 side effects
+ null, 3 wait states, 3 checkpoint kinds, 4 selfChanged states, 3 uncommitted
states, 3 segment verdicts, 4 session continuities, 6 finding kinds, 8 note
kinds, 9 anchors, 9 decision-source kinds); empty/non-empty lists; 8
anomaly/review/blocked combinations; 25 anomaly anchors; 16/17 blocked lines and
keep 0/15/16; 160/161-byte and multibyte declared forms; near-16 KiB briefs (3);
K3 review/proposal with expanded/truncated/unexpanded, 4 dispositions × 2
sources, null/empty/multiline cwd, null/empty commands, personText null/empty/text,
unsorted targets, empty/non-empty annotations and platformTargets, summary
fallback; 5 duties; all 5 decision selections; architecture empty/null/no-row,
12-row cap, moves, 7 elapsed thresholds; 8 kinds × 9 anchors; scribe 0/19/20/21/40
anchors; and `\r\n`, lone `\n`, Chinese, emoji, combining chars, `{{slot}}`,
backticks, trailing spaces.

## Commands

```bash
# install (check first; applies to base / result / any copy)
node /tmp/s85-scratch/S3/probes/e1/apply-probe.mjs <copy> --check
node /tmp/s85-scratch/S3/probes/e1/apply-probe.mjs <copy>

# record one run (two batches, <=10 files, 2 workers)
cd /tmp/s85-scratch/S3/base-e1
S85_PROBE_LOG=/tmp/s85-scratch/S3/probes/e1/base-run1 \
  npx vitest run --maxWorkers=2 \
  tests/runtime/K3-15-blocked-sentence-pure.test.ts \
  tests/runtime/K3-15-blocked-omission.test.ts \
  tests/runtime/K3-16-approved-method-lines.test.ts \
  tests/runtime/K3-16-proposal-input.test.ts \
  tests/runtime/K3-16-proposal-tool.test.ts \
  tests/runtime/K3-35-renderer-boundary-pure.test.ts \
  tests/runtime/S5-user-message-tools.test.ts \
  tests/work-graph/S3-role-profiles.test.ts \
  tests/work-graph/S8A-L8-reminders-public.test.ts \
  tests/work-graph/S4A-note-history.test.ts
S85_PROBE_LOG=/tmp/s85-scratch/S3/probes/e1/base-run1 \
  npx vitest run --maxWorkers=2 \
  tests/work-graph/S8A-L8-reminders-pure.test.ts \
  tests/app/AG2-consultation.test.ts \
  tests/app/S4C2-scribe-reminders.test.ts \
  tests/work-graph/WP2-context-extensions.test.ts \
  tests/work-graph/WP1-context-anomalies.test.ts \
  tests/work-graph/K3-35-owner-manifest-trim.test.ts \
  tests/runtime/K3-review-input-pure.test.ts \
  tests/runtime/K3-35-manifest-trim-pure.test.ts \
  tests/runtime/K3-15-disposition-effects-pure.test.ts \
  tests/runtime/K3-16-review-extremes-pure.test.ts

# combine, determinism, replay, edge
cd /tmp/s85-scratch/S3/probes/e1
node combine.mjs . base-run1 base-run1.jsonl
node combine.mjs . base-run2 base-run2.jsonl
node --max-old-space-size=4096 determinism.mjs base-run1.jsonl base-run2.jsonl \
  --report base-determinism.json
node replay.mjs <copy> base-run1.jsonl --out replayed-<copy>.jsonl \
  --report replay-<copy>-report.json --label <copy>
cd <copy> && S85_EDGE_OUT=.../edge-<copy>.jsonl S85_EDGE_LABEL=<copy> \
  npx vitest run --maxWorkers=2 tests/probes/edge.test.ts
cd /tmp/s85-scratch/S3/probes/e1
node compare-edge.mjs edge-base.jsonl edge-<copy>.jsonl --report edge-<copy>.json
```

`tests/work-graph/WP2-context-extensions.scale.test.ts` is excluded by the
default config (`**/*.scale.test.ts`, SC / decision 86-6) and was not run; the
normal WP2 context-extensions file is in batch 2.

## UNSPECIFIED / notes

- The `result-e1` proof is against the snapshot of `/tmp/s85-scratch/S3/result`
  taken at 22:18; re-run it after the result is frozen. The installer currently
  matches that result tree (`--check`), so no wrapper adaptation was needed.
- `consultation.guidance` has no test-recorded calls (reason above); its proof is
  edge-only. This is a gap in the existing suite, not in the renderer.
- `renderNoteHeader` takes no note state, and `platformRoleProfile` takes no
  resolved/legacy role selection; "note states" and "resolved/legacy roles" from
  inventory §4 item 2 cannot be fed to these two renderers. Covered here: all
  note kinds/anchors and all five duties (the profile template is the legacy
  form); the rest belongs to S4/other formatters.
- `tests/runtime/S5-user-message-tools.test.ts` fails after its recordings because
  `/usr/bin/bwrap` is absent in this environment; this is unrelated to the probe
  and affected both base runs identically.
