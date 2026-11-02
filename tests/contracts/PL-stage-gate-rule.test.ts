/**
 * G-01, G-02, G-12 (spec :116, :186, N13): every stage has a stage gate, the
 * model writes it and the reviewer checks it, and the platform adds no check.
 * So the rule only exists if it reaches the model through these four prompts.
 */
import { describe, expect, it } from 'vitest';
import type { ResolvedPromptPackV1 } from '../../src/contracts/prompts/prompt-pack.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';

const PACK: ResolvedPromptPackV1 = PLATFORM_PROMPT_PACK_V1;

const PER_STAGE_GATE = /(stage[- ]gate|阶段 ?gate|(each|every|per)[- ]stage[^.\n]{0,40}gate|每(个|一)?(阶段|段)[^。\n]{0,30}gate)/i;

describe('G-01/G-02/G-12: the per-stage gate rule reaches the model', () => {
  it.each(['initial-planning-answer', 'skill-platform-adviser', 'plan-review-input', 'skill-platform-reviewer'])(
    '%s names the rule', (id) => {
      expect(PACK.templates[id] ?? '').toMatch(PER_STAGE_GATE);
    });
});
