/**
 * XWS2P XP-08 — a failed main-workspace read is `unavailable`, never "the
 * caller is the main workspace", and the failure is not remembered.
 *
 * World: XP-02's (`XWS2P-world.ts`, memory) plus the second workspace's module
 * (`second-mod`, path `/@ws:<second>/src`). The read is `memoryFind` of the note
 * read owner (`createNoteReadModel`, the owner behind `platform.notes` and the
 * `find_graph` memory tool) over the platform's own records, catalog and plans,
 * with `related: {kind:'module', moduleId:'s6a-core'}`; resolving that scope
 * reaches `note-related-scope.ts`'s `mainWorkspaceOutcomeOf`. Its
 * `mainWorkspaceOf` is the uncached `readMainWorkspace` over those records. The
 * one read fault is the A2 wrapper the 4B/4C fixtures use: the real in-memory
 * backend's `readMany` answers the project's `start_lines` record (the record
 * `readMainWorkspace` reads) with `{status:'rejected', code:'unavailable'}` once
 * while armed; every other read is the real one.
 *
 * Named mutation (`src/core/work-graph/notes/note-related-scope.ts:331–:334`):
 * a non-ready main-workspace read returns `{ok:true, value:null}` — the caller
 * (the second workspace) is then taken as main, so the first read answers
 * `ready` instead of `rejected`/`unavailable`.
 *
 * Reversal in the same row: with the fault disarmed the read is made again and
 * must succeed; the note written from the main workspace must come back in the
 * RELATED segment. A remembered failure would keep the caller as main, where
 * `s6a-core`'s `src` ties with `second-mod`'s projected `src`, so the note would
 * fall to the project segment.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { MemoryFindRequest } from '../../src/core/work-graph/model/note-contracts.js';
import { createNoteReadModel } from '../../src/core/work-graph/notes/note-read-model.js';
import { readMainWorkspace } from '../../src/core/work-graph/sessions/role-line-operations.js';
import { operationRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { roleLineOperationRef } from '../../src/core/work-graph/state/role-line-operation.js';
import * as memoryBackend from '../../src/core/record-store/in-memory-record-store.js';
import {
  addXWS2PSecondModule, openXWS2PWorld, writeXWS2PNote, type XWS2PWorld,
} from '../helpers/XWS2P-world.js';

const WORLDS: XWS2PWorld[] = [];
const SPIES: Array<{ mockRestore(): void }> = [];
afterEach(async () => {
  for (const spy of SPIES.splice(0)) spy.mockRestore();
  await Promise.allSettled(WORLDS.splice(0).map(world => world.close()));
});

const findS6ACore = (): MemoryFindRequest => ({ v: 1, op: 'find',
  related: { kind: 'module', moduleId: 's6a-core' }, limit: 20, cursor: null });

describe('XP-08 the main workspace read failure', () => {
  it('answers unavailable instead of treating the caller as main, and reads again after it recovers', async () => {
    let faultKey: string | null = null;
    const platformStore: { records?: memoryBackend.InMemoryRecordBackend['records'] } = {};
    const realFactory = memoryBackend.createInMemoryRecordBackend;
    SPIES.push(vi.spyOn(memoryBackend, 'createInMemoryRecordBackend').mockImplementation((options) => {
      const backend = realFactory(options);
      const records = backend.records;
      platformStore.records = { ...records,
        readMany: (refKeys: readonly string[]) => faultKey !== null && refKeys.includes(faultKey)
          ? Promise.resolve({ status: 'rejected' as const, code: 'unavailable' as const,
            reason: 'XP-08 injected readMany failure' })
          : records.readMany(refKeys) };
      return { ...backend, records: platformStore.records };
    }));

    const world = await openXWS2PWorld();
    WORLDS.push(world);
    expect(await addXWS2PSecondModule(world, {
      moduleId: 'second-mod', name: 'second-mod', summary: 'second workspace module' }))
      .toMatchObject({ status: 'committed' });
    const records = platformStore.records;
    if (records === undefined) throw new Error('XP-08: the platform opened no in-memory records backend');
    // The platform caches the main workspace id once it has read it, so the
    // failure branch is reachable only while that cache is empty; this row
    // proves it with an uncached main-workspace read over the platform's store.
    const notes = createNoteReadModel({ records, plans: world.world.platform.plans,
      architecture: world.world.platform.architecture,
      mainWorkspaceOf: projectId => readMainWorkspace(records, projectId) });

    faultKey = operationRefKey(roleLineOperationRef(world.main.scope.projectId, 'start_lines', 'start_lines'));
    const failed = await notes.memoryFind(world.second.ctx, findS6ACore());
    expect(failed).toMatchObject({ status: 'rejected', code: 'unavailable' });
    faultKey = null;

    const note: NoteDraftV1 = {
      kind: 'convention', topic: 'xp08-main-workspace', conclusion: 'xp08: the main workspace read recovered',
      anchor: { kind: 'file', path: 'src/a.ts' }, extraAnchors: [],
      facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [], body: 'body',
    };
    const write = await writeXWS2PNote(world, world.main, note, 'xp08-main');
    const written = write.write;
    expect(written).toMatchObject({ status: 'accepted' });
    if (written.status === 'rejected') return;

    const recovered = await notes.memoryFind(world.second.ctx, findS6ACore());
    expect(recovered.status).toBe('ready');
    if (recovered.status !== 'ready') return;
    const item = recovered.value.items.find(entry => entry.noteId === written.noteId);
    expect(item?.segment).toBe('related');
  }, 180_000);
});
