import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type { EncodedRecord, EncodedRecordSchema, PreparedCommit, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { GOAL_RECORD_SCHEMAS, encodeProjectSnapshot, encodeWorkspaceSnapshot, canonicalRefKey } from '../../src/core/work-graph/persistence/record-codecs.js';
import { PLAN_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-record-codecs.js';
import { PLAN_STATE_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-readers.js';
import { materialRecordSchemas } from '../../src/core/work-graph/materials/record-readers.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { RunSnapshot, TaskLeaseSnapshot } from '../../src/contracts/dispatch.js';
import { makeCommitCursor, seqOfCommitCursor } from '../../src/contracts/ledger.js';

const at = '2026-09-24T00:00:00.000Z';
const projectId = 'r3c-adoption';
const workspaceId = 'r3c-workspace';
const project: ProjectSnapshot = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
const workspace: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 };
const actor = { kind: 'human' as const, id: 'r3c-author' };
const ctx: CoreCallContext = { projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };

const policyFixture = { schemaVersion: 1, identity: { policyId: 'policy-1' }, revision: 2,
  content: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 } };
const architectureFixture = { schemaVersion: 1, identity: { baselineId: 'baseline-1' }, revision: 2,
  content: { schemaVersion: 1, description: 'Accepted baseline', constraints: [] } };
const digest = (value: JsonValue) => sha256Hex(canonicalJson(value));
const policyRef = { aggregateType: 'CompletionPolicyRevision', projectId, policyId: 'policy-1', revision: 2 };
const architectureRef = { aggregateType: 'ArchitectureBaselineRevision', projectId, baselineId: 'baseline-1', revision: 2 };
const policyActiveRef = { aggregateType: 'ProjectCompletionPolicyActive', projectId };
const architectureActiveRef = { aggregateType: 'ProjectArchitectureBaselineActive', projectId };
const governance = [
  { ref: policyRef, revision: 1, schemaVersion: 1, policyId: 'policy-1', contentRevision: 2,
    contentDigest: digest(policyFixture), content: policyFixture.content },
  { ref: architectureRef, revision: 1, schemaVersion: 1, baselineId: 'baseline-1', contentRevision: 2,
    contentDigest: digest(architectureFixture), content: architectureFixture.content },
  { ref: policyActiveRef, projectId, revision: 1, activeRevision: policyRef },
  { ref: architectureActiveRef, projectId, revision: 1, activeRevision: architectureRef },
];
const encoded = (snapshot: (typeof governance)[number]): EncodedRecord => ({
  refKey: canonicalJson(snapshot.ref as JsonValue),
  schemaId: `${snapshot.ref.aggregateType}Snapshot@1`, revision: snapshot.revision,
  json: JSON.stringify(snapshot),
});
const governanceSchemas: EncodedRecordSchema[] = governance.map(snapshot => ({
  aggregateType: snapshot.ref.aggregateType,
  schemaId: `${snapshot.ref.aggregateType}Snapshot@1`,
  validate: record => record.refKey === canonicalJson(snapshot.ref as JsonValue) &&
    record.schemaId === `${snapshot.ref.aggregateType}Snapshot@1`
    ? { status: 'decoded', value: record } : { status: 'invalid', reason: 'wrong test prerequisite' },
}));
const schemas: RecordBackendSchemas = {
  records: [...GOAL_RECORD_SCHEMAS.records, ...governanceSchemas, ...PLAN_RECORD_SCHEMAS.records,
    ...PLAN_STATE_RECORD_SCHEMAS.records,
    ...materialRecordSchemas().records.filter(record => record.aggregateType === 'Run')],
  events: [...GOAL_RECORD_SCHEMAS.events, ...PLAN_RECORD_SCHEMAS.events,
    { eventType: 'ScopeSeeded', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) },
    { eventType: 'TaskStateSeeded', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }],
  lookups: [...PLAN_RECORD_SCHEMAS.lookups, ...(PLAN_STATE_RECORD_SCHEMAS.lookups ?? [])],
};
const seed: PreparedCommit = { identityKey: 'r3c-adoption-seed', fingerprint: 'r3c-adoption-seed-v1',
  guards: [project.ref, workspace.ref, ...governance.map(x => x.ref)].map(ref => ({
    refKey: canonicalJson(ref as JsonValue), expectedRevision: null })),
  records: [encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspace), ...governance.map(encoded)],
  events: [{ eventId: 'r3c-adoption-seed-event', eventType: 'ScopeSeeded', schemaVersion: 1,
    occurredAt: at, json: JSON.stringify({ eventId: 'r3c-adoption-seed-event', eventType: 'ScopeSeeded',
      schemaVersion: 1, occurredAt: at }) }], claims: [], indexGuards: [], indexChanges: [],
};

function validDraft(): PlanRevisionDraft {
  const work = (taskId: string, title: string) => ({ taskId, title, requirementLevel: 'required' as const,
    taskKind: 'work' as const, disposition: 'active' as const, phase: 'pending' as const,
    scope: { kind: 'goal' as const } });
  return { schemaVersion: 1, planId: 'plan-1', planRevision: 1, goalId: 'goal-1', stages: [],
    tasks: [work('design', 'Design'), work('implement', 'Implement'),
      { taskId: 'goal-gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
    assignments: [{ taskId: 'design', role: 'builder', instruction: 'Prepare design' },
      { taskId: 'implement', role: 'builder', instruction: 'Implement design' }],
    obligations: [{ obligationId: 'o-1', title: 'Deliver work', requirementLevel: 'required',
      taskIds: ['design', 'implement', 'goal-gate'], verificationRequirements: [
        { requirementId: 'check-1', requirementLevel: 'required', kind: 'test', description: 'Tests pass' },
      ] }], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [
      { taskId: 'implement', dependsOnId: 'design', requires: { kind: 'artifact', label: 'design' } },
    ] } };
}

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

it.each(['memory', 'sqlite'] as const)('%s: real Goal→candidate→accepted Plan is atomic, immutable and queryable', async kind => {
  const dir = kind === 'sqlite' ? await mkdtemp(join(tmpdir(), 'next-r3c-adopt-')) : null;
  if (dir !== null) dirs.push(dir);
  const backend = kind === 'memory' ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ path: join(dir!, 'records.sqlite'), schemas });
  try {
    expect(await backend.records.commit(seed)).toMatchObject({ status: 'committed' });
    let sequence = 0;
    const goals = createGoalService({ records: backend.records, now: () => at,
      eventId: () => `r3c-goal-${++sequence}` }).tasks;
    const plans = createPlanService({ records: backend.records, now: () => at,
      eventId: () => `r3c-plan-${++sequence}` });
    const goal = await goals.createGoal(ctx, { meta: { requestId: 'create-goal',
      expected: [{ ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 1 }] },
      input: { goalId: 'goal-1', workspace: { projectId, workspaceId }, objective: 'Build product' } });
    expect(goal).toMatchObject({ status: 'committed' });
    if (goal.status !== 'committed') throw Error('real Goal creation failed');
    const draft = validDraft();
    const proposed = await plans.proposePlan(ctx, { meta: { requestId: 'propose-plan',
      expected: [{ ref: goal.value.ref, revision: 1 }] },
      input: { goalRef: goal.value.ref, basedOn: null, draft,
        reason: { text: 'Initial plan', sources: [] } } });
    expect(proposed).toMatchObject({ status: 'committed', value: { kind: 'candidate_v2', issues: [] } });
    if (proposed.status !== 'committed') throw Error('valid proposal failed');
    const applyInput = { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision,
      decisionRefs: [] };
    const applied = await plans.applyPlanChange(ctx, { meta: { requestId: 'apply-plan',
      expected: [{ ref: goal.value.ref, revision: 1 }] }, input: applyInput });
    expect(applied).toMatchObject({ status: 'committed', replayed: false,
      value: { ref: { aggregateType: 'PlanRevision', projectId, planId: 'plan-1' },
        revision: 1, planRevision: 1,
        effectiveCompletionPolicy: { ref: { revision: 2 }, digest: digest(policyFixture) },
        effectiveArchitectureBaseline: { ref: { revision: 2 }, digest: digest(architectureFixture) } } });
    if (applied.status !== 'committed') throw Error('initial Plan adoption failed');
    const replay = await plans.applyPlanChange(ctx, { meta: { requestId: 'apply-plan',
      expected: [{ ref: goal.value.ref, revision: 1 }] }, input: applyInput });
    expect(replay).toMatchObject({ status: 'committed', replayed: true, value: applied.value });
    expect(await plans.applyPlanChange(ctx, { meta: { requestId: 'apply-plan',
      expected: [{ ref: goal.value.ref, revision: 1 }] }, input: { ...applyInput, decisionRefs: [
        { ref: goal.value.ref, revision: 1 },
      ] } })).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect(await plans.queryGoal(ctx, goal.value.ref)).toMatchObject({ status: 'ready',
      value: { goal: { activePlanRevision: applied.value.ref, revision: 2 } } });
    const graph = await plans.queryTaskGraph(ctx, { goalRef: goal.value.ref });
    expect(graph).toMatchObject({ status: 'ready', value: { plan: applied.value,
      tasks: [{ ref: { taskId: 'design' } }, { ref: { taskId: 'implement' } },
        { ref: { taskId: 'goal-gate' } }] } });
    expect(await plans.queryTaskGraph(ctx, { goalRef: goal.value.ref,
      atLeastCursor: applied.cursor })).toMatchObject({ status: 'ready' });
    expect(await plans.queryTaskGraph(ctx, { goalRef: goal.value.ref,
      atLeastCursor: makeCommitCursor(seqOfCommitCursor(applied.cursor) + 1_000) }))
      .toMatchObject({ status: 'not_ready' });
    const ready = await plans.queryReadyTasks(ctx, { goalRef: goal.value.ref, includeBlocked: false,
      page: { limit: 10 } });
    expect(ready).toMatchObject({ status: 'ready', value: { items: [
      { task: { ref: { taskId: 'design' }, eligibilityScope: 'task_state',
        eligibility: { eligible: true, reasons: [] } } },
      // Legacy dependsOn label has no exact input pin. A predecessor's whole
      // Task completion is no longer a candidate filter.
      { task: { ref: { taskId: 'implement' }, eligibilityScope: 'task_state',
        eligibility: { eligible: true, reasons: [] },
        legacyDependencies: [{ verification: 'legacy_unverifiable' }] } },
    ] } });
    const storedPlan = await backend.records.readMany([canonicalJson(applied.value.ref as JsonValue)]);
    expect(storedPlan).toMatchObject({ status: 'ready', value: { records: [
      { revision: 1, json: expect.any(String) },
    ] } });
    if (storedPlan.status !== 'ready') throw Error('stored Plan is unavailable');
    expect(JSON.parse(storedPlan.value.records[0]!.json).tasks[0].phase).toBe('pending');

    // The final Run lookup page can become stale before the exact-record read.
    // Insert a real ended Run in that gap; an unresolved attempt cannot become
    // a fresh ready task merely because TaskReduction has not arrived yet.
    const endedRun: RunSnapshot = { ref: { aggregateType: 'Run', projectId,
      goalId: 'goal-1', runId: 'design-ended-without-reduction' }, revision: 1, schemaVersion: 1,
      task: { projectId, goalId: 'goal-1', taskId: 'design' }, attemptId: 'design-ended-attempt',
      planRef: applied.value.ref, roleBinding: { schemaVersion: 1, bindingId: 'binding-ended',
        templateId: 'builder', templateRevision: '1', bindingVersion: 1, policyRevision: '1' },
      budget: { tokenBudget: 100, deadline: null }, workspaceSnapshot: { workspaceId, revision: 1 },
      status: 'ended', outcome: 'outcome_unknown', exitCode: null, lastEventSeq: 1,
      lastRuntimeEventId: 'run-ended', lastFactEventId: 'run-ended-fact', envelope: null,
      startedAt: at, endedAt: at };
    let injectEndedRun = true;
    const racingReadyReader = createPlanService({ records: {
      ...backend.records,
      async lookup(request) {
        const page = await backend.records.lookup(request);
        if (injectEndedRun && request.index === 'r3c-run-by-goal'
          && page.status === 'ready' && page.value.next === null) {
          injectEndedRun = false;
          const stateEvent = { eventId: 'ended-run-race', eventType: 'TaskStateSeeded',
            schemaVersion: 1, occurredAt: at };
          expect(await backend.records.commit({ identityKey: 'ended-run-race', fingerprint: 'ended-run-race-v1',
            guards: [{ refKey: canonicalJson(endedRun.ref as JsonValue), expectedRevision: null }],
            records: [{ refKey: canonicalJson(endedRun.ref as JsonValue), schemaId: 'RunSnapshot@1',
              revision: endedRun.revision, json: JSON.stringify(endedRun) }],
            events: [{ ...stateEvent, json: JSON.stringify(stateEvent) }],
            claims: [], indexGuards: [], indexChanges: [] })).toMatchObject({ status: 'committed' });
        }
        return page;
      },
    }, now: () => at, eventId: () => `r3c-ready-race-${++sequence}` });
    const racedReady = await racingReadyReader.queryReadyTasks(ctx, { goalRef: goal.value.ref,
      includeBlocked: false, page: { limit: 10 } });
    expect(injectEndedRun).toBe(false);
    if (racedReady.status === 'ready') {
      expect(racedReady.value.items).not.toContainEqual(expect.objectContaining({
        task: expect.objectContaining({ ref: expect.objectContaining({ taskId: 'design' }),
          eligibility: expect.objectContaining({ eligible: true }) }),
      }));
    } else {
      expect(['not_ready', 'rejected']).toContain(racedReady.status);
    }
    const endedGraph = await plans.queryTaskGraph(ctx, { goalRef: goal.value.ref });
    if (endedGraph.status === 'ready') {
      expect(endedGraph.value.tasks.find(task => task.ref.taskId === 'design')).toMatchObject({
        eligibility: { eligible: false }, execution: endedRun.ref,
      });
    } else {
      expect(['not_ready', 'rejected']).toContain(endedGraph.status);
    }

    // A real canonical Run/Lease appears after the accepted Plan. The Plan's
    // immutable `phase` stays pending, while the graph and readiness must use
    // these newer facts. Empty/unsupported readers must not mean "free".
    const runRef = { aggregateType: 'Run' as const, projectId, goalId: 'goal-1', runId: 'design-run' };
    const run: RunSnapshot = { ref: runRef, revision: 1, schemaVersion: 1,
      task: { projectId, goalId: 'goal-1', taskId: 'design' }, attemptId: 'design-attempt',
      planRef: applied.value.ref, roleBinding: { schemaVersion: 1, bindingId: 'binding-1',
        templateId: 'builder', templateRevision: '1', bindingVersion: 1, policyRevision: '1' },
      budget: { tokenBudget: 100, deadline: null }, workspaceSnapshot: { workspaceId, revision: 1 },
      status: 'running', outcome: null, exitCode: null, lastEventSeq: 1,
      lastRuntimeEventId: 'run-started', lastFactEventId: 'run-fact', envelope: null,
      startedAt: at, endedAt: null };
    const lease: TaskLeaseSnapshot = { ref: { aggregateType: 'TaskLease', projectId,
      goalId: 'goal-1', taskId: 'design' }, revision: 1, schemaVersion: 1,
      holderRunId: runRef.runId, attemptId: 'design-attempt', grantedAt: at, expiresAt: null };
    const stateEvent = { eventId: 'canonical-task-state', eventType: 'TaskStateSeeded',
      schemaVersion: 1, occurredAt: at };
    expect(await backend.records.commit({ identityKey: 'canonical-task-state', fingerprint: 'canonical-task-state-v1',
      guards: [run.ref, lease.ref].map(ref => ({ refKey: canonicalJson(ref as JsonValue), expectedRevision: null })),
      records: [run, lease].map(snapshot => ({ refKey: canonicalJson(snapshot.ref as JsonValue),
        schemaId: `${snapshot.ref.aggregateType}Snapshot@1`, revision: snapshot.revision,
        json: JSON.stringify(snapshot) })),
      events: [{ ...stateEvent, json: JSON.stringify(stateEvent) }],
      claims: [], indexGuards: [], indexChanges: [] })).toMatchObject({ status: 'committed' });
    const graphWithRun = await plans.queryTaskGraph(ctx, { goalRef: goal.value.ref });
    expect(graphWithRun).toMatchObject({ status: 'ready', value: { tasks: [
      { ref: { taskId: 'design' }, definition: { phase: 'pending' },
        effectivePhase: 'running', execution: runRef, eligibility: { eligible: false } },
      { ref: { taskId: 'implement' }, definition: { phase: 'pending' },
        effectivePhase: 'pending', eligibility: { eligible: true } },
      { ref: { taskId: 'goal-gate' }, definition: { phase: 'pending' },
        effectivePhase: 'pending', eligibility: { eligible: false } },
    ] } });
    if (graphWithRun.status !== 'ready') throw Error('task graph unavailable after Run');
    expect(graphWithRun.value.tasks).toHaveLength(3);
    expect(await plans.queryReadyTasks(ctx, { goalRef: goal.value.ref, includeBlocked: false,
      page: { limit: 10 } })).toMatchObject({ status: 'ready', value: { items: [{ task: { ref: { taskId: 'implement' } } }] } });

    const implementRun: RunSnapshot = { ...run,
      ref: { aggregateType: 'Run', projectId, goalId: 'goal-1', runId: 'implement-race' },
      task: { projectId, goalId: 'goal-1', taskId: 'implement' }, attemptId: 'implement-race-attempt',
      lastRuntimeEventId: 'implement-race-started', lastFactEventId: 'implement-race-fact' };
    let injectImplementRun = true;
    const racingGraphReader = createPlanService({ records: {
      ...backend.records,
      async lookup(request) {
        const page = await backend.records.lookup(request);
        if (injectImplementRun && request.index === 'r3c-run-by-goal'
          && page.status === 'ready' && page.value.next === null) {
          injectImplementRun = false;
          const stateEvent = { eventId: 'implement-run-race', eventType: 'TaskStateSeeded',
            schemaVersion: 1, occurredAt: at };
          expect(await backend.records.commit({ identityKey: 'implement-run-race',
            fingerprint: 'implement-run-race-v1',
            guards: [{ refKey: canonicalJson(implementRun.ref as JsonValue), expectedRevision: null }],
            records: [{ refKey: canonicalJson(implementRun.ref as JsonValue), schemaId: 'RunSnapshot@1',
              revision: implementRun.revision, json: JSON.stringify(implementRun) }],
            events: [{ ...stateEvent, json: JSON.stringify(stateEvent) }],
            claims: [], indexGuards: [], indexChanges: [] })).toMatchObject({ status: 'committed' });
        }
        return page;
      },
    }, now: () => at, eventId: () => `r3c-graph-race-${++sequence}` });
    const racedGraph = await racingGraphReader.queryTaskGraph(ctx, { goalRef: goal.value.ref });
    expect(injectImplementRun).toBe(false);
    if (racedGraph.status === 'ready') {
      expect(racedGraph.value.tasks.find(task => task.ref.taskId === 'implement')).toMatchObject({
        effectivePhase: 'running', execution: implementRun.ref, eligibility: { eligible: false },
      });
      expect(racedGraph.value.tasks).toHaveLength(3);
    } else {
      expect(['not_ready', 'rejected']).toContain(racedGraph.status);
    }

    const changedDraft = { ...validDraft(), planId: 'plan-change', planRevision: 2 };
    expect(await plans.proposePlan(ctx, { meta: { requestId: 'stale-proposal',
      expected: [{ ref: goal.value.ref, revision: 1 }] },
      input: { goalRef: goal.value.ref, basedOn: applied.value.ref, draft: changedDraft,
        reason: { text: 'Stale caller', sources: [] } } })).toMatchObject({
      status: 'rejected', code: 'revision_conflict',
    });
    const change = await plans.proposePlan(ctx, { meta: { requestId: 'change-proposal',
      expected: [{ ref: goal.value.ref, revision: 2 }] },
      input: { goalRef: goal.value.ref, basedOn: applied.value.ref, draft: changedDraft,
        reason: { text: 'Change candidate', sources: [] } } });
    expect(change).toMatchObject({ status: 'committed', value: { kind: 'candidate_v2' } });
    if (change.status !== 'committed') throw Error('change candidate failed');
    expect(await plans.applyPlanChange(ctx, { meta: { requestId: 'change-no-decision',
      expected: [{ ref: goal.value.ref, revision: 2 }] },
      input: { proposalRef: change.value.ref, expectedProposalRevision: change.value.revision,
        decisionRefs: [] } })).toMatchObject({ status: 'rejected' });
    expect(await plans.queryGoal(ctx, goal.value.ref)).toMatchObject({ status: 'ready',
      value: { goal: { activePlanRevision: applied.value.ref, revision: 2 } } });
    expect(await backend.records.readMany([canonicalJson({ aggregateType: 'PlanRevision', projectId,
      planId: 'plan-change' })])).toMatchObject({ status: 'ready', value: { missing: [
      canonicalJson({ aggregateType: 'PlanRevision', projectId, planId: 'plan-change' }),
    ] } });

    const secondGoal = await goals.createGoal(ctx, { meta: { requestId: 'create-goal-2',
      expected: [{ ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 1 }] },
      input: { goalId: 'goal-2', workspace: { projectId, workspaceId }, objective: 'Cycle guard' } });
    expect(secondGoal).toMatchObject({ status: 'committed' });
    if (secondGoal.status !== 'committed') throw Error('second Goal creation failed');
    const pendingDraft = validDraft();
    pendingDraft.goalId = 'goal-2';
    pendingDraft.planId = 'pending-race-plan';
    let injectProposal = true;
    const racingProposalReader = createPlanService({ records: {
      ...backend.records,
      async lookup(request) {
        const page = await backend.records.lookup(request);
        if (injectProposal && request.index === 'plan-proposal-by-goal'
          && page.status === 'ready' && page.value.next === null) {
          injectProposal = false;
          const inserted = await plans.proposePlan(ctx, { meta: { requestId: 'pending-race-proposal',
            expected: [{ ref: secondGoal.value.ref, revision: 1 }] },
            input: { goalRef: secondGoal.value.ref, basedOn: null, draft: pendingDraft,
              reason: { text: 'Proposal committed after candidate lookup', sources: [] } } });
          expect(inserted).toMatchObject({ status: 'committed' });
        }
        return page;
      },
    }, now: () => at, eventId: () => `r3c-proposal-race-${++sequence}` });
    const racedPending = await racingProposalReader.queryGoal(ctx, secondGoal.value.ref);
    expect(injectProposal).toBe(false);
    if (racedPending.status === 'ready') {
      expect(racedPending.value.pendingPlan).toMatchObject({ kind: 'candidate_v2',
        ref: { proposalId: expect.any(String) }, goalRef: secondGoal.value.ref });
    } else {
      expect(['not_ready', 'rejected']).toContain(racedPending.status);
    }
    const cyclicDraft = validDraft();
    cyclicDraft.goalId = 'goal-2';
    cyclicDraft.planId = 'plan-cycle';
    cyclicDraft.executionDag.dependsOn.push({ taskId: 'design', dependsOnId: 'implement',
      requires: { kind: 'artifact', label: 'implementation' } });
    const cyclic = await plans.proposePlan(ctx, { meta: { requestId: 'propose-cycle',
      expected: [{ ref: secondGoal.value.ref, revision: 1 }] },
      input: { goalRef: secondGoal.value.ref, basedOn: null, draft: cyclicDraft,
        reason: { text: 'Check cycle rejection', sources: [] } } });
    expect(cyclic).toMatchObject({ status: 'committed', value: { issues: [
      { code: 'dag_cycle' },
    ] } });
    if (cyclic.status !== 'committed') throw Error('cycle candidate was not recorded');
    expect(await plans.applyPlanChange(ctx, { meta: { requestId: 'apply-cycle',
      expected: [{ ref: secondGoal.value.ref, revision: 1 }] },
      input: { proposalRef: cyclic.value.ref, expectedProposalRevision: cyclic.value.revision,
        decisionRefs: [] } })).toMatchObject({ status: 'rejected' });
    expect(await plans.queryGoal(ctx, secondGoal.value.ref)).toMatchObject({ status: 'ready',
      value: { goal: { activePlanRevision: null, revision: 1 } } });
    expect(await backend.records.readMany([canonicalJson({ aggregateType: 'PlanRevision', projectId,
      planId: 'plan-cycle' })])).toMatchObject({ status: 'ready', value: { missing: [
      canonicalJson({ aggregateType: 'PlanRevision', projectId, planId: 'plan-cycle' }),
    ] } });

    // Two valid candidates exist at the old Goal pointer. Adopt one after
    // queryGoal's first real Goal read; the other is no longer pending for the
    // new pointer. A fresh Goal must never be paired with that stale candidate.
    const thirdGoal = await goals.createGoal(ctx, { meta: { requestId: 'create-goal-3',
      expected: [{ ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 1 }] },
      input: { goalId: 'goal-3', workspace: { projectId, workspaceId }, objective: 'Pointer race' } });
    expect(thirdGoal).toMatchObject({ status: 'committed' });
    if (thirdGoal.status !== 'committed') throw Error('third Goal creation failed');
    const staleDraft = validDraft();
    staleDraft.goalId = 'goal-3';
    staleDraft.planId = 'stale-pending-plan';
    const adoptingDraft = validDraft();
    adoptingDraft.goalId = 'goal-3';
    adoptingDraft.planId = 'adopting-plan';
    const staleCandidate = await plans.proposePlan(ctx, { meta: { requestId: 'stale-pending-candidate',
      expected: [{ ref: thirdGoal.value.ref, revision: 1 }] },
      input: { goalRef: thirdGoal.value.ref, basedOn: null, draft: staleDraft,
        reason: { text: 'Candidate left behind by adoption', sources: [] } } });
    const adoptingCandidate = await plans.proposePlan(ctx, { meta: { requestId: 'adopting-candidate',
      expected: [{ ref: thirdGoal.value.ref, revision: 1 }] },
      input: { goalRef: thirdGoal.value.ref, basedOn: null, draft: adoptingDraft,
        reason: { text: 'Candidate adopted during query', sources: [] } } });
    expect(staleCandidate).toMatchObject({ status: 'committed', value: { kind: 'candidate_v2', issues: [] } });
    expect(adoptingCandidate).toMatchObject({ status: 'committed', value: { kind: 'candidate_v2', issues: [] } });
    if (adoptingCandidate.status !== 'committed') throw Error('adopting candidate failed');
    const thirdGoalKey = canonicalJson(thirdGoal.value.ref as JsonValue);
    let injectAdoption = true;
    let adoptedRacePlanRef: typeof applied.value.ref | null = null;
    const racingGoalReader = createPlanService({ records: {
      ...backend.records,
      async readMany(keys) {
        const batch = await backend.records.readMany(keys);
        if (injectAdoption && keys.includes(thirdGoalKey) && batch.status === 'ready') {
          injectAdoption = false;
          const adopted = await plans.applyPlanChange(ctx, { meta: { requestId: 'adopt-during-query',
            expected: [{ ref: thirdGoal.value.ref, revision: 1 }] },
            input: { proposalRef: adoptingCandidate.value.ref,
              expectedProposalRevision: adoptingCandidate.value.revision, decisionRefs: [] } });
          expect(adopted).toMatchObject({ status: 'committed' });
          if (adopted.status !== 'committed') throw Error('race adoption failed');
          adoptedRacePlanRef = adopted.value.ref;
        }
        return batch;
      },
    }, now: () => at, eventId: () => `r3c-goal-race-${++sequence}` });
    const racedGoal = await racingGoalReader.queryGoal(ctx, thirdGoal.value.ref);
    expect(injectAdoption).toBe(false);
    if (racedGoal.status === 'ready') {
      expect(racedGoal.value.goal.activePlanRevision).toEqual(adoptedRacePlanRef);
      expect(racedGoal.value.pendingPlan).toBeNull();
    } else {
      expect(racedGoal.status).toBe('rejected');
    }
  } finally { await backend.close(); }
});
