# Import graph: src/core/work-graph

81 files, 37403 lines, 250 internal import edges (109 type-only).

## Groups

| group | files | lines |
| --- | ---: | ---: |
| (root) | 2 | 315 |
| architecture | 8 | 2990 |
| communication | 3 | 2927 |
| configuration | 6 | 3121 |
| evidence | 5 | 2052 |
| materials | 9 | 2880 |
| persistence | 7 | 2538 |
| queries | 4 | 3445 |
| sessions | 7 | 3625 |
| tasks | 30 | 13510 |

## Group edges

| from | to | value imports | type-only imports | examples |
| --- | --- | ---: | ---: | --- |
| (root) | materials | 0 | 2 | source-authority-ports.ts:7 -> materials/record-ports.ts (type)<br>source-authority-reader.ts:29 -> materials/record-ports.ts (type) |
| (root) | queries | 1 | 0 | source-authority-reader.ts:30 -> queries/query-record-codecs.ts |
| architecture | persistence | 4 | 0 | architecture/architecture-service.ts:48 -> persistence/record-codecs.ts<br>architecture/architecture-service.ts:49 -> persistence/commit-compiler.ts<br>architecture/catalog-service.ts:49 -> persistence/record-codecs.ts |
| architecture | tasks | 1 | 0 | architecture/catalog-record-codecs.ts:25 -> tasks/task-index.ts |
| communication | configuration | 0 | 1 | communication/contracts.ts:29 -> configuration/contracts.ts (type) |
| communication | materials | 0 | 1 | communication/contracts.ts:30 -> materials/contracts.ts (type) |
| communication | persistence | 1 | 0 | communication/mailbox-service.ts:49 -> persistence/record-codecs.ts |
| communication | queries | 1 | 0 | communication/mailbox-service.ts:70 -> queries/query-record-codecs.ts |
| communication | sessions | 2 | 2 | communication/contracts.ts:31 -> sessions/contracts.ts (type)<br>communication/mailbox-service.ts:50 -> sessions/session-record-codecs.ts<br>communication/mailbox-service.ts:51 -> sessions/contracts.ts (type) |
| communication | tasks | 4 | 4 | communication/contracts.ts:32 -> tasks/execution-entry-contracts.ts (type)<br>communication/contracts.ts:33 -> tasks/execution-read-contracts.ts (type)<br>communication/mailbox-service.ts:54 -> tasks/claim-contracts.ts (type) |
| configuration | persistence | 1 | 0 | configuration/project-bootstrap-service.ts:47 -> persistence/record-codecs.ts |
| configuration | tasks | 0 | 2 | configuration/project-bootstrap-contracts.ts:25 -> tasks/contracts.ts (type)<br>configuration/project-bootstrap-service.ts:46 -> tasks/contracts.ts (type) |
| evidence | architecture | 1 | 0 | evidence/evidence-service.ts:40 -> architecture/catalog-record-codecs.ts |
| evidence | materials | 0 | 1 | evidence/contracts.ts:36 -> materials/contracts.ts (type) |
| evidence | tasks | 6 | 3 | evidence/contracts.ts:37 -> tasks/execution-read-contracts.ts (type)<br>evidence/contracts.ts:38 -> tasks/contracts.ts (type)<br>evidence/coverage.ts:23 -> tasks/plan-task-basis.ts |
| materials | persistence | 4 | 0 | materials/record-readers.ts:38 -> persistence/record-codecs.ts<br>materials/record-readers.ts:39 -> persistence/execution-history-codecs.ts<br>materials/record-readers.ts:40 -> persistence/execution-entry-codecs.ts |
| materials | tasks | 0 | 2 | materials/grant-contracts.ts:36 -> tasks/contracts.ts (type)<br>materials/grant-service.ts:90 -> tasks/contracts.ts (type) |
| persistence | tasks | 0 | 4 | persistence/execution-entry-codecs.ts:26 -> tasks/claim-contracts.ts (type)<br>persistence/execution-entry-codecs.ts:27 -> tasks/execution-entry-contracts.ts (type)<br>persistence/execution-history-codecs.ts:35 -> tasks/execution-history-contracts.ts (type) |
| queries | communication | 1 | 1 | queries/contracts.ts:42 -> communication/contracts.ts (type)<br>queries/query-job-service.ts:59 -> communication/message-record-codecs.ts |
| queries | configuration | 0 | 1 | queries/contracts.ts:41 -> configuration/contracts.ts (type) |
| queries | materials | 1 | 0 | queries/query-record-codecs.ts:51 -> materials/record-readers.ts |
| queries | persistence | 2 | 0 | queries/query-execution.ts:39 -> persistence/record-codecs.ts<br>queries/query-job-service.ts:52 -> persistence/record-codecs.ts |
| queries | sessions | 1 | 0 | queries/query-execution.ts:41 -> sessions/session-record-codecs.ts |
| queries | tasks | 2 | 2 | queries/contracts.ts:43 -> tasks/contracts.ts (type)<br>queries/query-execution.ts:40 -> tasks/plan-record-codecs.ts<br>queries/query-execution.ts:54 -> tasks/contracts.ts (type) |
| sessions | architecture | 1 | 0 | sessions/session-targets.ts:20 -> architecture/catalog-service.ts |
| sessions | persistence | 1 | 0 | sessions/session-targets.ts:21 -> persistence/record-codecs.ts |
| sessions | tasks | 1 | 0 | sessions/session-directory.ts:58 -> tasks/run-state-service.ts |
| tasks | communication | 1 | 0 | tasks/claim-service.ts:50 -> communication/message-record-codecs.ts |
| tasks | configuration | 0 | 3 | tasks/claim-contracts.ts:14 -> configuration/contracts.ts (type)<br>tasks/execution-entry-contracts.ts:22 -> configuration/contracts.ts (type)<br>tasks/execution-entry-service.ts:39 -> configuration/contracts.ts (type) |
| tasks | evidence | 2 | 0 | tasks/completion.ts:44 -> evidence/evidence-record-codecs.ts<br>tasks/completion.ts:47 -> evidence/coverage.ts |
| tasks | materials | 1 | 4 | tasks/control-contracts.ts:18 -> materials/record-ports.ts (type)<br>tasks/execution-entry-contracts.ts:23 -> materials/contracts.ts (type)<br>tasks/execution-entry-service.ts:40 -> materials/contracts.ts (type) |
| tasks | persistence | 18 | 0 | tasks/claim-record-codecs.ts:25 -> persistence/execution-entry-codecs.ts<br>tasks/control-service.ts:31 -> persistence/control-record-codecs.ts<br>tasks/control-service.ts:39 -> persistence/execution-history-codecs.ts |
| tasks | queries | 2 | 0 | tasks/plan-service.ts:73 -> queries/query-record-codecs.ts<br>tasks/plan-service.ts:78 -> queries/query-execution.ts |
| tasks | sessions | 6 | 0 | tasks/claim-service.ts:39 -> sessions/session-record-codecs.ts<br>tasks/execution-entry-service.ts:51 -> sessions/session-record-codecs.ts<br>tasks/execution-history-service.ts:47 -> sessions/session-record-codecs.ts |

## Group-level strongly connected components

- (9) architecture, communication, configuration, evidence, materials, persistence, queries, sessions, tasks

Value imports only (type-only imports removed):

- (6) architecture, communication, evidence, queries, sessions, tasks

## Group-level elementary cycles (55; value-only 17)

- architecture -> persistence -> tasks -> communication -> queries -> sessions -> architecture
- architecture -> persistence -> tasks -> communication -> sessions -> architecture
- architecture -> persistence -> tasks -> evidence -> architecture
- architecture -> persistence -> tasks -> queries -> communication -> sessions -> architecture
- architecture -> persistence -> tasks -> queries -> sessions -> architecture
- architecture -> persistence -> tasks -> sessions -> architecture
- architecture -> tasks -> communication -> queries -> sessions -> architecture
- architecture -> tasks -> communication -> sessions -> architecture
- architecture -> tasks -> evidence -> architecture
- architecture -> tasks -> queries -> communication -> sessions -> architecture
- architecture -> tasks -> queries -> sessions -> architecture
- architecture -> tasks -> sessions -> architecture
- communication -> configuration -> persistence -> tasks -> communication
- communication -> configuration -> persistence -> tasks -> queries -> communication
- communication -> configuration -> tasks -> communication
- communication -> configuration -> tasks -> queries -> communication
- communication -> materials -> persistence -> tasks -> communication
- communication -> materials -> persistence -> tasks -> queries -> communication
- communication -> materials -> tasks -> communication
- communication -> materials -> tasks -> queries -> communication
- communication -> persistence -> tasks -> communication
- communication -> persistence -> tasks -> queries -> communication
- communication -> queries -> communication
- communication -> queries -> configuration -> persistence -> tasks -> communication
- communication -> queries -> configuration -> tasks -> communication
- communication -> queries -> materials -> persistence -> tasks -> communication
- communication -> queries -> materials -> tasks -> communication
- communication -> queries -> persistence -> tasks -> communication
- communication -> queries -> sessions -> persistence -> tasks -> communication
- communication -> queries -> sessions -> tasks -> communication
- communication -> queries -> tasks -> communication
- communication -> sessions -> persistence -> tasks -> communication
- communication -> sessions -> persistence -> tasks -> queries -> communication
- communication -> sessions -> tasks -> communication
- communication -> sessions -> tasks -> queries -> communication
- communication -> tasks -> communication
- communication -> tasks -> queries -> communication
- configuration -> persistence -> tasks -> configuration
- configuration -> persistence -> tasks -> queries -> configuration
- configuration -> tasks -> configuration
- configuration -> tasks -> queries -> configuration
- evidence -> materials -> persistence -> tasks -> evidence
- evidence -> materials -> tasks -> evidence
- evidence -> tasks -> evidence
- materials -> persistence -> tasks -> materials
- materials -> persistence -> tasks -> queries -> materials
- materials -> tasks -> materials
- materials -> tasks -> queries -> materials
- persistence -> tasks -> persistence
- persistence -> tasks -> queries -> persistence
- persistence -> tasks -> queries -> sessions -> persistence
- persistence -> tasks -> sessions -> persistence
- queries -> sessions -> tasks -> queries
- queries -> tasks -> queries
- sessions -> tasks -> sessions

## File-level strongly connected components (0)

## File-level SCCs with value imports only (0)


## Largest files

| file | lines |
| --- | ---: |
| tasks/plan-service.ts | 2130 |
| communication/mailbox-service.ts | 2069 |
| tasks/execution-entry-service.ts | 1696 |
| sessions/session-directory.ts | 1571 |
| queries/query-execution.ts | 1494 |
| tasks/plan-readers.ts | 1343 |
| configuration/project-bootstrap-service.ts | 1162 |
| evidence/evidence-service.ts | 1118 |
| materials/grant-service.ts | 969 |
| queries/query-job-service.ts | 956 |
| tasks/plan-record-codecs.ts | 838 |
| configuration/role-memory-service.ts | 809 |
| architecture/catalog-service.ts | 805 |
| sessions/session-record-codecs.ts | 788 |
| tasks/claim-service.ts | 785 |
| queries/query-record-codecs.ts | 763 |
| sessions/session-lifecycle.ts | 701 |
| architecture/architecture-service.ts | 687 |
| materials/record-readers.ts | 687 |
| tasks/completion.ts | 687 |
| tasks/run-state-service.ts | 644 |
| tasks/control-service.ts | 633 |
| communication/message-record-codecs.ts | 585 |
| architecture/catalog-record-codecs.ts | 556 |
| configuration/role-record-codecs.ts | 525 |

## Imports leaving the root

| target | imports |
| --- | ---: |
| src/contracts/architecture-catalog.ts | 2 |
| src/contracts/architecture-inspection.ts | 2 |
| src/contracts/architecture-source.ts | 7 |
| src/contracts/artifact.ts | 25 |
| src/contracts/command-event.ts | 55 |
| src/contracts/control-intent.ts | 3 |
| src/contracts/core/call-context.ts | 45 |
| src/contracts/core/execution-history.ts | 7 |
| src/contracts/core/identity.ts | 38 |
| src/contracts/core/operations.ts | 3 |
| src/contracts/core/prepared-execution.ts | 8 |
| src/contracts/core/results.ts | 47 |
| src/contracts/core/session-message.ts | 5 |
| src/contracts/core/session.ts | 14 |
| src/contracts/core/source.ts | 3 |
| src/contracts/core/task-claim.ts | 4 |
| src/contracts/dispatch.ts | 45 |
| src/contracts/evidence.ts | 10 |
| src/contracts/fingerprint.ts | 50 |
| src/contracts/goal-change.ts | 2 |
| src/contracts/goal-phase.ts | 6 |
| src/contracts/governance.ts | 14 |
| src/contracts/human-role-collaboration.ts | 2 |
| src/contracts/initial-planning.ts | 1 |
| src/contracts/ledger.ts | 39 |
| src/contracts/material-access.ts | 15 |
| src/contracts/plan.ts | 34 |
| src/contracts/query-job.ts | 18 |
| src/contracts/reduction.ts | 5 |
| src/contracts/reviewer-work.ts | 1 |
| src/contracts/role-spec-materials.ts | 5 |
| src/contracts/role-spec.ts | 6 |
| src/contracts/runtime-budget.ts | 2 |
| src/contracts/task-envelope.ts | 3 |
| src/contracts/validation/common.ts | 1 |
| src/contracts/validation/goal.ts | 1 |
| src/contracts/validation/role.ts | 2 |
| src/contracts/verification-context.ts | 2 |
| src/contracts/verification.ts | 7 |
| src/core/record-store/body-codec.ts | 5 |
| src/core/record-store/body-ports.ts | 9 |
| src/core/record-store/lookup-index.ts | 1 |
| src/core/record-store/lookup-ports.ts | 25 |
| src/core/record-store/ports.ts | 67 |
| src/core/record-store/record-codec.ts | 2 |
| src/core/workspace/access.ts | 2 |
| src/core/workspace/ports.ts | 2 |
| src/core/workspace/source-applicability.ts | 1 |
