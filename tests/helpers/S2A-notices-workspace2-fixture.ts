/**
 * Slice 2A QE3 QA-12 (M6): a SECOND workspace world.
 *
 * `openS5DecisionFixture`/`openManyTaskWorld` hardcode workspace `W` in every
 * call context, in the session/claim/entry/end stack and in their
 * `authorizeConfiguration`, so they cannot populate `W2`. This helper builds the
 * parallel world for `W2` over the SAME real fixture store:
 *   - `W2` and its static CompletionPolicy are laid down with the SAME raw
 *     `f.seedCommit` scope/governance checkpoint `openManyTaskWorld` uses (the
 *     S5 fixture does not register the bootstrap events, so the public
 *     `registerWorkspace`/`installCompletionPolicy` path cannot commit);
 *   - the Goal, Plan, Session, claim, execution entry, ended Run and system
 *     requeue all go through the real public services, using a `W2` call
 *     context and a `W2`-accepting Host `authorizeConfiguration`.
 * Nothing here seeds Goal/Plan/rework records directly.
 */
import { join } from 'node:path';
import { artifactBodyDigest } from '../../src/contracts/artifact.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef, VersionPin, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { PreparedTaskExecution, PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RoleBindingRefV1, RunSnapshot, RuntimeEventV1, TaskBudgetV1 } from '../../src/contracts/dispatch.js';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import type { CompletionPolicyRevisionSnapshot, ProjectCompletionPolicyActiveSnapshot } from '../../src/contracts/governance.js';
import { completionPolicyContentDigest } from '../../src/contracts/governance.js';
import type { GoalRef, GoalSnapshot, WorkspaceRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import { DEFAULT_TASK_AUTOMATION_POLICY, WORKFLOW_AUTOMATION_ACTOR, type TaskRequeueSnapshotV1 } from '../../src/contracts/task-requeue.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import type { RoleSpecResolutionV1 } from '../../src/contracts/role-spec-materials.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { SESSION_MAILBOX_TOOL_NAMES, USER_DECISION_TOOL_NAMES } from '../../src/core/agent-runtime/communication-tools.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import type { ClaimTaskInput } from '../../src/core/work-graph/model/claim-contracts.js';
import type {
  AuthorizeConfiguration, ExecutionEntryPort, KernelExecutionBinding, TaskEntryPermit,
} from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import { decodeGoalSnapshot, decodeWorkspaceSnapshot, encodeWorkspaceSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { createExecutionEntryService, MANIFEST_CONTENT_TYPE } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { PROJECT, PROJECT_ID, T, type S5DecisionFixture } from './S5-decision-fixture.js';
import { committed, key, materialsFor, mailboxDependencies, pin, storedRecord } from './S5-queue-support.js';

export const W2_WORKSPACE_ID = 'W2';
export const W2_SCOPE: WorkspaceScope = { projectId: PROJECT_ID, workspaceId: W2_WORKSPACE_ID };
export const W2_WORKSPACE: WorkspaceRef = { aggregateType: 'Workspace', projectId: PROJECT_ID, workspaceId: W2_WORKSPACE_ID };

/** The `W2` call context: same trusted Host principal, W2 project/workspace scope. */
export function w2Context(f: S5DecisionFixture): CoreCallContext {
  const reader = f.ctx.materialReader;
  return { ...f.ctx, workspaceId: W2_WORKSPACE_ID,
    materialReader: reader.kind === 'host' ? { ...reader, workspaceId: W2_WORKSPACE_ID } : reader };
}

/** Host-automation context for a W2 Goal (the W2 counterpart of `automationContext`). */
function W2AutomationContext(f: S5DecisionFixture): CoreCallContext {
  return { ...w2Context(f), principal: { kind: 'host', actor: WORKFLOW_AUTOMATION_ACTOR },
    materialReader: { kind: 'host', ...W2_SCOPE, actor: WORKFLOW_AUTOMATION_ACTOR } };
}

export type W2World = {
  goalRef: GoalRef;
  plan: { ref: PlanRevisionRef };
  requeueOnce(taskId: string): Promise<TaskRequeueSnapshotV1>;
  goals: ReturnType<typeof createGoalService>['tasks'];
};

/**
 * One real W2 Goal -> Plan -> Session -> claim -> enter -> crash -> system
 * requeue world, built entirely through public services over `f.records`.
 */
export async function openW2World(f: S5DecisionFixture, taskIds: readonly string[],
  options: { goalId?: string; planId?: string; optionalTaskIds?: readonly string[] } = {}): Promise<W2World> {
  const ctx = w2Context(f);
  const goalId = options.goalId ?? 'S2A-W2';
  const planId = options.planId ?? 'PS2A-W2';
  const optionalTaskIds = options.optionalTaskIds ?? [];

  // ---- W2 scope + static policy: the same allowed raw `f.seedCommit`
  // governance checkpoint `openManyTaskWorld`/`noticeWork` use. The S5 decision
  // fixture registers the Workspace/governance codecs but NOT
  // `PROJECT_BOOTSTRAP_RECORD_SCHEMAS`, so the public
  // `registerWorkspace`/`installCompletionPolicy`/`activateCompletionPolicy`
  // events cannot commit over `f.records` (they are rejected as unregistered
  // schemas). Only the scope/policy checkpoint is seeded here; the Goal, Plan,
  // Session, claim, entry, Run end and system requeue all go through the real
  // public services below.
  const workspaceRevision = 1;
  const policyId = `s2a-w2-static-${goalId}`;
  const policy: CompletionPolicyRevisionSnapshot = { ref: { aggregateType: 'CompletionPolicyRevision', projectId: PROJECT_ID,
    policyId, revision: 1 }, revision: 1, schemaVersion: 1, policyId, contentRevision: 1,
    content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 }, contentDigest: '' };
  policy.contentDigest = completionPolicyContentDigest(policy);
  const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: PROJECT_ID };
  const previous = await storedRecord(f.records, activeRef);
  const active: ProjectCompletionPolicyActiveSnapshot = { ref: activeRef, projectId: PROJECT_ID,
    revision: previous.revision + 1, activeRevision: policy.ref };
  const seeded = await f.seedCommit([
    encodeWorkspaceSnapshot({ ref: W2_WORKSPACE, revision: workspaceRevision }),
    ...[policy, active].map((snapshot) => ({ refKey: key(snapshot.ref),
      schemaId: `${snapshot.ref.aggregateType}Snapshot@1`, revision: snapshot.revision, json: JSON.stringify(snapshot) })),
  ], { guards: [{ refKey: key(activeRef), expectedRevision: previous.revision }] });
  if (seeded.status !== 'committed') throw new Error(`the W2 governance seed failed: ${JSON.stringify(seeded)}`);

  // ---- real W2 Goal + Plan -------------------------------------------------
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: PROJECT_ID, goalId };
  const goals = createGoalService({ records: f.records, now: f.now, eventId: f.newId }).tasks;
  const goal = committed(await goals.createGoal(ctx, { input: { goalId, workspace: W2_SCOPE,
    objective: 'Slice 2A W2 rework world' },
    meta: { requestId: `s2a-w2-goal-${goalId}`, expected: [{ ref: PROJECT, revision: 1 },
      { ref: W2_WORKSPACE, revision: workspaceRevision }] } }));

  const draft: PlanRevisionDraft = { schemaVersion: 2, planId, planRevision: 1, goalId, stages: [],
    tasks: [...taskIds.map((taskId) => ({ taskId, title: `S2A W2 ${taskId}`, taskKind: 'work' as const,
      requirementLevel: 'required' as const, disposition: 'active' as const, phase: 'pending' as const, scope: { kind: 'goal' as const } })),
      ...optionalTaskIds.map((taskId) => ({ taskId, title: `S2A W2 ${taskId}`, taskKind: 'work' as const,
        requirementLevel: 'optional' as const, disposition: 'active' as const, phase: 'pending' as const, scope: { kind: 'goal' as const } })),
      { taskId: 'w2-gate', title: 'S2A W2 gate', taskKind: 'gate' as const, requirementLevel: 'required' as const,
        disposition: 'active' as const, phase: 'pending' as const, scope: { kind: 'goal' as const } }],
    assignments: [...taskIds, ...optionalTaskIds].map((taskId) => ({ taskId, role: 'builder', instruction: `Perform ${taskId}` })),
    obligations: [{ obligationId: 's2a-w2-obligation', title: 'Static acceptance', requirementLevel: 'required',
      taskIds: [...taskIds, ...optionalTaskIds, 'w2-gate'], verificationRequirements: [{ requirementId: 's2a-w2-check', kind: 'static',
        requirementLevel: 'required', description: 'Registered check' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [] };
  const plans = createPlanService({ records: f.records, now: f.now, eventId: f.newId });
  const proposal = committed(await plans.proposePlan(ctx, { input: { goalRef, basedOn: null, draft,
    reason: { text: 'Slice 2A W2 rework world', sources: [] } },
    meta: { requestId: `s2a-w2-propose-${goalId}`, expected: [{ ref: goalRef, revision: goal.revision }] } }));
  const applied = await plans.applyPlanChange(ctx, { input: { proposalRef: proposal.ref,
    expectedProposalRevision: proposal.revision, decisionRefs: [] },
    meta: { requestId: `s2a-w2-adopt-${goalId}`, expected: [{ ref: goalRef, revision: goal.revision }] } });
  if (applied.status !== 'committed') throw new Error(`the W2 plan adoption failed: ${JSON.stringify(applied)}`);
  const plan = applied.value;

  // ---- real W2 Session/claim/entry/end stack -------------------------------
  const reads = createRunStateReader({ records: f.records });
  const sessionRole: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };
  const roleBinding: RoleBindingRefV1 = { schemaVersion: 1, bindingId: 's2a-w2-binding', templateId: 'builder',
    templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
  const budget: TaskBudgetV1 = { tokenBudget: 100000, deadline: null };
  const host = {
    configurationRevision: 's5-host-config-1',
    permissions: { policyRevision: 'legacy-template',
      tools: ['read', ...SESSION_MAILBOX_TOOL_NAMES, ...USER_DECISION_TOOL_NAMES] as string[], writeScope: [] as string[] },
    hostTemplate: { templateId: 'builder', revision: '1', digest: artifactBodyDigest('s5 trusted builder template') },
  };
  const roles = createRoleConfigurationService({ records: f.records, now: f.now, eventId: f.newId });
  const sessionsPort = createSessionDirectory({ records: f.records, lookups: f.records });
  const kernelStores = await createKernelStoreRegistry({ entries: [{ adapterId: 's5-kernel', storeKey: 's5-kernel-store',
    workspace: W2_SCOPE, databasePath: join(f.base.directory, 's5-kernel.sqlite') }] });

  const createSession = async (requestId: string, role: RoleConfigurationRef = sessionRole): Promise<SessionRef> => {
    const admitted = await sessionsPort.admitSessionCreation(ctx, { meta: { requestId: `admit-${requestId}`, expected: [] },
      input: { workspace: W2_SCOPE, kernelStore: { adapterId: 's5-kernel', storeKey: 's5-kernel-store' }, role,
        recommendedRefs: [], initialLinks: [] } });
    if (admitted.status !== 'committed') throw new Error(`W2 session admission failed: ${JSON.stringify(admitted)}`);
    const kernelSessionId = `s5-w2-kernel-session-${requestId}`;
    await kernelStores.withStore('s5-kernel', (store) => store.create(
      { sessionId: kernelSessionId, recordId: `s5-w2-kernel-record-${requestId}`, createdAt: T }, { signal: ctx.signal }));
    const registered = await sessionsPort.recordSessionCreated(ctx, { meta: { requestId: `register-${requestId}`, expected: [] },
      input: { operationRef: admitted.value.ref, sessionRef: admitted.value.action.plannedSessionRef,
        adapterId: 's5-kernel', kernelSessionId, historyCursor: null, observedAt: T } });
    if (registered.status !== 'committed') throw new Error(`W2 session registration failed: ${JSON.stringify(registered)}`);
    return { projectId: registered.value.ref.projectId, sessionId: registered.value.ref.sessionId };
  };

  const readGoal = async (ref: GoalRef): Promise<GoalSnapshot> => {
    const decoded = decodeGoalSnapshot(await storedRecord(f.records, ref));
    if (decoded.status !== 'decoded') throw new Error(`W2 Goal decode failed: ${decoded.reason}`);
    return decoded.value;
  };
  const readExecution = async (claim: TaskClaim) => {
    const read = await reads.readExecution(ctx, claim.runRef);
    if (read.status !== 'ready') throw new Error(`W2 run read failed: ${JSON.stringify(read)}`);
    return read.value;
  };
  const claimService = createTaskClaimService({ records: f.records, roles, now: f.now, newId: f.newId });
  const claimRun = async (input: { requestId: string; goalRef: GoalRef; planRef: PlanRevisionRef; taskId: string;
    sessionRef: SessionRef }): Promise<TaskClaim> => {
    const currentGoal = await readGoal(input.goalRef);
    const card = await sessionsPort.readSession(ctx, input.sessionRef);
    if (card.status !== 'ready') throw new Error(`W2 claim session read failed: ${JSON.stringify(card)}`);
    const request: GraphWrite<ClaimTaskInput> = { input: { goalRef: input.goalRef, planRef: input.planRef,
      taskId: input.taskId, sessionRef: input.sessionRef, roleBinding, budget },
      meta: { requestId: input.requestId, expected: [
        { ref: input.goalRef, revision: currentGoal.revision },
        { ref: W2_WORKSPACE, revision: workspaceRevision },
        { ref: plainSessionRefToAggregate(input.sessionRef), revision: card.value.record.revision } ] } };
    const claimed = await claimService.claimTask(ctx, request);
    if (claimed.status !== 'committed') throw new Error(`W2 claim failed: ${JSON.stringify(claimed)}`);
    return claimed.value;
  };

  const runPin = async (claim: TaskClaim): Promise<VersionPin> =>
    ({ ref: claim.runRef, revision: (await readExecution(claim)).run.revision });

  const buildPrepared = async (claim: TaskClaim): Promise<{ prepared: PreparedTaskExecution; permit: TaskEntryPermit }> => {
    const target = await readExecution(claim);
    const input = 'S2A W2 prepared manifest input';
    const inputDigest = artifactBodyDigest(input);
    const permissions = structuredClone(host.permissions);
    const roleFacts = await roles.resolveRoleBindingFacts(ctx, { roleBinding: target.run.roleBinding, declaredPermissions: permissions });
    if (roleFacts.result.status !== 'ready') throw new Error(`W2 role facts failed: ${JSON.stringify(roleFacts)}`);
    const role: RoleSpecResolutionV1 = roleFacts.result.value;
    const workspaceSnapshot = { workspaceId: claim.workspaceId, revision: workspaceRevision };
    const manifest: PreparedTaskManifestV1 = { schemaVersion: 1, kind: 'task_execution', claim, role,
      hostTemplate: structuredClone(host.hostTemplate), roleBinding: target.run.roleBinding,
      hostConfigurationRevision: host.configurationRevision, sessionRole: target.session.role, workspaceSnapshot, permissions,
      budget: target.run.budget, selectedTaskInputs: [], materialBasis: null, materialAccessRefs: [], additionalMaterialRefs: [],
      deliveryRefs: [], sourceRefs: [], input, inputDigest };
    const manifestJson = JSON.stringify(manifest);
    const stored = await f.bodies.put({ body: manifestJson, contentType: MANIFEST_CONTENT_TYPE,
      sourceRefs: [{ kind: 'workspace', refId: claim.workspaceId, revision: String(workspaceSnapshot.revision) }],
      origin: { kind: 'run', owner: claim.runRef }, requestedAt: T });
    if (stored.status !== 'ready') throw new Error(`W2 manifest store failed: ${JSON.stringify(stored)}`);
    const envelope: TaskEnvelopeV1 = { schemaVersion: 1, envelopeId: 's5-w2-envelope-1', projectId: claim.task.projectId,
      workspaceId: claim.workspaceId, goalId: claim.task.goalId, taskId: claim.task.taskId, runRef: claim.runRef,
      attemptRef: claim.attemptRef, planRef: claim.planRef, roleBinding: target.run.roleBinding, workspaceSnapshot, permissions,
      budget: target.run.budget, sourceRefs: [], bundleRef: stored.value.ref };
    const inputBinding: PreparedTaskExecution['inputBinding'] = { schemaVersion: 1, inputDigest,
      manifestDigest: artifactBodyDigest(manifestJson), materialAccessRefs: [], additionalMaterialRefs: [], deliveryRefs: [] };
    const permit: TaskEntryPermit = { claim, consumerId: 's5-w2-runtime', entryGeneration: 1, authorizationRevision: 1, inputDigest };
    return { prepared: { kind: 'task', claim, envelope, inputBinding }, permit };
  };

  const authorizeConfiguration: AuthorizeConfiguration = async (callCtx, input) => {
    if (callCtx.projectId !== PROJECT_ID || callCtx.workspaceId !== W2_WORKSPACE_ID
      || input.configurationRevision !== host.configurationRevision
      || canonicalJson(input.sessionRole) !== canonicalJson(sessionRole)) {
      return { status: 'rejected', code: 'forbidden', reason: 'the W2 Host binding does not authorize this configuration' };
    }
    return { status: 'ready', value: { configurationRevision: host.configurationRevision,
      permissions: structuredClone(input.permissions), hostTemplate: structuredClone(input.hostTemplate) } };
  };
  const entry: ExecutionEntryPort = createExecutionEntryService({ records: f.records, reads, roles,
    bodies: { read: (ref) => f.bodies.read(ref) }, authorizeConfiguration, now: f.now, eventId: f.newId, newId: f.newId });

  const enterClaim = async (claim: TaskClaim): Promise<RunSnapshot> => {
    const target = await readExecution(claim);
    const kernel: KernelExecutionBinding = { adapterId: target.session.kernel.adapterId,
      kernelSessionId: target.session.kernel.kernelSessionId, runId: 's5-w2-kernel-run', turnId: 's5-w2-kernel-turn' };
    const { prepared, permit } = await buildPrepared(claim);
    const authorized = await entry.authorizeRuntimeEntry(ctx, { input: { prepared, consumerId: permit.consumerId },
      meta: { requestId: `s5-w2-authorize-${claim.task.taskId}`, expected: [await runPin(claim)] } });
    if (authorized.status !== 'committed') throw new Error(`W2 authorize failed: ${JSON.stringify(authorized)}`);
    const begun = await entry.beginRuntimeEntry(ctx, { input: { permit: authorized.value, kernel },
      meta: { requestId: `s5-w2-begin-${claim.task.taskId}`, expected: [await runPin(claim)] } });
    if (begun.status !== 'committed') throw new Error(`W2 begin failed: ${JSON.stringify(begun)}`);
    const entered = await entry.recordExecutionEntered(ctx, { input: {
      permit: { ...authorized.value, authorizationRevision: begun.value.authorization.revision },
      enteredAt: T, kernelSource: { ...kernel, position: 3 },
      history: { kernel, startPosition: 2, observedThroughPosition: 3, endPosition: null } },
      meta: { requestId: `s5-w2-entered-${claim.task.taskId}`, expected: [await runPin(claim)] } });
    if (entered.status !== 'committed') throw new Error(`W2 entered failed: ${JSON.stringify(entered)}`);
    return entered.value;
  };

  const endRun = async (claim: TaskClaim, terminal: Pick<RuntimeEventV1, 'eventType' | 'payload'>) => {
    const current = await readExecution(claim);
    const authorization = current.run.executionAuthorization;
    const history = current.run.executionHistory;
    if (authorization === undefined || !('schemaVersion' in authorization) || authorization.schemaVersion !== 2
      || authorization.phase !== 'entered' || history === undefined || history === null) throw new Error('W2 Run must be entered');
    const resultWriter = createExecutionEntryService({ records: f.records, reads, roles, bodies: f.bodies,
      authorizeConfiguration: async () => ({ status: 'rejected' as const, code: 'forbidden' as const, reason: 'result-only setup' }),
      now: f.now, eventId: f.newId, newId: f.newId });
    const position = history.observedThroughPosition + 1;
    const source = { ...history.kernel, position };
    return committed(await resultWriter.recordRunResult(ctx, { input: { claim,
      entry: { consumerId: authorization.consumerId, entryGeneration: authorization.generation },
      event: { schemaVersion: 1, eventId: f.newId(), runRef: claim.runRef,
        sequence: current.run.lastEventSeq + 1, occurredAt: T, ...terminal },
      kernelSource: source, completedHistoryBoundary: { source, cursor: `s5-w2-end-${claim.runRef.runId}` },
      history: { ...history, observedThroughPosition: position, endPosition: position } },
      meta: { requestId: f.newId(), expected: [{ ref: claim.runRef, revision: current.run.revision }] } }));
  };

  // ---- real system requeue over W2 ----------------------------------------
  const materials = materialsFor(f);
  const mailbox = createSessionMailbox(mailboxDependencies(f));
  const source = { revision: 1 };
  const workspaceHost = {
    async resolveRoot(workspace: WorkspaceRef) {
      const decoded = decodeWorkspaceSnapshot(await storedRecord(f.records, workspace));
      if (decoded.status !== 'decoded') throw new Error(decoded.reason);
      return { status: 'ready' as const, value: { root: f.base.directory, workspaceRevision: decoded.value.revision } };
    },
  };
  const requeues = createTaskRequeueService({ records: f.records, reads, materials, messages: mailbox, workspaceHost,
    source: { async captureDigest() { return { status: 'ready' as const,
      sourceDigest: sha256Hex(`s2a-w2-source-${source.revision}`) }; } },
    delegatedWrites: { reads, roles, bodies: f.bodies,
      authorizeConfiguration: async () => ({ status: 'rejected' as const, code: 'forbidden' as const,
        reason: 'no agent writes in this fixture' }) },
    automationPolicy: () => DEFAULT_TASK_AUTOMATION_POLICY, now: f.now, eventId: f.newId });

  const requeueOnce = async (taskId: string): Promise<TaskRequeueSnapshotV1> => {
    const sessionRef = await createSession(`s2a-w2-rework-${goalId}-${taskId}`);
    const claim = await claimRun({ requestId: f.newId(), goalRef, planRef: plan.ref, taskId, sessionRef });
    await enterClaim(claim);
    const ended = await endRun(claim, { eventType: 'run_crashed',
      payload: { kind: 'crashed', error: 'recorded slice-2A W2 rework failure' } });
    source.revision += 1;
    const value = committed(await requeues.requeueTask(W2AutomationContext(f), { input: { taskRef: claim.task,
      afterRunRef: claim.runRef, reason: 'Retry the failed slice-2A W2 work' },
      meta: { requestId: f.newId(), expected: [await pin(f.records, goalRef), { ref: claim.runRef, revision: ended.revision }] } }));
    if (value.kind !== 'requeued') throw new Error(`the W2 automatic requeue was refused: ${JSON.stringify(value)}`);
    return value.requeue;
  };

  return { goalRef, plan, requeueOnce, goals };
}
