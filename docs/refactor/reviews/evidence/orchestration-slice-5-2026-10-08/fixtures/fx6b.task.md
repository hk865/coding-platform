# Group 6, round 2: `tests/work-graph/S5-decision-queue.test.ts`, `S5-notices.test.ts`, `tests/helpers/S5-queue-support.ts`

Read RULES.md, ROUND2.md, review-rv3.md. Same file permissions as fx6.md.

1. rv3 #4 (verified by run: DQ01/DQ07 fail at setup, `initial_coordination requires a Goal without an active
   Plan`, `query-job-service.ts:704–705`; and `plan-service.ts:967–968` requires initial_coordination for the
   formal planning answer reader). Lead decision: the planning question lives on a FOURTH Goal D of P/W created
   through the real Goal creation owner (no Plan; default settings), with a real answered `initial_coordination`
   Query (needs_decision, at least one question). Check in `plan-service.ts` `queryGoalDisplay` (about :1743, the
   `plan === null` branch) that a Goal without plan/proposal adds no other waiting card; DQ01 then counts
   message (B), cause (B), Q1/Q2 candidates (B), planning question (D), conflict (A/B) = 6. DQ07 ("cancelled Goal
   全来源读取"): cancel B and read B's sources (and, if you keep the planning source in DQ07, cancel D too);
   assert exactly the row.
2. rv3 #5: DQ01/DQ07 create `budget_exhausted` in addition to the existing `change_pending` cause (U1/U2 pending
   against PB1; AP01 relies on `change_pending`): use the existing `change_pending` as the single cause; keep
   DQ02's budget cause (it abandons both candidates).
3. rv3 #6: DQ06 answers with the pre-pause source (B@7) after the pause moved B to @8: reread the canonical card
   after pausing and answer its current source; the answer captures B@8 (§2.3 "readDecisionCard 在当前窗口生成
   答复 source").
4. rv3 #10 (NR04). Lead decision on the row "某message创建cursor10，后ack cursor20 → notice.position仍cursor10；
   已看后ack不再出一次": in this slice member notices come only from user-recipient `intent: notify` messages
   (§4.4 item 5); a Session mailbox ack does not apply to them. Use a REAL user notify message (sent through
   `sendUserMessage`; part-1 stub, allowed) as the member notice, create a later commit, and use the
   `markNoticesSeen` acknowledgement as the "ack": the notice keeps its creation position, and after it is
   marked seen it is not listed again. Use the production member-notice projection of the read model (no
   test-side projector computing `position` from `since`).
5. rv3 #11 (NR06): back the displayed member notices with real saved user notify messages and compare exactly
   those records (status/response/application) across marking and the SQLite reopen.
6. ROUND2 §2.3 note: no self pin inside `source.pins`.
