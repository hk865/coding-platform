import { afterEach, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { ReviewerDispatch } from '../../src/control/reviewer-dispatch.js';
import { CodingAgentRuntime } from '../../src/runtime/coding-agent-runtime.js';
import type { RunPort } from '../../src/contracts/ports.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { ReviewWorkRef } from '../../src/contracts/reviewer-work.js';
import { reviewerFixture, scope } from '../verification/reviewer-fixture.js';

/**
 * PRE-FIX REPRODUCTION ONLY — runs in an isolated copy of the repository.
 *
 * Before the ERR-01 repair, `LeasedWorkerRuntime.start` acquired the read lease,
 * found it refused, and `throw`-n away from that point instead of using
 * `CodingAgentRuntime.rejectBeforeStart`. This test reproduces exactly that
 * contact surface (a `RunPort` that throws after the canonical start binding was
 * committed) against the real Control, Ledger, ReviewerDispatch, Vault and
 * CodingAgentRuntime, and records the wedge the external review reported.
 *
 * This file is evidence, not a product test: it is never placed in the product
 * test tree.
 */
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

it('PRE-FIX F-01: a refused reviewer read lease leaves the canonical run unreconcilable and the plan unreviewable', async () => {
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

  // Pre-fix contact surface: the lease was refused and `start` threw.
  const preFixExecution: RunPort = { capabilities: () => runtime.capabilities(),
    start: async () => { throw Error('工作区读租约被拒绝：read_lease_conflict'); } };
  const dispatch = new ReviewerDispatch({ ledger: f.h.ledger,
    control: { startRun: command => f.h.control.startRun(command), runFact: command => f.h.control.runFact(command),
      grantMaterialAccess: command => f.h.grantMaterialAccess(command) },
    reviewControl: f.control.dispatch, context: f.reviewContext, runtime, execution: preFixExecution,
    observations: runtime.observations, vault: f.h.vault, now: () => '2026-09-10T08:00:02.000Z' });

  const first = await dispatch.drive(workRef);
  const second = await dispatch.drive(workRef);
  const run = (await f.h.ledger.load(work.reviewerRunRef) as { snapshot: RunSnapshot }).snapshot;

  console.log('PREFIX first=' + JSON.stringify(first));
  console.log('PREFIX second=' + JSON.stringify(second));
  console.log('PREFIX canonicalRun=' + JSON.stringify({ status: run.status, outcome: run.outcome, revision: run.revision, lastEventSeq: run.lastEventSeq }));
  console.log('PREFIX publicObservation=' + JSON.stringify(runtime.all().map(r => ({ status: r.status, events: r.events.length, trace: r.trace.length, usage: r.usage.length }))));
  console.log('PREFIX modelCalls=' + modelCalls);

  // (1) The canonical Run and the persistent observation disagree.
  const changed = await f.work(workRef);
  console.log('PREFIX workOutput=' + JSON.stringify(changed.output));
  console.log('PREFIX workAfterFirst=' + JSON.stringify({ input: changed.input !== null, output: changed.output, resultRef: changed.resultRef }));

  // (2) The same task+plan can never obtain another ReviewWork: the same
  //     requestId replays the wedged work, and a NEW request is refused.
  const replay = await f.service.startReview(scope, f.input);
  console.log('PREFIX replaySameRequest=' + JSON.stringify({ phase: replay.review.phase,
    sameWork: JSON.stringify(replay.review.work?.ref) === JSON.stringify(workRef), gaps: replay.review.gaps }));

  const freshRequest = await f.service.startReview(scope, { ...f.input, requestId: 'review-request-after-wedge' });
  console.log('PREFIX freshRequest=' + JSON.stringify({ phase: freshRequest.review.phase, work: freshRequest.review.work,
    gaps: freshRequest.review.gaps, current: freshRequest.review.current }));

  // (3) The workspace's later verification sees reviewer_required forever.
  const later = await f.service.startRound(scope, { requestId: 'tools-after-wedge', allowExecute: true,
    configuration: { checks: [{ checkId: 'dynamic', kind: 'dynamic', command: 'mkdir -p .cache; printf y >> .cache/tool-count',
      cwd: '.', timeoutMs: 3000, appliesTo: { workspaceId: scope.workspaceId, taskIds: [scope.taskId] } }] } });
  console.log('PREFIX laterRoundGaps=' + JSON.stringify(later.round.gaps));

  // The pre-fix observation, recorded as-is: the canonical Run is terminally
  // `outcome_unknown` with no reconciling fact, the public observation agrees,
  // nothing reran, and no result was ever bound.
  expect(run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
  expect(run.outcome).not.toBe('crashed');
  expect(modelCalls).toBe(0);
  expect(runtime.all()).toHaveLength(1);
  expect(runtime.all()[0]).toMatchObject({ status: 'outcome_unknown', events: [], trace: [], usage: [] });
  expect(changed.output).toBeNull();
  expect(changed.resultRef).toBeNull();
  await runtime.close();
});
