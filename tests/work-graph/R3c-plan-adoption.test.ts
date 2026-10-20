import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { GOAL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/record-codecs.js';
import { PLAN_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import { PLAN_GOVERNANCE_RECORD_SCHEMAS, PLAN_STATE_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-readers.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../../src/core/work-graph/architecture/catalog-record-codecs.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { materialRecordSchemas } from '../../src/core/work-graph/materials/record-readers.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { makeCommitCursor, seqOfCommitCursor } from '../../src/contracts/ledger.js';
import { createB2RuntimeFixture, type B2RuntimeFixture } from '../helpers/B2-runtime-fixture.js';
import { prepareTaskForReal } from '../helpers/task-claim-fixture.js';

const at = '2026-09-24T00:00:00.000Z';
const projectId = 'r3c-adoption';
const workspaceId = 'r3c-workspace';
const project: ProjectSnapshot = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
const workspace: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 };
const actor = { kind: 'human' as const, id: 'r3c-author' };
const ctx: CoreCallContext = { projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };

const policyFixture = { schemaVersion: 1, identity: { policyId: 'policy-1' }, revision: 2,
  content: { schemaVersion: 1 as const, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 } };
const architectureFixture = { schemaVersion: 1, identity: { baselineId: 'baseline-1' }, revision: 2,
  content: { schemaVersion: 1, description: 'Accepted baseline', constraints: [] } };
const digest = (value: JsonValue) => sha256Hex(canonicalJson(value));
const policyRef = { aggregateType: 'CompletionPolicyRevision', projectId, policyId: 'policy-1', revision: 2 } as const;
const policyActiveRef = { aggregateType: 'ProjectCompletionPolicyActive', projectId } as const;
const schemas: RecordBackendSchemas = {
  records: [...GOAL_RECORD_SCHEMAS.records, ...PLAN_GOVERNANCE_RECORD_SCHEMAS.records,
    ...PLAN_RECORD_SCHEMAS.records, ...PLAN_STATE_RECORD_SCHEMAS.records,
    ...ARCHITECTURE_CATALOG_SCHEMAS.records,
    ...materialRecordSchemas().records.filter(record => record.aggregateType === 'Run')],
  events: [...GOAL_RECORD_SCHEMAS.events, ...PLAN_GOVERNANCE_RECORD_SCHEMAS.events,
    ...PLAN_RECORD_SCHEMAS.events, ...PLAN_STATE_RECORD_SCHEMAS.events,
    ...ARCHITECTURE_CATALOG_SCHEMAS.events, ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events],
  lookups: [...(PLAN_RECORD_SCHEMAS.lookups ?? []), ...(PLAN_STATE_RECORD_SCHEMAS.lookups ?? []),
    ...(ARCHITECTURE_CATALOG_SCHEMAS.lookups ?? [])],
};

function validDraft(): PlanRevisionDraft {
  const work = (taskId: string, title: string) => ({ taskId, title, requirementLevel: 'required' as const,
    taskKind: 'work' as const, disposition: 'active' as const, phase: 'pending' as const,
    scope: { kind: 'goal' as const } });
  return { schemaVersion: 2, planId: 'plan-1', planRevision: 1, goalId: 'goal-1', stages: [],
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
const runtimeFixtures: B2RuntimeFixture[] = [];
afterEach(async () => {
  for (const fixture of runtimeFixtures.splice(0)) await fixture.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

it.each(['memory', 'sqlite'] as const)('%s: real Goal→candidate→accepted Plan is atomic, immutable and queryable', async kind => {
  const dir = kind === 'sqlite' ? await mkdtemp(join(tmpdir(), 'next-r3c-adopt-')) : null;
  if (dir !== null) dirs.push(dir);
  const backend = kind === 'memory' ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ path: join(dir!, 'records.sqlite'), schemas });
  try {
    // Scope, governance and architecture through the real public owners.
    let bootstrapSequence = 0;
    const bootstrap = createProjectBootstrapServices({ records: backend.records, now: () => at,
      eventId: () => `r3c-bootstrap-${++bootstrapSequence}` });
    const createdProject = await bootstrap.projects.createProject(ctx, { input: { projectId },
      meta: { requestId: 'r3c-create-project', expected: [{ ref: project.ref, revision: 0 }] } });
    if (createdProject.status !== 'committed') throw Error(`Project creation failed: ${JSON.stringify(createdProject)}`);
    const registered = await bootstrap.projects.registerWorkspace(ctx, {
      input: { workspace: { projectId, workspaceId } },
      meta: { requestId: 'r3c-register-workspace', expected: [
        { ref: createdProject.value.ref, revision: createdProject.value.revision },
        { ref: workspace.ref, revision: 0 },
      ] } });
    if (registered.status !== 'committed') throw Error(`Workspace registration failed: ${JSON.stringify(registered)}`);
    const installed = await bootstrap.completionPolicies.installCompletionPolicy(ctx, {
      input: { policyId: policyRef.policyId, contentRevision: policyRef.revision, content: policyFixture.content },
      meta: { requestId: 'r3c-install-policy', expected: [
        { ref: createdProject.value.ref, revision: createdProject.value.revision },
        { ref: policyRef, revision: 0 },
      ] } });
    if (installed.status !== 'committed') throw Error(`policy install failed: ${JSON.stringify(installed)}`);
    const activated = await bootstrap.completionPolicies.activateCompletionPolicy(ctx, {
      input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } },
      meta: { requestId: 'r3c-activate-policy', expected: [
        { ref: createdProject.value.ref, revision: createdProject.value.revision },
        { ref: policyActiveRef, revision: 0 },
      ] } });
    if (activated.status !== 'committed') throw Error(`policy activation failed: ${JSON.stringify(activated)}`);
    // The hand-written prerequisite used an architecture content revision 2.
    // The initial adoption writes revision 1, so one public revision writes the
    // same revision-2 baseline content the original assertion expects.
    const catalog = createArchitectureCatalogService({ records: backend.records });
    const emptyCatalog = { modules: [], dependencies: [], requireDag: true as const };
    const adopted = await catalog.adoptInitialArchitecture(ctx, {
      input: { baselineId: architectureFixture.identity.baselineId, catalog: emptyCatalog,
        description: architectureFixture.content.description,
        constraints: architectureFixture.content.constraints },
      meta: { requestId: 'r3c-adopt-baseline', expected: [
        { ref: createdProject.value.ref, revision: createdProject.value.revision },
        { ref: workspace.ref, revision: registered.value.revision },
      ] } });
    if (adopted.status !== 'committed') throw Error(`initial architecture adoption failed: ${JSON.stringify(adopted)}`);
    const revised = await catalog.reviseArchitectureCatalog(ctx, {
      input: { basedOn: { ref: adopted.value.baseline.ref, digest: adopted.value.baseline.contentDigest },
        catalog: emptyCatalog, reason: 'Reach the revision-2 baseline the original prerequisite used' },
      meta: { requestId: 'r3c-revise-baseline', expected: [
        { ref: createdProject.value.ref, revision: createdProject.value.revision },
        { ref: workspace.ref, revision: registered.value.revision },
      ] } });
    if (revised.status !== 'committed') throw Error(`architecture revision failed: ${JSON.stringify(revised)}`);
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

    // ---- TP-147: the real Runtime owns the running and ended Runs. ----
    let releaseDesign!: () => void;
    const designGate = new Promise<void>(resolve => { releaseDesign = resolve; });
    let designReached!: () => void;
    const designHeld = new Promise<void>(resolve => { designReached = resolve; });
    let releaseImplement!: () => void;
    const implementGate = new Promise<void>(resolve => { releaseImplement = resolve; });
    let implementReached!: () => void;
    const implementHeld = new Promise<void>(resolve => { implementReached = resolve; });
    const runtimeWorld = await createB2RuntimeFixture({ kind,
      scriptedReplies: [{ kind: 'text', text: 'R3c design completed' },
        { kind: 'text', text: 'R3c implement completed' }],
      beforeReply: async (_request, index) => {
        if (index === 0) { designReached(); await designGate; }
        else if (index === 1) { implementReached(); await implementGate; }
      } });
    runtimeFixtures.push(runtimeWorld);
    const rf = runtimeWorld.claimFixture;
    const runtimeGoal = await rf.goals.createGoal(runtimeWorld.ctx, {
      meta: { requestId: 'r3c-runtime-goal',
        expected: [{ ref: rf.projectRef, revision: 1 }, { ref: rf.workspaceRef, revision: 1 }] },
      input: { goalId: 'goal-1', workspace: runtimeWorld.scope, objective: 'R3c runtime race' },
    });
    if (runtimeGoal.status !== 'committed') throw Error('the runtime Goal creation failed');
    const runtimeProposed = await rf.plans.proposePlan(runtimeWorld.ctx, {
      meta: { requestId: 'r3c-runtime-propose', expected: [{ ref: runtimeGoal.value.ref, revision: 1 }] },
      input: { goalRef: runtimeGoal.value.ref, basedOn: null, draft: validDraft(),
        reason: { text: 'R3c runtime plan', sources: [] } },
    });
    if (runtimeProposed.status !== 'committed' || runtimeProposed.value.issues.length > 0) {
      throw Error(`the runtime Plan proposal failed: ${JSON.stringify(runtimeProposed)}`);
    }
    const runtimeApplied = await rf.plans.applyPlanChange(runtimeWorld.ctx, {
      meta: { requestId: 'r3c-runtime-apply', expected: [{ ref: runtimeGoal.value.ref, revision: 1 }] },
      input: { proposalRef: runtimeProposed.value.ref,
        expectedProposalRevision: runtimeProposed.value.revision, decisionRefs: [] },
    });
    if (runtimeApplied.status !== 'committed') throw Error('the runtime Plan adoption failed');
    const firstCard = await rf.sessionsPort.readSession(runtimeWorld.ctx, runtimeWorld.claim.sessionRef);
    if (firstCard.status !== 'ready') throw Error('the fixture Session role is unavailable');
    const designSession = await rf.createSession('r3c-design-session', firstCard.value.record.role);
    const designClaim = await rf.service.claimTask(runtimeWorld.ctx, await rf.buildRequest({
      requestId: 'r3c-design-claim',
      input: { goalRef: runtimeGoal.value.ref, planRef: runtimeApplied.value.ref,
        taskId: 'design', sessionRef: designSession },
    }));
    if (designClaim.status !== 'committed') throw Error('the design claim failed');
    runtimeWorld.allowRun(designClaim.value.runRef);
    const designPrepared = await prepareTaskForReal(rf, {
      bodies: runtimeWorld.deps.bodies, runRef: designClaim.value.runRef,
      host: runtimeWorld.host, requestId: 'r3c-design-prepare',
    });
    const designStart = runtimeWorld.runtime.port.startRun(runtimeWorld.ctx, {
      prepared: designPrepared.prepared, consumerId: 'r3c-adoption-runtime', requestId: 'r3c-design-start',
    });
    const designSettled = designStart.then(result => ({ settled: true as const, result }));
    const designEarly = await Promise.race([designHeld.then(() => null), designSettled]);
    if (designEarly !== null) {
      throw Error(`the design Run settled before its model gate: ${JSON.stringify(designEarly)}`);
    }

    // The running design Run and the still-eligible implement Task.
    const graphWithRun = await rf.plans.queryTaskGraph(runtimeWorld.ctx, { goalRef: runtimeGoal.value.ref });
    expect(graphWithRun).toMatchObject({ status: 'ready', value: { tasks: [
      { ref: { taskId: 'design' }, definition: { phase: 'pending' },
        effectivePhase: 'running', execution: designClaim.value.runRef, eligibility: { eligible: false } },
      { ref: { taskId: 'implement' }, definition: { phase: 'pending' },
        effectivePhase: 'pending', eligibility: { eligible: true } },
      { ref: { taskId: 'goal-gate' }, definition: { phase: 'pending' },
        effectivePhase: 'pending', eligibility: { eligible: false } },
    ] } });
    if (graphWithRun.status !== 'ready') throw Error('task graph unavailable after the running Run');
    expect(graphWithRun.value.tasks).toHaveLength(3);
    expect(await rf.plans.queryReadyTasks(runtimeWorld.ctx, { goalRef: runtimeGoal.value.ref,
      includeBlocked: false, page: { limit: 10 } }))
      .toMatchObject({ status: 'ready', value: { items: [{ task: { ref: { taskId: 'implement' } } }] } });

    // The race: the canonical lookup page is read first, then the real design
    // Run is released and awaited to its end before the stale page returns;
    // nothing in this world writes the Workflow's TaskReduction.
    let injectEndedRun = true;
    const racingReadyReader = createPlanService({ records: {
      ...rf.records,
      async lookup(request) {
        const page = await rf.records.lookup(request);
        if (injectEndedRun && request.index === 'r3c-run-by-goal'
          && page.status === 'ready' && page.value.next === null) {
          injectEndedRun = false;
          releaseDesign();
          const ended = await designStart;
          expect(ended).toMatchObject({ status: 'ready' });
        }
        return page;
      },
    }, now: () => at, eventId: () => `r3c-runtime-ready-race-${++sequence}` });
    const racedReady = await racingReadyReader.queryReadyTasks(runtimeWorld.ctx, {
      goalRef: runtimeGoal.value.ref, includeBlocked: false, page: { limit: 10 } });
    expect(injectEndedRun).toBe(false);
    if (racedReady.status === 'ready') {
      expect(racedReady.value.items).not.toContainEqual(expect.objectContaining({
        task: expect.objectContaining({ ref: expect.objectContaining({ taskId: 'design' }),
          eligibility: expect.objectContaining({ eligible: true }) }),
      }));
    } else {
      expect(['not_ready', 'rejected']).toContain(racedReady.status);
    }
    const endedGraph = await rf.plans.queryTaskGraph(runtimeWorld.ctx, { goalRef: runtimeGoal.value.ref });
    if (endedGraph.status === 'ready') {
      expect(endedGraph.value.tasks.find(task => task.ref.taskId === 'design')).toMatchObject({
        eligibility: { eligible: false }, execution: designClaim.value.runRef,
      });
    } else {
      expect(['not_ready', 'rejected']).toContain(endedGraph.status);
    }

    // A second real Run appears after the graph lookup read its old page and
    // stays running at its own model gate.
    const implementSession = await rf.createSession('r3c-implement-session', firstCard.value.record.role);
    let implementRunRef: import('../../src/contracts/dispatch.js').RunRef | undefined;
    let implementStart: ReturnType<typeof runtimeWorld.runtime.port.startRun> | undefined;
    let injectImplement = true;
    const racingGraphReader = createPlanService({ records: {
      ...rf.records,
      async lookup(request) {
        const page = await rf.records.lookup(request);
        if (injectImplement && request.index === 'r3c-run-by-goal'
          && page.status === 'ready' && page.value.next === null) {
          injectImplement = false;
          const claim = await rf.service.claimTask(runtimeWorld.ctx, await rf.buildRequest({
            requestId: 'r3c-implement-claim',
            input: { goalRef: runtimeGoal.value.ref, planRef: runtimeApplied.value.ref,
              taskId: 'implement', sessionRef: implementSession },
          }));
          if (claim.status !== 'committed') throw Error('the implement claim failed');
          implementRunRef = claim.value.runRef;
          runtimeWorld.allowRun(claim.value.runRef);
          const prepared = await prepareTaskForReal(rf, {
            bodies: runtimeWorld.deps.bodies, runRef: claim.value.runRef,
            host: runtimeWorld.host, requestId: 'r3c-implement-prepare',
          });
          implementStart = runtimeWorld.runtime.port.startRun(runtimeWorld.ctx, {
            prepared: prepared.prepared, consumerId: 'r3c-adoption-runtime', requestId: 'r3c-implement-start',
          });
          const settled = implementStart.then(result => ({ settled: true as const, result }));
          const early = await Promise.race([implementHeld.then(() => null), settled]);
          if (early !== null) {
            throw Error(`the implement Run settled before its model gate: ${JSON.stringify(early)}`);
          }
        }
        return page;
      },
    }, now: () => at, eventId: () => `r3c-graph-race-${++sequence}` });
    const racedGraph = await racingGraphReader.queryTaskGraph(runtimeWorld.ctx, { goalRef: runtimeGoal.value.ref });
    expect(injectImplement).toBe(false);
    if (implementStart === undefined || implementRunRef === undefined) throw Error('the implement gate did not fire');
    if (racedGraph.status === 'ready') {
      expect(racedGraph.value.tasks.find(task => task.ref.taskId === 'implement')).toMatchObject({
        effectivePhase: 'running', execution: implementRunRef, eligibility: { eligible: false },
      });
      expect(racedGraph.value.tasks).toHaveLength(3);
    } else {
      expect(['not_ready', 'rejected']).toContain(racedGraph.status);
    }
    releaseImplement();
    expect(await implementStart).toMatchObject({ status: 'ready' });

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
