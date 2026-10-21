# Q2-02 / Q1-02 — read points per call site (R2, 2026-10-22)

Counts are from `r2-base1` (`r2-base1.sites/*.jsonl`), 720 `deps` + 322 `kernel`
records; `r2-result` has the same counts on the mapped call sites. A call site is
identified by the first stack frame under `src/` (the site log is separate from
the compared payloads, so base and result line numbers never enter a comparison).

## A. Reached call sites

| base line (frame) | result file:line | method | calls base/result | how the site is told apart |
|---|---|---|---|---|
| `context-assembler.ts:989` (`:991`) | `context-workspace-facts.ts:46` | `workspaceHost.resolveRoot` | 23 / 23 | capture/facts entry (`briefWorkspaceFactsFor`) |
| `context-assembler.ts:1000` (`:1002`) | `context-workspace-facts.ts:57` | `workspaceSource.captureDigest` | 23 / 23 | same entry |
| `context-assembler.ts:1006` (`:1008`) | `context-workspace-facts.ts:63` | `workspaceSource.capture` | 23 / 23 | same entry |
| `context-assembler.ts:1061` (`:1063`) | `context-workspace-facts.ts:115` | `bodies.read` (capture changes) | 4 / 4 | via `workspace-baseline-artifact.ts:64` |
| `context-assembler.ts:1083` (`:1085`) | `context-workspace-facts.ts:137` | `workspaceHost.resolveRoot` | 2 / 2 | review-file entry (`unknownCallReviewFilesFor`) |
| `context-assembler.ts:1179` (owner; reads at `:1189`) | `context-history-facts.ts:81` (reads `:90`) | `kernelStores.byAdapterId` / `withStore` | 20 / 20 | `requeueSessionBasis` window loop |
| `context-assembler.ts:1238` (owner; reads `:1139` via `lastTerminalBoundary`) | `context-history-facts.ts:140` (reads `:40`) | `kernelStores.byAdapterId` / `withStore` | 24 / 24 | `reviewSessionBasis` |
| `context-assembler.ts:1279` + `:1358` (owner; reads `:1288`) | `context-history-facts.ts:181` (reads `:189`) | `kernelStores.byAdapterId` / `withStore` | 48+1 / 47+1 | `readKernelCommandFacts` window loop |
| `context-assembler.ts:1582` (owner; reads `:1600`, `continuation-brief-assembly.ts:425/:564`) | `context-continuation-recipe.ts:139` (reads `:155/:164`) | `kernelStores.byAdapterId` / `withStore` | 72 / 72 | `assembleBriefForContext` |
| `context-assembler.ts:1389` / `:1394` | `context-review-recipe.ts:65` / `:70` | `unknownCallReviews.readReview` | 24 / 24 | review round |
| `context-assembler.ts:1406` (`:1408`) | `context-review-recipe.ts:82` | `executions.readExecution` | 24 / 24 | review round |
| `context-assembler.ts:1508` (`:1520`) | `context-continuation-recipe.ts:65` (`:76`) | `commandRerunRequests.listRequests` | 8 / 8 | blocked-commands, paging |
| `context-assembler.ts:1568` (`:1575`) | `context-continuation-recipe.ts:125` (`:131`) | `executions.readContinuationBasis` | 72 / 72 | continuation |
| `context-assembler.ts:1612` | `context-continuation-recipe.ts:170` | `briefWorkspaceFactsFor` | 72 / 72 | continuation (direct probe also sees 17 test-level calls) |
| `context-assembler.ts:1619` | `context-continuation-recipe.ts:176` | `archiveOriginSkipsHistorySeed` | 72 / 72 | continuation |
| `context-assembler.ts:1643` | `context-continuation-recipe.ts:200` | `readTaskBlockedCommands` | 8 / 8 | continuation |
| `context-assembler.ts:1696` (`:1698`) | `context-work-recipe.ts:68` | `graphContext.readContextFacts` | 61 / 61 | work assembly, first read |
| `context-assembler.ts:1753` (`:1755`) | `context-work-recipe.ts:125` | `architectureReminders.read` | 10 / 10 | work assembly |
| `context-assembler.ts:1793` (`:1795`) | `context-work-recipe.ts:165` | `graphContext.readContextFacts` | 14 / 14 | upstream enrichment read |
| `context-assembler.ts:1823` (`:1825`) | `context-work-recipe.ts:195` | `taskInputs.readTaskInputPage` | 14 / 14 | work assembly |
| `context-assembler.ts:1981` (`:1983`) | `context-query-recipe.ts:53` | `graphContext.readContextFacts` | 6 / 6 | Query |
| `context-assembler.ts:2033` (`:2035`) | `context-assembler.ts:37` | `graphContext.readAttentionFacts` | 1 / 1 | `readAttentionGraph` |
| `context-assembler.ts:1768` (`:1770`) | `context-work-recipe.ts:140` | `now` | 10 / 10 | reminder formatting clock |
| `context-assembler.ts:975` (`:977`) | `context-workspace-facts.ts:32` | `now` | 72 / 72 | `briefWorkspaceFactsFor` |
| `session-operations.ts:960` / `:973` | same (unchanged) | `kernel.read` | 162 / 160 | head read / page read inside `readPositionWindow` |

The one extra `byAdapterId` (49 vs 48) is a call whose location is missing (it
returns before `withStore`); result has the same one missing-location call.

## B. Zero-call sites (side-by-side)

| site | base | result | why 0 |
|---|---|---|---|
| `unknownCallReviews.listReviews` | `:1503` in `readTaskBlockedCommands` | `context-continuation-recipe.ts:60` | every reached call passes `input.reviews`, so the paging read is skipped |
| `kernel.readTurnBounds` | `:1598`, `:1607` in `assembleBriefForContext` (owner at `continuation-brief-assembly.ts:564`) | `context-continuation-recipe.ts:155`, `:164` (owner unchanged at `:564`) | no reached test has a locator-only premise; the recorded reads are windows |
| baseline bundle `bodies.read` | `:1053` (`readRunStartBaseline`) | `context-workspace-facts.ts:106` | no test reaches a review file diff with a run-start bundle |
| baseline artifact `bodies.read` | `:1092` (`readRunStartBaseline` call) | `context-workspace-facts.ts:145` | same |
| `workspaceSource.readBaselineBlob` | `:1111` | `context-workspace-facts.ts:164` | same review-file diff path |
| `workspaceSource.readCurrentFile` | `:1112` | `context-workspace-facts.ts:165` | same |
| `kernelStores.forWorkspace` | owner entries `:1179`, `:1238`, `:1279`, `:1358` | `context-history-facts.ts:81`, `:140`, `:181`; `context-continuation-recipe.ts:139` | the owner only calls `byAdapterId`/`withStore` |
| `roles.resolveRoleBindingFacts`, `materials.storeArtifact`, `materials.openArtifact`, `plans`, `sessions` | type `:113–120` | `context-types.ts:33–39` | carried in the deps type, never read by the assembler |

Old/new code, verbatim:

- listReviews: base `const read = await readTaskReviews(ctx, reviews, { goalRef, taskId: input.task.taskId, workspace: input.workspace });` (result `context-continuation-recipe.ts:60`, same).
- readTurnBounds: base `const read = await readPreviousTurn(owner, candidate, …)` / `turn = await readPreviousTurn(owner, fallbackFacts, …)`; result `context-continuation-recipe.ts:155`/`:164` same; the owner's `owner.readTurnBounds({ session: record.session, kernelRunId: kernel.runId, signal })` is the same line `continuation-brief-assembly.ts:564` in both.
- baseline: base `return (await readWorkspaceBaselineFromBundle(bodies, bundleRef))?.baseline ?? null;` → result `context-workspace-facts.ts:106`, same; the helper's `reader.read(bundleRef)` (`workspace-baseline-artifact.ts:38`) and `reader.read(descriptor.ref)` (`:50`) are unchanged.
- review files: base `classifyReviewBytes(await source.readBaselineBlob(root, \`${baseline.headCommit}:${path}\`))` and `classifyReviewBytes(await source.readCurrentFile(root, path))` → result `context-workspace-facts.ts:164–165`, same.
- forWorkspace: base `createSessionHistoryCursorOwner({ kernelStores: deps.kernelStores, ...(deps.kernel === undefined ? {} : { kernel: deps.kernel }) })` → result `context-history-facts.ts:81`, `:140`, `:181`, `context-continuation-recipe.ts:139`, same expression; `session-operations.ts:900/903/1008/1013/1025/1040` never call `forWorkspace`.
- never-read members: base deps type `Pick<RuntimeExecutionDependencies, 'executions' | 'roles' | 'materials' | 'bodies'> & Partial<Pick<… 'plans' | 'sessions' …>>` → result `context-types.ts:33–39`, textually the same type; no production read of `roles`, `materials`, `plans` or `sessions` exists in either copy.

Note: S4's table row `commandRerunRequests.listRequests` (base `:1508`, `:1518`) is
no longer unreached — the widened 11 files reach it 8 times (all at `:1520`).
