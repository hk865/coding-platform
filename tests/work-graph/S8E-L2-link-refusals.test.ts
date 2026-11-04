/**
 * S8E L2 W-refuse (sheet §6.2): the write-time refusals through both frozen
 * entry layers.
 *
 * E1 is the real scribe Work Run: the scripted model calls the real
 * `record_note` inside `driveWorkflow`'s `select_work` (the world's
 * `writeAgent`), and the Kernel-delivered `{write, check}` is the receipt. Each
 * E1 refusal is preceded by a real K1 write, so the `compose.ts` reads of `[1]`
 * and `[0]` see a committed link. E2 stays the person `notes/write` route. Both
 * layers run the same assertion body, so the refusal table is not duplicated.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { WriteNoteResult } from '../../src/core/work-graph/model/note-contracts.js';
import {
  openS8ESemanticWorld, s8eLinkDraft, S8E_LINKS, type S8ESemanticWorld,
} from '../helpers/S8E-semantic-world.js';

const K1 = S8E_LINKS.K1;
const K3 = S8E_LINKS.K3;

type WriteVia = 'E1' | 'E2';

/** The one write entry of `via`: a real Run's `record_note`, or the person route. */
async function submitRefusal(world: S8ESemanticWorld, via: WriteVia, draft: NoteDraftV1,
  label: string): Promise<WriteNoteResult> {
  if (via === 'E2') return await world.writePerson(draft);
  const written = await world.writeAgent(draft, { label: `refusal-${label}` });
  if (written.envelope === null) throw new Error(`the ${label} agent write returned no {write, check}`);
  return written.envelope.write;
}

let baselineSeq = 0;

/** E1's preceding committed K1 (its own topic, so the same-topic gate is not this row). */
async function seedRefusalK1(world: S8ESemanticWorld, via: WriteVia, label: string): Promise<void> {
  if (via === 'E2') return;
  baselineSeq += 1;
  // A short unique topic: the note contract's topic cap is 40 code points.
  const id = `refusal-base-${baselineSeq}`;
  const written = await world.writeAgent(s8eLinkDraft(K1, { topic: id }), { label: id });
  const write = written.envelope?.write;
  if (write?.status !== 'accepted') {
    throw new Error(`the ${label} K1 baseline was not accepted: ${JSON.stringify(write)}`);
  }
}

type RefusalCase = {
  name: string;
  run: (world: S8ESemanticWorld, via: WriteVia, label: string) => Promise<void>;
};

describe('S8E L2 W-refuse: link write refusals', () => {
  const worlds: Partial<Record<WriteVia, S8ESemanticWorld>> = {};

  beforeAll(async () => {
    // E1 needs one K1 baseline plus one draft per refusal; E2 does not consume tasks.
    worlds.E1 = await openS8ESemanticWorld({ scribeTasks: 30 });
    worlds.E2 = await openS8ESemanticWorld({ scribeTasks: 1 });
  }, 240_000);
  afterAll(async () => {
    await worlds.E1?.close();
    await worlds.E2?.close();
  });

  const worldOf = (via: WriteVia): S8ESemanticWorld => {
    const world = worlds[via];
    if (world === undefined) throw new Error(`the ${via} world is not open`);
    return world;
  };

  const cases: RefusalCase[] = [
    {
      name: 'E-02: two same-name definitions are symbol_ambiguous: extraAnchors[0]',
      run: async (world, via, label) => {
        const draft = s8eLinkDraft(K1, { topic: 'E-02', extraAnchors: [
          { kind: 'file', path: 'src/wg/dual.ts', symbolRequest: { language: 'typescript', name: 'authorize' } },
          K1.via!,
        ] });
        const write = await submitRefusal(world, via, draft, label);
        expect(write.status).toBe('rejected');
        if (write.status !== 'rejected') return;
        expect(write.code).toBe('invalid');
        expect(write.reason).toBe('symbol_ambiguous: extraAnchors[0]');
        expect(write.symbolCandidates).toEqual([
          { name: 'authorize', range: { startLine: 2, endLine: 2 } },
          { name: 'authorize', range: { startLine: 5, endLine: 5 } },
        ]);
      },
    },
    {
      name: 'E-22: evidence [1] changed away from the wire line is evidence_missing [1]',
      run: async (world, via, label) => {
        const draft = s8eLinkDraft(K1, { topic: 'E-22a' });
        draft.link.evidence[1] = { role: 'wire', at: { path: 'src/compose.ts', range: { startLine: 10, endLine: 10 } } };
        const write = await submitRefusal(world, via, draft, label);
        expect(write.status).toBe('rejected');
        if (write.status !== 'rejected') return;
        expect(write.reason).toBe('evidence_missing');
        expect(write.evidenceIndexes).toEqual([1]);
      },
    },
    {
      name: 'E-22: both evidence lines gone is evidence_missing [0,1]',
      run: async (world, via, label) => {
        const draft = s8eLinkDraft(K1, { topic: 'E-22b' });
        draft.link.evidence[0] = { role: 'use', at: { path: 'src/runtime/run.ts', range: { startLine: 1, endLine: 1 } } };
        draft.link.evidence[1] = { role: 'wire', at: { path: 'src/compose.ts', range: { startLine: 10, endLine: 10 } } };
        const write = await submitRefusal(world, via, draft, label);
        expect(write.status).toBe('rejected');
        if (write.status !== 'rejected') return;
        expect(write.reason).toBe('evidence_missing');
        expect(write.evidenceIndexes).toEqual([0, 1]);
      },
    },
    {
      name: 'E-24: a null key is accepted but unverifiable (key_not_literal)',
      run: async (world, via, label) => {
        const draft = s8eLinkDraft(K3, { topic: 'E-24a' });
        draft.link.key = null;
        const write = await submitRefusal(world, via, draft, label);
        expect(write.status).toBe('accepted');
        if (write.status === 'rejected') return;
        expect(write.warnings).toEqual(['evidence_unverifiable']);
        const read = await world.platform.notes.readNote(world.humanContext(), { noteId: write.noteId });
        expect(read.status).toBe('ready');
        if (read.status !== 'ready') return;
        expect(read.value.link?.verification).toEqual({ status: 'unverifiable', reason: 'key_not_literal' });
      },
    },
    {
      name: 'E-24: the same null-key link with a missing evidence line is evidence_missing [0]',
      run: async (world, via, label) => {
        const draft = s8eLinkDraft(K3, { topic: 'E-24b' });
        draft.link.key = null;
        draft.link.evidence[0] = { role: 'register', at: { path: 'src/compose.ts', range: { startLine: 10, endLine: 10 } } };
        const write = await submitRefusal(world, via, draft, label);
        expect(write.status).toBe('rejected');
        if (write.status !== 'rejected') return;
        expect(write.reason).toBe('evidence_missing');
        expect(write.evidenceIndexes).toEqual([0]);
      },
    },
    {
      name: 'E-24: a null key with unreadable evidence is accepted unverifiable',
      run: async (world, via, label) => {
        // L2 only sees the write receipt warning. The exact stored reason
        // `key_not_literal` is L3's readback half. This variant is not a
        // red-first row; row 5's RED evidence is E-27 5a.
        const draft = s8eLinkDraft(K3, { topic: 'E-24-unreadable' });
        draft.link.key = null;
        // The working-tree reads of both evidence files fail, so neither content
        // can be loaded; the anchors' existence probes (maxBytes:1) are not hit.
        world.linkCheck.faultReads(request => request.version.kind === 'working_tree'
          && request.maxBytes > 1
          && (request.path === 'src/runtime/run.ts' || request.path === 'src/compose.ts')
          ? { status: 'rejected', code: 'unavailable', reason: 'the evidence cannot be read' }
          : null);
        const write = await submitRefusal(world, via, draft, label)
          .finally(() => { world.linkCheck.faultReads(null); });
        expect(write.status).toBe('accepted');
        if (write.status === 'rejected') return;
        expect(write.warnings).toEqual(['evidence_unverifiable']);
      },
    },
    {
      name: 'E-28: a misspelt "to" is link_end_unresolved: extraAnchors[0]',
      run: async (world, via, label) => {
        const draft = s8eLinkDraft(K1, { topic: 'E-28', extraAnchors: [
          { kind: 'file', path: 'src/wg/permit.ts', symbolRequest: { language: 'typescript', name: 'authorise' } },
          K1.via!,
        ] });
        const write = await submitRefusal(world, via, draft, label);
        expect(write.status).toBe('rejected');
        if (write.status !== 'rejected') return;
        expect(write.reason).toBe('link_end_unresolved: extraAnchors[0]');
      },
    },
    {
      name: 'E-29: a use evidence outside the "from" is evidence_outside_end [0]',
      run: async (world, via, label) => {
        const draft = s8eLinkDraft(K1, { topic: 'E-29' });
        draft.link.evidence[0] = { role: 'use', at: { path: 'src/wg/permit.ts', range: { startLine: 1, endLine: 3 } } };
        const write = await submitRefusal(world, via, draft, label);
        expect(write.status).toBe('rejected');
        if (write.status !== 'rejected') return;
        expect(write.reason).toBe('evidence_outside_end');
        expect(write.evidenceIndexes).toEqual([0]);
      },
    },
    {
      name: 'E-39: containment is reported before a missing later evidence line',
      run: async (world, via, label) => {
        const draft = s8eLinkDraft(K1, { topic: 'E-39a' });
        draft.link.evidence[0] = { role: 'use', at: { path: 'src/wg/permit.ts', range: { startLine: 1, endLine: 3 } } };
        draft.link.evidence[1] = { role: 'wire', at: { path: 'src/compose.ts', range: { startLine: 10, endLine: 10 } } };
        const write = await submitRefusal(world, via, draft, label);
        expect(write.status).toBe('rejected');
        if (write.status !== 'rejected') return;
        expect(write.reason).toBe('evidence_outside_end');
        expect(write.evidenceIndexes).toEqual([0]);
      },
    },
    {
      name: 'E-39: an unresolved end is reported before a missing evidence line',
      run: async (world, via, label) => {
        const draft = s8eLinkDraft(K1, { topic: 'E-39b', extraAnchors: [
          { kind: 'file', path: 'src/wg/permit.ts', symbolRequest: { language: 'typescript', name: 'authorise' } },
          K1.via!,
        ] });
        draft.link.evidence[1] = { role: 'wire', at: { path: 'src/compose.ts', range: { startLine: 10, endLine: 10 } } };
        const write = await submitRefusal(world, via, draft, label);
        expect(write.status).toBe('rejected');
        if (write.status !== 'rejected') return;
        expect(write.reason).toBe('link_end_unresolved: extraAnchors[0]');
      },
    },
    {
      name: 'E-40: a forbidden evidence [1] read is evidence_invalid at its path',
      run: async (world, via, label) => {
        // The workspace read fault wraps the real note check's workspace (the
        // shared object the note service holds); only the evidence [1] file is faulted.
        world.linkCheck.faultReads(request => request.path === 'src/compose.ts'
          ? { status: 'rejected', code: 'forbidden', reason: 'forbidden by the E-40 read fault' }
          : null);
        try {
          const write = await submitRefusal(world, via, s8eLinkDraft(K1, { topic: 'E-40' }), label);
          expect(write.status).toBe('rejected');
          if (write.status !== 'rejected') return;
          expect(write.code).toBe('invalid');
          expect(write.reason).toBe('evidence_invalid: link.evidence[1].at.path');
        } finally {
          world.linkCheck.faultReads(null);
        }
      },
    },
    {
      name: 'E-40: a forbidden symbol selector on evidence [0] is still evidence_invalid',
      run: async (world, via, label) => {
        // The read of the evidence file is forbidden, so the write falls back to
        // evidence_invalid (M1), never evidence_unverifiable (8E-2 §4.4 :883).
        const draft = s8eLinkDraft(S8E_LINKS.K2, { topic: 'E-40-symbol-forbidden' });
        draft.link.evidence[0] = { role: 'wire', at: { path: 'src/compose.ts',
          symbolRequest: { language: 'typescript', name: 'hooks' } } };
        world.linkCheck.faultReads(request => request.path === 'src/compose.ts'
          ? { status: 'rejected', code: 'forbidden', reason: 'forbidden by the E-40 read fault' }
          : null);
        try {
          const write = await submitRefusal(world, via, draft, label);
          expect(write.status).toBe('rejected');
          if (write.status !== 'rejected') return;
          expect(write.code).toBe('invalid');
          expect(write.reason).toBe('evidence_invalid: link.evidence[0].at.path');
        } finally {
          world.linkCheck.faultReads(null);
        }
      },
    },
  ];

  const rows = (['E1', 'E2'] as const).flatMap(via => cases.map(entry => ({ via, ...entry })));

  it.each(rows)('$via $name', async ({ via, name, run }: { via: WriteVia } & RefusalCase) => {
    const world = worldOf(via);
    await seedRefusalK1(world, via, name);
    await run(world, via, name);
  }, 120_000);
});
