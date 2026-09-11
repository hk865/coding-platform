/**
 * RW-11（ADR 0003 D4 前半）— 角色规格实体化契约。
 *
 * 把「角色」从 `RoleBindingRefV1.templateId` 的字符串升级为**版本化规格**：
 *   - `RoleSpecRevision` 与既有 CompletionPolicy／ArchitectureBaseline／CoordinationPolicy／
 *     ArchitectureEvolutionPolicy 同构：不可改写的 revision + 内容摘要 + Project 生效引用，
 *     install 是 CAS@0、activate 是 CAS，事件与快照走同一个账本。
 *     这不是第五套治理机制，而是同一条治理路径上的第五个治理种类（ARCHITECTURE 不变量 #11）。
 *   - 规格正文决定这个角色能拿哪些工具、必须读哪些材料、必须产出什么、什么条件下退出，
 *     形状与 dev_docs/agent/templates/short-lived-agent.md 的配置模板对齐。
 *
 * 角色能做什么由规格决定，而规格从哪来由人经 install/activate 显式提交（没有内置默认值）：
 * 没有安装过规格的项目，其 claim 语义与 RW-11 之前完全一致（ControlEngine 不编造角色目录）。
 */
import type { ActorRef, CommandFingerprint, CommandIdentity, CommitCursor } from "./command-event.js";
import { canonicalJson, sha256Hex } from "./fingerprint.js";

/**
 * 一个 roleId 只有一份不可改写的安装 revision（安装入口是 CAS@0，摘要口径固定用 revision 1）。
 * 与 P15_COORDINATION_POLICY_REVISION 同理：「安装一份内容不同的规格」在身份上就是换一个 roleId。
 */
export const ROLE_SPEC_REVISION = 1;

// ------------------------------------------------------------------------ //
// 规格正文                                                                   //
// ------------------------------------------------------------------------ //

/**
 * 责任视角。取自 CONTEXT.md 的两个既有定义：
 *   - Coordination Role：human_decision_support（面向人的决策支持）、fact_consolidation（事实整理与汇报）、
 *     planning／integration（规划与集成，含跨工作包协调）；
 *   - Execution Role：execution（实现）、verification（验证材料）、investigation（调查与观察）。
 * 这是职责词汇表，不是「哪些角色存在」的枚举——角色目录由人安装的策略矩阵决定。
 */
export const ROLE_RESPONSIBILITIES = [
  "human_decision_support",
  "fact_consolidation",
  "planning",
  "integration",
  "execution",
  "verification",
  "investigation",
] as const;
export type RoleResponsibilityV1 = (typeof ROLE_RESPONSIBILITIES)[number];

/** 必读／可选材料的种类。材料本身仍由 ContextCompiler 按规格取材（D4-3）。 */
export const ROLE_MATERIAL_KINDS = ["contract", "code", "evidence", "history", "decision"] as const;
export type RoleMaterialKindV1 = (typeof ROLE_MATERIAL_KINDS)[number];

/** 必产出种类。VerificationEngine 按规格校验必产出完备性（D4-3）。 */
export const ROLE_OUTPUT_KINDS = [
  "answer-with-sources",
  "proposal",
  "conflict-report",
  "verification-verdict",
  "implementation-result",
  "integration-result",
  "work-record",
] as const;
export type RoleOutputKindV1 = (typeof ROLE_OUTPUT_KINDS)[number];

export type RoleResponsibilitySpecV1 = RoleResponsibilityV1;
export type RoleMaterialRequirementV1 = { kind: RoleMaterialKindV1; reason: string };
export type RoleOutputRequirementV1 = { kind: RoleOutputKindV1; reason: string };

export type RoleSpecPermissionsV1 = {
  /** 允许工具集合的**上界**：claim 声明的 tools 必须是它的子集，超出即越界拒绝。 */
  tools: string[];
  /**
   * 写入授权类别：
   *   - "none"：只读角色——claim 声明的 writeScope 必须为空；
   *   - "workspace"：可在工作区内写入（具体路径范围仍由已接受计划的授权决定，
   *     规格不写死路径，因为范围是每个任务的事实，不是角色的常量）。
   */
  writeScope: "none" | "workspace";
};

export type RoleSpecBudgetV1 = {
  /** 预算的唯一来源是落账 Task 的持久预算；规格不内置数字，避免另起一套预算。 */
  source: "task-budget";
  /** assigned-task：本任务的预算；producer-task：生产者 Task 的已提交预算（独立审阅的既有规则）。 */
  scope: "assigned-task" | "producer-task";
};

export type RoleSpecExitV1 = {
  /** 可检查的交付条件。 */
  success: string;
  /** 预算耗尽、取消、缺少授权或无法继续时的停止条件。 */
  stop: string;
  /** 交接内容：已做事项、未解问题、产物与下一步。 */
  handoff: string;
};

export type RoleSpecContentV1 = {
  schemaVersion: 1;
  /** 面向人的角色标签。 */
  label: string;
  /** 这次角色存在要回答的问题或有界工作。 */
  purpose: string;
  /** 责任视角（至少一个，必须取自 ROLE_RESPONSIBILITIES）。 */
  responsibility: RoleResponsibilityV1[];
  /** 必读材料（至少一项，缺料时 ContextCompiler 返回 needs_material 而不是静默通过）。 */
  requiredMaterials: RoleMaterialRequirementV1[];
  /** 可选材料（可按预算与相关性选入）。 */
  optionalMaterials: RoleMaterialRequirementV1[];
  permissions: RoleSpecPermissionsV1;
  budget: RoleSpecBudgetV1;
  /** 必产出（至少一项）。 */
  requiredOutputs: RoleOutputRequirementV1[];
  exit: RoleSpecExitV1;
};

// ------------------------------------------------------------------------ //
// 治理种类：RoleSpecRevision（与 CoordinationPolicy 同构）                    //
// ------------------------------------------------------------------------ //

export type RoleSpecRevisionRef = { aggregateType: "RoleSpecRevision"; projectId: string; roleId: string; revision: number };
/** 角色矩阵里的 pin：一个角色在某个项目上被授权的精确规格 revision 与内容摘要。 */
export type RoleSpecPinV1 = { ref: RoleSpecRevisionRef; digest: string };
export type RoleSpecRevisionSnapshot = {
  ref: RoleSpecRevisionRef;
  revision: 1;
  schemaVersion: 1;
  roleId: string;
  contentRevision: number;
  content: RoleSpecContentV1;
  contentDigest: string;
  installedAt: string;
};
export type ProjectRoleSpecActiveRef = { aggregateType: "ProjectRoleSpecActive"; projectId: string; roleId: string };
export type ProjectRoleSpecActiveSnapshot = {
  ref: ProjectRoleSpecActiveRef;
  projectId: string;
  roleId: string;
  activeRevision: RoleSpecRevisionRef;
  revision: number;
};

export function roleSpecRevisionRefFor(projectId: string, roleId: string, revision: number = ROLE_SPEC_REVISION): RoleSpecRevisionRef {
  return { aggregateType: "RoleSpecRevision", projectId, roleId, revision };
}

export function projectRoleSpecActiveRefFor(projectId: string, roleId: string): ProjectRoleSpecActiveRef {
  return { aggregateType: "ProjectRoleSpecActive", projectId, roleId };
}

export function roleSpecContentDigest(content: RoleSpecContentV1, roleId: string, revision: number): string {
  return sha256Hex(canonicalJson({ schemaVersion: 1, roleId, revision, content }));
}

/**
 * 规格正文的稳定摘要口径（与 RoleBindingRefV1.templateRevision 的编码约定配套）：
 * claim 声明的 templateRevision 必须是它所绑定规格 revision 的十进制写法。
 * 规格为空或无法解析即 null——调用方必须据此拒绝，不能猜一个 revision 出来。
 */
export function roleSpecRevisionFromBinding(templateRevision: string): number | null {
  if (!/^[1-9][0-9]*$/.test(templateRevision)) return null;
  const value = Number(templateRevision);
  return Number.isSafeInteger(value) ? value : null;
}

// ------------------------------------------------------------------------ //
// 命令 / receipt                                                             //
// ------------------------------------------------------------------------ //

export type InstallRoleSpecRevisionCommand = {
  commandId: string;
  commandType: "InstallRoleSpecRevision";
  schemaVersion: 1;
  identity: CommandIdentity;
  correlationId: string;
  submittedAt: string;
  payload: { roleId: string; content: RoleSpecContentV1; contentDigest: string };
};
export type ActivateRoleSpecRevisionCommand = {
  commandId: string;
  commandType: "ActivateRoleSpecRevision";
  schemaVersion: 1;
  identity: CommandIdentity;
  aggregateId: string;
  expectedRevision: number;
  correlationId: string;
  submittedAt: string;
  payload: { target: RoleSpecPinV1 };
};

export type InstallRoleSpecRevisionReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; revisionRef: RoleSpecRevisionRef; contentDigest: string; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: "invalid" | "digest_mismatch" | "revision_conflict" | "idempotency_conflict" | "unavailable" };
export type ActivateRoleSpecRevisionReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; activeRef: ProjectRoleSpecActiveRef; activeRevision: RoleSpecRevisionRef; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: "invalid" | "not_found" | "digest_mismatch" | "revision_conflict" | "idempotency_conflict" | "unavailable" };

export function installRoleSpecRevisionFingerprint(command: InstallRoleSpecRevisionCommand): CommandFingerprint {
  return sha256Hex(
    canonicalJson({
      schemaVersion: command.schemaVersion,
      commandType: command.commandType,
      projectId: command.identity.projectId,
      payload: { roleId: command.payload.roleId, contentDigest: command.payload.contentDigest },
    }),
  ) as CommandFingerprint;
}
export function activateRoleSpecRevisionFingerprint(command: ActivateRoleSpecRevisionCommand): CommandFingerprint {
  return sha256Hex(
    canonicalJson({
      schemaVersion: command.schemaVersion,
      commandType: command.commandType,
      projectId: command.identity.projectId,
      expectedRevision: command.expectedRevision,
      target: command.payload.target,
    }),
  ) as CommandFingerprint;
}

export type RoleSpecInstalledEvent = {
  eventId: string;
  eventType: "RoleSpecInstalled";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "RoleSpecRevision";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: { revision: RoleSpecRevisionSnapshot };
};
export type RoleSpecActivatedEvent = {
  eventId: string;
  eventType: "RoleSpecActivated";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "ProjectRoleSpecActive";
  aggregateId: string;
  aggregateRevision: number;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: { activeRef: ProjectRoleSpecActiveRef; activeRevision: RoleSpecRevisionRef };
};

// ------------------------------------------------------------------------ //
// 冻结接口：角色规格治理入口                                                 //
// ------------------------------------------------------------------------ //

/** ControlEngine 的角色规格入口（与 CoordinationPolicyPort 同形；不新增 Module）。 */
export interface RoleSpecPort {
  install(command: InstallRoleSpecRevisionCommand): Promise<InstallRoleSpecRevisionReceipt>;
  activate(command: ActivateRoleSpecRevisionCommand): Promise<ActivateRoleSpecRevisionReceipt>;
}
