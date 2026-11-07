/**
 * PC-2 ruling 17/18: `base` v2 and the five Skills v2 carry the tool
 * sentences in `{{#tool:…}}` blocks, with version 2 and no declared tool
 * mentions. Their digests are hand-computed with `sha256sum` of the committed
 * files; the Skills' v1 digests below are the hand-written specification for
 * ruling 18's byte-equality check (with every named tool present the rendered
 * text is the v1 text plus decision 89's and 8E L3 row 4's paragraphs).
 */
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { ResolvedPromptPackV1 } from '../../src/contracts/prompts/prompt-pack.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { renderTemplate } from '../../src/contracts/prompts/render-template.js';
import { TEMPLATE_SLOTS } from '../../src/contracts/prompts/slot-tables.js';

/** The public export, read through the contract type so arbitrary template ids can be looked up. */
const PACK: ResolvedPromptPackV1 = PLATFORM_PROMPT_PACK_V1;

// decision 89 and 8E L3 row 4 append the skill paragraphs; each Skill template carries its own version.
const V2_TEMPLATES = {
    'base': '5a9fa326d215e82d8329a0ddce8ff2da29463430550dd8320695b760ef7f03b5',
    'skill-platform-work': '202fa0b83e3377a9dff1ccb3b189fe1c8ed6ea6c4e48ad4f20124e2757c4dab9',
    'skill-platform-secretary': '0bb59d33dcba00898fbb35ca971580b3acfde7ccffc4b2ca168c3fb957e6780a',
    'skill-platform-adviser': '8954f1e09e66ce7a1e7e38ea96d0dd413f1dfa10e640c1a15a2d656dd6166d96',
    'skill-platform-scribe': '7e7d2ea6b21f44f407d7dcd2d2847651e7b156306ae97fdc5a1bceb92ee4bd94',
    'skill-platform-reviewer': '7cd261e9a6611af0941f9ba42c3d0a6dbfe6e70d8a931fae88e1a4c7e03d8e9a',
} as const;

/** The v1 Skill texts PC-1 pinned plus the decision 89 and 8E L3 row 4 paragraphs, hand-written. */
const V1_SKILL_DIGESTS = {
    'skill-platform-work': '0b4b8f7baaffe224329c978d3c30819340bd87db0de7a00537da5b4ad1180952',
    'skill-platform-secretary': '5e8b4695d873c7f60bf6c9efad098a759f260b929e76b8c90e59b5d93b8451fa',
    'skill-platform-adviser': '14f22fef053a19f4013c53b833e50ee84431baf09798d2cf08a2218a8aeb0542',
    'skill-platform-scribe': '5c4d9ebc3a3abb6b7d56bcb957728247789186588f4290d451d3c1efe2f46fd1',
    'skill-platform-reviewer': '59e74ce8031bb1a10465326aefc4eab7039d2bb28096141f45a13c55ee61dd92',
} as const;

/** Every tool a Skill sentence names; all present, so no block is omitted. */
const NAMED_SKILL_TOOLS = [
    'read', 'edit', 'shell',
    'look_graph', 'find_graph', 'check_links', 'record_note',
    'query_task_graph', 'query_ready_tasks', 'propose_future_plan',
    'find_related_sessions', 'read_session_card', 'send_session_message',
    'search', 'code_index', 'run_readonly_command',
] as const;

describe('platform prompt pack v2 (rulings 17–18)', () => {
    it('carries base v2 and the five Skills at their own versions, no tool mentions and empty slot tables', () => {
        const { manifest, templates } = PACK;
        for (const [id, expectedDigest] of Object.entries(V2_TEMPLATES)) {
            expect(manifest.templates[id], `manifest entry ${id}`).toEqual({
                file: `templates/${id}.txt`,
                version: id === 'base' ? 2 : id === 'skill-platform-adviser' || id === 'skill-platform-work' ? 10
                    : id === 'skill-platform-reviewer' ? 4 : id === 'skill-platform-secretary' ? 9 : 8,
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
            'initial-planning-answer': { packId: 'platform', version: 5, mentionsTools: [] },
            'consultation-received-input': { packId: 'platform', version: 1, mentionsTools: [] },
            'user-decision-response': { packId: 'platform', version: 1, mentionsTools: [] },
            'action-request-delivery': { packId: 'platform', version: 1, mentionsTools: [] },
            'inquiry-delivery': { packId: 'platform', version: 1, mentionsTools: [] },
            'notify-delivery': { packId: 'platform', version: 1, mentionsTools: [] },
            'wait-reply-delivery': { packId: 'platform', version: 1, mentionsTools: [] },
            'wait-expiry-delivery': { packId: 'platform', version: 1, mentionsTools: [] },
            'intervention-delivery': { packId: 'platform', version: 1, mentionsTools: [] },
            'link-breaks-input': { packId: 'platform', version: 1, mentionsTools: [] },
            'intervention-planning': { packId: 'platform', version: 1, mentionsTools: [] },
            'plan-review-input': { packId: 'platform', version: 1, mentionsTools: [] },
            'scribe-reminder': { packId: 'platform', version: 2, mentionsTools: [] },
            'continuation-brief': { packId: 'platform', version: 2, mentionsTools: [] },
            'stale-files-reminder': { packId: 'platform', version: 1, mentionsTools: [] },
            'unknown-call-review': { packId: 'platform', version: 1, mentionsTools: [] },
            'unknown-call-proposal': {
                packId: 'platform', version: 1, mentionsTools: ['propose_safer_method'],
            },
            'work-input': { packId: 'platform', version: 2, mentionsTools: [] },
            'query-planning-input': { packId: 'platform', version: 2, mentionsTools: [] },
            'query-copy-input': { packId: 'platform', version: 2, mentionsTools: [] },
            'secretary-round': { packId: 'platform', version: 2, mentionsTools: [] },
            'secretary-answer': { packId: 'platform', version: 3, mentionsTools: [] },
            'handoff-write-understanding-secretary': { packId: 'platform', version: 1, mentionsTools: [] },
            'handoff-brief-secretary': { packId: 'platform', version: 1, mentionsTools: [] },
            'handoff-write-understanding-executor': { packId: 'platform', version: 1, mentionsTools: [] },
            'handoff-write-understanding-adviser': { packId: 'platform', version: 2, mentionsTools: [] },
            'handoff-brief-executor': { packId: 'platform', version: 1, mentionsTools: ['read'] },
            'handoff-brief-adviser': { packId: 'platform', version: 2, mentionsTools: ['read'] },
            base: { packId: 'platform', version: 2, mentionsTools: [] },
            'skill-platform-work': { packId: 'platform', version: 10, mentionsTools: [] },
            'skill-platform-secretary': { packId: 'platform', version: 9, mentionsTools: [] },
            'skill-platform-adviser': { packId: 'platform', version: 10, mentionsTools: [] },
            'skill-platform-scribe': { packId: 'platform', version: 8, mentionsTools: [] },
            'skill-platform-reviewer': { packId: 'platform', version: 4, mentionsTools: [] },
        });
    });
});
