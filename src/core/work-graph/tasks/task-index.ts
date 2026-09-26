/** Plan-local adjacency helpers; no Store index or claim authority is implied. */
import type { RuntimeExecutionDAG } from '../../../contracts/plan.js';

/** The plan-local graph inputs shared by a Draft and an accepted Snapshot. */
export type TaskGraphSource = {
  tasks: readonly { taskId: string }[];
  executionDag: RuntimeExecutionDAG;
};

export type TaskAdjacency = { predecessors: ReadonlyMap<string, readonly string[]>;
  successors: ReadonlyMap<string, readonly string[]> };

/**
 * Builds the forward/reverse dependency maps of ONE plan-local execution DAG.
 *
 * Every declared task starts with an explicit empty list, so an independent
 * task is `[]` rather than an absent key. Edges keep their declared order and
 * are never de-duplicated (a duplicated declared edge is a validation issue,
 * not a reason for an index reader to silently rewrite the graph). A dangling
 * endpoint still gets a list so this helper never invents a task object; the
 * admission validator rejects dangling/cyclic edges before a plan is accepted.
 */
export function buildTaskAdjacency(plan: TaskGraphSource): TaskAdjacency {
  const predecessors = new Map<string, string[]>();
  const successors = new Map<string, string[]>();
  for (const task of plan.tasks) {
    predecessors.set(task.taskId, []);
    successors.set(task.taskId, []);
  }
  for (const edge of plan.executionDag.dependsOn) {
    const preds = predecessors.get(edge.taskId);
    if (preds === undefined) predecessors.set(edge.taskId, [edge.dependsOnId]);
    else preds.push(edge.dependsOnId);
    const succs = successors.get(edge.dependsOnId);
    if (succs === undefined) successors.set(edge.dependsOnId, [edge.taskId]);
    else succs.push(edge.taskId);
  }
  return { predecessors, successors };
}

/**
 * Depth-first back-edge detection over the forward adjacency. Self-loops are
 * cycles. The walk is bounded by the plan's own task/edge count, so a plan-local
 * cycle check never scans other goals or the whole ledger.
 */
export function hasDirectedCycle(adjacency: TaskAdjacency): boolean {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const node of adjacency.successors.keys()) color.set(node, WHITE);
  const visit = (node: string): boolean => {
    color.set(node, GRAY);
    for (const next of adjacency.successors.get(node) ?? []) {
      const state = color.get(next) ?? WHITE;
      if (state === GRAY) return true;
      if (state === WHITE && visit(next)) return true;
    }
    color.set(node, BLACK);
    return false;
  };
  for (const node of adjacency.successors.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE && visit(node)) return true;
  }
  return false;
}

/** Cycle check for a second (non-execution) relation such as taskHierarchy.parentOf. */
export function hasCycleInEdges(edges: readonly { from: string; to: string }[]): boolean {
  const successors = new Map<string, string[]>();
  for (const edge of edges) {
    const list = successors.get(edge.from);
    if (list === undefined) successors.set(edge.from, [edge.to]);
    else list.push(edge.to);
  }
  return hasDirectedCycle({ predecessors: new Map(), successors });
}
