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
 * `main/read` is the 有 state cleared to the Member Goal, `decisions/queue` has no sections,
 * `workspaces/registration` stays Main's, and every other route is Member's.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { scene as MEMBER } from './Member.scene.mjs';

const HAVE = JSON.parse(readFileSync(new URL('./Main.scene.json', import.meta.url), 'utf8'));
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
const S7C_MAIN = structuredClone(MR);
S7C_MAIN.value.goalId = S7C_GOAL;
S7C_MAIN.value.requests = [];
S7C_MAIN.value.next = null;
S7C_MAIN.value.cards = [];
S7C_MAIN.value.notices = [];
const S7C_QUEUE = { status: 'ready', value: { ...HAVE.routes['decisions/queue'].value, sections: [] } };

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
  reply(route, input) {
    if (route === 'goals/read') pageGoal = input?.goalId ?? null;
    const scened = stateReply(route, input);
    if (scened !== undefined) return scened;
    if (route === 'queries/cancel') return { status: 'ready', value: { cancelled: true } };
    if (pageGoal === S7C_GOAL) {
      if (route === 'main/read') return S7C_MAIN;
      if (route === 'decisions/queue') return S7C_QUEUE;
      if (route === 'workspaces/registration') return HAVE.routes['workspaces/registration'];
      return MEMBER.reply(route, input);
    }
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
