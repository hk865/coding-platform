/**
 * R5c.1 Workflow advancement stage-one final-behaviour test.
 *
 * The real WorkGraph fixture produces a formal Project/Workspace/governance,
 * a Goal and an adopted Plan with two required work tasks and a Goal gate; the
 * Session facts come from the real Session directory and the real Runtime
 * Session creation. Only the execution/verification owner ports are controlled
 * doubles here, so this file proves the Workflow's own selection/continuation
 * decisions without faking any domain PASS or Task/Goal completion.
 *
 * These are FINAL behaviour assertions: stage one publishes the finite
 * interface and reports `unsupported` for `advanceWork`, so the run stops at
 * its first Workflow call and the later retry/continuation assertions are NOT
 * reached by the skeleton (they are reported as unreached, never as a green
 * "expected unsupported").
 *
 * Specification: docs/refactor/tasks/R5-workflow-advancement-skeleton.md §2/§4/§5.
 */
import { afterEach, expect, it } from 'vitest';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';
import type { WorkflowDependencies, WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import type { RuntimeExecutionPort } from '../../src/core/agent-runtime/ports.js';
import { createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import type { EvidencePort } from '../../src/core/work-graph/evidence/contracts.js';
import type { RegisteredCheckRunner } from '../../src/core/agent-runtime/check-execution.js';
import { join } from 'node:path';
import { createTaskClaimFixture, type TaskClaimFixture } from '../helpers/task-claim-fixture.js';

const fixtures: TaskClaimFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

function unsupported(reason: string) {
  return { status: 'rejected' as const, code: 'unsupported' as const, reason };
}

/** Assembly under test: real WorkGraph owners + real Runtime Session creation,
 * with the execution/verification owners as explicit controlled doubles. */
async function assemble(fixture: TaskClaimFixture) {
  const kernelStores = await createKernelStoreRegistry({ entries: [{
    adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store',
    workspace: fixture.scope, databasePath: join(fixture.directory, 'kernel.sqlite'),
  }] });
  const sessions = createSessionOperations({ sessions: fixture.sessionsPort, kernelStores });
  const runtime: RuntimeExecutionPort = {
    capabilities: async () => unsupported('R5c business test never reads capabilities'),
    createSession: (...args) => sessions.createSession(...args),
    readSessionHistory: (...args) => sessions.readSessionHistory(...args),
    readExecutionHistory: async () => unsupported('R5c business test never reads execution history'),
    readTaskExecutionHistory: async () => unsupported('R5c business test never reads task history'),
    prepareExecution: async () => unsupported('R5c business test stops before prepare'),
    startRun: async () => unsupported('R5c business test stops before start'),
    observeRun: async () => unsupported('R5c business test never observes'),
  };
  const evidence: EvidencePort = {
    openVerification: async () => unsupported('R5c business test does not open checks'),
    readVerification: async () => unsupported('R5c business test does not read checks'),
    beginCheck: async () => unsupported('R5c business test does not begin checks'),
    recordCheckResult: async () => unsupported('R5c business test does not record checks'),
    submitEvidence: async () => unsupported('R5c business test does not submit evidence'),
    finalizeChecks: async () => unsupported('R5c business test does not finalize checks'),
  };
  const checks: RegisteredCheckRunner = {
    runRegisteredCheck: async () => unsupported('R5c business test does not run checks'),
  };
  const { authority } = createMaterialRecordReaders(fixture.records);
  const configuration: WorkflowHostConfiguration = {
    consumerId: 'r5c-business-consumer',
    bindings: [{
      workspace: fixture.scope,
      sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding: fixture.roleBinding,
      budget: fixture.budget,
    }],
  };
  const dependencies: WorkflowDependencies = {
    tasks: fixture.goals, plans: fixture.plans, sessions: fixture.sessionsPort, claims: fixture.service,
    executions: createRunStateReader({ records: fixture.records }), runtime,
    evidence, checks, sourceAuthority: createSourceAuthorityReader({ authority }), configuration,
  };
  return createWorkflow(dependencies);
}

function selectWork(fixture: TaskClaimFixture, flowId: string, goalRef = fixture.goalRef): WorkflowAdvanceInput {
  return { schemaVersion: 1, goalRef, flowId, sessionHint: null, kind: 'select_work' };
}

it('selects the first required work, performs the exact owner request, and replays the original receipt', async () => {
  const fixture = await createTaskClaimFixture('memory');
  fixtures.push(fixture);
  const workflow = await assemble(fixture);

  const selected = await workflow.advanceWork(fixture.ctx, selectWork(fixture, 'r5c-flow-normal'));
  expect(selected, 'the first selection must return the next complete request').toMatchObject({
    status: 'ready',
    value: {
      state: 'advance', receipt: null,
      next: { kind: 'perform', operation: { kind: 'claim_task' } },
    },
  });
  if (selected.status !== 'ready') throw new Error(`selection did not advance: ${JSON.stringify(selected)}`);
  const next = selected.value.next;
  expect(next, 'an advance must carry the next request').not.toBeNull();
  if (next === null || next.kind !== 'perform') throw new Error('selection did not return a perform step');
  if (next.operation.kind !== 'claim_task') throw new Error('the first selected step must be the claim');
  // The Workflow derives the canonical request identity; it is not the flowId.
  expect(next.operation.request.meta.requestId).toMatch(/^wf:[0-9a-f]{64}$/);
  expect(next.operation.request.input.taskId).toBe('implement-a');

  // Host sends the exact request once; the Workflow calls the one owner and
  // preserves its complete receipt.
  const performed = await workflow.advanceWork(fixture.ctx, next);
  expect(performed).toMatchObject({ status: 'ready', value: { state: 'advance', receipt: { kind: 'claim_task' } } });
  if (performed.status !== 'ready' || performed.value.receipt?.kind !== 'claim_task') {
    throw new Error(`claim step did not return its receipt: ${JSON.stringify(performed)}`);
  }
  expect(performed.value.receipt.result).toMatchObject({ status: 'committed' });
  expect(performed.value.next).toMatchObject({ kind: 'perform', operation: { kind: 'prepare' } });

  // A lost-response retry re-sends the SAME perform input: same requestId, same
  // pins, and the core returns the original receipt as a replay.
  const replayed = await workflow.advanceWork(fixture.ctx, next);
  expect(replayed).toMatchObject({ status: 'ready', value: { receipt: { kind: 'claim_task' } } });
  if (replayed.status !== 'ready' || replayed.value.receipt?.kind !== 'claim_task') {
    throw new Error(`retry did not return the original receipt: ${JSON.stringify(replayed)}`);
  }
  expect(replayed.value.receipt.result).toEqual({ ...performed.value.receipt.result, replayed: true });
});

it('reports a required plan_only future node as waiting instead of inventing work', async () => {
  const fixture = await createTaskClaimFixture('memory');
  fixtures.push(fixture);
  const workflow = await assemble(fixture);

  const goalRef = { aggregateType: 'Goal' as const, projectId: fixture.scope.projectId, goalId: 'r5c-required-future-goal' };
  const created = await fixture.goals.createGoal(fixture.ctx, {
    meta: { requestId: 'r5c-required-future-goal', expected: [
      { ref: fixture.projectRef, revision: 1 }, { ref: fixture.workspaceRef, revision: 1 }] },
    input: { goalId: goalRef.goalId, workspace: fixture.scope, objective: 'Only a required future intent exists' },
  });
  expect(created, 'the second Goal is a real write').toMatchObject({ status: 'committed' });
  if (created.status !== 'committed') throw new Error('second Goal creation failed');

  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: 'r5c-required-future-plan', planRevision: 1, goalId: goalRef.goalId, stages: [],
    tasks: [{ taskId: 'future-only', title: 'Required future intent without execution', requirementLevel: 'required',
      taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'plan_only' }],
    assignments: [], obligations: [], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
    taskRelations: [], inputRequirements: [],
  };
  const proposed = await fixture.plans.proposePlan(fixture.ctx, {
    meta: { requestId: 'r5c-required-future-propose', expected: [{ ref: goalRef, revision: 1 }] },
    input: { goalRef, basedOn: null, draft, reason: { text: 'Only a future required intent', sources: [] } },
  });
  expect(proposed, 'the future-only Plan is a real proposal').toMatchObject({ status: 'committed' });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) throw new Error('future-only proposal failed');
  const applied = await fixture.plans.applyPlanChange(fixture.ctx, {
    meta: { requestId: 'r5c-required-future-apply', expected: [{ ref: goalRef, revision: 1 }] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
  });
  expect(applied, 'the future-only Plan is adopted').toMatchObject({ status: 'committed' });
  if (applied.status !== 'committed') throw new Error('future-only adoption failed');

  const selected = await workflow.advanceWork(fixture.ctx, selectWork(fixture, 'r5c-flow-required-future', goalRef));
  expect(selected, 'a required plan_only node cannot be turned into execution').toMatchObject({
    status: 'ready',
    value: { state: 'waiting', next: null, receipt: null },
  });
  if (selected.status !== 'ready') throw new Error('the future-only Goal should be a ready waiting result');
  expect(selected.value.reason, 'waiting must carry the real gap').toBeTruthy();
});
