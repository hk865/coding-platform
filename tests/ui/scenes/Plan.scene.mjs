/**
 * The Plan board-check scene with the same four Run blocks as Main.
 * `Plan.scene.json` is the 有 state; this wrapper gives req-1/2/3 their own Run and answers
 * `executions/steps` by `input.ref.runId` (not_started, ended with a next page, unknown, live), plus
 * one long running command and a ready `queries/cancel`.
 *   --scene tests/ui/scenes/Plan.scene.mjs --query '?goal=scene-goal'
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sceneLine } from './scene-line.mjs';

const HAVE = JSON.parse(readFileSync(new URL('./Plan.scene.json', import.meta.url), 'utf8'));
/* 5b's right panel reads, answered as the Main scene answers them (the same e3w-scene workspace). */
const MAIN = JSON.parse(readFileSync(new URL('./Main.scene.json', import.meta.url), 'utf8'));
const AUX = ['graph/hover', 'architecture/read', 'architecture/work-scope', 'files/list',
  'files/uncommitted', 'verification/installed-checks'];
const workingFiles = {
  'README.md': '# 工作台\n\n运行项目前先确认工作区。\n',
  'src/app/core-routes.ts': "export const coreRoutes = [\n  'files/read',\n  'files/uncommitted',\n];\n",
  'src/ui/views.ts': MAIN.routes['files/read'].value.content,
};
const headFiles = { 'README.md': workingFiles['README.md'], 'src/ui/views.ts': 'export function views(list) {\n' };
const digest = (text) => createHash('sha256').update(text).digest('hex');
const requestRef = (queryJobId) => ({ aggregateType: 'QueryJob', projectId: 'e3w-scene', workspaceId: 'e3w-scene', queryJobId });
const submitted = new Map();

function fileReply(route, input) {
  const { path, version } = input;
  const content = (version?.kind === 'git' ? headFiles : workingFiles)[path];
  if (content === undefined) return { status: 'rejected', code: 'not_found' };
  const revision = digest(content);
  if (route === 'files/save') {
    if (input.expectedRevision !== revision) return { status: 'rejected', code: 'source_stale' };
    workingFiles[path] = input.content;
    return { status: 'ready', value: { path, oldRevision: revision, revision: digest(input.content), byteLength: Buffer.byteLength(input.content) } };
  }
  return { status: 'ready', value: { path, version, content, digest: revision, digestBasis: 'raw_bytes',
    sizeBytes: Buffer.byteLength(content), readAt: MAIN.routes['files/read'].value.readAt } };
}
const LINE = sceneLine({ projectId: 'e3w-scene', workspaceId: 'e3w-scene', goalId: 'scene-goal',
  sessionId: 'scene-executor', name: '执行者 · 场景线' });
HAVE.routes['lines/list'].value.rows[1] = LINE.lineRow;
const qr = (job, run) => ({ aggregateType: 'QueryRun', projectId: 'e3w-scene', workspaceId: 'e3w-scene', queryJobId: job, runId: run });
const MR = structuredClone(HAVE.routes['main/read']);
for (const request of MR.value.requests) for (const round of request.rounds) {
  if (!('runRef' in round)) round.runRef = null;
  const id = request.requestRoot.queryJobId;
  if (id === 'scene-req-1') round.runRef = qr(id, 'scene-run-1');
  if (id === 'scene-req-2') round.runRef = qr(id, 'scene-run-2');
  if (id === 'scene-req-3') round.runRef = qr(id, 'scene-run-3');
}
/* 4c: the selected candidate, its facts and the stale variant on the second Goal. */
const TASKS = HAVE.routes['tasks/query'].value;
const GAP_ROW = TASKS.tasks.find((task) => task.ref.taskId === 'scene-work-2');
GAP_ROW.failure.round.gapCodes = ['uncovered_requirement'];
GAP_ROW.failure.automation.verdict = { kind: 'stopped', reason: 'verification_uncovered', detail: {} };
const DRAFT = {
  ...structuredClone(TASKS.plan),
  tasks: TASKS.tasks.map((task) => ({ ...task.definition })),
  obligations: [{ obligationId: 'scene-ob', title: '场景验收', requirementLevel: 'required',
    taskIds: TASKS.tasks.map((task) => task.ref.taskId),
    verificationRequirements: [{ requirementId: 'scene-check', requirementLevel: 'required', kind: 'static',
      description: 'npm run typecheck' }] }],
};
const CANDIDATE = {
  ref: { aggregateType: 'PlanProposal', projectId: 'e3w-scene', workspaceId: 'e3w-scene', proposalId: 'scene-candidate' },
  revision: 2, status: 'candidate', issues: [], draft: DRAFT,
};
const CANDIDATE_READ = (stale) => ({ status: 'ready', value: {
  head: stale ? { ...CANDIDATE, status: 'stale' } : CANDIDATE, status: stale ? 'stale' : 'candidate',
  closedReason: null, previous: null,
  impact: { marks: [{ taskId: 'scene-work-2', change: 'changed', after: { task: { title: '改重叠文件二' } } }] },
} });
const CANDIDATE_FACTS = (stale) => ({ status: 'ready', value: {
  card: { candidateStatus: stale ? 'stale' : 'candidate', staleReason: stale ? '来源已撤回' : null },
  diagnosis: [{ obligationId: 'scene-ob', requirementId: 'scene-req', kind: 'static', code: 'no_registered_check',
    message: '检查「scene static」还没有登记，采用后不会跑。' }],
  exactReview: { status: 'ready', value: { status: 'decided', verdict: 'fix', findings: [
    { taskId: 'scene-work-1', text: '改重叠文件一 要补一条检查' },
    { taskId: null, text: '总述里写清谁改哪一段' },
  ] } },
  exportRead: { status: 'ready', stages: [
    { state: 'written', stageId: 'S1', path: 'docs/taskbooks/scene-S1.md', bytes: 2048 },
    { state: 'missing', stageId: 'S2', path: 'docs/taskbooks/scene-S2.md' },
  ] },
  standardChange: { status: 'ready', value: null },
} });
/* The completed-Goal request's source and the plan notice (a deviation summary). */
const DONE_GOAL = {
  ...HAVE.routes['goals/list'].value.goals[0],
  ref: { ...HAVE.routes['goals/list'].value.goals[0].ref, goalId: 'scene-goal-done' },
  ordinal: 4, objective: '场景已完成目标', order: 4,
  activePlanRevision: null,
  display: { phase: 'COMPLETED' },
};
const GOALS = {
  ...HAVE.routes['goals/list'],
  value: { ...HAVE.routes['goals/list'].value,
    goals: [...HAVE.routes['goals/list'].value.goals, DONE_GOAL] },
};
const SOURCE_REQUEST = MR.value.requests.find((request) => request.requestRoot.queryJobId === 'scene-req-1');
SOURCE_REQUEST.source = { goalRef: { goalId: DONE_GOAL.ref.goalId } };
const PLAN_NOTICE = (goalId) => ({ itemKey: `deviation-notice:${goalId}:scene`, category: 'plan_notice',
  subject: { kind: 'goal', goalRef: { aggregateType: 'Goal', projectId: 'e3w-scene', goalId } },
  position: { kind: 'commit', cursor: 'c0000000002', itemKey: `deviation-notice:${goalId}:scene` },
  summary: 'usage: 2100000; growth: 2100000\nlines: 21 (added 21, deleted 0)\nchanged files: src/ui/views.ts'
    + ' · 参谋不改计划 · 场景：这一版不改计划', objects: [], rework: null });
MR.value.notices.push(PLAN_NOTICE('scene-goal'));
const MR2 = structuredClone(MR);
MR2.value.goalId = 'scene-goal-2';
MR2.value.notices = [PLAN_NOTICE('scene-goal-2')];
/* The stop card the gap row's button also opens. */
const UNCOVERED = {
  cardKey: 'scene-uncovered', state: 'waiting_answer', readOnly: false, actions: ['answer'],
  source: { kind: 'goal_cause', key: JSON.stringify({ code: 'verification_uncovered' }),
    subject: { kind: 'goal', goalRef: { aggregateType: 'Goal', projectId: 'e3w-scene', goalId: 'scene-goal' } },
    pins: [{ ref: { aggregateType: 'Goal', projectId: 'e3w-scene', goalId: 'scene-goal' }, revision: 1 }] },
  subject: { kind: 'goal', goalRef: { aggregateType: 'Goal', projectId: 'e3w-scene', goalId: 'scene-goal' } },
  senderSessionRef: null, requestRef: null, objects: [], options: [], answerMessageRef: null, answer: null,
  application: null, candidateStatus: null, staleReason: null, closedReason: null,
  openedAt: '2026-11-07T00:50:00.000Z',
  taskRef: { projectId: 'e3w-scene', goalId: 'scene-goal', taskId: 'scene-work-2' }, runRef: null,
};
HAVE.routes['decisions/queue'].value.waitingAnswer.push(UNCOVERED);
HAVE.routes['decisions/queue'].value.counts.waitingAnswer += 1;
MR.value.cards.push(UNCOVERED);
MR2.value.cards.push({ ...UNCOVERED, subject: { kind: 'goal', goalRef: { aggregateType: 'Goal', projectId: 'e3w-scene', goalId: 'scene-goal-2' } } });

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

export const scene = {
  now: HAVE.now,
  routes: { ...HAVE.routes, 'main/read': MR, 'goals/list': GOALS },
  reply(route, input) {
    const line = LINE.reply(route, input);
    if (line !== undefined) return line;
    if (route === 'files/read' || route === 'files/save') return fileReply(route, input);
    if (route === 'requests/ask') return { status: 'queued', followupRound: requestRef(input.commandId) };
    if (route === 'requests/submit') {
      const round = requestRef(input.commandId);
      const root = input.continues ?? round;
      const parent = submitted.get(root.queryJobId) ?? MR.value.requests.find((item) => item.requestRoot.queryJobId === root.queryJobId);
      const secretary = HAVE.routes['requests/read'].value.owner;
      const history = parent?.rounds ?? [];
      const goalId = parent?.goalId ?? input.goalId;
      const queued = {
        ref: round, runRef: null, kind: input.continues ? 'followup' : 'request', status: 'queued', input: input.text, references: input.references,
        answer: null, ideas: [], goalCardDrafts: [], selectedIdea: null, assignedSession: secretary, session: null,
        absorbedInto: null, closeCode: null, closeDetail: null, closeMessage: null, since: HAVE.routes['goals/list'].value.sourceCursor,
      };
      submitted.set(root.queryJobId, {
        requestRoot: root, goalId, effectiveGoalId: goalId, processing: true, assignment: 'assigned', owner: secretary,
        ownerState: 'owned', waitReason: null, reasons: ['round'], rounds: [...history, queued], candidate: null, cards: [],
      });
      return { status: 'queued', requestRoot: root, round, assignment: 'assigned', secretary, created: false, waitReason: null };
    }
    if (route === 'requests/read' && submitted.has(input.requestRoot.queryJobId)) {
      return { status: 'ready', value: submitted.get(input.requestRoot.queryJobId) };
    }
    if (route === 'goals/list') return GOALS;
    if (route === 'main/read') return input?.goalId === 'scene-goal-2' ? MR2 : MR;
    if (route === 'plans/request-candidate') {
      return input?.goalRef?.goalId === 'scene-goal-2' ? CANDIDATE_READ(true) : CANDIDATE_READ(false);
    }
    if (route === 'decisions/candidate-card') {
      return input?.goalRef?.goalId === 'scene-goal-2' ? CANDIDATE_FACTS(true) : CANDIDATE_FACTS(false);
    }
    if (route === 'plans/apply') return { status: 'rejected', code: 'busy', reason: 'stopping_affected_work' };
    if (route === 'executions/steps') {
      const run = input?.ref?.runId;
      if (run === 'scene-run-2') return input.after === 7 ? MORE : ENDED;
      if (run === 'scene-run-3') return UNKNOWN;
      if (run === 'scene-run-1') return NOT_STARTED;
      return LIVE;
    }
    if (route === 'executions/running-commands') return { status: 'ready', value: { items: [RUNNING] } };
    if (route === 'queries/cancel') return { status: 'ready', value: { cancelled: true } };
    if (AUX.includes(route)) return MAIN.routes[route];
    return HAVE.routes[route];
  },
};
