# Group A, round 2: shared fixture `tests/helpers/S5-decision-fixture.ts` only

Read RULES.md, ROUND2.md, review-rv3.md. Same constraints as fxA.md (keep every export and type; no test edits).
Fix exactly:

1. rv3 #1 (verified, spec §2.3 "source.pins不含消息自己的pin"): `:840` (message sources include their own
   message pin): remove the self pin from every stored question and answer source; the answer's captured pins are
   the objects only (A/B/C@7, U1@1, PB1@1 as before) with goalBases. Any helper that builds answer request pins
   returns the current message pin + the source pins, each once.
2. rv3 #2 (verified, §2.3 "沿用 SessionMessageSent/Responded@1，新增 SessionMessageDecisionAnswered@1（合成答复）"):
   `:890` seeds the ordinary answered message (pending@1 → responded@2) with `SessionMessageDecisionAnswered`;
   use the `SessionMessageResponded` event (actor = the Host operator; the codec accepts it now, D9). Keep the
   two-commit history and the captured versions.

Update the header comment. List changed values in your answer.
