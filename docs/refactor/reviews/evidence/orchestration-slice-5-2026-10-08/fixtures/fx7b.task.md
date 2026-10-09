# Group 7, round 2: `tests/work-graph/S5-user-messages.test.ts`, `tests/runtime/S5-user-message-tools.test.ts`, `tests/helpers/S5-user-message-support.ts`, and `tests/business/S5-decision-workflow.test.ts`

Read RULES.md, ROUND2.md, review-rv3.md. Same permissions as fx7.md, plus `tests/business/S5-decision-workflow.test.ts`
(WF01, WF02; spec §5.4 rows at lines 1132–1133).

1. rv3 #8 (verified against `state/message-machine.ts` createSessionMessageRecord and
   `tests/state/message-machine.test.ts:925–927`): UM03 (`:127`) requires materialized `needsReply:false` /
   `waitAfterSend:false`; the existing constructor omits false flags. Assert the established absent-field shape.
2. rv3 #12: UM08 (`:215`) never checks that the stored/returned response is the winner's text: identify the
   committed request and read back exactly its body text.
3. rv3 #13: WF01/WF02 (`S5-decision-workflow.test.ts:223,265`) assert commit-call counters: compare
   `storeSnapshot()` around each Workflow call (records/events/claims increment 0); keep WF01's explicit
   requeue-owner-call assertion.
4. ROUND2 §2.3 note: no self pin inside `source.pins`; answer requests carry the current message pin in
   `meta.expected`.
