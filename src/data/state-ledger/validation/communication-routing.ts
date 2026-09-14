/** Internal StateLedger communication-routing rules. Both adapters invoke these inside their commit protocol. */
import type { AggregateRef, AggregateSnapshot } from '../../../contracts/ledger.js';
import { WAIT_MAX_CONDITIONS } from '../../../contracts/coordination.js';
import { quarantineCommunicationIntent } from '../../../contracts/communication-reconciliation.js';
import { subscriptionCatchupIdFor, selectCatchupPrefix, subscriptionDeliveryIdFor, communicationSource } from "../../../contracts/coordination.js";
import { canonicalJson, sha256Hex } from "../../../contracts/fingerprint.js";
import { makeCommitCursor, seqOfCommitCursor } from "../../../contracts/ledger.js";
import { communicationIntentRefFor, deliveryDedupeKey, deliveryRefFor, routePageIntentIdFor } from "../../../contracts/coordination.js";
import { identityMatchesActor } from './batch-identity.js';
// ------------------------------------------------------------------------ //
// 协作通信提交校验（两个适配器共用这一份规则）                              //
// ------------------------------------------------------------------------ //

export const COMMUNICATION_EVENT_TYPES: readonly string[] = [
  "AgentInstanceRegistered",
  "WorkParticipationStarted",
  /**
   * 协作通信参与身份裁决（调用证据与参与语义规则）：WorkRunLinked 只作为「允许出现在协作通信提交里」的登记。
   * 它**不是**靠这条白名单被放行的：`participation-start` 走下面的专用校验
   * （validateParticipationStartCommit），白名单在这里只声明该事件类型属于协作通信提交的
   * 合法组成，避免通用形状校验把合法的 participation-start 误判为非法事件。
   */
  "WorkRunLinked",
  "WorkParticipationEnded",
  "DirectedRequestSent",
  "DirectedRequestResponded",
  "DirectedRequestCancelled",
  "SubscriptionCreated",
  "SubscriptionCancelled",
  "SubscriptionCatchupPlanned",
  "SubscriptionCatchupAdvanced",
  "DeliveryRecorded",
  "WaitConditionRegistered",
  "WaitConditionObserved",
  "WaitConditionSatisfied",
  "WaitConditionTimedOut",
  "WaitConditionCancelled",
  "CommunicationIntentRecorded",
  "CommunicationIntentCancelRequested",
  "CommunicationIntentClaimed",
  "CommunicationIntentSettled",
  "CommunicationAdmissionRecorded",
  "CoordinationRegistryUpdated",
  "WorkMailboxUpdated",
];


export function isCommunicationEvent(event: { eventType: string; schemaVersion: number; eventId: string }): boolean {
  return event.schemaVersion === 1 && event.eventId.length > 0 && COMMUNICATION_EVENT_TYPES.includes(event.eventType);
}


/**
 * 协作通信提交的**事务形状**规则（业务准入仍在 Control）：
 *   - 至少一个事件与一个快照；事件全部是已知的通信事件类型；
 *   - 每个事件的 projectId/idempotencyKey/actor 与提交身份一致；
 *   - 每个快照都能对上一条 expected version：`revision === expected + 1`（既有聚合推进）
 *     或 `revision === 1 且无 expected`（本次新建）。**expected 存在时不允许 revision 停在原值**
 *     （拒绝"写了快照但没推进版本"这种伪提交）。
 */
export function validateCommunicationCommit(batch: import("../../../contracts/coordination.js").CommunicationLedgerCommit): boolean {
  try {
    if (batch.schemaVersion !== 1) return false;
    if (!batch.identity.projectId || !batch.identity.idempotencyKey || !batch.identity.actor.id) return false;
    if (batch.events.length === 0 || batch.snapshots.length === 0) return false;
    if (!batch.events.every(isCommunicationEvent)) return false;
    if (batch.commitKind === 'wait-register') {
      const wait = batch.snapshots.find(s => s.ref.aggregateType === 'WaitCondition') as import('../../../contracts/coordination.js').WaitConditionSnapshot | undefined;
      if (!wait || (wait.wait.mode !== 'all' && wait.wait.mode !== 'any') || wait.wait.selectedReport ||
          !wait.wait.conditions.length || wait.wait.conditions.length > WAIT_MAX_CONDITIONS || wait.wait.satisfiedIndexes.length ||
          (wait.wait.mode === 'any' && wait.wait.conditions.some(t => t.kind === 'request_closed'))) return false;
    }
    if (!batch.events.every((event) =>
      identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity))) return false;
    const expectedKeys = new Set<string>();
    for (const expected of batch.expectedVersions) {
      const key = canonicalJson(expected.ref);
      if (expectedKeys.has(key)) return false;
      expectedKeys.add(key);
    }
    const snapshotKeys = new Set<string>();
    for (const snapshot of batch.snapshots) {
      const key = canonicalJson(snapshot.ref);
      if (snapshotKeys.has(key)) return false;
      snapshotKeys.add(key);
      if (!Number.isInteger(snapshot.revision) || snapshot.revision < 1) return false;
      const expected = batch.expectedVersions.find((v) => canonicalJson(v.ref) === key);
      if (expected === undefined) {
        // 新建聚合：必须是 @1（没有 expected，就没有"原地推进"这一说）。
        if (snapshot.revision !== 1) return false;
      } else if (snapshot.revision !== expected.revision + 1) {
        // 推进既有聚合：必须恰好 +1（拒绝"写了快照但没推进版本"的伪提交）。
        return false;
      }
      if (!("projectId" in snapshot.ref) || snapshot.ref.projectId !== batch.identity.projectId) return false;
    }
    return true;
  } catch {
    return false;
  }
}



/**
 * **源事件提交时同事务登记待路由 intent**（协作通信的可靠投递规则，协议约束 1.4）。
 *
 * 规则（为什么必须在账本里做，而不是在 Control 里）：
 *   - `CommitCursor` 由账本在**追加事件的那一刻**赋予；Control 构造提交时拿不到它。若让 Control
 *     先读后写去猜位置，两条并发的同 topic 事件会争同一个确定性 intentId，把合法提交判成冲突。
 *     因此 Control 只声明 anchor（源事件在本批里的类型）与 scope，位置由**本函数所在的同一个事务**
 *     算出：`sourceCursor = makeCommitCursor(firstSeq + anchorIndex)`。
 *   - 追加的事件与快照因此与源事件**原子**：提交被拒时两者都不落账。
 *
 * 形状（与协议同一个算式，不另立一套）：
 *   - intentId = routePageIntentIdFor(projectId, workspaceId, topic, sourceCursor)（确定性）；
 *   - 事件 = CommunicationIntentRecorded（aggregateRevision 1，aggregateId = intentId，身份字段
 *     逐字节沿用 anchor 事件，因此 identityMatchesActor 与源事件同一份判定）；
 *   - 快照 = CommunicationIntentSnapshot@1，expectedVersions 追加该聚合 @0。
 *
 * 失败即 invalid（**不**静默丢弃计划）：anchor 不在本批事件里、scope 为空、作用域不一致、
 * cursor 序号非法、topic 与 anchor 事件类型不一致，任何一种都拒绝整个提交。
 */
export function materializeRouteIntentPlans(
  batch: RouteIntentPlannableCommit,
  /** 本次追加序列里**第一个**事件的 cursor 序号（两个适配器在各自的事务里给出）。 */
  firstSeq: number,
  subscriptions: () => import("../../../contracts/coordination.js").SubscriptionSnapshot[] = () => [],
): { status: "ok"; batch: RouteIntentPlannableCommit } | { status: "invalid" } {
  if ((batch as { commitKind?: string }).commitKind === 'subscription-create') {
    const sub = (batch.snapshots as { ref: { aggregateType: string } }[]).find(s => s.ref.aggregateType === 'Subscription') as import('../../../contracts/coordination.js').SubscriptionSnapshot | undefined;
    if (sub?.subscription.startCursor != null && seqOfCommitCursor(sub.subscription.startCursor) >= firstSeq) return { status: 'invalid' };
  }
  batch = materializeSubscriptionStart(batch, firstSeq);
  const plans = batch.routeIntentPlans;
  if (plans === undefined || plans.length === 0) return { status: "ok", batch };
  if (!Number.isSafeInteger(firstSeq) || firstSeq < 1) return { status: "invalid" };
  const events: unknown[] = [...batch.events];
  const snapshots: unknown[] = [...batch.snapshots];
  const expectedVersions = [...batch.expectedVersions];
  const seen = new Set<string>();
  const materializedPlans: import("../../../contracts/coordination.js").RouteIntentPlanV1[] = [];
  for (let plan of plans) {
    if (plan === null || typeof plan !== "object") return { status: "invalid" };
    if (plan.schemaVersion !== 1) return { status: "invalid" };
    if (typeof plan.plannedAt !== "string" || plan.plannedAt.length === 0) return { status: "invalid" };
    if (plan.topic !== plan.anchorEventType) return { status: "invalid" };
    if (!Array.isArray(plan.subscriptionScope)) return { status: "invalid" };
    if (seen.has(plan.topic)) return { status: "invalid" };
    seen.add(plan.topic);
    const anchorIndex = events.findIndex((event) =>
      (event as { eventType?: unknown }).eventType === plan.anchorEventType);
    if (anchorIndex < 0) return { status: "invalid" };
    const anchor = events[anchorIndex] as import("../../../contracts/coordination.js").CommunicationDomainEvent;
    const projectId = batch.identity.projectId;
    const workspaceId = anchor.workspaceId;
    if (typeof workspaceId !== "string" || workspaceId.length === 0) return { status: "invalid" };
    const sourceCursor = makeCommitCursor(firstSeq + anchorIndex);
    if (plan.scopeMode === 'canonical_active') {
      const scope = subscriptions().filter(s => s.ref.projectId === projectId && s.ref.workspaceId === workspaceId &&
        s.subscription.status === 'active' && s.subscription.topics.includes(plan.topic) &&
        (s.subscription.startCursor === null || String(s.subscription.startCursor) < String(sourceCursor)))
        .map(s => ({ subscriptionRef: s.ref, expectedRevision: s.revision }))
        .sort((a,b) => canonicalJson(a.subscriptionRef).localeCompare(canonicalJson(b.subscriptionRef)));
      if (!scope.length) continue;
      plan = { ...plan, subscriptionScope: scope };
    }
    if (!plan.subscriptionScope.length) return { status: 'invalid' };
    materializedPlans.push(plan);
    // scope 的作用域必须与源事件同一 (projectId, workspaceId)：范围里的订阅属于别的 workspace
    // 是伪提交，直接拒绝而不是「写进去等着被页拒绝」。
    for (const entry of plan.subscriptionScope) {
      const ref = entry.subscriptionRef;
      if (ref === null || typeof ref !== "object") return { status: "invalid" };
      if (ref.aggregateType !== "Subscription") return { status: "invalid" };
      if (ref.projectId !== projectId || ref.workspaceId !== workspaceId) return { status: "invalid" };
    }
    const cursor = makeCommitCursor(firstSeq + anchorIndex);
    const intentId = routePageIntentIdFor(projectId, workspaceId, plan.topic, cursor);
    const intent: import("../../../contracts/coordination.js").CommunicationIntentV1 = {
      schemaVersion: 1,
      intentId,
      projectId,
      workspaceId,
      domain: {
        kind: "route_page",
        sourceTopic: plan.topic,
        sourceCursor: cursor,
        subscriptionPosition: null,
        subscriptionScope: plan.subscriptionScope.map((entry) => ({
          subscriptionRef: { ...entry.subscriptionRef },
          expectedRevision: entry.expectedRevision,
        })),
      },
      status: "pending",
      leaseGeneration: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
      attemptCount: 0,
      availableAt: null,
      lastFailureClass: null,
      sideEffectStarted: false,
      createdAt: plan.plannedAt,
      settledAt: null,
    };
    const event: import("../../../contracts/coordination.js").CommunicationIntentRecordedEvent = {
      eventId: "route-plan-" + intentId,
      eventType: "CommunicationIntentRecorded",
      schemaVersion: 1,
      projectId: anchor.projectId,
      workspaceId: anchor.workspaceId,
      aggregateType: "CommunicationIntent",
      aggregateId: intentId,
      aggregateRevision: 1,
      causationId: anchor.causationId,
      correlationId: anchor.correlationId,
      idempotencyKey: anchor.idempotencyKey,
      actor: { ...anchor.actor },
      occurredAt: plan.plannedAt,
      payload: { intent },
    };
    const snapshot: import("../../../contracts/coordination.js").CommunicationIntentSnapshot = {
      ref: communicationIntentRefFor(projectId, workspaceId, intentId),
      revision: 1,
      schemaVersion: 1,
      intent,
      recordedAt: plan.plannedAt,
    };
    events.push(event);
    snapshots.push(snapshot);
    expectedVersions.push({ ref: communicationIntentRefFor(projectId, workspaceId, intentId), revision: 0 });
  }
  return {
    status: "ok",
    batch: { ...batch, events, snapshots, expectedVersions, routeIntentPlans: materializedPlans },
  };
}


/**
 * materializeRouteIntentPlans 的结构约束（两个适配器的提交类型都满足）。
 * 刻意写成结构类型而不是 LedgerCommit 联合：bootstrap 的身份类型与 CommandIdentity 不同，
 * 而**只有**通信提交会带计划，适配器在调用前先判 routeIntentPlans 是否存在。
 */
export type RouteIntentPlannableCommit = {
  events: unknown[];
  snapshots: unknown[];
  expectedVersions: { ref: unknown; revision: number }[];
  identity: { projectId: string };
  routeIntentPlans?: import("../../../contracts/coordination.js").RouteIntentPlanV1[];
};


/**
 * `communication-route-page` 的**专用**形状校验（协作通信提交规则）。
 *
 * ── 为什么不能只靠通用形状校验 + 白名单 ────────────────────────────────────────
 * 通用规则只说"事件都在白名单里、快照 revision 与 expected 对齐"。于是：
 *   · 一条把正文投给**别的 Work**的 Delivery（越权投递）；
 *   · 同一页里对同一 (源事件, 订阅, 目标 Work) 重复登记两条 Delivery（重复投递）；
 *   · checkpoint **回退或原地**（同一 topic 的同一事件位置被再路由一次）；
 *   · 页里塞进"没有任何订阅快照支撑"的 Delivery
 * 都会被放行——那等于把订阅路由的三条断言（目标 Work、去重、checkpoint 单事务推进）交给调用方自觉。
 * 这里按 validateCommunicationSuccessorClaimCommit 的手法把它们逐条钉在**已提交的结果**上，
 * 而不是钉在 Control 收到的那份 proposal 上。
 *
 * ── 两个 intent 角色必须**分别**核对（此规则的修正）────────────────────────────
 * 一页提交里最多出现两个 CommunicationIntent，角色完全不同，不能混为一谈：
 *   ①「本页已完成（done）的 intent」：必填、恰好一个，是这一页正在收敛的那条；
 *   ②「可选的下一页 pending intent」：0 或 1 条，是本页没处理完时同事务登记的续页触发器。
 * 旧规则只认角色 ①——它按"恰好一个 CommunicationIntent 快照"计数，于是续页 intent 一出现
 * 就被判非法，任何需要翻页的提交都被整页拒绝（多页订阅无法连续完成）。
 *
 * ── 两个位置必须分开（协作通信协议约束 1.4）────────────────────────────────────
 *   · **源事件位置** = `sourceTopic` + `sourceCursor`：本 intent 负责的那一个账本事件位置。
 *     同一事件翻页时它**允许不变**，因此**不能**用"事件位置每页严格增加"去校验分页。
 *   · **订阅分页位置** = `subscriptionPosition`（canonical ref key，null = 该事件还没处理过订阅）：
 *     同一事件翻页时它**必须严格前进**，回退或原地不动一律拒绝。
 *   · **本轮订阅范围** = `subscriptionScope`：翻页期间**逐字节不变**。
 *
 * 检查项（事务边界，协议约束 2.1）：
 *   0. CAS 只允许落在**本次确实写入**的聚合上（expectedVersions 的每个 ref 都必须在本批快照里）；
 *      否则等于把页外的状态当成这一页的事务前置条件，"一起提交"就不成立了。
 *
 * 检查项（角色 ①，本页 done 的 intent）：
 *   1. 事件只允许 DeliveryRecorded / WaitConditionObserved / CommunicationIntentSettled /
 *      CommunicationIntentRecorded，且 settle 恰好一条、recorded 至多一条；
 *   2. 快照数量 = settle 事件数 + recorded 事件数，且事件与快照逐字节一致；
 *   3. 该 intent @(expected+1)，status=done，domain.kind=route_page；
 *   4. **确定性 id**：`subscriptionPosition === null`（该事件位置的第一页）时逐字节等于
 *      `routePageIntentIdFor(topic, sourceCursor)`；否则等于
 *      「首次页 id + "-p" + sha256(subscriptionPosition)[0..8]」（与 Control 的 nextRouteIntentFor 同一算式）；
 *   5. **来源位置**：domain.sourceCursor 必须是合法账本游标；
 *   6. **订阅分页边界**：本页处理的每个订阅都必须**严格排在** intent 自己的 subscriptionPosition
 *      之后（不得回退或原地重放已经处理过的订阅）；
 *   7. 每条 DeliveryRecorded 的 origin 必须是 subscription；
 *   8. 页内 Delivery 去重键唯一；
 *   9. 每条 Delivery 的 targetWorkContextRef 必须等于它所属订阅的 ownerWorkContextRef；
 *  10. 每条 Delivery 的订阅必须出现在**本页推进的订阅快照**里（不投给本页没处理的订阅）；
 *  11. 页事件位置唯一：本页所有 Delivery 的 sourceCursor 与所有被推进订阅的 routedThroughCursor
 *      必须等于同一个事件位置 P；若本页确实路由了 P，则 P 不得早于 intent 的 sourceCursor；
 *  12. 范围固定：如果 intent 已经固定了 subscriptionScope（非空），本页处理的订阅必须都在范围内，
 *      且每条推进后的快照必须正好是范围里登记的 expectedRevision + 1；
 *  12a. **自描述完整性（协议约束 2.4）**：intent 的 domain 必须**显式**带 subscriptionPosition 与
 *      subscriptionScope。旧形状（只有 afterSubscriptionRef / routedThroughCursor）的记录缺少必需
 *      字段时一律拒绝——不得当作"位置未知就是 null、范围未知就是空"补猜后继续；
 *  12c. **结算必须来自一次真实领取（协议约束 1.5）**：被结算的 intent 必须 generation >= 1 且有
 *      leaseOwner（正常路径上 settle 之前必定先 claim）。重放回执不授予再次执行副作用的权利。
 *
 * 检查项（两个角色共同的作用域约束）：
 *  12b. 整批事件与快照必须声明**同一个** (projectId, workspaceId)，且等于本页 intent 声明的作用域
 *       （projectId 由通用规则钉在提交身份上；CommandIdentity 没有 workspaceId 字段，因此
 *       workspaceId 钉在"整批互相同一"上）。
 *
 * 检查项（角色 ②，可选的下一页 pending intent）：
 *  13. **版本**：新建聚合——快照 @1 且 expected 恰好 @0；
 *  14. 形态为 pending 的 route_page，且未被任何人领取（generation=0、无 leaseOwner）；
 *  15. **来源位置**：与角色 ① 同 topic，且 sourceCursor 等于**本页实际路由的事件位置 P**
 *      （不能拿角色 ① 自己的 sourceCursor 来比：首页 intent 的 sourceCursor 可能是订阅声明的起点）；
 *  16. **确定性 id**：由 (topic, P, subscriptionPosition) 机械派生（同第 4 条算式）；
 *  17. **分页边界**：本页必须真的处理过订阅，续页的 subscriptionPosition 恰好等于本页处理过的
 *      订阅里 canonical 序**最大**的那一个，且**严格大于**角色 ① 自己的 subscriptionPosition；
 *  18. **范围固定**：续页的 subscriptionScope 与角色 ① 逐字节相同；
 *  19. **hasMore 与下一页 intent 必须一致**（本轮范围已固定时，它同时就是账本内的 hasMore 证）：
 *      范围里严格排在「本页处理到的位置」之后的订阅存在 ⇒ 本页**必须**登记下一页 intent；
 *      不存在 ⇒ 本页是末页，**不得**登记下一页 intent。
 *
 * 兼容边界：旧 intent 的 subscriptionScope 为空时，第 19 条没有可依据的范围事实，
 * 因此不会触发；当前生产路径在首页固定范围并在续页逐字节沿用。账本没有独立的
 * hasMore 字段，末页通过“不再登记续页 intent”表达。
 */
export function validateCommunicationRoutePageCommit(
  batch: import("../../../contracts/coordination.js").CommunicationRoutePageCommitV1,
): boolean {
  try {
    if (!validateCommunicationCommit(batch)) return false;
    if (batch.outboxIntents.length !== 0) return false;
    /**
     * (0) 协议约束 2.1（路由页是一个事务）：CAS 只允许发生在**本次确实写入**的聚合上。
     * 对没有快照的聚合做期望版本检查，等于把页外的状态拉进这一页的原子边界——
     * 那不是"一起提交"，而是把别人的版本当成自己的前置条件。
     */
    const writtenRefKeys = new Set(batch.snapshots.map((s) => canonicalJson(s.ref as never)));
    if (!batch.expectedVersions.every((v) => writtenRefKeys.has(canonicalJson(v.ref as never)))) return false;
    /**
     * (1) 事件词表：本页投递 / 页内 wait 观察 / **本页 intent 的 settle** /
     *     **下一页 pending intent 的登记**。
     *
     * 为什么必须放行 CommunicationIntentRecorded（此规则修掉的真实缺陷）：一页走完之后
     * 若还有没处理完的订阅，Control 会在**同一个 CAS** 里把下一页的 pending intent 与它的
     * CommunicationIntentRecorded 一起落账。旧规则只允许 settle，于是任何"需要翻页"的提交
     * 都被整页拒绝——多页订阅无法连续完成，重启后分页也永远停在该页。
     */
    for (const event of batch.events) {
      if (event.eventType !== "DeliveryRecorded" && event.eventType !== "WaitConditionObserved" &&
          event.eventType !== "CommunicationIntentSettled" &&
          event.eventType !== "CommunicationIntentRecorded") return false;
    }
    const settledEvents = batch.events
      .filter((e) => e.eventType === "CommunicationIntentSettled") as
      import("../../../contracts/coordination.js").CommunicationIntentSettledEvent[];
    const recordedEvents = batch.events
      .filter((e) => e.eventType === "CommunicationIntentRecorded") as
      import("../../../contracts/coordination.js").CommunicationIntentRecordedEvent[];
    // 本页恰好收敛**它自己**那一条 intent；下一页 intent 至多登记一条（0 条 = 末页）。
    if (settledEvents.length !== 1) return false;
    if (recordedEvents.length > 1) return false;

    const intents = batch.snapshots.filter((s) => s.ref.aggregateType === "CommunicationIntent") as
      import("../../../contracts/coordination.js").CommunicationIntentSnapshot[];
    // 快照数量必须与两个角色的事件数量精确对应：多一个少一个都是伪提交。
    if (intents.length !== settledEvents.length + recordedEvents.length) return false;

    // ---- 角色 ①：本页已完成（done）的 intent（必填，恰好一个）----------------
    const settledEvent = settledEvents[0]!;
    const settled = intents.find((s) => s.ref.intentId === settledEvent.aggregateId &&
      canonicalJson(s.ref as never) === canonicalJson(
        communicationIntentRefFor(settledEvent.projectId, settledEvent.workspaceId, settledEvent.aggregateId) as never));
    if (settled === undefined) return false;
    // 事件与快照必须逐字节一致（防"事件写一条、快照写另一条"的伪提交）。
    if (canonicalJson(settled.intent as never) !== canonicalJson(settledEvent.payload.intent as never)) return false;
    if (settledEvent.aggregateRevision !== settled.revision) return false;
    if (settled.intent.status !== "done") return false;
    if (settled.intent.domain.kind !== "route_page") return false;
    // 协议约束 2.4：route_page 的**新字段必须显式存在**。旧形状（只有 afterSubscriptionRef /
    // routedThroughCursor）的记录不能被当成"订阅位置未知就当作 null、订阅范围未知就当作空"继续
    // 处理——那是补猜值后继续，而不是"不可恢复或进入对账"。
    if (!isRoutePageDomainWellFormed(settled.intent.domain)) return false;
    // 协议约束 1.5：结算必须来自一次**真实领取**。账本看不到命令里的 consumer/generation，
    // 但它看得到结果，因此钉住可核对的事实：这条 intent 至少被领取过一次（generation >= 1 且有
    // leaseOwner）。**重放回执不授予再次执行副作用的权利**——一条从未被领取的 intent 被直接结算
    // 一律拒绝（正常路径上 settle 之前必定先 claim，见 CoordinationDrive.routePages）。
    if (settled.intent.leaseGeneration < 1 || settled.intent.leaseOwner === null) return false;
    // 版本：本页 intent 由 expected@N 推进到 N+1。
    const expectedForSettled = batch.expectedVersions.filter((v) => canonicalJson(v.ref as never) === canonicalJson(settled.ref as never));
    if (expectedForSettled.length !== 1) return false;
    if (settled.revision !== expectedForSettled[0]!.revision + 1) return false;
    const domainFrontier = settled.intent.domain.sourceCursor;
    const priorPosition = settled.intent.domain.subscriptionPosition;
    if (!cursorSeq(domainFrontier).ok) return false;
    // 确定性 id + 来源位置：该事件位置的**第一页**必须逐字节使用协议的 routePageIntentIdFor；
    // **续页**必须是「首次页 id + 订阅分页位置的稳定摘要」派生 id（与 Control 的 nextRouteIntentFor
    // 同一算式），且必须真的带着一个非空的订阅分页位置——否则"从头重来"的页能冒充续页。
    const settledBaseId = routePageIntentIdFor(
      settled.ref.projectId, settled.ref.workspaceId, settled.intent.domain.sourceTopic, settled.intent.domain.sourceCursor);
    if (priorPosition === null) {
      if (settled.intent.intentId !== settledBaseId) return false;
    } else if (settled.intent.intentId !== continuationRoutePageIntentId(settledBaseId, priorPosition)) {
      return false;
    }

    // 作用域一致性：一页只能属于**同一个** (projectId, workspaceId)。projectId 已由通用规则钉在
    // 提交身份上；workspaceId 在 CommandIdentity 里没有对应字段，因此这里把它钉在"整批事件与快照
    // 互相同一、且等于本页 intent 声明的作用域"上——否则一条把投递/订阅/intent 记到别的
    // workspace 的提交都能通过。
    const scopeProjectId = settled.ref.projectId;
    const scopeWorkspaceId = settled.ref.workspaceId;
    for (const event of batch.events) {
      if (event.projectId !== scopeProjectId || event.workspaceId !== scopeWorkspaceId) return false;
    }
    for (const snapshot of batch.snapshots) {
      if (snapshot.ref.projectId !== scopeProjectId || snapshot.ref.workspaceId !== scopeWorkspaceId) return false;
    }

    const subscriptions = batch.snapshots.filter((s) => s.ref.aggregateType === "Subscription") as
      import("../../../contracts/coordination.js").SubscriptionSnapshot[];
    // 本页推进过的订阅（canonical 序与 selectPageSubscriptions 同一口径：canonicalJson(ref) 的 localeCompare）。
    const advancedKeys = subscriptions.map((s) => canonicalJson(s.ref as never)).sort((a, b) => a.localeCompare(b));
    // 订阅分页边界（角色 ①侧，协议约束 1.4）：续页只能处理**严格排在自身订阅分页位置之后**的
    // 订阅——把本 intent 已经处理过的订阅再处理一次（回退或原地）一律整页拒绝。
    if (priorPosition !== null) {
      if (!advancedKeys.every((key) => key.localeCompare(priorPosition) > 0)) return false;
    }
    // 范围固定：intent 已经固定过订阅范围时，本页处理的订阅必须都在范围内
    // （每条的 expectedRevision 必须等于它在范围里登记的那一个）。
    const scopedByKey = new Map(settled.intent.domain.subscriptionScope.map((entry) =>
      [canonicalJson(entry.subscriptionRef as never), entry.expectedRevision] as const));
    if (settled.intent.domain.subscriptionScope.length > 0) {
      for (const subscription of subscriptions) {
        const expected = scopedByKey.get(canonicalJson(subscription.ref as never));
        // 范围外订阅：本页推进了本轮没有固定的订阅 → 整页拒绝。
        if (expected === undefined) return false;
        // 范围记的是**本轮开始时**那一版：本页推进后的快照必须正好是 expected + 1。
        if (subscription.revision - 1 < expected) return false;
      }
    }
    // 本轮订阅范围一旦固定，它同时就是**账本内的 hasMore 证**（协议约束 1.4 + 2.1）：
    //   范围里严格排在「本页处理到的位置」之后的订阅存在 ⟺ 本页**必须**登记下一页 intent；
    //   不存在 ⟺ 本页就是末页，**不得**登记下一页 intent。
    // 「本页处理到的位置」= 本页处理过的订阅里 canonical 序最大者；本页什么都没处理时位置不动
    // （空页既不推进分页位置，也不允许挂续页——见角色 ②）。
    const pageResultPosition = advancedKeys.length === 0 ? priorPosition : advancedKeys[advancedKeys.length - 1]!;
    if (scopedByKey.size > 0) {
      const scopeKeys = [...scopedByKey.keys()].sort((a, b) => a.localeCompare(b));
      const remaining = pageResultPosition === null
        ? scopeKeys
        : scopeKeys.filter((key) => key.localeCompare(pageResultPosition) > 0);
      if (recordedEvents.length === 1) {
        // hasMore 声称还有剩余，账本却在范围里看不到任何剩余 ⇒ 本页还挂了多余的续页 intent。
        if (remaining.length === 0) return false;
      } else if (remaining.length > 0) {
        // 范围里明明还有剩余订阅，本页却没登记下一页 intent ⇒ 分页会在这里永久停住。
        return false;
      }
    }
    const subscriptionByKey = new Map(subscriptions.map((s) => [canonicalJson(s.ref as never), s]));
    const deliveries = batch.events
      .filter((e) => e.eventType === "DeliveryRecorded")
      .map((e) => (e as import("../../../contracts/coordination.js").DeliveryRecordedEvent).payload.delivery);

    // (3)(4)(5)(6)(7)
    const dedupe = new Set<string>();
    const pageCursors = new Set<string>();
    for (const delivery of deliveries) {
      if (delivery.origin.kind !== "subscription") return false;
      const key = deliveryDedupeKey(delivery);
      if (dedupe.has(key)) return false;
      dedupe.add(key);
      const owner = subscriptionByKey.get(canonicalJson(delivery.origin.subscriptionRef as never));
      if (owner === undefined) return false;
      if (canonicalJson(delivery.targetWorkContextRef as never) !== canonicalJson(owner.subscription.ownerWorkContextRef as never)) return false;
      if (canonicalJson(owner.subscription.routedThroughCursor as never) !== canonicalJson(delivery.origin.sourceCursor as never)) return false;
      pageCursors.add(String(delivery.origin.sourceCursor));
      // 快照与事件必须逐字节一致（防止"事件一条、快照另一条"的伪提交）。
      const snapshot = batch.snapshots.find((s) => s.ref.aggregateType === "Delivery" && canonicalJson(s.ref as never) === canonicalJson(deliveryRefFor(delivery.projectId, delivery.workspaceId, delivery.deliveryId) as never));
      if (snapshot === undefined) return false;
      if (canonicalJson((snapshot as import("../../../contracts/coordination.js").DeliverySnapshot).delivery as never) !== canonicalJson(delivery as never)) return false;
    }
    for (const subscription of subscriptions) {
      const advanced = subscription.subscription.routedThroughCursor;
      if (advanced === null) return false;
      pageCursors.add(String(advanced));
    }
    if (pageCursors.size > 1) return false;

    // 事件位置不得回退到本 intent 的源事件位置之前（同一事件翻页时 P 等于 sourceCursor 是合法的：
    // 严格前进的是订阅分页位置，不是事件位置——协议约束 1.4）。
    if (pageCursors.size === 1) {
      const page = cursorSeq([...pageCursors][0]!);
      if (!page.ok) return false;
      if (page.seq < cursorSeq(domainFrontier).seq) return false;
    }

    // ---- 角色 ②：可选的下一页 pending intent（0 条 = 本页是末页）--------------
    if (recordedEvents.length === 1) {
      const recordedEvent = recordedEvents[0]!;
      const recorded = intents.find((s) => s.ref.intentId === recordedEvent.aggregateId &&
        canonicalJson(s.ref as never) === canonicalJson(
          communicationIntentRefFor(recordedEvent.projectId, recordedEvent.workspaceId, recordedEvent.aggregateId) as never));
      if (recorded === undefined) return false;
      if (canonicalJson(recorded.intent as never) !== canonicalJson(recordedEvent.payload.intent as never)) return false;
      if (recordedEvent.aggregateRevision !== 1) return false;
      const next = recorded.intent;
      // 版本：下一页 intent 是**新建聚合**（快照 @1 + expected @0）。
      if (recorded.revision !== 1 || next.schemaVersion !== 1) return false;
      const expectedForNext = batch.expectedVersions.filter((v) => canonicalJson(v.ref as never) === canonicalJson(recorded.ref as never));
      if (expectedForNext.length !== 1 || expectedForNext[0]!.revision !== 0) return false;
      // 形态：pending 的 route_page，且不是终态/租约态（下一页还没被任何人领取）。
      if (next.status !== "pending") return false;
      if (next.leaseGeneration !== 0 || next.leaseOwner !== null) return false;
      if (next.domain.kind !== "route_page") return false;
      // 协议约束 2.4：下一页 intent 同样必须显式带新字段。
      if (!isRoutePageDomainWellFormed(next.domain)) return false;
      // 来源位置：续页停在**本页实际路由的那个事件位置 P** 上（同 topic、同 cursor）。
      // 注意不能拿"本页 intent 自己的 sourceCursor"来比：首页 intent 的 sourceCursor 可能是
      // 订阅声明的起点（早于 P），而页走完之后续页的起点就是 P。
      if (next.domain.sourceTopic !== settled.intent.domain.sourceTopic) return false;
      if (pageCursors.size !== 1) return false;
      const pageRoutedCursor = [...pageCursors][0]!;
      if (String(next.domain.sourceCursor) !== pageRoutedCursor) return false;
      // 订阅分页边界：续页必须带一个非空的订阅分页位置。
      const nextPosition = next.domain.subscriptionPosition;
      if (nextPosition === null) return false;
      // 确定性 id：必须由 (topic, P, 订阅分页位置) 机械派生（不是调用方随便给的 id）。
      const nextBaseId = routePageIntentIdFor(
        recorded.ref.projectId, recorded.ref.workspaceId, next.domain.sourceTopic, next.domain.sourceCursor);
      if (next.intentId !== continuationRoutePageIntentId(nextBaseId, nextPosition)) return false;
      // 分页边界：
      //   · 本页必须真的处理过订阅（空页不允许挂续页，否则会拿空页把分页无限延长）；
      //   · 续页的订阅位置必须恰好是本页处理过的订阅里 canonical 序**最大**的那一个——
      //     比它小会漏投剩余订阅，比它大（不在本页集合里）会跳投；
      //   · 并且必须**严格大于**本页 intent 自己的订阅位置（不得原地不动）。
      if (advancedKeys.length === 0) return false;
      if (nextPosition !== advancedKeys[advancedKeys.length - 1]) return false;
      if (priorPosition !== null && nextPosition.localeCompare(priorPosition) <= 0) return false;
      // 范围固定：续页的订阅范围必须与角色 ① 逐字节相同（翻页期间不得改变）。
      if (canonicalJson(next.domain.subscriptionScope as never) !== canonicalJson(settled.intent.domain.subscriptionScope as never)) return false;
    }
    return true;
  } catch {
    return false;
  }
}


/**
 * 续页 route intent 的稳定 intentId（与 Control 的 nextRouteIntentFor 同一算式：
 * 首次页 id + "-p" + sha256(订阅分页位置 canonical ref key)[0..8]）。
 * 该事件位置的第一页仍逐字节使用协议的 routePageIntentIdFor；派生只发生在 hasMore 的下一页。
 */
export function continuationRoutePageIntentId(baseId: string, subscriptionPositionKey: string): string {
  return baseId + "-p" + sha256Hex(subscriptionPositionKey).slice(0, 8);
}


/**
 * route_page domain 的**自描述完整性**（协议约束 2.4）。
 *
 * 新形状必须**显式**带 subscriptionPosition 与 subscriptionScope。旧形状的记录（只有
 * afterSubscriptionRef / routedThroughCursor）缺少必需字段时，绝不能被当作
 * 「订阅位置未知就当作 null、订阅范围未知就当作空」继续处理——那正是 2.4 禁止的补猜值后继续。
 * 缺字段一律当作不合法提交拒绝（调用方得到明确的拒绝，而不是一个猜出来的分页位置）。
 */
export function isRoutePageDomainWellFormed(domain: unknown): boolean {
  if (domain === null || typeof domain !== "object") return false;
  const record = domain as Record<string, unknown>;
  if (record["kind"] !== "route_page") return false;
  const topic = record["sourceTopic"];
  if (typeof topic !== "string" || topic.length === 0) return false;
  const sourceCursor = record["sourceCursor"];
  if (typeof sourceCursor !== "string" || sourceCursor.length === 0) return false;
  const position = record["subscriptionPosition"];
  if (position !== null && (typeof position !== "string" || position.length === 0)) return false;
  const scope = record["subscriptionScope"];
  if (!Array.isArray(scope)) return false;
  for (const entry of scope) {
    if (entry === null || typeof entry !== "object") return false;
    const item = entry as Record<string, unknown>;
    const ref = item["subscriptionRef"];
    if (ref === null || typeof ref !== "object") return false;
    const refRecord = ref as Record<string, unknown>;
    if (refRecord["aggregateType"] !== "Subscription") return false;
    if (typeof refRecord["projectId"] !== "string" || typeof refRecord["workspaceId"] !== "string") return false;
    const subscriptionId = refRecord["subscriptionId"];
    if (typeof subscriptionId !== "string" || subscriptionId.length === 0) return false;
    const expectedRevision = item["expectedRevision"];
    if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 0) return false;
  }
  return true;
}


export function cursorSeq(cursor: string): { ok: true; seq: number } | { ok: false; seq: -1 } {
  const match = /^c(\d{10})$/.exec(String(cursor));
  if (!match?.[1]) return { ok: false, seq: -1 };
  const seq = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(seq) ? { ok: true, seq } : { ok: false, seq: -1 };
}


/** Fix subscription start and historical horizon at the actual append position. */
export function materializeSubscriptionStart(batch: RouteIntentPlannableCommit, firstSeq: number): RouteIntentPlannableCommit {
  if ((batch as {commitKind?: string}).commitKind !== 'subscription-create') return batch;
  const events = structuredClone(batch.events) as import('../../../contracts/coordination.js').CommunicationDomainEvent[];
  const snapshots = structuredClone(batch.snapshots) as import('../../../contracts/coordination.js').SubscriptionCreateCommitV1['snapshots'];
  const index = events.findIndex(e => e.eventType === 'SubscriptionCreated');
  if (index < 0) return batch;
  const event = events[index]; if (event?.eventType !== 'SubscriptionCreated') return batch;
  const sub = snapshots.find((s): s is import('../../../contracts/coordination.js').SubscriptionSnapshot => s.ref.aggregateType === 'Subscription');
  if (!sub || sub.revision !== 1) return batch;
  const horizonCursor = makeCommitCursor(firstSeq + index);
  const initial = sub.subscription.startCursor;
  const expectedVersions = [...batch.expectedVersions];
  if (initial === null) sub.subscription.startCursor = horizonCursor;
  else if (String(initial) < String(horizonCursor) && sub.subscription.topics.length) {
    const intentId = subscriptionCatchupIdFor(sub.ref);
    const ref = communicationIntentRefFor(sub.ref.projectId, sub.ref.workspaceId, intentId);
    sub.subscription.catchup = { intentRef: ref, horizonCursor };
    const intent: import('../../../contracts/coordination.js').CommunicationIntentV1 = {
      schemaVersion: 1, intentId, projectId: sub.ref.projectId, workspaceId: sub.ref.workspaceId,
      domain: { kind: 'subscription_catchup', subscriptionRef: sub.ref, startCursor: initial, scanCursor: initial, horizonCursor },
      status: 'pending', leaseGeneration: 0, leaseOwner: null, leaseExpiresAt: null, attemptCount: 0,
      availableAt: null, lastFailureClass: null, sideEffectStarted: false, createdAt: sub.recordedAt, settledAt: null,
    };
    events.push({ ...event, eventId: 'subscription-' + intentId, eventType: 'CommunicationIntentRecorded',
      aggregateType: 'CommunicationIntent', aggregateId: intentId, aggregateRevision: 1, payload: { intent } });
    snapshots.push({ ref, revision: 1, schemaVersion: 1, intent, recordedAt: sub.recordedAt });
    expectedVersions.push({ ref, revision: 0 });
  }
  event.payload.subscription = structuredClone(sub.subscription);
  return { ...batch, events, snapshots, expectedVersions };
}


/** Canonical replay of a bounded catchup page inside the same ledger transaction. */
export function validateSubscriptionCatchupPage(batch: import('../../../contracts/coordination.js').SubscriptionCatchupPageCommitV1,
  load: (ref: import('../../../contracts/ledger.js').AggregateRef) => import('../../../contracts/ledger.js').AggregateSnapshot | undefined,
  prefix: (cursor: import('../../../contracts/command-event.js').CommitCursor) => import('../../../contracts/ledger.js').PositionedEvent[]): boolean {
  try {
    if (!validateCommunicationCommit(batch) || batch.outboxIntents.length || batch.routeIntentPlans?.length) return false;
    const next = batch.snapshots.find((s): s is import('../../../contracts/coordination.js').CommunicationIntentSnapshot => s.ref.aggregateType === 'CommunicationIntent');
    const sub = batch.snapshots.find((s): s is import('../../../contracts/coordination.js').SubscriptionSnapshot => s.ref.aggregateType === 'Subscription');
    if (!next || !sub || next.intent.domain.kind !== 'subscription_catchup') return false;
    const prior = load(next.ref) as import('../../../contracts/coordination.js').CommunicationIntentSnapshot | undefined;
    const oldSub = load(sub.ref) as import('../../../contracts/coordination.js').SubscriptionSnapshot | undefined;
    if (!prior || !oldSub || prior.intent.domain.kind !== 'subscription_catchup' || prior.intent.status !== 'leased' || prior.intent.sideEffectStarted) return false;
    if (canonicalJson(prior.intent.domain.subscriptionRef) !== canonicalJson(sub.ref) ||
        canonicalJson(oldSub.subscription.catchup?.intentRef ?? null) !== canonicalJson(prior.ref)) return false;
    const selected = selectCatchupPrefix(prior.intent.domain, oldSub.subscription, prefix(prior.intent.domain.scanCursor));
    const now = next.recordedAt;
    const status = oldSub.subscription.status === 'cancelled' ? 'cancelled' : selected.cursor === prior.intent.domain.horizonCursor ? 'done' : 'pending';
    const expectedIntent = { ...prior, revision: prior.revision + 1, recordedAt: now, intent: { ...prior.intent,
      domain: { ...prior.intent.domain, scanCursor: selected.cursor }, status, leaseOwner: null, leaseExpiresAt: null, settledAt: status === 'pending' ? null : now } };
    if (canonicalJson(next) !== canonicalJson(expectedIntent)) return false;
    if (canonicalJson(sub) !== canonicalJson({ ...oldSub, revision: oldSub.revision + 1, recordedAt: now,
      subscription: { ...oldSub.subscription, routedThroughCursor: selected.cursor } })) return false;
    const deliveries = batch.snapshots.filter((s): s is import('../../../contracts/coordination.js').DeliverySnapshot => s.ref.aggregateType === 'Delivery');
    let expectedDelivery: import('../../../contracts/coordination.js').DeliveryV1 | null = null;
    if (selected.source) {
      const source = selected.source;
      const deliveryId = subscriptionDeliveryIdFor({ subscriptionRef: sub.ref, topic: source.topic, cursor: source.cursor, targetWorkContextRef: sub.subscription.ownerWorkContextRef });
      expectedDelivery = { schemaVersion: 1, deliveryId, projectId: sub.ref.projectId, workspaceId: sub.ref.workspaceId,
        origin: { kind: 'subscription', subscriptionRef: sub.ref, sourceTopic: source.topic, sourceCursor: source.cursor },
        targetWorkContextRef: sub.subscription.ownerWorkContextRef, bodyRef: source.bodyRef, sourceRefs: source.sourceRefs, createdAt: now };
      const existing = load({ aggregateType: 'Delivery', projectId: sub.ref.projectId, workspaceId: sub.ref.workspaceId, deliveryId }) as import('../../../contracts/coordination.js').DeliverySnapshot | undefined;
      if (existing) { if (canonicalJson({ ...existing.delivery, createdAt: now }) !== canonicalJson(expectedDelivery) || deliveries.length) return false; }
      else if (deliveries.length !== 1 || canonicalJson(deliveries[0]!.delivery) !== canonicalJson(expectedDelivery) || deliveries[0]!.revision !== 1) return false;
    } else if (deliveries.length) return false;
    const waits = batch.snapshots.filter((s): s is import('../../../contracts/coordination.js').WaitConditionSnapshot => s.ref.aggregateType === 'WaitCondition');
    for (const wait of waits) {
      const old = load(wait.ref) as import('../../../contracts/coordination.js').WaitConditionSnapshot | undefined;
      if (!old || old.wait.status !== 'active' || !selected.source || canonicalJson(old.wait.ownerWorkContextRef) !== canonicalJson(sub.subscription.ownerWorkContextRef)) return false;
      const added = wait.wait.satisfiedIndexes.filter(i => !old.wait.satisfiedIndexes.includes(i));
      if (!added.length || new Set(wait.wait.satisfiedIndexes).size !== wait.wait.satisfiedIndexes.length || old.wait.satisfiedIndexes.some(i => !wait.wait.satisfiedIndexes.includes(i))) return false;
      for (const i of added) {
        const term = old.wait.conditions[i]; if (!term) return false;
        if (term.kind === 'delivery_present') {
          const inPage = expectedDelivery && term.deliveryRef.deliveryId === expectedDelivery.deliveryId && term.deliveryRef.projectId === expectedDelivery.projectId && term.deliveryRef.workspaceId === expectedDelivery.workspaceId;
          if (!inPage && !load(term.deliveryRef)) return false;
        } else {
          const request = load(term.requestRef) as import('../../../contracts/coordination.js').DirectedRequestSnapshot | undefined;
          if (!request || (term.kind === 'request_responded' ? request.request.response === null : !['responded','cancelled','expired','closed'].includes(request.request.status))) return false;
        }
      }
      const expected = { ...old, revision: old.revision + 1, recordedAt: now, wait: { ...old.wait, satisfiedIndexes: wait.wait.satisfiedIndexes,
        observations: [...old.wait.observations, ...added.map(index => ({ index, observedAt: now, note: 'Historical delivery observed' }))] } };
      if (canonicalJson(wait) !== canonicalJson(expected)) return false;
    }
    if (batch.snapshots.length !== 2 + deliveries.length + waits.length || batch.events.length !== batch.snapshots.length || batch.expectedVersions.length !== batch.snapshots.length) return false;
    for (const snapshot of batch.snapshots) {
      const events = batch.events.filter(e => e.aggregateType === snapshot.ref.aggregateType && e.aggregateId ===
        (snapshot.ref.aggregateType === 'CommunicationIntent' ? snapshot.ref.intentId : snapshot.ref.aggregateType === 'Subscription' ? snapshot.ref.subscriptionId : snapshot.ref.aggregateType === 'Delivery' ? snapshot.ref.deliveryId : snapshot.ref.waitId));
      if (events.length !== 1 || events[0]!.aggregateRevision !== snapshot.revision || events[0]!.workspaceId !== sub.ref.workspaceId) return false;
      const event = events[0]!;
      if (snapshot.ref.aggregateType === 'CommunicationIntent') { if (event.eventType !== 'CommunicationIntentSettled' || canonicalJson(event.payload.intent) !== canonicalJson(next.intent)) return false; }
      else if (snapshot.ref.aggregateType === 'Subscription') { if (event.eventType !== 'SubscriptionCatchupAdvanced' || canonicalJson(event.payload) !== canonicalJson({ subscription: sub.subscription, intent: next.intent })) return false; }
      else if (snapshot.ref.aggregateType === 'Delivery') { if (event.eventType !== 'DeliveryRecorded' || canonicalJson(event.payload.delivery) !== canonicalJson((snapshot as import('../../../contracts/coordination.js').DeliverySnapshot).delivery)) return false; }
      else if (event.eventType !== 'WaitConditionObserved' || canonicalJson(event.payload.wait) !== canonicalJson((snapshot as import('../../../contracts/coordination.js').WaitConditionSnapshot).wait)) return false;
    }
    return true;
  } catch { return false; }
}


/** Ordinary route pages may only copy their exact committed source and prior subscription. */
export function validateRoutePageState(batch: import('../../../contracts/coordination.js').CommunicationRoutePageCommitV1,
  load: (ref: import('../../../contracts/ledger.js').AggregateRef) => import('../../../contracts/ledger.js').AggregateSnapshot | undefined,
  sourceAt: (cursor: import('../../../contracts/command-event.js').CommitCursor) => import('../../../contracts/events.js').DomainEvent | undefined): boolean {
  try {
    const done = batch.snapshots.find((s): s is import('../../../contracts/coordination.js').CommunicationIntentSnapshot => s.ref.aggregateType === 'CommunicationIntent' && (s as import('../../../contracts/coordination.js').CommunicationIntentSnapshot).intent.status === 'done');
    if (!done || done.intent.domain.kind !== 'route_page') return false;
    const prior = load(done.ref) as import('../../../contracts/coordination.js').CommunicationIntentSnapshot | undefined;
    if (!prior || prior.intent.domain.kind !== 'route_page' || prior.intent.status !== 'leased' || prior.intent.sideEffectStarted ||
        prior.intent.leaseGeneration !== done.intent.leaseGeneration || prior.intent.leaseOwner !== done.intent.leaseOwner) return false;
    const domain = done.intent.domain;
    const event = sourceAt(domain.sourceCursor);
    const source = event ? communicationSource(event, domain.sourceCursor) : null;
    const subs = batch.snapshots.filter((s): s is import('../../../contracts/coordination.js').SubscriptionSnapshot => s.ref.aggregateType === 'Subscription');
    for (const sub of subs) {
      const old = load(sub.ref) as import('../../../contracts/coordination.js').SubscriptionSnapshot | undefined;
      if (!old || !source || source.projectId !== sub.ref.projectId || source.workspaceId !== sub.ref.workspaceId || source.topic !== domain.sourceTopic) return false;
      if (canonicalJson(sub) !== canonicalJson({ ...old, revision: old.revision + 1, recordedAt: sub.recordedAt,
          subscription: { ...old.subscription, routedThroughCursor: source.cursor } })) return false;
      if (old.subscription.routedThroughCursor !== null && String(old.subscription.routedThroughCursor) > String(source.cursor)) return false;
      if (old.subscription.status !== 'active') continue;
      if (!old.subscription.topics.includes(source.topic) || (old.subscription.startCursor !== null && String(old.subscription.startCursor) >= String(source.cursor))) return false;
      if (old.subscription.catchup && (load(old.subscription.catchup.intentRef) as import('../../../contracts/coordination.js').CommunicationIntentSnapshot | undefined)?.intent.status !== 'done') return false;
      const id = subscriptionDeliveryIdFor({ subscriptionRef: sub.ref, topic: source.topic, cursor: source.cursor, targetWorkContextRef: sub.subscription.ownerWorkContextRef });
      const ref = { aggregateType: 'Delivery' as const, projectId: sub.ref.projectId, workspaceId: sub.ref.workspaceId, deliveryId: id };
      const delivery = (batch.snapshots.find(s => canonicalJson(s.ref) === canonicalJson(ref)) ?? load(ref)) as import('../../../contracts/coordination.js').DeliverySnapshot | undefined;
      if (!delivery || canonicalJson(delivery.delivery.bodyRef) !== canonicalJson(source.bodyRef) || canonicalJson(delivery.delivery.sourceRefs) !== canonicalJson(source.sourceRefs)) return false;
    }
    return true;
  } catch { return false; }
}


export function validateCommunicationReconcileState(batch: import('../../../contracts/coordination.js').CommunicationIntentReconcileCommitV1,
  get: (ref: import('../../../contracts/ledger.js').AggregateRef) => import('../../../contracts/ledger.js').AggregateSnapshot | undefined): boolean {
  try {
    if (!validateCommunicationCommit(batch) || batch.identity.actor.kind !== 'system' || batch.events.length !== 1 || batch.snapshots.length !== 1 ||
        batch.expectedVersions.length !== 1 || batch.outboxIntents.length || batch.routeIntentPlans?.length) return false;
    const event = batch.events[0], next = batch.snapshots[0] as import('../../../contracts/coordination.js').CommunicationIntentSnapshot;
    if (event?.eventType !== 'CommunicationIntentSettled' || next.ref.aggregateType !== 'CommunicationIntent' ||
        event.aggregateId !== next.ref.intentId || event.aggregateRevision !== next.revision || event.workspaceId !== next.ref.workspaceId ||
        canonicalJson(event.payload.intent) !== canonicalJson(next.intent)) return false;
    const prior = get(next.ref) as import('../../../contracts/coordination.js').CommunicationIntentSnapshot | undefined;
    return !!prior && canonicalJson(quarantineCommunicationIntent(prior, event.occurredAt)) === canonicalJson(next);
  } catch { return false; }
}
