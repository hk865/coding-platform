/**
 * G rows 3–5: a Python syntax error falls back to that file anchor.
 * Row 3: broken drive.py -> accepted, `warnings: ['symbol_unresolved']`, one
 *   `symbolProblems` { field: 'anchor' }; the read-back anchor is the plain file.
 *   Mutation `note-anchors.ts:370` makes `resolveSymbol` reject `syntax_error`;
 *   red at `write.status === 'accepted'`.
 * Row 4: a broken extra anchor beside permit.ts's `authorize` -> only
 *   `extraAnchors[0]` falls back while the TS symbol still resolves. Mutation
 *   `note-anchors.ts:534` rejects on any `symbolProblem`; red at accepted.
 * Row 5: the default `record_note` text names the rule. Mutation
 *   `resources/prompts/platform/tools/record_note.json:2` drops it; red at `toContain`.
*/
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNoteTools } from '../../src/core/agent-runtime/note-tool.js';
import { generalNote } from '../helpers/S4C2-note-card-fixture.js';
import { openS8ESemanticWorld } from '../helpers/S8E-semantic-world.js';

/** The bad Python text, byte for byte (`def broken(:` then an indented `pass`). */
const BROKEN_PYTHON = 'def broken(:\n    pass\n';

describe('8E-2 G: a Python syntax error falls back to the file anchor instead of rejecting the note', () => {
  it('Row 3: drive.py with a syntax error warns symbol_unresolved and stores the plain file anchor', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1 });
    try {
      await writeFile(join(world.root, 'src/robot/drive.py'), BROKEN_PYTHON, 'utf8');
      const { envelope, item } = await world.writeAgent(generalNote({ kind: 'convention', topic: 'row3',
        conclusion: 'row3: the note keeps its file anchor',
        anchor: { kind: 'file', path: 'src/robot/drive.py', symbolRequest: { language: 'python', name: 'main' } } }), { label: 'row3' });
      const write = envelope?.write;
      expect(write, JSON.stringify(write)).toMatchObject({ status: 'accepted',
        warnings: ['symbol_unresolved'],
        symbolProblems: [{ field: 'anchor', path: 'src/robot/drive.py', line: 1, message: expect.any(String) }] });
      if (write?.status !== 'accepted') throw new Error(`row3: ${JSON.stringify(write)}`);
      if (item === null) throw new Error('row3: no stored item');
      expect(item.anchor).toEqual({ kind: 'file', path: 'src/robot/drive.py' });
    } finally {
      await world.close();
    }
  }, 180_000);

  it('Row 4: a broken extra anchor falls back while permit.ts authorize still resolves', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1 });
    try {
      await writeFile(join(world.root, 'src/robot/drive.py'), BROKEN_PYTHON, 'utf8');
      const { envelope, item } = await world.writeAgent(generalNote({ kind: 'convention', topic: 'row4',
        conclusion: 'row4: the note keeps its file anchor',
        anchor: { kind: 'file', path: 'src/wg/permit.ts', symbolRequest: { language: 'typescript', name: 'authorize' } },
        extraAnchors: [{ kind: 'file', path: 'src/robot/drive.py', symbolRequest: { language: 'python', name: 'main' } }] }), { label: 'row4' });
      const write = envelope?.write;
      expect(write, JSON.stringify(write)).toMatchObject({ status: 'accepted',
        warnings: ['symbol_unresolved'],
        symbolProblems: [{ field: 'extraAnchors[0]', path: 'src/robot/drive.py', line: 1 }] });
      if (write?.status !== 'accepted') throw new Error(`row4: ${JSON.stringify(write)}`);
      if (item === null) throw new Error('row4: no stored item');
      expect(item.anchor).toMatchObject({ kind: 'file', path: 'src/wg/permit.ts',
        symbol: { language: 'typescript', qualifiedName: 'authorize' } });
      expect(item.extraAnchors[0]).toEqual({ kind: 'file', path: 'src/robot/drive.py' });
    } finally {
      await world.close();
    }
  }, 180_000);

  it('Row 5: the default record_note text states the syntax-error fallback and symbolProblems', () => {
    // The PC2-W-note-tool fake-context shape, no `texts`: the platform's default description.
    const definition = createNoteTools({ context: {} as never, notes: {} as never, check: {} as never,
      requestIdForCall: () => 'r', kinds: ['convention'], withdraw: true }).create({} as never)[0]!;
    const description = definition.description;
    expect(description).toContain('A Python file with a syntax error still stores its file anchor');
    expect(description).toContain('symbolProblems');
    expect(description).toContain('fix the syntax first');
  });
});
