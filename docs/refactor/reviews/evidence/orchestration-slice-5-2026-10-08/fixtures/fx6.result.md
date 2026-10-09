**FILES**

- Rewritten [S5-decision-queue.test.ts](/D:/cxt/impl-s5-fx6/tests/work-graph/S5-decision-queue.test.ts)
- Rewritten [S5-notices.test.ts](/D:/cxt/impl-s5-fx6/tests/work-graph/S5-notices.test.ts)
- Created [S5-queue-support.ts](/D:/cxt/impl-s5-fx6/tests/helpers/S5-queue-support.ts)

Only these files changed. No Node, npm, npx, typecheck or tests ran.

**PER CASE**

All cases retain memory and SQLite coverage. First failures below are expected from static inspection.

| Case | Status and history | First expected part-1 stub |
|---|---|---|
| DQ01 | REWRITTEN: real budget exhaustion, answered Query, existing candidates/conflict; six kinds checked | `queryDecisionQueue` |
| DQ02 | REWRITTEN: budget cause, abandonment with exact pins | `abandonPlanProposal` |
| DQ03 | REWRITTEN: separate uninitialized scope, real Goal creation | `queryDecisionQueue` |
| DQ04 | REWRITTEN: answer → settle RA → archive sender | `queryDecisionQueue` |
| DQ05 | REWRITTEN: user send → defer answer; natural message key | `sendUserMessage` |
| DQ06 | REWRITTEN: real pause → answer; stored Goal/Plan/Runs compared | `answerDecision` |
| DQ07 | REWRITTEN: populate sources → cancel; all history/actions/counts checked | `queryDecisionQueue` |
| DQ08 | REWRITTEN: direct card and queue compared before/after answer | `readDecisionCard` |
| DQ09 | REWRITTEN: reopen, paginate, refresh; store and model-request evidence compared | `queryDecisionQueue` |
| NR01 | REWRITTEN: real system/agent/human requeues and automatic reverify | automatic-rework `readPage` |
| NR02 | REWRITTEN: retained read/mark/reread sequence; saved watermark checked | `queryDecisionQueue` |
| NR03 | REWRITTEN: merged truncation, token inspection, forged mark rejection | `queryDecisionQueue` |
| NR04 | REWRITTEN: real Session send/ack; creation cursor retained through adapter | `queryDecisionQueue` |
| NR05 | REWRITTEN: real requeues, legacy serialization, read-boundary corruption | `decodeNoticeOrigin` |
| NR06 | REWRITTEN: save both categories, reopen, reread stored messages | `queryDecisionQueue` |
| NR07 | REWRITTEN: real three-successor chain; Task head and all notices checked | automatic-rework `readPage` |
| NR08 | REWRITTEN: legacy automatic round; actual policy resolver cap changed | automatic-rework `readPage` |

**FINDINGS**

- DONE — DQ01 real planning Query, six source kinds, keys/options/actions and unavailable capabilities.
- DONE — DQ02 exact abandonment pins and concrete RUNNING cause.
- DONE — DQ04 settlement before archival.
- DONE — DQ05 natural source key.
- DONE — DQ07 complete cancellation assertions.
- DONE — DQ09 actual-store observations and persistent model-request counters.
- DONE — NR01/07/08 production-generated histories, accumulated basis digests and head projection.
- DONE — NR04 real acknowledgement and only delivered positions marked; scope limitation below.
- DONE — NR06 independent saved settings, reopening and stored-message comparison.
- DONE — NR03 merged-page truncation and forged submission.
- DONE — NR08 current policy cap mutation.
- DONE — NR02 read/mark/reread and NR05 boundary-corruption coverage preserved.
- DONE — duplicate schema registration removed.
- DONE — DQ03 given separated from the initialized shared fixture.
- DONE — missing answered-planning-Query helper implemented.

**UNDETERMINED**

- DQ01: spec lines **629, 774** do not enumerate every affected pin for `budget_exhausted` or complete per-source action arrays. Assertions cover the specified identity fields and required actions.
- NR04: spec lines **841, 1120** name user notices and acknowledgement, but existing `ackMessage` authorizes only a recipient Session Run. The case uses a real Session message with an explicit notice adapter.

**RISKS**

- Runtime verification remains outstanding for the [Query setup](/D:/cxt/impl-s5-fx6/tests/helpers/S5-queue-support.ts:162), [delegated controller](/D:/cxt/impl-s5-fx6/tests/helpers/S5-queue-support.ts:319) and [reverify chain](/D:/cxt/impl-s5-fx6/tests/helpers/S5-queue-support.ts:383).
- [Legacy serialization](/D:/cxt/impl-s5-fx6/tests/helpers/S5-queue-support.ts:255) preserves owner-generated domain histories while omitting old wire metadata.
- [NR04’s adapter](/D:/cxt/impl-s5-fx6/tests/work-graph/S5-notices.test.ts:95) does not verify production user-notice discovery.
- [Model counters](/D:/cxt/impl-s5-fx6/tests/helpers/S5-queue-support.ts:76) observe formal attempts/admissions in the actual store; they are not provider-level instrumentation.