/**
 * NW (brief NW-1, NW-4; slice-4-SPEC.md:199, :215; MVP-BEHAVIOR.md:199): every
 * `facts` entry is a pointer to a fixed version, so its shape is checked at
 * the Kernel and a copied-text key is refused by the write owner.
 *
 * T1 (NW-1): the tool schema names the missing field. A file fact without
 * `digest` never passes the Kernel, so the scripted Run fails at
 * `facts.0.digest` and no note is stored; the same fact with the hand-computed
 * digest of `export function audit(id: string) {}\n` is accepted.
 * The named mutation puts `:236` back to `z.record(z.string(), z.unknown())`:
 * the first call succeeds as a rejected write instead of failing, so
 * `writeAgent` does not throw and the row goes red.
 *
 * T2 (NW-4): `file`, `note` and `commit` each carry one extra `note` key with
 * copied text. The service refuses each with the fact's index and its own
 * reason, and stores no note. The named mutation deletes the `file` branch's
 * `hasOnlyKeys` line: the file row is accepted instead of refused.
 *
 * Only memory (a business row, tests/RULES.md S3); the world is the existing
 * 8E semantic world, writes go through the real Work Run / `notes/write`.
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1, NoteFactV1 } from '../../src/contracts/note.js';
import { openS8ESemanticWorld } from '../helpers/S8E-semantic-world.js';

const ANCHOR = { kind: 'file', path: 'src/wg/audit.ts' } as const;
/** `printf 'export function audit(id: string) {}\n' | sha256sum` (the Kernel file revision). */
const DIGEST = '8da2145812fd59849bd09721928f810291db26bb0936efd168bb8e4f32f79d64';

function conventionDraft(topic: string, facts: readonly unknown[]): NoteDraftV1 {
  return {
    kind: 'convention', topic, conclusion: 'audit 是空函数，要用就引用它，不另写',
    anchor: ANCHOR,
    extraAnchors: [], facts: facts as NoteFactV1[], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], body: 'audit 只在 src/wg/audit.ts 里，要用就引用它。',
  };
}

async function acceptedTopics(world: Awaited<ReturnType<typeof openS8ESemanticWorld>>): Promise<string[]> {
  const listed = await world.platform.notes.listNotes(world.humanContext(),
    { anchor: ANCHOR, state: 'accepted', limit: 50, cursor: null });
  if (listed.status !== 'ready') throw new Error(`notes.listNotes is ${listed.status}`);
  return listed.value.items.map(item => item.topic);
}

describe('NW-1: the record_note facts schema names the field the model missed', () => {
  it('a file fact without digest fails the Run at facts.0.digest, then the right shape is accepted', async () => {
    const world = await openS8ESemanticWorld({});
    try {
      const topic = 'nw-no-digest';
      await expect(world.writeAgent(conventionDraft(topic, [{ kind: 'file', path: 'src/wg/audit.ts' }]),
        { label: 'nw-no-digest' })).rejects.toThrow(
        'S8E: record_note failed for nw-no-digest: 工具参数不符合 schema：facts.0.digest: Invalid input: expected string, received undefined');
      expect(await acceptedTopics(world)).not.toContain(topic);

      const written = await world.writeAgent(conventionDraft('nw-with-digest',
        [{ kind: 'file', path: 'src/wg/audit.ts', digest: DIGEST }]), { label: 'nw-with-digest' });
      expect(written.envelope?.write.status).toBe('accepted');
    } finally {
      await world.close();
    }
  }, 120_000);
});

type ExtraKeyRow = { readonly name: string; readonly fact: Readonly<Record<string, unknown>>; readonly reason: string };

/** Each fact differs from the tool schema only by one copied-text key. */
const EXTRA_KEY_ROWS: readonly ExtraKeyRow[] = [
  { name: 'file',
    fact: { kind: 'file', path: 'src/wg/audit.ts', digest: DIGEST, note: 'audit 是空函数' },
    reason: 'facts[0]: file fact carries unknown fields' },
  { name: 'note',
    fact: { kind: 'note', noteId: 'nw-note-1', version: 1, note: 'audit 是空函数' },
    reason: 'facts[0]: note fact carries unknown fields' },
  { name: 'commit',
    fact: { kind: 'commit', sha: 'a'.repeat(40), note: 'audit 是空函数' },
    reason: 'facts[0]: commit fact carries unknown fields' },
];

describe('rejects: a fact that carries copied text is refused with its index', () => {
  it.each(EXTRA_KEY_ROWS)('a $name fact with an extra note key is rejected invalid and writes no note', async row => {
    const world = await openS8ESemanticWorld({});
    try {
      const topic = `nw-extra-${row.name}`;
      const write = await world.writePerson(conventionDraft(topic, [row.fact]));
      expect(write).toMatchObject({ status: 'rejected', code: 'invalid', reason: row.reason });
      expect(await acceptedTopics(world)).not.toContain(topic);
    } finally {
      await world.close();
    }
  }, 120_000);
});
