/**
 * 动作请求的 RecordStore 适配：一个记录编解码、一个事件 `ActionRequestChanged` 和两种后端都注册的 schema 组。字段表
 * 在 `state/action-request.ts`（纯 `state/` 模块不能依赖 Store 适配），同 `state/rework-request.ts` +
 * `tasks/rework-request-codecs.ts` 的分法。
 *
 * 事件带这次的变化、提交的身份和指纹、记录快照（去掉提交绑定的 `since`）；派活受理那次另带当时读到的挡着的原因，
 * 重放按事件回同一张回执。
 */
import type { ActionRequestRef } from '../../../contracts/action-request.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import { defineEvent, f, type InferEvent } from '../../../contracts/data-format.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import type {
  DecodeResult, EncodedDomainEvent, GoalRecordTransactionPort, RecordBackendSchemas,
} from '../../record-store/ports.js';
import { createEventCodec, createRecordCodec, formatSchemas } from '../persistence/field-table-codec.js';
import { readOwnerRecord } from '../persistence/owner-record-read.js';
import {
  ACTION_REQUEST_BODY_FIELDS, ACTION_REQUEST_CHANGES, ACTION_REQUEST_FORMAT, DISPATCH_BLOCKER_FIELD,
  type ActionRequestV1,
} from '../state/action-request.js';

const id = f.string({ min: 1, unit: 'codePoints' });

const ACTION_REQUEST_CHANGED_FIELDS = {
  identityKey: id,
  fingerprint: id,
  change: f.enumOf(ACTION_REQUEST_CHANGES),
  request: f.object(ACTION_REQUEST_BODY_FIELDS),
  blockedBy: f.optional(f.array(DISPATCH_BLOCKER_FIELD)),
};

const ACTION_REQUEST_CHANGED_FORMAT = defineEvent({
  name: 'ActionRequestChanged',
  eventType: 'ActionRequestChanged',
  schemaVersion: 1,
  fields: ACTION_REQUEST_CHANGED_FIELDS,
});

export type ActionRequestChanged = InferEvent<'ActionRequestChanged', typeof ACTION_REQUEST_CHANGED_FIELDS>;

export const actionRequestCodec = createRecordCodec(ACTION_REQUEST_FORMAT);
export const actionRequestChangedCodec = createEventCodec(ACTION_REQUEST_CHANGED_FORMAT);

/** 记录和事件一组注册；Store 按记录的 schema 绑定 `since`。 */
export const ACTION_REQUEST_RECORD_SCHEMAS: RecordBackendSchemas = formatSchemas([
  actionRequestCodec, actionRequestChangedCodec,
]);

/** 解码一个存下或重放的 `ActionRequestChanged`；别的事件或坏载荷关着失败。 */
export function actionRequestChangedEventFromEvent(event: EncodedDomainEvent): DecodeResult<ActionRequestChanged> {
  return actionRequestChangedCodec.decode(event);
}

/** 按引用读一条动作请求（不存在是 `null`）：动作 owner 自己，和暂缓 owner 认叫停原因的请求方，都经这一处读。 */
export async function readActionRequestRecord(
  records: Pick<GoalRecordTransactionPort, 'readMany'>, ref: ActionRequestRef,
): Promise<{ status: 'ready'; record: ActionRequestV1 | null } | CoreRejection> {
  const read = await readOwnerRecord({ store: records, refKey: canonicalKey(ref), decode: actionRequestCodec.decode,
    readError: (message) => rejected('unavailable', `the action request cannot be read: ${message}`) });
  if ('rejection' in read) return read.rejection;
  return { status: 'ready', record: 'notFound' in read ? null : read.value };
}
