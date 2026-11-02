/**
 * The TaskMap adapter (E3-2 ruling item 3): a pure function that turns the two
 * route replies (`goals/read`, `goals/display` and `tasks/query`) into the shape
 * the board reads through `props.data`. It touches no DOM, no network and no app
 * module.
 *
 * Ruling items 2 and 6: the Goal's status word and square come from the formal
 * `goals/display` phase, never from `desiredState`. The outline shows the Goal
 * name, Task names, status words and the hover card's existing fields. `why`
 * stays empty because neither route carries prose (the task's instruction is not
 * the board's reason line); a stage-less task attaches to the goal, as the outline
 * does.
 */

import { asRecord, asText } from '../values.js';

/** Ruling item 1: a Goal with no adopted Plan shows this empty text. */
export const NO_PLAN_TEXT = '这个目标还没有采用的计划。';

export type GoalDisplayPhaseCode =
  | 'PLANNING' | 'RUNNING' | 'CHANGE_PENDING' | 'NEEDS_DECISION' | 'BLOCKED' | 'FAILED'
  | 'PAUSED' | 'CANCELLED' | 'COMPLETED' | 'ACCEPTED_PARTIAL';

/** The unwrapped `ReadResult<GoalDetail>` value (ruling item 3: boot unwraps). */
export type TaskMapGoalRead = { goal: { ref: { goalId: string }; objective: string } };

/** The unwrapped `ReadResult<GoalDisplayRead>` value. */
export type TaskMapDisplayRead = { display: { phase: GoalDisplayPhaseCode } };

/** The unwrapped `ReadResult<TaskGraph>` value; rows stay at the JSON boundary. */
export type TaskMapGraphRead = {
  plan: { stages: unknown[]; executionDag: { dependsOn: unknown[] } };
  tasks: unknown[];
};

export type TaskMapData = {
  goal: { id: string; name: string; st: string; word: string };
  stages: Array<{ id: string; name: string }>;
  tasks: Array<{
    id: string; stageId: string | null; name: string; st: string; why: string; deps: string[]; gate: boolean;
  }>;
  /** Ruling item 1: `tasks/query` answered `not_found` because no Plan is adopted. */
  planMissing?: boolean;
};

/** Ruling item 2: the ten formal display phases, worded as the board's own goal
 * words (`Main.dc.html:1765`, `Plan.dc.html:1773`) and task words
 * (`TaskMap.dc.html:745`) are worded. One place, no second copy in the board. */
export function goalDisplayState(phase: GoalDisplayPhaseCode): { st: string; word: string } {
  return {
    PLANNING: { st: 'pending', word: '规划中' },
    RUNNING: { st: 'running', word: '运行中' },
    CHANGE_PENDING: { st: 'waiting', word: '变更待处理' },
    NEEDS_DECISION: { st: 'decide', word: '需要你决定' },
    BLOCKED: { st: 'blocked', word: '受阻' },
    FAILED: { st: 'failed', word: '失败' },
    PAUSED: { st: 'waiting', word: '已暂停，可继续' },
    CANCELLED: { st: 'cancelled', word: '已取消' },
    COMPLETED: { st: 'satisfied', word: '已完成' },
    ACCEPTED_PARTIAL: { st: 'satisfied', word: '部分完成' },
  }[phase];
}

/** Ruling item 2 and ruling 8: a Goal is finished in the display state only when
 * it is completed or cancelled; `desiredState` is not the display. */
export function isFinishedGoalDisplayPhase(phase: GoalDisplayPhaseCode): boolean {
  return phase === 'COMPLETED' || phase === 'CANCELLED';
}

/** Ruling item 6's task words: the TaskRow phase plus the adopted execution intent.
 * Disposition `deferred` wins; `cancelled`/`superseded` tasks are not returned.
 * `ready` and `pending` are renamed; the other five phases are their own word. */
function taskState(phase: string, intent: unknown, disposition: unknown): string | null {
  if (disposition === 'cancelled' || disposition === 'superseded') return null;
  if (disposition === 'deferred') return 'deferred';
  if (phase === 'ready') return 'claimable';
  if (phase === 'pending') return intent === 'plan_only' ? 'future' : 'pending';
  return phase;
}

/** `goal` is the unwrapped `ReadResult<GoalDetail>` value; `graph` is the
 * unwrapped `ReadResult<TaskGraph>` value, or null for the ruled `not_found`. */
export function adaptTaskMap(
  goal: TaskMapGoalRead, graph: TaskMapGraphRead | null, display: TaskMapDisplayRead,
): TaskMapData {
  const goalBody = goal.goal;
  const goalRef = goalBody.ref;
  const state = goalDisplayState(display.display.phase);
  const goalData = { id: asText(goalRef.goalId), name: asText(goalBody.objective), st: state.st, word: state.word };
  if (graph === null) return { goal: goalData, stages: [], tasks: [], planMissing: true };

  const plan = graph.plan;
  const stages = plan.stages.map((entry) => {
    const stage = asRecord(entry);
    return { id: asText(stage.stageId), name: asText(stage.title) };
  });
  const kept = graph.tasks.flatMap((entry) => {
    const row = asRecord(entry);
    const definition = asRecord(row.definition);
    const st = taskState(asText(row.effectivePhase), definition.executionIntent, row.disposition);
    if (st === null) return [];
    return [{
      id: asText(definition.taskId),
      stageId: asText(definition.stageId),
      name: asText(definition.title),
      st,
      why: '',
      gate: definition.taskKind === 'gate',
      deps: [] as string[],
    }];
  });
  const keptIds = new Set(kept.map((task) => task.id));
  const dependencies = plan.executionDag.dependsOn;
  for (const task of kept) {
    const deps: string[] = [];
    for (const edge of dependencies) {
      const fact = asRecord(edge);
      if (asText(fact.taskId) !== task.id) continue;
      const dependsOnId = asText(fact.dependsOnId);
      if (dependsOnId !== '' && keptIds.has(dependsOnId)) deps.push(dependsOnId);
    }
    task.deps = deps;
  }

  return {
    goal: goalData,
    stages,
    tasks: kept,
  };
}
