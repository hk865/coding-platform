/**
 * 协作通信的**纯决策**规则（无 I/O、无时钟，全部 table-testable）。
 *
 * 为什么单独成文件：路由页、等待满足、后继资格都是并发敏感判定；把它们写成纯函数
 * 才能对两个适配器（内存 / SQLite）和所有强杀点使用同一份规则，也才能在测试里
 * 直接构造"事件先到 / wait 先注册"的两种时序而不用真的并发。
 */
import type { CommitCursor } from "../../../contracts/command-event.js";
import type {
  CommunicationIntentV1,
  DeliveryV1,
  SubscriptionSnapshot,
  WaitConditionSnapshot,
  WaitConditionTermV1,
} from "../../../contracts/coordination.js";
import { deliveryDedupeKey } from "../../../contracts/coordination.js";
import { canonicalJson } from "../../../contracts/fingerprint.js";

/** 一条待路由的源事件（由 Dispatch 从 ledger 事件页读出后交给纯函数）。 */
export type RoutableSourceEvent = {
  topic: string;
  cursor: CommitCursor;
  bodyRef: DeliveryV1["bodyRef"];
  sourceRefs: DeliveryV1["sourceRefs"];
};

/**
 * 固定页集：**一次路由只处理一个源事件位置**，页内订阅集合由该位置的
 * subscription-registry horizon 决定。分页期间新建的订阅不插入旧 horizon
 * （只有 startCursor 覆盖该位置且在该位置已存在的订阅才进入本次分页）。
 *
 * horizon 用"订阅的 (createdAt, subscriptionId)"近似不可行，因此调用方传入
 * 每个订阅的 **startCursor 是否覆盖该事件位置** 与 **是否已取消**；创建顺序的
 * 权威是 ledger 的 expectedVersions/CAS 结果，不在这里猜。
 */
export function selectPageSubscriptions(
  subscriptions: SubscriptionSnapshot[],
  event: RoutableSourceEvent,
  afterSubscriptionRefKey: string | null,
): SubscriptionSnapshot[] {
  return subscriptions
    .filter((snapshot) => snapshot.subscription.status === "active")
    .filter((snapshot) => snapshot.subscription.topics.includes(event.topic))
    .filter((snapshot) => {
      const start = snapshot.subscription.startCursor;
      if (start === null) return true;
      return compareCursor(start, event.cursor) < 0;
    })
    .sort((a, b) => canonicalJson(a.ref).localeCompare(canonicalJson(b.ref)))
    .filter((snapshot) => afterSubscriptionRefKey === null ||
      canonicalJson(snapshot.ref) > afterSubscriptionRefKey);
}

/** 只比较 opaque cursor 的十进制序号（cursor 语义由账本定义）。 */
export function compareCursor(a: CommitCursor, b: CommitCursor): number {
  const na = Number.parseInt(String(a).replace(/^c/, ""), 10);
  const nb = Number.parseInt(String(b).replace(/^c/, ""), 10);
  if (!Number.isSafeInteger(na) || !Number.isSafeInteger(nb)) throw new Error("not a ledger cursor");
  return na === nb ? 0 : na < nb ? -1 : 1;
}

/** 幂等键：同一 (源事件位置, 订阅, 目标 Work) 只允许一条 Delivery。 */
export function pageDelivery(input: {
  projectId: string;
  workspaceId: string;
  subscription: SubscriptionSnapshot;
  targetWorkContextRef: DeliveryV1["targetWorkContextRef"];
  event: RoutableSourceEvent;
  deliveryId: string;
  createdAt: string;
}): DeliveryV1 {
  return {
    schemaVersion: 1,
    deliveryId: input.deliveryId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    origin: {
      kind: "subscription",
      subscriptionRef: input.subscription.ref,
      sourceTopic: input.event.topic,
      sourceCursor: input.event.cursor,
    },
    targetWorkContextRef: input.targetWorkContextRef,
    bodyRef: input.event.bodyRef,
    sourceRefs: input.event.sourceRefs,
    createdAt: input.createdAt,
  };
}

/**
 * 一页的候选 Deliveries 去重：同页同键只保留第一条（顺序确定）。
 * 与账本侧"以 (source event + subscription) 唯一"的规则一致。
 */
export function dedupePageDeliveries(deliveries: DeliveryV1[]): DeliveryV1[] {
  const seen = new Set<string>();
  const out: DeliveryV1[] = [];
  for (const delivery of deliveries) {
    const key = deliveryDedupeKey(delivery);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(delivery);
  }
  return out;
}

// ------------------------------------------------------------------------ //
// Wait 条件求值                                                              //
// ------------------------------------------------------------------------ //

export type WaitConditionFacts = {
  /** 已存在的 Deliveries（按 canonical ref 排序）。 */
  deliveries: { refKey: string }[];
  /** 已回应的定向请求。 */
  respondedRequests: string[];
  /** 已关闭的定向请求。 */
  closedRequests: string[];
};

export type WaitEvaluation = {
  /** 当前已满足的条件下标（0-based，升序）。 */
  satisfiedIndexes: number[];
  /** 全部条件是否都满足。 */
  allSatisfied: boolean;
  /** 逐条原因（观察记录用，不构成业务状态）。 */
  notes: string[];
};

function termKey(term: WaitConditionTermV1): string {
  switch (term.kind) {
    case "delivery_present": return "delivery:" + canonicalJson(term.deliveryRef);
    case "request_responded": return "responded:" + canonicalJson(term.requestRef);
    case "request_closed": return "closed:" + canonicalJson(term.requestRef);
    default: return "unknown";
  }
}

/** 纯求值：只读 canonical 事实，不接受任意表达式。 */
export function evaluateWaitConditions(
  terms: WaitConditionTermV1[],
  facts: WaitConditionFacts,
): WaitEvaluation {
  const deliveryKeys = new Set(facts.deliveries.map((d) => d.refKey));
  const responded = new Set(facts.respondedRequests);
  const closed = new Set(facts.closedRequests);
  const satisfiedIndexes: number[] = [];
  const notes: string[] = [];
  terms.forEach((term, index) => {
    let satisfied = false;
    switch (term.kind) {
      case "delivery_present":
        satisfied = deliveryKeys.has(canonicalJson(term.deliveryRef));
        break;
      case "request_responded":
        satisfied = responded.has(canonicalJson(term.requestRef));
        break;
      case "request_closed":
        satisfied = closed.has(canonicalJson(term.requestRef));
        break;
    }
    if (satisfied) satisfiedIndexes.push(index);
    notes.push(termKey(term) + (satisfied ? "=satisfied" : "=pending"));
  });
  return {
    satisfiedIndexes,
    allSatisfied: satisfiedIndexes.length === terms.length,
    notes,
  };
}

/**
 * 接续资格：**条件满足 ∧ 前驱 Run 已公开结束 ∧ deadline 未过**。
 *
 * 三个分支故意分开返回，因为它们的处置不同：
 *   - `conditions_unsatisfied`：等条件；
 *   - `predecessor_active`：条件已满足但前驱仍执行——只保存观察，
 *     **不**重叠启动同一 Work 的后继（PLAN §5.1）；
 *   - `deadline_passed`：收敛为 timed_out，而不是接续。
 */
export type SuccessorEligibility =
  | { eligible: true }
  | { eligible: false; code: "conditions_unsatisfied" | "predecessor_active" | "deadline_passed" };

export function evaluateSuccessorEligibility(input: {
  wait: WaitConditionSnapshot["wait"];
  evaluation: WaitEvaluation;
  predecessorEnded: boolean;
  now: string;
}): SuccessorEligibility {
  if (input.wait.status !== "active") return { eligible: false, code: "conditions_unsatisfied" };
  if (input.wait.deadlineAt !== null && input.wait.deadlineAt <= input.now) {
    return { eligible: false, code: "deadline_passed" };
  }
  if (!input.evaluation.allSatisfied) return { eligible: false, code: "conditions_unsatisfied" };
  if (!input.predecessorEnded) return { eligible: false, code: "predecessor_active" };
  return { eligible: true };
}

// ------------------------------------------------------------------------ //
// 机械 intent 状态机（纯函数）                                                //
// ------------------------------------------------------------------------ //

export function intentLeaseExpired(intent: CommunicationIntentV1, now: string): boolean {
  if (intent.status !== "leased") return false;
  if (intent.leaseExpiresAt === null) return false;
  return intent.leaseExpiresAt <= now;
}

/**
 * 领取判定。三种拒绝的原因必须分开：
 *   - 未到期且 owner 是别人 → 不能抢；
 *   - 已到期但**已产生外部副作用** → 不能重新领取（必须走 reconcile）；
 *   - 已到期且可证明未产生副作用 → 允许重新领取，generation 递增。
 */
export type ClaimDecision =
  | { allow: true; nextGeneration: number }
  | { allow: false; code: "owned_elsewhere" | "not_claimable" | "requires_reconcile" | "cancel_requested" };

export function decideIntentClaim(input: {
  intent: CommunicationIntentV1;
  consumerId: string;
  now: string;
}): ClaimDecision {
  const { intent } = input;
  const expired = intentLeaseExpired(intent, input.now);
  if (intent.status === "leased" && !expired) {
    return intent.leaseOwner === input.consumerId
      ? { allow: true, nextGeneration: intent.leaseGeneration }
      : { allow: false, code: "owned_elsewhere" };
  }
  if (intent.status === "cancel_requested") return { allow: false, code: "cancel_requested" };
  if (intent.status === "pending" || intent.status === "retry_scheduled") {
    if (intent.availableAt !== null && intent.availableAt > input.now) return { allow: false, code: "not_claimable" };
    return { allow: true, nextGeneration: intent.leaseGeneration + 1 };
  }
  if (intent.status === "leased" && expired) {
    if (intent.sideEffectStarted) return { allow: false, code: "requires_reconcile" };
    return { allow: true, nextGeneration: intent.leaseGeneration + 1 };
  }
  return { allow: false, code: "not_claimable" };
}

/** 退避（带抖动；抖动值由调用方传入以保持纯函数可测）。 */
export function backoffDelayMs(attemptCount: number, jitter: number): number {
  const base = Math.min(60_000, 250 * 2 ** Math.min(attemptCount, 8));
  const bounded = Math.max(0, Math.min(1, jitter));
  return Math.round(base * (0.5 + bounded * 0.5));
}
