/** The Goals board-check scene (7D2 batch 16b): both Goals read `goals/display`,
 * so the first is NEEDS_DECISION with its stopped Task and the second is RUNNING
 * and reads its driver's wait basis.
 *   --scene tests/ui/scenes/Goals.scene.mjs */
import { readFileSync } from 'node:fs';
const HAVE = JSON.parse(readFileSync(new URL('./Goals.scene.json', import.meta.url), 'utf8'));
const RUNNING = { phase: 'RUNNING', row: 'GOAL-27', cause: null, causes: [], runStops: null };
export const scene = {
  now: HAVE.now,
  routes: HAVE.routes,
  reply(route, input) {
    if (route !== 'goals/display') return HAVE.routes[route];
    const answer = structuredClone(HAVE.routes['goals/display']);
    if (input?.goalRef?.goalId === 'scene-goal-2') {
      answer.value.goal.ref.goalId = 'scene-goal-2';
      answer.value.display = RUNNING;
    }
    return answer;
  },
};
