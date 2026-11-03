/**
 * The delete-module rule reads every open responsible
 * link of the PROJECT, not only the caller workspace's directory page.
 *
 * Two workspaces A and B of one project; B's line has an open responsible link
 * to `docs`. From A, `remove_module docs` with no move must refuse with
 * `responsibility_destination_missing` and keep `docs`; with the move it must
 * commit once, move B's line to `src/a`, and carry B's own workspace on the
 * `SessionResponsibilityChanged` event. The world is the real catalog owner and
 * memory store (`S8C-catalog-world.ts`), without the catalog-service mock: the
 * production responsibility port is the one under test.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalKey } from '../../src/contracts/fingerprint.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import type { ResponsibilityMoveV1 } from '../../src/contracts/note.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { openS8CCatalogWorld } from '../helpers/S8C-catalog-world.js';
import { responsibleLinkRef } from '../../src/core/work-graph/sessions/session-responsibility-service.js';
import { committed, ready } from '../helpers/S1-runtime-scenario-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));

type World = Awaited<ReturnType<typeof openS8CCatalogWorld>>;
const worlds: World[] = [];
const kernelDirs: string[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.all(worlds.splice(0).map(world => world.close()));
  await Promise.all(kernelDirs.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
  expect(left).toEqual([]);
});

async function openWorld(): Promise<World> {
  const world = await openS8CCatalogWorld();
  worlds.push(world);
  return world;
}

/** Workspace B, one real line created and linked to `docs` through B's own call context. */
async function lineInB(world: World) {
  const second = await world.openWorkspace('B');
  // B's own Kernel Store: `sessions/create` refuses a workspace the registry
  // does not know, and the fixture registers only A's.
  const kernelDirectory = await mkdtemp(join(tmpdir(), 's8c-row1-kernel-'));
  kernelDirs.push(kernelDirectory);
  // The real composition always publishes this optional interface member; only
  // a narrow test double leaves it out.
  const registerCurrent = world.platform.kernelStores.registerCurrent;
  if (registerCurrent === undefined) throw new Error('the Kernel store registry cannot register workspace B');
  await registerCurrent({
    adapterId: 's8c-row1-kernel-B', storeKey: 's8c-row1-kernel-store-B',
    workspace: second.scope, databasePath: join(kernelDirectory, 'kernel.sqlite'),
  });
  const created = await world.platform.runtime.createSession(second.ctx, {
    workspace: second.scope, role: world.lines.l1.role, recommendedRefs: [], initialLinks: [],
    meta: { requestId: 's8c-row1-session', expected: [] },
  });
  if (created.status !== 'completed') throw new Error(`sessions/create: ${JSON.stringify(created)}`);
  const line = created.value;
  const sessionRef = { projectId: second.scope.projectId, sessionId: line.ref.sessionId };
  const target = { kind: 'module' as const, ref: { projectId: second.scope.projectId, moduleId: 'docs' } };
  const card = ready(await world.platform.sessions.readSession(second.ctx, sessionRef));
  const ref = responsibleLinkRef(sessionRef, target);
  const link = committed(await world.platform.sessions.linkSessionWork(second.ctx, {
    meta: { requestId: 's8c-row1-link', expected: [
      { ref: card.record.ref, revision: card.record.revision },
      { ref, revision: 0 },
    ] },
    input: { sessionRef, target, relation: 'responsible', active: true },
  }));
  return { second, sessionRef, link };
}

const moduleIds = async (world: World): Promise<string[]> => {
  const read = ready(await world.platform.architecture.readArchitectureRevision(world.ctx,
    { selection: { kind: 'current' } }));
  return read.catalog!.catalog.modules.map(module => module.ref.moduleId);
};

/** `sessions/link active:false` over the line's own card and link pins, from public reads. */
async function closeResponsibilityLink(world: World, session: SessionRecord, moduleId: string) {
  const sessionRef = { projectId: world.scope.projectId, sessionId: session.ref.sessionId };
  const target = { kind: 'module' as const, ref: { projectId: world.scope.projectId, moduleId } };
  const card = await world.readSession(session);
  const ref = responsibleLinkRef(sessionRef, target);
  const existing = card.links.find(entry => canonicalKey(entry.ref) === canonicalKey(ref));
  if (existing === undefined) throw new Error(`the line has no ${moduleId} link to close`);
  return committed(await world.platform.sessions.linkSessionWork(world.ctx, {
    meta: { requestId: `s8c-row1-close-${moduleId}`, expected: [
      { ref: card.record.ref, revision: card.record.revision },
      { ref, revision: existing.revision },
    ] },
    input: { sessionRef, target, relation: 'responsible', active: false },
  }));
}

describe('S8C row 1 project-level responsible links', () => {
  it('row 1: an empty move refuses on B\'s open link; the move commits and keeps B on the event', async () => {
    const world = await openWorld();
    const b = await lineInB(world);
    const removeDocs = [{ op: 'remove_module' as const, moduleId: 'docs' }];

    const refused = await world.revise({ ops: removeDocs, reason: 'delete docs without a move' });
    expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(refused.status === 'rejected' ? refused.reason : '').toContain('responsibility_destination_missing');
    expect(await moduleIds(world)).toContain('docs');

    const move: ResponsibilityMoveV1 = {
      link: b.link.ref,
      to: { kind: 'modules', destinations: [{ projectId: world.scope.projectId, moduleId: 'src/a' }] },
    };
    const hold = commitBarrier.hold(byIdentityPrefix('architecture-catalog-revise:'), 'row 1 delete');
    const revising = world.revise({ ops: removeDocs, responsibilityMoves: [move], reason: 'delete docs and move B' });
    const prepared = await hold.reached;
    const changed = prepared.events.find(event => event.eventType === 'SessionResponsibilityChanged');
    expect(changed).toBeDefined();
    const body = JSON.parse(changed!.json) as { workspaceId?: string; source?: { workspaceId?: string } };
    expect(body.workspaceId).toBe('B');
    hold.release();
    const revision = committed(await revising);
    expect(revision.baseline.ref.revision).toBe(2);
    expect(await moduleIds(world)).not.toContain('docs');

    // B's own context, not A's: only B may read B's line card.
    const after = ready(await world.platform.sessions.readSession(b.second.ctx, b.sessionRef));
    const closed = after.links.find(entry => canonicalKey(entry.ref) === canonicalKey(b.link.ref));
    expect(closed?.until).not.toBeNull();
    const moved = after.links.find(entry => entry.ref.relation === 'responsible' && entry.until === null
      && entry.ref.target.kind === 'module' && entry.ref.target.ref.moduleId === 'src/a');
    expect(moved).toBeDefined();
  });

  it('row 1: a closed destination link reopens through the delete move instead of conflicting', async () => {
    const world = await openWorld();
    const line = world.lines.l1;
    // The same Session holds an open link on M (docs) and a formerly open one on N (src).
    const docsLink = await world.link(line, 'docs');
    const closedSrc = await closeResponsibilityLink(world, line, 'src');
    expect(closedSrc.until).not.toBeNull();

    const move: ResponsibilityMoveV1 = {
      link: docsLink.ref,
      to: { kind: 'modules', destinations: [{ projectId: world.scope.projectId, moduleId: 'src' }] },
    };
    const revision = committed(await world.revise({
      ops: [{ op: 'remove_module', moduleId: 'docs' }], responsibilityMoves: [move],
      reason: 'delete docs and move the line back to src',
    }));
    expect(revision.baseline.ref.revision).toBe(2);
    expect(await moduleIds(world)).not.toContain('docs');

    // Public Session read, not a store read: N is open again one revision after the closed record.
    const after = await world.readSession(line);
    const reopened = after.links.find(entry => entry.ref.relation === 'responsible' && entry.until === null
      && entry.ref.target.kind === 'module' && entry.ref.target.ref.moduleId === 'src');
    expect(reopened).toBeDefined();
    expect(reopened?.revision).toBe(closedSrc.revision + 1);
  });

  it('row 3: an archived executor\'s open link is not an open responsibility and does not block the delete', async () => {
    const world = await openWorld();
    const line = world.lines.l1;
    const docsLink = await world.link(line, 'docs');
    const card = await world.readSession(line);
    const archived = committed(await world.platform.sessions.archiveSession(world.ctx, {
      meta: { requestId: 's8c-row3-archive', expected: [
        { ref: card.record.ref, revision: card.record.revision }] },
      input: { sessionRef: { projectId: world.scope.projectId, sessionId: line.ref.sessionId },
        reason: 'the executor line is archived' },
    }));
    expect(archived.lifecycle).toBe('archived');
    const retained = await world.readSession(line);
    expect(retained.links.some(entry => canonicalKey(entry.ref) === canonicalKey(docsLink.ref)
      && entry.until === null)).toBe(true);

    // Empty moves: no active line needs migrating off docs, so the delete commits.
    const revision = committed(await world.revise({
      ops: [{ op: 'remove_module', moduleId: 'docs' }], reason: 'remove docs with only an archived link',
    }));
    expect(revision.baseline.ref.revision).toBe(2);
    expect(await moduleIds(world)).not.toContain('docs');
  });
});
