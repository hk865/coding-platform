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

export const scene = {
  now: HAVE.now,
  routes: HAVE.routes,
  reply(route, input) {
    if (route === 'controls/submit') {
      cancelled = true;
      return HAVE.routes['controls/submit'];
    }
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
