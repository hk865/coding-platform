/**
 * 动作请求的 owner（设计 3.1–3.4、3.10；lead 裁定 1、3、4）：问答轮的派活、叫停请求，你的批准和拒绝，请求方或你的
 * 撤回，目标循环的作废，和叫停放行之后的送停。
 *
 * 受理（`requestDispatch`、`requestStop`）经 `claim-holds.ts` 的问答轮准入，一次提交写请求和它在暂缓记录上的卡位：
 * 派活占 `openDispatch`；叫停「每步确认」占 `pendingStop`，自动档或规则命中当场放行（AR-01s：按放行判定写 `stop`
 * 原因的暂缓或如实作废）。命令指纹只含模型的输入。批准、拒只认记录上的原请求者和答卡回执，不重新准入；批准叫停在那次
 * 提交里重做放行判定（AR-02s）。叫停的读都按键（TaskLease 固定键、它指向的或冻结的 Run），不扫任务历史。送停交给
 * control owner（动作来源的 steer，指纹固定、只作 CAS），送前先读确定性意图（在就回它），再读原 Run：你动过或已结束
 * 就记“没送停”（AR-07），守确定性意图仍不存在。
 *
 * 每次写都是一条 `executeWriteCommand`，事件 `ActionRequestChanged`（变化 + 快照），重放按事件回原回执。
 */
import type { ActionRequestRef } from '../../../contracts/action-request.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { ControlIntentRef } from '../../../contracts/control-intent.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import { principalIdentity } from '../../../contracts/core/call-context.js';
import { rejected, rejectedWithNonEmptyCurrent } from '../../../contracts/core/rejections.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import { ActionRequestRefShape, SessionMessageRefShape, SessionRefShape } from '../../../contracts/data-format-refs.js';
import type { RunRef, RunSnapshot, TaskLeaseSnapshot, TaskTriple } from '../../../contracts/dispatch.js';
import { canonicalKey, sameJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import { isAutomationActor, WORKFLOW_AUTOMATION_ACTOR } from '../../../contracts/task-requeue.js';
import { truncateUtf8 } from '../../../contracts/utf8.js';
import { isRecord, nonEmpty, parseObject } from '../../../contracts/validation/common.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { DecodeResult, EncodedRecord, GoalRecordTransactionPort, RecordGuard } from '../../record-store/ports.js';
import type {
  ActionRequestAnswerV1, ActionRequestPort, ActionRequestRejectionV1, DeliverStopResultV1, DispatchRequestInputV1,
  DispatchRequestResultV1, StopRequestInputV1, StopRequestResultV1,
} from '../model/action-request-contracts.js';
import type { DispatchBasisFactsPort, DispatchBasisFactsV1 } from '../model/dispatch-basis-contracts.js';
import { dispatchBasisProblem } from '../model/message-payload.js';
import type { QueryRoundPort } from '../model/query-round-contracts.js';
import type { GraphWrite } from '../model/task-contracts.js';
import type { SessionDutyReadPort } from '../model/work-line-contracts.js';
import { commandKeys, executeWriteCommand, type Keys } from '../persistence/command-executor.js';
import { decodeControlIntentSnapshot } from '../persistence/control-record-codecs.js';
import { goalRefFor } from '../persistence/commit-compiler.js';
import { readOwnerRecord } from '../persistence/owner-record-read.js';
import { decodeRun } from '../persistence/run-record-codecs.js';
import {
  actionRequestSnapshotOf, approveDispatchRequest, awaitsStopDelivery, denyActionRequest, dispatchTaskProblem,
  newDispatchRequest, newStopRequest, recordStopNotSent, releaseStopRequest, stopReleaseOf, stopRunCheckOf, tableOutside,
  voidActionRequest, withdrawActionRequest,
  type ActionRequestChangeV1, type ActionRequestRequesterV1, type ActionRequestSnapshotV1, type ActionRequestV1,
  type DispatchBlockerV1, type PendingActionRequestV1, type StopFrozenV1, type StopReleaseV1, type StopRunFactsV1,
} from '../state/action-request.js';
import { taskLeaseNodeOf } from '../state/attempt-machine.js';
import { decisionActionPolicy } from '../state/decision-policy.js';
import { matchAutonomyRule } from '../state/autonomy-rules.js';
import {
  holdAwaitsCursor, nextTaskClaimHold, occupyHoldPointer, placeHoldReason, taskClaimHoldRefOf, yieldHoldPointer,
  type PendingTaskClaimHoldV1, type TaskClaimHoldV1,
} from '../state/task-claim-hold.js';
import { taskMachineStateOf } from '../state/task-machine.js';
import {
  actionRequestChangedCodec, actionRequestChangedEventFromEvent, actionRequestCodec, readActionRequestRecord,
  type ActionRequestChanged,
} from './action-request-codecs.js';
import type { AutonomyRulePort } from './autonomy-rule-service.js';
import {
  admitActionRound, blankTextProblem, isolateActionWrite, notReadyRejection, queryRoundActorOf, queryRoundRequesterOf,
  readTaskClaimHold, taskRefProblem, type ActionRoundAdmissionV1,
} from './claim-holds.js';
import { taskClaimHoldCodec } from './claim-record-codecs.js';
import { claimPhaseFacts } from './claim-service.js';
import type { RunControlPort } from './control-contracts.js';
import { controlIntentRefFor } from './control-service.js';
import { dispatchCurrentOf, sameBasis } from './dispatch-basis.js';
import { operatorProblem } from './execution-entry-service.js';
import { hostContextIn } from './plan-lineage.js';
import { readCanonicalTaskFacts, readGoal, taskRecordRefKey } from './plan-readers.js';

type HostActor = { kind: 'human' | 'system'; id: string };

export type ActionRequestDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  queryRounds: QueryRoundPort;
  duty: SessionDutyReadPort;
  /** 派活受理读三值的那一个读口（和发信、看图同一个实例）。 */
  dispatchBasis: DispatchBasisFactsPort;
  autonomyRules: Pick<AutonomyRulePort, 'read'>;
  /** 送停：control owner 的动作来源 steer。 */
  control: Pick<RunControlPort, 'submitControl'>;
  /** 配置的操作者（你撤回）。 */
  operatorActor?: HostActor;
  now: () => string;
  eventId: () => string;
};

/** 送停 steer 的理由上限，同 control owner 的理由字节上限。 */
const STEER_REASON_MAX_BYTES = 2048;

/** 一次请求写：下一版请求、读到的版本（新建是 `null`）、暂缓的读和写（`next` 为 `null` 只守不写）、别的守卫。 */
type RequestChange = {
  record: PendingActionRequestV1;
  before: number | null;
  hold: { current: TaskClaimHoldV1 | null; guard: RecordGuard; next: PendingTaskClaimHoldV1 | null } | null;
  guards: RecordGuard[];
  change: ActionRequestChangeV1;
  blockedBy?: DispatchBlockerV1[];
};
type Committed<T> = { status: 'committed'; value: T; replayed: boolean; cursor: CommitCursor };
/** 两个受理口从事件推出的回执（重放同样从事件推）；提交的 `replayed`、`cursor` 由执行器给。 */
type Uncommitted<T> = T extends unknown ? Omit<T, 'replayed' | 'cursor'> : never;
type DispatchProjection = Uncommitted<Extract<DispatchRequestResultV1, { status: 'requested' | 'needs_decision' }>>;
type StopProjection = Uncommitted<Extract<StopRequestResultV1, { status: 'released' | 'void' | 'needs_decision' }>>;

function invalid(reason: string): CoreRejection { return rejected('invalid', reason); }
function revisionGuard(ref: object, revision: number): RecordGuard { return { refKey: canonicalKey(ref), expectedRevision: revision }; }
function staleRevision(record: ActionRequestV1): CoreRejection {
  return rejectedWithNonEmptyCurrent('revision_conflict', 'the action request changed since that revision',
    [{ ref: record.ref, revision: record.revision }]);
}
function actionRefProblem(value: unknown): string | null {
  return checkShape(ActionRequestRefShape, value, 'stored') === null ? null : 'request must be a complete ActionRequestRef';
}
function automationActor(ctx: CoreCallContext): boolean {
  return ctx.principal.kind === 'host' && isAutomationActor(ctx.principal.actor);
}

export function createActionRequestService(deps: ActionRequestDependencies): ActionRequestPort {
  const records = deps.records;

  /** 请求的一次写：身份先定（新请求的号取这次命令的身份），读、判、写一次提交。 */
  async function writeActionRequest<Facts, Refusal, Result>(ctx: CoreCallContext, input: {
    operation: string; commandId: string; fingerprintInput: JsonValue;
    read(): Promise<{ status: 'ready'; facts: Facts } | CoreRejection>;
    change(facts: Facts, keys: Keys): RequestChange | { refuse: Refusal };
    project(event: ActionRequestChanged): Result;
  }): Promise<Committed<Result> | { status: 'refused'; refusal: Refusal } | CoreRejection> {
    const scope = { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null };
    const principal = principalIdentity(ctx.principal);
    const keys = commandKeys({ operation: input.operation, scope, principal, commandId: input.commandId,
      fingerprintInput: input.fingerprintInput });
    return executeWriteCommand<Facts, RequestChange, Refusal, ActionRequestChanged, Result>(records, {
      operation: input.operation, scope, principal, commandId: input.commandId, fingerprintInput: input.fingerprintInput,
      read: input.read,
      decide: (facts) => {
        const decided = input.change(facts, keys);
        return 'refuse' in decided ? decided : { decision: decided };
      },
      build: (change, committed) => {
        const requestKey = canonicalKey(change.record.ref);
        const written = [actionRequestCodec.encode(change.record)];
        const guards: RecordGuard[] = [...change.guards, { refKey: requestKey, expectedRevision: change.before }];
        const bindings: { refKey: string; field: 'since' | 'reasons[].since' }[] = [];
        if (change.record.since === null) bindings.push({ refKey: requestKey, field: 'since' });
        if (change.hold !== null) {
          guards.push(change.hold.guard);
          const next = change.hold.next;
          if (next !== null) {
            written.push(taskClaimHoldCodec.encode(next));
            if (holdAwaitsCursor(next)) bindings.push({ refKey: change.hold.guard.refKey, field: 'reasons[].since' });
          }
        }
        const event: ActionRequestChanged = {
          eventId: deps.eventId(), eventType: 'ActionRequestChanged', schemaVersion: 1, occurredAt: deps.now(),
          identityKey: committed.identityKey, fingerprint: committed.fingerprint, change: change.change,
          request: actionRequestSnapshotOf(change.record),
          ...(change.blockedBy === undefined ? {} : { blockedBy: change.blockedBy }),
        };
        return { guards, records: written, claims: [], events: [actionRequestChangedCodec.encode(event)],
          ...(bindings.length === 0 ? {} : { commitCursorBindings: bindings }) };
      },
      result: {
        eventType: 'ActionRequestChanged', schemaVersion: 1, decode: actionRequestChangedEventFromEvent,
        validate: (decoded, _receipt, committed) => decoded.identityKey === committed.identityKey
          && decoded.fingerprint === committed.fingerprint ? null : 'the action request change does not match the receipt',
        project: (decoded) => input.project(decoded),
      },
    });
  }

  /** 写口回执：提交的快照，拒绝照原样（含存储层的冲突）。 */
  function snapshotResult(
    result: Committed<ActionRequestSnapshotV1> | { status: 'refused'; refusal: CoreRejection } | CoreRejection,
  ): WriteResult<ActionRequestSnapshotV1> {
    return result.status === 'refused' ? result.refusal : result;
  }

  // ---- 读 -----------------------------------------------------------------

  /** 目标的自治档和项目的规则集：规则命中走第三层；不论命中与否，提交都守读到的规则集版本（没写过的守“仍不存在”）。 */
  async function readRules(ctx: CoreCallContext, projectId: string) {
    const view = await deps.autonomyRules.read(ctx, { projectRef: { projectId } });
    if (view.status !== 'ready') return notReadyRejection(view, 'the autonomy rules');
    const set = view.value.set;
    return { status: 'ready' as const, rules: view.value.rules, revision: set.revision,
      guard: { refKey: canonicalKey(set.ref), expectedRevision: set.revision === 0 ? null : set.revision } };
  }
  type Rules = Exclude<Awaited<ReturnType<typeof readRules>>, CoreRejection>;

  /** 放行五层（3.1）：人专属 → 已有待决卡（卡位占着时受理已拒） → 有效规则 → 出厂默认。 */
  function needsDecision(action: 'agent_dispatch' | 'agent_stop', goal: GoalSnapshot, rules: Rules,
    duty: 'secretary' | 'adviser'): boolean {
    const matchedRule = matchAutonomyRule({ action, tool: action === 'agent_dispatch' ? 'dispatch_task' : 'request_stop',
      objects: [{ kind: 'goal', goalRef: goal.ref }], rules: rules.rules, now: deps.now(), catalog: null, delegation: null,
      roleCeiling: null, createMemberAuthorized: false, duty, counts: { holders: 0, reservations: 0, open: 0 },
      newReservations: 0 });
    return decisionActionPolicy({ autonomy: goal.settings.autonomy, action, actorClass: 'agent', matchedRule,
      ruleSetRevision: rules.revision }) === 'needs_decision';
  }

  /** 按键读一条 Run（不扫任务历史）；不在也是读不到。 */
  async function readRunAt(ref: RunRef, what: string): Promise<{ status: 'ready'; run: RunSnapshot } | CoreRejection> {
    const read = await readOwnerRecord({ store: records, refKey: canonicalKey(ref), decode: storedRun,
      readError: (message) => rejected('unavailable', `${what} cannot be read: ${message}`) });
    if ('rejection' in read) return read.rejection;
    if ('notFound' in read) return rejected('unavailable', `${what} cannot be read`);
    return { status: 'ready', run: read.value };
  }

  /**
   * 叫停读法（契约 2.3）：目标、任务固定键上的 TaskLease（不存在是 `null`）、和一条 Run，都按键读，不扫任务历史。受理
   * 读租约指向的 Run（没有租约就不读），批准读冻结的原 Run。
   */
  async function readStopFacts(task: TaskTriple, runOf: (lease: TaskLeaseSnapshot | null) => RunRef | null, what: string):
  Promise<{ status: 'ready'; goal: GoalSnapshot; lease: TaskLeaseSnapshot | null; run: RunSnapshot | null } | CoreRejection> {
    const goalRef = goalRefFor(task.projectId, task.goalId);
    const goal = await readGoal(records, goalRef);
    if (goal.status !== 'ready') return goal;
    const leased = await readOwnerRecord({ store: records, refKey: taskRecordRefKey('TaskLease', goalRef, task.taskId),
      decode: storedLease, readError: (message) => rejected('unavailable', `the TaskLease cannot be read: ${message}`) });
    if ('rejection' in leased) return leased.rejection;
    const lease = 'notFound' in leased ? null : leased.value;
    const runRef = runOf(lease);
    if (runRef === null) return { status: 'ready', goal: goal.goal, lease, run: null };
    const run = await readRunAt(runRef, what);
    if (run.status !== 'ready') return run;
    return { status: 'ready', goal: goal.goal, lease, run: run.run };
  }

  /** 送停的确定性意图（不存在是 `null`）。 */
  async function readSteerIntent(intentRef: ControlIntentRef) {
    const read = await readOwnerRecord({ store: records, refKey: canonicalKey(intentRef), decode: decodeControlIntentSnapshot,
      readError: (message) => rejected('unavailable', `the stop control intent cannot be read: ${message}`) });
    if ('rejection' in read) return read.rejection;
    return { status: 'ready' as const, intent: 'notFound' in read ? null : read.value };
  }

  /** 原 Run 此刻的事实；指针和冻结值不同时读指针所指意图的提交者（按它认“谁动的”）。 */
  async function readStopRun(run: RunSnapshot, frozenPointer: ControlIntentRef | null):
  Promise<{ status: 'ready'; value: StopRunFactsV1 } | CoreRejection> {
    const pointer = run.controlState?.intentRef ?? null;
    let pointerBy: StopRunFactsV1['pointerBy'] = null;
    if (pointer !== null && !sameJson(frozenPointer, pointer)) {
      const intent = await readOwnerRecord({ store: records, refKey: canonicalKey(pointer), decode: decodeControlIntentSnapshot,
        readError: (message) => rejected('unavailable', `the Run control intent cannot be read: ${message}`) });
      if ('rejection' in intent) return intent.rejection;
      if ('notFound' in intent) return rejected('unavailable', 'the Run control pointer names a missing intent');
      pointerBy = intent.value.requestedBy;
    }
    return { status: 'ready', value: { ended: run.status === 'ended', pointer, pointerBy } };
  }

  async function readOwnRequest(ref: ActionRequestRef): Promise<{ status: 'ready'; record: ActionRequestV1 } | CoreRejection> {
    const read = await readActionRequestRecord(records, ref);
    if (read.status !== 'ready') return read;
    return read.record === null ? rejected('not_found', 'the action request does not exist')
      : { status: 'ready', record: read.record };
  }

  function requesterOf(admission: ActionRoundAdmissionV1): ActionRequestRequesterV1 {
    return queryRoundRequesterOf(queryRoundActorOf(admission.round), admission.round.session, admission.duty);
  }

  function holdChangeOf(read: { hold: TaskClaimHoldV1 | null; guard: RecordGuard },
    next: PendingTaskClaimHoldV1 | null): NonNullable<RequestChange['hold']> {
    return { current: read.hold, guard: read.guard, next };
  }

  function holdDraftOf(read: { hold: TaskClaimHoldV1 | null }, task: TaskTriple, workspaceId: string): PendingTaskClaimHoldV1 {
    return nextTaskClaimHold(read.hold, { ref: taskClaimHoldRefOf(task), workspaceId });
  }

  // ---- 派活受理（3.2 第 2、3 步） ------------------------------------------

  async function requestDispatch(ctx: CoreCallContext, request: GraphWrite<DispatchRequestInputV1>): Promise<DispatchRequestResultV1> {
    const owned = isolateActionWrite(request, 'dispatch request');
    if (!owned.ok) return owned.rejection;
    const input = owned.input;
    const basisProblem = input.expected === undefined ? null : dispatchBasisProblem(input.expected);
    const problem = taskRefProblem(input.taskRef) ?? blankTextProblem(input.reason)
      ?? (input.preferredLine === undefined || checkShape(SessionRefShape, input.preferredLine, 'stored') === null ? null
        : 'preferredLine must be a complete SessionRef')
      ?? (basisProblem === null ? null : `expected ${basisProblem}`);
    if (problem !== null) return invalid(problem);
    const task = input.taskRef;
    const goalRef = goalRefFor(task.projectId, task.goalId);
    type Facts = {
      admission: ActionRoundAdmissionV1; basis: DispatchBasisFactsV1; taskProblem: CoreRejection | null;
      leaseGuard: RecordGuard | null; hold: { hold: TaskClaimHoldV1 | null; guard: RecordGuard }; rules: Rules;
    };
    const result = await writeActionRequest<Facts, ActionRequestRejectionV1 | { already: ActionRequestRef }, DispatchProjection>(ctx, {
      operation: 'action_request.dispatch', commandId: owned.requestId,
      fingerprintInput: { taskRef: task, reason: input.reason, preferredLine: input.preferredLine ?? null,
        expected: input.expected ?? null } as unknown as JsonValue,
      read: async () => {
        const admission = await admitActionRound(ctx, deps, goalRef, 'request a dispatch');
        if (admission.status !== 'ready') return admission;
        const basis = await deps.dispatchBasis.readDispatchFacts(ctx, { goalRef });
        if (basis.status !== 'ready') return notReadyRejection(basis, 'the dispatch basis');
        const taskProblem = await dispatchProblemOf(goalRef, basis.value.plan, task.taskId);
        if (taskProblem.status !== 'ready') return taskProblem;
        const hold = await readTaskClaimHold(records, task);
        if (hold.status !== 'ready') return hold;
        const rules = await readRules(ctx, task.projectId);
        if (rules.status !== 'ready') return rules;
        return { status: 'ready', facts: { admission: admission.value, basis: basis.value,
          taskProblem: taskProblem.problem, leaseGuard: taskProblem.leaseGuard, hold, rules } };
      },
      change: (facts, keys) => {
        // 三值缺了代填，给了对不上就带回当前三值；只比不守（3.2 第 2 步）。
        if (input.expected !== undefined && !sameBasis(facts.basis.values, input.expected)) {
          return { refuse: { ...rejected('revision_conflict', 'the dispatch basis moved since it was read'),
            dispatchCurrent: dispatchCurrentOf(facts.basis) } };
        }
        if (facts.taskProblem !== null) return { refuse: facts.taskProblem };
        const open = facts.hold.hold?.openDispatch ?? null;
        if (open !== null) return { refuse: { already: open } };
        const goal = facts.basis.goal;
        const ref: ActionRequestRef = { aggregateType: 'ActionRequest', ...task, requestId: keys.identityKey };
        const record = newDispatchRequest({ ref, workspaceId: goal.workspaceRef.workspaceId, task,
          requester: requesterOf(facts.admission), reason: input.reason, requestedAt: deps.now(),
          expected: input.expected ?? facts.basis.values, preferredLine: input.preferredLine ?? null },
        needsDecision('agent_dispatch', goal, facts.rules, facts.admission.duty) ? 'pending' : 'open');
        const hold = occupyHoldPointer(holdDraftOf(facts.hold, task, goal.workspaceRef.workspaceId), 'openDispatch', ref);
        return { record, before: null, hold: holdChangeOf(facts.hold, hold), change: 'created',
          guards: [...facts.admission.guards, revisionGuard(goal.ref, goal.revision), facts.rules.guard,
            ...(facts.leaseGuard === null ? [] : [facts.leaseGuard])],
          blockedBy: dispatchBlockersOf(facts.hold.hold, goal) };
      },
      project: (event): DispatchProjection => event.request.state === 'pending'
        ? { status: 'needs_decision', actionRef: event.request.ref }
        : { status: 'requested', actionRef: event.request.ref, blockedBy: event.blockedBy ?? [] },
    });
    if (result.status === 'committed') return { ...result.value, replayed: result.replayed, cursor: result.cursor };
    if (result.status === 'refused') {
      return 'already' in result.refusal ? { status: 'already_requested', actionRef: result.refusal.already } : result.refusal;
    }
    return result;
  }

  /**
   * 派活受理的相位判定（读法同领取）和任务固定键上的 Lease（同一读窗）；受理提交守读到的 Lease 版本（不存在守“仍不
   * 存在”），读完之后普通领取先提交就冲突。任务不在计划里时不读任务事实（受理会拒，不提交）。
   */
  async function dispatchProblemOf(goalRef: GoalRef, plan: PlanRevisionSnapshot | null, taskId: string):
  Promise<{ status: 'ready'; problem: CoreRejection | null; leaseGuard: RecordGuard | null } | CoreRejection> {
    const definition = plan?.tasks.find((candidate) => candidate.taskId === taskId);
    if (plan === null || definition === undefined) {
      return { status: 'ready', problem: dispatchTaskProblem(null, { ranBefore: false, leaseHeld: false }), leaseGuard: null };
    }
    const read = await readCanonicalTaskFacts(records, goalRef, plan, taskId);
    if (read.status !== 'ready') return read;
    const state = read.value.byTaskId.get(taskId);
    const phaseFacts = state === undefined ? null : claimPhaseFacts(definition, state, read.value);
    if (phaseFacts === null) return rejected('unavailable', 'the Task state cannot be read');
    const lease = read.value.leasesByTaskId.get(taskId) ?? null;
    return { status: 'ready',
      problem: dispatchTaskProblem(taskMachineStateOf(definition, phaseFacts),
        { ranBefore: phaseFacts.selectedRun !== null, leaseHeld: taskLeaseNodeOf(lease) === 'held' }),
      leaseGuard: { refKey: taskRecordRefKey('TaskLease', goalRef, taskId), expectedRevision: lease?.revision ?? null } };
  }

  // ---- 叫停受理（3.4） ------------------------------------------------------

  async function requestStop(ctx: CoreCallContext, request: GraphWrite<StopRequestInputV1>): Promise<StopRequestResultV1> {
    const owned = isolateActionWrite(request, 'stop request');
    if (!owned.ok) return owned.rejection;
    const input = owned.input;
    const problem = taskRefProblem(input.taskRef) ?? blankTextProblem(input.reason);
    if (problem !== null) return invalid(problem);
    const task = input.taskRef;
    const goalRef = goalRefFor(task.projectId, task.goalId);
    type Facts = {
      admission: ActionRoundAdmissionV1; goal: GoalSnapshot; lease: TaskLeaseSnapshot | null; run: RunSnapshot | null;
      hold: { hold: TaskClaimHoldV1 | null; guard: RecordGuard }; pendingStop: ActionRequestV1 | null; rules: Rules;
    };
    const result = await writeActionRequest<Facts, CoreRejection, StopProjection>(ctx, {
      operation: 'action_request.stop', commandId: owned.requestId,
      fingerprintInput: { taskRef: task, reason: input.reason },
      read: async () => {
        const admission = await admitActionRound(ctx, deps, goalRef, 'request a stop');
        if (admission.status !== 'ready') return admission;
        // 契约 2.3：读 TaskLease 固定键，再读它指向的 Run。
        const stopFacts = await readStopFacts(task, (lease) => lease === null ? null
          : { aggregateType: 'Run', projectId: lease.ref.projectId, goalId: lease.ref.goalId, runId: lease.holderRunId },
        'the Run holding the TaskLease');
        if (stopFacts.status !== 'ready') return stopFacts;
        const { goal, lease, run } = stopFacts;
        const hold = await readTaskClaimHold(records, task);
        if (hold.status !== 'ready') return hold;
        let pendingStop: ActionRequestV1 | null = null;
        if (hold.hold?.pendingStop != null) {
          const pending = await readOwnRequest(hold.hold.pendingStop);
          if (pending.status !== 'ready') return pending;
          // 读卡位和读卡之间被撤、被批、被拒的，当没有卡位；卡位在读后换成新卡的，提交守暂缓版本会冲突。
          pendingStop = pending.record.state === 'pending' ? pending.record : null;
        }
        const rules = await readRules(ctx, task.projectId);
        if (rules.status !== 'ready') return rules;
        return { status: 'ready', facts: { admission: admission.value, goal, lease, run, hold, pendingStop, rules } };
      },
      change: (facts, keys) => {
        const { lease, run } = facts;
        // 已有待批的叫停卡先回它（原 Run 在等批时结束了也一样），调用方才知道该答或撤哪一张。
        if (facts.pendingStop !== null) {
          return { refuse: rejectedWithNonEmptyCurrent('busy', 'the Task already has a pending stop request; '
            + 'answer or withdraw that card first', [{ ref: facts.pendingStop.ref, revision: facts.pendingStop.revision }]) };
        }
        // 在跑的 Run，或已让出在等回复的 Run（Q8b：放行写 `stop` 挡住接续，不送）。
        const waiting = run?.status === 'ended' && run.outcome === 'yielded' && run.continuation !== undefined;
        if (lease === null || run === null || (run.status === 'ended' && !waiting)) {
          return { refuse: invalid('the Task has no running Run to stop; use hold_claim to keep it from being claimed, '
            + 'or submit a candidate to cancel it') };
        }
        // Q8a：你已暂停或正在停的 Run 不再出卡、不再送停。
        const pointerState = run.controlState?.desiredState;
        if (pointerState === 'paused' || pointerState === 'cancelled') {
          return { refuse: rejected('busy', 'the Run is already paused or stopping; use hold_claim to keep the Task '
            + 'from being claimed again') };
        }
        const goal = facts.goal;
        const round = facts.admission.round;
        const ref: ActionRequestRef = { aggregateType: 'ActionRequest', ...task, requestId: keys.identityKey };
        const frozen: StopFrozenV1 = { run: { ...run.ref }, lease: { ref: { ...lease.ref }, revision: lease.revision },
          pointer: run.controlState === undefined ? null : { ...run.controlState.intentRef } };
        const common = { ref, workspaceId: goal.workspaceRef.workspaceId, task, requester: requesterOf(facts.admission),
          reason: input.reason, requestedAt: deps.now(), frozen,
          basis: { requestRoot: null, sourceMessage: round.sourceMessageRef, round: { ...round.round } } };
        const guards = [...facts.admission.guards, revisionGuard(goal.ref, goal.revision), facts.rules.guard,
          revisionGuard(lease.ref, lease.revision), revisionGuard(run.ref, run.revision)];
        const draft = holdDraftOf(facts.hold, task, goal.workspaceRef.workspaceId);
        if (needsDecision('agent_stop', goal, facts.rules, facts.admission.duty)) {
          return { record: newStopRequest(common, null), before: null, change: 'created', guards,
            hold: holdChangeOf(facts.hold, occupyHoldPointer(draft, 'pendingStop', ref)) };
        }
        // AR-01s：读和放行是同一个读窗，冻结值就是此刻的租约和指针。
        const verdict = stopReleaseOf({ goal: goal.desiredState, leaseHolderRunId: lease.holderRunId, frozen,
          run: { ended: run.status === 'ended', pointer: frozen.pointer, pointerBy: null } });
        const placed = stopHold(draft, verdict, ref, common.basis, input.reason, null, keys);
        return { record: newStopRequest(common, { verdict, holdReasonId: placed.reasonId,
          closedBy: { commandId: owned.requestId, at: deps.now() } }), before: null, change: 'created', guards,
          hold: holdChangeOf(facts.hold, placed.hold) };
      },
      project: (event): StopProjection => {
        const stored = event.request;
        const outcome = stored.outcome;
        if (outcome === null) return { status: 'needs_decision', actionRef: stored.ref };
        if (outcome.kind === 'void') return { status: 'void', actionRef: stored.ref, reason: outcome.reason };
        return { status: 'released', actionRef: stored.ref,
          holdReasonId: outcome.kind === 'released' ? outcome.holdReasonId : null,
          notSent: outcome.kind === 'released' ? outcome.notSent : null };
      },
    });
    if (result.status === 'committed') return { ...result.value, replayed: result.replayed, cursor: result.cursor };
    return result.status === 'refused' ? result.refusal : result;
  }

  /**
   * 放行写的暂缓：判定要写就放一条 `stop` 原因（来源是请求、来源事实是受理那一轮），不写就不动。游标：当场放行的和请求
   * 同一次提交绑定；批准时照抄请求的受理游标（r2 #17）。原因号取这次命令的身份。
   */
  function stopHold(
    draft: PendingTaskClaimHoldV1, verdict: StopReleaseV1, ref: ActionRequestRef,
    basis: NonNullable<ActionRequestV1['basis']>, reason: string, since: CommitCursor | null, keys: Keys,
  ): { hold: PendingTaskClaimHoldV1 | null; reasonId: string | null } {
    if (verdict.kind !== 'released' || !verdict.writeHold) return { hold: null, reasonId: null };
    const put = placeHoldReason(draft, { id: keys.identityKey, kind: 'stop', placedBy: { kind: 'action', actionRef: ref },
      basis: { kind: 'round', ...basis }, reason, placedAt: deps.now(), since });
    return { hold: put.hold, reasonId: put.reasonId };
  }

  // ---- 你的批准和拒绝（答卡 ② 适配器，3.10） --------------------------------

  type AnswerFacts = {
    record: ActionRequestV1;
    /** 卡位所在的暂缓；批准派活（AR-02d）不改暂缓，不读（`null`）。 */
    hold: { hold: TaskClaimHoldV1 | null; guard: RecordGuard } | null;
    stop: { goal: GoalSnapshot; lease: TaskLeaseSnapshot | null; run: StopRunFactsV1; runGuard: RecordGuard } | null;
  };

  function answerInputProblem(input: ActionRequestAnswerV1): string | null {
    if (!isRecord(input)) return 'the answer requires { request, revision, commandId, answerRef }';
    return actionRefProblem(input.request)
      ?? (Number.isSafeInteger(input.revision) && input.revision >= 1 ? null : 'revision must be a positive integer')
      ?? (nonEmpty(input.commandId) ? null : 'commandId must be a non-empty string')
      ?? (checkShape(SessionMessageRefShape, input.answerRef, 'stored') === null ? null
        : 'answerRef must be a complete SessionMessageRef');
  }

  /**
   * 批准、拒：读记录。批准派活（AR-02d）只迁移请求，到此为止；拒、批准叫停要让出卡位，再读暂缓；批准一张叫停卡还读放行
   * 要看的目标、租约、原 Run。
   */
  async function readAnswerFacts(input: ActionRequestAnswerV1, approving: boolean):
  Promise<{ status: 'ready'; facts: AnswerFacts } | CoreRejection> {
    const read = await readOwnRequest(input.request);
    if (read.status !== 'ready') return read;
    const record = read.record;
    if (approving && record.kind === 'dispatch') return { status: 'ready', facts: { record, hold: null, stop: null } };
    const hold = await readTaskClaimHold(records, record.task);
    if (hold.status !== 'ready') return hold;
    if (!approving || record.state !== 'pending') return { status: 'ready', facts: { record, hold, stop: null } };
    const frozen = record.frozen!;
    const stopFacts = await readStopFacts(record.task, () => frozen.run, 'the stopped Run');
    if (stopFacts.status !== 'ready') return stopFacts;
    const run = stopFacts.run!;
    const runFacts = await readStopRun(run, frozen.pointer);
    if (runFacts.status !== 'ready') return runFacts;
    return { status: 'ready', facts: { record, hold, stop: { goal: stopFacts.goal, lease: stopFacts.lease, run: runFacts.value,
      runGuard: revisionGuard(run.ref, run.revision) } } };
  }

  /** 只收 Host 的可信输入；不重新准入原来那一轮（批准以后认记录上的原请求者和答卡回执）。 */
  async function answerRequest(ctx: CoreCallContext, input: ActionRequestAnswerV1, approving: boolean):
  Promise<WriteResult<ActionRequestSnapshotV1>> {
    if (ctx.principal.kind !== 'host') return rejected('forbidden', 'only the Host may approve or deny an action request');
    const problem = answerInputProblem(input);
    if (problem !== null) return invalid(problem);
    const closedBy = () => ({ commandId: input.commandId, at: deps.now() });
    const result = await writeActionRequest<AnswerFacts, CoreRejection, ActionRequestSnapshotV1>(ctx, {
      operation: approving ? 'action_request.approve' : 'action_request.deny', commandId: input.commandId,
      fingerprintInput: { request: input.request, revision: input.revision, answerRef: input.answerRef } as unknown as JsonValue,
      read: () => readAnswerFacts(input, approving),
      change: (facts, keys) => {
        const record = facts.record;
        if (record.revision !== input.revision) return { refuse: staleRevision(record) };
        const holdRead = facts.hold;
        // AR-02d：批准派活只迁移请求，不动暂缓（读时也就没读它）。
        if (holdRead === null) {
          const opened = approveDispatchRequest(record, input.answerRef);
          if ('status' in opened) return { refuse: opened };
          return { record: opened, before: record.revision, change: 'approved', guards: [], hold: null };
        }
        const draft = holdDraftOf(holdRead, record.task, record.workspaceId);
        if (!approving) {
          const denied = denyActionRequest(record, input.answerRef, closedBy());
          if ('status' in denied) return { refuse: denied };
          return { record: denied, before: record.revision, change: 'denied', guards: [],
            hold: holdChangeOf(holdRead, yieldHoldPointer(draft, record.kind === 'stop' ? 'pendingStop' : 'openDispatch',
              record.ref)) };
        }
        if (facts.stop === null) return { refuse: tableOutside(record) };
        // AR-02s：放行判定在这次提交里重做，守目标、租约、原 Run；让出卡位，按判定写 `stop` 原因。
        const { goal, lease, run, runGuard } = facts.stop;
        const yielded = yieldHoldPointer(draft, 'pendingStop', record.ref);
        const verdict = stopReleaseOf({ goal: goal.desiredState, leaseHolderRunId: lease?.holderRunId ?? null,
          frozen: record.frozen!, run });
        const placed = stopHold(yielded, verdict, record.ref, record.basis!, record.reason, record.since, keys);
        const released = releaseStopRequest(record, verdict, placed.reasonId, input.answerRef, closedBy());
        if ('status' in released) return { refuse: released };
        const guards = [revisionGuard(goal.ref, goal.revision), runGuard,
          ...(lease === null ? [] : [revisionGuard(lease.ref, lease.revision)])];
        return { record: released, before: record.revision, change: 'approved', guards,
          hold: holdChangeOf(holdRead, placed.hold ?? yielded) };
      },
      project: (event) => event.request,
    });
    return snapshotResult(result);
  }

  // ---- 撤回、作废 -------------------------------------------------------------

  /** 关掉一条请求、让出它的卡位（AR-04、AR-06）。 */
  async function closeRequest(ctx: CoreCallContext, input: {
    operation: string; commandId: string; ref: ActionRequestRef; fingerprintInput: JsonValue; change: 'withdrawn' | 'voided';
    right(record: ActionRequestV1): Promise<{ status: 'ready'; guards: RecordGuard[] } | CoreRejection>;
    next(record: ActionRequestV1): PendingActionRequestV1 | CoreRejection;
  }): Promise<WriteResult<ActionRequestSnapshotV1>> {
    type Facts = { record: ActionRequestV1; hold: { hold: TaskClaimHoldV1 | null; guard: RecordGuard }; guards: RecordGuard[] };
    const result = await writeActionRequest<Facts, CoreRejection, ActionRequestSnapshotV1>(ctx, {
      operation: input.operation, commandId: input.commandId, fingerprintInput: input.fingerprintInput,
      read: async () => {
        const read = await readOwnRequest(input.ref);
        if (read.status !== 'ready') return read;
        const right = await input.right(read.record);
        if (right.status !== 'ready') return right;
        const hold = await readTaskClaimHold(records, read.record.task);
        if (hold.status !== 'ready') return hold;
        return { status: 'ready', facts: { record: read.record, hold, guards: right.guards } };
      },
      change: (facts) => {
        const record = facts.record;
        const next = input.next(record);
        if ('status' in next) return { refuse: next };
        const draft = holdDraftOf(facts.hold, record.task, record.workspaceId);
        return { record: next, before: record.revision, change: input.change, guards: facts.guards,
          hold: holdChangeOf(facts.hold, yieldHoldPointer(draft, record.kind === 'stop' ? 'pendingStop' : 'openDispatch',
            record.ref)) };
      },
      project: (event) => event.request,
    });
    return snapshotResult(result);
  }

  async function withdrawRequest(ctx: CoreCallContext, request: GraphWrite<{ request: ActionRequestRef }>):
  Promise<WriteResult<ActionRequestSnapshotV1>> {
    const owned = isolateActionWrite(request, 'action request withdraw');
    if (!owned.ok) return owned.rejection;
    const problem = actionRefProblem(owned.input.request);
    if (problem !== null) return invalid(problem);
    // 回执身份按 `ctx.projectId` 算，管不住实际读写的记录键：别的项目的引用在查回执、读写之前就拒。
    if (owned.input.request.projectId !== ctx.projectId) {
      return rejected('forbidden',
        'the action request belongs to another project; this call may not change another project\'s records');
    }
    const refused = rejected('forbidden', 'only the requesting line or the configured operator may withdraw this action request');
    return closeRequest(ctx, {
      operation: 'action_request.withdraw', commandId: owned.requestId, ref: owned.input.request,
      fingerprintInput: { request: owned.input.request } as unknown as JsonValue, change: 'withdrawn',
      // 请求方那条线的问答轮（守这一轮的版本），或配置的操作者（AR-06“请求方或你”）。
      right: async (record) => {
        if (ctx.principal.kind === 'host') {
          const operator = operatorProblem(ctx.principal.actor, deps.operatorActor, 'withdraw an action request');
          return operator ?? { status: 'ready', guards: [] };
        }
        if (ctx.principal.kind !== 'query_run') return refused;
        const round = await deps.queryRounds.resolveQueryRound(ctx);
        if (round.status !== 'ready') return round;
        const session = round.value.session;
        return session.projectId === record.requester.session.projectId
          && session.sessionId === record.requester.session.sessionId
          ? { status: 'ready', guards: [...round.value.guards] } : refused;
      },
      next: (record) => withdrawActionRequest(record, { commandId: owned.requestId, at: deps.now() }),
    });
  }

  async function settleRequest(ctx: CoreCallContext, request: GraphWrite<{ request: ActionRequestRef; reason: string }>):
  Promise<WriteResult<ActionRequestSnapshotV1>> {
    if (!automationActor(ctx)) return rejected('forbidden', 'only the platform automation may settle an action request');
    const owned = isolateActionWrite(request, 'action request settle');
    if (!owned.ok) return owned.rejection;
    const problem = actionRefProblem(owned.input.request) ?? blankTextProblem(owned.input.reason);
    if (problem !== null) return invalid(problem);
    const reason = owned.input.reason;
    return closeRequest(ctx, {
      operation: 'action_request.settle', commandId: owned.requestId, ref: owned.input.request,
      fingerprintInput: { request: owned.input.request, reason } as unknown as JsonValue, change: 'voided',
      right: async () => ({ status: 'ready', guards: [] }),
      next: (record) => voidActionRequest(record, reason, { commandId: owned.requestId, at: deps.now() }),
    });
  }

  // ---- 送停（3.4“送停是一次投递”） -----------------------------------------

  /** AR-07：记“没送停”，守确定性意图仍不存在和请求版本（先到者已送停时后到者写不进）。 */
  async function recordNotSent(ctx: CoreCallContext, record: ActionRequestV1, notSent: 'person_stopped' | 'run_ended',
    intentRef: ControlIntentRef): Promise<DeliverStopResultV1> {
    const result = await writeActionRequest<null, CoreRejection, ActionRequestSnapshotV1>(ctx, {
      operation: 'action_request.not_sent', commandId: `action:${record.ref.requestId}:not_sent`,
      fingerprintInput: { request: record.ref, notSent } as unknown as JsonValue,
      read: async () => ({ status: 'ready', facts: null }),
      change: () => {
        const next = recordStopNotSent(record, notSent);
        if ('status' in next) return { refuse: next };
        return { record: next, before: record.revision, change: 'not_sent', hold: null,
          guards: [{ refKey: canonicalKey(intentRef), expectedRevision: null }] };
      },
      project: (event) => event.request,
    });
    if (result.status === 'committed') {
      return { status: 'not_sent', request: result.value, replayed: result.replayed, cursor: result.cursor };
    }
    return result.status === 'refused' ? result.refusal : result;
  }

  /**
   * 须是放行了、还没送的叫停，否则原样回。意图号按请求记下的项目、工作区算（不用先读 Run）。① 确定性意图已在就回它；
   * ② 按键读冻结的原 Run，你动过或已结束（含平台取消）就记没送停，守“意图仍不存在”冲突了（另一个送停者先送了）就重读
   * 同一意图，在就回它；③ 否则以平台自动化身份提交动作来源的 steer（`expected` 是这次读到的 Run 版本，只作 CAS），冲突
   * 或遇暂停就重读一次回到 ①；④ 只提交不投递（投递由 control 的送达做）。
   */
  async function deliverStop(ctx: CoreCallContext, input: { request: ActionRequestRef }): Promise<DeliverStopResultV1> {
    if (!automationActor(ctx)) return rejected('forbidden', 'only the platform automation may deliver a stop');
    if (!isRecord(input)) return invalid('deliverStop requires { request }');
    const problem = actionRefProblem(input.request);
    if (problem !== null) return invalid(problem);
    const read = await readOwnRequest(input.request);
    if (read.status !== 'ready') return read;
    const record = read.record;
    if (!awaitsStopDelivery(record)) return { status: 'unchanged', request: record };
    const frozen = record.frozen!;
    const scope = { projectId: record.ref.projectId, workspaceId: record.workspaceId };
    const steerRequestId = `action:${record.ref.requestId}:steer`;
    const intentRef = controlIntentRefFor(WORKFLOW_AUTOMATION_ACTOR, scope, steerRequestId);
    let lastRefusal: CoreRejection | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const existing = await readSteerIntent(intentRef);
      if (existing.status !== 'ready') return existing;
      if (existing.intent !== null) return { status: 'steer', intent: existing.intent, replayed: true };
      const stopped = await readRunAt(frozen.run, 'the stopped Run');
      if (stopped.status !== 'ready') return stopped;
      const run = stopped.run;
      const runFacts = await readStopRun(run, frozen.pointer);
      if (runFacts.status !== 'ready') return runFacts;
      const check = stopRunCheckOf(frozen.pointer, runFacts.value);
      if (check !== 'running') {
        const notSent = await recordNotSent(ctx, record, check, intentRef);
        if (notSent.status !== 'rejected' || notSent.code !== 'revision_conflict') return notSent;
        const after = await readSteerIntent(intentRef);
        if (after.status !== 'ready') return after;
        return after.intent === null ? notSent : { status: 'steer', intent: after.intent, replayed: true };
      }
      const controlCtx = hostContextIn({ ...ctx, principal: { kind: 'host', actor: { ...WORKFLOW_AUTOMATION_ACTOR } } },
        scope.workspaceId);
      const submitted = await deps.control.submitControl(controlCtx, {
        input: { runRef: { ...run.ref }, kind: 'steer',
          reason: truncateUtf8(`请收尾停下：${record.reason}；把做到一半的东西交代清楚再结束`, STEER_REASON_MAX_BYTES),
          source: { kind: 'action_request', actionRef: { ...record.ref } } },
        meta: { requestId: steerRequestId, expected: [{ ref: { ...run.ref }, revision: run.revision }] },
      });
      if (submitted.status === 'committed') {
        return { status: 'steer', intent: submitted.value.intent, replayed: submitted.replayed };
      }
      if (submitted.code !== 'revision_conflict' && submitted.code !== 'busy') return submitted;
      lastRefusal = submitted;
    }
    return lastRefusal!;
  }

  // ---- 读 -----------------------------------------------------------------

  async function readOneRequest(ctx: CoreCallContext, input: { ref: ActionRequestRef }): Promise<ReadResult<ActionRequestV1>> {
    if (!isRecord(input)) return invalid('readRequest requires { ref }');
    const problem = actionRefProblem(input.ref);
    if (problem !== null) return invalid(`readRequest requires ${problem}`);
    if (input.ref.projectId !== ctx.projectId) return rejected('forbidden', 'the action request belongs to another project');
    const read = await readActionRequestRecord(records, input.ref);
    if (read.status !== 'ready') return read;
    if (read.record === null) return { status: 'not_found' };
    if (ctx.workspaceId !== undefined && ctx.workspaceId !== read.record.workspaceId) {
      return rejected('forbidden', 'the action request belongs to another workspace');
    }
    return { status: 'ready', value: read.record };
  }

  return {
    requestDispatch, requestStop,
    approve: (ctx, input) => answerRequest(ctx, input, true),
    deny: (ctx, input) => answerRequest(ctx, input, false),
    withdraw: withdrawRequest, settle: settleRequest, deliverStop, readRequest: readOneRequest,
  };
}

/**
 * 按键读到的 Run、TaskLease。存储读出时已按登记的格式核过（`readMany` 对每条记录跑 `applyRecordSchema`）：Run 照现成的
 * `decodeRun` 写法再解一次；TaskLease 登记的校验就是 `plan-readers.ts` 的 `validateTaskLeaseSnapshot`，这里只解析取出快照。
 */
function storedRun(record: EncodedRecord): DecodeResult<RunSnapshot> {
  const decoded = decodeRun(record);
  return decoded.ok ? { status: 'decoded', value: decoded.value } : { status: 'invalid', reason: decoded.reason };
}
function storedLease(record: EncodedRecord): DecodeResult<TaskLeaseSnapshot> {
  const body = parseObject(record.json);
  return body === null ? { status: 'invalid', reason: 'the TaskLease snapshot is not a JSON object' }
    : { status: 'decoded', value: body as unknown as TaskLeaseSnapshot };
}

/** 派活受理时 owner 读得到的挡着的原因：暂缓（held 的原因）、叫停卡、目标暂停。 */
function dispatchBlockersOf(hold: TaskClaimHoldV1 | null, goal: GoalSnapshot): DispatchBlockerV1[] {
  const blockers: DispatchBlockerV1[] = (hold?.reasons ?? []).filter((reason) => reason.state === 'held')
    .map((reason) => ({ kind: 'claim_hold', reasonId: reason.id, holdKind: reason.kind, reason: reason.reason }));
  if (hold?.pendingStop != null) blockers.push({ kind: 'stop_pending', actionRef: { ...hold.pendingStop } });
  if (goal.desiredState === 'paused') blockers.push({ kind: 'goal_paused' });
  return blockers;
}

