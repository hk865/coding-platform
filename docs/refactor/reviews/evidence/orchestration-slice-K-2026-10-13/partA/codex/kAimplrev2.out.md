**Merge after listed fixes.** I changed no files, ran no tests, and called no models. I accept the lead’s reported WSL results: 291 files, 6,035 tests passing; typecheck and kernel-patch check exit 0. This assessment is from patch-source and test review.

The remaining problems are:

1. **Must fix before merge — finding 1 is only partially fixed: cross-Session reads still expand beyond the recorded window.**  
   [continuation-brief-assembly.ts:243](D:/cxt/kA-review/src/core/agent-runtime/continuation-brief-assembly.ts:243) reads to the Session tail whenever `endPosition` is null; line 258 then adopts the interrupted closure boundary without checking `sameSession`. Thus the branch reached with `sameSession: false` still applies the expanded interrupted-Turn window. This contradicts D1/L9’s explicit restriction and can make an otherwise readable recorded window depend on later records.

   **Fix:** retain `endPosition ?? observedThroughPosition` for the ordinary platform-window path. Expand to the identity-derived closure window only for the qualifying same-Session case. Derive state and accepted messages from that same selected window.

2. **Must fix before merge — finding 2 still misses an attested intermediate ancestor.**  
   [context-assembler.ts:743](D:/cxt/kA-review/src/core/agent-runtime/context-assembler.ts:743) selects `factsChain.at(-1)` and only checks whether the immediate `previous` Run entered. The chain builder still walks past every locator-less Run at [run-state-service.ts:904](D:/cxt/kA-review/src/core/work-graph/tasks/run-state-service.ts:904).

   Reachable sequence: R1 entered → R2 entered without a saved locator, then was attested → R3 never entered and was requeued → R4 prepares. The chain contains R2 and R1, but R4 selects R1 without checking R2’s identity. R2’s accepted facts disappear.

   **Fix:** inspect candidates nearest-first, distinguishing entry before selecting the source. Compute `sameSession` against the selected candidate’s Session, rather than reusing the comparison with the immediate predecessor. Extend the public D2 scenario with the intervening never-entered Run.

3. **Must fix before merge — new acceptance tests again bypass the required entry.**  
   The D8 tests import private assembly helpers at [K-R-previous-turn-bounds.test.ts:26](D:/cxt/kA-review/tests/composition/K-R-previous-turn-bounds.test.ts:26), fabricate Session/Run/requeue records at lines 63–102, and assert direct helper results at lines 117–140. They do not exercise Runtime preparation.

   D4 likewise directly constructs observers and fabricates Work/Query records at [K-R-observers-kernel-closed.test.ts:80](D:/cxt/kA-review/tests/composition/K-R-observers-kernel-closed.test.ts:80) and line 126. New health/capability cases also use fabricated platform records: [K-R-close-open-turn-health.test.ts:48](D:/cxt/kA-review/tests/composition/K-R-close-open-turn-health.test.ts:48), and the D5/D6 additions at [K-R-close-open-turn.test.ts:221](D:/cxt/kA-review/tests/composition/K-R-close-open-turn.test.ts:221).

   **Fix:** create platform state through public flows; invoke Runtime preparation/observation or Host routes. For D4, close the real live Turn through the public Kernel boundary, then observe through Runtime. Keep boundary instrumentation for zero-write assertions.

4. **Should fix — KA-05’s third refusal can pass for the wrong reason.**  
   [K-interrupted-history.test.ts:429](D:/cxt/kA-review/tests/kernel/K-interrupted-history.test.ts:429) uses generic `.rejects.toThrow()`. A later identity/duplicate-record failure could satisfy it even if interrupted Turns stopped participating in the history-overlap check.

   **Fix:** assert the specific history-prefix/current-Turn conflict, identified at [session-history.ts:395](D:/cxt/kA-review/vendor/coding-agent/patches/core/ports/session_store/session-history.ts:395).

5. **Should fix — some requested exclusion/fallback assertions remain missing.**  
   The archive-request case only asserts the final archived lifecycle at [K-W-maintenance.test.ts:169](D:/cxt/kA-review/tests/scenarios/K-W-maintenance.test.ts:169); it does not establish that closure never happened first. The four KA-12 cause cases assert successor selection, transfer and history verdicts, but omit predecessor archival assertions, starting at [K-W-workflow-close.test.ts:421](D:/cxt/kA-review/tests/scenarios/K-W-workflow-close.test.ts:421).

   **Fix:** add public predecessor/archive observations and boundary closure instrumentation where needed. **Note:** the requested provenance exclusion remains untested. Current creation normalizes omitted provenance and rejects explicit null ([session-directory.ts:789](D:/cxt/kA-review/src/core/work-graph/sessions/session-directory.ts:789)); record an explicit lead qualification or use an approved legacy fixture, rather than marking the row fully covered.

Findings 1–6 resolve as follows. Test names below are shortened to their distinguishing text.

| Original finding | Assessment and test evidence |
|---|---|
| **1 / D1** | **Partial.** Exact interrupted identity/window and bounded accepted-message selection are implemented. “KA-09 … accepted message, applied steer and tool facts” — [K-R-interrupted-brief.test.ts:102](D:/cxt/kA-review/tests/scenarios/K-R-interrupted-brief.test.ts:102); “platform position … lags” — [K-R-attested-facts-source.test.ts:165](D:/cxt/kA-review/tests/scenarios/K-R-attested-facts-source.test.ts:165). Remaining problem 1 above. |
| **2 / D2** | **Partial.** Immediate attested predecessor fixed; intermediate ancestor remains. “entered, locator-less, attested requeue continuation” — [K-R-attested-facts-source.test.ts:75](D:/cxt/kA-review/tests/scenarios/K-R-attested-facts-source.test.ts:75). |
| **3 / D3** | **Fixed.** Collision reconciliation and post-bounds header read are present. “D3 reconciles a same-closure append collision” and “retryable conflict” — [K-close-open-turn.test.ts:384](D:/cxt/kA-review/tests/kernel/K-close-open-turn.test.ts:384), line 429. |
| **4 / D4** | **Production fixed; test entry needs correction.** Guards precede mailbox confirmation and writes. “D4 … Work observer” / “Query observer” — [K-R-observers-kernel-closed.test.ts:101](D:/cxt/kA-review/tests/composition/K-R-observers-kernel-closed.test.ts:101), line 122. |
| **5 / D5** | **Production fixed; fabricated-record test caveat.** Both capabilities resolved per call. Independent absence tests — [K-R-close-open-turn.test.ts:221](D:/cxt/kA-review/tests/composition/K-R-close-open-turn.test.ts:221), line 231; getter-toggle test — [K-R-close-open-turn-health.test.ts:144](D:/cxt/kA-review/tests/composition/K-R-close-open-turn-health.test.ts:144). |
| **6 / D6** | **Production fixed; same test caveat.** Available-Session `host_config` becomes `transient`. “maps … host_config” — [K-R-close-open-turn.test.ts:241](D:/cxt/kA-review/tests/composition/K-R-close-open-turn.test.ts:241). |

The previously flagged acceptance rows:

| Row | Assessment; test name and location |
|---|---|
| **KA-02** | **Fixed:** handwritten bounds/revisions. “returns the table’s row 1–4 and 6” — [K-close-open-turn.test.ts:85](D:/cxt/kA-review/tests/kernel/K-close-open-turn.test.ts:85). |
| **KA-05** | **Partial:** third public refusal added; tighten its assertion. “keeps the boundaries right…” — [K-interrupted-history.test.ts:262](D:/cxt/kA-review/tests/kernel/K-interrupted-history.test.ts:262). |
| **KA-06** | **Fixed:** real pending tool work, execution counter and append instrumentation; removed checkpoint/readback assertions. “replays an interrupted identity…” — [K-interrupted-history.test.ts:488](D:/cxt/kA-review/tests/kernel/K-interrupted-history.test.ts:488). |
| **KA-09** | **Partial:** four public variants added at the D1/D2 locations above and “Host restart between close and claim” — [K-R-interrupted-brief.test.ts:138](D:/cxt/kA-review/tests/scenarios/K-R-interrupted-brief.test.ts:138). Ancestor gap and new D8 private tests remain. |
| **KA-10** | **Partial:** “successor exclusion … closure enabled” — [K-W-fallback.test.ts:92](D:/cxt/kA-review/tests/scenarios/K-W-fallback.test.ts:92); “operator archive request” — [K-W-maintenance.test.ts:139](D:/cxt/kA-review/tests/scenarios/K-W-maintenance.test.ts:139). See problem 5. |
| **KA-11** | **Fixed:** exact one-shot read fault, explicit waiting and recovery. “KA-11 (a)” / “(b)” — [K-W-workflow-close.test.ts:314](D:/cxt/kA-review/tests/scenarios/K-W-workflow-close.test.ts:314), line 340. |
| **KA-12** | **Partial:** four KE4 causes now present — “unreadable”, “another Run”, “legacy reader”, “adapter … no longer registered” at [K-W-workflow-close.test.ts:421](D:/cxt/kA-review/tests/scenarios/K-W-workflow-close.test.ts:421), lines 451, 477, 509. Archival assertions remain missing. |
| **KA-13** | **Fixed:** closure re-enabled before restart. “fallback … with closure now AVAILABLE” — [K-W-fallback.test.ts:39](D:/cxt/kA-review/tests/scenarios/K-W-fallback.test.ts:39). |
| **KA-14** | **Fixed:** public brief asserts the known call’s `outcome_unknown`. “decision 45/51 second phase” — [K-W-maintenance.test.ts:227](D:/cxt/kA-review/tests/scenarios/K-W-maintenance.test.ts:227). |
| **KA-15** | **Fixed:** actual append interference, waiting, no fallback, recovery. “real concurrent append…” — [K-W-workflow-close.test.ts:370](D:/cxt/kA-review/tests/scenarios/K-W-workflow-close.test.ts:370). |

**D7–D10:** D7’s retry/no-pin path is correct at [continuation-brief-assembly.ts:309](D:/cxt/kA-review/src/core/agent-runtime/continuation-brief-assembly.ts:309), covered by both “C3-R2 (W-25)” cases at [C3-brief-idempotency.test.ts:251](D:/cxt/kA-review/tests/scenarios/C3-brief-idempotency.test.ts:251), line 304. D8’s gate itself is correct: a selected Run with recorded end never requires identity lookup; null/absent ends remain eligible. Problem 2 can nevertheless skip the interrupted ancestor entirely. Its tests need replacement. D9’s exact reason and unchanged status are present at [session-operations.ts:1024](D:/cxt/kA-review/src/core/agent-runtime/session-operations.ts:1024). D10’s `open_checks` stop and assertion are present at [K-R-interrupted-brief.test.ts:111](D:/cxt/kA-review/tests/scenarios/K-R-interrupted-brief.test.ts:111); the other reviewed stops assert their intended stop or waiting settlement.

I found no additional production regression in Kernel closure/history handling, maintenance ordering, Workflow receipt/fallback classification, decision 54’s paused-line protection, or capability texts. No new direct store-readback assertions were found outside KE1; the private-helper/fabricated-record exceptions are identified above.

**Verdict: merge after listed fixes.**