import type { CommandIdentity } from '../../../contracts/command-event.js';
import { canonicalJson } from '../../../contracts/fingerprint.js';
import type { LedgerCommitReceipt, VersionedRef } from '../../../contracts/ledger.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import type { WorkContextRef } from '../../../contracts/context-continuity.js';
import type { ValidationIssue } from '../../../contracts/validation/common.js';
import { validateActor } from '../../../contracts/validation/identity.js';
import type {
  AdmitWaitSuccessorReceipt,
  AgentPrincipalRefV1,
  CommunicationSettleReceipt,
  CommunicationWriteReceipt,
  EnsureWaitAdmissionReceipt,
  WorkParticipationRef,
} from '../../../contracts/coordination.js';

/** Pure command-shape, attribution and receipt mapping for coordination admission. */
type WriteRejectionCode =
  | "invalid"
  | "not_found"
  | "forbidden"
  | "stale_participation"
  | "stale_binding"
  | "revision_conflict"
  | "idempotency_conflict"
  | "over_limit"
  | "unavailable";

// ------------------------------------------------------------------------ //
// 结构校验小工具（只判形状，不做业务准入）                                     //
// ------------------------------------------------------------------------ //

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function requireString(value: unknown, path: string, issues: string[]): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  issues.push(path + " 必须是非空字符串");
  return null;
}

export function requireIsoTimestamp(value: unknown, path: string, issues: string[]): string | null {
  const text = requireString(value, path, issues);
  if (text === null) return null;
  if (Number.isNaN(Date.parse(text))) {
    issues.push(path + " 必须是可解析的时间戳");
    return null;
  }
  return text;
}

type CommandShape = {
  commandId?: unknown;
  commandType?: unknown;
  schemaVersion?: unknown;
  correlationId?: unknown;
  aggregateId?: unknown;
  expectedRevision?: unknown;
  identity?: unknown;
};

export function checkCommandShape(command: CommandShape, expectedType: string, issues: string[]): void {
  if (command.schemaVersion !== 1) issues.push("schemaVersion 必须是 1");
  if (command.commandType !== expectedType) issues.push("commandType 必须是 " + expectedType);
  requireString(command.commandId, "commandId", issues);
  requireString(command.correlationId, "correlationId", issues);
  requireString(command.aggregateId, "aggregateId", issues);
  const identity = asRecord(command.identity);
  if (identity === null) {
    issues.push("identity 必须是对象");
    return;
  }
  requireString(identity["projectId"], "identity.projectId", issues);
  requireString(identity["idempotencyKey"], "identity.idempotencyKey", issues);
  const actorIssues: ValidationIssue[] = [];
  validateActor(identity["actor"], "identity.actor", actorIssues);
  for (const issue of actorIssues) issues.push(issue.message);
}

function checkRefScope(
  ref: unknown,
  path: string,
  projectId: string,
  workspaceId: string | null,
  issues: string[],
): void {
  const record = asRecord(ref);
  if (record === null) {
    issues.push(path + " 必须是引用对象");
    return;
  }
  if (record["projectId"] !== projectId) issues.push(path + ".projectId 必须与 identity.projectId 一致");
  if (workspaceId !== null && record["workspaceId"] !== workspaceId) {
    issues.push(path + ".workspaceId 必须与 payload.workspaceId 一致");
  }
}

export function checkWorkContextRef(value: unknown, path: string, projectId: string, workspaceId: string, issues: string[]): void {
  const record = asRecord(value);
  if (record === null) {
    issues.push(path + " 必须是 WorkContextRef");
    return;
  }
  if (record["aggregateType"] !== "WorkContextBinding") issues.push(path + ".aggregateType 必须是 WorkContextBinding");
  checkRefScope(record, path, projectId, workspaceId, issues);
  requireString(record["workId"], path + ".workId", issues);
}

export function checkParticipationRef(value: unknown, path: string, projectId: string, workspaceId: string, issues: string[]): void {
  const record = asRecord(value);
  if (record === null) {
    issues.push(path + " 必须是 WorkParticipationRef");
    return;
  }
  if (record["aggregateType"] !== "WorkParticipation") issues.push(path + ".aggregateType 必须是 WorkParticipation");
  checkRefScope(record, path, projectId, workspaceId, issues);
  requireString(record["workId"], path + ".workId", issues);
  requireString(record["participationId"], path + ".participationId", issues);
}

export function checkRunRef(value: unknown, path: string, projectId: string, issues: string[]): void {
  const record = asRecord(value);
  if (record === null) {
    issues.push(path + " 必须是 RunRef");
    return;
  }
  if (record["aggregateType"] !== "Run") issues.push(path + ".aggregateType 必须是 Run");
  checkRefScope(record, path, projectId, null, issues);
  requireString(record["goalId"], path + ".goalId", issues);
  requireString(record["runId"], path + ".runId", issues);
}

/** body-first 的引用**形状**校验：正文本身由 ArtifactVault 负责存在性与授权。 */
export function checkArtifactRef(value: unknown, path: string, issues: string[]): void {
  const record = asRecord(value);
  if (record === null) {
    issues.push(path + " 必须是 ArtifactRef");
    return;
  }
  if (record["kind"] !== "artifact") issues.push(path + ".kind 必须是 artifact");
  requireString(record["contentType"], path + ".contentType", issues);
  requireString(record["digest"], path + ".digest", issues);
  const size = record["sizeBytes"];
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
    issues.push(path + ".sizeBytes 必须是非负数字");
  }
  const source = asRecord(record["source"]);
  if (source === null) {
    issues.push(path + ".source 必须是 SourceRefV1");
    return;
  }
  requireString(source["kind"], path + ".source.kind", issues);
  requireString(source["refId"], path + ".source.refId", issues);
  requireString(source["revision"], path + ".source.revision", issues);
}

export function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

// ------------------------------------------------------------------------ //
// 归因校验（参与关系与换手：Agent 不用假 human 身份）                                     //
// ------------------------------------------------------------------------ //

/**
 * 协作通信命令的归因规则：actor **必须**是 agent，且（需要 Work/参与关系时）
 * identity.agentPrincipal 必须与 payload 逐字段一致。
 * 不一致一律 forbidden + 明确 issues——不静默按 payload 纠正，也不按 principal 改投。
 */
export function checkAgentAttribution(
  identity: CommandIdentity,
  expected: {
    agentInstanceId: string;
    workContextRef: WorkContextRef;
    participationRef: WorkParticipationRef;
    runRef: RunSnapshot["ref"] | { aggregateType: "Run"; projectId: string; goalId: string; runId: string };
    /** 省略时只核对 agent/Work/参与/Run；给出时还要逐字段核对授权版本。 */
    roleBinding?: unknown;
    /** true 时 principal 必须存在（需要 Work/参与关系的命令）。 */
    required: boolean;
  },
  issues: string[],
): void {
  const actor = identity.actor;
  if (actor.kind !== "agent") {
    issues.push("协作通信命令必须用 agent 身份归因（禁止用 human/system 冒充 Agent）");
    return;
  }
  const principal: AgentPrincipalRefV1 | undefined = identity.agentPrincipal;
  if (principal === undefined) {
    if (expected.required) issues.push("agent 命令必须携带 identity.agentPrincipal（精确 AgentInstance/Work/参与/RoleBinding/Run）");
    return;
  }
  if (principal.agentInstanceId !== expected.agentInstanceId) issues.push("agentPrincipal.agentInstanceId 与 payload 不一致");
  if (canonicalJson(principal.workContextRef) !== canonicalJson(expected.workContextRef)) {
    issues.push("agentPrincipal.workContextRef 与 payload 的工作地址不一致");
  }
  if (canonicalJson(principal.participationRef) !== canonicalJson(expected.participationRef)) {
    issues.push("agentPrincipal.participationRef 与 payload 的参与关系不一致");
  }
  if (canonicalJson(principal.runRef) !== canonicalJson(expected.runRef)) {
    issues.push("agentPrincipal.runRef 与 payload 的发起 Run 不一致");
  }
  if (expected.roleBinding !== undefined && canonicalJson(principal.roleBinding as never) !== canonicalJson(expected.roleBinding as never)) {
    issues.push("agentPrincipal.roleBinding 与 payload 的授权版本不一致");
  }
  if (actor.id !== expected.agentInstanceId) issues.push("actor.id 必须是 AgentInstance id（与 payload 一致）");
  if (canonicalJson(actor.runRef) !== canonicalJson(expected.runRef)) {
    issues.push("actor.runRef 必须与 payload 的发起 Run 一致（causation 可核对）");
  }
}

/**
 * **调度触发**的协作命令的归因规则（协作通信参与身份裁决，参与身份规则）：只允许 system 身份，
 * 并要求命令自带**来源关联**（correlationId 由被触发的等待确定性派生，payload 给出 waitRef 与
 * 前驱 Run）。
 *
 * ── 为什么后继受理**不能**用 agent principal（这正是要修的缺陷）──────────────────
 * 触发接续的是调度侧的机械推进，不是某一段参与里的模型调用。此刻唯一存在的 agent 身份属于
 * **前驱那一段参与**（后继 Run 还不存在），用它归因等于把**新参与者**与**旧 Run** 拼成同一个
 * 身份：账本上会留下一条「后继由旧参与者发起」的假事实。Agent 侧的命令（请求/回应/订阅/等待/
 * 参与建立与结束）仍然按 AgentPrincipalRefV1 的精确 principal 归因，两者的 actor 不得混用。
 */
export function checkSchedulerAttribution(
  identity: CommandIdentity,
  correlationId: string,
  expected: { sourceId: string },
  issues: string[],
): void {
  const actor = identity.actor;
  if (actor.kind === "human") {
    issues.push("后继受理必须由调度侧以 system 身份提交（禁止 human 冒充）");
    return;
  }
  if (actor.kind === "agent") {
    issues.push(
      "后继受理是调度触发命令，必须用 {kind:'system'} 身份 + 来源关联提交；" +
      "用 agent principal 归因会把新参与者与旧 Run 拼成一个身份（后继 Run 此刻还不存在）",
    );
    return;
  }
  if (actor.id.length === 0) issues.push("system 身份必须给出非空 actor.id（调度消费者）");
  if (correlationId.length === 0) issues.push("调度触发的命令必须带来源关联（correlationId）");
  if (expected.sourceId.length > 0 && !correlationId.includes(expected.sourceId)) {
    issues.push("correlationId 必须由本次触发来源确定性派生（须包含 " + expected.sourceId + "）");
  }
}

// ------------------------------------------------------------------------ //
// receipt 映射                                                              //
// ------------------------------------------------------------------------ //

export function rejectWrite(
  commandId: string,
  code: WriteRejectionCode,
  issues?: string[],
  currentRevision?: number,
): CommunicationWriteReceipt {
  return {
    status: "rejected",
    commandId,
    code,
    ...(issues === undefined ? {} : { issues }),
    ...(currentRevision === undefined ? {} : { currentRevision }),
  };
}

export function mapCommitReceipt(
  receipt: LedgerCommitReceipt,
  commandId: string,
  preferredRefKey?: string,
): CommunicationWriteReceipt {
  if (receipt.status === "committed") {
    return {
      status: "committed",
      commandId,
      replayed: receipt.replayed,
      eventIds: [...receipt.eventIds],
      commitCursor: receipt.commitCursor,
      revisions: receipt.aggregateRevisions.map((v: VersionedRef) => ({
        refKey: canonicalJson(v.ref),
        revision: v.revision,
      })),
    };
  }
  return mapRejectedCommit(receipt, commandId, preferredRefKey);
}

function mapRejectedCommit(
  receipt: Extract<LedgerCommitReceipt, { status: "rejected" }>,
  commandId: string,
  preferredRefKey?: string,
): CommunicationWriteReceipt {
  switch (receipt.code) {
    case "invalid_commit":
      return rejectWrite(commandId, "invalid", ["StateLedger 拒绝了提交形状（事件/快照/期望版本不一致）"]);
    case "revision_conflict": {
      const versions = receipt.currentVersions ?? [];
      const preferred = preferredRefKey === undefined
        ? undefined
        : versions.find((v) => canonicalJson(v.ref) === preferredRefKey);
      const chosen = preferred ?? versions[0];
      return rejectWrite(commandId, "revision_conflict", undefined, chosen?.revision);
    }
    case "idempotency_conflict":
      return rejectWrite(commandId, "idempotency_conflict");
    case "unavailable":
      return rejectWrite(commandId, "unavailable");
    case "not_empty":
      return rejectWrite(commandId, "invalid", ["协作通信提交必须携带期望版本（CAS）"]);
  }
}


export function isLedgerCursor(value: unknown): boolean {
  return typeof value === 'string' && /^c\d{10}$/.test(value);
}

export function checkWaitTerm(term: unknown, path: string, projectId: string, workspaceId: string, issues: string[]): void {
  const record = asRecord(term);
  if (record === null) {
    issues.push(path + " 必须是等待条件项");
    return;
  }
  if (record["kind"] === "delivery_present") {
    checkDeliveryRefShape(record["deliveryRef"], path + ".deliveryRef", projectId, workspaceId, issues);
    return;
  }
  if (record["kind"] === "request_responded" || record["kind"] === "request_closed") {
    const ref = asRecord(record["requestRef"]);
    if (ref === null) {
      issues.push(path + ".requestRef 必须是 DirectedRequestRef");
      return;
    }
    if (ref["aggregateType"] !== "DirectedRequest") issues.push(path + ".requestRef.aggregateType 必须是 DirectedRequest");
    checkRefScope(ref, path + ".requestRef", projectId, workspaceId, issues);
    requireString(ref["requestId"], path + ".requestRef.requestId", issues);
    return;
  }
  issues.push(path + ".kind 必须是 delivery_present|request_responded|request_closed");
}

export function checkDeliveryRefShape(value: unknown, path: string, projectId: string, workspaceId: string, issues: string[]): void {
  const record = asRecord(value);
  if (record === null) {
    issues.push(path + " 必须是 DeliveryRef");
    return;
  }
  if (record["aggregateType"] !== "Delivery") issues.push(path + ".aggregateType 必须是 Delivery");
  checkRefScope(record, path, projectId, workspaceId, issues);
  requireString(record["deliveryId"], path + ".deliveryId", issues);
}

export function checkWaitConditionRefShape(value: unknown, path: string, projectId: string, workspaceId: string, issues: string[]): void {
  const record = asRecord(value);
  if (record === null) {
    issues.push(path + " 必须是 WaitConditionRef");
    return;
  }
  if (record["aggregateType"] !== "WaitCondition") issues.push(path + ".aggregateType 必须是 WaitCondition");
  checkRefScope(record, path, projectId, workspaceId, issues);
  requireString(record["waitId"], path + ".waitId", issues);
  // 注意：WaitConditionRef 的 canonical 形状**只有** (aggregateType, projectId, workspaceId, waitId)
  // ——见 contracts/coordination.ts 的 WaitConditionRef 与 waitConditionRefFor。这里曾多要求一个
  // workId 字段，而契约与所有生产者都不产生它，于是任何合法的 waitRef 都会被判非法（当前实现固定材料集合规则
  // 的 Dispatch 消费者第一次真正用到它时暴露）。归属 Work 一律由**canonical 快照**判定
  // （见 admitWaitSuccessor 的同名说明），ref 本身不携带、也不校验 workId。
}

export function checkRoutePageProposal(value: unknown, projectId: string, workspaceId: string, issues: string[]): void {
  const page = asRecord(value);
  if (page === null) {
    issues.push("payload.page 必须是 RoutePageProposalV1");
    return;
  }
  requireString(page["sourceTopic"], "payload.page.sourceTopic", issues);
  if (!isLedgerCursor(page["sourceCursor"])) issues.push("payload.page.sourceCursor 必须是账本游标");
  // 本页处理到的**订阅分页位置**（协议约束 1.4）：一个 canonical ref key 或 null（本页没处理订阅）。
  if (page["subscriptionPosition"] !== null && typeof page["subscriptionPosition"] !== "string") {
    issues.push("payload.page.subscriptionPosition 必须是 canonical ref key 或 null");
  }
  if (typeof page["hasMore"] !== "boolean") issues.push("payload.page.hasMore 必须是布尔值");
  /**
   * 协作通信可靠投递规则（协议约束 1.4）：本轮固定的订阅范围。
   * 必填数组；每一项是 { subscriptionRef, expectedRevision }，引用必须属于本页作用域。
   * 成员资格、版本与"范围是否与已固定的一致"在 buildRoutePage 里与 canonical 订阅逐条核对。
   */
  const scope = page["subscriptionScope"];
  if (!Array.isArray(scope)) {
    issues.push("payload.page.subscriptionScope 必须是数组（本轮固定的订阅范围）");
  } else {
    scope.forEach((entry, index) => {
      const path = "payload.page.subscriptionScope[" + String(index) + "]";
      const record = asRecord(entry);
      if (record === null) { issues.push(path + " 必须是 { subscriptionRef, expectedRevision }"); return; }
      const ref = asRecord(record["subscriptionRef"]);
      if (ref === null || ref["aggregateType"] !== "Subscription") {
        issues.push(path + ".subscriptionRef 必须是 SubscriptionRef");
      } else {
        checkRefScope(ref, path + ".subscriptionRef", projectId, workspaceId, issues);
        requireString(ref["subscriptionId"], path + ".subscriptionRef.subscriptionId", issues);
      }
      const expectedRevision = record["expectedRevision"];
      if (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 0) {
        issues.push(path + ".expectedRevision 必须是非负整数");
      }
    });
  }
  const subscriptions = page["subscriptions"];
  if (!Array.isArray(subscriptions)) {
    issues.push("payload.page.subscriptions 必须是数组");
    return;
  }
  subscriptions.forEach((entry, index) => {
    const path = "payload.page.subscriptions[" + String(index) + "]";
    const record = asRecord(entry);
    if (record === null) {
      issues.push(path + " 必须是页内订阅项");
      return;
    }
    const ref = asRecord(record["subscriptionRef"]);
    if (ref === null) {
      issues.push(path + ".subscriptionRef 必须是 SubscriptionRef");
    } else {
      if (ref["aggregateType"] !== "Subscription") issues.push(path + ".subscriptionRef.aggregateType 必须是 Subscription");
      checkRefScope(ref, path + ".subscriptionRef", projectId, workspaceId, issues);
      requireString(ref["subscriptionId"], path + ".subscriptionRef.subscriptionId", issues);
    }
    if (typeof record["expectedRevision"] !== "number" || !Number.isInteger(record["expectedRevision"])) {
      issues.push(path + ".expectedRevision 必须是整数");
    }
    const deliveries = record["deliveries"];
    if (!Array.isArray(deliveries)) issues.push(path + ".deliveries 必须是数组");
    else {
      deliveries.forEach((delivery, deliveryIndex) => {
        const deliveryPath = path + ".deliveries[" + String(deliveryIndex) + "]";
        const record2 = asRecord(delivery);
        if (record2 === null) {
          issues.push(deliveryPath + " 必须是投递项");
          return;
        }
        requireString(record2["deliveryId"], deliveryPath + ".deliveryId", issues);
        checkWorkContextRef(record2["targetWorkContextRef"], deliveryPath + ".targetWorkContextRef", projectId, workspaceId, issues);
        if (record2["bodyRef"] !== null && record2["bodyRef"] !== undefined) {
          checkArtifactRef(record2["bodyRef"], deliveryPath + ".bodyRef", issues);
        }
      });
    }
    const waits = record["satisfiedWaitIndexes"];
    if (!Array.isArray(waits)) issues.push(path + ".satisfiedWaitIndexes 必须是数组");
    else {
      waits.forEach((transition, waitIndex) => {
        const waitPath = path + ".satisfiedWaitIndexes[" + String(waitIndex) + "]";
        const record2 = asRecord(transition);
        if (record2 === null) {
          issues.push(waitPath + " 必须是等待推进项");
          return;
        }
        checkWaitConditionRefShape(record2["waitRef"], waitPath + ".waitRef", projectId, workspaceId, issues);
        if (!Array.isArray(record2["indexes"]) || !(record2["indexes"] as unknown[]).every((i) => Number.isInteger(i))) {
          issues.push(waitPath + ".indexes 必须是整数数组");
        }
      });
    }
  });
}


type AdmitRejection = Extract<AdmitWaitSuccessorReceipt, { status: "rejected" }>;
export function admitReject(
  commandId: string,
  code: AdmitRejection["code"],
  issues?: string[],
  currentRevision?: number,
): AdmitWaitSuccessorReceipt {
  return {
    status: "rejected",
    commandId,
    code,
    ...(issues === undefined ? {} : { issues }),
    ...(currentRevision === undefined ? {} : { currentRevision }),
  };
}

type EnsureAdmissionRejection = Extract<EnsureWaitAdmissionReceipt, { status: "rejected" }>;
export function ensureAdmissionReject(
  commandId: string,
  code: EnsureAdmissionRejection["code"],
  issues?: string[],
  currentRevision?: number,
): EnsureWaitAdmissionReceipt {
  return {
    status: "rejected",
    commandId,
    code,
    ...(issues === undefined ? {} : { issues }),
    ...(currentRevision === undefined ? {} : { currentRevision }),
  };
}

export function mapSettleCommitRejection(
  receipt: Extract<LedgerCommitReceipt, { status: "rejected" }>,
  commandId: string,
  intentRefKey: string,
): CommunicationSettleReceipt {
  if (receipt.code === "revision_conflict") {
    const current = (receipt.currentVersions ?? []).find((v) => canonicalJson(v.ref) === intentRefKey);
    return current === undefined
      ? { status: "rejected", commandId, code: "revision_conflict" }
      : { status: "rejected", commandId, code: "revision_conflict", currentRevision: current.revision };
  }
  if (receipt.code === "idempotency_conflict") return { status: "rejected", commandId, code: "idempotency_conflict" };
  if (receipt.code === "unavailable") return { status: "rejected", commandId, code: "unavailable" };
  return { status: "rejected", commandId, code: "invalid", issues: ["StateLedger 拒绝了提交形状（事件/快照/期望版本不一致）"] };
}

