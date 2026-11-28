/**
 * 一个 Goal 从哪来，读的时候推出来，不存在 Goal 上（决定 49 第 21 项 (a)）。
 *
 * 人在已完成 Goal 的线上说新工作，平台开一条不挂 Goal 的请求，请求根轮记下来源：那个已完成的 Goal 和人说的那句话
 * （`interventionSource`）。请求出的目标卡确认成新 Goal 时写一条初始化绑定，绑定记着请求。所以新 Goal → 绑定 →
 * 请求根轮 → 来源。选线（首版计划的任务先给人说话的那条线）和目标列表（“接着哪个目标之后加的工作”）读这一份。
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { canonicalKey as keyOf } from '../../../contracts/fingerprint.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { QueryJobRef } from '../../../contracts/query-job.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import { decodeQueryJobSnapshot } from '../queries/query-record-codecs.js';
import { createInitializationBindingReader } from './goal-confirm-service.js';
import { readOwnerRecord } from './owner-record-read.js';

/** 新 Goal 接着哪个已完成的 Goal，和人在那条线上说的那句话；主对话来的来源没有消息。 */
export type GoalOriginV1 = { sourceGoal: GoalRef; messageRef: SessionMessageRef | null };

/**
 * 建出这个 Goal 的请求，和它的来源（没有来源时 `source` 为 null）。没有初始化绑定（`goals/create` 建的）是 null。
 * 一张卡只确认一次，所以取第一条绑定。只读；读失败原样返回，不当成“没有请求”。
 */
export type GoalCreationRequestV1 = {
  requestRef: QueryJobRef;
  source: { goalRef: GoalRef; messageRef: SessionMessageRef | null } | null;
};

/**
 * 建出这个 Goal 的请求：Goal → 初始化绑定（取第一条）→ 绑定记着的请求根轮 → 根轮的 `interventionSource`。
 * 没有绑定是 null，请求没有来源是 `source: null`；读失败原样返回，不当成“没有请求”。
 */
export async function readGoalCreationRequest(
  records: Pick<GoalRecordTransactionPort, 'readMany'> & Pick<RecordLookupPort, 'lookup'>,
  ctx: CoreCallContext, goalRef: GoalRef,
): Promise<ReadResult<GoalCreationRequestV1 | null>> {
  const bindings = await createInitializationBindingReader({ records }).readBindingByGoal(ctx, { goalRef });
  if (bindings.status !== 'ready') return bindings;
  const binding = bindings.value[0];
  if (binding === undefined) return { status: 'ready', value: null };
  const root = await readOwnerRecord({ store: records, refKey: keyOf(binding.requestRef),
    decode: decodeQueryJobSnapshot,
    readError: message => rejected('unavailable', `the Goal's request could not be read: ${message}`) });
  if (!root.ok) {
    return 'rejection' in root ? root.rejection
      : rejected('unavailable', `the Goal's request ${binding.requestRef.queryJobId} is missing`);
  }
  const source = root.value.job.interventionSource;
  return { status: 'ready', value: {
    requestRef: { ...binding.requestRef },
    source: source === undefined ? null
      : { goalRef: { ...source.goalRef },
          messageRef: source.messageRef === null ? null : { ...source.messageRef } },
  } };
}

/**
 * 一个 Goal 的来源。没有初始化绑定、请求没有来源都是 null。只读；读失败原样返回，不当成“没有来源”。
 */
export async function readGoalOrigin(
  records: Pick<GoalRecordTransactionPort, 'readMany'> & Pick<RecordLookupPort, 'lookup'>,
  ctx: CoreCallContext, goalRef: GoalRef,
): Promise<ReadResult<GoalOriginV1 | null>> {
  const creation = await readGoalCreationRequest(records, ctx, goalRef);
  if (creation.status !== 'ready') return creation;
  if (creation.value === null || creation.value.source === null) return { status: 'ready', value: null };
  return { status: 'ready', value: {
    sourceGoal: { ...creation.value.source.goalRef },
    messageRef: creation.value.source.messageRef === null ? null : { ...creation.value.source.messageRef },
  } };
}
