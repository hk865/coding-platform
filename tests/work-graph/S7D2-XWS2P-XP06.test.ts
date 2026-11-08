/**
 * XWS2P XP-06 — one batch read groups the paths by the workspace each one names.
 *
 * World: XP-02's (`XWS2P-world.ts`, memory). One note is written from the MAIN
 * workspace through the public `notes/write`: its anchor is `ws1/src/a.ts` and
 * one `file` fact names the SECOND workspace's file by the canonical project
 * path `/@ws:<second>/src/b.ts` with its digest. The check's one
 * `readWorkspaceFiles` batch must read both files from their own roots.
 *
 * Named mutation (`src/core/work-graph/views/note-views.ts:467–:505`):
 * `readBatch` reads the whole batch in the caller's workspace
 * (`workspaceRef(ctx)`) → the other workspace's fact reads `not_found`/
 * `changed`; the "each digest is its own workspace's file" assertion red.
 *
 * Reversal in the same row: writing both paths as one workspace's bare paths
 * reads one workspace only; the same assertion ("the two digests belong to the
 * two different files") goes red. Grouping must not hand every path to one root.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { fileDigestOf } from '../helpers/S4B-note-check-fixture.js';
import {
  addXWS2PSecondModule, openXWS2PWorld, readXWS2PNote, writeXWS2PNote, xws2pProjectPath,
  XWS2P_SECOND_B_TEXT, type XWS2PWorld,
} from '../helpers/XWS2P-world.js';

const WORLDS: XWS2PWorld[] = [];
afterEach(async () => { await Promise.allSettled(WORLDS.splice(0).map(world => world.close())); });

describe('XP-06 one batch read groups by workspace', () => {
  it('reads the main anchor and the second workspace fact from their own roots', async () => {
    const world = await openXWS2PWorld();
    WORLDS.push(world);
    const setup = await addXWS2PSecondModule(world, {
      moduleId: 'second-mod', name: 'second-mod', summary: 'second workspace module' });
    expect(setup).toMatchObject({ status: 'committed' });
    const secondB = xws2pProjectPath(world.second.scope.workspaceId, 'src/b.ts');
    const digestA = await fileDigestOf(`${world.main.root}/src/a.ts`);
    const digestB = await fileDigestOf(`${world.second.root}/src/b.ts`);

    const note: NoteDraftV1 = {
      kind: 'convention', topic: 'xp06-batch', conclusion: 'xp06 batch conclusion',
      anchor: { kind: 'file', path: 'src/a.ts' }, extraAnchors: [],
      facts: [{ kind: 'file', path: secondB, digest: digestB }],
      basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [], body: 'body',
    };
    const write = await writeXWS2PNote(world, world.main, note, 'xp06-batch');
    expect(write.write).toMatchObject({ status: 'accepted' });
    if (write.write.status === 'rejected') return;

    const read = await readXWS2PNote(world, world.main, write.write.noteId);
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    const observations = read.value.observedFiles;
    expect(observations.find(entry => entry.path === 'src/a.ts'))
      .toEqual({ path: 'src/a.ts', digest: digestA, outcome: 'same' });
    expect(observations.find(entry => entry.path === secondB))
      .toEqual({ path: secondB, digest: digestB, outcome: 'same' });
    expect(digestA).not.toBe(digestB);
    expect(observations.every(entry => entry.outcome !== 'forbidden' && entry.outcome !== 'unavailable'))
      .toBe(true);
    // The fact's own text is the second workspace's file, not a same-named main file.
    expect(XWS2P_SECOND_B_TEXT).toBe('export const b = 2;\n');
  }, 180_000);
});
