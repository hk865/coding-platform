/**
 * PC-2 joint step, PC-18: the one Session-history rule reaches the assembler,
 * the frozen manifest and the rendered input. New Session 0, an LA-1 seed on a
 * fresh Session 1, same-Session reuse 1; a Query and a K3 seed follow the same
 * rule. The reminder sits at the role section's end, also when every budget
 * section is omitted; the brief no longer carries its old sentence.
 *
 * State comes from the frozen platform fixture's public steps (a crashed Run, a
 * public requeue, a public createSession and a public claim); expected counts,
 * the whole reminder text and the section order are hand-written literals. The
 * boundary position is never used as an expectation.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ModelRequest, ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { renderContext } from '../../src/core/agent-runtime/context-rendering.js';
import { openPCQueryFixture, openPCWorkFixture, scriptedModel } from '../helpers/PC-platform-fixture.js';
import { openPC2ReviewFixture, pc2PackEntry, pc2ResolvedSource } from '../helpers/PC2-pack-fixture.js';
import { claimSuccessorRun } from '../helpers/WP2-platform-support.js';
import { rlQueryHostCtx } from '../helpers/RL-query-fixture.js';

const REMINDER = '- 文件可能已经变化，编辑前先重新读取。';

// The LA-1 source turn's own input, written from the scenario's frozen facts
// (role, goal, accepted task, reminders) as one plain literal. It is the same
// text PC-15's hand-written WP2 input records; it never comes from the manifest,
// `preparedTexts()`, the generated pack or a captured request.
const PC2_HISTORY_INPUT = "# Verified runtime task input\n\nThis is the current task context assembled from formal platform facts; it is not a transcript.\n\n## Runtime context\n## Runtime binding\nroleBinding: {\"policyRevision\":\"legacy-template\",\"tools\":[\"read\"],\"writeScope\":[]}\ntools: read\nwriteScope: (none)\n\n## Role specification\nrole: builder@1\nlabel: WP2 platform role\npurpose: WP2_PLATFORM_DUTY_PIN\nresponsibility: human_decision_support\nrequired materials: contract (Read the assigned Plan/Task)\nrequired outputs: answer-with-sources (Report the actual result)\nexit success: Report result\nexit stop: Stop on missing permission\nexit handoff: Keep references\n\nduty: secretary\n\ncontextResidentBytes: 4096\n\n## Goal\ngoal: r4c-claim-goal\nobjective: Exercise the atomic claim skeleton\nworkspace: r4c-claim-workspace@1\nautonomy: after_plan_confirmation\ncurrent understanding: 目标 r4c-claim-goal：还没有当前理解\n\n## Accepted task\ntask: Implement A (implement-a)\ninstruction: Implement A\nplan: r4c-claim-plan\nworkspace: r4c-claim-workspace@1\ndefinitionPlan: r4c-claim-plan@1\nstage: (未声明)\nmodule: (未声明)\nrequirementLevel: required\ndisposition: active\nphase: running\nobligations: [{\"obligationId\":\"obligation-1\",\"requirementLevel\":\"required\",\"taskIds\":[\"implement-a\",\"implement-b\",\"gate-goal\"],\"title\":\"Deliver implementation\",\"verificationRequirements\":[{\"description\":\"Tests pass\",\"kind\":\"test\",\"requirementId\":\"check-1\",\"requirementLevel\":\"required\"}]}]\nacceptance: [{\"description\":\"Tests pass\",\"kind\":\"test\",\"requirementId\":\"check-1\",\"requirementLevel\":\"required\"}]\nupstream: null\ndownstream: [{\"dependsOnId\":\"implement-a\",\"requires\":{\"kind\":\"output-contract\",\"label\":\"A output contract\"},\"taskId\":\"implement-b\"}]\nfailure: null\n\n## Reminders\n还没有观测";
// The personal pack's work-input template, hand-written here: the platform's
// section sequence. It renders the literal above for this frozen scenario.
const PC2_HISTORY_TEMPLATE = '{{prelude}}\n\n{{role}}{{goal}}{{task}}{{footprint}}{{notes}}{{inputs}}'
  + '{{continuation}}{{unknown_call_review}}{{reminders}}';
const PC2_HISTORY_REPLY = 'PC2 history reply.';

// The frozen PC2 review fixture starts a real blocked Run: §5.1's stand-in
// `shell` must be armed so the Run is held at its call.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

async function manifestOfBundle(
  fixture: { base: { ctx: unknown; platform: { materials: { openArtifact: Function } } } },
  bundleRef: ArtifactRef,
): Promise<PreparedTaskManifestV1> {
  const opened = await fixture.base.platform.materials.openArtifact(fixture.base.ctx, {
    ref: bundleRef, usage: 'historical_explanation',
  });
  if (opened.status !== 'ready') throw new Error(JSON.stringify(opened));
  return JSON.parse(opened.value.body) as PreparedTaskManifestV1;
}

async function manifestFrom(
  fixture: {
    base: { ctx: unknown; platform: { materials: { openArtifact: Function } } };
  },
  prepared: { envelope: { bundleRef: ArtifactRef } },
): Promise<PreparedTaskManifestV1> {
  return manifestOfBundle(fixture, prepared.envelope.bundleRef);
}

function reminderCount(input: string, role: { startByte: number | null; endByte: number | null }): number {
  if (role.startByte === null || role.endByte === null) return 0;
  const text = Buffer.from(input, 'utf8').subarray(role.startByte, role.endByte).toString('utf8');
  return text.split(REMINDER).length - 1;
}

/** The exact text a started request handed to the model (hand-joined, no production reader). */
function startedText(request: ModelRequest): string {
  return request.messages.map(message => ('content' in message ? message.content : '')).join('\n');
}

describe('PC-18 the reminder follows the one history decision', () => {
  it('a new Session carries no reminder; a same-Session reuse carries it once at the role end', async () => {
    const fixture = await openPCWorkFixture({
      model: scriptedModel([
        { beforeReply: async () => { throw new Error('PC-18 first run ended'); } },
        { text: 'PC-18 continuation answer' },
      ]),
      systemInstruction: null,
      skills: { resourceRoot: '/nonexistent/pc2-joint', enabledIds: [] },
    });
    try {
      const firstPrepared = await fixture.work.prepare();
      const firstManifest = await manifestFrom(fixture, firstPrepared);
      expect(firstManifest.takesSessionHistory).toBe(false);
      expect(firstManifest.input.split(REMINDER).length - 1).toBe(0);

      const firstStart = await fixture.work.start();
      expect(firstStart.status, JSON.stringify(firstStart)).toBe('ready');
      // The started request, not only the manifest, carries no reminder.
      expect(startedText(fixture.model.requests[0]!).split(REMINDER).length - 1).toBe(0);

      const continuation = await fixture.continuation();
      const continuationPrepared = await continuation.prepare();
      const manifest = await manifestFrom(fixture, continuationPrepared);
      expect(manifest.takesSessionHistory).toBe(true);
      // A reuse of the same Session seeds no formal basis; its cursor decides.
      expect(manifest.sessionBasis).toBeUndefined();
      expect(manifest.input.split(REMINDER).length - 1).toBe(1);
      const role = manifest.contextAssembly.sections.find(section => section.name === 'role');
      if (role === undefined) throw new Error('PC-18 the input has no role section');
      expect(reminderCount(manifest.input, role)).toBe(1);
      const roleText = Buffer.from(manifest.input, 'utf8')
        .subarray(role.startByte ?? 0, role.endByte ?? 0).toString('utf8');
      // The continuation Run's role range ends with the reminder itself.
      expect(roleText.endsWith(`\n${REMINDER}`)).toBe(true);
      // The brief template no longer carries the old stale-files sentence.
      expect(manifest.continuationBrief).toBeDefined();
      expect(manifest.input.split('文件可能已经变化').length - 1).toBe(1);

      const started = await continuation.start();
      expect(started.status, JSON.stringify(started)).toBe('ready');
      expect(startedText(fixture.model.requests.at(-1)!).split(REMINDER).length - 1).toBe(1);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it('an LA-1 seed on a fresh Session carries the previous history and reminds once', async () => {
    // A personal pack fixes the source turn's input from the hand-written
    // template; the reply is the scenario literal too, so both history messages
    // are known without reading a captured request.
    const pack = pc2PackEntry('pc2-history', { templates: { 'work-input': PC2_HISTORY_TEMPLATE } });
    const source = await pc2ResolvedSource([pack]);
    const fixture = await openPCWorkFixture({
      model: scriptedModel([
        { text: PC2_HISTORY_REPLY },
        { text: 'PC-18 LA-1 continuation answer' },
      ]),
      systemInstruction: null,
      skills: { resourceRoot: '/nonexistent/pc2-joint', enabledIds: [] },
      promptPacks: source,
      selection: { promptPack: pack.packId },
    });
    try {
      await fixture.work.prepare();
      const firstStart = await fixture.work.start();
      expect(firstStart.status, JSON.stringify(firstStart)).toBe('ready');
      if (firstStart.status !== 'ready') return;
      expect(firstStart.value.run.status).toBe('ended');
      expect(firstStart.value.run.outcome).toBe('completed');

      // Public steps only: close the completed Run's round INCONCLUSIVE so the
      // Task is requeueable, requeue it, create a same-role Session, then claim
      // its successor with the requeue reference.
      const base = fixture.base;
      const claim = base.claim!;
      base.platform.registerCheckConfiguration({ configuration: {
        configurationRevision: 'pc18-la1-checks@1',
        workspace: base.fixture.workspaceRef,
        executor: { kind: 'human', id: 'r4c-claim-operator' },
        permissionRevision: 'wp2-workspace-read@1',
        sourceAccess: 'verification_workspace',
        processAccess: 'all_except_denied',
        deniedPrefixes: ['.git'],
        checks: [],
      } });
      const opened = await base.platform.evidence.openVerification(base.ctx, {
        input: { subjectRunRef: claim.runRef, subject: claim.task, planRef: claim.planRef },
        meta: { requestId: 'pc18-la1-open', expected: [] },
      });
      if (opened.status !== 'committed') throw new Error(JSON.stringify(opened));
      const finalized = await base.platform.evidence.finalizeChecks(base.ctx, {
        input: { roundRef: opened.value.ref },
        meta: { requestId: 'pc18-la1-final', expected: [{ ref: opened.value.ref, revision: opened.value.revision }] },
      });
      if (finalized.status !== 'committed') throw new Error(JSON.stringify(finalized));
      const prior = await base.platform.executions.readExecution(base.ctx, claim.runRef);
      if (prior.status !== 'ready') throw new Error(JSON.stringify(prior));
      const goal = await base.platform.plans.queryGoal(base.ctx, base.goalRef);
      if (goal.status !== 'ready') throw new Error(JSON.stringify(goal));
      const requeue = await base.platform.claims.requeueTask!(base.ctx, {
        input: { taskRef: claim.task, afterRunRef: claim.runRef, reason: 'Continue PC work', note: 'Continue PC work' },
        meta: { requestId: 'pc18-la1-requeue', expected: [
          { ref: base.goalRef, revision: goal.value.goal.revision },
          { ref: claim.runRef, revision: prior.value.run.revision },
        ] },
      });
      if (requeue.status !== 'committed') throw new Error(JSON.stringify(requeue));
      if (requeue.value.kind !== 'requeued') throw new Error(JSON.stringify(requeue.value));
      const requeueRef = requeue.value.requeue.ref;

      const session = await base.platform.sessions.readSession(base.ctx, base.sessionRef);
      if (session.status !== 'ready') throw new Error(JSON.stringify(session));
      const created = await base.platform.runtime.createSession(base.ctx, {
        workspace: base.scope, role: session.value.record.role, recommendedRefs: [], initialLinks: [],
        meta: { requestId: 'pc18-la1-session', expected: [] },
      });
      if (created.status !== 'completed') throw new Error(JSON.stringify(created));
      const freshSessionRef = {
        projectId: created.value.ref.projectId, sessionId: created.value.ref.sessionId,
      };
      const runRef = await claimSuccessorRun(base, base.goalRef, claim.task.taskId,
        freshSessionRef, 'pc18-la1-claim', claim.planRef, requeueRef);
      const prepared = await base.platform.runtime.prepareExecution(base.ctx, {
        runRef, requestId: 'pc18-la1-prepare',
      });
      if (prepared.status !== 'ready') throw new Error(JSON.stringify(prepared));
      const manifest = await manifestFrom(fixture, prepared.value);
      expect(manifest.takesSessionHistory).toBe(true);
      expect(manifest.input.split(REMINDER).length - 1).toBe(1);
      const role = manifest.contextAssembly.sections.find(section => section.name === 'role');
      if (role === undefined) throw new Error('PC-18 the LA-1 input has no role section');
      expect(reminderCount(manifest.input, role)).toBe(1);
      const roleText = Buffer.from(manifest.input, 'utf8')
        .subarray(role.startByte ?? 0, role.endByte ?? 0).toString('utf8');
      expect(roleText.endsWith(`\n${REMINDER}`)).toBe(true);
      // The non-empty seed is stated in the continuation section's history line.
      const continuation = manifest.contextAssembly.sections.find(section => section.name === 'continuation');
      if (continuation === undefined) throw new Error('PC-18 the LA-1 input has no continuation section');
      const continuationText = Buffer.from(manifest.input, 'utf8')
        .subarray(continuation.startByte ?? 0, continuation.endByte ?? 0).toString('utf8');
      expect(continuationText).toMatch(/接续方式：在新的 Session .+ 中继续，带有 Session .+ 到位置 \d+ 的历史。/);

      const started = await base.platform.runtime.startRun(base.ctx, {
        prepared: prepared.value, consumerId: 'pc18-la1', requestId: 'pc18-la1-start',
      });
      expect(started.status, JSON.stringify(started)).toBe('ready');
      const request = fixture.model.requests.at(-1)!;
      // The whole history-message prefix: the source user input, then the
      // scripted reply, both scenario literals. This Turn's user message follows.
      expect(request.messages.slice(0, 2)).toEqual([
        { role: 'user', messageId: expect.any(String), content: PC2_HISTORY_INPUT },
        { role: 'assistant', messageId: expect.any(String), content: PC2_HISTORY_REPLY, toolCalls: [] },
      ]);
      expect(request.messages).toHaveLength(3);
      expect(request.messages[2]).toMatchObject({ role: 'user' });
      expect(startedText(request).split(REMINDER).length - 1).toBe(1);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it('a Query without a formal basis reads the real completed boundary (zero here)', async () => {
    const fixture = await openPCQueryFixture({
      tools: ['read'],
      model: scriptedModel([{ text: 'PC-18 query answer' }]),
    });
    try {
      const prepared = await fixture.prepare();
      const manifest = await manifestOfBundle(
        { base: { ctx: rlQueryHostCtx(), platform: fixture.base.platform } }, prepared.bundleRef);
      expect(manifest.takesSessionHistory).toBe(false);
      expect(manifest.sessionBasis).toBeUndefined();
      expect(manifest.input.split(REMINDER).length - 1).toBe(0);
      const started = await fixture.start();
      expect(started.status, JSON.stringify(started)).toBe('ready');
      expect(startedText(fixture.model.requests.at(-1)!).split(REMINDER).length - 1).toBe(0);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it('a K3 review seed follows the same decision and carries the reminder once', async () => {
    const fixture = await openPC2ReviewFixture('shrink');
    try {
      expect(fixture.preparation.status, JSON.stringify(fixture.preparation)).toBe('ready');
      const manifest = fixture.manifest;
      if (manifest === null) throw new Error('PC-18 the K3 review preparation must be ready');
      // A K3 seed whose source has no completed Turn is the explicit empty
      // baseline: the same rule decides `current_turn` and adds no reminder.
      expect(manifest.sessionBasis).toEqual({
        sourceKernelSessionId: 's5-kernel-session-pc-pending-review-session', throughPosition: null,
      });
      expect(manifest.takesSessionHistory).toBe(false);
      expect(manifest.input.split(REMINDER).length - 1).toBe(0);
      const started = await fixture.start();
      expect(started.status, JSON.stringify(started)).toBe('ready');
      expect(startedText(fixture.fixture.model.requests.at(-1)!).split(REMINDER).length - 1).toBe(0);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it('keeps the reminder inside the role range with every budget section omitted', () => {
    const texts = {
      templates: {
        'work-input': '{{prelude}}\n\n{{role}}{{goal}}{{task}}{{footprint}}{{notes}}{{inputs}}'
          + '{{continuation}}{{unknown_call_review}}{{reminders}}',
        'stale-files-reminder': REMINDER,
      },
      strings: {
        'context.prelude.work': 'PRE', 'context.section.role': '## Role', 'context.section.goal': '## Goal',
        'context.section.task': '## Task', 'context.section.footprint': '## F', 'context.section.notes': '## N',
        'context.section.reminders': '## M', 'context.section.inputs': '## I',
        'context.omissions.heading': '## Context omissions', 'context.omissions.prefix': '另有 ',
        'context.omissions.suffix': ' 条，用‘看’读', 'context.omissions.nameSeparator': ': ',
      },
    };
    const result = renderContext({
      prelude: 'PRE', required: { role: 'R', goal: null, task: 'T' },
      optional: {
        footprint: [{ key: 'f', text: 'f' }], notes: [{ key: 'n', text: 'n' }],
        reminders: [{ key: 'm', text: 'm' }], inputs: [{ key: 'i', text: 'i' }],
      },
      continuationSuffix: null, residentBudgetBytes: 0, takesSessionHistory: true, texts,
    });
    expect(result.input).toBe('PRE\n\n## Role\nR\n' + REMINDER + '\n\n## Task\nT\n\n## Context omissions\n'
      + 'footprint: 另有 1 条，用‘看’读\nnotes: 另有 1 条，用‘看’读\nreminders: 另有 1 条，用‘看’读\n'
      + 'inputs: 另有 1 条，用‘看’读');
    // start 5; role text '## Role\nR\n' = 10 bytes plus the 56-byte reminder.
    expect(result.sections.find(section => section.name === 'role')).toMatchObject({ startByte: 5, endByte: 71 });
    expect(result.residentBytes).toBe(0);
    expect(PLATFORM_PROMPT_PACK_V1.templates['stale-files-reminder']).toBe(REMINDER);
  });
});
