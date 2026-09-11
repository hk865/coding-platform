import { afterEach, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ReviewerDispatch } from '../../src/control/reviewer-dispatch.js';
import { LeasedWorkerRuntime } from '../../src/control/leased-worker-runtime.js';
import { CodingAgentRuntime } from '../../src/runtime/coding-agent-runtime.js';
import { buildAcquireWriteLeaseCommand, buildReleaseLeaseCommand } from '../../src/contracts/commands/workspace.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import { reviewerFixture, scope } from '../verification/reviewer-fixture.js';
import { P107_ROLE_BINDING_WRITER_V1 } from '../contract-suite/p1-07-harness.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

it('ends a reviewer run as known failed when its read lease is refused before model/tool start', async () => {
  const f = await reviewerFixture(roots);
  const started = await f.service.startReview(scope, f.input);
  expect(started.review.work, JSON.stringify(started.review)).not.toBeNull();
  const work = await f.work(started.review.work!.ref);
  const runtime = new CodingAgentRuntime(f.directory + '-runtime', async () => ({
    configuration: { revision: work.reviewerProfile.model.configurationRevision, provider: work.reviewerProfile.model.provider,
      model: work.reviewerProfile.model.model, baseUrl: work.reviewerProfile.model.baseUrl },
    client: { complete: async () => { throw Error('model must not be called while the read lease conflicts'); } } as never,
  }));
  roots.push(f.directory + '-runtime');
  await runtime.init();
  const leased = new LeasedWorkerRuntime({ runtime, lease: () => f.h.workspaceLease, vault: () => f.h.vault,
    materials: async () => undefined, reviewerMaterials: (spec, envelope) => f.reviewContext.runtime(spec.review!.workRef, envelope),
    now: () => '2026-09-10T08:00:01.000Z' });
  // Mirror the production composition root: grants are submitted through the
  // host port that advances the projection after the canonical commit, so the
  // Vault's grant candidate lookup can see the grant it just recorded. The
  // Control methods stay bound to their engine instance.
  const dispatch = new ReviewerDispatch({ ledger: f.h.ledger,
    control: { startRun: command => f.h.control.startRun(command), runFact: command => f.h.control.runFact(command),
      grantMaterialAccess: command => f.h.grantMaterialAccess(command) },
    reviewControl: f.control.dispatch,
    context: f.reviewContext, runtime, execution: leased, observations: runtime.observations, vault: f.h.vault,
    now: () => '2026-09-10T08:00:02.000Z' });

  const leaseId = 'conflicting-writer';
  const holder = { runRef: work.producerRunRef, attemptRef: work.producerAttemptRef, roleBinding: P107_ROLE_BINDING_WRITER_V1 };
  expect(await f.h.workspaceLease.acquireWriteLease(buildAcquireWriteLeaseCommand({ commandId: leaseId, correlationId: leaseId,
    actor: { kind: 'system', id: 'test-writer' }, idempotencyKey: leaseId, projectId: scope.projectId,
    workspaceId: scope.workspaceId, leaseId, scope: { schemaVersion: 1, projectId: scope.projectId,
      workspaceId: scope.workspaceId, kind: 'workspace', id: scope.workspaceId, revision: 1 }, holder,
    declaredWriteScope: ['*'], expiresAt: null, submittedAt: '2026-09-10T08:00:00.000Z' }))).toMatchObject({ status: 'committed' });

  const first = await dispatch.drive(work.ref);
  const second = await dispatch.drive(work.ref);
  const loaded = await f.h.ledger.load(work.reviewerRunRef);
  expect(loaded.status).toBe('found');
  const run = loaded.status === 'found' ? loaded.snapshot as RunSnapshot : null;
  console.log(JSON.stringify({ first, second, canonicalRun: run, runtime: runtime.all() }, null, 2));
  expect(run).toMatchObject({ status: 'ended', outcome: 'crashed', exitCode: null });
  expect(runtime.all()[0]).toMatchObject({ status: 'failed', trace: [], usage: [] });
  expect(first).toMatchObject({ status: 'incomplete', code: 'review_execution_incomplete' });
  expect(second).toMatchObject({ status: 'incomplete', code: 'review_execution_incomplete' });

  const observation = runtime.all()[0]!;
  const oldWorkBeforeReplacement = await f.work(work.ref);
  const replacement = await f.control.lifecycle.replaceFailedWork({
    identity: { projectId: scope.projectId, actor: { kind: 'human', id: 'operator' }, idempotencyKey: 'replace-review-after-lease-conflict' },
    previousWorkRef: work.ref, expectedWorkRevision: oldWorkBeforeReplacement.revision, expectedProtocolRevision: 1,
    requestId: 'review-request-after-lease-conflict',
    proof: { schemaVersion: 1, workRef: work.ref, runRef: work.reviewerRunRef, runtimeStatus: 'failed',
      terminalEventId: run!.lastRuntimeEventId, terminalEventSeq: run!.lastEventSeq,
      observationId: observation.sessionId + ':' + run!.lastRuntimeEventId, eventTypes: ['run_crashed'], traceCount: 0,
      usageCount: 0, modelStarted: false, toolStarted: false },
  });
  expect(replacement).toMatchObject({ status: 'accepted' });
  if (replacement.status === 'rejected') throw Error(replacement.code);
  const oldAfterReplacement = await f.h.ledger.load(work.ref);
  expect(oldAfterReplacement).toMatchObject({ status: 'found', snapshot: oldWorkBeforeReplacement });
  const newWork = await f.work(replacement.workRef);
  expect(newWork).toMatchObject({ revision: 1, input: null, output: null, resultRef: null });
  expect(newWork.ref).not.toEqual(work.ref);
  const pending = await f.h.ledger.pendingDispatchIntents(10, { workKind: 'review' });
  expect(pending.map(entry => entry.intent.runRef)).toContainEqual(newWork.reviewerRunRef);

  expect(await f.control.lifecycle.replaceFailedWork({
    identity: { projectId: scope.projectId, actor: { kind: 'system', id: 'automatic-dispatch' }, idempotencyKey: 'automatic-replace' },
    previousWorkRef: newWork.ref, expectedWorkRevision: 1, expectedProtocolRevision: 2, requestId: 'automatic-replacement',
    proof: { schemaVersion: 1, workRef: newWork.ref, runRef: newWork.reviewerRunRef, runtimeStatus: 'failed', terminalEventId: 'x',
      terminalEventSeq: 1, observationId: 'x', eventTypes: ['run_crashed'], traceCount: 0, usageCount: 0, modelStarted: false, toolStarted: false },
  })).toMatchObject({ status: 'rejected', code: 'replacement_not_authorized' });

  const releaseId = randomUUID();
  expect(await f.h.workspaceLease.releaseLease(buildReleaseLeaseCommand({ commandId: releaseId, correlationId: releaseId,
    actor: { kind: 'system', id: 'test-writer' }, idempotencyKey: releaseId, projectId: scope.projectId,
    workspaceId: scope.workspaceId, leaseId, kind: 'write', holderRunRef: holder.runRef,
    submittedAt: '2026-09-10T08:00:03.000Z' }))).toMatchObject({ status: 'committed' });

  // The known-failed reviewer run must not wedge the workspace: the same
  // workspace must still accept later verification work and still resolve the
  // canonical reviewer material (the `run_unsettled` gate keys off
  // prepared/running/outcome_unknown, never a proven pre-start failure).
  const laterRound = await f.service.startRound(scope, { requestId: 'tools-after-conflict', allowExecute: true,
    configuration: { checks: [{ checkId: 'dynamic', kind: 'dynamic', command: 'mkdir -p .cache; printf y >> .cache/tool-count',
      cwd: '.', timeoutMs: 3000, appliesTo: { workspaceId: scope.workspaceId, taskIds: [scope.taskId] } }] } });
  expect(laterRound.round.status, JSON.stringify(laterRound.round.gaps)).toBe('completed');
  const laterMaterial = await f.service.reviewMaterial(scope, 'tools-after-conflict');
  expect(laterMaterial.status, JSON.stringify(laterMaterial)).toBe('ready');
  await runtime.close();
});

it('ends a reviewer run as known failed when execution.start rejects before any model or tool call', async () => {
  const f = await reviewerFixture(roots);
  const started = await f.service.startReview(scope, f.input);
  expect(started.review.work, JSON.stringify(started.review)).not.toBeNull();
  const work = await f.work(started.review.work!.ref);
  let modelCalls = 0;
  const runtime = new CodingAgentRuntime(f.directory + '-runtime', async () => ({
    configuration: { revision: work.reviewerProfile.model.configurationRevision, provider: work.reviewerProfile.model.provider,
      model: work.reviewerProfile.model.model, baseUrl: work.reviewerProfile.model.baseUrl },
    client: { complete: async () => { modelCalls += 1; throw Error('model must not be called'); } } as never,
  }));
  roots.push(f.directory + '-runtime');
  await runtime.init();
  const leased = new LeasedWorkerRuntime({ runtime, lease: () => f.h.workspaceLease, vault: () => f.h.vault,
    materials: async () => undefined, reviewerMaterials: (spec, envelope) => f.reviewContext.runtime(spec.review!.workRef, envelope),
    now: () => '2026-09-10T08:00:01.000Z' });
  // `CodingAgentRuntime.start` rejects every pre-execution validation error before
  // any model/tool call. Force one by handing the REAL LeasedWorkerRuntime an
  // envelope whose permissions do not match the registered readonly review spec;
  // the runtime adapter must then classify the provably-side-effect-free failure
  // instead of throwing into the dispatcher's ambiguous path.
  const rejecting = { capabilities: () => runtime.capabilities(),
    start: (envelope: Parameters<InstanceType<typeof CodingAgentRuntime>['start']>[0]) =>
      leased.start({ ...envelope, permissions: { ...envelope.permissions, tools: ['read', 'write'], writeScope: ['*'] } } as never) };
  const dispatch = new ReviewerDispatch({ ledger: f.h.ledger,
    control: { startRun: command => f.h.control.startRun(command), runFact: command => f.h.control.runFact(command),
      grantMaterialAccess: command => f.h.grantMaterialAccess(command) },
    reviewControl: f.control.dispatch, context: f.reviewContext, runtime, execution: rejecting,
    observations: runtime.observations, vault: f.h.vault, now: () => '2026-09-10T08:00:02.000Z' });

  const first = await dispatch.drive(work.ref);
  const second = await dispatch.drive(work.ref);
  const run = (await f.h.ledger.load(work.reviewerRunRef) as { snapshot: RunSnapshot }).snapshot;
  // The pre-start rejection is provably side-effect free, so it must become a
  // KNOWN terminal failure rather than an unreconcilable `outcome_unknown`.
  expect(run).toMatchObject({ status: 'ended', outcome: 'crashed', exitCode: null });
  expect(first).toMatchObject({ status: 'incomplete', code: 'review_execution_incomplete' });
  expect(second).toMatchObject({ status: 'incomplete', code: 'review_execution_incomplete' });
  // Exactly one terminal `run_crashed` event is recorded (that is how
  // `rejectBeforeStart` makes the failure canonical); no model or tool ran.
  const record = runtime.all()[0]!;
  expect(record).toMatchObject({ status: 'failed', trace: [], usage: [] });
  expect(record.events).toHaveLength(1);
  expect(record.events[0]).toMatchObject({ eventType: 'run_crashed', sequence: 1 });
  expect(modelCalls).toBe(0);
  await runtime.close();
});
