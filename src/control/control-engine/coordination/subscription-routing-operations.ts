import type { CommitCursor } from '../../../contracts/command-event.js';
import type { WorkContextBindingSnapshot,WorkContextRef } from '../../../contracts/context-continuity.js';
import {
communicationIntentSettledEvent,
deliveryRecordedEvent,
waitConditionObservedEvent,
} from '../../../contracts/coordination-events.js';
import type {
CommunicationIntentSnapshot,
CommunicationIntentV1,
CommunicationSettleCommand,
CommunicationSettleReceipt,
CommunicationWriteReceipt,
DeliverySnapshot,
DeliveryV1,
DirectedRequestSnapshot,
RoutePageSubscriptionScopeEntry,
SubscribeCommand,
SubscriptionRef,
SubscriptionSnapshot,
WaitConditionRef,
WaitConditionSnapshot,
WaitConditionTermV1,
WorkParticipationRef,
WorkParticipationSnapshot,
} from '../../../contracts/coordination.js';
import {
COMMUNICATION_PAGE_MAX_DELIVERIES,
communicationIntentRefFor,
communicationSettleFingerprint,
communicationSource,
deliveryRefFor,
selectCatchupPrefix,
subscribeFingerprint,
SUBSCRIPTION_MAX_REPLAY_SPAN,
SUBSCRIPTION_MAX_TOPICS,
subscriptionDeliveryIdFor,
} from '../../../contracts/coordination.js';
import type { RunSnapshot } from "../../../contracts/dispatch.js";
import { canonicalJson,sha256Hex } from '../../../contracts/fingerprint.js';
import { makeCommitCursor,seqOfCommitCursor } from '../../../contracts/ledger.js';
import { dedupePageDeliveries,pageDelivery } from '../policies/coordination-rules.js';
import {
buildRoutePageCommit,
buildSubscriptionCreateCommit,
deliveryRefForOf,
routePageIntentFor,
type CoordinationFoldDeps,
} from '../records/coordination.js';
import {
checkAgentAttribution,
checkCommandShape,
checkParticipationRef,
checkWorkContextRef,
isLedgerCursor,
mapCommitReceipt,
mapSettleCommitRejection,
rejectWrite,
requireString
} from './admission-support.js';
import { readMailboxView } from './mailbox-view.js';
import { CoordinationOperationContext } from './operation-context.js';

/** Complete Control admission operations for this coordination responsibility. */
export class SubscriptionRoutingOperations {
  constructor(private readonly context: CoordinationOperationContext) {}

  // --------------------------------------------------------------------- //
  // 5. createSubscription                                                  //
  // --------------------------------------------------------------------- //

  async createSubscription(command: SubscribeCommand): Promise<CommunicationWriteReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "CreateSubscription", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    const scopeWorkspace = workspaceId ?? "";
    checkWorkContextRef(payload["ownerWorkContextRef"], "payload.ownerWorkContextRef", command.identity.projectId, scopeWorkspace, issues);
    checkParticipationRef(payload["ownerParticipationRef"], "payload.ownerParticipationRef", command.identity.projectId, scopeWorkspace, issues);
    if (command.expectedRevision !== 0) issues.push("expectedRevision 必须是 0（订阅只创建一次）");
    const topics = payload["topics"];
    if (!Array.isArray(topics)) {
      issues.push("payload.topics 必须是数组");
    } else {
      if (topics.length > SUBSCRIPTION_MAX_TOPICS) {
        issues.push("payload.topics 超过上界 " + String(SUBSCRIPTION_MAX_TOPICS));
      }
      const seen = new Set<string>();
      for (const topic of topics) {
        if (typeof topic !== "string" || topic.length === 0) {
          issues.push("payload.topics 每一项都必须是非空字符串");
          break;
        }
        if (seen.has(topic)) {
          issues.push("payload.topics 不允许重复：" + topic);
          break;
        }
        seen.add(topic);
      }
    }
    const startCursor = payload["startCursor"];
    if (startCursor !== null && startCursor !== undefined && !isLedgerCursor(startCursor)) {
      issues.push("payload.startCursor 必须是账本游标或 null");
    }
    if (issues.length > 0) {
      const overLimit = topics !== undefined && Array.isArray(topics) && topics.length > SUBSCRIPTION_MAX_TOPICS;
      return rejectWrite(command.commandId, overLimit ? "over_limit" : "invalid", issues);
    }

    const ownerWorkContextRef = payload["ownerWorkContextRef"] as WorkContextRef;
    const ownerParticipationRef = payload["ownerParticipationRef"] as WorkParticipationRef;

    const attribution: string[] = [];
    checkAgentAttribution(
      command.identity,
      {
        agentInstanceId: command.identity.actor.kind === "agent" ? command.identity.actor.id : "",
        workContextRef: ownerWorkContextRef,
        participationRef: ownerParticipationRef,
        runRef: command.identity.actor.kind === "agent" ? command.identity.actor.runRef : ({ aggregateType: "Run", projectId: "", goalId: "", runId: "" } as RunSnapshot["ref"]),
        required: true,
      },
      attribution,
    );
    if (attribution.length > 0) return rejectWrite(command.commandId, "forbidden", attribution);

    const participation = await this.context.loadTyped<WorkParticipationSnapshot>(ownerParticipationRef, "WorkParticipation");
    if (participation === null) return rejectWrite(command.commandId, "not_found", ["owner participation 不存在：" + ownerParticipationRef.participationId]);
    if (participation.participation.status !== "active") {
      return rejectWrite(command.commandId, "forbidden", ["owner participation 不是 active：" + participation.participation.status]);
    }
    if (canonicalJson(participation.participation.workContextRef) !== canonicalJson(ownerWorkContextRef)) {
      return rejectWrite(command.commandId, "forbidden", ["owner participation 不属于 owner Work"]);
    }
    const ownerBinding = await this.context.loadTyped<WorkContextBindingSnapshot>(ownerWorkContextRef, "WorkContextBinding");
    if (ownerBinding === null) return rejectWrite(command.commandId, "not_found", ["owner Work 不存在：" + ownerWorkContextRef.workId]);

    const foldDeps = this.context.foldDeps(workspaceId as string);
    const batch = buildSubscriptionCreateCommit({
      command,
      deps: foldDeps,
      fingerprint: subscribeFingerprint(command),
    });
    const receipt = await this.context.deps.ledger.commit(batch);
    return mapCommitReceipt(receipt, command.commandId, canonicalJson(batch.snapshots[0]!.ref));
  }



  /**
   * Settle one canonical route page after intent lifecycle has verified the
   * current lease owner, generation, outcome shape and expected intent revision.
   * This operation owns route proposal normalization, subscription/wait reads,
   * all business aggregate expected versions and the single atomic commit.
   */
  async settleRoutePage(
    command: CommunicationSettleCommand,
    prior: CommunicationIntentSnapshot,
  ): Promise<CommunicationSettleReceipt> {
    const projectId = command.identity.projectId;
    const workspaceId = command.payload.workspaceId;
    const payload = command.payload as unknown as Record<string, unknown>;
    const foldDeps = this.context.foldDeps(workspaceId);
    const built = await this.buildRoutePage(command, foldDeps, prior, payload, projectId, workspaceId);
    if (built.status === 'rejected') return built.receipt;

    // The committed page uses the canonical scope that Control reread and
    // normalized. The command fingerprint continues to cover caller input.
    const committedCommand: CommunicationSettleCommand = command.payload.outcome === 'route_page'
      ? {
        ...command,
        payload: {
          ...command.payload,
          page: { ...command.payload.page, subscriptionScope: built.subscriptionScope },
        },
      }
      : command;
    const batch = buildRoutePageCommit({
      command: committedCommand,
      deps: foldDeps,
      fingerprint: communicationSettleFingerprint(command),
      prior,
      deliveries: built.deliveries,
      subscriptions: built.subscriptions,
      waits: built.waits,
      nextIntent: built.nextIntent,
    });
    const receipt = await this.context.deps.ledger.commit(batch);
    if (receipt.status !== 'committed') {
      return mapSettleCommitRejection(receipt, command.commandId, canonicalJson(prior.ref));
    }
    return {
      status: 'committed',
      commandId: command.commandId,
      replayed: receipt.replayed,
      intentRef: prior.ref,
      intentStatus: 'done',
      deliveries: built.deliveries.map((delivery) => delivery.ref),
      nextIntentRef: built.nextIntent === null
        ? null
        : communicationIntentRefFor(projectId, workspaceId, built.nextIntent.intentId),
      eventIds: [...receipt.eventIds],
      commitCursor: receipt.commitCursor,
    };
  }

  /** One durable historical subscription prefix; all source data is reread canonically. */
  async settleCatchupPage(command: CommunicationSettleCommand, prior: CommunicationIntentSnapshot): Promise<CommunicationSettleReceipt> {
    const reject = (message: string): CommunicationSettleReceipt => ({ status: 'rejected', commandId: command.commandId, code: 'invalid', issues: [message] });
    const domain = prior.intent.domain;
    if (domain.kind !== 'subscription_catchup' || prior.intent.sideEffectStarted) return reject('Invalid catchup intent');
    const sub = await this.context.loadTyped<SubscriptionSnapshot>(domain.subscriptionRef, 'Subscription');
    if (!sub || canonicalJson(sub.subscription.catchup?.intentRef ?? null) !== canonicalJson(prior.ref)) return reject('Catchup subscription binding differs');
    const page = await this.context.deps.ledger.events({ afterCursor: domain.scanCursor, limit: SUBSCRIPTION_MAX_REPLAY_SPAN });
    let selected;
    try { selected = selectCatchupPrefix(domain, sub.subscription, page.events); } catch (error) { return reject(String(error)); }
    const now = this.context.deps.now();
    const deliveries: DeliverySnapshot[] = [];
    if (selected.source) {
      const source = selected.source;
      const deliveryId = subscriptionDeliveryIdFor({ subscriptionRef: sub.ref, topic: source.topic, cursor: source.cursor, targetWorkContextRef: sub.subscription.ownerWorkContextRef });
      const delivery = pageDelivery({ projectId: sub.ref.projectId, workspaceId: sub.ref.workspaceId, subscription: sub,
        targetWorkContextRef: sub.subscription.ownerWorkContextRef, event: source, deliveryId, createdAt: now });
      const ref = deliveryRefFor(sub.ref.projectId, sub.ref.workspaceId, deliveryId);
      const existing = await this.context.loadTyped<DeliverySnapshot>(ref, 'Delivery');
      if (existing && canonicalJson({ ...existing.delivery, createdAt: now }) !== canonicalJson(delivery)) return reject('Catchup delivery conflicts with durable content');
      if (!existing) deliveries.push({ ref, revision: 1, schemaVersion: 1, delivery, recordedAt: now });
    }
    const waits: WaitConditionSnapshot[] = [];
    if (selected.source && sub.subscription.status === 'active') {
      const mailbox = await readMailboxView(this.context.deps.ledger, sub.subscription.ownerWorkContextRef);
      if (mailbox.status === 'unavailable') return reject(mailbox.reason);
      for (const wait of mailbox.view.waits) {
        if (wait.wait.status !== 'active') continue;
        const indexes = [...wait.wait.satisfiedIndexes];
        for (let i = 0; i < wait.wait.conditions.length; i++) if (!indexes.includes(i) && await this.termSatisfied(wait.wait.conditions[i]!, deliveries)) indexes.push(i);
        indexes.sort((a,b) => a-b);
        const added = indexes.filter(i => !wait.wait.satisfiedIndexes.includes(i));
        if (added.length) waits.push({ ...wait, revision: wait.revision + 1, recordedAt: now, wait: { ...wait.wait, satisfiedIndexes: indexes,
          observations: [...wait.wait.observations, ...added.map(index => ({ index, observedAt: now, note: 'Historical delivery observed' }))] } });
      }
    }
    const status = sub.subscription.status === 'cancelled' ? 'cancelled' : selected.cursor === domain.horizonCursor ? 'done' : 'pending';
    const intent: CommunicationIntentV1 = { ...prior.intent, domain: { ...domain, scanCursor: selected.cursor }, status,
      leaseOwner: null, leaseExpiresAt: null, settledAt: status === 'pending' ? null : now };
    const next: CommunicationIntentSnapshot = { ...prior, revision: prior.revision + 1, intent, recordedAt: now };
    const nextSub: SubscriptionSnapshot = { ...sub, revision: sub.revision + 1, recordedAt: now,
      subscription: { ...sub.subscription, routedThroughCursor: selected.cursor } };
    const ctx = { commandId: command.commandId, correlationId: command.correlationId, occurredAt: now, identity: command.identity };
    const batch: import('../../../contracts/coordination.js').SubscriptionCatchupPageCommitV1 = {
      commitKind: 'subscription-catchup-page', schemaVersion: 1, identity: command.identity, fingerprint: communicationSettleFingerprint(command), outboxIntents: [],
      expectedVersions: [{ ref: prior.ref, revision: prior.revision }, { ref: sub.ref, revision: sub.revision },
        ...deliveries.map(d => ({ ref: d.ref, revision: 0 })), ...waits.map(w => ({ ref: w.ref, revision: w.revision - 1 }))],
      snapshots: [next, nextSub, ...deliveries, ...waits],
      events: [communicationIntentSettledEvent(ctx, this.context.deps.eventId(), intent, next.revision),
        { ...communicationIntentSettledEvent(ctx, this.context.deps.eventId(), intent, next.revision), eventType: 'SubscriptionCatchupAdvanced',
          aggregateType: 'Subscription', aggregateId: sub.ref.subscriptionId, aggregateRevision: nextSub.revision, payload: { subscription: nextSub.subscription, intent } },
        ...deliveries.map(d => deliveryRecordedEvent(ctx, this.context.deps.eventId(), d.delivery)), ...waits.map(w => waitConditionObservedEvent(ctx, this.context.deps.eventId(), w.wait, w.revision))],
    };
    const receipt = await this.context.deps.ledger.commit(batch);
    if (receipt.status !== 'committed') return mapSettleCommitRejection(receipt, command.commandId, canonicalJson(prior.ref));
    return { status: 'committed', commandId: command.commandId, replayed: receipt.replayed, intentRef: prior.ref, intentStatus: status,
      deliveries: deliveries.map(d => d.ref), nextIntentRef: status === 'pending' ? prior.ref : null, eventIds: receipt.eventIds, commitCursor: receipt.commitCursor };
  }



  /**
   * 路由页的 canonical 复核（Dispatch 的 proposal 只是提议）：
   *   - 每个订阅必须存在；已取消的订阅本页对它 no-op（与纯策略 selectPageSubscriptions 一致）；
   *   - 期望版本必须等于当前 revision，否则 revision_conflict（零写入）；
   *   - 每条投递的目标 Work 必须等于订阅的 owner Work（不允许把正文投给别的 Work）；
   *   - 页内投递按 (source event, subscription, target) 去重；
   *   - wait 条件推进按 index 复核，绝不写入未满足的 index。
   */
  private async buildRoutePage(
    command: CommunicationSettleCommand,
    foldDeps: CoordinationFoldDeps,
    prior: CommunicationIntentSnapshot,
    payload: Record<string, unknown>,
    projectId: string,
    workspaceId: string,
  ): Promise<
    | { status: "ok"; deliveries: DeliverySnapshot[]; subscriptions: SubscriptionSnapshot[]; waits: WaitConditionSnapshot[]; nextIntent: CommunicationIntentV1 | null; subscriptionScope: RoutePageSubscriptionScopeEntry[] }
    | { status: "rejected"; receipt: CommunicationSettleReceipt }
  > {
    const page = payload["page"] as {
      sourceTopic: string;
      sourceCursor: CommitCursor;
      subscriptionPosition: string | null;
      subscriptionScope: RoutePageSubscriptionScopeEntry[];
      subscriptions: {
        subscriptionRef: SubscriptionRef;
        expectedRevision: number;
        deliveries: { deliveryId: string; targetWorkContextRef: WorkContextRef; bodyRef: DeliveryV1["bodyRef"]; sourceRefs: { kind: string; refId: string; revision: string }[] }[];
        satisfiedWaitIndexes: { waitRef: WaitConditionRef; indexes: number[] }[];
      }[];
      hasMore: boolean;
    };
    if (prior.intent.domain.kind !== "route_page") {
      return { status: "rejected", receipt: { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["intent 的 domain 不是 route_page"] } };
    }
    const priorPosition = prior.intent.domain.subscriptionPosition;
    const sourceSeq = seqOfCommitCursor(page.sourceCursor);
    const sourcePage = await this.context.deps.ledger.events({ afterCursor: sourceSeq > 1 ? makeCommitCursor(sourceSeq - 1) : null, limit: 1 });
    const row = sourcePage.events[0];
    const source = row?.cursor === page.sourceCursor ? communicationSource(row.event, row.cursor) : null;
    if (page.subscriptions.length && (!source || source.projectId !== projectId || source.workspaceId !== workspaceId || source.topic !== page.sourceTopic)) {
      return { status: 'rejected', receipt: { status: 'rejected', commandId: command.commandId, code: 'invalid', issues: ['Route page source does not exist in this scope'] } };
    }
    if (prior.intent.domain.subscriptionScope.length && (page.sourceCursor !== prior.intent.domain.sourceCursor || page.sourceTopic !== prior.intent.domain.sourceTopic)) {
      return { status: 'rejected', receipt: { status: 'rejected', commandId: command.commandId, code: 'invalid', issues: ['A fixed route round cannot move its source position'] } };
    }
    // 本轮的订阅范围在**第一批处理时固定**：intent 上还没有范围（空）时以本页声明的整轮候选集合
    // 为准（协议约束 1.4），已经固定过则本页必须**逐字节回声**那个范围且不得引入范围外的订阅。
    const priorScope = prior.intent.domain.subscriptionScope;
    /**
     * 协作通信可靠投递规则：生产者在提案里给出**整轮候选集合**（RoutePageProposalV1.subscriptionScope）。
     *
     * 为什么必须有它：只给本页切片的话，intent 的范围永远是空的，账本侧的范围规则（本页不得引入
     * 范围外订阅 / 续页范围逐字节相同 / hasMore 与下一页 intent 一致）在生产路径上永远不会触发。
     * 这里只做**结构**复核（引用形状 + 非负整数版本），成员资格与版本在下面逐条与 canonical 订阅核对。
     */
    const declaredScope = page.subscriptionScope;
    if (!Array.isArray(declaredScope)) {
      return { status: "rejected", receipt: { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["payload.page.subscriptionScope 必须是数组"] } };
    }
    for (const entry of declaredScope) {
      if (entry === null || typeof entry !== "object") {
        return { status: "rejected", receipt: { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["payload.page.subscriptionScope 的每一项必须是对象"] } };
      }
      const ref = entry.subscriptionRef;
      if (ref === null || typeof ref !== "object" || ref.aggregateType !== "Subscription" ||
          ref.projectId !== projectId || ref.workspaceId !== workspaceId || typeof ref.subscriptionId !== "string" || ref.subscriptionId.length === 0) {
        return { status: "rejected", receipt: { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["payload.page.subscriptionScope 的订阅引用不合法（必须属于本页作用域）"] } };
      }
      if (!Number.isInteger(entry.expectedRevision) || entry.expectedRevision < 0) {
        return { status: "rejected", receipt: { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["payload.page.subscriptionScope 的 expectedRevision 必须是非负整数"] } };
      }
    }
    if (priorScope.length > 0 && canonicalJson(declaredScope as never) !== canonicalJson(priorScope as never)) {
      return {
        status: "rejected",
        receipt: {
          status: "rejected", commandId: command.commandId, code: "invalid",
          issues: ["本轮订阅范围已经固定，本页必须逐字节回声该范围（不得改变、不得引入范围外订阅）"],
        },
      };
    }
    // 首次处理订阅的页面**必须**声明范围：没有范围就没有"本轮"这个可核对的事实（协议约束 1.4）。
    if (priorScope.length === 0 && page.subscriptions.length > 0 && declaredScope.length === 0) {
      return {
        status: "rejected",
        receipt: {
          status: "rejected", commandId: command.commandId, code: "invalid",
          issues: ["本页要处理订阅，但没有声明本轮订阅范围（payload.page.subscriptionScope 为空）"],
        },
      };
    }
    const declaredByKey = new Map(declaredScope.map((entry) => [canonicalJson(entry.subscriptionRef as never), entry.expectedRevision] as const));
    const now = foldDeps.now();
    const deliverySnapshots: DeliverySnapshot[] = [];
    const subscriptionSnapshots: SubscriptionSnapshot[] = [];
    const waitNextByRef = new Map<string, { prior: WaitConditionSnapshot; indexes: Set<number>; notes: string[] }>();
    let lastSubscriptionRef: SubscriptionRef | null = null;
    let totalDeliveries = 0;

    for (const entry of page.subscriptions) {
      const loaded = await this.context.loadTyped<SubscriptionSnapshot>(entry.subscriptionRef, "Subscription");
      if (loaded === null) {
        return { status: "rejected", receipt: { status: "rejected", commandId: command.commandId, code: "not_found", issues: ["订阅不存在：" + entry.subscriptionRef.subscriptionId] } };
      }
      // 范围固定（协议约束 1.4）：本页处理的每个订阅都必须在本轮范围里——首次处理时范围就是
      // 本页声明的整轮候选集合，之后是 intent 上已固定的那一份。范围外订阅一律整页拒绝。
      const scopedRevision = declaredByKey.get(canonicalJson(entry.subscriptionRef as never));
      if (scopedRevision === undefined) {
        return {
          status: "rejected",
          receipt: { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["本页引入了本轮订阅范围外的订阅：" + entry.subscriptionRef.subscriptionId] },
        };
      }
      // 范围记的是**本轮开始时**那一版：本页处理的订阅当前必须正好是那一版（推进后账本侧还要
      // 再核对一次 revision === expected + 1，两处口径一致）。
      if (scopedRevision > loaded.revision) {
        return {
          status: "rejected",
          receipt: {
            status: "rejected", commandId: command.commandId, code: "revision_conflict", currentRevision: loaded.revision,
            issues: ["订阅版本与本轮范围登记的版本不一致：" + entry.subscriptionRef.subscriptionId],
          },
        };
      }
      if (loaded.revision !== entry.expectedRevision) {
        return {
          status: "rejected",
          receipt: { status: "rejected", commandId: command.commandId, code: "revision_conflict", currentRevision: loaded.revision, issues: ["订阅版本与页内期望不一致：" + entry.subscriptionRef.subscriptionId] },
        };
      }
      if (loaded.subscription.status === 'active') {
        if (entry.deliveries.length !== 1) return { status: 'rejected', receipt: { status: 'rejected', commandId: command.commandId, code: 'invalid', issues: ['Each active subscription must receive its canonical delivery'] } };
        if (!loaded.subscription.topics.includes(page.sourceTopic) || (loaded.subscription.startCursor !== null && String(loaded.subscription.startCursor) >= String(page.sourceCursor))) return { status: 'rejected', receipt: { status: 'rejected', commandId: command.commandId, code: 'invalid', issues: ['Source is outside subscription start/topics'] } };
        if (loaded.subscription.catchup) {
          const caught = await this.context.loadTyped<CommunicationIntentSnapshot>(loaded.subscription.catchup.intentRef, 'CommunicationIntent');
          if (caught?.intent.status !== 'done') return { status: 'rejected', receipt: { status: 'rejected', commandId: command.commandId, code: 'revision_conflict', issues: ['Subscription history has not reached its fixed horizon'] } };
        }
        if (loaded.subscription.routedThroughCursor !== null && String(loaded.subscription.routedThroughCursor) > String(page.sourceCursor)) return { status: 'rejected', receipt: { status: 'rejected', commandId: command.commandId, code: 'invalid', issues: ['Subscription checkpoint cannot move backwards'] } };
      }
      lastSubscriptionRef = entry.subscriptionRef;
      const candidates: DeliveryV1[] = [];
      for (const proposed of (loaded.subscription.status === 'active' ? entry.deliveries : [])) {
        const expectedId = subscriptionDeliveryIdFor({ subscriptionRef: loaded.ref, topic: page.sourceTopic, cursor: page.sourceCursor, targetWorkContextRef: loaded.subscription.ownerWorkContextRef });
        if (!source || proposed.deliveryId !== expectedId || canonicalJson(proposed.bodyRef) !== canonicalJson(source.bodyRef) || canonicalJson(proposed.sourceRefs) !== canonicalJson(source.sourceRefs)) return { status: 'rejected', receipt: { status: 'rejected', commandId: command.commandId, code: 'invalid', issues: ['Delivery payload or identity differs from its canonical source'] } };
        if (canonicalJson(proposed.targetWorkContextRef) !== canonicalJson(loaded.subscription.ownerWorkContextRef)) {
          return {
            status: "rejected",
            receipt: { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["页内投递目标不是订阅的 owner Work：" + proposed.deliveryId] },
          };
        }
        candidates.push(
          pageDelivery({
            projectId,
            workspaceId,
            subscription: loaded,
            targetWorkContextRef: proposed.targetWorkContextRef,
            event: {
              topic: page.sourceTopic,
              cursor: page.sourceCursor,
              bodyRef: proposed.bodyRef ?? null,
              sourceRefs: Array.isArray(proposed.sourceRefs) ? proposed.sourceRefs.map((s) => ({ ...s })) : [],
            },
            deliveryId: proposed.deliveryId,
            createdAt: now,
          }),
        );
      }
      for (const delivery of dedupePageDeliveries(candidates)) {
        totalDeliveries += 1;
        if (totalDeliveries > COMMUNICATION_PAGE_MAX_DELIVERIES) {
          return {
            status: "rejected",
            receipt: { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["页内投递数超过上界 " + String(COMMUNICATION_PAGE_MAX_DELIVERIES)] },
          };
        }
        const priorDelivery = await this.context.loadTyped<DeliverySnapshot>(deliveryRefForOf(projectId, workspaceId, delivery.deliveryId), 'Delivery');
        if (priorDelivery) {
          if (canonicalJson({ ...priorDelivery.delivery, createdAt: now }) !== canonicalJson(delivery)) return { status: 'rejected', receipt: { status: 'rejected', commandId: command.commandId, code: 'invalid', issues: ['Existing delivery differs from route event'] } };
          continue;
        }
        deliverySnapshots.push({
          ref: deliveryRefForOf(projectId, workspaceId, delivery.deliveryId),
          revision: 1,
          schemaVersion: 1,
          delivery,
          recordedAt: now,
        });
      }
      subscriptionSnapshots.push({
        ...loaded,
        revision: loaded.revision + 1,
        subscription: { ...loaded.subscription, routedThroughCursor: page.sourceCursor },
        recordedAt: now,
      });
      lastSubscriptionRef = entry.subscriptionRef;

      // wait 条件推进：逐 index 复核，只有真满足的 index 才写入。
      for (const transition of (loaded.subscription.status === 'active' ? entry.satisfiedWaitIndexes : [])) {
        const waitKey = canonicalJson(transition.waitRef);
        let bucket = waitNextByRef.get(waitKey);
        if (bucket === undefined) {
          const waitSnapshot = await this.context.loadTyped<WaitConditionSnapshot>(transition.waitRef, "WaitCondition");
          if (waitSnapshot === null) {
            return { status: "rejected", receipt: { status: "rejected", commandId: command.commandId, code: "not_found", issues: ["WaitCondition 不存在：" + transition.waitRef.waitId] } };
          }
          bucket = { prior: waitSnapshot, indexes: new Set<number>(), notes: [] };
          waitNextByRef.set(waitKey, bucket);
        }
        if (bucket.prior.wait.status !== "active") continue; // 终态等待不再推进。
        for (const index of transition.indexes) {
          if (!Number.isInteger(index) || index < 0 || index >= bucket.prior.wait.conditions.length) {
            return { status: "rejected", receipt: { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["等待条件下标越界：" + String(index)] } };
          }
          const satisfied = await this.termSatisfied(bucket.prior.wait.conditions[index]!, deliverySnapshots);
          if (!satisfied) {
            return {
              status: "rejected",
              receipt: { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["页内推进的等待条件并不满足：wait=" + bucket.prior.ref.waitId + " index=" + String(index)] },
            };
          }
          bucket.indexes.add(index);
        }
      }
    }

    const waits: WaitConditionSnapshot[] = [];
    for (const bucket of waitNextByRef.values()) {
      const merged = new Set<number>([...bucket.prior.wait.satisfiedIndexes, ...bucket.indexes]);
      const added = [...bucket.indexes].filter((index) => !bucket.prior.wait.satisfiedIndexes.includes(index));
      const ordered = [...merged].sort((a, b) => a - b);
      if (added.length === 0 && ordered.length === bucket.prior.wait.satisfiedIndexes.length) continue; // 事实上没有推进：不写。
      waits.push({
        ...bucket.prior,
        revision: bucket.prior.revision + 1,
        wait: {
          ...bucket.prior.wait,
          satisfiedIndexes: ordered,
          observations: [
            ...bucket.prior.wait.observations,
            ...added.map((index) => ({ index, observedAt: now, note: "route page 页内条件推进" })),
          ],
        },
        recordedAt: now,
      });
    }

    // 本页**处理到的订阅分页位置**：处理过订阅就是最后一个被处理订阅的 canonical ref key；
    // 一页什么都没处理（没有可路由事件/没有候选订阅）时保持 intent 原有的位置不变。
    const pagePosition = lastSubscriptionRef === null ? priorPosition : canonicalJson(lastSubscriptionRef as never);
    if (page.subscriptionPosition !== pagePosition) {
      return {
        status: "rejected",
        receipt: {
          status: "rejected", commandId: command.commandId, code: "invalid",
          issues: ["页声明的订阅分页位置与页内实际处理结果不一致：page=" + String(page.subscriptionPosition) + " 实际=" + String(pagePosition)],
        },
      };
    }
    // 订阅位置必须**严格前进**（协议约束 1.4）：回退或原地不动一律整页拒绝（零写入）。
    if (pagePosition !== null && priorPosition !== null && !refKeyAfter(pagePosition, priorPosition)) {
      return {
        status: "rejected",
        receipt: {
          status: "rejected", commandId: command.commandId, code: "invalid",
          issues: ["订阅分页位置必须严格前进（不得回退或原地）：page=" + pagePosition + " 已处理=" + priorPosition],
        },
      };
    }
    /**
     * 本轮订阅范围：首次由本页声明固定，之后逐字节沿用；落账前做一次**收敛**——
     * 只保留此刻仍然「存在且 active」的订阅。
     *
     * 为什么归一化而不是原样沿用：范围内的订阅可能在翻页期间被取消或（理论上）消失，那时它
     * 已经不可能再接收任何投递。把它留在范围里会让"范围内还有剩余订阅"永远为真，分页会在
     * 这里永久停住（账本侧的 hasMore 规则会直接拒绝末页）。收敛只做**删减**：不新增、不改写
     * 版本、不改变顺序，因此"不得引入范围外订阅"与"续页范围与上一页相同"两条不变式都仍成立。
     */
    const nextScope = (priorScope.length > 0 ? priorScope : declaredScope).map(entry => ({ ...entry, subscriptionRef: { ...entry.subscriptionRef } }));
    // 协议约束 1.4 / 2.4：hasMore 是**分页边界自洽性**的声明，不得与页内容矛盾。
    // 本页没有处理任何订阅（page.subscriptions 为空，或列出的订阅都已取消而被跳过）时，
    // 订阅分页位置没有前进、也没有任何可继续的边界——这时声称 hasMore=true 只能是
    // "本页什么都没做，却要求继续分页"。旧实现对此**静默收敛**：nextIntent 直接为 null，
    // 页被结算成 done，调度器声明的意图既没有被满足也没有留下任何可诊断的原因。
    // 现在一律**整页拒绝（零写入）**，要求调用方给出自洽的提案。
    if (page.hasMore && pagePosition === null) {
      return {
        status: "rejected",
        receipt: {
          status: "rejected", commandId: command.commandId, code: "invalid",
          issues: ["页声称 hasMore=true，但本页没有处理任何订阅：订阅分页位置没有前进，没有可继续的边界"],
        },
      };
    }
    const nextIntent = page.hasMore
      ? nextRouteIntentFor({
        projectId,
        workspaceId,
        topic: page.sourceTopic,
        cursor: page.sourceCursor,
        // 上面的守卫已保证：hasMore=true ⇒ 本页一定处理过订阅 ⇒ 分页位置非空。
        subscriptionPosition: pagePosition!,
        subscriptionScope: nextScope,
        now,
      })
      : null;

    return { status: "ok", deliveries: deliverySnapshots, subscriptions: subscriptionSnapshots, waits, nextIntent, subscriptionScope: nextScope };
  }



  /** 单条等待条件是否已被 canonical 事实满足（含本页新产生的投递）。 */
  private async termSatisfied(term: WaitConditionTermV1, pageDeliveries: DeliverySnapshot[]): Promise<boolean> {
    if (term.kind === "delivery_present") {
      if (pageDeliveries.some((d) => canonicalJson(d.ref) === canonicalJson(term.deliveryRef))) return true;
      return (await this.context.loadTyped<DeliverySnapshot>(term.deliveryRef, "Delivery")) !== null;
    }
    const request = await this.context.loadTyped<DirectedRequestSnapshot>(term.requestRef, "DirectedRequest");
    if (request === null) return false;
    const responded = request.request.status === "responded" || request.request.response !== null;
    if (term.kind === "request_responded") return responded;
    return responded || request.request.status === "cancelled" || request.request.status === "expired" || request.request.status === "closed";
  }
}

/** Stable continuation intent for another page at the same source cursor. */
function nextRouteIntentFor(input: {
  projectId: string;
  workspaceId: string;
  topic: string;
  cursor: CommitCursor;
  subscriptionPosition: string;
  subscriptionScope: RoutePageSubscriptionScopeEntry[];
  now: string;
}): CommunicationIntentV1 {
  const base = routePageIntentFor({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    topic: input.topic,
    cursor: input.cursor,
    now: input.now,
  });
  return {
    ...base,
    intentId: base.intentId + '-p' + sha256Hex(input.subscriptionPosition).slice(0, 8),
    domain: {
      kind: 'route_page',
      sourceTopic: input.topic,
      sourceCursor: input.cursor,
      subscriptionPosition: input.subscriptionPosition,
      subscriptionScope: input.subscriptionScope.map((entry) => ({
        subscriptionRef: { ...entry.subscriptionRef },
        expectedRevision: entry.expectedRevision,
      })),
    },
  };
}

/** Canonical ref-key ordering shared with route page selection. */
function refKeyAfter(a: string, b: string): boolean {
  return a.localeCompare(b) > 0;
}
