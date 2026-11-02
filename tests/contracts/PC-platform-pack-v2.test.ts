/**
 * PC-2 ruling 17/18: `base` v2 and the five Skills v2 carry the tool
 * sentences in `{{#tool:…}}` blocks, with version 2 and no declared tool
 * mentions. Their digests are hand-computed with `sha256sum` of the committed
 * files; the Skills' v1 digests below are the hand-written specification for
 * ruling 18's byte-equality check (with every named tool present the rendered
 * text is the v1 text plus decision 89's paragraphs).
 */
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { ResolvedPromptPackV1 } from '../../src/contracts/prompts/prompt-pack.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { renderTemplate } from '../../src/contracts/prompts/render-template.js';
import { TEMPLATE_SLOTS } from '../../src/contracts/prompts/slot-tables.js';

/** The public export, read through the contract type so arbitrary template ids can be looked up. */
const PACK: ResolvedPromptPackV1 = PLATFORM_PROMPT_PACK_V1;

// decision 89 appends the skill paragraphs (the five Skills are v3).
const V2_TEMPLATES = {
    'base': '5a9fa326d215e82d8329a0ddce8ff2da29463430550dd8320695b760ef7f03b5',
    'skill-platform-work': 'eb4bb377bcc4f98259878c47260d5c68ad01c2ce18fbe3b67e97c495a29719f1',
    'skill-platform-secretary': 'cb02659d41f8d91e430352da33b0a17154161a2edb30cb9d66e1823afa1da8d5',
    'skill-platform-adviser': '0eb7a06e205ac4530e3ec9261ba7ec697482804236a5388c7e344e8f4edb235b',
    'skill-platform-scribe': 'fd7b2ac9359d991e3181d8c2dd73d23334683601b5b6e459f161519ba76b103d',
    'skill-platform-reviewer': '4fa780b2a47de2e01145fef5363a2cac93409fc49f220ed63b1c9e77b474fc9a',
} as const;

/** The v1 Skill texts PC-1 pinned plus decision 89's paragraphs, hand-written. */
const V1_SKILL_DIGESTS = {
    'skill-platform-work': '2ccc77dc554adf50e7e55a6b86be85ff4bb4d4503c4cc13cb88e2b78ac958cd4',
    'skill-platform-secretary': '9306fa7e75e5914602f09734f36e4bf1920e816644bc9246132505b64e30d27a',
    'skill-platform-adviser': '127ff8e28254098d65175bbe068818b4eafa489e547c536265ffbf8c9ac0fabe',
    'skill-platform-scribe': 'c0fe77a90c88a341d1698bc472e79d1681a8818079cc166c83337062375385ca',
    'skill-platform-reviewer': 'c92a9343df26d1a1fd8e4db5d0aad055ad0100a9cf757670f2179f495ce8218b',
} as const;

/** Every tool a Skill sentence names; all present, so no block is omitted. */
const NAMED_SKILL_TOOLS = [
    'read', 'edit', 'shell',
    'look_graph', 'find_graph', 'record_note',
    'query_task_graph', 'query_ready_tasks', 'propose_future_plan',
    'find_related_sessions', 'read_session_card', 'send_session_message',
    'search', 'code_index', 'run_readonly_command',
] as const;

describe('platform prompt pack v2 (rulings 17–18)', () => {
    it('carries base v2 and the five Skills v3 with version 3, no tool mentions and empty slot tables', () => {
        const { manifest, templates } = PACK;
        for (const [id, expectedDigest] of Object.entries(V2_TEMPLATES)) {
            expect(manifest.templates[id], `manifest entry ${id}`).toEqual({
                file: `templates/${id}.txt`,
                version: id === 'base' ? 2 : id === 'skill-platform-adviser' ? 4 : 3,
                mentionsTools: [],
            });
            const text = templates[id];
            expect(text, `template text ${id}`).toBeTypeOf('string');
            if (text === undefined) throw new Error(`template ${id} is missing from the pack`);
            expect(TEMPLATE_SLOTS[id], `slot table ${id}`).toEqual({});
            expect(sha256Hex(text), `sha256 ${id}`).toBe(expectedDigest);
        }
    });

    it('renders every Skill to its v1 text plus the decision 89 paragraphs when every named tool is present (ruling 18)', () => {
        for (const [id, v1Digest] of Object.entries(V1_SKILL_DIGESTS)) {
            const rendered = renderTemplate(PACK, id, {}, NAMED_SKILL_TOOLS).text;
            // The whole text, compared whole: no prefix, no regex.
            expect(sha256Hex(rendered), `rendered ${id}`).toBe(v1Digest);
        }
    });

    it('orders the input templates by their section slots and carries the stale-files reminder (ruling 9)', () => {
        const work = {
            prelude: 'PRELUDE', role: 'ROLE', goal: 'GOAL', task: 'TASK', footprint: 'FOOTPRINT',
            notes: 'NOTES', inputs: 'INPUTS', continuation: 'CONTINUATION',
            unknown_call_review: 'UNKNOWN_CALL_REVIEW', reminders: 'REMINDERS',
        };
        expect(renderTemplate(PACK, 'work-input', work, []).text)
            .toBe('PRELUDE\n\nROLEGOALTASKFOOTPRINTNOTESINPUTSCONTINUATIONUNKNOWN_CALL_REVIEWREMINDERS');
        expect(renderTemplate(PACK, 'query-planning-input', {
            prelude: 'PRELUDE', role: 'ROLE', goal: 'GOAL', task: 'TASK', footprint: 'FOOTPRINT',
        }, []).text).toBe('PRELUDE\n\nROLEGOALTASKFOOTPRINT');
        expect(renderTemplate(PACK, 'query-copy-input', {
            prelude: 'PRELUDE', role: 'ROLE', goal: 'GOAL', task: 'TASK',
        }, []).text).toBe('PRELUDE\n\nROLEGOALTASK');
        expect(renderTemplate(PACK, 'secretary-round', {
            prelude: 'PRELUDE', role: 'ROLE', goal: 'GOAL', notes: 'NOTES',
            task_round: 'ROUND', task_batched: 'BATCHED', task_earlier: 'EARLIER',
        }, []).text).toBe('PRELUDE\n\nROLEGOALNOTESROUNDBATCHEDEARLIER');
        expect(renderTemplate(PACK, 'stale-files-reminder', {}, []).text)
            .toBe('- 文件可能已经变化，编辑前先重新读取。');
        expect(renderTemplate(PACK, 'continuation-brief', {
            marker: 'MARKER', body: '', bodyOmission: '', anomalies: '', review: '', blocked: '', blockedOmission: '',
        }, []).text).not.toContain('文件可能已经变化');
    });

    it('origins gives every template its pack, version and tool declarations (ruling 13)', () => {
        // Every platform template id with its pack, version and mentions, hand-written:
        // no key or version is read from the manifest or the generated origins.
        expect(PACK.origins).toEqual({
            'initial-planning-answer': { packId: 'platform', version: 4, mentionsTools: [] },
            'consultation-received-input': { packId: 'platform', version: 1, mentionsTools: [] },
            'user-decision-response': { packId: 'platform', version: 1, mentionsTools: [] },
            'action-request-delivery': { packId: 'platform', version: 1, mentionsTools: [] },
            'inquiry-delivery': { packId: 'platform', version: 1, mentionsTools: [] },
            'notify-delivery': { packId: 'platform', version: 1, mentionsTools: [] },
            'wait-reply-delivery': { packId: 'platform', version: 1, mentionsTools: [] },
            'wait-expiry-delivery': { packId: 'platform', version: 1, mentionsTools: [] },
            'intervention-delivery': { packId: 'platform', version: 1, mentionsTools: [] },
            'intervention-planning': { packId: 'platform', version: 1, mentionsTools: [] },
            'plan-review-input': { packId: 'platform', version: 1, mentionsTools: [] },
            'scribe-reminder': { packId: 'platform', version: 1, mentionsTools: [] },
            'continuation-brief': { packId: 'platform', version: 2, mentionsTools: [] },
            'stale-files-reminder': { packId: 'platform', version: 1, mentionsTools: [] },
            'unknown-call-review': { packId: 'platform', version: 1, mentionsTools: [] },
            'unknown-call-proposal': {
                packId: 'platform', version: 1, mentionsTools: ['propose_safer_method'],
            },
            'work-input': { packId: 'platform', version: 2, mentionsTools: [] },
            'query-planning-input': { packId: 'platform', version: 2, mentionsTools: [] },
            'query-copy-input': { packId: 'platform', version: 2, mentionsTools: [] },
            'secretary-round': { packId: 'platform', version: 1, mentionsTools: [] },
            'secretary-answer': { packId: 'platform', version: 3, mentionsTools: [] },
            'handoff-write-understanding-secretary': { packId: 'platform', version: 1, mentionsTools: [] },
            'handoff-brief-secretary': { packId: 'platform', version: 1, mentionsTools: [] },
            'handoff-write-understanding-executor': { packId: 'platform', version: 1, mentionsTools: [] },
            'handoff-write-understanding-adviser': { packId: 'platform', version: 1, mentionsTools: [] },
            'handoff-brief-executor': { packId: 'platform', version: 1, mentionsTools: ['read'] },
            'handoff-brief-adviser': { packId: 'platform', version: 1, mentionsTools: ['read'] },
            base: { packId: 'platform', version: 2, mentionsTools: [] },
            'skill-platform-work': { packId: 'platform', version: 3, mentionsTools: [] },
            'skill-platform-secretary': { packId: 'platform', version: 3, mentionsTools: [] },
            'skill-platform-adviser': { packId: 'platform', version: 4, mentionsTools: [] },
            'skill-platform-scribe': { packId: 'platform', version: 3, mentionsTools: [] },
            'skill-platform-reviewer': { packId: 'platform', version: 3, mentionsTools: [] },
        });
    });
});
