/**
 * §11.6 A-11(1)〔§10 段〕: the one observation light scan is the only TS analysis.
 * A fault at `{phase:'language'}` fails the TS language (never the capture), the
 * module layer is empty and the file layer still carries every file and line
 * count. A normal observation calls the language hook exactly once.
 */
import { afterEach, expect, it } from 'vitest';
import { BACKENDS, fixture, type Backend, type PlatformFixture } from '../helpers/S8D-platform-fixture.js';

const fixtures: PlatformFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});

const entries: [string, string][] = [
  ['src/a.ts', 'export const a = 1;\n'],
  ['src/b.ts', 'export const b = 1;\n\n'],
];
const mapping = [{ id: 'M', kind: 'module' as const, paths: ['src'] }];

async function queryModuleNodes(f: PlatformFixture, capture: { persisted: unknown }) {
  const result = await f.platform.architecture.queryArchitecture(f.ctx, {
    selection: { kind: 'observed', capture: capture.persisted as never },
    depth: 1, relations: ['dependency'], page: { limit: 20 },
  });
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw Error('queryArchitecture failed');
  return result.value.nodes;
}

for (const backend of BACKENDS) {
  it(`A-11(1) language fault fails TS coverage and keeps the file layer [${backend}]`, async () => {
    const f = await fixture(backend, `s8e-a11-${backend}`, entries, {
      lightScan: { fault: event => { if (event.phase === 'language') throw new TypeError('injected'); } },
    });
    fixtures.push(f);
    const captured = await f.capture(mapping);
    const page = await f.listFiles(captured);

    expect(page.languages).toEqual([{
      language: 'typescript', files: 2, parsed: 0, edges: 'failed', reason: 'TypeError: injected',
      notes: [], issues: [], issueCount: 0, complete: false,
    }]);
    expect(page.nodes).toEqual([
      { path: 'src/a.ts', nonBlankLines: 1, language: 'typescript' },
      { path: 'src/b.ts', nonBlankLines: 1, language: 'typescript' },
    ]);
    expect(await queryModuleNodes(f, captured)).toEqual([]);
    // §11.1: an observation capture has no semantic analyzer; `imports` included.
    const live = await f.platform.workspace.captureObservation(f.ctx, {
      workspace: { aggregateType: 'Workspace', ...f.scope }, workspaceRevision: 1, provider: 'typescript',
    });
    expect(live.status).toBe('ready');
    if (live.status !== 'ready') throw Error('captureObservation failed');
    for (const query of [{ kind: 'imports' as const }, { kind: 'symbols' as const }]) {
      const semantic = await f.platform.workspace.querySource(f.ctx, { capture: live.value.ref, query, limit: 10, cursor: null });
      expect(semantic.status).toBe('rejected');
      if (semantic.status === 'rejected') expect(semantic.code).toBe('unsupported');
    }
  });

  it(`A-11(1) calls the language fault exactly once per observation [${backend}]`, async () => {
    const calls: { phase: string; path?: string }[] = [];
    const f = await fixture(backend, `s8e-a11-once-${backend}`, entries, {
      lightScan: { fault: event => { calls.push(event); } },
    });
    fixtures.push(f);
    const captured = await f.capture(mapping);
    await f.listFiles(captured);
    // The file layer must reuse the stored scan; no second scan, no second call.
    expect(calls).toEqual([{ phase: 'language' }, { phase: 'file', path: 'src/a.ts' }, { phase: 'file', path: 'src/b.ts' }]);
  });
}
