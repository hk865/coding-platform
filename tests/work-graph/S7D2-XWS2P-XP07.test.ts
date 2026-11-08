/**
 * XWS2P XP-07 — link evidence compares after projecting to the evidence's own workspace.
 *
 * World: XP-02's (`XWS2P-world.ts`, memory). From the second workspace, the
 * public `notes/write` writes a `link`: `from` is the file `src/a.ts` (a real
 * file in the second root) and `to` is `module:second-mod`. The sheet's relation
 * `'use'` does not exist in this tree's `SemanticRelationV1` (there `use` is an
 * evidence ROLE); the one relation whose `entry` evidence is checked against the
 * `to` module's ownership is `spawns`, so the row uses `spawns` with its two
 * required roles (`launch` on the from file, `entry` on the same file). The
 * write must be accepted (never `evidence_outside_end`), store the file anchor
 * as the canonical project path, and name the second workspace's module.
 *
 * Named mutation (`src/core/work-graph/notes/link-evidence.ts:149–:155`):
 * `evidenceOwnershipOf` compares the RAW prefixed `evidence.at.path` with the
 * projected module path (`M2`'s `src`) → ownership misses, the write is refused
 * `evidence_outside_end`, assertion 1 red.
 *
 * Reversal in the same row: the same `to: second-mod` written from the MAIN
 * workspace names `ws1/src/a.ts`, which is `M1`'s file, not `M2`'s → the write
 * is refused: a prefix alone does not make the evidence belong to `M2`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { LinkDraftV1 } from '../../src/contracts/note.js';
import {
  addXWS2PSecondModule, openXWS2PWorld, readXWS2PNote, writeXWS2PNote, xws2pProjectPath,
  type XWS2PWorld,
} from '../helpers/XWS2P-world.js';

const WORLDS: XWS2PWorld[] = [];
afterEach(async () => { await Promise.allSettled(WORLDS.splice(0).map(world => world.close())); });

const linkDraft = (topic: string): LinkDraftV1 => ({
  kind: 'link', topic, conclusion: `${topic} conclusion`, body: '',
  anchor: { kind: 'file', path: 'src/a.ts' },
  extraAnchors: [{ kind: 'module', moduleId: 'second-mod' }],
  facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [],
  // `spawns` is the tree's relation whose `entry` evidence is owned by the `to` module;
  // the sheet's `relation:'use'`/`role:'use'` does not exist (see the header).
  link: { relation: 'spawns', key: { kind: 'literal', text: 'a' },
    evidence: [{ role: 'launch', at: { path: 'src/a.ts' } }, { role: 'entry', at: { path: 'src/a.ts' } }] },
});

describe('XP-07 evidence is owned after projection', () => {
  it('accepts the second workspace link and refuses the main workspace one', async () => {
    const world = await openXWS2PWorld();
    WORLDS.push(world);
    const setup = await addXWS2PSecondModule(world, {
      moduleId: 'second-mod', name: 'second-mod', summary: 'second workspace module' });
    expect(setup).toMatchObject({ status: 'committed' });
    const secondPath = xws2pProjectPath(world.second.scope.workspaceId, 'src/a.ts');

    // 1. The second workspace's own file is inside M2: the write is accepted.
    const write = await writeXWS2PNote(world, world.second, linkDraft('xp07-second'), 'xp07-second');
    expect(write.write).toMatchObject({ status: 'accepted' });
    if (write.write.status === 'rejected') return;
    const read = await readXWS2PNote(world, world.second, write.write.noteId);
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.value.kind).toBe('link');
    // 2. `from` is stored as the canonical project path.
    expect(read.value.anchor).toEqual({ kind: 'file', path: secondPath });
    // 3. The evidence belongs to the second workspace's module, never the main workspace's M1.
    expect(read.value.link?.ends.to).toEqual({ kind: 'module', moduleId: 'second-mod' });
    expect(read.value.link?.ends.to).not.toEqual({ kind: 'module', moduleId: 's6a-core' });

    // Reversal: the same target from the MAIN workspace names ws1/src/a.ts, which is M1's file.
    const reversed = await writeXWS2PNote(world, world.main, linkDraft('xp07-main'), 'xp07-main');
    expect(reversed.write.status).toBe('rejected');
  }, 180_000);
});
