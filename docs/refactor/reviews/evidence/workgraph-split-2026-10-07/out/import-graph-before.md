# Import graph: src/core/work-graph

100 files, 56993 lines, 404 internal import edges (136 type-only).

## Groups

| group | files | lines |
| --- | ---: | ---: |
| (root) | 2 | 315 |
| architecture | 8 | 2987 |
| communication | 4 | 3172 |
| configuration | 6 | 3121 |
| evidence | 5 | 3080 |
| materials | 5 | 906 |
| persistence | 8 | 3474 |
| queries | 4 | 3620 |
| sessions | 8 | 3951 |
| state | 13 | 13742 |
| tasks | 37 | 18625 |

## Group edges

| from | to | value imports | type-only imports | examples |
| --- | --- | ---: | ---: | --- |
| (root) | materials | 0 | 2 | source-authority-ports.ts:7 -> materials/record-ports.ts (type)<br>source-authority-reader.ts:29 -> materials/record-ports.ts (type) |
| (root) | queries | 1 | 0 | source-authority-reader.ts:30 -> queries/query-record-codecs.ts |
| architecture | persistence | 4 | 0 | architecture/architecture-service.ts:48 -> persistence/record-codecs.ts<br>architecture/architecture-service.ts:49 -> persistence/commit-compiler.ts<br>architecture/catalog-service.ts:49 -> persistence/record-codecs.ts |
| architecture | tasks | 1 | 0 | architecture/catalog-record-codecs.ts:25 -> tasks/task-index.ts |
| communication | configuration | 0 | 1 | communication/contracts.ts:29 -> configuration/contracts.ts (type) |
| communication | materials | 0 | 1 | communication/contracts.ts:30 -> materials/contracts.ts (type) |
| communication | persistence | 1 | 0 | communication/mailbox-service.ts:58 -> persistence/record-codecs.ts |
| communication | queries | 1 | 0 | communication/mailbox-service.ts:79 -> queries/query-record-codecs.ts |
| communication | sessions | 2 | 2 | communication/contracts.ts:31 -> sessions/contracts.ts (type)<br>communication/mailbox-service.ts:59 -> sessions/session-record-codecs.ts<br>communication/mailbox-service.ts:60 -> sessions/contracts.ts (type) |
| communication | state | 2 | 0 | communication/mailbox-service.ts:82 -> state/message-machine.ts<br>communication/mailbox-service.ts:88 -> state/transition.ts |
| communication | tasks | 4 | 4 | communication/contracts.ts:32 -> tasks/execution-entry-contracts.ts (type)<br>communication/contracts.ts:33 -> tasks/execution-read-contracts.ts (type)<br>communication/mailbox-service.ts:63 -> tasks/claim-contracts.ts (type) |
| configuration | persistence | 1 | 0 | configuration/project-bootstrap-service.ts:47 -> persistence/record-codecs.ts |
| configuration | tasks | 0 | 2 | configuration/project-bootstrap-contracts.ts:25 -> tasks/contracts.ts (type)<br>configuration/project-bootstrap-service.ts:46 -> tasks/contracts.ts (type) |
| evidence | architecture | 1 | 0 | evidence/evidence-service.ts:62 -> architecture/catalog-record-codecs.ts |
| evidence | communication | 0 | 1 | evidence/contracts.ts:38 -> communication/contracts.ts (type) |
| evidence | materials | 0 | 1 | evidence/contracts.ts:39 -> materials/contracts.ts (type) |
| evidence | persistence | 2 | 0 | evidence/evidence-record-codecs.ts:32 -> persistence/rework-codecs.ts<br>evidence/evidence-service.ts:81 -> persistence/rework-codecs.ts |
| evidence | state | 4 | 0 | evidence/evidence-service.ts:82 -> state/no-progress.ts<br>evidence/evidence-service.ts:83 -> state/task-failure.ts<br>evidence/evidence-service.ts:86 -> state/verification-machine.ts |
| evidence | tasks | 9 | 4 | evidence/contracts.ts:40 -> tasks/execution-read-contracts.ts (type)<br>evidence/contracts.ts:41 -> tasks/contracts.ts (type)<br>evidence/contracts.ts:42 -> tasks/plan-write-admission.ts (type) |
| materials | persistence | 5 | 0 | materials/record-readers.ts:32 -> persistence/record-codecs.ts<br>materials/record-readers.ts:33 -> persistence/execution-history-codecs.ts<br>materials/record-readers.ts:34 -> persistence/execution-entry-codecs.ts |
| persistence | tasks | 0 | 4 | persistence/execution-entry-codecs.ts:35 -> tasks/claim-contracts.ts (type)<br>persistence/execution-entry-codecs.ts:36 -> tasks/execution-entry-contracts.ts (type)<br>persistence/execution-history-codecs.ts:35 -> tasks/execution-history-contracts.ts (type) |
| queries | communication | 1 | 1 | queries/contracts.ts:42 -> communication/contracts.ts (type)<br>queries/query-job-service.ts:57 -> communication/message-record-codecs.ts |
| queries | configuration | 0 | 1 | queries/contracts.ts:41 -> configuration/contracts.ts (type) |
| queries | materials | 1 | 0 | queries/query-record-codecs.ts:51 -> materials/record-readers.ts |
| queries | persistence | 2 | 0 | queries/query-execution.ts:41 -> persistence/record-codecs.ts<br>queries/query-job-service.ts:50 -> persistence/record-codecs.ts |
| queries | sessions | 1 | 0 | queries/query-execution.ts:43 -> sessions/session-record-codecs.ts |
| queries | state | 3 | 0 | queries/query-execution.ts:46 -> state/query-run-recovery.ts<br>queries/query-execution.ts:51 -> state/session-availability.ts<br>queries/query-job-service.ts:59 -> state/query-run-recovery.ts |
| queries | tasks | 2 | 2 | queries/contracts.ts:43 -> tasks/contracts.ts (type)<br>queries/query-execution.ts:42 -> tasks/plan-record-codecs.ts<br>queries/query-execution.ts:65 -> tasks/contracts.ts (type) |
| sessions | architecture | 1 | 0 | sessions/session-targets.ts:20 -> architecture/catalog-service.ts |
| sessions | persistence | 1 | 0 | sessions/session-targets.ts:21 -> persistence/record-codecs.ts |
| sessions | state | 3 | 0 | sessions/session-directory.ts:65 -> state/session-availability.ts<br>sessions/session-health.ts:27 -> state/session-availability.ts<br>sessions/session-lifecycle.ts:69 -> state/session-availability.ts |
| sessions | tasks | 1 | 0 | sessions/session-directory.ts:68 -> tasks/run-state-service.ts |
| tasks | communication | 4 | 4 | tasks/claim-service.ts:80 -> communication/contracts.ts (type)<br>tasks/claim-service.ts:81 -> communication/message-record-codecs.ts<br>tasks/execution-entry-service.ts:68 -> communication/message-record-codecs.ts |
| tasks | configuration | 0 | 3 | tasks/claim-contracts.ts:18 -> configuration/contracts.ts (type)<br>tasks/execution-entry-contracts.ts:25 -> configuration/contracts.ts (type)<br>tasks/execution-entry-service.ts:56 -> configuration/contracts.ts (type) |
| tasks | evidence | 5 | 0 | tasks/completion.ts:57 -> evidence/evidence-record-codecs.ts<br>tasks/completion.ts:60 -> evidence/coverage.ts<br>tasks/plan-readers.ts:48 -> evidence/evidence-record-codecs.ts |
| tasks | materials | 1 | 4 | tasks/control-contracts.ts:18 -> materials/record-ports.ts (type)<br>tasks/execution-entry-contracts.ts:26 -> materials/contracts.ts (type)<br>tasks/plan-service.ts:62 -> materials/contracts.ts (type) |
| tasks | persistence | 28 | 0 | tasks/claim-record-codecs.ts:34 -> persistence/execution-entry-codecs.ts<br>tasks/claim-record-codecs.ts:35 -> persistence/rework-codecs.ts<br>tasks/claim-service.ts:83 -> persistence/rework-codecs.ts |
| tasks | queries | 2 | 0 | tasks/plan-service.ts:97 -> queries/query-record-codecs.ts<br>tasks/plan-service.ts:102 -> queries/query-execution.ts |
| tasks | sessions | 8 | 0 | tasks/claim-service.ts:50 -> sessions/session-record-codecs.ts<br>tasks/control-service.ts:62 -> sessions/session-record-codecs.ts<br>tasks/execution-entry-service.ts:67 -> sessions/session-record-codecs.ts |
| tasks | state | 37 | 14 | tasks/claim-service.ts:53 -> state/attempt-machine.ts<br>tasks/claim-service.ts:57 -> state/message-machine.ts<br>tasks/claim-service.ts:58 -> state/run-machine.ts |

## Group-level strongly connected components

- (9) architecture, communication, configuration, evidence, materials, persistence, queries, sessions, tasks

Value imports only (type-only imports removed):

- (6) architecture, communication, evidence, queries, sessions, tasks

## Group-level elementary cycles (68; value-only 17)

- architecture -> persistence -> tasks -> communication -> queries -> sessions -> architecture
- architecture -> persistence -> tasks -> communication -> sessions -> architecture
- architecture -> persistence -> tasks -> evidence -> architecture
- architecture -> persistence -> tasks -> evidence -> communication -> queries -> sessions -> architecture
- architecture -> persistence -> tasks -> evidence -> communication -> sessions -> architecture
- architecture -> persistence -> tasks -> queries -> communication -> sessions -> architecture
- architecture -> persistence -> tasks -> queries -> sessions -> architecture
- architecture -> persistence -> tasks -> sessions -> architecture
- architecture -> tasks -> communication -> queries -> sessions -> architecture
- architecture -> tasks -> communication -> sessions -> architecture
- architecture -> tasks -> evidence -> architecture
- architecture -> tasks -> evidence -> communication -> queries -> sessions -> architecture
- architecture -> tasks -> evidence -> communication -> sessions -> architecture
- architecture -> tasks -> queries -> communication -> sessions -> architecture
- architecture -> tasks -> queries -> sessions -> architecture
- architecture -> tasks -> sessions -> architecture
- communication -> configuration -> persistence -> tasks -> communication
- communication -> configuration -> persistence -> tasks -> evidence -> communication
- communication -> configuration -> persistence -> tasks -> queries -> communication
- communication -> configuration -> tasks -> communication
- communication -> configuration -> tasks -> evidence -> communication
- communication -> configuration -> tasks -> queries -> communication
- communication -> materials -> persistence -> tasks -> communication
- communication -> materials -> persistence -> tasks -> evidence -> communication
- communication -> materials -> persistence -> tasks -> queries -> communication
- communication -> persistence -> tasks -> communication
- communication -> persistence -> tasks -> evidence -> communication
- communication -> persistence -> tasks -> queries -> communication
- communication -> queries -> communication
- communication -> queries -> configuration -> persistence -> tasks -> communication
- communication -> queries -> configuration -> persistence -> tasks -> evidence -> communication
- communication -> queries -> configuration -> tasks -> communication
- communication -> queries -> configuration -> tasks -> evidence -> communication
- communication -> queries -> materials -> persistence -> tasks -> communication
- communication -> queries -> materials -> persistence -> tasks -> evidence -> communication
- communication -> queries -> persistence -> tasks -> communication
- communication -> queries -> persistence -> tasks -> evidence -> communication
- communication -> queries -> sessions -> persistence -> tasks -> communication
- communication -> queries -> sessions -> persistence -> tasks -> evidence -> communication
- communication -> queries -> sessions -> tasks -> communication
- communication -> queries -> sessions -> tasks -> evidence -> communication
- communication -> queries -> tasks -> communication
- communication -> queries -> tasks -> evidence -> communication
- communication -> sessions -> persistence -> tasks -> communication
- communication -> sessions -> persistence -> tasks -> evidence -> communication
- communication -> sessions -> persistence -> tasks -> queries -> communication
- communication -> sessions -> tasks -> communication
- communication -> sessions -> tasks -> evidence -> communication
- communication -> sessions -> tasks -> queries -> communication
- communication -> tasks -> communication
- communication -> tasks -> evidence -> communication
- communication -> tasks -> queries -> communication
- configuration -> persistence -> tasks -> configuration
- configuration -> persistence -> tasks -> queries -> configuration
- configuration -> tasks -> configuration
- configuration -> tasks -> queries -> configuration
- evidence -> materials -> persistence -> tasks -> evidence
- evidence -> persistence -> tasks -> evidence
- evidence -> tasks -> evidence
- materials -> persistence -> tasks -> materials
- materials -> persistence -> tasks -> queries -> materials
- persistence -> tasks -> persistence
- persistence -> tasks -> queries -> persistence
- persistence -> tasks -> queries -> sessions -> persistence
- persistence -> tasks -> sessions -> persistence
- queries -> sessions -> tasks -> queries
- queries -> tasks -> queries
- sessions -> tasks -> sessions

## File-level strongly connected components (3)

### SCC 1: 6 files across evidence, tasks

Members: `evidence/contracts.ts`, `evidence/evidence-record-codecs.ts`, `tasks/entry-plan-reader.ts`, `tasks/execution-entry-service.ts`, `tasks/plan-readers.ts`, `tasks/plan-write-admission.ts`

Shortest cycle through each member:

- tasks/plan-write-admission.ts -> tasks/execution-entry-service.ts -> tasks/plan-readers.ts -> evidence/evidence-record-codecs.ts -> evidence/contracts.ts -> tasks/plan-write-admission.ts
- tasks/entry-plan-reader.ts -> tasks/plan-readers.ts -> evidence/evidence-record-codecs.ts -> evidence/contracts.ts -> tasks/plan-write-admission.ts -> tasks/execution-entry-service.ts -> tasks/entry-plan-reader.ts

### SCC 2: 3 files across communication, tasks

Members: `communication/contracts.ts`, `tasks/execution-entry-contracts.ts`, `tasks/execution-read-contracts.ts`

Shortest cycle through each member:

- tasks/execution-read-contracts.ts -> communication/contracts.ts -> tasks/execution-read-contracts.ts
- tasks/execution-entry-contracts.ts -> tasks/execution-read-contracts.ts -> communication/contracts.ts -> tasks/execution-entry-contracts.ts

### SCC 3: 2 files across state

Members: `state/control-intent-machine.ts`, `state/run-machine.ts`

Shortest cycle through each member:

- state/run-machine.ts -> state/control-intent-machine.ts -> state/run-machine.ts

## File-level SCCs with value imports only (0)


## Largest files

| file | lines |
| --- | ---: |
| tasks/plan-service.ts | 2703 |
| state/run-machine.ts | 2335 |
| communication/mailbox-service.ts | 2234 |
| evidence/evidence-service.ts | 1849 |
| tasks/execution-entry-service.ts | 1822 |
| state/verification-machine.ts | 1682 |
| queries/query-execution.ts | 1677 |
| tasks/plan-readers.ts | 1644 |
| sessions/session-directory.ts | 1607 |
| state/plan-machine.ts | 1399 |
| state/task-machine.ts | 1352 |
| state/task-failure.ts | 1277 |
| configuration/project-bootstrap-service.ts | 1162 |
| state/goal-machine.ts | 1151 |
| tasks/claim-service.ts | 1003 |
| tasks/control-service.ts | 945 |
| tasks/plan-record-codecs.ts | 930 |
| state/attempt-machine.ts | 920 |
| queries/query-job-service.ts | 913 |
| state/control-intent-machine.ts | 904 |
| state/message-machine.ts | 878 |
| tasks/run-state-service.ts | 877 |
| tasks/requeue-service.ts | 856 |
| persistence/execution-entry-codecs.ts | 821 |
| configuration/role-memory-service.ts | 809 |

## Imports leaving the root

| target | imports |
| --- | ---: |
| src/contracts/architecture-catalog.ts | 2 |
| src/contracts/architecture-inspection.ts | 2 |
| src/contracts/architecture-source.ts | 7 |
| src/contracts/artifact.ts | 25 |
| src/contracts/command-event.ts | 61 |
| src/contracts/continuation-brief.ts | 3 |
| src/contracts/control-intent.ts | 19 |
| src/contracts/core/call-context.ts | 46 |
| src/contracts/core/execution-history.ts | 10 |
| src/contracts/core/identity.ts | 46 |
| src/contracts/core/operations.ts | 4 |
| src/contracts/core/prepared-execution.ts | 8 |
| src/contracts/core/results.ts | 59 |
| src/contracts/core/session-message.ts | 8 |
| src/contracts/core/session.ts | 16 |
| src/contracts/core/source.ts | 3 |
| src/contracts/core/task-claim.ts | 7 |
| src/contracts/delegated-write.ts | 6 |
| src/contracts/dispatch.ts | 63 |
| src/contracts/evidence.ts | 13 |
| src/contracts/fingerprint.ts | 60 |
| src/contracts/goal-change.ts | 3 |
| src/contracts/goal-phase.ts | 8 |
| src/contracts/governance.ts | 15 |
| src/contracts/human-role-collaboration.ts | 2 |
| src/contracts/initial-planning.ts | 1 |
| src/contracts/ledger.ts | 52 |
| src/contracts/material-access.ts | 3 |
| src/contracts/no-progress.ts | 11 |
| src/contracts/plan.ts | 41 |
| src/contracts/query-job.ts | 21 |
| src/contracts/reduction.ts | 8 |
| src/contracts/reviewer-work.ts | 1 |
| src/contracts/role-spec-materials.ts | 5 |
| src/contracts/role-spec.ts | 6 |
| src/contracts/runtime-budget.ts | 2 |
| src/contracts/task-envelope.ts | 4 |
| src/contracts/task-failure.ts | 6 |
| src/contracts/task-requeue.ts | 27 |
| src/contracts/validation/common.ts | 1 |
| src/contracts/validation/goal.ts | 1 |
| src/contracts/validation/role.ts | 2 |
| src/contracts/verification-context.ts | 3 |
| src/contracts/verification.ts | 18 |
| src/core/record-store/body-codec.ts | 4 |
| src/core/record-store/body-ports.ts | 10 |
| src/core/record-store/lookup-ports.ts | 27 |
| src/core/record-store/ports.ts | 68 |
| src/core/record-store/record-codec.ts | 2 |
| src/core/workspace/access.ts | 3 |
| src/core/workspace/ports.ts | 2 |
