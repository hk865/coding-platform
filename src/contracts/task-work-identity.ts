/**
 * RW-13 契约：任务工作身份（task work identity）的**权威解析形状** + 身份推导规则。
 *
 * ── 为什么这里只有「形状 + 纯推导函数」，没有业务分派 ─────────────────────────────
 * 本文件是共享契约面（Contracts），只放两样东西：
 *   1. 推导规则 `workIdFor`：workId 是 canonical 计划事实的纯函数（RW-12 起未变）；
 *   2. 解析查询／结果形状：ControlEngine 的权威只读解析面（见
 *      src/control/control-engine/work-identity-resolution.ts）与它的消费者用它交换结果。
 *
 * 推导规则为什么从 DispatchEngine 上移到 Contracts：
 *   身份是持久事实，读它的人不止派发面——ControlEngine 的解析面要在「同一任务多条候选」时
 *   区分「别的主体显式声明的身份」与「派发按推导规则兜底建立的身份」，ReadModel 的已完成工作
 *   视图也要按同一条规则把一个任务归并成一条身份。规则只写一次，三处消费同一个纯函数：
 *     - DispatchEngine（建立点）与 ControlEngine（权威读取）之间不存在第二份规则；
 *     - 也不会产生 ControlEngine → DispatchEngine 的反向依赖（ModuleDependencyDAG 只允许
 *       DispatchEngine → ControlEngine）。
 *   旧路径 `src/control/dispatch-engine/work-identity.ts` 继续 re-export 同名函数，既有消费者不变。
 *
 * ── 推导规则是**兜底规则**，不是身份的唯一来源 ──────────────────────────────────
 *   workId = "work-" + sha256(canonicalJson([projectId, workspaceId, goalId, originTaskId]))[0..32]
 * 它只在「这个任务在账本里还没有任何既存工作身份」时被用来建立新身份。一旦账本里已经有身份
 * （人／场景显式 bindWorkContext 建立，或此前按同一条规则建立），那段工作的身份就是已存在的那条：
 * 它不可改名、不可删除、不可被推导 id 顶替（同一段落工作只能有一个持久身份）。
 * 因此 `isDerivedWorkIdFor` 这个判断本身是有语义的：workId 不等于推导 id 的绑定，只可能是
 * 别的主体**显式声明**的身份，它在同一任务有多条候选时优先。
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "./fingerprint.js";
import type { WorkContextBindingV1, WorkContextRef } from "./context-continuity.js";
import type { PlanRevisionSnapshot } from './plan.js';

export const WORK_IDENTITY_MAX_CHAIN_HOPS = 16;

/** The same source-plan replacement chain is used by dispatch and impact reports. */
export function taskWorkOrigin(plan: PlanRevisionSnapshot, taskId: string): { originTaskId: string; chain: string[] } {
  const chain = [taskId];
  const seen = new Set(chain);
  let current = taskId;
  for (let hop = 0; hop < WORK_IDENTITY_MAX_CHAIN_HOPS; hop += 1) {
    const predecessor = plan.tasks.find(task => (task.replacedByTaskId ?? null) === current && !seen.has(task.taskId));
    if (!predecessor) break;
    chain.push(predecessor.taskId);
    seen.add(predecessor.taskId);
    current = predecessor.taskId;
  }
  return { originTaskId: current, chain };
}

/** 工作身份前缀（全仓唯一）。 */
export const WORK_ID_PREFIX = "work-";

/** 工作身份的作用域：一段工作属于一个 (项目, 工作区, 目标)。 */
export type WorkIdentityScope = { projectId: string; workspaceId: string; goalId: string };

/** 由 (作用域, 起源任务) 折出工作身份。纯函数：同输入永远同输出，重启后仍相同。 */
export function workIdFor(scope: WorkIdentityScope, originTaskId: string): string {
  const digest = createHash("sha256")
    .update(canonicalJson([scope.projectId, scope.workspaceId, scope.goalId, originTaskId]))
    .digest("hex");
  return WORK_ID_PREFIX + digest.slice(0, 32);
}

/**
 * 该 workId 是否恰好等于推导规则给这个任务算出的兜底 id。
 *
 * true  → 这条身份是（或至少完全可以由）推导规则产生的兜底身份；
 * false → 这条身份只能来自别的主体对同一任务的**显式声明**（例如人／场景直接 bindWorkContext）。
 * 身份是不可改写的持久事实：这个判断只用来决定「多条候选时哪一条代表这个任务」，
 * 绝不用来改写或删除任何一条绑定。
 */
export function isDerivedWorkIdFor(scope: WorkIdentityScope, taskId: string, workId: string): boolean {
  return workId === workIdFor(scope, taskId);
}

/** 权威解析查询：按 (projectId, workspaceId, goalId, taskId) 找该任务的 task 工作身份。 */
export type TaskWorkIdentityQuery = {
  projectId: string;
  workspaceId: string;
  goalId: string;
  /** 该工作的**起源任务** id（返工替换链收敛后的承担者；见 dispatch-engine/work-identity.ts）。 */
  taskId: string;
};

/** 一条候选身份（账本里同一任务的一条 WorkContextBinding）。 */
export type TaskWorkIdentityCandidate = {
  workContextRef: WorkContextRef;
  binding: WorkContextBindingV1;
};

/** 身份的来源判定：declared = 显式声明的身份；derived = 按推导规则兜底建立的身份。 */
export type TaskWorkIdentityAuthority = "declared" | "derived";

/**
 * 权威解析结果。三个状态都是**只读事实**，没有「顺手写一条」的分支：
 *   resolved    —— 该任务已存在的工作身份（唯一答案）；调用方必须复用它，只做 linkWorkRun；
 *   absent      —— 账本里确实没有该任务的身份，调用方才可以按推导规则建立；
 *   unavailable —— 读不完整／不可读：调用方必须失败（Run 不启动、零写入），
 *                  不得凭推导 id 硬写一个可能与既有身份冲突的新身份。
 */
export type TaskWorkIdentityResolution =
  | {
      status: "resolved";
      workContextRef: WorkContextRef;
      revision: number;
      /** 解析当时的 canonical 绑定快照（不是建立时的事件副本）。 */
      binding: WorkContextBindingV1;
      authority: TaskWorkIdentityAuthority;
      /** 同一 (goal, task) 的候选条数；>1 表示 RW-13 之前留下的历史不一致（不再新增）。 */
      candidateCount: number;
    }
  | { status: "absent" }
  | { status: "unavailable"; reason: string };
