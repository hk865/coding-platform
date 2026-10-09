FILES:

- [tests/work-graph/S5-user-messages.test.ts](D:/cxt/impl-s5-fx7b/tests/work-graph/S5-user-messages.test.ts)
- [tests/business/S5-decision-workflow.test.ts](D:/cxt/impl-s5-fx7b/tests/business/S5-decision-workflow.test.ts)

No other files changed. Preserved all 22 cases and UM memory/SQLite coverage. No Node, npm, npx, typecheck, or tests ran.

PER CASE:

| Case | Status and history | Expected first part-1 stub |
|---|---|---|
| UM01 | KEPT — adviser sends through mailbox owner | `sendUserMessage` |
| UM02 | KEPT — executor send; persisted zero-write comparison | `sendUserMessage` |
| UM03 | REWRITTEN — notify; false flags strictly absent; stored Task preserved | `sendUserMessage` |
| UM04 | KEPT — forged duties against trusted executor facts | `sendUserMessage` |
| UM05 | KEPT — absent duties; legacy `sendMessage` control | `sendUserMessage` |
| UM06 | KEPT — real send → answer → body/Task/Plan reads | `sendUserMessage` |
| UM07 | KEPT — same-request answer replay; event and allocation checks | `sendUserMessage` |
| UM08 | REWRITTEN — synchronized answer race; exact winning text read back | `sendUserMessage` |
| UM09 | KEPT — real send → oversized answer | `sendUserMessage` |
| UM10 | KEPT — legacy send → user-answer rejection → work-run response | `answerDecision` |
| UM11 | KEPT — answer → reread responded@2 → fresh-request rejection | `sendUserMessage` |
| UM12 | KEPT — legacy codec seed → real ack → replay | Expected passes in part 1: existing legacy path |
| UM13 | KEPT — send/answer status indexes; same-file SQLite reopen | `sendUserMessage` |
| TU01 | KEPT — tool calls real adviser owner and registers wait | `send_user_message` handler |
| TU02 | KEPT — strict tool arguments reject forged operator | `send_user_message` handler |
| TU03 | KEPT — tool preserves executor rejection | `send_user_message` handler |
| TU04 | KEPT — entered RB → send/answer → wire/body/input reads | `sendUserMessage` |
| TU05 | KEPT — send/answer → supply → real input acceptance → resupply | `sendUserMessage` |
| TU06 | KEPT — real answer; tool names and read-only reader | `sendUserMessage` |
| TU07 | KEPT — authorized RB enters inside pump; Session positive control | `sendUserMessage` |
| WF01 | REWRITTEN — settings → S5-bound crash owner → eligibility check → Workflow/store comparison | `setGoalSettings` |
| WF02 | REWRITTEN — reorder → real idle Session → ordering/store comparison | `reorderGoals` |

FINDINGS:

- **1 / rv3 #8 — DONE:** UM03 checks absent flags.
- **2 / rv3 #12 — DONE:** UM08 associates each result with its request and verifies the winner’s exact body.
- **3 / rv3 #13 — DONE:** WF01/WF02 compare persisted snapshots immediately around Workflow calls; WF01 retains the requeue-call assertion.
- **4 / source pins — DONE:** audited unchanged helper; sources exclude self-pins, answer requests carry the message pin separately.

UNDETERMINED:

- None.

RISKS:

- Static verification only. Lead should execute WF01’s revised crash/eligibility setup at `tests/business/S5-decision-workflow.test.ts:175`.
- Runtime tool setup retains the sandbox prerequisite at `tests/runtime/S5-user-message-tools.test.ts:67`.
- Shared-fixture source/event corrections described in ROUND2 must be integrated separately; that file was outside this group’s write scope.