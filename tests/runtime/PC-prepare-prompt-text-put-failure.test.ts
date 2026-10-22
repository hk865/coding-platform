/**
 * PC-1b P — ruling 14 item 6: a failed prompt-text body put is the
 * preparation's `unavailable`, for Work and Query alike. Nothing becomes
 * startable and no model is called.
 *
 * The failure is the frozen fixture's own content-type fault seam; the worlds
 * and the prepare/start calls are its public steps.
 */
import { describe, expect, it } from 'vitest';
import { PROMPT_TEXT_CONTENT_TYPE } from '../../src/contracts/prompts/prompt-set.js';
import {
  openPCQueryFixture, openPCWorkFixture, scriptedModel,
} from '../helpers/PC-platform-fixture.js';

describe('PC-11: a failed prompt-text put makes preparation unavailable', () => {
  it('fails Work preparation as unavailable, startable nothing, zero model calls', async () => {
    const fixture = await openPCWorkFixture({
      model: scriptedModel([{ text: 'PC must not answer' }]),
      failPutContentType: PROMPT_TEXT_CONTENT_TYPE,
    });
    try {
      await expect(fixture.work.prepare()).rejects.toThrow(/unavailable/);
      expect(fixture.model.calls()).toBe(0);
      expect(() => fixture.work.start()).toThrow(/prepare this Work first/);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it('fails Query preparation as unavailable, startable nothing, zero model calls', async () => {
    const fixture = await openPCQueryFixture({
      model: scriptedModel([{ text: 'PC must not answer' }]),
      failPutContentType: PROMPT_TEXT_CONTENT_TYPE,
    });
    try {
      await expect(fixture.prepare()).rejects.toThrow(/unavailable/);
      expect(fixture.model.calls()).toBe(0);
      expect(() => fixture.start()).toThrow(/prepare this Query first/);
    } finally {
      await fixture.close();
    }
  }, 60_000);
});
