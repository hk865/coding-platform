The implementation has merge blockers in reply positioning and notice-source validation, plus substantial gaps in the required acceptance tests. I reviewed the 37 changed/untracked paths and the supplied report and TDD rules. I changed nothing and ran no tests.

**Production conformance**

Here, `WG/` means `src/core/work-graph/`.

| File:symbol | Static assessment |
|---|---|
| `src/composition/create-platform.ts:createTargetPlatform`; `WG/configuration/message-duties-adapter.ts:createMessageDutiesFactsAdapter` | L1–L3/D01–D02 wiring is substantially correct: pinned Session role, exact legacy mapping, preserved guards, failure propagation, provenance and original authorization/replay order. |
| `WG/views/context-extensions.ts:createContextExtensionsReader/decisionRows`; `src/core/agent-runtime/context-assembler.ts:optionalRowsFromExtensions` | L4–L6/L9, G01/C01/C02 are implemented: autonomy, waiting-answer rows, Task association, hints, pagination and reminder consumption. G and binding sources remain unchanged. Acceptance evidence is insufficient below. |
| `WG/state/session-availability.ts:createSessionRecord/releaseSessionRecord/observeSessionHealthRecord/bindSessionUnavailableCursor` | L10 constructor rules are correct: entry creates pending R, SES-13 removes R, re-entry creates a new R, other transitions preserve it. |
| `WG/sessions/session-health.ts:recordSessionHealth`; `WG/tasks/run-reconcile-service.ts:commitDecided`; `WG/queries/query-execution.ts:commitOperation/loadRecordedResult` | The three specified owner tails bind R in the original commit. Health/Query replay uses the original receipt. Work/Query recovery paths reach these tails; result/control releases do not introduce another pending-R writer. |
| `src/contracts/core/session.ts:SessionRecord`; `WG/model/communication-contracts.ts:SessionMessage/UndeliveredReplyV1`; `src/core/record-store/{ports,commit-extensions,record-codec}.ts` binding types/functions | The intended two fields and closed mechanical binding extension are present; existing backend transactions are reused. |
| `WG/sessions/{session-record-codecs,message-record-codecs}.ts:checkSessionBody/checkSessionMessageBody` | Record/event validation modes and registrations exist, but nonzero validation is defective—finding 3. |
| `WG/state/message-machine.ts:nextSessionMessageRecord/bindMessageResponseCursor`; `WG/communication/mailbox-service.ts:commitPreparedSessionMessage/replaySessionMessageReceipt/readUndeliveredReplies`; `WG/communication/decision-service.ts:replayMessage` | Normal reply binding and original-receipt replay binding are implemented. Decision-answer creation and DTO forwarding violate §2.3—findings 1–2. |
| `WG/views/undelivered-reply-notices.ts:createUndeliveredReplyNoticeSource/projectReply` | Implements archived enumeration, Goal-before-position filtering, max(R,P), pagination, window retries and read-only projection; findings 2, 4–6 prevent full N01–N03 acceptance. |
| `WG/tasks/planning-question-reader.ts:readPlanningQuestions` | Correct narrow selection fix; scope handling noted below. |

I found no additional business-state writes outside `state/`, no second positioning commit, and no writes in the new read source. This supports §8.5 statically; the required zero-write/model-call acceptance assertions are missing.

**Production findings**

1. **Must fix before merge — user decision answers never receive P.**  
   [message-machine.ts:1267](D:/cxt/w2-review/src/core/work-graph/state/message-machine.ts:1267) deliberately omits `responseSince` in `decision_answered`. This contradicts **§2.3 line 176, P02/P01, L10–L11 and §8.9**.

   Concrete failure: member Session S sends a decision for Goal A; the user answers; S later becomes unavailable before the response is accepted. R exists, P does not. [undelivered-reply-notices.ts:307](D:/cxt/w2-review/src/core/work-graph/views/undelivered-reply-notices.ts:307) returns `incomplete/undelivered_reply_position_missing:`. Consequently, **A’s notice query and the unfiltered workspace query fail**, while a filtered Goal B query excludes A first and can succeed. Newly written data is incorrectly treated as legacy incomplete data. Replay/reopening cannot repair an absent field.

   Fix: mark pending P for original `work_run` senders in this branch, exactly as in `responded`. The exact replacement for the assertion at [S5-message-decision.test.ts:261](D:/cxt/w2-review/tests/state/S5-message-decision.test.ts:261) is:

   ```ts
   expect(next).toEqual({
     ...before,
     revision: before.revision + 1,
     status: 'responded',
     readAt: before.readAt ?? originalResponse.respondedAt,
     response: originalResponse,
     application: null,
     ...(before.sender.kind === 'work_run' ? { responseSince: null } : {}),
   });
   ```

   Retain whole-object equality. Also refreeze the event expectation at [S5-user-messages.test.ts:80](D:/cxt/w2-review/tests/work-graph/S5-user-messages.test.ts:80): the event contains pending `null`; the receipt contains its bound cursor. `decision-service.ts:376` already uses the correct original receipt cursor. Frozen-test conflict requires lead refreezing, not dropping the production requirement.

2. **Must fix before merge — DTO positions depend on the wrong sender.**  
   [mailbox-service.ts:3321](D:/cxt/w2-review/src/core/work-graph/communication/mailbox-service.ts:3321) forwards R/P only when the **response** sender is `work_run`. Query and user replies therefore omit positions even when stored. [undelivered-reply-notices.ts:296](D:/cxt/w2-review/src/core/work-graph/views/undelivered-reply-notices.ts:296) compensates by falling back to records, masking disagreement with the DTO contract. **§2.3, L7, §4.4.4** require forwarding stored positions and checking equality.

   Fix: forward both optional bound fields for every qualifying original Work message; require the specified DTO/record agreement. Refreeze IT20’s whole-DTO expectation at [S1-wait-copy-retirement.test.ts:172](D:/cxt/w2-review/tests/scenarios/S1-wait-copy-retirement.test.ts:172) with independent R/P receipt/log cursors.

3. **Must fix before merge — zero is accepted as a persisted position.**  
   [session-record-codecs.ts:772](D:/cxt/w2-review/src/core/work-graph/sessions/session-record-codecs.ts:772) and [message-record-codecs.ts:875](D:/cxt/w2-review/src/core/work-graph/sessions/message-record-codecs.ts:875) use a regex accepting `c0000000000`. **§2.3 line 180** explicitly requires nonzero platform cursors. Fix the two new-field validators; preserve legacy-field compatibility.

4. **Must fix before merge — continuation validation is incomplete.**  
   [undelivered-reply-notices.ts:402](D:/cxt/w2-review/src/core/work-graph/views/undelivered-reply-notices.ts:402) encodes flattened workspace fields with `JSON.stringify`, rather than the specified canonical envelope. Its decoder accepts malformed commit positions such as `"garbage"` at line 429. Such a token can yield an empty success when no items exist, or `unavailable` when comparison throws, instead of `invalid`. **§4.4.6/M08**.

   Fix: implement the prescribed envelope and validate its fields and complete positions before reading.

5. **Must fix before merge — duplicate identity comparison drops R/P information.**  
   [undelivered-reply-notices.ts:389](D:/cxt/w2-review/src/core/work-graph/views/undelivered-reply-notices.ts:389) signs the projected maximum, not both original positions. Duplicate source entries with R=10/P=20 and R=11/P=20 can compare equal despite conflicting metadata. **§4.4.5/M04** requires rejection.

   Fix: include ownership, `respondedAt`, R, P and full source Session identity explicitly in the duplicate signature.

6. **Must fix before merge — explicit-Goal read exceptions bypass proper normalization.**  
   [undelivered-reply-notices.ts:138](D:/cxt/w2-review/src/core/work-graph/views/undelivered-reply-notices.ts:138) casts arbitrary throws to Store failures. `Error` produces an undefined reason; `null` causes another exception, outside the outer catch at line 98. **§4.4.7/§8.1**.

   Fix: validate structured Store failures and normalize other throws to `unavailable/undelivered_reply_read_failed:` inside the common exception boundary.

7. **Note — the extra planning-reader change is correct and minimal.**  
   [planning-question-reader.ts:162](D:/cxt/w2-review/src/core/work-graph/tasks/planning-question-reader.ts:162) excludes successfully decoded non-`initial_coordination` jobs before calling an incompatible reader. Lookup, record, decode and relevant initial-planning Answer failures still propagate; it does not hide a relevant read failure. Retain the change, with lead scope refreezing under **§8.10**.

**Test audit**

Missing required behavior below is **must fix before merge**. Test-style defects are **should fix**, under **§5.3.1–5**, unless they invalidate the only evidence for a required row.

| New test file | Coupling, self-derived expectations, triviality, and correction |
|---|---|
| [state/WP2-positions.test.ts:130](D:/cxt/w2-review/tests/state/WP2-positions.test.ts:130) | Legitimate E5 literal constructor tests; no prohibited mocking/store reads found. Both tested response variants use `responded`; `decision_answered` is missing. Add that P01 branch. |
| [record-store/WP2-notice-cursors.test.ts:80](D:/cxt/w2-review/tests/record-store/WP2-notice-cursors.test.ts:80) | Direct record-store reads at 88/96; replay storage expectation comes from the first storage read. Synthetic `NoticeProbe` validation cannot prove production Session/message decoding. W231 is explicitly optional mechanical coverage, **not E3 evidence**. Line 100 always creates memory, so the backend matrix duplicates that test. Remove the duplicate; obtain domain persistence evidence through E3. |
| [runtime/WP2-context-assembly.test.ts:74](D:/cxt/w2-review/tests/runtime/WP2-context-assembly.test.ts:74) | All four F05/F06/F08 tests inject successful internal graph facts through `assemblerWithFacts`. They do not exercise E2 platform preparation. Budget-zero test at 117 does not cover continuation preservation. Replace acceptance evidence with real preparation and independently specified text/budget expectations. |
| [work-graph/WP2-context-extensions.test.ts:184](D:/cxt/w2-review/tests/work-graph/WP2-context-extensions.test.ts:184) | F05–F08 mostly inject successful anomaly/queue pages. F06 at 260 substitutes a new empty queue instead of answering the existing decision—trivial “disappearance.” F07 at 296 advances by call ordinal; 327 supplies 5,001 cards in one requested-100 page. These cannot establish E2 behavior or real paging. Fault-injection cases are useful supplements; use real owners/preparation for the named rows. |
| [work-graph/WP2-message-duties.test.ts:179](D:/cxt/w2-review/tests/work-graph/WP2-message-duties.test.ts:179) | M02 conflict doubles at 179/205/229/274/293 are defensible failure-shaped injections. Positive guard-dedup test at 250 uses a successful internal replacement and checks only a filtered subset, not the specified complete guard set. M03 asserts internal `sessionReads` at 369. F04 at 519 tests adapter failure, not request replay. Assert complete literal guards and public outcomes; cover replay at E1. |
| [work-graph/WP2-undelivered-notices.test.ts:109](D:/cxt/w2-review/tests/work-graph/WP2-undelivered-notices.test.ts:109) | F10/F12 take expected R from returned Session fields rather than independent commit cursors. M06 at 272 asserts internal flags and a count, not the named tail item. M07 at 376 fabricates 5,000/5,001 successful records in one page and reads the store watermark; M09 also reads it at 407 and asserts call counts. M08 compares returned keys/positions with each other instead of handwritten identities/order. M10 at 464 fails the **first** directory page, never proving continuation/accumulated-window discard, and asserts counts. P5 at 535 duplicates M04’s conflict case. Replace these with independent histories, conforming pages and outcome assertions. M05’s “bad cursor” is a valid-but-different cursor, leaving malformed/zero coverage absent. |
| [composition/WP2-wiring.test.ts:232](D:/cxt/w2-review/tests/composition/WP2-wiring.test.ts:232) | F04 never reissues the original request. F05–F08 primarily inspect graph facts, not the named preparation behavior. F11 derives expected identities from returned pages. F13 at 572 fabricates a Kernel acceptance position. F14 at 925/944 compares storage reads and deliberately omits P; reopening is followed by reading, not replaying the answer. F03’s helper [WP2-platform-support.ts:387](D:/cxt/w2-review/tests/helpers/WP2-platform-support.ts:387) overwrites Session provenance instead of creating a real readonly derivation. Fix these through public lifecycle/Runtime operations and independent expectations. |
| [scenarios/WP2-wiring-scenario.test.ts:55](D:/cxt/w2-review/tests/scenarios/WP2-wiring-scenario.test.ts:55) | Z02 advances Workflow, but checks graph facts instead of the next prepared reminder input. Z01 at 117 manually drives Runtime/owners and never advances Workflow. Seen-then-recovery returning zero also cannot independently prove recovery removal. Neither fulfills the frozen E0 scenario. |

The **§5.2 row disposition** is:

- **F01/F02:** genuine E1 coverage. **F03/F04:** deficiencies above.
- **F05–F08:** no adequate E2 acceptance.
- **F09/F10/F12:** real E3 coverage exists; F09 lacks notice behavior with a continuation and proof of no successor execution/acceptance.
- **F11:** missing memory-backend coverage and handwritten expected sequences.
- **F13/F14:** incomplete/invalid acceptance evidence. F14 lacks the Query writer and complete first/retry/reopened-retry comparisons.
- **F15:** real fault injection and recovery coverage exists.
- **M01/M03/M11:** meaningful E4 coverage, with the M03 counter issue. **M02/M04–M10:** limitations above.
- **P01/Z01/Z02:** incomplete.

Additionally, the suite does not bracket the required reading stages with both production `commitObserver` and model-boundary assertions. Add those **§5.2 line 308 / §8.5** checks. Memory-only module Work/Query recovery tests also do not establish the complete **L11-2** owner/replay matrix at E3.

**“Documented/not constructible” claims**

- **Z01/Z02:** stock wrapper limitations are real, but “no tool override” is too broad: [harness.ts:607](D:/cxt/w2-review/tests/scenarios/harness.ts:607) accepts `options.tools`, already used by scenario support. Obtain a narrow lead-reviewed harness extension; substitutes are inadequate.
- **F13:** the missing responsible link is a fixture limitation: [create-platform.ts:864](D:/cxt/w2-review/src/composition/create-platform.ts:864) exposes `linkSessionWork`. The claimed module fallback is absent—the `transfer` helper is never exercised. Fabricated acceptance is inadequate.
- **F14 Query:** platform Query preparation/start and `workflow.consumeConsultation` exist. The module test covers one initial Query reply, not required replay/reopen behavior.
- **F07:** Task-linked cards exist, including deferred required tasks and unknown outcomes in [goal-decision-reader.ts:283](D:/cxt/w2-review/src/core/work-graph/tasks/goal-decision-reader.ts:283). “Not constructible” describes the current fixture, not the product.
- **M02:** resolved contradictions are substantially unreachable through consistent immutable role facts; failure-shaped E4 doubles are appropriate. Successful guard merging still needs adequate evidence.
- **F04:** rereading an unchanged message is not replay. Reissue the original request identity after role-fact failure and verify the original receipt and unchanged card count.

**Verdict: not ready.**