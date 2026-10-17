/**
 * §10 item 4 / §11.6 A-13: the 100,000-edge cap is one budget across all three
 * languages. Each language is under a tiny injected cap, together they are over.
 */
import { afterEach, expect, it } from 'vitest';
import { BACKENDS, fixture, type PlatformFixture } from '../helpers/S8D-platform-fixture.js';

const fixtures: PlatformFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});

const entries: [string, string][] = [
  ['a.ts', 'import "./b";\n'],
  ['b.ts', 'export {};\n'],
  ['a.py', 'import b\n'],
  ['b.py', 'b = 1\n'],
];

for (const backend of BACKENDS) {
  it(`A-13 TS and Python edges share one finite budget [${backend}]`, async () => {
    const f = await fixture(backend, `s8e-a13-${backend}`, entries, {
      fileGraph: { maxNodes: 20000, maxEdges: 1 },
    });
    fixtures.push(f);
    const result = await f.captureResult();
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw Error('expected a rejected capture');
    expect(result.code).toBe('capacity');
    expect(result.reason).toContain('(reached 1)');
  });
}
