/**
 * §10 items 4/7 / §11.6 A-09: the old body-size and 10,000-reference limits are
 * gone. 1,500 long-path files capture and page completely; a project with more
 * than 10,000 TS references keeps a non-empty module layer.
 */
import { afterEach, expect, it } from 'vitest';
import { BACKENDS, fixture, type Entry, type PlatformFixture } from '../helpers/S8D-platform-fixture.js';

const fixtures: PlatformFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});

const longPaths = Array.from({ length: 1500 }, (_value, index) => {
  const id = String(index).padStart(4, '0');
  return `src/very-long-feature-directory-${id}/subsystem/module_with_a_very_long_name_${id}.ts`;
});
const longEntries: Entry[] = longPaths.map(path => [path, 'export const value = 1;\n']);

async function allFiles(f: PlatformFixture, captureRef: Parameters<PlatformFixture['listFiles']>[0]) {
  const paths: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await f.platform.architecture.listFiles(f.ctx, { captureRef, cursor });
    expect(page.status).toBe('ready');
    if (page.status !== 'ready') throw Error('listFiles failed');
    paths.push(...page.value.nodes.map(node => node.path));
    cursor = page.value.nextCursor;
  } while (cursor !== null);
  return paths;
}

for (const backend of BACKENDS) {
  it(`A-09 captures and pages 1,500 files whose average path exceeds 60 bytes [${backend}]`, async () => {
    const f = await fixture(backend, `s8e-a09-scale-${backend}`, longEntries);
    fixtures.push(f);
    const captured = await f.capture();
    const paths = await allFiles(f, captured);
    expect(paths).toEqual([...longPaths].sort());
    expect(longPaths.reduce((sum, path) => sum + path.length, 0) / longPaths.length).toBeGreaterThan(60);
  }, 180_000);

  it(`A-09 keeps a non-empty module layer with more than 10,000 TS references [${backend}]`, async () => {
    const count = 1001;
    const name = (index: number) => `src/m${String(index).padStart(4, '0')}.ts`;
    const entries: Entry[] = Array.from({ length: count }, (_value, index) => [
      name(index),
      Array.from({ length: 10 }, (_unused, offset) => `import "./m${String((index + offset + 1) % count).padStart(4, '0')}";\n`).join(''),
    ]);
    const f = await fixture(backend, `s8e-a09-references-${backend}`, entries);
    fixtures.push(f);
    const captured = await f.capture([{ id: 'M', kind: 'module', paths: ['src'] }]);
    const query = await f.platform.architecture.queryArchitecture(f.ctx, {
      selection: { kind: 'observed', capture: captured.persisted },
      depth: 1, relations: ['dependency'], page: { limit: 20 },
    });
    expect(query.status).toBe('ready');
    if (query.status !== 'ready') throw Error('queryArchitecture failed');
    expect(query.value.nodes.length).toBeGreaterThan(0);
  }, 180_000);
}
