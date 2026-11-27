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
import { renderTemplate } from '../../src/contracts/prompts/render-template.js';
import { TEMPLATE_SLOTS } from '../../src/contracts/prompts/slot-tables.js';

const PACK: ResolvedPromptPackV1 = PLATFORM_PROMPT_PACK_V1;

describe('A-05: the initial planning guide', () => {
  it('carries both answer forms and the two planning rules', () => {
    const text = PACK.templates['initial-planning-answer'] ?? '';
    expect(text).toContain('submit_plan_round');
    expect(text).toContain('answerKind');
    expect(text).toContain('estimatedLines');
    expect(text).toContain('sizeClass');
    expect(text).toContain('only this segment');
    expect(TEMPLATE_SLOTS['initial-planning-answer']).toEqual({});
    // The JSON text shape moved to its own template, rendered only on the path
    // with no submission tool.
    const textOnly = PACK.templates['planning-answer-text'] ?? '';
    expect(textOnly).toContain('exactly one JSON object as your entire final answer');
    expect(TEMPLATE_SLOTS['planning-answer-text']).toEqual({});
  });

  /*
   * RSR R4 (RSR-3; `rsr-draft.md` 测试行 R4; MVP-BEHAVIOR.md:98 "每轮说明改了什么"; the ruling's literal sentence): a
   * revising round that provides submit_plan_round is told to put what changed into the summary, right after
   * "only for a change" inside that tool block; a round without the tool never reads it. Red today: the template
   * has no such sentence. Mutation guarded: delete the sentence, or move it out of the tool block.
   */
  it('RSR R4: only a round with submit_plan_round is told to say in the summary what changed from the last candidate', () => {
    const sentence = 'When revising an existing candidate, use the summary to tell the person what changed from the '
      + 'previous candidate in this round.';
    const withTool = renderTemplate(PACK, 'initial-planning-answer', {}, ['submit_plan_round']).text;
    expect(withTool.split(sentence), 'exactly once').toHaveLength(2);
    expect(withTool).toContain(`Call submit_plan_round only for a change. ${sentence} If it returns problems`);
    expect(renderTemplate(PACK, 'initial-planning-answer', {}, []).text).not.toContain(sentence);
  });
});
