/**
 * R5c.1 Workflow advancement stage-one final-behaviour test.
 *
 * The real WorkGraph fixture produces a formal Project/Workspace/governance,
 * a Goal and an adopted Plan with two required work tasks and a Goal gate; the
 * Session facts come from the real Session directory and the real Runtime
 * Session creation. The execution/verification ports come from the real
 * composition root over the same records; this file proves the Workflow's own
 * selection/continuation decisions without faking any domain PASS or
 * Task/Goal completion.
 *
 * Specification: docs/refactor/tasks/R5-workflow-advancement-skeleton.md §2/§4/§5.
 */
import { afterEach, expect, it } from 'vitest';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';
import type { WorkflowDependencies, WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import type { RuntimeExecutionPort } from '../../src/core/agent-runtime/ports.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import type { SessionMailboxDependencies } from '../../src/core/work-graph/model/communication-contracts.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import type { EvidencePort } from '../../src/core/work-graph/model/evidence-contracts.js';
import type { RegisteredCheckRunner } from '../../src/core/agent-runtime/check-execution.js';
import { join } from 'node:path';
import { createTaskClaimFixture, type TaskClaimFixture } from '../helpers/task-claim-fixture.js';
import { workflowPlanReads } from '../helpers/S1-workflow-archive-fixture.js';
import { openMemoryPlatform } from '../helpers/K3-review-card-fixture.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { INITIALIZATION_BINDING_SCHEMAS } from '../../src/core/work-graph/persistence/initialization-binding-codecs.js';

const R5C_SCHEMAS = {
  records: [...COMPLETION_RECORD_SCHEMAS.records, ...QUERY_JOB_RECORD_SCHEMAS.records,
    ...INITIALIZATION_BINDING_SCHEMAS.records],
  events: [...COMPLETION_RECORD_SCHEMAS.events, ...QUERY_JOB_RECORD_SCHEMAS.events,
    ...INITIALIZATION_BINDING_SCHEMAS.events],
  lookups: [...(COMPLETION_RECORD_SCHEMAS.lookups ?? []), ...(QUERY_JOB_RECORD_SCHEMAS.lookups ?? []),
    ...(INITIALIZATION_BINDING_SCHEMAS.lookups ?? [])],
};

const fixtures: TaskClaimFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

/** Assembly under test: the real WorkGraph owners and the composition's real
 * Runtime/evidence/check ports over the same records. */
async function assemble(fixture: TaskClaimFixture) {
  const kernelEntries = { entries: [{
    adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store',
    workspace: fixture.scope, databasePath: join(fixture.directory, 'kernel.sqlite'),
  }] };
  const configuration: WorkflowHostConfiguration = {
    consumerId: 'r5c-business-consumer',
    bindings: [{
      workspace: fixture.scope,
      sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding: fixture.roleBinding,
      budget: fixture.budget,
    }],
  };
  // The real composition root over the SAME records and Kernel store: its published
  // runtime/evidence/checks are the production ports, not a hand-written whole object.
  const platform = await openMemoryPlatform(fixture.records as never, new RawArtifactBodyStore(), {
    now: () => '2026-09-24T00:00:00.000Z',
    kernelStores: kernelEntries,
    workspace: {
      async resolveRoot() {
        return { status: 'ready' as const, value: { root: fixture.directory, workspaceRevision: 1 } };
      },
      async authorize() {
        return { status: 'ready' as const, value: { subjectKey: 'r5c-business-host',
          permissionRevision: 'r5c-business@1', allowsRead: () => true } };
      },
    },
    workflow: configuration,
  });
  const runtime: RuntimeExecutionPort = platform.runtime;
  const evidence: EvidencePort = platform.evidence;
  const checks: RegisteredCheckRunner = platform.checks;
  const { authority } = createMaterialRecordReaders(fixture.records);
  const bodies = new RawArtifactBodyStore();
  const materials = createMaterialService({ bodies, authority, now: () => '2026-09-24T00:00:00.000Z' });
  let sequence = 0;
  const mailboxDeps: SessionMailboxDependencies = {
    records: fixture.records, sessions: fixture.sessionsPort,
    executions: createRunStateReader({ records: fixture.records }), roles: createRoleConfigurationService({
      records: fixture.records, now: () => '2026-09-24T00:00:00.000Z', eventId: () => `r5c-role-${++sequence}` }),
    materials,
    defaultInquiryDeadlineMs: 86_400_000,
    systemActor: { kind: 'system', id: 'r5c-business-system' },
    now: () => '2026-09-24T00:00:00.000Z', newId: () => `r5c-business-${++sequence}`,
  };
  const messages = createSessionMailbox(mailboxDeps);
  const planReads = workflowPlanReads({ records: fixture.records, messages, plans: fixture.plans,
    now: mailboxDeps.now, newId: mailboxDeps.newId, mailboxDeps, materials });
  const dependencies: WorkflowDependencies = {
    tasks: fixture.goals, plans: fixture.plans, sessions: fixture.sessionsPort, claims: fixture.service,
    executions: createRunStateReader({ records: fixture.records }), runtime,
    ...planReads,
    evidence, checks, sourceAuthority: createSourceAuthorityReader({ authority }), configuration,
  };
  return createWorkflow(dependencies);
}

function selectWork(fixture: TaskClaimFixture, flowId: string, goalRef = fixture.goalRef): WorkflowAdvanceInput {
  return { schemaVersion: 1, goalRef, flowId, sessionHint: null, kind: 'select_work' };
}

it('selects the first required work, performs the exact owner request, and replays the original receipt', async () => {
  const fixture = await createTaskClaimFixture('memory', R5C_SCHEMAS);
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
  const fixture = await createTaskClaimFixture('memory', R5C_SCHEMAS);
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
