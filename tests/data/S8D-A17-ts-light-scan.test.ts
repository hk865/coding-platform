/**
 * A-17 (slice 8 §11.6): every TS/JS reference form is read from the frozen
 * material and resolved against one shared module-resolution cache. The row runs
 * through the shared platform fixture's public capture and pages (memory and
 * SQLite); the literal 10 edges and the one unresolved import are hand-computed
 * from TS 6.0.3's `nodenext` resolution.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BACKENDS, fixture, type Entry, type GraphShape, type PlatformFixture } from '../helpers/S8D-platform-fixture.js';

const fixtures: PlatformFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});

const SELF = 'export {};\n';

const ENTRIES: Entry[] = [
  ['tsconfig.json', '{"compilerOptions":{"module":"nodenext","allowJs":true,"typeRoots":["./types"]}}\n'],
  ['package.json', '{"name":"p","exports":{".":{"import":"./lib/p.d.mts","require":"./lib/p.d.cts"}}}\n'],
  ['src/main.ts', [
    '/// <reference path="./ref.ts" />',
    '/// <reference path="./ref2" />',
    '/// <reference types="t" />',
    'import type { T } from "./t";',
    'import r = require("./r");',
    'import type { P } from "p" with { "resolution-mode": "import" };',
    'export const d = import("./d.js");',
    'export type Q = import("./q").Q;',
    '',
  ].join('\n')],
  ['src/t.ts', SELF],
  ['src/r.ts', SELF],
  ['src/d.ts', SELF],
  ['src/ref.ts', SELF],
  ['src/ref2.ts', SELF],
  ['src/z.ts', SELF],
  ['src/q.ts', 'export type Q = 1;\n'],
  ['types/t/index.d.ts', 'declare const t: number;\n'],
  ['lib/p.d.mts', 'export type P = 1;\n'],
  ['lib/p.d.cts', 'export type P = 1;\n'],
  ['src/c.js', 'const a = require("./a2");\n'],
  ['src/a2.js', 'module.exports = 1;\n'],
  ['src/req.ts', 'const z = require("./z");\n'],
  ['esm/package.json', '{"type":"module"}\n'],
  ['esm/a.ts', SELF],
  ['esm/m.ts', 'import "./a";\n'],
  ['esm/n.cts', 'import "./a";\n'],
];

const byKey = (values: string[]) => [...values].sort();
const edgePairs = (graph: GraphShape) => graph.edges.map(edge => `${edge.from} -> ${edge.to}`);

describe.each(BACKENDS)('A-17 TS reference forms [%s]', backend => {
  it('A-17 reads exactly the ten reference edges of all reference forms and the one ESM extension-less miss', async () => {
    const f = await fixture(backend, `s8d-a17-${backend}`, ENTRIES);
    fixtures.push(f);
    const graph = await f.graph();

    expect(graph.languages.find(entry => entry.language === 'typescript')).toEqual({
      language: 'typescript', files: 17, parsed: 17, edges: 'supported', reason: null,
      notes: [], issues: [], issueCount: 0, complete: true,
    });
    expect(byKey(edgePairs(graph))).toEqual(byKey([
      'src/main.ts -> src/ref.ts',
      'src/main.ts -> src/ref2.ts',
      'src/main.ts -> types/t/index.d.ts',
      'src/main.ts -> src/t.ts',
      'src/main.ts -> src/r.ts',
      'src/main.ts -> lib/p.d.mts',
      'src/main.ts -> src/d.ts',
      'src/main.ts -> src/q.ts',
      'src/c.js -> src/a2.js',
      'esm/n.cts -> esm/a.ts',
    ]));
    expect(graph.unresolved.map(entry => [entry.from, entry.specifier])).toEqual([['esm/m.ts', './a']]);
    expect(graph.edges.some(edge => edge.from === 'src/req.ts')).toBe(false);
    expect(graph.unresolved.some(entry => entry.from === 'src/req.ts')).toBe(false);
  });
});
