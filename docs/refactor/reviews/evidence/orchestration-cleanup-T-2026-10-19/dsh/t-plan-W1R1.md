# T wave 1 rework 1 plan (W1R1)

Base: `w1-merged` = `5daea2e`. Findings: `.dsh-ref/t-w1-findings.md`. Rule sheet: v2.

## Group 0 — production (coordinator, serial first)

Files: `src/app/startup-reconcile.ts`, `src/app/goal-fan-out-driver.ts`,
`src/business/workflow/workflow.ts`, `src/composition/create-platform.ts`,
`src/core/agent-runtime/{context-assembler,continuation-brief-assembly,execution-driver,execution-observation,run-reconcile,runtime}.ts`,
`src/contracts/{run-activity,dispatch}.ts`, `src/core/work-graph/state/{run-machine,session-availability}.ts`,
`src/core/work-graph/sessions/{session-directory,session-record-codecs}.ts`,
`src/core/work-graph/model/session-contracts.ts`, `src/core/workspace/typescript-source-query.ts`.
Rows: W1-01, W1-02, W1-03, W1-04, plus W1-14 (delete `createLegacySession`, needed by typecheck).
Checks: typecheck, check:architecture, direct tests.

## Group A — S3 admission world (one worker; files disjoint from all below)

Files: `tests/work-graph/S3-prepared-context-admission.test.ts`,
`tests/helpers/task-claim-fixture.ts`.
Rows: W1-43 (adopt architecture) → W1-09 (AD03 rejects) → W1-19 (materials read) →
W1-25 (real upstream runA, public workspace @5→@7) → W1-26 (AD06 real revoke; AD08
base path BLOCKED) → W1-41 (dead helpers/imports).

## Group B — fixtures batch 1 (worker 2)

Files: `tests/helpers/S1-archive-service-fixture.ts`, `tests/helpers/S1-workflow-archive-fixture.ts`,
`tests/helpers/WP1-units-fixture.ts`, `tests/business/WP1-start-refusal.test.ts`,
`tests/helpers/C1-mailbox-fixture.ts`, `tests/helpers/S2B-track-fixture.ts`,
`tests/helpers/S2B-runtime-steps-fixture.ts`, `tests/helpers/S5-decision-fixture.ts`,
`tests/helpers/S5-queue-support.ts`.
Rows: W1-44; W1-10; W1-13 + its W1-35 part; W1-15 + its W1-36 part;
W1-17, W1-18, rest of W1-36 and W1-37; W1-14 already done in G0.

## Group C — runtime / R4c (worker 3)

Files: `tests/runtime/source-binding-migration.test.ts`, `tests/runtime/R4c-*.test.ts`,
`tests/helpers/graph-session-fixture.ts` (only if B needs it; coordinate — it belongs to D).
Rows: W1-20; B-03; B-04; B-08; B-09.

## Group D — graph-session and context inputs (after B releases graph-session-fixture)

Files: `tests/helpers/graph-session-fixture.ts`, `tests/work-graph/A1-independent-review.test.ts`,
`tests/work-graph/S3-context-inputs.test.ts`, `tests/work-graph/A2-gate-chain-facts.test.ts`,
`tests/work-graph/R3e-reverify.test.ts`.
Rows: B-10, B-11, B-12, B-13, B-02.

## Group E — everything else (after A/B/C/D release their files)

Files: the tests named by W1-05..W1-08, W1-11, W1-12, W1-16, W1-21..W1-24,
W1-27..W1-34, W1-38..W1-40, W1-42.
Rows: those ids.

## Parallelism

- G0 first and alone (typecheck slot).
- Then A + B + C in parallel (three workers, disjoint files).
- Then D + E in parallel (two workers, disjoint files).
- Coordinator runs every typecheck; workers only their own test files with
  `npx vitest run --maxWorkers=2`.
- Final: coordinator runs the full changed/importing test set, commits, ledgers.
