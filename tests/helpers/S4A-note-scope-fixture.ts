/**
 * Slice 4A group G scope fixture (N-20, N-21, N-22, N-10 scope cases, the L7
 * per-scope count).
 *
 * What it builds and through which public calls:
 *   - one real `createTargetPlatform` (memory or SQLite) over a real temporary
 *     workspace with Host workspace bindings (real workspace-tool reads and a
 *     real text capture for the missing-file candidates);
 *   - the project/workspace and a `test` completion policy through
 *     `projects.createProject`, `projects.registerWorkspace`,
 *     `completionPolicies.installCompletionPolicy`/`activateCompletionPolicy`;
 *   - an active architecture catalog with explicit `containment.parentOf`
 *     (`R` ⊃ `A`, `R` ⊃ `B`, `A` ⊃ `A1`) through
 *     `architecture.adoptInitialArchitecture`; `containment:false` omits the
 *     field (the no-containment branch);
 *   - Goal `g1` (plan `s1`; tasks `t1`/`t4`/`t5`/`t6` assigned to
 *     `platform-scribe`, `t2` cancelled and `t3` active assigned to
 *     `platform-executor`, gate `g1`) and Goal `g2` (task `t9`) through
 *     `goals.createGoal`, `plans.proposePlan`, `plans.applyPlanChange`;
 *   - real Sessions through `sessions.admitSessionCreation`/`recordSessionCreated`
 *     whose role is the exact platform legacy template (`platform-scribe` /
 *     `platform-executor`), so the PRODUCTION `createSessionDutyResolver` (the
 *     default; this fixture never injects `sessionDutyResolver`) maps duty from
 *     the Session's own role facts. Scribe scope therefore exercises production
 *     resolution, not a Run-keyed test double;
 *   - real Runs through `claims.claimTask`, and open responsible `SessionWorkLink`s
 *     to module targets through `sessions.linkSessionWork`.
 * Nothing reads the record store to answer an assertion; tests only use
 * `platform.notes` and the public Session/claim writes.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import type { RunRef, RoleBindingRefV1, TaskBudgetV1 } from '../../src/contracts/dispatch.js';
import type { GoalRef, WorkspaceRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { NoteReadPort, NoteScopeReadPort, NoteWritePort, WriteNoteResult } from '../../src/core/work-graph/model/note-contracts.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';

export type S4ANoteScopeFixtureKind = 'memory' | 'sqlite';
export type S4ARole = 'scribe' | 'executor';

let suffixCounter = 0;

export const S4A_SCOPE_AT = '2026-10-15T00:00:00.000Z';
const PROJECT = 's4a-scope-project';
const WORKSPACE = 's4a-scope-workspace';

export type ScribeHandle = { sessionRef: SessionRef; roleBinding: RoleBindingRefV1; runRef: RunRef };

export type S4ANoteScopeFixture = {
  kind: S4ANoteScopeFixtureKind;
  platform: Awaited<ReturnType<typeof createTargetPlatform>>;
  notes: NoteWritePort & NoteReadPort & NoteScopeReadPort;
  root: string;
  scope: { projectId: string; workspaceId: string };
  projectRef: { aggregateType: 'Project'; projectId: string };
  workspaceRef: WorkspaceRef;
  goalRef: GoalRef;
  goal2Ref: GoalRef;
  planRef: PlanRevisionRef;
  plan: PlanRevisionSnapshot;
  scribes: { s0: ScribeHandle; sa: ScribeHandle; sa1: ScribeHandle; sa1b: ScribeHandle; executor: ScribeHandle; executor2: ScribeHandle };
  ctx(): CoreCallContext;
  workCtx(runRef: RunRef): CoreCallContext;
  linkModule(handle: ScribeHandle, moduleId: string, active: boolean): Promise<void>;
  review(handle: ScribeHandle, noteId: string, verdict: 'review' | 'accept' | 'reject', expectedVersion?: number, commandId?: string):
    Promise<unknown>;
  write(ctx: CoreCallContext, draft: NoteDraftV1, goalId: string | null,
    options?: { commandId?: string; expectedPointerRevision?: number | null }): Promise<WriteNoteResult>;
  close(): Promise<void>;
};

function roleRef(role: S4ARole): RoleConfigurationRef {
  return role === 'scribe'
    ? { kind: 'legacy_template', templateId: 'platform-scribe', templateRevision: 's3.1' }
    : { kind: 'legacy_template', templateId: 'platform-executor', templateRevision: 's3.1' };
}
function bindingFor(role: S4ARole, id: string): RoleBindingRefV1 {
  return { schemaVersion: 1, bindingId: `s4a-scope-${id}-binding`, templateId: role === 'scribe' ? 'platform-scribe' : 'platform-executor',
    templateRevision: 's3.1', bindingVersion: 1, policyRevision: 'legacy-template' };
}

export async function createS4ANoteScopeFixture(kind: S4ANoteScopeFixtureKind,
  options: { containment?: boolean; skipProjectScribe?: boolean } = {}): Promise<S4ANoteScopeFixture> {
  const withContainment = options.containment ?? true;
  // Item 10a: when `skipProjectScribe` is set, S0 is made the region scribe of
  // the unused module M1 instead of the project scribe, so NO Session holds the
  // project scope (SA/SA1 keep their real A/A1 responsible links).
  const skipProjectScribe = options.skipProjectScribe ?? false;
  const directory = await mkdtemp(join(tmpdir(), `s4a-scope-${kind}-`));
  const root = join(directory, 'workspace');
  await mkdir(join(root, 'src/a/one'), { recursive: true });
  await mkdir(join(root, 'src/b'), { recursive: true });
  await mkdir(join(root, 'tests'), { recursive: true });
  await writeFile(join(root, 'src/a/x.ts'), 'export const a = 1;\n');
  await writeFile(join(root, 'src/a/one/x.ts'), 'export const one = 1;\n');
  await writeFile(join(root, 'src/b/y.ts'), 'export const b = 1;\n');
  await writeFile(join(root, 'tests/old.ts'), 'export const old = 1;\n');

  const scope = { projectId: PROJECT, workspaceId: WORKSPACE };
  const projectRef = { aggregateType: 'Project' as const, projectId: PROJECT };
  const workspaceRef: WorkspaceRef = { aggregateType: 'Workspace', projectId: PROJECT, workspaceId: WORKSPACE };
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: PROJECT, goalId: 's4a-goal' };
  const goal2Ref: GoalRef = { aggregateType: 'Goal', projectId: PROJECT, goalId: 's4a-goal-2' };
  const planRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: PROJECT, planId: 's4a-scope-plan' };
  const plan2Ref: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: PROJECT, planId: 's4a-scope-plan-2' };
  const budget: TaskBudgetV1 = { tokenBudget: 100000, deadline: null };

  let clock = 0;
  const now = () => new Date(Date.parse(S4A_SCOPE_AT) + (++clock) * 1000).toISOString();
  const hostActor = { kind: 'human' as const, id: 's4a-scope-operator' };
  const bindings: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      return requested.projectId === PROJECT && requested.workspaceId === WORKSPACE
        ? { status: 'ready', value: { root, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered' };
    },
    async authorize() {
      return { status: 'ready', value: { subjectKey: 's4a-scope-host', permissionRevision: 's4a-scope-grant-1', allowsRead: () => true } };
    },
  };
  const platform = await createTargetPlatform({
    storage: kind === 'memory' ? { kind: 'memory' } : { kind: 'sqlite', directory: join(directory, 'storage') },
    workspace: bindings,
    now,
    kernelStores: { entries: [{ adapterId: 's4a-kernel', storeKey: 's4a-kernel-store', workspace: scope,
      databasePath: join(directory, 'kernel.sqlite') }] },
    // No `sessionDutyResolver`: the production resolver reads the Session role.
  });

  const hostCtx = (): CoreCallContext => ({ projectId: PROJECT, workspaceId: WORKSPACE,
    principal: { kind: 'host', actor: hostActor },
    materialReader: { kind: 'host', projectId: PROJECT, workspaceId: WORKSPACE, actor: hostActor },
    signal: new AbortController().signal });
  const workCtx = (runRef: RunRef): CoreCallContext => ({ projectId: PROJECT, workspaceId: WORKSPACE,
    principal: { kind: 'work_run', runRef, roleBinding: bindingFor('executor', 'ctx') },
    materialReader: { kind: 'run', requester: runRef }, signal: new AbortController().signal });

  const committed = async (label: string, result: { status: string }): Promise<Record<string, unknown>> => {
    if (result.status !== 'committed') throw new Error(`S4A scope fixture ${label} failed: ${JSON.stringify(result)}`);
    return (result as unknown as { value: Record<string, unknown> }).value;
  };
  const ctx = hostCtx();
  await committed('project', await platform.projects.createProject(ctx, { meta: { requestId: 's4a-scope-project', expected: [{ ref: projectRef, revision: 0 }] },
    input: { projectId: PROJECT } }));
  await committed('workspace', await platform.projects.registerWorkspace(ctx, { meta: { requestId: 's4a-scope-workspace',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: scope } }));
  const installed = await committed('policy-install', await platform.completionPolicies.installCompletionPolicy(ctx, {
    meta: { requestId: 's4a-scope-policy-install', expected: [{ ref: projectRef, revision: 1 },
      { ref: { aggregateType: 'CompletionPolicyRevision', projectId: PROJECT, policyId: 's4a-scope-policy', revision: 1 }, revision: 0 }] },
    input: { policyId: 's4a-scope-policy', contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 } } }));
  await committed('policy-activate', await platform.completionPolicies.activateCompletionPolicy(ctx, {
    meta: { requestId: 's4a-scope-policy-activate', expected: [{ ref: projectRef, revision: 1 },
      { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId: PROJECT }, revision: 0 }] },
    input: { target: { ref: installed['ref'] as never, digest: installed['contentDigest'] as string } } }));

  const modules = [
    { ref: { projectId: PROJECT, moduleId: 'R' }, name: 'Root Module', responsibility: 'root', paths: ['.'], interfaces: [] },
    { ref: { projectId: PROJECT, moduleId: 'A' }, name: 'Area A', responsibility: 'area A', paths: ['src/a'],
      interfaces: [{ id: 'I1', description: 'A interface', paths: ['src/a'] }] },
    { ref: { projectId: PROJECT, moduleId: 'A1' }, name: 'Area A1', responsibility: 'area A1', paths: ['src/a/one'], interfaces: [] },
    { ref: { projectId: PROJECT, moduleId: 'B' }, name: 'Area B', responsibility: 'area B', paths: ['src/b'], interfaces: [] },
    ...Array.from({ length: 6 }, (_, index) => ({ ref: { projectId: PROJECT, moduleId: `M${String(index + 1)}` },
      name: `Module ${String(index + 1)}`, responsibility: `module ${String(index + 1)}`, paths: [`src/m${String(index + 1)}`], interfaces: [] })),
  ];
  const containment = { parentOf: [
    { parent: { projectId: PROJECT, moduleId: 'R' }, child: { projectId: PROJECT, moduleId: 'A' } },
    { parent: { projectId: PROJECT, moduleId: 'R' }, child: { projectId: PROJECT, moduleId: 'B' } },
    { parent: { projectId: PROJECT, moduleId: 'A' }, child: { projectId: PROJECT, moduleId: 'A1' } },
  ] };
  await committed('architecture', await platform.architecture.adoptInitialArchitecture(ctx, {
    meta: { requestId: 's4a-scope-architecture', expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
    input: { baselineId: 's4a-scope-baseline', description: 'S4A scope anchors', constraints: [], catalog: {
      requireDag: true, dependencies: [], modules,
      ...(withContainment ? { containment } : {}),
    } } }));

  await committed('goal', await platform.goals.createGoal(ctx, { meta: { requestId: 's4a-scope-goal',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
    input: { goalId: goalRef.goalId, workspace: scope, objective: 'S4A scope goal' } }));
  const scribeAssignment = (taskId: string) => ({ taskId, role: 'platform-scribe', instruction: `Scribe ${taskId}` });
  const executorAssignment = (taskId: string) => ({ taskId, role: 'platform-executor', instruction: `Execute ${taskId}` });
  const draft: PlanRevisionDraft = { schemaVersion: 1, planId: planRef.planId, planRevision: 1, goalId: goalRef.goalId,
    stages: [{ stageId: 's1', title: 'Stage one' }],
    tasks: [
      { taskId: 't1', stageId: 's1', title: 'Scribe one', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 't2', stageId: 's1', title: 'Cancelled work', requirementLevel: 'required', taskKind: 'work', disposition: 'cancelled', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 't3', stageId: 's1', title: 'Executor work', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 't4', stageId: 's1', title: 'Scribe four', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 't5', stageId: 's1', title: 'Scribe five', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 't6', stageId: 's1', title: 'Scribe six', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'g1', title: 'Gate', requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [scribeAssignment('t1'), executorAssignment('t2'), executorAssignment('t3'),
      scribeAssignment('t4'), scribeAssignment('t5'), scribeAssignment('t6')],
    obligations: [{ obligationId: 'o1', title: 'Deliver', requirementLevel: 'required', taskIds: ['t1', 't2', 't3', 't4', 't5', 't6', 'g1'],
      verificationRequirements: [{ requirementId: 'v1', requirementLevel: 'required', kind: 'test', description: 'Tests pass' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
  const proposed = await committed('plan-propose', await platform.plans.proposePlan(ctx, {
    meta: { requestId: 's4a-scope-plan-propose', expected: [{ ref: goalRef, revision: 1 }] },
    input: { goalRef, basedOn: null, draft, reason: { text: 'S4A scope plan', sources: [] } } }));
  const applied = await committed('plan-apply', await platform.plans.applyPlanChange(ctx, {
    meta: { requestId: 's4a-scope-plan-apply', expected: [{ ref: goalRef, revision: 1 }] },
    input: { proposalRef: proposed['ref'] as never, expectedProposalRevision: proposed['revision'] as number, decisionRefs: [] } }));
  const plan = applied as unknown as PlanRevisionSnapshot;

  await committed('goal2', await platform.goals.createGoal(ctx, { meta: { requestId: 's4a-scope-goal2',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
    input: { goalId: goal2Ref.goalId, workspace: scope, objective: 'S4A scope goal two' } }));
  const draft2: PlanRevisionDraft = { schemaVersion: 1, planId: plan2Ref.planId, planRevision: 1, goalId: goal2Ref.goalId,
    stages: [{ stageId: 's2', title: 'Stage two' }],
    tasks: [
      { taskId: 't9', stageId: 's2', title: 'Other goal work', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 't10', stageId: 's2', title: 'Other goal scribe', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'g2', title: 'Gate two', requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [executorAssignment('t9'), scribeAssignment('t10')],
    obligations: [{ obligationId: 'o2', title: 'Deliver two', requirementLevel: 'required', taskIds: ['t9', 't10', 'g2'],
      verificationRequirements: [{ requirementId: 'v2', requirementLevel: 'required', kind: 'test', description: 'Tests pass' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
  const proposed2 = await committed('plan2-propose', await platform.plans.proposePlan(ctx, {
    meta: { requestId: 's4a-scope-plan2-propose', expected: [{ ref: goal2Ref, revision: 1 }] },
    input: { goalRef: goal2Ref, basedOn: null, draft: draft2, reason: { text: 'S4A scope plan two', sources: [] } } }));
  await committed('plan2-apply', await platform.plans.applyPlanChange(ctx, {
    meta: { requestId: 's4a-scope-plan2-apply', expected: [{ ref: goal2Ref, revision: 1 }] },
    input: { proposalRef: proposed2['ref'] as never, expectedProposalRevision: proposed2['revision'] as number, decisionRefs: [] } }));

  let sessionSeq = 0;
  async function createSession(requestId: string, role: S4ARole): Promise<{ sessionRef: SessionRef }> {
    const admitted = await committed(`admit-${requestId}`, await platform.sessions.admitSessionCreation(ctx, {
      meta: { requestId: `s4a-scope-admit-${requestId}`, expected: [] },
      input: { workspace: scope, kernelStore: { adapterId: 's4a-kernel', storeKey: 's4a-kernel-store' },
        role: roleRef(role), recommendedRefs: [], initialLinks: [] } }));
    const action = admitted['action'] as { plannedSessionRef: SessionRef };
    const admittedRef = admitted['ref'] as { projectId: string; sessionId: string };
    const kernelSessionId = `s4a-scope-kernel-session-${requestId}-${++sessionSeq}`;
    await platform.kernelStores.withStore('s4a-kernel', store => store.create({
      sessionId: kernelSessionId, recordId: `s4a-scope-kernel-record-${requestId}`, createdAt: now(),
    }, { signal: ctx.signal }));
    const registered = await committed(`record-${requestId}`, await platform.sessions.recordSessionCreated(ctx, {
      meta: { requestId: `s4a-scope-record-${requestId}`, expected: [] },
      input: { operationRef: admittedRef as never, sessionRef: action.plannedSessionRef, adapterId: 's4a-kernel',
        kernelSessionId, historyCursor: null, observedAt: now() } }));
    const registeredRef = registered['ref'] as SessionRef & { aggregateType?: string };
    return { sessionRef: { projectId: registeredRef.projectId, sessionId: registeredRef.sessionId } };
  }

  async function claim(suffix: string, sessionRef: SessionRef, claimGoalRef: GoalRef, claimPlanRef: PlanRevisionRef,
    taskId: string, role: S4ARole): Promise<RunRef> {
    const goalRead = await platform.plans.queryGoal(ctx, claimGoalRef);
    if (goalRead.status !== 'ready') throw new Error(`S4A scope fixture goal read failed for ${suffix}`);
    const card = await platform.sessions.readSession(ctx, sessionRef);
    if (card.status !== 'ready') throw new Error(`S4A scope fixture session read failed for ${suffix}`);
    const claimed = await committed(`claim-${suffix}`, await platform.claims.claimTask(ctx, {
      input: { goalRef: claimGoalRef, planRef: claimPlanRef, taskId, sessionRef, roleBinding: bindingFor(role, suffix), budget },
      meta: { requestId: `s4a-scope-claim-${suffix}`, expected: [
        { ref: claimGoalRef, revision: goalRead.value.goal.revision },
        { ref: workspaceRef, revision: 1 },
        { ref: { ...sessionRef, aggregateType: 'Session' as const }, revision: card.value.record.revision },
      ] } }));
    return claimed['runRef'] as RunRef;
  }

  const s0Session = await createSession('s0', 'scribe');
  const saSession = await createSession('sa', 'scribe');
  const sa1Session = await createSession('sa1', 'scribe');
  const sa1bSession = await createSession('sa1b', 'scribe');
  const exSession = await createSession('ex', 'executor');
  const ex2Session = await createSession('ex2', 'executor');
  // Item 15a: S0 is the project scribe and its Run must live in goal 1 (t1 is
  // already assigned `platform-scribe`), so its cross-goal anchor write really
  // crosses goals instead of staying in its own.
  const s0: ScribeHandle = { ...s0Session, roleBinding: bindingFor('scribe', 's0'), runRef: await claim('s0', s0Session.sessionRef, goalRef, planRef, 't1', 'scribe') };
  const sa: ScribeHandle = { ...saSession, roleBinding: bindingFor('scribe', 'sa'), runRef: await claim('sa', saSession.sessionRef, goalRef, planRef, 't4', 'scribe') };
  const sa1: ScribeHandle = { ...sa1Session, roleBinding: bindingFor('scribe', 'sa1'), runRef: await claim('sa1', sa1Session.sessionRef, goalRef, planRef, 't5', 'scribe') };
  const sa1b: ScribeHandle = { ...sa1bSession, roleBinding: bindingFor('scribe', 'sa1b'), runRef: await claim('sa1b', sa1bSession.sessionRef, goalRef, planRef, 't6', 'scribe') };
  const executor: ScribeHandle = { ...exSession, roleBinding: bindingFor('executor', 'ex'), runRef: await claim('ex', exSession.sessionRef, goalRef, planRef, 't3', 'executor') };
  const executor2: ScribeHandle = { ...ex2Session, roleBinding: bindingFor('executor', 'ex2'), runRef: await claim('ex2', ex2Session.sessionRef, goal2Ref, plan2Ref, 't9', 'executor') };

  async function linkModule(handle: ScribeHandle, moduleId: string, active: boolean): Promise<void> {
    const card = await platform.sessions.readSession(ctx, handle.sessionRef);
    if (card.status !== 'ready') throw new Error('S4A scope fixture link session read failed');
    const target = { kind: 'module' as const, ref: { projectId: PROJECT, moduleId } };
    const linkRef = { ...handle.sessionRef, aggregateType: 'SessionWorkLink' as const, target, relation: 'responsible' as const };
    const existing = card.value.links.find(link => link.ref.relation === 'responsible' && link.ref.target.kind === 'module'
      && link.ref.target.ref.moduleId === moduleId);
    const expected = [{ ref: { ...handle.sessionRef, aggregateType: 'Session' as const }, revision: card.value.record.revision },
      { ref: linkRef, revision: active ? (existing?.revision ?? 0) : (existing?.revision ?? 0) }];
    const result = await platform.sessions.linkSessionWork(ctx, { input: { sessionRef: handle.sessionRef, target, relation: 'responsible', active },
      meta: { requestId: `s4a-scope-link-${handle.sessionRef.sessionId}-${moduleId}-${String(active)}`, expected } });
    if (result.status !== 'committed') throw new Error(`S4A scope fixture linkModule failed: ${JSON.stringify(result)}`);
  }

  // The standard scope fixture: SA1 and SA are region scribes; S0 is project.
  // Item 10a: with `skipProjectScribe`, S0 and the unlinked handover successor
  // SA1b become region scribes of the unused modules M1/M2, so the project scope
  // has no scribe.
  await linkModule(sa1, 'A1', true);
  await linkModule(sa, 'A', true);
  if (skipProjectScribe) {
    await linkModule(s0, 'M1', true);
    await linkModule(sa1b, 'M2', true);
  }

  return {
    kind, platform, notes: platform.notes as NoteWritePort & NoteReadPort & NoteScopeReadPort, root, scope,
    projectRef, workspaceRef, goalRef, goal2Ref, planRef, plan,
    scribes: { s0, sa, sa1, sa1b, executor, executor2 },
    ctx: hostCtx, workCtx,
    linkModule,
    async review(handle, noteId, verdict, expectedVersion = 1, commandId) {
      return platform.notes.reviewNote(workCtx(handle.runRef), { commandId: commandId ?? `s4a-scope-review-${suffixCounter++}`,
        noteId, expectedVersion, expectedPointerRevision: null, verdict, reason: null });
    },
    async write(callCtx, draftNote, goalId, opts = {}) {
      return platform.notes.writeNote(callCtx, { commandId: opts.commandId ?? `s4a-scope-${suffixCounter++}`,
        note: draftNote, expectedPointerRevision: opts.expectedPointerRevision ?? null, goalId });
    },
    async close() {
      await platform.close();
      rmSync(directory, { recursive: true, force: true });
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}
