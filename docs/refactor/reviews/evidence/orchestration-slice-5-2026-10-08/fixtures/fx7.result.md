**FILES**

- Rewritten [S5-user-messages.test.ts](D:/cxt/impl-s5-fx7/tests/work-graph/S5-user-messages.test.ts).
- Rewritten [S5-user-message-tools.test.ts](D:/cxt/impl-s5-fx7/tests/runtime/S5-user-message-tools.test.ts).
- Created [S5-user-message-support.ts](D:/cxt/impl-s5-fx7/tests/helpers/S5-user-message-support.ts).

Only these three files were edited. All 13 UM and 7 TU cases remain; UM retains both backends. No Node, npm, npx, tests, or typecheck ran.

**PER CASE**

First-stop entries below are expected, not executed results.

| Case | Status and setup | Expected first part-1 stop |
|---|---|---|
| UM01 | REWRITTEN — adviser sends through real mailbox | `sendUserMessage` |
| UM02 | REWRITTEN — executor send; actual store comparison | `sendUserMessage` |
| UM03 | REWRITTEN — stored Task read before/after notify | `sendUserMessage` |
| UM04 | REWRITTEN — forged duties against trusted executor | `sendUserMessage` |
| UM05 | REWRITTEN — absent duties; legacy `sendMessage` retained | `sendUserMessage` |
| UM06 | REWRITTEN — real send→answer; body and Task/Plan rereads | `sendUserMessage` |
| UM07 | REWRITTEN — real send; two owners answer/replay | `sendUserMessage` |
| UM08 | REWRITTEN — real send; preserved two-commit barrier | `sendUserMessage` |
| UM09 | REWRITTEN — real send; oversized answer | `sendUserMessage` |
| UM10 | REWRITTEN — legacy send→user answer rejection→work-run response | `answerDecision` |
| UM11 | REWRITTEN — answer→reread responded@2→fresh request | `sendUserMessage` |
| UM12 | REWRITTEN — old codec seed→real ack→replay | Expected pass: existing legacy path |
| UM13 | REWRITTEN — send→answer→status indexes→SQLite reopen | `sendUserMessage` |
| TU01 | REWRITTEN — tool invokes admitted adviser owner | `send_user_message` handler |
| TU02 | REWRITTEN — strict schema and owner-call observation | `send_user_message` handler |
| TU03 | REWRITTEN — tool invokes admitted executor owner | `send_user_message` handler |
| TU04 | REWRITTEN — enter Run→send→answer→wire/read/supply | `sendUserMessage` |
| TU05 | REWRITTEN — enter Run→send→answer→supply→real acceptance | `sendUserMessage` |
| TU06 | REWRITTEN — send→answer→real read tool | `sendUserMessage` |
| TU07 | REWRITTEN — authorize→driver→enter→send; real consumer and pump | `sendUserMessage` |

**FINDINGS**

- DONE — UM duties use the typed D3 seam; UM05 omits it.
- DONE — UM12 uses absent-field legacy data, fixed DTO/receipt expectations, strict absence checks, unchanged claims and replay allocations.
- DONE — UM03/06 reread stored Task state; UM07 identifies the response event and checks allocations.
- DONE — zero-write assertions compare actual `storeSnapshot()` results.
- DONE — UM08 barrier and UM11 current-pin behavior preserved.
- DONE — TU duties use the typed seam.
- DONE — TU05 uses pending@1→responded@2 with that message’s source, exact formatting and original input ID.
- DONE — TU04 requires the original body; no assertion-skipping return.
- DONE — TU01/03 real admission, TU06 real readers, and TU07 matching-profile pump coverage retained.

**UNDETERMINED**

None in the assigned spec rows.

**RISKS**

- [Runtime fixture:67](D:/cxt/impl-s5-fx7/tests/runtime/S5-user-message-tools.test.ts:67) creates a real `WorkspaceSandbox`; its existing implementation requires Linux `/proc/self/fd`. Lead execution needs that supported environment.
- Untouched shared fixture still includes self pins at [line 840](D:/cxt/impl-s5-fx7/tests/helpers/S5-decision-fixture.ts:840) and uses the synthetic-answer event for an ordinary response at [line 890](D:/cxt/impl-s5-fx7/tests/helpers/S5-decision-fixture.ts:890). Assigned operations use freshly sent messages, but the shared initialization remains outside my edit scope.
- [TU07 runtime preparation:246](D:/cxt/impl-s5-fx7/tests/runtime/S5-user-message-tools.test.ts:246) and [Task reread:47](D:/cxt/impl-s5-fx7/tests/work-graph/S5-user-messages.test.ts:47) were checked against current guards statically; the lead must confirm them through execution.