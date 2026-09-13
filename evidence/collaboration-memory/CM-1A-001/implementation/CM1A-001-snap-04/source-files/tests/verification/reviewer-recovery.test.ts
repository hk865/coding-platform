import { afterEach, expect, it, vi } from 'vitest';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { reviewerFixture, scope } from './reviewer-fixture.js';
import { buildRunFactCommand } from '../../src/contracts/commands/dispatch.js';
import { P107_SCHEMA } from '../contract-suite/p1-07-harness.js';
import type { RuntimeEventV1 } from '../../src/contracts/dispatch.js';
import type { ReviewRecoverInput } from '../../src/contracts/reviewer-verification.js';

const storageFault = vi.hoisted(() => ({ remaining: 0 }));
vi.mock('../../src/storage/atomic-file.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/storage/atomic-file.js')>();
  return { ...actual, writeAtomicFile: async (...args: Parameters<typeof actual.writeAtomicFile>) => {
    if (storageFault.remaining > 0 && String(args[1]).includes('"recovery"') && String(args[1]).includes('"proof"')) {
      storageFault.remaining--; throw Error('injected atomic authorization write failure');
    }
    return actual.writeAtomicFile(...args);
  } };
});

const roots: string[] = [];
afterEach(async () => { storageFault.remaining = 0; vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const authorization: ReviewRecoverInput = { requestId: 'authorized-recovery', previousRequestId: 'review-request', allowExecute: true, reason: 'Lease conflict resolved; authorize a fresh read-only review.' };

async function failed(unknown = false) {
  const f = await reviewerFixture(roots), initial = await f.service.startReview(scope, f.input);
  const ref = initial.review.work!.ref;
  await f.begin(ref);
  const before = (await f.reviewContext.inspect(ref))!;
  const event: RuntimeEventV1 = { schemaVersion: 1, eventId: ref.reviewId + '-crashed', runRef: before.run.ref,
    sequence: 1, eventType: 'run_crashed', occurredAt: P107_SCHEMA, payload: { kind: 'crashed', error: 'read lease refused before model start' } };
  expect(await f.h.control.runFact(buildRunFactCommand({ projectId: scope.projectId, runId: before.run.ref.runId,
    commandId: event.eventId, idempotencyKey: event.eventId, correlationId: f.input.requestId,
    actor: { kind: 'system', id: 'trusted-dispatch' }, submittedAt: P107_SCHEMA, expectedRevision: before.run.revision,
    fact: unknown ? { kind: 'outcome_unknown', runRef: before.run.ref, reason: 'terminal side effects not confirmed' } : { kind: 'runtime_event', event } }))).toMatchObject({ status: 'committed' });
  const observation = f.observations[1]!;
  Object.assign(observation, { status: 'failed', events: [event], trace: [], usage: [], error: event.payload.kind === 'crashed' ? event.payload.error : null });
  const old = await f.reviewContext.inspect(ref);
  return { ...f, ref, observation, event, old };
}

async function saved(f: Awaited<ReturnType<typeof failed>>, requestId: string) {
  for (const file of await readdir(f.directory)) if (file.startsWith('review-')) {
    const body = JSON.parse(await readFile(join(f.directory, file), 'utf8'));
    if (body.requestId === requestId) return body;
  }
  throw Error('journal missing');
}

it.each(['PASS', 'FAIL'] as const)('replaces a proven prestart failure and follows the original %s result/evidence/reduction chain across reopen', async outcome => {
  const f = await failed();
  expect((await f.service.review(scope, f.input.requestId)).recovery).toMatchObject({ allowed: true, code: 'prestart_failure_proven', failureReason: 'read lease refused before model start' });
  const recovered = await f.service.recoverReview(scope, authorization);
  expect(recovered.review).toMatchObject({ phase: 'awaiting_result', recoveryRequest: { previousRequestId: f.input.requestId, reason: authorization.reason } });
  const ref = recovered.review.work!.ref;
  await f.h.advanceProjection();
  const agents = await f.h.consoleActiveAgents(scope);
  expect(agents.status).toBe('ready');
  if (agents.status !== 'ready') throw Error('ActiveAgents view unavailable');
  expect(agents.agents.rows.find(row => row.runRef.runId === recovered.review.work!.reviewerRunRef.runId))
    .toMatchObject({ work: { kind: 'review', reviewWorkRef: ref }, displayState: 'starting' });
  const started = await f.begin(ref);
  await f.complete(ref, await f.report(ref, started.packet, [outcome, outcome]));
  const service = await f.reopen();
  const settled = await service.resumeReview(scope, { requestId: authorization.requestId });
  expect(settled.review.phase, JSON.stringify(settled.review.gaps)).toBe('settled');
  expect(settled.review.formal.evidenceRefs).toHaveLength(1);
  expect(settled.review.assessment?.body.decision).toMatchObject({ status: 'accepted', requirements: [expect.objectContaining({ outcome }), expect.objectContaining({ outcome })] });
  if (outcome === 'FAIL') expect(settled.review.formal.taskPhase).not.toBe('satisfied');
  expect((await service.review(scope, authorization.requestId)).recovery.allowed).toBe(false);
  expect(await f.reviewContext.inspect(f.ref)).toEqual(f.old);
  const beforeEvents = await f.h.ledger.events({ afterCursor: null, limit: 1000 });
  const reopened = await f.reopen();
  expect((await reopened.recoverReview(scope, authorization)).replayed).toBe(true);
  expect(await f.h.ledger.events({ afterCursor: null, limit: 1000 })).toEqual(beforeEvents);
  expect((await saved(f, authorization.requestId)).recovery.receipt.status).toBe('accepted');
  expect(await reopened.reviewReceipt(scope, authorization.requestId)).toMatchObject({ recoveryRequest: { previousRequestId: f.input.requestId, reason: authorization.reason } });
});

it('replays same-key concurrent recovery, conflicts on changed payload, and admits only one competing authorization', async () => {
  const f = await failed();
  const [first, replay] = await Promise.all([f.service.recoverReview(scope, authorization), f.service.recoverReview(scope, authorization)]);
  expect(replay.replayed).toBe(true); expect(replay.review.work!.ref).toEqual(first.review.work!.ref);
  await expect(f.service.recoverReview(scope, { ...authorization, reason: 'different reason' })).rejects.toThrow('同一 Reviewer 请求内容已改变');
  await expect(f.service.startReview(scope, { ...f.input, requestId: authorization.requestId })).rejects.toThrow('同一 Reviewer 请求内容已改变');
  const competitor = await f.service.recoverReview(scope, { ...authorization, requestId: 'different-authorization' });
  expect(competitor.review).toMatchObject({ phase: 'work_rejected', work: null });
  expect((await f.service.review(scope, f.input.requestId)).recovery).toMatchObject({ allowed: false, code: 'recovery_not_current' });
  const protocol = await f.h.ledger.load(f.old!.work.protocolRef);
  expect(protocol).toMatchObject({ status: 'found', snapshot: { revision: 2, workRefs: [f.ref, first.review.work!.ref] } });
});

it('lets protocol CAS choose one Work for different simultaneous authorization identities', async () => {
  const f = await failed();
  const results = await Promise.all(['competing-a', 'competing-b'].map(requestId => f.service.recoverReview(scope, { ...authorization, requestId })));
  expect(results.filter(r => r.review.work !== null)).toHaveLength(1);
  const protocol = await f.h.ledger.load(f.old!.work.protocolRef);
  expect(protocol).toMatchObject({ status: 'found', snapshot: { revision: 2, workRefs: [f.ref, results.find(r => r.review.work)!.review.work!.ref] } });
});

it('persists a committed Control receipt after response loss and replays the frozen command after restart', async () => {
  const f = await failed(), original = f.control.lifecycle.replaceFailedWork;
  const spy = vi.spyOn(f.control.lifecycle, 'replaceFailedWork').mockImplementationOnce(async command => {
    expect(await original(command)).toMatchObject({ status: 'accepted' });
    throw Error('control response lost after commit');
  });
  const lost = await f.service.recoverReview(scope, authorization);
  expect(lost.review.work).not.toBeNull();
  const persisted = await saved(f, authorization.requestId);
  expect(persisted.recovery.receipt).toBeNull();
  const reopened = await f.reopen();
  const replayed = await reopened.recoverReview(scope, authorization);
  expect(replayed.review.work!.ref).toEqual(lost.review.work!.ref);
  expect((await saved(f, authorization.requestId)).recovery.receipt.status).toBe('replayed');
  expect(spy.mock.calls[1]![0]).toEqual(persisted.recovery.command);
  expect(await original(persisted.recovery.command)).toMatchObject({ status: 'replayed' });
  expect(await original({ ...persisted.recovery.command, expectedProtocolRevision: 99 })).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
});

it('resumes authorization saved before Control submission and refuses a later unknown observation without refreshing its frozen proof', async () => {
  const f = await failed();
  const spy = vi.spyOn(f.control.lifecycle, 'replaceFailedWork').mockImplementationOnce(async () => { throw Error('unavailable before submit'); });
  await f.service.recoverReview(scope, authorization);
  const persisted = await saved(f, authorization.requestId);
  expect(persisted.recovery.command).not.toBeNull();
  f.observation.status = 'outcome_unknown';
  const reopened = await f.reopen();
  const result = await reopened.recoverReview(scope, authorization);
  expect(result.review).toMatchObject({ work: null, phase: 'work_rejected', recovery: { allowed: false, code: 'recovery_outcome_unknown' } });
  expect(spy).toHaveBeenCalledTimes(1);
  expect((await saved(f, authorization.requestId)).recovery.command).toEqual(persisted.recovery.command);
});

it('resumes a saved unsubmitted authorization when the same complete proof remains current', async () => {
  const f = await failed();
  vi.spyOn(f.control.lifecycle, 'replaceFailedWork').mockImplementationOnce(async () => { throw Error('unavailable before submit'); });
  await f.service.recoverReview(scope, authorization);
  const reopened = await f.reopen();
  expect((await reopened.resumeReview(scope, { requestId: authorization.requestId })).review).toMatchObject({ phase: 'awaiting_result', work: { requestId: authorization.requestId } });
});

it('does not submit an in-memory frozen command until its failed journal save has durably succeeded', async () => {
  const f = await failed(), control = vi.spyOn(f.control.lifecycle, 'replaceFailedWork');
  storageFault.remaining = 3;
  await expect(f.service.recoverReview(scope, authorization)).rejects.toThrow('injected atomic authorization write failure');
  expect(control).not.toHaveBeenCalled();
  expect((await saved(f, authorization.requestId)).recovery.command).toBeNull();
  const retry = await f.service.recoverReview(scope, authorization);
  expect(retry.review.work).toBeNull();
  expect(control).not.toHaveBeenCalled();
  expect((await f.service.recoverReview(scope, authorization)).review.work).not.toBeNull();
  expect(control).toHaveBeenCalledTimes(1);
});

it('reopens authorization intent saved before the replacement command could be frozen', async () => {
  const f = await failed();
  storageFault.remaining = 2;
  await expect(f.service.recoverReview(scope, authorization)).rejects.toThrow('injected atomic authorization write failure');
  expect((await saved(f, authorization.requestId)).recovery.command).toBeNull();
  const reopened = await f.reopen();
  expect((await reopened.resumeReview(scope, { requestId: authorization.requestId })).review.work).not.toBeNull();
});

it('keeps canonical outcome_unknown blocked even when a persisted runtime row claims the exact prestart failure', async () => {
  const f = await failed(true);
  expect(await f.reviewContext.recovery(f.ref)).toMatchObject({ allowed: false, code: 'recovery_outcome_unknown' });
  expect((await f.service.recoverReview(scope, authorization)).review).toMatchObject({ phase: 'work_rejected', work: null, recovery: { code: 'recovery_outcome_unknown' } });
  expect(await f.reviewContext.inspect(f.ref)).toEqual(f.old);
});

it('requires complete exact durable failure facts and refuses absent, ambiguous, started, malformed, or unknown records', async () => {
  const f = await failed(), pristine = structuredClone(f.observation);
  const mutations: Array<() => void> = [
    () => { delete f.observation.events; }, () => { delete f.observation.trace; }, () => { delete f.observation.usage; },
    () => { delete f.observation.sessionId; }, () => { f.observation.sessionId = 'producer-session'; },
    () => { f.observation.status = 'outcome_unknown'; }, () => { f.observation.trace = [{ type: 'model_request' }]; },
    () => { f.observation.usage = [{}]; }, () => { f.observation.spec.workspaceId = 'other'; },
    () => { f.observation.spec.review!.profile.digest = '0'.repeat(64); },
    () => { f.observation.events![0]!.sequence = 2; }, () => { f.observation.events![0]!.eventId = 'different'; },
    () => { f.observation.events![0]!.occurredAt = 'invalid'; },
    () => { f.observation.events![0]!.payload = { kind: 'crashed', error: '' }; },
    () => { f.observation.events!.unshift({ ...f.event, eventType: 'run_started', payload: { kind: 'started', startedAt: P107_SCHEMA } }); },
  ];
  for (const mutate of mutations) {
    for (const key of Object.keys(f.observation)) delete (f.observation as unknown as Record<string, unknown>)[key];
    Object.assign(f.observation, structuredClone(pristine)); mutate();
    expect(await f.reviewContext.recovery(f.ref)).toMatchObject({ allowed: false });
  }
  Object.assign(f.observation, structuredClone(pristine));
  f.observations.push(structuredClone(pristine));
  expect(await f.reviewContext.recovery(f.ref)).toMatchObject({ allowed: false, code: 'recovery_evidence_insufficient' });
  f.observations.pop();
  expect(await f.reviewContext.recovery(f.ref)).toMatchObject({ allowed: true });
  f.changeModel();
  expect(await f.reviewContext.recovery(f.ref)).toMatchObject({ allowed: false });
});
