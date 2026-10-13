The six original production defects are fixed. The test audit is **not fully closed**: several required preparation, replay and boundary cases remain inadequately demonstrated.

Reviewed `b601deeb` against the working tree, including untracked files. **No files changed; no tests run.**

References below use the frozen [SPEC](/D:/cxt/w2-review3/docs/refactor/design/orchestration-2026-10/slices/wiring-2-SPEC.md). Test abbreviations:

- **C**: `tests/composition/WP2-wiring.test.ts`
- **U**: `tests/work-graph/WP2-undelivered-notices.test.ts`
- **X**: `tests/work-graph/WP2-context-extensions.test.ts`
- **S**: `tests/scenarios/WP2-wiring-scenario.test.ts`

**Production findings 1–6**

| Finding | Result and evidence |
|---|---|
| 1. User answers lack P | **Fixed.** [message-machine.ts:1267](/D:/cxt/w2-review3/src/core/work-graph/state/message-machine.ts:1267) sets pending P for original Work senders. Mailbox binding and decision replay use the original commit cursor. |
| 2. DTO positions depend on response sender | **Fixed.** [mailbox-service.ts:3313](/D:/cxt/w2-review3/src/core/work-graph/communication/mailbox-service.ts:3313) forwards both positions. [undelivered-reply-notices.ts:307](/D:/cxt/w2-review3/src/core/work-graph/views/undelivered-reply-notices.ts:307) checks exact DTO/record agreement, including absence. |
| 3. Persisted zero cursor accepted | **Fixed.** [session-record-codecs.ts:776](/D:/cxt/w2-review3/src/core/work-graph/sessions/session-record-codecs.ts:776) and [message-record-codecs.ts:875](/D:/cxt/w2-review3/src/core/work-graph/sessions/message-record-codecs.ts:875) reject zero for the new fields. |
| 4. Continuation validation | **Fixed.** [undelivered-reply-notices.ts:413](/D:/cxt/w2-review3/src/core/work-graph/views/undelivered-reply-notices.ts:413) uses the canonical envelope and validates scope, filters and complete positions before reading. |
| 5. Duplicate signature loses R/P | **Original defect fixed.** [undelivered-reply-notices.ts:397](/D:/cxt/w2-review3/src/core/work-graph/views/undelivered-reply-notices.ts:397) includes both original positions. A related source-identity gap remains below. |
| 6. Explicit-Goal exceptions | **Fixed.** [undelivered-reply-notices.ts:116](/D:/cxt/w2-review3/src/core/work-graph/views/undelivered-reply-notices.ts:116) normalizes structured failures and arbitrary throws; the Goal-read catch uses it. |

I found no additional business-state writes outside state constructors, positioning writes outside the owner’s original commit, writes during reads, swallowed read failures producing empty success, or replay paths returning newly bound positions.

**Test-audit disposition**

| Audit item | Current result; entry and expected-value assessment |
|---|---|
| P01 missing `decision_answered` | **Fixed:** `tests/state/WP2-positions.test.ts:162`. E5, literal whole-object expectations for Work and Host senders. |
| W231 storage reads/duplicate memory test | **Fixed mechanically:** `tests/record-store/WP2-notice-cursors.test.ts:127`; reads removed and backend matrix corrected. Replacement internal/trivial tests remain, discussed below. |
| Runtime tests substituting graph facts | **Not fixed:** `tests/runtime/WP2-context-assembly.test.ts:74–154` still uses `assemblerWithFacts`. These do not enter E2. |
| Context F06 disappearance | **Fixed:** X:314 answers the existing decision through its owner. Module evidence only; successful synthetic cases also remain. |
| Context F07 paging/capacity | **Partial:** X:356 now reads real pages, but derives expectations from queue readback; X:378 still advances synthetic pages by call ordinal. |
| Duties M02/M03/F04 | **Partial:** `tests/work-graph/WP2-message-duties.test.ts:270` asserts complete guards; internal read-count assertion removed at :358; adapter-only F04 removed. Successful resolver replacement remains at :254. |
| Notice F10/F12 positions | **Fixed:** U:152–188 obtains expected R from commit observation. |
| M04/M05 | **Fixed for reviewed defects:** U:688 distinguishes equal-max/different-R duplicates; U:286/:315 covers malformed/zero persisted positions. Duplicate P5 removed. |
| M06 | **Partial:** U:351 checks a named tail instead of flags, but :378/:384 derives its expected identity from message readback and `noticeKey`. |
| M07 | **Partial:** U:534 uses conforming pages and observed watermark; successful internal mocks and incomplete exact-boundary evidence remain. |
| M08 | **Partial:** malformed/incompatible tokens covered at U:439; purported handwritten ordering is calculated at :407–412. |
| M09/M10 | M09 counter/store-watermark assertions removed. M10 continuation-page discard **fixed** at U:633; four-attempt boundary remains unproved at :663. |
| F01–F04 | F01/F02 retain genuine E1 evidence. F03 **fixed** at C:254 using lifecycle derivation (`WP2-platform-support.ts:417`). F04 **fixed** at C:318 with original identity from commit observation and actual replay. |
| F05–F08 | **Partial:** real preparation added, but gaps below remain. F07’s accepted Task-card limitation applies. |
| F09/F10/F12/F13/F15 | Real E3 coverage retained/improved. F09 continuation and no acceptance: C:1066. F13 real link, transfer and execution acceptance: C:742/:777/:792. F15 fault/recovery: C:809/:905. F10 covers equal timestamps, not a backward-clock variation. |
| F11/F14 | Both backends now present; **independent ordered expectations and complete replay/reopen matrix remain incomplete**. |
| Z01/Z02 | **Fixed under accepted Z02 entry equivalence:** S:160 advances Workflow; S:223 proves recovery removal without a seen step; S:111–139 checks next prepared input and removal after answering. Z02 expected identity comes from the send event. |
| Zero commits/models; recovery-owner matrix | **Partial:** notice/queue guards added, but preparations and the separate Query model are incompletely observed; Work/Query recovery remains module/memory-only. |

**Must fix before merge**

1. **Finish the required E2 evidence.**  
   [C:383](/D:/cxt/w2-review3/tests/composition/WP2-wiring.test.ts:383) checks changed graph facts, never a newly prepared input containing `every_step`. C:457’s budget case has no continuation to preserve. C:569 tests foreign/missing Goal reads, not preparation failure from an installed settings/decisions source.  
   **Spec:** F05–F08, lines 284–287; §8.7.  
   **Fix:** prepare a subsequent unbound Run after the autonomy change; prepare a real continuation under the constrained budget; inject boundary read failures and assert E2 preparation rejects.

2. **Replace self-derived identity/order expectations.**  
   [C:644](/D:/cxt/w2-review3/tests/composition/WP2-wiring.test.ts:644) explicitly declines to assert equal-cursor order. C:685 computes survivors from whichever item the implementation returned first. X:368–375 derives expected cards from queue readback; U:378–384 derives the tail identity from readback; U:407–412 calculates expected ordering with product serialization and comparison.  
   **Spec:** lines 274, 286, 290, 300, 302, 314.  
   **Fix:** retain identities from creating commands/commit observations, use a predetermined ordered example, and assert explicit first-page, tail and post-seen sequences. F11 must reject the wrong first item, not accommodate it.

3. **Complete F14’s replay and notice evidence.**  
   [C:1029](/D:/cxt/w2-review3/tests/composition/WP2-wiring.test.ts:1029) and C:1349 reopen then read; neither reissues the Work/Query request after reopening. User-answer assertions at C:1195/:1201/:1236 check P without complete first/retry/reopened-retry receipt/value comparisons. User and Query cases stop at mailbox DTOs, omitting the verified-fix notice assertions.  
   **Spec:** lines 178, 293; `verified-fixes.md` findings 1–2.  
   **Fix:** preserve complete initial results, replay after SQLite reopening, compare complete values/cursors, verify literal reply contents/options, and assert user-answer Goal/workspace notices at R and Query-answer notices at P.

4. **Exercise the other unavailable-position writers at E3.**  
   [U:748](/D:/cxt/w2-review3/tests/work-graph/WP2-undelivered-notices.test.ts:748) and U:760 remain memory-only owner tests. Composition coverage uses the health writer; it does not close the previously identified Work/Query recovery matrix.  
   **Spec:** L11-2; lines 174, 268, 316.  
   **Fix:** drive real platform Work reconciliation/recognition and Query recovery on both backends, checking independent R, resulting notices and applicable replay/reopen behavior.

5. **Observe preparation stages for writes and both models.**  
   [WP2-platform-support.ts:810](/D:/cxt/w2-review3/tests/helpers/WP2-platform-support.ts:810) prepares without observation brackets; direct preparation calls also bypass them. C:38 observes only `scripted`, not `queryScripted`.  
   **Spec:** line 308; §8.5.  
   **Fix:** bracket the tested preparation/read stages with commit observation and both model counters. Preserve the existing notice/queue guards.

6. **Repair capacity and retry-boundary evidence.**  
   [X:378](/D:/cxt/w2-review3/tests/work-graph/WP2-context-extensions.test.ts:378) repeats the same 100 cards and advances independently of the requested cursor. U:534 fabricates successful mailbox/message pages; its 5,000-item success assertion checks only the first 200. U:663’s perpetual-staleness rejection passes with one, two, four or five attempts.  
   **Spec:** L6/L7; lines 286, 301, 304, 312; §4.4.7.  
   **Fix:** use real successful histories and independently named tails, cover exact capacity and overflow, and use failure scripts that stabilize on attempt four versus only after attempt four—assert public outcomes, not internal call counts.

**Should fix**

- **DTO source Session is ignored during consistency checking.**  
  [undelivered-reply-notices.ts:334](/D:/cxt/w2-review3/src/core/work-graph/views/undelivered-reply-notices.ts:334) signs the directory-derived source; :337–352 never checks `reply.sourceSessionRef`. Duplicate DTOs differing only in that field silently collapse. **Spec line 248.** Validate the complete DTO source identity and reject disagreements. The current mailbox always constructs the correct identity, so this is a contract-validation gap, not an established normal-owner outage.

- **Successful internal mocks remain.**  
  `tests/runtime/WP2-context-assembly.test.ts:74`, X:263 and `tests/work-graph/WP2-message-duties.test.ts:254` still replace successful internal collaborators. **Spec line 312.** Replace redundant cases with allowed public operations or remove them; retain legitimate failure injections and the expressly accepted Task-card limitation.

- **Optional W231 coverage is implementation-coupled/trivial.**  
  `tests/record-store/WP2-notice-cursors.test.ts:83` restates a constant; :103 tests the internal binder; :128 proves receipt replay without proving bound fields. **Spec lines 312, 318, 397; fix-round brief T1.** Remove the redundant internal assertions or retain meaningful mechanical boundary coverage consistent with this round’s no-store-verification instruction. Do not count these as E3 evidence.

- **Malformed-position empty-source case can fail for the wrong reason.**  
  U:450 uses the already-invalid legacy envelope. **Spec §4.4.6.** Use the valid envelope with malformed positions there, as the populated-source case already does.

**Refreeze and lead decisions**

The four old-test changes match `w2-refreeze.md`: `S5-message-decision.test.ts:261`, `S5-user-messages.test.ts:192`, `S1-wait-copy-retirement.test.ts:173`, and `S5-decision-routes.test.ts:284`. Whole-object assertions remain intact; IT20 obtains R/P from unique observed commits. No additional tracked test files changed beyond those four and the two approved harness files.

Harness additions are `ScenarioCommit`, optional `HostScenarioOptions.commitObserver`, optional tools threading through `CompositionSettings`/`openComposition`/`PlatformScenarioOptions`, optional `tools`/`hostInstance` parameters on `openWorkRoot`, and `openOwnedWorkRoot`. The backend-factory observation mechanism differs from the refreeze’s original seam wording, exactly as the lead has accepted. I found no material default-behavior change.

I accept Z02’s E0 equivalence and the observer decision. **F07’s rationale needs narrowing:** [goal-decision-reader.ts:287](/D:/cxt/w2-review3/src/core/work-graph/tasks/goal-decision-reader.ts:287) also creates Task-linked unknown-outcome/stop/rework cards, and :383 creates automation-confirmation cards. “Only deferred Tasks” is inaccurate. I have not established that those cards coexist with a preparable claim for the same Task, so this does not overturn the accepted omission; it also does not waive the remaining paging/capacity evidence.

**Verdict: merge after listed must-fix items.**