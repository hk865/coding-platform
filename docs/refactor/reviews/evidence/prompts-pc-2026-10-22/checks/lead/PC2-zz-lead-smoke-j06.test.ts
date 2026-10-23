import { describe, expect, it, vi } from 'vitest';
import type { ModelRequest, ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { openPCK3ReviewFixture } from '../helpers/PC-platform-fixture.js';
// The frozen PC2 review fixture starts a real blocked Run: §5.1's stand-in
// `shell` must be armed so the Run is held at its call.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

// Lead smoke check of the J-06 fixture branch (not committed): it opens and prepares.
describe('lead smoke: openPCK3ReviewFixture completed_turn', () => {
  it('opens with a completed source turn and prepares the review round', async () => {
    const fixture = await openPCK3ReviewFixture({ sourceHistory: 'completed_turn' });
    try {
      const prepared = await fixture.work.prepare();
      expect(prepared).toBeDefined();
      console.log('SMOKE review status', fixture.review.status, 'items', fixture.review.items.length);
    } finally {
      await fixture.close();
    }
  }, 60_000);
});
