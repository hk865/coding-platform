/**
 * The maintainer writers: create, link and transfer rows. Each row goes through the one world's real HTTP entry
 * (`S8B-maintainer-world.ts`), never a hand-built ctx or a store read; every pin comes from `sessions/read` inside
 * the world's step.
 *
 * The named mutations are:
 * - create skips the claim (`claimOf` left unchanged): the second line's link open commits instead of conflicting;
 * - `sessions/link` close does not release: the reopen's `null -> owner` CAS conflicts, so reopen is not committed;
 * - reopen takes no claim: the extra line's open commits instead of conflicting;
 * - transfer passes `claimChanges: []`: the extra occupant's `scopeOwned.holder` is L1, not the winning destination L2;
 * - the same-owner open bumps the revision again: the idempotent row's `replayed`/revision/cursor/commit count fail;
 * - the continuation opens the successor link without its scope-transfer child: the module-scope entry and fields fail.
 */
import { dirname } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { ArchiveLineResultV1 } from '../../src/business/workflow/session-archive.js';
import type { RoleSpecContentV1 } from '../../src/contracts/role-spec.js';
import { canonicalKey } from '../../src/contracts/fingerprint.js';
import { MODULE_MAINTAINER_PREFIX } from '../../src/contracts/role-lines.js';
import { canonicalRefKey } from '../../src/core/work-graph/persistence/record-codecs.js';
import { byIdentityPrefix } from '../helpers/S6A-commit-barrier.js';
import { committed as committedLink, ready as readyArchive } from '../helpers/S1-runtime-scenario-fixture.js';
import {
  archiveReceipt, commitBarrier, maintainerClaimMove, openMaintainerWorld0, type MaintainerWorld,
} from '../helpers/S8B-maintainer-world.js';

// A3: a delegating wrapper around the real backend records counts the responsibility-event and work-link commits this
// file's rows make, and the SQLite factory hands back the real database path so `reopenHost` opens the same file.
const barrierState = vi.hoisted(() => ({ responsibilityCommits: 0, linkCommits: 0, sqlitePath: '' }));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const mod = await (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal);
  return { ...mod,
    createInMemoryRecordBackend: (options: Parameters<typeof mod.createInMemoryRecordBackend>[0]) => {
      const backend = mod.createInMemoryRecordBackend(options);
      return { ...backend, records: { ...backend.records,
        commit: (input: Parameters<typeof backend.records.commit>[0]) => {
          if (input.events.some(event => event.eventType === 'SessionResponsibilityChanged')
            || maintainerClaimMove(input)) {
            barrierState.responsibilityCommits += 1;
          }
          if (input.events.some(event => event.eventType === 'SessionWorkLinkChanged')) {
            barrierState.linkCommits += 1;
          }
          return backend.records.commit(input);
        } } };
    } };
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) => {
  const mod = await (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal);
  return { ...mod,
    createSqliteRecordBackend: (options: Parameters<typeof mod.createSqliteRecordBackend>[0]) => {
      barrierState.sqlitePath = options.path;
      const backend = mod.createSqliteRecordBackend(options);
      return { ...backend, records: { ...backend.records,
        commit: (input: Parameters<typeof backend.records.commit>[0]) => {
          if (input.events.some(event => event.eventType === 'SessionResponsibilityChanged')
            || maintainerClaimMove(input)) {
            barrierState.responsibilityCommits += 1;
          }
          if (input.events.some(event => event.eventType === 'SessionWorkLinkChanged')) {
            barrierState.linkCommits += 1;
          }
          return backend.records.commit(input);
        } } };
    } };
});

const worlds: MaintainerWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  expect(left).toEqual([]);
});

async function openW0(backend: 'memory' | 'sqlite'): Promise<MaintainerWorld> {
  const world = await openMaintainerWorld0({ backend });
  worlds.push(world);
  return world;
}

const scopeOwned = (sessionId: string) => ({
  duty: 'executor' as const,
  target: { kind: 'region' as const, moduleRef: { projectId: 'p1', moduleId: 'M' } },
  holder: { projectId: 'p1', sessionId },
});
const scopeReason = (sessionId: string) =>
  `scope_owned: the executor scope {"kind":"region","moduleRef":{"moduleId":"M","projectId":"p1"}} is held by ${sessionId}`;

const executorRoleSpec = (withDuty: boolean): RoleSpecContentV1 => ({
  schemaVersion: 1, ...(withDuty ? { platformDuty: 'executor' as const } : {}),
  label: 'S8B duty read probe', purpose: 'Probe the archive acceptance duty read',
  responsibility: ['execution'],
  requiredMaterials: [{ kind: 'contract', reason: 'Read the module link' }], optionalMaterials: [],
  permissions: { tools: ['read'], writeScope: 'none' },
  budget: { source: 'task-budget', scope: 'assigned-task' },
  requiredOutputs: [{ kind: 'implementation-result', reason: 'Report the result' }],
  exit: { success: 'Report', stop: 'Stop', handoff: 'Keep the references' },
});

describe('M-writers-create', () => {
  it('M-writers-create (memory): the create commit takes the claim, and the close releases it', async () => {
    const world = await openW0('memory');
    const target = world.module('M');
    const first = await world.createMaintainerLine({ label: 'create-first', duty: 'executor', modules: ['M'],
      requestId: 'm-writers-create-line' });
    const firstLink = await world.readLink(first, target);
    expect(firstLink?.revision).toBe(1);
    expect(firstLink?.until).toBeNull();

    const second = await world.link({ line: world.lines.L1, target, requestId: 'm-writers-create-second' });
    expect(second.result).toEqual({ status: 'rejected', code: 'revision_conflict',
      scopeOwned: scopeOwned(first.ref.sessionId), reason: scopeReason(first.ref.sessionId) });

    const close = await world.link({ line: first, target, active: false, requestId: 'm-writers-create-close' });
    const closed = committedLink(close.result);
    expect(closed.revision).toBe(2);

    const retried = await world.link({ line: world.lines.L1, target, requestId: 'm-writers-create-retry' });
    expect(retried.result).toMatchObject({ status: 'committed', replayed: false });
  });
});

describe('M-writers-link', () => {
  it('M-writers-link (memory): open, close and reopen keep the claim; an extra occupant is refused', async () => {
    const world = await openW0('memory');
    const target = world.module('M');

    const opened = committedLink((await world.link({ line: world.lines.L1, target,
      requestId: 'm-writers-link-open' })).result);
    expect(opened.revision).toBe(1);
    expect(opened.since).not.toBeNull();
    expect(opened.until).toBeNull();

    const closed = committedLink((await world.link({ line: world.lines.L1, target, active: false,
      requestId: 'm-writers-link-close' })).result);
    expect(closed.revision).toBe(2);
    expect(closed.since).toBe(opened.since);
    expect(closed.until).not.toBeNull();

    const reopened = committedLink((await world.link({ line: world.lines.L1, target,
      requestId: 'm-writers-link-reopen' })).result);
    expect(reopened.revision).toBe(3);
    expect(reopened.since).not.toBeNull();
    expect(reopened.until).toBeNull();

    const extra = await world.link({ line: world.lines.L2, target, requestId: 'm-writers-link-extra' });
    expect(extra.result).toEqual({ status: 'rejected', code: 'revision_conflict',
      scopeOwned: scopeOwned(world.lines.L1.ref.sessionId), reason: scopeReason(world.lines.L1.ref.sessionId) });
  });
});

describe('M-writers-transfer', () => {
  it.each(['memory', 'sqlite'] as const)(
    'M-writers-transfer (%s): the legal transfer closes the source, opens the destination and moves the claim',
    async backend => {
      const world = await openW0(backend);
      const target = world.module('M');
      const open = committedLink((await world.link({ line: world.lines.L1, target,
        requestId: 'm-writers-transfer-open' })).result);

      const moved = await world.transfer({ from: world.lines.L1, to: world.lines.L2, target,
        requestId: 'm-writers-transfer-move' });
      expect(moved.expected).toHaveLength(4);
      if (moved.result.status !== 'committed') throw new Error(`the transfer did not commit: ${JSON.stringify(moved.result)}`);
      expect(moved.result.value.from).toMatchObject({ revision: 2, since: open.since, until: moved.result.cursor });
      expect(moved.result.value.from.until).not.toBeNull();
      expect(moved.result.value.to).toMatchObject({ revision: 1, since: moved.result.cursor, until: null });

      const extra = await world.link({ line: world.lines.L3, target, requestId: 'm-writers-transfer-extra' });
      expect(extra.result).toEqual({ status: 'rejected', code: 'revision_conflict',
        scopeOwned: scopeOwned(world.lines.L2.ref.sessionId), reason: scopeReason(world.lines.L2.ref.sessionId) });
    });

  it.each(['memory', 'sqlite'] as const)(
    'M-writers-transfer race (%s): one competing transfer commits and the other is a revision conflict',
    async backend => {
      const world = await openW0(backend);
      const target = world.module('M');
      committedLink((await world.link({ line: world.lines.L1, target,
        requestId: 'm-writers-race-open' })).result);

      // The claim move is the hold under test. The second hold is a safety net: if the transfer commit carries no
      // module-maintainer claim (the named `claimChanges: []` mutation), the row fails on the assertion below instead
      // of waiting forever for a hold that can never fire.
      const hold = commitBarrier.hold(maintainerClaimMove);
      const fallback = commitBarrier.hold(byIdentityPrefix('session-responsibility-transfer:'), 'transfer commit');
      const first = world.transfer({ from: world.lines.L1, to: world.lines.L2, target,
        requestId: 'm-writers-race-first' });
      const reached = await Promise.race([
        hold.reached.then(commit => ({ kind: 'claim' as const, commit })),
        fallback.reached.then(commit => ({ kind: 'transfer' as const, commit })),
      ]);
      fallback.release();       // the loser's commit must not wait on the safety net
      expect(reached.kind).toBe('claim');
      expect(reached.commit.claims.some(claim => claim.claimKey.startsWith(MODULE_MAINTAINER_PREFIX))).toBe(true);
      const second = world.transfer({ from: world.lines.L1, to: world.lines.L3, target,
        requestId: 'm-writers-race-second' });
      const secondResult = await second;
      hold.release();
      const firstResult = await first;
      const results = [firstResult, secondResult];
      const statuses = results.map(entry => entry.result.status === 'committed' ? 'committed' : entry.result.code);
      expect(statuses.sort()).toEqual(['committed', 'revision_conflict']);
      const rejected = results.find(entry => entry.result.status === 'rejected');
      if (rejected === undefined || rejected.result.status !== 'rejected') throw new Error('no rejected transfer');
      expect(rejected.result.code).toBe('revision_conflict');
    });
});

describe('M-writers-idempotent', () => {
  it('M-writers-idempotent (memory): the owner re-opening its open link writes nothing and replays the original result', async () => {
    const world = await openW0('memory');
    const target = world.module('M');
    const opened = committedLink((await world.link({ line: world.lines.L1, target,
      requestId: 'm-writers-idempotent-open' })).result);
    const before = await world.readCard(world.lines.L1);

    // The new requestId misses the receipt lookup; the same link is already open and its claim is this line's.
    barrierState.linkCommits = 0;
    barrierState.responsibilityCommits = 0;
    const again = await world.link({ line: world.lines.L1, target, requestId: 'm-writers-idempotent-again' });
    expect(again.result).toMatchObject({ status: 'committed', replayed: true, cursor: opened.since });
    if (again.result.status !== 'committed') throw new Error('the same-owner open is not committed');
    expect(again.result.value).toEqual({ ref: opened.ref, revision: opened.revision, since: opened.since, until: null });

    // M-07: the real delegating wrapper counted zero commits, so the row does not infer "no write" from `replayed`.
    expect(barrierState.linkCommits).toBe(0);
    expect(barrierState.responsibilityCommits).toBe(0);
    const after = await world.readCard(world.lines.L1);
    expect(after.record.revision).toBe(before.record.revision);
    expect(await world.readLink(world.lines.L1, target)).toMatchObject({
      revision: opened.revision, since: opened.since, until: null });
  });
});

describe('M-writers-continuation', () => {
  it('M-writers-continuation (memory): the real handoff moves the maintainer with its scope-transfer child', async () => {
    const world = await openW0('memory');
    const target = world.module('M');
    const opened = committedLink((await world.link({ line: world.lines.L1, target,
      requestId: 'm-writers-continuation-open' })).result);

    const step = await world.handoff({ source: world.lines.L1, commandId: 'm-writers-continuation' });
    expect(step.accepted).toMatchObject({ stage: 'accepted', phase: 'accepted', approval: null });
    expect(step.accepted.operation.projectId).toBe('p1');
    // The saved module-scope sub-step (7D1 G2-2b) is the module entry and its real transfer-child receipt.
    const scope = step.operation.action.progress.scope;
    const moved = scope?.entries.find(entry => entry.target.kind === 'module'
      && entry.target.ref.projectId === 'p1' && entry.target.ref.moduleId === 'M');
    if (moved === undefined || moved.receipt === null) {
      throw new Error(`the saved module-scope sub-step is missing: ${JSON.stringify(scope)}`);
    }
    const child = moved.receipt.cursor;
    expect(child).not.toBeNull();

    expect(await world.readLink(world.lines.L1, target)).toMatchObject({
      revision: opened.revision + 1, since: opened.since, until: child });
    expect(await world.readLink(step.successor, target)).toMatchObject({ revision: 1, since: child, until: null });

    // The successor holds the moved maintainer claim; the source's claim followed the same transfer child.
    const extra = await world.link({ line: world.lines.L3, target, requestId: 'm-writers-continuation-extra' });
    expect(extra.result).toEqual({ status: 'rejected', code: 'revision_conflict',
      scopeOwned: { duty: 'executor', target: { kind: 'region',
        moduleRef: { projectId: 'p1', moduleId: 'M' } }, holder: step.successor },
      reason: scopeReason(step.successor.sessionId) });
  });
});

describe('M-writers-archive-drop', () => {
  it.each(['memory', 'sqlite'] as const)(
    'M-writers-archive-drop (%s): the choice closes the link at the receipt cursor and releases the claim',
    async backend => {
      const world = await openW0(backend);
      const target = world.module('M');
      const opened = committedLink((await world.link({ line: world.lines.L1, target,
        requestId: 'm-writers-archive-open' })).result);

      const archived = readyArchive((await world.archiveLine({ line: world.lines.L1, requestId: 'm-writers-archive-drop',
        tasks: [{ target, disposition: { kind: 'drop' } }] })).result);
      expect(archived).toMatchObject({ state: 'archived', message: '已归档', rejection: null, pendingOn: null });
      const disposal = archiveReceipt(archived, 'responsibility');
      if (disposal === undefined) throw new Error('the drop archive has no responsibility receipt');
      expect(disposal.replayed).toBe(false);

      const closed = await world.readLink(world.lines.L1, target);
      expect(closed).toMatchObject({ revision: opened.revision + 1, since: opened.since, until: disposal.cursor });

      // The module has no maintainer after the drop: every card the public target read returns has no open link.
      const found = await world.findByTarget(target, true);
      expect(found.flatMap(card => card.links).filter(link =>
        link.ref.relation === 'responsible' && link.until === null)).toEqual([]);

      // The released claim lets a new line open the same module; it is not a plain second owner.
      const reoccupied = committedLink((await world.link({ line: world.lines.L3, target,
        requestId: 'm-writers-archive-reoccupied' })).result);
      expect(reoccupied).toMatchObject({ revision: 1, until: null });
      expect(reoccupied.since).not.toBeNull();
      expect(reoccupied.since).not.toEqual(disposal.cursor);

      // A second executor's open module link with no choice is refused before the request registers.
      const other = world.module('M2');
      committedLink((await world.link({ line: world.lines.L2, target: other,
        requestId: 'm-writers-archive-other-open' })).result);
      const missing = await world.archiveLine({ line: world.lines.L2, tasks: [],
        requestId: 'm-writers-archive-missing' });
      expect(missing.result).toEqual({ status: 'rejected', code: 'invalid',
        reason: 'archive_disposal_required: an open responsibility has no archive choice' });
    });

  it.each(['memory', 'sqlite'] as const)(
    'M-writers-archive-drop replay (%s): a pending request replays the original responsibility cursor',
    async backend => {
      const world = await openW0(backend);
      const target = world.module('M');
      committedLink((await world.link({ line: world.lines.L1, target,
        requestId: 'm-writers-archive-replay-open' })).result);

      // M-06: the final archive commit fails once while R is pending, so the next continuation replays the
      // responsibility step instead of taking the `archived` early return.
      const fault = commitBarrier.failCommitOnce(commit =>
        commit.events.some(event => event.eventType === 'SessionArchived'));
      let first: ReadResult<ArchiveLineResultV1>;
      try {
        first = (await world.archiveLine({ line: world.lines.L1, requestId: 'm-writers-archive-replay',
          tasks: [{ target, disposition: { kind: 'drop' } }] })).result;
      } finally { fault.release(); }
      const partial = readyArchive(first);
      expect(partial).toMatchObject({ state: 'partial', message: '处置已完成，归档没成功' });
      expect(partial.session.lifecycle).toBe('active');
      const original = archiveReceipt(partial, 'responsibility');
      if (original === undefined) throw new Error('the faulted archive has no responsibility receipt');
      expect(archiveReceipt(partial, 'archive')).toBeUndefined();

      if (backend === 'sqlite') {
        expect(barrierState.sqlitePath).not.toBe('');
        await world.reopenHost(dirname(barrierState.sqlitePath));
      }
      const continued = readyArchive(await world.continueArchive({ line: world.lines.L1,
        archiveRequestId: 'm-writers-archive-replay' }));
      expect(continued).toMatchObject({ state: 'archived', message: '已归档', rejection: null });
      expect(archiveReceipt(continued, 'responsibility')).toMatchObject({ cursor: original.cursor, replayed: true });
      expect(archiveReceipt(continued, 'archive')?.replayed).toBe(false);
    });
});

describe('M-writers-archive-handover', () => {
  it('M-writers-archive-handover (memory): the transfer moves the claim with one responsibility commit', async () => {
    const world = await openW0('memory');
    const target = world.module('M');
    const opened = committedLink((await world.link({ line: world.lines.L1, target,
      requestId: 'm-writers-handover-open' })).result);

    barrierState.responsibilityCommits = 0;
    const archived = readyArchive((await world.archiveLine({ line: world.lines.L1,
      requestId: 'm-writers-handover', tasks: [{ target,
        disposition: { kind: 'transfer', to: world.lines.L2.ref } }] })).result);
    expect(archived).toMatchObject({ state: 'archived', message: '已归档', rejection: null });
    const disposals = archived.receipts.filter(receipt => receipt.step === 'responsibility');
    expect(disposals).toHaveLength(1);
    const disposal = disposals[0]!;
    // M-07: the real delegating wrapper counted this choice's one commit, not a receipt inference.
    expect(barrierState.responsibilityCommits).toBe(1);

    expect(await world.readLink(world.lines.L1, target)).toMatchObject({
      revision: opened.revision + 1, since: opened.since, until: disposal.cursor });
    expect(await world.readLink(world.lines.L2, target)).toMatchObject({
      revision: 1, since: disposal.cursor, until: null });

    const extra = await world.link({ line: world.lines.L3, target, requestId: 'm-writers-handover-extra' });
    expect(extra.result).toEqual({ status: 'rejected', code: 'revision_conflict',
      scopeOwned: scopeOwned(world.lines.L2.ref.sessionId),
      reason: scopeReason(world.lines.L2.ref.sessionId) });

    // L2 is the module's public maintainer line: the target read returns it with the open link.
    const found = await world.findByTarget(target, true);
    const holder = found.find(card => card.record.ref.sessionId === world.lines.L2.ref.sessionId);
    expect(holder?.links.some(link => link.ref.relation === 'responsible'
      && canonicalKey(link.ref.target) === canonicalKey(target) && link.until === null)).toBe(true);
    expect(found.filter(card => card.record.ref.sessionId === world.lines.L1.ref.sessionId)
      .flatMap(card => card.links).filter(link => link.ref.relation === 'responsible' && link.until === null)).toEqual([]);
  });

  it('M-writers-archive-handover rejection (memory): a non-executor destination is refused exactly', async () => {
    const world = await openW0('memory');
    const target = world.module('M');
    committedLink((await world.link({ line: world.lines.L1, target,
      requestId: 'm-writers-handover-a1-open' })).result);

    const result = (await world.archiveLine({ line: world.lines.L1, requestId: 'm-writers-handover-a1',
      tasks: [{ target, disposition: { kind: 'transfer', to: world.lines.A1.ref } }] })).result;
    const partial = readyArchive(result);
    expect(partial.state).toBe('partial');
    expect(partial.rejection).toEqual({ status: 'rejected', code: 'unavailable',
      reason: 'the destination Session is not an active executor line' });
    expect((await world.readLink(world.lines.L1, target))?.until).toBeNull();
  });
});

describe('M-writers-archive-acceptance-duty', () => {
  it('M-08 (memory): a rejected duty read is unavailable and the request is not registered', async () => {
    const world = await openW0('memory');
    const line = await world.createRoleSpecLine({ label: 'duty-rejected', content: executorRoleSpec(true),
      modules: ['M'], requestId: 'm-writers-duty-rejected-line' });
    if (line.role.kind !== 'role_spec') throw new Error('the line is not a RoleSpec line');
    const fault = commitBarrier.failReads(canonicalRefKey(line.role.pin.ref), 'throw-always');
    let result: ReadResult<ArchiveLineResultV1>;
    try {
      result = (await world.archiveLine({ line, tasks: [], requestId: 'm-writers-duty-rejected' })).result;
    } finally { fault.release(); }
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('the rejected duty read was not refused');
    expect(result.code).toBe('unavailable');
    expect((await world.readCard(line)).record.archiveRequest ?? null).toBeNull();
  });

  it('M-08 (memory): an unknown duty is unavailable and the request is not registered', async () => {
    const world = await openW0('memory');
    const line = await world.createRoleSpecLine({ label: 'duty-unknown', content: executorRoleSpec(false),
      modules: ['M'], requestId: 'm-writers-duty-unknown-line' });
    const result = (await world.archiveLine({ line, tasks: [], requestId: 'm-writers-duty-unknown' })).result;
    expect(result).toEqual({ status: 'rejected', code: 'unavailable', reason: 'the Session duty is unknown' });
    expect((await world.readCard(line)).record.archiveRequest ?? null).toBeNull();
  });
});
