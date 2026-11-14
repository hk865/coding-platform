/**
 * A-01: the review input template's declared slots and its render. The table
 * has exactly the five review slots (no `role`, no `diagnosis`); a missing
 * required slot is the renderer's `required_slot_empty` rejection; the
 * generated pack carries the new template and both planning tools.
 */
import { describe, expect, it } from 'vitest';
import type { ResolvedPromptPackV1 } from '../../src/contracts/prompts/prompt-pack.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { renderTemplate } from '../../src/contracts/prompts/render-template.js';
import { TEMPLATE_SLOTS } from '../../src/contracts/prompts/slot-tables.js';

const PACK: ResolvedPromptPackV1 = PLATFORM_PROMPT_PACK_V1;

describe('A-01: the plan-review input template', () => {
  it('declares exactly the five review slots, with no role or diagnosis', () => {
    expect(TEMPLATE_SLOTS['plan-review-input']).toEqual({
      prelude: { required: false },
      goal: { required: true },
      plan: { required: false },
      candidate: { required: true },
      message: { required: true },
    });
    expect(TEMPLATE_SLOTS['plan-review-input']).not.toHaveProperty('role');
    expect(TEMPLATE_SLOTS['plan-review-input']).not.toHaveProperty('diagnosis');
  });

  it('renders goal, plan, candidate and message without a role or diagnosis section', () => {
    const text = renderTemplate(PACK, 'plan-review-input', {
      goal: 'GOAL-TEXT', plan: 'PLAN-TEXT', candidate: 'CANDIDATE-TEXT', message: 'MESSAGE-TEXT',
    }, []).text;
    expect(text).toContain('GOAL-TEXT');
    expect(text).toContain('PLAN-TEXT');
    expect(text).toContain('CANDIDATE-TEXT');
    expect(text).toContain('MESSAGE-TEXT');
    expect(text).not.toContain('{{role}}');
    expect(text).not.toContain('{{diagnosis}}');
    expect(text).not.toContain('机械诊断');
    expect(text).not.toContain('ROLE-TEXT');
  });

  it('carries the template and both planning tools, with the bumped versions', () => {
    expect(PACK.templates['plan-review-input']).toBeTypeOf('string');
    expect(PACK.manifest.templates['plan-review-input']).toEqual({
      file: 'templates/plan-review-input.txt', version: 1, mentionsTools: [],
    });
    expect(PACK.manifest.templates['skill-platform-adviser']?.version).toBe(14);
    expect(PACK.manifest.templates['initial-planning-answer']?.version).toBe(7);
    expect(Object.keys(PACK.tools)).toEqual(expect.arrayContaining(['submit_plan_round', 'submit_plan_review']));
    expect(PACK.tools['submit_plan_review']?.description).toBeTruthy();
    expect(PACK.tools['submit_plan_round']?.description).toBeTruthy();
  });
});
