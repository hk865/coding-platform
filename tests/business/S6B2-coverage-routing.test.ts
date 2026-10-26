/**
 * H-B row 17 (coverage facts and the whole-read horizon) and row 20 (the routing set's close and `expectedSource`).
 *
 * The world is the frozen fixture's (steps 1, 5, 8 and 9); the advance is the real service over the real request/facts
 * owners, the saved system principal and the real record store. Routing children are D's `append`/receipt read, called
 * exactly as the composite would between two advances; the second root's owner moves through the public route.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import { coverageHolds } from '../../src/core/work-graph/state/session-handoff.js';
import { createSecretaryHandoffFacts } from '../../src/core/work-graph/views/secretary-handoff-facts.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { governS6B } from '../helpers/S6B1-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { seedS6BStaleCandidate, seedS6BTwoProcessingRoots } from '../helpers/S6B2-fixture.js';
import { waitForRound } from '../helpers/S6A-history-fixture.js';
import {
  s6b2Accept, s6b2Advance, s6b2Backend, s6b2Duty, s6b2Facts, s6b2Scene, s6b2Workspace, type S6B2Captured,
} from '../helpers/S6B2-handoff-scene.js';

const captured = vi.hoisted((): S6B2Captured => ({ backend: null }));
/** A2 (the S6B2-handoff-fence.test.ts:96 shape): the real store's commit lookup answers unavailable once for `prefix`. */
const lookupFault = vi.hoisted(() => ({ prefix: null as string | null }));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const module = await (await import('../helpers/S6B2-handoff-scene.js')).sealInMemory(captured,
    await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>(), true) as
    typeof import('../../src/core/record-store/in-memory-record-store.js');
  return { ...module, createInMemoryRecordBackend: (options: Parameters<typeof module.createInMemoryRecordBackend>[0]) => {
    const built = module.createInMemoryRecordBackend(options);
    const realLookup = built.records.lookupCommit;
    built.records.lookupCommit = async (request) => {
      if (lookupFault.prefix === null || !request.identityKey.startsWith(lookupFault.prefix)) return realLookup(request);
      lookupFault.prefix = null;
      return { status: 'rejected', code: 'unavailable', reason: 'S6B2: the receipt lookup failed once' };
    };
    return built;
  } };
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6B2-handoff-scene.js')).sealSqlite(captured,
    await importOriginal<typeof import('../../src/core/record-store/sqlite-record-store.js')>(), true));

const scene = s6b2Scene();
afterEach(() => { lookupFault.prefix = null; expect(commitBarrier.reset()).toEqual([]); });
afterAll(() => scene.closeAll());

function services(world: Parameters<typeof s6b2Facts>[0]) {
  const facts = s6b2Facts(world, captured);
  return { facts, advance: s6b2Advance(world, captured, { coverage: facts }) };
}

describe.each(['memory', 'sqlite'] as const)('row 20 on %s: the routing set closes only on a complete read and checks expectedSource', backend => {
  it('routes one root, skips the moved owner and closes with the final read horizon', async () => {
    const { world } = await scene.open(backend);
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    const source = await world.createSecretary('s6b-route-source');
    const target = await world.createSecretary('s6b-route-target');
    const other = await world.createSecretary('s6b-route-other');
    const first = await ws.submit({ label: 'route-1', goalId: null, recipient: source.ref });
    const second = await ws.submit({ label: 'route-2', goalId: null, recipient: null });
    await world.route({ commandId: 's6b-route-second', round: second.round, to: source.ref });

    // A secretary line with no goals: coverage is vacuously true; the existing target needs no line creation.
    const operation = await s6b2Accept(world, { commandId: 's6b-route-accept', source: source.ref, target: target.ref, trigger: 'too_long', actor: 'system' });
    const { advance } = services(world);

    const steps: Array<{ revision: number; stage: string }> = [];
    const run = async (revision: number) => {
      const result = await advance.advanceHandoff(world.humanContext(),
        { kind: 'continue', operation, expectedRevision: revision });
      if (result.status !== 'committed') throw new Error(`advance at ${revision} failed: ${JSON.stringify(result)}`);
      steps.push({ revision: result.value.revision, stage: result.value.write.stage });
      return result.value;
    };
    // accepted -> fence take -> wait/stopped -> recheck -> existing successor -> routing.
    let value = await run(1);
    expect(value.write.stage).toBe('fence');
    value = await run(value.revision);
    expect(value.write.stage).toBe('wait_writer');
    value = await run(value.revision);
    expect(value.write.stage).toBe('recheck');
    value = await run(value.revision);
    expect(value.write.stage).toBe('successor');
    expect(value.next).toBe('routing');
    value = await run(value.revision);
    expect(value.write.stage).toBe('routing');
    expect(value.write.phase).toBe('before');
    expect(value.write.item).toBe(`root:${first.requestRoot.queryJobId}`);
    const firstBefore = value.revision;
    const firstInput = value.write.savedInput;
    const firstHorizon = (await world.platform.sessions.getSessionOperation(world.humanContext(), operation));
    const firstRoutingHorizon = firstHorizon.status === 'ready' && firstHorizon.value.action.kind === 'handoff'
      ? firstHorizon.value.action.progress.routing?.horizon : null;
    expect(firstRoutingHorizon).not.toBeNull();

    const appendResult = await world.platform.requestRounds.append(
      world.systemContext(), { command: { kind: 'handoff', operationId: operation.operationId,
        requestRoot: first.requestRoot, to: target.ref, expectedSource: source.ref } });
    expect(appendResult.status).toBe('appended');

    value = await run(firstBefore);
    expect(value.write.stage).toBe('routing');
    expect(value.write.phase).toBe('after');
    expect(value.write.receipt).not.toBeNull();
    value = await run(value.revision);
    expect(value.write.phase).toBe('before');
    expect(value.write.item).toBe(`root:${second.requestRoot.queryJobId}`);
    const secondBefore = value.revision;

    await world.route({ commandId: 's6b-route-away', round: second.round, to: other.ref });
    const refused = await world.platform.requestRounds.append(
      world.systemContext(), { command: { kind: 'handoff', operationId: operation.operationId,
        requestRoot: second.requestRoot, to: target.ref, expectedSource: source.ref } });
    expect(refused).toMatchObject({ status: 'rejected', code: 'busy' });

    value = await run(secondBefore);
    expect(value.write.stage).toBe('routing');
    expect(value.write.phase).toBe('after');
    expect(value.next).toBe('routing');
    value = await run(value.revision);
    expect(value.write.stage).toBe('routing');
    expect(value.write.phase).toBe('after');
    expect(value.next).toBe('archive');
    const closed = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
    expect(closed.status).toBe('ready');
    if (closed.status !== 'ready') return;
    const routing = closed.value.action.kind === 'handoff' ? closed.value.action.progress.routing : null;
    expect(routing?.closed).toBe(true);
    expect(routing?.roots.map(root => root.skipped)).toEqual([null, 'owner_changed']);
    expect(routing?.roots[0]?.receipt).not.toBeNull();
    expect(routing?.roots[0]?.input).toEqual(firstInput !== null && firstInput?.kind === 'route'
      ? { operationId: firstInput.operationId, to: firstInput.to, expectedSource: firstInput.expectedSource } : null);
    expect(routing?.roots[1]?.receipt).toBeNull();
    expect(routing?.horizon).not.toBe(firstRoutingHorizon);
  }, 60_000);
});

describe('row 20 receipts: found, missing, conflict and unavailable are four outcomes', () => {
  it('records only a found receipt; missing refuses, conflict keeps idempotency and unavailable stops', async () => {
    const { world } = await scene.open('memory');
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    const source = await world.createSecretary('s6b-receipt-source');
    const target = await world.createSecretary('s6b-receipt-target');
    const other = await world.createSecretary('s6b-receipt-other');
    const request = await ws.submit({ label: 'receipt-1', goalId: null, recipient: source.ref });
    const secondRequest = await ws.submit({ label: 'receipt-2', goalId: null, recipient: null });
    await world.route({ commandId: 's6b-receipt-route-2', round: secondRequest.round, to: source.ref });
    const operation = await s6b2Accept(world, { commandId: 's6b-receipt-accept', source: source.ref, target: target.ref, trigger: 'too_long', actor: 'system' });
    const base = services(world);
    let value = await base.advance.advanceHandoff(world.humanContext(),
      { kind: 'continue', operation, expectedRevision: 1 });
    for (let step = 0; step < 3 && value.status === 'committed'; step += 1) {
      value = await base.advance.advanceHandoff(world.humanContext(),
        { kind: 'continue', operation, expectedRevision: value.value.revision });
    }
    expect(value.status).toBe('committed');
    if (value.status !== 'committed') return;
    expect(value.value.write.stage).toBe('successor');
    value = await base.advance.advanceHandoff(world.humanContext(),
      { kind: 'continue', operation, expectedRevision: value.value.revision });
    expect(value.status).toBe('committed');
    if (value.status !== 'committed') return;
    expect(value.value.write.stage).toBe('routing');
    expect(value.value.write.phase).toBe('before');
    const beforeRevision = value.value.revision;

    // The routing child has not committed: the same before write comes back (its saved arm, item and generation
    // included) and no empty-input after receipt is written, so the composite can call the append owner again.
    const missing = await base.advance.advanceHandoff(world.humanContext(),
      { kind: 'continue', operation, expectedRevision: beforeRevision });
    expect(missing).toMatchObject({ status: 'committed', replayed: true });
    if (missing.status !== 'committed') return;
    expect(missing.value.write).toMatchObject({ stage: 'routing', phase: 'before', item: value.value.write.item,
      generation: value.value.write.generation, savedInput: value.value.write.savedInput, receipt: null });
    expect(missing.value.revision).toBe(beforeRevision);
    const afterMissing = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
    expect(afterMissing.status).toBe('ready');
    if (afterMissing.status !== 'ready' || afterMissing.value.action.kind !== 'handoff') return;
    expect(afterMissing.value.revision).toBe(beforeRevision);
    expect(afterMissing.value.action.progress.lastRefusal).toBeNull();

    // A2: the store lookup under the real receipt read answers unavailable once; the real read answers unavailable,
    // the stage stops and writes nothing.
    lookupFault.prefix = 'request.handoff:';
    const unavailableRead = await base.advance.advanceHandoff(world.humanContext(),
      { kind: 'continue', operation, expectedRevision: afterMissing.value.revision });
    expect(unavailableRead).toMatchObject({ status: 'rejected', code: 'unavailable' });

    const appended = await world.platform.requestRounds.append(world.systemContext(),
      { command: { kind: 'handoff', operationId: operation.operationId, requestRoot: request.requestRoot,
        to: target.ref, expectedSource: source.ref } });
    expect(appended.status).toBe('appended');
    const found = await base.advance.advanceHandoff(world.humanContext(),
      { kind: 'continue', operation, expectedRevision: afterMissing.value.revision });
    expect(found.status).toBe('committed');
    if (found.status !== 'committed') return;
    expect(found.value.write.receipt).not.toBeNull();

    // The second root's real child commits under a different input than its saved before arm: the receipt read
    // answers conflict and the parent writes nothing.
    const secondBefore = await base.advance.advanceHandoff(world.humanContext(),
      { kind: 'continue', operation, expectedRevision: found.value.revision });
    expect(secondBefore).toMatchObject({ status: 'committed' });
    if (secondBefore.status !== 'committed') return;
    expect(secondBefore.value.write).toMatchObject({ stage: 'routing', phase: 'before',
      item: `root:${secondRequest.requestRoot.queryJobId}` });
    const diverged = await world.platform.requestRounds.append(world.systemContext(),
      { command: { kind: 'handoff', operationId: operation.operationId, requestRoot: secondRequest.requestRoot,
        to: other.ref, expectedSource: source.ref } });
    expect(diverged.status).toBe('appended');
    const conflict = await base.advance.advanceHandoff(world.humanContext(),
      { kind: 'continue', operation, expectedRevision: secondBefore.value.revision });
    expect(conflict).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    const afterConflict = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
    expect(afterConflict.status).toBe('ready');
    if (afterConflict.status !== 'ready' || afterConflict.value.action.kind !== 'handoff') return;
    expect(afterConflict.value.revision).toBe(secondBefore.value.revision);
    expect(afterConflict.value.action.progress.routing?.roots[1]?.receipt).toBeNull();
  }, 60_000);
});

describe.each(['memory', 'sqlite'] as const)('row 17 on %s: coverage facts over the real owned roots', backend => {
  it('discards a whole read attempt whose horizon moved and keeps the same facts on a re-read', async () => {
    const { world } = await scene.open(backend);
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    const source = await world.createSecretary('s6b-horizon-source');
    const target = await world.createSecretary('s6b-horizon-target');
    const operation = await s6b2Accept(world, { commandId: 's6b-horizon-accept', source: source.ref, target: target.ref, trigger: 'too_long', actor: 'system' });
    const { advance, facts } = services(world);

    const first = await facts.readCoverage(world.humanContext(), { source: source.ref });
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') return;
    const hold = commitBarrier.hold(byIdentityPrefix('handoff.advance:'), 'the fence take');
    const advancing = advance.advanceHandoff(world.humanContext(),
      { kind: 'continue', operation, expectedRevision: 1 });
    await hold.reached;
    // One real public commit lands after the coverage read and before the fence commit.
    await ws.submit({ label: 'horizon-move', goalId: null, recipient: null });
    hold.release();
    expect(await advancing).toMatchObject({ status: 'rejected', code: 'revision_conflict' });

    const second = await facts.readCoverage(world.humanContext(), { source: source.ref });
    expect(second.status).toBe('ready');
    if (second.status !== 'ready') return;
    expect(second.value.horizon).not.toBe(first.value.horizon);
    expect(second.value.goals).toEqual(first.value.goals);
    const retry = await advance.advanceHandoff(world.humanContext(),
      { kind: 'continue', operation, expectedRevision: 1 });
    expect(retry.status).toBe('committed');
  }, 60_000);

  it('reads the roots, their goals, the activity revision and a complete-read horizon', async () => {
    const { world } = await scene.open(backend);
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    const source = await world.createSecretary('s6b-coverage-source');
    await governS6B(world, ws, world.goals);
    const seeded = await seedS6BTwoProcessingRoots(world, { secretary: source });
    const { facts } = services(world);
    const read = await facts.readCoverage(world.humanContext(), { source: source.ref });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.value.source).toEqual(source.ref);
    expect(read.value.goals).toHaveLength(2);
    expect(read.value.goals.every(goal => goal.textSource === null)).toBe(true);
    expect(read.value.horizon).not.toBeNull();
    expect(read.value.lastRound).toBeNull();
    expect(read.value.activityRevision).toBeGreaterThanOrEqual(0);
    expect(coverageHolds(read.value)).toBe(false);
    // Step 8 moves the ledger through a real proposal and its public adoption; the whole read is repeated.
    await seedS6BStaleCandidate(world, { request: seeded.requests[1] });
    const again = await facts.readCoverage(world.humanContext(), { source: source.ref });
    expect(again.status).toBe('ready');
    if (again.status !== 'ready') return;
    expect(again.value.horizon).not.toBe(read.value.horizon);
    expect(again.value.goals).toEqual(read.value.goals);
    expect(again.value.source).toEqual(read.value.source);
  }, 60_000);
});

describe('row 17: a root whose round is answered still processes while its candidate is current', () => {
  it('reads the answered root so its candidate still counts as processing', async () => {
    const { world } = await scene.open('memory', { requestDriver: 'on' });
    const ws = await s6b2Workspace(world);
    const source = await world.createSecretary('s6b-answered-source');
    await world.scripted.script(source, [{ kind: 'text', text: 'S6B2 answered request' }]);
    const request = await ws.submit({ label: 's6b-answered', goalId: world.goals.first.goalId, recipient: source.ref });
    await waitForRound(world, request.requestRoot, request.round, 'ended');
    await ws.proposeCandidate({ label: 's6b-answered-candidate', goal: world.goals.first, request });
    const view = await ws.readRequest(request.requestRoot);
    expect(view['processing']).toBe(true);
    expect((view['rounds'] as Array<{ status: string }>)[0]?.status).toBe('ended');
    const { facts } = services(world);
    const routing = await facts.readRoutingSet(world.humanContext(), { source: source.ref, horizon: null });
    expect(routing.status).toBe('ready');
    if (routing.status !== 'ready') return;
    expect(routing.value.roots.map(root => root.requestRoot.queryJobId)).toContain(request.requestRoot.queryJobId);
  }, 60_000);
});

describe('row 17: the coverage and the basis are one complete read window', () => {
  it('discards the whole attempt when a real commit lands after the first fact and before the basis', async () => {
    const { world } = await scene.open('memory');
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    const source = await world.createSecretary('s6b-window-source');
    const target = await world.createSecretary('s6b-window-target');
    const operation = await s6b2Accept(world, { commandId: 's6b-window-accept', source: source.ref, target: target.ref, trigger: 'too_long', actor: 'system' });
    let moved = false;
    let factsReads = 0;
    const sessions = world.platform.sessions;
    // A3 probe: the first fact is answered, then one real public commit lands before the old window's horizon.
    const facts = createSecretaryHandoffFacts({ records: s6b2Backend(captured).records,
      requests: world.platform.requestFacts, duty: s6b2Duty, sessions: { ...sessions,
        readSession: async (ctx, ref) => { const read = await sessions.readSession(ctx, ref); factsReads += 1;
          if (!moved) { moved = true; await ws.submit({ label: 's6b-window-move', goalId: null, recipient: null }); }
          return read; } } });
    const result = await s6b2Advance(world, captured, { coverage: facts }).advanceHandoff(world.humanContext(),
      { kind: 'continue', operation, expectedRevision: 1 });
    expect(moved).toBe(true);
    expect(factsReads).toBe(2); // the moved pass is discarded, never mixed: the whole read runs again
    expect(result).toMatchObject({ status: 'committed', value: { write: { stage: 'fence' } } });
  }, 60_000);
});
