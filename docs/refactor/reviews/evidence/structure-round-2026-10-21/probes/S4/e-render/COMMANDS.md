# Exact run commands (S4 e-render)

All commands run from the repository root unless a `cd` is shown. Nothing outside
`.dsh-scratch/S4` is written.

## Copy and install

```bash
S=.dsh-scratch/S4
mkdir -p $S/base-e1
git archive s85-n2-base | tar -x -C $S/base-e1
cp -al node_modules $S/base-e1/node_modules
mkdir -p $S/base-e1/vendor/coding-agent
cp -al vendor/coding-agent/node_modules $S/base-e1/vendor/coding-agent/node_modules
node $S/probes/e-render/apply-probe-base.mjs $S/base-e1 --check
node $S/probes/e-render/apply-probe-base.mjs $S/base-e1
```

## Recording: run 1

Run every command below inside `$S/base-e1`. Each is under `timeout 900` and uses
`--maxWorkers=2`. `S85_PROBE_LOG` is the same prefix for every batch (per-worker
files `base-run1.<pool>.<pid>.jsonl`); run 2 repeats all four with `base-run2`.

```bash
cd .dsh-scratch/S4/base-e1
export S85_PROBE_LOG=/home/han001/dsh-work/slices/s9s85-S4/.dsh-scratch/S4/probes/e-render/logs/base-run1

timeout 900 npx vitest run --maxWorkers=2 \
  tests/app/S3-attention-context.test.ts \
  tests/business/S1-archive-flow.test.ts \
  tests/composition/WP2-wiring.test.ts \
  tests/contracts/A2-rework-contract-helpers.test.ts \
  tests/runtime/K3-16-proposal-input.test.ts \
  tests/runtime/K3-16-review-extremes-pure.test.ts \
  tests/runtime/K3-35-manifest-trim-pure.test.ts \
  tests/runtime/K3-35-workspace-baseline-prepare.test.ts \
  tests/runtime/K3-B3-cancellation-cancelled.test.ts \
  tests/runtime/K3-B3-runtime-fail-closed.test.ts

timeout 900 npx vitest run --maxWorkers=2 \
  tests/runtime/K3-merge-cancel-propagation.test.ts \
  tests/runtime/K3-review-input-pure.test.ts \
  tests/runtime/K3-review-preparation.test.ts \
  tests/runtime/K3-unknown-call-review-section.test.ts \
  tests/runtime/S1-archive-files-brief.test.ts \
  tests/runtime/S3-context-assembler.test.ts \
  tests/runtime/S4C2-assembly.test.ts \
  tests/runtime/WP1-context-assembly.test.ts \
  tests/scenarios/K3-42-unexpanded-r2.test.ts \
  tests/scenarios/S3-context-and-inputs.test.ts

timeout 900 npx vitest run --maxWorkers=2 \
  tests/scenarios/S3-query-graph.test.ts \
  tests/work-graph/K3-35-owner-manifest-trim.test.ts \
  tests/work-graph/R5b-initial-plan.test.ts \
  tests/work-graph/S3-role-profiles.test.ts \
  tests/work-graph/S4C2-memory-material.test.ts \
  tests/work-graph/S4C2-project-set-shared.test.ts \
  tests/work-graph/S4C2-read-counts.test.ts \
  tests/work-graph/S8A-L8-reminders-public.test.ts

timeout 900 npx vitest run --maxWorkers=2 tests/probes/planning-query.test.ts
```

Run 2 is identical with `S85_PROBE_LOG=.../logs/base-run2` (both runs were done on
the same `base-e1` copy; the per-probe counts matched exactly).

## Combine, counts, determinism, replay

```bash
cd .dsh-scratch/S4/probes/e-render
node combine.mjs logs base-run1 base-run1.jsonl
node combine.mjs logs base-run2 base-run2.jsonl
node probe-counts.mjs base-run1.jsonl --expect 'renderContext,renderAttentionChanges,fact.effectiveDuty,fact.rolePayload,fact.goalPayload,fact.taskPayload,fact.queryFocusLines,fact.queryPlanSummary,fact.notImplementedExtensions,fact.noteSourcesOf,fact.declarationsForTask,fact.missingInputReminder,fact.optionalRowsFromExtensions,fact.annotations,fact.topLevelModuleCards,note.generalWarningLabel'
node probe-counts.mjs base-run2.jsonl --expect 'renderContext,renderAttentionChanges,fact.effectiveDuty,fact.rolePayload,fact.goalPayload,fact.taskPayload,fact.queryFocusLines,fact.queryPlanSummary,fact.notImplementedExtensions,fact.noteSourcesOf,fact.declarationsForTask,fact.missingInputReminder,fact.optionalRowsFromExtensions,fact.annotations,fact.topLevelModuleCards,note.generalWarningLabel'
node compare-records.mjs base-run1.jsonl base-run2.jsonl --label base1-vs-base2 --report base-determinism.json
node determinism.mjs base-run1.jsonl base-run2.jsonl --report base-determinism-report.json
node replay.mjs ../../base-e1 base-run1.jsonl --out replayed-base-run1.jsonl --report replay-base-report.json --label base-e1
```

## Edge harness (twice)

```bash
cd .dsh-scratch/S4/base-e1
S85_EDGE_OUT=/home/han001/dsh-work/slices/s9s85-S4/.dsh-scratch/S4/probes/e-render/edge-base.jsonl \
S85_EDGE_LABEL=base-e1 timeout 900 npx vitest run --maxWorkers=2 tests/probes/edge.test.ts
S85_EDGE_OUT=/home/han001/dsh-work/slices/s9s85-S4/.dsh-scratch/S4/probes/e-render/edge-base2.jsonl \
S85_EDGE_LABEL=base-e1 timeout 900 npx vitest run --maxWorkers=2 tests/probes/edge.test.ts
cd /home/han001/dsh-work/slices/s9s85-S4/.dsh-scratch/S4/probes/e-render
cmp edge-base.jsonl edge-base2.jsonl
node compare-edge.mjs edge-base.jsonl edge-base2.jsonl --report edge-base-determinism.json
```

## Result copy (later, final commit)

```bash
S=.dsh-scratch/S4
git archive 39fee06 | tar -x -C $S/result-1
cp -al node_modules $S/result-1/node_modules
mkdir -p $S/result-1/vendor/coding-agent
cp -al vendor/coding-agent/node_modules $S/result-1/vendor/coding-agent/node_modules
node $S/probes/e-render/apply-probe-result.mjs $S/result-1 --check
node $S/probes/e-render/apply-probe-result.mjs $S/result-1
# repeat the four recording commands with cwd=$S/result-1 and S85_PROBE_LOG=.../logs/result-run1
cd $S/probes/e-render
node combine.mjs logs result-run1 result-run1.jsonl
node probe-counts.mjs result-run1.jsonl --expect 'renderContext,renderQueryContext,renderAttentionChanges,fact.effectiveDuty,fact.rolePayload,fact.goalPayload,fact.taskPayload,fact.queryFocusLines,fact.queryPlanSummary,fact.notImplementedExtensions,fact.noteSourcesOf,fact.declarationsForTask,fact.missingInputReminder,fact.optionalRowsFromExtensions,fact.annotations,fact.topLevelModuleCards,note.generalWarningLabel'
node replay.mjs ../../result-1 base-run1.jsonl --out replayed-result-run1.jsonl --report replay-result-report.json --label result-1
# edge twice on result-1, then:
node compare-edge.mjs edge-base.jsonl edge-result-1.jsonl --report edge-base-vs-result-1.json
```

The result installer's `--check` passed against the final commit `39fee06`; because it is anchor-asserting, run `--check` on a fresh archive before installing.
