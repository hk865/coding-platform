# R2 exact commands (all inside this copy)

`S=.dsh-scratch/R2`; repository HEAD = `239395d` (comment-only fix on `39fee06`);
base = tag `s85-n2-base`.

## Copies and probes

```bash
S=.dsh-scratch/R2
mkdir -p $S/base-a $S/result-a $S/probes
git -c core.autocrlf=false archive s85-n2-base | tar -x -C $S/base-a
git -c core.autocrlf=false archive HEAD | tar -x -C $S/result-a
cp -al node_modules $S/base-a/node_modules; cp -al node_modules $S/result-a/node_modules
cp -al vendor/coding-agent/node_modules $S/base-a/vendor/coding-agent/node_modules
cp -al vendor/coding-agent/node_modules $S/result-a/vendor/coding-agent/node_modules
cp -a .dsh-ref/s85-probes-S4/e-assembler $S/probes/e-assembler
cp -a .dsh-ref/s85-probes-S4/e-render $S/probes/e-render
cd $S/probes/e-assembler
node apply-probes.mjs ../../base-a
node apply-probes.mjs ../../result-a
```

`apply-probes.mjs` (R2 version) installs the Q1-01 probe-hook extension, the
Q2-02 site log and the copy-only determinism edits (seeded ids/clock, vendor
clock/identity, metadata size/mtime/ctime pinned in both workspace-sandbox
hashes, SQLite `-shm/-wal/-journal` sidecars excluded from the candidate source
digest). It has no `--check`.

## Assembler capture (28 = 25 + 11 files, 6 batches)

```bash
cd .dsh-scratch/R2/probes/e-assembler
./run-capture.sh ../../base-a r2-base1 r2-base1.log
./run-capture.sh ../../base-a r2-base2 r2-base2.log
./run-capture.sh ../../result-a r2-result r2-result.log
node concat.mjs r2-base1 r2-base1.jsonl
node concat.mjs r2-base2 r2-base2.jsonl
node concat.mjs r2-result r2-result.jsonl
node compare.mjs r2-base1 r2-base2 --declared=declared.json > r2-base-vs-base.txt
node compare.mjs r2-base1 r2-result --declared=declared.json > r2-base-vs-result.txt
node compare.mjs r2-base1 r2-result --result-only --declared=declared.json > r2-base-vs-result-resultonly.txt
node call-sites.mjs r2-base1.sites base > call-sites-base.txt
node call-sites.mjs r2-result.sites result > call-sites-result.txt
```

`run-capture.sh` exports the fixed `GIT_*` environment and
`S85_PROBE_SITE_DIR=$out.sites`; every batch is
`timeout 900 npx vitest run --maxWorkers=2 <≤10 files>`.

## inner-diff (lead's script)

```bash
node ./.dsh-ref/inner-diff.mjs $S/probes/e-assembler/r2-base1 $S/probes/e-assembler/r2-base2 > $S/probes/e-assembler/inner-base12.txt
node ./.dsh-ref/inner-diff.mjs $S/probes/e-assembler/r2-base1 $S/probes/e-assembler/r2-result > $S/probes/e-assembler/inner-baseresult.txt
```

## e-render (edge matrix + replay)

```bash
S=.dsh-scratch/R2
mkdir -p $S/base-e $S/result-e
git -c core.autocrlf=false archive s85-n2-base | tar -x -C $S/base-e
git -c core.autocrlf=false archive HEAD | tar -x -C $S/result-e
cp -al node_modules $S/base-e/node_modules; cp -al node_modules $S/result-e/node_modules
cp -al vendor/coding-agent/node_modules $S/base-e/vendor/coding-agent/node_modules
cp -al vendor/coding-agent/node_modules $S/result-e/vendor/coding-agent/node_modules
cd $S/probes/e-render
node apply-probe-base.mjs ../../base-e --check && node apply-probe-base.mjs ../../base-e
node apply-probe-result.mjs ../../result-e --check && node apply-probe-result.mjs ../../result-e

cd ../../base-e
R=/home/han001/dsh-work/slices/s9s85r2/.dsh-scratch/R2/probes/e-render
S85_EDGE_OUT=$R/edge-base.jsonl S85_EDGE_LABEL=base-e timeout 900 npx vitest run --maxWorkers=2 tests/probes/edge.test.ts
S85_EDGE_OUT=$R/edge-base2.jsonl S85_EDGE_LABEL=base-e timeout 900 npx vitest run --maxWorkers=2 tests/probes/edge.test.ts
cd ../../result-e
S85_EDGE_OUT=$R/edge-result.jsonl S85_EDGE_LABEL=result-e timeout 900 npx vitest run --maxWorkers=2 tests/probes/edge.test.ts
cd $R
cmp edge-base.jsonl edge-base2.jsonl
node compare-edge.mjs edge-base.jsonl edge-base2.jsonl --report edge-base-determinism.json
node compare-edge.mjs edge-base.jsonl edge-result.jsonl --report edge-base-vs-result.json
node sample-revive.mjs > sample-revive.txt
node replay.mjs ../../base-e ./.dsh-ref/s85-probes-S4/e-render/base-run1.jsonl --out replayed-r2-base.jsonl --report replay-r2-base-report.json --label r2-base
node replay.mjs ../../result-e ./.dsh-ref/s85-probes-S4/e-render/base-run1.jsonl --out replayed-r2-result.jsonl --report replay-r2-result-report.json --label r2-result
cmp replayed-r2-base.jsonl replayed-r2-result.jsonl
```

## Repository checks (one at a time)

```bash
npm run typecheck
npm run check:architecture
npm run build
export GIT_AUTHOR_NAME='S85 probe' GIT_AUTHOR_EMAIL='s85-probe@example.invalid' \
  GIT_COMMITTER_NAME='S85 probe' GIT_COMMITTER_EMAIL='s85-probe@example.invalid' \
  GIT_AUTHOR_DATE='2026-01-01T00:00:00 +0000' GIT_COMMITTER_DATE='2026-01-01T00:00:00 +0000'
timeout 900 npx vitest run --maxWorkers=2 tests/runtime/S3-context-assembler.test.ts \
  tests/runtime/K3-review-preparation.test.ts tests/runtime/K3-merge-cancel-propagation.test.ts \
  tests/runtime/S4C2-assembly.test.ts tests/architecture
```
