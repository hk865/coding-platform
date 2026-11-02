/**
 * A-05: the planning guide's two conditional answer forms. The guide names the
 * planning submit tool for a round that provides it, keeps the JSON text
 * protocol for a round that does not, and carries the estimated-lines and
 * only-this-segment rules. It has no slots.
 *
 * PL P3-11: the renderer tautology (read the pack text, then expect the same
 * value from the renderer) is removed; the renderer's canonical rows are in
 * tests/contracts/PC2-resolve-pack.test.ts. The frozen A-05 Host observations
 * are in A-05-plan-round.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { ResolvedPromptPackV1 } from '../../src/contracts/prompts/prompt-pack.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { TEMPLATE_SLOTS } from '../../src/contracts/prompts/slot-tables.js';

const PACK: ResolvedPromptPackV1 = PLATFORM_PROMPT_PACK_V1;

describe('A-05: the initial planning guide', () => {
  it('carries both answer forms and the two planning rules', () => {
    const text = PACK.templates['initial-planning-answer'] ?? '';
    expect(text).toContain('submit_plan_round');
    expect(text).toContain('answerKind');
    expect(text).toContain('exactly one JSON object as your entire final answer');
    expect(text).toContain('estimatedLines');
    expect(text).toContain('sizeClass');
    expect(text).toContain('only this segment');
    expect(TEMPLATE_SLOTS['initial-planning-answer']).toEqual({});
  });
});
