/**
 * 动作请求 `ActionRequest`（问答轮的派活、叫停，设计 3.1–3.4）：一张字段表、一个格式、迁移表 AR-01…07 的纯构造器，
 * 加两条纯判定——派活受理只拒“永远等不到”的（3.2 第 2 步），叫停的放行看读到的事实取第一条（3.4）。
 *
 * owner（`tasks/action-requests.ts`）读事实、调这里、在一次提交里写下一版和它的事件；派活被领走（AR-03）由领取
 * owner 在领取那次提交里调 `applyDispatchRequest`。表外的迁移一律 `revision_conflict` 带当前版本：调用方读到的
 * 记录已经不在它以为的状态，重读即可。
 *
 * `since` 是受理那次提交的游标（叫停原因的失效从它起算），只在新建时由提交绑定；之后的版本原样带着它，不重绑。
 * 这个文件只依赖 `src/contracts` 和本目录（纯 `state/` 模块）。
 */
import type { ActionRequestRef } from '../../../contracts/action-request.js';
import { sameActorKindAndId } from '../../../contracts/actor-equality.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import type { ControlIntentRef } from '../../../contracts/control-intent.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import { rejected, rejectedWithNonEmptyCurrent } from '../../../contracts/core/rejections.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { defineRecord, f, type InferPending, type InferRecord, type InferShape } from '../../../contracts/data-format.js';
import {
  ActionRequestRefShape, ControlIntentRefShape, QueryJobRefShape, RunRefShape, SessionMessageRefShape, SessionRefShape,
  TaskLeaseRefShape, TaskTripleShape,
} from '../../../contracts/data-format-refs.js';
import type { RunRef, TaskTriple } from '../../../contracts/dispatch.js';
import { sameJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { DispatchBasisV1, GoalDesiredState } from '../../../contracts/ledger.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../../contracts/task-requeue.js';
import type { DecisionPolicyVerdictV1 } from './decision-policy.js';
import { AGENT_REQUESTER_FIELD } from './rework-request.js';
import type { TaskMachineState } from './task-machine.js';

const id = f.string({ min: 1, unit: 'codePoints' });

/**
 * 受理时 `decisionActionPolicy` 的四种判定。字段表要一个固定的值列表，这里用 `satisfies` 和
 * `state/decision-policy.ts` 的 `DecisionPolicyVerdictV1` 锁在一起，不另写一份判定。
 */
export const ACTION_REQUEST_DECISION_VERDICTS = [
  'user_only', 'needs_decision', 'automatic', 'automatic_notice',
] as const satisfies readonly DecisionPolicyVerdictV1[];
export type ActionRequestDecisionVerdictV1 = (typeof ACTION_REQUEST_DECISION_VERDICTS)[number];

/** 受理那一轮的原始事实（Q4b）：只存不推；来源链根和失效由读的一方推。`requestRoot` 是这一轮或它来源消息的请求根，别处为 null。 */
export const ROUND_BASIS_FIELDS = {
  requestRoot: f.nullable(f.ref(QueryJobRefShape)),
  sourceMessage: f.nullable(f.ref(SessionMessageRefShape)),
  round: f.ref(QueryJobRefShape),
};

/** 叫停受理时冻结的：持有租约的 Run、那把 TaskLease 的引用和版本、此刻的控制指针。 */
const FROZEN_FIELDS = {
  run: f.ref(RunRefShape),
  lease: f.object({ ref: f.ref(TaskLeaseRefShape), revision: f.revision({ min: 1 }) }),
  pointer: f.nullable(f.ref(ControlIntentRefShape)),
};

/** 了结结果：派活被领走（`applied`），叫停放行（`released`），或作废（`void`，派活的原因是平台写的一句话）。 */
const OUTCOME_FIELD = f.union('kind', {
  applied: {
    kind: f.literal('applied'), session: f.ref(SessionRefShape), run: f.ref(RunRefShape), byRequest: f.boolean(),
  },
  released: {
    kind: f.literal('released'), holdReasonId: f.nullable(id),
    notSent: f.nullable(f.enumOf(['person_stopped', 'run_ended'] as const)),
  },
  void: { kind: f.literal('void'), reason: id },
});

/** 记录除 `since` 以外的字段：事件里的快照就是它（提交绑定的游标不进事件）。 */
export const ACTION_REQUEST_BODY_FIELDS = {
  ref: f.ref(ActionRequestRefShape),
  revision: f.revision({ min: 1 }),
  schemaVersion: f.literal(1),
  /** 任务所在目标的工作区。 */
  workspaceId: id,
  kind: f.enumOf(['dispatch', 'stop'] as const),
  task: f.ref(TaskTripleShape),
  requester: AGENT_REQUESTER_FIELD,
  reason: id,
  requestedAt: f.isoTime(),
  /** 受理时 `decisionActionPolicy` 的判定（卡 / 自动档 / 自动请知悉 / 只给人），不只留“要不要卡”的布尔。 */
  decision: f.object({ verdict: f.enumOf(ACTION_REQUEST_DECISION_VERDICTS) }),
  state: f.enumOf(['pending', 'open', 'released', 'void', 'applied', 'denied', 'withdrawn'] as const),
  /** 放行卡的正式答复（你批或拒时）。 */
  answerRef: f.nullable(f.ref(SessionMessageRefShape)),
  closedBy: f.nullable(f.object({ commandId: id, at: f.isoTime() })),
  /** 派活：受理时的三值（模型给的或平台代填的 `DispatchBasisV1`，`number | 'none'` 没有字段种类能描述，存 JSON）。 */
  expected: f.nullable(f.json()),
  preferredLine: f.nullable(f.ref(SessionRefShape)),
  /** 叫停：受理时冻结的 Run、租约、指针。 */
  frozen: f.nullable(f.object(FROZEN_FIELDS)),
  /** 两种动作受理那一轮的原始事实（请求根、来源消息、轮）；请求根是请求反馈认来源的唯一依据。 */
  basis: f.nullable(f.object(ROUND_BASIS_FIELDS)),
  outcome: f.nullable(OUTCOME_FIELD),
};
const ACTION_REQUEST_FIELDS = { ...ACTION_REQUEST_BODY_FIELDS, since: f.boundCursor('since') };

export type ActionRequestV1 = InferRecord<typeof ACTION_REQUEST_FIELDS>;
/** 提交前的形状：新建时 `since` 为 `null`，由提交绑定。 */
export type PendingActionRequestV1 = InferPending<typeof ACTION_REQUEST_FIELDS>;
/** 事件里的快照（记录去掉 `since`），也是写口的回执值。 */
export type ActionRequestSnapshotV1 = InferShape<typeof ACTION_REQUEST_BODY_FIELDS>;
type ActionRequestStateV1 = ActionRequestV1['state'];
export type ActionRequestRequesterV1 = ActionRequestV1['requester'];
export type RoundBasisV1 = NonNullable<ActionRequestV1['basis']>;
export type StopFrozenV1 = NonNullable<ActionRequestV1['frozen']>;

/** §2.8/T37：反馈按受理那一轮存下的完整请求根读回全部动作，不扫当前计划、不靠最近卡位。 */
export const ACTION_REQUEST_BY_REQUEST_ROOT_LOOKUP = 'action-request-by-request-root';

export const ACTION_REQUEST_FORMAT = defineRecord({
  name: 'ActionRequest',
  schemaId: 'ActionRequest@1',
  aggregateType: 'ActionRequest',
  fields: ACTION_REQUEST_FIELDS,
  lookups: [{
    name: ACTION_REQUEST_BY_REQUEST_ROOT_LOOKUP,
    equal: ['basis.requestRoot.projectId', 'basis.requestRoot.workspaceId', 'basis.requestRoot.queryJobId'],
    orderBy: { path: 'since', valueType: 'text' },
  }],
});

/** 派活受理时 owner 读得到的挡着的原因（暂缓、叫停卡、目标暂停）；门、线忙等由目标循环判。事件里带它，重放回同一张回执。 */
export const DISPATCH_BLOCKER_FIELD = f.union('kind', {
  claim_hold: {
    kind: f.literal('claim_hold'), reasonId: id, holdKind: f.enumOf(['agent', 'stop', 'scribe_stop'] as const), reason: id,
  },
  stop_pending: { kind: f.literal('stop_pending'), actionRef: f.ref(ActionRequestRefShape) },
  goal_paused: { kind: f.literal('goal_paused') },
});
export type DispatchBlockerV1 = InferShape<{ blocker: typeof DISPATCH_BLOCKER_FIELD }>['blocker'];

/** 每次被接受的迁移在事件里记的一种变化。 */
export const ACTION_REQUEST_CHANGES = [
  'created', 'approved', 'applied', 'voided', 'denied', 'withdrawn', 'not_sent',
] as const;
export type ActionRequestChangeV1 = (typeof ACTION_REQUEST_CHANGES)[number];

/** 受理时 owner 交来的事实（构造器的输入，不是记录：记录的每个字段只在这里写）。 */
export type ActionRequestCommonInputV1 = {
  ref: ActionRequestRef; workspaceId: string; task: TaskTriple; requester: ActionRequestRequesterV1; reason: string;
  requestedAt: string;
  /** 受理时同一份策略判定的结果；卡和自动档都记它。 */
  decision: { verdict: ActionRequestDecisionVerdictV1 };
};
type ClosedByV1 = { commandId: string; at: string };

/** AR-01 / AR-01d：派活受理。「每步确认」没有规则命中是 `pending`，自动档或规则命中是 `open`。`basis` 记受理那一轮
 * 的请求根和来源，反馈按它认回原请求；受理 owner 必须给，只有不写记录的纯构造不传（记 null）。 */
export function newDispatchRequest(
  input: ActionRequestCommonInputV1 & {
    expected: DispatchBasisV1; preferredLine: SessionRef | null; basis?: RoundBasisV1;
  },
  state: 'pending' | 'open',
): PendingActionRequestV1 {
  return {
    ...input, revision: 1, schemaVersion: 1, kind: 'dispatch', expected: input.expected as unknown as JsonValue,
    frozen: null, basis: input.basis === undefined ? null : { ...input.basis }, state, answerRef: null, closedBy: null,
    outcome: null, since: null,
  };
}

/**
 * AR-01 / AR-01s：叫停受理。`release` 为 `null` 是「每步确认」的 `pending`；否则是自动档或规则命中在同一次提交里的
 * 放行判定（`released` 带写下的 `stop` 原因号，`void` 带原因）。
 */
export function newStopRequest(
  input: ActionRequestCommonInputV1 & { frozen: StopFrozenV1; basis: RoundBasisV1 },
  release: { verdict: StopReleaseV1; holdReasonId: string | null; closedBy: ClosedByV1 } | null,
): PendingActionRequestV1 {
  const base = {
    ...input, revision: 1, schemaVersion: 1 as const, kind: 'stop' as const, expected: null, preferredLine: null,
    answerRef: null, since: null,
  };
  if (release === null) return { ...base, state: 'pending', closedBy: null, outcome: null };
  return { ...base, ...releasedFields(release.verdict, release.holdReasonId), closedBy: release.closedBy };
}

/** AR-02d：你批了派活，`pending → open`；请求成为优先项，等目标循环领。 */
export function approveDispatchRequest(record: ActionRequestV1, answerRef: SessionMessageRef): PendingActionRequestV1 | CoreRejection {
  return moved(record, ['pending'], 'dispatch', { state: 'open', answerRef });
}

/** AR-02s：你批了叫停，`pending → released / void`，按提交那次的放行判定。 */
export function releaseStopRequest(
  record: ActionRequestV1, verdict: StopReleaseV1, holdReasonId: string | null, answerRef: SessionMessageRef,
  closedBy: ClosedByV1,
): PendingActionRequestV1 | CoreRejection {
  return moved(record, ['pending'], 'stop', { ...releasedFields(verdict, holdReasonId), answerRef, closedBy });
}

/**
 * AR-03：这个任务的任何一次领取了结派活请求，记领到的线和 Run。按请求领的那次（`byRequest: true`）只服务已放行的
 * `open` 请求：卡还在等你批时请求不是优先项（设计 3.2 第 3 步），按请求领它走表外（契约 2.5“非 open 由迁移表拒”）；
 * 不按请求的领取照样了结 `pending`。
 */
export function applyDispatchRequest(
  record: ActionRequestV1, applied: { session: SessionRef; run: RunRef; byRequest: boolean }, closedBy: ClosedByV1,
): PendingActionRequestV1 | CoreRejection {
  return moved(record, applied.byRequest ? ['open'] : ['pending', 'open'], 'dispatch', {
    state: 'applied', closedBy,
    outcome: { kind: 'applied', session: { ...applied.session }, run: { ...applied.run }, byRequest: applied.byRequest },
  });
}

/**
 * AR-04：目标循环的一步作废派活请求（任务取消、替代、已完成、你停过），写原因、让出 `openDispatch`。叫停不走这里：
 * 它的作废只有放行判定的两种原因（`goal_cancelled`、`run_replaced`），待批的叫停卡由你批、拒或请求方撤回。
 */
export function voidActionRequest(record: ActionRequestV1, reason: string, closedBy: ClosedByV1): PendingActionRequestV1 | CoreRejection {
  return moved(record, ['pending', 'open'], 'dispatch', { state: 'void', closedBy, outcome: { kind: 'void', reason } });
}

/** AR-05：你拒，只从 `pending`。 */
export function denyActionRequest(
  record: ActionRequestV1, answerRef: SessionMessageRef, closedBy: ClosedByV1,
): PendingActionRequestV1 | CoreRejection {
  return moved(record, ['pending'], null, { state: 'denied', answerRef, closedBy });
}

/** AR-06：请求方或你撤回。 */
export function withdrawActionRequest(record: ActionRequestV1, closedBy: ClosedByV1): PendingActionRequestV1 | CoreRejection {
  return moved(record, ['pending', 'open'], null, { state: 'withdrawn', closedBy });
}

type ReleasedOutcomeV1 = Extract<NonNullable<ActionRequestV1['outcome']>, { kind: 'released' }>;

/** 放行了、还没送停的叫停：送停只对它做，AR-07 也只从它起（这条判定只在这里写）。 */
export function awaitsStopDelivery(record: ActionRequestV1): record is ActionRequestV1 & { outcome: ReleasedOutcomeV1 } {
  return record.kind === 'stop' && record.state === 'released' && record.outcome?.kind === 'released'
    && record.outcome.notSent === null;
}

/** AR-07：放行了、还没送停的叫停记“没送停”（你已接手或 Run 已结束）；暂缓留着。 */
export function recordStopNotSent(
  record: ActionRequestV1, notSent: 'person_stopped' | 'run_ended',
): PendingActionRequestV1 | CoreRejection {
  if (!awaitsStopDelivery(record)) return tableOutside(record);
  return { ...record, revision: record.revision + 1, outcome: { ...record.outcome, notSent } };
}

/** 表外的迁移：调用方读到的记录已不在它以为的状态，带当前版本，重读即可。 */
export function tableOutside(record: ActionRequestV1): CoreRejection {
  return rejectedWithNonEmptyCurrent('revision_conflict', `the action request is ${record.state}`,
    [{ ref: record.ref, revision: record.revision }]);
}

function moved(
  record: ActionRequestV1, from: readonly ActionRequestStateV1[], kind: ActionRequestV1['kind'] | null,
  patch: Partial<PendingActionRequestV1>,
): PendingActionRequestV1 | CoreRejection {
  if (!from.includes(record.state) || (kind !== null && record.kind !== kind)) return tableOutside(record);
  return { ...record, ...patch, revision: record.revision + 1 };
}

function releasedFields(verdict: StopReleaseV1, holdReasonId: string | null): Pick<PendingActionRequestV1, 'state' | 'outcome'> {
  return verdict.kind === 'void'
    ? { state: 'void', outcome: { kind: 'void', reason: verdict.reason } }
    : { state: 'released', outcome: { kind: 'released', holdReasonId, notSent: verdict.notSent } };
}

// -------------------------------------------------------------------------- //
// 派活受理：只拒这条请求永远等不到的（设计 3.2 第 2 步）                        //
// -------------------------------------------------------------------------- //

/**
 * 相位读法同领取（`task-machine.ts` 的行号），在不在做看任务固定键上的 Lease。不在已采用计划、不是做事任务（门任务
 * 领不走）、不是启用、已完成：永远等不到；让出在等回复（P5、P18）：接续属于那条等待；租约还被持有（在跑的 Run、审查 Run
 * ——相位投影不算它——或结果未知、等审查的 Run 持有）：先等它放开；上一个 Run 已结束、没有待领返工（不是 P4）：先请返工
 * 或重验。其余挡着的（暂缓、待决卡、门、线忙、目标暂停）
 * 都收下，由目标循环在能领时先领它。`ranBefore` 是读到的选中 Run 存在，`leaseHeld` 是读到的 Lease 还没释放，
 * `reviewPending` 是选中 Run 的结果未知、审查还没了结（P3 的同一事实）。
 */
export function dispatchTaskProblem(
  state: TaskMachineState, facts: { ranBefore: boolean; leaseHeld: boolean; reviewPending: boolean },
): CoreRejection | null {
  if (state === null) return rejected('invalid', 'the Task is not in the accepted plan; a dispatch request would never be served');
  // 门任务没有 Run，领取只认做事任务（`task-machine.ts` 的 `taskClaimProblem`），所以同那里的原句。
  if (state.taskKind !== 'work') {
    return rejected('invalid', 'only a work task can be claimed; a dispatch request would never be served');
  }
  if (state.disposition !== 'active') {
    return rejected('invalid', `the Task is not active (${state.disposition}); a dispatch request would never be served`);
  }
  if (state.phase === 'satisfied') return rejected('invalid', 'the Task is already satisfied; there is nothing to dispatch');
  if (state.row === 'P5' || state.row === 'P18') {
    return rejected('busy', 'the Task is waiting for a reply; its continuation belongs to that wait');
  }
  if (facts.leaseHeld) {
    return facts.reviewPending
      ? rejected('busy', 'the Task is in progress; its lease is still held (the last outcome is unknown and awaits review)')
      : rejected('busy', 'the Task is in progress; its lease is still held by a running Run');
  }
  if (facts.ranBefore && state.row !== 'P4') {
    return rejected('invalid', 'the last Run of the Task ended without a pending rework; request a rework or recheck first');
  }
  return null;
}

// -------------------------------------------------------------------------- //
// 叫停放行和送停前的判定（设计 3.4；重裁 2）                                    //
// -------------------------------------------------------------------------- //

/** 原 Run 此刻的事实：是否已结束、当前控制指针，和指针所指意图的提交者（只在指针和冻结值不同时读）。 */
export type StopRunFactsV1 = { ended: boolean; pointer: ControlIntentRef | null; pointerBy: ActorRef | null };

export type StopReleaseV1 =
  | { kind: 'void'; reason: 'goal_cancelled' | 'run_replaced' }
  /** `writeHold`：写 `stop` 原因的暂缓；`notSent` 非空就不送停。 */
  | { kind: 'released'; writeHold: boolean; notSent: 'person_stopped' | 'run_ended' | null };

/**
 * 原 Run 还该不该收到送停（放行和送停共用）。控制指针只有控制提交会动（Run 自然结束不动它），所以和冻结值比就知道
 * 有没有人动过：提交者是 `WORKFLOW_AUTOMATION_ACTOR`（书记硬停的取消）当 Run 已结束；别的（你、目标暂停取消的扇出、
 * 你的恢复）是你已接手，永不补送。指针没动时，Run 已结束就不送。
 */
export function stopRunCheckOf(
  frozenPointer: ControlIntentRef | null, run: StopRunFactsV1,
): 'person_stopped' | 'run_ended' | 'running' {
  if (!sameJson(frozenPointer, run.pointer)) {
    return run.pointerBy !== null && sameActorKindAndId(run.pointerBy, WORKFLOW_AUTOMATION_ACTOR)
      ? 'run_ended' : 'person_stopped';
  }
  return run.ended ? 'run_ended' : 'running';
}

/**
 * 叫停的放行判定（AR-01s、AR-02s 共用），取第一条：目标已取消 → 作废；租约已被别的 Run 持有 → 作废，永不对接任者
 * 送；目标已暂停 → 放行、不写暂缓（原 Run 已自然结束时暂停扇出不动它的指针，这条暂缓会挡住恢复后的领取）；
 * 你动过指针 → 放行、不写暂缓（你已接手）；书记硬停或 Run 已结束 → 放行、写暂缓、不送；其余 → 放行、写暂缓、待送。
 * “在跑”只决定送不送：Run 结束了照样写暂缓，挡住检查没过之后的自动再领（A4）。
 */
export function stopReleaseOf(input: {
  goal: GoalDesiredState; leaseHolderRunId: string | null; frozen: StopFrozenV1; run: StopRunFactsV1;
}): StopReleaseV1 {
  if (input.goal === 'cancelled') return { kind: 'void', reason: 'goal_cancelled' };
  if (input.leaseHolderRunId !== input.frozen.run.runId) return { kind: 'void', reason: 'run_replaced' };
  if (input.goal === 'paused') return { kind: 'released', writeHold: false, notSent: 'person_stopped' };
  const check = stopRunCheckOf(input.frozen.pointer, input.run);
  if (check === 'person_stopped') return { kind: 'released', writeHold: false, notSent: 'person_stopped' };
  return { kind: 'released', writeHold: true, notSent: check === 'run_ended' ? 'run_ended' : null };
}

/** 事件里的快照：记录去掉提交绑定的 `since`。 */
export function actionRequestSnapshotOf(record: PendingActionRequestV1): ActionRequestSnapshotV1 {
  const { since: _since, ...snapshot } = record;
  return snapshot;
}
