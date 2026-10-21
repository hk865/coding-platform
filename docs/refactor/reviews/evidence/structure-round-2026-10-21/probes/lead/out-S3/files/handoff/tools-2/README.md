# tools-2 handoff (S3 / D3a)

15 tool files under `tools/<name>.json`, shape `{ "description": "...", "parameters": { ... } }`, with the final
expanded text cut from `s85-base`. `strings.json` is empty.

Consumers already changed (in the working copy): `communication-tools.ts`, `graph-tools.ts`,
`session-discovery-tools.ts`, `unknown-call-review-tools.ts` read `PLATFORM_PROMPT_PACK_V1.tools.<name>`; only the
`.describe(...)` string arguments changed, Zod chains/field order/generation unchanged.

| tool name | resource key | base location |
| --- | --- | --- |
| send_session_message | tools/send_session_message.json | communication-tools.ts:391 |
| read_session_inbox | tools/read_session_inbox.json | communication-tools.ts:391 |
| read_session_message | tools/read_session_message.json | communication-tools.ts:391 |
| read_session_message_body | tools/read_session_message_body.json | communication-tools.ts:391 |
| ack_session_message | tools/ack_session_message.json | communication-tools.ts:391 |
| respond_session_message | tools/respond_session_message.json | communication-tools.ts:391 |
| send_user_message | tools/send_user_message.json | communication-tools.ts:486 |
| read_user_decision | tools/read_user_decision.json | communication-tools.ts:486 |
| record_decision_application | tools/record_decision_application.json | communication-tools.ts:486 |
| look_graph | tools/look_graph.json | graph-tools.ts:327 |
| find_graph | tools/find_graph.json | graph-tools.ts:328 |
| find_related_sessions | tools/find_related_sessions.json | session-discovery-tools.ts:138 |
| read_session_card | tools/read_session_card.json | session-discovery-tools.ts:139 |
| record_unknown_call_review | tools/record_unknown_call_review.json | unknown-call-review-tools.ts:212; params :51,:53,:55,:59 |
| propose_safer_method | tools/propose_safer_method.json | unknown-call-review-tools.ts:298; params :68,:70,:72,:74 |

Parameter keys: `record_unknown_call_review` = item / verdict / evidence / crashSuspicion (the object's own
description at the object path); `propose_safer_method` = item / command / cwd (after `.optional()`) / rationale.
All other tool files have `parameters: {}` because they have no `.describe(...)`.

`verify.cjs` compares every description and parameter string with the base literals and reports OK for all 15.

UNSPECIFIED: none.
