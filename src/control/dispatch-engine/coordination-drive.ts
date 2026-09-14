/**
 * Dispatch 侧协作通信驱动：请求、投递与等待受理。
 *
 * ── 位置与收口───────────────────────────────────────────────
 * 本驱动**挂在唯一公开入口 `DispatchEngineImpl.drive(trigger)` 之内**：不新增第二生产入口、
 * 不新开后台循环；宿主只唤醒此持久扫描，不另持有同一工作的启动权。
 * 一次 drive 的协作与 ordinary 两段各以 `trigger.maxIntents`（默认 8）为上界，因此"继续分页"
 * 也始终是有界的。
 *
 * ── 权威边界（谁是权威，谁只是提议）──────────────────────────────────────────
 *   · **领取**：只经 `control.claimCommunicationIntent`（CAS + 单调 generation）。拿不到就是
 *     `owned_elsewhere`，本驱动**不自己重试抢**；`sideEffectStarted` 且租约过期时
 *     `requires_reconcile`——**绝不重领**，经正式对账进入可见 quarantine。
 *   · **路由页**：本驱动只**提议** `RoutePageProposalV1`。页内订阅候选来自 Control 的只读面
 *     （账本里 SubscriptionCreated 事件的 canonical ref → load 快照 → 与 Control 同一个纯策略
 *     `selectPageSubscriptions` 决定 horizon），投递目标恒为订阅自己的 ownerWorkContextRef，
 *     真正的准入复核（目标 Work、订阅期望版本、去重、checkpoint 严格推进、条件推进）全部在
 *     Control 与 StateLedger 的专用校验里，本驱动写不进任何"Control 不接受"的页。
 *   · **接续判定**："条件已满足但前驱仍 active"需要前驱 Run 的 canonical 状态，本驱动不判定，
 *     只调用 `control.ensureWaitAdmission`（Control 判定后幂等建立 wait_admission intent）。
 *   · **后继**：唯一 successor TaskAttempt/Run/outbox 由 `control.admitWaitSuccessor` 在**同一事务**
 *     里创建；本驱动只提供派生 id（`successorIdsFor` 的同一规则）与 Wait 上的精确 Delivery 引用。
 *
 * ── 消费的事实（全部来自持久状态，没有任何内存队列）────────────────────────────
 * 一次 drive 做一次有界事件扫描，收集：CommunicationIntentRecorded 的 intent 引用、
 * SubscriptionCreated/Cancelled 的订阅引用、Wait* 的等待引用、以及**可路由域事件**的位置索引。
 * 重启后（SQLite close+reopen）这些事实照样读得到，因此不需要"再开一个内存对象"的伪恢复。
 *
 * ── 如实记录的边界（不假装已满足）─────────────────────────────────────────────
 *   (1) 路由 topic 词表是**封闭的账本域事件名**（见 communicationTopicOf）：只有列在表里的
 *       协作通信事件可被订阅命中。这不是通用事件总线，也不打算在当前实现变成一条。
 *   (2) 源事件生产者在 canonical 提交内固定 active subscription scope 并登记 route intent。
 *       历史 catchup 使用订阅创建时的固定 horizon；完成后再推进 live intent。
 *   (3) not_ready 不伪造 done/cancelled；已证实无副作用的 intent 可按 availableAt 退避，
 *       否则必须走正式对账/隔离。旧 generation 不能据租约到期自行重复副作用。
 *   (4) 页位置只在"有候选订阅"时才被提交；没有任何候选订阅的位置不会被写进 checkpoint，
 *       因此不会用空页把 topic checkpoint 往前推。
 */
import type { CommitCursor } from "../../contracts/command-event.js";
import type { DomainEvent } from "../../contracts/events.js";
import type { StateLedger } from "../../contracts/ledger.js";
import type { CoordinationControl } from "../../contracts/modules.js";
import type { RunSnapshot } from "../../contracts/dispatch.js";
import type { WorkContextBindingSnapshot } from "../../contracts/context-continuity.js";
import type {
  AdmitWaitSuccessorCommand,
  CommunicationIntentRef,
  CommunicationIntentSnapshot,
  CommunicationSettleCommand,
  CommunicationSettleReceipt,
  DeliveryRef,
  DeliveryV1,
  EnsureWaitAdmissionCommand,
  RoutePageProposalV1,
  RoutePageSubscriptionScopeEntry,
  SubscriptionRef,
  SubscriptionSnapshot,
  WaitConditionRef,
  WaitConditionSnapshot,
} from "../../contracts/coordination.js";
import {
  COMMUNICATION_INTENT_MAX_ATTEMPTS,
  COMMUNICATION_PAGE_MAX_DELIVERIES,
  communicationIntentRefFor,
  directedRequestRefFor,
  deliveryRefFor,
  successorAttemptIdFor,
  successorRunIdFor,
  waitConditionRefFor,
} from "../../contracts/coordination.js";
import { canonicalJson, sha256Hex } from "../../contracts/fingerprint.js";
import { backoffDelayMs, selectPageSubscriptions, type RoutableSourceEvent } from "../control-engine/policies/coordination-rules.js";
import { resolveAdmittedDeliveryRefs } from "./coordination-admission-deliveries.js";
import type {
  CoordinationBacklog,
  CoordinationDriveFailure,
  CoordinationDriveResult,
} from "../../contracts/ports.js";

/** 事件扫描分页大小与页数上限（与 Control 的 mailboxView 同一口径）。 */
export const COORDINATION_SCAN_PAGE_SIZE = 1000;
export const COORDINATION_MAX_SCAN_PAGES = 200;
/** 默认领取租约（毫秒）：到期后**未产生副作用**的 intent 才允许被别人重领。 */
export const COORDINATION_DEFAULT_LEASE_MS = 60_000;
/** 本驱动默认的 consumer id。它是**确定性**的：重启后同一消费者可以重领自己未完成的租约。 */
export const COORDINATION_DRIVE_CONSUMER_ID = "coordination-drive";

export type CoordinationDriveDeps = {
  ledger: Pick<StateLedger, "load" | "events" | "alternativeReport">;
  control: Pick<
    CoordinationControl,
    "claimCommunicationIntent" | "settleCommunicationIntent" | "admitWaitSuccessor" | "ensureWaitAdmission" | "requestCommunicationIntentCancellation" | "reconcileCommunicationIntent"
  >;
  /** 调用方时钟（claim 的 now / settle 的 settledAt 都由它给出）。 */
  now: () => string;
  consumerId?: string;
  leaseDurationMs?: number;
  /**
   * 一页最多处理多少个订阅。默认 `COMMUNICATION_PAGE_MAX_DELIVERIES`（与 Control 的页内投递
    * 上界同一个常量），因此**生产路径的行为不因这个注入点改变**。它是协作通信规范明列
   * 「可在实现中收敛」的分页大小：宿主/测试可以用更小的页驱动"同一事件位置必须翻多页"的真实链路，
   * 而不必为了触发分页去造 64 个以上订阅。
   */
  pageSize?: number;
  prepareAlternativeReports?: (wait: WaitConditionSnapshot) => Promise<import('../../contracts/alternative-report.js').AlternativeReportInspection | null>;
};

/** 一条可路由域事件：位置 + topic + 正文/来源 + 可选请求归属。 */
type RoutableEvent = {
  cursor: CommitCursor;
  topic: string;
  bodyRef: DeliveryV1["bodyRef"];
  sourceRefs: DeliveryV1["sourceRefs"];
  requestRef: ReturnType<typeof directedRequestRefFor> | null;
};

/**
 * 路由 topic 词表：**就是账本域事件名本身**（封闭、有类型，不是自由字符串、不是 DSL）。
 * 只有这里列出的协作通信事件可以被订阅命中；其余事件不参与路由。
 */
export function communicationTopicOf(event: DomainEvent): string | null {
  switch (event.eventType) {
    case "DirectedRequestSent":
    case "DirectedRequestResponded":
    case "WorkParticipationEnded":
    case "WaitConditionSatisfied":
      return event.eventType;
    default:
      return null;
  }
}

/** 可路由事件的正文与来源。正文为 null 表示"这次投递只证明该位置发生了这件事"。 */
function routablePayloadOf(event: DomainEvent): Pick<RoutableEvent, "bodyRef" | "sourceRefs" | "requestRef"> {
  switch (event.eventType) {
    case "DirectedRequestSent": {
      const request = event.payload.request;
      return {
        bodyRef: request.statementBodyRef,
        sourceRefs: [{ kind: "directed-request", refId: request.requestId, revision: "1" }],
        requestRef: directedRequestRefFor(request.projectId, request.workspaceId, request.requestId),
      };
    }
    case "DirectedRequestResponded": {
      const request = event.payload.request;
      return {
        bodyRef: request.response?.bodyRef ?? null,
        sourceRefs: (request.response?.sourceRefs ?? []).map((ref) => ({ ...ref })),
        requestRef: directedRequestRefFor(request.projectId, request.workspaceId, request.requestId),
      };
    }
    default:
      return { bodyRef: null, sourceRefs: [], requestRef: null };
  }
}

/** 订阅投递的确定性 id：同一 (订阅, topic, 位置, 目标 Work) 永远同一个 id（重放不产生第二条）。 */
export { subscriptionDeliveryIdFor } from "../../contracts/coordination.js";
import { subscriptionDeliveryIdFor, communicationSource } from "../../contracts/coordination.js";

export class CoordinationDrive {
  constructor(private readonly deps: CoordinationDriveDeps) {}

  private get consumerId(): string { return this.deps.consumerId ?? COORDINATION_DRIVE_CONSUMER_ID; }

  /** 页内订阅上界（默认与 Control 的页内投递上界一致；注入值被夹在该上界之内）。 */
  private get pageSize(): number {
    const configured = this.deps.pageSize;
    if (configured === undefined || !Number.isFinite(configured)) return COMMUNICATION_PAGE_MAX_DELIVERIES;
    return Math.max(1, Math.min(COMMUNICATION_PAGE_MAX_DELIVERIES, Math.floor(configured)));
  }

  async drive(maxIntents: number): Promise<CoordinationDriveResult> {
    const failures: CoordinationDriveFailure[] = [];
    const result = {
      claimed: 0, pagesRouted: 0, deliveries: 0, deadlinesSettled: 0, admissions: 0,
      waitAdmissionsEnsured: 0, deferred: 0, cancelConverged: 0,
    };
    let backlog: CoordinationBacklog = { ...this.backlogOf([]), incomplete: true };
    try {
      const scan = await this.scan();
      backlog = this.backlogOf(scan.intents);
      let budget = Math.max(0, Math.floor(maxIntents));
      for (const intent of scan.intents) {
        if (budget <= 0) break;
        if (intent.intent.status !== 'outcome_unknown' && !(intent.intent.status === 'leased' && intent.intent.sideEffectStarted && this.leaseExpired(intent))) continue;
        budget--;
        if (!this.deps.control.reconcileCommunicationIntent) throw Error('Communication reconciliation is not connected');
        const id = 'reconcile-' + intent.ref.intentId + '-r' + intent.revision;
        const receipt = await this.deps.control.reconcileCommunicationIntent({ commandId: id, commandType: 'ReconcileCommunicationIntent', schemaVersion: 1,
          aggregateId: intent.ref.intentId, expectedRevision: intent.revision, correlationId: id, submittedAt: this.deps.now(),
          identity: { projectId: intent.ref.projectId, actor: { kind: 'system', id: this.consumerId }, idempotencyKey: id },
          payload: { workspaceId: intent.ref.workspaceId } });
        if (receipt.status !== 'committed') failures.push({ intentId: intent.ref.intentId, code: 'rejected', message: 'Communication reconciliation rejected' });
        else {
          const fresh = await this.deps.ledger.load(intent.ref);
          if (fresh.status === 'found') Object.assign(intent, fresh.snapshot);
        }
      }
      budget -= await this.recoverWaitCancellations(scan.intents, scan.waits, failures, budget);
      // (a) cancel_requested：只能由本 drive 以**同一 generation** 收敛（不发放新 generation）。
      for (const intent of scan.intents) {
        if (budget <= 0) break;
        if (intent.intent.status !== "cancel_requested") continue;
        budget--;
        result.cancelConverged += await this.convergeCancelled(intent, failures);
      }
      // All mechanical categories share the same oldest-progress queue.
      const frontier = this.topicFrontiers(scan.intents);
      const work = scan.intents.filter(intent => {
        if (!this.claimable(intent)) return false;
        const d = intent.intent.domain;
        if (d.kind !== 'route_page') return true;
        if (frontier.get(this.routingScope(intent)) !== String(d.sourceCursor)) return false;
        return !d.subscriptionScope.some(entry => {
          const sub = scan.subscriptions.find(s => canonicalJson(s.ref) === canonicalJson(entry.subscriptionRef));
          if (!sub?.subscription.catchup || sub.subscription.status !== 'active') return false;
          return scan.intents.find(i => canonicalJson(i.ref) === canonicalJson(sub.subscription.catchup!.intentRef))?.intent.status !== 'done';
        });
      });
      for (const [index, intent] of work.entries()) {
        if (budget <= 0) break;
        const d = intent.intent.domain;
        if (d.kind === 'route_page') {
          const reserved = Math.min(budget - 1, work.length - index - 1);
          budget -= Math.max(1, await this.routePages(intent, scan, result, failures, budget - reserved));
        } else if (d.kind === 'architecture_decision_delivery') {
          budget--; await this.architectureDelivery(intent, result, failures);
        } else if (d.kind === 'subscription_catchup') {
          budget--; await this.catchupPage(intent, result, failures);
        } else if (d.kind === 'wait_deadline') {
          budget--; await this.settleDeadline(intent, result, failures);
        } else {
          budget--; await this.admitFromIntent(intent, result, failures);
        }
      }
      // (e) 条件已满足但前驱仍 active：请 Control 判定并幂等建立 wait_admission intent。
      //     放在 (d) 之前，并重新扫描一次 intent 列表，使本 drive 内刚建立的 intent
      //     能在同一次 drive 里被领取（否则要等下一次 drive，等待后继的"事件先到"时序仍然成立，
      //     但会多消耗一次 drive 预算）。
      // Decision delivery can register a Wait in this same drive. Include those durable facts now.
      const waitRefs = result.deliveries>0 && work.some(i=>i.intent.domain.kind==='architecture_decision_delivery') ? (await this.scan()).waitRefs : scan.waitRefs;
      for (const waitRef of waitRefs) {
        if (budget <= 0) break;
        const ensured = await this.ensureAdmission(waitRef, failures);
        if (ensured.receipt === "ensured") result.waitAdmissionsEnsured += 1;
        if (ensured.receipt !== "skipped" && ensured.code !== "predecessor_ended") budget -= 1;
        if (ensured.code === "predecessor_ended" && budget > 0) {
          // 后继触发规则的第二个触发点：条件已满足、前驱**已经**公开结束。这时不需要"前驱结束时复查"的
          // intent——直接请 Control 受理唯一后继（Control 在同一事务里复查资格并创建
          // TaskAttempt/Run/唯一 outbox；不满足则零写入 not_ready）。判定仍在 Control。
          await this.admitWait(waitRef, result, failures);
          budget -= 1;
        }
      }
      // (d) wait admission：唯一后继在同一事务里创建。
      const intents = await this.scanIntents();
      for (const intent of intents) {
        if (budget <= 0) break;
        if (intent.intent.domain.kind !== "wait_admission" || work.some(w => canonicalJson(w.ref) === canonicalJson(intent.ref))) continue;
        if (!this.claimable(intent)) continue;
        await this.admitFromIntent(intent, result, failures);
        budget -= 1;
      }
      // backlog 在**推进之后**重新从持久状态读一遍：drive 结果要回答的是"现在还剩什么"，
      // 而不是"开始时看到什么"（两者在同一个 drive 里刚建立 intent 时会不同）。
      backlog = this.backlogOf(await this.scanIntents());
    } catch (error) {
      backlog = { ...backlog, incomplete: true };
      // 协作推进**绝不让唯一 drive 收口抛错**：ordinary outbox 必须继续被推进。
      failures.push({
        intentId: "coordination-drive",
        code: "unavailable",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return { ...result, failures, backlog };
  }

  /**
   * 每个 topic 当前允许推进的**事件处理位置**（协议约束 1.4：末页完成后才推进）。
   *
   * 取该 topic 上所有**未收敛** route intent 的 sourceCursor 最小值。未收敛 = 不是
   * done / cancelled。未知与隔离会阻塞该作用域后续源位置，并在 backlog 显示原因；
   * 不能把后续 checkpoint 越过缺失投递。其他种类工作仍参与公平调度。
   */
  private routingScope(intent: CommunicationIntentSnapshot): string {
    return canonicalJson([intent.ref.projectId, intent.ref.workspaceId]);
  }
  private async recoverWaitCancellations(intents: CommunicationIntentSnapshot[], waits: WaitConditionSnapshot[], failures: CoordinationDriveFailure[], budget: number) {
    let used = 0;
    for (let i = 0; i < intents.length && used < budget; i++) {
      const intent = intents[i]!, d = intent.intent.domain;
      if (d.kind !== 'wait_deadline' && d.kind !== 'wait_admission') continue;
      if (['done','cancelled','cancel_requested','quarantined','outcome_unknown'].includes(intent.intent.status)) continue;
      if (!waits.some(w => canonicalJson(w.ref) === canonicalJson(d.waitRef) && w.wait.status === 'cancelled')) continue;
      used++;
      const id = 'recover-cancel-' + intent.intent.intentId + '-' + intent.revision;
      if (!this.deps.control.requestCommunicationIntentCancellation) throw Error('Canonical cancellation recovery is not connected');
      const receipt = await this.deps.control.requestCommunicationIntentCancellation({ commandId: id, commandType: 'RequestCommunicationIntentCancellation', schemaVersion: 1,
        aggregateId: intent.intent.intentId, expectedRevision: intent.revision, correlationId: id, submittedAt: this.deps.now(),
        identity: { projectId: intent.ref.projectId, actor: { kind: 'system', id: this.consumerId }, idempotencyKey: id },
        payload: { workspaceId: intent.ref.workspaceId, reason: 'Canonical Wait was cancelled before restart' } });
      if (receipt.status !== 'committed') { failures.push({ intentId: intent.intent.intentId, code: 'rejected', message: 'Wait cancellation recovery was rejected' }); continue; }
      const fresh = await this.deps.ledger.load(intent.ref);
      if (fresh.status === 'found') intents[i] = fresh.snapshot as CommunicationIntentSnapshot;
    }
    return used;
  }
  private async architectureDelivery(intent:CommunicationIntentSnapshot,result:{claimed:number;deliveries:number},failures:CoordinationDriveFailure[]) {
    const claim=await this.claim(intent,failures);if(!claim)return;result.claimed++;
    const id='architecture-delivery-'+intent.ref.intentId+'-'+claim.revision;
    const receipt=await this.deps.control.settleCommunicationIntent({schemaVersion:1,commandType:'CommunicationSettleIntent',commandId:id,aggregateId:intent.ref.intentId,expectedRevision:claim.revision,identity:{projectId:intent.ref.projectId,actor:{kind:'system',id:this.consumerId},idempotencyKey:id},correlationId:id,submittedAt:this.deps.now(),payload:{outcome:'architecture_delivery',workspaceId:intent.ref.workspaceId,consumerId:this.consumerId,leaseGeneration:claim.generation,settledAt:this.deps.now()}});
    if(receipt.status==='committed')result.deliveries+=receipt.deliveries.length;
    else failures.push({intentId:intent.ref.intentId,code:'rejected',message:'Architecture decision delivery rejected: '+JSON.stringify(receipt)});
  }

  private async catchupPage(intent: CommunicationIntentSnapshot, result: { claimed: number; pagesRouted: number; deliveries: number }, failures: CoordinationDriveFailure[]) {
    const claimed = await this.claim(intent, failures); if (!claimed) return;
    result.claimed++;
    const id = 'catchup-page-' + intent.ref.intentId + '-' + claimed.revision;
    const receipt = await this.deps.control.settleCommunicationIntent({ commandId: id, commandType: 'CommunicationSettleIntent', schemaVersion: 1,
      aggregateId: intent.ref.intentId, expectedRevision: claimed.revision, correlationId: id, submittedAt: this.deps.now(),
      identity: { projectId: intent.ref.projectId, actor: { kind: 'system', id: this.consumerId }, idempotencyKey: id },
      payload: { outcome: 'catchup_page', workspaceId: intent.ref.workspaceId, consumerId: this.consumerId, leaseGeneration: claimed.generation, settledAt: this.deps.now() } });
    if (receipt.status === 'committed') { result.pagesRouted++; result.deliveries += receipt.deliveries.length; }
    else failures.push({ intentId: intent.ref.intentId, code: 'rejected', message: 'Historical catchup was rejected: ' + JSON.stringify(receipt) });
  }

  private topicFrontiers(intents: CommunicationIntentSnapshot[]): Map<string, string> {
    const frontier = new Map<string, string>();
    for (const intent of intents) {
      if (intent.intent.domain.kind !== "route_page") continue;
      const status = intent.intent.status;
      if (status === "done" || status === "cancelled") continue;
      const domain = intent.intent.domain;
      const current = frontier.get(this.routingScope(intent));
      const cursor = String(domain.sourceCursor);
      if (current === undefined || cursor < current) frontier.set(this.routingScope(intent), cursor);
    }
    return frontier;
  }

  /**
   * 可领取的本地判据（不做权威判定，权威在 Control 的 claim）：终态、未到期租约、未到
   * availableAt、cancel_requested 一律不由本路径领取。
   */
  private claimable(intent: CommunicationIntentSnapshot): boolean {
    const status = intent.intent.status;
    if (status === "pending" || status === "retry_scheduled") {
      return intent.intent.availableAt === null || intent.intent.availableAt <= this.deps.now();
    }
    if (status === "leased") {
      // 自己的租约（含未过期）可以继续处理；别人的租约交给 Control 判定 owned_elsewhere。
      return intent.intent.leaseOwner === this.consumerId || this.leaseExpired(intent);
    }
    return false;
  }

  private leaseExpired(intent: CommunicationIntentSnapshot): boolean {
    if (intent.intent.status !== "leased" || intent.intent.leaseExpiresAt === null) return false;
    return intent.intent.leaseExpiresAt <= this.deps.now();
  }

  // --------------------------------------------------------------------- //
  // 有界事件扫描：intent / 订阅 / 等待 / 可路由事件位置                        //
  // --------------------------------------------------------------------- //

  private async scan(): Promise<{
    intents: CommunicationIntentSnapshot[];
    subscriptions: SubscriptionSnapshot[];
    waits: WaitConditionSnapshot[];
    waitRefs: WaitConditionRef[];
    routable: Map<string, RoutableEvent>;
  }> {
    const intentRefs = new Map<string, CommunicationIntentRef>();
    const subscriptionRefs = new Map<string, SubscriptionRef>();
    const waitRefs = new Map<string, WaitConditionRef>();
    const routable = new Map<string, RoutableEvent>();
    let cursor: CommitCursor | null = null;
    let pages = 0;
    for (;;) {
      const page = await this.deps.ledger.events({ afterCursor: cursor, limit: COORDINATION_SCAN_PAGE_SIZE });
      for (const positioned of page.events) {
        this.collect(positioned.event, positioned.cursor, { intentRefs, subscriptionRefs, waitRefs, routable });
      }
      if (!page.hasMore) break;
      if (page.throughCursor === null || page.throughCursor === cursor) throw Error('Coordination scan did not advance; result is incomplete');
      cursor = page.throughCursor;
      pages += 1;
      if (pages >= COORDINATION_MAX_SCAN_PAGES) throw Error('Coordination scan exceeded its page bound; result is incomplete');
    }
    const intents: CommunicationIntentSnapshot[] = [];
    for (const ref of intentRefs.values()) {
      const loaded = await this.deps.ledger.load(ref);
      if (loaded.status === "found" && loaded.snapshot.ref.aggregateType === "CommunicationIntent") {
        intents.push(loaded.snapshot as CommunicationIntentSnapshot);
      }
    }
    // Map order follows the last durable intent event, so progress rotates an
    // item behind older candidates even with a fixed or skewed wall clock.
    const subscriptions: SubscriptionSnapshot[] = [];
    for (const ref of subscriptionRefs.values()) {
      const loaded = await this.deps.ledger.load(ref);
      if (loaded.status === "found" && loaded.snapshot.ref.aggregateType === "Subscription") {
        subscriptions.push(loaded.snapshot as SubscriptionSnapshot);
      }
    }
    const waits: WaitConditionSnapshot[] = [];
    for (const ref of waitRefs.values()) {
      const loaded = await this.deps.ledger.load(ref);
      if (loaded.status === "found" && loaded.snapshot.ref.aggregateType === "WaitCondition") {
        waits.push(loaded.snapshot as WaitConditionSnapshot);
      }
    }
    return { intents, subscriptions, waits, waitRefs: [...waitRefs.values()], routable };
  }

  /** 只重新读 intent（页/等待推进之后新建立的 intent 需要被同一次 drive 看到）。 */
  private async scanIntents(): Promise<CommunicationIntentSnapshot[]> {
    const refs = new Map<string, CommunicationIntentRef>();
    let cursor: CommitCursor | null = null;
    let pages = 0;
    for (;;) {
      const page = await this.deps.ledger.events({ afterCursor: cursor, limit: COORDINATION_SCAN_PAGE_SIZE });
      for (const positioned of page.events) {
        if (positioned.event.eventType !== "CommunicationIntentRecorded" && positioned.event.eventType !== "CommunicationIntentClaimed" && positioned.event.eventType !== "CommunicationIntentSettled" && positioned.event.eventType !== "CommunicationIntentCancelRequested") continue;
        const intent = positioned.event.payload.intent;
        const ref = communicationIntentRefFor(intent.projectId, intent.workspaceId, intent.intentId);
        refs.delete(canonicalJson(ref as never));
        refs.set(canonicalJson(ref as never), ref);
      }
      if (!page.hasMore) break;
      if (page.throughCursor === null || page.throughCursor === cursor) throw Error('Coordination scan did not advance');
      cursor = page.throughCursor;
      pages += 1;
      if (pages >= COORDINATION_MAX_SCAN_PAGES) throw Error('Coordination scan exceeded its page bound');
    }
    const out: CommunicationIntentSnapshot[] = [];
    for (const ref of refs.values()) {
      const loaded = await this.deps.ledger.load(ref);
      if (loaded.status === "found" && loaded.snapshot.ref.aggregateType === "CommunicationIntent") {
        out.push(loaded.snapshot as CommunicationIntentSnapshot);
      }
    }
    return out;
  }

  /** 只按事件 payload 里声明的 canonical 归属关系收引用（与 Control 的 mailboxView 同一手法）。 */
  private collect(
    event: DomainEvent,
    cursor: CommitCursor,
    out: {
      intentRefs: Map<string, CommunicationIntentRef>;
      subscriptionRefs: Map<string, SubscriptionRef>;
      waitRefs: Map<string, WaitConditionRef>;
      routable: Map<string, RoutableEvent>;
    },
  ): void {
    switch (event.eventType) {
      case "CommunicationIntentClaimed":
      case "CommunicationIntentSettled":
      case "CommunicationIntentCancelRequested":
      case "CommunicationIntentRecorded": {
        const intent = event.payload.intent;
        const ref = communicationIntentRefFor(intent.projectId, intent.workspaceId, intent.intentId);
        out.intentRefs.delete(canonicalJson(ref as never));
        out.intentRefs.set(canonicalJson(ref as never), ref);
        return;
      }
      case "SubscriptionCreated":
      case "SubscriptionCancelled":
      case "SubscriptionCatchupAdvanced":
      case "SubscriptionCatchupPlanned": {
        const subscription = event.payload.subscription;
        const ref = { aggregateType: "Subscription" as const, projectId: subscription.projectId, workspaceId: subscription.workspaceId, subscriptionId: subscription.subscriptionId };
        out.subscriptionRefs.set(canonicalJson(ref as never), ref);
        return;
      }
      case "WaitConditionRegistered":
      case "WaitConditionObserved":
      case "WaitConditionSatisfied":
      case "WaitConditionTimedOut":
      case "WaitConditionCancelled": {
        const wait = event.payload.wait;
        const ref = waitConditionRefFor(wait.projectId, wait.workspaceId, wait.waitId);
        out.waitRefs.set(canonicalJson(ref as never), ref);
        break;
      }
      default: break;
    }
    const topic = communicationTopicOf(event);
    if (topic === null) return;
    const payload = routablePayloadOf(event);
    out.routable.set(String(cursor), { cursor, topic, ...payload });
  }

  // --------------------------------------------------------------------- //
  // backlog（来自持久状态）                                                   //
  // --------------------------------------------------------------------- //

  private backlogOf(intents: CommunicationIntentSnapshot[]): CoordinationBacklog {
    const now = Date.parse(this.deps.now());
    let oldest: number | null = null;
    const backlog: CoordinationBacklog = {
      pending: 0, leased: 0, retryScheduled: 0, cancelRequested: 0,
      quarantined: 0, outcomeUnknown: 0, done: 0, requiresReconcile: 0,
      oldestPendingAgeMs: null, observed: intents.length, oldestPendingIntent: null, blocked: [],
    };
    for (const snapshot of intents) {
      const intent = snapshot.intent;
      switch (intent.status) {
        case "pending": backlog.pending += 1; break;
        case "leased":
          backlog.leased += 1;
          if (this.leaseExpired(snapshot) && intent.sideEffectStarted) backlog.requiresReconcile += 1;
          break;
        case "retry_scheduled": backlog.retryScheduled += 1; break;
        case "cancel_requested": backlog.cancelRequested += 1; break;
        case "quarantined": backlog.quarantined += 1; break;
        case "outcome_unknown": backlog.outcomeUnknown += 1; break;
        case "cancelled":
        case "done": backlog.done += 1; break;
      }
      if (intent.status === "done" || intent.status === "cancelled") continue;
      if (backlog.blocked.length < 32) backlog.blocked.push({ intentRef: snapshot.ref, status: intent.status,
        reason: intent.lastFailureClass ?? (intent.sideEffectStarted ? 'requires_reconcile' : intent.status),
        availableAt: intent.availableAt });
      const createdAt = Date.parse(intent.createdAt);
      if (Number.isFinite(createdAt) && Number.isFinite(now)) {
        const age = Math.max(0, now - createdAt);
        if (oldest === null || age > oldest) { oldest = age; backlog.oldestPendingIntent = snapshot.ref; }
      }
    }
    backlog.oldestPendingAgeMs = oldest;
    return backlog;
  }

  // --------------------------------------------------------------------- //
  // 领取                                                                   //
  // --------------------------------------------------------------------- //

  private async claim(intent: CommunicationIntentSnapshot, failures: CoordinationDriveFailure[]): Promise<{ generation: number; revision: number } | null> {
    const projectId = intent.intent.projectId;
    const workspaceId = intent.intent.workspaceId;
    const commandId = "coord-claim-" + intent.intent.intentId + "-r" + String(intent.revision);
    const receipt = await this.deps.control.claimCommunicationIntent({
      commandId,
      commandType: "CommunicationClaimIntent",
      schemaVersion: 1,
      aggregateId: intent.intent.intentId,
      expectedRevision: intent.revision,
      correlationId: commandId,
      submittedAt: this.deps.now(),
      identity: { projectId, actor: { kind: "system", id: this.consumerId }, idempotencyKey: commandId },
      payload: {
        workspaceId,
        consumerId: this.consumerId,
        leaseDurationMs: this.deps.leaseDurationMs ?? COORDINATION_DEFAULT_LEASE_MS,
        now: this.deps.now(),
      },
    });
    if (receipt.status === "claimed") return { generation: receipt.leaseGeneration, revision: receipt.revision };
    const message = receipt.status === "rejected" ? (receipt.issues ?? []).join("; ") : "";
    // not_claimable（未到 availableAt / 已终态）是正常节流，不是失败；
    // requires_reconcile / cancel_requested 是**必须看得见**的事实。
    if (receipt.status === "rejected" && /not_claimable/.test(message)) return null;
    if (receipt.status === "rejected" && /cancel_requested/.test(message)) return null;
    failures.push({
      intentId: intent.intent.intentId,
      code: receipt.status === "owned_elsewhere" ? "owned_elsewhere"
        : /requires_reconcile/.test(message) ? "requires_reconcile"
        : receipt.status === "not_found" ? "not_found"
        : receipt.status === "rejected" && receipt.code === "unavailable" ? "unavailable" : "rejected",
      message: "领取未成功（" + receipt.status + "）" + (message.length > 0 ? "：" + message : ""),
    });
    return null;
  }

  // --------------------------------------------------------------------- //
  // 路由页                                                                  //
  // --------------------------------------------------------------------- //

  /** 返回本次消耗的预算（页数）。 */
  private async routePages(
    intent: CommunicationIntentSnapshot,
    scan: { subscriptions: SubscriptionSnapshot[]; waits: WaitConditionSnapshot[]; routable: Map<string, RoutableEvent> },
    result: { claimed: number; pagesRouted: number; deliveries: number; deferred: number },
    failures: CoordinationDriveFailure[],
    pageBudget: number,
  ): Promise<number> {
    let current = intent;
    let used = 0;
    for (;;) {
      // 分页循环也受**一次 drive 的有界预算**约束：预算用尽即交回，下一页留在账本里等下一次 drive。
      if (used >= Math.max(1, pageBudget)) break;
      if (current.intent.domain.kind !== "route_page") break;
      const claimed = await this.claim(current, failures);
      if (claimed === null) break;
      result.claimed += 1;
      const built = this.buildPage(current, scan);
      if ("failure" in built) {
        // 读不完整/与固定范围对不上：**可见失败**，不静默跳过（协议约束 2.4）。
        failures.push({ intentId: current.intent.intentId, code: "not_found", message: built.failure });
        break;
      }
      const settled = await this.settlePage(current, claimed, built.page, failures);
      if (settled === null) break;
      used += 1;
      result.pagesRouted += 1;
      result.deliveries += settled.deliveries.length;
      if (settled.nextIntentRef === null) break;
      const next = await this.deps.ledger.load(settled.nextIntentRef);
      if (next.status !== "found" || next.snapshot.ref.aggregateType !== "CommunicationIntent") break;
      current = next.snapshot as CommunicationIntentSnapshot;
    }
    return used;
  }

  /**
   * 构造一页提案。协议约束 1.4（**两个位置分开** + **本轮订阅范围固定**）：
   *   · 续页（intent 已固定范围）→ 源事件位置**必须不变**，只在**该事件内**按订阅分页位置继续，
   *     并且候选集合来自 intent 上那份**固定的范围**（不是这次扫描里"现在有哪些订阅"）；
   *   · 首页 → 从 intent 的源事件位置开始，取**第一个**有候选订阅的可路由事件位置；
   *     该位置的全部候选订阅就是**本轮要固定的范围**（不是本页切片——把切片当范围会把下一页的
   *     合法订阅判成范围外，这正是协议约束 1.4 要求区分两件事的原因）。
   *
   * 提案里的 `subscriptionPosition` 是**本页处理到**的订阅位置：处理过订阅就是最后一个被处理订阅的
   * canonical ref key；一页什么都没处理时沿用 intent 已有的位置（不伪造推进）。
   * `subscriptionScope` 首页 = 要固定的整轮范围，续页 = 已固定范围的逐字节回声。
   *
   * 读不完整/对不上时返回**可见失败**（由调用方收进 failures），不静默跳过——
   * 协议约束 2.4：不补猜值。
   */
  private buildPage(
    intent: CommunicationIntentSnapshot,
    scan: { subscriptions: SubscriptionSnapshot[]; waits: WaitConditionSnapshot[]; routable: Map<string, RoutableEvent> },
  ): { page: RoutePageProposalV1 } | { failure: string } {
    if (intent.intent.domain.kind !== "route_page") throw Error("route page 提案只服务 route_page intent");
    const domain = intent.intent.domain;
    const afterKey = domain.subscriptionPosition;
    const refKey = (ref: SubscriptionRef): string => canonicalJson(ref as never);
    const byKey = new Map(scan.subscriptions.map((snapshot) => [refKey(snapshot.ref), snapshot] as const));
    let chosen: RoutableEvent | null = null;
    let candidates: SubscriptionSnapshot[] = [];
    let scopeEntries: RoutePageSubscriptionScopeEntry[] = [];
    if (domain.subscriptionScope.length > 0 || afterKey !== null) {
      // ── 续页：源事件位置不变；候选集合来自**固定的本轮范围** ────────────────────────
      const located = scan.routable.get(String(domain.sourceCursor)) ?? null;
      if (located === null || located.topic !== domain.sourceTopic) {
        return { failure: "续页读不到本 intent 的源事件位置（" + domain.sourceTopic + "@" + String(domain.sourceCursor) + "）；不猜一个新位置" };
      }
      chosen = located;
      scopeEntries = domain.subscriptionScope.map((entry) => ({
        subscriptionRef: { ...entry.subscriptionRef },
        expectedRevision: entry.expectedRevision,
      }));
      if (scopeEntries.length === 0) {
        return { failure: "续页缺少本轮固定的订阅范围（协议约束 1.4）；不按当前扫描另选一份" };
      }
      const unreadable: string[] = [];
      for (const entry of scopeEntries) {
        if (afterKey !== null && refKey(entry.subscriptionRef) <= afterKey) continue; // 本页之前已处理过
        const snapshot = byKey.get(refKey(entry.subscriptionRef));
        if (snapshot === undefined) { unreadable.push(entry.subscriptionRef.subscriptionId); continue; }
        candidates.push(snapshot);
      }
      if (unreadable.length > 0) {
        return { failure: "本轮固定的订阅范围在本页读不到：" + unreadable.join(", ") + "（不静默跳过，交由对账）" };
      }
    } else {
      // ── 首页：固定本轮范围 = 该事件位置的全部候选订阅 ──────────────────────────────
      for (const event of [...scan.routable.values()].sort((a, b) => String(a.cursor).localeCompare(String(b.cursor)))) {
        if (event.topic !== domain.sourceTopic) continue;
        if (String(event.cursor) < String(domain.sourceCursor)) continue;
        const selected = selectPageSubscriptions(scan.subscriptions, this.asSourceEvent(event), null);
        if (selected.length === 0) continue;
        chosen = event;
        candidates = selected;
        scopeEntries = selected.map((snapshot) => ({
          subscriptionRef: { ...snapshot.ref },
          expectedRevision: snapshot.revision,
        }));
        break;
      }
    }
    const empty: RoutePageProposalV1 = {
      schemaVersion: 1,
      sourceTopic: domain.sourceTopic,
      sourceCursor: domain.sourceCursor,
      subscriptionPosition: domain.subscriptionPosition,
      subscriptionScope: scopeEntries,
      subscriptions: [],
      hasMore: false,
    };
    if (chosen === null || candidates.length === 0) return { page: scopeEntries.length === 0 ? empty : { ...empty, subscriptionScope: scopeEntries } };
    const pageSubscriptions = candidates.slice(0, this.pageSize);
    const hasMore = candidates.length > pageSubscriptions.length;
    return { page: {
      schemaVersion: 1,
      sourceTopic: domain.sourceTopic,
      // 同一事件翻页时这里是 intent 的源事件位置（= chosen.cursor）；首页则把它固定为该位置。
      sourceCursor: chosen.cursor,
      subscriptionPosition: canonicalJson(pageSubscriptions[pageSubscriptions.length - 1]!.ref as never),
      // 首页 = 要固定的整轮范围；续页 = 已固定范围的逐字节回声（Control 会逐字节复核）。
      subscriptionScope: scopeEntries,
      subscriptions: pageSubscriptions.map((subscription) => {
        const targetWorkContextRef = subscription.subscription.ownerWorkContextRef;
        const deliveryId = subscriptionDeliveryIdFor({
          subscriptionRef: subscription.ref,
          topic: chosen!.topic,
          cursor: chosen!.cursor,
          targetWorkContextRef,
        });
        const deliveryRef = deliveryRefFor(subscription.ref.projectId, subscription.ref.workspaceId, deliveryId);
        return {
          subscriptionRef: subscription.ref,
          expectedRevision: subscription.revision,
          deliveries: [{
            deliveryId,
            targetWorkContextRef,
            bodyRef: chosen!.bodyRef,
            sourceRefs: chosen!.sourceRefs.map((ref) => ({ ...ref })),
          }],
          // 页内条件推进：只按**引用相等**索引出候选 index（真正的满足判定在 Control：它按
          // canonical 事实逐 index 复核，不满足就整页拒绝）。
          satisfiedWaitIndexes: this.waitTransitionsFor(scan.waits, deliveryRef, chosen.requestRef),
        };
      }),
      hasMore,
    } };
  }

  private asSourceEvent(event: RoutableEvent): RoutableSourceEvent {
    return { topic: event.topic, cursor: event.cursor, bodyRef: event.bodyRef, sourceRefs: event.sourceRefs };
  }

  /** 只做引用匹配：本页新投递的 Delivery 或被引用的请求命中哪些 wait 条件的下标。 */
  private waitTransitionsFor(
    waits: WaitConditionSnapshot[],
    deliveryRef: DeliveryRef,
    requestRef: ReturnType<typeof directedRequestRefFor> | null,
  ): { waitRef: WaitConditionRef; indexes: number[] }[] {
    const out: { waitRef: WaitConditionRef; indexes: number[] }[] = [];
    const deliveryKey = canonicalJson(deliveryRef as never);
    const requestKey = requestRef === null ? null : canonicalJson(requestRef as never);
    for (const wait of waits) {
      if (wait.wait.status !== "active") continue;
      const indexes: number[] = [];
      wait.wait.conditions.forEach((term, index) => {
        if (term.kind === "delivery_present") {
          if (canonicalJson(term.deliveryRef as never) === deliveryKey) indexes.push(index);
          return;
        }
        if (requestKey !== null && canonicalJson(term.requestRef as never) === requestKey) indexes.push(index);
      });
      if (indexes.length > 0) out.push({ waitRef: wait.ref, indexes });
    }
    return out;
  }

  private async settlePage(
    intent: CommunicationIntentSnapshot,
    claimed: { generation: number; revision: number },
    page: RoutePageProposalV1,
    failures: CoordinationDriveFailure[],
  ): Promise<Extract<CommunicationSettleReceipt, { status: "committed" }> | null> {
    const intentId = intent.intent.intentId;
    const generation = claimed.generation;
    const commandId = "coord-page-" + intentId + "-r" + String(claimed.revision) + "-g" + String(generation);
    const command: CommunicationSettleCommand = {
      commandId,
      commandType: "CommunicationSettleIntent",
      schemaVersion: 1,
      aggregateId: intentId,
      // 领取是一次 CAS@N 提交：settle 必须用**领取之后**的 revision。
      expectedRevision: claimed.revision,
      correlationId: commandId,
      submittedAt: this.deps.now(),
      identity: { projectId: intent.intent.projectId, actor: { kind: "system", id: this.consumerId }, idempotencyKey: commandId },
      payload: {
        outcome: "route_page",
        workspaceId: intent.intent.workspaceId,
        consumerId: this.consumerId,
        leaseGeneration: generation,
        page,
        settledAt: this.deps.now(),
      },
    };
    const receipt = await this.deps.control.settleCommunicationIntent(command);
    if (receipt.status === "committed") return receipt;
    const message = "路由页未被受理（" + receipt.status + "）：" +
      (receipt.status === "rejected" ? (receipt.issues ?? []).join("; ") : "generation=" + String(receipt.currentGeneration));
    failures.push({
      intentId,
      code: receipt.status === "stale_generation" ? "stale_generation"
        : receipt.status === "rejected" && receipt.code === "unavailable" ? "unavailable" : "rejected",
      message,
    });
    /**
     * **只有已证实无副作用的失败才能进入退避重试**（协作通信可靠投递规则 / 外部副作用恢复 / 协议约束 2.4）。
     *
     * unavailable 表示执行能力（Control/账本）当时不可用，提交**根本没有发生**；而
     * sideEffectStarted === false 又证明这条 intent 至今没有产生过任何外部副作用。两个条件同时
     * 成立时进入 retry_scheduled，并把 availableAt 推到 now + 退避时长（确定性算式
     * backoffDelayMs；抖动取 intentId 的稳定摘要，重放可复算）。
     *
     * 其余失败一律**不**走这条路：非法提案立刻熔断（quarantine），已产生副作用的 intent 连领取
     * 都不允许（requires_reconcile），退避请求会被 Control 二次拒绝。
     */
    if (receipt.status === "rejected" && receipt.code === "unavailable" && !intent.intent.sideEffectStarted) {
      await this.scheduleNoEffectRetry(intent, claimed, message, failures);
      return null;
    }
    await this.quarantineIfExhausted(intent, claimed, message, failures);
    return null;
  }

  /** 已证实无副作用的失败 → 非终态 settle（retry_scheduled + availableAt）。 */
  private async scheduleNoEffectRetry(
    intent: CommunicationIntentSnapshot,
    claimed: { generation: number; revision: number },
    reason: string,
    failures: CoordinationDriveFailure[],
  ): Promise<void> {
    const backoffMs = backoffDelayMs(intent.intent.attemptCount, stableJitter(intent.intent.intentId));
    const commandId = "coord-retry-" + intent.intent.intentId + "-g" + String(claimed.generation);
    const receipt = await this.deps.control.settleCommunicationIntent({
      commandId,
      commandType: "CommunicationSettleIntent",
      schemaVersion: 1,
      aggregateId: intent.intent.intentId,
      expectedRevision: claimed.revision,
      correlationId: commandId,
      submittedAt: this.deps.now(),
      identity: { projectId: intent.intent.projectId, actor: { kind: "system", id: this.consumerId }, idempotencyKey: commandId },
      payload: {
        outcome: "no_effect_failure",
        workspaceId: intent.intent.workspaceId,
        consumerId: this.consumerId,
        leaseGeneration: claimed.generation,
        reason,
        backoffMs,
        settledAt: this.deps.now(),
      },
    });
    if (receipt.status !== "committed") {
      failures.push({
        intentId: intent.intent.intentId,
        code: "rejected",
        message: "退避重排未被受理（" + receipt.status + "）：" +
          (receipt.status === "rejected" ? (receipt.issues ?? []).join("; ") : "generation=" + String(receipt.currentGeneration)),
      });
    }
  }

  /**
   * 反复硬失败的机械熔断：同一条 intent 连续失败到 `COMMUNICATION_INTENT_MAX_ATTEMPTS` 次时，
   * 以**当前 generation** 把它收敛为 `quarantined`（可见的人工处置状态），
   * 而不是无限重试。它不是"业务成功"，也不掩盖原因：失败原因写进 intent 的 lastFailureClass 与
   * 本 drive 的 failures。
   */
  private async quarantineIfExhausted(
    intent: CommunicationIntentSnapshot,
    claimed: { generation: number; revision: number },
    reason: string,
    failures: CoordinationDriveFailure[],
  ): Promise<void> {
    // 本次失败已经消耗了一次 attempt（领取是 CAS@N 提交），因此用**领取之后**的计数与 revision。
    if (intent.intent.attemptCount + 1 < COMMUNICATION_INTENT_MAX_ATTEMPTS) return;
    const generation = claimed.generation;
    const commandId = "coord-quarantine-" + intent.intent.intentId + "-g" + String(generation);
    const receipt = await this.deps.control.settleCommunicationIntent({
      commandId,
      commandType: "CommunicationSettleIntent",
      schemaVersion: 1,
      aggregateId: intent.intent.intentId,
      expectedRevision: claimed.revision,
      correlationId: commandId,
      submittedAt: this.deps.now(),
      identity: { projectId: intent.intent.projectId, actor: { kind: "system", id: this.consumerId }, idempotencyKey: commandId },
      payload: {
        outcome: "quarantine",
        workspaceId: intent.intent.workspaceId,
        consumerId: this.consumerId,
        leaseGeneration: generation,
        reason: "连续失败达到上界，转入人工处置：" + reason,
        settledAt: this.deps.now(),
      },
    });
    if (receipt.status !== "committed") {
      failures.push({
        intentId: intent.intent.intentId,
        code: "rejected",
        message: "熔断（quarantine）未能收敛（" + receipt.status + "）：" +
          (receipt.status === "rejected" ? (receipt.issues ?? []).join("; ") : "generation=" + String(receipt.currentGeneration)),
      });
    }
  }

  // --------------------------------------------------------------------- //
  // wait deadline                                                          //
  // --------------------------------------------------------------------- //

  private async settleDeadline(
    intent: CommunicationIntentSnapshot,
    result: { claimed: number; deadlinesSettled: number; deferred: number },
    failures: CoordinationDriveFailure[],
  ): Promise<void> {
    if (intent.intent.domain.kind !== "wait_deadline") return;
    const claimed = await this.claim(intent, failures);
    if (claimed === null) return;
    result.claimed += 1;
    const generation = claimed.generation;
    const waitRef = intent.intent.domain.waitRef;
    const commandId = "coord-deadline-" + intent.intent.intentId + "-g" + String(generation);
    const command: CommunicationSettleCommand = {
      commandId,
      commandType: "CommunicationSettleIntent",
      schemaVersion: 1,
      aggregateId: intent.intent.intentId,
      expectedRevision: claimed.revision,
      correlationId: commandId,
      submittedAt: this.deps.now(),
      identity: { projectId: intent.intent.projectId, actor: { kind: "system", id: this.consumerId }, idempotencyKey: commandId },
      payload: {
        outcome: "wait_deadline",
        workspaceId: intent.intent.workspaceId,
        consumerId: this.consumerId,
        leaseGeneration: generation,
        waitRef,
        observedStatus: "active",
        settledAt: this.deps.now(),
      },
    };
    const receipt = await this.deps.control.settleCommunicationIntent(command);
    if (receipt.status === "committed") {
      result.deadlinesSettled += 1;
      // 参与身份裁决：Dispatch 在 wait deadline **之后**也要请 Control 复查接续资格
      // （deadline 到点但条件已满足、前驱仍 active 时，等待需要的是 wait_admission intent）。
      await this.ensureAdmission(waitRef, failures);
      return;
    }
    failures.push({
      intentId: intent.intent.intentId,
      code: receipt.status === "stale_generation" ? "stale_generation"
        : receipt.status === "rejected" && receipt.code === "unavailable" ? "unavailable" : "rejected",
      message: "wait deadline 未被受理（" + receipt.status + "）：" +
        (receipt.status === "rejected" ? (receipt.issues ?? []).join("; ") : "generation=" + String(receipt.currentGeneration)),
    });
  }

  // --------------------------------------------------------------------- //
  // ensureWaitAdmission（判定在 Control）                                     //
  // --------------------------------------------------------------------- //

  private async ensureAdmission(
    waitRef: WaitConditionRef,
    failures: CoordinationDriveFailure[],
  ): Promise<{ receipt: "ensured" | "deferred" | "skipped"; code?: "predecessor_ended" }> {
    // 现场重读：本 drive 前面的路由页可能刚把 wait 推进了一个 revision（扫描时的快照已过期）。
    const loaded = await this.deps.ledger.load(waitRef);
    if (loaded.status !== "found" || loaded.snapshot.ref.aggregateType !== "WaitCondition") return { receipt: "skipped" };
    const wait = loaded.snapshot as WaitConditionSnapshot;
    if (wait.wait.status !== "active") return { receipt: "skipped" };
    const commandId = "coord-ensure-" + wait.ref.waitId + "-r" + String(wait.revision);
    const command: EnsureWaitAdmissionCommand = {
      commandId,
      commandType: "EnsureWaitAdmission",
      schemaVersion: 1,
      aggregateId: wait.ref.waitId,
      correlationId: commandId,
      submittedAt: this.deps.now(),
      identity: { projectId: wait.ref.projectId, actor: { kind: "system", id: this.consumerId }, idempotencyKey: commandId },
      payload: { workspaceId: wait.ref.workspaceId, expectedRevision: wait.revision },
    };
    const receipt = await this.deps.control.ensureWaitAdmission(command);
    if (receipt.status === "committed" || receipt.status === "already_present") return { receipt: "ensured" };
    if (receipt.status === "not_ready") {
      return receipt.code === "predecessor_ended" ? { receipt: "skipped", code: "predecessor_ended" } : { receipt: "skipped" };
    }
    failures.push({
      intentId: "ensure-wait-admission:" + wait.ref.waitId,
      code: receipt.code === "unavailable" ? "unavailable" : receipt.code === "not_found" ? "not_found" : "rejected",
      message: "wait_admission intent 未建立（" + receipt.code + "）：" + (receipt.issues ?? []).join("; "),
    });
    return { receipt: "skipped" };
  }

  // --------------------------------------------------------------------- //
  // wait admission（唯一后继）                                                //
  // --------------------------------------------------------------------- //

  private async admitFromIntent(
    intent: CommunicationIntentSnapshot,
    result: { claimed: number; admissions: number; deferred: number },
    failures: CoordinationDriveFailure[],
  ): Promise<void> {
    if (intent.intent.domain.kind !== "wait_admission") return;
    const claimed = await this.claim(intent, failures);
    if (claimed === null) return;
    result.claimed += 1;
    await this.admitWait(intent.intent.domain.waitRef, result, failures, intent, claimed);
  }

  /**
   * 请 Control 受理该等待的唯一后继。`intent` 只用于命令 id 的确定性前缀（谁触发的这次尝试），
   * 真正的资格判定与唯一性都在 Control／账本的同一事务里。
   */
  private async admitWait(
    waitRef: WaitConditionRef,
    result: { admissions: number; deferred: number },
    failures: CoordinationDriveFailure[],
    intent?: CommunicationIntentSnapshot,
    claimed?: { generation: number; revision: number },
  ): Promise<void> {
    const trigger = intent === undefined ? "direct" : intent.intent.intentId;
    const loaded = await this.deps.ledger.load(waitRef);
    if (loaded.status !== "found" || loaded.snapshot.ref.aggregateType !== "WaitCondition") {
      failures.push({ intentId: trigger, code: "not_found", message: "wait_admission 触发指向的 WaitCondition 不存在：" + waitRef.waitId });
      return;
    }
    const wait = loaded.snapshot as WaitConditionSnapshot;
    // 后继 id 必须由 (workId, waitId, satisfiedRevision) 机械派生（Control 会逐字复核）。
    let inspection: import('../../contracts/alternative-report.js').AlternativeReportInspection | null = null;
    try {
    if (wait.wait.mode === 'any') {
      if (!this.deps.prepareAlternativeReports) {
        failures.push({ intentId: trigger, code: 'unavailable', message: 'Optional report inspection is not connected' });
        return;
      }
      try { inspection = await this.deps.prepareAlternativeReports(wait); }
      catch (error) {
        const reason = 'Optional report inspection preparation failed: ' + String(error);
        failures.push({ intentId: trigger, code: 'unavailable', message: reason });
        if (intent && claimed) await this.scheduleNoEffectRetry(intent, claimed, reason, failures);
        return;
      }
    }
    const satisfiedRevision = wait.revision + 1;
    const workId = wait.wait.ownerWorkContextRef.workId;
    const binding = await this.loadBinding(wait);
    if (binding === null) {
      failures.push({ intentId: trigger, code: "not_found", message: "后继受理缺少 Work 绑定或前驱 Run 信封：workId=" + workId });
      return;
    }
    // 目标 Delivery 集合（这次接续**固定**必须消费的投递）：delivery_present 条件直接贡献它们的
    // ref；请求类条件（request_responded / request_closed）按与路由页相同的确定性算式解析出
    // "报告被投给本 Work 的那条 Delivery"。读不完整即明确失败，绝不用截断集合冒充完整答案。
    const admitted = await resolveAdmittedDeliveryRefs({ ledger: this.deps.ledger, wait });
    if (admitted.status === "unavailable") {
      failures.push({ intentId: trigger, code: "unavailable", message: "目标 Delivery 集合无法确定：" + admitted.reason });
      return;
    }
    // 命令 id 由「来源等待 + 触发者 + 当前 wait revision」决定：同一 (wait, revision) 的重复尝试
    // 是同一命令（账本幂等 replay），wait 前进之后是新命令（不会把旧结果 replay 成新事实）。
    // waitId 刻意写进 id/correlationId：调度触发的命令必须自带**来源关联**（Control 会复核）。
    const commandId = "coord-admit-" + waitRef.waitId + "-" + trigger + "-r" + String(wait.revision);
    // 归因（参与身份规则）：后继受理是**调度触发**命令，必须用 {kind:'system'} + 来源关联。
    // 它**不**是某一段参与里的模型调用：此刻唯一存在的 agent 身份属于前驱那一段（后继 Run 还
    // 不存在），用 agent principal 归因就是把**新参与者**与**旧 Run** 拼成一个身份（精确 principal
    // 由 Agent 工具命令使用，见 Control 的 checkSchedulerAttribution）。
    const command: AdmitWaitSuccessorCommand = {
      commandId,
      commandType: "AdmitWaitSuccessor",
      schemaVersion: 1,
      aggregateId: waitRef.waitId,
      expectedRevision: wait.revision,
      correlationId: commandId,
      submittedAt: this.deps.now(),
      identity: {
        projectId: waitRef.projectId,
        actor: { kind: "system", id: this.consumerId },
        idempotencyKey: commandId,
      },
      payload: {
        workspaceId: waitRef.workspaceId,
        waitRef,
        ...(intent && claimed ? { intentClaim: { intentRef: intent.ref, consumerId: this.consumerId, leaseGeneration: claimed.generation, revision: claimed.revision } } : {}),
        ...(inspection ? { reportObservationToken: inspection.token } : {}),
        workContextRef: wait.wait.ownerWorkContextRef,
        // 提议：该 Work 的**当前**参与关系（Work 权威状态里的单值）。Control 会逐字段复核；
        // 没有当前参与关系时这里退化为「最后一次已知的参与关系」，只为让 Control 能给出权威原因。
        participationRef: binding.participationRef,
        agentInstanceId: binding.agentInstanceId,
        predecessorRunRef: wait.wait.predecessorRunRef,
        goalId: binding.goalId,
        taskId: binding.taskId,
        attemptId: successorAttemptIdFor(workId, waitRef.waitId, satisfiedRevision),
        runId: successorRunIdFor(successorAttemptIdFor(workId, waitRef.waitId, satisfiedRevision)),
        planRef: binding.planRef,
        roleBinding: binding.roleBinding,
        declaredPermissions: binding.declaredPermissions,
        budget: binding.budget,
        workspaceRevision: binding.workspaceRevision,
        deliveryRefs: admitted.deliveryRefs,
      },
    };
    const receipt = await this.deps.control.admitWaitSuccessor(command);
    if (receipt.status === "committed") { result.admissions += 1; return; }
    if (receipt.status === "not_ready") {
      if (receipt.code === 'report_material_unavailable' && intent && claimed) {
        await this.scheduleNoEffectRetry(intent, claimed, (receipt.issues ?? ['No readable optional report']).join('; '), failures);
      }
      // 零写入：条件未满足 / 前驱仍 active / deadline 已过。**不**伪造终态，让 intent 保持 leased
      // （同一 consumer 下次可直接重领；别人要等租约过期，那时 sideEffectStarted 仍为 false 才可重领）。
      result.deferred += 1;
      return;
    }
    const message = "后继受理被拒绝（" + receipt.code + "）：" + (receipt.issues ?? []).join("; ");
    failures.push({
      intentId: trigger,
      code: receipt.code === "unavailable" ? "unavailable" : receipt.code === "not_found" ? "not_found" : "rejected",
      message,
    });
    if (wait.wait.mode === 'any' && receipt.code === 'unavailable' && intent && claimed) {
      await this.scheduleNoEffectRetry(intent, claimed, message, failures);
      return;
    }
    // 只有"经 intent 触发"的路径才有可熔断的 intent（直接受理没有 intent 可收敛）。
    if (intent !== undefined && claimed !== undefined) {
      await this.quarantineIfExhausted(intent, claimed, message, failures);
    }
    } finally { inspection?.dispose(); }
  }

  /**
   * 后继受理需要的 Work 侧事实：**当前**参与关系（participationRef + agentInstanceId + 授权版本）、
   * Work 绑定（goal/task/plan）、前驱 Run 信封（权限与预算）。任一缺失即**明确失败**
   * （前驱 Run 尚未 startRun 时没有信封，这时不能用「猜的权限」启动后继）。
   *
   * 参与关系取 Work 权威状态里的 currentParticipationRef（参与身份规则）：等待登记时的那一段只是
   * 历史事实。它缺省/已 ended 时仍然把它当作**提议**送交 Control，由 Control 给出权威的
   * no_active_participation 拒绝（资格判定不在 Drive）。
   */
  private async loadBinding(wait: WaitConditionSnapshot): Promise<{
    participationRef: AdmitWaitSuccessorCommand["payload"]["participationRef"];
    agentInstanceId: string;
    goalId: string;
    taskId: string;
    planRef: AdmitWaitSuccessorCommand["payload"]["planRef"];
    roleBinding: AdmitWaitSuccessorCommand["payload"]["roleBinding"];
    declaredPermissions: AdmitWaitSuccessorCommand["payload"]["declaredPermissions"];
    budget: AdmitWaitSuccessorCommand["payload"]["budget"];
    workspaceRevision: number;
  } | null> {
    const work = await this.deps.ledger.load(wait.wait.ownerWorkContextRef);
    if (work.status !== "found" || work.snapshot.ref.aggregateType !== "WorkContextBinding") return null;
    const binding = (work.snapshot as WorkContextBindingSnapshot).binding;
    const participationRef = binding.currentParticipationRef ?? { ...wait.wait.ownerParticipationRef };
    const participation = await this.deps.ledger.load(participationRef);
    if (participation.status !== "found" || participation.snapshot.ref.aggregateType !== "WorkParticipation") return null;
    const predecessor = await this.deps.ledger.load(wait.wait.predecessorRunRef);
    if (predecessor.status !== "found" || predecessor.snapshot.ref.aggregateType !== "Run") return null;
    const run = predecessor.snapshot as RunSnapshot;
    if (run.envelope === null) return null;

    const participationValue = (participation.snapshot as import("../../contracts/coordination.js").WorkParticipationSnapshot).participation;
    const agentInstanceId = participationValue.agentInstanceId;
    return {
      participationRef,
      agentInstanceId,
      goalId: binding.goalId ?? run.ref.goalId,
      taskId: binding.taskId ?? run.task.taskId,
      planRef: binding.planRef ?? run.planRef,
      // 授权版本取**参与关系**固定的那一份（参与关系与换手）：同一 Work 的下一段执行沿用同一绑定，
      // 且必须与 command.identity.agentPrincipal.roleBinding 逐字段一致（Control 会复核）。
      roleBinding: participationValue.roleBinding,
      declaredPermissions: {
        tools: [...run.envelope.permissions.tools],
        writeScope: [...run.envelope.permissions.writeScope],
      },
      budget: run.budget,
      workspaceRevision: run.workspaceSnapshot.revision,
    };
  }

  // --------------------------------------------------------------------- //
  // cancel_requested 收敛（同一 generation，不发放新 generation）               //
  // --------------------------------------------------------------------- //

  /**
   * 收敛一条 cancel_requested 的 intent（**同一 generation**，不发放新 generation）。
   *
   * 两个结果必须分开（协作通信可靠投递规则 / 先记取消意图·外部副作用恢复）：
   *   · 未产生过外部副作用（sideEffectStarted = false）→ 可以**确认取消**（cancel_confirmed）；
   *   · 已经产生过（sideEffectStarted = true）→ 外部动作是否真的发生**无法从本地账本证明**，
   *     因此只能收敛为 outcome_unknown，并保留在同一 generation 上等对账。
   *     **绝不**在没有证据时声称 cancelled：那会把一次可能已经发生的外部调用伪装成没发生。
   *     「租约到期」不是证据——它只说明消费者不见了。
   */  private async convergeCancelled(intent: CommunicationIntentSnapshot, failures: CoordinationDriveFailure[]): Promise<number> {
    const commandId = "coord-cancel-" + intent.intent.intentId + "-g" + String(intent.intent.leaseGeneration);
    const command: CommunicationSettleCommand = {
      commandId,
      commandType: "CommunicationSettleIntent",
      schemaVersion: 1,
      aggregateId: intent.intent.intentId,
      expectedRevision: intent.revision,
      correlationId: commandId,
      submittedAt: this.deps.now(),
      identity: { projectId: intent.intent.projectId, actor: { kind: "system", id: this.consumerId }, idempotencyKey: commandId },
      payload: intent.intent.sideEffectStarted
        ? {
            outcome: "unknown",
            workspaceId: intent.intent.workspaceId,
            consumerId: this.consumerId,
            leaseGeneration: intent.intent.leaseGeneration,
            reason: "取消请求到达时外部副作用已经开始；本地账本无法证明它是否发生，转入对账（不声称已取消）",
            settledAt: this.deps.now(),
          }
        : {
            outcome: "cancel_confirmed",
            workspaceId: intent.intent.workspaceId,
            consumerId: this.consumerId,
            leaseGeneration: intent.intent.leaseGeneration,
            settledAt: this.deps.now(),
          },
    };
    const receipt = await this.deps.control.settleCommunicationIntent(command);
    if (receipt.status === "committed") return 1;
    failures.push({
      intentId: intent.intent.intentId,
      code: receipt.status === "stale_generation" ? "stale_generation" : "rejected",
      message: "取消收敛未成功（" + receipt.status + "）：" + (receipt.status === "rejected" ? (receipt.issues ?? []).join("; ") : "generation=" + String(receipt.currentGeneration)),
    });
    return 0;
  }
}

/**
 * 退避抖动的确定性来源：intentId 的稳定摘要（0..1）。
 * 用 intentId 而不是随机数，是为了让同一 intent 的重放得到同一个 availableAt（可复算）。
 */
function stableJitter(intentId: string): number {
  const digest = sha256Hex(intentId);
  return Number.parseInt(digest.slice(0, 8), 16) / 0xffffffff;
}

export function createCoordinationDrive(deps: CoordinationDriveDeps): CoordinationDrive {
  return new CoordinationDrive(deps);
}
