import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../../src/business/workflow/contracts.js';
import type { GoalRef } from '../../../src/contracts/ledger.js';
import { asRecord } from '../../../src/ui/values.js';
import { ag2bPlanDraft, graphWrite, plain } from '../../helpers/AG2b-collaboration-fixture.js';
import { S6A_POLICY_CONTENT } from '../../helpers/S6A-memory-fixture.js';
import { S6A_WORK_ROLE, type S6ARequestWorld } from '../../helpers/S6A-request-fixture.js';
import { bootPage, type BootedPage, type PageFetch } from './boot-page.js';
import {
  bootE3N, countRoute, forwardPage, newPageLog, routeOf, sleep, waitFor,
  type PageLog,
} from './E3N-page.js';

/**
 * E3A ArchOverview worlds (E3ARCH tests §1.2): the one architecture seed the
 * board's rows share. The catalog and the observation are reached only through
 * `architecture/adopt-initial` / `architecture/capture`; the files are the
 * capture's real input, never a record. The literals below are the test's own,
 * not read from the page or the adapter.
 */

export const E3A = {
  moduleName: 'WorkGraph',
  otherModule: 'Other',
  responsibility: '目标、任务与执行的正式事实',
  otherResponsibility: '另一个模块',
  filePath: 'src/module.ts',
  otherFile: 'src/other/other.ts',
  moduleId: 'src/core/work-graph',
  otherModuleId: 'other',
  noteText: '模块语义：只读源码',
} as const;

export type E3AWorld = typeof E3A;

function pins(world: S6ARequestWorld): unknown[] {
  return [
    { ref: { aggregateType: 'Project', projectId: world.scope.projectId }, revision: 1 },
    { ref: { aggregateType: 'Workspace', projectId: world.scope.projectId, workspaceId: world.scope.workspaceId }, revision: 1 },
  ];
}

function committedBody(body: unknown, what: string): Record<string, unknown> {
  const record = asRecord(body);
  if (record['status'] !== 'committed') throw new Error(`E3A: ${what} did not commit: ${JSON.stringify(body)}`);
  return asRecord(record['value']);
}

/** `sessions/create` answers `completed` (the operation's own status). */
function sessionCompleted(body: unknown, what: string): Record<string, unknown> {
  const record = asRecord(body);
  if (record['status'] !== 'completed') throw new Error(`E3A: ${what} did not complete: ${JSON.stringify(body)}`);
  return asRecord(record['value']);
}

/** `architecture/observation-state`'s value; a rejection throws with the body. */
export async function archObservationState(world: S6ARequestWorld): Promise<Record<string, unknown>> {
  const answer = await world.post('architecture/observation-state', plain(world.scope, { workspace: world.scope }));
  const body = asRecord(answer.body);
  if (body['status'] !== 'ready') throw new Error(`E3A: the observation state is not ready: ${JSON.stringify(answer.body)}`);
  return asRecord(body['value']);
}

function persistedRefOf(state: Record<string, unknown>): unknown {
  return asRecord(state['current'])['persistedRef'] ?? null;
}

/**
 * W1's architecture: `src/other/other.ts` (the capture input) plus the catalog
 * with WorkGraph and Other. `moduleFiles` adds further capture inputs under the
 * WorkGraph module; they are workspace files, never records. The registration's
 * L8 capture settles first; only a workspace without one is captured by the
 * test, with the one mapping §1.2 names. Returns the literals the rows assert.
 */
export async function seedArchWorld(world: S6ARequestWorld,
  options: { moduleFiles?: readonly string[] } = {}): Promise<E3AWorld> {
  await mkdir(join(world.root, 'src/other'), { recursive: true });
  await writeFile(join(world.root, E3A.otherFile), "import '../module';\n");
  for (const file of options.moduleFiles ?? []) {
    await mkdir(join(world.root, dirname(file)), { recursive: true });
    await writeFile(join(world.root, file), 'export const e3aSearchFile = 1;\n');
  }
  const scope = world.scope;
  committedBody((await world.post('architecture/adopt-initial', graphWrite(scope, {
    baselineId: 'e3a-baseline',
    description: 'E3A read-only architecture page',
    constraints: [],
    catalog: {
      requireDag: true,
      dependencies: [],
      modules: [
        { ref: { projectId: scope.projectId, moduleId: E3A.moduleId }, name: E3A.moduleName,
          responsibility: E3A.responsibility, paths: ['src'], interfaces: [] },
        { ref: { projectId: scope.projectId, moduleId: E3A.otherModuleId }, name: E3A.otherModule,
          responsibility: E3A.otherResponsibility, paths: ['src/other'], interfaces: [] },
      ],
    },
  }, 'e3a-adopt', pins(world)))).body, 'the architecture adoption');
  await world.settleDetached();
  let state = await archObservationState(world);
  if (persistedRefOf(state) === null) {
    committedBody((await world.post('architecture/capture', graphWrite(scope, {
      workspace: scope,
      mappings: [{ id: E3A.moduleId, kind: 'module', paths: ['src'] }],
      previous: null,
    }, 'e3a-capture', pins(world)))).body, 'the architecture capture');
    for (let turn = 0; turn < 500; turn += 1) {
      state = await archObservationState(world);
      if (persistedRefOf(state) !== null) break;
      await sleep(20);
    }
    if (persistedRefOf(state) === null) throw new Error('E3A: the observation did not settle');
  }
  return E3A;
}

/** The project's governance a Plan needs: the real policy install + activate. */
async function activateArchPolicy(world: S6ARequestWorld): Promise<void> {
  const scope = world.scope;
  const projectRef = { aggregateType: 'Project' as const, projectId: scope.projectId };
  const registration = await world.post('workspaces/registration',
    plain(scope, { projectId: scope.projectId, workspaceId: scope.workspaceId }));
  const projectRevision = Number(asRecord(asRecord(asRecord(registration.body)['value'])['project'])['revision']);
  const installed = committedBody((await world.post('completion-policies/install', graphWrite(scope, {
    policyId: 'e3a-policy', contentRevision: 1, content: S6A_POLICY_CONTENT,
  }, 'e3a-policy-install', [
    { ref: projectRef, revision: projectRevision },
    { ref: { aggregateType: 'CompletionPolicyRevision', projectId: scope.projectId, policyId: 'e3a-policy', revision: 1 }, revision: 0 },
  ]))).body, 'the policy install');
  committedBody((await world.post('completion-policies/activate', graphWrite(scope, {
    target: { ref: installed['ref'], digest: installed['contentDigest'] },
  }, 'e3a-policy-activate', [
    { ref: projectRef, revision: projectRevision },
    { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId: scope.projectId }, revision: 0 },
  ]))).body, 'the policy activation');
}

export type E3APlanTask = { taskId: string; title: string; plannedFiles: string[] };

export type E3APlan = {
  goal: GoalRef;
  tasks: readonly E3APlanTask[];
  lineName: string;
};

/**
 * The adopted Plan the task-colour and responsibility rows need (§1.2): the
 * AG2b draft with `plannedFiles`, then one executor line responsible for the
 * first work task through `sessions/create`'s `initialLinks`. The line's
 * derived name is that task's title, so the world's literal `执行者` is the name
 * both `lines/list` and the page show.
 */
export async function seedArchPlan(world: S6ARequestWorld,
  input: { tasks?: readonly E3APlanTask[] } = {}): Promise<E3APlan> {
  const goal = world.goals.first;
  const tasks = input.tasks ?? [{ taskId: 'e3a-work', title: '执行者', plannedFiles: [E3A.filePath] }];
  await activateArchPolicy(world);
  const base = ag2bPlanDraft(tasks.map((task) => task.taskId));
  const draft = {
    ...base,
    planId: 'e3a-plan',
    goalId: goal.goalId,
    tasks: base.tasks.map((task) => {
      const wanted = tasks.find((entry) => entry.taskId === task.taskId);
      return wanted === undefined ? task : { ...task, title: wanted.title, plannedFiles: [...wanted.plannedFiles] };
    }),
    assignments: tasks.map((task) => ({ taskId: task.taskId, role: 'builder', instruction: `E3A work ${task.taskId}` })),
  };
  const proposed = committedBody((await world.post('plans/propose', graphWrite(world.scope, {
    goalRef: goal, basedOn: null, draft, reason: { text: 'E3A read-only architecture page plan', sources: [] },
  }, 'e3a-propose'))).body, 'the Plan proposal');
  committedBody((await world.post('plans/apply', graphWrite(world.scope, {
    proposalRef: proposed['ref'], expectedProposalRevision: proposed['revision'], decisionRefs: [],
  }, 'e3a-apply'))).body, 'the Plan adoption');
  const first = tasks[0];
  if (first !== undefined) {
    sessionCompleted((await world.post('sessions/create', plain(world.scope, {
      workspace: world.scope, role: S6A_WORK_ROLE, recommendedRefs: [],
      initialLinks: [{ target: { kind: 'task', ref: { projectId: world.scope.projectId, goalId: goal.goalId, taskId: first.taskId } },
        relation: 'responsible' }],
      meta: { requestId: 'e3a-executor-line', expected: [] },
    }))).body, 'the executor line');
  }
  return { goal, tasks, lineName: first?.title ?? '' };
}

/**
 * §5.2 item 9's non-empty A5 world: one real Work Run through the public
 * Workflow, left live. `select_work` names the claim step and the next
 * `workflow/advance` performs it; the later prepare/start steps are not driven,
 * so the Run stays `starting` (a live status for `architecture/work-scope`)
 * with the Plan's `plannedFiles`, and no model call is needed. The wait is the
 * public work-scope read itself, never a fixed tick.
 */
export async function startWorkRun(world: S6ARequestWorld, plan: E3APlan): Promise<void> {
  const task = plan.tasks[0];
  if (task === undefined) throw new Error('E3A: startWorkRun needs one planned Task');
  let input: WorkflowAdvanceInput = {
    schemaVersion: 1, goalRef: plan.goal, flowId: 'e3a-work-scope', sessionHint: null,
    kind: 'select_work', taskId: task.taskId,
  };
  for (let step = 0; step < 2; step += 1) {
    const answer = await world.post('workflow/advance', plain(world.scope, input));
    const body = answer.body as WorkflowAdvanceResult;
    if (answer.httpStatus !== 200 || body.status !== 'ready') {
      throw new Error(`E3A: workflow/advance step ${step + 1}: ${JSON.stringify(answer.body)}`);
    }
    if (body.value.next === null) throw new Error(`E3A: workflow/advance step ${step + 1} named no next step`);
    input = body.value.next;
  }
  for (let turn = 0; turn < 500; turn += 1) {
    const answer = await world.post('architecture/work-scope', plain(world.scope, {}));
    const body = asRecord(answer.body);
    const counts = asRecord(asRecord(body['value'])['counts']);
    if (body['status'] === 'ready' && counts['files'] === task.plannedFiles.length) return;
    await sleep(20);
  }
  throw new Error('E3A: the live Run never appeared in architecture/work-scope');
}

/** One note anchored at the selected file, written by the person. The page
 * reads a file node's note by its `{kind:'file', path}` anchor (A13b). */
export async function writeArchNote(world: S6ARequestWorld): Promise<void> {
  const answer = await world.post('notes/write', plain(world.scope, {
    commandId: 'e3a-module-semantics',
    goalId: null,
    expectedPointerRevision: null,
    note: {
      kind: 'convention', topic: 'module-semantics', conclusion: E3A.noteText,
      anchor: { kind: 'file', path: E3A.filePath },
      extraAnchors: [], facts: [], basisFiles: [], structural: false,
      replaces: [], contradicts: [], coexistWith: [], body: 'body',
    },
  }));
  const write = asRecord(asRecord(answer.body)['write']);
  if (write['status'] !== 'accepted') throw new Error(`E3A: the note was not accepted: ${JSON.stringify(answer.body)}`);
}

/**
 * The no-observation row's boot: the workspace's registration always starts an
 * L8 capture, so this one route is answered as the state before any capture
 * (current null); every other read still goes to the real Host. The page's own
 * no-observation text is what the row checks.
 */
export async function bootArchMissingObservation(world: S6ARequestWorld, search?: string): Promise<{ page: BootedPage; log: PageLog }> {
  const log = newPageLog();
  const forward = forwardPage(world, log);
  const pageRequest: PageFetch = async (url, init, realFetch) => {
    if (routeOf(url) === 'architecture/observation-state') {
      return new Response(JSON.stringify({ status: 'ready', value: {
        current: null, previous: null, previousPersistedRef: null, autoCapture: null,
      } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return forward(url, init, realFetch);
  };
  const page = await bootPage({
    name: 'ArchOverview',
    ...(search === undefined ? {} : { search }),
    token: () => world.token,
    request: pageRequest,
  });
  return { page, log };
}

/** The two page reads every row shares; exported for the request-set row. */
export const ARCH_ROUTES = {
  read: 'architecture/read',
  state: 'architecture/observation-state',
  query: 'architecture/query',
  find: 'architecture/find',
  workScope: 'architecture/work-scope',
} as const;

export { bootE3N, countRoute, waitFor };
