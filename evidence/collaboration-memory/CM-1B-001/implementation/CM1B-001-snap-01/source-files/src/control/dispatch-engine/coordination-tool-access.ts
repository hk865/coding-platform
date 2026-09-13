/**
 * 协调 Host 工具的**产品实现**（CM-1A-001 第 3 工作段，D03）：把窄端口接到真实的
 * ArtifactVault 与 ControlEngine 正式写入口。
 *
 * ── 它是谁（以及不是什么）─────────────────────────────────────────────────────
 *   · 它是**宿主适配器**：组合根按当前 Run 建一次（`coordinationAccessFor`），Runtime 把它
 *     变成模型能调用的工具。它本身**不保存**任何 canonical 状态、不是第二个写入口、
 *     也不新增 Module 依赖（只经 Contracts 的 port 形状使用 Control/Vault/Ledger）。
 *   · **身份由宿主绑定**：principal 从 canonical 事实派生（见 `resolveRunPrincipal`），
 *     模型的参数里没有这些字段。
 *
 * ── 正文先存 Vault，再经 Control 正式受理 ──────────────────────────────────────
 * 每个写操作都是：`vault.put`（body-first）→ Control 命令 → **回执**。
 * 回执非 committed 一律返回 rejected：正文存在**不等于**已被受理，绝不先回 ok 再补交。
 *
 * ── 幂等 ────────────────────────────────────────────────────────────────────
 * 聚合 id 由 `(principal.runRef, 模型给的内容键)` 机械派生，因此同一次工具调用的重复提交
 * 是账本幂等 replay（回执 `replayed: true`），不会产生第二条事实。
 */
import type { ArtifactPort } from "../../contracts/artifact.js";
import type { CommitCursor } from "../../contracts/command-event.js";
import type {
  AgentPrincipalRefV1,
  DeliverySnapshot,
  DirectedRequestRef,
  DirectedRequestSnapshot,
  SubscriptionRef,
  SubscriptionSnapshot,
  WaitConditionRef,
  WaitConditionSnapshot,
  WorkParticipationRef,
  WorkParticipationSnapshot,
} from "../../contracts/coordination.js";
import {
  deliveryRefFor,
  directedRequestRefFor,
  subscriptionRefFor,
  waitConditionRefFor,
} from "../../contracts/coordination.js";
import { directDeliveryIdFor } from "../../contracts/coordination-events.js";
import type { StateLedger } from "../../contracts/ledger.js";
import type { ControlEngine } from "../../contracts/modules.js";
import type { RunRef } from "../../contracts/dispatch.js";
import type { WorkContextBindingSnapshot } from "../../contracts/context-continuity.js";
import {
  COORDINATION_CAPABILITY_ID,
  type CoordinationCapabilityBasisV1,
  type CoordinationCapabilityGrantV1,
  type CoordinationMailboxResultV1,
  type CoordinationToolAccessPort,
  type CoordinationToolOutcomeV1,
  type CoordinationToolReferenceV1,
} from "../../contracts/coordination-tools.js";
import { canonicalJson, sha256Hex } from "../../contracts/fingerprint.js";

/** 事件扫描的页大小与页数上限（与 mailboxView / coordination-drive 同一口径）。 */
const SCAN_PAGE_SIZE = 1000;
const SCAN_MAX_PAGES = 200;

export type CoordinationAccessDeps = {
  ledger: Pick<StateLedger, "load" | "events">;
  control: Pick<
    ControlEngine,
    | "sendDirectedRequest"
    | "respondDirectedRequest"
    | "createSubscription"
    | "registerWait"
    | "cancelCommunication"
  >;
  vault: ArtifactPort;
  now: () => string;
};

/**
 * 该 Run 的协调身份解析结果。`absent` 与 `ambiguous` 都必须**明确失败**，不猜一个身份。
 *
 * `resolved` 同时给出**授予依据**（账本里已经存在的那条 canonical 事实）：协调能力不是本模块
 * 自己签发的，而是"这个 Run 精确对应一段 active 参与关系"这一账本事实的读法。
 */
export type RunPrincipalResolution =
  | { status: "resolved"; principal: AgentPrincipalRefV1; basis: CoordinationCapabilityBasisV1 }
  | { status: "absent"; reason: string }
  | { status: "ambiguous"; reason: string };

/**
 * 从 canonical 事实派生**当前 Run 的 exact principal**（协议约束 2.3 的显式推导规则）。
 *
 * 规则（刻意写成可复核的显式条款，不用"唯一一段 active 参与关系"这类过程式判据——
 * 它在换手、跨 Work、多段参与下会含糊）：
 *
 *   **候选**（这个 Run 可能属于哪一段参与）：
 *     a. 这个 Run **发起**的参与关系：`WorkParticipationStarted` 的 actor 是 agent 且 runRef == 本 Run；
 *     b. **后继 Run**：某个 `CommunicationAdmission` 的 `runRef` == 本 Run 时，它固定的 `participationRef`。
 *   **授予条件**（三条同时成立才授予，任何一条不成立都不授予）：
 *     1. 该参与关系 `status === 'active'`；
 *     2. 该参与关系**正好是该 Work 的当前参与关系**（`WorkContextBindingV1.currentParticipationRef`
 *        指向它）——换手之后旧参与关系不再"当前"，旧 Run 因此不再被授予；
 *     3. 该 Run **link 在这个 Work 上**（`linkedRunRefs` 含本 Run）。
 *   **结果**：恰好一个 Work 满足 → 授予（并给出依据）；一个都不满足 → absent + 可读原因；
 *     多个 Work 同时满足 → ambiguous（**拒绝**，宿主不替它挑一个身份）。
 *
 * 依据的取值：普通 Run 用 `work_current_participation`（Work 上的当前参与指针，participation-start
 * 与参与关系快照同事务写入）；后继 Run 用它那条受理记录（`communication_admission`）。
 *
 * 旧记录/异常一律 fail-closed：`currentParticipationRef` 缺失（undefined/null）按"该 Work 没有
 * 当前参与关系"处理，**不回退**到等待登记时那一段，也不补猜。
 */
export async function resolveRunPrincipal(
  deps: Pick<CoordinationAccessDeps, "ledger">,
  runRef: RunRef,
): Promise<RunPrincipalResolution> {
  // ── 候选（步骤 a/b）：这个 Run 发起过的参与关系 ∪ 它的接续受理记录固定的参与关系 ──────────
  const candidates = new Map<string, { ref: WorkParticipationRef; admissionWaitRef: WaitConditionRef | null }>();
  let cursor: CommitCursor | null = null;
  let pages = 0;
  for (;;) {
    const page = await deps.ledger.events({ afterCursor: cursor, limit: SCAN_PAGE_SIZE });
    for (const positioned of page.events) {
      const event = positioned.event as { eventType?: string; projectId?: string; workspaceId?: string; payload?: Record<string, unknown> };
      if (event.projectId !== runRef.projectId) continue;
      if (event.eventType === "WorkParticipationStarted") {
        const actor = (event as { actor?: { kind?: string; runRef?: RunRef } }).actor;
        if (actor?.kind !== "agent" || actor.runRef?.runId !== runRef.runId) continue;
        const participation = (event.payload as { participation?: { workContextRef?: { workId?: string }; participationId?: string } }).participation;
        if (participation?.workContextRef?.workId === undefined || participation.participationId === undefined) continue;
        const ref: WorkParticipationRef = {
          aggregateType: "WorkParticipation",
          projectId: runRef.projectId,
          workspaceId: String(event.workspaceId),
          workId: participation.workContextRef.workId,
          participationId: participation.participationId,
        };
        candidates.set(canonicalJson(ref as never), { ref, admissionWaitRef: null });
        continue;
      }
      if (event.eventType === "CommunicationAdmissionRecorded") {
        const admission = (event.payload as { admission?: { runRef?: RunRef; participationRef?: WorkParticipationRef; waitRef?: WaitConditionRef } }).admission;
        if (admission?.runRef?.runId !== runRef.runId || admission.participationRef === undefined) continue;
        const ref: WorkParticipationRef = { ...admission.participationRef };
        const key = canonicalJson(ref as never);
        // 受理记录是"后继 Run 属于哪一段参与"的权威来源；同一个 ref 已有记录时保留受理依据。
        candidates.set(key, { ref, admissionWaitRef: admission.waitRef === undefined ? null : { ...admission.waitRef } });
      }
    }
    if (!page.hasMore) break;
    if (page.throughCursor === null || page.throughCursor === cursor) {
      return { status: "absent", reason: "账本事件页游标没有推进，读不完整就不猜身份" };
    }
    cursor = page.throughCursor;
    pages += 1;
    if (pages >= SCAN_MAX_PAGES) {
      return { status: "absent", reason: "身份扫描超过上限 " + String(SCAN_MAX_PAGES) + " 页，读不完整就不猜身份" };
    }
  }
  if (candidates.size === 0) {
    return { status: "absent", reason: "这个 Run 既没有发起过参与关系，也不是任何接续受理记录的后继 Run" };
  }
  // ── 授予条件（1/2/3）：active ∧ 是该 Work 的当前参与关系 ∧ 该 Run link 在这个 Work 上 ──────
  const granted: { principal: AgentPrincipalRefV1; basis: CoordinationCapabilityBasisV1 }[] = [];
  const refusals: string[] = [];
  for (const candidate of candidates.values()) {
    const { ref } = candidate;
    const loaded = await deps.ledger.load(ref);
    if (loaded.status !== "found" || loaded.snapshot.ref.aggregateType !== "WorkParticipation") {
      refusals.push(ref.participationId + "：参与关系读不到");
      continue;
    }
    const participation = (loaded.snapshot as WorkParticipationSnapshot).participation;
    if (participation.status !== "active") {
      refusals.push(ref.participationId + "：参与关系不是 active（" + participation.status + "）");
      continue;
    }
    const work = await deps.ledger.load(participation.workContextRef);
    if (work.status !== "found" || work.snapshot.ref.aggregateType !== "WorkContextBinding") {
      refusals.push(ref.participationId + "：所属 Work 读不到（" + participation.workContextRef.workId + "）");
      continue;
    }
    const binding = (work.snapshot as WorkContextBindingSnapshot).binding;
    const current = binding.currentParticipationRef ?? null;
    if (current === null || canonicalJson(current as never) !== canonicalJson(ref as never)) {
      // 换手之后旧参与关系不再是"当前"：旧 Run 因此不再被授予（协议 2.2 不自动继承旧授权）。
      refusals.push(ref.participationId + "：不是该 Work 的当前参与关系（current=" + (current === null ? "null" : current.participationId) + "）");
      continue;
    }
    if (!binding.linkedRunRefs.some((linked: RunRef) => linked.runId === runRef.runId && linked.projectId === runRef.projectId)) {
      refusals.push(ref.participationId + "：本 Run 没有 link 在这个 Work 上");
      continue;
    }
    granted.push({
      principal: {
        schemaVersion: 1,
        agentInstanceId: participation.agentInstanceId,
        workContextRef: { ...participation.workContextRef },
        participationRef: { ...ref },
        roleBinding: { ...participation.roleBinding },
        runRef: { ...runRef },
      },
      basis: candidate.admissionWaitRef === null
        ? { kind: "work_current_participation", workContextRef: { ...participation.workContextRef }, participationRef: { ...ref } }
        : { kind: "communication_admission", waitRef: { ...candidate.admissionWaitRef }, participationRef: { ...ref } },
    });
  }
  if (granted.length === 0) {
    return { status: "absent", reason: "这个 Run 的候选参与关系都不满足授予条件（" + refusals.join("；") + "）" };
  }
  if (granted.length > 1) {
    return { status: "ambiguous", reason: "这个 Run 同时在多个 Work 上满足授予条件；宿主不替它挑一个身份，协调工具不装配" };
  }
  return { status: "resolved", principal: granted[0]!.principal, basis: granted[0]!.basis };
}

/** 模型给的内容键 → 聚合 id（由 principal 的 Run + 键机械派生；重复调用是幂等 replay）。 */
function aggregateIdFor(principal: AgentPrincipalRefV1, kind: string, key: string): string {
  return "c" + kind + "-" + sha256Hex(canonicalJson(["coordination-tool-v1", kind, principal.runRef.runId, key] as never)).slice(0, 24);
}

export class CoordinationToolAccess implements CoordinationToolAccessPort {
  constructor(
    private readonly deps: CoordinationAccessDeps,
    readonly principal: AgentPrincipalRefV1,
    /**
     * **宿主授予的协调能力**（协议约束 2.3）。它不是可选项：没有授予就构造不出这个访问面
     * （见 coordinationRuntimeGrant），而每个写操作还会在**动 Vault/Control 之前**再校验一次。
     */
    private readonly capability: CoordinationCapabilityGrantV1,
  ) {}

  /**
   * 每个**写**操作的第一道闸门（协议约束 2.3）：在 `vault.put` 与 Control 写入口**之前**，
   * 确认"这个 Run 现在仍然被授予协调能力"。
   *
   * 为什么要在调用时刻再查一次（而不是只在装配时查）：装配发生在运行开始前，而运行期间
   * canonical 事实可能变化（例如这一段参与关系被 endWorkParticipation 结束、或指向的参与
   * 关系已不再 active）。此时必须**拒绝并给出可读原因**，不能静默降级成"只读成功"，
   * 也不能让正文先落进 Vault 再被 Control 拒绝。
   *
   * 返回 null = 通过；返回非 null = 已经可以交回给模型的拒绝结果。
   */
  private async capabilityDenial(operation: "request" | "respond" | "subscribe" | "wait" | "cancel"): Promise<CoordinationToolOutcomeV1 | null> {
    if (this.capability.capability !== COORDINATION_CAPABILITY_ID ||
        canonicalJson(this.capability.runRef as never) !== canonicalJson(this.principal.runRef as never) ||
        canonicalJson(this.capability.participationRef as never) !== canonicalJson(this.principal.participationRef as never)) {
      return this.rejected(operation, "not_granted", [
        "本次调用没有宿主授予的协调能力（授予与当前 Run/参与关系不一致）：拒绝，且不读写任何平台状态",
      ]);
    }
    const loaded = await this.deps.ledger.load(this.capability.participationRef);
    if (loaded.status !== "found" || loaded.snapshot.ref.aggregateType !== "WorkParticipation") {
      return this.rejected(operation, "not_granted", [
        "本次调用的协调能力依据（参与关系 " + this.capability.participationRef.participationId + "）在账本里读不到：拒绝，且不读写任何平台状态",
      ]);
    }
    const participation = (loaded.snapshot as WorkParticipationSnapshot).participation;
    if (participation.status !== "active") {
      return this.rejected(operation, "not_granted", [
        "本次调用的协调能力已经不再有效：参与关系 " + this.capability.participationRef.participationId +
        " 当前是 " + participation.status + "（能力授予在调用时刻必须仍然成立）：拒绝，且不读写任何平台状态",
      ]);
    }
    if (participation.agentInstanceId !== this.principal.agentInstanceId) {
      return this.rejected(operation, "not_granted", [
        "Particip 参与关系与本次调用的 AgentInstance 不一致（" + participation.agentInstanceId + " ≠ " + this.principal.agentInstanceId + "）：拒绝",
      ]);
    }
    return null;
  }

  private identity(operation: string, target: string) {
    return {
      projectId: this.principal.workContextRef.projectId,
      actor: { kind: "agent" as const, id: this.principal.agentInstanceId, runRef: { ...this.principal.runRef } },
      idempotencyKey: "coord-tool-" + operation + "-" + target,
      agentPrincipal: {
        schemaVersion: 1 as const,
        agentInstanceId: this.principal.agentInstanceId,
        workContextRef: { ...this.principal.workContextRef },
        participationRef: { ...this.principal.participationRef },
        roleBinding: { ...this.principal.roleBinding },
        runRef: { ...this.principal.runRef },
      },
    };
  }

  private rejected(operation: "request" | "respond" | "subscribe" | "wait" | "cancel", code: string, issues: string[]): CoordinationToolOutcomeV1 {
    return { status: "rejected", operation, code, issues };
  }

  /**
   * 正文的**来源 pin**。
   *
   * 诚实边界：`SourceRefV1.kind` 是封闭四值（plan-revision / artifact / workspace / governance），
   * 没有"Run 输出"这一档。这里用 artifact + `run:<runId>` 的坐标表达"这份正文由这个 Run 提交"：
   * 它是一份**出处坐标**，不冒充对工作区版本或任何 digest 的核验（正文自身的完整性由 Vault 的
   * 内容寻址保证——ArtifactRef.digest/sizeBytes 由 put 计算）。
   */
  private bodySourceRefs() {
    return [{ kind: "artifact" as const, refId: "run:" + this.principal.runRef.runId, revision: "1" }];
  }

  async mailbox(): Promise<CoordinationMailboxResultV1> {
    const work = this.principal.workContextRef;
    const refs = await this.scanMailbox();
    const requests: { requestId: string; revision: number; status: string; fromWorkId: string; toWorkId: string }[] = [];
    for (const ref of refs.requests.values()) {
      const loaded = await this.deps.ledger.load(ref);
      if (loaded.status !== "found" || loaded.snapshot.ref.aggregateType !== "DirectedRequest") continue;
      const request = (loaded.snapshot as DirectedRequestSnapshot).request;
      requests.push({ requestId: request.requestId, revision: loaded.snapshot.revision, status: request.status, fromWorkId: request.fromWorkContextRef.workId, toWorkId: request.toWorkContextRef.workId });
    }
    const deliveries: { deliveryId: string; originKind: string; bodyDigest: string | null }[] = [];
    for (const ref of refs.deliveries.values()) {
      const loaded = await this.deps.ledger.load(ref);
      if (loaded.status !== "found" || loaded.snapshot.ref.aggregateType !== "Delivery") continue;
      const delivery = (loaded.snapshot as DeliverySnapshot).delivery;
      deliveries.push({ deliveryId: delivery.deliveryId, originKind: delivery.origin.kind, bodyDigest: delivery.bodyRef?.digest ?? null });
    }
    const subscriptions: { subscriptionId: string; topics: string[]; status: string }[] = [];
    for (const ref of refs.subscriptions.values()) {
      const loaded = await this.deps.ledger.load(ref);
      if (loaded.status !== "found" || loaded.snapshot.ref.aggregateType !== "Subscription") continue;
      const subscription = (loaded.snapshot as SubscriptionSnapshot).subscription;
      subscriptions.push({ subscriptionId: subscription.subscriptionId, topics: [...subscription.topics], status: subscription.status });
    }
    const waits: { waitId: string; status: string; conditions: number }[] = [];
    for (const ref of refs.waits.values()) {
      const loaded = await this.deps.ledger.load(ref);
      if (loaded.status !== "found" || loaded.snapshot.ref.aggregateType !== "WaitCondition") continue;
      const wait = (loaded.snapshot as WaitConditionSnapshot).wait;
      waits.push({ waitId: wait.waitId, status: wait.status, conditions: wait.conditions.length });
    }
    return {
      status: "ready",
      mailbox: {
        workContextRef: { ...work },
        requests: requests.sort((a, b) => a.requestId.localeCompare(b.requestId)),
        deliveries: deliveries.sort((a, b) => a.deliveryId.localeCompare(b.deliveryId)),
        subscriptions: subscriptions.sort((a, b) => a.subscriptionId.localeCompare(b.subscriptionId)),
        waits: waits.sort((a, b) => a.waitId.localeCompare(b.waitId)),
      },
    };
  }

  /** 只按事件 payload 里声明的 canonical 归属关系收引用（与 Control 的 mailboxView 同一手法）。 */
  private async scanMailbox(): Promise<{
    requests: Map<string, DirectedRequestRef>;
    deliveries: Map<string, ReturnType<typeof deliveryRefFor>>;
    subscriptions: Map<string, SubscriptionRef>;
    waits: Map<string, WaitConditionRef>;
  }> {
    const workId = this.principal.workContextRef.workId;
    const projectId = this.principal.workContextRef.projectId;
    const requests = new Map<string, DirectedRequestRef>();
    const deliveries = new Map<string, ReturnType<typeof deliveryRefFor>>();
    const subscriptions = new Map<string, SubscriptionRef>();
    const waits = new Map<string, WaitConditionRef>();
    let cursor: CommitCursor | null = null;
    let pages = 0;
    for (;;) {
      const page = await this.deps.ledger.events({ afterCursor: cursor, limit: SCAN_PAGE_SIZE });
      for (const positioned of page.events) {
        const event = positioned.event as { eventType?: string; projectId?: string; payload?: Record<string, unknown> };
        if (event.projectId !== projectId) continue;
        if (event.eventType === "DirectedRequestSent" || event.eventType === "DirectedRequestResponded" || event.eventType === "DirectedRequestCancelled") {
          const request = (event.payload as { request?: { requestId: string; fromWorkContextRef: { workId: string }; toWorkContextRef: { workId: string } } }).request;
          if (request === undefined) continue;
          if (request.fromWorkContextRef.workId !== workId && request.toWorkContextRef.workId !== workId) continue;
          const ref = directedRequestRefFor(projectId, String((event as { workspaceId?: string }).workspaceId), request.requestId);
          requests.set(canonicalJson(ref as never), ref);
          continue;
        }
        if (event.eventType === "DeliveryRecorded") {
          const delivery = (event.payload as { delivery?: { deliveryId: string; targetWorkContextRef: { workId: string } } }).delivery;
          if (delivery === undefined || delivery.targetWorkContextRef.workId !== workId) continue;
          const ref = deliveryRefFor(projectId, String((event as { workspaceId?: string }).workspaceId), delivery.deliveryId);
          deliveries.set(canonicalJson(ref as never), ref);
          continue;
        }
        if (event.eventType === "SubscriptionCreated" || event.eventType === "SubscriptionCancelled" || event.eventType === "SubscriptionCatchupPlanned" || event.eventType === "SubscriptionCatchupAdvanced") {
          const subscription = (event.payload as { subscription?: { subscriptionId: string; ownerWorkContextRef: { workId: string } } }).subscription;
          if (subscription === undefined || subscription.ownerWorkContextRef.workId !== workId) continue;
          const ref = subscriptionRefFor(projectId, String((event as { workspaceId?: string }).workspaceId), subscription.subscriptionId);
          subscriptions.set(canonicalJson(ref as never), ref);
          continue;
        }
        if (event.eventType === "WaitConditionRegistered" || event.eventType === "WaitConditionObserved" ||
            event.eventType === "WaitConditionSatisfied" || event.eventType === "WaitConditionTimedOut" || event.eventType === "WaitConditionCancelled") {
          const wait = (event.payload as { wait?: { waitId: string; ownerWorkContextRef: { workId: string } } }).wait;
          if (wait === undefined || wait.ownerWorkContextRef.workId !== workId) continue;
          const ref = waitConditionRefFor(projectId, String((event as { workspaceId?: string }).workspaceId), wait.waitId);
          waits.set(canonicalJson(ref as never), ref);
        }
      }
      if (!page.hasMore) break;
      if (page.throughCursor === null || page.throughCursor === cursor) {
        return { requests, deliveries, subscriptions, waits };
      }
      cursor = page.throughCursor;
      pages += 1;
      if (pages >= SCAN_MAX_PAGES) return { requests, deliveries, subscriptions, waits };
    }
    return { requests, deliveries, subscriptions, waits };
  }

  async request(input: { toWorkId: string; statement: string; body: string; key: string }): Promise<CoordinationToolOutcomeV1> {
    const denied = await this.capabilityDenial("request");
    if (denied !== null) return denied;
    const work = this.principal.workContextRef;
    const requestId = aggregateIdFor(this.principal, "req", input.key);
    // body-first：正文先进 Vault，拿到精确 ArtifactRef 之后才可能被 Control 受理。
    // 来源 pin 的坐标说明见 bodySourceRefs()。
    const stored = await this.deps.vault.put({
      contentType: "application/json",
      body: input.body,
      ownerRef: { ...this.principal.runRef },
      sourceRefs: this.bodySourceRefs(),
      requestedAt: this.deps.now(),
    });
    if (stored.status !== "stored") {
      return this.rejected("request", "body_not_stored", ["请求正文未能存入 Vault（" + stored.code + "）：" + stored.issues.join("; ")]);
    }
    const receipt = await this.deps.control.sendDirectedRequest({
      commandId: "coord-tool-request-" + requestId,
      commandType: "SendDirectedRequest",
      schemaVersion: 1,
      aggregateId: requestId,
      expectedRevision: 0,
      correlationId: "coord-tool-request-" + requestId,
      submittedAt: this.deps.now(),
      identity: this.identity("request", requestId),
      payload: {
        workspaceId: work.workspaceId,
        fromParticipationRef: { ...this.principal.participationRef },
        fromRunRef: { ...this.principal.runRef },
        toWorkContextRef: { aggregateType: "WorkContextBinding", projectId: work.projectId, workspaceId: work.workspaceId, workId: input.toWorkId },
        expectedParticipationRef: null,
        statement: input.statement,
        statementBodyRef: stored.ref,
        roleBinding: { ...this.principal.roleBinding },
      },
    });
    if (receipt.status !== "committed") {
      return this.rejected("request", receipt.code, ["定向请求未被受理（" + receipt.status + "）", ...(receipt.issues ?? [])]);
    }
    // 请求受理时**同事务**产生首个 Delivery（正文进目标 Work），它的 id 是确定性的：
    // 模型因此能在后续的 wait 里引用**精确的** Delivery，而不必猜 id。
    const deliveryId = directDeliveryIdFor(requestId, input.toWorkId);
    return {
      status: "accepted", operation: "request", replayed: receipt.replayed,
      references: [
        { kind: "DirectedRequest", id: requestId, revision: 1 },
        { kind: "Delivery", id: deliveryId, revision: 1 },
      ],
      summary: "定向请求已受理（Work " + input.toWorkId + "）；正文已 body-first 存入 Vault。",
    };
  }

  async respond(input: { requestId: string; body: string; key: string }): Promise<CoordinationToolOutcomeV1> {
    const denied = await this.capabilityDenial("respond");
    if (denied !== null) return denied;
    const work = this.principal.workContextRef;
    const requestRef = directedRequestRefFor(work.projectId, work.workspaceId, input.requestId);
    const loaded = await this.deps.ledger.load(requestRef);
    if (loaded.status !== "found" || loaded.snapshot.ref.aggregateType !== "DirectedRequest") {
      return this.rejected("respond", "not_found", ["定向请求不存在：" + input.requestId]);
    }
    const stored = await this.deps.vault.put({
      contentType: "application/json",
      body: input.body,
      ownerRef: { ...this.principal.runRef },
      sourceRefs: this.bodySourceRefs(),
      requestedAt: this.deps.now(),
    });
    if (stored.status !== "stored") {
      return this.rejected("respond", "body_not_stored", ["报告正文未能存入 Vault（" + stored.code + "）：" + stored.issues.join("; ")]);
    }
    const receipt = await this.deps.control.respondDirectedRequest({
      commandId: "coord-tool-respond-" + input.requestId + "-" + input.key,
      commandType: "RespondDirectedRequest",
      schemaVersion: 1,
      aggregateId: input.requestId,
      expectedRevision: loaded.snapshot.revision,
      correlationId: "coord-tool-respond-" + input.requestId + "-" + input.key,
      submittedAt: this.deps.now(),
      identity: this.identity("respond", input.requestId + "-" + input.key),
      payload: {
        workspaceId: work.workspaceId,
        respondingParticipationRef: { ...this.principal.participationRef },
        respondingRunRef: { ...this.principal.runRef },
        response: {
          bodyRef: stored.ref,
          // 诚实归因（Control 会复核）：报告作者必须就是本次回应的 Run。
          sourceRefs: this.bodySourceRefs(),
          authorRunRef: { ...this.principal.runRef },
        },
      },
    });
    if (receipt.status !== "committed") {
      return this.rejected("respond", receipt.code, ["报告未被受理（" + receipt.status + "）", ...(receipt.issues ?? [])]);
    }
    return {
      status: "accepted", operation: "respond", replayed: receipt.replayed,
      references: [{ kind: "DirectedRequest", id: input.requestId, revision: loaded.snapshot.revision + 1 }],
      summary: "报告正文已 body-first 存入 Vault，并由 Control 正式登记为该请求的回应。",
    };
  }

  async subscribe(input: { topics: string[]; startCursor?: string | null; key: string }): Promise<CoordinationToolOutcomeV1> {
    const denied = await this.capabilityDenial("subscribe");
    if (denied !== null) return denied;
    const work = this.principal.workContextRef;
    const subscriptionId = aggregateIdFor(this.principal, "sub", input.key);
    const receipt = await this.deps.control.createSubscription({
      commandId: "coord-tool-subscribe-" + subscriptionId,
      commandType: "CreateSubscription",
      schemaVersion: 1,
      aggregateId: subscriptionId,
      expectedRevision: 0,
      correlationId: "coord-tool-subscribe-" + subscriptionId,
      submittedAt: this.deps.now(),
      identity: this.identity("subscribe", subscriptionId),
      payload: {
        workspaceId: work.workspaceId,
        ownerWorkContextRef: { ...work },
        ownerParticipationRef: { ...this.principal.participationRef },
        topics: [...input.topics],
        // "从现在起"：Control 会把订阅锚定到当前账本 frontier 并为每个 topic 建首个 route intent，
        // 因此订阅之前的事件不会被补投（可核对的事实）。
        startCursor: (input.startCursor ?? null) as import('../../contracts/command-event.js').CommitCursor | null,
      },
    });
    if (receipt.status !== "committed") {
      return this.rejected("subscribe", receipt.code, ["订阅未被受理（" + receipt.status + "）", ...(receipt.issues ?? [])]);
    }
    return {
      status: "accepted", operation: "subscribe", replayed: receipt.replayed,
      references: [{ kind: "Subscription", id: subscriptionId, revision: 1 }],
      summary: "订阅已受理：" + input.topics.join(", ") + (input.startCursor ? "（从指定位置有限补投到本 Work）。" : "（从现在起路由到本 Work）。"),
    };
  }

  async wait(input: { mode?: 'all' | 'any'; deliveryIds: string[]; requestIds: string[]; deadlineAt: string | null; key: string }): Promise<CoordinationToolOutcomeV1> {
    const denied = await this.capabilityDenial("wait");
    if (denied !== null) return denied;
    const work = this.principal.workContextRef;
    const waitId = aggregateIdFor(this.principal, "wait", input.key);
    const conditions = [
      ...input.deliveryIds.map((deliveryId) => ({ kind: "delivery_present" as const, deliveryRef: deliveryRefFor(work.projectId, work.workspaceId, deliveryId) })),
      ...input.requestIds.map((requestId) => ({ kind: "request_responded" as const, requestRef: directedRequestRefFor(work.projectId, work.workspaceId, requestId) })),
    ];
    if (conditions.length === 0) {
      return this.rejected("wait", "invalid", ["等待至少要有一条条件（deliveryIds 或 requestIds）"]);
    }
    const receipt = await this.deps.control.registerWait({
      commandId: "coord-tool-wait-" + waitId,
      commandType: "RegisterWait",
      schemaVersion: 1,
      aggregateId: waitId,
      expectedRevision: 0,
      correlationId: "coord-tool-wait-" + waitId,
      submittedAt: this.deps.now(),
      identity: this.identity("wait", waitId),
      payload: {
        workspaceId: work.workspaceId,
        ownerWorkContextRef: { ...work },
        ownerParticipationRef: { ...this.principal.participationRef },
        predecessorRunRef: { ...this.principal.runRef },
        ...(input.mode ? { mode: input.mode } : {}),
        conditions,
        deadlineAt: input.deadlineAt,
      },
    });
    if (receipt.status !== "committed") {
      return this.rejected("wait", receipt.code, ["等待未被受理（" + receipt.status + "）", ...(receipt.issues ?? [])]);
    }
    return {
      status: "accepted", operation: "wait", replayed: receipt.replayed,
      references: [{ kind: "WaitCondition", id: waitId, revision: 1 }],
      summary: "all-wait 已受理（" + String(conditions.length) + " 条条件）：条件全部满足且本次 Run 公开结束后，同一 Work 上受理唯一后继。",
    };
  }

  async cancel(input: { target: "directed_request" | "subscription" | "wait"; targetId: string; reason: string }): Promise<CoordinationToolOutcomeV1> {
    const denied = await this.capabilityDenial("cancel");
    if (denied !== null) return denied;
    const work = this.principal.workContextRef;
    const ref = input.target === "directed_request"
      ? directedRequestRefFor(work.projectId, work.workspaceId, input.targetId)
      : input.target === "subscription"
        ? subscriptionRefFor(work.projectId, work.workspaceId, input.targetId)
        : waitConditionRefFor(work.projectId, work.workspaceId, input.targetId);
    const loaded = await this.deps.ledger.load(ref);
    if (loaded.status !== "found") {
      return this.rejected("cancel", "not_found", ["取消目标不存在：" + input.target + " " + input.targetId]);
    }
    const receipt = await this.deps.control.cancelCommunication({
      commandId: "coord-tool-cancel-" + input.target + "-" + input.targetId,
      commandType: "CancelCommunication",
      schemaVersion: 1,
      aggregateId: input.targetId,
      expectedRevision: loaded.snapshot.revision,
      correlationId: "coord-tool-cancel-" + input.target + "-" + input.targetId,
      submittedAt: this.deps.now(),
      identity: this.identity("cancel", input.target + "-" + input.targetId),
      payload: { workspaceId: work.workspaceId, target: input.target, reason: input.reason },
    });
    if (receipt.status !== "committed") {
      return this.rejected("cancel", receipt.code, ["取消未被受理（" + receipt.status + "）", ...(receipt.issues ?? [])]);
    }
    return {
      status: "accepted", operation: "cancel", replayed: receipt.replayed,
      references: [],
      summary: "取消已受理（desired-state-first，等待 handler 以同一 generation 收敛）。",
    };
  }
}

/**
 * 组合根用的入口：为**一个** Run 装配工具访问面。
 * 没有唯一 active 参与关系时返回 `null`（不装配工具），并把原因交给调用方如实报告。
 */
export async function coordinationAccessFor(
  deps: CoordinationAccessDeps,
  runRef: RunRef,
): Promise<{ access: CoordinationToolAccessPort | null; reason: string | null }> {
  const resolution = await resolveRunPrincipal(deps, runRef);
  if (resolution.status !== "resolved") return { access: null, reason: resolution.reason };
  // 访问面**只能**带着一份明确的授予被构造（协议约束 2.3）：没有授予就没有访问面。
  return {
    access: new CoordinationToolAccess(deps, resolution.principal, {
      schemaVersion: 1,
      capability: COORDINATION_CAPABILITY_ID,
      runRef: { ...runRef },
      workContextRef: { ...resolution.principal.workContextRef },
      participationRef: { ...resolution.principal.participationRef },
      agentInstanceId: resolution.principal.agentInstanceId,
      roleBinding: { ...resolution.principal.roleBinding },
      basis: resolution.basis,
    }),
    reason: null,
  };
}

export type { CoordinationToolAccessPort };
