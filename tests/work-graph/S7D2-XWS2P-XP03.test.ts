/**
 * XWS2P XP-03 — a stored path reads in the workspace the RECORD names, not the caller's.
 *
 * World: XP-02's (`XWS2P-world.ts`, memory). `ws1/src/a.ts` is
 * `export const a = 1;`, `ws/2/src/a.ts` is `export const a = 2;`. Two notes are
 * written through the public `notes/write`, each with the bare request path
 * `src/a.ts` under its own context; the second workspace's write side stores
 * `/@ws:<second>/src/a.ts`. Then the row stands in the MAIN workspace and reads
 * the second workspace's note (`notes/read`, whose check owns `observedFiles`),
 * and the other way round. The expected digests are the independent
 * `fileDigestOf` of the two real files.
 *
 * Named mutation (`src/core/work-graph/views/note-views.ts:467–:505`):
 * `readBatch` always uses `workspaceRef(ctx)` (the caller's workspace) and skips
 * the `resolveStoredProjectPath` grouping → reading the second workspace's note
 * from `ws1` reads `ws1/src/a.ts` (or `not_found` for the prefixed path);
 * assertion 1 red.
 *
 * Reversal in the same row: `notes/read` still returns the canonical
 * `anchor.path` `/@ws:<second>/src/a.ts`, not a stripped workspace path.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { fileDigestOf } from '../helpers/S4B-note-check-fixture.js';
import {
  addXWS2PSecondModule, openXWS2PWorld, readXWS2PNote, writeXWS2PNote, xws2pProjectPath,
  type XWS2PWorld,
} from '../helpers/XWS2P-world.js';

const WORLDS: XWS2PWorld[] = [];
afterEach(async () => { await Promise.allSettled(WORLDS.splice(0).map(world => world.close())); });

const noteAt = (path: string, topic: string): NoteDraftV1 => ({
  kind: 'convention', topic, conclusion: `${topic} conclusion`,
  anchor: { kind: 'file', path }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
  replaces: [], contradicts: [], coexistWith: [], body: 'body',
});

describe('XP-03 a stored path reads in its own workspace', () => {
  it('the second workspace note observes ws/2/src/a.ts while the read runs in ws1', async () => {
    const world = await openXWS2PWorld();
    WORLDS.push(world);
    const setup = await addXWS2PSecondModule(world, {
      moduleId: 'second-mod', name: 'second-mod', summary: 'second workspace module' });
    expect(setup).toMatchObject({ status: 'committed' });
    const secondPath = xws2pProjectPath(world.second.scope.workspaceId, 'src/a.ts');

    const secondWrite = await writeXWS2PNote(world, world.second, noteAt('src/a.ts', 'xp03-second'), 'xp03-second');
    expect(secondWrite.write).toMatchObject({ status: 'accepted' });
    const mainWrite = await writeXWS2PNote(world, world.main, noteAt('src/a.ts', 'xp03-main'), 'xp03-main');
    expect(mainWrite.write).toMatchObject({ status: 'accepted' });
    if (secondWrite.write.status === 'rejected' || mainWrite.write.status === 'rejected') return;

    const mainDigest = await fileDigestOf(`${world.main.root}/src/a.ts`);
    const secondDigest = await fileDigestOf(`${world.second.root}/src/a.ts`);
    expect(secondDigest).not.toBe(mainDigest);

    // Standing in the MAIN workspace, read the second workspace's note.
    const fromMain = await readXWS2PNote(world, world.main, secondWrite.write.noteId);
    expect(fromMain.status).toBe('ready');
    if (fromMain.status !== 'ready') return;
    const secondObservation = fromMain.value.observedFiles.find(entry => entry.path === secondPath);
    // 1. The digest is ws/2/src/a.ts's, never ws1's.
    expect(secondObservation).toEqual({ path: secondPath, digest: secondDigest, outcome: 'same' });
    expect(secondObservation?.digest).not.toBe(mainDigest);
    // 3. The observed path is the canonical project path, and the read is not forbidden/unavailable.
    expect(fromMain.value.observedFiles.map(entry => entry.path)).toContain(secondPath);
    expect(fromMain.value.observedFiles.every(entry => entry.outcome !== 'forbidden'
      && entry.outcome !== 'unavailable')).toBe(true);

    // Standing in the second workspace, read the main workspace's note.
    const fromSecond = await readXWS2PNote(world, world.second, mainWrite.write.noteId);
    expect(fromSecond.status).toBe('ready');
    if (fromSecond.status !== 'ready') return;
    // 2. Its observation is ws1/src/a.ts's digest; the two are not equal.
    expect(fromSecond.value.observedFiles.find(entry => entry.path === 'src/a.ts'))
      .toEqual({ path: 'src/a.ts', digest: mainDigest, outcome: 'same' });
    expect(fromSecond.value.observedFiles.find(entry => entry.path === 'src/a.ts')?.digest).not.toBe(secondDigest);

    // Reversal: the read side keeps the canonical anchor, never a stripped workspace path.
    expect(fromMain.value.anchor).toEqual({ kind: 'file', path: secondPath });
  }, 180_000);
});
