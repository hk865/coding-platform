/**
 * S8B1-R: the one change-scope world of B1-06..10 (`darr-b1-tests.frozen.md` §1.2, §2.2).
 *
 * Prior states are public steps only:
 * - a definite change: the AG2b real Host + scripted model world (`startAG2bHost`), the frozen
 *   `seedAG2bWorkGraph` Plan and one Work Run whose `edit` call writes `src/ag2b-result.txt`;
 * - a second goal of the same project: `goals/create`, `plans/propose` + `plans/apply` and one
 *   executor line through `sessions/create`, then a second Work Run writing `src/ag2b-other.txt`;
 * - a starting Run: the S6A world with the E3A architecture seed/Plan and `startWorkRun`
 *   (`select_work` + the claim step, no prepare/start);
 * - no Run: the S6A world's second goal, which has no Plan and no Run.
 *
 * Every read is the public route; nothing here reads a record or the store.
 */
import type { GoalRef } from '../../src/contracts/ledger.js';
import {
  AG2B_GOAL_REF, AG2B_RESULT_FILE, AG2B_RESULT_TEXT, AG2B_SCOPE, AG2B_WORK_ROLE, ag2bPlanDraft,
  corePost, graphWrite, plain, seedAG2bWorkGraph, startAG2bHost, type AG2bHost,
} from './AG2b-collaboration-fixture.js';
import { driveWorkflow, publicDirectory, selectWork } from './A2-restart-fixture.js';
import { openS6ARequestWorld, S6A_SCOPE, S6A_WORK_ROLE, type S6ARequestWorld } from './S6A-request-fixture.js';
import { asRecord, committedValue } from './S6A-memory-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from './S6A-cards-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from './S6B1-fixture.js';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';

export const S8B1_SECOND_GOAL_ID = 's8b1-goal-2';
export const S8B1_SECOND_TASK_ID = 's8b1-second-work';
export const S8B1_SECOND_FILE = 'src/ag2b-other.txt';
export const S8B1_SECOND_TEXT = 'S8B1_SECOND_RESULT\n';

async function bodyOf(host: AG2bHost, suffix: string, body: unknown): Promise<Record<string, unknown>> {
  const answer = await corePost(host.base, suffix, host.token, body);
  if (answer.status !== 200) throw new Error(`S8B1-R: ${suffix} answered ${String(answer.status)}`);
  return asRecord(await answer.json() as unknown);
}


export type S8B1DefiniteWorld = {
  readonly host: AG2bHost;
  readonly firstGoal: GoalRef;
  readonly secondGoal: GoalRef;
  readonly firstFile: string;
  readonly secondFile: string;
  readonly moduleId: string;
  close(): Promise<void>;
};

/**
 * The definite-change world: goal 1's completed Work Run writes the AG2b result file; a second
 * goal of the same project has its own Plan and executor line, and its Work Run writes another
 * file. Both Runs stop at `open_checks` (the Run has ended and its activity is recorded; the
 * check is not part of this read).
 */
export async function openS8B1DefiniteWorld(): Promise<S8B1DefiniteWorld> {
  const publicDir = await publicDirectory();
  const host = await startAG2bHost(publicDir, { replies: [
    { kind: 'calls', calls: [{ callId: 's8b1-first-edit', name: 'edit',
      args: { mode: 'create', path: AG2B_RESULT_FILE, newText: AG2B_RESULT_TEXT } }] },
    { kind: 'text', text: 'S8B1: the first goal file is written' },
    { kind: 'calls', calls: [{ callId: 's8b1-second-edit', name: 'edit',
      args: { mode: 'create', path: S8B1_SECOND_FILE, newText: S8B1_SECOND_TEXT } }] },
    { kind: 'text', text: 'S8B1: the second goal file is written' },
  ] });
  try {
    await seedAG2bWorkGraph(host);
    await driveWorkflow(host, selectWork('s8b1-first-work'), { stopBefore: 'open_checks' });

    const secondGoal: GoalRef = { aggregateType: 'Goal', projectId: AG2B_SCOPE.projectId, goalId: S8B1_SECOND_GOAL_ID };
    committedValue(await bodyOf(host, 'goals/create', graphWrite(AG2B_SCOPE, {
      goalId: secondGoal.goalId, workspace: AG2B_SCOPE, objective: 'S8B1 second goal',
    }, 's8b1-second-goal', [
      { ref: { aggregateType: 'Project', projectId: AG2B_SCOPE.projectId }, revision: 1 },
      { ref: { aggregateType: 'Workspace', ...AG2B_SCOPE }, revision: 1 },
    ])), 'the second Goal');
    const base = ag2bPlanDraft([S8B1_SECOND_TASK_ID]);
    const draft = { ...base, planId: 's8b1-second-plan', goalId: secondGoal.goalId };
    const proposed = committedValue<{ ref: unknown; revision: number }>(await bodyOf(host, 'plans/propose', graphWrite(AG2B_SCOPE, {
      goalRef: secondGoal, basedOn: null, draft,
      reason: { text: 'S8B1 second goal plan', sources: [] },
    }, 's8b1-second-propose')), 'the second Plan proposal');
    committedValue(await bodyOf(host, 'plans/apply', graphWrite(AG2B_SCOPE, {
      proposalRef: proposed['ref'], expectedProposalRevision: proposed['revision'], decisionRefs: [],
    }, 's8b1-second-apply')), 'the second Plan adoption');
    const line = await bodyOf(host, 'sessions/create', plain(AG2B_SCOPE, {
      workspace: AG2B_SCOPE, role: AG2B_WORK_ROLE, recommendedRefs: [], initialLinks: [{
        target: { kind: 'task', ref: { projectId: AG2B_SCOPE.projectId, goalId: secondGoal.goalId,
          taskId: S8B1_SECOND_TASK_ID } }, relation: 'responsible',
      }], meta: { requestId: 's8b1-second-line', expected: [] },
    }));
    if (line['status'] !== 'completed') {
      throw new Error(`S8B1-R: the second executor line did not complete: ${JSON.stringify(line)}`);
    }
    await driveWorkflow(host, { schemaVersion: 1, goalRef: secondGoal, flowId: 's8b1-second-work',
      sessionHint: null, kind: 'select_work', taskId: S8B1_SECOND_TASK_ID }, { stopBefore: 'open_checks' });

    return {
      host,
      firstGoal: AG2B_GOAL_REF,
      secondGoal,
      firstFile: AG2B_RESULT_FILE,
      secondFile: S8B1_SECOND_FILE,
      moduleId: 'ag2b-work',
      close: async () => await host.host.close(),
    };
  } catch (error) {
    await host.host.close().catch(() => undefined);
    throw error;
  }
}

export type S8B1StartingWorld = { readonly world: S6ARequestWorld; readonly goal: GoalRef;
  close(): Promise<void> };

/**
 * The starting-Run world: the S6A real Host's governance (S6B's public architecture/policy seed),
 * one adopted Plan and executor line, then the two public `workflow/advance` steps E3A's
 * `startWorkRun` uses (`select_work` and the claim); no prepare/start, so the Run stays `starting`.
 */
export async function openS8B1StartingWorld(): Promise<S8B1StartingWorld> {
  const world = await openS6ARequestWorld({ backend: 'memory' });
  try {
    const ws: S6ACardsWorkspace = s6aCardsWorkspace(world, S6A_SCOPE);
    await governS6B(world, ws, { first: world.goals.first, second: world.goals.second });
    const taskId = 's8b1-start-work';
    const plan = await adoptS6BPlan(ws, world.goals.first, { label: 's8b1', taskIds: [taskId],
      role: S6A_WORK_ROLE.templateId });
    const task = plan.tasks.find(candidate => candidate.taskId === taskId);
    if (task === undefined) throw new Error('S8B1-R: the starting Plan has no work Task');
    await createS6BLine(ws, { label: 's8b1', role: S6A_WORK_ROLE, tasks: [task] });
    let input: WorkflowAdvanceInput = { schemaVersion: 1, goalRef: world.goals.first,
      flowId: 's8b1-start', sessionHint: null, kind: 'select_work', taskId };
    for (let step = 0; step < 2; step += 1) {
      const answer = await world.post('workflow/advance', plain(S6A_SCOPE, input));
      const body = asRecord(answer.body) as unknown as WorkflowAdvanceResult;
      if (body.status !== 'ready') throw new Error(`S8B1-R: workflow/advance was not ready: ${JSON.stringify(answer.body)}`);
      if (body.value.next === null) break;
      input = body.value.next;
    }
    return { world, goal: world.goals.first, close: async () => await world.close() };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/** The no-Run goal world: the S6A world's second goal, no Plan and no Run. */
export async function openS8B1NoRunWorld(): Promise<{ world: S6ARequestWorld; goal: GoalRef; close(): Promise<void> }> {
  const world = await openS6ARequestWorld({ backend: 'memory' });
  return { world, goal: world.goals.second, close: async () => await world.close() };
}

/** The one `architecture/change-scope` call shape (`{scope,input}` on the plain route). */
export async function postS8B1ChangeScope(world: S6ARequestWorld, scope: { projectId: string; workspaceId: string },
  goalRef: GoalRef): Promise<{ httpStatus: number; body: unknown }> {
  return await world.post('architecture/change-scope', { scope, input: { goalRef } });
}

/** The change-scope body fields the rows read (the build's shape; count/complete typed locally). */
export type S8B1ChangeScope = {
  goalRef: GoalRef;
  files: Array<{ path: string; certainty: string; moduleRef: { projectId: string; moduleId: string } | null;
    interfaceId?: string | null }>;
  counts: { files: number; changed: number; possible: number };
  modules: Array<{ moduleRef?: { projectId: string; moduleId: string }; moduleId?: string;
    changed: number; possible: number }>;
  complete: boolean;
};

export function changeScopeOfBody(body: unknown): S8B1ChangeScope {
  const record = asRecord(body);
  if (record['status'] !== 'ready') throw new Error(`S8B1-R: change-scope was not ready: ${JSON.stringify(body)}`);
  return record['value'] as unknown as S8B1ChangeScope;
}

export const MODULE_ID = 'ag2b-work';

/** The same `{scope,input}` call on the AG2b Host handle (B1-06/B1-10). */
export async function postS8B1ChangeScopeOn(host: AG2bHost, scope: { projectId: string; workspaceId: string },
  goalRef: GoalRef): Promise<{ httpStatus: number; body: unknown }> {
  const answer = await corePost(host.base, 'architecture/change-scope', host.token,
    { scope, input: { goalRef } });
  return { httpStatus: answer.status, body: await answer.json() as unknown };
}
