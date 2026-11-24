/**
 * The Plan board-check scene with the same four Run blocks as Main.
 * `Plan.scene.json` is the 有 state; this wrapper gives req-1/2/3 their own Run and answers
 * `executions/steps` by `input.ref.runId` (not_started, ended with a next page, unknown, live), plus
 * one long running command and a ready `queries/cancel`.
 *   --scene tests/ui/scenes/Plan.scene.mjs --query '?goal=scene-goal'
 */
import { readFileSync } from 'node:fs';

const HAVE = JSON.parse(readFileSync(new URL('./Plan.scene.json', import.meta.url), 'utf8'));
const qr = (job, run) => ({ aggregateType: 'QueryRun', projectId: 'e3w-scene', workspaceId: 'e3w-scene', queryJobId: job, runId: run });
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

export const scene = {
  now: HAVE.now,
  routes: { ...HAVE.routes, 'main/read': MR },
  reply(route, input) {
    if (route === 'main/read') return MR;
    if (route === 'executions/steps') {
      const run = input?.ref?.runId;
      if (run === 'scene-run-2') return input.after === 7 ? MORE : ENDED;
      if (run === 'scene-run-3') return UNKNOWN;
      if (run === 'scene-run-1') return NOT_STARTED;
      return LIVE;
    }
    if (route === 'executions/running-commands') return { status: 'ready', value: { items: [RUNNING] } };
    if (route === 'queries/cancel') return { status: 'ready', value: { cancelled: true } };
    return HAVE.routes[route];
  },
};
