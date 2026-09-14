/** Internal StateLedger participation rules. Both adapters invoke these inside their commit protocol. */
import type { AggregateRef, AggregateSnapshot } from '../../../contracts/ledger.js';
import { startWorkParticipationFingerprint as startWorkParticipationFingerprintForInitial } from '../../../contracts/coordination.js';
import { initialAssignmentEligible } from '../../../contracts/initial-work-assignment.js';
import { canonicalJson } from "../../../contracts/fingerprint.js";
import { isKnownEventType } from "../../../contracts/events.js";
import { WORK_CONTEXT_MAX_RUN_LINKS } from "../../../contracts/context-continuity.js";
import { identityMatchesActor } from './batch-identity.js';
import { validateCommunicationCommit } from './communication-routing.js';


/**
 * `participation-start` 的**专用**形状校验：参与关系与发起 Run 必须在同一提交中成立。
 *
 * ── 为什么不能只靠通用形状校验 + 白名单 ────────────────────────────────────────
 * 通用规则只说「事件都在白名单里、快照 revision 与 expected 对齐」，于是
 * `[WorkParticipationStarted]`、`[WorkRunLinked]`、乃至两条顺序颠倒或快照与事件不
 * 对应的组合都会被放行——那等于把「参与关系与发起 Run 在同一事务里成立」这条语义
 * 交给调用方自觉。这里照 validateQueryJobStartCommit 的复合样板，把**同一个事务里必须
 * 同时成立的两件事**逐一钉住：
 *
 *   1. 恰好两条事件，且顺序为 `[WorkParticipationStarted, WorkRunLinked]`；
 *   2. 恰好两个快照，且顺序为 `[WorkParticipationSnapshot@1, WorkContextBindingSnapshot@(expected+1)]`；
 *   3. expectedVersions 恰好是这两个 ref（participation@0、binding@priorRevision）；
 *   4. 事件与快照逐字段一致：aggregateId/aggregateRevision、payload 与快照值逐字节相同；
 *   5. **link 的 Run 必须真的落在该 Work 上**：`WorkRunLinked.payload.runRef` 必须出现在
 *      binding 快照的 `linkedRunRefs` 里，且事件里的 `linkedRunRefs` 与快照逐字节一致；
 *   6. participation 的 `workContextRef` 与 binding 快照的 ref 逐字段一致（同一个 Work），
 *      且三条记录的 projectId/workspaceId 一致；
 *   7. 两条事件的 command 身份与提交身份一致（identityMatchesActor）。
 *
 * 边界（如实）：校验只看**这次提交**的内容，因此它能证明「这条 participation-start 把
 * 某个 Run link 到了它自己的 Work 上」，但**不能**证明「该 AgentInstance 在别处没有别的
 * active participation」——那需要持久身份槽，见 contracts/coordination.ts 的边界说明。
 */
export function validateParticipationStartCommit(
  batch: import("../../../contracts/coordination.js").ParticipationStartCommitV1,
): boolean {
  try {
    // (0) **先执行通用事件校验，再执行专用校验**（协作通信参与身份裁决）：
    // validateCommunicationCommit 是协作通信提交的通用形状规则，它覆盖了专用校验
    // 表达不了、也不该由每个 commit kind 各写一遍的部分：
    //   · 每条事件的 schemaVersion === 1 与**非空 eventId**；
    //   · 事件类型在协作通信白名单内（WorkRunLinked 已在白名单里登记）；
    //   · 每条事件的 (projectId, idempotencyKey, actor) 与提交身份一致；
    //   · 每个快照的 ref.projectId 与**提交身份**一致（作用域一致）；
    //   · expectedVersions / snapshots 的 ref 不重复，且 revision 与 expected 精确对齐。
    // 专用校验只补通用规则看不到的**事务内关联**（下面 (1)-(7)），两者都必须成立；
    // 这里**不重复实现**通用规则。历史缺陷：本函数曾是唯一入口且没有复用通用校验，
    // 于是 eventId 为空、事件 schemaVersion 不是 1 的提交都能写进账本。
    if (!validateCommunicationCommit(batch)) return false;
    if (batch.outboxIntents.length !== 0) return false;
    if (batch.events.length !== 2 || batch.snapshots.length !== 2 || batch.expectedVersions.length !== 2) return false;

    const startedEvent = batch.events[0]!;
    const linkedEvent = batch.events[1]!;
    if (startedEvent.eventType !== "WorkParticipationStarted" || linkedEvent.eventType !== "WorkRunLinked") return false;
    if (!isKnownEventType(startedEvent.eventType) || !isKnownEventType(linkedEvent.eventType)) return false;
    const participationSnapshotRaw = batch.snapshots[0]!;
    const bindingSnapshotRaw = batch.snapshots[1]!;
    if (participationSnapshotRaw.ref.aggregateType !== "WorkParticipation") return false;
    if (bindingSnapshotRaw.ref.aggregateType !== "WorkContextBinding") return false;

    // 顺序已在上面钉死，这里按已声明的联合类型收窄（类型系统看不到数组下标与事件类型的关联）。
    const started = startedEvent as import("../../../contracts/coordination.js").WorkParticipationStartedEvent;
    const linked = linkedEvent as import("../../../contracts/context-continuity.js").WorkRunLinkedEvent;
    const participationSnapshot = participationSnapshotRaw as import("../../../contracts/coordination.js").WorkParticipationSnapshot;
    const bindingSnapshot = bindingSnapshotRaw as import("../../../contracts/context-continuity.js").WorkContextBindingSnapshot;

    const participation = started.payload.participation;
    const binding = bindingSnapshot.binding;
    const linkPayload = linked.payload;

    // (1)(2) 版本与形状
    if (participationSnapshot.revision !== 1 || participationSnapshot.schemaVersion !== 1) return false;
    if (bindingSnapshot.revision < 2 || bindingSnapshot.schemaVersion !== 1) return false;
    if (participation.schemaVersion !== 1) return false;
    if (participation.status !== "active" || participation.endedAt !== null) return false;

    // (3) expectedVersions 恰好对应这两个 ref
    const expectedFor = (ref: unknown) =>
      batch.expectedVersions.filter((v) => canonicalJson(v.ref as never) === canonicalJson(ref as never));
    const participationExpected = expectedFor(participationSnapshot.ref);
    const bindingExpected = expectedFor(bindingSnapshot.ref);
    if (participationExpected.length !== 1 || participationExpected[0]!.revision !== 0) return false;
    if (bindingExpected.length !== 1 || bindingExpected[0]!.revision !== bindingSnapshot.revision - 1) return false;

    // (4) 事件/快照逐字段一致
    if (started.aggregateType !== "WorkParticipation") return false;
    if (started.aggregateId !== participation.participationId) return false;
    if (started.aggregateRevision !== 1) return false;
    if (participationSnapshot.ref.participationId !== participation.participationId) return false;
    if (participationSnapshot.ref.workId !== participation.workContextRef.workId) return false;
    if (canonicalJson(participationSnapshot.participation as never) !== canonicalJson(participation as never)) return false;
    if (linked.aggregateType !== "WorkContextBinding") return false;
    if (linked.aggregateId !== binding.workId) return false;
    if (linked.aggregateRevision !== bindingSnapshot.revision) return false;

    // (5) link 的 Run 必须真的落在该 Work 上
    if (binding.linkedRunRefs.length === 0) return false;
    if (binding.linkedRunRefs.length > WORK_CONTEXT_MAX_RUN_LINKS) return false;
    if (canonicalJson(linkPayload.linkedRunRefs as never) !== canonicalJson(binding.linkedRunRefs as never)) return false;
    const linkedRunKey = canonicalJson(linkPayload.runRef as never);
    if (!binding.linkedRunRefs.some((run) => canonicalJson(run as never) === linkedRunKey)) return false;

    // (6) 同一个 Work、同一个作用域
    if (canonicalJson(participation.workContextRef as never) !== canonicalJson(bindingSnapshot.ref as never)) return false;
    if (binding.workId !== bindingSnapshot.ref.workId) return false;
    if (binding.projectId !== started.projectId || binding.workspaceId !== started.workspaceId) return false;
    if (participationSnapshot.ref.projectId !== started.projectId || bindingSnapshot.ref.projectId !== started.projectId) return false;
    if (participationSnapshot.ref.workspaceId !== started.workspaceId || bindingSnapshot.ref.workspaceId !== started.workspaceId) return false;
    // 两条事件必须声明**同一个**作用域：projectId 由 identityMatchesActor 钉在提交身份上，
    // 而 CommandIdentity 里没有 workspaceId，因此 workspaceId 只能钉在"两条事件互相同一"上。
    // 历史缺陷：这里曾漏掉 WorkRunLinked 自身的 (projectId, workspaceId)，于是"参与关系记在一处、
    // 发起 Run 的 link 记在另一处"的提交会被放行。
    if (linked.projectId !== started.projectId || linked.workspaceId !== started.workspaceId) return false;

    // (7) 身份一致
    if (!identityMatchesActor(started.projectId, started.idempotencyKey, started.actor.kind, started.actor.id, batch.identity)) return false;
    if (!identityMatchesActor(linked.projectId, linked.idempotencyKey, linked.actor.kind, linked.actor.id, batch.identity)) return false;
    return true;
  } catch {
    return false;
  }
}


export function validateInitialParticipationState(batch:import('../../../contracts/coordination.js').InitialParticipationStartCommitV1,get:(ref:AggregateRef)=>AggregateSnapshot|undefined):boolean {
  if(!initialAssignmentEligible(batch.command,get))return false;
  const old=get(batch.command.payload.workContextRef) as import('../../../contracts/context-continuity.js').WorkContextBindingSnapshot;
  const part=batch.snapshots[0] as import('../../../contracts/coordination.js').WorkParticipationSnapshot;
  const agent=get({aggregateType:'AgentInstance',projectId:old.ref.projectId,workspaceId:old.ref.workspaceId,agentInstanceId:part.participation.agentInstanceId}) as import('../../../contracts/coordination.js').AgentInstanceSnapshot|undefined;
  return agent?.agent.status==='active'&&agent.agent.templateId===batch.command.payload.roleBinding.templateId&&agent.agent.templateRevision===batch.command.payload.roleBinding.templateRevision
    &&canonicalJson(batch.snapshots[1]!)===canonicalJson({...old,revision:old.revision+1,binding:{...old.binding,currentParticipationRef:part.ref}});
}

export function validateInitialParticipationCommit(batch:import('../../../contracts/coordination.js').InitialParticipationStartCommitV1):boolean {
  try {
    const c=batch.command;
    if(!c?.payload.initialDispatchRef||c.commandType!=='StartWorkParticipation'||c.expectedRevision!==0||c.schemaVersion!==1
      ||startWorkParticipationFingerprintForInitial(c)!==batch.fingerprint||canonicalJson(c.identity)!==canonicalJson(batch.identity)
      ||!validateParticipationStartCommit({...batch,commitKind:'participation-start'}))return false;
    const part=batch.snapshots[0] as import('../../../contracts/coordination.js').WorkParticipationSnapshot;
    const link=batch.events[1] as import('../../../contracts/context-continuity.js').WorkRunLinkedEvent;
    return part.recordedAt===part.participation.startedAt&&batch.events.every(e=>e.occurredAt===part.recordedAt)
      &&c.aggregateId===part.ref.participationId&&part.ref.workspaceId===c.payload.workspaceId
      &&canonicalJson(part.participation.workContextRef)===canonicalJson(c.payload.workContextRef)
      &&part.participation.agentInstanceId===c.payload.agentInstanceId
      &&canonicalJson(part.participation.roleBinding)===canonicalJson(c.payload.roleBinding)
      &&canonicalJson(link.payload.runRef)===canonicalJson(c.payload.runRef)
      &&batch.events.every(e=>e.causationId===c.commandId&&e.correlationId===c.correlationId);
  }catch{return false;}
}
