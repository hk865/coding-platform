/**
 * §10 item 8 A-14 / §9 item 5: after a capture, narrowing the Host grant so one
 * frozen node path is no longer readable makes all three file pages `forbidden`.
 * The rejection reason never echoes the unauthorized path.
 */
import { afterEach, expect, it } from 'vitest';
import { BACKENDS, fixture, type PlatformFixture } from '../helpers/S8D-platform-fixture.js';

const fixtures: PlatformFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});

const entries: [string, string][] = [
  ['private/x.ts', 'export const x = 1;\n'],
  ['src/y.ts', 'import "../private/x";\n'],
  ['src/z.ts', 'import "./y";\n'],
];

for (const backend of BACKENDS) {
  it(`A-14 a narrowed Host grant hides the whole capture from all three pages [${backend}]`, async () => {
    const f = await fixture(backend, `s8e-a14-${backend}`, entries);
    fixtures.push(f);
    const captured = await f.capture();
    // The capture itself is readable while the grant still covers the path.
    expect((await f.listFiles(captured)).nodes.map(node => node.path))
      .toEqual(['private/x.ts', 'src/y.ts', 'src/z.ts']);

    f.deny('private/x.ts');
    const reads = [
      f.platform.architecture.listFiles(f.ctx, { captureRef: captured, cursor: null }),
      f.platform.architecture.neighbors(f.ctx,
        { captureRef: captured, file: 'private/x.ts', direction: 'in', limit: 200, cursor: null }),
      f.platform.architecture.impact(f.ctx,
        { captureRef: captured, file: 'private/x.ts', depth: 2, limit: 200, cursor: null }),
    ];
    const results = await Promise.all(reads);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status !== 'rejected') continue;
      expect(result.code).toBe('forbidden');
      expect(result.reason).not.toContain('private/x.ts');
    }
  });
}
