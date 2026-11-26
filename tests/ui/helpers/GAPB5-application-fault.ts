import { vi } from 'vitest';
import * as decisionService from '../../../src/core/work-graph/communication/decision-service.js';

/**
 * GAPB-5 fault injection (A2): the first `recordDecisionApplication` answers
 * `unavailable`, so the person's answer commits and its application does not.
 *
 * The frozen row says “spy on the real Host's platform method”. In this tree
 * `decisions/answer` runs the Workflow's decision coordinator, which binds the
 * decision-message owner at composition (`workflow.ts:5219`), and the public
 * `platform.decisionMessages` object is a different wrapper (`create-platform.ts`).
 * Wrapping the factory's result is the same one-shot `unavailable` on the
 * method the Workflow really calls; after the Host is built the wrapper stays
 * installed on the owner the Workflow captured.
 *
 * Returns the restore function: call it right after the world is opened.
 */
export function failApplicationOnce(): () => void {
  let armed = true;
  const real = decisionService.createDecisionMessageService;
  const spy = vi.spyOn(decisionService, 'createDecisionMessageService').mockImplementation((deps) => {
    const owner = real(deps);
    const original = owner.recordDecisionApplication.bind(owner);
    owner.recordDecisionApplication = async (ctx, request) => {
      if (armed) {
        armed = false;
        return { status: 'rejected', code: 'unavailable', reason: 'GAPB5: the application commit is unavailable once' };
      }
      return await original(ctx, request);
    };
    return owner;
  });
  return () => spy.mockRestore();
}
