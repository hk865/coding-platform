/**
 * K3 slice self-test for the §5.1 "存储读失败一次" harness seam
 * (docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md §5.1, K3-03):
 * `HostScenarioOptions.failNextLookupCommitOnce` and
 * `HostScenario.failNextLookupCommitOnce()` arm exactly ONE store-level
 * `lookupCommit` failure (`{ status: 'rejected', code: 'unavailable' }`); every
 * later call passes through to the real backend.
 *
 * The proof drives the public `goals/create` route on the running Host: its
 * `CreateGoal` admission starts with the idempotency `lookupCommit`, so a normal
 * call commits and an armed one is refused `unavailable`; the identical retry
 * then commits. Nothing reads the database and no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import { AG2B_PROJECT_REF, AG2B_SCOPE, AG2B_WORKSPACE_REF, graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { cleanupScenarios, openHostScenario } from './harness.js';

afterEach(cleanupScenarios);

/** A fresh `goals/create` core-route body for one new Goal inside the seeded AG2b scope. */
function goalBody(requestId: string, goalId: string) {
  return graphWrite(AG2B_SCOPE, { goalId, workspace: AG2B_SCOPE, objective: 'K3 store-wrapper seam probe' },
    requestId, [{ ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_WORKSPACE_REF, revision: 1 }]);
}

it('K3 seam (a): with no option a normal public write commits and injects no store failure', async () => {
  const h = await openHostScenario();
  const committed = await h.answer('goals/create', goalBody('k3-seam-a-1', 'k3-seam-a-goal'));
  expect(committed).toMatchObject({ status: 'committed' });
});

it('K3 seam (b): failNextLookupCommitOnce fails exactly the next lookupCommit; the identical retry commits', async () => {
  const h = await openHostScenario();
  h.failNextLookupCommitOnce();
  const body = goalBody('k3-seam-b-1', 'k3-seam-b-goal');
  const failed = await h.answer('goals/create', body);
  expect(failed).toMatchObject({ status: 'rejected', code: 'unavailable' });
  expect(String(failed['reason'])).toContain('the scenario store seam failed this lookupCommit once');
  // The one-shot is spent: the identical request now reaches the real backend and commits once.
  const retried = await h.answer('goals/create', body);
  expect(retried).toMatchObject({ status: 'committed' });
});

it('K3 seam (c): the boolean option arms the same one-shot for the first call after open', async () => {
  const h = await openHostScenario({ failNextLookupCommitOnce: true });
  const body = goalBody('k3-seam-c-1', 'k3-seam-c-goal');
  const failed = await h.answer('goals/create', body);
  expect(failed).toMatchObject({ status: 'rejected', code: 'unavailable' });
  const retried = await h.answer('goals/create', body);
  expect(retried).toMatchObject({ status: 'committed' });
});
