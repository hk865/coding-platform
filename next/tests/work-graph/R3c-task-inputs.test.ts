import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import type { EncodedRecord, PreparedCommit, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import type { ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { MaterialAccessGrantSnapshot, MaterialAccessGrantV1, MaterialBasisV1,
  MaterialSourcePinV1 } from '../../src/contracts/material-access.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import type { TaskReductionSnapshot } from '../../src/contracts/reduction.js';
import { WorkspaceSourceApplicability } from '../../src/core/workspace/source-applicability.js';
import type { ProjectSourceAccess } from '../../src/core/workspace/project-source-index.js';
import { encodeProjectSnapshot, encodeWorkspaceSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { materialRecordSchemas, createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialAccessResolver } from '../../src/core/work-graph/materials/applicability.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { PLAN_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-record-codecs.js';
import { PLAN_GOVERNANCE_RECORD_SCHEMAS, PLAN_STATE_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';

const at = '2026-09-24T00:00:00.000Z';
const projectId = 'r3c-exact-inputs';
const workspaceId = 'r3c-exact-workspace';
const actor = { kind: 'human' as const, id: 'trusted-host' };
const project: ProjectSnapshot = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
const workspace: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 };
const hostCtx: CoreCallContext = { projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };
const key = (ref: object) => canonicalJson(ref as JsonValue);
const digest = (value: JsonValue) => sha256Hex(canonicalJson(value));
const policy = { schemaVersion: 1, identity: { policyId: 'input-policy' }, revision: 1,
  content: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 } };
const architecture = { schemaVersion: 1, identity: { baselineId: 'input-baseline' }, revision: 1,
  content: { schemaVersion: 1, description: 'Input test baseline', constraints: [] } };
const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: 'input-policy', revision: 1 };
const architectureRef = { aggregateType: 'ArchitectureBaselineRevision' as const, projectId,
  baselineId: 'input-baseline', revision: 1 };
const governance = [
  { ref: policyRef, revision: 1, schemaVersion: 1, policyId: policyRef.policyId,
    contentRevision: 1, contentDigest: digest(policy), content: policy.content },
  { ref: architectureRef, revision: 1, schemaVersion: 1, baselineId: architectureRef.baselineId,
    contentRevision: 1, contentDigest: digest(architecture), content: architecture.content },
  { ref: { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId }, projectId,
    revision: 1, activeRevision: policyRef },
  { ref: { aggregateType: 'ProjectArchitectureBaselineActive' as const, projectId }, projectId,
    revision: 1, activeRevision: architectureRef },
];
const encoded = (row: { ref: object; revision: number }): EncodedRecord => ({
  refKey: key(row.ref), schemaId: `${(row.ref as { aggregateType: string }).aggregateType}Snapshot@1`,
  revision: row.revision, json: JSON.stringify(row),
});
const materialSchemas = materialRecordSchemas();
const schemas: RecordBackendSchemas = {
  records: [...materialSchemas.records, ...PLAN_GOVERNANCE_RECORD_SCHEMAS.records,
    ...PLAN_RECORD_SCHEMAS.records, ...PLAN_STATE_RECORD_SCHEMAS.records],
  events: [...materialSchemas.events, ...PLAN_RECORD_SCHEMAS.events,
    { eventType: 'InputFixtureSeeded', schemaVersion: 1,
      validate: event => ({ status: 'decoded', value: event }) }],
  lookups: [...(materialSchemas.lookups ?? []), ...(PLAN_RECORD_SCHEMAS.lookups ?? []),
    ...(PLAN_STATE_RECORD_SCHEMAS.lookups ?? [])],
};
let seedNumber = 0;
function seedRows(rows: { ref: object; revision: number }[], expected: number | null = null): PreparedCommit {
  const n = ++seedNumber;
  const event = { eventId: `input-fixture-${n}`, eventType: 'InputFixtureSeeded', schemaVersion: 1, occurredAt: at };
  return { identityKey: `input-fixture-${n}`, fingerprint: `input-fixture-${n}`,
    guards: rows.map(row => ({ refKey: key(row.ref), expectedRevision: expected })),
    records: rows.map(encoded), events: [{ ...event, json: JSON.stringify(event) }],
    claims: [], indexGuards: [], indexChanges: [] };
}
const roleBinding = { schemaVersion: 1 as const, bindingId: 'input-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: '1' };
function run(goalId: string, taskId: string, planRef: PlanRevisionRef): RunSnapshot {
  const ref: RunRef = { aggregateType: 'Run', projectId, goalId, runId: `${taskId}-run` };
  return { ref, revision: 1, schemaVersion: 1, task: { projectId, goalId, taskId }, attemptId: `${taskId}-attempt`,
    planRef, roleBinding, budget: { tokenBudget: 100, deadline: null },
    workspaceSnapshot: { workspaceId, revision: 1 }, status: 'running', outcome: null,
    exitCode: null, lastEventSeq: 0, lastRuntimeEventId: '', lastFactEventId: '', envelope: null,
    startedAt: at, endedAt: null };
}
function workCtx(reader: RunRef, planRef: PlanRevisionRef, sourcePin: MaterialSourcePinV1): CoreCallContext {
  return { projectId, workspaceId, principal: { kind: 'work_run', runRef: reader, roleBinding },
    materialReader: { kind: 'run', requester: reader, currentBasis: {
      planRef, workspaceRevision: 1, sourceDigest: null, sourcePin,
    } }, signal: new AbortController().signal };
}
function grant(id: string, reader: RunRef, ref: ArtifactRef, basis: MaterialBasisV1): MaterialAccessGrantSnapshot {
  const value: MaterialAccessGrantV1 = { schemaVersion: 1, grantId: id,
    scope: { projectId, workspaceId, goalId: reader.goalId }, materials: [ref], reader,
    issuedBy: { aggregateType: 'Control', projectId, goalId: reader.goalId }, purpose: 'Consume exact plan input',
    basis, grantedAt: at };
  return { ref: { aggregateType: 'MaterialAccessGrant', projectId, workspaceId,
    goalId: reader.goalId, grantId: id }, revision: 1, schemaVersion: 1, grant: value };
}
function draft(goalId: string, exact: ArtifactRef, absent: ArtifactRef, unused: ArtifactRef): PlanRevisionDraft {
  return { schemaVersion: 2, planId: `${goalId}-plan`, planRevision: 1, goalId, stages: [],
    tasks: [
      { taskId: 'producer', title: 'Produce artifact', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'consumer', title: 'Use artifact', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'gate', title: 'Check result', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ], assignments: [
      { taskId: 'producer', role: 'builder', instruction: 'Produce the artifact' },
      { taskId: 'consumer', role: 'builder', instruction: 'Use the artifact' },
    ], obligations: [{ obligationId: 'deliver', title: 'Deliver', requirementLevel: 'required',
      taskIds: ['producer', 'consumer', 'gate'], verificationRequirements: [
        { requirementId: 'check', requirementLevel: 'required', kind: 'test', description: 'Tests pass' },
      ] }], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
    taskRelations: [{ fromTaskId: 'producer', toTaskId: 'consumer', kind: 'expected_dependency',
      note: 'Advisory only; the exact input is independently readable' }],
    inputRequirements: [
      { requirementId: 'needed', consumerTaskId: 'consumer', kind: 'artifact', artifactRef: exact },
      { requirementId: 'absent', consumerTaskId: 'consumer', kind: 'artifact', artifactRef: absent },
      { requirementId: 'unused', consumerTaskId: 'consumer', kind: 'artifact', artifactRef: unused },
    ] };
}

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

it.each(['memory', 'sqlite'] as const)('%s: exact input is current while producer runs; unrelated inputs stay not_checked', async kind => {
  const dir = await mkdtemp(join(tmpdir(), 'next-task-inputs-')); dirs.push(dir);
  const backend = kind === 'memory' ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ path: join(dir, 'records.sqlite'), schemas });
  try {
    expect(await backend.records.commit(seedRows([project, workspace, ...governance].map(row => row as { ref: object; revision: number }))
      )).toMatchObject({ status: 'committed' });
    const file = join(dir, 'src/input.txt'); await mkdir(dirname(file), { recursive: true });
    await writeFile(file, 'source version one');
    const access: ProjectSourceAccess = {
      allowed: path => path === 'src/input.txt',
      inventory: async () => ({ paths: ['src/input.txt'], truncated: false }),
      read: async (path, maxBytes) => {
        if (path !== 'src/input.txt') throw Error('outside source scope');
        const content = await readFile(file, 'utf8');
        if (Buffer.byteLength(content) > maxBytes) throw Error('capacity');
        return { content };
      },
      sourceIdentity: async () => ({ workspace: dir, commit: null }),
    };
    const source = new WorkspaceSourceApplicability(scope =>
      scope.projectId === projectId && scope.workspaceId === workspaceId ? access : null);
    const captured = await source.capture({ projectId, workspaceId,
      sourceSet: { kind: 'workspace_paths', paths: ['src/input.txt'] } });
    expect(captured.status).toBe('sourced');
    if (captured.status !== 'sourced') throw Error('source pin fixture failed');
    const bodies = new RawArtifactBodyStore();
    const owner: RunRef = { aggregateType: 'Run', projectId, goalId: 'goal-one', runId: 'producer-run' };
    const put = async (body: string, store = bodies) => {
      const result = await store.put({ body, contentType: 'text/plain',
        sourceRefs: [{ kind: 'workspace', refId: workspaceId, revision: '1' }],
        origin: { kind: 'run', owner }, requestedAt: at });
      if (result.status !== 'ready') throw Error('body fixture failed');
      return result.value.ref;
    };
    const exact = await put('exact input body');
    const absent = await put('absent input body', new RawArtifactBodyStore());
    const unused = await put('unused input body');
    let sequence = 0;
    const goals = createGoalService({ records: backend.records, now: () => at,
      eventId: () => `goal-input-${++sequence}` }).tasks;
    const goal = await goals.createGoal(hostCtx, { meta: { requestId: 'create-goal-one',
      expected: [{ ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 1 }] },
      input: { goalId: 'goal-one', workspace: { projectId, workspaceId }, objective: 'Use a known artifact' } });
    expect(goal).toMatchObject({ status: 'committed' });
    if (goal.status !== 'committed') throw Error('goal fixture failed');
    const reads = createMaterialRecordReaders(backend.records);
    const realMaterials = createMaterialService({ bodies, authority: reads.authority,
      grants: createMaterialAccessResolver(reads.authority, reads.index, source), now: () => at });
    const opened: ArtifactRef[] = [];
    const plans = createPlanService({ records: backend.records, now: () => at,
      eventId: () => `plan-input-${++sequence}`, materials: { openArtifact: (ctx, input) => {
        opened.push(input.ref); return realMaterials.openArtifact(ctx, input);
      } } });
    const proposed = await plans.proposePlan(hostCtx, { meta: { requestId: 'propose-goal-one',
      expected: [{ ref: goal.value.ref, revision: 1 }] }, input: { goalRef: goal.value.ref,
      basedOn: null, draft: draft('goal-one', exact, absent, unused), reason: { text: 'Exact input', sources: [] } } });
    expect(proposed, JSON.stringify(proposed)).toMatchObject({ status: 'committed', value: { issues: [] } });
    if (proposed.status !== 'committed') throw Error('proposal fixture failed');
    const applied = await plans.applyPlanChange(hostCtx, { meta: { requestId: 'apply-goal-one',
      expected: [{ ref: goal.value.ref, revision: 1 }] }, input: { proposalRef: proposed.value.ref,
      expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
    expect(applied).toMatchObject({ status: 'committed' });
    if (applied.status !== 'committed') throw Error('adoption fixture failed');
    const planRef = applied.value.ref;
    // An authorized active reader can inspect another task's declared input;
    // candidate discovery must not itself create or start the consumer Run.
    const producer = run('goal-one', 'producer', planRef);
    const basis: MaterialBasisV1 = { planRef, workspaceRevision: 1, sourceDigest: null, sourcePin: captured.pin };
    const accessGrant = grant('consumer-input', producer.ref, exact, basis);
    expect(await backend.records.commit(seedRows([producer, accessGrant]))).toMatchObject({ status: 'committed' });
    const ctx = workCtx(producer.ref, planRef, captured.pin);

    const graph = await plans.queryTaskGraph(ctx, { goalRef: goal.value.ref });
    expect(graph).toMatchObject({ status: 'ready' });
    if (graph.status !== 'ready') throw Error('graph fixture unavailable');
    expect(graph.value.tasks.find(task => task.ref.taskId === 'producer')?.effectivePhase).toBe('running');
    expect(graph.value.tasks.find(task => task.ref.taskId === 'consumer')?.inputRequirements)
      .toEqual(expect.arrayContaining([{ requirement: { requirementId: 'needed', consumerTaskId: 'consumer',
        kind: 'artifact', artifactRef: exact }, verification: 'not_checked' }]));
    expect(await plans.queryReadyTasks(ctx, { goalRef: goal.value.ref, includeBlocked: false,
      page: { limit: 20 } })).toMatchObject({ status: 'ready', value: {
        items: [{ task: { ref: { taskId: 'consumer' }, eligibility: { eligible: true } } }],
      } });
    expect(opened).toEqual([]);

    const input = { goalRef: goal.value.ref, planRef, taskId: 'consumer', requirementId: 'needed' };
    for (const malformed of [null, undefined, [], 7]) {
      await expect(plans.readTaskInput(ctx, malformed as unknown as typeof input))
        .resolves.toMatchObject({ status: 'rejected', code: 'invalid' });
    }
    expect(await plans.readTaskInput(ctx, input)).toMatchObject({ status: 'ready',
      value: { ref: exact, body: 'exact input body', applicability: 'current' } });
    expect(opened).toEqual([exact]);
    expect(await plans.readTaskInput(ctx, { ...input, requirementId: 'absent' })).toMatchObject({ status: 'not_found' });
    expect(opened).toEqual([exact, absent]);
    for (const bad of [
      { ...input, taskId: 'producer' },
      { ...input, taskId: 'missing-task' },
      { ...input, requirementId: 'missing-requirement' },
      { ...input, goalRef: { ...goal.value.ref, goalId: 'other-goal' } },
      { ...input, planRef: { ...planRef, planId: 'other-plan' } },
    ]) expect((await plans.readTaskInput(ctx, bad)).status).not.toBe('ready');
    expect(opened).toEqual([exact, absent]);

    // A formal producer result may already be recorded, but it is not a
    // substitute for the consumer's precise, currently readable input.
    // This fixture seeds only the already-admitted reduction fact; it does not
    // claim to implement the Run/verification admission workflow here.
    const reduction: TaskReductionSnapshot = { ref: { aggregateType: 'TaskReduction', projectId,
      goalId: 'goal-one', taskId: 'producer' }, revision: 1, schemaVersion: 1,
      planRef, planRevision: 1, taskKind: 'work', requirementLevel: 'required', disposition: 'active',
      phase: 'satisfied', currentAnchor: { schemaVersion: 1, planRef, planRevision: 1,
        workspaceRevision: 1, pinnedCompletionPolicy: applied.value.effectiveCompletionPolicy,
        pinnedArchitectureBaseline: applied.value.effectiveArchitectureBaseline },
      effectiveEvidenceIds: ['previously-admitted-evidence'], blockingEvidenceIds: [], staleEvidenceIds: [],
      outOfScopeEvidenceIds: [], satisfiedObligationIds: ['deliver'], causes: [], reducedAt: at };
    expect(await backend.records.commit(seedRows([reduction]))).toMatchObject({ status: 'committed' });
    expect(await plans.queryTaskGraph(ctx, { goalRef: goal.value.ref })).toMatchObject({ status: 'ready',
      value: { tasks: expect.arrayContaining([expect.objectContaining({
        ref: expect.objectContaining({ taskId: 'producer' }), effectivePhase: 'satisfied',
      })]) } });
    expect(await plans.readTaskInput(ctx, { ...input, requirementId: 'absent' }))
      .toMatchObject({ status: 'not_found' });
    expect(opened).toEqual([exact, absent, absent]);

    const legacyGoal = await goals.createGoal(hostCtx, { meta: { requestId: 'create-legacy-goal',
      expected: [{ ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 1 }] },
      input: { goalId: 'legacy-goal', workspace: { projectId, workspaceId }, objective: 'Old label only' } });
    expect(legacyGoal).toMatchObject({ status: 'committed' });
    if (legacyGoal.status !== 'committed') throw Error('legacy goal fixture failed');
    const v1: PlanRevisionDraft = { schemaVersion: 1, planId: 'legacy-plan', planRevision: 1,
      goalId: 'legacy-goal', stages: [],
      tasks: [
        { taskId: 'producer', title: 'Produce', requirementLevel: 'required', taskKind: 'work',
          disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
        { taskId: 'consumer', title: 'Consume', requirementLevel: 'required', taskKind: 'work',
          disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
        { taskId: 'gate', title: 'Gate', requirementLevel: 'required', taskKind: 'gate',
          disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      ], assignments: [{ taskId: 'producer', role: 'builder', instruction: 'Produce' },
        { taskId: 'consumer', role: 'builder', instruction: 'Consume' }],
      obligations: [{ obligationId: 'legacy-deliver', title: 'Deliver', requirementLevel: 'required',
        taskIds: ['producer', 'consumer', 'gate'], verificationRequirements: [
          { requirementId: 'legacy-check', requirementLevel: 'required', kind: 'test', description: 'Tests pass' },
        ] }], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [
        { taskId: 'consumer', dependsOnId: 'producer', requires: { kind: 'artifact', label: 'exact input body' } },
      ] } };
    const legacyProposal = await plans.proposePlan(hostCtx, { meta: { requestId: 'propose-legacy-goal',
      expected: [{ ref: legacyGoal.value.ref, revision: 1 }] }, input: { goalRef: legacyGoal.value.ref,
      basedOn: null, draft: v1, reason: { text: 'Legacy dependency label', sources: [] } } });
    expect(legacyProposal).toMatchObject({ status: 'committed', value: { issues: [] } });
    if (legacyProposal.status !== 'committed') throw Error('legacy proposal fixture failed');
    const legacyApplied = await plans.applyPlanChange(hostCtx, { meta: { requestId: 'apply-legacy-goal',
      expected: [{ ref: legacyGoal.value.ref, revision: 1 }] }, input: {
        proposalRef: legacyProposal.value.ref, expectedProposalRevision: legacyProposal.value.revision,
        decisionRefs: [],
      } });
    expect(legacyApplied).toMatchObject({ status: 'committed' });
    if (legacyApplied.status !== 'committed') throw Error('legacy adoption fixture failed');
    expect((await plans.readTaskInput(hostCtx, { goalRef: legacyGoal.value.ref,
      planRef: legacyApplied.value.ref, taskId: 'consumer', requirementId: 'needed' })).status).not.toBe('ready');
    expect(opened).toEqual([exact, absent, absent]);

    // Both refs really exist and the foreign Plan has the same requirementId.
    // Checking independent existence is insufficient: selection must bind Goal to Plan.
    const foreignGoal = await goals.createGoal(hostCtx, { meta: { requestId: 'create-foreign-goal',
      expected: [{ ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 1 }] },
      input: { goalId: 'foreign-goal', workspace: { projectId, workspaceId }, objective: 'A separate goal' } });
    if (foreignGoal.status !== 'committed') throw Error('foreign Goal fixture failed');
    const foreignProposal = await plans.proposePlan(hostCtx, { meta: { requestId: 'propose-foreign',
      expected: [{ ref: foreignGoal.value.ref, revision: 1 }] }, input: {
        goalRef: foreignGoal.value.ref, basedOn: null, draft: draft('foreign-goal', exact, absent, unused),
        reason: { text: 'Separate accepted plan with identical local requirement identity', sources: [] },
      } });
    if (foreignProposal.status !== 'committed') throw Error('foreign proposal fixture failed');
    const foreignPlan = await plans.applyPlanChange(hostCtx, { meta: { requestId: 'apply-foreign',
      expected: [{ ref: foreignGoal.value.ref, revision: 1 }] }, input: {
        proposalRef: foreignProposal.value.ref, expectedProposalRevision: foreignProposal.value.revision, decisionRefs: [],
      } });
    if (foreignPlan.status !== 'committed') throw Error('foreign plan fixture failed');
    expect((await plans.readTaskInput(ctx, { ...input, planRef: foreignPlan.value.ref })).status).not.toBe('ready');
    expect(opened).toEqual([exact, absent, absent]);

    // Delay the real Store read, then mutate caller-owned objects. The material
    // reader must observe the identity/input captured at invocation, while the
    // original AbortSignal remains live. No fake material authorization here.
    for (const scenario of ['preserve', 'no-escalation', 'cancel'] as const) {
      let release!: () => void;
      let entered!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const reading = new Promise<void>(resolve => { entered = resolve; });
      const delayedPlans = createPlanService({
        records: { ...backend.records, readMany: async keys => {
          entered(); await gate; return backend.records.readMany(keys);
        } },
        materials: realMaterials, now: () => at, eventId: () => 'read-only-input-test',
      });
      const controller = new AbortController();
      const caller = workCtx(scenario === 'no-escalation'
        ? { ...producer.ref, runId: 'unadmitted-reader' } : structuredClone(producer.ref),
      structuredClone(planRef), structuredClone(captured.pin));
      caller.signal = controller.signal;
      const request = structuredClone(input);
      const pending = delayedPlans.readTaskInput(caller, request);
      await reading;
      if (scenario === 'no-escalation') {
        Object.assign(caller, workCtx(structuredClone(producer.ref), planRef, captured.pin));
      } else {
        caller.projectId = 'another-project';
        caller.workspaceId = 'another-workspace';
        if (caller.principal.kind === 'work_run') caller.principal.runRef.runId = 'replaced-reader';
        if (caller.materialReader.kind === 'run') caller.materialReader.requester.runId = 'replaced-reader';
        request.goalRef.goalId = 'foreign-goal';
        request.planRef.planId = 'foreign-plan';
        request.requirementId = 'absent';
        if (scenario === 'cancel') controller.abort();
        caller.signal = new AbortController().signal;
      }
      release();
      await expect(pending).resolves.toMatchObject(scenario === 'preserve'
        ? { status: 'ready', value: { ref: exact, body: 'exact input body', applicability: 'current' } }
        : { status: 'rejected', code: scenario === 'cancel' ? 'cancelled' : 'forbidden' });
    }

    const completedConsumer: TaskReductionSnapshot = { ...reduction,
      ref: { ...reduction.ref, taskId: 'consumer' } };
    expect(await backend.records.commit(seedRows([completedConsumer]))).toMatchObject({ status: 'committed' });
    expect(await plans.queryReadyTasks(ctx, { goalRef: goal.value.ref, includeBlocked: false,
      page: { limit: 20 } })).toMatchObject({ status: 'ready', value: { items: [] } });
    // Reading a declared input is not a request to dispatch that task again.
    expect(await plans.readTaskInput(ctx, input)).toMatchObject({ status: 'ready',
      value: { ref: exact, applicability: 'current' } });

    await writeFile(file, 'source version two');
    expect(await plans.readTaskInput(ctx, input)).toMatchObject({ status: 'rejected', code: 'source_stale' });
    const revoked: MaterialAccessGrantSnapshot = { ...accessGrant, revision: 2,
      revocation: { reason: 'withdrawn', revokedAt: at, actor, commandId: 'revoke-input' } };
    expect(await backend.records.commit(seedRows([revoked], 1))).toMatchObject({ status: 'committed' });
    expect(await plans.readTaskInput(ctx, input)).toMatchObject({ status: 'rejected', code: 'forbidden' });

    // Seed an already-accepted later Plan and its active reader facts; delta
    // admission itself is outside this slice. The old Plan remains a valid
    // selection pin, while CURRENT material authority comes from the later Run.
    const laterPlanRef = { ...planRef, planId: 'goal-one-later-plan' };
    const laterPlan = { ...applied.value, ref: laterPlanRef,
      planId: laterPlanRef.planId, planRevision: 2 };
    expect(await backend.records.commit(seedRows([laterPlan]))).toMatchObject({ status: 'committed' });
    const laterGoal = { ...goal.value, revision: 3, activePlanRevision: laterPlanRef };
    expect(await backend.records.commit(seedRows([laterGoal], 2))).toMatchObject({ status: 'committed' });
    const laterSource = await source.capture({ projectId, workspaceId,
      sourceSet: { kind: 'workspace_paths', paths: ['src/input.txt'] } });
    if (laterSource.status !== 'sourced') throw Error('later source fixture failed');
    const laterReader = run('goal-one', 'consumer', laterPlanRef);
    const laterGrant = grant('later-current-input', laterReader.ref, exact, {
      planRef: laterPlanRef, workspaceRevision: 1, sourceDigest: null, sourcePin: laterSource.pin,
    });
    expect(await backend.records.commit(seedRows([laterReader, laterGrant]))).toMatchObject({ status: 'committed' });
    expect(await plans.readTaskInput(workCtx(laterReader.ref, laterPlanRef, laterSource.pin), input))
      .toMatchObject({ status: 'ready', value: { ref: exact, applicability: 'current' } });
  } finally { await backend.close(); }
});
