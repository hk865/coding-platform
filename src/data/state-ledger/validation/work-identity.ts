/** Internal StateLedger work-identity rules. Both adapters invoke these inside their commit protocol. */
import { canonicalJson } from "../../../contracts/fingerprint.js";


// ------------------------------------------------------------------------ //
// 任务工作身份唯一性：提交语义层的身份槽（两个适配器共用这一份规则）        //
// ------------------------------------------------------------------------ //

/**
 * 一个身份槽的占用声明：key = 该槽的稳定标识，owner = 占用者（canonical 聚合 ref）。
 *
 * ── 为什么这条规则必须放在账本的提交语义里（而不是只放在 Control 守卫里）──────────
 * 「先查、后写」在跨进程时是不成立的：两个宿主进程各自的 ControlEngine 都会先扫到「这个任务
 * 还没有身份」，然后各自提交——两条绑定的聚合 ref 不同，CAS@0 各自成立，账本里就留下两条
 * WorkContextBound。进程内锁同样不成立（不跨进程），调用方约定更不成立（任何调用方都能绕）。
 * 因此唯一性必须由**唯一写入路径**（StateLedger.commit）在同一个事务里判定并占用。
 *
 * ── 为什么 key 由绑定内容机械派生，而不是由调用方传进来 ────────────────────────
 * key 完全由「这条绑定描述的是哪个 (项目, 工作区, 目标, 任务)」算出，没有调用方可控的自由度：
 * 任何一条 task 绑定都必然占用它自己那个槽，因此**没有**「忘了声明所以绕过」的路径。
 * 非 task 工作（coordination／query／review／integration）不占槽：唯一性要求只针对任务身份。
 *
 * ── 边界（明确写下来，不假装覆盖）─────────────────────────────────────────────
 *   1. 槽表是按需建立的**约束索引**，不是状态对象：没有事件、没有 revision、没有生命周期，
 *      只在它所守卫的那次原子提交里被写入（与既有的 idempotency 索引同一手法）。
 *   2. 它不改变任何既有事实：已经存在的绑定不改名、不删除、不合并。在该唯一性规则生效之前形成的
 *      「同一任务两条身份」仍然是可读的不可变历史（解析面继续给唯一答案），只是不再新增第三条。
 *   3. 槽按 taskId 精确匹配；返工替换链上的不同承担者仍是不同任务，本规则不跨越它们合并
 *      （派发面已把替换链收敛到起源任务，那属于派发面的解析语义）。
 */
export type WorkIdentityClaim = {
  key: string;
  owner: string;
  /**
   * true 表示这次提交**释放**该槽（占用者本人释放才生效），而不是占用它。
   * 唯一的使用者是 participation-end：一段参与结束必须在**同一个事务**里让出
   * AgentInstance 的参与槽，否则换手（同一 Agent 在同一工作区建立下一段参与）永远被拒。
   * 缺省（undefined）= 占用，既有 work-context-bind 的语义逐字节不变。
   */
  release?: boolean;
};


/** 任务身份槽的稳定 key（纯函数；同一 (项目, 工作区, 目标, 任务) 永远同一 key）。 */
export function taskWorkIdentityClaimKey(
  projectId: string,
  workspaceId: string,
  goalId: string,
  taskId: string,
): string {
  return canonicalJson(["task-work-identity-claim-v1", projectId, workspaceId, goalId, taskId]);
}


/**
 * 这次 work-context-bind 要占用的身份槽（非 task 工作返回 null）。
 * 由**快照内容**派生：调用方无法省略、无法改写，也就无法绕过。
 */
export function workContextIdentityClaim(
  batch: import("../../../contracts/ledger.js").WorkContextBindLedgerCommitV1,
): WorkIdentityClaim | null {
  const snapshot = batch.snapshots[0];
  if (snapshot === undefined || snapshot.ref.aggregateType !== "WorkContextBinding") return null;
  const binding = snapshot.binding;
  if (binding.workKind !== "task" || binding.goalId === null || binding.taskId === null) return null;
  return {
    key: taskWorkIdentityClaimKey(binding.projectId, binding.workspaceId, binding.goalId, binding.taskId),
    owner: canonicalJson(snapshot.ref as never),
  };
}


/**
 * AgentInstance 的 active participation 槽的稳定 key（纯函数）。
 * 作用域刻意是 (project, workspace, agentInstanceId)：不变式是「一个 AgentInstance 在同一
 * (project, workspace) 至多有一个 active participation」，因此跨 Work 也只有一个槽。
 */
export function participationIdentityClaimKey(
  projectId: string,
  workspaceId: string,
  agentInstanceId: string,
): string {
  return canonicalJson(["agent-participation-claim-v1", projectId, workspaceId, agentInstanceId]);
}


/**
 * 这次参与提交要占用／释放的槽（协作通信参与身份裁决，参与身份规则）。
 *
 * 与 workContextIdentityClaim 同一手法：key 与 owner 全部由**快照内容**派生，调用方无法省略、
 * 无法改写，因此没有「忘了声明所以绕过」的路径。两种提交各自的语言是：
 *   - participation-start → 占用（若该 AgentInstance 在本 (project, workspace) 已有另一段 active
 *     参与，占用失败 → 账本拒绝且零写入）；
 *   - participation-end  → 释放（只有当前占用者本人释放才生效；别人的槽不动）。
 *
 * ── 为什么必须在账本里（而不是只靠 Control 的守卫）─────────────────────────────
 * Control 的守卫是「先查后写」：两个宿主进程各自的引擎都会先看到「这个 Agent 还没有 active
 * 参与」，然后各自提交 —— 两条参与关系的聚合 ref 不同，CAS@0 各自成立，账本里于是留下两段
 * active 参与。唯一有效的判定点只能是与写入同一时刻的这一次提交。
 *
 * 边界（如实）：槽按快照内容派生，守卫的是「经正式提交写进来的参与关系」；该约束启用之前已经
 * 落账的历史重复保持可读、不改写、不合并。
 */
export function participationIdentityClaim(
  batch: import("../../../contracts/coordination.js").ParticipationStartCommitV1 |
    import("../../../contracts/coordination.js").ParticipationEndCommitV1,
): WorkIdentityClaim | null {
  const snapshot = batch.snapshots.find((s) => s.ref.aggregateType === "WorkParticipation");
  if (snapshot === undefined) return null;
  const participation = (snapshot as import("../../../contracts/coordination.js").WorkParticipationSnapshot).participation;
  if (participation === undefined) return null;
  return {
    key: participationIdentityClaimKey(
      participation.workContextRef.projectId,
      participation.workContextRef.workspaceId,
      participation.agentInstanceId,
    ),
    owner: canonicalJson(snapshot.ref as never),
    ...(batch.commitKind === "participation-end" ? { release: true } : {}),
  };
}


/**
 * 槽已被**另一个**身份占用即为冲突（同一 owner 的重复提交不是冲突：那条路径由 CAS@0 与
 * 幂等记录决定，语义不变）。
 *
 * 释放型声明永远不是冲突：它由适配器按 owner 精确删除（自己占的才清），别人占的槽不受影响。
 */
export function identityClaimConflicts(
  claim: WorkIdentityClaim | null,
  existingOwner: string | undefined,
): boolean {
  if (claim === null || claim.release === true) return false;
  return existingOwner !== undefined && existingOwner !== claim.owner;
}
