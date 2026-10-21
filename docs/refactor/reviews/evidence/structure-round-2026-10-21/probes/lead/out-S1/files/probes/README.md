# S1 / D2 byte-proof probes

Scratch root `$S = /tmp/s85-scratch/S1`. The base copy is `$S/base` (a
`git archive s85-base` export, `node_modules` is a symlink). All probe-only
files live here; the copies receive them only through `apply-probe.py`.

## What is wrapped (base line numbers, pristine `s85-base`)

| # | Capture `kind` | Symbol / expression | File:line | How |
|---|---|---|---|---|
| a | `observed-lists` | `enabledNames` + the `hostAuthorizedTools` array literal | `src/core/agent-runtime/observed-model-run.ts:301-303`, `:316` | the authorised literal is bound to one local at the same place, logged, then used as `hostAuthorizedTools` |
| b | `additional-tools` | the existing `additionalTools` callback's return value | `src/core/agent-runtime/observed-model-run.ts:317-338` | `probeAdditionalTools(() => { ...original body... })`; the callback runs exactly once, no factory or resource is touched |
| c | `model-client-tools` | `request.tools` at the model client's `stream` input | `src/core/agent-runtime/observed-model-run.ts:258-267` | one `probeLog` before `assertCurrent`; the raw received array (Kernel's converted, name-sorted specs) |

No edit is made to `execution-driver.ts` or `query-execution.ts`: those files
only pass the options that `runObservedModel` captures.

`probe-log.ts` becomes `src/core/agent-runtime/__probe-log.ts`. It writes one
JSON line `{testFile, testName, kind, runIndex, payload}` per capture to
`$S85_PROBE_LOG_DIR/probe-<pid>.jsonl`. `testFile` is relative to the copy
root, key order is literal order, and `undefined` is written as
`{"__undefined__": true}`. `runIndex` counts per `(testFile, testName, kind)`.
`kind` values: `observed-lists`, `additional-tools`, `model-client-tools`.

The `additional-tools` payload records `{index, name, description, effectClass,
requiredCapabilities, defaultTimeoutMs, outputLimitBytes, independentReadOnly,
inputSchema}` per definition, in return order. `inputSchema` is the definition's
own `toJSONSchema()` (not a Kernel conversion). `model-client-tools` records the
raw `request.tools` array in received order.

## Apply (idempotent; noisy failure if an anchor is missing)

```bash
python3 $S/probes/apply-probe.py $S/base
python3 $S/probes/apply-probe.py $S/result-1   # S1 result, commit 0695a5f
```

The script recognises both source layouts. The result moved the assembly into
`tool-group-assembly.ts`, so three anchors differ; the capture payloads are
identical and no production export was added:

| Capture | Base anchor | Result anchor |
|---|---|---|
| import | after `kernelToolNameOf` import | after `assembleObservedExtensions, kernelEnabledToolNames` import |
| `observed-lists` | `hostAuthorizedTools: [...coordinationNames, ...readonlyCommandNames, ...unknownCallReviewNames, ...commandRerunNames]` | `hostAuthorizedTools: [...extensions.names]` |
| `additional-tools` open | same `additionalTools: workspace => {` | same (unchanged) |
| `additional-tools` close | `if (commandRerunTool !== undefined) tools.push(...)` | `tools.push(...extensions.create(workspace))` |
| `model-client-tools` | `async *stream(request, options) { await o.sourceTools?.assertCurrent?.();` | same (unchanged) |

## Capture commands (exact; max 2 workers, no tsc/build)

Run 1 (fresh log dir):

```bash
mkdir -p /tmp/s85-scratch/S1/probes/logs/base-1
cd /tmp/s85-scratch/S1/base
S85_PROBE_LOG_DIR=/tmp/s85-scratch/S1/probes/logs/base-1 timeout 900 npx vitest run --maxWorkers=2 tests/runtime/C2-runtime-platform-tools.test.ts tests/runtime/S3-graph-tools.test.ts tests/runtime/K-readonly-command.test.ts tests/runtime/K3-14-record-unknown-call-review-tool.test.ts tests/runtime/K3-16-proposal-tool.test.ts tests/runtime/B1-kernel-assembly.test.ts tests/runtime/source-tool-lifecycle.test.ts tests/runtime/B2-01-shell-hook.test.ts
S85_PROBE_LOG_DIR=/tmp/s85-scratch/S1/probes/logs/base-1 timeout 900 npx vitest run --maxWorkers=2 tests/runtime/__probe-cases.test.ts
```

Run 2 is identical with `logs/base-2` (and a fresh `mkdir`). The result copy uses
the same two commands with `logs/result-1`:

```bash
mkdir -p /tmp/s85-scratch/S1/probes/logs/result-1
cd /tmp/s85-scratch/S1/result-1
S85_PROBE_LOG_DIR=/tmp/s85-scratch/S1/probes/logs/result-1 timeout 900 npx vitest run --maxWorkers=2 tests/runtime/C2-runtime-platform-tools.test.ts tests/runtime/S3-graph-tools.test.ts tests/runtime/K-readonly-command.test.ts tests/runtime/K3-14-record-unknown-call-review-tool.test.ts tests/runtime/K3-16-proposal-tool.test.ts tests/runtime/B1-kernel-assembly.test.ts tests/runtime/source-tool-lifecycle.test.ts tests/runtime/B2-01-shell-hook.test.ts
S85_PROBE_LOG_DIR=/tmp/s85-scratch/S1/probes/logs/result-1 timeout 900 npx vitest run --maxWorkers=2 tests/runtime/__probe-cases.test.ts
```

`__probe-cases.test.ts` is the probe-only driver copied in by
`apply-probe.py`; its five `it` blocks cover cases 1, 3, 4, 5 and 8 below.

## Compare

```bash
cd /tmp/s85-scratch/S1/probes
python3 compare.py logs/base-1 logs/base-2
# add --list-tests to print every matched test; --max-details N to bound output
```

`compare.py` implements §5.0 rule 4: strings as UTF-8 buffers (first differing
byte offset, both lengths, 8 bytes on each side), arrays element by element with
count and order, objects by own keys in order with missing/undefined/null kept
apart, numbers exactly (value and JSON number type), and never sorts or
canonicalises a compared value. Capture keys are matched by
`(testFile, testName, kind, runIndex)`.

## Eight cases (§5.2)

| # | Case | Test / driver | Captured? |
|---|---|---|---|
| 1 | Work Run, every coordination group (mailbox, user decision, whiteboard, session discovery, graph, note) | **probe-only driver**, `probe case 1` (`tests/runtime/__probe-cases.test.ts`) | yes |
| 2 | Work Run with no coordination group | `tests/runtime/K-readonly-command.test.ts` :: `KB-07 authorized empty-write Work sees run_readonly_command, runs it and stores the output in this execution` | yes |
| 3 | review Run | **probe-only driver**, `probe case 3 + 4` runIndex 2 (`record_unknown_call_review`) | yes |
| 4 | proposal Run | **probe-only driver**, `probe case 3 + 4` runIndex 3 (`propose_safer_method`) | yes |
| 5 | Run with blocked commands (rerun tool) | **probe-only driver**, `probe case 5` runIndex 3 (`request_command_rerun`) | yes |
| 6 | Query with graph tools | `tests/runtime/S3-graph-tools.test.ts` :: `GT10 sends find then look through the real Query Kernel seam ...` | yes |
| 7 | Query without graph tools | `tests/runtime/K-readonly-command.test.ts` :: `KB-09 an authorized Query granted shell, edit and write still sees none of them` | yes |
| 8 | fixed-source Run (`read_source`/`read_material`) | **probe-only driver**, `probe case 8` | yes |

No checked-in test reaches cases 1, 3, 4, 5 or 8 on its own:

* `B2-01-shell-hook.test.ts` only exercises the exported `before_tool` hook; its
  24 captured Work runs are the fixture's original run (no
  `request_command_rerun`). The blocked-rerun registration is case 5's driver.
* `K3-14-record-unknown-call-review-tool.test.ts` only proves an ordinary Run
  does *not* register the review tool; the positive review round is case 3's
  driver.
* `K3-16-proposal-tool.test.ts` is a unit test of the tool factory; it calls no
  model loop (zero captures). The proposal round is case 4's driver.
* No checked-in test grants `read_source` + `read_material`; case 8's driver
  calls `runObservedModel` directly.

## Result comparison

`python3 compare.py logs/base-1 logs/result-1` (saved as
`logs/result-compare.txt`) is **zero differences** too: 321 captures on each
side (`observed-lists` 98, `additional-tools` 95, `model-client-tools` 128),
identical capture keys. All eight cases match by test file, test name, kind and
runIndex, and each has its `additional-tools` capture.

## Base determinism

`logs/base-1` and `logs/base-2`, each produced by the two commands above in
order, compare with **zero differences**: 321 captures per run
(`observed-lists` 98, `additional-tools` 95, `model-client-tools` 128).
The three `observed-lists` captures with no `additional-tools` partner are the
expected pre-Kernel failures in `source-tool-lifecycle.test.ts`
(`attempts every cleanup ...`, `closes the already-created source tools ...`,
`releases all resources acquired before kernel_initialization fails`); they are
not one of the eight cases.
