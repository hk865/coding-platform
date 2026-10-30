/**
 * WK's pure registration basis (fixture spec v2.2 §2, SR4 §7 W-F2): one `GoalWaitBasisV1` per goal for
 * the registry's `register` calls.
 *
 * Type imports only: no world, Host, platform, store or fixture is loaded, so the pure registry test
 * imports this file and still opens no world. `wake-world.ts` and the registry test import this one copy.
 */
import type { GoalWaitBasisV1 } from '../../src/business/workflow/contracts.js';

/** One `GoalWaitBasisV1` for the registry's `register` calls, with the WK wait's fixed reason. */
export function basisOf(
  projectId: string,
  goalId: string,
  recordKinds: GoalWaitBasisV1['recordKinds'],
): GoalWaitBasisV1 {
  return { projectId, goalId, recordKinds, reasons: ['wait_reply'] };
}
