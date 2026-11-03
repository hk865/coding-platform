/**
 * S8E L3 R-tools.
 *
 * The world is the L2 `openS8ESemanticWorld` (spec §5.2, 19 files, K1–K7).
 * E1 is blocked on this tree: `src/app/host.ts:659` authorizes the note
 * workspace read only for `ctx.principal.kind === 'host'`, so a Work Run's
 * `record_note` file anchor is `invalid`/`anchor_forbidden`
 * (`tests/helpers/S8E-semantic-world.ts:28-35`; `8e-l2-reply.md` §1 item 1).
 * This row therefore writes K1 and one general note through E2
 * (`notes/write`, a person), and reports the E1 half as unproven. No principal
 * is built and no product code is changed.
 *
 * The reads are the real `platform.notes.memoryFind` / `memoryLookup` owner
 * entries with the world's own Host context (`world.humanContext()`), not a
 * fabricated `CoreCallContext`.
 *
 * Named mutation (owner, not the tool schema): delete the `kind` test in
 * `headMatchesFilters` (`src/core/work-graph/notes/note-read-model.ts`, `kindMatches` call);
 * `find kind: 'link'` then returns the general note too, and the
 * "only links" assertion fails.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type {
  MemoryLookupResultV1, MemoryResultV1, NoteItemV1, WriteNoteResult,
} from '../../src/core/work-graph/model/note-contracts.js';
import {
  openS8ESemanticWorld, s8eLinkDraft, S8E_LINKS, type S8ESemanticWorld,
} from '../helpers/S8E-semantic-world.js';

type AcceptedWrite = Extract<WriteNoteResult, { status: 'accepted' | 'pending_review' | 'staged' }>;

const accepted = (write: WriteNoteResult): AcceptedWrite => {
  if (write.status === 'rejected') throw new Error(`write rejected: ${write.code}/${write.reason}`);
  if (write.status !== 'accepted') throw new Error(`write was not accepted: ${write.status}`);
  return write;
};

const ready = <T>(result: { status: string; value?: T }, what: string): T => {
  if (result.status !== 'ready' || result.value === undefined) {
    throw new Error(`${what} was not ready: ${JSON.stringify(result)}`);
  }
  return result.value;
};

/** One of the six general kinds, on the same file as K1's "from" end. */
function generalDraft(): NoteDraftV1 {
  return {
    kind: 'convention', topic: 'r-tools-general', conclusion: 'keep the call narrow',
    anchor: { kind: 'file', path: 'src/runtime/run.ts' },
    extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], body: 'The general note this row keeps out of link reads.',
  };
}

describe('S8E L3 R-tools: find by kind and lookup on the "to" anchor', () => {
  let world: S8ESemanticWorld;

  beforeAll(async () => { world = await openS8ESemanticWorld({ scribeTasks: 1 }); }, 120_000);
  afterAll(async () => { await world?.close(); });

  it('find kind:link returns only links (K1); kind:general excludes K1; lookup on permit.ts#authorize returns K1', async () => {
    const ctx = world.humanContext();

    // E2: the person `notes/write` route, K1 first. The id is the receipt's;
    // the assertion pins only version 1 (the world never pins `n1`).
    const k1 = accepted(await world.writePerson(s8eLinkDraft(S8E_LINKS.K1)));
    expect(k1.version).toBe(1);

    const general = accepted(await world.writePerson(generalDraft()));
    expect(general.version).toBe(1);
    expect(general.noteId).not.toBe(k1.noteId);

    const links = ready(await world.platform.notes.memoryFind(ctx, {
      v: 1, op: 'find', kind: 'link', limit: 100, cursor: null,
    }), 'find kind:link') as MemoryResultV1;
    const linkIds = links.items.map(item => item.noteId);
    expect(linkIds).toContain(k1.noteId);
    expect(linkIds).not.toContain(general.noteId);
    expect(links.items.every(item => item.kind === 'link')).toBe(true);

    const generalNotes = ready(await world.platform.notes.memoryFind(ctx, {
      v: 1, op: 'find', kind: 'general', limit: 100, cursor: null,
    }), 'find kind:general') as MemoryResultV1;
    const generalIds = generalNotes.items.map(item => item.noteId);
    expect(generalIds).toContain(general.noteId);
    expect(generalIds).not.toContain(k1.noteId);
    expect(generalNotes.items.every(item => item.kind !== 'link')).toBe(true);

    // The stored "to" anchor the platform resolved for K1 is the lookup
    // anchor; its file type has a resolved `symbol`, not a `symbolRequest`.
    const k1Read = ready(await world.platform.notes.readNote(ctx, { noteId: k1.noteId }), 'read K1') as NoteItemV1;
    const toAnchor = k1Read.extraAnchors[0];
    if (toAnchor === undefined) throw new Error('K1 has no "to" anchor');
    expect(toAnchor).toMatchObject({ kind: 'file', path: 'src/wg/permit.ts' });

    const lookup = ready(await world.platform.notes.memoryLookup(ctx, {
      v: 1, op: 'lookup', anchor: toAnchor, limit: 100, cursor: null,
    }), 'lookup on permit.ts#authorize') as MemoryLookupResultV1;
    const item = lookup.items.find(candidate => candidate.noteId === k1.noteId) as NoteItemV1 | undefined;
    expect(item).toBeDefined();
    if (item === undefined) return;
    expect(item.kind).toBe('link');
    expect(item.storedState).toBe('accepted');
    expect(item.link?.relation).toBe('injects');
    expect(item.link?.verification).toEqual({ status: 'verified' });
  });
});
