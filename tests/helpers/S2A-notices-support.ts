/**
 * Slice 2A QE3 notice-flow support (Group N).
 *
 * Builds the real S5 decision world plus the real notice owners.
 */
import { expect } from 'vitest';
import type { NoticeCategoryV1, NoticePositionV1 } from '../../src/contracts/goal-decisions.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { GoalRef, WorkspaceRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import type { TaskRequeueSnapshotV1 } from '../../src/contracts/task-requeue.js';
import { DEFAULT_TASK_AUTOMATION_POLICY, type TaskAutomationPolicyV1 } from '../../src/contracts/task-requeue.js';
import type { TrustedCheckConfiguration, CheckProcessObservation } from '../../src/contracts/verification.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { DecisionNoticeSourcePort, S5RecordPort } from '../../src/core/work-graph/model/decision-contracts.js';
import { createDecisionSettingsService } from '../../src/core/work-graph/configuration/decision-settings-service.js';
import { createDecisionReadModel } from '../../src/core/work-graph/views/decision-read-model.js';
import { createNoticeDisplayToken } from '../../src/core/work-graph/views/notice-display-token.js';
import { createNoticePositionComparator } from '../../src/core/work-graph/views/notice-position.js';
import { createAutomaticReworkNoticeSource } from '../../src/core/work-graph/views/automatic-rework-notices.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { decodeWorkspaceSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { createEvidenceService } from '../../src/core/work-graph/evidence/evidence-service.js';
import { OPERATOR, PROJECT, PROJECT_ID, T, WORKSPACE, WORKSPACE_SCOPE, openS5DecisionFixture,
  type S5DecisionFixture, type S5FixtureKind } from './S5-decision-fixture.js';
import { automationContext, committed, endRun, key, mailboxDependencies, materialsFor, noticeWork, pin, ready,
  storedRecord, workspaceSnapshot } from './S5-queue-support.js';

export { WORKSPACE_SCOPE, committed, pin, ready };
type S5NoticeWork = Awaited<ReturnType<typeof noticeWork>>;

/** Opens the real S5 fixture and the real notice world used by the QE3 rows. */
export async function openS2ANotices(kind: S5FixtureKind): Promise<{ f: S5DecisionFixture; work: S5NoticeWork }> {
  const f = await openS5DecisionFixture(kind);
  const work = await noticeWork(f);
  return { f, work };
}

/**
 * The production notice source under test, built on the same real store.
 * The S5 fixture's observed port forwards `readMany`/`lookup` but predates the
 * ordered port, so `lookupOrdered` is delegated to the real backend the fixture
 * wraps (`f.b2.base.records`), exactly as P8 adapts a records double.
 */
export function automaticRework(f: S5DecisionFixture,
  countOrdered?: (index: string) => void,
  orderedPageLimit?: number): DecisionNoticeSourcePort {
  const real = f.b2.base.records as unknown as RecordOrderedLookupPort;
  return createAutomaticReworkNoticeSource({ records: {
    readMany: (keys: readonly string[]) => f.records.readMany(keys),
    lookup: (request: Parameters<S5RecordPort['lookup']>[0]) => f.records.lookup(request),
    lookupOrdered: (request: Parameters<RecordOrderedLookupPort['lookupOrdered']>[0]) => {
      countOrdered?.(request.index);
      return real.lookupOrdered(request);
    },
  }, ...(orderedPageLimit === undefined ? {} : { orderedPageLimit }) });
}

/**
 * The queue + `markNoticesSeen` harness of `tests/work-graph/S5-notices.test.ts`.
 * Only the injected notice sources differ; the merger, token and settings owner
 * are always the production implementations.
 */
export function noticesHarness(f: S5DecisionFixture, sources: readonly DecisionNoticeSourcePort[],
  widths: { sourcePageLimit?: number; lookupPageLimit?: number } = {}) {
  const displayTokens = createNoticeDisplayToken(new Uint8Array(32));
  const positions = createNoticePositionComparator();
  const settings = createDecisionSettingsService({ records: f.records, now: f.now, newId: f.newId,
    displayTokens, positions, operatorActor: OPERATOR });
  const reads = createDecisionReadModel({ records: f.records, cardSources: [], noticeSources: sources,
    // Notice-only requests never call the unrelated conflict assembler.
    conflicts: { async queryGoalConflicts() { throw new Error('notice-only reads must not query conflicts'); } },
    positions, displayTokens,
    ...(widths.sourcePageLimit === undefined ? {} : { sourcePageLimit: widths.sourcePageLimit }),
    ...(widths.lookupPageLimit === undefined ? {} : { lookupPageLimit: widths.lookupPageLimit }) });
  const page = async (options: { categories?: NoticeCategoryV1[]; limit?: number; cursor?: string } = {}) =>
    ready(await reads.queryDecisionQueue(f.ctx, { workspace: WORKSPACE_SCOPE, sections: ['notices'],
      ...(options.categories === undefined ? {} : { categories: options.categories }),
      page: { limit: options.limit ?? 50, ...(options.cursor === undefined ? {} : { cursor: options.cursor }) } }));
  const mark = async (displayToken: string | null, seenThrough: Partial<Record<NoticeCategoryV1, NoticePositionV1>>) => {
    if (displayToken === null) throw new Error('the delivered page must have a token');
    return committed(await settings.markNoticesSeen(f.ctx, { input: { workspace: WORKSPACE_SCOPE, displayToken, seenThrough },
      meta: { requestId: f.newId(), expected: [await pin(f.records, WORKSPACE)] } }));
  };
  return { page, mark, displayTokens, reads };
}

/** The public claim/entry/end steps the shared many-task world drives. */
export type ManyTaskWorldClaimStack = {
  createSession(goalId: string, taskId: string): Promise<SessionRef>;
  claim(input: { requestId: string; goalRef: GoalRef; planRef: PlanRevisionRef; taskId: string;
    sessionRef: SessionRef }): Promise<TaskClaim>;
  enter(claim: TaskClaim): Promise<RunSnapshot>;
  end(claim: TaskClaim): Promise<RunSnapshot>;
  automationContext(): CoreCallContext;
};

export type ManyTaskWorldOptions = {
  goalId?: string;
  planId?: string;
  optionalTaskIds?: readonly string[];
  scope?: WorkspaceScope;
  ctx?: CoreCallContext;
  claim?: ManyTaskWorldClaimStack;
};

/**
 * QA-10(一): a real Goal/Plan with one work Task per id, a real requeue writer
 * with a controllable source digest. Each `requeueOnce(taskId)` claims a FRESH
 * real Session/Run, enters it, ends it as a crash and performs a real system
 * requeue. Distinct Task ids keep the fixture's enter identities unique, and the
 * bumped source keeps `no_new_basis` from refusing.
 */
export async function openManyTaskWorld(f: S5DecisionFixture, taskIds: readonly string[],
  options: ManyTaskWorldOptions = {}) {
  const goalId = options.goalId ?? 'S2A';
  const planId = options.planId ?? 'PS2A';
  const optionalTaskIds = options.optionalTaskIds ?? [];
  const scope = options.scope ?? WORKSPACE_SCOPE;
  const ctx = options.ctx ?? f.ctx;
  const workspaceRef: WorkspaceRef = { aggregateType: 'Workspace', projectId: scope.projectId,
    workspaceId: scope.workspaceId };
  const workspaceKey = key(workspaceRef);
  const workspaceRead = ready(await f.records.readMany([workspaceKey]));
  let workspaceRevision = workspaceRead.records.find((record) => record.refKey === workspaceKey)?.revision;
  // The public bootstrap owner registers a missing Workspace and installs /
  // activates the static CompletionPolicy the rework writer needs.
  const bootstrap = createProjectBootstrapServices({ records: f.records, now: f.now, eventId: f.newId });
  if (workspaceRevision === undefined) {
    const registered = committed(await bootstrap.projects.registerWorkspace(ctx, {
      input: { workspace: scope },
      meta: { requestId: `s2a-many-workspace-${goalId}`,
        expected: [{ ref: PROJECT, revision: 1 }, { ref: workspaceRef, revision: 0 }] } }));
    workspaceRevision = registered.revision;
  }
  const policyId = `s2a-static-${scope.workspaceId}-${goalId}`;
  const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId: scope.projectId, policyId, revision: 1 };
  const projectPin = await pin(f.records, PROJECT);
  const installed = committed(await bootstrap.completionPolicies.installCompletionPolicy(ctx, {
    input: { policyId, contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } },
    meta: { requestId: `s2a-many-install-${goalId}`,
      expected: [projectPin, { ref: policyRef, revision: 0 }] } }));
  const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: scope.projectId };
  const previous = await storedRecord(f.records, activeRef);
  committed(await bootstrap.completionPolicies.activateCompletionPolicy(ctx, {
    input: { target: { ref: installed.ref, digest: installed.contentDigest } },
    meta: { requestId: `s2a-many-activate-${goalId}`,
      expected: [projectPin, { ref: activeRef, revision: previous.revision }] } }));
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: scope.projectId, goalId };
  const goals = createGoalService({ records: f.records, now: f.now, eventId: f.newId }).tasks;
  const goal = committed(await goals.createGoal(ctx, { input: { goalId: goalRef.goalId, workspace: scope,
    objective: 'Slice 2A many-task rework world' },
    meta: { requestId: `s2a-many-goal-${goalId}`,
      expected: [projectPin, { ref: workspaceRef, revision: workspaceRevision }] } }));
  const draft: PlanRevisionDraft = { schemaVersion: 2, planId, planRevision: 1, goalId: goalRef.goalId, stages: [],
    tasks: [...taskIds.map((taskId) => ({ taskId, title: `S2A ${taskId}`, taskKind: 'work' as const,
      requirementLevel: 'required' as const, disposition: 'active' as const, phase: 'pending' as const, scope: { kind: 'goal' as const } })),
      ...optionalTaskIds.map((taskId) => ({ taskId, title: `S2A ${taskId}`, taskKind: 'work' as const,
        requirementLevel: 'optional' as const, disposition: 'active' as const, phase: 'pending' as const, scope: { kind: 'goal' as const } })),
      { taskId: 's2a-gate', title: 'S2A gate', taskKind: 'gate' as const, requirementLevel: 'required' as const,
        disposition: 'active' as const, phase: 'pending' as const, scope: { kind: 'goal' as const } }],
    assignments: [...taskIds, ...optionalTaskIds].map((taskId) => ({ taskId, role: 'builder', instruction: `Perform ${taskId}` })),
    obligations: [{ obligationId: 's2a-obligation', title: 'Static acceptance', requirementLevel: 'required',
      taskIds: [...taskIds, ...optionalTaskIds, 's2a-gate'], verificationRequirements: [{ requirementId: 's2a-check', kind: 'static',
        requirementLevel: 'required', description: 'Registered check' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [] };
  const plans = createPlanService({ records: f.records, now: f.now, eventId: f.newId });
  const proposal = committed(await plans.proposePlan(ctx, { input: { goalRef, basedOn: null, draft,
    reason: { text: 'Slice 2A rework world', sources: [] } },
    meta: { requestId: `s2a-many-propose-${goalId}`, expected: [{ ref: goalRef, revision: goal.revision }] } }));
  const applied = await plans.applyPlanChange(ctx, { input: { proposalRef: proposal.ref,
    expectedProposalRevision: proposal.revision, decisionRefs: [] },
    meta: { requestId: `s2a-many-adopt-${goalId}`, expected: [{ ref: goalRef, revision: goal.revision }] } });
  if (applied.status !== 'committed') throw new Error(`the rework world plan adoption failed: ${JSON.stringify(applied)}`);
  const plan = applied.value;

  const reads = createRunStateReader({ records: f.records });
  const materials = materialsFor(f);
  const mailbox = createSessionMailbox(mailboxDependencies(f));
  const roles = createRoleConfigurationService({ records: f.records, now: f.now, eventId: f.newId });
  const source = { revision: 1 };
  const workspaceHost = {
    async resolveRoot(workspace: WorkspaceRef) {
      const decoded = decodeWorkspaceSnapshot(await storedRecord(f.records, workspace));
      if (decoded.status !== 'decoded') throw new Error(decoded.reason);
      return { status: 'ready' as const, value: { root: f.base.directory, workspaceRevision: decoded.value.revision } };
    },
    async authorize() { return { status: 'ready' as const, value: { subjectKey: 's2a-rework-host',
      permissionRevision: 's2a-rework-permission', allowsRead: () => true } }; },
  };
  const requeues = createTaskRequeueService({ records: f.records, reads, materials, messages: mailbox, workspaceHost,
    source: { async captureDigest() { return { status: 'ready' as const,
      sourceDigest: sha256Hex(`s2a-rework-source-${source.revision}`) }; } },
    delegatedWrites: { reads, roles, bodies: f.bodies,
      authorizeConfiguration: async () => ({ status: 'rejected' as const, code: 'forbidden' as const,
        reason: 'no agent writes in this fixture' }) },
    automationPolicy: () => DEFAULT_TASK_AUTOMATION_POLICY, now: f.now, eventId: f.newId });
  let sessionSeq = 0;
  const claimStack: ManyTaskWorldClaimStack = options.claim ?? {
    async createSession() { return f.createS5Session(`s2a-rework-${goalId}-${++sessionSeq}`); },
    claim: (input) => f.claimRun(input),
    enter: (claim) => f.enterClaim(claim),
    end: (claim) => endRun(f, claim, { eventType: 'run_crashed',
      payload: { kind: 'crashed', error: 'recorded slice-2A rework failure' } }),
    automationContext: () => automationContext(f),
  };
  const requeueOnce = async (taskId: string): Promise<TaskRequeueSnapshotV1> => {
    const sessionRef = await claimStack.createSession(goalId, taskId);
    const claim = await claimStack.claim({ requestId: f.newId(), goalRef, planRef: plan.ref, taskId, sessionRef });
    await claimStack.enter(claim);
    const ended = await claimStack.end(claim);
    source.revision += 1;
    const value = committed(await requeues.requeueTask(claimStack.automationContext(), { input: { taskRef: claim.task,
      afterRunRef: claim.runRef, reason: 'Retry the failed slice-2A work' },
      meta: { requestId: f.newId(), expected: [await pin(f.records, goalRef), { ref: claim.runRef, revision: ended.revision }] } }));
    if (value.kind !== 'requeued') throw new Error(`the automatic requeue was refused: ${JSON.stringify(value)}`);
    return value.requeue;
  };
  return { goalRef, plan, requeueOnce, goals };
}

/**
 * QA-12: complete one world's Goal through the real formal path — one
 * successful work Run, a controlled static check per required task and the goal
 * gate, `completeTask`, then `completeGoal`. The world comes from
 * `openManyTaskWorld`; the static evidence owner from `openReverifyChain`.
 */
export async function completeWorldGoal(
  f: S5DecisionFixture,
  world: Awaited<ReturnType<typeof openManyTaskWorld>>,
  chain: ReturnType<typeof openReverifyChain>,
  taskId: string,
  gateTaskId = 's2a-gate',
): Promise<void> {
  const sessionRef = await f.createS5Session(`s2a-complete-${world.goalRef.goalId}-${taskId}`);
  const claim = await f.claimRun({ requestId: f.newId(), goalRef: world.goalRef, planRef: world.plan.ref, taskId, sessionRef });
  await f.enterClaim(claim);
  const run = await f.settleRun(claim);
  await verifyAndCompleteTask(f, world, chain, run.ref, { projectId: PROJECT_ID, goalId: world.goalRef.goalId, taskId }, false);
  await verifyAndCompleteTask(f, world, chain, run.ref,
    { projectId: PROJECT_ID, goalId: world.goalRef.goalId, taskId: gateTaskId }, true);
  const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: PROJECT_ID, goalId: world.goalRef.goalId };
  committed(await world.goals.completeGoal(f.ctx, { input: { goalRef: world.goalRef },
    meta: { requestId: f.newId(), expected: [await pin(f.records, world.goalRef), { ref: phaseRef, revision: 0 }] } }));
}

/** One real open -> begin -> record -> finalize PASS -> completeTask cycle. */
async function verifyAndCompleteTask(
  f: S5DecisionFixture,
  world: Awaited<ReturnType<typeof openManyTaskWorld>>,
  chain: ReturnType<typeof openReverifyChain>,
  subjectRunRef: Parameters<typeof chain.evidence.openVerification>[1]['input']['subjectRunRef'],
  subject: { projectId: string; goalId: string; taskId: string },
  gate: boolean,
): Promise<void> {
  const opened = committed(await chain.evidence.openVerification(f.ctx, { input: { subjectRunRef, subject,
    planRef: world.plan.ref, ...(gate ? { gateSubject: 'goal' as const } : {}) },
    meta: { requestId: f.newId(), expected: [] } }));
  const checkId = opened.checks[0]?.checkId;
  if (checkId === undefined) throw new Error('the opened round has no configured check');
  const ticket = committed(await chain.evidence.beginCheck(f.ctx, { input: { roundRef: opened.ref, checkId },
    meta: { requestId: f.newId(), expected: [{ ref: opened.ref, revision: opened.revision }] } }));
  let round = ready(await chain.evidence.readVerification(f.ctx, opened.ref));
  round = committed(await chain.evidence.recordCheckResult(f.ctx, { input: { roundRef: opened.ref, checkId,
    invocationId: ticket.invocationId, observation: staticCheckProcess() },
    meta: { requestId: f.newId(), expected: [{ ref: opened.ref, revision: round.revision }] } }));
  const finalized = committed(await chain.evidence.finalizeChecks(f.ctx, { input: { roundRef: opened.ref },
    meta: { requestId: f.newId(), expected: [{ ref: opened.ref, revision: round.revision }] } }));
  expect(finalized).toMatchObject({ outcome: 'PASS' });
  const reductionRef = { aggregateType: 'TaskReduction' as const, projectId: PROJECT_ID,
    goalId: world.goalRef.goalId, taskId: subject.taskId };
  committed(await world.goals.completeTask(f.ctx, { input: { taskRef: subject, planRef: world.plan.ref,
    roundRef: finalized.snapshot.ref },
    meta: { requestId: f.newId(), expected: [await pin(f.records, world.goalRef), { ref: reductionRef, revision: 0 }] } }));
}

/** A controlled successful static-check observation (no process is launched). */
function staticCheckProcess(): CheckProcessObservation {
  return { kind: 'executed', startedAt: T, finishedAt: T, exitCode: 0, signal: null, timedOut: false, cancelled: false,
    stdout: { text: 'S2A_OK\n', totalBytes: 7, truncated: false },
    stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { workspaceRevision: 's2a-complete-source', changedPaths: [] },
    sandboxProfileVersion: 'bwrap-m3-v4' };
}

/**
 * A real evidence owner over the fixture's store whose source digest can be
 * changed between reverify calls (QA-18 needs a person's reverify and then a
 * system reverify on a NEW source, exactly like `noticeWork.rounds` bumps its
 * internal `source.revision` before an automatic successor). The configuration,
 * workspace host and capture shape are the same real `createEvidenceService`
 * inputs `S5-queue-support.noticeWork` uses.
 */
export function openReverifyChain(f: S5DecisionFixture, policy: TaskAutomationPolicyV1 = DEFAULT_TASK_AUTOMATION_POLICY) {
  const reads = createRunStateReader({ records: f.records });
  const materials = materialsFor(f);
  const source = { revision: 1 };
  const configuration: TrustedCheckConfiguration = { configurationRevision: 's2a-notice-checks', workspace: WORKSPACE,
    executor: OPERATOR, permissionRevision: 's2a-notice-permission', sourceAccess: 'verification_workspace',
    processAccess: 'all_except_denied', deniedPrefixes: [],
    checks: [{ checkId: 'static', kind: 'static', command: 'fixture-check', cwd: '.', timeoutMs: 1000, taskIds: 'all' }] };
  const workspaceHost = {
    async resolveRoot() { return { status: 'ready' as const, value: { root: f.base.directory,
      workspaceRevision: (await workspaceSnapshot(f)).revision } }; },
    async authorize() { return { status: 'ready' as const, value: { subjectKey: 's2a-notice-host',
      permissionRevision: 's2a-notice-permission', allowsRead: () => true } }; },
  };
  const evidence = createEvidenceService({ records: f.records, executions: reads, materials, workspaceHost, configuration,
    automationPolicy: () => policy,
    source: { async capture() { return { status: 'ready' as const, sourceDigest: sha256Hex(`s2a-source-${source.revision}`),
      sourceProof: { kind: 'current-workspace-only' as const, runBaselineKnown: false },
      changeScope: { diffClass: 'code-change' as const, changedFiles: ['src/m/a.ts'], writeSummary: `source ${source.revision}` }, gaps: [] }; } },
    now: f.now, newId: f.newId });
  return { evidence, bumpSource: () => { source.revision += 1; } };
}
