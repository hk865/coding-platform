import type { WorkContextBindingSnapshot, WorkContextRef } from '../../../contracts/context-continuity.js';
import type {
  CommunicationWriteReceipt,
  DeliveryV1,
  DirectedRequestRef,
  DirectedRequestSnapshot,
  RespondDirectedRequestCommand,
  SendDirectedRequestCommand,
  WorkParticipationRef,
  WorkParticipationSnapshot,
} from '../../../contracts/coordination.js';
import {
  directedRequestRefFor,
  REQUEST_STATEMENT_MAX_BYTES,
  respondDirectedRequestFingerprint,
  sendDirectedRequestFingerprint,
} from '../../../contracts/coordination.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import { canonicalJson } from '../../../contracts/fingerprint.js';
import type { AggregateRef } from '../../../contracts/ledger.js';
import {
  buildDirectedRequestRespondCommit,
  buildDirectedRequestSendCommit,
  withRouteIntentPlan,
} from '../records/coordination.js';
import {
  asRecord,
  checkAgentAttribution,
  checkArtifactRef,
  checkCommandShape,
  checkParticipationRef,
  checkRunRef,
  checkWorkContextRef,
  mapCommitReceipt,
  rejectWrite,
  requireString,
  utf8Bytes,
} from './admission-support.js';
import {
  CoordinationOperationContext,
  runLinkedInBinding,
  workContextRefOfParticipation,
} from './operation-context.js';

/** Complete Control admission operations for this coordination responsibility. */
export class DirectedRequestOperations {
  constructor(private readonly context: CoordinationOperationContext) {}

  // --------------------------------------------------------------------- //
  // 3. sendDirectedRequest                                                 //
  // --------------------------------------------------------------------- //

  async sendDirectedRequest(command: SendDirectedRequestCommand): Promise<CommunicationWriteReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "SendDirectedRequest", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    const scopeWorkspace = workspaceId ?? "";
    checkParticipationRef(payload["fromParticipationRef"], "payload.fromParticipationRef", command.identity.projectId, scopeWorkspace, issues);
    checkRunRef(payload["fromRunRef"], "payload.fromRunRef", command.identity.projectId, issues);
    checkWorkContextRef(payload["toWorkContextRef"], "payload.toWorkContextRef", command.identity.projectId, scopeWorkspace, issues);
    if (payload["expectedParticipationRef"] !== null && payload["expectedParticipationRef"] !== undefined) {
      checkParticipationRef(payload["expectedParticipationRef"], "payload.expectedParticipationRef", command.identity.projectId, scopeWorkspace, issues);
    }
    const statement = requireString(payload["statement"], "payload.statement", issues);
    if (statement !== null && utf8Bytes(statement) > REQUEST_STATEMENT_MAX_BYTES) {
      issues.push("payload.statement 超过 " + String(REQUEST_STATEMENT_MAX_BYTES) + " 字节上界");
    }
    checkArtifactRef(payload["statementBodyRef"], "payload.statementBodyRef", issues);
    if (command.expectedRevision !== 0) issues.push("expectedRevision 必须是 0（请求只创建一次）");
    if (issues.length > 0) return rejectWrite(command.commandId, "invalid", issues);

    const fromParticipationRef = payload["fromParticipationRef"] as WorkParticipationRef;
    const fromRunRef = payload["fromRunRef"] as RunSnapshot["ref"];
    const toWorkContextRef = payload["toWorkContextRef"] as WorkContextRef;

    const attribution: string[] = [];
    checkAgentAttribution(
      command.identity,
      {
        agentInstanceId: command.identity.actor.kind === "agent" ? command.identity.actor.id : "",
        workContextRef: workContextRefOfParticipation(fromParticipationRef),
        participationRef: fromParticipationRef,
        runRef: fromRunRef,
        roleBinding: payload["roleBinding"],
        required: true,
      },
      attribution,
    );
    if (attribution.length > 0) return rejectWrite(command.commandId, "forbidden", attribution);

    // 引用存在 + 参与活性：发起参与必须 active，且发起 Run 确实 link 在该 Work。
    const from = await this.context.loadTyped<WorkParticipationSnapshot>(fromParticipationRef, "WorkParticipation");
    if (from === null) return rejectWrite(command.commandId, "not_found", ["发起参与关系不存在：" + fromParticipationRef.participationId]);
    if (from.participation.status !== "active") {
      return rejectWrite(command.commandId, "forbidden", ["发起参与关系不是 active：" + from.participation.status]);
    }
    const fromBinding = await this.context.loadTyped<WorkContextBindingSnapshot>(from.participation.workContextRef, "WorkContextBinding");
    if (fromBinding === null) return rejectWrite(command.commandId, "not_found", ["发起 Work 不存在：" + from.participation.workContextRef.workId]);
    if (!runLinkedInBinding(fromBinding, fromRunRef)) {
      return rejectWrite(command.commandId, "forbidden", [
        "发起 Run 没有 link 在发起 Work 上：" + fromRunRef.runId + " @ " + from.participation.workContextRef.workId,
      ]);
    }
    const fromRun = await this.context.loadTyped<RunSnapshot>(fromRunRef as AggregateRef, "Run");
    if (fromRun === null) return rejectWrite(command.commandId, "not_found", ["发起 Run 不存在：" + fromRunRef.runId]);

    // 目标 Work 必须存在且 active。
    const target = await this.context.loadTyped<WorkContextBindingSnapshot>(toWorkContextRef, "WorkContextBinding");
    if (target === null) return rejectWrite(command.commandId, "not_found", ["目标 Work 不存在：" + toWorkContextRef.workId]);
    if (target.binding.status !== "active") {
      return rejectWrite(command.commandId, "forbidden", ["目标 Work 不是 active：" + String(target.binding.status)]);
    }

    // 并发校验：expectedParticipationRef 必须仍然存在、active 且属于目标 Work；
    // 不匹配一律 stale_participation（**不**偷偷转投给「现在那边是谁」）。
    const expected = payload["expectedParticipationRef"];
    if (expected !== null && expected !== undefined) {
      const expectedRef = expected as WorkParticipationRef;
      const expectedSnapshot = await this.context.loadTyped<WorkParticipationSnapshot>(expectedRef, "WorkParticipation");
      if (expectedSnapshot === null) {
        return rejectWrite(command.commandId, "stale_participation", ["expectedParticipationRef 已不存在：" + expectedRef.participationId]);
      }
      if (expectedSnapshot.participation.status !== "active") {
        return rejectWrite(command.commandId, "stale_participation", ["expectedParticipationRef 不是 active：" + expectedSnapshot.participation.status]);
      }
      if (canonicalJson(expectedSnapshot.participation.workContextRef) !== canonicalJson(toWorkContextRef)) {
        return rejectWrite(command.commandId, "stale_participation", ["expectedParticipationRef 不属于目标 Work"]);
      }
    }

    const sourceRefs: { kind: string; refId: string; revision: string }[] = [
      { kind: "participation", refId: fromParticipationRef.participationId, revision: String(from.revision) },
      { kind: "run", refId: fromRunRef.runId, revision: String(fromRun.revision) },
      { kind: "work", refId: toWorkContextRef.workId, revision: String(target.revision) },
    ];

    // 协作通信可靠投递规则：DirectedRequestSent 是可路由源事件 → 同事务登记待路由 intent。
    const sendPlan = await this.context.routeIntentPlanFor("DirectedRequestSent", workspaceId as string, this.context.deps.now(), command.identity.projectId);
    const batch = withRouteIntentPlan(buildDirectedRequestSendCommit({
      command,
      deps: this.context.foldDeps(workspaceId as string),
      fingerprint: sendDirectedRequestFingerprint(command),
      sourceRefs,
    }), sendPlan);
    const receipt = await this.context.deps.ledger.commit(batch);
    return mapCommitReceipt(receipt, command.commandId, canonicalJson(batch.snapshots[0]!.ref));
  }


  // --------------------------------------------------------------------- //
  // 4. respondDirectedRequest                                              //
  // --------------------------------------------------------------------- //

  async respondDirectedRequest(command: RespondDirectedRequestCommand): Promise<CommunicationWriteReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "RespondDirectedRequest", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    const scopeWorkspace = workspaceId ?? "";
    checkParticipationRef(payload["respondingParticipationRef"], "payload.respondingParticipationRef", command.identity.projectId, scopeWorkspace, issues);
    checkRunRef(payload["respondingRunRef"], "payload.respondingRunRef", command.identity.projectId, issues);
    if (typeof command.expectedRevision !== "number" || !Number.isInteger(command.expectedRevision) || command.expectedRevision < 1) {
      issues.push("expectedRevision 必须是当前 DirectedRequest 的正整数 revision");
    }
    const response = asRecord(payload["response"]);
    if (response === null) {
      issues.push("payload.response 必须是 ReportMaterialV1");
    } else {
      checkArtifactRef(response["bodyRef"], "payload.response.bodyRef", issues);
      checkRunRef(response["authorRunRef"], "payload.response.authorRunRef", command.identity.projectId, issues);
      if (!Array.isArray(response["sourceRefs"])) issues.push("payload.response.sourceRefs 必须是数组");
    }
    if (issues.length > 0) return rejectWrite(command.commandId, "invalid", issues);

    const respondingParticipationRef = payload["respondingParticipationRef"] as WorkParticipationRef;
    const respondingRunRef = payload["respondingRunRef"] as RunSnapshot["ref"];
    const responseRecord = payload["response"] as {
      bodyRef: DeliveryV1["bodyRef"];
      sourceRefs: { kind: string; refId: string; revision: string }[];
      authorRunRef: RunSnapshot["ref"];
    };
    // 诚实归因：报告作者必须就是本次回应的 Run，不允许替别人署名。
    if (canonicalJson(responseRecord.authorRunRef) !== canonicalJson(respondingRunRef)) {
      return rejectWrite(command.commandId, "invalid", ["payload.response.authorRunRef 必须等于 payload.respondingRunRef"]);
    }

    const attribution: string[] = [];
    checkAgentAttribution(
      command.identity,
      {
        agentInstanceId: command.identity.actor.kind === "agent" ? command.identity.actor.id : "",
        workContextRef: workContextRefOfParticipation(respondingParticipationRef),
        participationRef: respondingParticipationRef,
        runRef: respondingRunRef,
        roleBinding: payload["roleBinding"],
        required: true,
      },
      attribution,
    );
    if (attribution.length > 0) return rejectWrite(command.commandId, "forbidden", attribution);

    // 请求必须存在且处于「可以被回应」的状态（未 cancelled/expired/closed）。
    const requestRef: DirectedRequestRef = directedRequestRefFor(
      command.identity.projectId,
      workspaceId as string,
      command.aggregateId,
    );
    const prior = await this.context.loadTyped<DirectedRequestSnapshot>(requestRef, "DirectedRequest");
    if (prior === null) return rejectWrite(command.commandId, "not_found", ["DirectedRequest 不存在：" + command.aggregateId]);
    if (prior.request.status !== "submitted" && prior.request.status !== "routed") {
      return rejectWrite(command.commandId, "forbidden", ["DirectedRequest 当前状态不可回应：" + prior.request.status]);
    }

    // 回应者必须是目标 Work 的 active 参与，且回应 Run 确实 link 在该 Work。
    const participation = await this.context.loadTyped<WorkParticipationSnapshot>(respondingParticipationRef, "WorkParticipation");
    if (participation === null) return rejectWrite(command.commandId, "not_found", ["回应参与关系不存在：" + respondingParticipationRef.participationId]);
    if (participation.participation.status !== "active") {
      return rejectWrite(command.commandId, "forbidden", ["回应参与关系不是 active：" + participation.participation.status]);
    }
    if (canonicalJson(participation.participation.workContextRef) !== canonicalJson(prior.request.toWorkContextRef)) {
      return rejectWrite(command.commandId, "forbidden", ["只有请求的目标 Work 才能回应"]);
    }
    const targetBinding = await this.context.loadTyped<WorkContextBindingSnapshot>(prior.request.toWorkContextRef, "WorkContextBinding");
    if (targetBinding === null) return rejectWrite(command.commandId, "not_found", ["目标 Work 不存在：" + prior.request.toWorkContextRef.workId]);
    if (!runLinkedInBinding(targetBinding, respondingRunRef)) {
      return rejectWrite(command.commandId, "forbidden", ["回应 Run 没有 link 在目标 Work 上：" + respondingRunRef.runId]);
    }

    // CAS 期望版本：先于 ledger 判定，给出明确的 revision_conflict 与当前版本。
    if (prior.revision !== command.expectedRevision) {
      return rejectWrite(command.commandId, "revision_conflict", undefined, prior.revision);
    }

    // 协作通信可靠投递规则：DirectedRequestResponded 是可路由源事件 → 同事务登记待路由 intent。
    const respondPlan = await this.context.routeIntentPlanFor("DirectedRequestResponded", workspaceId as string, this.context.deps.now(), command.identity.projectId);
    const batch = withRouteIntentPlan(buildDirectedRequestRespondCommit({
      command,
      deps: this.context.foldDeps(workspaceId as string),
      fingerprint: respondDirectedRequestFingerprint(command),
      prior,
    }), respondPlan);
    const receipt = await this.context.deps.ledger.commit(batch);
    return mapCommitReceipt(receipt, command.commandId, canonicalJson(requestRef));
  }
}
