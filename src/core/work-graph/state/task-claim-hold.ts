/**
 * 暂缓领取 `TaskClaimHold`（设计 3.3；A4、A14 的一半；重裁 5）：每个任务一条，固定键。暂缓原因列表加两个卡位：
 * `pendingStop`（在等你批的叫停卡，挡领取）和 `openDispatch`（在等的派活请求，不挡任何东西，只给领取那次了结它）。
 *
 * 一次提交里对它的改动从读到的记录（或不存在）起：`nextTaskClaimHold` 先定下一版（`+1`），再用下面的纯函数一步步叠
 * （放原因、点名撤、撤全部、占和让两个卡位），最后编码写入。各 owner（暂缓、动作请求、领取）都只经这里改它。
 *
 * 每个原因的 `since` 是放下那次提交的游标（Q4b：只存原始事实和游标，失效由读的一方推），新放的写 `null` 占位，由提交
 * 绑定（`reasons[].since`，Store 只填 null 元素、已绑定的保留）；叫停批准时的 `stop` 原因照抄请求的受理游标。
 * 这个文件只依赖 `src/contracts` 和本目录（纯 `state/` 模块）。
 */
import type { ActionRequestRef } from '../../../contracts/action-request.js';
import { defineRecord, f, type InferPending, type InferRecord } from '../../../contracts/data-format.js';
import {
  ActionRequestRefShape, QueryRunRefShape, RunRefShape, SessionMessageRefShape, SessionRefShape, TaskClaimHoldRefShape,
} from '../../../contracts/data-format-refs.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import type { TaskClaimHoldRef } from '../../../contracts/task-claim-hold.js';
import { ROUND_BASIS_FIELDS } from './action-request.js';

const id = f.string({ min: 1, unit: 'codePoints' });

/** 谁放的：一条线的问答轮、一条叫停请求的放行、或平台（书记的长命令审查，按操作号）。 */
const PLACED_BY_FIELD = f.union('kind', {
  agent: {
    kind: f.literal('agent'), session: f.ref(SessionRefShape), queryRun: f.ref(QueryRunRefShape),
    duty: f.enumOf(['secretary', 'adviser'] as const),
  },
  action: { kind: f.literal('action'), actionRef: f.ref(ActionRequestRefShape) },
  platform: { kind: f.literal('platform'), operationId: id },
});

/** 失效认的来源（原始事实）：`agent`、`stop` 是放下或受理那一轮；`scribe_stop` 是这次审查的来源消息和原 Run。 */
const BASIS_FIELD = f.union('kind', {
  round: { kind: f.literal('round'), ...ROUND_BASIS_FIELDS },
  scribe: { kind: f.literal('scribe'), sourceMessage: f.ref(SessionMessageRefShape), run: f.ref(RunRefShape) },
});

/** 谁撤的：一条线点名撤、你撤全部（任务卡上的“撤销暂缓”）、你的直接干预领取撤全部。 */
const RELEASED_BY_FIELD = f.union('kind', {
  agent: { kind: f.literal('agent'), session: f.ref(SessionRefShape) },
  person: { kind: f.literal('person'), actor: f.object({ kind: f.enumOf(['human', 'system'] as const), id }) },
  intervention: { kind: f.literal('intervention'), messageRef: f.ref(SessionMessageRefShape) },
});

const TASK_CLAIM_HOLD_REASON_FIELDS = {
  id,
  kind: f.enumOf(['agent', 'stop', 'scribe_stop'] as const),
  placedBy: PLACED_BY_FIELD,
  basis: BASIS_FIELD,
  reason: id,
  placedAt: f.isoTime(),
  since: f.boundCursor('reasons[].since'),
  state: f.enumOf(['held', 'released'] as const),
  releasedBy: f.nullable(RELEASED_BY_FIELD),
  releaseNote: f.nullable(id),
};

const TASK_CLAIM_HOLD_FIELDS = {
  ref: f.ref(TaskClaimHoldRefShape),
  revision: f.revision({ min: 1 }),
  schemaVersion: f.literal(1),
  workspaceId: id,
  reasons: f.array(f.object(TASK_CLAIM_HOLD_REASON_FIELDS)),
  pendingStop: f.nullable(f.ref(ActionRequestRefShape)),
  openDispatch: f.nullable(f.ref(ActionRequestRefShape)),
};

export type TaskClaimHoldV1 = InferRecord<typeof TASK_CLAIM_HOLD_FIELDS>;
/** 提交前的形状：新放的原因 `since` 为 `null`，由提交绑定。 */
export type PendingTaskClaimHoldV1 = InferPending<typeof TASK_CLAIM_HOLD_FIELDS>;
export type TaskClaimHoldReasonV1 = TaskClaimHoldV1['reasons'][number];
export type PendingTaskClaimHoldReasonV1 = PendingTaskClaimHoldV1['reasons'][number];
export type HoldReleasedByV1 = NonNullable<TaskClaimHoldReasonV1['releasedBy']>;
/** 新放的原因：状态和撤的信息由这里定。 */
export type NewHoldReasonV1 = Pick<PendingTaskClaimHoldReasonV1, 'id' | 'kind' | 'placedBy' | 'basis' | 'reason' | 'placedAt' | 'since'>;

export const TASK_CLAIM_HOLD_FORMAT = defineRecord({
  name: 'TaskClaimHold',
  schemaId: 'TaskClaimHold@1',
  aggregateType: 'TaskClaimHold',
  fields: TASK_CLAIM_HOLD_FIELDS,
});

/** 一个任务的暂缓记录的固定引用。 */
export function taskClaimHoldRefOf(task: { projectId: string; goalId: string; taskId: string }): TaskClaimHoldRef {
  return { aggregateType: 'TaskClaimHold', projectId: task.projectId, goalId: task.goalId, taskId: task.taskId };
}

/** 这次提交写的下一版：读到的记录 `+1`，不存在时是空的第一版。之后的纯函数只叠内容，不再动版本。 */
export function nextTaskClaimHold(
  current: TaskClaimHoldV1 | null, base: { ref: TaskClaimHoldRef; workspaceId: string },
): PendingTaskClaimHoldV1 {
  if (current !== null) return { ...current, revision: current.revision + 1 };
  return { ref: base.ref, revision: 1, schemaVersion: 1, workspaceId: base.workspaceId, reasons: [],
    pendingStop: null, openDispatch: null };
}

/** 放一个原因。同一个放的人、同一份来源已经 held 就原样（`placed: false`，回那条）；不同来源各成一条，各自撤。 */
export function placeHoldReason(
  hold: PendingTaskClaimHoldV1, reason: NewHoldReasonV1,
): { hold: PendingTaskClaimHoldV1; reasonId: string; placed: boolean } {
  const placedBy = canonicalKey(reason.placedBy);
  const basis = canonicalKey(reason.basis);
  for (const held of hold.reasons as readonly PendingTaskClaimHoldReasonV1[]) {
    if (held.state === 'held' && canonicalKey(held.placedBy) === placedBy && canonicalKey(held.basis) === basis) {
      return { hold, reasonId: held.id, placed: false };
    }
  }
  const next: PendingTaskClaimHoldReasonV1 = { ...reason, state: 'held', releasedBy: null, releaseNote: null };
  return { hold: { ...hold, reasons: [...hold.reasons as readonly PendingTaskClaimHoldReasonV1[], next] },
    reasonId: reason.id, placed: true };
}

/** 点名撤一个原因；已撤的原样（`released: false`），没有这个原因是 `null`。 */
export function releaseHoldReason(
  hold: PendingTaskClaimHoldV1, reasonId: string, by: HoldReleasedByV1, note: string | null,
): { hold: PendingTaskClaimHoldV1; released: boolean } | null {
  let target: PendingTaskClaimHoldReasonV1 | undefined;
  for (const reason of hold.reasons as readonly PendingTaskClaimHoldReasonV1[]) if (reason.id === reasonId) target = reason;
  if (target === undefined) return null;
  if (target.state === 'released') return { hold, released: false };
  return { hold: withReasons(hold, (reason) => reason.id === reasonId ? releasedReason(reason, by, note) : reason), released: true };
}

function releasedReason(reason: PendingTaskClaimHoldReasonV1, by: HoldReleasedByV1, note: string | null): PendingTaskClaimHoldReasonV1 {
  return { ...reason, state: 'released', releasedBy: by, releaseNote: note };
}

function withReasons(
  hold: PendingTaskClaimHoldV1, change: (reason: PendingTaskClaimHoldReasonV1) => PendingTaskClaimHoldReasonV1,
): PendingTaskClaimHoldV1 {
  const reasons: PendingTaskClaimHoldReasonV1[] = [];
  for (const reason of hold.reasons as readonly PendingTaskClaimHoldReasonV1[]) reasons.push(change(reason));
  return { ...hold, reasons };
}

/**
 * 撤掉全部 held 的原因（含 `scribe_stop`）：你点“撤销暂缓”，或你的直接干预领取同次撤（Q6a）。`pendingStop` 不是原因，
 * 随那张卡关，不动。
 */
export function releaseAllHoldReasons(hold: PendingTaskClaimHoldV1, by: HoldReleasedByV1): PendingTaskClaimHoldV1 {
  return withReasons(hold, (reason) => reason.state === 'held' ? releasedReason(reason, by, null) : reason);
}

/** 占一个卡位。owner 在受理时已经按读到的卡位拒了（已有派活回那条、已有叫停卡 busy），所以这里只会占空的。 */
export function occupyHoldPointer(
  hold: PendingTaskClaimHoldV1, pointer: 'pendingStop' | 'openDispatch', actionRef: ActionRequestRef,
): PendingTaskClaimHoldV1 {
  return { ...hold, [pointer]: { ...actionRef } };
}

/** 让出一个卡位：只在它还指着这条请求时清掉。 */
export function yieldHoldPointer(
  hold: PendingTaskClaimHoldV1, pointer: 'pendingStop' | 'openDispatch', actionRef: ActionRequestRef,
): PendingTaskClaimHoldV1 {
  const current = hold[pointer];
  return current !== null && canonicalKey(current) === canonicalKey(actionRef) ? { ...hold, [pointer]: null } : hold;
}

/** 有新放的原因在等提交绑定游标：提交要带 `reasons[].since` 这一条绑定。 */
export function holdAwaitsCursor(hold: PendingTaskClaimHoldV1): boolean {
  return hold.reasons.some((reason) => reason.since === null);
}

/**
 * 书记硬停过这个任务、那条原因还 held：平台的自动返工要等负责参谋或你撤了它才开（2.6、A14；重验不看它，Q9）。
 * task-gate 的等待和返工 owner 的 `system` 拒绝都只经这一处判。
 */
export function scribeStopHeld(hold: Pick<TaskClaimHoldV1, 'reasons'> | null): boolean {
  if (hold === null) return false;
  for (const reason of hold.reasons) if (reason.kind === 'scribe_stop' && reason.state === 'held') return true;
  return false;
}

/** 挡着领取的那一条：held 的原因（谁放的、理由），或在等你批的叫停卡。 */
export type HoldBlockerV1 =
  | { kind: 'held'; reason: Pick<PendingTaskClaimHoldReasonV1, 'placedBy' | 'reason'> }
  | { kind: 'stop_pending'; actionRef: ActionRequestRef };

/**
 * 挡不挡领取：第一条 held 的原因，否则在等的叫停卡，否则不挡。`openDispatch` 不挡任何东西（S1）。领取用的是这次
 * 提交要写的那一版（干预领取先撤全部再问它，所以只剩叫停卡挡）。
 */
export function holdBlockerOf(hold: PendingTaskClaimHoldV1 | null): HoldBlockerV1 | null {
  if (hold === null) return null;
  for (const reason of hold.reasons as readonly PendingTaskClaimHoldReasonV1[]) {
    if (reason.state === 'held') return { kind: 'held', reason: { placedBy: reason.placedBy, reason: reason.reason } };
  }
  return hold.pendingStop === null ? null : { kind: 'stop_pending', actionRef: hold.pendingStop };
}
