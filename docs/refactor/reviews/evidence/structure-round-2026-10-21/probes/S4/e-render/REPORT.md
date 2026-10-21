# S4 (D3b) byte proof — e-render

Base `s85-n2-base` (`b35e077`) → `.dsh-scratch/S4/base-e1`; final commit `39fee06` → `.dsh-scratch/S4/result-e-render` (both `git archive` + hardlinked `node_modules`). Installers are copy-only; the repository tree was never written. The base installer wraps `context-assembler.ts` plus nested `generalWarningLabel`; the result installer wraps `context-rendering.ts` (`renderContext`, `renderQueryContext`, `renderAttentionChanges`), `context-fact-text.ts` (13 formatters) plus the same nested function. `context-support.ts`/`context-types.ts` hold moved helpers and types only; no declared probe function lives there (`utf8Bytes`, `byKey`, `canonical`, `indexRowText`, `sortedSources` are exercised through the formatters/renderers).

28 files (`test-files.txt`) + the copy-only planning driver, each copy: 288/288 tests pass, no `ENOENT .../bwrap` failures. Base run1/run2 and result run1/run2 each captured 2,156 records. The Query split is handled explicitly: 220 base `renderContext` Work calls replay through result `renderContext`, 16 Query calls through result `renderQueryContext` (by prelude); the result log has 220 + 16, the base log 236 under one name.

**Determinism.** Random ids/temp dirs/clock are reported, never erased; replay is the per-record proof.

| copy | records | byte-identical | differing | args-only | out |
|---|---:|---:|---:|---:|---:|
| base run1 vs run2 | 2,156 | 1,843 | 313 | 254 | 59 |
| result run1 vs run2 | 2,156 | 1,843 | 313 | 254 | 59 |

**Replay proof.** Base-run1 recorded args through the result copy: **0/2,156 differences, every probe 0** (`replay-result-report.json`); the same replay on base: 0/2,156. A direct mapped copy-to-copy compare has 399 raw record differences (340 args-only, 59 out), all nondeterministic (temp `skills.resourceRoot`, random ids); replay is the proof.

**Edge.** 140 cases, 0 errors; base twice byte-identical (`cmp`), base vs result **0/140** (`edge-base-vs-result.json`). Inventory §4 item 2 matrix, including every candidate-prefix boundary −1/==/+1, continuation/review null/empty/both, 25-row/empty-anchor lists and text edges.

**Zero calls.** None. `queryPlanSummary` has 0 from the 28 suite files; the driver supplies its 1 call (and `topLevelModuleCards`' second). Commands: `COMMANDS.md`.

```bash
S=.dsh-scratch/S4
git archive 39fee06 | tar -x -C $S/result-e-render
cp -al node_modules $S/result-e-render/node_modules
mkdir -p $S/result-e-render/vendor/coding-agent && cp -al vendor/coding-agent/node_modules $S/result-e-render/vendor/coding-agent/node_modules
node $S/probes/e-render/apply-probe-result.mjs $S/result-e-render --check
node $S/probes/e-render/apply-probe-result.mjs $S/result-e-render
cd $S/result-e-render && S85_PROBE_LOG=$PWD/../../probes/e-render/logs/result-run1 timeout 900 \
  npx vitest run --maxWorkers=2 <28 files + driver; exact lists in COMMANDS.md>
# run 2 = same with logs/result-run2; then:
cd $S/probes/e-render
node combine.mjs logs result-run1 result-run1.jsonl
node combine.mjs logs result-run2 result-run2.jsonl
node replay.mjs ../../result-e-render base-run1.jsonl --out replayed-result-e-render.jsonl --report replay-result-report.json --label result-e-render
node compare-copies.mjs base-run1.jsonl result-run1.jsonl --report base-vs-result-raw.json
node compare-edge.mjs edge-base.jsonl edge-result-e-render.jsonl --report edge-base-vs-result.json
```

## Probe table (base calls = base log; result calls = result log; diffs = replay)

| probe | symbol, base file:line → result file:line | base calls | result calls | diffs |
|---|---|---:|---:|---:|
| `renderContext` | `context-assembler.ts:266` → `context-rendering.ts:232` | 236 | 220 | 0 |
| `renderQueryContext` (base Query half) | `—` (base used `renderContext`) → `context-rendering.ts:252` | 0 (16 under `renderContext`) | 16 | 0 |
| `renderAttentionChanges` | `context-assembler.ts:535` → `context-rendering.ts:270` | 12 | 12 | 0 |
| `fact.effectiveDuty` | `:608` → `context-fact-text.ts:38` | 251 | 251 | 0 |
| `fact.rolePayload` | `:623` → `context-fact-text.ts:53` | 248 | 248 | 0 |
| `fact.goalPayload` | `:734` → `context-fact-text.ts:164` | 141 | 141 | 0 |
| `fact.taskPayload` | `:787` → `context-fact-text.ts:217` | 222 | 222 | 0 |
| `fact.queryFocusLines` | `:904` → `context-fact-text.ts:335` | 14 | 14 | 0 |
| `fact.queryPlanSummary` | `:914` → `context-fact-text.ts:345` | 1 | 1 | 0 |
| `fact.notImplementedExtensions` | `:201` → `context-fact-text.ts:366` | 109 | 109 | 0 |
| `fact.noteSourcesOf` | `:233` → `context-fact-text.ts:382` | 228 | 228 | 0 |
| `fact.declarationsForTask` | `:757` → `context-fact-text.ts:187` | 222 | 222 | 0 |
| `fact.missingInputReminder` | `:831` → `context-fact-text.ts:261` | 7 | 7 | 0 |
| `fact.optionalRowsFromExtensions` | `:852` → `context-fact-text.ts:283` | 232 | 232 | 0 |
| `fact.annotations` | `:890` → `context-fact-text.ts:321` | 228 | 228 | 0 |
| `fact.topLevelModuleCards` | `:921` → `context-fact-text.ts:352` | 2 | 2 | 0 |
| `note.generalWarningLabel` | `note-read-model.ts:1846` → `:1847` | 3 | 3 | 0 |
| **total** | | **2,156** | **2,156** | **0** |

Reach (same as the base report): CA01/CA10/CA11/CA13/CA14 of `tests/runtime/S3-context-assembler.test.ts`; AT02 of `tests/app/S3-attention-context.test.ts`; `R5b-initial-plan` (topLevel); PU-03d of `S4C2-memory-material` and C-02 of `S4C2-assembly` (warning); SPQ01 driver (queryPlanSummary).

## Paths

```text
.dsh-scratch/S4/base-e1/                         base copy + probe
.dsh-scratch/S4/result-e-render/                 result copy (39fee06) + probe
.dsh-scratch/S4/probes/e-render/
  apply-probe-base.mjs  apply-probe-result.mjs  replay.mjs
  compare-records.mjs  compare-copies.mjs  compare-edge.mjs  determinism.mjs
  probe-counts.mjs  combine.mjs  lib/compare.mjs  payload/*
  base-run1.jsonl  base-run2.jsonl  result-run1.jsonl  result-run2.jsonl
  replayed-base-run1.jsonl  replayed-result-e-render.jsonl
  edge-base.jsonl  edge-base2.jsonl  edge-result-e-render.jsonl
  base-determinism*.json  result-determinism-report.json  replay-*-report.json
  base-vs-result-raw.json  edge-base-vs-result.json  test-files.txt
  REPORT.md  COMMANDS.md  README.md  logs/
```
