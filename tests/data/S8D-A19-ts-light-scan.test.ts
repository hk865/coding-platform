/**
 * A-19 (slice 8 §11.6): configuration selection, `references`, failing/
 * unsupported configs, `paths`/`baseUrl` resolution, out-of-scope files and the
 * default `resolveJsonModule` value. Every case runs through the shared
 * platform fixture's public capture and pages on both backends; the literals are
 * the spec's and do not change.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BACKENDS, fixture, type Entry, type GraphShape, type PlatformFixture } from '../helpers/S8D-platform-fixture.js';

const fixtures: PlatformFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});

const SELF = 'export {};\n';
const REFERENCES_REASON = '根配置带 references，观测还不跟进';
const typescript = (graph: GraphShape) => graph.languages.find(entry => entry.language === 'typescript');

describe.each(BACKENDS)('A-19 TS configuration [%s]', backend => {
  it('A-19 a root config with references is unsupported and carries no edges or module layer', async () => {
    const f = await fixture(backend, `s8d-a19-references-${backend}`, [
      ['tsconfig.json', '{"files":["a.ts"],"references":[{"path":"./b"}]}\n'],
      ['a.ts', SELF],
    ]);
    fixtures.push(f);
    const graph = await f.graph();

    expect(typescript(graph)).toEqual({
      language: 'typescript', files: 1, parsed: 0, edges: 'unsupported', reason: REFERENCES_REASON,
      notes: [], issues: [], issueCount: 0, complete: false,
    });
    expect(graph.edges).toEqual([]);
    expect(graph.unresolved).toEqual([]);
  });

  it('A-19 references are unsupported even when the root config has no files of its own', async () => {
    const f = await fixture(backend, `s8d-a19-references-empty-${backend}`, [
      ['tsconfig.json', '{"references":[{"path":"./b"}]}\n'],
      ['a.ts', SELF],
    ]);
    fixtures.push(f);
    const graph = await f.graph();

    expect(typescript(graph)).toEqual({
      language: 'typescript', files: 1, parsed: 0, edges: 'unsupported', reason: REFERENCES_REASON,
      notes: [], issues: [], issueCount: 0, complete: false,
    });
    expect(graph.edges).toEqual([]);
  });

  it('A-19 a config extending a missing package fails with a file-name-only reason and no fallback', async () => {
    const f = await fixture(backend, `s8d-a19-extends-${backend}`, [
      ['tsconfig.json', '{"extends":"missing-pkg"}\n'],
      ['jsconfig.json', '{"compilerOptions":{}}\n'],
      ['a.ts', SELF],
    ]);
    fixtures.push(f);
    const graph = await f.graph();

    const coverage = typescript(graph);
    expect(coverage?.edges).toBe('failed');
    expect(coverage?.reason).toMatch(/^配置错误：/);
    expect(coverage?.reason).not.toContain('/workspace/');
    expect(coverage?.parsed).toBe(0);
    expect(coverage?.notes).toEqual([]);
    expect(coverage?.issues).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it('A-19 a root tsconfig.json with NUL fails as binary source even when a readable jsconfig.json exists', async () => {
    const f = await fixture(backend, `s8d-a19-binary-${backend}`, [
      ['tsconfig.json', new Uint8Array([0x7b, 0x00, 0x7d])],
      ['jsconfig.json', '{"compilerOptions":{}}\n'],
      ['a.ts', SELF],
    ]);
    fixtures.push(f);
    const graph = await f.graph();

    expect(typescript(graph)).toEqual({
      language: 'typescript', files: 1, parsed: 0, edges: 'failed', reason: 'tsconfig.json 读不了：binary source',
      notes: [], issues: [], issueCount: 0, complete: false,
    });
    expect(graph.edges).toEqual([]);
    expect(graph.unresolved).toEqual([]);
  });

  it('A-19 paths aliases resolve from the config', async () => {
    const f = await fixture(backend, `s8d-a19-paths-${backend}`, [
      ['tsconfig.json', '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}\n'],
      ['a.ts', 'import { x } from "@/x";\n'],
      ['src/x.ts', 'export const x = 1;\n'],
    ]);
    fixtures.push(f);
    const graph = await f.graph();

    expect(graph.edges).toEqual([{ from: 'a.ts', to: 'src/x.ts' }]);
    expect(typescript(graph)).toEqual({
      language: 'typescript', files: 2, parsed: 2, edges: 'supported', reason: null,
      notes: [], issues: [], issueCount: 0, complete: true,
    });
  });

  it('A-19 baseUrl resolves non-relative names', async () => {
    const f = await fixture(backend, `s8d-a19-baseurl-${backend}`, [
      ['tsconfig.json', '{"compilerOptions":{"baseUrl":"src"}}\n'],
      ['a.ts', 'import { x } from "x";\n'],
      ['src/x.ts', 'export const x = 1;\n'],
    ]);
    fixtures.push(f);
    const graph = await f.graph();

    expect(graph.edges).toEqual([{ from: 'a.ts', to: 'src/x.ts' }]);
    expect(graph.unresolved).toEqual([]);
  });

  it('A-19 a TS file outside the configured project is skipped with the literal reason', async () => {
    const f = await fixture(backend, `s8d-a19-outside-${backend}`, [
      ['tsconfig.json', '{"files":["a.ts"]}\n'],
      ['a.ts', SELF],
      ['other.ts', SELF],
    ]);
    fixtures.push(f);
    const graph = await f.graph();

    expect(typescript(graph)).toEqual({
      language: 'typescript', files: 2, parsed: 1, edges: 'supported', reason: null,
      notes: [], issues: [{ path: 'other.ts', kind: 'skipped', reason: '不在 TS 分析的范围里' }],
      issueCount: 1, complete: false,
    });
    expect(graph.nodes.filter(node => node.language === 'typescript')).toEqual([
      { path: 'a.ts', nonBlankLines: 1, language: 'typescript' },
      { path: 'other.ts', nonBlankLines: 1, language: 'typescript' },
    ]);
    expect(graph.edges).toEqual([]);
  });

  it('A-19 default options resolve a .json module and walk it without counting it as parsed', async () => {
    const entries: Entry[] = [
      ['a.ts', 'import c = require("./c.json");\n'],
      ['c.json', '{}\n'],
    ];
    const f = await fixture(backend, `s8d-a19-json-${backend}`, entries);
    fixtures.push(f);
    const graph = await f.graph();

    expect(graph.edges).toEqual([{ from: 'a.ts', to: 'c.json' }]);
    expect(graph.unresolved).toEqual([]);
    expect(typescript(graph)).toEqual({
      language: 'typescript', files: 1, parsed: 1, edges: 'supported', reason: null,
      notes: [], issues: [], issueCount: 0, complete: true,
    });
    expect(graph.nodes.map(node => node.path)).toEqual(['a.ts', 'c.json']);
  });
});
