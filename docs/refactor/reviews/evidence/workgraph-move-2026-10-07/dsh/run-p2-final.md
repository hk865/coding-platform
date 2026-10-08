## FILES CHANGED

18 moves (`src/core/work-graph/` prefix omitted on the left, added on the right):

```
tasks/contracts.ts                  → src/core/work-graph/model/task-contracts.ts
tasks/claim-contracts.ts           → src/core/work-graph/model/claim-contracts.ts
tasks/execution-entry-contracts.ts → src/core/work-graph/model/execution-entry-contracts.ts
tasks/execution-read-contracts.ts  → src/core/work-graph/model/execution-read-contracts.ts
tasks/execution-history-contracts.ts → src/core/work-graph/model/execution-history-contracts.ts
tasks/plan-contracts.ts            → src/core/work-graph/model/plan-contracts.ts
configuration/contracts.ts         → src/core/work-graph/model/configuration-contracts.ts
materials/contracts.ts             → src/core/work-graph/model/material-contracts.ts
sessions/contracts.ts              → src/core/work-graph/model/session-contracts.ts
communication/contracts.ts         → src/core/work-graph/model/communication-contracts.ts
evidence/contracts.ts              → src/core/work-graph/model/evidence-contracts.ts
tasks/task-index.ts                → src/core/work-graph/model/task-index.ts
tasks/plan-record-codecs.ts        → src/core/work-graph/persistence/plan-record-codecs.ts
evidence/evidence-record-codecs.ts → src/core/work-graph/persistence/evidence-record-codecs.ts
persistence/model-request-codecs.ts → src/core/work-graph/tasks/model-request-codecs.ts
evidence/coverage.ts               → src/core/work-graph/tasks/evidence-coverage.ts
communication/message-record-codecs.ts → src/core/work-graph/sessions/message-record-codecs.ts
communication/message-body-envelope.ts → src/core/work-graph/sessions/message-body-envelope.ts
```

Other files edited: 147 (145 with specifier changes + the 2 data files).

```
src/app/attention-observer.ts
src/app/collaboration-driver.ts
src/app/core-http-types.ts
src/app/core-routes.ts
src/app/goal-fan-out-driver.ts
src/app/host.ts
src/app/startup-reconcile.ts
src/business/workflow/consultation.ts
src/business/workflow/contracts.ts
src/business/workflow/ports.ts
src/business/workflow/workflow.ts
src/composition/create-platform.ts
src/core/agent-runtime/check-execution.ts
src/core/agent-runtime/communication-tools.ts
src/core/agent-runtime/continuation-brief-assembly.ts
src/core/agent-runtime/execution-contracts.ts
src/core/agent-runtime/execution-control.ts
src/core/agent-runtime/execution-driver.ts
src/core/agent-runtime/execution-history-contracts.ts
src/core/agent-runtime/execution-inputs.ts
src/core/agent-runtime/execution-observation.ts
src/core/agent-runtime/execution-preparation.ts
src/core/agent-runtime/kernel-turn-facts.ts
src/core/agent-runtime/model-call-access.ts
src/core/agent-runtime/run-reconcile.ts
src/core/agent-runtime/session-discovery-tools.ts
src/core/agent-runtime/session-operations.ts
src/core/agent-runtime/whiteboard-tools.ts
src/core/work-graph/architecture/catalog-record-codecs.ts
src/core/work-graph/communication/mailbox-service.ts
src/core/work-graph/configuration/project-bootstrap-contracts.ts
src/core/work-graph/configuration/project-bootstrap-service.ts
src/core/work-graph/configuration/role-memory-service.ts
src/core/work-graph/evidence/evidence-service.ts
src/core/work-graph/materials/material-service.ts
src/core/work-graph/persistence/execution-entry-codecs.ts
src/core/work-graph/persistence/execution-history-codecs.ts
src/core/work-graph/queries/contracts.ts
src/core/work-graph/queries/query-execution.ts
src/core/work-graph/queries/query-job-service.ts
src/core/work-graph/sessions/lifecycle-contracts.ts
src/core/work-graph/sessions/session-directory.ts
src/core/work-graph/sessions/session-lifecycle.ts
src/core/work-graph/sessions/session-record-codecs.ts
src/core/work-graph/tasks/claim-record-codecs.ts
src/core/work-graph/tasks/claim-service.ts
src/core/work-graph/tasks/completion.ts
src/core/work-graph/tasks/control-contracts.ts
src/core/work-graph/tasks/control-service.ts
src/core/work-graph/tasks/entry-plan-reader.ts
src/core/work-graph/tasks/execution-entry-service.ts
src/core/work-graph/tasks/execution-history-service.ts
src/core/work-graph/tasks/goal-control.ts
src/core/work-graph/tasks/model-call-contracts.ts
src/core/work-graph/tasks/model-call-service.ts
src/core/work-graph/tasks/plan-commit-compiler.ts
src/core/work-graph/tasks/plan-readers.ts
src/core/work-graph/tasks/plan-service.ts
src/core/work-graph/tasks/plan-task-basis.ts
src/core/work-graph/tasks/plan-validation.ts
src/core/work-graph/tasks/plan-write-admission.ts
src/core/work-graph/tasks/reconcile-intents.ts
src/core/work-graph/tasks/reconcile-reads.ts
src/core/work-graph/tasks/requeue-service.ts
src/core/work-graph/tasks/run-reconcile-contracts.ts
src/core/work-graph/tasks/run-reconcile-service.ts
src/core/work-graph/tasks/run-state-service.ts
src/core/work-graph/tasks/task-service.ts
tests/app/A2-reverify-route.test.ts
tests/app/A2-startup-redrive-select.test.ts
tests/app/R6-workbench.test.ts
tests/app/goal-fan-out-driver.test.ts
tests/app/orchestration-mechanism.test.ts
tests/architecture/production-reach-allowlist.json
tests/architecture/state-writes.test.ts
tests/business/A2-workflow-auto-rework.test.ts
tests/business/A2-workflow-disposition.test.ts
tests/business/A2-workflow-result-mapping.test.ts
tests/business/A2-workflow-reverify.test.ts
tests/business/R5b-initial-planning-workflow.test.ts
tests/business/R5c-workflow.test.ts
tests/composition/A1-graph-session-platform.test.ts
tests/composition/A2-reconcile-classifier-platform.test.ts
tests/composition/A2-requeue-platform.test.ts
tests/composition/C1-M1-platform.test.ts
tests/composition/R3c-R4b-platform.test.ts
tests/composition/W1-future-plan-platform.test.ts
tests/composition/W2-future-intent-platform.test.ts
tests/helpers/B2-execution-fixture.ts
tests/helpers/B2-runtime-fixture.ts
tests/helpers/C1-mailbox-fixture.ts
tests/helpers/R3e-evidence-fixture.ts
tests/helpers/W2-whiteboard-fixture.ts
tests/helpers/graph-session-fixture.ts
tests/helpers/task-claim-fixture.ts
tests/runtime/A2-reconcile-runtime.test.ts
tests/runtime/B2-runtime-execution.test.ts
tests/runtime/C1-communication-tools.test.ts
tests/runtime/C2-runtime-platform-tools.test.ts
tests/runtime/C3-brief-timeline.test.ts
tests/runtime/R4-control-runtime.test.ts
tests/runtime/R4b-session-input-boundaries.test.ts
tests/runtime/R4c-graph-history.test.ts
tests/runtime/W2-role-skills.test.ts
tests/runtime/W2-whiteboard-tools.test.ts
tests/scenarios/A4-duplicate-receipts.test.ts
tests/scenarios/C6-unrelated-adoption.test.ts
tests/scenarios/C7-defer-reactivate.test.ts
tests/scenarios/C7-supersede-failed-task.test.ts
tests/scenarios/C8-human-stop-respected.test.ts
tests/scenarios/harness.ts
tests/scenarios/support/common.ts
tests/scenarios/support/fuzz.ts
tests/scenarios/support/gate.ts
tests/scenarios/support/plan.ts
tests/scenarios/support/receipts.ts
tests/scenarios/support/rework.ts
tests/state/attempt-machine.test.ts
tests/state/invariants.test.ts
tests/state/invariants.ts
tests/state/message-machine.test.ts
tests/state/plan-machine.test.ts
tests/work-graph/A2-control-service.test.ts
tests/work-graph/A2-disposition-change.test.ts
tests/work-graph/A2-entry-plan.test.ts
tests/work-graph/A2-gate-chain-facts.test.ts
tests/work-graph/A2-goal-control.test.ts
tests/work-graph/A2-requeue-service.test.ts
tests/work-graph/A2-step1-codecs.test.ts
tests/work-graph/A2-verification-chain.test.ts
tests/work-graph/C1-session-mailbox.test.ts
tests/work-graph/C2-mailbox-admission.test.ts
tests/work-graph/R3c-plan-adoption.test.ts
tests/work-graph/R3c-plan-entry.test.ts
tests/work-graph/R3c-task-graph.test.ts
tests/work-graph/R3c-task-relations-boundaries.test.ts
tests/work-graph/R3c-task-relations.test.ts
tests/work-graph/R3e-evidence-coverage.test.ts
tests/work-graph/R3e-reverify.test.ts
tests/work-graph/R4b-session-directory.test.ts
tests/work-graph/R4c-execution-history-index.test.ts
tests/work-graph/R4c-execution-read.test.ts
tests/work-graph/R4c-task-claim.test.ts
tests/work-graph/R5b-initial-plan.test.ts
tests/work-graph/W1-future-plan.test.ts
tests/work-graph/W2-agent-whiteboard.test.ts
tests/work-graph/W2-future-intent.test.ts
```

## CHECKS

Before → after:

- `npm run typecheck` → exit 0 → exit 0.
- `npm run check:architecture` → exit 0 (`next source boundaries: OK`) → exit 0 (`next source boundaries: OK`).
- `npx vitest run tests/architecture tests/state tests/work-graph` → exit 1; ` Test Files  3 failed | 68 passed (71)`; `      Tests  9 failed | 4202 passed | 29 skipped (4240)` → exit 1; ` Test Files  3 failed | 68 passed (71)`; `      Tests  9 failed | 4202 passed | 29 skipped (4240)`. Failed files identical both times: `tests/work-graph/A2-verification-chain.test.ts` (8), `tests/state/invariants-fuzz.test.ts` (1), `tests/state/invariants.test.ts` (whole suite).

Supplementary verification of the edits (part-1 listing applied exactly): `node apply.mjs` reported 380/380 specifier matches and 12/12 path-string matches; `git status --short` = 147 `M` + 5 `R` + 13 `RM` (18 renames, no untracked); `git diff -M HEAD --numstat` = 165 files, every file equal added/deleted, exactly the 5 moved-only files at `0 0`; a scripted diff check over `git diff -M HEAD --unified=0` found 160 changed files and exactly 392 changed quoted spans, with every removed/added line pair identical outside its quoted strings.

## UNSPECIFIED

- `tests/architecture/boundaries.test.ts:354` has relative specifier `../../scripts/check-boundaries.mjs` (`.mjs`, not `.js`); neither end moves, rule (c) leaves it unchanged.
- Git shows the 13 moved files that also change specifiers as `RM` (staged rename + unstaged edit) and the 5 moved-only files as `R`; both together are the 18 renames.
- `git diff -M HEAD --numstat` abbreviates some rename paths with braces (e.g. `src/core/work-graph/{tasks => model}/task-index.ts`); the five `0 0` rows are the moved-only files.
- Step-6 searches also match the 7 `state-writes.test.ts` data entries and the JSON `"file"` values; those are not comments/test titles, so they are not in the stale list (they are the 12 applied path strings).
- The bare-basename search matches `src/contracts/architecture-catalog.ts:5` (`architecture/catalog-contracts.ts`); not a moved file, excluded.
- No comment/test-title hit found for `tasks/contracts.ts`, `tasks/execution-read-contracts.ts`, `tasks/execution-history-contracts.ts`, `configuration/contracts.ts`, `materials/contracts.ts`, `evidence/contracts.ts`, `persistence/model-request-codecs.ts`, `communication/message-record-codecs.ts`, `communication/message-body-envelope.ts`; commands that found nothing: `grep -rnE 'tasks/contracts\.ts' src tests --include=*.ts`, `grep -rnE 'tasks/execution-read-contracts\.ts' src tests --include=*.ts`, `grep -rnE 'tasks/execution-history-contracts\.ts' src tests --include=*.ts`, `grep -rnE 'configuration/contracts\.ts' src tests --include=*.ts`, `grep -rnE 'materials/contracts\.ts' src tests --include=*.ts`, `grep -rnE 'evidence/contracts\.ts' src tests --include=*.ts`, `grep -rnE 'persistence/model-request-codecs\.ts' src tests --include=*.ts`, `grep -rnE 'communication/message-body-envelope\.ts' src tests --include=*.ts`; `grep -rnE 'communication/message-record-codecs\.ts' src tests --include=*.ts` matched only the non-comment data line `tests/architecture/state-writes.test.ts:170`.

Search commands used again:

```
for f in tasks/contracts.ts tasks/claim-contracts.ts tasks/execution-entry-contracts.ts \
         tasks/execution-read-contracts.ts tasks/execution-history-contracts.ts tasks/plan-contracts.ts \
         configuration/contracts.ts materials/contracts.ts sessions/contracts.ts communication/contracts.ts \
         evidence/contracts.ts tasks/task-index.ts tasks/plan-record-codecs.ts \
         evidence/evidence-record-codecs.ts persistence/model-request-codecs.ts evidence/coverage.ts \
         communication/message-record-codecs.ts communication/message-body-envelope.ts; do
  grep -rnE "$f" src tests --include=*.ts
done

grep -rnE "\b(contracts|claim-contracts|execution-entry-contracts|execution-read-contracts|execution-history-contracts|plan-contracts|task-index|plan-record-codecs|evidence-record-codecs|model-request-codecs|coverage|message-record-codecs|message-body-envelope)\.ts" src tests --include=*.ts

grep -rnE "\b(contracts|claim-contracts|execution-entry-contracts|execution-read-contracts|execution-history-contracts|plan-contracts|task-index|plan-record-codecs|evidence-record-codecs|model-request-codecs|coverage|message-record-codecs|message-body-envelope)\.ts" src tests
```

Comment/test-title lines naming a moved file, checked again after the change (38, identical to part 1; nothing was changed for them):

```
src/contracts/core/task-claim.ts:6
src/contracts/core/session-message.ts:6
src/core/work-graph/state/attempt-machine.ts:32
src/core/work-graph/state/attempt-machine.ts:48
src/core/work-graph/state/attempt-machine.ts:58
src/core/work-graph/state/message-machine.ts:6
src/core/work-graph/state/message-machine.ts:43
src/core/work-graph/state/message-machine.ts:58
src/core/work-graph/state/message-machine.ts:61
src/core/work-graph/state/message-machine.ts:67
src/core/work-graph/state/message-machine.ts:76
src/core/work-graph/state/message-machine.ts:85
src/core/work-graph/state/message-machine.ts:95
src/core/work-graph/state/message-machine.ts:104
src/core/work-graph/state/message-machine.ts:112
src/core/work-graph/state/message-machine.ts:155
src/core/work-graph/state/run-machine.ts:342
src/core/work-graph/state/run-machine.ts:353
src/core/work-graph/state/verification-machine.ts:41
src/core/work-graph/state/verification-machine.ts:82
src/core/work-graph/state/verification-machine.ts:84
src/core/work-graph/state/verification-machine.ts:86
src/core/work-graph/state/verification-machine.ts:804
src/core/work-graph/state/plan-machine.ts:32
src/core/work-graph/state/plan-machine.ts:61
src/core/work-graph/state/plan-machine.ts:64
src/core/work-graph/state/plan-machine.ts:67
src/core/work-graph/state/plan-machine.ts:70
src/core/work-graph/state/plan-machine.ts:80
src/core/work-graph/state/plan-machine.ts:87
src/core/work-graph/state/session-availability.ts:32
src/core/work-graph/state/goal-machine.ts:815
src/core/work-graph/architecture/catalog-record-codecs.ts:13
src/core/work-graph/tasks/completion.ts:23
src/core/work-graph/tasks/completion.ts:24
tests/state/plan-machine.test.ts:298
tests/state/verification-machine.test.ts:948
tests/state/attempt-machine.test.ts:705
```

## NOTES

- After `.dsh-scratch/` deletion, `git status --short` shows 147 `M` + 5 `R` + 13 `RM` = 165 paths and no untracked file.
- The diff check found exactly 392 changed quoted spans (380 specifiers + 12 path strings) with no skeleton changes, so no edit landed outside quotes.
- The three checks reproduce the part-1 results exactly, including the same three failing suites.