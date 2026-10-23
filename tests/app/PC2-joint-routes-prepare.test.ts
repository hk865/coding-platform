/**
 * PC-2 joint step, PC-04 (prepared vs new): a template and a tool are saved
 * through the real settings routes over the real Host, then real preparations
 * and starts run against the disk pack source. A preparation made before the
 * save is unchanged, a new preparation uses the new text, and an invalid save
 * leaves every pack file byte-equal.
 *
 * The pack files are the Host fixture's own temporary tree; the runtime uses
 * H's real disk source over that same tree. Expected texts and the tool digest
 * are hand-written literals. The settings half of PC-05/06/08 is the second
 * group below (J-01, J-02, H-09): each Work world is built through the Host's
 * own public owners and prepared, started and recorded on the Host's own
 * platform, so the Host's settings-to-execution chain is the thing under test.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { createDiskPromptPackSource } from '../../src/app/prompt-packs.js';
import { LOCAL_WORKBENCH_ROLE, LOCAL_WORKBENCH_ROLE_BINDING } from '../../src/app/runtime-configuration.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { openPC2HostFixture } from '../helpers/PC2-host-fixture.js';
import { openPCWorkFixture, scriptedModel } from '../helpers/PC-platform-fixture.js';
import { pc2PackEntry, snapshotPC2Step } from '../helpers/PC2-pack-fixture.js';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const OLD_NOTE_BODY = JSON.stringify({ description: 'PC2_OLD_NOTE', parameters: {} });
const NEW_NOTE_BODY = JSON.stringify({ description: 'PC2_NEW_NOTE', parameters: {} });

describe('PC-04 a route save reaches the next preparation, never the prepared one', () => {
  it('the prepared start keeps the old template and tool; a new preparation reads the saved ones', async () => {
    const pack = pc2PackEntry('pc2-route-child', {
      templates: { base: 'PC2_OLD_BASE' },
      tools: { record_note: { description: 'PC2_OLD_NOTE', parameters: {} } },
    });
    const host = await openPC2HostFixture({ packs: [pack] });
    let work: Awaited<ReturnType<typeof openPCWorkFixture>> | undefined;
    try {
      const directory = join(host.paths.promptsDirectory, pack.packId);
      // An invalid save changes no file in the pack directory.
      const invalid = await snapshotPC2Step(directory, () => host.call('prompts/templates/save', {
        packId: pack.packId, templateId: 'base', expectedVersion: 1, text: 'PC2 {{pc2_unknown}}', mentionsTools: [],
      }));
      expect(invalid.difference.equal).toBe(true);
      expect(invalid.outcome.status).toBe('returned');
      if (invalid.outcome.status === 'returned') {
        expect(invalid.outcome.value.status).toBe(400);
      }

      work = await openPCWorkFixture({
        promptPacks: createDiskPromptPackSource(host.paths.promptsDirectory),
        selection: { promptPack: pack.packId },
        systemInstruction: null,
        skills: { resourceRoot: '/nonexistent/pc2-joint', enabledIds: [] },
        tools: ['read', 'record_note'],
        model: scriptedModel([
          { beforeReply: async () => { throw new Error('PC-04 first run ended'); } },
          { text: 'PC-04 new preparation answer' },
        ]),
      });
      await work.work.prepare();

      // Save a new base and a new tool text through the routes.
      const savedBase = await host.call('prompts/templates/save', {
        packId: pack.packId, templateId: 'base', expectedVersion: 1, text: 'PC2_NEW_BASE', mentionsTools: [],
      });
      expect(savedBase.status).toBe(200);
      expect(savedBase.body).toMatchObject({ status: 'ready', value: { version: 2, text: 'PC2_NEW_BASE' } });
      const savedTool = await host.call('prompts/tools/save', {
        packId: pack.packId, toolName: 'record_note', expectedDigest: sha(OLD_NOTE_BODY),
        entry: { description: 'PC2_NEW_NOTE', parameters: {} },
      });
      expect(savedTool.status).toBe(200);
      expect(savedTool.body).toMatchObject({
        status: 'ready', value: { digest: sha(NEW_NOTE_BODY), entry: { description: 'PC2_NEW_NOTE' } },
      });

      // The preparation made before the save still sends its frozen texts.
      const first = await work.work.start();
      expect(first.status, JSON.stringify(first)).toBe('ready');
      expect(work.model.requests[0]!.systemPrompt).toBe('PC2_OLD_BASE');
      expect(work.model.requests[0]!.tools.find(tool => tool.name === 'record_note')?.description)
        .toBe('PC2_OLD_NOTE');

      // A preparation after the save reads the new files from disk.
      const continuation = await work.continuation();
      await continuation.prepare();
      const secondStart = await continuation.start();
      expect(secondStart.status, JSON.stringify(secondStart)).toBe('ready');
      expect(work.model.requests[1]!.systemPrompt).toBe('PC2_NEW_BASE');
      expect(work.model.requests[1]!.tools.find(tool => tool.name === 'record_note')?.description)
        .toBe('PC2_NEW_NOTE');
    } finally {
      await work?.close();
      await host.close();
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// PC-05 / PC-06 / PC-08 settings half (J-01, J-02, H-09). Every Work world is
// built through the Host's own public owners on `host.live.platform`, and the
// Host's own trusted runtime prepares, starts and records it. Expected system
// prompts, record set fields and base digests are hand-written literals.
// ---------------------------------------------------------------------------

type PC2Host = Awaited<ReturnType<typeof openPC2HostFixture>>;

const SETTINGS_MODELS = [
  { id: 'pc2-model-a', label: 'Model A', provider: 'deepseek' as const, model: 'deepseek-chat' },
  { id: 'pc2-model-b', label: 'Model B', provider: 'deepseek' as const, model: 'deepseek-chat' },
];
const PACK_IDS = { a: 'pc2-settings-pack-a', b: 'pc2-settings-pack-b', a2: 'pc2-settings-pack-a2' } as const;
const PACK_A = 'PC2_SETTINGS_PACK_A';
const PACK_B = 'PC2_SETTINGS_PACK_B';
const PACK_A2 = 'PC2_SETTINGS_PACK_A2';
const SKILL_A = 'PC2_SETTINGS_SKILL_A';
const SKILL_B = 'PC2_SETTINGS_SKILL_B';
const SKILL_A2 = 'PC2_SETTINGS_SKILL_A2';

function settingsHostContext(host: PC2Host): CoreCallContext {
  const actor = { kind: 'human' as const, id: 'pc2-host-operator' };
  return {
    projectId: host.scope.projectId,
    workspaceId: host.scope.workspaceId,
    principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: host.scope.projectId, workspaceId: host.scope.workspaceId, actor },
    signal: new AbortController().signal,
  };
}

function committed<T>(result: { status: string; value?: T }): T {
  if (result.status !== 'committed' || !('value' in result)) {
    throw new Error(`the Host owner did not commit: ${JSON.stringify(result)}`);
  }
  return result.value as T;
}

function completed<T>(result: { status: string; value?: T }): T {
  if (result.status !== 'completed' || !('value' in result)) {
    throw new Error(`the Host owner did not complete: ${JSON.stringify(result)}`);
  }
  return result.value as T;
}

/** The one Host-wide project/governance seed, through public owners. */
async function seedHostGovernance(host: PC2Host): Promise<void> {
  const platform = host.live.platform;
  const ctx = settingsHostContext(host);
  const projectId = host.scope.projectId;
  const projectRef = { aggregateType: 'Project' as const, projectId };
  const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId: host.scope.workspaceId };
  committed(await platform.projects.createProject(ctx, {
    input: { projectId },
    meta: { requestId: 'pc2-routes-project', expected: [{ ref: projectRef, revision: 0 }] },
  }));
  committed(await platform.projects.registerWorkspace(ctx, {
    input: { workspace: host.scope },
    meta: { requestId: 'pc2-routes-workspace',
      expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] },
  }));
  const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId,
    policyId: 'pc2-routes-policy', revision: 1 };
  const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId };
  const installed = committed(await platform.completionPolicies.installCompletionPolicy(ctx, {
    input: { policyId: 'pc2-routes-policy', contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 } },
    meta: { requestId: 'pc2-routes-policy',
      expected: [{ ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 }] },
  }));
  committed(await platform.completionPolicies.activateCompletionPolicy(ctx, {
    input: { target: { ref: installed.ref, digest: installed.contentDigest } },
    meta: { requestId: 'pc2-routes-policy-active',
      expected: [{ ref: projectRef, revision: 1 }, { ref: activeRef, revision: 0 }] },
  }));
  committed(await platform.architecture.adoptInitialArchitecture(ctx, {
    input: { baselineId: 'pc2-routes-baseline', description: 'PC2 settings execution', constraints: [],
      catalog: { requireDag: true, dependencies: [], modules: [] } },
    meta: { requestId: 'pc2-routes-architecture',
      expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
  }));
}

/** One fresh Goal, adopted Plan, Session and claimed Work Run through owners. */
async function createWorkRun(host: PC2Host, prefix: string): Promise<RunRef> {
  const platform = host.live.platform;
  const ctx = settingsHostContext(host);
  const projectId = host.scope.projectId;
  const projectRef = { aggregateType: 'Project' as const, projectId };
  const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId: host.scope.workspaceId };
  const registration = await platform.projects.readWorkspaceRegistration(ctx, host.scope);
  if (registration.status !== 'ready') throw new Error(`the Host workspace registration read failed: ${JSON.stringify(registration)}`);
  const goalId = `${prefix}-goal`;
  const planId = `${prefix}-plan`;
  const taskId = `${prefix}-task`;
  const goalRef = { aggregateType: 'Goal' as const, projectId, goalId };
  committed(await platform.goals.createGoal(ctx, {
    input: { goalId, workspace: host.scope, objective: `PC2 ${prefix} objective` },
    meta: { requestId: `${prefix}-goal`, expected: [
      { ref: projectRef, revision: registration.value.project.revision },
      { ref: workspaceRef, revision: registration.value.workspace.revision },
    ] },
  }));
  const created = await platform.plans.queryGoal(ctx, goalRef);
  if (created.status !== 'ready') throw new Error(`the Host Goal read failed: ${JSON.stringify(created)}`);
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId, planRevision: 1, goalId, stages: [],
    tasks: [
      { taskId, title: `PC2 ${prefix} work`, requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: `${taskId}-gate`, title: `PC2 ${prefix} gate`, requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId, role: LOCAL_WORKBENCH_ROLE_BINDING.templateId, instruction: `PC2 ${prefix} work` }],
    obligations: [{ obligationId: `${prefix}-obligation`, title: `PC2 ${prefix} delivery`, requirementLevel: 'required',
      taskIds: [taskId, `${taskId}-gate`],
      verificationRequirements: [{ requirementId: `${prefix}-check`, requirementLevel: 'required',
        kind: 'test', description: 'PC2 test' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
  };
  const proposed = committed(await platform.plans.proposePlan(ctx, {
    input: { goalRef, basedOn: null, draft, reason: { text: `PC2 ${prefix} plan`, sources: [] } },
    meta: { requestId: `${prefix}-propose`, expected: [{ ref: goalRef, revision: created.value.goal.revision }] },
  }));
  if (proposed.issues.length > 0) throw new Error(`the Host Plan proposal has issues: ${JSON.stringify(proposed.issues)}`);
  committed(await platform.plans.applyPlanChange(ctx, {
    input: { proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [] },
    meta: { requestId: `${prefix}-apply`, expected: [{ ref: goalRef, revision: created.value.goal.revision }] },
  }));
  const sessionRecord = completed(await platform.runtime.createSession(ctx, {
    workspace: host.scope, role: LOCAL_WORKBENCH_ROLE, recommendedRefs: [], initialLinks: [],
    meta: { requestId: `${prefix}-session`, expected: [] },
  }));
  const sessionRef = { projectId: sessionRecord.ref.projectId, sessionId: sessionRecord.ref.sessionId };
  const goalRead = await platform.plans.queryGoal(ctx, goalRef);
  if (goalRead.status !== 'ready') throw new Error(`the Host Goal read before claim failed: ${JSON.stringify(goalRead)}`);
  const claimRegistration = await platform.projects.readWorkspaceRegistration(ctx, host.scope);
  if (claimRegistration.status !== 'ready') throw new Error(`the Host workspace registration read before claim failed: ${JSON.stringify(claimRegistration)}`);
  const claim = committed(await platform.claims.claimTask(ctx, {
    input: {
      goalRef, planRef: { aggregateType: 'PlanRevision' as const, projectId, planId }, taskId, sessionRef,
      roleBinding: LOCAL_WORKBENCH_ROLE_BINDING, budget: { tokenBudget: 1_000_000, deadline: null },
    },
    meta: { requestId: `${prefix}-claim`, expected: [
      { ref: goalRef, revision: goalRead.value.goal.revision },
      { ref: workspaceRef, revision: claimRegistration.value.workspace.revision },
      { ref: plainSessionRefToAggregate(sessionRef), revision: sessionRecord.revision },
    ] },
  }));
  return claim.runRef;
}

/** The Host's own runtime prepares one claimed Run. */
async function prepareRun(host: PC2Host, runRef: RunRef, prefix: string) {
  const prepared = await host.live.platform.runtime.prepareExecution(settingsHostContext(host), {
    runRef, requestId: `${prefix}-prepare`,
  });
  expect(prepared.status, JSON.stringify(prepared)).toBe('ready');
  if (prepared.status !== 'ready') throw new Error(`the Host preparation failed: ${JSON.stringify(prepared)}`);
  return prepared.value;
}

/** The Host's own runtime starts one prepared Run. */
async function startPrepared(host: PC2Host, prepared: Awaited<ReturnType<typeof prepareRun>>, prefix: string) {
  const started = await host.live.platform.runtime.startRun(settingsHostContext(host), {
    prepared, consumerId: `${prefix}-consumer`, requestId: `${prefix}-start`,
  });
  expect(started.status, JSON.stringify(started)).toBe('ready');
  if (started.status !== 'ready') throw new Error(`the Host start failed: ${JSON.stringify(started)}`);
}

async function prepareAndStart(host: PC2Host, runRef: RunRef, prefix: string): Promise<void> {
  await startPrepared(host, await prepareRun(host, runRef, prefix), prefix);
}

/** The Host's own record read for one Run. */
async function promptRecordOf(host: PC2Host, runRef: RunRef) {
  const readPromptRecord = host.live.platform.runtime.readPromptRecord;
  if (readPromptRecord === undefined) throw new Error('the Host runtime has no readPromptRecord');
  const record = await readPromptRecord(settingsHostContext(host), runRef);
  expect(record.status).toBe('ready');
  if (record.status !== 'ready') throw new Error(`the Host readPromptRecord failed: ${JSON.stringify(record)}`);
  return record.value;
}

function expectRecordSet(
  record: Awaited<ReturnType<typeof promptRecordOf>>,
  expected: { modelId: string; packId: string; reasoningReplay: 'current_run' | 'none' },
): void {
  expect({
    modelId: record.set.modelId, packId: record.set.packId, reasoningReplay: record.set.reasoningReplay,
  }).toEqual(expected);
}

function expectPackBase(record: Awaited<ReturnType<typeof promptRecordOf>>, text: string): void {
  expect(record.set.base.digest).toBe(sha(text));
  expect(record.texts[sha(text)]).toBe(text);
}

function lastSystemPrompt(host: PC2Host): string {
  const request = host.model.requests.at(-1);
  if (request === undefined) throw new Error('the Host scripted model received no request');
  return request.systemPrompt;
}

/** The whole system prompt: the pack base plus the pack's own Skill section. */
function expectSystemPrompt(host: PC2Host, base: string, skill: string): void {
  const source = `skill:platform-work@sha256:${sha(skill)}`;
  expect(lastSystemPrompt(host)).toBe(
    `${base}\n\n[skill_instruction id="platform-work" source="${source}"]\n${skill}`);
}

function expectPackSkill(record: Awaited<ReturnType<typeof promptRecordOf>>, text: string): void {
  expect(record.set.skills).toHaveLength(1);
  expect(record.set.skills[0]).toMatchObject({ id: 'platform-work', digest: sha(text) });
  expect(record.texts[sha(text)]).toBe(text);
}

function saveModel(
  host: PC2Host, id: string, fields: { promptPack?: string; reasoningReplay?: 'current_run' | 'none' } = {},
) {
  return host.call('models/save', {
    id, label: id === 'pc2-model-a' ? 'Model A' : 'Model B',
    provider: 'deepseek', model: 'deepseek-chat', ...fields,
  });
}

/**
 * The open options cannot pass a Kernel store, so start the (not yet started)
 * Host with one; `restart` keeps the same `current` map.
 */
type FixtureOptions = NonNullable<Parameters<typeof openPC2HostFixture>[0]>;

async function startSettingsHost({
  models, packs, replies,
}: {
  models: NonNullable<FixtureOptions['models']>;
  packs: NonNullable<FixtureOptions['packs']>;
  replies: Parameters<typeof scriptedModel>[0];
}): Promise<PC2Host> {
  const host = await openPC2HostFixture({ models, packs, model: scriptedModel(replies), start: false });
  await host.start({
    kernelStores: { entries: [{
      adapterId: 'pc2-routes-kernel', storeKey: 'pc2-routes-kernel-store',
      workspace: host.scope, databasePath: join(host.paths.directory, 'kernel.sqlite'),
    }] },
  });
  await seedHostGovernance(host);
  return host;
}

describe('PC-05 (J-01) two settings models each select their own pack', () => {
  it('each real preparation and start uses the selected model\'s literal pack', async () => {
    const packA = pc2PackEntry(PACK_IDS.a, { templates: { base: PACK_A, 'skill-platform-work': SKILL_A } });
    const packB = pc2PackEntry(PACK_IDS.b, { templates: { base: PACK_B, 'skill-platform-work': SKILL_B } });
    const host = await startSettingsHost({
      models: SETTINGS_MODELS, packs: [packA, packB],
      replies: [{ text: 'PC-05 model A answer' }, { text: 'PC-05 model B answer' }],
    });
    try {
      expect((await saveModel(host, 'pc2-model-a', { promptPack: PACK_IDS.a, reasoningReplay: 'none' })).status).toBe(200);
      expect((await saveModel(host, 'pc2-model-b', { promptPack: PACK_IDS.b, reasoningReplay: 'current_run' })).status).toBe(200);

      expect((await host.call('models/select', { scope: host.scope, modelId: 'pc2-model-a' })).status).toBe(200);
      const aRun = await createWorkRun(host, 'pc2-j01-a');
      await prepareAndStart(host, aRun, 'pc2-j01-a');
      expectSystemPrompt(host, PACK_A, SKILL_A);
      const aRecord = await promptRecordOf(host, aRun);
      expectRecordSet(aRecord, { modelId: 'pc2-model-a', packId: PACK_IDS.a, reasoningReplay: 'none' });
      expectPackBase(aRecord, PACK_A);
      expectPackSkill(aRecord, SKILL_A);

      expect((await host.call('models/select', { scope: host.scope, modelId: 'pc2-model-b' })).status).toBe(200);
      const bRun = await createWorkRun(host, 'pc2-j01-b');
      await prepareAndStart(host, bRun, 'pc2-j01-b');
      expectSystemPrompt(host, PACK_B, SKILL_B);
      const bRecord = await promptRecordOf(host, bRun);
      expectRecordSet(bRecord, { modelId: 'pc2-model-b', packId: PACK_IDS.b, reasoningReplay: 'current_run' });
      expectPackBase(bRecord, PACK_B);
      expectPackSkill(bRecord, SKILL_B);
    } finally {
      await host.close();
    }
  }, 60_000);
});

describe('PC-06/PC-08 (J-02) the same settings model changes pack after preparation', () => {
  it('the prepared run keeps A and a new preparation uses B', async () => {
    const packA = pc2PackEntry(PACK_IDS.a, { templates: { base: PACK_A, 'skill-platform-work': SKILL_A } });
    const packA2 = pc2PackEntry(PACK_IDS.a2, { templates: { base: PACK_A2, 'skill-platform-work': SKILL_A2 } });
    const host = await startSettingsHost({
      models: SETTINGS_MODELS.slice(0, 1), packs: [packA, packA2],
      replies: [{ text: 'PC-08 old answer' }, { text: 'PC-08 new answer' }],
    });
    try {
      expect((await saveModel(host, 'pc2-model-a', { promptPack: PACK_IDS.a, reasoningReplay: 'none' })).status).toBe(200);
      expect((await host.call('models/select', { scope: host.scope, modelId: 'pc2-model-a' })).status).toBe(200);

      const preparedRun = await createWorkRun(host, 'pc2-j02-before');
      const prepared = await prepareRun(host, preparedRun, 'pc2-j02-before');
      // The same model id gets pack A2 through the real settings save.
      expect((await saveModel(host, 'pc2-model-a', { promptPack: PACK_IDS.a2, reasoningReplay: 'current_run' })).status).toBe(200);

      await startPrepared(host, prepared, 'pc2-j02-before');
      expectSystemPrompt(host, PACK_A, SKILL_A);
      const oldRecord = await promptRecordOf(host, preparedRun);
      expectRecordSet(oldRecord, { modelId: 'pc2-model-a', packId: PACK_IDS.a, reasoningReplay: 'none' });
      expectPackBase(oldRecord, PACK_A);
      expectPackSkill(oldRecord, SKILL_A);

      const nextRun = await createWorkRun(host, 'pc2-j02-after');
      await prepareAndStart(host, nextRun, 'pc2-j02-after');
      expectSystemPrompt(host, PACK_A2, SKILL_A2);
      const newRecord = await promptRecordOf(host, nextRun);
      expectRecordSet(newRecord, { modelId: 'pc2-model-a', packId: PACK_IDS.a2, reasoningReplay: 'current_run' });
      expectPackBase(newRecord, PACK_A2);
      expectPackSkill(newRecord, SKILL_A2);
    } finally {
      await host.close();
    }
  }, 60_000);
});

describe('PC-05 / PC-06 / PC-08 (J-01, J-02, H-09) settings reach the real execution and a restart', () => {
  it('freezes A, updates B, clears to platform/current_run, and keeps an absent pack id', async () => {
    const catalog = [
      {
        id: 'pc2-model-a', label: 'Model A', provider: 'deepseek' as const, model: 'deepseek-chat',
        promptPack: 'pc2-catalog-old', reasoningReplay: 'none' as const,
      },
      { id: 'pc2-model-b', label: 'Model B', provider: 'deepseek' as const, model: 'deepseek-chat' },
    ];
    const packA = pc2PackEntry(PACK_IDS.a, { templates: { base: PACK_A, 'skill-platform-work': SKILL_A } });
    const packB = pc2PackEntry(PACK_IDS.b, { templates: { base: PACK_B, 'skill-platform-work': SKILL_B } });
    const packA2 = pc2PackEntry(PACK_IDS.a2, { templates: { base: PACK_A2, 'skill-platform-work': SKILL_A2 } });
    const host = await startSettingsHost({
      models: catalog, packs: [packA, packB, packA2],
      replies: [
        { text: 'H-09 old answer' }, { text: 'H-09 updated answer' },
        { text: 'H-09 model B answer' }, { text: 'H-09 default answer' },
      ],
    });
    try {
      // The startup catalog really carries an old pack and policy.
      const initial = await host.call('snapshot', {});
      expect(initial.body.status).toBe('ready');
      if (initial.body.status !== 'ready') throw new Error('the initial settings read failed');
      expect(initial.body.value.models.find(model => model.id === 'pc2-model-a'))
        .toMatchObject({ promptPack: 'pc2-catalog-old', reasoningReplay: 'none' });

      expect((await saveModel(host, 'pc2-model-a', { promptPack: PACK_IDS.a, reasoningReplay: 'none' })).status).toBe(200);
      expect((await saveModel(host, 'pc2-model-b', { promptPack: PACK_IDS.b, reasoningReplay: 'current_run' })).status).toBe(200);
      expect((await host.call('models/select', { scope: host.scope, modelId: 'pc2-model-a' })).status).toBe(200);

      // A Run prepared under A stays A after the same model is saved to A2.
      const preparedRun = await createWorkRun(host, 'pc2-h09-a');
      const prepared = await prepareRun(host, preparedRun, 'pc2-h09-a');
      expect((await saveModel(host, 'pc2-model-a', { promptPack: PACK_IDS.a2, reasoningReplay: 'current_run' })).status).toBe(200);

      await startPrepared(host, prepared, 'pc2-h09-a');
      expectSystemPrompt(host, PACK_A, SKILL_A);
      const oldRecord = await promptRecordOf(host, preparedRun);
      expectRecordSet(oldRecord, { modelId: 'pc2-model-a', packId: PACK_IDS.a, reasoningReplay: 'none' });
      expectPackBase(oldRecord, PACK_A);
      expectPackSkill(oldRecord, SKILL_A);

      const updatedRun = await createWorkRun(host, 'pc2-h09-a2');
      await prepareAndStart(host, updatedRun, 'pc2-h09-a2');
      expectSystemPrompt(host, PACK_A2, SKILL_A2);
      const updatedRecord = await promptRecordOf(host, updatedRun);
      expectRecordSet(updatedRecord, { modelId: 'pc2-model-a', packId: PACK_IDS.a2, reasoningReplay: 'current_run' });
      expectPackBase(updatedRecord, PACK_A2);
      expectPackSkill(updatedRecord, SKILL_A2);

      // Model B has its own pack.
      expect((await host.call('models/select', { scope: host.scope, modelId: 'pc2-model-b' })).status).toBe(200);
      const bRun = await createWorkRun(host, 'pc2-h09-b');
      await prepareAndStart(host, bRun, 'pc2-h09-b');
      expectSystemPrompt(host, PACK_B, SKILL_B);
      const bRecord = await promptRecordOf(host, bRun);
      expectRecordSet(bRecord, { modelId: 'pc2-model-b', packId: PACK_IDS.b, reasoningReplay: 'current_run' });
      expectPackBase(bRecord, PACK_B);
      expectPackSkill(bRecord, SKILL_B);

      // Clearing the two fields persists; a restart reads the later save, not the
      // startup catalog, and the next execution freezes the defaults. Model A is
      // the workspace's selection again, so its cleared pack is the one resolved.
      expect((await host.call('models/select', { scope: host.scope, modelId: 'pc2-model-a' })).status).toBe(200);
      expect((await saveModel(host, 'pc2-model-a')).status).toBe(200);
      const cleared = await host.call('snapshot', {});
      expect(cleared.body.status).toBe('ready');
      if (cleared.body.status !== 'ready') throw new Error('the cleared settings read failed');
      expect(cleared.body.value.models.find(model => model.id === 'pc2-model-a'))
        .not.toHaveProperty('promptPack');
      expect(cleared.body.value.models.find(model => model.id === 'pc2-model-a'))
        .not.toHaveProperty('reasoningReplay');

      await host.restart();
      const restarted = await host.call('snapshot', {});
      expect(restarted.body.status).toBe('ready');
      if (restarted.body.status !== 'ready') throw new Error('the restarted settings read failed');
      const restartedA = restarted.body.value.models.find(model => model.id === 'pc2-model-a');
      expect(restartedA).not.toHaveProperty('promptPack');
      expect(restartedA).not.toHaveProperty('reasoningReplay');
      expect(restarted.body.value.models.find(model => model.id === 'pc2-model-b'))
        .toMatchObject({ promptPack: PACK_IDS.b, reasoningReplay: 'current_run' });

      const defaultsRun = await createWorkRun(host, 'pc2-h09-default');
      await prepareAndStart(host, defaultsRun, 'pc2-h09-default');
      const defaultsRecord = await promptRecordOf(host, defaultsRun);
      expectRecordSet(defaultsRecord, {
        modelId: 'pc2-model-a', packId: 'platform', reasoningReplay: 'current_run',
      });

      // A legal pack id that does not exist is accepted at save and read back.
      const absent = await saveModel(host, 'pc2-model-b', { promptPack: 'pc2-absent' });
      expect(absent.status).toBe(200);
      expect(absent.body).toMatchObject({
        status: 'ready',
        value: { models: expect.arrayContaining([
          expect.objectContaining({ id: 'pc2-model-b', promptPack: 'pc2-absent' }),
        ]) },
      });
      const afterAbsent = await host.call('snapshot', {});
      expect(afterAbsent.body.status).toBe('ready');
      if (afterAbsent.body.status !== 'ready') throw new Error('the absent-pack settings read failed');
      expect(afterAbsent.body.value.models.find(model => model.id === 'pc2-model-b'))
        .toMatchObject({ promptPack: 'pc2-absent' });
    } finally {
      await host.close();
    }
  }, 60_000);
});
