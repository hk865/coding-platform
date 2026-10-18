## 1. Reuse map

**(a) Triggers.**
- **Workspace registered.** Commit: `src/core/work-graph/configuration/project-bootstrap-service.ts:617` function, `:699` `commitBootstrap`; success returns `:700–709`. Do **not** start there: the Host has not bound the root yet. The Host calls it at `src/app/host.ts:869`, then `:876` `addWorkspaceState` (root, revision, prefixes), so start after `:888`. Wrapper point: `src/composition/create-platform.ts:1100`.
- **Adoption / revision.** Adoption: `architecture/catalog-service.ts:461`, commit `:555–565`, non-replay return `:577–579`. Revision: `:598`, commit `:737–751`, return `:763–765`. Wrapper points: `create-platform.ts:1134–1135`.
- **PASS finalized.** `src/core/work-graph/evidence/evidence-service.ts:1461` `finalizeChecks`, commit `:1607`; `FinalizedChecks` carries `outcome/gaps/applicable` at `:1597–1599`. Trigger only `outcome==='PASS' && gaps.length===0 && !replayed`. Wrapper: `create-platform.ts:1213`.
- **Post-commit precedent.** `src/composition/commit-observer.ts:105–113` calls an observer after a real commit and swallows errors; wired at `src/app/host.ts:476–483`. `src/app/goal-fan-out-driver.ts:139–148` documents “the work runs after the commit returned”, implementation `:568–578`. `create-platform.ts:966–973` (`trackedCall`) drains detached work at close. Caveat: the notice keeps only `aggregateType/projectId` (`commit-observer.ts:56–71`), dropping `workspaceId`; the wrapper has the request/result and should carry it.
- **Exactly-once reuse.** Deterministic `meta.requestId` + fingerprint replay already exists in `architecture-service.ts:782–800`; use `auto-capture:<trigger>:<commitCursor>` so a duplicate trigger replays instead of capturing twice.

**(b) Failure record / retry.** A failed capture is visible only as the returned rejection (`architecture-service.ts:825–842`); success commits at `:957`, failure only releases the temporary capture in `finally` (`:966–968`). No failure record, event or attention item exists. Precedents: a persisted fact with lookup indexes — `SessionAnomalyAnchor` (`src/contracts/session-anomaly.ts:10,21`; indexes `tasks/session-anomaly-codecs.ts:392–396`), `TaskReworkRefusal` (`tasks/claim-record-codecs.ts:52,839,846`). Startup scan precedent: `src/app/startup-reconcile.ts:159` with candidate reads at `:224–366` (`ReconcileCandidateReader` `:71`). The L4/8C startup scan of PASS-finalized rounds does **not** exist in this tree. Host-local-only counterexample: `goal-fan-out-driver.ts:212,562–568`.

**(c) No catalog.** The service already accepts `mappings: []` (`architecture-service.ts:147–149`), builds an empty module snapshot (`:244–252`), and chooses it at `:846–850`. But no production caller uses it: the UI builder requires `current.adopted` and at least one module (`src/ui/views/setup/requests.ts:202–205`), and both buttons are disabled without adoption (`views/graphs/tabs.ts:84`, `views/setup/panels.ts:118`). No trigger exists.

**(d) Latest/previous observation.** The current pointer is written in the same commit (`architecture/contracts.ts:19–20,70–73`; `architecture-service.ts:943–959`). Each record has `observedAt` (`contracts.ts:61–64`). But there is **no list**: `OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.lookups` is `[]` (`architecture-record-codecs.ts:577–581`) and no read route (`src/app/core-routes.ts:350–356`). `previous` is caller-supplied (`architecture/contracts.ts:103–107`), and the v2 body keeps only change counts (`architecture-service.ts:860–868`), so the predecessor is unrecoverable. Nodes do carry `digest` (`src/contracts/architecture-inspection.ts:66–76`); full nodes are loaded at `architecture-service.ts:612–632`, but pages project it away (`:741–752`, `file-graph-index.ts:74–80`). Reusable digest compare: `src/core/workspace/workspace-read.ts:101–122` `diffContent`; `changeSet` `architecture-service.ts:516–529` only matches same paths.

**(e) Reminder kinds.** `formal-comparison.ts` computes `dependency_missing` `:168–181`, `import_undeclared` `:100–112`, `ungrouped` `:59–62`, plus `unresolved` `:80–87`, `ambiguous` `:63–74`, `cycle` `:116–120`; sorted `:183–192`. Missing: **move** (digest across paths) and the task-filtered **shared longest directory prefix**. `pathOwnershipOf` (`src/contracts/path-ownership.ts:36–63`) is containment only; A-03 needs `src/a/loose.ts` vs `src/a/core` → common `src/a`, so a new common-prefix helper is required. Task module: `src/contracts/plan.ts:17`; resolved at `context-assembler.ts:593–597`, printed at `:624`. A-03 also implies a move target is not repeated as `ungrouped` (`src/new.ts` is absent from the ungrouped row), which L8 does not state.

**(f) Assembler.** Reminder rows are built in `context-assembler.ts:658–687`, `:990–1000`, `:1024–1053`; rendered by `renderContext` `:210–320`. Rows sort by `key` (`:217`); the ellipsis precedent is `另有 N 条，用‘看’读` (`:238`, `:310`). There is **no 10-line section cap**; only the global `residentBudgetBytes` and per-section clipping. No relative-time formatter exists anywhere (only the clock at `:949`).

**(g) Manual capture.** Buttons `views/graphs/tabs.ts:84`, `views/setup/panels.ts:118`; action `views/setup/actions.ts:43`; request `views/setup/requests.ts:200–209`; route `src/app/core-routes.ts:352`, handler `:912`; result state `src/ui/state/apply-result.ts:63`; HTTP types `src/app/core-http-types.ts:304–305`.

## 2. Unclear (need a decision)

1. **Awaited or detached?** If awaited, `workspaces/register`, adoption/revision and PASS finalize block ~27 s and may fail; if detached, the caller sees the original success and the test needs a public drain/wait point. Options: detached + tracked + stored failure; awaited with timeout; queued worker.
2. **Failure record.** Stored record (new schema/lookup), a field on the current pointer, or Host-local note? Who reads it, when is it cleared, and how does “next Host start” survive restart? Host-local `reentryFailures` does not.
3. **Concurrent trigger.** Single-flight per workspace, queue, or drop? Today only the commit guard catches it (`architecture-service.ts:947–957`, `revision_conflict`), after two full captures.
4. **27 s / memory.** In-process capture at 2,000 files peaks near the heap limit (§10 evidence); several triggers could overlap. Serialize, cap, or run off-process?
5. **A-04 “各触发一次”.** Per non-replayed commit? Per trigger type per revision? Does a startup retry count? What if two triggers share a cursor?
6. **Previous observation.** Ordered by `observedAt` or commit order? Failed captures excluded? Is the pointer authoritative when observations arrive out of order?
7. **Move rule.** Unique digest in the new capture only, or in both (as `diffContent` requires)? Two deleted paths with one digest? Is the move target suppressed from `ungrouped` (A-03 implies yes)?
8. **Shared prefix.** Literal common directory segments, or containment? Minimum length? Does `src/loose.ts` + module `src/a/core` qualify via `src`? A `.` root?
9. **Reminder format.** Kind order and per-kind text are not fixed; where do 10-line and ellipsis apply, and what are the relative-time thresholds (“3 小时前”)?
10. **Task module source.** Which catalog read at preparation time, and what happens with no catalog? `ContextAssemblerDependencies` (`context-assembler.ts:73–76`) has no architecture reader.
11. **Auto-capture actor and pins.** `captureSourceChanges` requires a host principal/material reader (`architecture-service.ts:428–440`) and project+workspace pins (`:447–460`); the wrappers must construct both.

## 3. Spec differs from code

- §6:454 says `architecture-service.ts` has “自动抓的触发”; it has none.
- §6:454 names `project-bootstrap-service.ts`, `core-routes.ts`, `host.ts` as trigger points. The registration commit is `project-bootstrap-service.ts:699`, but the only safe start is `host.ts:876–888`; `core-routes.ts` is routing only.
- “设置页的手动按钮” is actually `views/graphs/tabs.ts:84` + `views/setup/panels.ts:118`, disabled without adoption — contrary to L8’s no-catalog capture.
- `views/context-extensions.ts` is `src/core/work-graph/views/context-extensions.ts`; it projects only anomalies/decisions/understanding (`:5–10,658`).
- L8’s “最多 10 行” has no counterpart; `renderContext` uses a byte budget and a global cap.
- Cited lines moved: `architecture-record-codecs.ts:265` is now the manifest, not root path (root path is `graph-index.ts:96`); `catalog-record-codecs.ts:263` is not root path (`requireDag` is `:271–272`); `capture.ts:207` is now git comparison (tolerant observation is `project-source-snapshot.ts:232`, `capture.ts:150/253`).
- `ObservedArchitecturePort` (`architecture/contracts.ts:103–133`) has no history/list read, only capture with caller-supplied `previous`.

## 4. Tests expected to break

- `tests/work-graph/R3d-observed-architecture.test.ts:80–92` counts `captureSourceChanges` calls — fails if a trigger is added inside the service/workspace tools.
- `tests/composition/R3d-R3g-platform.test.ts:212–219` expects current-pointer revision 2 and the second manual capture; any trigger on observation commits changes both.
- `tests/composition/R5a-project-bootstrap-platform.test.ts:112–120` sets `state.revision` only after registration; `tests/app/R6-host.test.ts:308,461,729` register before `addWorkspaceState` (`host.ts:876`). A registration trigger at the service wrapper fails or races.
- `tests/composition/A2-verification-chain-platform.test.ts:201` and other PASS tests would start a capture per PASS; with fake/no workspace roots they produce failures, and if awaited they add ~27 s/timeouts.
- `tests/app/R6-host.test.ts:281–284` uses `mappings: []`; a failure record on the new path would add records but the request itself stays valid.

## 5. Plan

| Part | Files (disjoint) | Est. |
|---|---|---|
| S1 history + failure record | `contracts/architecture-inspection.ts`, `architecture/contracts.ts`, `architecture-record-codecs.ts`, `architecture-service.ts`, new `observation-history.ts` | 5–6 h, 300–400 lines |
| S2 pure reminders | new `architecture/observation-reminders.ts` (reuse `formal-comparison.ts`, `workspace-read.ts:101`, `path-ownership.ts:36`), `contracts/architecture-inspection.ts` | 4 h, 200–250 |
| S3 triggers + retry | `composition/create-platform.ts`, `app/host.ts`, `app/startup-reconcile.ts` | 5–6 h, 200–300 |
| S4 assembler | `agent-runtime/context-assembler.ts`, `execution-preparation.ts`, `views/context-extensions.ts`, contracts | 4–5 h, 150–200 |
| S5 acceptance/old tests | `tests/composition/S8A-AE1-*`, new `tests/app/S8A-AE2-*`, `tests/work-graph/S8A-*` | 4–5 h, 300–450 test lines |

Production estimate: **850–1,100 lines** (±20%). Two days with S3 and S4 parallel after S1; about one day thereafter for S2/S5 and close-out. S1 and S2 must land before S3/S4 because both consume the history read.