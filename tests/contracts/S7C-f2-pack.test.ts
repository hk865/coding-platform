/**
 * The four Work handoff templates: the code-owned slot table, the real
 * parser's resolution, their tool references and the `hand_off` pack entry.
 * The expected literals are the frozen start rulings §2.4–2.5 and DR-02.
 */
import { describe, expect, it } from 'vitest';
import { readDiskPromptPack } from '../../src/app/prompt-packs.js';
import { templateToolNames } from '../../src/contracts/continuation-brief-render.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import type { ResolvedPromptPackV1 } from '../../src/contracts/prompts/prompt-pack.js';
import { parseTemplateV1 } from '../../src/contracts/prompts/render-template.js';
import { TEMPLATE_SLOTS } from '../../src/contracts/prompts/slot-tables.js';

const PACK: ResolvedPromptPackV1 = PLATFORM_PROMPT_PACK_V1;

const IDS = [
    ['handoff-write-understanding-executor', []],
    ['handoff-write-understanding-adviser', []],
    ['handoff-brief-executor', ['read']],
    ['handoff-brief-adviser', ['read']],
] as const;

const UNDERSTANDING_IDS = [
    'handoff-write-understanding-executor',
    'handoff-write-understanding-adviser',
] as const;

describe('the platform handoff templates', () => {
    it.each(IDS)('%s declares one required task_round slot and its tool declaration', (id, mentionsTools) => {
        expect(TEMPLATE_SLOTS[id]).toEqual({ task_round: { required: true } });
        expect(PACK.manifest.templates[id]?.mentionsTools).toEqual(mentionsTools);
    });

    it.each(IDS)('%s is resolved by the real parser through the real slot table', (id) => {
        const parsed = parseTemplateV1(id, PACK.templates[id]!);
        expect(parsed.status, parsed.status === 'invalid' ? parsed.error.code : 'parsed').toBe('parsed');
    });

    it.each(UNDERSTANDING_IDS)('%s reads record_note from its tool block', (id) => {
        expect(templateToolNames(PACK, id)).toEqual(['record_note']);
    });

    it('puts hand_off in both pack tables and validates as the platform pack', async () => {
        expect(PACK.manifest.tools).toHaveProperty('hand_off');
        expect(PACK.tools).toHaveProperty('hand_off');
        const read = await readDiskPromptPack('.', 'platform');
        expect(read.status).toBe('ready');
    });
});
