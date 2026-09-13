/**
 * 接续受理的**只读入口**（CM-1A-001 第 3 工作段）。
 *
 * 它回答一个窄问题："这个 Run 是不是某个 CommunicationAdmission 受理的后继？如果是，那次
 * 受理固定了什么？"——具体是：
 *   · 固定的 Work 与参与关系/授权版本（第 2 步裁决写进 admission）；
 *   · 固定的**目标 Delivery 集合**（admission.deliveryRefs）。后继 Run 的 Context 只按这个
 *     集合取材，不再把"该 Work 当前全部带正文的 Delivery"当成本次必需输入；
 *   · 前驱 Run（指令来源的锚点）。
 *
 * 为什么在 Dispatch 侧按事件扫描实现，而不是给 ControlEngine 加方法：admission 的定位键是
 * waitId，而调用方手里只有 runRef，两者之间没有反向索引。Dispatch 本来就有"有界事件扫描 +
 * 按 canonical ref 读快照"的既定手法（coordination-drive.scan / mailboxView 同一口径），
 * 因此这里复用同一手法，不新增 Control 写面、不新增聚合、也不做全库无界扫描（有页数上限，
 * 读不完整一律 unavailable，**不**把截断的集合当成完整答案）。
 */
import type { CommitCursor } from "../../contracts/command-event.js";
import type { StateLedger } from "../../contracts/ledger.js";
import type { DeliverySnapshot, DeliveryRef } from "../../contracts/coordination.js";
import { communicationAdmissionRefFor } from "../../contracts/coordination.js";
import type { CommunicationAdmissionSnapshot } from "../../contracts/coordination.js";
import { deliveryRefFor } from "../../contracts/coordination.js";
import { canonicalJson } from "../../contracts/fingerprint.js";
import type { AdmittedDeliveryReadPort } from "../../contracts/runtime-context-materials.js";

const SCAN_PAGE_SIZE = 1000;
const SCAN_MAX_PAGES = 200;

export type AdmittedSuccessorFacts = {
  admissionRef: ReturnType<typeof communicationAdmissionRefFor>;
  admission: CommunicationAdmissionSnapshot;
  /** admission 固定下来的目标 Delivery（已按精确 ref 读回，顺序与 admission 一致）。 */
  deliveries: DeliverySnapshot[];
};

export type AdmittedSuccessorResult =
  | { status: "found"; facts: AdmittedSuccessorFacts }
  /** 该 Run 不是接续产生的：它不消费任何 Delivery 材料（正常任务运行就是这一类）。 */
  | { status: "absent" }
  | { status: "unavailable"; reason: string };

export type AdmittedSuccessorQuery = { projectId: string; workspaceId: string; runId: string };

/**
 * 受理记录**输入绑定**的完整性判据（协议约束 1.2 的字段清单）。
 *
 * 返回空数组表示绑定完整；否则每一项都是"缺了什么"，调用方据此给出明确的不可恢复原因。
 * 刻意不做的两件事：不补默认值、不回退到"读该 Work 的邮箱"或"按任务重新解析 Work"——
 * 那正是 1.2 禁止的重新猜测。`deliveryRefs` 允许为空数组（本次接续确实没有必需投递），
 * 但**必须存在**（旧记录没有它就无法区分"没有"和"没登记"）。
 */
export function admissionBindingIssues(value: import("../../contracts/coordination.js").CommunicationAdmissionV1): string[] {
  const issues: string[] = [];
  const record = value as unknown as Record<string, unknown>;
  if (record["workContextRef"] === undefined || record["workContextRef"] === null) issues.push("缺少 workContextRef（本次实际采用的 Work）");
  if (record["participationRef"] === undefined || record["participationRef"] === null) issues.push("缺少 participationRef（本次实际采用的参与关系）");
  if (record["roleBinding"] === undefined || record["roleBinding"] === null) issues.push("缺少 roleBinding（本次实际采用的授权版本）");
  if (record["predecessorRunRef"] === undefined || record["predecessorRunRef"] === null) issues.push("缺少 predecessorRunRef（前驱 Run）");
  if (record["runRef"] === undefined || record["runRef"] === null) issues.push("缺少 runRef（后继 Run）");
  if (record["attemptRef"] === undefined || record["attemptRef"] === null) issues.push("缺少 attemptRef（后继 TaskAttempt）");
  if (!Array.isArray(record["deliveryRefs"])) issues.push("缺少 deliveryRefs（必需 Delivery 的精确引用与版本）");
  if (record["declaredPermissions"] === undefined || record["declaredPermissions"] === null) issues.push("缺少 declaredPermissions（本次实际采用的权限集）");
  return issues;
}

/** 按 Run 找它的接续受理记录（有界事件扫描 → canonical 快照）。 */
export async function readAdmittedSuccessor(
  ledger: Pick<StateLedger, "load" | "events">,
  query: AdmittedSuccessorQuery,
): Promise<AdmittedSuccessorResult> {
  const waitIds = new Set<string>();
  let cursor: CommitCursor | null = null;
  let pages = 0;
  try {
    for (;;) {
      const page = await ledger.events({ afterCursor: cursor, limit: SCAN_PAGE_SIZE });
      for (const positioned of page.events) {
        const event = positioned.event as {
          eventType?: string; projectId?: string; workspaceId?: string;
          payload?: { admission?: { runRef?: { runId?: string }; waitRef?: { waitId?: string } } };
        };
        if (event.eventType !== "CommunicationAdmissionRecorded") continue;
        if (event.projectId !== query.projectId || event.workspaceId !== query.workspaceId) continue;
        if (event.payload?.admission?.runRef?.runId !== query.runId) continue;
        const waitId = event.payload.admission.waitRef?.waitId;
        if (typeof waitId === "string" && waitId.length > 0) waitIds.add(waitId);
      }
      if (!page.hasMore) break;
      if (page.throughCursor === null || page.throughCursor === cursor) {
        return { status: "unavailable", reason: "账本事件页游标没有推进，读不完整就不当作完整答案" };
      }
      cursor = page.throughCursor;
      pages += 1;
      if (pages >= SCAN_MAX_PAGES) {
        return { status: "unavailable", reason: "接续受理扫描超过上限 " + String(SCAN_MAX_PAGES) + " 页，读不完整" };
      }
    }
  } catch (error) {
    return { status: "unavailable", reason: "账本事件不可读：" + (error instanceof Error ? error.message : String(error)) };
  }
  if (waitIds.size === 0) return { status: "absent" };
  if (waitIds.size > 1) {
    // 同一个 Run 只可能由一次接续受理创建；多于一条说明账本里存在互相矛盾的事实。
    return { status: "unavailable", reason: "同一个 Run 对应多条接续受理记录（waitId=" + [...waitIds].join(", ") + "），不猜哪一条是权威" };
  }
  const waitId = [...waitIds][0]!;
  const admissionRef = communicationAdmissionRefFor(query.projectId, query.workspaceId, waitId);
  const loaded = await ledger.load(admissionRef);
  if (loaded.status !== "found" || loaded.snapshot.ref.aggregateType !== "CommunicationAdmission") {
    return { status: "unavailable", reason: "CommunicationAdmission 快照读不到：" + waitId };
  }
  const admission = loaded.snapshot as CommunicationAdmissionSnapshot;
  // 协议约束 1.2 / 2.4：受理必须带着完整的**输入绑定**。旧记录（或任何缺字段的记录）缺少
  // 必需身份/输入绑定时**不可恢复**——返回明确原因并**不启动后继**，绝不补猜值继续。
  const missing = admissionBindingIssues(admission.admission);
  if (missing.length > 0) {
    return {
      status: "unavailable",
      reason: "受理记录缺少不可恢复的输入绑定（协议约束 1.2）：" + missing.join("；") + "（不启动后继，也不补猜值）",
    };
  }
  const deliveries: DeliverySnapshot[] = [];
  const seen = new Set<string>();
  for (const ref of admission.admission.deliveryRefs) {
    const key = canonicalJson(ref as never);
    if (seen.has(key)) continue;
    seen.add(key);
    const delivery = await ledger.load(ref);
    if (delivery.status !== "found" || delivery.snapshot.ref.aggregateType !== "Delivery") {
      return { status: "unavailable", reason: "受理固定的 Delivery 读不到：" + ref.deliveryId };
    }
    deliveries.push(delivery.snapshot as DeliverySnapshot);
  }
  return { status: "found", facts: { admissionRef, admission, deliveries } };
}

/**
 * ContextCompiler 需要的窄只读面（`AdmittedDeliveryReadPort`）的产品实现：
 * "这次 Run 被受理固定的 Delivery 是哪些"。组合根注入给 WorkMaterialDrive /
 * DeliveryMaterialCompiler，Context 侧因此不需要认识 Control 或 Dispatch 的实现。
 */
export function createAdmittedDeliveryRead(
  ledger: Pick<StateLedger, "load" | "events">,
): AdmittedDeliveryReadPort {
  return {
    async admittedDeliveriesForRun(query) {
      const read = await readAdmittedSuccessor(ledger, query);
      if (read.status === "absent") return { status: "none" };
      if (read.status === "unavailable") return { status: "unavailable", reason: read.reason };
      return { status: "admitted", deliveries: read.facts.deliveries };
    },
  };
}

export type { DeliveryRef };
export { deliveryRefFor };
