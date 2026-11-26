/**
 * The TaskMap board-check scene for the stop success path (N10). `TaskMap.scene.json` is the
 * static scene: T13 is running `scene-run-1`, its line has an available cancel control, and
 * `graph/detail` answers so a selected Task keeps its detail. This wrapper adds only the two
 * live answers the success path needs: `controls/submit` commits once, and `executions/read`
 * then says `desiredState: cancelled` for that Run, so the page draws 停止请求中.
 * Open it with
 *   --scene tests/ui/scenes/TaskMap.scene.mjs --query '?goal=g1'
 * The JSON alone still opens the page and the confirm card; without this wrapper the answer
 * stays `running` and the 停止请求中 state cannot be reached.
 */
import { readFileSync } from 'node:fs';

const HELPER = (await import('../helpers/task-map-scene.ts')).scene;
const HAVE = JSON.parse(readFileSync(new URL('./TaskMap.scene.json', import.meta.url), 'utf8'));
const RUN = 'scene-run-1';
const READ = HAVE.routes['executions/read'];
let cancelled = false;

/* D42-2: one page of two anchors (one unclaimed, one picked up) for the
   selected Task's 关系; the Task itself is the first one a test selects. */
const anchor = (id, cause, changed, picked) => ({
  anchor: {
    ref: { aggregateType: 'SessionAnomalyAnchor', projectId: 'ple34b', goalId: 'g1', runId: id },
    revision: 1, schemaVersion: 1, workspaceId: 'scene',
    task: { projectId: 'ple34b', goalId: 'g1', taskId: 'T15' },
    planRef: { aggregateType: 'PlanRevision', projectId: 'ple34b', planId: 'ple34b-scene-plan' },
    lineHead: { projectId: 'ple34b', sessionId: 'T15' }, sessionRef: { projectId: 'ple34b', sessionId: 'T15' },
    role: { projectId: 'ple34b', roleId: 'executor' }, runRef: { aggregateType: 'Run', projectId: 'ple34b', goalId: 'g1', runId: id },
    attemptRef: { attemptId: id + '-attempt' }, cause,
    archiveRequestId: 'scene-archive', archiveRequestReceipt: {},
    archivedBy: { kind: 'human', id: 'scene' }, recordedAt: '2026-10-04T13:50:00+08:00',
    changedFiles: changed, resultVerification: 'not_checked',
  },
  line: { key: { projectId: 'ple34b', sessionId: 'T15' }, duty: 'executor',
    name: { source: 'running_task', primary: '执行者 · 启动核对', extraCount: 0, tasks: [], complete: true },
    status: { own: 'idle' } },
  problem: null, pickedUpBy: picked,
});
const KNOWN = { source: 'kernel', status: 'known', confirmed: ['src/scene-anchor.txt'], possible: [],
  omitted: 0, baseCommit: null, runBaselineKnown: false, reason: null };
const ANOMALIES = { status: 'ready', value: { section: 'anomalies', items: [
  anchor('scene-anchor-1', 'archive_interrupted', KNOWN, null),
  anchor('scene-anchor-2', 'retired_archive', { ...KNOWN, status: 'unavailable', confirmed: [], source: 'unknown' },
    { aggregateType: 'Run', projectId: 'ple34b', goalId: 'g1', runId: 'scene-run-2' }),
], nextCursor: null, sourceCursor: 'c0000000001' } };
const ROUNDS = { status: 'ready', value: { chain: { rounds: [
  { ordinal: 1, roundRef: { aggregateType: 'VerificationRound', projectId: 'ple34b', workspaceId: 'scene', goalId: 'g1', taskId: 'T15', runId: 's15-check', roundId: 's15-check' },
    revision: 1, status: 'finalized', displayStatus: 'incomplete', outcome: 'INCONCLUSIVE',
    counts: { total: 2, pass: 0, fail: 0, inconclusive: 2, pending: 0, executing: 0, interrupted: 0 }, failingCheckIds: [] },
  { ordinal: 2, roundRef: { aggregateType: 'VerificationRound', projectId: 'ple34b', workspaceId: 'scene', goalId: 'g1', taskId: 'T15', runId: 's15-check', roundId: 's15-check' },
    revision: 1, status: 'open', displayStatus: 'running', outcome: null,
    counts: { total: 2, pass: 0, fail: 0, inconclusive: 1, pending: 1, executing: 0, interrupted: 0 }, failingCheckIds: [] },
] } } };

export const scene = {
  now: HAVE.now,
  routes: HAVE.routes,
  reply(route, input) {
    if (route === 'controls/submit') {
      cancelled = true;
      return HAVE.routes['controls/submit'];
    }
    if (route === 'graph/detail' && input && input.section === 'anomalies') return ANOMALIES;
    if (route === 'verification/round') return ROUNDS;
    if (route === 'graph/detail') {
      const answer = HELPER.reply(route, input);
      if (input && input.section) answer.value.section = input.section;
      return answer;
    }
    if (route === 'executions/read') {
      const runId = input && input.runId ? input.runId : RUN;
      if (!cancelled || runId !== RUN) return READ;
      const answer = structuredClone(READ);
      answer.value.run.controlState = { desiredState: 'cancelled' };
      return answer;
    }
    return HAVE.routes[route];
  },
};
