# S3/D3a byte proof — guide and tools (base)

Scratch only; the repository copy was not edited. Base copy:
`/tmp/s85-scratch/S3/base-e2` (fresh `git archive s85-base`; `node_modules` and
`vendor/coding-agent/node_modules` symlinked). The run sheet's scratch path was not
writable, so `/tmp/s85-scratch/S3` from `CONVENTIONS.md` is used.

## Probe table

| # | What is wrapped (symbol, file, base line) | Capture point | Runs | Calls per run | Differences |
|---|---|---|---|---|---|
| 1 | `INITIAL_COORDINATION_RESPONSE_GUIDE`, `src/core/agent-runtime/query-preparation.ts:50–133` | direct import in `tests/probe-setup.ts`, one record per test file | base-run1, base-run2 | 22 records; every one 8,347 bytes | 0 |
| 2 | final Query input after the guide append, `query-preparation.ts:309–311` | `probeLog('query-input')` right after the `question` expression | base-run1, base-run2 | 51 (45 `initial_coordination` with guide, 6 `semantic_query` without); all 45 end with exactly `\n\n` + the 8,347-byte guide, the 6 contain no guide | 0 |
| 3 | registered definitions in registration order, `src/core/agent-runtime/observed-model-run.ts:317–337` (`additionalTools` return) | `probeLog('tools-additional')` before `return tools`; name, description, `inputSchema.toJSONSchema()` | base-run1, base-run2 | 97 (31 distinct platform tools) | 0 |
| 4 | `enabledNames` and `hostAuthorizedTools`, `observed-model-run.ts:301–303`, `:316` | `probeLog('tool-lists')` where the function computes them | base-run1, base-run2 | 100 | 0 |
| 5 | tool specs at the model client, `observed-model-run.ts:258–266` (`client.stream`) | `probeLog('model-client-tools')` with the complete `request.tools` (Kernel converted and name-sorted at `vendor/coding-agent/dist/tools/registry/tool-registry.js:71–99`; dist not edited) | base-run1, base-run2 | 130 (33 distinct names = 31 platform + builtins `read`, `edit`) | 0 |

All 31 platform tools appear in (a): `ack_session_message`, `apply_future_plan`,
`code_index`, `cpp_index`, `find_graph`, `find_related_sessions`, `list_files`,
`look_graph`, `project_source`, `propose_future_plan`, `propose_safer_method`,
`python_index`, `query_ready_tasks`, `query_task_graph`, `read_session_card`,
`read_session_inbox`, `read_session_message`, `read_session_message_body`,
`read_source`, `read_user_decision`, `record_decision_application`, `record_note`,
`record_unknown_call_review`, `request_command_rerun`, `respond_session_message`,
`run_readonly_command`, `search`, `send_session_message`, `send_user_message`,
`source_excerpt`, `symbols`.

## Base vs base twice

`node compare.mjs base-run1 base-run2` → 22 files, 400 records compared,
**0 payload differences, 22/22 raw-byte-equal files, 0 runIndex differences**.
Concatenated snapshots are byte-identical:
`base-run1.jsonl` and `base-run2.jsonl`, 400 lines, both sha256
`3d934394255a25ee5902488e2ebd59e0ede738e6216f7930df0ae207c227656f`.
Guide bytes: 8,347 bytes, sha256
`0ce75daec4258062d451703fb6efb22879a7e2e8359767a17d0f2666bfe8bd3d`
(`artifacts/guide-base.txt`).

## Result copy vs base (final commit 6b8c80f)

`/tmp/s85-scratch/S3/result-final`, `git archive` of the final commit with both
`node_modules` symlinks. The same `apply-probes.mjs` / `run-capture.sh` were applied
(`result/`, `result.log`). `node compare.mjs base-run1 result`:

- 22 files, 400 records, **22/22 raw-byte-equal, 0 payload differences, 0 runIndex
  differences**.
- Guide constant: 22 records, 8,347 bytes, same sha256
  `0ce75daec4258062d451703fb6efb22879a7e2e8359767a17d0f2666bfe8bd3d`.
- Final Query input: 51 calls (45 `initial_coordination` ending in exactly `\n\n` + the
  guide; 6 `semantic_query` with no guide), 0 differences.
- `additionalTools`: 97 calls, all 31 platform tools, 0 differences.
- `enabledNames` / `hostAuthorizedTools`: 100 calls, 0 differences.
- Model client: 130 calls, 33 names (31 platform + builtins `read`, `edit`), 0 differences.
- `result.jsonl` is byte-identical to `base-run1.jsonl` (400 lines, sha256
  `3d934394255a25ee5902488e2ebd59e0ede738e6216f7930df0ae207c227656f`).
- The only failing tests are the same environment failures as the base: 15
  `sandbox_unavailable` in `K-readonly-command.test.ts`, one `waiting` in
  `business/R5b-initial-planning-workflow.test.ts`, one `waiting` in `R6-host.test.ts`.

## Case coverage

| Case | Reached by |
|---|---|
| every coordination group | repository tests for mailbox, graph, note, session discovery and `query_task_graph`; probe driver registers all 18 coordination names (mailbox 6, decisions 3, whiteboard 4, discovery 2, graph 2, note 1) |
| none | `source-tool-lifecycle.test.ts` "does not open or register source capabilities without read permission (pinned=false/true)" → empty `enabledNames`/`hostAuthorizedTools`; `K3-14` "never registers record_unknown_call_review on an ordinary Run" |
| review | probe driver, `record_unknown_call_review` |
| proposal | probe driver, `propose_safer_method` |
| blocked commands / rerun | probe driver, `request_command_rerun` (the blocked-command Work tests in the named set do not reach the callback) |
| Query with graph | 45 `initial_coordination` query inputs (R5b-initial-plan, R5b-query-execution, R5b-query-session-loop, S3-graph-tools, K-readonly-command, business R5b, R6-host, host-settings, S3-prepared-context-admission) |
| Query without | 6 `semantic_query` query inputs (S3-graph-tools GT05/GT10/GT11/GT12/GT20, host-settings) |
| fixed-source | `project_source` captured 79 times through B1/exploration/R5b/K-readonly |

Named-file note: `K3-14-record-unknown-call-review-tool.test.ts` and
`K3-16-proposal-tool.test.ts` call the factories directly, not `runObservedModel`, so the
named files alone never reach the `additionalTools` callback for those two tools. Their
captures cover the ordinary-Run negative (`K3-14 ... never registers
record_unknown_call_review on an ordinary Run`); the review/proposal/rerun registration
cases are reached by `driver.test.ts`. The other named files reach the callback normally.

## Run commands

```bash
cd /tmp/s85-scratch/S3/probes/e2
node apply-probes.mjs /tmp/s85-scratch/S3/base-e2
./run-capture.sh /tmp/s85-scratch/S3/base-e2 base-run1 base-run1.log
./run-capture.sh /tmp/s85-scratch/S3/base-e2 base-run2 base-run2.log
node compare.mjs base-run1 base-run2
# later, on a result copy:
node apply-probes.mjs <result-copy>
./run-capture.sh <result-copy> result result.log
node compare.mjs base-run1 result
```

`run-capture.sh` runs five `npx vitest run --maxWorkers=2` commands (6, 5, 6, 1, 4 files)
under `timeout 900`, with `S85_PROBE_DIR` pointing at the output directory; it copies
`driver.test.ts` into the scratch copy's `tests/probe-e2/`. The five groups are A
(C2-runtime-platform-tools, S3-graph-tools, K-readonly-command, K3-14, K3-16-proposal-tool,
B1-kernel-assembly), B (source-tool-lifecycle, exploration-tools, reviewer-source-tools,
project-source-tool, C1-communication-tools), C (R5b-initial-plan, R5b-query-execution,
R5b-query-job, business R5b, composition R5b, runtime R5b-query-session-loop), D
(probe-e2/driver) and E (R6-host, host-settings, S3-prepared-context-admission,
S3-context-assembler). Probe files:
`src/probe-hook.ts`, `tests/probe-setup.ts`, `setupFiles` in `vitest.config.ts`, the
`query-preparation.ts` and `observed-model-run.ts` edits.

## Environment-only test failures (captures unaffected)

- `K-readonly-command.test.ts`: 15 tests fail with `sandbox_unavailable` (no bubblewrap).
- `business/R5b-initial-planning-workflow.test.ts` and `app/R6-host.test.ts`: one test each
  ends `waiting`, not `completed`, because their registered `echo` check needs the same
  missing sandbox.

Tool registration and the guide expression happen before those commands, and both base
runs produced identical bytes for these files.

## Notes / UNSPECIFIED

- Result copy was not created; `run-result.sh` applies the identical probe and compares.
- `read_source` is only registered when `createExplorationTools` receives
  `includeReadSource: true`; the driver sets it. `read_material` is a material tool, not
  one of the 31.
- The guide constant is logged once per test file (18 identical copies, not 18 different
  guides).
- `model-client-tools` also sees Kernel builtins `read`/`edit`; the comparison keeps
  them, because rule 4 says never drop data before comparing.
