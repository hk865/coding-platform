/**
 * 两个动作 owner 的端口：动作请求（问答轮的派活、叫停，设计 3.1–3.4）和暂缓领取（3.3）。消息只带信息；派活、叫停、
 * 暂缓各有自己的记录和规则，由这两个 owner 准入、提交（通信与权限、校验拆开，决定 121-152）。
 *
 * 问答轮的口（受理、暂缓、点名撤、撤回）各判自己的准入：解析出的问答轮非副本、非请求轮，职责是秘书或参谋，并且负责这个
 * 目标（参谋认目标的负责链接；秘书认目标或项目的负责链接），提交时守这一轮的版本和收下它的那条链接的版本。授予（工具挂
 * 不挂）由挂工具的一方核。批准、拒只收 Host 的可信输入（答卡回执），不重新准入；作废、送停、书记原因只收平台自动化身份。
 */
import type { ActionRequestRef } from '../../../contracts/action-request.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { ControlIntentSnapshotV1 } from '../../../contracts/control-intent.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { RunRef, TaskTriple } from '../../../contracts/dispatch.js';
import type { DispatchBasisV1, DispatchCurrentV1 } from '../../../contracts/ledger.js';
import type { TaskClaimHoldRef } from '../../../contracts/task-claim-hold.js';
import type { ActionRequestSnapshotV1, ActionRequestV1, DispatchBlockerV1 } from '../state/action-request.js';
import type { TaskClaimHoldV1 } from '../state/task-claim-hold.js';
import type { GraphWrite } from './task-contracts.js';

/** 派活受理的拒绝：显式 `expected` 对不上时带回当前三值（同发信的做法）。 */
export type ActionRequestRejectionV1 = CoreRejection & { dispatchCurrent?: DispatchCurrentV1 };

type CommittedV1 = { replayed: boolean; cursor: CommitCursor };

export type DispatchRequestInputV1 = {
  taskRef: TaskTriple;
  reason: string;
  /** 首选线：目标循环选线时排第一，不在合格集合里就照常排。 */
  preferredLine?: SessionRef;
  /** 模型读到的三值；缺了由平台代填，给了对不上是 `revision_conflict`。 */
  expected?: DispatchBasisV1;
};
export type DispatchRequestResultV1 =
  /** 收下了（自动档或规则命中）：请求留着，能领时目标循环先领它；`blockedBy` 是此刻读得到的挡着的原因。 */
  | ({ status: 'requested'; actionRef: ActionRequestRef; blockedBy: DispatchBlockerV1[] } & CommittedV1)
  /** 「每步确认」：等你批。 */
  | ({ status: 'needs_decision'; actionRef: ActionRequestRef } & CommittedV1)
  /** 这个任务已有在等的派活请求：回那一条，不另建。 */
  | { status: 'already_requested'; actionRef: ActionRequestRef }
  | ActionRequestRejectionV1;

export type StopRequestInputV1 = { taskRef: TaskTriple; reason: string };
export type StopRequestResultV1 =
  /** 当场放行：写了 `stop` 原因的暂缓（`holdReasonId`）；`notSent` 非空就不送停。 */
  | ({ status: 'released'; actionRef: ActionRequestRef; holdReasonId: string | null;
    notSent: 'person_stopped' | 'run_ended' | null } & CommittedV1)
  | ({ status: 'void'; actionRef: ActionRequestRef; reason: string } & CommittedV1)
  | ({ status: 'needs_decision'; actionRef: ActionRequestRef } & CommittedV1)
  | CoreRejection;

/** 答卡 ② 适配器交来的可信输入（照返工请求的批准落实）：请求、它的版本、命令号、正式答复。 */
export type ActionRequestAnswerV1 = {
  request: ActionRequestRef; revision: number; commandId: string; answerRef: SessionMessageRef;
};

export type DeliverStopResultV1 =
  /** 送停的意图（这次提交的，或先前已提交的）。 */
  | { status: 'steer'; intent: ControlIntentSnapshotV1; replayed: boolean }
  /** 没送：你已接手，或原 Run 已结束；记在请求上（AR-07）。 */
  | ({ status: 'not_sent'; request: ActionRequestSnapshotV1 } & CommittedV1)
  /** 请求不是“放行了、还没送”：原样回。 */
  | { status: 'unchanged'; request: ActionRequestV1 }
  | CoreRejection;

export interface ActionRequestPort {
  requestDispatch(ctx: CoreCallContext, request: GraphWrite<DispatchRequestInputV1>): Promise<DispatchRequestResultV1>;
  requestStop(ctx: CoreCallContext, request: GraphWrite<StopRequestInputV1>): Promise<StopRequestResultV1>;
  approve(ctx: CoreCallContext, input: ActionRequestAnswerV1): Promise<WriteResult<ActionRequestSnapshotV1>>;
  deny(ctx: CoreCallContext, input: ActionRequestAnswerV1): Promise<WriteResult<ActionRequestSnapshotV1>>;
  withdraw(ctx: CoreCallContext, request: GraphWrite<{ request: ActionRequestRef }>):
    Promise<WriteResult<ActionRequestSnapshotV1>>;
  settle(ctx: CoreCallContext, request: GraphWrite<{ request: ActionRequestRef; reason: string }>):
    Promise<WriteResult<ActionRequestSnapshotV1>>;
  deliverStop(ctx: CoreCallContext, input: { request: ActionRequestRef }): Promise<DeliverStopResultV1>;
  readRequest(ctx: CoreCallContext, input: { ref: ActionRequestRef }): Promise<ReadResult<ActionRequestV1>>;
}

/** 暂缓写口的回执：哪条暂缓、写成的版本、放下或点名撤的那条原因（撤全部是 `null`）。 */
export type ClaimHoldWriteV1 = { hold: TaskClaimHoldRef; revision: number; reasonId: string | null };
export type ClaimHoldResultV1 =
  | WriteResult<ClaimHoldWriteV1>
  /** 同一来源已放着、要撤的已撤：原样回，没写。 */
  | { status: 'unchanged'; value: ClaimHoldWriteV1 };

export type ScribeStopInputV1 = {
  taskRef: TaskTriple; reason: string; sourceMessage: SessionMessageRef; run: RunRef; operationId: string;
};

export interface ClaimHoldPort {
  place(ctx: CoreCallContext, request: GraphWrite<{ taskRef: TaskTriple; reason: string }>): Promise<ClaimHoldResultV1>;
  placeScribeStop(ctx: CoreCallContext, request: GraphWrite<ScribeStopInputV1>): Promise<ClaimHoldResultV1>;
  release(ctx: CoreCallContext, request: GraphWrite<{ taskRef: TaskTriple; reasonId: string; note?: string }>):
    Promise<ClaimHoldResultV1>;
  releaseAll(ctx: CoreCallContext, request: GraphWrite<{ taskRef: TaskTriple }>): Promise<ClaimHoldResultV1>;
  readHold(ctx: CoreCallContext, input: { taskRef: TaskTriple }): Promise<ReadResult<TaskClaimHoldV1>>;
}
