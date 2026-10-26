/**
 * Row 27: the two secretary lifecycle routes, `secretaries/handoff` and `secretaries/archive`, over the REAL Host, the
 * real route table and the real composition root. `handoff` accepts the person's operation and drives the Workflow's
 * advance; `archive` accepts the person's choices and drives the manual archive.
 *
 * Every prior state comes from the frozen fixture's public steps (`openS6B2World`, the line/archive seeds) and every
 * check reads a route or a public owner read. No store read, no hand-written fact, no model call. Expected values are
 * hand-computed from the book: the person's trigger is `manual`, a handoff creates exactly one successor whose
 * provenance names the source, one archive item per chosen root, and the routes refuse a member or system actor
 * before any owner call; the archive drive's facade call is an A3 delegating spy.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import { seedS6BArchiveSource } from '../helpers/S6B1-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { openS6B2World } from '../helpers/S6B2-fixture.js';
import { s6b2Workspace, type S6B2World } from '../helpers/S6B2-handoff-scene.js';

// A3: the frozen commit barrier at the real backend seam; one row holds the handoff's archive registration there.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));

const opened: S6B2World[] = [];

async function openRouteWorld(extraHostOptions?: Record<string, unknown>) {
  const world = await openS6B2World({ backend: 'memory',
    ...(extraHostOptions === undefined ? {} : { extraHostOptions }) });
  opened.push(world);
  return world;
}

afterEach(async () => {
  // A held commit keeps a tracked call open, so the barrier goes first.
  commitBarrier.reset();
  await Promise.all(opened.splice(0).map(world => world.close()));
});

const body = (input: unknown): { scope: typeof S6A_SCOPE; input: unknown } => ({ scope: S6A_SCOPE, input });

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** The `value` of a route answer whose status is `ready`; any other answer fails with what the platform said. */
function readyOf(value: unknown, what: string): Record<string, unknown> {
  const answer = asRecord(value);
  if (answer['status'] !== 'ready') throw new Error(`S6B2: ${what} is not ready: ${JSON.stringify(value)}`);
  return asRecord(answer['value']);
}

/** The handoff successors of one source: real Sessions whose provenance names it. */
async function successorsOf(world: S6B2World, source: SessionRef): Promise<SessionRecord[]> {
  const cards = await world.world.listSessions();
  return cards.map(card => card.record).filter(record => record.provenance.kind === 'handoff'
    && record.provenance.from.projectId === source.projectId
    && record.provenance.from.sessionId === source.sessionId);
}

describe('the two secretary lifecycle routes', () => {
  it('secretaries/handoff accepts the person\'s command and drives the Workflow to the successor', async () => {
    const world = await openRouteWorld();
    const source = await world.world.createSecretary('route-handoff');
    expect(await successorsOf(world, source.ref)).toEqual([]);

    const answer = asRecord((await world.world.post('secretaries/handoff',
      body({ commandId: 's6b2-route-handoff-1', session: source.ref }))).body);
    // The accept committed under the person's own principal and the drive created the successor through the handoff
    // identity: it replaces the source and carries the source's own role, exactly one line.
    const successors = await successorsOf(world, source.ref);
    expect(successors).toHaveLength(1);
    const successor = successors[0]!;
    expect({ projectId: successor.ref.projectId, sessionId: successor.ref.sessionId }).not.toEqual(source.ref);
    expect(successor.role).toEqual((await world.world.readSession(source.ref)).record.role);
    // The route drives the published Workflow's advance and answers its own progress: the handoff finishes, with the
    // source archived and this one successor, so `archive_host_only` is not where the drive stops.
    expect(answer).toMatchObject({ status: 'ready' });
    const progress = asRecord(answer['value']);
    expect({ stage: progress['stage'], phase: progress['phase'], archived: progress['archived'],
      trigger: progress['trigger'], lastRefusal: progress['lastRefusal'] })
      .toEqual({ stage: 'finished', phase: 'completed', archived: true, trigger: 'manual', lastRefusal: null });
    expect(progress['successor']).toEqual({ projectId: successor.ref.projectId, sessionId: successor.ref.sessionId });
    expect((await world.world.readSession(source.ref)).record.lifecycle).toBe('archived');

    // A replay of the same command names the same operation: no second successor and no second handoff.
    const replay = asRecord((await world.world.post('secretaries/handoff',
      body({ commandId: 's6b2-route-handoff-1', session: source.ref }))).body);
    expect(replay).toMatchObject({ status: 'ready' });
    expect(asRecord(replay['value'])['operation']).toEqual(progress['operation']);
    expect(asRecord(replay['value'])['stage']).toBe('finished');
    expect(await successorsOf(world, source.ref)).toEqual([successor]);
  });

  it('counts a live handoff source and its successor as one line at the open cap', async () => {
    const world = await openRouteWorld({ secretaryOpenCap: 2 });
    // A real request opens the source secretary A: it stays processing on it and is the handoff's routing item.
    const first = await world.world.submit({ commandId: 's6b2-route-cap-a', goalId: null, text: 'S6B2 cap A' });
    if (first.status !== 'queued' || first.secretary === null) throw new Error(`S6B2: no source: ${JSON.stringify(first)}`);
    // A3: the drive is held at the archive child's real registration commit, so A stays active with its successor.
    const hold = commitBarrier.hold(byIdentityPrefix('session-archive:'), 'the handoff archive registration');
    const handoff = world.world.post('secretaries/handoff',
      body({ commandId: 's6b2-route-cap-handoff', session: first.secretary }));
    await hold.reached;
    const successors = await successorsOf(world, first.secretary);
    expect(successors).toHaveLength(1);
    const successor = successors[0]!;
    expect((await world.world.readSession(first.secretary)).record.lifecycle).toBe('active');
    // A and its live successor are one line: the cap of 2 admits a third secretary, a new line C.
    const third = await world.world.submit({ commandId: 's6b2-route-cap-c', goalId: null, text: 'S6B2 cap C' });
    expect(third).toMatchObject({ status: 'queued', assignment: 'assigned', created: true, waitReason: null });
    if (third.status !== 'queued' || third.secretary === null) throw new Error(`S6B2: no third line: ${JSON.stringify(third)}`);
    expect([first.secretary.sessionId, successor.ref.sessionId]).not.toContain(third.secretary.sessionId);
    hold.release();
    expect(asRecord((await handoff).body)).toMatchObject({ status: 'ready' });
    expect((await world.world.readSession(first.secretary)).record.lifecycle).toBe('archived');
  });

  it('secretaries/archive accepts one item per chosen root and routes each of them', async () => {
    const world = await openRouteWorld();
    const ws = await s6b2Workspace(world.world);
    const seeded = await seedS6BArchiveSource(ws, 'route-archive');
    const choices = seeded.requests.map(request => ({ requestRoot: request.requestRoot, to: seeded.other }));

    const advanceSpy = vi.spyOn(world.world.platform.sessionArchive, 'advanceArchive');
    const driven = readyOf((await world.world.post('secretaries/archive',
      body({ commandId: 's6b2-route-archive-1', session: seeded.source, choices }))).body, 'the archive route');
    expect(advanceSpy).toHaveBeenCalled();
    advanceSpy.mockRestore();
    // One item per chosen root, each really routed to the chosen successor with its routing receipt, and the source's
    // archive request registered as the operation's own saved write.
    const items = driven['items'] as { requestRoot: { queryJobId: string }; outcome: string | null;
      to: SessionRef | null; receipt: string | null }[];
    expect(items.map(item => item.requestRoot.queryJobId))
      .toEqual(seeded.requests.map(request => request.requestRoot.queryJobId));
    expect(items.map(item => item.outcome)).toEqual(['routed', 'routed']);
    expect(items.map(item => item.to)).toEqual([seeded.other, seeded.other]);
    expect(items.every(item => item.receipt !== null)).toBe(true);
    expect(driven['archiveRequest']).not.toBeNull();

    // A replay names the same operation and writes no second item.
    const replay = asRecord((await world.world.post('secretaries/archive',
      body({ commandId: 's6b2-route-archive-1', session: seeded.source, choices }))).body);
    expect(readyOf(replay, 'the replayed archive route')['operation']).toEqual(driven['operation']);
  });
});

describe('rejects: the two secretary lifecycle routes are the person\'s', () => {
  it('refuses a non-human handoff and archive before any owner call', async () => {
    const world = await openRouteWorld();
    const ws = await s6b2Workspace(world.world);
    const source = await world.world.createSecretary('route-forbidden');
    const seeded = await seedS6BArchiveSource(ws, 'route-forbidden-archive');
    const before = (await world.world.listSessions()).length;
    const sourceBefore = await world.world.readSession(source.ref);
    const archiveSourceBefore = await world.world.readSession(seeded.source);

    // A3: a delegating wrapper around each real accept owner that counts entries and returns its result unchanged.
    // The route's own guard must answer before the owner runs, so the count (not only the body) proves it.
    const handoffOwner = world.world.platform.sessionHandoff;
    const archiveOwner = world.world.platform.sessionArchive;
    const realHandoff = handoffOwner.acceptHandoff.bind(handoffOwner);
    const realArchive = archiveOwner.acceptArchive.bind(archiveOwner);
    let handoffCalls = 0;
    let archiveCalls = 0;
    handoffOwner.acceptHandoff = async (ctx, input) => { handoffCalls += 1; return realHandoff(ctx, input); };
    archiveOwner.acceptArchive = async (ctx, input) => { archiveCalls += 1; return realArchive(ctx, input); };
    try {
      const handoff = asRecord(await world.world.dispatch('secretaries/handoff', world.world.systemContext(),
        body({ commandId: 's6b2-route-system-handoff', session: source.ref })));
      expect(handoff).toMatchObject({ status: 'rejected', code: 'forbidden' });
      const archive = asRecord(await world.world.dispatch('secretaries/archive', world.world.systemContext(),
        body({ commandId: 's6b2-route-system-archive', session: seeded.source,
          choices: [{ requestRoot: seeded.requests[0]!.requestRoot, to: seeded.other }] })));
      expect(archive).toMatchObject({ status: 'rejected', code: 'forbidden' });
    } finally {
      handoffOwner.acceptHandoff = realHandoff;
      archiveOwner.acceptArchive = realArchive;
    }
    expect({ handoffCalls, archiveCalls }).toEqual({ handoffCalls: 0, archiveCalls: 0 });

    // Nothing moved: no line was created and neither source carries a lifecycle write.
    expect((await world.world.listSessions()).length).toBe(before);
    expect(await world.world.readSession(source.ref)).toEqual(sourceBefore);
    expect(await world.world.readSession(seeded.source)).toEqual(archiveSourceBefore);
  });
});
