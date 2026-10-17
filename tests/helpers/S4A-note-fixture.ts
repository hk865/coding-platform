/**
 * Slice 4A W1 behaviour-test fixture (N-01…N-10).
 *
 * What it builds and through which public calls:
 *   - one real `createTargetPlatform` (memory or SQLite) over a real temporary
 *     workspace, with Host workspace bindings (real workspace-tool reads);
 *   - the project/workspace, a `test` completion policy, an active architecture
 *     catalog (modules `R`/`A`/`A1`/`B` and interface `A/I1`) through
 *     `projects.createProject`, `projects.registerWorkspace`,
 *     `completionPolicies.installCompletionPolicy`/`activateCompletionPolicy` and
 *     `architecture.adoptInitialArchitecture`;
 *   - a Goal with an accepted Plan (stage `s1`, work Tasks `t1`/`t2`, gate `g1`)
 *     through `goals.createGoal`, `plans.proposePlan`, `plans.applyPlanChange`;
 *   - real Sessions through `sessions.admitSessionCreation`/`recordSessionCreated`
 *     and real Runs through `claims.claimTask`; every Session's role is the exact
 *     `platform-<executor|scribe>@s3.1` legacy template and the claim's binding
 *     names the same template, so the PRODUCTION `createSessionDutyResolver`
 *     (never injected here) maps the Run's Session role to a real duty. The plan
 *     assigns `t1`/`t2` to `platform-executor` and `t3` to `platform-scribe`.
 * Nothing reads the record store to answer an assertion; the tests only use
 * `platform.notes`.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { GoalRef, WorkspaceRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { RoleBindingRefV1, TaskBudgetV1 } from '../../src/contracts/dispatch.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { NoteWritePort, WriteNoteResult } from '../../src/core/work-graph/model/note-contracts.js';
import type { TaskRequeueRef } from '../../src/contracts/task-requeue.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';

export type S4ANoteFixtureKind = 'memory' | 'sqlite';

/**
 * Slice 4B round 2 (R16): the injectable note limits the composition root
 * forwards. This is the one additive change to this 4A fixture: the existing
 * top-level `anchorQuota`/`goalQuota`/`symbolHitsMax` options keep working, and
 * a caller may also pass any of these through `noteLimits` (the read-model
 * limits reach `platform.notes`' own read model).
 */
export type S4ANoteLimits = {
  anchorQuota?: number; goalQuota?: number; symbolHitsMax?: number; basisFileMaxBytes?: number;
  readFilesMax?: number; readFactsMax?: number; symbolRecheckMax?: number;
  textSearchCandidateMax?: number; textSearchMaxTerms?: number; resultMaxBytes?: number;
};

let suffixCounter = 0;

export const S4A_AT = '2026-10-15T00:00:00.000Z';
const PROJECT = 's4a-project';
const WORKSPACE = 's4a-workspace';

export type S4ARole = 'executor' | 'scribe';

export type S4ANoteFixture = {
  kind: S4ANoteFixtureKind;
  platform: Awaited<ReturnType<typeof createTargetPlatform>>;
  notes: NoteWritePort;
  root: string;
  scope: { projectId: string; workspaceId: string };
  projectRef: { aggregateType: 'Project'; projectId: string };
  workspaceRef: WorkspaceRef;
  goalRef: GoalRef;
  planRef: PlanRevisionRef;
  plan: PlanRevisionSnapshot;
  roleBinding: RoleBindingRefV1;
  budget: TaskBudgetV1;
  ctx(): CoreCallContext;
  workCtx(runRef: RunRef): CoreCallContext;
  queryCtx(): CoreCallContext;
  createSession(requestId: string, role: S4ARole): Promise<{ sessionRef: { projectId: string; sessionId: string } }>;
  claimRun(suffix: string, taskId?: string, role?: S4ARole): Promise<RunRef>;
  /** Claim another task with an EXISTING Session (item 9b: a later Run of the same Session).
   * Slice 4C-2 item 2: an optional real `requeueRef` makes this a TASK-03 continuation claim. */
  claimInSession(suffix: string, sessionRef: { projectId: string; sessionId: string }, taskId: string,
    role: S4ARole, requeueRef?: TaskRequeueRef): Promise<RunRef>;
  write(ctx: CoreCallContext, draft: NoteDraftV1, goalId: string | null,
    options?: { commandId?: string; expectedPointerRevision?: number | null }): Promise<WriteNoteResult>;
  close(): Promise<void>;
};

function roleRef(role: S4ARole): RoleConfigurationRef {
  return { kind: 'legacy_template', templateId: role === 'scribe' ? 'platform-scribe' : 'platform-executor',
    templateRevision: 's3.1' };
}

function bindingFor(role: S4ARole, id: string): RoleBindingRefV1 {
  return { schemaVersion: 1, bindingId: `s4a-${id}-binding`, templateId: role === 'scribe' ? 'platform-scribe' : 'platform-executor',
    templateRevision: 's3.1', bindingVersion: 1, policyRevision: 'legacy-template' };
}

export async function createS4ANoteFixture(kind: S4ANoteFixtureKind,
  options: { anchorQuota?: number; goalQuota?: number; symbolHitsMax?: number; noteLimits?: S4ANoteLimits;
    /** Slice 4C-2 item 2: the trusted Host runtime binding, so a test can drive
     * the public `prepareExecution`/`startRun` over a real claim in this fixture. */
    runtime?: RuntimeHostBindings;
    /** Slice 4C-2 D-03: the deterministic note id generator passed to the note
     * service; absent keeps the production `randomUUID`. */
    noteNewId?: () => string } = {}): Promise<S4ANoteFixture> {
  const directory = await mkdtemp(join(tmpdir(), `s4a-note-${kind}-`));
  const root = join(directory, 'workspace');
  await mkdir(join(root, 'src/a/one'), { recursive: true });
  await mkdir(join(root, 'src/b'), { recursive: true });
  await writeFile(join(root, 'src/a/x.ts'), 'export const a = 1;\n');
  await writeFile(join(root, 'src/a/one/x.ts'), 'export const one = 1;\n');
  await writeFile(join(root, 'src/b/y.ts'), 'export const b = 1;\n');

  const scope = { projectId: PROJECT, workspaceId: WORKSPACE };
  const projectRef = { aggregateType: 'Project' as const, projectId: PROJECT };
  const workspaceRef: WorkspaceRef = { aggregateType: 'Workspace', projectId: PROJECT, workspaceId: WORKSPACE };
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: PROJECT, goalId: 's4a-goal' };
  const planRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: PROJECT, planId: 's4a-plan' };
  const executorBinding = bindingFor('executor', 'fixture');
  const budget: TaskBudgetV1 = { tokenBudget: 100000, deadline: null };

  let clock = 0;
  const now = () => new Date(Date.parse(S4A_AT) + (++clock) * 1000).toISOString();
  const runBindings = new Map<string, RoleBindingRefV1>();
  const hostActor = { kind: 'human' as const, id: 's4a-operator' };
  const bindings: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      return requested.projectId === PROJECT && requested.workspaceId === WORKSPACE
        ? { status: 'ready', value: { root, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered' };
    },
    async authorize() {
      return { status: 'ready', value: { subjectKey: 's4a-host', permissionRevision: 's4a-grant-1', allowsRead: () => true } };
    },
  };
  const noteLimits: S4ANoteLimits = {
    ...(options.noteLimits ?? {}),
    ...(options.anchorQuota === undefined ? {} : { anchorQuota: options.anchorQuota }),
    ...(options.goalQuota === undefined ? {} : { goalQuota: options.goalQuota }),
    ...(options.symbolHitsMax === undefined ? {} : { symbolHitsMax: options.symbolHitsMax }),
  };
  const platform = await createTargetPlatform({
    storage: kind === 'memory' ? { kind: 'memory' } : { kind: 'sqlite', directory: join(directory, 'storage') },
    workspace: bindings,
    now,
    kernelStores: { entries: [{ adapterId: 's4a-kernel', storeKey: 's4a-kernel-store', workspace: scope,
      databasePath: join(directory, 'kernel.sqlite') }] },
    ...(Object.keys(noteLimits).length === 0 ? {} : { noteLimits }),
    ...(options.runtime === undefined ? {} : { runtime: options.runtime }),
    ...(options.noteNewId === undefined ? {} : { noteNewId: options.noteNewId }),
  });

  const hostCtx = (): CoreCallContext => ({ projectId: PROJECT, workspaceId: WORKSPACE,
    principal: { kind: 'host', actor: hostActor },
    materialReader: { kind: 'host', projectId: PROJECT, workspaceId: WORKSPACE, actor: hostActor },
    signal: new AbortController().signal });
  const workCtx = (runRef: RunRef): CoreCallContext => ({ projectId: PROJECT, workspaceId: WORKSPACE,
    principal: { kind: 'work_run', runRef, roleBinding: runBindings.get(runRef.runId) ?? executorBinding },
    materialReader: { kind: 'run', requester: runRef }, signal: new AbortController().signal });
  const queryCtx = (): CoreCallContext => ({ projectId: PROJECT, workspaceId: WORKSPACE,
    principal: { kind: 'query_run', queryRunRef: { aggregateType: 'QueryRun', projectId: PROJECT, queryRunId: 's4a-query' } as never,
      initiator: hostActor },
    materialReader: { kind: 'host', projectId: PROJECT, workspaceId: WORKSPACE, actor: hostActor },
    signal: new AbortController().signal });

  const committed = async (label: string, result: { status: string }): Promise<Record<string, unknown>> => {
    if (result.status !== 'committed') throw new Error(`S4A fixture ${label} failed: ${JSON.stringify(result)}`);
    return (result as unknown as { value: Record<string, unknown> }).value;
  };
  const ctx = hostCtx();
  await committed('project', await platform.projects.createProject(ctx, { meta: { requestId: 's4a-project', expected: [{ ref: projectRef, revision: 0 }] },
    input: { projectId: PROJECT } }));
  await committed('workspace', await platform.projects.registerWorkspace(ctx, { meta: { requestId: 's4a-workspace',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: scope } }));
  const installed = await committed('policy-install', await platform.completionPolicies.installCompletionPolicy(ctx, {
    meta: { requestId: 's4a-policy-install', expected: [{ ref: projectRef, revision: 1 },
      { ref: { aggregateType: 'CompletionPolicyRevision', projectId: PROJECT, policyId: 's4a-policy', revision: 1 }, revision: 0 }] },
    input: { policyId: 's4a-policy', contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 } } }));
  await committed('policy-activate', await platform.completionPolicies.activateCompletionPolicy(ctx, {
    meta: { requestId: 's4a-policy-activate', expected: [{ ref: projectRef, revision: 1 },
      { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId: PROJECT }, revision: 0 }] },
    input: { target: { ref: installed['ref'] as never, digest: installed['contentDigest'] as string } } }));
  await committed('architecture', await platform.architecture.adoptInitialArchitecture(ctx, {
    meta: { requestId: 's4a-architecture', expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
    input: { baselineId: 's4a-baseline', description: 'S4A note anchors', constraints: [], catalog: {
      requireDag: true, dependencies: [], modules: [
        { ref: { projectId: PROJECT, moduleId: 'R' }, name: 'R', responsibility: 'root', paths: ['.'], interfaces: [] },
        { ref: { projectId: PROJECT, moduleId: 'A' }, name: 'A', responsibility: 'area A', paths: ['src/a'],
          interfaces: [{ id: 'I1', description: 'A interface', paths: ['src/a'] }] },
        { ref: { projectId: PROJECT, moduleId: 'A1' }, name: 'A1', responsibility: 'area A1', paths: ['src/a/one'], interfaces: [] },
        { ref: { projectId: PROJECT, moduleId: 'B' }, name: 'B', responsibility: 'area B', paths: ['src/b'], interfaces: [] },
      ] } } }));
  await committed('goal', await platform.goals.createGoal(ctx, { meta: { requestId: 's4a-goal',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
    input: { goalId: goalRef.goalId, workspace: scope, objective: 'S4A note goal' } }));
  const draft: PlanRevisionDraft = { schemaVersion: 1, planId: planRef.planId, planRevision: 1, goalId: goalRef.goalId,
    stages: [{ stageId: 's1', title: 'Stage one' }],
    tasks: [
      { taskId: 't1', stageId: 's1', title: 'Work one', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 't2', stageId: 's1', title: 'Work two', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 't3', stageId: 's1', title: 'Scribe review', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'g1', title: 'Gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 't1', role: 'platform-executor', instruction: 'Work one' },
      { taskId: 't2', role: 'platform-executor', instruction: 'Work two' },
      { taskId: 't3', role: 'platform-scribe', instruction: 'Scribe review' }],
    obligations: [{ obligationId: 'o1', title: 'Deliver', requirementLevel: 'required', taskIds: ['t1', 't2', 't3', 'g1'],
      verificationRequirements: [{ requirementId: 'v1', requirementLevel: 'required', kind: 'test', description: 'Tests pass' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
  const proposed = await committed('plan-propose', await platform.plans.proposePlan(ctx, {
    meta: { requestId: 's4a-plan-propose', expected: [{ ref: goalRef, revision: 1 }] },
    input: { goalRef, basedOn: null, draft, reason: { text: 'S4A plan', sources: [] } } }));
  const applied = await committed('plan-apply', await platform.plans.applyPlanChange(ctx, {
    meta: { requestId: 's4a-plan-apply', expected: [{ ref: goalRef, revision: 1 }] },
    input: { proposalRef: proposed['ref'] as never, expectedProposalRevision: proposed['revision'] as number, decisionRefs: [] } }));
  const plan = applied as unknown as PlanRevisionSnapshot;

  let sessionSeq = 0;
  async function createSession(requestId: string, role: S4ARole): Promise<{ sessionRef: { projectId: string; sessionId: string } }> {
    const admitted = await committed(`admit-${requestId}`, await platform.sessions.admitSessionCreation(ctx, {
      meta: { requestId: `s4a-admit-${requestId}`, expected: [] },
      input: { workspace: scope, kernelStore: { adapterId: 's4a-kernel', storeKey: 's4a-kernel-store' },
        role: roleRef(role), recommendedRefs: [], initialLinks: [] } }));
    const action = admitted['action'] as { plannedSessionRef: { projectId: string; sessionId: string } };
    const admittedRef = admitted['ref'] as { projectId: string; sessionId: string };
    const kernelSessionId = `s4a-kernel-session-${requestId}-${++sessionSeq}`;
    await platform.kernelStores.withStore('s4a-kernel', store => store.create({
      sessionId: kernelSessionId, recordId: `s4a-kernel-record-${requestId}`, createdAt: now(),
    }, { signal: ctx.signal }));
    const registered = await committed(`record-${requestId}`, await platform.sessions.recordSessionCreated(ctx, {
      meta: { requestId: `s4a-record-${requestId}`, expected: [] },
      input: { operationRef: admittedRef as never, sessionRef: action.plannedSessionRef, adapterId: 's4a-kernel',
        kernelSessionId, historyCursor: null, observedAt: now() } }));
    return { sessionRef: registered['ref'] as { projectId: string; sessionId: string } };
  }

  async function claimInSession(suffix: string, sessionRef: { projectId: string; sessionId: string },
    taskId: string, role: S4ARole, requeueRef?: TaskRequeueRef): Promise<RunRef> {
    const roleBinding = bindingFor(role, suffix);
    const goalRead = await platform.plans.queryGoal(ctx, goalRef);
    if (goalRead.status !== 'ready') throw new Error('S4A fixture goal read failed');
    const card = await platform.sessions.readSession(ctx, sessionRef);
    if (card.status !== 'ready') throw new Error('S4A fixture session read failed');
    const claimed = await committed(`claim-${suffix}`, await platform.claims.claimTask(ctx, {
      input: { goalRef, planRef, taskId, sessionRef, roleBinding, budget,
        ...(requeueRef === undefined ? {} : { requeueRef }) },
      meta: { requestId: `s4a-claim-${suffix}`, expected: [
        { ref: goalRef, revision: goalRead.value.goal.revision },
        { ref: workspaceRef, revision: 1 },
        { ref: { aggregateType: 'Session', projectId: PROJECT, sessionId: sessionRef.sessionId },
          revision: card.value.record.revision },
      ] } }));
    const run = claimed['runRef'] as RunRef;
    runBindings.set(run.runId, roleBinding);
    return run;
  }

  async function claimRun(suffix: string, taskId = 't1', role: S4ARole = 'executor'): Promise<RunRef> {
    const { sessionRef } = await createSession(suffix, role);
    return claimInSession(suffix, sessionRef, taskId, role);
  }

  return {
    kind, platform, notes: platform.notes, root, scope, projectRef, workspaceRef, goalRef, planRef, plan,
    roleBinding: executorBinding, budget, ctx: hostCtx, workCtx, queryCtx,
    createSession,
    claimRun,
    claimInSession,
    async write(callCtx, draft, goalId, opts = {}) {
      return platform.notes.writeNote(callCtx, { commandId: opts.commandId ?? `s4a-${suffixCounter++}`,
        note: draft, expectedPointerRevision: opts.expectedPointerRevision ?? null, goalId });
    },
    async close() {
      await platform.close();
      rmSync(directory, { recursive: true, force: true });
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}
