# S4 (D3b) probe kit — e-render

Probe kit for book §5.1 "Byte proof, S4" item 1 (renderers, every fact
formatter of `context-fact-text.ts`, nested `generalWarningLabel`, inventory §4
item 2 edge matrix). Scratch only; nothing here is committed.

## Install

Two anchor-asserting installers write the SAME record shape and the SAME edge
harness/case list; only the module imports differ.

| copy | installer | wrapped modules |
|---|---|---|
| base `s85-n2-base` | `apply-probe-base.mjs` | `src/core/agent-runtime/context-assembler.ts` + nested `generalWarningLabel` in `note-read-model.ts` |
| result (final commit) | `apply-probe-result.mjs` | `context-rendering.ts` (`renderContext`, `renderQueryContext`, `renderAttentionChanges`), `context-fact-text.ts` + nested `generalWarningLabel` in `note-read-model.ts` |

```bash
node apply-probe-base.mjs   <copy> --check   # anchors only, writes nothing
node apply-probe-base.mjs   <copy>
node apply-probe-result.mjs <copy> --check
node apply-probe-result.mjs <copy>
```

Each module-level target is wrapped by renaming `NAME` -> `NAMEImpl` and
appending a same-name wrapper plus an exported `probeNAME`; declarations hoist,
so every existing caller gets the wrapper. `generalWarningLabel` is renamed and
wrapped in place inside `createNoteReadModel`; its probe source is registered
with a hook appended at the end of the file. Installers are transactional: every
anchor must match exactly once before anything is written. `--check` on the
final commit `39fee06` passed; because it is anchor-asserting, run `--check` only on a fresh archive.

Copy-only files: `src/probe-hook.ts`, `tests/probe-setup.ts`,
`tests/probes/edge-cases.ts`, `tests/probes/edge.test.ts`,
`tests/probes/edge-targets.ts` (installer variant),
`tests/probes/planning-query.test.ts` (probe driver, see below). `vitest.config.ts`
gains `setupFiles: ['./tests/probe-setup.ts']`.

## Log shape

One JSON line per call, per-worker file `${S85_PROBE_LOG}.<pool>.<pid>.jsonl`:

```json
{"testPath":"...","testName":"...","probe":"renderContext","index":0,"args":[...],"out":...}
```

`undefined` is serialised as `{"$probe":"undefined"}`; `index` resets per probe
before each test; the key is `(testPath, testName, probe, index)`. Objects keep
construction key order; nothing is sorted or canonicalised.

## Runs (base)

28 files = 24 in `.dsh-ref/s85-tests.txt` + every `*.test.ts` importing
`context-assembler` (28 listed in `test-files.txt`), batches of at most 10,
`--maxWorkers=2`, each `timeout 900`. Plus the copy-only driver
`tests/probes/planning-query.test.ts` (the suite never reaches the planning
Query branch, so `queryPlanSummary` would capture zero). Never a scale test.

```bash
cd .dsh-scratch/S4/base-e1
S85_PROBE_LOG=$PWD/../../probes/e-render/logs/base-run1 \
  timeout 900 npx vitest run --maxWorkers=2 <10 files>
# ... batches 2, 3 and the driver ...
cd ../../probes/e-render
node combine.mjs logs base-run1 base-run1.jsonl
node probe-counts.mjs base-run1.jsonl --expect 'renderContext,...,note.generalWarningLabel'
node compare-records.mjs base-run1.jsonl base-run2.jsonl --report base-determinism.json
node determinism.mjs base-run1.jsonl base-run2.jsonl --report base-determinism-report.json
node replay.mjs ../../base-e1 base-run1.jsonl \
  --out replayed-base-run1.jsonl --report replay-base-report.json --label base-e1
```

Edge harness (twice; `cmp` must be byte-identical):

```bash
cd .dsh-scratch/S4/base-e1
S85_EDGE_OUT=.../edge-base.jsonl S85_EDGE_LABEL=base-e1 \
  timeout 900 npx vitest run --maxWorkers=2 tests/probes/edge.test.ts
cd .../probes/e-render
node compare-edge.mjs edge-base.jsonl edge-base2.jsonl
```

## Result replay (later, final commit)

```bash
S=.dsh-scratch/S4; git archive 39fee06 | tar -x -C $S/result-1
cp -al node_modules $S/result-1/node_modules
mkdir -p $S/result-1/vendor/coding-agent
cp -al vendor/coding-agent/node_modules $S/result-1/vendor/coding-agent/node_modules
node $S/probes/e-render/apply-probe-result.mjs $S/result-1 --check
node $S/probes/e-render/apply-probe-result.mjs $S/result-1
# same 28 files + driver, S85_PROBE_LOG=.../logs/result-run1
node combine.mjs logs result-run1 result-run1.jsonl
node replay.mjs ../../result-1 base-run1.jsonl \
  --out replayed-result-run1.jsonl --report replay-result-report.json --label result-1
# edge twice on result-1 then:
node compare-edge.mjs edge-base.jsonl edge-result-1.jsonl --report edge-base-vs-result-1.json
```

`replay.mjs` feeds the BASE-recorded arguments through the copy's real functions
(via `tests/probes/edge-targets.ts`) and compares outputs with `lib/compare.mjs`.
The result adapter dispatches a recorded base `renderContext` Query call (exact
Query prelude) to `renderQueryContext`; Work calls stay on `renderContext`.
Random ids/hashes are not erased; the base-recorded args carry them, so the
result side sees identical inputs. The result copy must give 0 differences.

## Files

- `lib/compare.mjs` — strings as UTF-8 buffers (first differing byte, both
  lengths, 16 bytes around it), arrays element by element, objects by own keys
  in order, numbers exactly; `undefined` sentinel kept.
- `combine.mjs`, `compare-records.mjs`, `determinism.mjs`, `probe-counts.mjs`,
  `compare-edge.mjs`, `replay.mjs`.
- `edge-base.jsonl`, `edge-base2.jsonl`, `base-run1.jsonl`, `base-run2.jsonl`,
  `replayed-base-run1.jsonl`, reports `base-determinism*.json`,
  `replay-base-report.json`, `edge-base-determinism.json`, batch logs in
  `logs/`.
