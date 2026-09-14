/** Internal subscription commit construction. Control admission remains in the command handler. */
/**
 * Control 持有的协作通信 canonical 记录构造（确定性 fold）。
 * 这里只做纯构造：业务准入守卫在 handlers 里，事务权威在 StateLedger。
 */
import type { CommitCursor } from "../../../../contracts/command-event.js";
import type { CancelCommunicationCommand, CommunicationIntentV1, SubscribeCommand, SubscriptionCancelCommitV1, SubscriptionCatchupCommitV1, SubscriptionCreateCommitV1, SubscriptionSnapshot, SubscriptionV1 } from "../../../../contracts/coordination.js";
import { communicationIntentRecordedEvent, subscriptionCancelledEvent, subscriptionCreatedEvent } from "../../../../contracts/coordination-events.js";
import { subscriptionCatchupPlannedEvent } from "../../../../contracts/coordination-events.js";
import type { CoordinationFoldDeps } from './shared.js';
import { ctxOf } from './shared.js';
import { communicationIntentRefForOf } from './waiting.js';
import { intentSnapshotFor } from './waiting.js';


// ------------------------------------------------------------------------ //
// Subscription（订阅路由）                                                        //
// ------------------------------------------------------------------------ //

export function buildSubscriptionCreateCommit(input: {
  command: SubscribeCommand;
  deps: CoordinationFoldDeps;
  fingerprint: SubscriptionCreateCommitV1["fingerprint"];
}): SubscriptionCreateCommitV1 {
  const { command, deps } = input;
  const workspaceId = deps.workspaceId;
  const now = deps.now();
  const subscription: SubscriptionV1 = {
    schemaVersion: 1,
    subscriptionId: command.aggregateId,
    projectId: command.identity.projectId,
    workspaceId,
    ownerWorkContextRef: command.payload.ownerWorkContextRef,
    ownerParticipationRef: command.payload.ownerParticipationRef,
    topics: [...command.payload.topics],
    startCursor: command.payload.startCursor,
    routedThroughCursor: null,
    status: "active",
    createdAt: now,
    cancelledAt: null,
  };
  const snapshot: SubscriptionSnapshot = {
    ref: { aggregateType: "Subscription", projectId: command.identity.projectId, workspaceId, subscriptionId: command.aggregateId },
    revision: 1,
    schemaVersion: 1,
    subscription,
    recordedAt: now,
  };
  return {
    commitKind: "subscription-create",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: [{ ref: snapshot.ref, revision: 0 }],
    events: [subscriptionCreatedEvent(ctxOf(command, now), deps.eventId(), subscription)],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}


export function buildSubscriptionCancelCommit(input: {
  command: CancelCommunicationCommand;
  deps: CoordinationFoldDeps;
  fingerprint: SubscriptionCancelCommitV1["fingerprint"];
  prior: SubscriptionSnapshot;
}): SubscriptionCancelCommitV1 {
  const { command, deps, prior } = input;
  const now = deps.now();
  const subscription: SubscriptionV1 = { ...prior.subscription, status: "cancelled", cancelledAt: now };
  const snapshot: SubscriptionSnapshot = { ...prior, revision: prior.revision + 1, subscription, recordedAt: now };
  return {
    commitKind: "subscription-cancel",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: [{ ref: prior.ref, revision: command.expectedRevision }],
    events: [subscriptionCancelledEvent(ctxOf(command, now), deps.eventId(), subscription, snapshot.revision)],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}


/**
 * subscription-catchup：把"从现在起"的订阅锚定到观察到的 frontier，并为每个 topic
 * 建立首个 route intent（形状见 contracts/coordination.ts 的 SubscriptionCatchupCommitV1）。
 *
 * 本函数是纯构造：frontier 由调用方（Control handler）读账本得到，这里不读任何 I/O。
 */
export function buildSubscriptionCatchupCommit(input: {
  command: SubscribeCommand;
  deps: CoordinationFoldDeps;
  fingerprint: SubscriptionCatchupCommitV1["fingerprint"];
  prior: SubscriptionSnapshot;
  frontierCursor: CommitCursor | null;
  intents: CommunicationIntentV1[];
}): SubscriptionCatchupCommitV1 {
  const { command, deps, prior } = input;
  const now = deps.now();
  const subscription: SubscriptionV1 = {
    ...prior.subscription,
    // 锚定在观察到的 frontier：订阅之前（含 frontier 位置）的事件不会被补投。
    startCursor: input.frontierCursor,
  };
  const snapshot: SubscriptionSnapshot = { ...prior, revision: prior.revision + 1, subscription, recordedAt: now };
  const ctx = ctxOf(command, now);
  return {
    commitKind: "subscription-catchup",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: [
      { ref: prior.ref, revision: prior.revision },
      ...input.intents.map((intent) => ({
        ref: communicationIntentRefForOf(intent.projectId, intent.workspaceId, intent.intentId),
        revision: 0,
      })),
    ],
    events: [
      subscriptionCatchupPlannedEvent(ctx, deps.eventId(), subscription, snapshot.revision, input.frontierCursor, input.intents),
      ...input.intents.map((intent) => communicationIntentRecordedEvent(ctx, deps.eventId(), intent)),
    ],
    snapshots: [snapshot, ...input.intents.map((intent) => intentSnapshotFor(intent, now))],
    outboxIntents: [],
  };
}
