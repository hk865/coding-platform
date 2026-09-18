import { expect, it } from 'vitest';
import { producerCollaborationFacts } from '../../src/data/context-compiler/producer-collaboration-facts.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import type { StateLedger } from '../../src/contracts/ledger.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { SourceApplicabilityPort } from '../../src/contracts/material-access.js';

function world() {
  const scope = { projectId: 'p', workspaceId: 'w' }, planRef = { aggregateType: 'PlanRevision', projectId: 'p', planId: 'plan' };
  const runRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'producer' };
  const deliveryRef = { aggregateType: 'Delivery', ...scope, deliveryId: 'delivered' };
  const grantRef = { aggregateType: 'MaterialAccessGrant', ...scope, goalId: 'g', grantId: 'grant' };
  const reviewRef = { aggregateType: 'ArchitectureReview', ...scope, reviewId: 'decision' };
  const workRef = { aggregateType: 'WorkContextBinding', ...scope, workId: 'reader-work' };
  const peerRef = { ...workRef, workId: 'peer-work' };
  const bodyRef = { kind: 'artifact', digest: 'a'.repeat(64), sizeBytes: 100, contentType: 'application/json' };
  const pin = { schemaVersion: 1, ...scope, sourceSet: { kind: 'workspace_paths', paths: ['.'] }, identity: { workspace: '/isolated', commit: null }, manifestDigest: 'b'.repeat(64) };
  const binding = { schemaVersion: 1, inputDigest: 'c'.repeat(64), manifestDigest: 'd'.repeat(64), materialAccessRefs: [grantRef], deliveryRefs: [deliveryRef], additionalMaterialRefs: [] };
  // Canonical fact fixtures; authority predicates run through the production
  // runtimeInputMaterialGuards and explicit source recapture, not a mocked verdict.
  const run: any = { ref: runRef, revision: 4, task: { projectId: 'p', goalId: 'g', taskId: 'reader-a' }, planRef,
    envelope: { ...scope, planRef, workspaceSnapshot: { revision: 1 } }, inputBinding: binding };
  const delivery: any = { ref: deliveryRef, revision: 1, schemaVersion: 1, recordedAt: '2026-09-14T00:00:01Z', delivery: {
    schemaVersion: 1, deliveryId: deliveryRef.deliveryId, projectId: scope.projectId, workspaceId: scope.workspaceId,
    origin: { kind: 'architecture_decision', reviewRef, reviewRevision: 2, targetIndex: 0 }, targetWorkContextRef: workRef, bodyRef,
    sourceRefs: [{ kind: 'architecture_review', refId: reviewRef.reviewId, revision: '2' }], createdAt: '2026-09-14T00:00:01Z',
  } };
  const grant: any = { ref: grantRef, revision: 1, grant: { reader: runRef, scope: { ...scope, goalId: 'g' }, materials: [bodyRef], basis: { planRef, workspaceRevision: 1, sourceDigest: pin.manifestDigest, sourcePin: pin } } };
  const review: any = { ref: reviewRef, revision: 2, schemaVersion: 1, reporterRunRef: runRef, status: 'accepted', bodyRef, proposalDigest: 'e'.repeat(64),
    decisionRef: { aggregateType: 'ArchitectureChangeDecision', projectId: 'p', decisionId: 'human' }, summary: 'Recorded intent; baseline unchanged.', proposalContent: { description: 'Retain current source pending a separately verified migration.' }, recordedAt: '2026-09-14T00:00:00Z',
    targets: [{ ref: workRef, revision: 1, mode: 'resume' }, { ref: peerRef, revision: 1, mode: 'resume' }] };
  const work: any = { ref: workRef, revision: 3, binding: { ...scope, workId: workRef.workId, goalId: 'g', taskId: 'reader-a', planRef, linkedRunRefs: [runRef] } };
  const peer: any = { ref: peerRef, revision: 2, binding: { ...work.binding, workId: peerRef.workId, taskId: 'reader-b', linkedRunRefs: [] } };
  const key = (v: any) => canonicalJson(v), rows = new Map([run, delivery, grant, review, work, peer].map(v => [key(v.ref), v]));
  let reads = 0, onRead = () => {};
  const opened = { ...review, revision: 1, status: 'pending', decisionRef: null, summary: 'Submitted for human decision.', recordedAt: '2026-09-13T23:59:00Z' };
  const ledger = {
    load: async (ref: any) => { reads++; onRead(); const value = rows.get(key(ref)); return value ? { status: 'found', snapshot: structuredClone(value) } : { status: 'not_found' }; },
    events: async () => ({ afterCursor: null, throughCursor: 'c0000000001', hasMore: false, events: [{ cursor: 'c0000000001', event: { eventType: 'ArchitectureReviewRecorded', projectId: 'p', workspaceId: 'w', payload: { action: 'open', snapshot: structuredClone(opened) } } }] }),
  } as unknown as StateLedger;
  const source: SourceApplicabilityPort = { capture: async () => ({ status: 'sourced', pin: structuredClone(pin) as any }) };
  return { run: run as RunSnapshot, delivery, grant, review, work, peer, ledger, source, pin, rows, key, reads: () => reads, onRead: (hook: () => void) => { onRead = hook; } };
}

it('corroborates the exact delivered decision and both Work-to-Task identities without source-code ownership claims', async () => {
  const w = world(), facts: any = await producerCollaborationFacts(w.ledger, w.source, w.run);
  expect(facts).toMatchObject({ kind: 'producer-collaboration-facts', producerRunRef: w.run.ref, inputDigest: w.run.inputBinding!.inputDigest,
    decisions: [{ deliveryRef: w.delivery.ref, review: { revision: 2, status: 'accepted', proposalDigest: w.review.proposalDigest, summary: w.review.summary } }] });
  expect(facts.decisions[0].works.map((v: any) => [v.ref.workId, v.taskId])).toEqual([['reader-work', 'reader-a'], ['peer-work', 'reader-b']]);
  expect(facts.authority).toContain('not source-code consumers');
  expect(JSON.stringify(facts)).not.toContain('private model input');
});

it('corroborates a producer own formal ArchitectureReview separately from decisions received in its input', async () => {
  const w = world();
  w.run.inputBinding!.deliveryRefs = [];
  const facts: any = await producerCollaborationFacts(w.ledger, w.source, w.run);
  expect(facts.decisions).toEqual([]);
  expect(facts.reportedReviews).toMatchObject([{
    recorded: { ref: w.review.ref, revision: 1, status: 'pending', reporterRunRef: w.run.ref },
    current: { ref: w.review.ref, revision: 2, status: 'accepted', decisionRef: w.review.decisionRef },
  }]);
  expect(facts.authority).toContain('reported by this Run');
  expect(facts.authority).toContain('not received by this Run');
});

it('retains every exact ordinary peer Delivery bound to the producer input', async () => {
  const w = world(), peerDeliveryRef = { aggregateType: 'Delivery', projectId: 'p', workspaceId: 'w', deliveryId: 'peer-report' };
  const peerDelivery: any = { ref: peerDeliveryRef, revision: 1, schemaVersion: 1, recordedAt: '2026-09-13T23:58:00Z', delivery: {
    schemaVersion: 1, deliveryId: peerDeliveryRef.deliveryId, projectId: 'p', workspaceId: 'w',
    origin: { kind: 'directed_request', requestRef: { aggregateType: 'DirectedRequest', projectId: 'p', workspaceId: 'w', requestId: 'reader-report' } },
    targetWorkContextRef: w.work.ref, bodyRef: { kind: 'artifact', digest: '9'.repeat(64), sizeBytes: 42, contentType: 'text/plain' }, sourceRefs: [], createdAt: '2026-09-13T23:58:00Z',
  } };
  w.rows.set(w.key(peerDeliveryRef), peerDelivery);
  w.run.inputBinding!.deliveryRefs = [peerDeliveryRef as any];
  const facts: any = await producerCollaborationFacts(w.ledger, w.source, w.run);
  expect(facts.decisions).toEqual([]);
  expect(facts.inputDeliveries).toEqual([{ ref: peerDelivery.ref, origin: peerDelivery.delivery.origin,
    targetWorkContextRef: peerDelivery.delivery.targetWorkContextRef, bodyRef: peerDelivery.delivery.bodyRef,
    sourceRefs: [], createdAt: peerDelivery.delivery.createdAt }]);
});

it.each(['revoked', 'wrong-reader', 'uncovered-body', 'source-changed', 'decision-changed', 'wrong-target', 'foreign-work', 'unbound-run'])('rejects %s instead of certifying copied report claims', async kind => {
  const w = world();
  if (kind === 'revoked') w.grant.revocation = { reason: 'withdrawn' };
  if (kind === 'wrong-reader') w.grant.grant.reader = { ...w.run.ref, runId: 'other' };
  if (kind === 'uncovered-body') w.grant.grant.materials = [];
  if (kind === 'source-changed') w.source.capture = async () => ({ status: 'sourced', pin: { ...w.pin, manifestDigest: 'f'.repeat(64) } as any });
  if (kind === 'decision-changed') w.review.revision++;
  if (kind === 'wrong-target') w.delivery.delivery.origin.targetIndex = 1;
  if (kind === 'foreign-work') w.peer.binding.workspaceId = 'other';
  if (kind === 'unbound-run') w.work.binding.linkedRunRefs = [];
  await expect(producerCollaborationFacts(w.ledger, w.source, w.run)).rejects.toThrow();
});

it('rejects a decision changed during the bounded capture', async () => {
  const w = world();
  w.onRead(() => { if (w.reads() === 7) w.review.summary = 'Changed after capture'; });
  await expect(producerCollaborationFacts(w.ledger, w.source, w.run)).rejects.toThrow(/changed during capture/);
});

it('does not infer old or unbound decisions from a mailbox', async () => {
  const w = world(); delete w.run.inputBinding;
  expect(await producerCollaborationFacts(w.ledger, undefined, w.run)).toBeUndefined();
  expect(w.reads()).toBe(0);
});

it('refuses a missing source capability even when declared hashes match', async () => {
  const w = world(); await expect(producerCollaborationFacts(w.ledger, undefined, w.run)).rejects.toThrow(/source capability/);
});

it('rechecks source after canonical facts are read', async () => {
  const w = world(); let calls = 0;
  w.source.capture = async () => ({ status: 'sourced', pin: { ...w.pin, manifestDigest: ++calls === 1 ? w.pin.manifestDigest : 'f'.repeat(64) } as any });
  await expect(producerCollaborationFacts(w.ledger, w.source, w.run)).rejects.toThrow(/source changed during capture/);
});

it('cancels producer corroboration at its source boundary without starting the final recapture', async () => {
  const w = world(), entered = Promise.withResolvers<void>(), released = Promise.withResolvers<void>();
  const controller = new AbortController(), reason = new Error('query disconnected');
  let received: AbortSignal | undefined, calls = 0;
  const capture = w.source.capture.bind(w.source);
  w.source.capture = async (query, signal) => {
    received = signal; calls++; entered.resolve(); await released.promise;
    signal?.throwIfAborted(); return capture(query, signal);
  };
  const pending = producerCollaborationFacts(w.ledger, w.source, w.run, controller.signal);
  await entered.promise; controller.abort(reason); released.resolve();
  await expect(pending).rejects.toBe(reason);
  expect(received).toBe(controller.signal); expect(calls).toBe(1);
});
