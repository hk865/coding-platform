/**
 * The Main board-check scene with the right panel's two states (T-B19, test sheet §1.4, lead ruling 9).
 * `Main.scene.json` is the 有 state: a plan, a catalog, listed files and changed files. The four Run
 * blocks answer by `input.ref.runId`: not_started, ended (with a next page), unknown and the live one.
 * Open it with
 *   --scene tests/ui/scenes/Main.scene.mjs --query '?goal=scene-goal'
 * The 无 state is the scene's third Goal, which has no adopted Plan (`goals/list` says so):
 *   --scene tests/ui/scenes/Main.scene.mjs --query '?goal=scene-goal-3'
 * Its `tasks/query` and `graph/hover` answer `not_found` (a Goal without a Plan, `boot.ts` readNav and
 * readAuxPanel). The workspace routes carry no Goal, so they answer by the Goal the page opened on, the
 * one its scope read (`goals/read`, `boot.ts` taskMapScope) names: under the 无 Goal there is no adopted
 * architecture (`architecture/read` `not_found`), no current work and an empty listing, so 文件 lists no
 * file and Diff no change (an empty listing reads no `files/uncommitted`). Only the right panel is scened
 * twice: the goal bar keeps the 有 Goal's `goals/display`.
 * The Main line view borrows the Member world (as `MainLV` does in review):
 *   --scene tests/ui/scenes/Main.scene.mjs --query '?goal=s7c-goal'
 * Its task row carries an `awaiting_advice` review and its three messages carry
 * the withdrawal and the transfer pair, so the line view draws 我来处理 and the
 * three message facts.
 * 4b's Goal bar states and the two-step requeue dialog have their own Goals:
 *   --scene tests/ui/scenes/Main.scene.mjs --query '?goal=scene-goal-4b-paused'
 *   --scene tests/ui/scenes/Main.scene.mjs --query '?goal=scene-goal-4b-decide'
 *   --scene tests/ui/scenes/Main.scene.mjs --query '?goal=scene-goal-4b-cancelled'
 * `main/read` is the 有 state cleared to the Member Goal, `decisions/queue` has no sections,
 * `workspaces/registration` stays Main's, and every other route is Member's.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sceneLine } from './scene-line.mjs';
import { scene as MEMBER } from './Member.scene.mjs';
import { candidateScene } from './Decide.scene.mjs';

const HAVE = JSON.parse(readFileSync(new URL('./Main.scene.json', import.meta.url), 'utf8'));
const LINE = sceneLine({ projectId: 'e3w-scene', workspaceId: 'e3w-scene', goalId: 'scene-goal',
  sessionId: 'scene-executor', name: '执行者 · 场景线' });
HAVE.routes['lines/list'].value.rows[1] = LINE.lineRow;
const NONE_GOAL = 'scene-goal-3';
const S7C_GOAL = 's7c-goal';
const NOT_FOUND = { status: 'rejected', code: 'not_found', reason: 'not in the Main scene' };
/* Diff 页读两侧，按路径回答，截图里页头的文件和下面画的逐行才是同一个。清单第一个改动行 core-routes.ts（+4 −0）
   当新文件画：HEAD 一侧没有，工作区 4 行。其余路径照旧回 views.ts 的正文，HEAD 一侧少两行。 */
const VIEWS = HAVE.routes['files/read'];
const OLD_VIEWS = { ...VIEWS, value: { ...VIEWS.value, content: 'export function views(list) {\n', sizeBytes: 30 } };
const CORE_PATH = 'src/app/core-routes.ts';
const CORE_TEXT = "export const coreRoutes = [\n  'files/read',\n  'files/uncommitted',\n];\n";
const CORE = { ...VIEWS, value: { ...VIEWS.value, path: CORE_PATH, content: CORE_TEXT,
  digest: createHash('sha256').update(CORE_TEXT).digest('hex'), sizeBytes: Buffer.byteLength(CORE_TEXT) } };

const readGoal = HAVE.routes['goals/read'];
const workScope = HAVE.routes['architecture/work-scope'];
const NONE = {
  'goals/read': {
    ...readGoal,
    value: { ...readGoal.value, goal: { ...readGoal.value.goal, ref: { ...readGoal.value.goal.ref, goalId: NONE_GOAL }, objective: '场景目标三' } },
  },
  'architecture/read': NOT_FOUND,
  'architecture/work-scope': {
    ...workScope,
    value: { ...workScope.value, files: [], modules: [], counts: { runs: 0, files: 0, modules: 0 } },
  },
  'files/list': { status: 'ready', value: { paths: [], partial: false } },
  'verification/installed-checks': {
    status: 'ready',
    value: { configurationRevision: null, contentDigest: null, settings: null, checks: [] },
  },
};

const qr = (job, run) => ({ aggregateType: 'QueryRun', projectId: 'e3w-scene', workspaceId: 'e3w-scene', queryJobId: job, runId: run });
/* The four Runs of the 有 Goal. The JSON carries `runRef: null` for the old rounds (the contract);
   the .mjs gives req-1/2/3 their own Run so the four blocks are not_started, ended, unknown and live. */
const MR = structuredClone(HAVE.routes['main/read']);
for (const request of MR.value.requests) for (const round of request.rounds) {
  if (!('runRef' in round)) round.runRef = null;
  const id = request.requestRoot.queryJobId;
  if (id === 'scene-req-1') round.runRef = qr(id, 'scene-run-1');
  if (id === 'scene-req-2') round.runRef = qr(id, 'scene-run-2');
  if (id === 'scene-req-3') round.runRef = qr(id, 'scene-run-3');
}
/* 4a states live on the 有 Goal's page; the other Goals keep the base page and
   queue so their screenshots do not grow a second batch's rows. */
const MAIN_BASE = structuredClone(MR);
MAIN_BASE.value.cards = MAIN_BASE.value.cards.filter((card) => card.cardKey === 'scene-card-1');
MAIN_BASE.value.notices = MAIN_BASE.value.notices.filter((notice) => notice.itemKey === 'plan-adoption:scene-plan:1');
const QUEUE_BASE = structuredClone(HAVE.routes['decisions/queue']);
const candidateGoal = QUEUE_BASE.value.waitingAnswer[0].source.pins.find((pin) => pin.ref.aggregateType === 'Goal');
const candidates = candidateScene(candidateGoal, HAVE.routes.bootstrap.workspaces[0].scope.workspaceId);
QUEUE_BASE.value.waitingAnswer = QUEUE_BASE.value.waitingAnswer.filter((card) => !card.cardKey.startsWith('scene-card-4a'));
QUEUE_BASE.value.counts.waitingAnswer = QUEUE_BASE.value.waitingAnswer.length;
// Goal 2 opens on a conflict. Both paths are leaves in the Main catalog.
const [firstGoal, secondGoal] = HAVE.routes['goals/list'].value.goals;
const workspace = HAVE.routes.bootstrap.workspaces[0].scope;
const conflictSubject = { kind: 'goal', goalRef: secondGoal.ref };
const conflictKey = 'scene-goal-files';
const conflictCard = {
  ...QUEUE_BASE.value.waitingAnswer[0], cardKey: conflictKey, subject: conflictSubject, taskRef: null, runRef: null,
  source: { kind: 'goal_conflict', key: conflictKey, subject: conflictSubject,
    pins: [firstGoal, secondGoal].map(({ ref, revision }) => ({ ref, revision })) },
  objects: ['src/ui/views.ts', CORE_PATH].map((path) => ({ kind: 'file', workspace, path, label: path, digest: null })),
  options: [{ id: 'wait', label: '等前一个目标', effect: 'apply' }, { id: 'order', label: '调整顺序', effect: 'apply' },
    { id: 'parallel', label: '接受风险并行', effect: 'apply' }],
};
const LIVE = HAVE.routes['executions/steps'];
const ENDED = { status: 'ready', value: { kind: 'steps',
  summary: { startedAt: '2026-11-07T08:30:00+08:00', lastAt: '2026-11-07T08:34:00+08:00', live: false, reads: 2,
    changedFiles: { definite: 1, possible: 1, possiblyIncomplete: false }, commands: 1 },
  steps: [
    { kind: 'think', position: 1, at: '2026-11-07T08:30:05+08:00', text: { text: '第 2 轮检查停在类型检查，先看记录。\n第二行思考：按规格 §9 记为检查不完整。', truncated: true } },
    { kind: 'read', position: 2, callId: 'e-2', tool: 'read', status: 'done', startedAt: '2026-11-07T08:30:10+08:00', endedAt: '2026-11-07T08:30:11+08:00', error: null, path: 'src/checks/run.ts' },
    { kind: 'read', position: 3, callId: 'e-3', tool: 'read', status: 'failed', startedAt: '2026-11-07T08:30:20+08:00', endedAt: '2026-11-07T08:30:21+08:00', error: { code: 'not_found', message: { text: 'no such file', truncated: false } }, path: 'src/checks/missing.ts' },
    { kind: 'edit', position: 4, callId: 'e-4', tool: 'edit', status: 'done', startedAt: '2026-11-07T08:31:00+08:00', endedAt: '2026-11-07T08:31:01+08:00', error: null, path: 'plans/recheck-options.md', lines: { added: 46, deleted: 0 } },
    { kind: 'command', position: 5, callId: 'e-5', tool: 'run_readonly_command', status: 'done', startedAt: '2026-11-07T08:32:00+08:00', endedAt: '2026-11-07T08:32:41+08:00', error: null, command: { text: 'npm run typecheck', truncated: false }, exitCode: 2, stdout: { text: 'src/a.ts(3,1): error TS2304', truncated: false }, stderr: null },
    { kind: 'message', position: 6, callId: 'e-6', tool: 'send_message', status: 'done', startedAt: '2026-11-07T08:33:00+08:00', endedAt: '2026-11-07T08:33:00+08:00', error: null, to: { kind: 'person' }, text: { text: '类型检查有一个错误，已写进方案。', truncated: false } },
    { kind: 'tool', position: 7, callId: 'e-7', tool: 'graph_query', status: 'done', startedAt: '2026-11-07T08:33:30+08:00', endedAt: '2026-11-07T08:33:31+08:00', error: null, target: { text: '任务图：检查链与重新检查', truncated: false } },
  ], next: 7, runningFrom: null } };
const MORE = { status: 'ready', value: { kind: 'steps', summary: ENDED.value.summary,
  steps: [{ kind: 'read', position: 8, callId: 'e-8', tool: 'read', status: 'done', startedAt: '2026-11-07T08:33:40+08:00', endedAt: '2026-11-07T08:33:41+08:00', error: null, path: 'docs/refactor/STATE-MACHINES-SPEC.md' }],
  next: null, runningFrom: null } };
const UNKNOWN = { status: 'ready', value: { kind: 'unknown', reason: 'history_damaged', detail: 'kernel record 12 bad json' } };
const NOT_STARTED = { status: 'ready', value: { kind: 'not_started' } };
const RUNNING = {
  run: { kind: 'query', queryRunRef: qr('scene-req-4', 'scene-run-4') }, workspaceId: 'e3w-scene',
  sessionRef: { projectId: 'e3w-scene', sessionId: 'scene-secretary' }, callId: 'scene-call-5', tool: 'run_readonly_command',
  commandPreview: 'npm test', expectedMs: 300000, startedAt: '2026-11-07T08:47:00+08:00', elapsedMs: 13 * 60000, lineMs: 3600000, overLine: true,
};

/* 4b: the Goal bar's paused and decision states, and the two-step requeue's
 * dialog data. Each is opened with its own ?goal= so the screenshots do not
 * depend on one another. */
const FOUR_B = {
  'scene-goal-4b-paused': {
    name: '4b 暂停中的目标', phase: 'PAUSED', cause: null,
    causes: [],
    runStops: [
      { runRef: { aggregateType: 'Run', projectId: 'e3w-scene', goalId: 'scene-goal-4b-paused', runId: 'scene-4b-run-a' },
        stop: { kind: 'paused_interrupted', pausedBy: 'goal_fan_out' } },
      { runRef: { aggregateType: 'Run', projectId: 'e3w-scene', goalId: 'scene-goal-4b-paused', runId: 'scene-4b-run-b' },
        stop: { kind: 'stop_requested' } },
    ],
    liveRuns: [{ aggregateType: 'Run', projectId: 'e3w-scene', goalId: 'scene-goal-4b-paused', runId: 'scene-4b-run-a' }],
  },
  'scene-goal-4b-decide': {
    name: '4b 有一份计划改动', phase: 'NEEDS_DECISION',
    cause: { code: 'change_pending', proposalRef: { aggregateType: 'PlanProposal', projectId: 'e3w-scene', planId: 'scene-plan', proposalId: 'scene-4b-proposal' } },
    causes: [{ code: 'change_pending', proposalRef: { aggregateType: 'PlanProposal', projectId: 'e3w-scene', planId: 'scene-plan', proposalId: 'scene-4b-proposal' } }],
    runStops: null, liveRuns: [],
  },
  'scene-goal-4b-cancelled': {
    name: '4b 已取消、可重新入队', phase: 'CANCELLED', cause: null, causes: [], runStops: null, liveRuns: [],
  },
};
const fourBGoal = (id) => ({ ...HAVE.routes['goals/list'].value.goals[0],
  ref: { ...HAVE.routes['goals/list'].value.goals[0].ref, goalId: id }, objective: FOUR_B[id].name,
  ordinal: 9, order: 9, activePlanRevision: null, display: { phase: FOUR_B[id].phase } });
const FOUR_B_DISPLAY = (id) => ({ ...HAVE.routes['goals/display'], value: {
  ...HAVE.routes['goals/display'].value,
  goal: { ...HAVE.routes['goals/display'].value.goal,
    ref: { ...HAVE.routes['goals/display'].value.goal.ref, goalId: id }, objective: FOUR_B[id].name },
  display: { phase: FOUR_B[id].phase, row: 'GOAL-20', cause: FOUR_B[id].cause,
    causes: FOUR_B[id].causes, runStops: FOUR_B[id].runStops },
  liveRuns: FOUR_B[id].liveRuns, resumePending: [], reentryFailures: [],
} });
const COPY_CANDIDATES = [
  { messageRef: { aggregateType: 'SessionMessage', projectId: 'e3w-scene', workspaceId: 'e3w-scene', messageId: 'scene-4b-message-a' },
    version: 1, state: 'not_delivered', selectable: true, reason: null, retractable: true, retractReason: null },
  { messageRef: { aggregateType: 'SessionMessage', projectId: 'e3w-scene', workspaceId: 'e3w-scene', messageId: 'scene-4b-message-b' },
    version: 2, state: 'applied', selectable: false, reason: 'applied', retractable: false, retractReason: 'applied' },
];
const FOUR_B_TASKS = (() => {
  const reply = structuredClone(HAVE.routes['tasks/query']);
  const [first, second] = reply.value.tasks;
  first.ref.goalId = 'scene-goal-4b-paused';
  first.definition.title = '暂停中的工作一';
  first.execution = { aggregateType: 'Run', projectId: 'e3w-scene', goalId: 'scene-goal-4b-paused', runId: 'scene-4b-run-a' };
  second.ref.goalId = 'scene-goal-4b-paused';
  second.definition.title = '暂停中的工作二';
  second.execution = { aggregateType: 'Run', projectId: 'e3w-scene', goalId: 'scene-goal-4b-paused', runId: 'scene-4b-run-b' };
  return reply;
})();
const FOUR_B_COPY = { status: 'ready', value: {
  source: { goal: { aggregateType: 'Goal', projectId: 'e3w-scene', goalId: 'scene-goal-4b-cancelled' }, revision: 3 },
  objective: '4b 重新入队的目标', autonomy: 'after_plan_confirmation', order: 9,
  toReconfirm: { waitForGoalRef: null, parallelRisks: [] }, understanding: null,
  interventions: { available: true, candidates: COPY_CANDIDATES },
} };
const FOUR_B_BODIES = {
  'scene-4b-message-a:message': { status: 'ready', value: { messageRef: COPY_CANDIDATES[0].messageRef, part: 'message',
    text: '这一条旧的干预要在新目标里接着用', sourceRef: { kind: 'workspace', refId: 'e3w-scene', revision: '1' }, usage: 'message' } },
  'scene-4b-message-b:message': { status: 'ready', value: { messageRef: COPY_CANDIDATES[1].messageRef, part: 'message',
    text: '这一条已经生效了，不能再勾', sourceRef: { kind: 'workspace', refId: 'e3w-scene', revision: '1' }, usage: 'message' } },
};

const S7C_MAIN = structuredClone(MR);
S7C_MAIN.value.goalId = S7C_GOAL;
S7C_MAIN.value.requests = [];
S7C_MAIN.value.next = null;
S7C_MAIN.value.cards = [];
S7C_MAIN.value.notices = [];
const S7C_QUEUE = { status: 'ready', value: { ...QUEUE_BASE.value, sections: [] } };
/* 4a: the two writes the shot review clicks answer with success; the withdrawn
   snapshot then shows the check only in `withdrawnChecks`. */
let withdrawn4a = false;
const snapshot4a = () => {
  const value = structuredClone(HAVE.routes['settings/snapshot'].value);
  const workspace = value.workspaces[0];
  if (withdrawn4a) {
    workspace.checks = [];
    workspace.checkApprovals = [];
    workspace.withdrawnChecks = [{ checkId: 'scene-docs-check', withdrawnAt: '2026-11-07T00:59:00.000Z',
      plan: { proposalRef: { proposalId: 'scene-4a-cand' } } }];
  }
  return value;
};

/** The Goal the page opened on: the last `goals/read` it sent. */
let pageGoal = null;
let staleRead = false;
/* 1B: four right-panel states, chosen by ?goal=...; only these reads differ. */
const STATE = {
  'scene-goal-diff-side': { name: 'Diff 一侧不是 UTF-8', path: 'assets/legacy-note.txt', side: true, add: true, text: 'café au lait\n第二行能读\n第三行能读\n' },
  'scene-goal-diff-stale': { name: 'Diff 单文件读失败', path: 'src/ui/notes.ts', stale: true, add: true, text: 'export const notes = [\n  "下一行",\n];\n' },
  'scene-goal-conflict': { name: '冲突比较磁盘与草稿', path: 'README.md', text: '# E3W scene\n\n草稿改了这一行。\n' },
  'scene-goal-command': { name: '命令运行中与取消', command: true },
};
const stateGoal = (id) => ({ ...HAVE.routes['goals/list'].value.goals[0], ref: { ...HAVE.routes['goals/list'].value.goals[0].ref, goalId: id }, objective: STATE[id].name, order: 8, ordinal: 8, activePlanRevision: null });
const addFirst = (reply, key, value) => ({ ...reply, value: { ...reply.value, [key]: [value, ...reply.value[key]] } });
const stateFile = (s) => ({ ...VIEWS, value: { ...VIEWS.value, path: s.path, content: s.text,
  digest: createHash('sha256').update(s.text).digest('hex'), sizeBytes: Buffer.byteLength(s.text) } });
function stateReply(route, input) {
  const s = STATE[pageGoal];
  if (s === undefined) return undefined;
  if (route === 'goals/read') return { ...readGoal, value: { ...readGoal.value, goal: { ...readGoal.value.goal, ref: { ...readGoal.value.goal.ref, goalId: pageGoal }, objective: s.name } } };
  if (route === 'goals/display') return { ...HAVE.routes['goals/display'], value: { ...HAVE.routes['goals/display'].value, goal: { ...HAVE.routes['goals/display'].value.goal, ref: { ...HAVE.routes['goals/display'].value.goal.ref, goalId: pageGoal }, objective: s.name } } };
  if (route === 'goals/list') return { ...HAVE.routes['goals/list'], value: { ...HAVE.routes['goals/list'].value, goals: [...HAVE.routes['goals/list'].value.goals, ...Object.keys(STATE).map(stateGoal)] } };
  if (s.add && route === 'files/list') return addFirst(HAVE.routes[route], 'paths', s.path);
  if (s.add && route === 'files/uncommitted') return addFirst(HAVE.routes[route], 'files', { path: s.path, state: 'uncommitted', lines: { added: 3, deleted: 0 } });
  if (route === 'files/read' && input?.path === s.path) {
    if (s.side && input?.version?.kind === 'git') return { status: 'rejected', code: 'unsupported', reason: 'not UTF-8' };
    if (s.stale && !staleRead) { staleRead = true; return { status: 'rejected', code: 'source_stale', reason: 'moved' }; }
    if (s.add && input?.version?.kind === 'git') return NOT_FOUND;
    return stateFile(s);
  }
  if (route === 'files/save' && s.path === 'README.md') return { status: 'rejected', code: 'source_stale', reason: 'changed on disk' };
  if (s.command && route === 'commands/start') return { status: 'ready', value: { commandId: 'scene-command-running' } };
  if (s.command && route === 'commands/read') return { status: 'ready', value: { state: 'running', stdout: '', stderr: '', outputTruncated: false, exitCode: null, signal: null, timedOut: false, cancelled: false, error: null, executionMs: null } };
  if (s.command && route === 'commands/stop') return { status: 'ready', value: { commandId: input?.commandId } };
  return undefined;
}

export const scene = {
  now: HAVE.now,
  routes: { ...HAVE.routes, 'main/read': MR },
  reply(route, input, body) {
    if (route === 'goals/read') pageGoal = input?.goalId ?? null;
    if (pageGoal === 'scene-goal') {
      const candidate = candidates.reply(route, body?.request?.input ?? input);
      if (candidate !== undefined) return candidate;
      if (route === 'main/read') {
        const page = structuredClone(MR);
        page.value.cards.push(...candidates.waiting());
        return page;
      }
      if (route === 'decisions/queue') {
        const queue = structuredClone(HAVE.routes[route]);
        queue.value.waitingAnswer.push(...candidates.waiting());
        queue.value.counts.waitingAnswer = queue.value.waitingAnswer.length;
        return queue;
      }
    }
    if (pageGoal in FOUR_B) {
      if (route === 'goals/read') return { ...readGoal, value: { ...readGoal.value, goal: { ...readGoal.value.goal,
        ref: { ...readGoal.value.goal.ref, goalId: pageGoal }, objective: FOUR_B[pageGoal].name } } };
      if (route === 'goals/display') return FOUR_B_DISPLAY(pageGoal);
      if (route === 'goals/list') return { ...HAVE.routes['goals/list'], value: { ...HAVE.routes['goals/list'].value,
        goals: [...HAVE.routes['goals/list'].value.goals, ...Object.keys(FOUR_B).map(fourBGoal)] } };
      if (route === 'goals/copy-draft') return FOUR_B_COPY;
      if (route === 'tasks/query') return FOUR_B_TASKS;
      if (route === 'messages/body') return FOUR_B_BODIES[`${input?.messageRef?.messageId}:${input?.part}`] ?? NOT_FOUND;
    }
    const scened = stateReply(route, input);
    if (scened !== undefined) return scened;
    if (pageGoal === secondGoal.ref.goalId && route === 'decisions/queue') {
      return { ...QUEUE_BASE, value: { ...QUEUE_BASE.value, waitingAnswer: [conflictCard], counts: { ...QUEUE_BASE.value.counts, waitingAnswer: 1 } } };
    }
    if (route === 'graph/detail' && input.node?.ref?.taskId === 'scene-work-2') {
      const graph = HAVE.routes['tasks/query'].value;
      const row = graph.tasks.find((task) => task.ref.taskId === input.node.ref.taskId);
      const task = { ...row.definition, task: row.ref, planRef: graph.plan.ref, workspaceId: workspace.workspaceId };
      return { status: 'ready', value: { section: input.section, task, items: [], nextCursor: null } };
    }
    if (route === 'queries/cancel') return { status: 'ready', value: { cancelled: true } };
    if (route === 'decisions/answer') return { status: 'ready', value: { answer: { status: 'committed' } } };
    if (route === 'settings/snapshot') return { status: 'ready', value: snapshot4a() };
    if (route === 'settings/checks/withdraw') {
      withdrawn4a = true;
      return { status: 'ready', value: snapshot4a() };
    }
    if (route === 'main/read' && pageGoal !== 'scene-goal' && pageGoal !== S7C_GOAL) return MAIN_BASE;
    if (route === 'decisions/queue' && pageGoal !== 'scene-goal' && pageGoal !== S7C_GOAL) return QUEUE_BASE;
    if (pageGoal === S7C_GOAL) {
      if (route === 'main/read') return S7C_MAIN;
      if (route === 'decisions/queue') return S7C_QUEUE;
      if (route === 'workspaces/registration') return HAVE.routes['workspaces/registration'];
      if (route === 'tasks/query') {
        const reply = MEMBER.reply(route, input);
        if (reply?.value === undefined) return reply;
        return { ...reply, value: { ...reply.value, tasks: reply.value.tasks.map((task) => task.ref.taskId !== 's7c-m1'
          ? task : { ...task, unknownCallReview: {
            ref: { aggregateType: 'UnknownCallReview', projectId: 'ag2b-collab-project', goalId: 's7c-goal', runId: '3671ba29-7403-40da-ab76-b6ad47735275' },
            revision: 2, status: 'awaiting_advice', decisionReasons: [], activeRound: null, hold: null, remainingRoundSlots: 7,
          } }) } };
      }
      if (route === 'messages/view') {
        const reply = MEMBER.reply(route, input);
        if (reply?.value === undefined) return reply;
        const message = reply.value.message;
        const extra = message.ref.messageId === 'session-message-06d6b93735128a1cece7dbae2a8412eb070cfff4a23db6b59acd7a34b5af7621'
          ? { withdrawnAt: '2026-10-23T09:00:02.000Z' }
          : message.ref.messageId === 'session-message-53e59795223e856bd9998bb58f3c4efd4998bb974375ebdb60bfa6dfcbabd19a'
            ? { transferredTo: { aggregateType: 'SessionMessage', projectId: 'ag2b-collab-project', workspaceId: 'ag2b-collab-workspace', messageId: 'session-message-9c5585a96ff349229ee6f0d0ab32edcccd806c1bfb53eea717db9cf2b3669403' } }
            : message.ref.messageId === 'session-message-9c5585a96ff349229ee6f0d0ab32edcccd806c1bfb53eea717db9cf2b3669403'
              ? { originalRef: { aggregateType: 'SessionMessage', projectId: 'ag2b-collab-project', workspaceId: 'ag2b-collab-workspace', messageId: 'session-message-53e59795223e856bd9998bb58f3c4efd4998bb974375ebdb60bfa6dfcbabd19a' } }
              : {};
        return { ...reply, value: { ...reply.value, message: { ...message, ...extra } } };
      }
      return MEMBER.reply(route, input);
    }
    const line = LINE.reply(route, input);
    if (line !== undefined) return line;
    if ((route === 'tasks/query' || route === 'graph/hover') && input?.goalRef?.goalId === NONE_GOAL) return NOT_FOUND;
    if (pageGoal === NONE_GOAL && route in NONE) return NONE[route];
    if (route === 'main/read') return MR;
    if (route === 'executions/steps') {
      const run = input?.ref?.runId;
      if (run === 'scene-run-2') return input.after === 7 ? MORE : ENDED;
      if (run === 'scene-run-3') return UNKNOWN;
      if (run === 'scene-run-1') return NOT_STARTED;
      return LIVE;
    }
    if (route === 'executions/running-commands') return { status: 'ready', value: { items: [RUNNING] } };
    if (route === 'files/read' && input?.path === CORE_PATH) return input?.version?.kind === 'git' ? NOT_FOUND : CORE;
    if (route === 'files/read' && input?.version?.kind === 'git') return OLD_VIEWS;
    return HAVE.routes[route];
  },
};
