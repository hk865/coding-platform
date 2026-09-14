/** Internal participation commit construction. Control admission remains in the command handler. */
import type { AgentInstanceRegisterCommitV1, AgentInstanceSnapshot, AgentInstanceV1, EndWorkParticipationCommand, ParticipationEndCommitV1, ParticipationStartCommitV1, RegisterAgentInstanceCommand, StartWorkParticipationCommand, WorkParticipationSnapshot, WorkParticipationV1 } from "../../../../contracts/coordination.js";
import type { WorkContextBindingSnapshot } from "../../../../contracts/context-continuity.js";
import { canonicalJson } from "../../../../contracts/fingerprint.js";
import { workParticipationRefFor, agentInstanceRegisteredEvent, participationStartEvent, participationEndEvent } from "../../../../contracts/coordination-events.js";
import type { CoordinationFoldDeps } from './shared.js';
import { ctxOf } from './shared.js';


// ------------------------------------------------------------------------ //
// AgentInstance / WorkParticipation（参与关系与换手）                                   //
// ------------------------------------------------------------------------ //

export function buildAgentInstanceRegisterCommit(
  command: RegisterAgentInstanceCommand,
  deps: CoordinationFoldDeps,
  fingerprint: AgentInstanceRegisterCommitV1["fingerprint"],
): AgentInstanceRegisterCommitV1 {
  const now = deps.now();
  const agent: AgentInstanceV1 = {
    schemaVersion: 1,
    agentInstanceId: command.aggregateId,
    projectId: command.identity.projectId,
    workspaceId: deps.workspaceId,
    templateId: command.payload.templateId,
    templateRevision: command.payload.templateRevision,
    status: "active",
    createdAt: now,
    retiredAt: null,
  };
  const snapshot: AgentInstanceSnapshot = {
    ref: { aggregateType: "AgentInstance", projectId: command.identity.projectId, workspaceId: deps.workspaceId, agentInstanceId: command.aggregateId },
    revision: 1,
    schemaVersion: 1,
    agent,
    recordedAt: now,
  };
  return {
    commitKind: "agent-instance-register",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint,
    expectedVersions: [{ ref: snapshot.ref, revision: 0 }],
    events: [agentInstanceRegisteredEvent(ctxOf(command, now), deps.eventId(), agent)],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}


export function buildParticipationStartCommit(
  command: StartWorkParticipationCommand,
  deps: CoordinationFoldDeps,
  fingerprint: ParticipationStartCommitV1["fingerprint"],
  priorBinding: import("../../../../contracts/context-continuity.js").WorkContextBindingSnapshot,
): ParticipationStartCommitV1 {
  const now = deps.now();
  const participation: WorkParticipationV1 = {
    schemaVersion: 1,
    participationId: command.aggregateId,
    workContextRef: command.payload.workContextRef,
    agentInstanceId: command.payload.agentInstanceId,
    roleBinding: { ...command.payload.roleBinding },
    status: "active",
    startedAt: now,
    endedAt: null,
  };
  const snapshot: WorkParticipationSnapshot = {
    ref: workParticipationRefFor(
      command.identity.projectId,
      deps.workspaceId,
      command.payload.workContextRef.workId,
      command.aggregateId,
    ),
    revision: 1,
    schemaVersion: 1,
    participation,
    recordedAt: now,
  };
  // 同一事务把发起 Run link 进该 Work（workId 不变，linkedRunRefs 有界追加）。
  const linked = [...priorBinding.binding.linkedRunRefs];
  if (!linked.some((r) => canonicalJson(r) === canonicalJson(command.payload.runRef))) {
    linked.push({ ...command.payload.runRef });
  }
  // 协作通信的参与身份规则：同一个提交里**同时**占用该 Work 的当前参与关系。
  // 这是 Work 权威状态上唯一会改 currentParticipationRef 的地方（见 WorkContextBindingV1），
  // 且与参与关系快照、WorkRunLinked 事件、绑定自身的 CAS 不可分割：两个并发 start 只有一个
  // 能推进这个绑定 revision，因此「当前参与关系」永远是单值、可原子读改的。
  const participationRef = snapshot.ref;
  const bindingSnapshot: import("../../../../contracts/context-continuity.js").WorkContextBindingSnapshot = {
    ...priorBinding,
    revision: priorBinding.revision + 1,
    binding: { ...priorBinding.binding, linkedRunRefs: linked, currentParticipationRef: { ...participationRef } },
  };
  const ctx = ctxOf(command, now);
  const linkEvent: import("../../../../contracts/context-continuity.js").WorkRunLinkedEvent = {
    eventId: deps.eventId(),
    eventType: "WorkRunLinked",
    schemaVersion: 1,
    projectId: priorBinding.ref.projectId,
    workspaceId: priorBinding.ref.workspaceId,
    aggregateType: "WorkContextBinding",
    aggregateId: priorBinding.ref.workId,
    aggregateRevision: bindingSnapshot.revision,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: command.identity.actor,
    occurredAt: now,
    payload: { runRef: { ...command.payload.runRef }, linkedRunRefs: linked },
  };
  return {
    commitKind: "participation-start",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint,
    expectedVersions: [
      { ref: snapshot.ref, revision: 0 },
      { ref: priorBinding.ref, revision: priorBinding.revision },
    ],
    events: [participationStartEvent(ctx, deps.eventId(), participation), linkEvent],
    snapshots: [snapshot, bindingSnapshot],
    outboxIntents: [],
  };
}


/**
 * participation-end：参与关系结束（CAS@N）。
 *
 * 历史保留、不改名、不删除：只把 status 置 `ended` 并记 endedAt。endedAt 取 prior 的
 * 既有值（**首次**结束的时间就是权威事实），因此同一段参与关系的多个结束提交不会改写它。
 * 归属不会因此改变：Request/Subscription/Wait/Delivery 的 owner 是 WorkContextBinding，
 * 参与关系结束不影响它们的 workContextRef（参与关系与换手「等待仍归 Work」）。
 */
export function buildParticipationEndCommit(input: {
  command: EndWorkParticipationCommand;
  deps: CoordinationFoldDeps;
  fingerprint: ParticipationEndCommitV1["fingerprint"];
  prior: WorkParticipationSnapshot;
}): ParticipationEndCommitV1 {
  const { command, deps, prior } = input;
  const now = deps.now();
  const participation: WorkParticipationV1 = {
    ...prior.participation,
    status: "ended",
    endedAt: prior.participation.endedAt ?? now,
  };
  // 快照 revision 必须与 expectedRevision 对齐（账本的形状规则是 revision === expected + 1）。
  // 正常路径 expectedRevision === prior.revision；「已经 ended 再结束」路径下调用方给的是
  // 落后版本，账本会先判幂等（同一命令身份 → committed/replayed）或先判 CAS 失败
  // （另一命令身份 → revision_conflict），因此这个批次永远不会被真正写入。
  const snapshot: WorkParticipationSnapshot = { ...prior, revision: command.expectedRevision + 1, participation, recordedAt: now };
  return {
    commitKind: "participation-end",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: [{ ref: prior.ref, revision: command.expectedRevision }],
    events: [participationEndEvent(ctxOf(command, now), deps.eventId(), participation, snapshot.revision)],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}
