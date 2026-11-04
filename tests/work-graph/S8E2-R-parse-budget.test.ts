/**
 * S8E-2 R parse budget (8E-2 §4.3 :832 E2-08, :867 E2-36): the first tier's
 * single-file parse byte budget `readParseBytesMax` (R4 :343; §2.0 :156, :170)
 * and the digest-keyed parse results that do not spend it (R7 second exception
 * :378; R4 :343), on the slice-4 S4B fixture (8E-2 §4.1 :705–713).
 *
 * Hand computation (8E-2 §4.2 :745–746, :796): `src/a/one.ts` and
 * `src/a/two.ts` are `export function one() {}\n` / `export function two() {}\n`,
 * 25 bytes each; touching appends `// touched\n` (11 bytes), so each is 36.
 * With `readParseBytesMax = 36` one call parses `one` (36 <= 36) and not `two`
 * (36 + 36 > 36). A second call on the same Host reuses `one`'s parse result by
 * its decoded-text digest (no bytes), so `two` fits.
 *
 * The notes are general notes written through the real 4A writer, as
 * `S4B-note-anchor-status.test.ts:155–170`; one `checkNotes` reads both, `one`
 * first. Memory only (S3).
 */
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { NoteCheckV1 } from '../../src/core/work-graph/model/note-contracts.js';
import { createS4BNoteCheckFixture, type S4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';

/** The S4B fixture with `readParseBytesMax = 36` (`check` is spread into `noteLimits`, S4B-note-check-fixture.ts:136). */
const budgetFixture = (): Promise<S4BNoteCheckFixture> =>
  createS4BNoteCheckFixture('memory', { check: { readParseBytesMax: 36 } });

function symbolNote(topic: string, path: string, name: string): NoteDraftV1 {
  return { kind: 'pitfall', topic, conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'file', path, symbolRequest: { language: 'typescript', name } },
    extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [] };
}

async function writeNote(f: S4BNoteCheckFixture, note: NoteDraftV1): Promise<string> {
  const result = await f.inner.write(f.ctx(), note, null);
  if (result.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

/** One `checkNotes` of the two notes, `one` first. */
async function checkBoth(f: S4BNoteCheckFixture, one: string, two: string): Promise<[NoteCheckV1, NoteCheckV1]> {
  const checks = await f.check.checkNotes(f.ctx(), { items: [{ noteId: one, version: 1 }, { noteId: two, version: 1 }] });
  if (checks.status !== 'ready') throw new Error(`checkNotes was not ready: ${JSON.stringify(checks)}`);
  return [checks.value[0]!, checks.value[1]!];
}

/** The E2-08 steps: the two 25-byte files, the two notes, both files touched to 36 bytes, one read. */
async function touchedPair(f: S4BNoteCheckFixture): Promise<{ one: string; two: string; first: [NoteCheckV1, NoteCheckV1] }> {
  await writeFile(join(f.root, 'src/a/one.ts'), 'export function one() {}\n');
  await writeFile(join(f.root, 'src/a/two.ts'), 'export function two() {}\n');
  const one = await writeNote(f, symbolNote('one', 'src/a/one.ts', 'one'));
  const two = await writeNote(f, symbolNote('two', 'src/a/two.ts', 'two'));
  await appendFile(join(f.root, 'src/a/one.ts'), '// touched\n');
  await appendFile(join(f.root, 'src/a/two.ts'), '// touched\n');
  return { one, two, first: await checkBoth(f, one, two) };
}

describe('S8E-2 R parse budget: readParseBytesMax and the digest-keyed parse results', () => {
  it('E2-08 readParseBytesMax 36: one (36 bytes) parses live and fresh; two (36 + 36 > 36) is unchecked', async () => {
    const f = await budgetFixture();
    try {
      const { first: [one, two] } = await touchedPair(f);
      expect(one.anchorStatus).toBe('live');
      expect(one.freshness).toBe('fresh');
      expect(two.freshness).toBe('unchecked');
      expect(two.currentEligible).toBe(false);
    } finally { await f.close(); }
  }, 180_000);

  it('E2-36 the same Host reads again: one hits its parse result and spends no bytes, so two parses live and fresh',
    async () => {
      const f = await budgetFixture();
      try {
        const { one: oneId, two: twoId, first } = await touchedPair(f);
        // Precondition (F11): the first read left `two` unchecked, so the second half cannot pass empty.
        expect(first[1].freshness).toBe('unchecked');
        const [one, two] = await checkBoth(f, oneId, twoId);
        expect(one.anchorStatus).toBe('live');
        expect(one.freshness).toBe('fresh');
        expect(two.anchorStatus).toBe('live');
        expect(two.freshness).toBe('fresh');
      } finally { await f.close(); }
    }, 180_000);
});
