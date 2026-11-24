/**
 * The ArchOverview board-check scene (7D2 batch 10): `ArchOverview.scene.json` is the sample the
 * page already draws; this file adds the two caption rows the page reads per workspace and splits
 * them by whether the page opened with a Goal. The scene knows the Goal the page opened on by the
 * `goals/read` it sent (`boot.ts` taskMapScope), the way `Main.scene.mjs` does.
 *
 * 有 Goal (an adopted architecture, a finished initialization and one deepen in flight):
 *   --scene tests/ui/scenes/ArchOverview.scene.mjs --query '?goal=arch-goal'
 * 无 Goal (the same workspace, its cold start stopped by the person):
 *   --scene tests/ui/scenes/ArchOverview.scene.mjs
 * 无 Goal, cold start running (to shoot a successful stop):
 *   SCENE_MODE=running --scene tests/ui/scenes/ArchOverview.scene.mjs
 *
 * The two `role-lines/operations` rows follow `role-line-operations-read.ts`'s `action:'role_line'`
 * shape; `knowledge/status` is `{branch,dirty,files,localOnly}`, so the bar's 处 is `dirty` (3) and
 * the confirmation box's 个文件 is `files` (2). The four writes answer success and move this state,
 * so the reread after the click shows the stopped/continued/deepened/committed page.
 */
import { readFileSync } from 'node:fs';

const HAVE = JSON.parse(readFileSync(new URL('./ArchOverview.scene.json', import.meta.url), 'utf8'));
const P = 'coding-platform';
const MODE = process.env.SCENE_MODE || 'base';

const coldStart = (phase, result) => ({
  operation: { aggregateType: 'CoreOperation', projectId: P, operationId: 'cold_start:' + P },
  action: 'role_line', phase, actionPhase: phase === 'completed' ? 'done' : 'regions',
  result, plannedRounds: 3, followUp: null,
});
const deepenRow = (moduleId) => ({
  operation: { aggregateType: 'CoreOperation', projectId: P,
    operationId: 'exploration_followup:deepen:' + moduleId },
  action: 'role_line', phase: 'running', actionPhase: 'regions', result: null, plannedRounds: 1,
  followUp: { kind: 'deepen', moduleRefs: [{ projectId: P, moduleId }], reason: null, sourceBatchRef: null },
});

/** The writes' answers and the state their reread shows; one process keeps one page's state. */
const S = { cold: MODE === 'running' ? 'running' : 'waiting',
  deepening: ['src/core/work-graph'], dirty: 3, files: 2 };
const committedAnswer = (value) => ({ status: 'committed', value: value ?? {} });
const readyAnswer = (value) => ({ status: 'ready', value });

/** No Goal: the cold start's current state; stop and continue move it. */
const noGoal = () => [coldStart('running',
  S.cold === 'waiting' ? { status: 'waiting', reason: 'stopped_by_person' } : null)];

/** 有 Goal: the initialization finished, and one deepen covers src/core/work-graph. */
const withGoal = () => [coldStart('completed', { status: 'done', reason: null }), ...S.deepening.map(deepenRow)];

/** The Goal the page opened on: the last `goals/read` it sent; null means no `?goal=`. */
let pageGoal = null;

export const scene = {
  now: HAVE.now,
  routes: HAVE.routes,
  reply(route, input, body) {
    const winput = body && body.request ? body.request.input : null;
    if (route === 'goals/read') pageGoal = input?.goalId ?? null;
    if (route === 'role-lines/operations') return readyAnswer(pageGoal === null ? noGoal() : withGoal());
    if (route === 'knowledge/status') {
      return readyAnswer(pageGoal === null
        ? { branch: 'main', dirty: 0, files: 0, localOnly: false }
        : { branch: 'main', dirty: S.dirty, files: S.files, localOnly: false });
    }
    if (route === 'workspaces/exploration/stop') {
      S.cold = 'waiting';
      return committedAnswer({ status: 'stopped' });
    }
    if (route === 'workspaces/exploration/continue') {
      S.cold = 'running';
      return committedAnswer({ status: 'continued' });
    }
    if (route === 'workspaces/exploration/deepen') {
      const moduleId = winput && winput.module ? winput.module.moduleId : '';
      if (moduleId !== '' && !S.deepening.includes(moduleId)) S.deepening.push(moduleId);
      return committedAnswer({ followUp: 'deepen' });
    }
    if (route === 'knowledge/commit') {
      S.dirty = 0;
      S.files = 0;
      return readyAnswer({ commit: 'abc1234', files: 2 });
    }
    return HAVE.routes[route];
  },
};
