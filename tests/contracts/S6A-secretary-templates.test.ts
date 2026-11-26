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
    'initial-planning-answer': '3ecd62878939477c537732d53ca0781c22c78ce7419b60879822f3ca98f73833',
    base: 'cee15946501a2db933e00e1ea9954e8332542ab130268cd32c6962c91061958c',
    'skill-platform-work': '09c7bd509c006205eb99ce699dede5c31dd783580dfb30cc834086cd0f6b2047',
    'skill-platform-secretary': '31f121ff3cf1c558f9d23affc170f88408f8c29ed99d81304d3bd09176c4aa6a',
    'skill-platform-adviser': '37a81d972c2b96514a7a1edfeef7539d742ca0831ee75a5d32b5af382ee8bb78',
    'skill-platform-scribe': '9050ace0cf231d3caa36c5d8016e03e637b36a844281d9fc9a6ffff539b9d657',
    'skill-platform-reviewer': '2a7f0abb14ff6702d5d1951d0062798cb1337b1dd4782ba6b5bba6108688ad58',
} as const;

const secretaryAnswerText = [
    '{{#tool:submit_secretary_answer}}Answer only by calling submit_secretary_answer with this round\'s answer, as '
    + 'the last and only call of this reply; never write the answer as text, because a text answer changes nothing. '
    + 'If it returns problems, fix every one and call it again in this round.{{/tool:submit_secretary_answer}}'
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
    + 'new required obligation carrying them. Put them in an existing stage, or open a new stage with its own required stage '
    + 'gate. The platform adopts a change this small under its own identity without review, and the person sees '
    + '"arranged"; anything larger stays a candidate for the person. A new check it brings is first approved by the adviser. If the change is not small or you are unsure, '
    + 'keep using submit_secretary_answer.\n'
    + 'The plan\'s fields (the platform fills schemaVersion, kind and every task\'s phase):\n- stages: array of {stageId, title, description?}. A task references a stage only through its own stageId.\n- tasks: array of {taskId, stageId?, title, requirementLevel, taskKind, disposition, scope, executionIntent?, sizeClass?, estimatedLines?, plannedFiles?, replacedByTaskId?}. requirementLevel is "required" or "optional". taskKind is "work" or "gate". disposition is "active", "deferred", "cancelled" or "superseded". Every task of a NEW plan starts "pending". scope is {kind:"goal"}, {kind:"stage",stageId} or {kind:"module",stageId,moduleRef}. Task scope.moduleRef is a non-empty STRING containing the moduleId, NOT the {projectId,moduleId} object used in the architecture catalog. executionIntent is "plan_only" or "request_execution" and may appear on a work task only. sizeClass is "small", "medium", "large" or "explore"; a placeholder task carries it too. estimatedLines is a positive integer line estimate; when unsure, say so or leave it out instead of inventing a precise number. plannedFiles (optional, work task only) lists the files this task expects to change, as workspace-relative paths such as "src/a/b.ts": no leading "/" or "./", no ".." or backslash, no directory or wildcard, each path once, at most 50. A file the task will create may be listed; a rename lists both paths. It is a hint for people and other tasks, not a limit: the executor may change other files without asking, and those show as not in the plan. List only the files you are fairly sure of, or leave it out; never pad the list. A task that already ran keeps its list. replacedByTaskId points a superseded task at its successor. A task that already ran changes only its disposition (superseded plus replacedByTaskId); its frozen definition and the obligations it carries stay byte-identical. To change acceptance, add a NEW obligation (new obligationId and new requirementId) carried by the replacement task; keep the old obligation and add the replacement task to its taskIds. To cancel an existing task, set that task itself (same taskId) to "cancelled"; never add a new task that starts "cancelled".\n- assignments: array of {taskId, role, instruction}. A work task with executionIntent "request_execution" needs exactly one assignment whose role is one of the AVAILABLE roles/templateId shown in this context; a work task with executionIntent "plan_only" may omit it; a gate task must never carry an assignment or an executionIntent, because a gate conclusion comes from the formal evidence reduction, not from an execution run. A future work task with executionIntent "plan_only" may omit assignment, obligations/acceptance and dependencies; its incompleteness alone is not a reason to answer with questions instead.\n- obligations: array of {obligationId, title, requirementLevel, taskIds, verificationRequirements}. taskIds lists only work/gate tasks of this same plan. Every verificationRequirements entry is {requirementId, requirementLevel, kind, description, requiredReadPaths?}; requirementLevel is "required" or "optional" and kind must be one of the requirementKinds of the effective CompletionPolicy shown in this context. requiredReadPaths is an optional array of workspace-relative paths that a required witness requirement must read. A required obligation needs at least the policy\'s minimum number of required verification requirements.\n- taskHierarchy: {parentOf:[{parentTaskId, childTaskId}]}. It only expresses display grouping.\n- executionDag: {dependsOn:[{taskId, dependsOnId, requires:{kind, label}}]}. requires.kind is "artifact", "environment-revision" or "gate-result"; use a real versioned input/output dependency, keep the DAG acyclic and never make a task depend on itself.\n- taskRelations: Optional: array of {fromTaskId, toTaskId, kind, note}; kind is "coordination" or "expected_dependency". It is advisory only and never a dispatch prerequisite.\nA segment or refinement keeps the existing goal gate, stage gates and their obligations unchanged, unless the person changes what the goal or a stage must meet (see below). A task you leave out stays as it is and is not dropped: when the change replaces or drops what a task does, list that task with its own taskId as "cancelled", or "superseded" with replacedByTaskId.\nA gate\'s obligations carry only general checks (the whole test suite passes, the main-flow scenario works); put each feature\'s own requirements in obligations on the work tasks that build it.\nWhen a change touches what an adopted gate requires: until the person has clearly changed what the goal or a stage must meet, keep the gate and its obligations, and ask through questions only about a real open decision; once the person has clearly changed it (drops or rewrites a requirement a gate carries), mark that gate superseded with replacedByTaskId naming a new gate, carry the new acceptance in new obligations on that gate, and leave out the obligations only the old gate carried (this holds for obligations only; a task left out stays active); only the person\'s adoption accepts this.\nA planning round\'s checks are a top-level list beside plan (array of {checkId, kind, command, cwd, timeoutMs, taskIds}); each entry\'s kind is "static" or "dynamic", taskIds is "all" for a project-wide entry, else exactly the tasks it checks; they are checks its tasks need and no installed check runs; adopting the plan installs them, so a later goal proposes its own checks; a plan the platform adopts by itself needs each new check to fail on the workspace as it is before this change.\n'
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
            'secretary-round': 2, 'secretary-answer': 11,
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
            .toBe('1c56383595c12ebea30f9b7ad9551d276495daef12cba1fa273f71ff455ba9bb');
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

/**
 * CPL C9 (decision 121-128, `cpl-rulings.md` CPL-3 and row C9): the rendered initial planning instructions (the prose
 * before the shape sample) ask for the one goal gate and say what a check's git view hides.
 * Green today: the guide names a `"gate"` task with scope `{kind:"goal"}` and its `taskIds`, and a check's git works
 * while only the untracked `.workbench/` is hidden (lead 11-26: the command is not blind to `.git`).
 * Mutation: delete either new sentence, or put the old one back -> its cell fails.
 */
describe('CPL C9: the initial planning instructions ask for the goal gate and say what a check\'s git hides', () => {
    const prose = renderTemplate(PACK, 'initial-planning-answer', {}, []).text
        .split('BEGIN_INITIAL_PLAN_EXAMPLE')[0]!.split('\n');
    it.each([
        { cell: 'the one goal gate: a "gate" task with scope {kind:"goal"} listed in an obligation\'s taskIds',
            holds: (line: string) => /taskKind"?:?\s*"gate"/.test(line) && /kind"?:\s*"goal"/.test(line)
                && line.includes('taskIds') },
        { cell: 'the sentence that a check\'s git hides only .workbench/', holds: (line: string) => line.includes('.workbench/') },
    ])('carries $cell', ({ holds }) => {
        expect(prose.some(holds)).toBe(true);
    });

    it('no longer limits the gates a plan may add to the stage gates', () => {
        expect(prose.join('\n')).not.toContain('Apart from those stage gates and their obligations, never invent');
    });
});

/**
 * SRV-2, row V4 (SRV rulings "测试行"): the secretary Skill says what happens after its answer: text written only in
 * the reply body, outside the submit tool, changes nothing; without an adoption receipt it never says "已改". Rendered
 * with the secretary's two submit tools granted, so a sentence gated on either tool renders too; each cell needs both
 * of its ruling fragments on one line. Mutation: the section deleted → both cells red.
 * Today (no SRV) both cells are red: `skill-platform-secretary.txt` has no such section; green once SRV-2 adds it.
 */
describe('SRV V4: the secretary Skill says what happens after its answer', () => {
    const lines = renderTemplate(PACK, 'skill-platform-secretary', {},
        ['submit_secretary_answer', 'submit_plan_round']).text.split('\n');
    it.each([
        { cell: 'text only in the reply body changes nothing', parts: ['正文', '不改目标'] },
        { cell: 'no "已改" without an adoption receipt', parts: ['采用回执', '已改'] },
    ])('carries the line: $cell', ({ parts }) => {
        expect(lines.some(line => parts.every(part => line.includes(part)))).toBe(true);
    });
});
