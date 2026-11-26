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
// The five Skills after the P2 rewrite; every digest below is the merged template file's own sha256.
const V2_TEMPLATES = {
    'base': 'cee15946501a2db933e00e1ea9954e8332542ab130268cd32c6962c91061958c',
    'skill-platform-work': '09c7bd509c006205eb99ce699dede5c31dd783580dfb30cc834086cd0f6b2047',
    'skill-platform-secretary': '31f121ff3cf1c558f9d23affc170f88408f8c29ed99d81304d3bd09176c4aa6a',
    'skill-platform-adviser': '37a81d972c2b96514a7a1edfeef7539d742ca0831ee75a5d32b5af382ee8bb78',
    'skill-platform-scribe': '9050ace0cf231d3caa36c5d8016e03e637b36a844281d9fc9a6ffff539b9d657',
    'skill-platform-reviewer': '2a7f0abb14ff6702d5d1951d0062798cb1337b1dd4782ba6b5bba6108688ad58',
} as const;

/** The five rewritten Skill texts with every block present, hand-written as one whole digest each. */
const V1_SKILL_DIGESTS = {
    'skill-platform-work': '369d27b23e48e389a1d5ee5a8834499a4c27397163f762be8f53b5feb8c3d08d',
    'skill-platform-secretary': '191222787f6d52752cabc8c18c37f9cbf5d162e45b0e176d214c24f51c03f9cf',
    'skill-platform-adviser': '125f31954a1312b61b7f6f7d7d10476179d73532d07b66dc1f915cdfbdfb6e3d',
    'skill-platform-scribe': '5322ad792ec968e91fdacef87caa585fbe0b94c31e33740941692a680e6097f5',
    'skill-platform-reviewer': '910a470de221f1730a196d25ce27095b2652754eea476546930def7082a9b358',
} as const;

/** Every tool a Skill sentence names; all present, so no block is omitted. */
const NAMED_SKILL_TOOLS = [
    'read', 'edit', 'shell',
    'look_graph', 'find_graph', 'check_links', 'record_note',
    'query_task_graph', 'query_ready_tasks', 'propose_future_plan',
    'ask_copy', 'ask_person', 'notify_person', 'respond_session_message', 'withdraw_session_message',
    'send_session_message', 'read_requests', 'read_user_decision',
    'dispatch_task', 'hold_claim', 'release_hold', 'request_stop',
    'assign_module_maintainer', 'create_member', 'propose_architecture_revision', 'propose_role_split',
    'submit_command_rerun_advice', 'submit_plan_round', 'submit_scribe_review', 'submit_unknown_call_advice',
    'search', 'code_index', 'run_readonly_command', 'project_source',
] as const;

describe('platform prompt pack v2 (rulings 17–18)', () => {
    it('carries base v2 and the five Skills at their own versions, no tool mentions and empty slot tables', () => {
        const { manifest, templates } = PACK;
        for (const [id, expectedDigest] of Object.entries(V2_TEMPLATES)) {
            expect(manifest.templates[id], `manifest entry ${id}`).toEqual({
                file: `templates/${id}.txt`,
                version: id === 'base' ? 3 : id === 'skill-platform-adviser' ? 18 : id === 'skill-platform-work' ? 15
                    : id === 'skill-platform-reviewer' ? 6 : id === 'skill-platform-secretary' ? 14 : 10,
                mentionsTools: [],
            });
            const text = templates[id];
            expect(text, `template text ${id}`).toBeTypeOf('string');
            if (text === undefined) throw new Error(`template ${id} is missing from the pack`);
            expect(TEMPLATE_SLOTS[id], `slot table ${id}`).toEqual({});
            expect(sha256Hex(text), `sha256 ${id}`).toBe(expectedDigest);
        }
    });

    it('renders every Skill to its rewritten text when every named tool is present (ruling 18)', () => {
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
            'initial-planning-answer': { packId: 'platform', version: 16, mentionsTools: [] },
            'planning-answer-text': { packId: 'platform', version: 1, mentionsTools: [] },
            'consultation-received-input': { packId: 'platform', version: 1, mentionsTools: [] },
            'user-decision-response': { packId: 'platform', version: 1, mentionsTools: [] },
            'message-delivery': { packId: 'platform', version: 1, mentionsTools: [] },
            'wait-reply-delivery': { packId: 'platform', version: 1, mentionsTools: [] },
            'wait-expiry-delivery': { packId: 'platform', version: 1, mentionsTools: [] },
            'intervention-delivery': { packId: 'platform', version: 1, mentionsTools: [] },
            'link-breaks-input': { packId: 'platform', version: 1, mentionsTools: [] },
            'python-syntax-input': { packId: 'platform', version: 1, mentionsTools: [] },
            'context-summary-request': { packId: 'platform', version: 1, mentionsTools: [] },
            'intervention-planning': { packId: 'platform', version: 2, mentionsTools: [] },
            'plan-review-input': { packId: 'platform', version: 2, mentionsTools: [] },
            'exec-review-input': { packId: 'platform', version: 2, mentionsTools: [] },
            'unknown-call-advice-input': { packId: 'platform', version: 1, mentionsTools: [] },
            'command-rerun-advice-input': { packId: 'platform', version: 1, mentionsTools: [] },
            'check-review-input': { packId: 'platform', version: 1, mentionsTools: [] },
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
            'secretary-answer': { packId: 'platform', version: 11, mentionsTools: [] },
            'handoff-write-understanding-secretary': { packId: 'platform', version: 1, mentionsTools: [] },
            'handoff-brief-secretary': { packId: 'platform', version: 1, mentionsTools: [] },
            'handoff-write-understanding-executor': { packId: 'platform', version: 1, mentionsTools: [] },
            'handoff-write-understanding-adviser': { packId: 'platform', version: 2, mentionsTools: [] },
            'handoff-brief-executor': { packId: 'platform', version: 1, mentionsTools: ['read'] },
            'handoff-brief-adviser': { packId: 'platform', version: 2, mentionsTools: ['read'] },
            base: { packId: 'platform', version: 3, mentionsTools: [] },
            'skill-platform-work': { packId: 'platform', version: 15, mentionsTools: [] },
            'skill-platform-secretary': { packId: 'platform', version: 14, mentionsTools: [] },
            'skill-platform-adviser': { packId: 'platform', version: 18, mentionsTools: [] },
            'skill-platform-scribe': { packId: 'platform', version: 10, mentionsTools: [] },
            'skill-platform-reviewer': { packId: 'platform', version: 6, mentionsTools: [] },
        });
    });
});
