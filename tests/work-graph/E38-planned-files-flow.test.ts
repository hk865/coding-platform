/**
 * E38-R4 (E3-8 spec §3.3 "读口", §3.5 第 3 条; write-tests brief `e38-tests-brief.md` "E38-R4"; rulings 4, 16, 17):
 * after the real `plans/propose` + `plans/apply`, `tasks/query` and the `graph/detail` summary carry a task's
 * `plannedFiles`, and the detail risks of a task with a list meet other tasks on files, not on the module.
 *
 * World: `openS7C1World({ adviser: false })`, memory (S3: a business rule, not a storage row). Its catalog is
 * already adopted (ruling 11): `s6a-core` paths ['src'], `s6a-ui` paths ['src/ui']
 * (`tests/helpers/S6A-memory-fixture.ts:118–:129`). One more Goal `e38-detail-goal` through `main.createGoal`; its
 * first Plan is the public `plans/propose` body, written here the way `moduleDraft` writes it from `ag2bPlanDraft`
 * (`tests/helpers/S7C-member-fixture.ts:196–:207`, `:287–:294`): one stage, no dependency edge, the gate and the
 * obligation as `ag2bPlanDraft` has them (the gate is goal scope, no list), every work task assigned to the world's
 * `S7C1_CREATE_ROLE`.
 *
 * | task   | scope            | plannedFiles                       |
 * | e38-t1 | module s6a-core  | ['src/core/a.ts', 'src/core/b.ts'] |
 * | e38-t2 | module s6a-core  | ['src/core/c.ts']                  |
 * | e38-t3 | module s6a-core  | (none)                             |
 * | e38-t4 | module s6a-ui    | ['src/core/a.ts']                  |
 *
 * Expected for e38-t1's risks (by hand, spec §3.5 第 3 条):
 * - t2: same module, both have a list and the lists share no path: no module risk ("两边都写了清单，就往下比文件"),
 *   no executed file on either side, no planned file in common: nothing;
 * - t3: same module, t3 has no list: the module risk ("有一边没写清单，才出模块风险");
 * - t4: another module, no executed file, the planned file `src/core/a.ts` in both lists:
 *   `{ kind: 'file', path: 'src/core/a.ts', certainty: 'planned' }`;
 * - the gate: goal scope, no list, no executed file: nothing.
 * The item order is the task-graph row order, which the spec does not fix: the items are sorted by taskId first.
 * Not here (rulings 4, 16): the frozen-list cell (PL-31 proves the whole execution definition), a task with neither
 * a module nor a file, a second risk read of t2.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';
import type { NodeDetailV1, NodeRiskV1 } from '../../src/contracts/work-line.js';
import type { TaskRow } from '../../src/core/work-graph/model/plan-contracts.js';
import { ag2bPlanDraft, graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { openS7C1World, S7C1_CREATE_ROLE, type S7C1World } from '../helpers/S7C-member-fixture.js';

let world: S7C1World | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

const STAGE_ID = 'e38-detail-stage';

/** The four work tasks of the row's table; `plannedFiles` absent = the plan did not write a list. */
const WORK: readonly { taskId: string; moduleRef: string; plannedFiles?: readonly string[] }[] = [
  { taskId: 'e38-t1', moduleRef: 's6a-core', plannedFiles: ['src/core/a.ts', 'src/core/b.ts'] },
  { taskId: 'e38-t2', moduleRef: 's6a-core', plannedFiles: ['src/core/c.ts'] },
  { taskId: 'e38-t3', moduleRef: 's6a-core' },
  { taskId: 'e38-t4', moduleRef: 's6a-ui', plannedFiles: ['src/core/a.ts'] },
];

/** The `plans/propose` draft: `ag2bPlanDraft` changed the way `moduleDraft` changes it, plus the lists. */
function detailDraft(goal: GoalRef): PlanRevisionDraft {
  const draft = ag2bPlanDraft(WORK.map(task => task.taskId));
  return {
    ...draft, planId: 'e38-detail-plan', goalId: goal.goalId,
    stages: [{ stageId: STAGE_ID, title: 'E38 detail stage' }],
    tasks: draft.tasks.map((task): RuntimeTask => {
      const work = WORK.find(entry => entry.taskId === task.taskId);
      if (work === undefined) return task;
      return { ...task, scope: { kind: 'module', stageId: STAGE_ID, moduleRef: work.moduleRef },
        ...(work.plannedFiles === undefined ? {} : { plannedFiles: [...work.plannedFiles] }) };
    }),
    assignments: (draft.assignments ?? []).map(assignment => ({ ...assignment,
      role: S7C1_CREATE_ROLE.templateId, instruction: `E38 ${assignment.taskId}` })),
    executionDag: { dependsOn: [] },
  };
}

/** The real `plans/propose` + `plans/apply` of a Goal's first Plan (`S7C-member-fixture.ts:287–:294`). */
async function adoptFirstPlan(target: S7C1World, goal: GoalRef, draft: PlanRevisionDraft, label: string): Promise<void> {
  const proposed = valueOf<{ ref: unknown; revision: number }>(await target.main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: goal, basedOn: null, draft, reason: { text: `E38 ${label}`, sources: [] },
  }, `${label}-propose`)), 'committed', `the ${label} Plan proposal`);
  valueOf(await target.main.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
  }, `${label}-apply`)), 'committed', `the ${label} Plan adoption`);
}

/** Every `risks` item of one task node, page after page until `nextCursor: null`. */
async function risksOf(target: S7C1World, goal: GoalRef, node: unknown): Promise<NodeRiskV1[]> {
  const items: NodeRiskV1[] = [];
  let afterCursor: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const read: NodeDetailV1 = valueOf<NodeDetailV1>(await target.main.route('graph/detail', {
      goalRef: goal, node, section: 'risks', page: { afterCursor, limit: 20 } }), 'ready', 'the risks page');
    if (read.section !== 'risks') throw new Error(`E38-R4: graph/detail answered ${read.section}, not risks`);
    items.push(...read.items);
    if (read.nextCursor === null) return items;
    afterCursor = read.nextCursor;
  }
  throw new Error(`E38-R4: the risks did not end within 20 pages; read so far: ${JSON.stringify(items)}`);
}

describe('E38-R4: the adopted plannedFiles in the task reads and the detail risks', () => {
  it('E38-R4 tasks/query and the summary carry the list; e38-t1 risks are t3 by module and t4 by planned file', async () => {
    /* Named mutation: (1) the risks' module branch ignores the lists (same module always gives the module risk):
     * e38-t1 gets one more item `{ taskId: 'e38-t2', shared: { kind: 'module', … } }`, the last `toEqual` (risks)
     * goes red; (2) the planned-file step is not done: the `e38-t4` item is missing, the same `toEqual` goes red. */
    world = await openS7C1World({ adviser: false });
    const goal = (await world.main.createGoal('e38-detail-goal', 'E38 planned files in the task reads')).ref;
    await adoptFirstPlan(world, goal, detailDraft(goal), 'e38-r4');
    const projectId = goal.projectId;

    // tasks/query: the definition is the whole adopted RuntimeTask (spec §3.3 读口).
    const graph = valueOf<{ plan: PlanRevisionSnapshot; tasks: TaskRow[] }>(
      await world.main.route('tasks/query', { goalRef: goal }), 'ready', 'tasks/query of e38-detail-goal');
    const rowOf = (taskId: string): TaskRow => {
      const row = graph.tasks.find(candidate => candidate.ref.taskId === taskId);
      if (row === undefined) throw new Error(`E38-R4: tasks/query has no ${taskId}: ${JSON.stringify(graph.tasks.map(entry => entry.ref))}`);
      return row;
    };
    expect(rowOf('e38-t1').definition.plannedFiles).toEqual(['src/core/a.ts', 'src/core/b.ts']);
    expect(rowOf('e38-t3').definition).not.toHaveProperty('plannedFiles');

    // graph/detail summary: `plannedFiles` on the task, `[]` without a list.
    const nodeOf = (taskId: string) => {
      const ref: TaskTriple = { projectId, goalId: goal.goalId, taskId };
      return { kind: 'task' as const, ref, planRef: graph.plan.ref };
    };
    const summaryOf = async (taskId: string) => {
      const detail = valueOf<NodeDetailV1>(await world!.main.route('graph/detail', { goalRef: goal,
        node: nodeOf(taskId), section: 'summary', page: { afterCursor: null, limit: 20 } }), 'ready', `the ${taskId} summary`);
      if (detail.section !== 'summary' || detail.task === null) {
        throw new Error(`E38-R4: the ${taskId} summary has no task: ${JSON.stringify(detail)}`);
      }
      return detail.task;
    };
    const t1 = await summaryOf('e38-t1');
    expect(t1.plannedFiles).toEqual(['src/core/a.ts', 'src/core/b.ts']);
    expect(t1.plannedModules).toEqual([{ projectId, moduleId: 's6a-core' }]);
    expect((await summaryOf('e38-t3')).plannedFiles).toEqual([]);

    // graph/detail risks of e38-t1, every page, sorted by taskId (the order is not specified).
    const risks = (await risksOf(world, goal, nodeOf('e38-t1')))
      .map(item => ({ taskId: item.task.taskId, shared: item.shared }))
      .sort((left, right) => (left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0));
    expect(risks).toEqual([
      { taskId: 'e38-t3', shared: { kind: 'module', module: { projectId, moduleId: 's6a-core' } } },
      { taskId: 'e38-t4', shared: { kind: 'file', path: 'src/core/a.ts', certainty: 'planned' } },
    ]);
  });
});
