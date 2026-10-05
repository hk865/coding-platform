/**
 * A.2 step 5.4: the requeue owner (`createTaskRequeueService`) over the real
 * RecordStore, Run/claim/entry writers and delegated-write admission
 * (docs/refactor/STATE-MACHINES-SPEC.md §4 TASK-03, TASK-16, TASK-28, 4.3
 * "处理步骤", 4.6; §13.2, §13.3; decisions D-3, TD-6, C1, C8, ND-9).
 *
 * The Runs are produced by the formal claim → authorize → begin → entered →
 * result writers of the B2 execution fixture (the Kernel binding is the
 * fixture's explicit test binding; no model is called). Only the Host-side
 * callbacks are test doubles: the workspace root, the digest-only source
 * capture (counted, so a policy refusal is shown to capture nothing) and the
 * Host configuration recheck of the delegated-write admission.
 *
 * - TD-6: an entered Agent of the same Goal with the `requeue_task` grant
 *   requeues a failed Task (requestedBy agent, counted); another Goal, an
 *   agent budget or a refused Host recheck write nothing.
 * - G-BUDGET (TASK-28) and the TASK-03 budget pin.
 * - G-CAP, and a requeue racing a refusal on one afterRun: exactly one commit,
 *   the loser `revision_conflict` naming the winner.
 * - ND-9: a session message of another workspace is `forbidden` before any read.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RunRef, RunSnapshot, RuntimeEventV1, TaskBudgetV1 } from '../../src/contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import {
  WORKFLOW_AUTOMATION_ACTOR, type TaskAutomationPolicyV1, type TaskRequeueOutcomeV1,
} from '../../src/contracts/task-requeue.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createMaterialAccessResolver } from '../../src/core/work-graph/materials/applicability.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import type { RequeueTaskInput } from '../../src/core/work-graph/tasks/claim-contracts.js';
import { taskRequeueRefKey, taskReworkRefusalRefKey } from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import type { GraphWrite } from '../../src/core/work-graph/tasks/contracts.js';
import type { AuthorizeConfiguration, KernelExecutionBinding } from '../../src/core/work-graph/tasks/execution-entry-contracts.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createTaskRequeueService, type TaskRequeueDependencies } from '../../src/core/work-graph/tasks/requeue-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import {
  B2_AT, B2_HOST, createB2ExecutionFixture, synchronizeB2Commits, type B2Admitted, type B2ExecutionFixture, type B2Records,
} from '../helpers/B2-execution-fixture.js';
import type { ClaimFixtureKind } from '../helpers/task-claim-fixture.js';

const GRANT = { ...B2_HOST.permissions, tools: ['read', 'requeue_task'] };
const SOURCE_DIGEST = 'a'.repeat(64);
const key = (ref: object) => canonicalJson(ref as JsonValue);

type Requeue = (ctx: CoreCallContext, request: GraphWrite<RequeueTaskInput>) => Promise<WriteResult<TaskRequeueOutcomeV1>>;
type Opened = {
  b2: B2ExecutionFixture;
  records: B2Records;
  host: { enabled: boolean };
  captures: string[];
  messageReads: number;
  /** A requeue owner over `records` (the shared ledger unless a race wraps it). */
  service(options?: { records?: B2Records; policy?: TaskAutomationPolicyV1 }): Requeue;
  /** Enter a fresh claim of `taskId`/`goal` in `sessionRef` with `permissions`, under a distinct Kernel identity. */
  enterAgent(claim: TaskClaim, permissions: typeof GRANT, kernelRunId: string): Promise<void>;
  /** End Run A (implement-a) with this terminal event. */
  endRunA(admitted: B2Admitted, event: Pick<RuntimeEventV1, 'eventType' | 'payload'>): Promise<RunSnapshot>;
  hostCtx(actor?: { kind: 'human' | 'system'; id: string }): CoreCallContext;
  workCtx(claim: TaskClaim, run: RunSnapshot): CoreCallContext;
  request(requestId: string, extra?: Partial<RequeueTaskInput>): Promise<GraphWrite<RequeueTaskInput>>;
  read(refKey: string): Promise<{ revision: number } | null>;
};

const opened: Opened[] = [];
afterEach(async () => {
  for (const fixture of opened.splice(0)) await fixture.b2.close();
});

async function open(kind: ClaimFixtureKind): Promise<Opened> {
  const b2 = await createB2ExecutionFixture(kind);
  const base = b2.base;
  const records = base.records;
  let seq = 0;
  const now = () => B2_AT;
  const eventId = () => `a2-requeue-event-${++seq}`;
  const reads = createRunStateReader({ records });
  const roles = createRoleConfigurationService({ records, now, eventId });
  const host = { enabled: true };
  // The Host's current grant for the exact pinned configuration: the fixture's tools, or those plus `requeue_task`.
  const authorizeConfiguration: AuthorizeConfiguration = async (ctx, input) => {
    if (!host.enabled || ctx.projectId !== base.scope.projectId || ctx.workspaceId !== base.scope.workspaceId
      || input.configurationRevision !== B2_HOST.configurationRevision
      || ![B2_HOST.permissions, GRANT].some((permissions) => key(permissions) === key(input.permissions))
      || key({ template: input.hostTemplate }) !== key({ template: B2_HOST.hostTemplate })) {
      return { status: 'rejected', code: 'forbidden', reason: 'the test Host does not authorize this configuration' };
    }
    return { status: 'ready', value: { configurationRevision: B2_HOST.configurationRevision,
      permissions: structuredClone(input.permissions), hostTemplate: structuredClone(B2_HOST.hostTemplate) } };
  };
  const materialReads = createMaterialRecordReaders(records);
  const materials = createMaterialService({ bodies: b2.bodies, authority: materialReads.authority,
    grants: createMaterialAccessResolver(materialReads.authority, materialReads.index), now });
  const entry = createExecutionEntryService({ records, reads, roles, bodies: b2.bodies, materials,
    plans: base.plans, authorizeConfiguration, now, eventId, newId: () => `a2-requeue-entry-${++seq}` });
  const fixture: Opened = {
    b2, records, host, captures: [], messageReads: 0,
    service(options = {}) {
      const deps: TaskRequeueDependencies = {
        records: options.records ?? records, reads,
        workspaceHost: { async resolveRoot(workspace) {
          return workspace.workspaceId === base.scope.workspaceId
            ? { status: 'ready', value: { root: base.directory, workspaceRevision: 1 } }
            : { status: 'rejected', code: 'not_found', reason: 'not a registered workspace' };
        } },
        source: { async captureDigest(root) { fixture.captures.push(root); return { status: 'ready', sourceDigest: SOURCE_DIGEST }; } },
        materials,
        messages: { async readMessage() { fixture.messageReads += 1; return { status: 'not_found' }; } },
        delegatedWrites: { reads, roles, bodies: b2.bodies, authorizeConfiguration },
        ...(options.policy === undefined ? {} : { automationPolicy: () => options.policy! }),
        now, eventId,
      };
      const service = createTaskRequeueService(deps);
      return (ctx, request) => service.requeueTask(ctx, request);
    },
    async enterAgent(claim, permissions, kernelRunId) {
      const prepared = await b2.buildPrepared({ claim, permissions });
      const facts = await b2.read(claim);
      const kernel: KernelExecutionBinding = { adapterId: facts.session.kernel.adapterId,
        kernelSessionId: facts.session.kernel.kernelSessionId, runId: kernelRunId, turnId: `${kernelRunId}-turn` };
      const pin = async () => b2.pin(claim);
      const authorized = await entry.authorizeRuntimeEntry(base.ctx, { input: { prepared, consumerId: `consumer-${kernelRunId}` },
        meta: { requestId: `${kernelRunId}-authorize`, expected: [await pin()] } });
      if (authorized.status !== 'committed') throw new Error(`agent authorize failed: ${JSON.stringify(authorized)}`);
      const begun = await entry.beginRuntimeEntry(base.ctx, { input: { permit: authorized.value, kernel },
        meta: { requestId: `${kernelRunId}-begin`, expected: [await pin()] } });
      if (begun.status !== 'committed') throw new Error(`agent begin failed: ${JSON.stringify(begun)}`);
      const entered = await entry.recordExecutionEntered(base.ctx, {
        input: { permit: { ...authorized.value, authorizationRevision: begun.value.authorization.revision },
          enteredAt: B2_AT, kernelSource: { ...kernel, position: 3 },
          history: { kernel, startPosition: 2, observedThroughPosition: 3, endPosition: null } },
        meta: { requestId: `${kernelRunId}-entered`, expected: [await pin()] } });
      if (entered.status !== 'committed') throw new Error(`agent entered failed: ${JSON.stringify(entered)}`);
    },
    async endRunA(admitted, event) {
      const observation = { ...b2.terminalObservation(admitted), event: b2.terminalEvent(event) };
      const ended = await b2.entry.recordRunResult(base.ctx, { input: observation,
        meta: { requestId: 'a2-requeue-run-a-end', expected: [await b2.runPin()] } });
      if (ended.status !== 'committed') throw new Error(`Run A end failed: ${JSON.stringify(ended)}`);
      return ended.value;
    },
    hostCtx(actor = base.ctx.principal.kind === 'host' ? base.ctx.principal.actor : { kind: 'human', id: 'unreachable' }) {
      return { projectId: base.scope.projectId, workspaceId: base.scope.workspaceId, principal: { kind: 'host', actor },
        materialReader: { kind: 'host', projectId: base.scope.projectId, workspaceId: base.scope.workspaceId, actor },
        signal: new AbortController().signal };
    },
    workCtx(claim, run) {
      return { projectId: base.scope.projectId, workspaceId: claim.workspaceId,
        principal: { kind: 'work_run', runRef: claim.runRef, roleBinding: run.roleBinding },
        materialReader: { kind: 'run', requester: claim.runRef }, signal: new AbortController().signal };
    },
    async request(requestId, extra = {}) {
      return { meta: { requestId, expected: [await base.goalPin(), await b2.runPin()] },
        input: { taskRef: base.tasks.first, afterRunRef: b2.claim.runRef, reason: 'retry the failed work', ...extra } };
    },
    async read(refKey) {
      const read = await records.readMany([refKey]);
      if (read.status !== 'ready') throw new Error(`record read failed: ${JSON.stringify(read)}`);
      const record = read.value.records.find((candidate) => candidate.refKey === refKey);
      return record === undefined ? null : { revision: record.revision };
    },
  };
  opened.push(fixture);
  return fixture;
}

const CRASHED = { eventType: 'run_crashed', payload: { kind: 'crashed', error: 'the build tool exited 2' } } as const;
const EXHAUSTED = { eventType: 'run_budget_exhausted', payload: { kind: 'budget_exhausted', exhaustedAt: B2_AT } } as const;

function requeueKeyOf(f: Opened): string {
  const runRef: RunRef = f.b2.claim.runRef;
  return taskRequeueRefKey({ aggregateType: 'TaskRequeue', projectId: runRef.projectId, goalId: runRef.goalId,
    taskId: f.b2.claim.task.taskId, afterRunId: runRef.runId });
}
function refusalRefOf(f: Opened) {
  const runRef = f.b2.claim.runRef;
  return { aggregateType: 'TaskReworkRefusal' as const, projectId: runRef.projectId, goalId: runRef.goalId,
    taskId: f.b2.claim.task.taskId, operation: 'requeue' as const, subjectId: runRef.runId };
}

describe.each(['memory', 'sqlite'] as const)('the requeue owner (%s)', (kind) => {
  it('TD-6: an entered Agent of the same Goal with the requeue_task grant requeues a failed Task; '
    + 'another Goal, an agent budget or a refused Host recheck write nothing', async () => {
    const f = await open(kind);
    const base = f.b2.base;
    await f.endRunA(await f.b2.enter(), CRASHED);
    // Run B: the same Goal's implement-b in the second Session, entered under the requeue_task grant.
    const claimedB = await base.service.claimTask(base.ctx, await base.buildRequest({
      input: { taskId: base.tasks.second.taskId, sessionRef: base.sessions.second } }));
    if (claimedB.status !== 'committed') throw new Error(`claim B failed: ${JSON.stringify(claimedB)}`);
    const claimB = claimedB.value;
    await f.enterAgent(claimB, GRANT, 'a2-agent-b');
    // Run C: the second Goal's Run, entered under the same grant.
    await f.enterAgent(f.b2.secondClaim, GRANT, 'a2-agent-c');
    const runB = (await f.b2.read(claimB)).run;
    const runC = (await f.b2.read(f.b2.secondClaim)).run;
    expect(runB).toMatchObject({ status: 'running', envelope: { permissions: GRANT } });
    const requeue = f.service();
    const nothingWritten = async () => {
      expect(await f.read(requeueKeyOf(f))).toBeNull();
      expect(await f.read(taskReworkRefusalRefKey(refusalRefOf(f)))).toBeNull();
      expect(f.captures).toEqual([]);
    };

    // TD-6: an Agent never pins a budget (§4.3 matrix).
    expect(await requeue(f.workCtx(claimB, runB), await f.request('agent-budget',
      { budget: { tokenBudget: 200000, deadline: null } }))).toMatchObject({ status: 'rejected', code: 'invalid' });
    // An Agent reworks only Tasks of its own Goal.
    expect(await requeue(f.workCtx(f.b2.secondClaim, runC), await f.request('agent-other-goal')))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    // The current Host recheck of the delegated write refuses: nothing is written.
    f.host.enabled = false;
    expect(await requeue(f.workCtx(claimB, runB), await f.request('agent-host-refused')))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    f.host.enabled = true;
    await nothingWritten();

    const committed = await requeue(f.workCtx(claimB, runB), await f.request('agent-requeue'));
    if (committed.status !== 'committed' || committed.value.kind !== 'requeued') throw new Error(JSON.stringify(committed));
    expect(committed.value.requeue).toMatchObject({ revision: 1, failureClass: 'run_failed', afterOutcome: 'crashed',
      requestedBy: { kind: 'agent', runRef: claimB.runRef }, budget: null, basisComparison: 'compared',
      automation: { automatic: true, counted: true, autoCount: 1, cap: 3 },
      agentProvenance: { runRef: claimB.runRef, sessionRef: claimB.sessionRef },
      historySource: { throughPosition: 4 } });
    expect(f.captures).toEqual([base.directory]);
    expect(await f.read(requeueKeyOf(f))).toEqual({ revision: 1 });
    // The same request replays the committed value.
    expect(await requeue(f.workCtx(claimB, runB), await f.request('agent-requeue')))
      .toMatchObject({ status: 'committed', replayed: true, value: committed.value });
  }, 60_000);

  it('G-BUDGET and the TASK-03 budget pin: a budget_exhausted Run is refused without a capture, '
    + 'requeued with a larger budget, and claimed only with that budget', async () => {
    const f = await open(kind);
    const base = f.b2.base;
    await f.endRunA(await f.b2.enter(), EXHAUSTED);
    const requeue = f.service();
    const operator = f.hostCtx();

    const refused = await requeue(operator, await f.request('budget-none'));
    expect(refused).toMatchObject({ status: 'committed', replayed: false,
      value: { kind: 'refused', refusal: { code: 'budget_not_increased', revision: 1, failureClass: 'run_failed' } } });
    // A budget that is not larger is refused again (@2), still without a capture.
    expect(await requeue(operator, await f.request('budget-same', { budget: { ...base.budget } }))).toMatchObject({
      status: 'committed', value: { kind: 'refused', refusal: { code: 'budget_not_increased', revision: 2 } } });
    expect(f.captures).toEqual([]);

    const pinned: TaskBudgetV1 = { tokenBudget: base.budget.tokenBudget * 2, deadline: null };
    const requeued = await requeue(operator, await f.request('budget-larger', { budget: pinned }));
    if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') throw new Error(JSON.stringify(requeued));
    expect(requeued.value.requeue).toMatchObject({ budget: pinned, failureClass: 'run_failed', afterOutcome: 'budget_exhausted' });
    expect(f.captures).toEqual([base.directory]);

    // TASK-03: the claim with this requeueRef must carry exactly the pinned budget.
    const requeueRef = requeued.value.requeue.ref;
    const claimWith = async (requestId: string, budget: TaskBudgetV1) => {
      const request = await base.buildRequest({ requestId, input: { budget } });
      return base.service.claimTask(base.ctx, { ...request, input: { ...request.input, requeueRef } });
    };
    expect(await claimWith('claim-binding-budget', base.budget)).toMatchObject({ status: 'rejected', code: 'invalid',
      reason: 'the requeue pins the claim budget' });
    const claimed = await claimWith('claim-pinned-budget', pinned);
    if (claimed.status !== 'committed') throw new Error(`the pinned claim failed: ${JSON.stringify(claimed)}`);
    const run = (await f.b2.read(claimed.value)).run;
    expect(run).toMatchObject({ requeueRef, budget: pinned, status: 'starting' });
  }, 60_000);

  it('G-CAP and the commit race: an automatic requeue over the cap is a refusal without a capture; '
    + 'a requeue racing a refusal on one afterRun commits exactly once', async () => {
    const f = await open(kind);
    await f.endRunA(await f.b2.enter(), CRASHED);
    const capZero: TaskAutomationPolicyV1 = { schemaVersion: 1, autoReworkLimit: 0, resumeOnStartup: false };
    const automation = f.hostCtx({ ...WORKFLOW_AUTOMATION_ACTOR });
    const refused = await f.service({ policy: capZero })(automation, await f.request('cap-1'));
    expect(refused).toMatchObject({ status: 'committed',
      value: { kind: 'refused', refusal: { code: 'auto_rework_cap_reached', revision: 1, requestedBy: WORKFLOW_AUTOMATION_ACTOR } } });
    expect(f.captures).toEqual([]);

    // Both writers read the same window and reach the store together (a real commit race).
    const race = synchronizeB2Commits(f.records);
    const raced = f.service({ records: race.records, policy: capZero });
    const [human, system] = await Promise.all([
      raced(f.hostCtx(), await f.request('race-human')),
      raced(automation, await f.request('race-system')),
    ]);
    expect(race.arrivals()).toBe(2);
    const results = [human, system];
    expect(results.filter((result) => result.status === 'committed')).toHaveLength(1);
    const loser = results.find((result) => result.status !== 'committed');
    if (human.status === 'committed') {
      expect(human.value.kind).toBe('requeued');
      expect(await f.read(requeueKeyOf(f))).toEqual({ revision: 1 });
      expect(await f.read(taskReworkRefusalRefKey(refusalRefOf(f)))).toEqual({ revision: 1 });
      // §13.3: the losing refusal names the TaskRequeue@1 that won.
      expect(loser).toMatchObject({ status: 'rejected', code: 'revision_conflict',
        current: [{ ref: { aggregateType: 'TaskRequeue', afterRunId: f.b2.claim.runRef.runId }, revision: 1 }] });
    } else {
      expect(system).toMatchObject({ status: 'committed', value: { kind: 'refused', refusal: { revision: 2 } } });
      expect(await f.read(requeueKeyOf(f))).toBeNull();
      expect(loser).toMatchObject({ status: 'rejected', code: 'revision_conflict',
        current: [{ ref: refusalRefOf(f), revision: 2 }] });
    }
  }, 60_000);

  it('ND-9: a session message of another project or workspace is forbidden before any read; nothing is written', async () => {
    const f = await open(kind);
    await f.endRunA(await f.b2.enter(), CRASHED);
    const base = f.b2.base;
    const foreign = (projectId: string, workspaceId: string) => ({ kind: 'session_message' as const,
      ref: { aggregateType: 'SessionMessage' as const, projectId, workspaceId, messageId: 'answered-elsewhere' } });
    const requeue = f.service();
    expect(await requeue(f.hostCtx(), await f.request('foreign-workspace',
      { newInputRefs: [foreign(base.scope.projectId, 'another-workspace')] })))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await requeue(f.hostCtx(), await f.request('foreign-project',
      { newInputRefs: [foreign('another-project', base.scope.workspaceId)] })))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(f.messageReads).toBe(0);
    // An in-scope message is read through the mailbox owner (here: not found → invalid, ND-9).
    expect(await requeue(f.hostCtx(), await f.request('local-missing',
      { newInputRefs: [foreign(base.scope.projectId, base.scope.workspaceId)] })))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(f.messageReads).toBe(1);
    expect(f.captures).toEqual([]);
    expect(await f.read(requeueKeyOf(f))).toBeNull();
  }, 60_000);
});
