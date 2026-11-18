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
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const HAVE = JSON.parse(readFileSync(new URL('./Main.scene.json', import.meta.url), 'utf8'));
const NONE_GOAL = 'scene-goal-3';
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

/** The Goal the page opened on: the last `goals/read` it sent. */
let pageGoal = null;

export const scene = {
  now: HAVE.now,
  routes: HAVE.routes,
  reply(route, input) {
    if (route === 'goals/read') pageGoal = input?.goalId ?? null;
    if ((route === 'tasks/query' || route === 'graph/hover') && input?.goalRef?.goalId === NONE_GOAL) return NOT_FOUND;
    if (pageGoal === NONE_GOAL && route in NONE) return NONE[route];
    if (route === 'files/read' && input?.path === CORE_PATH) return input?.version?.kind === 'git' ? NOT_FOUND : CORE;
    if (route === 'files/read' && input?.version?.kind === 'git') return OLD_VIEWS;
    return HAVE.routes[route];
  },
};
