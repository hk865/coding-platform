/**
 * XWS2P XP-02 — two workspaces both hold `src/a.ts`; modules and notes must not mix.
 *
 * World: XP-02's two real roots (`XWS2P-world.ts`), memory. The main
 * workspace's catalog module is `s6a-core` over `src`; the second workspace's
 * module `second-mod` owns `/@ws:<second>/src`, added by one human
 * `architecture/revise` from the second workspace (the sheet's exploration
 * proposal is not reachable there: the second workspace has no Runtime or
 * Workflow binding, so no QueryRun can run — see the helper header). Both notes
 * are written through the public `notes/write` with the bare request path
 * `src/a.ts` and each workspace's own context.
 *
 * Named mutation (`src/core/work-graph/notes/note-anchors.ts:400–:410`): make
 * `anchorKeyOf`'s file arm `file:${normalizePath(anchor.path).replace(/^\/@ws:[^/]+\//,'')}`
 * (strip the prefix) → the two notes get one key, the second workspace's anchor
 * check goes red (assertion 2).
 *
 * Reversal in the same row: the project graph read keeps the whole catalog
 * (`graph-context-reader.ts`, no `catalogForWorkspace` projection) → the second
 * workspace's `graph/look(path:'src')` hits `M1` and its `graph/find('src/a.ts')`
 * attributes the file to `M1`; assertions 3 and 4 red: the read side must project.
 * (The proposal-side qualification is not reachable here — the second workspace
 * has no Run — and is A's XA-05 row.)
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { GraphReadPageV1, NodeCardV1 } from '../../src/core/work-graph/model/graph-context-contracts.js';
import { anchorKeyOf } from '../../src/core/work-graph/notes/note-anchors.js';
import {
  addXWS2PSecondModule, xws2pModuleId, findXWS2P, listXWS2PNotes, lookXWS2P, openXWS2PWorld, readXWS2PCatalog,
  readXWS2PNote, writeXWS2PNote, xws2pProjectPath, type XWS2PWorld,
} from '../helpers/XWS2P-world.js';

const WORLDS: XWS2PWorld[] = [];
afterEach(async () => { await Promise.allSettled(WORLDS.splice(0).map(world => world.close())); });

const noteAt = (path: string, topic: string): NoteDraftV1 => ({
  kind: 'convention', topic, conclusion: `${topic} conclusion`,
  anchor: { kind: 'file', path }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
  replaces: [], contradicts: [], coexistWith: [], body: 'body',
});

const moduleIdsOf = (page: GraphReadPageV1<NodeCardV1>): string[] =>
  page.items.flatMap(card => card.node.kind === 'module' ? [card.node.ref.moduleId] : []);

describe('XP-02 two workspaces, one project catalog, two note anchors', () => {
  it('keeps M1/M2 and the two src/a.ts notes apart through the public reads', async () => {
    const world = await openXWS2PWorld();
    WORLDS.push(world);
    const qualified = xws2pProjectPath(world.second.scope.workspaceId, 'src');
    const setup = await addXWS2PSecondModule(world, {
      moduleId: 'second-mod', name: 'second-mod', summary: 'second workspace module' });
    expect(setup).toMatchObject({ status: 'committed' });
    const secondMod = xws2pModuleId(world.second.scope.workspaceId, 'second-mod');

    // 1. The one project catalog: M1 keeps its bare path, M2 carries the second workspace's prefix.
    const catalog = await readXWS2PCatalog(world);
    const modules = catalog.catalog.catalog.modules;
    const m1 = modules.find(module => module.ref.moduleId === 's6a-core');
    const m2 = modules.find(module => module.ref.moduleId === secondMod);
    expect(m1?.name).toBe('first-mod');
    expect(m1?.paths).toEqual(['src']);
    expect(m2?.paths).toEqual([qualified]);
    expect(m1?.ref.moduleId).not.toBe(m2?.ref.moduleId);
    expect(modules.filter(module => module.ref.moduleId === secondMod)).toHaveLength(1);

    // 2. The two notes: the second workspace's stored anchor is the canonical project path.
    const mainWrite = await writeXWS2PNote(world, world.main, noteAt('src/a.ts', 'xp02-main'), 'xp02-main');
    expect(mainWrite.write).toMatchObject({ status: 'accepted' });
    const secondWrite = await writeXWS2PNote(world, world.second, noteAt('src/a.ts', 'xp02-second'), 'xp02-second');
    expect(secondWrite.write).toMatchObject({ status: 'accepted' });
    if (mainWrite.write.status === 'rejected' || secondWrite.write.status === 'rejected') return;
    const mainRead = await readXWS2PNote(world, world.main, mainWrite.write.noteId);
    const secondRead = await readXWS2PNote(world, world.second, secondWrite.write.noteId);
    expect(mainRead.status).toBe('ready');
    expect(secondRead.status).toBe('ready');
    if (mainRead.status !== 'ready' || secondRead.status !== 'ready') return;
    expect(mainRead.value.anchor).toEqual({ kind: 'file', path: 'src/a.ts' });
    expect(secondRead.value.anchor).toEqual({ kind: 'file', path: `${qualified}/a.ts` });
    expect(anchorKeyOf(mainRead.value.anchor)).toBe('file:src/a.ts');
    expect(anchorKeyOf(secondRead.value.anchor)).toBe(`file:${qualified}/a.ts`);
    expect(anchorKeyOf(mainRead.value.anchor)).not.toBe(anchorKeyOf(secondRead.value.anchor));

    // The tree's `notes/list` is anchor-scoped (`NoteListRequestV1`), so each
    // workspace's own request for the bare `src/a.ts` answers its own note; the
    // two are told apart by their anchor keys, never by a workspace filter.
    const mainList = await listXWS2PNotes(world, world.main, { kind: 'file', path: 'src/a.ts' });
    const secondList = await listXWS2PNotes(world, world.second, { kind: 'file', path: 'src/a.ts' });
    expect(mainList.status).toBe('ready');
    expect(secondList.status).toBe('ready');
    if (mainList.status !== 'ready' || secondList.status !== 'ready') return;
    expect(mainList.value.items.map(item => item.noteId)).toEqual([mainWrite.write.noteId]);
    expect(secondList.value.items.map(item => item.noteId)).toEqual([secondWrite.write.noteId]);

    // 3. `graph/look(path:'src')` hits the workspace's own module only.
    const mainLook = await lookXWS2P(world, world.main, 'src');
    const secondLook = await lookXWS2P(world, world.second, 'src');
    expect(mainLook.status).toBe('ready');
    expect(secondLook.status).toBe('ready');
    if (mainLook.status !== 'ready' || secondLook.status !== 'ready') return;
    expect(moduleIdsOf(mainLook.value)).toEqual(['s6a-core']);
    expect(moduleIdsOf(secondLook.value)).toEqual([secondMod]);

    // 4. `graph/find('src/a.ts')` attributes the file to the workspace's own module.
    const mainFind = await findXWS2P(world, world.main, 'src/a.ts');
    const secondFind = await findXWS2P(world, world.second, 'src/a.ts');
    expect(mainFind.status).toBe('ready');
    expect(secondFind.status).toBe('ready');
    if (mainFind.status !== 'ready' || secondFind.status !== 'ready') return;
    expect(moduleIdsOf(mainFind.value)).toContain('s6a-core');
    expect(moduleIdsOf(mainFind.value)).not.toContain(secondMod);
    expect(moduleIdsOf(secondFind.value)).toContain(secondMod);
    expect(moduleIdsOf(secondFind.value)).not.toContain('s6a-core');
  }, 180_000);
});
