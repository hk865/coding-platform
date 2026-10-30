/**
 * PC-2 joint step: PC-03 (a child pack overrides only `base`, the frozen set
 * names every used template's source pack and version) and PC-06/PC-08's
 * person half (a person's pack changes after preparation; the prepared run is
 * unchanged and a new preparation uses the new text). The PC-05 /
 * PC-06/PC-08 model half lives beside the real Host settings routes, in
 * tests/app/PC2-joint-routes-prepare.test.ts.
 *
 * Every world comes from the frozen platform fixture's public steps. Expected
 * texts and versions are hand-written literals; the small packs below only
 * supply input.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ResolvedPromptPackV1 } from '../../src/contracts/prompts/prompt-pack.js';
import type { PromptPackSourcePort } from '../../src/contracts/prompts/prompt-pack.js';
import { openPCWorkFixture, scriptedModel } from '../helpers/PC-platform-fixture.js';
import { pc2PackCases, pc2PackEntry, pc2ResolvedSource } from '../helpers/PC2-pack-fixture.js';
import { DELIVERY_SET_IDS } from '../helpers/S7B-delivery-samples.js';

const NO_SKILLS = { resourceRoot: '/nonexistent/pc2-joint', enabledIds: [] as string[] };
const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** The current task input: the last message, which must be the user turn. */
function lastUserContent(messages: readonly { role: string; content?: string }[]): string {
  const last = messages.at(-1);
  if (last === undefined || last.role !== 'user' || typeof last.content !== 'string') {
    throw new Error(`the last message is not a user input: ${JSON.stringify(last)}`);
  }
  return last.content;
}

/** Two resolved packs behind one source: the pack id selects it, never the current state. */
function packSource(...packs: readonly ResolvedPromptPackV1[]): PromptPackSourcePort {
  const byId = new Map(packs.map(pack => [pack.manifest.packId, pack]));
  return {
    async resolve(packId, signal) {
      signal.throwIfAborted();
      const pack = byId.get(packId);
      return pack === undefined
        ? { status: 'rejected', code: 'invalid', reason: `prompt pack ${packId} is not available` }
        : { status: 'ready', value: structuredClone(pack) };
    },
  };
}

async function resolved(pack: ReturnType<typeof pc2PackEntry>): Promise<ResolvedPromptPackV1> {
  return (await pc2ResolvedSource([pack])).snapshot();
}

describe('PC-03 a child pack overriding only base keeps every other platform template', () => {
  it('names each used template\'s source pack and literal version in the frozen set', async () => {
    const cases = pc2PackCases();
    const source = await pc2ResolvedSource([cases.child, cases.parent]);
    const fixture = await openPCWorkFixture({
      promptPacks: source,
      selection: { promptPack: 'pc2-child' },
      systemInstruction: null,
      skills: NO_SKILLS,
      model: scriptedModel([{ text: 'PC-03 answer' }]),
    });
    try {
      await fixture.work.prepare();
      const started = await fixture.work.start();
      expect(started.status, JSON.stringify(started)).toBe('ready');
      // The public sent fact: the child's base version 8 is the system prompt.
      expect(fixture.model.requests[0]!.systemPrompt).toBe('CHILD');
      const record = await fixture.work.readPromptRecord();
      expect(record.status).toBe('ready');
      if (record.status !== 'ready') throw new Error('PC-03 readPromptRecord failed');
      const set = record.value.set;
      expect(set.packId).toBe('pc2-child');
      expect(set.base).toMatchObject({ templateId: 'base', version: 8 });
      // The frozen set names each used template's supplier and literal version, then the delivery set's.
      expect(set.templates.map(entry => ({ id: entry.id, version: entry.version, packId: entry.packId })))
        .toEqual([
          { id: 'work-input', version: 2, packId: 'platform' },
          { id: 'base', version: 8, packId: 'pc2-child' },
          ...DELIVERY_SET_IDS.map(id => ({ id, version: 1, packId: 'platform' })),
        ]);
      // The whole used template is the platform's text, not the child's.
      const workInput = set.templates.find(entry => entry.id === 'work-input');
      if (workInput === undefined) throw new Error('PC-03 the set has no work-input template');
      expect(record.value.texts[workInput.digest])
        .toBe('{{prelude}}\n\n{{role}}{{goal}}{{task}}{{footprint}}{{notes}}{{inputs}}{{continuation}}{{unknown_call_review}}{{reminders}}');
    } finally {
      await fixture.close();
    }
  }, 60_000);
});

const OLD_TASK_INPUT = `# Verified runtime task input

This is the current task context assembled from formal platform facts; it is not a transcript.

## Runtime context
## Runtime binding
roleBinding: {"policyRevision":"legacy-template","tools":["read"],"writeScope":[]}
tools: read
writeScope: (none)

## Role specification
role: builder@1
label: WP2 platform role
purpose: WP2_PLATFORM_DUTY_PIN
responsibility: human_decision_support
required materials: contract (Read the assigned Plan/Task)
required outputs: answer-with-sources (Report the actual result)
exit success: Report result
exit stop: Stop on missing permission
exit handoff: Keep references

duty: secretary

contextResidentBytes: 4096

## Goal
goal: r4c-claim-goal
objective: Exercise the atomic claim skeleton
workspace: r4c-claim-workspace@1
autonomy: after_plan_confirmation
current understanding: 目标 r4c-claim-goal：还没有当前理解

## Accepted task
task: Implement A (implement-a)
instruction: Implement A
plan: r4c-claim-plan
workspace: r4c-claim-workspace@1
definitionPlan: r4c-claim-plan@1
stage: (未声明)
module: (未声明)
requirementLevel: required
disposition: active
phase: running
obligations: [{"obligationId":"obligation-1","requirementLevel":"required","taskIds":["implement-a","implement-b","gate-goal"],"title":"Deliver implementation","verificationRequirements":[{"description":"Tests pass","kind":"test","requirementId":"check-1","requirementLevel":"required"}]}]
acceptance: [{"description":"Tests pass","kind":"test","requirementId":"check-1","requirementLevel":"required"}]
upstream: null
downstream: [{"dependsOnId":"implement-a","requires":{"kind":"output-contract","label":"A output contract"},"taskId":"implement-b"}]
failure: null

## Reminders
还没有观测`;
// The one hand-written difference the changed string table makes to the input.
const NEW_TASK_INPUT = OLD_TASK_INPUT.replace(
  'label: WP2 platform role', 'CHANGED ROLEWP2 platform role',
);
const WORK_INPUT = '{{prelude}}\n\n{{role}}{{goal}}{{task}}{{footprint}}{{notes}}{{inputs}}'
  + '{{continuation}}{{unknown_call_review}}{{reminders}}';

describe('PC-06/PC-08 a person\'s pack changes after preparation', () => {
  it('freezes the whole old task input and sends the whole new one after a new preparation', async () => {
    const pack = pc2PackEntry('pc2-person-change', { templates: { base: 'PC2_PERSON_BASE' } });
    const source = await pc2ResolvedSource([pack]);
    const selection = { modelId: 'pc2-person-model', promptPack: pack.packId };
    const first = await openPCWorkFixture({
      promptPacks: source,
      selection,
      systemInstruction: null,
      skills: NO_SKILLS,
      model: scriptedModel([
        { beforeReply: async () => { throw new Error('PC-06 person first run ended'); } },
        { text: 'PC-06 person continuation answer' },
      ]),
    });
    try {
      await first.work.prepare();

      // The person edits base and a string-table label after preparation.
      source.change({ base: 'PC2_CHANGED_BASE', strings: { 'context.role.label': 'CHANGED ROLE' } });

      const started = await first.work.start();
      expect(started.status, JSON.stringify(started)).toBe('ready');
      if (started.status !== 'ready') throw new Error('PC-06 first start failed');
      expect(first.model.requests[0]!.systemPrompt).toBe('PC2_PERSON_BASE');
      // The whole current task input is the frozen old text.
      expect(lastUserContent(first.model.requests[0]!.messages)).toBe(OLD_TASK_INPUT);
      // The Run's recorded input digest is the SHA-256 of that hand-written text.
      expect(started.value.run.inputBinding?.inputDigest).toBe(sha(OLD_TASK_INPUT));

      const oldRecord = await first.work.readPromptRecord();
      expect(oldRecord.status).toBe('ready');
      if (oldRecord.status !== 'ready') throw new Error('PC-06 old readPromptRecord failed');
      const oldSet = oldRecord.value.set;
      expect(oldRecord.value.texts[oldSet.base.digest]).toBe('PC2_PERSON_BASE');
      expect(oldSet.base.digest).toBe(sha('PC2_PERSON_BASE'));
      const oldWorkInput = oldSet.templates.find(entry => entry.id === 'work-input');
      if (oldWorkInput === undefined) throw new Error('PC-06 old record has no work-input template');
      expect(oldRecord.value.texts[oldWorkInput.digest]).toBe(WORK_INPUT);
      expect(oldWorkInput.digest).toBe(sha(WORK_INPUT));

      // The continuation keeps the previous whole input as history and sends the
      // changed label; its brief digest is production-derived, so only the frozen
      // base and the changed label are compared here.
      const continuation = await first.continuation();
      await continuation.prepare();
      const secondStart = await continuation.start();
      expect(secondStart.status, JSON.stringify(secondStart)).toBe('ready');
      expect(first.model.requests[1]!.systemPrompt).toBe('PC2_CHANGED_BASE');
      expect(lastUserContent(first.model.requests[1]!.messages)).toContain('CHANGED ROLEWP2 platform role');
      const changedRecord = await continuation.readPromptRecord();
      expect(changedRecord.status).toBe('ready');
      if (changedRecord.status !== 'ready') throw new Error('PC-06 new readPromptRecord failed');
      const changedSet = changedRecord.value.set;
      expect(changedRecord.value.texts[changedSet.base.digest]).toBe('PC2_CHANGED_BASE');
      expect(changedSet.base.digest).toBe(sha('PC2_CHANGED_BASE'));
    } finally {
      await first.close();
    }

    // A wholly new preparation after the change sends the whole new task input.
    const second = await openPCWorkFixture({
      promptPacks: source,
      selection,
      systemInstruction: null,
      skills: NO_SKILLS,
      model: scriptedModel([{ text: 'PC-06 person new preparation answer' }]),
    });
    try {
      await second.work.prepare();
      const newStart = await second.work.start();
      expect(newStart.status, JSON.stringify(newStart)).toBe('ready');
      if (newStart.status !== 'ready') throw new Error('PC-06 new start failed');
      expect(second.model.requests[0]!.systemPrompt).toBe('PC2_CHANGED_BASE');
      expect(lastUserContent(second.model.requests[0]!.messages)).toBe(NEW_TASK_INPUT);
      expect(newStart.value.run.inputBinding?.inputDigest).toBe(sha(NEW_TASK_INPUT));

      const newRecord = await second.work.readPromptRecord();
      expect(newRecord.status).toBe('ready');
      if (newRecord.status !== 'ready') throw new Error('PC-06 new preparation record failed');
      const newSet = newRecord.value.set;
      expect(newRecord.value.texts[newSet.base.digest]).toBe('PC2_CHANGED_BASE');
      expect(newSet.base.digest).toBe(sha('PC2_CHANGED_BASE'));
      const newWorkInput = newSet.templates.find(entry => entry.id === 'work-input');
      if (newWorkInput === undefined) throw new Error('PC-06 new record has no work-input template');
      expect(newRecord.value.texts[newWorkInput.digest]).toBe(WORK_INPUT);
    } finally {
      await second.close();
    }
  }, 60_000);
});

describe('a trusted binding change after preparation keeps the prepared pack', () => {
  it('the prepared execution uses pack A and a new preparation uses pack B', async () => {
    const packA = pc2PackEntry('pc2-model-a-pack', { templates: { base: 'PC2_PACK_A' } });
    const packB = pc2PackEntry('pc2-model-b-pack', { templates: { base: 'PC2_PACK_B' } });
    const source = packSource(await resolved(packA), await resolved(packB));
    const fixture = await openPCWorkFixture({
      promptPacks: source,
      selection: { modelId: 'pc2-model-a', promptPack: packA.packId },
      systemInstruction: null,
      skills: NO_SKILLS,
      model: scriptedModel([
        { beforeReply: async () => { throw new Error('binding A run ended'); } },
        { text: 'binding B answer' },
      ]),
    });
    try {
      await fixture.work.prepare();

      // The trusted binding changes from model A to model B after preparation.
      fixture.installBinding({ selection: { modelId: 'pc2-model-b', promptPack: packB.packId } });

      const started = await fixture.work.start();
      expect(started.status, JSON.stringify(started)).toBe('ready');
      expect(fixture.model.requests[0]!.systemPrompt).toBe('PC2_PACK_A');
      const firstRecord = await fixture.work.readPromptRecord();
      expect(firstRecord.status).toBe('ready');
      if (firstRecord.status !== 'ready') throw new Error('binding readPromptRecord A failed');
      expect(firstRecord.value.set).toMatchObject({ modelId: 'pc2-model-a', packId: 'pc2-model-a-pack' });

      const continuation = await fixture.continuation();
      await continuation.prepare();
      const secondStart = await continuation.start();
      expect(secondStart.status, JSON.stringify(secondStart)).toBe('ready');
      expect(fixture.model.requests[1]!.systemPrompt).toBe('PC2_PACK_B');
      const secondRecord = await continuation.readPromptRecord();
      expect(secondRecord.status).toBe('ready');
      if (secondRecord.status !== 'ready') throw new Error('binding readPromptRecord B failed');
      expect(secondRecord.value.set).toMatchObject({ modelId: 'pc2-model-b', packId: 'pc2-model-b-pack' });
    } finally {
      await fixture.close();
    }
  }, 60_000);
});
