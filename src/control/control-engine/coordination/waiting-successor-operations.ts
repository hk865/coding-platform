import { qualifiedAlternativeReport } from '../../../contracts/alternative-report.js';
import { architectureDeliveryApplies,architectureDeliverySetMatches } from "../../../contracts/architecture-review-values.js";
import type { WorkContextBindingSnapshot,WorkContextRef } from "../../../contracts/context-continuity.js";
import type {
AdmitWaitSuccessorCommand,
AdmitWaitSuccessorReceipt,
CommunicationIntentSnapshot,
CommunicationWriteReceipt,
DeliveryRef,
DeliverySnapshot,
DirectedRequestSnapshot,
EnsureWaitAdmissionCommand,
EnsureWaitAdmissionReceipt,
RegisterWaitCommand,
WaitConditionRef,
WaitConditionSnapshot,
WorkParticipationRef,
WorkParticipationSnapshot
} from "../../../contracts/coordination.js";
import {
admitWaitSuccessorFingerprint,
ensureWaitAdmissionFingerprint,
registerWaitFingerprint,
WAIT_MAX_CONDITIONS,
waitAdmissionIntentIdFor,
waitConditionRefFor
} from "../../../contracts/coordination.js";
import type { RoleBindingRefV1,RunSnapshot,SourceRefV1 } from "../../../contracts/dispatch.js";
import { canonicalJson } from "../../../contracts/fingerprint.js";
import type { AggregateRef,VersionedRef } from "../../../contracts/ledger.js";
import type { PlanRevisionRef } from "../../../contracts/plan.js";
import { projectRoleSpecActiveRefFor,type ProjectRoleSpecActiveSnapshot,type RoleSpecRevisionRef,type RoleSpecRevisionSnapshot } from "../../../contracts/role-spec.js";
import type { ContextManifestV1,MaterialGapV1 } from "../../../contracts/task-envelope.js";
import type { ValidationIssue } from "../../../contracts/validation/common.js";
import { validateDeclaredPermissions } from "../../../contracts/validation/dispatch.js";
import { resolveActiveCoordinationPolicy } from "../policies/coordination-policy.js";
import {
evaluateSuccessorEligibility,
evaluateWaitConditions,
type WaitConditionFacts
} from "../policies/coordination-rules.js";
import { evaluateRoleBindingAdmission } from "../policies/role-binding-admission.js";
import {
buildIntentRecordCommit,
buildSuccessorCommit,
buildWaitRegisterCommit,
communicationIntentRefForOf,
successorIdsFor,
waitAdmissionIntentFor,
waitDeadlineIntentFor,
withRouteIntentPlan
} from "../records/coordination.js";
import {
admitReject,
checkAgentAttribution,
checkCommandShape,
checkDeliveryRefShape,
checkParticipationRef,
checkRunRef,
checkSchedulerAttribution,
checkWaitConditionRefShape,
checkWaitTerm,
checkWorkContextRef,
ensureAdmissionReject,
mapCommitReceipt,
rejectWrite,
requireString
} from "./admission-support.js";
import { CoordinationOperationContext,isTerminalIntentStatus,runLinkedInBinding } from './operation-context.js';

/** Complete Control admission operations for this coordination responsibility. */
export class WaitingSuccessorOperations {
  constructor(private readonly context: CoordinationOperationContext) {}

  // --------------------------------------------------------------------- //
  // 6. registerWait（deadline 非空时同事务建立 wait_deadline intent）        //
  // --------------------------------------------------------------------- //

  async registerWait(command: RegisterWaitCommand): Promise<CommunicationWriteReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "RegisterWait", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    const scopeWorkspace = workspaceId ?? "";
    checkWorkContextRef(payload["ownerWorkContextRef"], "payload.ownerWorkContextRef", command.identity.projectId, scopeWorkspace, issues);
    checkParticipationRef(payload["ownerParticipationRef"], "payload.ownerParticipationRef", command.identity.projectId, scopeWorkspace, issues);
    checkRunRef(payload["predecessorRunRef"], "payload.predecessorRunRef", command.identity.projectId, issues);
    if (command.expectedRevision !== 0) issues.push("expectedRevision 必须是 0（等待只注册一次）");
    const conditions = payload["conditions"];
    const mode = payload['mode'] === undefined ? 'all' : payload['mode'];
    if (mode !== 'all' && mode !== 'any') issues.push('payload.mode must be all or any');
    if (mode === 'any' && Array.isArray(conditions) && conditions.some(term => (term as { kind?: string })?.kind === 'request_closed')) {
      issues.push('any waits require optional reports; request closure is not a report');
    }
    if (!Array.isArray(conditions) || conditions.length === 0) {
      issues.push("payload.conditions 至少要有 1 条条件");
    } else if (conditions.length > WAIT_MAX_CONDITIONS) {
      issues.push("payload.conditions 超过上界 " + String(WAIT_MAX_CONDITIONS));
    } else {
      conditions.forEach((term, index) => checkWaitTerm(term, "payload.conditions[" + String(index) + "]", command.identity.projectId, scopeWorkspace, issues));
    }
    const deadlineAt = payload["deadlineAt"];
    if (deadlineAt !== null && deadlineAt !== undefined) {
      if (typeof deadlineAt !== "string" || Number.isNaN(Date.parse(deadlineAt))) {
        issues.push("payload.deadlineAt 必须是可解析的时间戳或 null");
      }
    }
    if (issues.length > 0) {
      const count = Array.isArray(conditions) ? conditions.length : 0;
      return rejectWrite(command.commandId, count > WAIT_MAX_CONDITIONS ? "over_limit" : "invalid", issues);
    }

    const ownerWorkContextRef = payload["ownerWorkContextRef"] as WorkContextRef;
    const ownerParticipationRef = payload["ownerParticipationRef"] as WorkParticipationRef;
    const predecessorRunRef = payload["predecessorRunRef"] as RunSnapshot["ref"];

    const attribution: string[] = [];
    checkAgentAttribution(
      command.identity,
      {
        agentInstanceId: command.identity.actor.kind === "agent" ? command.identity.actor.id : "",
        workContextRef: ownerWorkContextRef,
        participationRef: ownerParticipationRef,
        runRef: predecessorRunRef,
        required: true,
      },
      attribution,
    );
    if (attribution.length > 0) return rejectWrite(command.commandId, "forbidden", attribution);

    const participation = await this.context.loadTyped<WorkParticipationSnapshot>(ownerParticipationRef, "WorkParticipation");
    if (participation === null) return rejectWrite(command.commandId, "not_found", ["owner participation 不存在：" + ownerParticipationRef.participationId]);
    if (participation.participation.status !== "active") {
      return rejectWrite(command.commandId, "forbidden", ["owner participation 不是 active：" + participation.participation.status]);
    }
    if (canonicalJson(participation.participation.workContextRef) !== canonicalJson(ownerWorkContextRef)) {
      return rejectWrite(command.commandId, "forbidden", ["owner participation 不属于 owner Work"]);
    }
    const ownerBinding = await this.context.loadTyped<WorkContextBindingSnapshot>(ownerWorkContextRef, "WorkContextBinding");
    if (ownerBinding === null) return rejectWrite(command.commandId, "not_found", ["owner Work 不存在：" + ownerWorkContextRef.workId]);
    const predecessor = await this.context.loadTyped<RunSnapshot>(predecessorRunRef as AggregateRef, "Run");
    if (predecessor === null) return rejectWrite(command.commandId, "not_found", ["前驱 Run 不存在：" + predecessorRunRef.runId]);
    if (!runLinkedInBinding(ownerBinding, predecessorRunRef)) {
      return rejectWrite(command.commandId, "forbidden", ["前驱 Run 没有 link 在 owner Work 上：" + predecessorRunRef.runId]);
    }

    const foldDeps = this.context.foldDeps(workspaceId as string);
    const batch = buildWaitRegisterCommit({
      command,
      deps: foldDeps,
      fingerprint: registerWaitFingerprint(command),
      intent: waitDeadlineIntentFor(command, foldDeps),
    });
    const receipt = await this.context.deps.ledger.commit(batch);
    return mapCommitReceipt(receipt, command.commandId, canonicalJson(batch.snapshots[0]!.ref));
  }


  // --------------------------------------------------------------------- //
  // 9b. 协议约束 2.2：本次实际采用的权限集（只许收窄）                          //
  // --------------------------------------------------------------------- //

  /**
   * 后继受理**实际采用**的权限集：前驱 Run 信封声明的权限 ∩ 当前参与关系 RoleBinding 的规格上界。
   *
   * 三条分支（确定性，不看运气；口径来自协议约束 2.2 的裁决原文）：
   *   1. 项目**没有**生效的角色矩阵（matrix === null）→ 既有策略在这一分支返回 spec=null，
   *      表示**未校验、不等于已授权**。此时**保持前驱 declaredPermissions 原值**。
   *      这条分支如实回 basis="no_matrix"：绝不把「没有上界」当成「交集为空」而把权限收成空集，
   *      也不假装它已经被授权过。
   *   2. 有矩阵且**规格可受理** → tools = 前驱 tools ∩ spec.permissions.tools；writeScope：
   *      规格为 none 即**空数组**（只读角色不得再写），否则**保留前驱 writeScope 原值**。
   *      交集与前驱相同时回 basis="within_spec"，确实收掉了东西时回 basis="narrowed"。
   *   3. 交集为空集 → 拒绝（basis 不适用）。
   *
   * 一律拒绝（零写入、等待保留、给出可读原因）的情形：
   *   - 绑定本身不合格（角色未登记／revision 过期／规格未安装／未激活）：新参与者没有合格授权，
   *     不能退回旧关系（2.2），也不是「收窄」能解决的问题；
   *   - 收窄结果为空集（既没有工具也没有写范围）：没有可执行的授权；
   *   - 收窄结果仍不通过策略（口径分叉，宁可停）。
   */
  private async effectiveSuccessorPermissions(input: {
    projectId: string;
    roleBinding: RoleBindingRefV1;
    inherited: { tools: string[]; writeScope: string[] };
    guards?: VersionedRef[];
  }): Promise<
    | { status: "ok"; permissions: { tools: string[]; writeScope: string[] }; basis: "no_matrix" | "within_spec" | "narrowed" }
    | { status: "rejected"; issues: string[] }
  > {
    const copy = (value: { tools: string[]; writeScope: string[] }) => ({
      tools: [...value.tools],
      writeScope: [...value.writeScope],
    });
    const reads: Pick<import('../../../contracts/ledger.js').StateLedger, 'load'> = { load: async ref => {
      const loaded = await this.context.deps.ledger.load(ref);
      if (input.guards) {
        if (loaded.status !== 'found' && loaded.status !== 'not_found') throw Error('Report permission basis unavailable');
        input.guards.push({ ref, revision: loaded.status === 'found' ? loaded.snapshot.revision : 0 });
      }
      return loaded;
    } };
    const policy = await resolveActiveCoordinationPolicy(reads, input.projectId);
    const matrix = policy?.content.roles ?? null;
    if (matrix === null) return { status: "ok", permissions: copy(input.inherited), basis: "no_matrix" };

    const roleId = input.roleBinding.templateId;
    const pin = Object.prototype.hasOwnProperty.call(matrix.catalog, roleId) ? matrix.catalog[roleId] : undefined;
    let pinnedSpec: RoleSpecRevisionSnapshot | null = null;
    let activeRevision: RoleSpecRevisionRef | null = null;
    if (pin !== undefined) {
      const installed = await reads.load(pin.ref);
      if (installed.status === "found" && installed.snapshot.ref.aggregateType === "RoleSpecRevision") {
        pinnedSpec = installed.snapshot as RoleSpecRevisionSnapshot;
      }
      const active = await reads.load(projectRoleSpecActiveRefFor(input.projectId, roleId));
      if (active.status === "found" && active.snapshot.ref.aggregateType === "ProjectRoleSpecActive") {
        activeRevision = (active.snapshot as ProjectRoleSpecActiveSnapshot).activeRevision;
      }
    }
    const facts = {
      roleBinding: input.roleBinding,
      declaredPermissions: copy(input.inherited),
      matrix,
      pinnedSpec,
      activeRevision,
    };
    // 「有矩阵且**规格可受理**」：按既有策略判定绑定本身（角色在册 / revision 与 pin 一致 /
    // 规格已安装且摘要一致 / 生效引用等于 pin）。探针带的声明权限取**规格自己的上界**
    // —— 与同文件 evaluateRoleSpecPinReadiness 的手法完全相同 —— 这样这次判定只回答
    // 「这份规格可不受理」，不被前驱权限集干扰；策略在可受理时会把规格正文（授权上界）返回，
    // 我们因此不需要另读一份规格，也不猜上界。
    const probe = pinnedSpec === null
      ? { tools: [] as string[], writeScope: [] as string[] }
      : {
          tools: [...pinnedSpec.content.permissions.tools],
          writeScope: pinnedSpec.content.permissions.writeScope === "none" ? [] : ["workspace"],
        };
    const admitted = evaluateRoleBindingAdmission({ ...facts, declaredPermissions: probe });
    if (!admitted.admissible) {
      return {
        status: "rejected",
        issues: [
          "当前参与关系的角色绑定不满足既有准入策略：" + admitted.reasons.map((reason) => reason.message).join("; ") +
          "；新参与者没有合格授权，不退回旧关系、也不放宽权限，本次不产生后继（等待保持 active）",
        ],
      };
    }
    const upper = admitted.spec?.permissions ?? null;
    if (upper === null) {
      return { status: "rejected", issues: ["角色绑定的规格上界不可读（策略判定可受理却拿不到规格）：本次不产生后继"] };
    }
    // 裁决口径：tools 取前驱 ∩ 规格上界；writeScope 按类别 —— 只读规格收成空，否则保留前驱原值
    // （前驱写范围是既有事实，必然落在已授权的工作区范围内；这里不发明新的路径映射）。
    //
    // 判据只有一份：**策略只回答「是否越界」（布尔）**，交集的算术在 Control 侧完成；
    // 因此算术的结果**必须重新通过同一个策略**才算数（见下面的 verify）——口径分叉就零写拒绝。
    const narrowed = {
      tools: input.inherited.tools.filter((tool) => upper.tools.includes(tool)),
      writeScope: upper.writeScope === "none" ? [] : [...input.inherited.writeScope],
    };
    // 用**同一个策略**复核收窄结果：口径若分叉就停（零写拒绝），不让两套判据并存。
    const verify = evaluateRoleBindingAdmission({ ...facts, declaredPermissions: { ...narrowed } });
    if (!verify.admissible) {
      return { status: "rejected", issues: ["收窄后的权限集仍未通过既有准入策略：" + verify.reasons.map((reason) => reason.message).join("; ")] };
    }
    // 无可用授权（裁决）：交集后的**工具为 0 项**即视为没有可执行的授权 —— 无论写范围是否还留着。
    // 写范围脱离工具没有意义，而「留着一个没有任何工具的写范围」在事后复核里会被读成「仍有写权限」，
    // 因此不保留这种模糊状态：零写拒绝 + 等待保留 + 明确原因。
    if (narrowed.tools.length === 0) {
      return {
        status: "rejected",
        issues: [
          "前驱权限集与当前 RoleBinding 规格上界的交集中**工具为 0 项**（写范围=" +
          (narrowed.writeScope.length === 0 ? "空" : narrowed.writeScope.join(",")) +
          "）：没有可执行的授权，等待保持 active，本次不产生后继（不退回旧关系、不临时放宽）",
        ],
      };
    }
    const unchanged = canonicalJson(narrowed as never) === canonicalJson(input.inherited as never);
    return { status: "ok", permissions: narrowed, basis: unchanged ? "within_spec" : "narrowed" };
  }


  // --------------------------------------------------------------------- //
  // 10. admitWaitSuccessor（唯一后继；零写入 not_ready）                      //
  // --------------------------------------------------------------------- //

  async admitWaitSuccessor(command: AdmitWaitSuccessorCommand): Promise<AdmitWaitSuccessorReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "AdmitWaitSuccessor", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    const scopeWorkspace = workspaceId ?? "";
    const workContextRef = payload["workContextRef"] as WorkContextRef;
    checkWorkContextRef(payload["workContextRef"], "payload.workContextRef", command.identity.projectId, scopeWorkspace, issues);
    checkWaitConditionRefShape(payload["waitRef"], "payload.waitRef", command.identity.projectId, scopeWorkspace, issues);
    checkParticipationRef(payload["participationRef"], "payload.participationRef", command.identity.projectId, scopeWorkspace, issues);
    requireString(payload["agentInstanceId"], "payload.agentInstanceId", issues);
    checkRunRef(payload["predecessorRunRef"], "payload.predecessorRunRef", command.identity.projectId, issues);
    requireString(payload["goalId"], "payload.goalId", issues);
    requireString(payload["taskId"], "payload.taskId", issues);
    requireString(payload["attemptId"], "payload.attemptId", issues);
    requireString(payload["runId"], "payload.runId", issues);
    if (typeof payload["workspaceRevision"] !== "number" || !Number.isInteger(payload["workspaceRevision"])) {
      issues.push("payload.workspaceRevision 必须是整数");
    }
    if (!Array.isArray(payload["deliveryRefs"])) issues.push("payload.deliveryRefs 必须是数组");
    else {
      (payload["deliveryRefs"] as unknown[]).forEach((ref, index) =>
        checkDeliveryRefShape(ref, "payload.deliveryRefs[" + String(index) + "]", command.identity.projectId, scopeWorkspace, issues));
    }
    // 协议约束 2.2 的输入：继承来的权限集必须有合法形状，否则一律 invalid（零写入）。
    // 复用既有的形状校验（dispatch 契约里那一份，与 validateActor 同一调用手法），不另立一套。
    const permissionIssues: ValidationIssue[] = [];
    validateDeclaredPermissions(payload["declaredPermissions"], "payload.declaredPermissions", permissionIssues);
    for (const issue of permissionIssues) issues.push(issue.message);
    if (typeof command.expectedRevision !== "number" || !Number.isInteger(command.expectedRevision) || command.expectedRevision < 1) {
      issues.push("expectedRevision 必须是当前 WaitCondition 的正整数 revision");
    }
    if (issues.length > 0) {
      return admitReject(command.commandId, "invalid", issues);
    }

    const projectId = command.identity.projectId;
    const waitRef = payload["waitRef"] as WaitConditionRef;
    const participationRef = payload["participationRef"] as WorkParticipationRef;
    const predecessorRunRef = payload["predecessorRunRef"] as RunSnapshot["ref"];
    const goalId = payload["goalId"] as string;
    const taskId = payload["taskId"] as string;

    // WaitConditionRef 只带 (projectId, workspaceId, waitId)：归属 Work 由 canonical 快照判定
    // （下面的 ownerWorkContextRef 复核），这里只核对引用自身的范围。
    if (canonicalJson(waitRef) !== canonicalJson(waitConditionRefFor(projectId, scopeWorkspace, waitRef.waitId))) {
      return admitReject(command.commandId, "invalid", ["payload.waitRef 的 projectId/workspaceId 必须与 workspaceId 一致"]);
    }

    // 归因（参与身份规则）：这是**调度触发**命令 —— system 身份 + 来源关联，不接受 agent
    // principal（那会把新参与者与旧 Run 拼成一个身份，见 checkSchedulerAttribution）。
    const attribution: string[] = [];
    checkSchedulerAttribution(command.identity, command.correlationId, { sourceId: waitRef.waitId }, attribution);
    if (attribution.length > 0) return admitReject(command.commandId, "forbidden", attribution);

    const wait = await this.context.loadTyped<WaitConditionSnapshot>(waitRef, "WaitCondition");
    if (wait === null) return admitReject(command.commandId, "not_found", ["WaitCondition 不存在：" + waitRef.waitId]);
    if (wait.revision !== command.expectedRevision) {
      return admitReject(command.commandId, "revision_conflict", ["WaitCondition 当前 revision 与 expectedRevision 不一致"], wait.revision);
    }
    if (canonicalJson(wait.wait.ownerWorkContextRef) !== canonicalJson(workContextRef)) {
      return admitReject(command.commandId, "invalid", ["wait 的 owner Work 与 payload.workContextRef 不一致"]);
    }
    if (canonicalJson(wait.wait.predecessorRunRef) !== canonicalJson(predecessorRunRef)) {
      return admitReject(command.commandId, "invalid", ["payload.predecessorRunRef 与 wait 登记的前驱不一致"]);
    }
    const binding = await this.context.loadTyped<WorkContextBindingSnapshot>(workContextRef, "WorkContextBinding");
    if (binding === null) return admitReject(command.commandId, "not_found", ["WorkContextBinding 不存在：" + workContextRef.workId]);
    if (binding.binding.goalId !== null && binding.binding.goalId !== goalId) {
      return admitReject(command.commandId, "invalid", ["payload.goalId 与该 Work 的 goal 不一致"]);
    }
    if (binding.binding.taskId !== null && binding.binding.taskId !== taskId) {
      return admitReject(command.commandId, "invalid", ["payload.taskId 与该 Work 的 task 不一致"]);
    }

    // ── 先处理等待**自己的**生命周期（不是接续资格）───────────────────────────────
    // deadline 到点是等待自身的收敛条件（Dispatch 会以同一 generation 把它 settle 成
    // timed_out），与「谁在参与、前驱是否结束」无关；因此它先于参与关系判定，
    // 否则一个已经过期的等待会被「没有参与者」这类失败反复计入熔断计数。
    if (wait.wait.status !== "active") {
      return { status: "not_ready", commandId: command.commandId, code: "conditions_unsatisfied" };
    }
    if (wait.wait.deadlineAt !== null && wait.wait.deadlineAt <= this.context.deps.now()) {
      return { status: "not_ready", commandId: command.commandId, code: "deadline_passed" };
    }

    // ── 接续资格的第一条：该 Work 现在**有没有有效的参与者**（参与身份规则）─────────
    // wait.ownerParticipationRef 是**注册时**的参与关系，只作历史事实/追溯；资格一律按 Work
    // 权威状态里的**当前**参与关系判定。因此：
    //   · 换手（旧段 ended + 新段 active）之后，同一等待仍然能产生同一个 Work 上的唯一后继；
    //   · 现在没有有效参与者时**保留等待**（零写入、不产生后继），并给出可读原因。
    // 顺序刻意在「条件/前驱」之前：没有参与者是**确定性**的不可接续，不能与「前驱还在跑」这种
    // 会自己消失的等待混为一谈（后者只是 not_ready，不向上报失败）。
    const currentRef = binding.binding.currentParticipationRef ?? null;
    if (currentRef === null) {
      return admitReject(command.commandId, "no_active_participation", [
        "该 Work 还没有被受理过任何参与关系（没有有效的当前参与者）；等待保持 active，本次不产生后继",
      ]);
    }
    const participation = await this.context.loadTyped<WorkParticipationSnapshot>(currentRef, "WorkParticipation");
    if (participation === null) {
      return admitReject(command.commandId, "no_active_participation", [
        "该 Work 的当前参与关系在账本里不存在：" + currentRef.participationId + "；等待保持 active，本次不产生后继",
      ]);
    }
    if (participation.participation.status !== "active") {
      return admitReject(command.commandId, "no_active_participation", [
        "该 Work 的当前参与关系已经 ended（" + currentRef.participationId + "）：等待保持 active、不产生后继；" +
        "换手完成（新的参与关系建立）之后同一等待仍可接续",
      ]);
    }
    if (canonicalJson(participation.participation.workContextRef) !== canonicalJson(workContextRef)) {
      return admitReject(command.commandId, "invalid", ["当前参与关系不属于该 Work（后继必须留在同一个 Work）"]);
    }
    // 调用方的提议必须与**当前**事实逐字段一致：不得改用等待登记时的那一段参与关系，
    // 也不得换一个 AgentInstance/授权版本。
    if (canonicalJson(participationRef as never) !== canonicalJson(currentRef as never)) {
      return admitReject(command.commandId, "invalid", [
        "payload.participationRef 必须与该 Work 的当前参与关系一致（" + currentRef.participationId +
        "）；等待登记时的那一段参与关系只是历史事实，不能用于接续资格",
      ]);
    }
    if (participation.participation.agentInstanceId !== (payload["agentInstanceId"] as string)) {
      return admitReject(command.commandId, "invalid", ["payload.agentInstanceId 与当前参与关系的 AgentInstance 不一致"]);
    }
    if (canonicalJson(payload["roleBinding"] as never) !== canonicalJson(participation.participation.roleBinding as never)) {
      return admitReject(command.commandId, "invalid", [
        "payload.roleBinding 与当前参与关系固定的授权版本不一致（后继必须沿用这一段参与的授权）",
      ]);
    }
    // ── 协议约束 2.2：按**当前** RoleBinding 重新核验资格，并把权限集收窄到规格上界内 ──────
    // 只许收窄、不许放宽；交集为空或绑定本身不合格一律零写拒绝（等待保持 active）。
    const reportGuards: VersionedRef[] = [];
    const effective = await this.effectiveSuccessorPermissions({
      projectId,
      roleBinding: participation.participation.roleBinding,
      inherited: payload["declaredPermissions"] as { tools: string[]; writeScope: string[] },
      ...(wait.wait.mode === 'any' ? { guards: reportGuards } : {}),
    });
    if (effective.status === "rejected") {
      return admitReject(command.commandId, "no_admissible_permissions", effective.issues);
    }

    // 唯一后继 id：attemptId/runId 必须由 (workId, waitId, satisfiedRevision) 机械派生。
    const satisfiedRevision = wait.revision + 1;
    const derived = successorIdsFor(workContextRef.workId, waitRef.waitId, satisfiedRevision);
    if (payload["attemptId"] !== derived.attemptId || payload["runId"] !== derived.runId) {
      return admitReject(command.commandId, "invalid", [
        "attemptId/runId 必须由 successorIdsFor(workId, waitId, satisfiedRevision) 派生：" + derived.attemptId + " / " + derived.runId,
      ]);
    }

    // 目标 Delivery 必须存在、属于该 Work，并且是后继 Run 必须消费的精确版本。
    const deliveryRefs = wait.wait.mode === 'any' ? [] : payload["deliveryRefs"] as DeliveryRef[];
    if(!architectureDeliverySetMatches(wait,deliveryRefs))return admitReject(command.commandId,'forbidden',['Architecture wait requires its complete exact decision material set']);
    const deliveries: DeliverySnapshot[] = [];
    const seenDelivery = new Set<string>();
    for (const ref of deliveryRefs) {
      const key = canonicalJson(ref);
      if (seenDelivery.has(key)) continue;
      seenDelivery.add(key);
      const delivery = await this.context.loadTyped<DeliverySnapshot>(ref, "Delivery");
      if (delivery === null) return admitReject(command.commandId, "not_found", ["Delivery 不存在：" + ref.deliveryId]);
      if (canonicalJson(delivery.delivery.targetWorkContextRef) !== canonicalJson(workContextRef)) {
        return admitReject(command.commandId, "invalid", ["Delivery 不属于该 Work：" + ref.deliveryId]);
      }
      if(delivery.delivery.origin.kind==='architecture_decision') {
        const review=await this.context.loadTyped<import('../../../contracts/architecture-review.js').ArchitectureReviewSnapshot>(delivery.delivery.origin.reviewRef,'ArchitectureReview');
        if(!architectureDeliveryApplies(review??undefined,delivery,wait))return admitReject(command.commandId,'forbidden',['Architecture decision no longer applies to this Work']);
        reportGuards.push({ref:review!.ref,revision:review!.revision},{ref:delivery.ref,revision:delivery.revision});
      }
      deliveries.push(delivery);
    }

    // 条件事实：直接按条件里写的精确 ref 读取（≤ WAIT_MAX_CONDITIONS 次），不扫全量事件。
    const facts: WaitConditionFacts = { deliveries: [], respondedRequests: [], closedRequests: [] };
    for (const term of wait.wait.conditions) {
      if (term.kind === "delivery_present") {
        const delivery = await this.context.loadTyped<DeliverySnapshot>(term.deliveryRef, "Delivery");
        if (delivery !== null) facts.deliveries.push({ refKey: canonicalJson(delivery.ref) });
        continue;
      }
      const request = await this.context.loadTyped<DirectedRequestSnapshot>(term.requestRef, "DirectedRequest");
      if (request === null) continue;
      const requestKey = canonicalJson(request.ref);
      if (request.request.status === "responded" || request.request.response !== null) facts.respondedRequests.push(requestKey);
      if (request.request.status === "responded" || request.request.status === "cancelled" ||
          request.request.status === "expired" || request.request.status === "closed") {
        facts.closedRequests.push(requestKey);
      }
    }
    const evaluation = evaluateWaitConditions(wait.wait.conditions, facts);
    let selectedReport: import('../../../contracts/alternative-report.js').AlternativeReportSelection | undefined;
    let reportQualification: import('../../../contracts/alternative-report.js').AlternativeReportQualification | undefined;
    const predecessor = await this.context.loadTyped<RunSnapshot>(predecessorRunRef as AggregateRef, 'Run');
    if (!predecessor) return admitReject(command.commandId, 'not_found', ['Predecessor Run is missing']);
    if (wait.wait.mode === 'any') {
      const chosen = await this.context.deps.ledger.alternativeReport(wait.ref);
      if (chosen.status === 'unavailable') return admitReject(command.commandId, 'unavailable', [chosen.reason]);
      if (chosen.status === 'pending') return { status: 'not_ready', commandId: command.commandId, code: 'conditions_unsatisfied' };
      if (!this.context.deps.alternativeReportObservation) return admitReject(command.commandId, 'unavailable', ['Trusted report inspection is not connected']);
      const grants = new Map<string, import('../../../contracts/ledger.js').AggregateSnapshot>();
      grants.set(canonicalJson(predecessor.ref), predecessor);
      reportGuards.push({ ref: predecessor.ref, revision: predecessor.revision });
      for (const ref of [{ aggregateType: 'Workspace' as const, projectId, workspaceId: scopeWorkspace }, { aggregateType: 'Goal' as const, projectId, goalId }]) {
        const loaded = await this.context.deps.ledger.load(ref);
        if (loaded.status !== 'found') return admitReject(command.commandId, 'unavailable', ['Report scope is unavailable']);
        grants.set(canonicalJson(ref), loaded.snapshot);
        reportGuards.push({ ref, revision: loaded.snapshot.revision });
      }
      const observed = await this.context.deps.alternativeReportObservation.observe(wait, predecessor, chosen.candidates, command.payload.reportObservationToken);
      if (observed.status === 'unavailable') return admitReject(command.commandId, 'unavailable', [observed.reason]);
      reportQualification = observed.qualification;
      for (const observation of reportQualification.observations) {
        const loaded = await this.context.deps.ledger.load(observation.grantRef);
        if (loaded.status !== 'found') return admitReject(command.commandId, 'unavailable', ['Report grant disappeared during inspection']);
        grants.set(canonicalJson(observation.grantRef), loaded.snapshot);
        reportGuards.push({ ref: observation.grantRef, revision: observation.grantRevision });
      }
      const winner = qualifiedAlternativeReport(wait, chosen.candidates, reportQualification, ref => grants.get(canonicalJson(ref)));
      if (!winner) return { status: 'not_ready', commandId: command.commandId, code: 'report_material_unavailable',
        issues: reportQualification.observations.map(row => row.selection.deliveryRef.deliveryId + ': ' + row.reason) };
      selectedReport = winner;
      for (const candidate of chosen.candidates.slice(0, reportQualification.observations.length)) {
        reportGuards.push({ ref: candidate.delivery.ref, revision: candidate.delivery.revision }, { ref: candidate.request.ref, revision: candidate.request.revision });
      }
      const selected = chosen.candidates.find(candidate => canonicalJson(candidate.deliveryRef) === canonicalJson(winner.deliveryRef))!;
      deliveries.push(selected.delivery);
      evaluation.satisfiedIndexes = [selectedReport.conditionIndex];
    }

    // 前驱公开结束以 canonical RunSnapshot.status === "ended" 为准（不看私有日志）。
    if (predecessor === null) {
      return admitReject(command.commandId, "not_found", ["前驱 Run 不存在：" + predecessorRunRef.runId]);
    }
    const eligibility = evaluateSuccessorEligibility({
      wait: wait.wait,
      evaluation,
      predecessorEnded: predecessor.status === "ended",
      now: this.context.deps.now(),
    });
    if (!eligibility.eligible) {
      // 零写入：条件未满足 / 前驱仍 active / deadline 已过都只返回 not_ready。
      return { status: "not_ready", commandId: command.commandId, code: eligibility.code };
    }

    const manifest = this.buildSuccessorManifest({
      workspaceId: scopeWorkspace,
      workspaceRevision: payload["workspaceRevision"] as number,
      planRef: payload["planRef"] as PlanRevisionRef,
      deliveries,
    });

    const priorLease = await this.context.loadTyped<import("../../../contracts/dispatch.js").TaskLeaseSnapshot>(
      { aggregateType: "TaskLease", projectId, goalId, taskId },
      "TaskLease",
    );
    const admissionIntentRef = communicationIntentRefForOf(projectId, scopeWorkspace, waitAdmissionIntentIdFor(waitRef.waitId, satisfiedRevision));
    const admissionIntent = await this.context.loadTyped<CommunicationIntentSnapshot>(admissionIntentRef, "CommunicationIntent");
    const claim = command.payload.intentClaim;
    if (admissionIntent) {
      if (!claim || canonicalJson(claim.intentRef) !== canonicalJson(admissionIntent.ref) ||
          claim.revision !== admissionIntent.revision || claim.leaseGeneration !== admissionIntent.intent.leaseGeneration ||
          claim.consumerId !== admissionIntent.intent.leaseOwner || command.identity.actor.id !== claim.consumerId ||
          admissionIntent.intent.status !== 'leased' || admissionIntent.intent.sideEffectStarted ||
          !admissionIntent.intent.leaseExpiresAt || admissionIntent.intent.leaseExpiresAt <= this.context.deps.now()) {
        return admitReject(command.commandId, 'forbidden', ['Admission requires the current unexpired consumer and generation']);
      }
    } else if (claim) return admitReject(command.commandId, 'invalid', ['Claimed admission intent does not exist']);

    // 协议约束 2.1：换手涉及的**当前参与关系版本**（Work 绑定 + 参与关系本身）进入同一事务的
    // 版本检查。上面读到的 binding/participation 的 revision 就是这里的期望值——它们只作 CAS
    // 守卫，本提交不写这两个快照。因此在「读」与「写」之间发生的 endWorkParticipation /
    // startWorkParticipation（换手）会让这次受理以 revision_conflict 零写失败，调用方必须重新
    // 读取当前参与关系再试，而不是把一个过期的参与者写进 admission。
    // 协作通信可靠投递规则：WaitConditionSatisfied 是可路由源事件 → 同事务登记待路由 intent。
    // 这次提交已经带了 settlesIntent 与若干快照，账本侧的 successor-claim 校验只放行**由计划带来**的
    // CommunicationIntentRecorded（数量必须与计划数一致），因此这里给出的计划是唯一来源。
    const successorPlan = await this.context.routeIntentPlanFor("WaitConditionSatisfied", scopeWorkspace, this.context.deps.now(), command.identity.projectId);
    const batch = withRouteIntentPlan(buildSuccessorCommit({
      command,
      ...(selectedReport ? { selectedReport } : {}),
      ...(reportQualification ? { reportQualification } : {}),
      deps: this.context.foldDeps(scopeWorkspace),
      fingerprint: admitWaitSuccessorFingerprint(command),
      priorWait: wait,
      priorLease,
      priorBinding: binding,
      priorParticipation: participation,
      declaredPermissions: effective.permissions,
      permissionBasis: effective.basis,
      intent: admissionIntent !== null && isTerminalIntentStatus(admissionIntent.intent.status) ? null : admissionIntent,
      manifest,
    }), successorPlan);
    for (const guard of reportGuards) {
      const existing = batch.expectedVersions.find(version => canonicalJson(version.ref) === canonicalJson(guard.ref));
      if (existing && existing.revision !== guard.revision) return admitReject(command.commandId, 'revision_conflict', ['Report inspection basis changed']);
      if (!existing) batch.expectedVersions.push(guard);
    }
    const receipt = await this.context.deps.ledger.commit(batch);
    if (receipt.status === "committed") {
      const admission = batch.snapshots.find((s) => s.ref.aggregateType === "CommunicationAdmission") as
        | import("../../../contracts/coordination.js").CommunicationAdmissionSnapshot
        | undefined;
      const attempt = batch.snapshots.find((s) => s.ref.aggregateType === "TaskAttempt")!;
      const run = batch.snapshots.find((s) => s.ref.aggregateType === "Run")!;
      return {
        status: "committed",
        commandId: command.commandId,
        replayed: receipt.replayed,
        waitRef,
        admissionRef: admission!.ref,
        attemptRef: attempt.ref as import("../../../contracts/dispatch.js").TaskAttemptRef,
        runRef: run.ref as RunSnapshot["ref"],
        eventIds: [...receipt.eventIds],
        commitCursor: receipt.commitCursor,
      };
    }
    if (receipt.code === "revision_conflict") {
      const conflicted = receipt.currentVersions ?? [];
      const current = conflicted.find((v) => canonicalJson(v.ref) === canonicalJson(waitRef));
      // 冲突可能来自 wait 本身，也可能来自**本次读与写之间的换手**（协议约束 2.1 的版本检查）。
      // 后者必须给出可读原因，否则调用方会把它当成 wait 的问题而反复重试同一个过期参与者。
      const handoff = conflicted.filter((v) =>
        canonicalJson(v.ref) === canonicalJson(binding.ref) || canonicalJson(v.ref) === canonicalJson(participation.ref));
      const issues = handoff.length === 0
        ? ["wait 的 CAS 与账本当前版本冲突"]
        : [
          "本次受理读取的当前参与关系/Work 绑定在提交前被推进（换手或并发参与变更）：" +
          handoff.map((v) => v.ref.aggregateType + "@" + String(v.revision)).join(", ") +
          "；零写入，调用方必须重新读取当前参与关系再试",
        ];
      return admitReject(command.commandId, "revision_conflict", issues, current?.revision);
    }
    return {
      status: "rejected",
      commandId: command.commandId,
      code: receipt.code === "idempotency_conflict" ? "idempotency_conflict"
        : receipt.code === "unavailable" ? "unavailable" : "invalid",
    };
  }


  // --------------------------------------------------------------------- //
  // 10b. ensureWaitAdmission（条件已满足但前驱仍在执行 → 幂等建立复查 intent）  //
  // --------------------------------------------------------------------- //

  /**
   * 「条件已满足但前驱仍在执行」时**幂等地**建立 wait_admission intent。
   *
   * 为什么这条判定在 Control：它需要两件 Dispatch 拿不到的 canonical 事实——
   *   ① wait 的每个条件是否已被 canonical Delivery/DirectedRequest 满足；
   *   ② 前驱 RunSnapshot.status 是否仍**不是** ended。
   * Dispatch 只提议"请复核这个等待"，由 Control 读事实后决定建不建 intent。
   *
   * 守卫顺序（与同族 handler 一致：结构 → 引用存在 → 事实判定 → CAS → 唯一一次 commit）：
   *   1. 结构校验：commandType/commandId/correlationId/aggregateId/payload.workspaceId/
   *      payload.expectedRevision（正整数）；
   *   2. wait 必须存在（not_found）；
   *   3. wait 必须 active（否则 not_ready/wait_not_active，零写入）；
   *   4. payload.expectedRevision 必须等于当前 revision（否则 revision_conflict，零写入）；
   *   5. 条件必须全部满足（否则 not_ready/conditions_unsatisfied，零写入）；
   *   6. 前驱必须仍然 active（已经结束 → not_ready/predecessor_ended：那条路径是
   *      admitWaitSuccessor 的直接路径，不需要"前驱结束时复查"的 intent，零写入）；
   *   7. deadline 未到（已到 → not_ready/deadline_passed，等 deadline intent 收敛为 timed_out）；
   *   8. 派生 intentId = waitAdmissionIntentIdFor(waitId, wait.revision + 1)：已存在且非终态 →
   *      already_present（零写入，幂等命中）；已存在且终态 → not_ready/intent_terminal（零写入）；
   *   9. 否则一次 CAS@0 提交（communication-intent-record）。
   */
  async ensureWaitAdmission(command: EnsureWaitAdmissionCommand): Promise<EnsureWaitAdmissionReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "EnsureWaitAdmission", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    const expectedRevision = payload["expectedRevision"];
    if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
      issues.push("payload.expectedRevision 必须是当前 WaitCondition 的正整数 revision");
    }
    if (issues.length > 0) return ensureAdmissionReject(command.commandId, "invalid", issues);

    const projectId = command.identity.projectId;
    const scopeWorkspace = workspaceId as string;
    const waitRef: WaitConditionRef = waitConditionRefFor(projectId, scopeWorkspace, command.aggregateId);
    const wait = await this.context.loadTyped<WaitConditionSnapshot>(waitRef, "WaitCondition");
    if (wait === null) return ensureAdmissionReject(command.commandId, "not_found", ["WaitCondition 不存在：" + command.aggregateId]);
    if (wait.wait.status !== "active") {
      return { status: "not_ready", commandId: command.commandId, waitRef, code: "wait_not_active" };
    }
    if (wait.revision !== expectedRevision) {
      return ensureAdmissionReject(command.commandId, "revision_conflict", ["wait 的当前 revision 与 payload.expectedRevision 不一致"], wait.revision);
    }

    // 条件事实：直接按条件里写的精确 ref 读取（与 admitWaitSuccessor 同一口径，不扫全量事件）。
    const facts: WaitConditionFacts = { deliveries: [], respondedRequests: [], closedRequests: [] };
    for (const term of wait.wait.conditions) {
      if (term.kind === "delivery_present") {
        const delivery = await this.context.loadTyped<DeliverySnapshot>(term.deliveryRef, "Delivery");
        if (delivery !== null) facts.deliveries.push({ refKey: canonicalJson(delivery.ref) });
        continue;
      }
      const request = await this.context.loadTyped<DirectedRequestSnapshot>(term.requestRef, "DirectedRequest");
      if (request === null) continue;
      const requestKey = canonicalJson(request.ref);
      if (request.request.status === "responded" || request.request.response !== null) facts.respondedRequests.push(requestKey);
      if (request.request.status === "responded" || request.request.status === "cancelled" ||
          request.request.status === "expired" || request.request.status === "closed") {
        facts.closedRequests.push(requestKey);
      }
    }
    const evaluation = evaluateWaitConditions(wait.wait.conditions, facts);
    if (wait.wait.mode === 'any') {
      const chosen = await this.context.deps.ledger.alternativeReport(wait.ref);
      if (chosen.status === 'unavailable') return ensureAdmissionReject(command.commandId, 'unavailable', [chosen.reason]);
      evaluation.satisfiedIndexes = chosen.status === 'selected' ? [chosen.selection.conditionIndex] : [];
    }
    if (wait.wait.mode === 'any' ? evaluation.satisfiedIndexes.length === 0 : !evaluation.allSatisfied) {
      return { status: "not_ready", commandId: command.commandId, waitRef, code: "conditions_unsatisfied" };
    }

    const predecessor = await this.context.loadTyped<RunSnapshot>(wait.wait.predecessorRunRef as AggregateRef, "Run");
    if (predecessor === null) return ensureAdmissionReject(command.commandId, "not_found", ["前驱 Run 不存在：" + wait.wait.predecessorRunRef.runId]);
    if (predecessor.status === "ended" && wait.wait.mode !== 'any') {
      // 前驱已经结束：这时该直接走 admitWaitSuccessor（唯一后继在同一事务里创建），
      // 不需要"前驱结束时复查"的 intent。零写入，让调用方换路径。
      return { status: "not_ready", commandId: command.commandId, waitRef, code: "predecessor_ended" };
    }
    const now = this.context.deps.now();
    if (wait.wait.deadlineAt !== null && wait.wait.deadlineAt <= now) {
      return { status: "not_ready", commandId: command.commandId, waitRef, code: "deadline_passed" };
    }

    const satisfiedRevision = wait.revision + 1;
    const intentId = waitAdmissionIntentIdFor(waitRef.waitId, satisfiedRevision);
    const intentRef = communicationIntentRefForOf(projectId, scopeWorkspace, intentId);
    const existing = await this.context.loadTyped<CommunicationIntentSnapshot>(intentRef, "CommunicationIntent");
    if (existing !== null) {
      return isTerminalIntentStatus(existing.intent.status)
        ? { status: "not_ready", commandId: command.commandId, waitRef, code: "intent_terminal" }
        : { status: "already_present", commandId: command.commandId, waitRef, intentRef, satisfiedRevision };
    }

    const intent = waitAdmissionIntentFor({ projectId, workspaceId: scopeWorkspace, waitRef, satisfiedRevision, now });
    const batch = buildIntentRecordCommit({
      command,
      deps: this.context.foldDeps(scopeWorkspace),
      fingerprint: ensureWaitAdmissionFingerprint(command),
      intent,
    });
    const receipt = await this.context.deps.ledger.commit(batch);
    if (receipt.status === "committed") {
      return {
        status: "committed",
        commandId: command.commandId,
        replayed: receipt.replayed,
        waitRef,
        intentRef,
        satisfiedRevision,
        eventIds: [...receipt.eventIds],
        commitCursor: receipt.commitCursor,
      };
    }
    if (receipt.code === "revision_conflict") {
      // 并发下另一个调用已经建立了同一个 intent：幂等命中，不是失败。
      return { status: "already_present", commandId: command.commandId, waitRef, intentRef, satisfiedRevision };
    }
    return ensureAdmissionReject(
      command.commandId,
      receipt.code === "idempotency_conflict" ? "idempotency_conflict" : receipt.code === "unavailable" ? "unavailable" : "invalid",
    );
  }


  /**
   * 后继 Run 的 ContextManifest：只登记**精确的**目标 Delivery 版本 + 工作区/计划新鲜度，
   * 没有选材自由度（选材是 ContextCompiler 的事，这里只固定后继必须消费的引用）。
   */
  private buildSuccessorManifest(input: {
    workspaceId: string;
    workspaceRevision: number;
    planRef: PlanRevisionRef;
    deliveries: DeliverySnapshot[];
  }): ContextManifestV1 {
    const selectedRefs: SourceRefV1[] = input.deliveries.map((snapshot) => {
      const delivery = snapshot.delivery;
      const version = delivery.origin.kind === "subscription"
        ? delivery.origin.sourceTopic + "@" + String(delivery.origin.sourceCursor)
        : delivery.origin.kind === "architecture_decision" ? "architecture_decision@" + delivery.origin.reviewRef.reviewId + "@" + delivery.origin.reviewRevision : "directed_request@" + delivery.origin.requestRef.requestId;
      return {
        kind: "artifact" as const,
        refId: delivery.deliveryId,
        revision: version,
        ...(delivery.bodyRef === null ? {} : { digest: delivery.bodyRef.digest }),
      };
    });
    const gaps: MaterialGapV1[] = [];
    return {
      schemaVersion: 1,
      selectedRefs,
      gaps,
      freshness: {
        workspaceSnapshot: { workspaceId: input.workspaceId, revision: input.workspaceRevision },
        planRef: input.planRef,
      },
    };
  }
}
