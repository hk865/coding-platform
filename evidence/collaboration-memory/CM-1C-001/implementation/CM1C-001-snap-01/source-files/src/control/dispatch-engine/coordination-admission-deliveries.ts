/**
 * 接续受理时**固定目标 Delivery 集合**的解析（CM-1A-001 第 3 工作段）。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────────────────────
 * wait 的条件有两类：
 *   · `delivery_present`：条件本身就是一条精确 Delivery —— 集合直接来自条件；
 *   · `request_responded` / `request_closed`：条件是一条 canonical 请求事实。**报告正文**
 *     是通过订阅路由到本 Work 的那条 Delivery 才进入模型的（DirectedRequestResponded 的
 *     route page 会把 `response.bodyRef` 投给订阅者）。如果集合只取 `delivery_present`，
 *     以请求为条件的等待就会得到一个**空的必需集合** —— 后继跑起来了，却没有任何报告材料，
 *     这既不符合"报告到齐后产生后继"，也让 A06 的"目标 Delivery 版本进入实际模型输入"无法成立。
 *
 * 因此：对每一个请求类条件，按**与路由页完全相同的确定性算式**（同一条账本位置 + 同一个订阅
 * → `subscriptionDeliveryIdFor`）解析出它对应的 Delivery，并且只收**账本里确实存在**的那些。
 * 提议权在 Dispatch，准入复核仍在 Control（它逐条复核"存在 ∧ 属于该 Work"）——本文件写不进
 * 任何 Control 不接受的集合。
 *
 * ── 如实记录的边界 ────────────────────────────────────────────────────────────
 *   · 请求条件已满足、但该 Work 还没有任何订阅覆盖响应 topic（因此没有已路由的 Delivery）时，
 *     集合里就没有那一条：后继照常受理，只是没有任何报告材料。这是"订阅没覆盖该 topic"的
 *     可诊断事实（mailboxView 里看得到），本文件**不**用别的 Delivery 冒充它，也不静默补料。
 *   · 解析是**有界**的（页数上限 + 集合上限）：读不完整时返回 unavailable，调用方必须失败，
 *     绝不把截断的集合当成完整答案。
 */
import type { CommitCursor } from "../../contracts/command-event.js";
import type { StateLedger } from "../../contracts/ledger.js";
import type { DeliveryRef, DeliverySnapshot, SubscriptionRef, SubscriptionSnapshot, WaitConditionSnapshot } from "../../contracts/coordination.js";
import { deliveryRefFor, subscriptionRefFor } from "../../contracts/coordination.js";
import { canonicalJson } from "../../contracts/fingerprint.js";
import { subscriptionDeliveryIdFor } from "./coordination-drive.js";

const SCAN_PAGE_SIZE = 1000;
const SCAN_MAX_PAGES = 200;
/** 集合上限：与一个路由页最多产生的投递数同一口径（超限如实失败，不静默裁剪）。 */
const MAX_ADMITTED_DELIVERIES = 64;

export type AdmittedDeliveryResolution =
  | { status: "resolved"; deliveryRefs: DeliveryRef[] }
  | { status: "unavailable"; reason: string };

/** 路由 topic 词表里与"报告"有关的那一个（与 coordination-drive.communicationTopicOf 一致）。 */
const RESPONSE_TOPIC = "DirectedRequestResponded";

/**
 * 解析这次接续必须固定的目标 Delivery 集合。
 *
 * `delivery_present` 条件直接贡献它们的 ref；请求类条件按 (订阅, 响应事件位置) 确定性解析。
 */
export async function resolveAdmittedDeliveryRefs(input: {
  ledger: Pick<StateLedger, "load" | "events" | "alternativeReport">;
  wait: WaitConditionSnapshot;
}): Promise<AdmittedDeliveryResolution> {
  const { wait } = input;
  if (wait.wait.mode === 'any') {
    const chosen = await input.ledger.alternativeReport(wait.ref);
    if (chosen.status === 'unavailable') return chosen;
    return { status: 'resolved', deliveryRefs: chosen.status === 'selected' ? [chosen.selection.deliveryRef] : [] };
  }
  const projectId = wait.ref.projectId;
  const workspaceId = wait.ref.workspaceId;
  const workId = wait.wait.ownerWorkContextRef.workId;
  const collected = new Map<string, DeliveryRef>();
  const add = (ref: DeliveryRef) => {
    const key = canonicalJson(ref as never);
    if (!collected.has(key)) collected.set(key, ref);
  };
  const requestTerms: { requestId: string }[] = [];
  for (const term of wait.wait.conditions) {
    if (term.kind === "delivery_present") { add(term.deliveryRef); continue; }
    requestTerms.push({ requestId: term.requestRef.requestId });
  }
  if (requestTerms.length === 0) {
    const refs = [...collected.values()].sort(byRefKey);
    return refs.length > MAX_ADMITTED_DELIVERIES
      ? { status: "unavailable", reason: "受理固定的 Delivery 超过上限 " + String(MAX_ADMITTED_DELIVERIES) }
      : { status: "resolved", deliveryRefs: refs };
  }
  const wanted = new Set(requestTerms.map((term) => term.requestId));
  const subscriptions = new Map<string, SubscriptionSnapshot>();
  const positionOf = (value: CommitCursor) => Number(String(value).replace(/^c/, ""));
  /** 该 Work 的订阅关心、且与某个请求条件对应的响应事件位置。 */
  const positions: { cursor: CommitCursor; requestId: string }[] = [];
  let cursor: CommitCursor | null = null;
  let pages = 0;
  try {
    for (;;) {
      const page = await input.ledger.events({ afterCursor: cursor, limit: SCAN_PAGE_SIZE });
      for (const positioned of page.events) {
        const event = positioned.event as {
          eventType?: string; projectId?: string; workspaceId?: string;
          payload?: Record<string, unknown>;
        };
        if (event.projectId !== projectId || event.workspaceId !== workspaceId) continue;
        if (event.eventType === "SubscriptionCreated" || event.eventType === "SubscriptionCancelled" || event.eventType === "SubscriptionCatchupPlanned" || event.eventType === "SubscriptionCatchupAdvanced") {
          const subscription = (event.payload as { subscription?: SubscriptionSnapshot["subscription"] }).subscription;
          if (subscription === undefined) continue;
          if (subscription.ownerWorkContextRef.workId !== workId) continue;
          const ref: SubscriptionRef = subscriptionRefFor(projectId, workspaceId, subscription.subscriptionId);
          subscriptions.set(canonicalJson(ref as never), {
            ref, revision: 1, schemaVersion: 1, subscription, recordedAt: wait.recordedAt,
          });
          continue;
        }
        if (event.eventType === RESPONSE_TOPIC) {
          const request = (event.payload as { request?: { requestId: string } }).request;
          if (request === undefined || !wanted.has(request.requestId)) continue;
          positions.push({ cursor: positioned.cursor, requestId: request.requestId });
        }
      }
      if (!page.hasMore) break;
      if (page.throughCursor === null || page.throughCursor === cursor) {
        return { status: "unavailable", reason: "账本事件页游标没有推进，读不完整就不当作完整答案" };
      }
      cursor = page.throughCursor;
      pages += 1;
      if (pages >= SCAN_MAX_PAGES) {
        return { status: "unavailable", reason: "受理集合解析超过上限 " + String(SCAN_MAX_PAGES) + " 页，读不完整" };
      }
    }
  } catch (error) {
    return { status: "unavailable", reason: "账本事件不可读：" + (error instanceof Error ? error.message : String(error)) };
  }
  for (const position of positions) {
    for (const subscription of subscriptions.values()) {
      if (subscription.subscription.status !== "active") continue;
      if (!subscription.subscription.topics.includes(RESPONSE_TOPIC)) continue;
      const start = subscription.subscription.startCursor;
      // 与 selectPageSubscriptions 同一判据：startCursor 严格早于事件位置才算覆盖它
      // （startCursor 为 null 的订阅在建立时已被 Control 锚定到 frontier，这里同样按 null 覆盖处理）。
      if (start !== null && !(positionOf(start) < positionOf(position.cursor))) continue;
      const deliveryId = subscriptionDeliveryIdFor({
        subscriptionRef: subscription.ref,
        topic: RESPONSE_TOPIC,
        cursor: position.cursor,
        targetWorkContextRef: wait.wait.ownerWorkContextRef,
      });
      const ref = deliveryRefFor(projectId, workspaceId, deliveryId);
      // 只收账本里**确实存在**的 Delivery：路由页还没跑到的位置不进入集合（不用它冒充已受理）。
      const loaded = await input.ledger.load(ref);
      if (loaded.status !== "found" || loaded.snapshot.ref.aggregateType !== "Delivery") continue;
      add(ref);
    }
  }
  const refs = [...collected.values()].sort(byRefKey);
  if (refs.length > MAX_ADMITTED_DELIVERIES) {
    return { status: "unavailable", reason: "受理固定的 Delivery 超过上限 " + String(MAX_ADMITTED_DELIVERIES) };
  }
  return { status: "resolved", deliveryRefs: refs };
}

function byRefKey(a: DeliveryRef, b: DeliveryRef): number {
  return canonicalJson(a as never).localeCompare(canonicalJson(b as never));
}

export type { DeliverySnapshot };
