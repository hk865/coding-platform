/**
 * 8E-2 G8 (§2.4 :446) and R3 (§2.3 :335–340): E2-24 and E2-29a–d (§4.3 :852,
 * :857–860; group "G, R", r-start-rulings 1: the write half is G8, the read half
 * R3), a general note's Python/C++ symbol anchor through the W11 single-file
 * lookup (§2.1 :279–298).
 *
 * - E2-24 (:852; E1 write, E5 read): drive.py of the S8E world
 *   (`tests/helpers/S8E-semantic-world.ts:187–190`; the spec's `:184–185` is
 *   teleop.py). The stored locator is pinned whole; both digests are
 *   hand-computed (below). Touched (:796) it reads live/fresh, renamed
 *   retired/symbol_missing (R3 :337).
 * - E2-29a–d (:857–860; E1, E5): the §4.2 cpp files (:774–782) written in the
 *   row (:717), with or without compile_commands.json (W11 :283, :293; written as
 *   `tests/data/S8E2-W-native-cpp.test.ts:26–29`), an include outside the
 *   workspace (a fatal diagnostic, W11 rule 5 :289) or `<cstddef>` (the
 *   compiler's own headers, W11 rule 1 :285). The renamed read is
 *   retired/symbol_missing only on an exact parse; otherwise it reads doubtful
 *   (R3 :338, §9-7).
 * Real python3 and libclang 18 at their default locations
 * (`src/core/workspace/native-single-file.ts:42–43`; the world passes no
 * `sourceAnalyzers`), WSL only, no skip but E2-29d's skip condition (:860).
 * One world per row (8E-2 :281, :372); only memory (S3).
 */
import { spawnSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NoteAnchorV1 } from '../../src/contracts/note.js';
import type { NoteItemV1 } from '../../src/core/work-graph/model/note-contracts.js';
import { openS8ESemanticWorld, type S8ESemanticWorld } from '../helpers/S8E-semantic-world.js';

/** sha256 of drive.py's 78 bytes (`S8E-semantic-world.ts:187–190`), by hand with node:crypto in ./.dsh-scratch/digests.mjs. */
const DRIVE_DIGEST = 'd7f169f02e14d8c586db6ff3b3d1b64a42a13f8a2168e826a208efb210f05abf';
/** sha256('main'): the name span, whitespace folded (8E-2 :434, :296), as `S4A-note-symbol.test.ts:41–43`. */
const MAIN_SIG = '0d6e4079e36703ebd37c00722f5891d28b0e2811dc114b129215123adcce3605';

/**
 * E2-29d's skip condition (8E-2 :860, W11 rule 4 :288): libclang 18 parses an in-memory
 * `#include <cstddef>` (`-x c++`) with no error or fatal diagnostic. Tried once here, as
 * the default parse of `scripts/cpp-source-query.py`'s `probe()`; production is not called.
 */
const PROBE = [
  'import ctypes as C',
  "lib = C.CDLL('/usr/lib/llvm-18/lib/libclang.so.1')",
  'class U(C.Structure):',
  "    _fields_ = [('Filename', C.c_char_p), ('Contents', C.c_char_p), ('Length', C.c_ulong)]",
  'def bind(name, result, *args):',
  '    function = getattr(lib, name)',
  '    function.restype, function.argtypes = result, list(args)',
  '    return function',
  'P = C.c_void_p',
  "index = bind('clang_createIndex', P, C.c_int, C.c_int)(0, 0)",
  "parse = bind('clang_parseTranslationUnit', P, P, C.c_char_p, C.POINTER(C.c_char_p), C.c_int, C.POINTER(U), C.c_uint, C.c_uint)",
  "count = bind('clang_getNumDiagnostics', C.c_uint, P)",
  "get = bind('clang_getDiagnostic', P, P, C.c_uint)",
  "severity = bind('clang_getDiagnosticSeverity', C.c_uint, P)",
  "source = b'#include <cstddef>\\n'",
  "tu = parse(index, b'probe.cpp', (C.c_char_p * 2)(b'-x', b'c++'), 2, (U * 1)(U(b'probe.cpp', source, len(source))), 1, 0)",
  'print(sum(severity(get(tu, n)) >= 3 for n in range(count(tu))) if tu else -1)',
].join('\n');
const probe = spawnSync('python3', ['-I', '-S', '-c', PROBE], { env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, encoding: 'utf8' });
const PRECISE = probe.status === 0 && probe.stdout.trim() === '0';

/** A file under the world root, written in the row before the note (as `S8E-semantic-world.ts:686–688`). */
async function putFile(world: S8ESemanticWorld, path: string, text: string): Promise<void> {
  const target = join(world.root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, 'utf8');
}

/** "第 n 行改成 X" (1-based), the file read back and written whole. */
async function setLine(world: S8ESemanticWorld, path: string, n: number, text: string): Promise<void> {
  const lines = (await readFile(join(world.root, path), 'utf8')).split('\n');
  lines[n - 1] = text;
  await writeFile(join(world.root, path), lines.join('\n'), 'utf8');
}

/**
 * E1: a general note on `path`'s `name` through the real Run's `record_note`; the receipt is
 * asserted accepted with no warning, and E5 `readNote` returns the stored item.
 */
async function writeSymbolNote(world: S8ESemanticWorld, row: string, path: string,
  symbolRequest: { language: 'python' | 'cpp'; name: string }): Promise<NoteItemV1> {
  const written = await world.writeAgent({
    kind: 'convention', topic: row, conclusion: `${row}: ${symbolRequest.name} is the entry`,
    anchor: { kind: 'file', path, symbolRequest }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], body: `${row} body`,
  }, { label: row });
  const write = written.envelope?.write;
  expect(write, JSON.stringify(write)).toMatchObject({ status: 'accepted', warnings: [] });
  if (write?.status !== 'accepted') throw new Error(`${row}: ${JSON.stringify(write)}`);
  const read = await world.platform.notes.readNote(world.humanContext(), { noteId: write.noteId });
  if (read.status !== 'ready') throw new Error(`${row}: readNote is ${read.status}`);
  return read.value;
}

/** E5: the owner lookup on the anchor `readNote` read back (as `S8E-F-read.test.ts:65–74`); the note's item. */
async function lookupItem(world: S8ESemanticWorld, noteId: string, anchor: NoteAnchorV1): Promise<NoteItemV1> {
  const lookup = await world.platform.notes.memoryLookup(world.humanContext(),
    { v: 1, op: 'lookup', anchor, limit: 100, cursor: null });
  if (lookup.status !== 'ready') throw new Error(`the lookup was not ready: ${JSON.stringify(lookup)}`);
  const item = lookup.value.items.find(candidate => candidate.noteId === noteId);
  if (item === undefined) throw new Error(`${noteId} is not in the lookup`);
  return item;
}

const MATH_CPP = 'cpp/src/math.cpp';

/** One C++ row (8E-2 :857–860): what goes before math.cpp's line 1, whether compile_commands.json is there, and the pick line. */
type CppRow = { id: string; first: string | null; commands: boolean; line: number; touch: boolean;
  renamed: 'retired' | 'doubtful' };

const CPP_ROWS: Readonly<Record<'a' | 'b' | 'c' | 'd', CppRow>> = {
  a: { id: 'E2-29a', first: null, commands: true, line: 2, touch: true, renamed: 'retired' },
  b: { id: 'E2-29b', first: null, commands: false, line: 2, touch: false, renamed: 'doubtful' },
  c: { id: 'E2-29c', first: '#include "/opt/e2-29c/extra.h"', commands: true, line: 3, touch: false, renamed: 'doubtful' },
  d: { id: 'E2-29d', first: '#include <cstddef>', commands: true, line: 3, touch: false, renamed: 'retired' },
};

/** The §4.2 files (:774–782), a general note on math.cpp's `pick`, then the row's reads. */
async function cppRow(row: CppRow): Promise<void> {
  const world = await openS8ESemanticWorld({ scribeTasks: 1 });
  try {
    await putFile(world, 'cpp/include/math.hpp', '#pragma once\n#ifdef API_ENABLED\nint pick(int value);\n#endif\n');
    await putFile(world, MATH_CPP, [...(row.first === null ? [] : [row.first]),
      '#include "math.hpp"', 'int pick(int value) { return value + 1; }'].join('\n') + '\n');
    if (row.commands) {
      await putFile(world, 'compile_commands.json', JSON.stringify([{
        directory: world.root, file: join(world.root, MATH_CPP),
        arguments: ['clang++', '-std=c++20', '-DAPI_ENABLED=1', '-I', join(world.root, 'cpp/include'), '-c', MATH_CPP],
      }]));
    }
    const item = await writeSymbolNote(world, row.id, MATH_CPP, { language: 'cpp', name: 'pick' });
    expect(item.anchor).toMatchObject({ kind: 'file', path: MATH_CPP,
      symbol: { language: 'cpp', qualifiedName: 'pick', range: { startLine: row.line, endLine: row.line } } });
    if (row.touch) {
      await appendFile(join(world.root, MATH_CPP), '// touched\n', 'utf8');
      expect(await lookupItem(world, item.noteId, item.anchor)).toMatchObject({ anchorStatus: 'live', freshness: 'fresh' });
    }
    await setLine(world, MATH_CPP, row.line, 'int take(int value) { return value + 1; }');
    const renamed = await lookupItem(world, item.noteId, item.anchor);
    if (row.renamed === 'retired') {
      // Mutations (8E-2 :857, :860): no exact parse (a, the fallback with compile_commands.json; d, the
      // compiler's headers not mapped) → freshness unchecked, not retired; this is red.
      expect(renamed).toMatchObject({ anchorStatus: 'retired', anchorRetiredReasons: ['symbol_missing'] });
    } else {
      // Mutations (8E-2 :858, :859): a miss read as symbol_missing (b) / an exact parse despite the
      // fatal diagnostic (c) → retired; this is red.
      expect(renamed.freshness).toBe('unchecked');
      expect(renamed.anchorStatus).not.toBe('retired');
      expect(renamed.anchorRetiredReasons).not.toContain('symbol_missing');
    }
  } finally {
    await world.close();
  }
}

describe('8E-2 G8/R3: a Python or C++ general note stores its locator at write and is read by the single-file lookup', () => {
  it('E2-24 drive.py main: the exact locator; touched live and fresh; renamed retired, symbol_missing', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1 });
    try {
      const item = await writeSymbolNote(world, 'E2-24', 'src/robot/drive.py', { language: 'python', name: 'main' });
      expect(item.anchor).toEqual({ kind: 'file', path: 'src/robot/drive.py', symbol: { language: 'python',
        qualifiedName: 'main', range: { startLine: 1, endLine: 1 }, fileDigest: DRIVE_DIGEST, signatureDigest: MAIN_SIG } });
      await appendFile(join(world.root, 'src/robot/drive.py'), '# touched\n', 'utf8');
      // Mutation (8E-2 :852): R3 reads every python locator unchecked → freshness 'unchecked' here; this is red.
      expect(await lookupItem(world, item.noteId, item.anchor)).toMatchObject({ anchorStatus: 'live', freshness: 'fresh' });
      await setLine(world, 'src/robot/drive.py', 1, 'def run(node):');
      expect(await lookupItem(world, item.noteId, item.anchor))
        .toMatchObject({ anchorStatus: 'retired', anchorRetiredReasons: ['symbol_missing'] });
    } finally {
      await world.close();
    }
  }, 180_000);

  it.each([CPP_ROWS.a, CPP_ROWS.b, CPP_ROWS.c].map(row => [row.id, row.line, row.renamed, row] as const))(
    '%s math.cpp pick: the locator at line %i; renamed reads %s', async (_id, _line, _renamed, row) => {
      await cppRow(row);
    }, 180_000);

  // 8E-2 :860: skipped only where the precise mode does not work (PROBE prints the error count).
  it.skipIf(!PRECISE)('E2-29d math.cpp pick after <cstddef>: the locator at line 3; renamed reads retired',
    async () => { await cppRow(CPP_ROWS.d); }, 180_000);
});
