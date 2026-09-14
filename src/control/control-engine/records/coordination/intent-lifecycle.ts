/** Internal intent-lifecycle commit construction. Control admission remains in the command handler. */
import type { CommunicationClaimCommand, CommunicationIntentCancelRequestCommitV1, CommunicationIntentClaimCommitV1, CommunicationIntentSettleCommitV1, CommunicationIntentSnapshot, CommunicationIntentV1, CommunicationRoutePageCommitV1, CommunicationSettleCommand, DeliverySnapshot, RequestIntentCancellationCommand, RoutePageSubscriptionScopeEntry, SubscriptionSnapshot, WaitConditionSnapshot, WaitConditionV1 } from "../../../../contracts/coordination.js";
import { communicationIntentCancelRequestedEvent, communicationIntentClaimedEvent, communicationIntentRecordedEvent, communicationIntentSettledEvent, deliveryRecordedEvent } from "../../../../contracts/coordination-events.js";
import { waitConditionObservedEvent, waitConditionTimedOutEvent } from "../../../../contracts/coordination-events.js";
import type { CoordinationFoldDeps } from './shared.js';
import { ctxOf } from './shared.js';
import { communicationIntentRefForOf } from './waiting.js';
import { intentSnapshotFor } from './waiting.js';


// ------------------------------------------------------------------------ //
// 机械 intent                                                                //
// ------------------------------------------------------------------------ //

export function buildCommunicationIntentClaimCommit(input: {
  command: CommunicationClaimCommand;
  deps: CoordinationFoldDeps;
  fingerprint: CommunicationIntentClaimCommitV1["fingerprint"];
  prior: CommunicationIntentSnapshot;
  nextGeneration: number;
}): CommunicationIntentClaimCommitV1 {
  const { command, deps, prior } = input;
  const now = deps.now();
  const intent: CommunicationIntentV1 = {
    ...prior.intent,
    status: "leased",
    leaseGeneration: input.nextGeneration,
    leaseOwner: command.payload.consumerId,
    leaseExpiresAt: new Date(Date.parse(now) + command.payload.leaseDurationMs).toISOString(),
    attemptCount: prior.intent.attemptCount + 1,
  };
  const snapshot: CommunicationIntentSnapshot = { ...prior, revision: prior.revision + 1, intent, recordedAt: now };
  return {
    commitKind: "communication-intent-claim",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: [{ ref: prior.ref, revision: command.expectedRevision }],
    events: [communicationIntentClaimedEvent(ctxOf(command, now), deps.eventId(), intent, prior.intent.leaseGeneration, snapshot.revision)],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}


/**
 * 一页路由的原子提交：Deliveries + 页 checkpoint + wait transition + next intent
 * + 当前 intent settle 全部在**同一个 generation-guarded CAS** 里（意图生命周期与可靠投递规则）。
 */
export function buildRoutePageCommit(input: {
  command: CommunicationSettleCommand;
  deps: CoordinationFoldDeps;
  fingerprint: CommunicationRoutePageCommitV1["fingerprint"];
  prior: CommunicationIntentSnapshot;
  deliveries: DeliverySnapshot[];
  subscriptions: SubscriptionSnapshot[];
  waits: WaitConditionSnapshot[];
  nextIntent: CommunicationIntentV1 | null;
}): CommunicationRoutePageCommitV1 {
  const { command, deps, prior } = input;
  const now = deps.now();
  const ctx = ctxOf(command, now);
  /**
   * 协作通信可靠投递规则：**本条 intent 的订阅范围由这一页固定/收敛后落账**。
   *
   * 为什么必须写进 settled intent 的 domain：范围是"本轮"这个事实的一部分，而 intent 的
   * 快照就是这一轮的 canonical 记录。只把它放在下一页 intent 上，会让"单页就结束"的轮次在
   * 账本里看不出范围（协议约束 1.4 的 hasMore/范围规则也就没有可依据的事实）。
   * 取值来自**命令里那一页的 page.subscriptionScope**（Control 已经逐条复核并归一化：范围内
   * 只剩下仍然活跃的订阅），因此与本页处理结果严格同源，不是第二个判定点。
   */
  const pageScope: RoutePageSubscriptionScopeEntry[] =
    command.payload.outcome === "route_page" ? command.payload.page.subscriptionScope : [];
  const domain = prior.intent.domain.kind === "route_page"
    ? { ...prior.intent.domain, subscriptionScope: pageScope.map((entry) => ({
      subscriptionRef: { ...entry.subscriptionRef },
      expectedRevision: entry.expectedRevision,
    })) }
    : prior.intent.domain;
  const intent: CommunicationIntentV1 = { ...prior.intent, domain, status: "done", settledAt: now };
  const intentSnapshot: CommunicationIntentSnapshot = { ...prior, revision: prior.revision + 1, intent, recordedAt: now };
  const events: CommunicationRoutePageCommitV1["events"] = [
    ...input.deliveries.map((snapshot) => deliveryRecordedEvent(ctx, deps.eventId(), snapshot.delivery)),
    ...input.waits.map((w) => waitConditionObservedEvent(ctx, deps.eventId(), w.wait, w.revision)),
    communicationIntentSettledEvent(ctx, deps.eventId(), intent, intentSnapshot.revision),
  ];
  const snapshots: (CommunicationIntentSnapshot | DeliverySnapshot | SubscriptionSnapshot | WaitConditionSnapshot)[] = [
    intentSnapshot,
    ...input.deliveries,
    ...input.subscriptions,
    ...input.waits,
  ];
  const expected: CommunicationRoutePageCommitV1["expectedVersions"] = [
    { ref: prior.ref, revision: command.expectedRevision },
    ...input.subscriptions.map((s) => ({ ref: s.ref, revision: s.revision - 1 })),
    ...input.waits.map((w) => ({ ref: w.ref, revision: w.revision - 1 })),
  ];
  if (input.nextIntent !== null) {
    snapshots.push(intentSnapshotFor(input.nextIntent, now));
    expected.push({ ref: communicationIntentRefForOf(input.nextIntent.projectId, input.nextIntent.workspaceId, input.nextIntent.intentId), revision: 0 });
    // 同上：下一页 intent 的存在也必须是 canonical 事件，否则"回执丢失 + 重启"之后
    // 没有任何消费者能发现它（分页会在重启处永久停住）。
    events.push(communicationIntentRecordedEvent(ctx, deps.eventId(), input.nextIntent));
  }
  return {
    commitKind: "communication-route-page",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: expected,
    events,
    snapshots,
    outboxIntents: [],
  };
}


/**
 * **先持久化取消意图**（协作通信可靠投递规则 / 先记取消意图：desired-state-first）。
 *
 * 纯构造：只把 intent 标记为 cancel_requested，**不改** generation、不写 settledAt、不碰任何
 * 外部能力。执行能力的调用发生在这之后，且必须读到这条已落账的意图。
 * 终态与已 quarantined 的 intent 不允许再被标记（Control 在调用前判定，这里不重复业务规则）。
 */
export function buildIntentCancelRequestCommit(input: {
  command: RequestIntentCancellationCommand;
  deps: CoordinationFoldDeps;
  fingerprint: CommunicationIntentCancelRequestCommitV1["fingerprint"];
  prior: CommunicationIntentSnapshot;
}): CommunicationIntentCancelRequestCommitV1 {
  const { command, deps, prior } = input;
  const now = deps.now();
  const intent: CommunicationIntentV1 = { ...prior.intent, status: "cancel_requested" };
  const snapshot: CommunicationIntentSnapshot = { ...prior, revision: prior.revision + 1, intent, recordedAt: now };
  return {
    commitKind: "communication-intent-cancel-request",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: [{ ref: prior.ref, revision: command.expectedRevision }],
    events: [communicationIntentCancelRequestedEvent(ctxOf(command, now), deps.eventId(), intent, command.payload.reason, snapshot.revision)],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}


/** 非页面的 settle（cancel 确认 / unknown / quarantine / deadline 到点）。 */
export function buildIntentSettleCommit(input: {
  command: CommunicationSettleCommand;
  deps: CoordinationFoldDeps;
  fingerprint: CommunicationIntentSettleCommitV1["fingerprint"];
  prior: CommunicationIntentSnapshot;
  status: CommunicationIntentV1["status"];
  waits: WaitConditionSnapshot[];
}): CommunicationIntentSettleCommitV1 {
  const { command, deps, prior } = input;
  const now = deps.now();
  const payload = command.payload;
  /**
   * 协作通信可靠投递规则：两个**非终态**结果。
   *
   *   · no_effect_failure：已证实没有产生副作用 → retry_scheduled + availableAt = now + backoffMs。
   *     这是退避在当前实现里唯一合法的入口（Control 已拒绝 sideEffectStarted 的 intent 走这条路）。
   *   · side_effect_started：外部副作用**已经开始** → 保持 leased 且把 sideEffectStarted 置 true。
   *     它不是终态，也不改 generation：租约到期以后领取会被判 requires_reconcile，**不构成重跑依据**。
   */
  const nonTerminal =
    payload.outcome === "no_effect_failure" ? "retry_scheduled" as const :
    payload.outcome === "side_effect_started" ? prior.intent.status : null;
  const intent: CommunicationIntentV1 = nonTerminal !== null
    ? {
        ...prior.intent,
        status: nonTerminal,
        availableAt: payload.outcome === "no_effect_failure"
          ? new Date(Date.parse(now) + Math.max(0, payload.backoffMs)).toISOString()
          : prior.intent.availableAt,
        lastFailureClass: payload.outcome === "no_effect_failure" ? payload.reason : prior.intent.lastFailureClass,
        sideEffectStarted: payload.outcome === "side_effect_started" ? true : prior.intent.sideEffectStarted,
        settledAt: prior.intent.settledAt,
      }
    : {
        ...prior.intent,
        status: input.status,
        settledAt: now,
        lastFailureClass:
          payload.outcome === "unknown" || payload.outcome === "quarantine" ? payload.reason : prior.intent.lastFailureClass,
      };
  const snapshot: CommunicationIntentSnapshot = { ...prior, revision: prior.revision + 1, intent, recordedAt: now };
  const ctx = ctxOf(command, now);
  const events: CommunicationIntentSettleCommitV1["events"] = [
    communicationIntentSettledEvent(ctx, deps.eventId(), intent, snapshot.revision),
    ...input.waits.map((w) => waitConditionTimedOutEvent(ctx, deps.eventId(), w.wait, w.revision)),
  ];
  return {
    commitKind: "communication-intent-settle",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: [
      { ref: prior.ref, revision: command.expectedRevision },
      ...input.waits.map((w) => ({ ref: w.ref, revision: w.revision - 1 })),
    ],
    events,
    snapshots: [snapshot, ...input.waits],
    outboxIntents: [],
  };
}


/**
 * 条件已满足但前驱仍在执行：只保存**观察**并重排 intent，**不**创建后继。
 * 当事件已到但前驱尚未结束时，保留可重建的条件观察。
 */
export function buildWaitObservationCommit(input: {
  command: CommunicationSettleCommand;
  deps: CoordinationFoldDeps;
  fingerprint: CommunicationIntentSettleCommitV1["fingerprint"];
  priorIntent: CommunicationIntentSnapshot;
  priorWait: WaitConditionSnapshot;
  satisfiedIndexes: number[];
  note: string;
}): CommunicationIntentSettleCommitV1 {
  const { command, deps, priorIntent, priorWait } = input;
  const now = deps.now();
  const wait: WaitConditionV1 = {
    ...priorWait.wait,
    satisfiedIndexes: [...input.satisfiedIndexes],
    observations: [
      ...priorWait.wait.observations,
      ...input.satisfiedIndexes
        .filter((index) => !priorWait.wait.satisfiedIndexes.includes(index))
        .map((index) => ({ index, observedAt: now, note: input.note })),
    ],
  };
  const waitSnapshot: WaitConditionSnapshot = { ...priorWait, revision: priorWait.revision + 1, wait, recordedAt: now };
  const intent: CommunicationIntentV1 = { ...priorIntent.intent, status: "retry_scheduled", availableAt: now };
  const intentSnapshot: CommunicationIntentSnapshot = { ...priorIntent, revision: priorIntent.revision + 1, intent, recordedAt: now };
  const ctx = ctxOf(command, now);
  return {
    commitKind: "communication-intent-settle",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: [
      { ref: priorIntent.ref, revision: command.expectedRevision },
      { ref: priorWait.ref, revision: priorWait.revision },
    ],
    events: [
      waitConditionObservedEvent(ctx, deps.eventId(), wait, waitSnapshot.revision),
      communicationIntentSettledEvent(ctx, deps.eventId(), intent, intentSnapshot.revision),
    ],
    snapshots: [waitSnapshot, intentSnapshot],
    outboxIntents: [],
  };
}
