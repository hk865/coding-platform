/**
 * The two secretary templates: their platform text, slot tables, rendering and
 * section order. Expected texts are the specification's literals; expected
 * digests are `sha256sum` of the committed files, as the PC pack tests do.
 *
 * The task section is one section made of three adjacent slots
 * (`task_round`, `task_batched`, `task_earlier`) in that internal order. A
 * person's pack may move the block but never split or reorder it.
 */
import { describe, expect, it } from 'vitest';
import type { ContextAssemblyBindingV1 } from '../../src/contracts/graph-context.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { ResolvedPromptPackV1 } from '../../src/contracts/prompts/prompt-pack.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import type { PromptTextsV1 } from '../../src/contracts/prompts/prompt-set.js';
import { parseTemplateV1, renderTemplate } from '../../src/contracts/prompts/render-template.js';
import { TEMPLATE_SLOTS } from '../../src/contracts/prompts/slot-tables.js';
import {
    queryPreparedSectionOrder, sectionOrderFor, templateSectionOrder, workPreparedSectionOrder,
} from '../../src/core/agent-runtime/context-rendering.js';
import { contextAssemblyProblem } from '../../src/core/work-graph/state/context-input.js';

const PACK: ResolvedPromptPackV1 = PLATFORM_PROMPT_PACK_V1;

/** The committed platform files, hand-checked with `sha256sum`; decision 89 appends the skill paragraphs. */
const EXISTING_DIGESTS = {
    'work-input': 'f3ebad58e28d7f5a2d8bc8831b7974b03057c0590982d23fc325be933f5aed7a',
    'query-planning-input': 'ac29545b215361ea2ce479007f2c3ffcc3daa87a2bbacaf89957b49aa4022a77',
    'query-copy-input': '89ee28b2dc868787a7e41a063edadf9765e474e93b3bb477b038f93909808e20',
    'initial-planning-answer': 'a34231b808930bc7b7d357a774d0601a8fff212992446f20826c972ed1bd861b',
    base: 'cee15946501a2db933e00e1ea9954e8332542ab130268cd32c6962c91061958c',
    'skill-platform-work': 'fee248cc70c5ed0a07bc8e679bd8357fa6e678976818b121e6f837cdf29ec7b3',
    'skill-platform-secretary': '0bb59d33dcba00898fbb35ca971580b3acfde7ccffc4b2ca168c3fb957e6780a',
    'skill-platform-adviser': 'b96a3e5867ab98f821bb34926568b2f21325607254cf583a978dbd35c59c3628',
    'skill-platform-scribe': '06eaa54bb819486d3b7e3e69bd4bdcfe0a5cfb7e5a73a893296500710ec7b65d',
    'skill-platform-reviewer': '7cd261e9a6611af0941f9ba42c3d0a6dbfe6e70d8a931fae88e1a4c7e03d8e9a',
} as const;

const secretaryAnswerText = [
    '{{#tool:submit_secretary_answer}}Answer only by calling submit_secretary_answer with this round\'s answer, as '
    + 'the last and only call of this reply; never write the answer as text. If it returns problems, fix every one '
    + 'and call it again in this round.{{/tool:submit_secretary_answer}}'
    + '{{#tool:submit_initial_plan}}When this round\'s answer is a plan, answer only by calling submit_initial_plan '
    + 'with it, as the last and only call of this reply; never write the answer as text. If it returns problems, fix '
    + 'every one and call it again in this round.',
    '{{/tool:submit_initial_plan}}{{#tool:submit_initial_questions}}When this round\'s answer is questions for the '
    + 'person, answer only by calling submit_initial_questions with them, as the last and only call of this reply; '
    + 'never write the answer as text. If it returns problems, fix every one and call it again in this round.'
    + '{{/tool:submit_initial_questions}}'
    + '{{#tool:submit_plan_round}}\n'
    + 'The Goal already has an adopted Plan. When this request only adds 1-3 new Tasks, changes no existing Task '
    + '(its definition, acceptance, disposition or dependencies), adds no gate or obligation for an existing Task, '
    + 'and does not change the Goal objective, you may skip the ideas and call submit_plan_round directly: answerKind '
    + '"plan", a one-sentence summary, and one segment that holds only the new Tasks with their assignments plus one '
    + 'new obligation carrying them. Put them in an existing stage, or open a new stage with its own required stage '
    + 'gate. The platform adopts a change this small under its own identity without review, and the person sees '
    + '"arranged"; anything larger stays a candidate for the person. If the change is not small or you are unsure, '
    + 'keep using submit_secretary_answer.\n'
    + '{{/tool:submit_plan_round}}',
].join('\n');

/** The platform `secretary-round` layout, written out: one blank line after the prelude. */
const secretaryRoundBody =
    '{{prelude}}\n\n{{role}}{{goal}}{{notes}}{{task_round}}{{task_batched}}{{task_earlier}}';

const TASK_BLOCK = '{{role}}{{goal}}{{task_round}}{{task_batched}}{{task_earlier}}{{notes}}';

function textsOf(secretaryRound: string): PromptTextsV1 {
    return { templates: { 'secretary-round': secretaryRound }, strings: {} };
}

describe('the platform secretary templates', () => {
    it('declares the round at version 2 and the answer at version 4, with their code-owned slots and digests', () => {
        const versions = {
            'secretary-round': 2, 'secretary-answer': 4,
            'handoff-write-understanding-secretary': 1, 'handoff-brief-secretary': 1,
        } as const;
        for (const id of [
            'secretary-round', 'secretary-answer',
            'handoff-write-understanding-secretary', 'handoff-brief-secretary',
        ] as const) {
            expect(PACK.manifest.templates[id], `manifest entry ${id}`).toEqual({
                file: `templates/${id}.txt`, version: versions[id], mentionsTools: [],
            });
            expect(PACK.origins[id], `origin ${id}`).toEqual({
                packId: 'platform', version: versions[id], mentionsTools: [],
            });
        }
        expect(TEMPLATE_SLOTS['secretary-round']).toEqual({
            prelude: { required: false },
            role: { required: true },
            goal: { required: false },
            notes: { required: false },
            task_round: { required: true },
            task_batched: { required: false },
            task_earlier: { required: false },
        });
        expect(TEMPLATE_SLOTS['secretary-answer']).toEqual({});
        expect(TEMPLATE_SLOTS['handoff-write-understanding-secretary']).toEqual({ task_round: { required: true } });
        expect(TEMPLATE_SLOTS['handoff-brief-secretary']).toEqual({ task_round: { required: true } });
        expect(PACK.templates['secretary-round']).toBe(secretaryRoundBody);
        expect(PACK.templates['secretary-answer']).toBe(secretaryAnswerText);
        expect(parseTemplateV1('secretary-round', PACK.templates['secretary-round']!).status).toBe('parsed');
        expect(parseTemplateV1('secretary-answer', PACK.templates['secretary-answer']!).status).toBe('parsed');
        expect(sha256Hex(PACK.templates['secretary-round']!))
            .toBe('1fbe219c936568074193d9f4f57dd5a15e963f6487be2838a78d040429b3cc7c');
        expect(sha256Hex(PACK.templates['secretary-answer']!))
            .toBe('6de01c878a178ac3f108130eb73463d318eb8157ba7eeb24fb515240029ba3cf');
        expect(sha256Hex(PACK.templates['handoff-write-understanding-secretary']!))
            .toBe('d7afe976edbe02c6dd541b644b3c2b7f314bb186ff4458432e817a4fae7483c6');
        expect(sha256Hex(PACK.templates['handoff-brief-secretary']!))
            .toBe('d9207c93fb42718ece6b1e70e3bcbb526a28c3782f4e99e680fd366ffc15b6a9');
    });

    it('renders the three task slots as one adjacent block in the platform order', () => {
        const rendered = renderTemplate(PACK, 'secretary-round', {
            prelude: 'PRELUDE', role: 'ROLE', goal: 'GOAL', notes: 'NOTES',
            task_round: 'ROUND', task_batched: 'BATCHED', task_earlier: 'EARLIER',
        }, []);
        expect(rendered.text).toBe('PRELUDE\n\nROLEGOALNOTESROUNDBATCHEDEARLIER');
        expect(Object.keys(rendered.sectionRanges)).toEqual(
            ['prelude', 'role', 'goal', 'notes', 'task_round', 'task_batched', 'task_earlier']);
    });

    it('carries the secretary strings of the specification verbatim', () => {
        expect({
            workspaceHeading: PACK.strings['secretary.workspaceHeading'],
            goalsHeading: PACK.strings['secretary.goalsHeading'],
            noGoal: PACK.strings['secretary.noGoal'],
            roundHeading: PACK.strings['secretary.roundHeading'],
            referencesHeading: PACK.strings['secretary.referencesHeading'],
            selectedIdea: PACK.strings['secretary.selectedIdea'],
            batchedHeading: PACK.strings['secretary.batchedHeading'],
            earlierHeading: PACK.strings['secretary.earlierHeading'],
            answerOmitted: PACK.strings['secretary.answerOmitted'],
            noAnswer: PACK.strings['secretary.noAnswer'],
            notEnded: PACK.strings['secretary.notEnded'],
            initialDrafts: PACK.strings['secretary.initialDrafts'],
            setupRequired: PACK.strings['secretary.setupRequired'],
        }).toEqual({
            workspaceHeading: '## Workspace',
            goalsHeading: '## Goals',
            noGoal: 'This request has no goal yet.',
            roundHeading: '## This round',
            referencesHeading: '## References',
            selectedIdea: 'Selected idea:',
            batchedHeading: '## Also queued in this request',
            earlierHeading: '## Earlier rounds of this request on other secretaries',
            answerOmitted: '(answer cut at 2 KiB)',
            noAnswer: '(no answer)',
            notEnded: '(still running or result unknown)',
            initialDrafts: 'This request has no goal yet, so a plan answer needs at least one "goalCardDrafts" entry '
                + 'and a "planDraftIndex" naming the draft it is for; a questions answer may carry drafts or none. '
                + 'A draft is a proposal only.',
            setupRequired: 'This project has no adopted architecture or no active completion policy yet, so a plan '
                + 'answer must carry the "setup" field with architecture, completionPolicy and checks; the OPTIONAL '
                + 'and "Omit setup" wording does not apply in this round.',
        });
    });

    it('renders no text when no submit tool is frozen, with no slots', () => {
        expect(renderTemplate(PACK, 'secretary-answer', {}, []).text).toBe('');
    });

    it('records the platform order as role, goal, notes, task', () => {
        expect(templateSectionOrder(PACK, 'secretary-round')).toEqual(['role', 'goal', 'notes', 'task']);
        expect(sectionOrderFor('secretary', 'secretary-round')).toEqual(['role', 'goal', 'notes', 'task']);
        expect(queryPreparedSectionOrder()).toEqual({
            planning: ['role', 'goal', 'task', 'footprint'],
            copy: ['role', 'goal', 'task'],
            secretary: ['role', 'goal', 'notes', 'task'],
            intervention_planning: ['role', 'goal', 'task'],
        });
    });

    it("follows a person's pack that moves the task block to another legal section order", () => {
        const texts = textsOf('{{prelude}}\n\n' + TASK_BLOCK);
        expect(parseTemplateV1('secretary-round', TASK_BLOCK).status).toBe('parsed');
        expect(templateSectionOrder(texts, 'secretary-round')).toEqual(['role', 'goal', 'task', 'notes']);
        expect(sectionOrderFor('secretary', 'secretary-round', texts)).toEqual(['role', 'goal', 'task', 'notes']);
    });
});

describe('rejects: a pack that does not keep the task slots as one block', () => {
    it('separates the block by another section', () => {
        const parsed = parseTemplateV1('secretary-round',
            '{{prelude}}\n\n{{role}}{{goal}}{{task_round}}{{notes}}{{task_batched}}{{task_earlier}}');
        expect(parsed.status).toBe('invalid');
        if (parsed.status !== 'invalid') return;
        expect(parsed.errors).toHaveLength(1);
        expect(parsed.error.code).toBe('illegal_section_order');
        expect(parsed.error.slot).toBe('task_round');
    });

    it('reorders the three task slots', () => {
        const parsed = parseTemplateV1('secretary-round',
            '{{prelude}}\n\n{{role}}{{goal}}{{notes}}{{task_round}}{{task_earlier}}{{task_batched}}');
        expect(parsed.status).toBe('invalid');
        if (parsed.status !== 'invalid') return;
        expect(parsed.errors).toHaveLength(1);
        expect(parsed.error.code).toBe('illegal_section_order');
        expect(parsed.error.slot).toBe('task_round');
    });

    it('puts a section before the role section', () => {
        const parsed = parseTemplateV1('secretary-round',
            '{{prelude}}\n\n{{goal}}{{role}}{{notes}}{{task_round}}{{task_batched}}{{task_earlier}}');
        expect(parsed.status).toBe('invalid');
        if (parsed.status !== 'invalid') return;
        expect(parsed.errors).toHaveLength(1);
        expect(parsed.error.code).toBe('illegal_section_order');
        expect(parsed.error.slot).toBe('role');
    });

    it('puts a task slot inside a block instead of a top-level slot', () => {
        const parsed = parseTemplateV1('secretary-round',
            '{{prelude}}\n\n{{role}}{{goal}}{{notes}}{{task_round}}{{#task_batched}}{{/task_batched}}{{task_earlier}}');
        expect(parsed.status).toBe('invalid');
        if (parsed.status !== 'invalid') return;
        expect(parsed.errors).toHaveLength(1);
        expect(parsed.error.code).toBe('template_invalid');
        expect(parsed.error.slot).toBe('task_batched');
    });
});

describe('rejects: an empty required task slot', () => {
    it('reports an empty task_round as a code bug instead of rendering it', () => {
        // A required task slot may not be empty: the renderer reports the code bug.
        expect(() => renderTemplate(PACK, 'secretary-round', {
            prelude: 'PRELUDE', role: 'ROLE', task_round: '',
        }, [])).toThrow(/required slot "task_round" is empty/);
    });
});

describe('the existing input templates stay byte-identical and keep their orders', () => {
    it('keeps the Work and Query texts and their frozen section orders', () => {
        for (const [id, digest] of Object.entries(EXISTING_DIGESTS)) {
            expect(sha256Hex(PACK.templates[id]!), `sha256 ${id}`).toBe(digest);
        }
        expect(PACK.templates['work-input']).toBe(
            '{{prelude}}\n\n{{role}}{{goal}}{{task}}{{footprint}}{{notes}}{{inputs}}'
            + '{{continuation}}{{unknown_call_review}}{{reminders}}');
        expect(workPreparedSectionOrder()).toEqual({
            work: ['role', 'goal', 'task', 'footprint', 'notes', 'inputs', 'unknown_call_review', 'reminders'],
            continuation: ['role', 'goal', 'task', 'footprint', 'notes', 'inputs', 'continuation', 'reminders'],
            handoff: ['role', 'goal', 'task', 'footprint', 'notes', 'inputs', 'continuation', 'reminders'],
        });
        expect(queryPreparedSectionOrder().planning).toEqual(['role', 'goal', 'task', 'footprint']);
        expect(queryPreparedSectionOrder().copy).toEqual(['role', 'goal', 'task']);
    });
});


/** A minimal secretary binding whose text is exactly its four sections. */
function secretaryBinding(text: string, sections: ContextAssemblyBindingV1['sections'],
    sectionOrder: ContextAssemblyBindingV1['sectionOrder']): ContextAssemblyBindingV1 {
    const totalBytes = Buffer.byteLength(text, 'utf8');
    return {
        schemaVersion: 1, formatVersion: 's3-context-v1', callKind: 'secretary', sectionOrder, duty: 'secretary',
        residentBudgetBytes: totalBytes, residentBytes: 0, totalBytes, sections,
        sources: [], inputSelections: [],
        extensions: {
            notes: 'not_implemented', anomalies: 'not_implemented', footprint: 'not_implemented',
            goalSettings: 'not_implemented', decisions: 'not_implemented',
        },
    };
}

describe('the state guard requires the secretary goal and task sections', () => {
    it('accepts role, goal, notes and task in the binding order', () => {
        const text = 'ROLE\n\nGOAL\n\nNOTES\n\nTASK';
        const binding = secretaryBinding(text, [
            { name: 'role', startByte: 0, endByte: 4, omitted: 0 },
            { name: 'goal', startByte: 6, endByte: 10, omitted: 0 },
            { name: 'notes', startByte: 12, endByte: 17, omitted: 0 },
            { name: 'task', startByte: 19, endByte: 23, omitted: 0 },
        ], ['role', 'goal', 'notes', 'task']);
        expect(contextAssemblyProblem({
            binding, text, selectedTaskInputs: [], continuationSuffix: null,
        })).toBeNull();
    });

    it('rejects a secretary binding without a goal section', () => {
        const text = 'ROLE\n\nTASK';
        const binding = secretaryBinding(text, [
            { name: 'role', startByte: 0, endByte: 4, omitted: 0 },
            { name: 'task', startByte: 6, endByte: 10, omitted: 0 },
        ], ['role', 'task']);
        const problem = contextAssemblyProblem({
            binding, text, selectedTaskInputs: [], continuationSuffix: null,
        });
        expect(problem).toMatchObject({ status: 'rejected', code: 'invalid' });
        if (problem === null || problem.status !== 'rejected') return;
        expect(problem.reason).toContain('goal section');
    });

    it('rejects a secretary binding without a task section', () => {
        const text = 'ROLE\n\nGOAL\n\nNOTES';
        const binding = secretaryBinding(text, [
            { name: 'role', startByte: 0, endByte: 4, omitted: 0 },
            { name: 'goal', startByte: 6, endByte: 10, omitted: 0 },
            { name: 'notes', startByte: 12, endByte: 17, omitted: 0 },
        ], ['role', 'goal', 'notes']);
        const problem = contextAssemblyProblem({
            binding, text, selectedTaskInputs: [], continuationSuffix: null,
        });
        expect(problem).toMatchObject({ status: 'rejected', code: 'invalid' });
        if (problem === null || problem.status !== 'rejected') return;
        expect(problem.reason).toContain('task section');
    });
});
