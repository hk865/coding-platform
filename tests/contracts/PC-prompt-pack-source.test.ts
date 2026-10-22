/**
 * PC-1a — ruling 13: the default pack source is pure. It resolves `"platform"`
 * to the generated pack and rejects every other id as invalid, with the exact
 * reason PC-2's disk-backed source will replace.
 */
import { describe, expect, it } from 'vitest';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { createPlatformPromptPackSource } from '../../src/contracts/prompts/prompt-pack.js';

describe('createPlatformPromptPackSource (ruling 13)', () => {
    it('resolves the platform id to the generated pack', async () => {
        const source = createPlatformPromptPackSource();
        const result = await source.resolve('platform', new AbortController().signal);
        expect(result.status).toBe('ready');
        if (result.status !== 'ready') throw new Error(`platform pack was ${result.status}: ${result.reason}`);
        expect(result.value).toBe(PLATFORM_PROMPT_PACK_V1);
    });

    it('rejects any other id as invalid with the exact reason', async () => {
        const source = createPlatformPromptPackSource();
        const result = await source.resolve('mine', new AbortController().signal);
        expect(result).toEqual({ status: 'rejected', code: 'invalid', reason: 'prompt pack mine is not available' });
    });
});
