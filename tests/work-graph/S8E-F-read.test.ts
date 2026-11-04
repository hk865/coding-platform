/**
 * S8E-2 R F-read (8E-2 §4.3 :828, :830, :831, :835, :866): the first-tier link
 * read (R2 :328–333, R3 :335–337, R5 :345–360, R7 second exception :377) on the
 * one S8E semantic world (8E §5.2 :604–711; K1, K3 at
 * `tests/helpers/S8E-semantic-world.ts:262–295`).
 *
 * Rows and the spec lines their expectations come from:
 * - E2-04 (:828; E2 write, E3 read): a BOM in `access.ts` before K1 is written;
 *   nothing changes; the read is `verified`, three ends `live`, current, builds 0
 *   (R2 :330: a symbol locator compares the decoded-text digest).
 * - E2-06 (:830; E1 write, E3 read): `src/wg/reg2.ts` (§4.2 :727–728); `onPicked`
 *   only in `export … from` is not a free identifier (R5 rule 5 :353), so the
 *   touched register file reads `refs_pending`.
 * - E2-07 (:831; E1, E3): `src/wg/gate.ts`, `src/wire4.ts` (§4.2 :729–736); a
 *   `constructor` "to" never takes rules 4–5 (R5 :354), the touch reads `refs_pending`.
 * - E2-12 (:835; E1, E3, E5): E2-07's write in its own world (wire4.ts untouched);
 *   a body on the constructor changes its signature digest (R3 :337, F41): "to"
 *   `live`, `symbol_signature_changed`, `stale`, `refs_pending`.
 * - E2-35 (:866; E2, E3): `refs_pending`, then `broken [1]`, then the same item
 *   again (parse results keyed by the decoded-text digest, R7 :377); builds 0.
 *
 * One world per row (R7 keeps verdicts per Host, 8E-2 :372, :377). "Touch" is the
 * line `// touched` (8E-2 :796); builds are `world.linkCheck.builds()` around the
 * read (8E-2 :708, :800). Ids come only from the receipts (A1).
 */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { LinkDraftV1, LinkEndRequestV1 } from '../../src/contracts/note.js';
import type { SemanticLinkV1, SemanticPageV1 } from '../../src/contracts/semantic-layer.js';
import type { NoteItemV1, WriteNoteResult } from '../../src/core/work-graph/model/note-contracts.js';
import {
  openS8ESemanticWorld, s8eLinkDraft, S8E_LINKS, type S8EAgentWrite, type S8ESemanticWorld,
} from '../helpers/S8E-semantic-world.js';

const at = (world: S8ESemanticWorld, path: string): string => join(world.root, path);
const tsEnd = (path: string, name: string): LinkEndRequestV1 =>
  ({ kind: 'file', path, symbolRequest: { language: 'typescript', name } });

/** "Line n becomes X" (1-based). */
async function replaceLine(world: S8ESemanticWorld, path: string, n: number, text: string): Promise<void> {
  const lines = (await readFile(at(world, path), 'utf8')).split('\n');
  lines[n - 1] = text;
  await writeFile(at(world, path), lines.join('\n'), 'utf8');
}

/** "Touch": append `// touched`, 11 bytes with its newline (8E-2 :796). */
const touch = async (world: S8ESemanticWorld, path: string): Promise<void> =>
  await appendFile(at(world, path), '// touched\n', 'utf8');

/** E3: K by noteId on the project page (as `pageOf`, `S8E-R-route.test.ts:50–57`), and that read's builds. */
async function readLink(world: S8ESemanticWorld, noteId: string): Promise<{ item: SemanticLinkV1; builds: number }> {
  const before = world.linkCheck.builds();
  const result = await world.route('architecture/semantic-links', { scope: { kind: 'project' }, cursor: null, limit: 100 });
  const builds = world.linkCheck.builds() - before;
  const read = result as ReadResult<SemanticPageV1<SemanticLinkV1>>;
  if (read.status !== 'ready') throw new Error(`the semantic read was not ready: ${JSON.stringify(result)}`);
  const item = read.value.items.find(candidate => candidate.noteId === noteId);
  if (item === undefined) throw new Error(`${noteId} is not on the semantic page`);
  return { item, builds };
}

/** E5: the owner `lookup` on the note's stored anchor (`S8E-R-tools.test.ts:92–99`), the note by noteId. */
async function lookupItem(world: S8ESemanticWorld, noteId: string): Promise<NoteItemV1> {
  const note = await world.platform.notes.readNote(world.humanContext(), { noteId });
  if (note.status !== 'ready') throw new Error(`readNote ${noteId} was not ready: ${JSON.stringify(note)}`);
  const lookup = await world.platform.notes.memoryLookup(world.humanContext(),
    { v: 1, op: 'lookup', anchor: note.value.anchor, limit: 100, cursor: null });
  if (lookup.status !== 'ready') throw new Error(`the lookup was not ready: ${JSON.stringify(lookup)}`);
  const item = lookup.value.items.find(candidate => candidate.noteId === noteId);
  if (item === undefined) throw new Error(`${noteId} is not in the lookup`);
  return item;
}

/** A person write's receipt (A1): accepted, or the row stops. */
function personId(write: WriteNoteResult): string {
  if (write.status !== 'accepted') throw new Error(`E2: not accepted: ${JSON.stringify(write)}`);
  return write.noteId;
}

/** An E1 write's Kernel-delivered receipt (A1; `S8E-R-context.test.ts:100–111`): accepted, written `verified`. */
function agentId(written: S8EAgentWrite): string {
  const envelope = written.envelope;
  if (envelope === null) throw new Error('E1: the record_note result carried no {write, check}');
  if (envelope.write.status !== 'accepted') throw new Error(`E1: not accepted: ${JSON.stringify(envelope.write)}`);
  const noteId = envelope.write.noteId;
  expect(envelope.check).toMatchObject({ noteId, linkVerification: { status: 'verified' } });
  return noteId;
}

/**
 * The rows' `calls` from run.ts#dispatch under key 'wg.audit' (8E-2 :830–831), written like `linkDraft`
 * (`S8E-L2-link-write.test.ts:99–113`): [0] `register` at one line, [1] `use` as K3's [1] (world :293).
 */
type CallsCase = { files: Readonly<Record<string, readonly string[]>>; to: LinkEndRequestV1; register: string; line: number };
const callsDraft = (topic: string, row: CallsCase): LinkDraftV1 => ({
  kind: 'link', topic, conclusion: `${topic}: dispatch reaches the wg.audit handler`,
  anchor: tsEnd('src/runtime/run.ts', 'dispatch'), extraAnchors: [row.to],
  facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [], body: '',
  link: { relation: 'calls', key: { kind: 'literal', text: 'wg.audit' }, evidence: [
    { role: 'register', at: { path: row.register, range: { startLine: row.line, endLine: row.line } } },
    { role: 'use', at: { path: 'src/runtime/run.ts', symbolRequest: { language: 'typescript', name: 'dispatch' } } },
  ] },
});

// §4.2 :727–728 (E2-06) and :729–736 (E2-07, E2-12), verbatim.
const REG2: CallsCase = {
  files: { 'src/wg/reg2.ts': ["export { onPicked } from './permit.js'; export const PICK_KEY = 'wg.audit';"] },
  to: tsEnd('src/wg/permit.ts', 'onPicked'), register: 'src/wg/reg2.ts', line: 1,
};
const GATE: CallsCase = {
  files: {
    'src/wg/gate.ts': ['export class Gate {', '  constructor(readonly id: string) {}', '}'],
    'src/wire4.ts': ["import { handlers } from './wg/registry.js';", "import { Gate } from './wg/gate.js';",
      "handlers.set('wg.audit', () => { new Gate('x'); });"],
  },
  to: tsEnd('src/wg/gate.ts', 'constructor'), register: 'src/wire4.ts', line: 3,
};

/** The row's new files, then the agent's write (E1); returns the accepted noteId. */
async function writeCalls(world: S8ESemanticWorld, row: string, input: CallsCase): Promise<string> {
  for (const [path, lines] of Object.entries(input.files)) await writeFile(at(world, path), lines.join('\n') + '\n', 'utf8');
  return agentId(await world.writeAgent(callsDraft(row, input), { label: row }));
}

describe('S8E-2 R F-read: the first-tier link read', () => {
  it('E2-04 access.ts saved with a BOM before K1: verified, three ends live, current, builds 0', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1 });
    try {
      const access = at(world, 'src/contracts/access.ts');
      await writeFile(access, '\uFEFF' + await readFile(access, 'utf8'), 'utf8');
      const k1 = personId(await world.writePerson(s8eLinkDraft(S8E_LINKS.K1)));
      const { item, builds } = await readLink(world, k1);
      expect(item.verification).toEqual({ status: 'verified' });
      expect([item.from.anchorStatus, item.to.anchorStatus, item.via?.anchorStatus]).toEqual(['live', 'live', 'live']);
      expect(item.currentEligible).toBe(true);
      expect(builds).toBe(0);
    } finally {
      await world.close();
    }
  }, 180_000);

  it.each<[string, CallsCase]>([
    ['E2-06 onPicked only in export … from (reg2.ts line 1)', REG2],
    ['E2-07 the "to" is Gate\'s constructor (wire4.ts line 3)', GATE],
  ])('%s: written verified; the register file touched, the read is refs_pending', async (name, input) => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1 });
    try {
      const id = await writeCalls(world, name.slice(0, 5), input);
      await touch(world, input.register);
      expect((await readLink(world, id)).item.verification).toEqual({ status: 'unchecked', reason: 'refs_pending' });
    } finally {
      await world.close();
    }
  }, 180_000);

  it('E2-12 E2-07\'s write, wire4.ts untouched, a constructor body: "to" live, signature changed, stale, refs_pending', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1 });
    try {
      const id = await writeCalls(world, 'E2-12', GATE);
      await replaceLine(world, 'src/wg/gate.ts', 2, '  constructor(readonly id: string) { void id; }');
      const { item } = await readLink(world, id);
      expect(item.to.anchorStatus).toBe('live');
      expect(item.freshness).toBe('stale');
      expect((await lookupItem(world, id)).staleReasons).toEqual(['symbol_signature_changed']);
      expect(item.verification).toEqual({ status: 'unchecked', reason: 'refs_pending' });
    } finally {
      await world.close();
    }
  }, 180_000);

  it('E2-35 K1: line 10 begin reads refs_pending, line 7 broken [1], the unchanged reread equal; builds 0', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1 });
    try {
      const k1 = personId(await world.writePerson(s8eLinkDraft(S8E_LINKS.K1)));
      await replaceLine(world, 'src/compose.ts', 10, 'export const begin = (id: string) => runModel(access, id);');
      const first = await readLink(world, k1);
      expect(first.item.verification).toEqual({ status: 'unchecked', reason: 'refs_pending' });
      await replaceLine(world, 'src/compose.ts', 7, 'const access: Access = { before: authorize };');
      const second = await readLink(world, k1);
      expect(second.item.verification).toEqual({ status: 'broken', missing: [1] });
      const third = await readLink(world, k1);
      expect(third.item).toEqual(second.item);
      expect([first.builds, second.builds, third.builds]).toEqual([0, 0, 0]);
    } finally {
      await world.close();
    }
  }, 180_000);
});
