import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { scanTypeScript, type LightScanInput } from '../../src/core/workspace/typescript-light-scan.js';
import { BACKENDS, fixture, type PlatformFixture } from '../helpers/S8D-platform-fixture.js';

/**
 * A-27 (slice 8 §11.6): the light scan's `noResolve`, triple-slash/type-reference
 * and cancellation configurations through the shared platform fixture's public
 * capture and pages, on both backends. Only the line of a type import reference
 * stays at the scan level: the public page/comparison exposes `from`,
 * `specifier` and `reason`, but no unresolved line, so that one literal has no
 * public path.
 */

const SELF = 'export {};\n';

function material(entries: readonly (readonly [string, string])[]) {
  return new Map(entries.map(([path, content]) => [path, {
    path,
    content,
    digest: createHash('sha256').update(content).digest('hex'),
  }]));
}

function input(entries: readonly (readonly [string, string])[], extra: Partial<LightScanInput> = {}): LightScanInput {
  return { files: material(entries), signal: new AbortController().signal, ...extra };
}

const fixtures: PlatformFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});

describe.each(BACKENDS)('A-27 TS light scan through the public capture [%s]', backend => {
  it('noResolve still resolves references to the initial root files and never loads a target outside it', async () => {
    const f = await fixture(backend, `s8e-a27-noresolve-${backend}`, [
      ['tsconfig.json', '{"compilerOptions":{"noResolve":true},"files":["a.ts","b.ts"]}'],
      ['a.ts', 'import "./b";\nimport "./c";\n'],
      ['b.ts', SELF],
      ['c.ts', SELF],
    ]);
    fixtures.push(f);
    const graph = await f.graph();

    // a.ts -> b.ts is inside the initial root set; ./c resolves to c.ts in the
    // material but c.ts is not a root, so it is unknown and never enqueued.
    expect(graph.edges).toEqual([{ from: 'a.ts', to: 'b.ts' }]);
    expect(graph.unresolved).toEqual([{ from: 'a.ts', specifier: './c', reason: null }]);
    expect(graph.languages.find(entry => entry.language === 'typescript')).toEqual({
      language: 'typescript', files: 3, parsed: 2, edges: 'supported', reason: null,
      notes: [], issues: [{ path: 'c.ts', kind: 'skipped', reason: '不在 TS 分析的范围里' }],
      issueCount: 1, complete: false,
    });
    expect([...graph.nodes.map(node => node.path)]).toEqual(expect.arrayContaining(['a.ts', 'b.ts', 'c.ts']));
  });

  it('noResolve still resolves a triple-slash path and a type reference to initial root files', async () => {
    const f = await fixture(backend, `s8e-a27-roots-${backend}`, [
      ['tsconfig.json', '{"compilerOptions":{"noResolve":true,"typeRoots":["./types"]},"files":["a.ts","ref.ts","types/t/index.d.ts"]}'],
      ['a.ts', '/// <reference path="./ref.ts" />\n/// <reference types="t" />\n'],
      ['ref.ts', SELF],
      ['types/t/index.d.ts', 'declare const t: number;\n'],
    ]);
    fixtures.push(f);
    const graph = await f.graph();

    expect(graph.edges).toEqual([
      { from: 'a.ts', to: 'ref.ts' },
      { from: 'a.ts', to: 'types/t/index.d.ts' },
    ]);
    expect(graph.unresolved).toEqual([]);
    expect(graph.languages.find(entry => entry.language === 'typescript')?.parsed).toBe(3);
  });

  it('cancellation is observed at the yield after the file that aborted, before the next file hook', async () => {
    // The chain the scanner's `finally` makes: the first failing file busy-waits
    // on the real clock past YIELD_INTERVAL_MS (50 ms), queues the abort in the
    // same check phase as the scanner's yield (with `setImmediate`, which runs
    // FIFO before the scanner's own `setImmediate`), then throws RangeError. The
    // per-file catch records the failure (the signal is not aborted yet), the
    // loop's `finally` calls `maybeYield`: >50 ms have elapsed, so it yields;
    // the abort callback runs at that yield, the post-yield
    // `signal.throwIfAborted()` throws AbortError, the outer catch rethrows it,
    // and the loop stops before x2's hook.
    const controller = new AbortController();
    const calls: string[] = [];
    const f = await fixture(backend, `s8e-a27-cancel-${backend}`, [
      ['a.ts', 'import "./x1";\nimport "./x2";\nimport "./x3";\nimport "./x4";\n'],
      ['x1.ts', SELF],
      ['x2.ts', SELF],
      ['x3.ts', SELF],
      ['x4.ts', SELF],
    ], {
      signal: controller.signal,
      lightScan: { fault: event => {
        if (event.phase !== 'file') return;
        calls.push(event.path);
        if (event.path === 'a.ts') return;
        if (event.path === 'x1.ts') {
          const until = Date.now() + 150;
          while (Date.now() < until) { /* real clock: pass the 50 ms yield interval */ }
          setImmediate(() => controller.abort());
        }
        throw new RangeError('injected');
      } },
    });
    fixtures.push(f);
    const result = await f.graphResult();

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.code).toBe('cancelled');
    expect(calls).toEqual(['a.ts', 'x1.ts']);
  });
});

// This one stays at the scan level because the public page/comparison exposes
// `from`/`specifier`/`reason` but no unresolved line, and the point of the case
// is that a type import reports the type node's line, not the specifier's line.
it('a type import reference reports the type node line, not the specifier line', async () => {
  const result = await scanTypeScript(input([
    ['a.ts', 'type T = import(\n"./missing"\n).T\n'],
  ]));

  expect(result.unresolved).toEqual([{ from: 'a.ts', specifier: './missing', reason: null, line: 1 }]);
  expect(result.references).toEqual([expect.objectContaining({
    path: 'a.ts', line: 1, specifier: './missing', resolution: 'unknown', targets: [],
  })]);
});
