import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type { EncodedRecord, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { encodeProjectSnapshot, encodeWorkspaceSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { materialRecordSchemas } from '../../src/core/work-graph/materials/record-readers.js';
import { PLAN_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-record-codecs.js';
import { PLAN_GOVERNANCE_RECORD_SCHEMAS, PLAN_STATE_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';

const at = '2026-09-24T00:00:00.000Z';
const projectId = 'r3c-relations';
const workspaceId = 'r3c-relations-workspace';
const project: ProjectSnapshot = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
const workspace: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 };
const actor = { kind: 'human' as const, id: 'r3c-relations-author' };
const ctx: CoreCallContext = { projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };
const digest = (value: JsonValue) => sha256Hex(canonicalJson(value));
const policy = { schemaVersion: 1, identity: { policyId: 'policy-1' }, revision: 2,
  content: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 } };
const architecture = { schemaVersion: 1, identity: { baselineId: 'baseline-1' }, revision: 2,
  content: { schemaVersion: 1, description: 'Accepted baseline', constraints: [] } };
const policyRef = { aggregateType: 'CompletionPolicyRevision', projectId, policyId: 'policy-1', revision: 2 };
const architectureRef = { aggregateType: 'ArchitectureBaselineRevision', projectId, baselineId: 'baseline-1', revision: 2 };
const governance = [
  { ref: policyRef, revision: 1, schemaVersion: 1, policyId: 'policy-1', contentRevision: 2,
    contentDigest: digest(policy), content: policy.content },
  { ref: architectureRef, revision: 1, schemaVersion: 1, baselineId: 'baseline-1', contentRevision: 2,
    contentDigest: digest(architecture), content: architecture.content },
  { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId }, projectId,
    revision: 1, activeRevision: policyRef },
  { ref: { aggregateType: 'ProjectArchitectureBaselineActive', projectId }, projectId,
    revision: 1, activeRevision: architectureRef },
];
const schemas: RecordBackendSchemas = {
  records: [...materialRecordSchemas().records, ...PLAN_GOVERNANCE_RECORD_SCHEMAS.records,
    ...PLAN_RECORD_SCHEMAS.records, ...PLAN_STATE_RECORD_SCHEMAS.records],
  events: [...materialRecordSchemas().events, ...PLAN_RECORD_SCHEMAS.events,
    { eventType: 'RelationScopeSeeded', schemaVersion: 1,
      validate: event => ({ status: 'decoded', value: event }) }],
  lookups: [...(PLAN_RECORD_SCHEMAS.lookups ?? []), ...(PLAN_STATE_RECORD_SCHEMAS.lookups ?? [])],
};
const artifactRef: ArtifactRef = { kind: 'artifact', contentType: 'text/plain', digest: 'a'.repeat(64),
  sizeBytes: 6, source: { kind: 'artifact', refId: 'design-output', revision: '1' } };

function draft(): PlanRevisionDraft {
  const work = (taskId: string) => ({ taskId, title: taskId, requirementLevel: 'required' as const,
    taskKind: 'work' as const, disposition: 'active' as const, phase: 'pending' as const,
    scope: { kind: 'goal' as const } });
  return { schemaVersion: 2, planId: 'plan-v2', planRevision: 1, goalId: 'goal-1', stages: [],
    tasks: [work('design'), work('implement'), { ...work('goal-gate'), taskKind: 'gate' }],
    assignments: [{ taskId: 'design', role: 'builder', instruction: 'Design' },
      { taskId: 'implement', role: 'builder', instruction: 'Implement' }],
    obligations: [{ obligationId: 'o-1', title: 'Deliver', requirementLevel: 'required',
      taskIds: ['design', 'implement', 'goal-gate'], verificationRequirements: [
        { requirementId: 'check-1', requirementLevel: 'required', kind: 'test', description: 'Tests pass' },
      ] }], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [
      { taskId: 'implement', dependsOnId: 'design', requires: { kind: 'artifact', label: 'old design label' } },
    ] }, taskRelations: [{ fromTaskId: 'design', toTaskId: 'implement',
      kind: 'expected_dependency', note: 'Coordinate the interface when useful' },
      { fromTaskId: 'implement', toTaskId: 'design', kind: 'coordination',
        note: 'Feedback may return while design remains open' }],
    inputRequirements: [{ requirementId: 'design-artifact', consumerTaskId: 'implement',
      kind: 'artifact', artifactRef }],
  };
}

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

it.each(['memory', 'sqlite'] as const)('%s: v2 relations and exact inputs survive adoption, replay and reopen without material reads', async kind => {
  const dir = kind === 'sqlite' ? await mkdtemp(join(tmpdir(), 'r3c-relations-')) : null;
  if (dir) dirs.push(dir);
  const path = dir === null ? '' : join(dir, 'records.sqlite');
  const open = () => kind === 'memory' ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ path, schemas });
  let backend = open();
  try {
    const seedRecords: EncodedRecord[] = [encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspace),
      ...governance.map(snapshot => ({ refKey: canonicalJson(snapshot.ref as JsonValue),
        schemaId: `${snapshot.ref.aggregateType}Snapshot@1`, revision: snapshot.revision,
        json: JSON.stringify(snapshot) }))];
    expect(await backend.records.commit({ identityKey: 'relation-seed', fingerprint: 'relation-seed',
      guards: seedRecords.map(record => ({ refKey: record.refKey, expectedRevision: null })),
      records: seedRecords, claims: [], indexGuards: [], indexChanges: [],
      events: [{ eventId: 'relation-seed-event', eventType: 'RelationScopeSeeded', schemaVersion: 1,
        occurredAt: at, json: JSON.stringify({ eventId: 'relation-seed-event', eventType: 'RelationScopeSeeded', schemaVersion: 1, occurredAt: at }) }],
    })).toMatchObject({ status: 'committed' });
    let sequence = 0;
    const goals = createGoalService({ records: backend.records, now: () => at,
      eventId: () => `goal-${++sequence}` }).tasks;
    let materialReads = 0;
    const plans = createPlanService({ records: backend.records, now: () => at,
      eventId: () => `plan-${++sequence}`, materials: { openArtifact: async () => {
        materialReads += 1;
        return { status: 'rejected', code: 'unsupported', reason: 'not expected for graph/ready' };
      } } });
    const goal = await goals.createGoal(ctx, { meta: { requestId: 'create-goal',
      expected: [{ ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 1 }] },
      input: { goalId: 'goal-1', workspace: { projectId, workspaceId }, objective: 'Build' } });
    expect(goal).toMatchObject({ status: 'committed' });
    if (goal.status !== 'committed') throw Error('Goal fixture failed');
    const invalidDomain = [
      { name: 'duplicate input identity', change: (base: Extract<PlanRevisionDraft, { schemaVersion: 2 }>) => ({
        ...base, inputRequirements: [...(base.inputRequirements ?? []),
          { ...base.inputRequirements![0]!, consumerTaskId: 'design' }],
      }), code: 'duplicate_requirement_id' },
      { name: 'missing input consumer', change: (base: Extract<PlanRevisionDraft, { schemaVersion: 2 }>) => ({
        ...base, inputRequirements: [{ ...base.inputRequirements![0]!, consumerTaskId: 'absent-task' }],
      }), code: 'dangling_task_ref' },
      { name: 'missing relation endpoint', change: (base: Extract<PlanRevisionDraft, { schemaVersion: 2 }>) => ({
        ...base, taskRelations: [{ ...base.taskRelations![0]!, toTaskId: 'absent-task' }],
      }), code: 'dangling_task_ref' },
    ] as const;
    for (const case_ of invalidDomain) {
      const base = draft();
      if (base.schemaVersion !== 2) throw Error('test draft is not v2');
      const candidate = await plans.proposePlan(ctx, { meta: { requestId: `invalid-${case_.name}`,
        expected: [{ ref: goal.value.ref, revision: 1 }] },
        input: { goalRef: goal.value.ref, basedOn: null, draft: case_.change(base),
          reason: { text: case_.name, sources: [] } } });
      expect(candidate).toMatchObject({ status: 'committed', value: { issues: [{ code: case_.code }] } });
      if (candidate.status !== 'committed') throw Error('invalid candidate was not recorded');
      expect(await plans.applyPlanChange(ctx, { meta: { requestId: `apply-invalid-${case_.name}`,
        expected: [{ ref: goal.value.ref, revision: 1 }] },
        input: { proposalRef: candidate.value.ref, expectedProposalRevision: candidate.value.revision,
          decisionRefs: [] } })).toMatchObject({ status: 'rejected' });
    }
    for (const [name, malformed] of [
      ['malformed artifact reference', { ...draft(), inputRequirements: [{
        requirementId: 'design-artifact', consumerTaskId: 'implement', kind: 'artifact',
        artifactRef: { kind: 'artifact', digest: 'bad' },
      }] }],
      ['artifact missing source identity', { ...draft(), inputRequirements: [{
        requirementId: 'design-artifact', consumerTaskId: 'implement', kind: 'artifact',
        artifactRef: { ...artifactRef, source: {} },
      }] }],
      ['non-array relations', { ...draft(), taskRelations: 'bad-relations' }],
      ['v1 carrying v2 fields', { ...draft(), schemaVersion: 1 }],
    ] as const) {
      const malformedResult = await plans.proposePlan(ctx, { meta: { requestId: `malformed-${name}`,
        expected: [{ ref: goal.value.ref, revision: 1 }] },
        input: { goalRef: goal.value.ref, basedOn: null, draft: malformed as unknown as PlanRevisionDraft,
          reason: { text: name, sources: [] } } });
      expect(malformedResult).toMatchObject({ status: 'rejected', code: 'invalid' });
    }
    const proposedDraft = draft();
    const proposal = await plans.proposePlan(ctx, { meta: { requestId: 'propose-v2',
      expected: [{ ref: goal.value.ref, revision: 1 }] },
      input: { goalRef: goal.value.ref, basedOn: null, draft: proposedDraft,
        reason: { text: 'Initial v2 plan', sources: [] } } });
    expect(proposal).toMatchObject({ status: 'committed', value: { kind: 'candidate_v2', issues: [], draft: proposedDraft } });
    if (proposal.status !== 'committed') throw Error('v2 proposal fixture failed');
    const applyRequest = { meta: { requestId: 'apply-v2', expected: [{ ref: goal.value.ref, revision: 1 }] },
      input: { proposalRef: proposal.value.ref, expectedProposalRevision: proposal.value.revision, decisionRefs: [] } };
    const applied = await plans.applyPlanChange(ctx, applyRequest);
    expect(applied).toMatchObject({ status: 'committed', replayed: false,
      value: { revision: 1, schemaVersion: 2,
        taskRelations: proposedDraft.schemaVersion === 2 ? proposedDraft.taskRelations : [],
        inputRequirements: proposedDraft.schemaVersion === 2 ? proposedDraft.inputRequirements : [] } });
    if (applied.status !== 'committed') throw Error('v2 adoption fixture failed');
    expect(await plans.applyPlanChange(ctx, applyRequest)).toMatchObject({ status: 'committed', replayed: true, value: applied.value });
    const graph = await plans.queryTaskGraph(ctx, { goalRef: goal.value.ref });
    expect(graph).toMatchObject({ status: 'ready', value: { tasks: [
      { ref: { taskId: 'design' }, inputRequirements: [], legacyDependencies: [] },
      { ref: { taskId: 'implement' }, relations: [{ kind: 'expected_dependency' }, { kind: 'coordination' }],
        inputRequirements: [{ requirement: { requirementId: 'design-artifact', artifactRef }, verification: 'not_checked' }],
        legacyDependencies: [{ dependsOnId: 'design', verification: 'legacy_unverifiable' }] },
      { ref: { taskId: 'goal-gate' } },
    ] } });
    const ready = await plans.queryReadyTasks(ctx, { goalRef: goal.value.ref, includeBlocked: false,
      page: { limit: 10 } });
    expect(ready).toMatchObject({ status: 'ready', value: { items: [
      { task: { ref: { taskId: 'design' } } },
      { task: { ref: { taskId: 'implement' }, inputRequirements: [{ verification: 'not_checked' }] } },
    ] } });
    expect(materialReads).toBe(0);
    const planKey = canonicalJson(applied.value.ref as JsonValue);
    const stored = await backend.records.readMany([planKey]);
    expect(stored).toMatchObject({ status: 'ready', value: { records: [
      { schemaId: 'PlanRevisionSnapshot@1', revision: 1 },
    ] } });
    if (stored.status !== 'ready') throw Error('Plan record missing');
    expect(JSON.parse(stored.value.records[0]!.json)).toMatchObject({ schemaVersion: 2,
      taskRelations: proposedDraft.schemaVersion === 2 ? proposedDraft.taskRelations : [],
      inputRequirements: proposedDraft.schemaVersion === 2 ? proposedDraft.inputRequirements : [] });
    await backend.close();
    if (kind === 'sqlite') {
      backend = open();
      const resumed = createPlanService({ records: backend.records, now: () => at,
        eventId: () => `resumed-${++sequence}` });
      expect(await resumed.queryTaskGraph(ctx, { goalRef: goal.value.ref })).toMatchObject({ status: 'ready',
        value: { plan: applied.value, tasks: [{}, { inputRequirements: [{ verification: 'not_checked' }] }, {}] } });
      expect(await resumed.applyPlanChange(ctx, applyRequest)).toMatchObject({ status: 'committed', replayed: true,
        value: applied.value });
    }
  } finally { await backend.close(); }
});
