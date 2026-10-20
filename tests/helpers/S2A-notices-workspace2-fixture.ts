/**
 * Slice 2A QE3 QA-12 (M6): the SECOND workspace's public claim/entry stack.
 *
 * The Goal/Plan/requeue world itself is `openManyTaskWorld`
 * (`S2A-notices-support.ts`); this file keeps only the W2 call context and the
 * W2 Session/claim/entry/end steps. `W2` and its static CompletionPolicy are
 * registered by the shared factory through the public bootstrap owner.
 */
import { join } from 'node:path';
import { artifactBodyDigest } from '../../src/contracts/artifact.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef, VersionPin, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RoleBindingRefV1, RunSnapshot, TaskBudgetV1 } from '../../src/contracts/dispatch.js';
import type { GoalRef, GoalSnapshot, WorkspaceRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { SESSION_MAILBOX_TOOL_NAMES, USER_DECISION_TOOL_NAMES } from '../../src/core/agent-runtime/communication-tools.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import type { ClaimTaskInput } from '../../src/core/work-graph/model/claim-contracts.js';
import type {
  AuthorizeConfiguration, ExecutionEntryPort, KernelExecutionBinding, TaskEntryPermit,
} from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import { decodeGoalSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { PROJECT_ID, T, type S5DecisionFixture } from './S5-decision-fixture.js';
import { openManyTaskWorld, type ManyTaskWorldClaimStack } from './S2A-notices-support.js';
import { preparationHost, prepareTaskForReal } from './task-claim-fixture.js';
import { committed, storedRecord } from './S5-queue-support.js';

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

export type W2World = Awaited<ReturnType<typeof openManyTaskWorld>>;

/** The W2 public Session/claim/entry/end stack the shared world drives. */
export async function w2ClaimStack(f: S5DecisionFixture): Promise<ManyTaskWorldClaimStack> {
  const ctx = w2Context(f);
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
  const claimService = createTaskClaimService({ records: f.records, roles, now: f.now, newId: f.newId });
  const reads = createRunStateReader({ records: f.records });
  const kernelStores = await createKernelStoreRegistry({ entries: [{ adapterId: 's5-kernel', storeKey: 's5-kernel-store',
    workspace: W2_SCOPE, databasePath: join(f.base.directory, 's5-kernel.sqlite') }] });

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
  const runPin = async (claim: TaskClaim): Promise<VersionPin> =>
    ({ ref: claim.runRef, revision: (await readExecution(claim)).run.revision });

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

  const createSession = async (goalId: string, taskId: string): Promise<SessionRef> => {
    const requestId = `s2a-w2-rework-${goalId}-${taskId}`;
    const admitted = await sessionsPort.admitSessionCreation(ctx, { meta: { requestId: `admit-${requestId}`, expected: [] },
      input: { workspace: W2_SCOPE, kernelStore: { adapterId: 's5-kernel', storeKey: 's5-kernel-store' }, role: sessionRole,
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

  const claim = async (input: { requestId: string; goalRef: GoalRef; planRef: PlanRevisionRef; taskId: string;
    sessionRef: SessionRef }): Promise<TaskClaim> => {
    const currentGoal = await readGoal(input.goalRef);
    const card = await sessionsPort.readSession(ctx, input.sessionRef);
    if (card.status !== 'ready') throw new Error(`W2 claim session read failed: ${JSON.stringify(card)}`);
    const workspaceRevision = (await storedRecord(f.records, W2_WORKSPACE)).revision;
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

  const enter = async (claim: TaskClaim): Promise<RunSnapshot> => {
    const target = await readExecution(claim);
    const kernel: KernelExecutionBinding = { adapterId: target.session.kernel.adapterId,
      kernelSessionId: target.session.kernel.kernelSessionId, runId: 's5-w2-kernel-run', turnId: 's5-w2-kernel-turn' };
    const real = await prepareTaskForReal(f, {
      bodies: f.bodies, runRef: claim.runRef, now: f.now, ctx,
      requestId: `s5-w2-prepare-${claim.runRef.runId}`,
      host: preparationHost({ configurationRevision: host.configurationRevision, permissions: host.permissions,
        hostTemplate: host.hostTemplate }),
    });
    const permit: TaskEntryPermit = { claim, consumerId: 's5-w2-runtime', entryGeneration: 1, authorizationRevision: 1,
      inputDigest: real.prepared.inputBinding.inputDigest };
    const authorized = await entry.authorizeRuntimeEntry(ctx, { input: { prepared: real.prepared, consumerId: permit.consumerId },
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

  const end = async (claim: TaskClaim): Promise<RunSnapshot> => {
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
        sequence: current.run.lastEventSeq + 1, occurredAt: T,
        eventType: 'run_crashed', payload: { kind: 'crashed', error: 'recorded slice-2A W2 rework failure' } },
      kernelSource: source, completedHistoryBoundary: { source, cursor: `s5-w2-end-${claim.runRef.runId}` },
      history: { ...history, observedThroughPosition: position, endPosition: position } },
      meta: { requestId: f.newId(), expected: [{ ref: claim.runRef, revision: current.run.revision }] } }));
  };

  return { createSession, claim, enter, end, automationContext: () => W2AutomationContext(f) };
}

/**
 * One real W2 Goal -> Plan -> Session -> claim -> enter -> crash -> system
 * requeue world through the shared factory, with the W2 claim stack.
 */
export async function openW2World(f: S5DecisionFixture, taskIds: readonly string[],
  options: { goalId?: string; planId?: string; optionalTaskIds?: readonly string[] } = {}): Promise<W2World> {
  return openManyTaskWorld(f, taskIds, { ...options, goalId: options.goalId ?? 'S2A-W2',
    planId: options.planId ?? 'PS2A-W2', scope: W2_SCOPE, ctx: w2Context(f), claim: await w2ClaimStack(f) });
}
