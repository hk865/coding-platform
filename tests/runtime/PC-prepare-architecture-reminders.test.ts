/**
 * PC-1b P (ruling 14): the architecture reminder rows preparation appends are
 * rendered from the RESOLVED pack. The world is the frozen PC fixture's real
 * Work preparation; the pack source is the fixture's public, replaceable one.
 *
 * The injected string is a literal; no expected value comes from the generated
 * pack or from a production read.
 */
import { describe, expect, it } from 'vitest';
import { openPCWorkFixture } from '../helpers/PC-platform-fixture.js';

describe('ruling 14: architecture reminder rows take the resolved pack', () => {
  it('keeps the injected no-observation text in the prepared input', async () => {
    const fixture = await openPCWorkFixture();
    try {
      fixture.packs.change({ strings: { 'architecture.noObservation': 'CUSTOM' } });
      await fixture.work.prepare();
      const prepared = await fixture.work.preparedTexts();
      expect(prepared.texts.strings['architecture.noObservation']).toBe('CUSTOM');
      expect(prepared.input).toContain('CUSTOM');
    } finally {
      await fixture.close();
    }
  }, 60_000);
});
