/**
 * Slice 1 §4.3: pure soft ordering of Workflow candidates by the real
 * `executionDag.dependsOn` edges only.
 *
 * It performs a stable Kahn topological sort whose ready-set tie-break is
 * (required first, original plan position, taskId). It only changes the
 * selection order: `selectNext` still tries each candidate through the existing
 * eligibility/phase/action checks, and the claim owner gains no new
 * "upstream satisfied" gate. Cycles (already invalid for a real plan) are
 * appended defensively with the same stable key; self-edges are ignored.
 */
import type { RuntimeExecutionDAG, RuntimeTask } from '../../contracts/plan.js';

export function orderTasksByDependency(
  tasks: readonly RuntimeTask[], dependsOn: RuntimeExecutionDAG['dependsOn'],
): RuntimeTask[] {
  const position = new Map<string, number>();
  const byId = new Map<string, RuntimeTask>();
  const original = [...tasks];
  for (let index = 0; index < original.length; index += 1) {
    const task = original[index]!;
    // A repeated taskId keeps its FIRST position; the id is the tie-break.
    if (!position.has(task.taskId)) position.set(task.taskId, index);
    if (!byId.has(task.taskId)) byId.set(task.taskId, task);
  }

  // Upstream -> downstream, de-duplicated; self-edges and endpoints outside the
  // candidate set are ignored (they neither join nor block).
  const downstream = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const edge of dependsOn) {
    if (!byId.has(edge.taskId) || !byId.has(edge.dependsOnId)) continue;
    if (edge.taskId === edge.dependsOnId) continue;
    let targets = downstream.get(edge.dependsOnId);
    if (targets === undefined) { targets = new Set<string>(); downstream.set(edge.dependsOnId, targets); }
    if (targets.has(edge.taskId)) continue;
    targets.add(edge.taskId);
    indegree.set(edge.taskId, (indegree.get(edge.taskId) ?? 0) + 1);
  }

  const stableKey = (taskId: string): [number, number, string] => {
    const task = byId.get(taskId)!;
    return [task.requirementLevel === 'required' ? 0 : 1, position.get(taskId) ?? 0, taskId];
  };
  const compare = (left: string, right: string): number => {
    const a = stableKey(left);
    const b = stableKey(right);
    if (a[0] !== b[0]) return a[0] - b[0];
    if (a[1] !== b[1]) return a[1] - b[1];
    return a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0;
  };

  const ordered: RuntimeTask[] = [];
  const emitted = new Set<string>();
  const ready: string[] = [];
  for (const taskId of byId.keys()) {
    if ((indegree.get(taskId) ?? 0) === 0) ready.push(taskId);
  }
  while (ready.length > 0) {
    ready.sort(compare);
    const next = ready.shift()!;
    if (emitted.has(next)) continue;
    emitted.add(next);
    ordered.push(byId.get(next)!);
    for (const target of downstream.get(next) ?? []) {
      const remaining = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, remaining);
      if (remaining === 0 && !emitted.has(target)) ready.push(target);
    }
  }

  // A corrupted cycle is appended defensively with the same stable key.
  const leftovers = [...byId.keys()].filter((taskId) => !emitted.has(taskId)).sort(compare);
  for (const taskId of leftovers) ordered.push(byId.get(taskId)!);
  return ordered;
}
