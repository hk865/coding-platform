/**
 * WDT-07/WDT-08/WDT-11 (`wd-tests.frozen.md` §1): the knowledge and history sides of a workspace removal.
 *
 * World: `tests/helpers/S7D2-DWD-world.ts` over `XWS2A-world.ts`; every prior state is a public step (`workspaces/open`,
 * the person `notes/write`, `architecture/semantic-links`, `architecture/read`, `notes/list`). No store is read.
 *
 * WDT-07: Today RED at line 85 `expect(response.status).toBe('ready')`: the Host has no `workspaces/remove` route
 *   (unknown-route `not_found`). After WD lands GREEN because `deleteWorkspaceIndexRows` removes this workspace's
 *   index rows and every anchor prefix `/@ws:<id>/`, so the cross-workspace link leaves the project semantic page
 *   and the main notes read (WD-12/WD-13).
 * WDT-08: Today RED at line 99 `expect(response.status).toBe('ready')`: no `workspaces/remove` route. After WD lands
 *   GREEN because the removal writes no architecture revision (WD-15/WD-23): the saved baseline revision still reads
 *   with `secondId`, while the current read excludes it (WD-16).
 * WDT-11: Today RED at line 121 `expect(response.status).toBe('ready')`: no `workspaces/withdraw` route. After WD lands
 *   GREEN because the knowledge removal deletes index rows only and never `.workbench/notes` (WD-05/WD-12), and a
 *   reopened workspace reindexes the same file note (WD-19).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ArchitectureRevision } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import type { NoteItemV1, WriteNoteEnvelopeV1 } from '../../src/core/work-graph/model/note-contracts.js';
import type { LinkDraftV1, NoteAnchorV1 } from '../../src/contracts/note.js';
import type { SemanticLinkV1, SemanticPageV1 } from '../../src/contracts/semantic-layer.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import {
  cancelSecondGoal, openDwdWorld, readNoteBytes, remove, secondId, writeSecondFileNote,
} from '../helpers/S7D2-DWD-world.js';
import type { XWS2AWorld } from '../helpers/XWS2A-world.js';
import { xws2aSecondPath } from '../helpers/XWS2A-world.js';
import { waitFor } from '../scenarios/harness.js';

const worlds: XWS2AWorld[] = [];
afterEach(async () => {
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
});

const opened = async (options: Parameters<typeof openDwdWorld>[0] = { backend: 'memory' }): Promise<XWS2AWorld> => {
  const world = await openDwdWorld(options);
  worlds.push(world);
  return world;
};

/** The project page of `architecture/semantic-links` (today's body: a `plain` scope, not a bare object). */
async function projectLinks(world: XWS2AWorld): Promise<readonly SemanticLinkV1[]> {
  return valueOf<SemanticPageV1<SemanticLinkV1>>((await world.base.world.post('architecture/semantic-links',
    plain(S6A_SCOPE, { scope: { kind: 'project' }, limit: 100, cursor: null }))).body, 'ready',
  'the project semantic links').items;
}

/** One `notes/list` anchor page. */
async function notePage(world: XWS2AWorld, scope: { projectId: string; workspaceId: string },
  anchor: NoteAnchorV1): Promise<readonly NoteItemV1[]> {
  return valueOf<{ items: readonly NoteItemV1[] }>((await world.base.world.post('notes/list',
    plain(scope, { anchor, limit: 100, cursor: null }))).body, 'ready', `the notes on ${anchor.kind}`).items;
}

describe('S7D2 DWD: removal history and knowledge', () => {
  it('WDT-07 a cross-workspace link leaves the semantic page after the workspace is removed', async () => {
    const world = await opened({ backend: 'memory', withModule: true,
      secondFiles: { 'src/second/note.ts': 'ag2bMarker\n' } });
    await cancelSecondGoal(world);
    const secondFile = xws2aSecondPath(world.second.scope.workspaceId, 'src/second/note.ts');
    const draft: LinkDraftV1 = {
      kind: 'link', topic: 'dwd-link-note', conclusion: 'the main module writes what the second workspace module reads',
      anchor: { kind: 'file', path: 'src/module.ts' },
      extraAnchors: [{ kind: 'module', moduleId: secondId(world) }],
      facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [], body: '',
      link: { relation: 'data', key: { kind: 'literal', text: 'ag2bMarker' }, evidence: [
        { role: 'emit', at: { path: 'src/module.ts' } },
        { role: 'receive', at: { path: secondFile } },
      ] },
    };
    const answer = await world.base.world.post('notes/write', plain(S6A_SCOPE, {
      commandId: 'dwd-link-note', goalId: null, expectedPointerRevision: null, note: draft,
    }));
    const envelope = answer.body as WriteNoteEnvelopeV1;
    expect(envelope.write.status).toBe('accepted');
    if (envelope.write.status !== 'accepted') throw new Error(`WDT-07: the link note was not accepted: ${JSON.stringify(envelope)}`);
    const noteId = envelope.write.noteId;
    expect((await projectLinks(world)).some(item => item.noteId === noteId)).toBe(true);
    expect((await notePage(world, S6A_SCOPE, { kind: 'file', path: 'src/module.ts' })).some(item =>
      item.noteId === noteId)).toBe(true);

    const response = await remove(world, 'remove');
    expect(response.status).toBe('ready');

    expect((await projectLinks(world)).some(item => item.noteId === noteId)).toBe(false);
    expect((await notePage(world, S6A_SCOPE, { kind: 'module', moduleId: 'src' })).some(item =>
      item.noteId === noteId)).toBe(false);
    expect((await notePage(world, S6A_SCOPE, { kind: 'file', path: 'src/module.ts' })).some(item =>
      item.noteId === noteId)).toBe(false);
  });

  it('WDT-08 the saved architecture revision still shows the removed workspace, the current one does not', async () => {
    const world = await opened({ backend: 'memory', withModule: true });
    const revision = (await world.catalog(S6A_SCOPE)).baseline.ref;
    await cancelSecondGoal(world);
    const response = await remove(world, 'remove');
    expect(response.status).toBe('ready');

    const historical = valueOf<ArchitectureRevision>((await world.base.world.post('architecture/read',
      plain(S6A_SCOPE, { selection: { kind: 'revision', ref: revision } }))).body, 'ready',
    'the historical architecture');
    expect(historical.catalog.catalog.modules.some(module => module.ref.moduleId === secondId(world))).toBe(true);
    expect(historical.baseline.ref).toEqual(revision);

    const current = valueOf<ArchitectureRevision>((await world.base.world.post('architecture/read',
      plain(S6A_SCOPE, { selection: { kind: 'current' } }))).body, 'ready', 'the current architecture');
    expect(current.catalog.catalog.modules.some(module => module.ref.moduleId === secondId(world))).toBe(false);
  });

  it('WDT-11 withdrawing a workspace leaves every .workbench note byte untouched and the note reindexes', async () => {
    const world = await opened({ backend: 'memory', secondFiles: { 'docs/dwd-note.md': '# dwd note\n' } });
    const root = await world.secondRoot();
    const envelope = await writeSecondFileNote(world, 'docs/dwd-note.md');
    expect(envelope.write.status).toBe('accepted');
    const before = await readNoteBytes(root);
    expect(before.size).toBeGreaterThanOrEqual(1);

    const response = await remove(world, 'withdraw');
    expect(response.status).toBe('ready');

    const reopened = await world.base.world.settings('workspaces/open', { path: root, name: 'again',
      projectId: S6A_SCOPE.projectId, writeAllowed: false, commandsAllowed: false });
    expect(reopened.status).toBe('ready');
    if (reopened.status !== 'ready') throw new Error(`WDT-11: the workspace did not reopen: ${JSON.stringify(reopened)}`);
    const notes = await waitFor(() => notePage(world, reopened.value.scope,
      { kind: 'file', path: 'docs/dwd-note.md' }),
    items => items.some(item => item.topic === 'dwd-file-note'), 'the reopened workspace note');
    expect(notes.some(item => item.topic === 'dwd-file-note')).toBe(true);
    expect(await readNoteBytes(root)).toEqual(before);
  });
});
