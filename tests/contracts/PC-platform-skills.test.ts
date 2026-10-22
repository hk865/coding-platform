/**
 * PC-1a — ruling 12: platform Skill metadata stays in code, with the five
 * values the committed `skill.json` files carry. A pack changes text only.
 */
import { describe, expect, it } from 'vitest';
import { PLATFORM_SKILLS } from '../../src/contracts/prompts/platform-skills.js';

describe('platform Skill metadata (ruling 12)', () => {
    it('lists the five platform Skills in priority order with their template ids', () => {
        expect(PLATFORM_SKILLS).toEqual([
            { id: 'platform-work', title: 'Platform work', kind: 'instruction', priority: 90, templateId: 'skill-platform-work' },
            { id: 'platform-secretary', title: 'Platform secretary', kind: 'instruction', priority: 70, templateId: 'skill-platform-secretary' },
            { id: 'platform-adviser', title: 'Platform adviser', kind: 'instruction', priority: 60, templateId: 'skill-platform-adviser' },
            { id: 'platform-scribe', title: 'Platform scribe', kind: 'instruction', priority: 50, templateId: 'skill-platform-scribe' },
            { id: 'platform-reviewer', title: 'Platform reviewer', kind: 'instruction', priority: 40, templateId: 'skill-platform-reviewer' },
        ]);
    });

    it('gives every row the instruction kind and a skill-platform- template id', () => {
        for (const skill of PLATFORM_SKILLS) {
            expect(skill.kind).toBe('instruction');
            expect(skill.templateId).toBe(`skill-${skill.id}`);
        }
    });
});
