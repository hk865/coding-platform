/**
 * PC-1b group S, ruling 23: after `resources/skills/platform-*` is deleted, a
 * preparation that selects the platform root still prepares and starts — the
 * root is recognised by path and its Skill content comes from the frozen pack,
 * so nothing reads that directory any more.
 *
 * The base, the platform Skill template and every input template/string are
 * literals injected through the fixture's pack source. The whole expected
 * system prompt is hand-written from Kernel's documented section format, the
 * whole input is hand-written below, and the change after preparation proves
 * the old Skill is the one sent.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ResolvedPromptPackV1 } from '../../src/contracts/prompts/prompt-pack.js';
import { PLATFORM_SKILL_RESOURCE_ROOT } from '../../src/core/agent-runtime/platform-skill-root.js';
import { mutablePromptPacks, openPCQueryFixture, openPCWorkFixture, scriptedModel } from '../helpers/PC-platform-fixture.js';
import { DELIVERY_SET_TEXTS } from '../helpers/S7B-delivery-samples.js';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const WORK_BASE = 'PC_PLATFORM_ROOT_WORK_BASE';
const WORK_PRELUDE = 'PC_SEND_WORK_PRELUDE';
const WORK_SKILL = 'PC_PLATFORM_ROOT_WORK_SKILL';
const WORK_INSTRUCTION = 'PC_PLATFORM_ROOT_WORK_HOST_INSTRUCTION';
const QUERY_BASE = 'PC_PLATFORM_ROOT_QUERY_BASE';
const QUERY_PRELUDE = 'PC_SEND_QUERY_PRELUDE';
const QUERY_SKILL = 'PC_PLATFORM_ROOT_QUERY_SKILL';
const QUERY_INSTRUCTION = 'PC_PLATFORM_ROOT_QUERY_HOST_INSTRUCTION';

const WORK_INPUT_TEMPLATE = '{{prelude}}\n\n{{role}}{{goal}}{{task}}{{footprint}}{{notes}}{{reminders}}{{inputs}}{{continuation}}{{unknown_call_review}}';
const QUERY_PLANNING_TEMPLATE = '{{prelude}}\n\n{{role}}{{goal}}{{task}}{{footprint}}';
const PLAN_GUIDE = 'PC INITIAL PLAN GUIDE';

/** Every string the renderers read, with the hand-written literal as its value. */
const STRINGS: Readonly<Record<string, string>> = {
  'context.role.bindingHeading': 'context.role.bindingHeading',
  'context.role.binding': 'context.role.binding',
  'context.role.tools': 'context.role.tools',
  'context.role.writeScope': 'context.role.writeScope',
  'context.none': 'context.none',
  'context.role.specificationHeading': 'context.role.specificationHeading',
  'context.role.role': 'context.role.role',
  'context.role.label': 'context.role.label',
  'context.role.purpose': 'context.role.purpose',
  'context.role.responsibility': 'context.role.responsibility',
  'context.role.materials': 'context.role.materials',
  'context.role.outputs': 'context.role.outputs',
  'context.role.exitSuccess': 'context.role.exitSuccess',
  'context.role.exitStop': 'context.role.exitStop',
  'context.role.exitHandoff': 'context.role.exitHandoff',
  'context.role.duty': 'context.role.duty',
  'context.role.residentBytes': 'context.role.residentBytes',
  'context.goal.goal': 'context.goal.goal',
  'context.goal.objective': 'context.goal.objective',
  'context.goal.workspace': 'context.goal.workspace',
  'context.goal.autonomy': 'context.goal.autonomy',
  'context.goal.understanding': 'context.goal.understanding',
  'context.understanding.noCurrentGoalPrefix': 'context.understanding.noCurrentGoalPrefix',
  'context.understanding.noCurrentSuffix': 'context.understanding.noCurrentSuffix',
  'context.task.task': 'context.task.task',
  'context.task.instruction': 'context.task.instruction',
  'context.task.plan': 'context.task.plan',
  'context.task.workspace': 'context.task.workspace',
  'context.task.definitionPlan': 'context.task.definitionPlan',
  'context.task.stage': 'context.task.stage',
  'context.task.undeclared': 'context.task.undeclared',
  'context.task.module': 'context.task.module',
  'context.task.requirementLevel': 'context.task.requirementLevel',
  'context.task.disposition': 'context.task.disposition',
  'context.task.phase': 'context.task.phase',
  'context.task.obligations': 'context.task.obligations',
  'context.task.undefined': 'context.task.undefined',
  'context.task.acceptance': 'context.task.acceptance',
  'context.task.upstream': 'context.task.upstream',
  'context.task.null': 'context.task.null',
  'context.task.downstream': 'context.task.downstream',
  'context.task.failure': 'context.task.failure',
  'context.prelude.work': WORK_PRELUDE,
  'context.section.role': 'PC-ROLE',
  'context.section.goal': 'PC-GOAL',
  'context.section.task': 'PC-TASK',
  'context.section.footprint': 'PC-FOOTPRINT',
  'context.section.notes': 'PC-NOTES',
  'context.section.reminders': 'PC-REMINDERS',
  'context.section.inputs': 'PC-INPUTS',
  'context.omissions.prefix': 'context.omissions.prefix',
  'context.omissions.suffix': 'context.omissions.suffix',
  'context.questionHeading': 'PC-QUESTION',
  'context.prelude.query': QUERY_PRELUDE,
};

/** The literal pack: every text below is hand-written in this file. */
function literalPack(base: string, skill: string): ResolvedPromptPackV1 {
  const templates: Record<string, string> = {
    base,
    'work-input': WORK_INPUT_TEMPLATE,
    'query-planning-input': QUERY_PLANNING_TEMPLATE,
    'initial-planning-answer': PLAN_GUIDE,
    'skill-platform-work': skill,
    ...DELIVERY_SET_TEXTS,
  };
  const ids = Object.keys(templates);
  return {
    manifest: { schemaVersion: 1, packId: 'platform', extends: null,
      templates: Object.fromEntries(ids.map(id => [id, { file: `${id}.md`, version: 1, mentionsTools: [] }])),
      strings: 'strings.json', tools: {} },
    templates, strings: { ...STRINGS }, tools: {},
    origins: Object.fromEntries(ids.map(id => [id, { packId: 'platform', version: 1, mentionsTools: [] }])),
    toolOrigins: {},
  };
}

/** The complete Work input, hand-written from the literal pack and the fixture's facts. */
const WORK_INPUT = 'PC_SEND_WORK_PRELUDE\n\nPC-ROLE\ncontext.role.bindingHeading\ncontext.role.binding{"policyRevision":"legacy-template","tools":["read"],"writeScope":[]}\ncontext.role.toolsread\ncontext.role.writeScopecontext.none\n\ncontext.role.specificationHeading\ncontext.role.rolebuilder@1\ncontext.role.labelWP2 platform role\ncontext.role.purposeWP2_PLATFORM_DUTY_PIN\ncontext.role.responsibilityhuman_decision_support\ncontext.role.materialscontract (Read the assigned Plan/Task)\ncontext.role.outputsanswer-with-sources (Report the actual result)\ncontext.role.exitSuccessReport result\ncontext.role.exitStopStop on missing permission\ncontext.role.exitHandoffKeep references\n\ncontext.role.dutysecretary\n\ncontext.role.residentBytes4096\n\nPC-GOAL\ncontext.goal.goalr4c-claim-goal\ncontext.goal.objectiveExercise the atomic claim skeleton\ncontext.goal.workspacer4c-claim-workspace@1\ncontext.goal.autonomyafter_plan_confirmation\ncontext.goal.understandingcontext.understanding.noCurrentGoalPrefixr4c-claim-goalcontext.understanding.noCurrentSuffix\n\nPC-TASK\ncontext.task.taskImplement A (implement-a)\ncontext.task.instructionImplement A\ncontext.task.planr4c-claim-plan\ncontext.task.workspacer4c-claim-workspace@1\ncontext.task.definitionPlanr4c-claim-plan@1\ncontext.task.stagecontext.task.undeclared\ncontext.task.modulecontext.task.undeclared\ncontext.task.requirementLevelrequired\ncontext.task.dispositionactive\ncontext.task.phaserunning\ncontext.task.obligations[{"obligationId":"obligation-1","requirementLevel":"required","taskIds":["implement-a","implement-b","gate-goal"],"title":"Deliver implementation","verificationRequirements":[{"description":"Tests pass","kind":"test","requirementId":"check-1","requirementLevel":"required"}]}]\ncontext.task.acceptance[{"description":"Tests pass","kind":"test","requirementId":"check-1","requirementLevel":"required"}]\ncontext.task.upstreamcontext.task.null\ncontext.task.downstream[{"dependsOnId":"implement-a","requires":{"kind":"output-contract","label":"A output contract"},"taskId":"implement-b"}]\ncontext.task.failure\n\nPC-REMINDERS\n';

/** The complete Query planning input, hand-written from the same literal pack. */
const QUERY_INPUT = 'PC_SEND_QUERY_PRELUDE\n\nPC-ROLE\ncontext.role.bindingHeading\ncontext.role.binding{"policyRevision":"rl-query-host@1","tools":["read"],"writeScope":[]}\ncontext.role.toolsread\ncontext.role.writeScopecontext.none\n\ncontext.role.specificationHeading\ncontext.role.roleadvisor (absent)\nthe project has no active coordination policy, so there is no role matrix\ncontext.role.label\ncontext.role.purpose\ncontext.role.responsibilityexecution\n\ncontext.role.dutyexecutor\n\ncontext.role.residentBytes4096\n\nPC-GOAL\ncontext.goal.goalrl-query-goal\ncontext.goal.objectiveAnswer one RL reading question\ncontext.goal.workspacerl-query-workspace@1\ncontext.goal.autonomyafter_plan_confirmation\ncontext.goal.understandingcontext.understanding.noCurrentGoalPrefixrl-query-goalcontext.understanding.noCurrentSuffix\nPC-QUESTION\nRead the workspace and answer\n\nPC INITIAL PLAN GUIDE';

function expectedSystem(base: string, instruction: string, skill: string): string {
  const source = `skill:platform-work@sha256:${sha(skill)}`;
  return `${base}\n\n${instruction}\n\n[skill_instruction id="platform-work" source=${JSON.stringify(source)}]\n${skill}`;
}

describe('ruling 23: the platform Skill directory is gone and never read', () => {
  it('Work prepare+start sends the pack Skill from the platform root and keeps the old one', async () => {
    expect(existsSync(join(PLATFORM_SKILL_RESOURCE_ROOT, 'platform-work'))).toBe(false);
    const pack = literalPack(WORK_BASE, WORK_SKILL);
    const packs = await mutablePromptPacks(pack);
    const fixture = await openPCWorkFixture({
      skills: { resourceRoot: PLATFORM_SKILL_RESOURCE_ROOT, enabledIds: ['platform-work'] },
      systemInstruction: WORK_INSTRUCTION,
      promptPacks: packs,
      model: scriptedModel([{ text: 'PC platform root Work answer' }]),
    });
    try {
      await fixture.work.prepare();
      packs.replace({
        ...pack,
        templates: { ...pack.templates, 'skill-platform-work': 'PC_PLATFORM_ROOT_CHANGED_SKILL' },
      });
      await fixture.work.start();
      expect(fixture.model.calls()).toBe(1);
      const request = fixture.model.requests[0]!;
      expect(request.systemPrompt).toBe(expectedSystem(WORK_BASE, WORK_INSTRUCTION, WORK_SKILL));
      expect(request.systemPrompt).toContain(WORK_SKILL);
      expect(request.systemPrompt).not.toContain('PC_PLATFORM_ROOT_CHANGED_SKILL');
      expect(request.messages.map(message => ('content' in message ? message.content : undefined))).toEqual([WORK_INPUT]);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it('Query prepare+start sends the pack Skill from the platform root and keeps the old one', async () => {
    const pack = literalPack(QUERY_BASE, QUERY_SKILL);
    const packs = await mutablePromptPacks(pack);
    const fixture = await openPCQueryFixture({
      skills: { resourceRoot: PLATFORM_SKILL_RESOURCE_ROOT, enabledIds: ['platform-work'] },
      systemInstruction: QUERY_INSTRUCTION,
      promptPacks: packs,
      model: scriptedModel([{ text: 'PC platform root Query answer' }]),
    });
    try {
      await fixture.prepare();
      packs.replace({
        ...pack,
        templates: { ...pack.templates, 'skill-platform-work': 'PC_PLATFORM_ROOT_CHANGED_SKILL' },
      });
      await fixture.start();
      expect(fixture.model.calls()).toBe(1);
      const request = fixture.model.requests[0]!;
      expect(request.systemPrompt).toBe(expectedSystem(QUERY_BASE, QUERY_INSTRUCTION, QUERY_SKILL));
      expect(request.systemPrompt).toContain(QUERY_SKILL);
      expect(request.systemPrompt).not.toContain('PC_PLATFORM_ROOT_CHANGED_SKILL');
      expect(request.messages.map(message => ('content' in message ? message.content : undefined))).toEqual([QUERY_INPUT]);
    } finally {
      await fixture.close();
    }
  }, 60_000);
});
