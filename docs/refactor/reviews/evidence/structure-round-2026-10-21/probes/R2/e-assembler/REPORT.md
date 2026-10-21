# S4/D3b byte proof — base vs result (assembler split)

Base `s85-n2-base` (`b35e077`), result `39fee06`; copies
`.dsh-scratch/S4/base-e2`, `.dsh-scratch/S4/result-e-assembler`.
No repository file was edited; both copies received the identical
`apply-probes.mjs`. 25 files, 217 tests per run, all pass. 613 records/run.

## Determinism edits (copy-only, book §5.0 rule 3)

Installed identically in both copies, only inside the copies:

- probe setup: counter `randomUUID`, test-file-derived `mkdtemp` suffix, fixed `GIT_*_DATE`;
- `vendor/coding-agent/dist/app/composition/composition-root.js:82`:
  `const now = '2026-10-21T00:00:00.000Z';`
- `vendor/coding-agent/dist/core/runtime/loop/runtime-runner.js`: `SystemClock.now()`
  returns `new Date('2026-10-21T00:00:00.000Z')`;
- `vendor/coding-agent/dist/sandbox/workspace/workspace-sandbox.js`:
  workspace identity `dev:ino` → `'1:1'`.

These vendor pins are **copy-only determinism edits for this proof, not part
of commit `39fee06`**; the repository's `vendor/.../dist` is untouched.

## Probe table (base vs result)

| probe | wraps (file:line) | base | result | diffs |
|---|---|---|---|---|
| assembler:task | `assembleTask` return, base `context-assembler.ts:1672`; result `context-work-recipe.ts` | 132 | 132 | **0** (result-only; full payload 11 = copy-root `skills.resourceRoot` in replay metadata `args` only) |
| assembler:query | `assembleQuery`, base `:1952`; result `context-query-recipe.ts` | 8 | 8 | **0** (full 1 = same metadata path) |
| assembler:attention | `readAttentionGraph`, base `:2029` | 1 | 1 | **0** |
| deps + clock | deps proxy in `createContextAssembler`, base `:1669`; result `:25–39` | 254 | 254 | names/order 254/254, args 254/254 identical; **23 outcomes** differ (see residual) |
| stored:task | `execution-preparation.ts:561,570` | 105 | 105 | **0** manifests/digests; 105/105 raw `body` equal |
| stored:task:put | same put request | 105 | 105 | **0** |
| stored:query | `query-preparation.ts:248,278,284` | 4 | 4 | **0** |
| stored:query:put | same | 4 | 4 | **0** |

## Base determinism (base-run1 vs base-run2)

| probe | calls | diffs |
|---|---|---|
| assembler:task / query / attention | 132 / 8 / 1 | **0 / 0 / 0** |
| stored:task / :put / query / :put | 105 / 105 / 4 / 4 | **0 / 0 / 0 / 0** |
| deps | 254 | **23** |

11/14 files raw-byte-equal; the 23 deps records differ in 6 leaf paths:
`entries[].body.text` (20) and `sourceDigest` / `requeue` digests derived from
it (6 values).

## Residual, not byte-proven (finding)

| field | source | records |
|---|---|---|
| Kernel history `entries[].body.text` `.payload.workspace.revision`/`.checksum` | the live Kernel SQLite DB inside the temporary workspace root is hashed; its bytes (pages/timestamps) change per run | 20 deps outcomes |
| `sourceDigest`, `requeue.basis.source.sourceDigest`, `.basis.digest` | derived from the same workspace revision | 6 values in 3+ records |

These are filesystem/DB-content values, not clock values: after both Kernel
clocks were pinned the clock-derived `startedAt`/`recordedAt` paths disappeared.
Declared "not byte-proven" under book §5.0 rule 3.

Replay (`run-replay.sh`, base-run1 args/deps/depsShape): 61 groups / 141 calls,
53 groups equal; the same 8 groups fail on both copies on mid-call
`AbortSignal` aborts and non-JSON brief values — a replay-harness limit.

## Zero-capture read points (base line; old → new)

| read point | base line | old | new |
|---|---|---|---|
| `roles.resolveRoleBindingFacts` | type 113–120 | carried, never read | `context-types.ts:33–39`, never read |
| `materials.storeArtifact` | type 113–120 | carried, never read | `context-types.ts:33–39`, never read |
| `materials.openArtifact` | type 113–120 | carried, never read | `context-types.ts:33–39`, never read |
| `plans` | type 115 | carried, never read | `context-types.ts:35`, never read |
| `sessions` | type 115 | carried, never read | `context-types.ts:35`, never read |
| `commandRerunRequests.listRequests` | `:1508`, `:1518` | `read = await requestsRead.listRequests(ctx, {…})` | `context-continuation-recipe.ts:64,75` (same) |
| `workspaceSource.readBaselineBlob` | `:1111` | `classifyReviewBytes(await source.readBaselineBlob(root, …))` | `context-workspace-facts.ts:164` (same) |
| `workspaceSource.readCurrentFile` | `:1112` | `classifyReviewBytes(await source.readCurrentFile(root, path))` | `context-workspace-facts.ts:165` (same) |
| `kernelStores.forWorkspace` | entry `:1179,1238,1279,1358` | `createSessionHistoryCursorOwner({kernelStores: deps.kernelStores,…})`; owner uses `byAdapterId`/`withStore` only | `context-history-facts.ts:80,139,180`; `context-continuation-recipe.ts:139` (same) |

Reached: `readExecution` 12, `readContinuationBasis` 16, `bodies.read` 4,
`readContextFacts` 35, `readAttentionFacts` 1, `readTaskInputPage` 4,
`architectureReminders.read` 10, `readReview` 12, `resolveRoot` 14,
`captureDigest` 12, `capture` 12, `byAdapterId` 48, `withStore` 48, `now` 26.

## Commands

```bash
S=.dsh-scratch/S4
git archive s85-n2-base | tar -x -C $S/base-e2
git archive 39fee06   | tar -x -C $S/result-e-assembler
cp -al node_modules {base-e2,result-e-assembler}/ ; cp -al vendor/coding-agent/node_modules {base-e2,result-e-assembler}/vendor/coding-agent/
cd $S/probes/e-assembler
node apply-probes.mjs ../../base-e2 && node apply-probes.mjs ../../result-e-assembler
./run-capture.sh ../../base-e2 base-run1 base-run1.log
./run-capture.sh ../../base-e2 base-run2 base-run2.log
./run-capture.sh ../../result-e-assembler result-run result.log
node compare.mjs base-run1 base-run2 --declared=declared.json
node compare.mjs base-run1 result-run --declared=declared.json
node compare.mjs base-run1 result-run --result-only --declared=declared.json
node read-points.mjs base-run1 declared.json
node field-diff.mjs base-run1 base-run2 ; node field-diff.mjs base-run1 result-run
./run-replay.sh ../../result-e-assembler base-run1 replay-result result-replay.log
node concat.mjs base-run1 base-run1.jsonl; node concat.mjs base-run2 base-run2.jsonl; node concat.mjs result-run result-run.jsonl
```

Artifacts: `base-run1.jsonl`, `base-run2.jsonl`, `result-run.jsonl` (613 each);
`base-vs-base.txt`, `base-vs-result.txt`, `base-vs-result-resultonly.txt`,
`fields-base12.txt`, `fields-baseresult.txt`, `deps-order.txt`,
`stored-diff.txt`, `read-points.txt`, `coverage.txt`, `replay-result/`, logs.
