# T wave 1: frozen finding table, rework 2 (lead, frozen 2026-10-20 02:30)

Source: the Codex audit of rework 1 (`w1-merged..ed26c44`, two groups: `codex2/t-r1-R1.out.md`, `t-r1-R2.out.md`;
会出错 1, 违规 7, 不整洁 6). The lead checked each against the rework-1 table and the code; all fourteen stand. The
Codex ids in brackets point into those answers. This table binds rework 2 (decision 81: the second of at most three).

Copy: `~/dsh-work/slices/s9tbW1`, HEAD `ed26c44` (tag `w1r1` = this commit; `w1-merged` = 5daea2e). The rework-1
table `t-w1-findings.md` still holds every row's original text; a row below that names a W1 or B row adds to it.

## 0. Rulings

- **R-1 to R-6** from `t-w1-findings.md` §0 still apply.
- **R-7 The shared real Runtime.** `tests/helpers/S2B-runtime-steps-fixture.ts` (real prepare; start with a scripted
  model on a supported provider; an A3 gate that holds the model request; finish) is how a test reaches an entered,
  running or ended Run. C1 uses it since rework 1 (`tests/helpers/C1-mailbox-fixture.ts:141-152`).
  - "This fixture has no Runtime wired" is not a BLOCKED reason any more.
  - A BLOCKED now needs the `file:line` of the check that refuses the state, or of the entry point that is missing.
- **R-8 Values the Runtime issues.** Kernel identity, positions, message ids and the like are taken from a public read
  after the real step (for example `readExecution`), as returned. A test never binds its own value in their place
  (rule sheet v2, A1 "Values the platform issues").
- **R-9 BLOCKED form.** A part that stays BLOCKED keeps its form at `ed26c44`, unless its row says otherwise.

## 1. Findings from the rework-1 audit

| 编号 | 位置 | 行 | 问题 | 改法 |
|---|---|---|---|---|
| W2-01 [R1-01] 会出错 | `tests/runtime/source-binding-migration.test.ts:179` | B-04 | Lost cover: base opened the access while the Run ran, ended the Run, then read with the same access and got `forbidden` (base `:150`, `:158`). Now the factory is first called after the end, so a wrong cache of the first grant would pass. Per-request check: `src/core/agent-runtime/source-capture-access.ts:169`; first-open check `:324`. | Real start (R-7) held by the A3 gate in running; open the access; release the gate and wait for the real end; read the same file with the same access; keep the `forbidden` assertion and both backends. |
| W2-02 [R1-02] 违规 | `tests/composition/platform.test.ts:102-105` | W1-12 | The A6 row has no public prior state (no Goal, no candidate Plan), and its "valid" request lacks the GraphWrite `meta`/`input`, so more than the kind is wrong. Request shape: `src/business/workflow/workflow.ts:849`. | Create a Goal and a candidate Plan publicly; build a complete valid `{meta, input}` request and change only the kind; a public read shows `ready` before; compare it after. Keep `unsupported` and both backends. |
| W2-03 [R1-03] 不整洁 | `tests/helpers/S2B-track-fixture.ts:28-33` | W1-36 | After the W1-15 revert, eight names are imported and unused: `JsonValue`, `continuationBriefDigest`, `renderContinuationBriefZh`, `assembleAnomalySection`, `assembleContinuationBrief`, `PreparedQueryManifestV1`, `PreparedTaskManifestV1`, `QUERY_MANIFEST_CONTENT_TYPE`. | Delete those eight import names only. |
| W2-04 [R1-04] 不整洁 | `tests/helpers/S2B-track-fixture.ts:23` | W1-37 | The new comment says nothing here writes a business fact, but `:352` hand-builds entered/history and `:387` a terminal observation. | Words only: the real prepare is wired; entered and end are still handwritten because W1-15 is BLOCKED. |
| W2-05 [R1-05] 不整洁 | `tests/helpers/S5-decision-fixture.ts:266` | W1-37 | Still says the default uses a trusted baseline checkpoint; both paths call the public `adoptInitialArchitecture` (`:580`, `:582`). | Words only: the default publicly adopts an empty module catalog; `modules` publicly adopts M/N. |
| W2-06 [R1-06] 不整洁 | `tests/runtime/source-binding-migration.test.ts:195` | B-04 | After the digest sub-case went (R-3), the title still says it rechecks the accepted ReviewWork; the body checks only that candidate source reads and `dist` is refused (`:208-216`). | Title: `limits a bound Reviewer to candidate source`. Do not restore the deleted sub-case. |
| W2-07 [R2-01] 违规 | `tests/work-graph/R4c-execution-history-index.test.ts:649-668` | B-08(d) | The occupied-slot row is in `rejects:`, but its prior state still comes from `write()` with a hand-built Kernel identity and positions (`:192`, `:301`, `:313`), and "nothing changed" is read through `records.readMany` and the internal `readRun()` (`:155`). | First Run: real prepare, start and finish (R-7), which gives its locator. Publicly claim a second Task in the same Session. Only the refused request carries the first Run's real identity (R-8). Compare `readExecution` of the second Run before and after. Keep `busy` and the zero-change assertion. |
| W2-08 [R2-02] 违规 | `tests/work-graph/R4c-execution-read.test.ts:221-234` | B-09 | The "public chain" calls `enter`/`end`/`retire` from `tests/helpers/S1-archive-service-fixture.ts`, which hand-builds the Kernel identity (`:185`), the entered fact (`:191`), the terminal event (`:205`) and the probe verdict `{verdict:'missing'}` (`:289`). | Real start and a failed end (R-7); keep the public requeue and claim; the Host probe (`src/core/work-graph/sessions/session-health.ts:121`) gives its result from a real step; then archive. Keep the Session and Lease assertions. R-5 per step: a step no public path reaches is BLOCKED with its `file:line`, and the row is reported partial, not done. |
| W2-09 [R2-03] 违规 | `tests/work-graph/S3-prepared-context-admission.test.ts:593-596` | W1-09 | AD03's refusal shows only `commitCount`; A6 needs a public read showing nothing changed. | Read the Runs involved with the public execution read before and after the conflicting call and compare. Keep `idempotency_conflict` and the zero-commit assertion. |
| W2-10 [R2-04] 违规 | `tests/work-graph/S3-prepared-context-admission.test.ts:481`, `:488-520`, `:625` | W1-26 AD06 | AD06 moved from the wave-1 real `prepare` to the new `basePrepare`, which rebuilds the `CHANGED` binding, manifest and envelope. The lead had accepted AD06 as BLOCKED in its wave-1 form; only AD08 got the base path. | Convert AD06 as W1-26 ruled, now with R-7: a real unentered failure, then Host reconcile to `revoked` (`src/core/agent-runtime/run-reconcile.ts:320-322`, `src/app/startup-reconcile.ts:330`); the changed binding is the one refused input in `rejects:` (A6); keep `invalid` and the unchanged-binding (RUN-03) assertion. If a step is unreachable (`file:line`), AD06 is BLOCKED and keeps the base path, as AD08 does (its wave-1 form is red: `checks/full-W1.txt`). Fix the `:481` comment either way. |
| W2-11 [R2-05] 违规 | `tests/work-graph/S5-request-candidates.test.ts:282` | W1-28 | Q1's head being unchanged does not show that the new proposal holds no claim: `src/core/work-graph/tasks/plan-readers.ts:579-602` reads only the proposal index and records, and `:598` skips `requestRef=null`. A proposal that wrongly took a claim would still pass. | Find a public read that shows the claim is absent. If none does, put the base no-claim assertion and its snapshot back (base `:286`) and list it BLOCKED (R-5). |
| W2-12 [R2-06] 违规 | `tests/work-graph/S5-request-candidates.test.ts:277` | W1-28 | The base `allocationCounts` check (saved `:277`, compared `:285`) was deleted. It counts `newId`/`now`/`bodyPut` calls (`tests/helpers/S5-decision-fixture.ts:211-224`); it is not an F7 store read, and no row asked to remove it. | Put back the snapshot before `readPlanProposal` and `toEqual(allocations)` after. |
| W2-13 [R2-07] 不整洁 | `tests/work-graph/S2B-r2-s-preentry-control.test.ts:9` | W1-16 | The comment says the fold file keeps the old case as a supplement; rework 1 deleted that case. | Delete those two comment lines. |
| W2-14 [R2-08] 不整洁 | the reply, B-11 | B-11 | The named cover `tests/state/plan-machine.test.ts:670-672` hands in a ready-made `unsupported` delta; nothing runs the physical-removal check `src/core/work-graph/tasks/plan-validation.ts:337-338`. | Reply only: B-11's deletion stands (R-4); the check has no direct test, and the lead adds it to L-2. No test change. |

## 2. BLOCKED parts reopened

The audit named a public path for each (R-7 makes them reachable). Each row's original text is in `t-w1-findings.md`;
R-5 applies per part, with the R-7 standard of evidence.

| 编号 | 行 | 改法 |
|---|---|---|
| W2-15 | W1-25 | As W1-25 says: the upstream Run with the real Session, claim, prepare and start, ended through the scripted model (R-7, `tests/helpers/S2B-runtime-steps-fixture.ts:317`, `:345`, `:369`); the Session created publicly; the Workspace taken to @7 by public steps; delete the raw Run, the Host fact and the @5 seed. |
| W2-16 | W1-21 | As W1-21 says: two segments of one Task. The public cancel, requeue and second claim already exist (`tests/work-graph/R4c-task-claim-concurrency.test.ts:109`, `:137`, `:146`); the second Session takes continuation provenance (`src/core/work-graph/sessions/session-directory.ts:710`). Put back the three assertions. |
| W2-17 | B-08(a) | The second Run is prepared and started for real (R-7); its identity and positions come from `readExecution` (R-8). The direct, evidence and mutation assertions already use variables (`tests/runtime/R4c-graph-history.test.ts:400`, `:555`, `:733`). Where the frozen upper bound needs the Run held, use the A3 gate. The late-lower-end sub-case: see §3. |
| W2-18 | B-12 | The three Run seeds (`tests/work-graph/S3-context-inputs.test.ts:466`): public claim, then R-7 start and finish as each needs. IN14 (`:479`, `:778`): real send and reply on an entered Run (`src/core/work-graph/communication/mailbox-service.ts:750`, `:1329`, `:1361`, `:1369-1382`); the message id is the one the owner derives from the request id, written as a literal you derive by hand. |
| W2-19 | B-13 | IN11: a completed Run from the R-7 finish, then the real open, begin, result and finalize, as B-13 says (expected revision and report type worked out by hand, the working in a comment). |

## 3. B-14 rulings

Codex checked each part against the code (`./.dsh-ref/t-r1-B14.out.md`; the evidence lines are there, `rg -n` the item id, never read it whole).
The items' text is in `t-items-TP.md`.

| 编号 | 条目 | 裁定与改法 |
|---|---|---|
| W2-20 | TP-072, TP-091 (`tests/app/S2B-r2-backfill-done-cursor.test.ts:44-112`, `tests/helpers/S2B-activity-fixture.ts:316-336`, `:557`) | **Convert.** R-6 correction to TP-072's 书面核对改正: a real end always carries its activity fact in the same commit (`src/core/agent-runtime/execution-observation.ts:775`, `src/core/work-graph/tasks/execution-entry-service.ts:1916-1942`), so a backfill candidate is a Run whose activity was recorded as retryable `unknown`, not a Run with no record. Chain: a public plan with at least 103 work Tasks, each claimed publicly (`S2B-activity-fixture.ts:369-462`); R-7 prepare and start; inside the model gate, `observeRun` on the same Runtime; then release and finish, with one A2 read failure injected only at the end's whole-history activity re-read (`execution-observation.ts:472-476`), which gives `unknown(history_read_failed)` while the Run still ends. Restore reads, backfill the middle 101 for real, then make the two end candidates. The backfill under test uses the real `countRunActivity` (`src/core/agent-runtime/runtime.ts:690`, `src/business/workflow/activity-backfill.ts:162-182`) with the same end-time order, `readRecordCap: 3` and `batchRuns: 1`. Every paging and counted assertion stays. `seedLegacyActivity`, `writeActivity` and the fixed counter stop being used by R9 (delete them if nothing else uses them). **Time guard:** if the file then needs more than its current test timeout, do not raise it: mark the row BLOCKED with the measured time. |
| W2-21 | TP-099 (`tests/helpers/S5-decision-fixture.ts:555-598`) | **Convert, keeping every revision the importers assert** (107 importers assert Goals @7 to @9 and Workspace@3). Project@1 from `createProject`; Workspace@3 from its registration plus a public `setLinePins` that adds and then removes one real Session; the three Goals created publicly, reordered A, B, C, then given their settings through the public settings operation until each is at pre-adoption @6 (`pausedB`: B one fewer, then the existing pause). Each extra step is a real public settings change; say in a comment why the count is what it is. **R-4:** a persisted but empty `decisionSettings.noticeSeen` is unreachable (`src/core/work-graph/state/notice-settings-machine.ts:56-62`); in `tests/app/S5-decision-routes.test.ts:246` drop only the `decisionSettings` part of the precondition and keep `revision: 3`. The refusal and its unchanged-Workspace assertions (`:251-256`) stay. |
| W2-22 | TP-124 | **Keep BLOCKED.** A real start refuses the `requeue_task` tool before any model call (`src/core/agent-runtime/execution-driver.ts:239-243`); production has no Runtime tool entry for the Agent requeue owner (GAP-46). The lead adds it to L-3. No change. |
| W2-23 | TP-146 (`tests/work-graph/B2-execution-entry.test.ts:171-184`) | **Convert, as an A6 row.** Claim A; R-7 prepare, start and finish, so A really holds its Kernel slot. Claim B in the same Session; real prepare and start, held by an A3 gate just before B's real `beginRuntimeEntry` (`src/core/agent-runtime/execution-driver.ts:885-910`); keep B's real permit and latest pin. The one refused input: that begin with A's real identity (R-8). Keep `rejected` and the public `readExecution` before/after equality; then release the gate and let B's real begin go on. |
| W2-24 | TP-163 (`tests/work-graph/S3-graph-context.test.ts:351-752`, the GR world) | **Convert.** Two R-6 corrections: runB need not stay running (the work-run graph read checks only identity and scope, `src/core/work-graph/views/graph-context-reader.ts:625`, `:652`), so both runA and runB end through R-7 and each gets a real `openVerification`; and the two-task Plan cannot be adopted as written, because it lacks the required Goal gate (`src/core/work-graph/tasks/plan-validation.ts:75-83`): add a Goal-level `finish` gate holding the original oB, outside stage s, and keep tA/tB, oB/vB, the dependency edge and the instructions. Chain: public bootstrap and governance, `createGoal` g and g2, propose/apply, `createSession` A/B/Q (requestIds `gr-session-88`, `gr-session-92`, `gr-session-44`; derive their ids by hand and check none contains `b`, so the upper-case variant still matches only through `Builder`), claim A/B, R-7 finish, `openVerification`; the QueryJob keeps its submit/claim; GR10 switches p1 → p2 by a propose/apply based on p1. Assertions: GR06 `[tB, M1, SA, SB, SQ, runB, rb]`, GR07 `[tB, M1, SA, SB, SQ, runB, rB]` with the real Session ids; GR17's search term becomes SB's full real id; GR01, GR02, GR10, GR19 and the M2 exclusion stay as they are. |
| W2-25 | TP-108(a) late-lower-end (`tests/runtime/R4c-graph-history.test.ts:594-641`) | **Convert, as an A6 row.** The "real end later lowers the bound" story is unreachable (a real end sets `observedThrough` and `end` together, `src/core/agent-runtime/execution-observation.ts:731-743`; going back is refused, `src/core/work-graph/state/run-machine.ts:1258`), but the reader's refusal is current (`src/core/agent-runtime/graph-execution-history.ts:259`). Claim; R-7 prepare, start and finish; read the first page publicly and take its non-empty cursor; the one refused input is that cursor with only the outer `u` set to the real end + 1. Assert `source_stale` (tightened from `source_stale | invalid`, so the inner range check cannot pass it) and a public read showing the execution unchanged. |

Order inside a row: the conversion first; if a step cannot be reached, R-5 with R-7's standard of evidence.

## 4. Full suite on `ed26c44`

The bubblewrap full suite on `ed26c44` is green: 773 files, 9,929 passed, 5 skipped, 2,457 s
(`checks/full-W1R1.txt`). The failures DSH saw in its sandbox were all environment failures. No row may leave a test
red.

## 5. Stays BLOCKED (the audit confirmed the reason)

- W1-10 WF01: no public step changes a Goal's objective or Workspace after creation (`src/contracts/graph-context.ts:181`,
  `src/core/work-graph/state/goal-settings-machine.ts:233`).
- W1-15: a real finish writes a RunActivity that the L8 backfill does not replace
  (`src/core/work-graph/tasks/execution-entry-service.ts:1920`, `run-activity-service.ts:159`).
- B-04's accepted-ReviewWork base: the real source reader returns `unsupported` for ReviewWork
  (`src/core/work-graph/source-authority-reader.ts:158`).
- W1-26 AD08: the base path; the product gap is L-1.

## 6. Lead items (not for DSH)

- **L-1 AD08**, as in `t-w1-findings.md` §7.
- **L-2** gains the physical-removal check `plan-validation.ts:337-338` (W2-14).
- **L-3 TP-124 / GAP-46:** no Runtime tool entry for the Agent requeue owner (W2-22).
