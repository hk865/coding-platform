# Group 5, round 2: `tests/work-graph/S5-decision-application.test.ts`, `S5-request-candidates.test.ts`, `tests/helpers/S5-application-support.ts`

Read RULES.md, ROUND2.md, review-rv3.md. Same file permissions as fx5.md.

1. rv3 #9 (verified against rows): AP15 (`:408`) row = "AP03补记成功后，新requestId、同一receipt再补记 → 返回的
   application与AP03深等；message revision不变": a NEW identity with the same application is a no-op (§3.1
   S5-MSG-04 "同一 application 新身份 no-op"): assert the returned application deep-equals AP03's and the message
   revision is unchanged; do NOT require `replayed:true`/the original cursor for a new requestId. AP07 (`:297`) row
   = "应用后对象再变版，补同原receipt → 仍可证明历史应用；changes.after为原版本": same treatment; if you also cover
   a true replay, resend the ORIGINAL identity with the ORIGINAL pins.
2. rv3 #14: AP12 (`:369`) freezes the number of `eventAt` reads; require only that the corruption hook was
   reached; keep `unavailable`, application null and 0 writes.
3. ROUND2 §2.3 note: never place the message's own pin in `source.pins`; answer requests carry it in
   `meta.expected`. Check every answer/application request in your files.
4. Optional (D8): where a row applies a Plan change attributed to an answer, you may pass `decisionSource` (the
   answer's response.decision.source); only assert proof fields the row states.
