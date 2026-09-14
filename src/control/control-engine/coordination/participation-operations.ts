import type { WorkContextBindingSnapshot, WorkContextRef } from '../../../contracts/context-continuity.js';
import type {
  AgentInstanceSnapshot,
  CommunicationWriteReceipt,
  EndWorkParticipationCommand,
  RegisterAgentInstanceCommand,
  StartWorkParticipationCommand,
  WorkParticipationSnapshot,
} from '../../../contracts/coordination.js';
import {
  agentInstanceRefFor,
  endWorkParticipationFingerprint,
  registerAgentInstanceFingerprint,
  startWorkParticipationFingerprint,
  workParticipationRefFor,
} from '../../../contracts/coordination.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import { canonicalJson } from '../../../contracts/fingerprint.js';
import { initialAssignmentEligible } from '../../../contracts/initial-work-assignment.js';
import type { AggregateRef, AggregateSnapshot, WorkspaceRef } from '../../../contracts/ledger.js';
import {
  buildAgentInstanceRegisterCommit,
  buildParticipationEndCommit,
  buildParticipationStartCommit,
  withRouteIntentPlan,
} from '../records/coordination.js';
import {
  checkAgentAttribution,
  checkCommandShape,
  checkRunRef,
  checkWorkContextRef,
  mapCommitReceipt,
  rejectWrite,
  requireString,
} from './admission-support.js';
import { CoordinationOperationContext, runLinkedInBinding } from './operation-context.js';

/** Complete Control admission operations for this coordination responsibility. */
export class ParticipationOperations {
  constructor(private readonly context: CoordinationOperationContext) {}

  // --------------------------------------------------------------------- //
  // 1. registerAgentInstance（CAS@0）                                      //
  // --------------------------------------------------------------------- //

  async registerAgentInstance(command: RegisterAgentInstanceCommand): Promise<CommunicationWriteReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "RegisterAgentInstance", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    requireString(payload["templateId"], "payload.templateId", issues);
    requireString(payload["templateRevision"], "payload.templateRevision", issues);
    if (command.expectedRevision !== 0) issues.push("expectedRevision 必须是 0（AgentInstance 只创建一次）");
    if (issues.length > 0) return rejectWrite(command.commandId, "invalid", issues);

    // 归因：注册 AgentInstance 的命令只能是 agent 自己发的（不新增 human/system 旁路）。
    if (command.identity.actor.kind !== "agent") {
      return rejectWrite(command.commandId, "forbidden", ["RegisterAgentInstance 必须由 agent 身份提交"]);
    }
    if (command.identity.actor.id !== command.aggregateId) {
      return rejectWrite(command.commandId, "invalid", ["actor.id 必须是本次注册的 AgentInstance id"]);
    }

    const workspaceRef: WorkspaceRef = {
      aggregateType: "Workspace",
      projectId: command.identity.projectId,
      workspaceId: workspaceId as string,
    };
    if ((await this.context.deps.ledger.load(workspaceRef)).status !== "found") {
      return rejectWrite(command.commandId, "not_found", ["工作区不存在：" + String(workspaceId)]);
    }

    const batch = buildAgentInstanceRegisterCommit(
      command,
      this.context.foldDeps(workspaceId as string),
      registerAgentInstanceFingerprint(command),
    );
    const receipt = await this.context.deps.ledger.commit(batch);
    return mapCommitReceipt(receipt, command.commandId, canonicalJson(batch.snapshots[0]!.ref));
  }


  // --------------------------------------------------------------------- //
  // 2. startWorkParticipation（CAS@0 + 同事务 link 发起 Run）                //
  // --------------------------------------------------------------------- //

  async startWorkParticipation(command: StartWorkParticipationCommand): Promise<CommunicationWriteReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "StartWorkParticipation", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    const agentInstanceId = requireString(payload["agentInstanceId"], "payload.agentInstanceId", issues);
    const scopeWorkspace = workspaceId ?? "";
    checkWorkContextRef(payload["workContextRef"], "payload.workContextRef", command.identity.projectId, scopeWorkspace, issues);
    checkRunRef(payload["runRef"], "payload.runRef", command.identity.projectId, issues);
    if (command.expectedRevision !== 0) issues.push("expectedRevision 必须是 0（参与关系只创建一次）");
    if (issues.length > 0) return rejectWrite(command.commandId, "invalid", issues);

    const workContextRef = payload["workContextRef"] as WorkContextRef;
    const runRef = payload["runRef"] as RunSnapshot["ref"];
    const roleBinding = payload["roleBinding"];

    // 归因（principal 与 payload 逐字段一致；刚创建时 principal.participationRef 就是本次 id）。
    const attribution: string[] = [];
    checkAgentAttribution(
      command.identity,
      {
        agentInstanceId: agentInstanceId as string,
        workContextRef,
        participationRef: workParticipationRefFor(
          command.identity.projectId,
          workspaceId as string,
          workContextRef.workId,
          command.aggregateId,
        ),
        runRef,
        roleBinding,
        required: false,
      },
      attribution,
    );
    if (attribution.length > 0) return rejectWrite(command.commandId, "forbidden", attribution);

    // 引用存在：AgentInstance + WorkContextBinding + 发起 Run。
    const agent = await this.context.loadTyped<AgentInstanceSnapshot>(
      agentInstanceRefFor(command.identity.projectId, workspaceId as string, agentInstanceId as string),
      "AgentInstance",
    );
    if (agent === null) return rejectWrite(command.commandId, "not_found", ["AgentInstance 不存在：" + String(agentInstanceId)]);
    if (agent.agent.status !== "active") {
      return rejectWrite(command.commandId, "forbidden", ["AgentInstance 不是 active：" + agent.agent.status]);
    }
    const binding = await this.context.loadTyped<WorkContextBindingSnapshot>(workContextRef, "WorkContextBinding");
    if (binding === null) return rejectWrite(command.commandId, "not_found", ["WorkContextBinding 不存在：" + workContextRef.workId]);
    if (binding.binding.status !== "active") {
      return rejectWrite(command.commandId, "forbidden", ["WorkContextBinding 不是 active：" + String(binding.binding.status)]);
    }
    if ((await this.context.deps.ledger.load(runRef as AggregateRef)).status !== "found") {
      return rejectWrite(command.commandId, "not_found", ["发起 Run 不存在：" + runRef.runId]);
    }

    // ── 唯一性：先查后写（可读原因）＋ 账本提交语义（跨进程的唯一判定点）──────────────
    // 协作通信的参与身份规则：不变式是「同一 AgentInstance 在同一 (project, workspace) 至多一段
    // active 参与」，并且该 Work 的「当前参与关系」是单值。这里能读到的只有 Work 权威状态
    // （currentParticipationRef），它覆盖「同一 Work 上已有一段 active 参与」——换手必须先结束
    // 旧段。跨 Work／跨进程的那一半**只能**由账本在同一事务里判定并占用该 AgentInstance 的
    // 参与身份槽（participationIdentityClaim），所以这条守卫只负责给出可读原因，不作为保证。
    const currentRef = binding.binding.currentParticipationRef ?? null;
    if (currentRef !== null && currentRef.participationId !== command.aggregateId) {
      const currentParticipation = await this.context.loadTyped<WorkParticipationSnapshot>(currentRef, "WorkParticipation");
      if (currentParticipation !== null && currentParticipation.participation.status === "active") {
        return rejectWrite(command.commandId, "forbidden", [
          "该 Work 上已经有一段 active 参与关系（当前参与者：" +
          currentParticipation.participation.agentInstanceId + "，participation=" + currentRef.participationId +
          "）：换手必须先 endWorkParticipation 结束旧的一段，再建立新的参与关系",
        ]);
      }
    }

    const batch = buildParticipationStartCommit(
      command,
      this.context.foldDeps(workspaceId as string),
      startWorkParticipationFingerprint(command),
      binding,
    );
    if(command.payload.initialDispatchRef){
      const source=await this.context.deps.ledger.load(command.payload.initialDispatchRef);
      const run=await this.context.deps.ledger.load(runRef);
      const existing=await this.context.deps.ledger.load(batch.snapshots[0]!.ref);
      if(existing.status!=='found'){
        const cache=new Map<string,AggregateSnapshot>([[canonicalJson(binding.ref),binding]]);
        if(source.status==='found')cache.set(canonicalJson(source.snapshot.ref),source.snapshot);
        if(run.status==='found')cache.set(canonicalJson(run.snapshot.ref),run.snapshot);
        if(!initialAssignmentEligible(command,ref=>cache.get(canonicalJson(ref))))return rejectWrite(command.commandId,'forbidden',['Initial assignment requires the untouched Work and its sole authorized pending Run']);
      }
    }
    const receipt = await this.context.deps.ledger.commit(command.payload.initialDispatchRef?{...batch,commitKind:'initial-participation-start',command}:batch);
    // 账本用**同一个事务**判定并占用该 (project, workspace, agentInstanceId) 的参与身份槽：
    // 已被别的参与关系占用时它只回 revision_conflict（看不到具体原因），因此这里补一句可读的
    // 归因，但不改变零写入与拒绝语义。
    const mapped = mapCommitReceipt(receipt, command.commandId, canonicalJson(batch.snapshots[0]!.ref));
    if (mapped.status === "rejected" && mapped.code === "revision_conflict") {
      return {
        ...mapped,
        issues: [
          "参与身份槽可能已被该 AgentInstance 在本 (project, workspace) 的另一段 active 参与占用" +
          "（唯一性由账本在提交事务里判定，跨进程同样成立）；换手必须先在原参与关系上 endWorkParticipation",
        ],
      };
    }
    return mapped;
  }


  // --------------------------------------------------------------------- //
  // 2b. endWorkParticipation（参与关系与换手：同一 Work 换参与者；CAS@N）                 //
  // --------------------------------------------------------------------- //

  /**
   * 结束一段参与关系。为什么必须有这条路径：WorkParticipation 是**一段时间**上的参与，
   * 换手（旧的一段结束、同一 Work 上开始新的一段）必须能被表达，否则「等待/请求归 Work
   * 而不是归某个参与者」在账本里没有可证的迁移路径。结束**不**触碰任何
   * Request/Subscription/Wait/Delivery：它们的 owner 是 WorkContextBinding。
   *
   * 「已经 ended 再结束一次」的语义（参与身份裁决要求明确选一个，并在测试里断言）：
   *   - `expectedRevision >= 当前 revision` → `revision_conflict`（零写入）；
   *   - `expectedRevision < 当前 revision` → **交给账本判定**：StateLedger 在 CAS 之前先判
   *     幂等，因此同一命令身份+指纹的重复提交返回 committed(replayed=true)（不再写事件），
   *     另一个命令身份则必然 CAS 失败 → revision_conflict（零写入）。
   * 这样重复结束既不会产生第二条 ended 事实，也不会把幂等重放误报成冲突。
   */
  async endWorkParticipation(command: EndWorkParticipationCommand): Promise<CommunicationWriteReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "EndWorkParticipation", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    const scopeWorkspace = workspaceId ?? "";
    checkWorkContextRef(payload["workContextRef"], "payload.workContextRef", command.identity.projectId, scopeWorkspace, issues);
    checkRunRef(payload["runRef"], "payload.runRef", command.identity.projectId, issues);
    requireString(payload["reason"], "payload.reason", issues);
    if (typeof command.expectedRevision !== "number" || !Number.isInteger(command.expectedRevision) || command.expectedRevision < 1) {
      issues.push("expectedRevision 必须是当前 WorkParticipation 的正整数 revision");
    }
    if (issues.length > 0) return rejectWrite(command.commandId, "invalid", issues);

    const projectId = command.identity.projectId;
    const workContextRef = payload["workContextRef"] as WorkContextRef;
    const runRef = payload["runRef"] as RunSnapshot["ref"];
    const participationRef = workParticipationRefFor(projectId, scopeWorkspace, workContextRef.workId, command.aggregateId);

    const attribution: string[] = [];
    checkAgentAttribution(
      command.identity,
      {
        agentInstanceId: command.identity.actor.kind === "agent" ? command.identity.actor.id : "",
        workContextRef,
        participationRef,
        runRef,
        required: true,
      },
      attribution,
    );
    if (attribution.length > 0) return rejectWrite(command.commandId, "forbidden", attribution);

    const prior = await this.context.loadTyped<WorkParticipationSnapshot>(participationRef, "WorkParticipation");
    if (prior === null) {
      return rejectWrite(command.commandId, "not_found", ["参与关系不存在：" + participationRef.participationId]);
    }
    if (canonicalJson(prior.participation.workContextRef) !== canonicalJson(workContextRef)) {
      return rejectWrite(command.commandId, "invalid", ["payload.workContextRef 与该参与关系的 Work 不一致"]);
    }
    // 收尾 Run 必须是该 Work 上的 Run（授权 + 归因都可核对）。
    const binding = await this.context.loadTyped<WorkContextBindingSnapshot>(workContextRef, "WorkContextBinding");
    if (binding === null) return rejectWrite(command.commandId, "not_found", ["WorkContextBinding 不存在：" + workContextRef.workId]);
    if (!runLinkedInBinding(binding, runRef)) {
      return rejectWrite(command.commandId, "forbidden", ["收尾 Run 没有 link 在该 Work 上：" + runRef.runId]);
    }

    if (prior.participation.status === "ended") {
      if (command.expectedRevision >= prior.revision) {
        return rejectWrite(command.commandId, "revision_conflict", ["参与关系已经 ended，不能再次结束"], prior.revision);
      }
      // expectedRevision 落后于当前 revision：可能是同一命令身份的幂等重放，交给账本判定。
    } else if (prior.revision !== command.expectedRevision) {
      return rejectWrite(command.commandId, "revision_conflict", undefined, prior.revision);
    }

    // 协作通信可靠投递规则：WorkParticipationEnded 是**可路由源事件**。这次提交在同一个事务里
    // 登记它触发的待路由 intent（位置由账本按该事件落点算出），因此不存在"事件已落账但没人
    // 能发现它"的窗口——重启后 Dispatch 照样读得到这条 intent。
    const endPlan = await this.context.routeIntentPlanFor("WorkParticipationEnded", scopeWorkspace, this.context.deps.now(), command.identity.projectId);
    const batch = withRouteIntentPlan(buildParticipationEndCommit({
      command,
      deps: this.context.foldDeps(scopeWorkspace),
      fingerprint: endWorkParticipationFingerprint(command),
      prior,
    }), endPlan);
    const receipt = await this.context.deps.ledger.commit(batch);
    return mapCommitReceipt(receipt, command.commandId, canonicalJson(participationRef));
  }
}
