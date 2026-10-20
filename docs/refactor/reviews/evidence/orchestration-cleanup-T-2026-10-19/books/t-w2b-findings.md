# T wave 2: frozen finding table, rework 1 (lead, frozen 2026-10-20 15:00)

Sources, each finding checked by the lead against the items, the book and the code:

- **[P]** the Claude pre-audit of the merged copy (`checks/w2-preaudit.json`, 40 confirmed, each with a skeptic);
- **[L]** the Claude ledger-cover check (`checks/w2-ledger-cover.json`, 15 confirmed);
- **[C]** the Codex audit, six parts (`codex2/t-w2a-T1a..T3b.out.md`; 会出错 15, 违规 47, 不整洁 8);
- **[FS]** the bubblewrap full suite on the merged copy (`checks/full-W2a.txt`: 766 files, 6 failed; 8 tests failed);
- **[S]** what segment a left: not started, partial, BLOCKED.

The ids in brackets point into those answers. Where two sources disagree, §5 says which way the lead ruled and why.
This table binds rework 1 of at most 3 (decision 81).

Copy: `~/dsh-work/slices/s9tb2M`. Tag `w2-merged` = `4807e64` (the three groups merged). The plan was: the lead
applies the rows marked **lead**, DSH the rest after 18:00. By the user's decision at 14:41, Claude subagents applied
the whole table instead; the result is tag `w2r1` (§6).

## 0. Rulings

- **R-1 to R-12** (`t-w1-findings.md` §0, `t-w1r1-findings.md` §0, `t-w1r2-findings.md` §0) still apply.
- **R-13 The note tools adapter (A7-1).** The A7 exemption for the adapter in `tests/runtime/S4C-note-tools.test.ts`
  covers the adapter's whole own contract: mapping, defaults, pass-through, the tool name, `effectClass`, metadata
  and the strict schema refusal (`:114`, `:215` are inside A7).
- **R-14 Timeouts.** No raised timeout, except where a row of this table allows one: then at most `120_000`, on that
  test only, with the measured time (from a run with `--maxWorkers=2`) in a comment and in the reply.
- **R-15 Shared helpers keep what they issued.** A change to a shared helper must not move the ids, positions or
  times other tests pin (W2b-01 is the example). After changing a helper, run every test file that imports it,
  directly or through another `tests/helpers` file (follow the imports; `grep -rln`).
- **R-16 Kernel history positions** are platform-issued (book §2 rule 4). A test compares them as returned: between
  public reads, or with the window the Runtime submitted. It never writes a position literal. Counts and lengths are
  literals with their working.
- **R-17 Merge targets** carry every source's spec-row id in the test name (book §2 rule 3).
- **R-18 Converted refusal rows (A6).** Inside `describe('rejects: …')`; one error per row; a public read before and
  after shows nothing changed. Applies to the rows this table names.
- **R-19 Service-layer rows run on memory and SQLite** (rule sheet v1, "Every row also"). The rows named here are
  parameterized over both; a "SQLite only" row says why (a Host restart).
- **R-20 BLOCKED in this table.** A sub-part a row sends to BLOCKED goes back to its `w2-base` form exactly, is named in
  the reply with its category (tamper-only, unreachable, missing entry point) and `file:line`, and its item is
  `partial`. Never work around it.
- **R-21 A4, the other direction.** A wrapper of the real backend factory that hands the test the platform's own real
  backend, unchanged, for a production reader under test is A4 (`tests/work-graph/S4C2-goal-triggers.test.ts:60-71`).
- **R-22 The store-page row of W2b-20 is a scale row** (added 2026-10-20 17:10, after rework 1 measured it). Its 205
  real blocked Runs take 65–69 s on memory and 162–168 s on SQLite with `--maxWorkers=2`; one shared Session is
  refused (`busy: the target Session health is unavailable`). Like the S2A scale tests (`S2A_SCALE_TIMEOUT_MS`), that
  one test may carry a timeout of at most `600_000`, with the measured times in a comment. It goes on the user's L-4
  list (test time).
- **Accepted DSH adaptations** (segment a, reply §5): T1-062 requirement kind `static` (public input); T2-051 the
  history page carries the Kernel `executionIdentity.runId`, taken from tA's public `readExecution`
  (`src/core/agent-runtime/execution-history-contracts.ts:23`); T1-025 the public `reviseArchitectureCatalog` step for
  revision 2; T2-037 the real `planRef`; T3-080 the `K3_35_TASK_ID` export stays; T2-040/T2-042 the edit of
  `tests/scenarios/K3-19-review-unavailable.test.ts` (the lead left it off the whitelist by mistake). **Not
  accepted:** T1-020 `round: 2` (W2b-05).
- **Stay as they are, for the user at the end of T:** T1-025 and T1-068 event sub-parts and T2-025 observer-down (no
  public event read, no observer seam); the default path of `tests/helpers/S5-decision-fixture.ts` (handwritten
  Session and entered, inherited by the K3 world; W2b-21 adds a real path beside it).

## 1. Group T1 files

| 编号 | 位置 | 条目 | 问题 | 改法 |
|---|---|---|---|---|
| W2b-01 [FS] 违规 · **lead** | `tests/helpers/task-claim-fixture.ts:369` | T1-003 | `createSession` now passes `requestId` to the real `createSession`; `w2-base` admitted with `admit-${requestId}`. Session ids, and the message ids built on them, moved: 2B-26 (both backends) in `S2B-activity-calendar-tasks`, F11 [sqlite] in `WP2-wiring`, M08 in `WP2-undelivered-notices` failed. | `meta: { requestId: \`admit-${requestId}\`, expected: [] }` (`createSession` admits with the request's own `meta`, `src/core/agent-runtime/session-operations.ts:592-603`). The three files pass (69/69). Run every importer (R-15). |
| W2b-02 [P T1b-03, L T1-L2-01, C T1b-04] 违规 · **lead** | `tests/work-graph/R4b-session-boundaries.test.ts:126-139` (`w2-base :74-93`) | none (T1-029/T1-030 do not name it) | The test 'does not disclose a workspace A operation or registration receipt to workspace B' was rewritten to `createSession(inB, workspace A)`, which `session-operations.ts:578-579` refuses first; the cross-workspace refusal `session-directory.ts:871-872` has no test left. | Put the test back exactly as at `w2-base :74-93`. |
| W2b-03 [C T1b-05, FS] 违规 · **lead** | `tests/work-graph/R4b-session-boundaries.test.ts:221-225` | T1-029 | Still creates 1000 filler Sessions; the item says the target query does not cross the scan bound (`session-directory.ts:1486-1501`) and no fillers are needed. Timed out at 30 s. | Delete the filler loop; keep the target Session, its link and the discovery assertions; name the test after the target query. |
| W2b-04 [P T1b-01, C T1b-01] 违规 | `tests/work-graph/A2-control-service.test.ts:329-335` | T1-003 | The cancelled branch lost the zero-commit check (`w2-base :340`) and the not-entered combination. | Put back the cancelled + not-entered sub-case of `w2-base :330-342`, with `countingCommits` (A3) and `commits() === 0`. Keep the new entered branch and wrap its refusal in `countingCommits` too (0). |
| W2b-05 [P T1a-03/T1b-08, C T1a-01/T1b-03] 违规 · **lead** | `tests/work-graph/K3-16-second-unfinished-proposal.test.ts:107-116`, `K3-16-proposal-round-fixture.test.ts` | T1-020 | The merge changed the source's `round: 1` to `round: 2` and reported done. The target path records a review round first, so the source's first-round case is a different path. | **Ruling: T1-020 is not merged; both tests stay.** Both files' T1-020 parts back to `w2-base` (source cases `:121-135` restored; the target's added `round: 2` and comment removed). Item result: not merged (W2b-05). |
| W2b-06 [P T1a-04] 违规 · **lead** | `tests/work-graph/goal-independent.test.ts:63-65` | T1-068 | Expected `workspaceRef` is `workspace.value.ref` (program output; not an issued value). | Literal `{ aggregateType: 'Workspace', projectId, workspaceId }` with a comment (the `registerWorkspace` input). Pins stay as returned. |
| W2b-07 [P T1a-05] 不整洁 · **lead** | `tests/helpers/W2-whiteboard-fixture.ts:46`, `:70-72` | T3-096 | `agentActorIdFor` has no caller; it is the only use of `sha256Hex`. | Delete both. |
| W2b-08 [P T1b-04, C T1b-07, FS] 违规 | `tests/work-graph/S2C-node-detail-anomalies.test.ts:86-91`, `:120-123`, `:151-153`; helpers `S2C-L-runs-support.ts:145-163`, `:211-219`, `:246-249`, `S2C-D-node-support.ts:300-305`, `:392-395`, `:433` | T1-040 | Still the handwritten Runtime/Host facts the book check rejected (entered, paused observation, `host_instance_takeover`, archive observation with a self-computed `subjectKey`, Kernel Session + `recordSessionCreated`): F3, reported done. 2C-28 (sqlite) timed out at 30 s. | As the refresh says: real pause, restart takeover, `sessions/archive-line` archive, requeue and continuation in another Session; the 101 anchors come from real archives, only the second page's read fails (injected). A step with no public entry: R-20. Then 2C-28 must pass in 30 s; if not, R-14 allows a timeout on that test. Other users of the two helpers: R-15. |
| W2b-09 [P T1b-05, L T1-L4-01/02, C T1b-08/09] 会出错 | `tests/work-graph/S4C2-goal-triggers.test.ts:77`, `:283-299`, `:336-346`, `:373-507` | T1-054 | 3a: `P1_AT = AT` and plan revision = reduction revision = 1, so a reader that takes `task_end`'s key or time from the Plan still passes. 3d: fixed clock, so archive, rework and plan times are all equal; the plan key and time are copied from the graph read. | 3a: adopt P1 at a literal time before `AT` (`adopt` takes `at`, `:217-219`); give the Plan a revision other than the reduction's (a second public adopt before the claim); if that cannot be done, say why. 3d: `createTriggerComposition` with `advancingClock: true` (`WP2-platform-support.ts:121-126`); assert the three `at` values differ pairwise and each equals the time read from its own source record (the rework's and the archive's requeue `requestedAt`, the Plan's `acceptedAt`) through a public read, used as returned; the plan key is a literal (`plan:p<n>`, n counted from the adopts). The `vi.mock` capture stays (R-21). |
| W2b-10 [P T1a-01/02, C T1a-03/05/11] 违规 | `tests/work-graph/A2-disposition-change.test.ts:349-396`, `:585-701`, `:171`, `:635`, `:707`, `:787`, `:812` | T3-106 | Guards 2 and 9 kept `seedRun`/`seedLease`/`humanStop` (F3) with false BLOCKED reasons; converted refusal rows not in `rejects:`; converted service rows memory only. | **Guard 2:** a real `outcome_unknown` (`startHeld('B')`, then `moveKernelAside` + restart, as `tests/scenarios/S2C-K-unknown-outcome.test.ts:45-50`, or the RUN-08 path of `tests/runtime/S2B-38-run08-unknown-activity.test.ts`). The Lease stays held (`run-machine.ts:2318-2320`); guard 2 (`plan-machine.ts:661`) runs before guard 4 (`:675-681`), so the expected refusal is unchanged and the row still fails without guard 2. **Guard 9:** `startHeld('B')`; in the racing commit wrapper (A3), on the plan-apply commit, submit a real cancel through `steps.controls.submitControl` with the publicly read revision; keep `revision_conflict`, `raced`, `activePlan` unchanged and `forbidden` after the re-read. Delete `seedRun`, `seedLease`, `humanStop` and their interface entries (`:161-166`, `:423`). Converted refusal rows: R-18, with a public unchanged read between the guard-9 refusal and the operator adoption. Converted service rows: R-19. A state no public step reaches: R-20 with the refusing check. |
| W2b-11 [P T1b-09, C T1a-07/08/09, T1b-13] 违规 · **lead** | `tests/work-graph/S2C-lines-tiers.test.ts:155`; `tests/scenarios/A7-control.test.ts:451`; `tests/work-graph/S5R2-queue-history.test.ts:127` | T1-037, T1-005, T1-056 | Merge targets lost the source ids. | R-17: add `2C-12 (9)`, `RUN-14`, `R2A08`. Names only. |
| W2b-12 [P T1b-10] 不整洁 · **lead** | `tests/work-graph/S4C2-project-set-shared.test.ts:162` | T1-055 | The `includeInputs: false` row is the query material but is named work material. | Name from the parameter. |
| W2b-13 [C T1a-10] 不整洁 · **lead** | `tests/work-graph/S4C2-D-rows.test.ts:110` | T1-052 | The D-06 title still says "and supersedes it" (now in `S4C2-D17.test.ts:53`). | Drop the phrase. |
| W2b-14 [C T1a-02] 会出错 | `tests/work-graph/S4C2-D-rows.test.ts:280` | T1-049 | Only the anchor was parameterized; the source's combination (file anchor, user `goalId: null`, pitfall on both sides; `w2-base tests/work-graph/S4C-note-protection.test.ts:21`, `:259`, `:262`) is gone. A wrong `pending_review` on that combination passes. | Parameterize the whole combination (anchor, user `goalId`, agent kind): the file row with `null`/pitfall, the Goal row as now; both backends. |
| W2b-15 [C T1b-06] 会出错 | `tests/work-graph/R4b-session-directory.test.ts:281` | T1-031 | The "no Session created" check is an empty list filtered by the wrong Task; `w2-base :272` read `plannedSessionRef` → `not_found`. An orphan Session would pass. | Observe the real admission's `plannedSessionRef` with an A3 delegating wrapper; after the refusal, read that Session publicly: `not_found`. |
| W2b-16 [C T1b-12] 违规 | `tests/work-graph/S4C2-U3.test.ts:29`; `tests/work-graph/R4b-session-directory.test.ts:267`, `:271` | T1-053, T1-031 | Converted refusal rows outside `rejects:`. | R-18. |
| W2b-17 [C T1b-10] 会出错 | `tests/work-graph/W1-future-plan.test.ts:523-525` | T1-062 | C's Reduction byte-unchanged assertion became a `TaskRow` comparison; `TaskRow` has no revision or `reducedAt` (`src/core/work-graph/model/plan-contracts.ts:89`). Book check ③ (`t-bk-T1.out.md:36`) and the refresh: byte/event assertions with no public equivalent stay, BLOCKED. | If a public read returns C's Reduction (revision, `reducedAt`, anchor, evidence ids), compare it before and after. Otherwise put back the `w2-base` byte assertions and their helper and apply R-20 (missing entry point). |
| W2b-18 [L T1-L3-01] 会出错 | `tests/record-store/lookup.test.ts:94`, `:174` | T1-034 | SV03 went as a duplicate, but its "lookup and index rebuild write nothing" assertions (`w2-base tests/work-graph/S1-codecs-indexes.test.ts:390-413`; spec SV03 states them) have no cover. | Record-store test, store ports allowed. At `:94` (both backends): `readMany` of the seeded rows is equal before and after the lookups (json, revision), and the lookup page's `readThrough` is unchanged. At `:174`: after the reopen and the lookup, `readMany([row.refKey])` returns the seeded json and revision. The lead writes the cover post-note. |

## 2. Group T2 files

| 编号 | 位置 | 条目 | 问题 | 改法 |
|---|---|---|---|---|
| W2b-19 [P T2b-01, L T2-L1-01..03] 违规 · **lead** | `tests/work-graph/UCR-settle-review.test.ts:160`, `:184`, `:209`, `:237`, `:295` | T1-061 | Five added `120_000` timeouts; every case runs in at most 8 s in the full suite. | Remove all five. |
| W2b-20 [P T2b-02, L T2-L3-01, C T2b-01/T2a-03/T2b-03, FS] 会出错 | `tests/work-graph/unknown-call-review-list.test.ts:166-252`; `tests/helpers/K3-35-runtime.ts:113`; `tests/helpers/B2-crr-world.ts:127` | T1-070 | The second Goal's records and both assertions on them were deleted though the sub-case was reported BLOCKED (`w2-base :88-127`); the cursor is rebuilt with the production `unknownCallReviewRefKey` (`:240-246`); 'more than a store page' timed out (both backends). | (a) **Ruling:** `K3-35-runtime.ts` gets a new optional authorization for a second Goal (default unchanged). Make the second Goal's records through real chains and restore the Goal-filter exclusion and the cross-Goal open assertions of `w2-base :88-127`, both backends. (b) Take the boundary `nextCursor` from a real wider page and pass it as returned. (c) The store-page test passes in 30 s, or R-14 allows a timeout on it. Where the chain creates a Session with `createS5Session` (`B2-crr-world.ts:127`), use W2b-21's real path. |
| W2b-21 [P T2a-04/T2b-03, C T2a-04/T2b-02] 未完成 | `tests/helpers/S5-decision-fixture.ts:615-627`, `:840-871` | T1-067, T1-023, T1-070 | The Session (`kernelStores…create` + `recordSessionCreated`) and the entered Run (chosen Kernel ids, positions 2/3, `recordExecutionEntered`) are still handwritten (F3) under tests reported done. | **Ruling:** add a new optional real path to the fixture: the Session from `createSessionOperations(...).createSession`, entered/ended through the shared real Runtime (`tests/helpers/S2B-runtime-steps-fixture.ts`). The default path stays (§0). Use it in F07 (`WP2-context-extensions.test.ts:269`), the budget test (`K3-48-2-unknown-call-review-model-text-budget.test.ts:192`) and W2b-20. R-15. |
| W2b-22 [C T2a-08/10/09] 违规 | `tests/work-graph/WP2-context-extensions.test.ts:90`, `:269`, `:415-455` | T1-067 | Expected row keys come from the production `decisionSourceKey` (`:435-446`); F07's anomalies come from `anomalyDouble`, a handwritten `ready` (F4; called at `src/core/work-graph/views/context-extensions.ts:225`); F07 runs on memory only. | Row keys as literals from the spec format with their working (proposal ids as returned). Wire F07's anomalies to the real SessionAnomaly reader of the same world (F07 only). F07 on both backends (R-19). |
| W2b-23 [P T2a-01/02, C T2a-05/06] 违规 | `tests/business/K3-review-workflow-rows.test.ts:728-757`, `:886-973` | T3-033 | (a) The settle_review row runs through `savedRunRuntime`, which ignores the request, and a cast start request (`:754-757`; v2 A1 forbids both). (b) About 20 expected fields are copied from `before.*`, `revision` is `before.revision + 1`; `toMatchObject` at `:967`, `:971`. | (a) After the real claim/end, advance a real `select_work` (`src/business/workflow/workflow.ts:1390`, UR4 `:1418`) and perform the settle_review it plans; no `savedRunRuntime`, no cast in this row; otherwise R-20. (b) Issued values (`ref`, `runRef`, `sessionRef`, `task`, `kernel`, `argumentsDigest`, `origin` proof and `hostInstanceId`, workspace capture digests, cursor) from public reads as returned; every other field (`schemaVersion`, `revision`, inventory, `inventoryProblem`, alias, `toolName`, `contained`, summary, times…) a literal with its working; owner result and `receipt.result` with `toEqual` on the whole object. |
| W2b-24 [P T2a-03, L T2-L1-04, C T2a-01] 违规 · **lead** | `tests/runtime/S4C-note-tools.test.ts:134-141`, `:158-166`, `:199-219` | T2-038 | The merged RW-14 compared whole requests with `toStrictEqual`; GTN02/03/06 use `toBe`/`toEqual`, which miss an extra key or a missing `undefined` key (`note-contracts.ts:181-182`). | `toStrictEqual` on the whole captured inputs; literals unchanged. |
| W2b-25 [P T2b-04] 违规 · **lead** | `tests/work-graph/K3-14-unknown-call-review-tool.test.ts:78-88` | T1-018 | Literal revisions 3/4/4 became `start + 1`/`start + 2` from a read. | Hand-count the commits on the real chain; assert `start` against that literal, then literal expectations with the working. A request's expected revision may stay as read. |
| W2b-26 [P T2b-05, C T2b-04/T2a-12, S] 未完成 | `tests/helpers/K3-review-card-fixture.ts:58`, `:336`; `tests/helpers/S2A-window-fixture.ts:48`; `tests/app/S5-decision-routes.test.ts:223`; `tests/helpers/executed-files-stub.ts` | T3-103 | The stub stays; the reply said the two helpers are off the whitelist, but `t-files-T2.txt:13-14` lists them. | Wire `createGoalExecutedFilesReader` (`{ records }` in the K3 card fixture, `{ records: inner }` in the S2A window fixture, and in the S5 routes test), registering `RUN_ACTIVITY_RECORD_SCHEMAS` and forwarding the real `lookupOrdered` (pattern `S5-decision-fixture.ts:471`, `:497`, `:515`). Then delete the stub. R-15. |
| W2b-27 [C T2b-05] 违规 | `tests/scenarios/K3-29-disposition-recovery.test.ts:95` (`:185`); `tests/scenarios/K3-44-recovery-answers.test.ts:180` (`:267`) | T2-040, T2-046 | `executeChecks` on in the process-sandbox stand-in (`tests/scenarios/support/process-sandbox-standin.ts:48`). Rule sheet v2 `:64-66` names these two as wave-2 instances outside A7. | Run the formal checks on the real ProcessSandbox (R-10); remove the stand-in's execute path from these two; keep the business assertions. If the stand-in's `executeChecks` path then has no user, delete it. |
| W2b-28 [C T2a-02] 会出错 · **lead** | `tests/business/K3-46-review-advance-failures.test.ts:545` | T3-031 | The merged source (`w2-base tests/business/K3-UR7-crr-failed-set.test.ts:544`) also refused `failedReviewRefs: []`. | Add `{ key: 'failedReviewRefs', value: [] }` with the same refusal and unchanged assertions. |
| W2b-29 [C T2a-07] 违规 | `tests/runtime/S3-graph-tools.test.ts:100`, `:456`, `:464-465`, `:490`, `:798`, `:801` | T2-036 | Expected digests and ArtifactRefs use `H = sha256Hex` (R-11). | Literals for the fixed bodies, with the input and steps in a comment; no `H` in an expectation. |
| W2b-30 [C T2a-09] 违规 | `tests/runtime/S3-graph-tools.test.ts:920` (GT07/08/09/13); `tests/runtime/S4C-note-run-task-resolver.test.ts:146`, `:263` (GTN20/21) | T2-035, T2-036, T2-037 | Converted rows fixed to SQLite (the `w2-base` rows ran on memory, `:858`). | R-19, with the A4 factory seam. |
| W2b-31 [C T2a-11] 违规 | `tests/runtime/S4C-note-run-task-resolver.test.ts:309`, `:322` | T2-037 | The refusal check only shows the Run ref still exists. | R-18: read the same execution publicly before and after and compare whole; keep the `not_found` check. |
| W2b-32 [L T2-L2-01] 会出错 · **lead** | `tests/scenarios/K3-45-review-incomplete-r2.test.ts:227-230` | T1-002 | K3-37 (三)'s "rounds still has one entry while round 2 is active" (`w2-base K3-37:379`) was not merged. | Add `rounds: [{ result: 'unfinished', round: 1 }]` to that read's `toMatchObject`. |
| W2b-33 [C T2b-06/T2a-14] 违规 · **lead** | `tests/runtime/B2-04-allowance.test.ts:39`; `tests/scenarios/K3-45-review-incomplete-r2.test.ts:119` | T2-019, T1-002 | Merge targets lost source ids. | R-17: add `B2-09b (owner part)`, `K3-37 (三)`. |
| W2b-34 [P T2b-06..09, C T2b-07/08, T2a-15/16] 不整洁 · **lead** | `K3-11-review-reasons.test.ts:22`; `K3-14-unknown-call-review-tool.test.ts:52-57`; `K3-29-recovery-round.test.ts:121-122`; `K3-r1-seams.test.ts:19`; `C6-unrelated-adoption.test.ts:11`, `:21`; `K3-18-one-card.test.ts:100`; `K3-11-review-reasons-r2.test.ts:108`; `K3-45-review-incomplete-r2.test.ts:117`; `tests/helpers/K3-35-continuation-fixture.ts:252` | T1-016, T1-017/018, T2-046, T2-048, T2-039, T2-042, T1-070 | Stale line refs and comments, a double blank line, a header number gap, a world opened before its cleanup is registered, a missing optional `goalRef` in an exported type. | Fix each as named. |
| W2b-35 [S] 未开始 | `tests/runtime/S3-context-assembler.test.ts:385`, `:647`, `:662`, `:855` | T2-034 | Not started in segment a. | Do the item as its correction says (real init → Runtime Session → claim → prepare → start, cancelled at the entry commit; no direct `authorizeRuntimeEntry`; CA04 through a real successor Plan adoption and a real note write; CA03 a delegating body-store counter, expected 1; CA15 a throwing real extension dependency). |

## 3. Group T3 files

| 编号 | 位置 | 条目 | 问题 | 改法 |
|---|---|---|---|---|
| W2b-36 [P T3a-01, C T3a-01] 会出错 · **lead** | `tests/app/A2-settings-automation.test.ts:114-144` | T3-004 | The merged source's "a stored 0/false survives another setting's save" (`w2-base :95-104`) became open + reopen with no write. | In the stored variant, before the save of 5: `models/save`, the file still holds 0/false, reopen, read back 0/false. |
| W2b-37 [P T3a-02] 违规 · **lead** | `tests/data/S8E-A23-ignored-databases.test.ts:22-37`, `:57-60`, `:73-90` | T3-065 | The new inputs went into the shared `baseEntries()`, changing two sibling tests; `:57-60` repeats `:52`. | `baseEntries()` back to `w2-base`; the two inputs only in the merge target; drop the duplicate. |
| W2b-38 [P T3a-03, L T3-L1-03, C T3a-04] 违规 | `tests/scenarios/C8-human-stop-respected.test.ts:456-462` | T3-027 | The merge kept a `toMatchObject` subset: no `reason: null`, no `next.taskId`, no `planRef.revision`, no exact `open_checks` input, no `complete_task` input (`w2-base tests/business/A2-workflow-auto-rework.test.ts:248-259`). | Add `reason: null` and `next.taskId`; compare `steps[0].next.operation` and its `request.input` with `toEqual`; find the `complete_task` step and assert its `request.input` equals `{ taskRef, planRef, roundRef }`, with `roundRef` from the publicly returned round. |
| W2b-39 [P T3a-04] 不整洁 · **lead** | `tests/app/A2-runtime-capabilities.test.ts:209-235`; `tests/helpers/runtime-capabilities-fixture.ts:40`, `:56`, `:65` | T3-002/003 | An unasked `settingsDirectory` moves the Host off its default location (`src/app/host.ts:327-328`), the item's basis. | Remove the argument, the temp directory and the optional parameter. |
| W2b-40 [P T3a-05/06, C T3a-14] 不整洁 · **lead** | `tests/runtime/K3-19-review-admission.test.ts:24-28`; `tests/helpers/R4-history-turn-support.ts:53`; `K-R-previous-turn-bounds.test.ts:27`; `tests/helpers/WP2-duties-fixture.ts:1-4` | T2-022, T2-025, T3-036, T3-101 | Comments point at deleted files or describe removed code. | Fix the comments. |
| W2b-41 [P T3b-01/02, L T3-L1-01/02, C T3b-02] 会出错 · **lead** | `tests/app/session-rendering.test.ts:406-445` | T3-006 | Half the R6 raw-record assertions were merged (`w2-base R6:358-361`: the reasoning text and `reasoningContent`); the "not open" check passes on an empty match. R6's unknown record type (`parse.ts:200`, `timeline.ts:275-277`) is not the same branch as the target's unknown event type. | Add the two `toContain` checks on `savedRaw`; add a `future.unknown` record and assert it in the html and its raw block. |
| W2b-42 [P T3b-03, C T3b-01/06] 会出错 | `tests/app/host-settings.test.ts:901-906` | T3-021 | The locked workspace has no command authorization **and** no saved Answer; only `rejected` is asserted, so removing the authorization check (`src/app/host-settings.ts:772-775`) still passes (`host.ts:979-989` answers `not_found`). The refusal rows are outside `rejects:` and use hand-built `answerRef`s. | Run a real Query in the locked scope (one more scripted `planAnswer` reply) and approve with the returned `answerRef`; assert `{ status: 'rejected', code: 'forbidden' }` and an unchanged settings snapshot. R-18 for both refusal rows. |
| W2b-43 [P T3b-04] 违规 · **lead** | `tests/composition/W1-future-plan-platform.test.ts:179-181`, `:209`, `:211` | T3-042 | `plan2Ref` became `plan2Applied.value.ref`; the `planId` is the test's own input. | The `w2-base :175` literal; assert the apply returns it. |
| W2b-44 [P T3b-06, L T3-L2-02, C T3b-04] 违规 | `tests/data/S8E-A08-skip-list.test.ts:36-42` | T3-064 | The correction asked for "all language issues empty"; `dist/z.ts` is a legal skipped issue (`typescript-source-query.ts:112`, `typescript-light-scan.ts:417-421`). DSH changed the assertion to three `not.toContain` checks, which miss `node_modules/x.ts` and `a/b/.venv/y.py`. | **Ruling:** the flattened language issues equal exactly one skipped issue for `dist/z.ts`, its reason a literal with its source line in a comment. Keep the input as is. `configOnly` empty: dropped (the item's reason). |
| W2b-45 [P T3b-08, C T3b-07/08] 不整洁 · **lead** | `tests/app/R6-workbench.test.ts:294-299`; `tests/runtime/R4c-kernel-history-range.test.ts:406` | T3-006, T2-033 | Names and comments describe removed parts. | Rename to what they check. |
| W2b-46 [L T3-L2-01, L T3-L2-03] 会出错 | `tests/data/S8E-A07-git-inventory.test.ts:32-75`, `:60-61` | T3-063 | The merge target has no tracked file outside the workspace and no repo-root `.gitignore` (`w2-base tests/data/S8D-observation-inventory.test.ts:132-149`); the comment at `:60-61` claims an unasserted fact. | In the parent variant, with real git: commit a file in the repo root outside the workspace, and a repo-root `.gitignore` that alone ignores a workspace path (for example `gen/` and `gen/x.ts`); the exact `page.nodes` shows neither. Fix the comment. If not doable, restore `w2-base :132-149`. |
| W2b-47 [C T3b-03] 会出错 | `tests/data/S8D-platform-fixture.test.ts` (deleted; `w2-base :29` on) | T3-067 | The deleted case's second capture asserted the new `h.py → g.py` edge and a Python file count of 3; the named covers (`S8E-A15-previous-observation.test.ts:42-51`, `S8D-A20-python-imports.test.ts:140-146`) check only nodes, inventory, or the first capture. | Restore the deleted case exactly. T3-067 for this case: not done. |
| W2b-48 [C T3b-05] 违规 | `tests/app/S2B-41-decision54-backfill-bound.test.ts:205` | T3-011 | `messages.readMessage` always returns a handwritten `not_found` (F4). | A real `createSessionMailbox` over the same world (`src/core/work-graph/communication/mailbox-service.ts:1045`); pass its read port. |
| W2b-49 [C T3b-06/T3a-09] 违规 | `tests/runtime/R4b-session-input-boundaries.test.ts:110-131`; `tests/runtime/R4c-execution-history.test.ts:199`, `:267`; `tests/runtime/R4b-session-recovery.test.ts:224` | T2-025, T2-030, T2-032 | The refreshes say "拒绝例按 A6 保留"; the converted refusal rows are not in A6 form. | R-18, with a public history read before and after. |
| W2b-50 [C T3a-02] 会出错 | `tests/work-graph/S8A-L8-observation-state.test.ts:395`, `:924` | T3-019 | The helper signals `entered` before the real read finishes, so the close aborts it and the owner returns `cancelled` (`architecture-service.ts:1475`): the late-`ready` case is not reached (`w2-base tests/app/S8A-L8-capture-start.test.ts:327` waited for the real result). | In the ready branch: await the real read and check `ready`, then signal `entered`, wait for the release, return the cached `ready`. |
| W2b-51 [C T3a-03] 违规 · **lead** | `tests/work-graph/S8A-L8-observation-state.test.ts:766` | T3-018 | The exact reason `injected start-state throw` (`w2-base tests/app/S8A-L8-capture-start.test.ts:258`, `:265`) was changed. | The no-old-observation variant injects and asserts the original string. |
| W2b-52 [C T3a-05] 违规 | `tests/runtime/R4c-execution-history.test.ts:68`, `:111`, `:157` | T2-025, T2-032 | `rawRecords` opens the Kernel store (F7) and derives positions and counts from it (F8). | Evidence from the public history read; counts literal with working; positions per R-16. |
| W2b-53 [C T3a-06/07/08] 违规 | `tests/runtime/R4c-execution-history.test.ts:127`, `:276`, `:400` | T2-025, T2-031, T2-032 | `:127` splices two executions' run/turn ids and expects `ready` (neither a returned identity nor an A6 refusal); `:276` a stand-in returns a handwritten `not_ready` and watermark cursor (F4; no public wait entry, `session-operations.ts:753`, `:767`, `session-directory.ts:1178`); `:400` rewrites a real returned page (F2). | Each of the three sub-parts: R-20. |
| W2b-54 [C T3a-10] 违规 | `tests/runtime/R4b-session-recovery.test.ts:100`, `:125`, `:147`, `:172` | T2-029 | `withStore`/`store.list` assert Kernel Session existence and count (F7); no public read shows unmapped Kernel Sessions (`session-directory.ts:1192`, `:1527`). | These sub-parts: R-20 (missing entry point). Do not reduce them to a `findSessions` count. |
| W2b-55 [C T3a-11/12] 违规 | `tests/composition/R3d-R3g-platform.test.ts:54`, `:126`, `:132`, `:165`, `:211` | T3-038 | Expected digest from a production function (`:54`, `:126`) and copied from the returned pin (`:132`, `:165`); the tail opens the database for the pointer revision, `readThrough`, `observedRef` and active records (F7; `observationState` lacks the first two, `src/contracts/architecture-observation.ts:53`). | Digest literal with its working (the returned pin only passed on); the database tail: R-20 (missing entry point). |
| W2b-56 [C T3a-13] 违规 | `tests/composition/A1-graph-session-platform.test.ts:99`, `:156`, `:202` | T3-035 | The whole `adopted.value` is the expectation (F8). | Write the expected baseline/catalog from the fixed adopt input (`:85` on); issued values as returned. |

## 4. Segment-a leftovers

| 编号 | 位置 | 条目 | 问题 | 改法 |
|---|---|---|---|---|
| W2b-57 [S] BLOCKED | `tests/work-graph/S2B-r2-r5-not-entered.test.ts`; `tests/work-graph/S2B-r2-keyed-cap.test.ts:61-77`; `src/core/work-graph/views/activity-read-helpers.ts:176-183` | T1-036 | T1-036's new `unavailable` branch is hit by `S2B-r2-r5-not-entered.test.ts:52-74`, which hand-builds an old-shape Run with no history and no dispatch claim; its own header (`:7`) says no production flow emits it. | **Ruling:** delete `S2B-r2-r5-not-entered.test.ts` (old shape, 79-1; `provenNotEnteredKernel` stays, an untested guard for the user). Then do T1-036 as its correction says (missing dispatch record throws `unavailable` with the ref key; delete the R7 case and the header lines). The one production change of this rework. |

## 5. Not adopted, and conflicts

- **B2 history positions** [P T1b-02, C T1b-02; L T1-L1-01 refuted]: positions are issued (R-16); the old 2/4/4 echoed
  the handwritten observation; `run-machine.ts:1754-1757` binds `endPosition` to the Kernel source; literal windows
  stay in `tests/state/run-machine.test.ts:830`, `:1678`. No action.
- **Guard 2 unreachable** [C T1a-04]: the guard order makes the real path valid (W2b-10).
- **T2-051 Kernel runId** [C T1a-06]: accepted adaptation (§0).
- **S3-host plan without an Answer** [C T1b-11]: `plans/propose`'s body is a public input (v2 A1); the 10-19 correction
  predates v2. No action.
- **`vi.mock` capture** [P T1b-06]: R-21.
- **T1-015 reply wording** [P T1b-11]: the code is right; only the reply's description was wrong. No action.
- **K3-19-review-unavailable off the whitelist** [C T2a-13]: §0.
- **The S5 fixture's default path** [C T2b-02/T2a-04, beyond W2b-21]: §0 (for the user).
- **T1-003 cancelled zero-commit** [L T1-L1-02 called it a duplicate]: adopted anyway (W2b-04): book §2 rule 2.
- **T1-062 bytes** [P T1b-07 refuted by its skeptic]: the book check ③ says otherwise; adopted (W2b-17).
- **T3-063 configOnly/configSkipped** [L T3-L2-03 refuted]: covered by `S8D-observation-inventory.test.ts:73-74`; only
  the comment (W2b-46).
- **Rejected by their skeptics, no action:** P T1a-06, P T3b-07.

## 6. Rework 1 result (`w2r1` = `722ddf3`)

**Who did it.** At 14:41 the user decided that Claude subagents apply the whole table now instead of DSH after 18:00
(a deviation from decisions 56/81 for this rework only; it goes into the T evidence). The **lead** marks above are
the first batch the lead planned to do itself; in the end the rows were done by Claude subagents (18 agents in three
workflows, 5 + 8 + 5, plus three single agents for W2b-36, W2b-09 and W2b-20; corrected 2026-10-20 from "31 agents
plus four single agents"), in the scratch copies `~/dsh-work/scratch/w2fix` and `w2fix2..6`, each row all or nothing.
The lead applied W2b-01 before the workflows, then reviewed every diff, applied W2b-12 and one agent's patch itself
(rows 37, 39, 40, 41, 43, 45, 51: the Edit hook refused that agent), committed per copy and merged: `9b5c10a` (w2fix), `3e8f580` (w2fix6), `ed47f57`
(w2fix2), `3317425` (w2fix3), `e94ad5d` (w2fix4), `3d05d71` (w2fix5), merges up to `722ddf3`; `s9tb2M` fast-forwarded,
tags `w2-merged` = `4807e64`, `w2r1` = `722ddf3`. Typecheck 0 errors, `check:architecture` OK. Ledger
`checks/ledger-W2R1.txt`: 88 lines and 2 deleted files, each mapped to a row below (renames by R-17, refusal rows moved
into `rejects:` by R-18, assertions replaced by stricter ones; no unplanned deletion).

| 编号 | 结果 | 备注 |
|---|---|---|
| W2b-01 | done | the three failing files pass; 150 of the 390 transitive importers ran green, the rest in the full suite |
| W2b-02 / 03 / 06 | done | 03 now 135 ms |
| W2b-04 | done | |
| W2b-05 | done | T1-020 not merged: both files equal to `w2-base` |
| W2b-07 | done | plus the now unused `SessionRef` import (lead) |
| W2b-08 | done | real pause (`pauseAtSafePoint`), restart (`restartAndReconcile`, production `reconcileRunAtStartup`), `sessions/archive-line`, `tasks/requeue`, continuation in another Session; 101 real archives; R-14 `120_000` on 'pages the index to the end' (measured SQLite 34–49 s, memory 11 s); `S2C-L-runs-support.ts` back to `w2-base` (its wave-2 additions had no user left) |
| W2b-09 | **partial** | 3a, 3c, 3d real; three times pairwise different; R-20 (missing entry point): the archive requeue's `requestedAt` has no public read (`src/composition/create-platform.ts:1263-1271`; `src/core/work-graph/views/task-state-timeline.ts:149`); the `w2-base` fake-records 3d case kept for it. **Revoked by rework 2 (R-24):** `queryTaskGraph`'s `TaskRow.rework.entries[].requestedAt` is a public read; W2c-01 |
| W2b-10 | done | guard 2: real `outcome_unknown` (held Run, Kernel moved aside, start-up reconcile), Lease held; guard 9: real cancel inside the A3 commit wrapper; seeds deleted; R-18; R-19. Left: the gate/only-carrier row (two refusals in one row) is not a wave-2 conversion |
| W2b-11 / 13 | done | names only |
| W2b-12 | done (lead) | `MATERIAL_READS` carries a third value `'work'`/`'query'` that only names the row |
| W2b-14 / 15 / 16 | done | 16: U3 stays memory only (R-18 row, not R-19) |
| W2b-17 | **partial** | R-20 (missing entry point): no public read returns C's TaskReduction (`plan-contracts.ts:89-125`; `goal-phase.ts:21-31` only after `completeGoal`); the `w2-base` byte comparison and `readJsons` back |
| W2b-18 | done | the SV03 cover post-note is still for the lead |
| W2b-19 | done | |
| W2b-20 | done (`03b9cfd`, after R-22) | NOT DONE in rework 1's workflows (store page 162–168 s on SQLite); ruling R-22; a new agent applied it on `w2r1` in the scratch copy `w2fix`: Goal A's records through the real chain (S5 public adopt, claim with `goalRef`, `createRealS5Session`), the boundary cursor from a real wider page as returned, the store-page test at `600_000` with the measured times |
| W2b-21 | done | optional `realRuntime` path + `createRealS5Session`; S2B steps option `decisionMessages`; K3-48-2 cwd bytes 457/376 → 422/341 (the real Kernel Session id is 35 bytes longer, working in the comment) |
| W2b-22 | done | |
| W2b-23 | done | R-6 notes: `origin` is `human_attested` (literal); `items[0].startedAt` (Kernel wall clock) and `workspace.detail` (no spec wording) as read |
| W2b-24 / 25 / 28 / 32 / 33 / 34 | done | 25: revision 2 counted by hand |
| W2b-26 | done | `executed-files-stub.ts` deleted; `docs/refactor/IMPLEMENTED-CAPABILITIES.md` still names it (docs at the end of T) |
| W2b-27 | done | the stand-in's execute path deleted; the check input is `'pass'` (`process.execPath` is outside the sandbox mounts); 27 importers keep a harmless `executeChecks: false` field |
| W2b-29 / 30 / 31 | done | |
| W2b-35 | done | CA rows on the memory platform only (spec §5.5 counts CA as 15 rows, not M/S) |
| W2b-36 | done | stored variant: `models/save`, file still 0/false, reopen; `models` expected as the saved model literal with its issued id |
| W2b-37 / 39 / 40 / 41 / 43 / 45 / 51 | done | the lead applied the agent's patch |
| W2b-38 / 44 / 46 / 48 / 56 | done | |
| W2b-42 | done | SQLite only, like its source rows. (Corrected by the lead in rework 2: the first reason, "the memory Host answers `unsupported` for settings", was wrong; a memory Host has settings once it gets a `settingsDirectory`, `src/app/host.ts:324-329`.) |
| W2b-47 | done | file restored; T3-067 for this case not done |
| W2b-49 / 50 / 52 | done | |
| W2b-53 | done (R-20 ×3) | T2-025, T2-031, T2-032 partial |
| W2b-54 | done (R-20) | no edit; T2-029 partial |
| W2b-55 | **partial** | digest literal done; database tail R-20 (missing entry point, `src/contracts/architecture-observation.ts:53`). **Narrowed by rework 2 (R-24):** the observed ref (`observationState`) and the missing active baseline (`readArchitectureRevision` current) have public reads; R-20 stays for the pointer revision and `readThrough`; W2c-05 |
| W2b-57 | done | the one production change: `activity-read-helpers.ts` `claimingSessionOf` throws `unavailable` with the ref key; `S2B-r2-r5-not-entered.test.ts` and the R7 case deleted |

Full suite on `w2r1`: `checks/full-W2R1.txt`: 765/766 files, 9,773 passed, 3 skipped, 3,017 s. The only failure is W2b-20's
store-page pair (memory and SQLite, 30 s timeout), which `03b9cfd` fixes (R-22).
