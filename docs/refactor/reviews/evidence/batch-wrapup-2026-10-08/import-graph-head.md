# Import graph: src/core/work-graph

101 files, 57020 lines, 403 internal import edges (134 type-only).

## Groups

| group | files | lines |
| --- | ---: | ---: |
| (root) | 2 | 315 |
| architecture | 8 | 2987 |
| communication | 1 | 2234 |
| configuration | 5 | 3081 |
| evidence | 2 | 2035 |
| materials | 5 | 931 |
| model | 12 | 1420 |
| persistence | 9 | 4814 |
| queries | 4 | 3620 |
| sessions | 9 | 4556 |
| state | 13 | 13743 |
| tasks | 31 | 17284 |

## Group edges

| from | to | value imports | type-only imports | examples |
| --- | --- | ---: | ---: | --- |
| (root) | materials | 0 | 2 | source-authority-ports.ts:7 -> materials/record-ports.ts (type)<br>source-authority-reader.ts:29 -> materials/record-ports.ts (type) |
| (root) | queries | 1 | 0 | source-authority-reader.ts:30 -> queries/query-record-codecs.ts |
| architecture | model | 1 | 0 | architecture/catalog-record-codecs.ts:25 -> model/task-index.ts |
| architecture | persistence | 4 | 0 | architecture/architecture-service.ts:48 -> persistence/record-codecs.ts<br>architecture/architecture-service.ts:49 -> persistence/commit-compiler.ts<br>architecture/catalog-service.ts:49 -> persistence/record-codecs.ts |
| communication | materials | 1 | 0 | communication/mailbox-service.ts:68 -> materials/run-snapshot-decoder.ts |
| communication | model | 1 | 5 | communication/mailbox-service.ts:55 -> model/communication-contracts.ts (type)<br>communication/mailbox-service.ts:56 -> model/communication-contracts.ts<br>communication/mailbox-service.ts:60 -> model/session-contracts.ts (type) |
| communication | persistence | 1 | 0 | communication/mailbox-service.ts:58 -> persistence/record-codecs.ts |
| communication | queries | 1 | 0 | communication/mailbox-service.ts:79 -> queries/query-record-codecs.ts |
| communication | sessions | 3 | 0 | communication/mailbox-service.ts:59 -> sessions/session-record-codecs.ts<br>communication/mailbox-service.ts:69 -> sessions/message-record-codecs.ts<br>communication/mailbox-service.ts:78 -> sessions/message-body-envelope.ts |
| communication | state | 2 | 0 | communication/mailbox-service.ts:82 -> state/message-machine.ts<br>communication/mailbox-service.ts:88 -> state/transition.ts |
| communication | tasks | 3 | 0 | communication/mailbox-service.ts:65 -> tasks/claim-record-codecs.ts<br>communication/mailbox-service.ts:66 -> tasks/execution-entry-service.ts<br>communication/mailbox-service.ts:67 -> tasks/plan-readers.ts |
| configuration | model | 0 | 3 | configuration/project-bootstrap-contracts.ts:25 -> model/task-contracts.ts (type)<br>configuration/project-bootstrap-service.ts:46 -> model/task-contracts.ts (type)<br>configuration/role-memory-service.ts:61 -> model/configuration-contracts.ts (type) |
| configuration | persistence | 1 | 0 | configuration/project-bootstrap-service.ts:47 -> persistence/record-codecs.ts |
| evidence | architecture | 1 | 0 | evidence/evidence-service.ts:65 -> architecture/catalog-record-codecs.ts |
| evidence | model | 0 | 5 | evidence/evidence-service.ts:63 -> model/communication-contracts.ts (type)<br>evidence/evidence-service.ts:64 -> model/material-contracts.ts (type)<br>evidence/evidence-service.ts:115 -> model/evidence-contracts.ts (type) |
| evidence | persistence | 3 | 0 | evidence/evidence-service.ts:70 -> persistence/plan-record-codecs.ts<br>evidence/evidence-service.ts:86 -> persistence/rework-codecs.ts<br>evidence/evidence-service.ts:104 -> persistence/evidence-record-codecs.ts |
| evidence | state | 4 | 0 | evidence/evidence-service.ts:87 -> state/no-progress.ts<br>evidence/evidence-service.ts:88 -> state/task-failure.ts<br>evidence/evidence-service.ts:91 -> state/verification-machine.ts |
| evidence | tasks | 7 | 0 | evidence/evidence-service.ts:66 -> tasks/plan-readers.ts<br>evidence/evidence-service.ts:71 -> tasks/claim-record-codecs.ts<br>evidence/evidence-service.ts:76 -> tasks/plan-task-basis.ts |
| materials | model | 0 | 1 | materials/material-service.ts:9 -> model/material-contracts.ts (type) |
| materials | persistence | 5 | 0 | materials/record-readers.ts:32 -> persistence/record-codecs.ts<br>materials/record-readers.ts:33 -> persistence/execution-history-codecs.ts<br>materials/record-readers.ts:34 -> persistence/execution-entry-codecs.ts |
| model | state | 0 | 1 | model/plan-contracts.ts:19 -> state/goal-machine.ts (type) |
| persistence | model | 0 | 5 | persistence/evidence-record-codecs.ts:31 -> model/evidence-contracts.ts (type)<br>persistence/execution-entry-codecs.ts:35 -> model/claim-contracts.ts (type)<br>persistence/execution-entry-codecs.ts:36 -> model/execution-entry-contracts.ts (type) |
| queries | materials | 1 | 0 | queries/query-record-codecs.ts:51 -> materials/record-readers.ts |
| queries | model | 0 | 4 | queries/contracts.ts:41 -> model/configuration-contracts.ts (type)<br>queries/contracts.ts:42 -> model/communication-contracts.ts (type)<br>queries/contracts.ts:43 -> model/task-contracts.ts (type) |
| queries | persistence | 4 | 0 | queries/query-execution.ts:41 -> persistence/record-codecs.ts<br>queries/query-execution.ts:42 -> persistence/plan-record-codecs.ts<br>queries/query-job-service.ts:50 -> persistence/record-codecs.ts |
| queries | sessions | 2 | 0 | queries/query-execution.ts:43 -> sessions/session-record-codecs.ts<br>queries/query-job-service.ts:57 -> sessions/message-record-codecs.ts |
| queries | state | 3 | 0 | queries/query-execution.ts:46 -> state/query-run-recovery.ts<br>queries/query-execution.ts:51 -> state/session-availability.ts<br>queries/query-job-service.ts:59 -> state/query-run-recovery.ts |
| sessions | architecture | 1 | 0 | sessions/session-targets.ts:20 -> architecture/catalog-service.ts |
| sessions | materials | 1 | 0 | sessions/session-directory.ts:68 -> materials/run-snapshot-decoder.ts |
| sessions | model | 0 | 6 | sessions/lifecycle-contracts.ts:19 -> model/session-contracts.ts (type)<br>sessions/message-body-envelope.ts:14 -> model/communication-contracts.ts (type)<br>sessions/message-record-codecs.ts:31 -> model/communication-contracts.ts (type) |
| sessions | persistence | 1 | 0 | sessions/session-targets.ts:21 -> persistence/record-codecs.ts |
| sessions | state | 3 | 0 | sessions/session-directory.ts:65 -> state/session-availability.ts<br>sessions/session-health.ts:27 -> state/session-availability.ts<br>sessions/session-lifecycle.ts:69 -> state/session-availability.ts |
| tasks | materials | 3 | 1 | tasks/completion.ts:64 -> materials/run-snapshot-decoder.ts<br>tasks/control-contracts.ts:18 -> materials/record-ports.ts (type)<br>tasks/reconcile-reads.ts:24 -> materials/run-snapshot-decoder.ts |
| tasks | model | 1 | 40 | tasks/claim-record-codecs.ts:33 -> model/claim-contracts.ts (type)<br>tasks/claim-service.ts:73 -> model/claim-contracts.ts (type)<br>tasks/claim-service.ts:74 -> model/task-contracts.ts (type) |
| tasks | persistence | 44 | 0 | tasks/claim-record-codecs.ts:34 -> persistence/execution-entry-codecs.ts<br>tasks/claim-record-codecs.ts:35 -> persistence/rework-codecs.ts<br>tasks/claim-service.ts:83 -> persistence/rework-codecs.ts |
| tasks | queries | 2 | 0 | tasks/plan-service.ts:97 -> queries/query-record-codecs.ts<br>tasks/plan-service.ts:102 -> queries/query-execution.ts |
| tasks | sessions | 12 | 0 | tasks/claim-service.ts:50 -> sessions/session-record-codecs.ts<br>tasks/claim-service.ts:81 -> sessions/message-record-codecs.ts<br>tasks/control-service.ts:62 -> sessions/session-record-codecs.ts |
| tasks | state | 37 | 13 | tasks/claim-service.ts:53 -> state/attempt-machine.ts<br>tasks/claim-service.ts:57 -> state/message-machine.ts<br>tasks/claim-service.ts:58 -> state/run-machine.ts |

## Group-level strongly connected components

- none

Value imports only (type-only imports removed):

- none

## Group-level elementary cycles (0; value-only 0)


## File-level strongly connected components (2)

### SCC 1: 3 files across model

Members: `model/communication-contracts.ts`, `model/execution-entry-contracts.ts`, `model/execution-read-contracts.ts`

Shortest cycle through each member:

- model/execution-read-contracts.ts -> model/communication-contracts.ts -> model/execution-read-contracts.ts
- model/execution-entry-contracts.ts -> model/execution-read-contracts.ts -> model/communication-contracts.ts -> model/execution-entry-contracts.ts

### SCC 2: 2 files across state

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
| evidence/evidence-service.ts | 1903 |
| tasks/execution-entry-service.ts | 1822 |
| state/verification-machine.ts | 1683 |
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
| persistence/plan-record-codecs.ts | 930 |
| state/attempt-machine.ts | 920 |
| queries/query-job-service.ts | 913 |
| state/control-intent-machine.ts | 904 |
| state/message-machine.ts | 878 |
| tasks/run-state-service.ts | 862 |
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
| src/contracts/core/identity.ts | 45 |
| src/contracts/core/operations.ts | 4 |
| src/contracts/core/prepared-execution.ts | 8 |
| src/contracts/core/results.ts | 59 |
| src/contracts/core/session-message.ts | 8 |
| src/contracts/core/session.ts | 16 |
| src/contracts/core/source.ts | 3 |
| src/contracts/core/task-claim.ts | 7 |
| src/contracts/delegated-write.ts | 6 |
| src/contracts/dispatch.ts | 64 |
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
| src/contracts/verification-context.ts | 2 |
| src/contracts/verification.ts | 18 |
| src/core/record-store/body-codec.ts | 4 |
| src/core/record-store/body-ports.ts | 10 |
| src/core/record-store/lookup-ports.ts | 26 |
| src/core/record-store/ports.ts | 68 |
| src/core/record-store/record-codec.ts | 2 |
| src/core/workspace/access.ts | 3 |
| src/core/workspace/ports.ts | 2 |
