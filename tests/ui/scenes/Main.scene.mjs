/**
 * The Main board-check scene with the right panel's two states (T-B19, test sheet §1.4, lead ruling 9).
 * `Main.scene.json` is the 有 state: a plan, a catalog, listed files and changed files. Open it with
 *   --scene tests/ui/scenes/Main.scene.mjs --query '?goal=scene-goal'
 * The 无 state is the scene's third Goal, which has no adopted Plan (`goals/list` says so):
 *   --scene tests/ui/scenes/Main.scene.mjs --query '?goal=scene-goal-3'
 * Its `tasks/query` and `graph/hover` answer `not_found` (a Goal without a Plan, `boot.ts` readNav and
 * readAuxPanel). The workspace routes carry no Goal, so they answer by the Goal the page opened on, the
 * one its scope read (`goals/read`, `boot.ts` taskMapScope) names: under the 无 Goal there is no adopted
 * architecture (`architecture/read` `not_found`), no current work and an empty listing, so 文件 lists no
 * file and Diff no change (an empty listing reads no `files/uncommitted`). Only the right panel is scened
 * twice: the goal bar keeps the 有 Goal's `goals/display`.
 */
import { readFileSync } from 'node:fs';

const HAVE = JSON.parse(readFileSync(new URL('./Main.scene.json', import.meta.url), 'utf8'));
const NONE_GOAL = 'scene-goal-3';
const NOT_FOUND = { status: 'rejected', code: 'not_found', reason: 'not in the Main scene' };

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
};

/** The Goal the page opened on: the last `goals/read` it sent. */
let pageGoal = null;

export const scene = {
  now: HAVE.now,
  routes: HAVE.routes,
  reply(route, input) {
    if (route === 'goals/read') pageGoal = input?.goalId ?? null;
    if ((route === 'tasks/query' || route === 'graph/hover') && input?.goalRef?.goalId === NONE_GOAL) return NOT_FOUND;
    if (pageGoal === NONE_GOAL && route in NONE) return NONE[route];
    return HAVE.routes[route];
  },
};
