/**
 * PC-1b joint step, J-01 and J-02 (PC-06, book §5.2 lines 678-682).
 *
 * J-01 injects a literal prompt pack (templates, a 54-key string table and the
 * base) and the real custom Skill directory. Preparation freezes them; after it
 * the pack changes a real section label (`context.section.goal`) and the base,
 * and the Skill file is rewritten. The model request must still carry the
 * hand-written frozen system and input, the old Skill must still be present,
 * and every frozen text (templates, strings, base, Skill) must hash to the
 * SHA-256 of its hand-written literal.
 *
 * J-02 reaches a continuation and a K3 review through the frozen fixture's
 * public steps, changes a string the entry's re-render actually uses after
 * preparation, and checks the entry passes and the model receives the frozen
 * literal content, never the changed one.
 *
 * No expected value is read from production: the only reads are public
 * transitions, the public record read and the model requests.
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { ResolvedPromptPackV1 } from '../../src/contracts/prompts/prompt-pack.js';
import type { PromptSetV1 } from '../../src/contracts/prompts/prompt-set.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import {
  mutablePromptPacks, openPCK3ReviewFixture, openPCQueryFixture, openPCWorkFixture, scriptedModel,
} from '../helpers/PC-platform-fixture.js';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const SKILL_ID = 'pc-custom';
const FROZEN_SKILL = 'PC_CUSTOM_SKILL_V1';
const CHANGED_SKILL = 'PC_CHANGED_SKILL';
const SKILL_SOURCE = `skill:${SKILL_ID}@sha256:${sha(FROZEN_SKILL)}`;

const WORK_BASE = 'PC_WORK_BASE';
const QUERY_BASE = 'PC_QUERY_BASE';
const GOAL_LABEL = 'PC-GOAL';
const CHANGED_GOAL_LABEL = 'PC-CHANGED-GOAL';
const WORK_INPUT_TEMPLATE = '{{prelude}}\n\n{{role}}{{goal}}{{task}}{{footprint}}{{notes}}{{reminders}}{{inputs}}{{continuation}}{{unknown_call_review}}';
const QUERY_PLANNING_TEMPLATE = '{{prelude}}\n\n{{role}}{{goal}}{{task}}{{footprint}}';
const PLAN_GUIDE = 'PC INITIAL PLAN GUIDE';

const STRINGS: Readonly<Record<string, string>> = {
  "context.role.bindingHeading": "context.role.bindingHeading",
  "context.role.binding": "context.role.binding",
  "context.role.tools": "context.role.tools",
  "context.role.writeScope": "context.role.writeScope",
  "context.none": "context.none",
  "context.role.specificationHeading": "context.role.specificationHeading",
  "context.role.role": "context.role.role",
  "context.role.label": "context.role.label",
  "context.role.purpose": "context.role.purpose",
  "context.role.responsibility": "context.role.responsibility",
  "context.role.materials": "context.role.materials",
  "context.role.outputs": "context.role.outputs",
  "context.role.exitSuccess": "context.role.exitSuccess",
  "context.role.exitStop": "context.role.exitStop",
  "context.role.exitHandoff": "context.role.exitHandoff",
  "context.role.duty": "context.role.duty",
  "context.role.residentBytes": "context.role.residentBytes",
  "context.goal.goal": "context.goal.goal",
  "context.goal.objective": "context.goal.objective",
  "context.goal.workspace": "context.goal.workspace",
  "context.goal.autonomy": "context.goal.autonomy",
  "context.goal.understanding": "context.goal.understanding",
  "context.understanding.noCurrentGoalPrefix": "context.understanding.noCurrentGoalPrefix",
  "context.understanding.noCurrentSuffix": "context.understanding.noCurrentSuffix",
  "context.task.task": "context.task.task",
  "context.task.instruction": "context.task.instruction",
  "context.task.plan": "context.task.plan",
  "context.task.workspace": "context.task.workspace",
  "context.task.definitionPlan": "context.task.definitionPlan",
  "context.task.stage": "context.task.stage",
  "context.task.undeclared": "context.task.undeclared",
  "context.task.module": "context.task.module",
  "context.task.requirementLevel": "context.task.requirementLevel",
  "context.task.disposition": "context.task.disposition",
  "context.task.phase": "context.task.phase",
  "context.task.obligations": "context.task.obligations",
  "context.task.undefined": "context.task.undefined",
  "context.task.acceptance": "context.task.acceptance",
  "context.task.upstream": "context.task.upstream",
  "context.task.null": "context.task.null",
  "context.task.downstream": "context.task.downstream",
  "context.task.failure": "context.task.failure",
  "context.prelude.work": "PC WORK PRELUDE",
  "context.section.role": "PC-ROLE",
  "context.section.goal": "PC-GOAL",
  "context.section.task": "PC-TASK",
  "context.section.footprint": "PC-FOOTPRINT",
  "context.section.notes": "PC-NOTES",
  "context.section.reminders": "PC-REMINDERS",
  "context.section.inputs": "PC-INPUTS",
  "context.omissions.prefix": "context.omissions.prefix",
  "context.omissions.suffix": "context.omissions.suffix",
  "context.questionHeading": "PC-QUESTION",
  "context.prelude.query": "PC QUERY PRELUDE",
};

const WORK_INPUT = "PC WORK PRELUDE\n\nPC-ROLE\ncontext.role.bindingHeading\ncontext.role.binding{\"policyRevision\":\"legacy-template\",\"tools\":[\"read\"],\"writeScope\":[]}\ncontext.role.toolsread\ncontext.role.writeScopecontext.none\n\ncontext.role.specificationHeading\ncontext.role.rolebuilder@1\ncontext.role.labelWP2 platform role\ncontext.role.purposeWP2_PLATFORM_DUTY_PIN\ncontext.role.responsibilityhuman_decision_support\ncontext.role.materialscontract (Read the assigned Plan/Task)\ncontext.role.outputsanswer-with-sources (Report the actual result)\ncontext.role.exitSuccessReport result\ncontext.role.exitStopStop on missing permission\ncontext.role.exitHandoffKeep references\n\ncontext.role.dutysecretary\n\ncontext.role.residentBytes4096\n\nPC-GOAL\ncontext.goal.goalr4c-claim-goal\ncontext.goal.objectiveExercise the atomic claim skeleton\ncontext.goal.workspacer4c-claim-workspace@1\ncontext.goal.autonomyafter_plan_confirmation\ncontext.goal.understandingcontext.understanding.noCurrentGoalPrefixr4c-claim-goalcontext.understanding.noCurrentSuffix\n\nPC-TASK\ncontext.task.taskImplement A (implement-a)\ncontext.task.instructionImplement A\ncontext.task.planr4c-claim-plan\ncontext.task.workspacer4c-claim-workspace@1\ncontext.task.definitionPlanr4c-claim-plan@1\ncontext.task.stagecontext.task.undeclared\ncontext.task.modulecontext.task.undeclared\ncontext.task.requirementLevelrequired\ncontext.task.dispositionactive\ncontext.task.phaserunning\ncontext.task.obligations[{\"obligationId\":\"obligation-1\",\"requirementLevel\":\"required\",\"taskIds\":[\"implement-a\",\"implement-b\",\"gate-goal\"],\"title\":\"Deliver implementation\",\"verificationRequirements\":[{\"description\":\"Tests pass\",\"kind\":\"test\",\"requirementId\":\"check-1\",\"requirementLevel\":\"required\"}]}]\ncontext.task.acceptance[{\"description\":\"Tests pass\",\"kind\":\"test\",\"requirementId\":\"check-1\",\"requirementLevel\":\"required\"}]\ncontext.task.upstreamcontext.task.null\ncontext.task.downstream[{\"dependsOnId\":\"implement-a\",\"requires\":{\"kind\":\"output-contract\",\"label\":\"A output contract\"},\"taskId\":\"implement-b\"}]\ncontext.task.failure\n\nPC-REMINDERS\n\n{\"key\":\"decision:not_available:message_release\",\"node\":{\"kind\":\"goal\",\"ref\":{\"aggregateType\":\"Goal\",\"goalId\":\"r4c-claim-goal\",\"projectId\":\"r4c-claim-project\"}},\"sources\":[],\"text\":\"待决来源尚未接入：message_release\"}";
const QUERY_INPUT = "PC QUERY PRELUDE\n\nPC-ROLE\ncontext.role.bindingHeading\ncontext.role.binding{\"policyRevision\":\"rl-query-host@1\",\"tools\":[\"read\"],\"writeScope\":[]}\ncontext.role.toolsread\ncontext.role.writeScopecontext.none\n\ncontext.role.specificationHeading\ncontext.role.roleadvisor (absent)\nthe project has no active coordination policy, so there is no role matrix\ncontext.role.label\ncontext.role.purpose\ncontext.role.responsibilityexecution\n\ncontext.role.dutyexecutor\n\ncontext.role.residentBytes4096\n\nPC-GOAL\ncontext.goal.goalrl-query-goal\ncontext.goal.objectiveAnswer one RL reading question\ncontext.goal.workspacerl-query-workspace@1\ncontext.goal.autonomyafter_plan_confirmation\ncontext.goal.understandingcontext.understanding.noCurrentGoalPrefixrl-query-goalcontext.understanding.noCurrentSuffix\nPC-QUESTION\nRead the workspace and answer\n\nPC INITIAL PLAN GUIDE";

const WORK_SYSTEM = WORK_BASE + '\n\n' + skillSection(SKILL_ID, FROZEN_SKILL);
const QUERY_SYSTEM = QUERY_BASE + '\n\n' + skillSection(SKILL_ID, FROZEN_SKILL);

/** The literal Kernel section shape: base, then each instruction Skill. */
function skillSection(id: string, content: string): string {
  return `[skill_instruction id=${JSON.stringify(id)} source=${JSON.stringify(`skill:${id}@sha256:${sha(content)}`)}]\n${content}`;
}

/** The literal pack: every text below is hand-written in this file. */
function literalPack(base: string): ResolvedPromptPackV1 {
  const templates: Record<string, string> = {
    base,
    'work-input': WORK_INPUT_TEMPLATE,
    'query-planning-input': QUERY_PLANNING_TEMPLATE,
    'initial-planning-answer': PLAN_GUIDE,
  };
  const ids = Object.keys(templates);
  return {
    manifest: { schemaVersion: 1, packId: 'platform', extends: null,
      templates: Object.fromEntries(ids.map(id => [id, { file: `${id}.md`, version: 1, mentionsTools: [] }])),
      strings: 'strings.json', tools: {} },
    templates, strings: { ...STRINGS }, tools: {},
    origins: Object.fromEntries(ids.map(id => [id, { packId: 'platform', version: 1 }])),
  };
}

/** Every frozen text the set names, with its hand-written literal and digest. */
function expectFrozenTexts(
  set: PromptSetV1,
  texts: Record<string, string>,
  templates: readonly { id: string; text: string }[],
  base: string,
): void {
  expect(set.templates.map(template => template.id)).toEqual(templates.map(template => template.id));
  for (const [index, entry] of set.templates.entries()) {
    const literal = templates[index]!.text;
    expect(entry.digest).toBe(sha(literal));
    expect(texts[entry.digest]).toBe(literal);
  }
  const stringsText = JSON.stringify(STRINGS);
  expect(set.strings.digest).toBe(sha(stringsText));
  expect(texts[set.strings.digest]).toBe(stringsText);
  expect(set.base.digest).toBe(sha(base));
  expect(texts[set.base.digest]).toBe(base);
  expect(set.skills).toHaveLength(1);
  expect(set.skills[0]).toMatchObject({
    schemaVersion: 1, id: SKILL_ID, title: 'PC custom skill', kind: 'instruction',
    priority: 10, source: SKILL_SOURCE, digest: sha(FROZEN_SKILL),
  });
  expect(texts[set.skills[0]!.digest]).toBe(FROZEN_SKILL);
}

const USER_MESSAGE = (content: string) =>
  ({ role: 'user', messageId: expect.any(String), content });

describe('J-01 PC-06 joint: the frozen Work system and input survive a changed pack and Skill', () => {
  it('sends the hand-written frozen system and input, keeps the old Skill and hashes every text', async () => {
    const packs = await mutablePromptPacks(literalPack(WORK_BASE));
    const fixture = await openPCWorkFixture({
      model: scriptedModel([{ text: 'PC joint frozen Work answer' }]),
      systemInstruction: null, promptPacks: packs,
      selection: { modelId: 'pc-joint-freeze-model', promptPack: 'platform', reasoningReplay: 'none' },
    });
    try {
      await fixture.work.prepare();
      // After preparation: a real section label, the base and the Skill file change.
      packs.change({ base: 'PC_CHANGED_WORK_BASE', strings: { 'context.section.goal': CHANGED_GOAL_LABEL } });
      await fixture.skill.rewrite(CHANGED_SKILL);
      expect(packs.snapshot().strings['context.section.goal']).toBe(CHANGED_GOAL_LABEL);

      expect((await fixture.work.start()).status).toBe('ready');
      const request = fixture.model.requests[0]!;
      expect(request.systemPrompt).toBe(WORK_SYSTEM);
      expect(request.systemPrompt).toContain(FROZEN_SKILL);
      expect(request.systemPrompt).not.toContain(CHANGED_SKILL);
      expect(request.systemPrompt).not.toContain(CHANGED_GOAL_LABEL);
      expect(request.messages).toHaveLength(1);
      expect(request.messages[0]).toMatchObject(USER_MESSAGE(WORK_INPUT));
      expect(JSON.stringify(request.messages)).toContain(GOAL_LABEL);
      expect(JSON.stringify(request.messages)).not.toContain(CHANGED_GOAL_LABEL);

      const read = await fixture.work.readPromptRecord();
      expect(read.status, JSON.stringify(read)).toBe('ready');
      if (read.status !== 'ready') return;
      expectFrozenTexts(read.value.set, read.value.texts, [
        { id: 'work-input', text: WORK_INPUT_TEMPLATE }, { id: 'base', text: WORK_BASE },
      ], WORK_BASE);
    } finally {
      await fixture.close();
    }
  }, 60_000);
});

describe('J-01 PC-06 joint: the frozen Query system and input survive a changed pack and Skill', () => {
  it('sends the hand-written frozen system and input, keeps the old Skill and hashes every text', async () => {
    const packs = await mutablePromptPacks(literalPack(QUERY_BASE));
    const fixture = await openPCQueryFixture({
      model: scriptedModel([{ text: 'PC joint frozen Query answer' }]),
      systemInstruction: null, promptPacks: packs,
      selection: { modelId: 'pc-joint-query-freeze', promptPack: 'platform', reasoningReplay: 'none' },
    });
    try {
      await fixture.prepare();
      packs.change({ base: 'PC_CHANGED_QUERY_BASE', strings: { 'context.section.goal': CHANGED_GOAL_LABEL } });
      await fixture.skill.rewrite(CHANGED_SKILL);
      expect(packs.snapshot().strings['context.section.goal']).toBe(CHANGED_GOAL_LABEL);

      expect((await fixture.start()).status).toBe('ready');
      const request = fixture.model.requests[0]!;
      expect(request.systemPrompt).toBe(QUERY_SYSTEM);
      expect(request.systemPrompt).toContain(FROZEN_SKILL);
      expect(request.systemPrompt).not.toContain(CHANGED_SKILL);
      expect(request.systemPrompt).not.toContain(CHANGED_GOAL_LABEL);
      expect(request.messages).toHaveLength(1);
      expect(request.messages[0]).toMatchObject(USER_MESSAGE(QUERY_INPUT));
      expect(JSON.stringify(request.messages)).toContain(GOAL_LABEL);
      expect(JSON.stringify(request.messages)).not.toContain(CHANGED_GOAL_LABEL);

      const read = await fixture.readPromptRecord();
      expect(read.status, JSON.stringify(read)).toBe('ready');
      if (read.status !== 'ready') return;
      expectFrozenTexts(read.value.set, read.value.texts, [
        { id: 'initial-planning-answer', text: PLAN_GUIDE },
        { id: 'query-planning-input', text: QUERY_PLANNING_TEMPLATE },
        { id: 'base', text: QUERY_BASE },
      ], QUERY_BASE);
    } finally {
      await fixture.close();
    }
  }, 60_000);
});

// §5.1's stand-in `shell`, hoisted per test file (the fixture's real blocked Kernel
// call and the review round both need the same seam the K3 tests use).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;
afterEach(() => shellSeam.release());

const FROZEN_BRIEF_LEAD = 'PC-FROZEN-BRIEF-LEAD';
const CHANGED_BRIEF_LEAD = 'PC-CHANGED-BRIEF-LEAD';
const FROZEN_REVIEW_LEAD = 'PC-FROZEN-REVIEW-LEAD';
const CHANGED_REVIEW_LEAD = 'PC-CHANGED-REVIEW-LEAD';

function userText(fixture: { model: { lastRequest(): { messages: readonly { role: string; content?: string }[] } | undefined } }): string {
  return (fixture.model.lastRequest()?.messages ?? [])
    .map(message => message.role === 'user' ? message.content ?? '' : '').join('\n');
}

describe('J-02 PC-06 joint: the entry re-renders from the frozen strings, not the changed pack', () => {
  it('a continuation entry admits and the model receives the hand-written frozen brief lead', async () => {
    const fixture = await openPCWorkFixture({
      model: scriptedModel([
        { beforeReply: async () => { throw new Error('PC base crash'); } },
        { text: 'PC joint continuation answer' },
      ]),
    });
    try {
      await fixture.work.prepare();
      expect((await fixture.work.start()).status).toBe('ready');
      const continuation = await fixture.continuation();
      fixture.packs.change({ strings: { 'brief.summary.lead': FROZEN_BRIEF_LEAD } });
      await continuation.prepare();

      fixture.packs.change({ strings: { 'brief.summary.lead': CHANGED_BRIEF_LEAD } });
      const started = await continuation.start();
      expect(started.status, JSON.stringify(started)).toBe('ready');
      expect(userText(fixture)).toContain(FROZEN_BRIEF_LEAD);
      expect(userText(fixture)).not.toContain(CHANGED_BRIEF_LEAD);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it('a K3 review entry admits and the model receives the hand-written frozen status lead', async () => {
    const fixture = await openPCK3ReviewFixture({
      model: scriptedModel([{ text: 'PC joint review answer' }]),
    });
    try {
      fixture.packs.change({ strings: { 'k3.workspace.statusLead': FROZEN_REVIEW_LEAD } });
      await fixture.work.prepare();

      fixture.packs.change({ strings: { 'k3.workspace.statusLead': CHANGED_REVIEW_LEAD } });
      const started = await fixture.work.start();
      expect(started.status, JSON.stringify(started)).toBe('ready');
      expect(userText(fixture)).toContain(FROZEN_REVIEW_LEAD);
      expect(userText(fixture)).not.toContain(CHANGED_REVIEW_LEAD);
    } finally {
      await fixture.close();
    }
  }, 60_000);
});
