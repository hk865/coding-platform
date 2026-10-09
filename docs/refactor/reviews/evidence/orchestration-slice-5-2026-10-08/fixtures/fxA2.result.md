FILES: Changed only [tests/helpers/S5-decision-fixture.ts](D:/cxt/impl-s5-fxA2/tests/helpers/S5-decision-fixture.ts). All exports and types preserved.

PER CASE (fixture duties):

- Duty 1 — REWRITTEN: Both question sources and the answered response source now capture exactly A/B/C@7, U1@1, PB1@1, with Goal bases. Removed message self-pins; documented the separate current message pin for answer requests.
- Duty 2 — REWRITTEN: Preserved the two `seedCommit` operations and real codecs: `SessionMessageSent` pending@1 → `SessionMessageResponded` responded@2, retaining the Host operator actor. First expected failure is the existing codec guard below, before any stub.

FINDINGS:

- rv3 #1 — DONE.
- rv3 #2 — DONE in the fixture; production validation remains blocked.
- Header and helper contract comments updated. Static comparison confirms only the intended edits.

UNDETERMINED: None.

RISKS: **D9 is incomplete in this checkout.** [message-record-codecs.ts:837](D:/cxt/impl-s5-fxA2/src/core/work-graph/sessions/message-record-codecs.ts:837) calls `checkResponseSender`, which rejects Host actors at [line 313](D:/cxt/impl-s5-fxA2/src/core/work-graph/sessions/message-record-codecs.ts:313), before reaching D9’s exception. The corrected seed at [fixture line 891](D:/cxt/impl-s5-fxA2/tests/helpers/S5-decision-fixture.ts:891) therefore cannot currently commit. This requires a lead source correction outside my allowed scope.

No Node, npm, npx, typecheck, or tests were run.