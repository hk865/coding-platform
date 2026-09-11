import { afterEach, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { ReviewerDispatch } from '../../src/control/dispatch-engine/reviewer-dispatch.js';
import { CodingAgentRuntime } from '../../src/execution/worker-runtime/coding-agent-runtime.js';
import type { RunPort } from '../../src/contracts/ports.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { ReviewWorkRef } from '../../src/contracts/reviewer-work.js';
import type { ReviewExecutionObservation } from '../../src/contracts/reviewer-work.js';
import { reviewerFixture, scope } from '../verification/reviewer-fixture.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

/** The dispatcher under test, wired like the production composition root: the
 *  grant port is the host port that advances the projection after the canonical
 *  commit, and the Control methods stay bound to their engine instance. */
function dispatchFor(f: Awaited<ReturnType<typeof reviewerFixture>>, runtime: CodingAgentRuntime,
  execution: RunPort, observations: { all: () => ReviewExecutionObservation[] }) {
  return new ReviewerDispatch({ ledger: f.h.ledger,
    control: { startRun: command => f.h.control.startRun(command), runFact: command => f.h.control.runFact(command),
      grantMaterialAccess: command => f.h.grantMaterialAccess(command) },
    reviewControl: f.control.dispatch, context: f.reviewContext, runtime, execution, observations,
    vault: f.h.vault, now: () => '2026-09-10T08:00:02.000Z' });
}

it('keeps an unprovable reviewer start as outcome_unknown and never reruns the model', async () => {
  const f = await reviewerFixture(roots);
  const started = await f.service.startReview(scope, f.input);
  expect(started.review.work, JSON.stringify(started.review)).not.toBeNull();
  const workRef = started.review.work!.ref as ReviewWorkRef;
  const work = await f.work(workRef);

  let modelCalls = 0;
  const runtime = new CodingAgentRuntime(f.directory + '-runtime', async () => ({
    configuration: { revision: work.reviewerProfile.model.configurationRevision, provider: work.reviewerProfile.model.provider,
      model: work.reviewerProfile.model.model, baseUrl: work.reviewerProfile.model.baseUrl },
    client: { complete: async () => { modelCalls += 1; throw Error('model must not be called'); } } as never,
  }));
  roots.push(f.directory + '-runtime');
  await runtime.init();

  // (1) The start binding is committed but the executor is unreachable: the
  //     canonical Run stays `starting` and the public observation stays
  //     `prepared` with no events. This must never be reinterpreted as a known
  //     failure, and must never trigger a second session.
  const unreachable: RunPort = { capabilities: () => runtime.capabilities(),
    start: async () => { throw Error('executor unreachable after the start binding was committed'); } };
  const dispatch = dispatchFor(f, runtime, unreachable, runtime.observations);
  // (1) The start binding is committed but the executor is unreachable. The
  //     first drive cannot classify it; the second records the ambiguous state
  //     as unknown. It must never be reinterpreted as a known `crashed`
  //     failure, and no second session may be started.
  expect(await dispatch.drive(workRef)).toMatchObject({ status: 'incomplete', code: 'dispatch_interrupted' });
  expect(await dispatch.drive(workRef)).toMatchObject({ status: 'incomplete', code: 'runtime_outcome_unknown' });

  const afterFailure = await f.h.ledger.load(work.reviewerRunRef);
  expect((afterFailure as { snapshot: RunSnapshot }).snapshot)
    .toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
  expect((afterFailure as { snapshot: RunSnapshot }).snapshot.outcome).not.toBe('crashed');
  expect(runtime.all()).toHaveLength(1);
  expect(runtime.all()[0]).toMatchObject({ status: 'outcome_unknown', events: [], trace: [], usage: [] });
  expect(modelCalls).toBe(0);

  // (2) Further drives keep the terminal unknown fact and still execute
  //     nothing: no automatic rerun, no duplicate session.
  for (const _ of [1, 2]) {
    const again = await dispatch.drive(workRef);
    expect(again.status).toBe('incomplete');
    expect(again).not.toMatchObject({ code: 'already_bound' });
  }
  expect(runtime.all()).toHaveLength(1);
  expect(modelCalls).toBe(0);
  const stillUnknown = (await f.h.ledger.load(work.reviewerRunRef) as { snapshot: RunSnapshot }).snapshot;
  expect(stillUnknown).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
  expect(stillUnknown.revision).toBe(afterFailure && (afterFailure as { snapshot: RunSnapshot }).snapshot.revision);
  await runtime.close();
});
