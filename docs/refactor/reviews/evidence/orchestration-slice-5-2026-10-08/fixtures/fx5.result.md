**FILES**

- Rewritten: [S5-decision-application.test.ts](D:/cxt/impl-s5-fx5/tests/work-graph/S5-decision-application.test.ts)
- Rewritten: [S5-request-candidates.test.ts](D:/cxt/impl-s5-fx5/tests/work-graph/S5-request-candidates.test.ts)
- Created: [S5-application-support.ts](D:/cxt/impl-s5-fx5/tests/helpers/S5-application-support.ts)

Only these files were edited. Preserved all 25 cases and both backends.

**PER CASE**

First stops below are static expectations, not executed results.

| Case | Status and history | Expected first Part-1 stop |
|---|---|---|
| AP01 | REWRITTEN — real Goal cause, concurrent answers, persisted synthetic claim | `readGoalDecisionCauses` |
| AP02 | REWRITTEN — answer → acknowledged reorder → pending queue | `answerDecision` |
| AP03 | REWRITTEN — reorder receipt, exact proof, pending-count decrement | `reorderGoals` |
| AP04 | REWRITTEN — scope-only receipt; persisted zero writes | `recordDecisionApplication` |
| AP05 | REWRITTEN — settings change creates wrong content version | `setGoalSettings` |
| AP06 | REWRITTEN — reorder → intercepted application commit → reopen/recover | `reorderGoals` |
| AP07 | REWRITTEN — adopt U1 with acknowledgement, apply, later settings write, replay | `recordDecisionApplication` |
| AP08 | REWRITTEN — consistent automation context; zero writes | `answerDecision` |
| AP09 | REWRITTEN — pause → conflict answer → resume → risk application | `queryGoalConflicts` |
| AP12 | REWRITTEN — real receipt with intercepted corrupt event read | `reorderGoals` |
| AP13 | REWRITTEN — two real receipts with mismatched cursor | `reorderGoals` |
| AP14 | REWRITTEN — operator modification, unrelated Work caller | `reorderGoals` |
| AP15 | REWRITTEN — complete application replay; unchanged allocations/store | `reorderGoals` |
| AP16 | REWRITTEN — second real modification; original application preserved | `reorderGoals` |
| RC01 | REWRITTEN — request heads and actual queue cards | `readRequestCandidate` |
| RC02 | REWRITTEN — owner releases Q1; both first writers meet at commit barrier | `abandonPlanProposal` |
| RC03 | REWRITTEN — intercept actual replacement claim; verify atomic rollback | Missing replacement/slot behavior |
| RC04 | REWRITTEN — one receipt contains both versions, events and slot transfer | Missing replacement/slot behavior |
| RC05 | REWRITTEN — adopt valid U1; inspect stale Q2 actions | `readRequestCandidate` |
| RC06 | REWRITTEN — abandon/replay; new first candidate proves released slot | `abandonPlanProposal` |
| RC07 | REWRITTEN — real foreign-Goal request; persisted zero writes | Missing request/Goal validation |
| RC08 | REWRITTEN — abandon, independent proposal/adoption, reopen/rebuild | `abandonPlanProposal` |
| RC09 | REWRITTEN — old-v2 codec seed and production read; strict field absence | `candidateRequestRef` |
| RC10 | REWRITTEN — retained foreign-read interception; persisted observations | `readRequestCandidate` |
| RC11 | REWRITTEN — complete typed legacy record; unchanged fields/claims | `candidateRequestRef` |

**FINDINGS**

- Operator configuration — **DONE**.
- Exact pins and setup-result assertions — **DONE**.
- AP07/RC05 admissible adoption and legitimate later writes — **DONE**.
- AP01 cause/claim, AP03 exact proof/count, AP06 failure evidence, AP09 rebase — **DONE**.
- Persisted zero-write and complete replay observations — **DONE**.
- AP13 real cursor and AP16 preserved application — **DONE**.
- RC queue, stale actions, slot release, concurrency, coherent closure and compatibility assertions — **DONE**.
- RC03/RC04 D2 atomic records/events/claim semantics — **DONE**.
- RC10 foreign-read protection — **DONE**.

**UNDETERMINED**

- AP02/AP03/AP06 and RC01/RC05 require message/candidate queue projection (§4.2, lines 779–782), but Part 1 exposes only cause/planning adapter factories. The helper follows production composition wiring; production must provide the required projections without fabricated test cards.

**RISKS**

- No Node, npm, npx, tests or typecheck ran. Static import-path, case-count and prohibited-pattern checks completed.
- Lead should execute the adoption setup at AP:66, cause read at AP:134, Goal control at helper:120, and RC08 adoption at RC:242.
- AP09’s conflict projection uses the shared fixture’s legacy baseline without a catalog; handling this setup under §4.3 remains unverified.