/**
 * RW-15（M1）ReadModelIndex — 完成工作视图的**归并可见性**。
 *
 * 背景：RW-13 规定「一个任务只有一个持久工作身份」，视图按 `dedupeTaskWorks` 把同一 (goal, task)
 * 的多条身份归并成一行。归并本身是对的（落选身份仍是不可变历史事实），但它此前是**静默**的：
 * 读者看不到「这里发生过归并、落选者是谁」，落选身份的留痕也就永远没有机会进入历史选材。
 *
 * 这里只做两件事，两套后端共用同一份实现（内存与 SQLite 必须逐字段一致）：
 *   1. 把 `dedupeTaskWorks` 的结果与候选集合求差，得到每个 (goal, task) 的落选身份；
 *      **不重算选择规则**：选谁代表该任务仍由 work-identity-resolution 的唯一实现决定，
 *      本文件只回答「谁落选了」，且按引用比较（`dedupeTaskWorks` 原样返回输入对象）；
 *   2. 给出稳定的排序（canonical 形式），使两套后端的输出顺序相同，不依赖存储遍历顺序。
 */
import { canonicalJson } from '../../contracts/fingerprint.js';
import type { WorkContextRef } from '../../contracts/context-continuity.js';

/** 视图两侧共用的最小形状：一条工作身份候选（`goalId`/`taskId` 非 task 工作时为 null）。 */
export type TaskWorkCandidateLike = {
  ref: WorkContextRef;
  binding: { goalId: string | null; taskId: string | null };
};

/** (goal, task) 的归并键：与 dedupeTaskWorks 的分组口径一致（只按目标与任务，不掺 workId）。 */
export function taskWorkKey(goalId: string | null, taskId: string | null): string {
  return canonicalJson([goalId, taskId]);
}

/** canonical 形式排序：两套后端同序，便于逐字段比对与重开一致性检查。 */
export function sortWorkRefs(refs: readonly WorkContextRef[]): WorkContextRef[] {
  return [...refs].sort((a, b) => canonicalJson(a as never).localeCompare(canonicalJson(b as never)));
}

/**
 * 落选身份清单：候选里存在、但不在 RW-13 归并结果里的那些，按 (goal, task) 分组。
 * `retained` 必须是 `dedupeTaskWorks(candidates)` 的返回值。
 */
export function droppedWorkRefsByTask<T extends TaskWorkCandidateLike>(
  candidates: readonly T[],
  retained: readonly T[],
): Map<string, WorkContextRef[]> {
  const retainedRefs = new Set(retained.map((row) => canonicalJson(row.ref)));
  const dropped = new Map<string, WorkContextRef[]>();
  for (const candidate of candidates) {
    if (retainedRefs.has(canonicalJson(candidate.ref))) continue;
    const group = taskWorkKey(candidate.binding.goalId, candidate.binding.taskId);
    dropped.set(group, [...(dropped.get(group) ?? []), candidate.ref]);
  }
  return dropped;
}
