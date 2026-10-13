All checks pass and the scratch area is deleted. Here is the final report.

---

# FILES CHANGED

**Production (L-scope + the lead-accepted `planning-question-reader.ts`)**
- `src/contracts/core/session.ts`
- `src/core/record-store/ports.ts`
- `src/core/record-store/commit-extensions.ts`
- `src/core/record-store/record-codec.ts`
- `src/core/work-graph/configuration/message-duties-adapter.ts`
- `src/core/work-graph/model/communication-contracts.ts`
- `src/core/work-graph/views/context-extensions.ts`
- `src/core/agent-runtime/context-assembler.ts`
- `src/core/work-graph/state/session-availability.ts`
- `src/core/work-graph/state/message-machine.ts`
- `src/core/work-graph/sessions/session-health.ts`
- `src/core/work-graph/sessions/session-record-codecs.ts`
- `src/core/work-graph/sessions/message-record-codecs.ts`
- `src/core/work-graph/communication/mailbox-service.ts`
- `src/core/work-graph/communication/decision-service.ts`
- `src/core/work-graph/tasks/run-reconcile-service.ts`
- `src/core/work-graph/queries/query-execution.ts`
- `src/core/work-graph/tasks/planning-question-reader.ts`
- `src/composition/create-platform.ts`
- `src/core/work-graph/views/undelivered-reply-notices.ts` (new)

**New tests / helper**
- `tests/state/WP2-positions.test.ts`
- `tests/work-graph/WP2-message-duties.test.ts`
- `tests/work-graph/WP2-context-extensions.test.ts`
- `tests/runtime/WP2-context-assembly.test.ts`
- `tests/work-graph/WP2-undelivered-notices.test.ts`
- `tests/record-store/WP2-notice-cursors.test.ts`
- `tests/composition/WP2-wiring.test.ts`
- `tests/scenarios/WP2-wiring-scenario.test.ts`
- `tests/helpers/WP2-platform-support.ts`

**Refrozen old tests + harness (only the `w2-refreeze.md` changes)**
- `tests/state/S5-message-decision.test.ts`
- `tests/work-graph/S5-user-messages.test.ts`
- `tests/scenarios/S1-wait-copy-retirement.test.ts`
- `tests/app/S5-decision-routes.test.ts`
- `tests/scenarios/harness.ts`
- `tests/scenarios/support/common.ts`

# FINDINGS (production findings 1–6)

| # | First failing test (entry) | RED message first seen | Minimal fix (file:symbol) |
|---|---|---|---|
| 1 | `P01 a user decision answer on a work_run decision card marks a pending response position; a host-sent card gains none` (`tests/state/WP2-positions.test.ts:162`, E5) | `AssertionError: expected { ref: { …(4) }, …(12) } to deeply equal { ref: { …(4) }, …(13) }` — diff `- "responseSince": null` | `src/core/work-graph/state/message-machine.ts:nextSessionMessageRecord` (+`bindMessageResponseCursor`) — `decision_answered` on a `work_run` sender returns the record with `responseSince: null` |
| 2 | `M09 a stable DTO that omits R/P the Session record and message still carry is refused` (`tests/work-graph/WP2-undelivered-notices.test.ts:726`, E4); plus `F14 …` DTO | `expected 'ready' to be 'rejected'`; and `expected [ { kind: 'retired_reply', …(6) } ] to deeply equal [ { kind: 'retired_reply', …(8) } ]` (diff `- "responseSince": "c0000000022"`, `- "unavailableSince": "c0000000023"`) | `src/core/work-graph/communication/mailbox-service.ts:readUndeliveredReplies` forwards every bound R/P; `src/core/work-graph/views/undelivered-reply-notices.ts:projectReply` compares DTO↔record exactly and uses the DTO values only |
| 3 | `M05 a zero or malformed platform cursor is never a stored position: the Session and SessionMessage records refuse it` (`tests/work-graph/WP2-undelivered-notices.test.ts:315`, E4) | `AssertionError: expected { status: 'committed', …(5) } to match object { status: 'rejected', code: 'invalid' }` | `src/core/work-graph/sessions/session-record-codecs.ts:isNonZeroPlatformCursor` (used by `checkSessionBody`) + `src/core/work-graph/sessions/message-record-codecs.ts:checkSessionMessageBody` |
| 4 | `M08 a malformed continuation cursor is invalid, never an empty success, unavailable or a restart from page 1` (`tests/work-graph/WP2-undelivered-notices.test.ts:439`, E4) | `AssertionError: garbage: expected 'ready' to be 'rejected'` | `src/core/work-graph/views/undelivered-reply-notices.ts:SourceCursorV1 / encodeSourceCursor / decodeSourceCursor / isCommitPosition` |
| 5 | `M04 a duplicate message+reply pair whose entry or reply position differs is refused even when the later position is equal` (`tests/work-graph/WP2-undelivered-notices.test.ts:688`, E4) | `AssertionError: expected 'ready' to be 'rejected'` | `src/core/work-graph/views/undelivered-reply-notices.ts:itemSignature` now includes both original positions + the source Session ref |
| 6 | `M11 a throw from the explicit-Goal read is an undelivered_reply_read_failed rejection, never a reason-less result or a rejected promise` (`tests/work-graph/WP2-undelivered-notices.test.ts:513`, E4) | `AssertionError: expected 'undefined' to be 'string'` (Error case had no reason; null case rejected the promise) | `src/core/work-graph/views/undelivered-reply-notices.ts:readFailure`, used by `goalScopeProblem` and the `readPage` outer catch |

All `UNSPECIFIED (reported)` comments that these findings resolved are gone.

# AUDIT (test-audit items)

**Group T1**
| Audit item | Status | New test (file:line) |
|---|---|---|
| record-store: no direct store reads, no duplicate memory case, mechanical only | fixed | `W231 declares exactly …` `:83`, `W231 still rejects a commit cursor field outside the closed set` `:87`, `W231 binds both notice fields to the literal commit cursor` `:102`, `W231 refuses an existing value, an unregistered schema field and an unbound target` `:113`, `W231 accepts a commit with both notice bindings and replays its own cursor` `:128` |
| M02 complete literal guard set | fixed | `M02 identical guards collapse to one entry and the complete guard set is returned` `WP2-message-duties.test.ts:250` |
| M03 no internal read counts | fixed | `M03 a throwing role resolver is unavailable and never reads the Session` `:358` |
| remove F04 from this file | fixed | block deleted |
| F10/F12 R,P from independent observations | fixed | `F10 …` `WP2-undelivered-notices.test.ts:147`, `F12 …` `:166` |
| M06 named tail item | fixed | `M06 an empty directory or reply page still follows its cursor to the later named tail item` `:351` |
| M07 conforming pages, no store watermark | fixed | `M07 exactly 5000 items succeed across conforming pages…` `:534` |
| M08 handwritten identities/order + malformed cursor | fixed | `M08 same-position items page by the complete key in the handwritten order…` `:390`, `M08 a malformed continuation cursor…` `:439` |
| M09 no call counts | fixed | `M09 …` `:569`, `:603`, `:726` |
| M10 later directory page, whole window discarded | fixed | `M10 a later directory page that goes source_stale discards the whole accumulated window` `:633`, `:663` |
| remove P5 duplicate of M04 | fixed | deleted |
| M05 malformed + zero positions | fixed | `M05 a zero or malformed platform cursor…` `:315` |
| F06 answers the existing decision | fixed | `F06 answering the existing decision removes its row from the next real queue read` `WP2-context-extensions.test.ts:314` |
| F07 real cards across real pages | fixed | `F07 the reader keeps every real waiting card across real queue pages` `:356` |
| fault-injection cases are supplements, not F05–F08 evidence | fixed | `SUP (fault injection) …` `:395`, `:430`, `:482`, `:495` |

**Group T2**
| Audit item | Status | New test (file:line) |
|---|---|---|
| F03 real read-only copy via public lifecycle | fixed | `F03 a read-only copy Session is refused at the real claim admission and produces no decision card` `tests/composition/WP2-wiring.test.ts:254`; helper `createDerivedReadOnlyCopy` `WP2-platform-support.ts:369` |
| F04 reissue original request identity; original receipt + unchanged card count | fixed | `F04 after a successful tool request, broken role facts refuse the next request, the original request identity replays, and the card count is unchanged` `:276`; id from the first command's own `SessionMessageSent` event `:304` |
| F05 real preparation | fixed | `F05 a changed autonomy level reaches the new prepared context while the already-bound input does not move` `:342` |
| F06 prepared reminder input + budget | fixed | `F06 a waiting decision card becomes a decision reminder row…` `:395`, `F06 [budget] …` `:457` |
| F07 Task-linked cards | **partial (documented, UNSPECIFIED)** | `F07 a focus task keeps the real Task-linked goal_cause card and another focus excludes it` `:472` (assembled-input assertion blocked) |
| F08 real Work/Query preparation | fixed | `F08 real Work preparation carries the installed extensions in the bound scope, Query preparation stays copy/planning, and a foreign scope is refused` `:515` |
| F09 continuation + no successor acceptance | fixed | `F09 [%s] a reply saved after its Session already became unavailable appears once and archiving keeps it` `:1039` (memory+sqlite) |
| F11 memory + handwritten sequences | fixed | `F11 [%s] marking one displayed notice leaves the later same-cursor notice and a later reply unseen…` `:578` |
| F13 real `linkSessionWork` link + transfer, no fabricated Kernel position | fixed | `F13 [%s] the real responsible link and wait transfer keep the notice; a successor execution accepting the reply removes it` `:698` |
| F14 Query Answer writer (real prep/start + `consumeConsultation`, retry/reopen incl. P) | fixed | `F14 [%s] (Query Answer) a consultation answer saved after the real health commit carries R and P across a retry and a reopen` `:1239` |
| F14 E3 rows on both backends | fixed | `F14 [%s]` `:963`, `:1150`, `:1239` are `it.each(['memory','sqlite'])` |
| commitObserver zero-commits + zero model calls on reading stages (§5.2 line 308, §8.5) | fixed | `quietRead` `:47`; F01 `:174`, F02 `:210`, F03 `:234`, F05 `:327/:350`, F06 `:413`, F07 `:455`, F08 `:569/:574`, F09 `:1086`, F11 `:635`, F13 `:703`, F14-Work `:976`, F14-user `:1175/:1219`, F14-Query `:1265`, F15 `:813`; Z01 scenario `:193`, Z02 scenario `:82` |
| Z01 advances through the scenario harness | fixed | `Z01 automatic advancement through the scenario harness…` `WP2-wiring-scenario.test.ts:142` (uses `openOwnedWorkRoot`) |
| Z02 checks the next prepared reminder input, not graph facts | fixed assertion / **entry deviation (UNSPECIFIED)** | `Z02 automatic advancement: … the NEXT prepared reminder input carries its row, and answering removes the row` `:57` |
| recovery removal proven by a positive observation | fixed | `Z01` `:128`, `:216-221` (health `available`, `unavailableSince` absent, notices empty) |

# HARNESS

**Approved additions (group H), exact signatures**
- `tests/scenarios/harness.ts`:
  - `export type ScenarioCommit = PreparedCommit & { readonly cursor: CommitCursor };` (`PreparedCommit` from `src/core/record-store/ports.js`, `CommitCursor` from `src/contracts/command-event.js`)
  - `HostScenarioOptions.commitObserver?: (batch: ScenarioCommit) => void;` — fires once per non-replayed committed batch, in commit order, for every in-process writer; additive, nothing installed when absent
  - `CompositionSettings.tools?: readonly string[];`
  - `openComposition(settings, …, tools?: readonly string[]): …`
  - `PlatformScenarioOptions.tools?: readonly string[];`
- `tests/scenarios/support/common.ts`:
  - `openWorkRoot(h: HostScenario, model?: ScriptedModel, observer?: RecordCommitObserver, queryModel?: ScriptedModel, tools?: readonly string[], hostInstance?: HostInstanceFacts): Promise<Platform>`
  - `openOwnedWorkRoot(h: HostScenario, model?: ScriptedModel, observer?: RecordCommitObserver, tools?: readonly string[]): Promise<Platform>` — delegates with `{ hostInstanceId: 'wp2-scenario-host', lease: 'owned' }`
- Implementation note (differs from refreeze §5 wording): the production `RecordCommitObserver` seam (`src/composition/commit-observer.ts`) carries only `{cursor, aggregates}` and cannot see events, so `commitObserver` is implemented by additively wrapping `createInMemoryRecordBackend`/`createSqliteRecordBackend`; documented at `harness.ts:135-143`. Needs lead confirmation.

**Group T2 helper additions (`tests/helpers/WP2-platform-support.ts`, all additive)**
- `createDerivedReadOnlyCopy(...)` (real lifecycle-derived read-only copy), `preparedCommits()` (full-commit observation guard), `preparedBundleInput(...)`, `claimSuccessorRun(...)`, `responseIdentityOf(f, messageId)`, `deferredGoal`/`deferredGoalRef`, `queryScripted`, memory `resolveQueryConfiguration`, `contextResidentBytes`, `queryReplies`/`queryInstruction`/`queryTools`, `roleBinding`, `check`/`wp2ChecksConfiguration`, memory `workflowBound`.

# ROWS (spec §5.2 — 29 rows, all with a row-prefixed test)

`row | test(s) | RED first seen this round | implementation`
- **Z01** | `Z01 automatic advancement through the scenario harness…` (scenario:142) | `markNoticesSeen` → `unsupported/no configured operator can mark notices seen` | `create-platform.ts:createTargetPlatform`; `undelivered-reply-notices.ts:createUndeliveredReplyNoticeSource`
- **Z02** | `Z02 automatic advancement: … the NEXT prepared reminder input carries its row…` (scenario:57) | none this round (rewrite: assertion changed from graph facts to prepared input) | `create-platform.ts`; `context-extensions.ts:createContextExtensionsReader`; `context-assembler.ts:optionalRowsFromExtensions`
- **F01** | `F01 a real entered secretary Run calling send_user_message commits and leaves exactly one waiting decision card` (composition:178) | pre-existing (earlier session), GREEN | `message-duties-adapter.ts`; `mailbox-service.ts:sendUserMessage`; `decision-policy.ts:canSendUserMessage`
- **F02** | `F02 an executor and an ordinary reviewer Run may notify but a decision request is refused and leaves no card` (:212) | pre-existing, GREEN | `decision-policy.ts`; `message-duties-adapter.ts`
- **F03** | `F03 a read-only copy Session is refused at the real claim admission and produces no decision card` (:254) | none this round (helper rewritten to a real lifecycle copy) | `message-duties-adapter.ts:readOnlyCopy`; `mailbox-service.ts:sendUserMessage`
- **F04** | `F04 after a successful tool request, broken role facts refuse the next request, the original request identity replays, and the card count is unchanged` (:276) | none this round (id now observed from the first command event) | `message-duties-adapter.ts`; `mailbox-service.ts` replay
- **F05** | `F05 a changed autonomy level reaches the new prepared context…` (:342); runtime:74; module:238 | none this round | `context-extensions.ts`; `goal-settings-service.ts:setGoalSettings`; `context-assembler.ts:goalPayload`
- **F06** | `F06 a waiting decision card becomes a decision reminder row…` (:395), `F06 [budget] …` (:457); runtime:97,:117; module:263,:314 | `## Accepted task` header expectation corrected (test-side) | `context-extensions.ts`; `decision-read-model.ts:queryDecisionQueue`; `context-assembler.ts:optionalRowsFromExtensions`
- **F07** | `F07 a focus task keeps the real Task-linked goal_cause card and another focus excludes it` (:472); module:335,:356,:378 | plan needed an active required work+gate; legacy unassigned work task rejected at apply; `plan_only` needs v2 | `context-extensions.ts`; `decision-read-model.ts:queryDecisionQueue/readDecisionQueueWindow`
- **F08** | `F08 real Work preparation carries the installed extensions in the bound scope…` (:515); runtime:129; module `SUP` | `usage:'current'` is forbidden for a Run reader | `context-extensions.ts`; `context-assembler.ts:optionalRowsFromExtensions`
- **F09** | `F09 [%s] a reply saved after its Session already became unavailable appears once and archiving keeps it` (:1039); module:113,:127 | pre-existing/rewrite, GREEN | `undelivered-reply-notices.ts`; `mailbox-service.ts`; `session-availability.ts`
- **F10** | `F10 [%s] a reply saved before its Session becomes unavailable becomes a new unseen notice…` (:1099); module:147 | none this round (R/P now from commit observer) | `undelivered-reply-notices.ts`; `session-health.ts:recordSessionHealth`; `session-availability.ts`
- **F11** | `F11 [%s] marking one displayed notice leaves the later same-cursor notice and a later reply unseen…` (:578) | none this round (single backend → memory+sqlite; `.sort()` removed) | `decision-read-model.ts:readDecisionQueueWindow`; `decision-settings-service.ts:markNoticesSeen`; `undelivered-reply-notices.ts`
- **F12** | `F12 [%s] SES-13 recovery removes the notice and a later re-entry produces a new unseen one` (:1117); module:166 | none this round | `session-availability.ts`; `session-health.ts`; `undelivered-reply-notices.ts`
- **F13** | `F13 [%s] the real responsible link and wait transfer keep the notice; a successor execution accepting the reply removes it` (:698) | memory branch lacked the Workflow binding | `undelivered-reply-notices.ts`; `mailbox-service.ts`; `session-directory.ts:findSessions`
- **F14** | Work `F14 [%s] …` (:963); user `F14 [%s] …` (:1150); Query `F14 [%s] (Query Answer) …` (:1239) | missing Query host; wrong role binding; stale captured method after reopen | `mailbox-service.ts`; `decision-service.ts:replayMessage`; `query-execution.ts`; `message-machine.ts:nextSessionMessageRecord`
- **F15** | `F15 [%s] a failed reply or health commit leaves no half state, and a committed reply recovers exactly once on retry` (:809); `F15 [sqlite] …` (:905) | pre-existing, GREEN | `commit-extensions.ts`/`record-codec.ts`; `mailbox-service.ts`; `session-health.ts`
- **M01** | `M01 each of the five legacy platform templates resolves to its exact duty` (module:113) + :126,:141,:152 | pre-existing (earlier session), GREEN | `message-duties-adapter.ts:createMessageDutiesFactsAdapter`
- **M02** | `M02 identical guards collapse to one entry and the complete guard set is returned` (:250) + :179,:205,:229,:279,:298,:318,:328 | first rewrite run RED: Session guard refKey lacked `aggregateType`; revision expected 2, is 1 | `message-duties-adapter.ts`
- **M03** | `M03 a throwing role resolver is unavailable and never reads the Session` (:358) + :378–:506 | none this round (read-count assertion removed) | `message-duties-adapter.ts`
- **M04** | `M04 the same message+reply pair is deduplicated when its metadata agrees and refused when it conflicts` (module:192); `M04 a duplicate … whose entry or reply position differs is refused…` (:688) | `expected 'ready' to be 'rejected'` (finding 5) | `undelivered-reply-notices.ts`
- **M05** | `M05 old data missing a position blocks only its Goal; a damaged position is refused` (:221); `M05 …` (:286,:315) | `expected { status: 'committed', …(5) } to match object { status: 'rejected', code: 'invalid' }` (finding 3) | `undelivered-reply-notices.ts`; `session-directory.ts:findSessions`; `mailbox-service.ts:readUndeliveredReplies`
- **M06** | `M06 an empty directory or reply page still follows its cursor to the later named tail item` (:351) | none this round (named-tail rewrite) | `undelivered-reply-notices.ts`; `mailbox-service.ts`
- **M07** | `M07 exactly 5000 items succeed across conforming pages; one more is a capacity rejection without half a page` (:534) | none this round (conforming pages replace the fabricated one) | `undelivered-reply-notices.ts`
- **M08** | `M08 same-position items page by the complete key in the handwritten order and an incompatible cursor is refused` (:390); `M08 a malformed continuation cursor is invalid…` (:439) | `garbage: expected 'ready' to be 'rejected'` (finding 4) | `undelivered-reply-notices.ts`
- **M09** | `M09 a changed window is retried as a whole and recovers; a stable mismatch fails` (:569); `M09 …` (:603,:726) | `expected 'ready' to be 'rejected'` (finding 2) | `undelivered-reply-notices.ts`
- **M10** | `M10 a later directory page that goes source_stale discards the whole accumulated window` (:633); `M10 consecutive unstable directory windows fail…` (:663) | none this round (new whole-window-discard case) | `undelivered-reply-notices.ts`; `session-directory.ts:findSessions`
- **M11** | `M11 an installed-but-empty source is available, a missing one is not_available…` (:483); `M11 a throw from the explicit-Goal read…` (:513) | `expected 'undefined' to be 'string'` (finding 6) | `undelivered-reply-notices.ts`; `mailbox-service.ts`
- **P01** | `P01 an available Session entering unavailable marks the pending entry position` (`tests/state/WP2-positions.test.ts:113`) + :127,:136,:147,:162,:180 | `expected { ref: { …(4) }, …(12) } to deeply equal { ref: { …(4) }, …(13) }`, diff `- "responseSince": null` (finding 1) | `session-availability.ts`; `message-machine.ts`

# CHECKS

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 (tsc main + ui clean) |
| `npm run check:architecture` | exit 0 (`next source boundaries: OK`; 49 observed submodule edges) |
| `npm run build` | exit 0 (workbench published) |
| `npx vitest run WP2-` | `Test Files 8 passed (8)` / `Tests 99 passed (99)`; duration 5.89s |
| 50-file regression (section 8 list) | `Test Files 5 failed │ 45 passed (50)` / `Tests 18 failed │ 1184 passed (1202)`; duration 63.95s |
| extra refrozen 4-file run | `Test Files 4 passed (4)` / `Tests 49 passed (49)` |
| `sha256sum` (section 3, 10 files) | all ten match byte-for-byte |
| `git diff --stat slice-base -- tests` | exactly the 6 refrozen/harness files: `S5-decision-routes` 6, `S1-wait-copy-retirement` 29, `harness.ts` 121, `support/common.ts` 21, `S5-message-decision` 5, `S5-user-messages` 5 (168 insertions, 19 deletions); no other tracked test change |
| `git diff slice-base -- <6 files>` | only the refreeze assertions + the additive `commitObserver`/`tools`/`openOwnedWorkRoot` harness changes (24 181-byte diff) |
| `git status --short` | only L-scope paths (20 production modifiers, 9 new production/test files, 4 refrozen tests, 2 harness files); `.dsh-scratch/` deleted; no commit (log still 2 commits) |

All 18 regression failures are the expected sandbox kind (`expected 'waiting' to be 'stopped'/'completed'` ×14, `{stopped:null}` not `completed` ×2, "re-drive completed the Task/Goal without a workflow/advance" ×2) and sit only in the 5 baseline files: `A8-host-restart-entry` (7), `A8-host-restart` (3), `C6-unrelated-adoption` (5), `S1-archive-restart` (1), `WP1-wiring` (2). The 7 intended-RED tests now pass. No `WP2-` or refrozen case is sandbox-blocked.

# UNSPECIFIED

- **F07 assembled-input evidence (not fixed; documented limitation).** (1) test assertion: `expect(input).toContain(JSON.stringify('待决定：goal_cause；source=<key>').slice(1,-1))` for a Run whose claim Task is the card's Task; (2) spec §5.2 F07: "带焦点任务准备时，按 L5 选出相关的任务卡和目标卡"; (3) acceptance-review line 82: "F05–F08 primarily inspect graph facts, not the named preparation behavior." Tried: claim `wp2-deferred-work` → `invalid: the Task disposition is not active`; claim `implement-b` via Workflow → `the input declaration is not part of the claim Plan`; `context-extensions.ts:113` excludes a Task-linked card whose Task is not the claim Task; an ended failed/unknown Run would need an unexposed writer. Independent review confirmed: prepared focus comes only from the claim Task (`context-assembler.ts:789-794`), the card attaches only to deferred (ineligible) tasks (`goal-machine.ts:1042-1050`, `eligibility.ts:47-50`), and the composition exposes no writer for a failed/unknown Run. The E4 module tests keep the real Task-linked card evidence (`WP2-wiring.test.ts:472`); the assembled-input assertion is not written.
- **Z02 entry deviation (spec §5.1 names E0).** (1) the test asserts the card reaches the queue and the NEXT prepared reminder input; (2) spec §5.1: Z02's entry is E0 ("现有场景测试框架…真实平台加 Workflow 自动推进"); (3) refreeze §5 allows the `tools` override to grant `send_user_message` to a scenario role for Z02. Attempts via `openPlatformScenario` + `registerWorkflowBinding` with a `platform-secretary` Session failed: `no trusted Workflow binding matches … role builder` (`workflow.ts:1368`); `the legacy Session template does not match the binding` (`claim-service.ts:671`); `roleBinding:{platform-secretary,s3.1}` rejected because the AG2b Task is assigned to `builder`. The stock fixture forces the Task/Session/Binding/Run to the same legacy template, so no secretary member is reachable without changing fixture/policy data outside T2's files. The current Z02 drives the real `createWP2Platform` + `workflow.advanceWork` automatic-advance path and passes.
- **Harness `commitObserver` done differently.** Refreeze §5 says "passed to the platform's existing commit-observer seam"; that seam (`src/composition/commit-observer.ts:23-30`) carries only `{cursor, aggregates}` and cannot see events or the separately-opened `retireS1Session` backend. H implemented it as an additive wrap of the record-backend factories (`harness.ts:135-143` documents this); observation-only, installs nothing when the option is absent. Confirmed forced by the H reviewer; needs lead sign-off.
- **No behavioural RED for the test-only rewrites.** Findings 2–6 were fixed by group P before T1's rewrites, and L-scope forbids reverting production, so the M04/M05/M06/M07/M08/M09/M10/F06/F07/F10/F12 rewrites show no new RED; the only REDs observed were test-side (M02 expected literal, `ready` import) and are logged above.
- **F08 installed-source read failure.** Not separately injected at E2; the audit text only requires real preparation (met), and the E4 module `SUP (fault injection)` tests cover read-failure-not-successful.
- **Naming note.** Spec §6/§7 assign F01–F04's E4 module part to W206 (`WP2-message-duties.test.ts`), which contains only M01–M03 names; F01–F04 are matched at E1 composition, and F08's module part is named `SUP`. No §5.2 row is untested.

# NOTES

- Subagents run: wave 1 P (1) + H (1 + 1 follow-up); wave 2 T1 (1 + 1 cleanup) + T2 (1 + 3 continuations); reviewers P, H, T1, T2-1, T2-2 (5); row mapper (1) — 14 delegations. Coordinator ran only the section 6 checks.
- L-bwrap rows: none. Z01/Z02 pass in this sandbox without a registered check.
- No real model calls, no network; ports 3080/3099/44797 untouched; no git write commands; `./.dsh-scratch/` deleted.
- 29/29 spec §5.2 rows have a test whose name starts with the exact row id; no test prefix outside §5.2 except `W231`, `SUP`, `P3/W225`, `P4/W226` (noted above).
- Production changes stay within the first brief's L-scope plus the lead-accepted `planning-question-reader.ts`; the 7 intended-RED tests are GREEN.
- The only outstanding spec items are F07's assembled-input assertion and Z02's E0 entry, both reported under UNSPECIFIED with the three texts; the remaining 18 test failures are the baseline sandbox-kind cases the lead runs outside.