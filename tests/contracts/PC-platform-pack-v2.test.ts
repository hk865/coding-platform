/**
 * PC-2 ruling 17/18: `base` v2 and the five Skills v2 carry the tool
 * sentences in `{{#tool:…}}` blocks, with version 2 and no declared tool
 * mentions. Their digests are hand-computed with `sha256sum` of the committed
 * files; the Skills' v1 digests below are the hand-written specification for
 * ruling 18's byte-equality check (with every named tool present the rendered
 * text is the v1 text).
 */
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { ResolvedPromptPackV1 } from '../../src/contracts/prompts/prompt-pack.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { renderTemplate } from '../../src/contracts/prompts/render-template.js';
import { TEMPLATE_SLOTS } from '../../src/contracts/prompts/slot-tables.js';

/** The public export, read through the contract type so arbitrary template ids can be looked up. */
const PACK: ResolvedPromptPackV1 = PLATFORM_PROMPT_PACK_V1;

const V2_TEMPLATES = {
    'base': '5a9fa326d215e82d8329a0ddce8ff2da29463430550dd8320695b760ef7f03b5',
    'skill-platform-work': 'e258bef4180c56177bcd6a083e5927e3e374cf1dcd50636cf74171bfd8abf053',
    'skill-platform-secretary': '3842e7592faceea16b868ae8e364f261d93cfd859f00c00be8fc1809af8c4f84',
    'skill-platform-adviser': '99e51b8b684661c215258afe57e07d4bf40a44163a5d2e97208699465715c977',
    'skill-platform-scribe': 'dc0671546449950d91ab03fdfa7a8fa3858473a9cda84779e4c4eb3f5564f59f',
    'skill-platform-reviewer': 'a7e4ab9987ab8703399f3f9c7815e85b1b4bb7ced24ad9437d196c169ee63d6f',
} as const;

/** The v1 Skill texts PC-1 pinned, hand-written: bytes of the old resources. */
const V1_SKILL_DIGESTS = {
    'skill-platform-work': '5e1feacc1aed9901b3a5c0fb5870ccb8642b6cb43e3b1ac28f9cb02f2ed4f95f',
    'skill-platform-secretary': 'a8644c9adebb22df4e920fc823ede079fc7caee44d959f84394546b63dffc8ee',
    'skill-platform-adviser': '3e9bf8beaed4064e7c992fefba9729d57a5317a01227976926029915dad3dc85',
    'skill-platform-scribe': 'e2384821311341bfd440a50cd4b68bc818126d3b8d0792f23e9357c619bae043',
    'skill-platform-reviewer': 'a7e4ab9987ab8703399f3f9c7815e85b1b4bb7ced24ad9437d196c169ee63d6f',
} as const;

/** Every tool a Skill sentence names; all present, so no block is omitted. */
const NAMED_SKILL_TOOLS = [
    'read', 'edit', 'shell',
    'look_graph', 'find_graph', 'record_note',
    'query_task_graph', 'query_ready_tasks', 'propose_future_plan', 'apply_future_plan',
    'find_related_sessions', 'read_session_card', 'send_session_message',
] as const;

describe('platform prompt pack v2 (rulings 17–18)', () => {
    it('carries base v2 and the five Skills v2 with version 2, no tool mentions and empty slot tables', () => {
        const { manifest, templates } = PACK;
        for (const [id, expectedDigest] of Object.entries(V2_TEMPLATES)) {
            expect(manifest.templates[id], `manifest entry ${id}`).toEqual({
                file: `templates/${id}.txt`,
                version: 2,
                mentionsTools: [],
            });
            const text = templates[id];
            expect(text, `template text ${id}`).toBeTypeOf('string');
            if (text === undefined) throw new Error(`template ${id} is missing from the pack`);
            expect(TEMPLATE_SLOTS[id], `slot table ${id}`).toEqual({});
            expect(sha256Hex(text), `sha256 ${id}`).toBe(expectedDigest);
        }
    });

    it('renders every Skill to its v1 text when every named tool is present (ruling 18)', () => {
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
            'initial-planning-answer': { packId: 'platform', version: 1, mentionsTools: [] },
            'consultation-received-input': { packId: 'platform', version: 1, mentionsTools: [] },
            'user-decision-response': { packId: 'platform', version: 1, mentionsTools: [] },
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
            base: { packId: 'platform', version: 2, mentionsTools: [] },
            'skill-platform-work': { packId: 'platform', version: 2, mentionsTools: [] },
            'skill-platform-secretary': { packId: 'platform', version: 2, mentionsTools: [] },
            'skill-platform-adviser': { packId: 'platform', version: 2, mentionsTools: [] },
            'skill-platform-scribe': { packId: 'platform', version: 2, mentionsTools: [] },
            'skill-platform-reviewer': { packId: 'platform', version: 2, mentionsTools: [] },
        });
    });
});
