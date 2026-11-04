/**
 * 8E-2 G (§2.4 :431–447): E2-20 and E2-21 (§4.3 :845–846), the write gate's
 * TypeScript single-file lookup for a file the configured project leaves out.
 *
 * The world is the one S8E semantic world (8E §5.2 :604–711; K1 at
 * `tests/helpers/S8E-semantic-world.ts:263–273`) plus two files written in the
 * row only (8E-2 §4.2 :717): a root `tsconfig.json` with `exclude: ["src/ui"]`
 * and `src/ui/panel.ts`.
 * - E2-20 (:845; E1 write, E5 read): a general note's TS symbol anchor resolves
 *   by the single-file lookup (G7 :439–445, G2 :434), so the excluded file still
 *   stores its locator. Only `language`, `qualifiedName`, `range` are pinned; the
 *   digests' rule is E2-24's (S1).
 * - E2-21 (:846; E1 write): K1 with its [1] wire evidence in that file. The
 *   second tier answers not_in_project for it (W6 :274), which is
 *   analyzer_unavailable (G4 :436), not evidence_missing; the check after the
 *   write reads refs_pending (R5 :347, :359: a stored analyzer_unavailable with
 *   a reference part reads doubtful; `authorize` sits after `.`, `beforeCall` is
 *   a property key, so R5 rules 4 and 5 do not hold). §6 item 2 as frozen: no
 *   new reason word.
 * One world per row (8E-2 :372, :377); only memory (S3).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { WriteNoteEnvelopeV1 } from '../../src/core/work-graph/model/note-contracts.js';
import { openS8ESemanticWorld, s8eLinkDraft, S8E_LINKS, type S8ESemanticWorld } from '../helpers/S8E-semantic-world.js';

const PANEL = 'src/ui/panel.ts';
/** The lead's minimal config for "exclude: ["src/ui"]" (8E-2 :845). */
const TSCONFIG = '{"exclude": ["src/ui"]}\n';

/** The row's files, written under the world root before the note (as `S8E-semantic-world.ts:686–688`). */
async function putFiles(world: S8ESemanticWorld, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    const target = join(world.root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, 'utf8');
  }
}

/** E1: the real Run's `record_note`; the Kernel-delivered `{write, check}` (A1). */
async function agentEnvelope(world: S8ESemanticWorld, note: NoteDraftV1, label: string): Promise<WriteNoteEnvelopeV1> {
  const envelope = (await world.writeAgent(note, { label })).envelope;
  if (envelope === null) throw new Error(`E1 ${label}: the record_note result carried no {write, check}`);
  return envelope;
}

describe('8E-2 G: the write gate looks a TS symbol up in its own file, inside or outside the project', () => {
  it('E2-20 a general note on an excluded file stores the locator of show', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1 });
    try {
      await putFiles(world, { 'tsconfig.json': TSCONFIG, [PANEL]: 'export function show() {}\n' });
      const envelope = await agentEnvelope(world, {
        kind: 'convention', topic: 'E2-20', conclusion: 'show draws the panel',
        anchor: { kind: 'file', path: PANEL, symbolRequest: { language: 'typescript', name: 'show' } },
        extraAnchors: [], facts: [], basisFiles: [], structural: false,
        replaces: [], contradicts: [], coexistWith: [], body: 'show is the panel entry.',
      }, 'E2-20');
      expect(envelope.write, JSON.stringify(envelope.write)).toMatchObject({ status: 'accepted', warnings: [] });
      if (envelope.write.status !== 'accepted') return;
      const read = await world.platform.notes.readNote(world.humanContext(), { noteId: envelope.write.noteId });
      if (read.status !== 'ready') throw new Error(`E2-20: readNote is ${read.status}`);
      // Mutation (8E-2 :845): G7 still goes through the capture, which tsconfig.json keeps
      // the file out of → no locator, symbol_unresolved; this is red.
      expect(read.value.anchor).toMatchObject({ kind: 'file', path: PANEL, symbol: {
        language: 'typescript', qualifiedName: 'show', range: { startLine: 1, endLine: 1 },
        fileDigest: expect.any(String), signatureDigest: expect.any(String) } });
    } finally {
      await world.close();
    }
  }, 180_000);

  it('E2-21 a wire evidence in an excluded file is accepted unverifiable, not evidence_missing', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1 });
    try {
      await putFiles(world, { 'tsconfig.json': TSCONFIG, [PANEL]: [
        "import type { Access } from '../contracts/access.js';",
        'export function show() {}',
        "export function wire(p: typeof import('../wg/permit.js')): Access {",
        '  return { beforeCall: p.authorize };',
        '}',
      ].join('\n') + '\n' });
      const draft = s8eLinkDraft(S8E_LINKS.K1, { topic: 'E2-21' });
      draft.link.evidence[1] = { role: 'wire', at: { path: PANEL, range: { startLine: 3, endLine: 5 } } };
      const envelope = await agentEnvelope(world, draft, 'E2-21');
      // Mutation (8E-2 :846): G4 reads not_in_project as not_found → evidence_missing,
      // evidenceIndexes [1]; this is red.
      expect(envelope.write, JSON.stringify(envelope.write))
        .toMatchObject({ status: 'accepted', warnings: ['evidence_unverifiable'] });
      expect(envelope.check, JSON.stringify(envelope.check))
        .toMatchObject({ linkVerification: { status: 'unchecked', reason: 'refs_pending' } });
    } finally {
      await world.close();
    }
  }, 180_000);
});
