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
// SCRV (start rulings draft §4): the scribe template gains its review section, version 8 -> 9 below; its digest here is
// 9's, set at the merge from the builder's text (lead rulings: pins are unified at the merge).
const V2_TEMPLATES = {
    'base': 'cee15946501a2db933e00e1ea9954e8332542ab130268cd32c6962c91061958c',
    'skill-platform-work': 'fee248cc70c5ed0a07bc8e679bd8357fa6e678976818b121e6f837cdf29ec7b3',
    'skill-platform-secretary': 'da3380211ac07defcb938eb3dba47d8ac1b0083174a1b8e688909c491cb2c48a',
    'skill-platform-adviser': '479429b59b3681902eb367d6cb3d7cb8821b8fcba76964e9d282af67e36baee0',
    'skill-platform-scribe': '06eaa54bb819486d3b7e3e69bd4bdcfe0a5cfb7e5a73a893296500710ec7b65d',
    'skill-platform-reviewer': '730e2ee4693fbd17776a2adfb5c6b8edaeab2c5ba7ed102aec0ba49aec9307a6',
} as const;

/** The v1 Skill texts PC-1 pinned plus the decision 89, 8E L3 row 4 and 121-128 (goal gate) paragraphs, hand-written. */
const V1_SKILL_DIGESTS = {
    'skill-platform-work': '65d0bd9fca305c43d84ab2ebee1d8de00a76567aa69721243de78a181d00953c',
    'skill-platform-secretary': 'e7f8d824bb4b98a2bc15bade83c872bda2849b21062881290fe2aa3b5d2d9553',
    'skill-platform-adviser': '177e6d85204008fc09a91d760a8b24dba713267d00937e545db30a1a0c993c3a',
    'skill-platform-scribe': '5c4d9ebc3a3abb6b7d56bcb957728247789186588f4290d451d3c1efe2f46fd1',
    'skill-platform-reviewer': '36fcce8c4354c4ac131f4bc64759a76695b4781c0937ab47c3c44704f7b9ed20',
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
                version: id === 'base' ? 3 : id === 'skill-platform-adviser' ? 15 : id === 'skill-platform-work' ? 11
                    : id === 'skill-platform-reviewer' ? 5 : id === 'skill-platform-secretary' ? 10 : 9, // scribe 9 (SCRV, +1 in its tree)
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
            'initial-planning-answer': { packId: 'platform', version: 8, mentionsTools: [] },
            'consultation-received-input': { packId: 'platform', version: 1, mentionsTools: [] },
            'user-decision-response': { packId: 'platform', version: 1, mentionsTools: [] },
            'action-request-delivery': { packId: 'platform', version: 1, mentionsTools: [] },
            'inquiry-delivery': { packId: 'platform', version: 1, mentionsTools: [] },
            'notify-delivery': { packId: 'platform', version: 1, mentionsTools: [] },
            'wait-reply-delivery': { packId: 'platform', version: 1, mentionsTools: [] },
            'wait-expiry-delivery': { packId: 'platform', version: 1, mentionsTools: [] },
            'intervention-delivery': { packId: 'platform', version: 1, mentionsTools: [] },
            'link-breaks-input': { packId: 'platform', version: 1, mentionsTools: [] },
            'python-syntax-input': { packId: 'platform', version: 1, mentionsTools: [] },
            'context-summary-request': { packId: 'platform', version: 1, mentionsTools: [] },
            'intervention-planning': { packId: 'platform', version: 1, mentionsTools: [] },
            'plan-review-input': { packId: 'platform', version: 2, mentionsTools: [] },
            'exec-review-input': { packId: 'platform', version: 1, mentionsTools: [] },
            'unknown-call-advice-input': { packId: 'platform', version: 1, mentionsTools: [] },
            'command-rerun-advice-input': { packId: 'platform', version: 1, mentionsTools: [] },
            'scribe-reminder': { packId: 'platform', version: 3, mentionsTools: [] },
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
            'secretary-answer': { packId: 'platform', version: 6, mentionsTools: [] },
            'handoff-write-understanding-secretary': { packId: 'platform', version: 1, mentionsTools: [] },
            'handoff-brief-secretary': { packId: 'platform', version: 1, mentionsTools: [] },
            'handoff-write-understanding-executor': { packId: 'platform', version: 1, mentionsTools: [] },
            'handoff-write-understanding-adviser': { packId: 'platform', version: 2, mentionsTools: [] },
            'handoff-brief-executor': { packId: 'platform', version: 1, mentionsTools: ['read'] },
            'handoff-brief-adviser': { packId: 'platform', version: 2, mentionsTools: ['read'] },
            base: { packId: 'platform', version: 3, mentionsTools: [] },
            'skill-platform-work': { packId: 'platform', version: 11, mentionsTools: [] },
            'skill-platform-secretary': { packId: 'platform', version: 10, mentionsTools: [] },
            'skill-platform-adviser': { packId: 'platform', version: 15, mentionsTools: [] },
            'skill-platform-scribe': { packId: 'platform', version: 9, mentionsTools: [] },
            'skill-platform-reviewer': { packId: 'platform', version: 5, mentionsTools: [] },
        });
    });
});
