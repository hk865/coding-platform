**FILES**

- [S5-decision-queue.test.ts](D:/cxt/impl-s5-fx6b/tests/work-graph/S5-decision-queue.test.ts)
- [S5-notices.test.ts](D:/cxt/impl-s5-fx6b/tests/work-graph/S5-notices.test.ts)
- [S5-queue-support.ts](D:/cxt/impl-s5-fx6b/tests/helpers/S5-queue-support.ts)

**PER CASE**

Expected first stubs below are based on static inspection.

| Case | Status and construction | First stub |
|---|---|---|
| DQ01 | REWRITTEN: create Goal D; submit/claim/prepare/enter/answer Query; retain B’s `change_pending` | `queryDecisionQueue` |
| DQ02 | KEPT: exhaust RB, abandon both candidates, inspect RUNNING cause | `abandonPlanProposal` |
| DQ03 | KEPT: real Goal creation before architecture adoption | `queryDecisionQueue` |
| DQ04 | REWRITTEN: corrected answer pins; answer, settle RA, archive sender | `queryDecisionQueue` |
| DQ05 | REWRITTEN: send valid two-option question, answer defer | `sendUserMessage` |
| DQ06 | REWRITTEN: pause, reread canonical card, answer and verify captured B@8 | `readDecisionCard` |
| DQ07 | REWRITTEN: B’s five sources plus D’s planning question; cancel both | `queryDecisionQueue` |
| DQ08 | REWRITTEN: corrected answer pins; compare both read entrances | `readDecisionCard` |
| DQ09 | KEPT: reopen, page fully, refresh, compare durable state and counters | `queryDecisionQueue` |
| NR01 | KEPT: real system/agent/human requeues and automatic reverify | automatic-rework `readPage` |
| NR02 | KEPT: category pagination, production token and markSeen | `queryDecisionQueue` |
| NR03 | KEPT: merged truncation, forged watermark rejection, durable observations | `queryDecisionQueue` |
| NR04 | REWRITTEN: real user notify, later Session commit, production projection, markSeen acknowledgement | `sendUserMessage` |
| NR05 | KEPT: real legacy/new requeues and read-boundary corruption | `decodeNoticeOrigin` |
| NR06 | REWRITTEN: two real user notifications plus real requeue; preserve those messages through marking/reopen | `sendUserMessage` |
| NR07 | KEPT: real finalized predecessor chain; head R4 and three notices | automatic-rework `readPage` |
| NR08 | KEPT: real legacy reverify; change current policy, retain unknown historical cap | automatic-rework `readPage` |

**FINDINGS**

- fx6b #1: DONE — planning Query uses newly created, planless Goal D.
- #2: DONE — DQ01/DQ07 retain only `change_pending`; DQ02 retains budget exhaustion.
- #3: DONE — DQ06 captures the canonical B@8 source.
- #4: DONE — removed the test-side member projector; NR04 uses production projection and markSeen.
- #5: DONE — NR06 compares the displayed notifications’ exact saved records.
- #6: DONE within scope — answer requests carry one separate message pin; source pins are neither filtered nor deduplicated.

**UNDETERMINED**

- DQ01: spec lines 629/781 do not enumerate the complete affected-pin set or action list for `change_pending`. Assertions retain the concrete proposal pin, cause identity and required action.

**RISKS**

- The separate shared-fixture correction remains pending locally: [line 840](D:/cxt/impl-s5-fx6b/tests/helpers/S5-decision-fixture.ts:840) still inserts a self-pin; [line 890](D:/cxt/impl-s5-fx6b/tests/helpers/S5-decision-fixture.ts:890) still uses the synthetic-answer event. Neither file was edited.
- The newly reachable Query chain at [support line 187](D:/cxt/impl-s5-fx6b/tests/helpers/S5-queue-support.ts:187) was checked against current guards but not executed.
- All 17 case IDs and both backend variants remain. No Node, npm, npx, typecheck or tests ran.