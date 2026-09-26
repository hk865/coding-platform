/**
 * R5b.4 chain one: a real initial_coordination answer -> the SAME Plan owner's
 * candidate_v2 -> public governance completion -> original apply -> task graph.
 *
 * The whole path is produced by the real `createTargetPlatform` composition root
 * on a real SQLite ledger, the frozen Kernel and a controlled local provider:
 * public Project/Workspace/Goal (NO Plan/policy/baseline), the formal pending
 * Query submit, a formal Runtime Session, the R5b.2 claim/prepare/start seam,
 * and the model's real `project_source` round before it returns the v2 plan JSON.
 *
 * Stage one: `proposeInitialPlanFromAnswer` is explicitly `unsupported`, so this
 * is the FIRST RED and every candidate/origin/apply/graph assertion below is NOT
 * reached by the skeleton. The test is the final acceptance shape and must not
 * be relaxed to pass early.
 *
 * Specification: docs/refactor/tasks/R5b-query-planning-skeleton.md §11.2-§11.4,
 * §11.6.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { InitialPlanningResponseV2 } from '../../src/contracts/initial-planning.js';
import type { QueryJobAnswerRef, QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createScriptedModel, digestOf } from '../helpers/B2-runtime-fixture.js';

const AT = '2026-09-26T00:00:00.000Z';
const projectId = 'r5b-initial-project';
const workspaceId = 'r5b-initial-workspace';
const scope = { projectId, workspaceId };
const human = { kind: 'human' as const, id: 'r5b-initial-operator' };
const projectRef = { aggregateType: 'Project' as const, projectId };
const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
const goalRef = { aggregateType: 'Goal' as const, projectId, goalId: 'r5b-initial-goal' };
const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: 'r5b-initial-policy', revision: 1 };
const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId };
const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', projectId, workspaceId, queryJobId: 'r5b-initial-job' };
const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', projectId, workspaceId, queryJobId: 'r5b-initial-job', runId: 'r5b-initial-run' };
const roleBinding = { schemaVersion: 1 as const, bindingId: 'r5b-initial-binding', templateId: 'advisor', templateRevision: '1', bindingVersion: 1, policyRevision: '1' };
const sessionRole = { kind: 'legacy_template' as const, templateId: 'advisor', templateRevision: '1' };
const runtimeBudget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };
const hostInstruction = 'R5b initial-plan trusted read-only guidance';

/** The real v2 reply the model returns, typed so the shape is compile-checked. */
const PLAN_RESPONSE: InitialPlanningResponseV2 = {
  schemaVersion: 2,
  kind: 'plan',
  summary: 'Initial plan derived from the real coordination answer',
  plan: {
    schemaVersion: 2,
    stages: [],
    tasks: [
      { taskId: 'work-1', title: 'First ordinary work', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: 'work-2', title: 'Second ordinary work', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: 'goal-gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'future-intent', title: 'Optional future investigation', requirementLevel: 'optional', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'plan_only' },
    ],
    assignments: [
      { taskId: 'work-1', role: 'builder', instruction: 'Do the first ordinary work' },
      { taskId: 'work-2', role: 'builder', instruction: 'Do the second ordinary work' },
    ],
    obligations: [{ obligationId: 'r5b-initial-obligation', title: 'Deliver the initial plan work',
      requirementLevel: 'required', taskIds: ['work-1', 'work-2', 'goal-gate'],
      verificationRequirements: [{ requirementId: 'r5b-initial-static', requirementLevel: 'required',
        kind: 'static', description: 'Registered static command check' }] }],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [] },
    taskRelations: [],
    inputRequirements: [],
  },
};
const PLAN_ANSWER_TEXT = JSON.stringify(PLAN_RESPONSE);

function hostCtx(): CoreCallContext {
  return { projectId, workspaceId, principal: { kind: 'host', actor: human },
    materialReader: { kind: 'host', projectId, workspaceId, actor: human }, signal: new AbortController().signal };
}
function initialCoordinationIntent(): QueryJobIntentV1 {
  return {
    schemaVersion: 1, intentId: queryJobRef.queryJobId, projectId, workspaceId, goalId: goalRef.goalId,
    question: 'Read the project sources and propose the initial plan',
    focusTaskRefs: [], budget: { maxTokens: 4096, deadline: null }, multiTurn: { maxRounds: 1 },
    correlationId: 'r5b-initial-corr', execution: { kind: 'initial_coordination', roleBinding, runtimeBudget },
  };
}
function submitRequest(requestId: string) {
  return { meta: { requestId, expected: [
    { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }, { ref: goalRef, revision: 1 },
    { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 },
  ] }, input: { queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent: initialCoordinationIntent() } };
}

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

type HostState = { revision: number | null };
function workspaceBindings(directory: string, state: HostState): WorkspaceHostBindings {
  return {
    async resolveRoot(requested) {
      if (requested.projectId !== projectId || requested.workspaceId !== workspaceId || state.revision === null) {
        return { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered in this Host' };
      }
      return { status: 'ready', value: { root: directory, workspaceRevision: state.revision } };
    },
    async authorize() {
      return { status: 'ready', value: { subjectKey: 'r5b-initial-host', permissionRevision: 'host-grant-1', allowsRead: () => true } };
    },
  };
}

async function bootstrap(platform: Awaited<ReturnType<typeof createTargetPlatform>>, state: HostState) {
  expect(await platform.projects.createProject(hostCtx(), { meta: { requestId: 'r5b-initial-project-1', expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId } }))
    .toMatchObject({ status: 'committed' });
  const registered = await platform.projects.registerWorkspace(hostCtx(), { meta: { requestId: 'r5b-initial-workspace-1', expected: [
    { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: scope } });
  expect(registered).toMatchObject({ status: 'committed' });
  if (registered.status !== 'committed') throw new Error('Workspace registration failed');
  state.revision = registered.value.revision;
  expect(await platform.goals.createGoal(hostCtx(), { meta: { requestId: 'r5b-initial-goal-1', expected: [
    { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
    input: { goalId: goalRef.goalId, workspace: scope, objective: 'Adopt one real answer-derived initial plan' } }))
    .toMatchObject({ status: 'committed' });
}

/** Public governance completion required only by apply, never by the answer or
 * the candidate (the candidate must stay readable while governance is absent). */
async function completeGovernance(platform: Awaited<ReturnType<typeof createTargetPlatform>>) {
  const host = hostCtx();
  const installed = await platform.completionPolicies.installCompletionPolicy(host, { meta: { requestId: 'r5b-initial-policy-1',
    expected: [{ ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 }] },
    input: { policyId: 'r5b-initial-policy', contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } } });
  expect(installed, 'the CompletionPolicy must install').toMatchObject({ status: 'committed' });
  if (installed.status !== 'committed') throw new Error('policy install failed');
  expect(await platform.completionPolicies.activateCompletionPolicy(host, { meta: { requestId: 'r5b-initial-policy-active',
    expected: [{ ref: projectRef, revision: 1 }, { ref: activeRef, revision: 0 }] },
    input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } } })).toMatchObject({ status: 'committed' });
  expect(await platform.architecture.adoptInitialArchitecture(host, { meta: { requestId: 'r5b-initial-baseline',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
    input: { baselineId: 'r5b-initial-baseline', description: 'The initial plan module boundary', constraints: [], catalog: {
      requireDag: true, dependencies: [], modules: [{ ref: { projectId, moduleId: 'r5b-initial' }, name: 'R5b initial plan',
        responsibility: 'Consume one formal answer into an initial plan', paths: ['src/core/work-graph/tasks'], interfaces: [] }] } } }))
    .toMatchObject({ status: 'committed' });
}

it('consumes one real v2 answer into the same Plan owner candidate, then adopts it through public governance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'next-r5b-initial-'));
  directories.push(directory);
  await mkdir(join(directory, 'src'), { recursive: true });
  await writeFile(join(directory, 'src', 'module.ts'), 'export const r5bInitialMarker = "R5B_INITIAL_REAL_SOURCE";\n');
  const skillRoot = join(directory, 'skills');
  await mkdir(join(skillRoot, 'r5b-initial-skill'), { recursive: true });
  await writeFile(join(skillRoot, 'r5b-initial-skill', 'skill.json'), JSON.stringify({ schemaVersion: 1, id: 'r5b-initial-skill', title: 'R5b initial skill', kind: 'instruction', priority: 10, contentFile: 'content.md' }));
  await writeFile(join(skillRoot, 'r5b-initial-skill', 'content.md'), 'R5B_INITIAL_SKILL_FROM_REAL_FILE');
  const state: HostState = { revision: null };

  const scripted = createScriptedModel([
    { kind: 'calls', calls: [{ callId: 'r5b-initial-source-1', name: 'project_source', args: { action: 'read', path: 'src/module.ts', maxBytes: 8192, version: { kind: 'working_tree' } } }] },
    { kind: 'text', text: PLAN_ANSWER_TEXT },
  ]);
  const host: RuntimeHostBindings = {
    async resolveConfiguration() {
      return { status: 'rejected', code: 'unsupported', reason: 'this chain never runs Work execution' };
    },
    async resolveQueryConfiguration() {
      return { status: 'ready', value: {
        configurationRevision: 'r5b-initial-host@1',
        model: { configuration: { revision: 'r5b-initial-host@1', provider: 'deepseek', model: 'r5b-initial-scripted', baseUrl: 'http://127.0.0.1' }, client: scripted.client,
          inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 'r5b-fixture-counter' }) } },
        budget: runtimeBudget,
        tools: ['read', 'project_source'],
        writeScope: [], skills: { resourceRoot: skillRoot, enabledIds: ['r5b-initial-skill'] },
        systemInstruction: hostInstruction,
        hostTemplate: { templateId: 'advisor', revision: '1', digest: digestOf(hostInstruction) },
        deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };

  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite' as const, directory },
    workspace: workspaceBindings(directory, state),
    sourcePolicyFor: async (requestedProjectId: string, requestedWorkspaceId: string) =>
      requestedProjectId === projectId && requestedWorkspaceId === workspaceId && state.revision !== null
        ? { root: directory, permissionRevision: 'host-grant-1', allowsRead: () => true } : null,
    runtime: host,
    kernelStores: { entries: [{ adapterId: 'r5b-initial-kernel', storeKey: 'r5b-initial-kernel-store', workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] },
    now: () => AT,
  });
  try {
    await bootstrap(platform, state);

    // 1. Formal pending submit, formal Session, then the R5b.2 claim/prepare/start.
    expect(await platform.queries.submitQueryJob(hostCtx(), submitRequest('r5b-initial-submit-1')))
      .toMatchObject({ status: 'committed', replayed: false });
    const created = await platform.runtime.createSession(hostCtx(), {
      workspace: scope, role: sessionRole, recommendedRefs: [], initialLinks: [],
      meta: { requestId: 'r5b-initial-session-1', expected: [] },
    });
    expect(created).toMatchObject({ status: 'completed' });
    if (created.status !== 'completed') throw new Error('Session creation did not complete');
    const sessionRef = created.value.ref;
    const claim = await platform.queries.claimQuery(hostCtx(), {
      meta: { requestId: 'r5b-initial-claim-1', expected: [
        { ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 }, { ref: sessionRef, revision: created.value.revision }] },
      input: { queryRunRef, sessionRef },
    });
    expect(claim).toMatchObject({ status: 'committed' });
    if (claim.status !== 'committed') throw new Error('Query claim did not commit: ' + JSON.stringify(claim));
    const prepared = await platform.runtime.prepareQuery(hostCtx(), { queryRunRef, requestId: 'r5b-initial-prepare-1' });
    expect(prepared).toMatchObject({ status: 'ready' });
    if (prepared.status !== 'ready') throw new Error('Query preparation did not become ready');
    const started = await platform.runtime.startQuery(hostCtx(), { prepared: prepared.value, consumerId: 'r5b-initial-consumer', requestId: 'r5b-initial-start-1' });
    expect(started).toMatchObject({ status: 'ready' });
    if (started.status !== 'ready') throw new Error('Query start did not become ready');

    // 2. The answer is the real v2 plan JSON and keeps the real source witness.
    expect(started.value.job.job.status).toBe('answered');
    expect(started.value.answer).not.toBeNull();
    const answerRef = started.value.answer?.ref as QueryJobAnswerRef | undefined;
    if (answerRef === undefined) throw new Error('the QueryRun did not record a formal answer');
    expect(scripted.calls()).toBe(2);
    const answer = await platform.queries.readQueryAnswer(hostCtx(), answerRef);
    expect(answer).toMatchObject({ status: 'ready', value: { answer: {
      answer: PLAN_ANSWER_TEXT, queryJobRef, runRef: queryRunRef, roundIndex: 0, stale: false } } });
    if (answer.status !== 'ready') throw new Error('formal answer was not readable');
    expect(answer.value.answer.sources.some(source => source.kind === 'project_source'
      && source.refKey.includes('src/module.ts')
      && source.version === digestOf('export const r5bInitialMarker = "R5B_INITIAL_REAL_SOURCE";\n'))).toBe(true);

    // 3. The new Plan owner entry. Stage one is explicitly unsupported, so this
    // is the FIRST RED; everything below is unreached by the skeleton.
    const proposalRequest = {
      meta: { requestId: 'r5b-initial-propose-1', expected: [] },
      input: { answerRef, reason: { text: 'Initial plan from the real coordination answer', sources: [] } },
    };
    const proposed = await platform.plans.proposeInitialPlanFromAnswer(hostCtx(), proposalRequest);
    expect(proposed).toMatchObject({ status: 'committed' });
    if (proposed.status !== 'committed') throw new Error('the answer-derived candidate did not commit: ' + JSON.stringify(proposed));
    const candidate = proposed.value;
    expect(candidate).toMatchObject({ kind: 'candidate_v2', revision: 1, schemaVersion: 2, status: 'candidate', goalRef });
    if (candidate.kind !== 'candidate_v2') throw new Error('the owner did not return a v2 candidate');

    // 4. Full origin identity + digest + the original manifest Goal/Workspace pin.
    const origin = candidate.draft.origin;
    expect(origin).toBeDefined();
    if (origin === undefined) throw new Error('the candidate has no model-coordination origin');
    expect(origin).toMatchObject({
      kind: 'model_coordination',
      answerRef: { ...answerRef },
      answerDigest: sha256Hex(PLAN_ANSWER_TEXT),
      goalRevision: 1,
      workspaceRevision: 1,
      requestId: queryJobRef.queryJobId,
      summary: PLAN_RESPONSE.kind === 'plan' ? PLAN_RESPONSE.summary : '',
      assignments: PLAN_RESPONSE.kind === 'plan' ? PLAN_RESPONSE.plan.assignments : [],
    });

    // 5. The optional plan_only future is preserved with NO assignment/acceptance.
    const future = candidate.draft.tasks.find(task => task.taskId === 'future-intent');
    expect(future).toMatchObject({ requirementLevel: 'optional', executionIntent: 'plan_only' });
    expect(candidate.draft.assignments?.some(assignment => assignment.taskId === 'future-intent')).not.toBe(true);

    // 6. It is not adopted/executable yet; the candidate is readable with no policy.
    const goalBefore = await platform.plans.queryGoal(hostCtx(), goalRef);
    expect(goalBefore).toMatchObject({ status: 'ready', value: { goal: { activePlanRevision: null }, pendingPlan: { kind: 'candidate_v2' } } });
    expect(await platform.plans.readPlanProposal(hostCtx(), candidate.ref)).toMatchObject({ status: 'ready', value: { ref: candidate.ref } });

    // 7. Public governance completion, then the original apply with current pins.
    await completeGovernance(platform);
    const applyRequest = { meta: { requestId: 'r5b-initial-apply-1', expected: [{ ref: goalRef, revision: 1 }] },
      input: { proposalRef: candidate.ref, expectedProposalRevision: candidate.revision, decisionRefs: [] } };
    const applied = await platform.plans.applyPlanChange(hostCtx(), applyRequest);
    expect(applied).toMatchObject({ status: 'committed' });
    if (applied.status !== 'committed') throw new Error('the initial plan was not adopted: ' + JSON.stringify(applied));

    // 8. The adopted graph shows real ordinary work/gate and the optional future.
    const graph = await platform.plans.queryTaskGraph(hostCtx(), { goalRef });
    expect(graph).toMatchObject({ status: 'ready', value: {
      plan: { schemaVersion: 2, origin: { kind: 'model_coordination' } },
      tasks: expect.arrayContaining([
        expect.objectContaining({ ref: expect.objectContaining({ taskId: 'work-1' }) }),
        expect.objectContaining({ ref: expect.objectContaining({ taskId: 'work-2' }) }),
        expect.objectContaining({ ref: expect.objectContaining({ taskId: 'goal-gate' }) }),
        expect.objectContaining({ ref: expect.objectContaining({ taskId: 'future-intent' }),
          definition: expect.objectContaining({ executionIntent: 'plan_only' }) }),
      ]),
    } });

    // 9. Both original requests replay their saved receipts after adoption.
    expect(await platform.plans.proposeInitialPlanFromAnswer(hostCtx(), proposalRequest))
      .toMatchObject({ status: 'committed', replayed: true, value: proposed.value });
    expect(await platform.plans.applyPlanChange(hostCtx(), applyRequest))
      .toMatchObject({ status: 'committed', replayed: true, value: applied.value });
  } finally { await platform.close(); }
});
