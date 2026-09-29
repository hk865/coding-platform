import { kernelRunLimits } from '../../src/core/agent-runtime/run-limits.js';
/**
 * R5b.2 chain two: one real read-only Query session loop.
 *
 * Real SQLite records/bodies/Kernel stores, the frozen Kernel public API and a
 * controlled ScriptedProvider. The public no-Plan path creates Project/
 * Workspace/Goal, submits the pending QueryJob, creates the Session and claims
 * it; the model then calls `project_source` at least once (capture/query or an
 * exact read) before answering. The chain verifies that the second provider
 * request really saw the tool result, that the formal answer carries its body
 * ref and a real source witness, that the original Session history holds this
 * round, and that repeated start/observe and a close/reopen read-back add no
 * Turn and no provider call. The Host grant is exactly the trusted read-only
 * configuration (no shell/edit/communication/whiteboard writers).
 *
 * Stage one: `claimQuery` is explicitly `unsupported`, so this is the FIRST RED
 * of the runtime chain and the whole model loop below is UNREACHED by the
 * skeleton. The test is the final acceptance shape; it must not be relaxed.
 *
 * Specification: docs/refactor/tasks/R5b-query-planning-skeleton.md §10.2/§10.4/§10.6.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { QueryJobAnswerRef, QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { DEFAULT_RUNTIME_BUDGET, type RuntimeBudget } from '../../src/contracts/runtime-budget.js';
import { BudgetExceeded, ModelBudget, type ModelTokenBudget } from '../../src/core/agent-runtime/model-budget.js';
import { LOCAL_WORKBENCH_BUDGET } from '../../src/app/runtime-configuration.js';
import { createScriptedModel, digestOf } from '../helpers/B2-runtime-fixture.js';

const AT = '2026-09-26T00:00:00.000Z';
const projectId = 'r5b-loop-project';
const workspaceId = 'r5b-loop-workspace';
const scope = { projectId, workspaceId };
const human = { kind: 'human' as const, id: 'r5b-loop-operator' };
const projectRef = { aggregateType: 'Project' as const, projectId };
const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
const goalRef = { aggregateType: 'Goal' as const, projectId, goalId: 'r5b-loop-goal' };
const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', projectId, workspaceId, queryJobId: 'r5b-loop-job' };
const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', projectId, workspaceId, queryJobId: 'r5b-loop-job', runId: 'r5b-loop-run' };
const queryJobRef2: QueryJobRef = { aggregateType: 'QueryJob', projectId, workspaceId, queryJobId: 'r5b-loop-job-2' };
const queryRunRef2: QueryRunRef = { aggregateType: 'QueryRun', projectId, workspaceId, queryJobId: 'r5b-loop-job-2', runId: 'r5b-loop-run-2' };
const roleBinding = { schemaVersion: 1 as const, bindingId: 'r5b-loop-binding', templateId: 'advisor', templateRevision: '1', bindingVersion: 1, policyRevision: '1' };
const sessionRole = { kind: 'legacy_template' as const, templateId: 'advisor', templateRevision: '1' };
const runtimeBudget: RuntimeBudget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };
/** A real explicit test limit: two declared calls against a one-tool budget make
 * the Kernel start the first and abandon the never-started second. */
const limitRuntimeBudget: RuntimeBudget = { ...runtimeBudget, maxRequests: 4, maxToolCalls: 1 };
const hostInstruction = 'R5b trusted read-only query guidance';

function hostCtx(): CoreCallContext {
  return { projectId, workspaceId, principal: { kind: 'host', actor: human },
    materialReader: { kind: 'host', projectId, workspaceId, actor: human }, signal: new AbortController().signal };
}
/**
 * Query budget: `maxTokens: null` is the explicit no-cumulative-cap default and
 * is NOT 0/Infinity; an explicit positive integer and a deadline stay real
 * constraints. The production contract now declares `number | null`.
 */
const EXPLICIT_QUERY_BUDGET: QueryJobIntentV1['budget'] = { maxTokens: 4096, deadline: null };
const NULL_QUERY_BUDGET: QueryJobIntentV1['budget'] = { maxTokens: null, deadline: null };
function coordinationIntent(queryJobId: string, budget: RuntimeBudget = runtimeBudget,
  queryBudget: QueryJobIntentV1['budget'] = EXPLICIT_QUERY_BUDGET): QueryJobIntentV1 {
  return {
    schemaVersion: 1, intentId: queryJobId, projectId, workspaceId, goalId: goalRef.goalId,
    question: 'Read the project sources and explain the goal',
    focusTaskRefs: [], budget: queryBudget, multiTurn: { maxRounds: 1 },
    correlationId: 'r5b-loop-corr', execution: { kind: 'initial_coordination', roleBinding, runtimeBudget: budget },
  };
}
function submitRequest(
  requestId: string, jobRef: QueryJobRef = queryJobRef, runRef: QueryRunRef = queryRunRef, budget: RuntimeBudget = runtimeBudget,
  queryBudget: QueryJobIntentV1['budget'] = EXPLICIT_QUERY_BUDGET,
) {
  return { meta: { requestId, expected: [
    { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }, { ref: goalRef, revision: 1 },
    { ref: jobRef, revision: 0 }, { ref: runRef, revision: 0 },
  ] }, input: { queryJobId: jobRef.queryJobId, runId: runRef.runId, intent: coordinationIntent(jobRef.queryJobId, budget, queryBudget) } };
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
      return { status: 'ready', value: { subjectKey: 'r5b-loop-host', permissionRevision: 'host-grant-1', allowsRead: () => true } };
    },
  };
}

async function bootstrap(platform: Awaited<ReturnType<typeof createTargetPlatform>>, state: HostState) {
  expect(await platform.projects.createProject(hostCtx(), { meta: { requestId: 'r5b-loop-project-1', expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId } }))
    .toMatchObject({ status: 'committed' });
  const registered = await platform.projects.registerWorkspace(hostCtx(), { meta: { requestId: 'r5b-loop-workspace-1', expected: [
    { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: scope } });
  expect(registered).toMatchObject({ status: 'committed' });
  if (registered.status !== 'committed') throw new Error('Workspace registration failed');
  state.revision = registered.value.revision;
  expect(await platform.goals.createGoal(hostCtx(), { meta: { requestId: 'r5b-loop-goal-1', expected: [
    { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
    input: { goalId: goalRef.goalId, workspace: scope, objective: 'Answer one reading question from real sources' } }))
    .toMatchObject({ status: 'committed' });
}

it('drives project_source through the real Kernel and answers once on the original Session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'next-r5b-loop-'));
  directories.push(directory);
  await mkdir(join(directory, 'src'), { recursive: true });
  await writeFile(join(directory, 'src', 'module.ts'), 'export const r5bLoopMarker = "R5B_LOOP_REAL_SOURCE";\n');
  const skillRoot = join(directory, 'skills');
  await mkdir(join(skillRoot, 'r5b-loop-skill'), { recursive: true });
  await writeFile(join(skillRoot, 'r5b-loop-skill', 'skill.json'), JSON.stringify({ schemaVersion: 1, id: 'r5b-loop-skill', title: 'R5b loop skill', kind: 'instruction', priority: 10, contentFile: 'content.md' }));
  await writeFile(join(skillRoot, 'r5b-loop-skill', 'content.md'), 'R5B_LOOP_SKILL_FROM_REAL_FILE');
  const state: HostState = { revision: null };

  const scripted = createScriptedModel([
    { kind: 'calls', calls: [{ callId: 'r5b-loop-source-1', name: 'project_source', args: { action: 'read', path: 'src/module.ts', maxBytes: 8192, version: { kind: 'working_tree' } } }] },
    { kind: 'text', text: 'R5b loop answer backed by the real source witness' },
  ]);
  let grantedTools: string[] = [];
  const host: RuntimeHostBindings = {
    async resolveConfiguration() {
      return { status: 'rejected', code: 'unsupported', reason: 'this chain never runs Work execution' };
    },
    async resolveQueryConfiguration() {
      grantedTools = ['read', 'project_source'];
      return { status: 'ready', value: {
        configurationRevision: 'r5b-loop-host@1',
        model: { configuration: { revision: 'r5b-loop-host@1', provider: 'deepseek', model: 'r5b-loop-scripted', baseUrl: 'http://127.0.0.1' }, client: scripted.client,
          inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 'r5b-fixture-counter' }) } },
        budget: runtimeBudget,
        tools: [...grantedTools],
        writeScope: [], skills: { resourceRoot: skillRoot, enabledIds: ['r5b-loop-skill'] },
        systemInstruction: hostInstruction,
        hostTemplate: { templateId: 'advisor', revision: '1', digest: digestOf(hostInstruction) },
        deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };

  const options = {
    storage: { kind: 'sqlite' as const, directory },
    workspace: workspaceBindings(directory, state),
    sourcePolicyFor: async (requestedProjectId: string, requestedWorkspaceId: string) =>
      requestedProjectId === projectId && requestedWorkspaceId === workspaceId && state.revision !== null
        ? { root: directory, permissionRevision: 'host-grant-1', allowsRead: () => true } : null,
    runtime: host,
    kernelStores: { entries: [{ adapterId: 'r5b-loop-kernel', storeKey: 'r5b-loop-kernel-store', workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] },
    now: () => AT,
  };
  const platform = await createTargetPlatform(options);
  let answerRef: QueryJobAnswerRef | undefined;
  try {
    await bootstrap(platform, state);
    // Frozen default: an explicit null cumulative Query budget still submits,
    // claims, prepares, reads real sources and answers; it is not truncated.
    expect(await platform.queries.submitQueryJob(hostCtx(),
      submitRequest('r5b-loop-submit-1', queryJobRef, queryRunRef, runtimeBudget, NULL_QUERY_BUDGET)))
      .toMatchObject({ status: 'committed', replayed: false });

    const created = await platform.runtime.createSession(hostCtx(), {
      workspace: scope, role: sessionRole, recommendedRefs: [], initialLinks: [],
      meta: { requestId: 'r5b-loop-session-1', expected: [] },
    });
    expect(created).toMatchObject({ status: 'completed' });
    if (created.status !== 'completed') throw new Error('Session creation did not complete');
    const session = created.value.ref;

    // Stage-one first red: the claim seam is explicitly unsupported.
    const claim = await platform.queries.claimQuery(hostCtx(), {
      meta: { requestId: 'r5b-loop-claim-1', expected: [
        { ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 }, { ref: session, revision: created.value.revision }] },
      input: { queryRunRef, sessionRef: session },
    });
    expect(claim).toMatchObject({ status: 'committed' });
    if (claim.status !== 'committed') throw new Error('Query claim did not commit: ' + JSON.stringify(claim));

    // Prepare and start the ONE fresh run.
    const prepared = await platform.runtime.prepareQuery(hostCtx(), { queryRunRef, requestId: 'r5b-loop-prepare-1' });
    expect(prepared).toMatchObject({ status: 'ready' });
    if (prepared.status !== 'ready') throw new Error('Query preparation did not become ready');
    const started = await platform.runtime.startQuery(hostCtx(), { prepared: prepared.value, consumerId: 'r5b-loop-consumer', requestId: 'r5b-loop-start-1' });
    expect(started).toMatchObject({ status: 'ready' });
    if (started.status !== 'ready') throw new Error('Query start did not become ready');
    const record = started.value;

    // The model made multiple requests inside ONE QueryRun/Turn: the first saw
    // the Query source tool, the second saw the delivered tool body.
    expect(scripted.calls()).toBe(2);
    expect(scripted.requests[0]?.tools.map(tool => tool.name)).toContain('project_source');
    const secondRequest = scripted.requests[1];
    const delivered = secondRequest?.messages.find(message => message.role === 'tool' && message.callId === 'r5b-loop-source-1');
    expect(delivered?.role === 'tool' ? delivered.result.status : undefined).toBe('success');
    if (delivered?.role !== 'tool') throw new Error('the Kernel did not deliver the source tool result');
    const sourceBody = delivered.result.output.find(part => part.kind === 'json');
    expect(sourceBody?.kind === 'json' ? sourceBody.value : undefined).toMatchObject({ status: 'ready', value: {
      path: 'src/module.ts', content: 'export const r5bLoopMarker = "R5B_LOOP_REAL_SOURCE";\n',
      version: { kind: 'working_tree' } } });
    expect(record.run.run.executionState?.requests.length).toBe(2);
    expect(new Set(record.run.run.executionState?.requests.map(entry => entry.requestId)).size).toBe(2);

    // The formal answer carries the real text, body ref and source witness.
    expect(record.answer).not.toBeNull();
    answerRef = record.answer?.ref;
    if (answerRef === undefined) throw new Error('the QueryRun did not record a formal answer');
    const answer = await platform.queries.readQueryAnswer(hostCtx(), answerRef);
    expect(answer).toMatchObject({ status: 'ready', value: { answer: {
      queryJobRef, runRef: queryRunRef, roundIndex: 0, stale: false,
      answer: 'R5b loop answer backed by the real source witness', bodyRef: { kind: 'artifact' } } } });
    if (answer.status === 'ready') {
      expect(answer.value.answer.sources.length).toBeGreaterThan(0);
      expect(answer.value.answer.sources.some(source => source.kind === 'project_source'
        && source.refKey.includes('src/module.ts')
        && source.version === digestOf('export const r5bLoopMarker = "R5B_LOOP_REAL_SOURCE";\n'))).toBe(true);
    }

    // The original Session history holds this round, not a second transcript.
    const history = await platform.runtime.readSessionHistory(hostCtx(), { sessionRef: session, afterCursor: null, throughCursor: null, limit: 100 });
    expect(history).toMatchObject({ status: 'ready' });
    if (history.status === 'ready') {
      expect(history.value.items.some(entry => entry.kind === 'turn_started')).toBe(true);
    }

    // Host grant is the trusted read-only configuration: no writer tool leaks in.
    expect(grantedTools).toEqual(['read', 'project_source']);
    for (const forbidden of ['shell', 'edit', 'write', 'send_message', 'whiteboard_write']) {
      expect(scripted.requests[0]?.tools.map(tool => tool.name)).not.toContain(forbidden);
    }
    expect(scripted.requests[0]?.systemPrompt).toContain(hostInstruction);
    expect(scripted.requests[0]?.systemPrompt).toContain('R5B_LOOP_SKILL_FROM_REAL_FILE');

    // Repeated start/observe must not add a Turn or a provider call.
    const beforeReplay = scripted.calls();
    expect(await platform.runtime.startQuery(hostCtx(), { prepared: prepared.value, consumerId: 'r5b-loop-consumer', requestId: 'r5b-loop-start-1' }))
      .toMatchObject({ status: 'ready' });
    expect(await platform.runtime.observeQuery(hostCtx(), { queryRunRef })).toMatchObject({ status: 'ready' });
    expect(scripted.calls()).toBe(beforeReplay);
  } finally { await platform.close(); }

  // Close/reopen read-back adds no Turn and no provider call.
  const reopenedCalls = scripted.calls();
  const reopened = await createTargetPlatform(options);
  try {
    expect(await reopened.queries.readQueryJob(hostCtx(), queryJobRef)).toMatchObject({ status: 'ready' });
    if (answerRef !== undefined) {
      expect(await reopened.queries.readQueryAnswer(hostCtx(), answerRef)).toMatchObject({ status: 'ready' });
    }
    expect(scripted.calls()).toBe(reopenedCalls);
  } finally { await reopened.close(); }
});

it('terminalizes a real Kernel tool-budget limit whose never-started call is abandoned, releases the Session and lets the next Query reuse it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'next-r5b-limit-'));
  directories.push(directory);
  await mkdir(join(directory, 'src'), { recursive: true });
  await writeFile(join(directory, 'src', 'module.ts'), 'export const r5bLoopMarker = "R5B_LOOP_REAL_SOURCE";\n');
  const skillRoot = join(directory, 'skills');
  await mkdir(join(skillRoot, 'r5b-loop-skill'), { recursive: true });
  await writeFile(join(skillRoot, 'r5b-loop-skill', 'skill.json'), JSON.stringify({ schemaVersion: 1, id: 'r5b-loop-skill', title: 'R5b loop skill', kind: 'instruction', priority: 10, contentFile: 'content.md' }));
  await writeFile(join(skillRoot, 'r5b-loop-skill', 'content.md'), 'R5B_LOOP_SKILL_FROM_REAL_FILE');
  const state: HostState = { revision: null };

  // The provider first declares ONE real tool call, which genuinely settles
  // under the explicit ONE-tool budget. On its second request it declares a
  // SECOND call; the Kernel reaches the real tool cap before that call can
  // start, so the reducer marks the never-started declaration `abandoned` with
  // no result (not `outcome_unknown`). This is a genuine terminal, not a
  // fabricated one.
  const scripted = createScriptedModel([
    { kind: 'calls', calls: [
      { callId: 'r5b-loop-limit-1', name: 'project_source', args: { action: 'read', path: 'src/module.ts', maxBytes: 8192, version: { kind: 'working_tree' } } },
    ] },
    { kind: 'calls', calls: [
      { callId: 'r5b-loop-limit-2', name: 'project_source', args: { action: 'read', path: 'src/module.ts', maxBytes: 8192, version: { kind: 'working_tree' } } },
    ] },
    { kind: 'text', text: 'R5b successor answer after the limited prefix' },
  ]);
  const host: RuntimeHostBindings = {
    async resolveConfiguration() {
      return { status: 'rejected', code: 'unsupported', reason: 'this chain never runs Work execution' };
    },
    async resolveQueryConfiguration() {
      return { status: 'ready', value: {
        configurationRevision: 'r5b-loop-limit-host@1',
        model: { configuration: { revision: 'r5b-loop-limit-host@1', provider: 'deepseek', model: 'r5b-loop-scripted', baseUrl: 'http://127.0.0.1' }, client: scripted.client,
          inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 'r5b-fixture-counter' }) } },
        budget: limitRuntimeBudget,
        tools: ['read', 'project_source'],
        writeScope: [], skills: { resourceRoot: skillRoot, enabledIds: ['r5b-loop-skill'] },
        systemInstruction: hostInstruction,
        hostTemplate: { templateId: 'advisor', revision: '1', digest: digestOf(hostInstruction) },
        deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };

  const options = {
    storage: { kind: 'sqlite' as const, directory },
    workspace: workspaceBindings(directory, state),
    sourcePolicyFor: async (requestedProjectId: string, requestedWorkspaceId: string) =>
      requestedProjectId === projectId && requestedWorkspaceId === workspaceId && state.revision !== null
        ? { root: directory, permissionRevision: 'host-grant-1', allowsRead: () => true } : null,
    runtime: host,
    kernelStores: { entries: [{ adapterId: 'r5b-loop-kernel', storeKey: 'r5b-loop-kernel-store', workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] },
    now: () => AT,
  };
  const platform = await createTargetPlatform(options);
  try {
    await bootstrap(platform, state);
    expect(await platform.queries.submitQueryJob(hostCtx(), submitRequest('r5b-loop-limit-submit-1', queryJobRef, queryRunRef, limitRuntimeBudget)))
      .toMatchObject({ status: 'committed', replayed: false });

    const created = await platform.runtime.createSession(hostCtx(), {
      workspace: scope, role: sessionRole, recommendedRefs: [], initialLinks: [],
      meta: { requestId: 'r5b-loop-limit-session-1', expected: [] },
    });
    expect(created).toMatchObject({ status: 'completed' });
    if (created.status !== 'completed') throw new Error('Session creation did not complete');
    const session = created.value.ref;

    const claim = await platform.queries.claimQuery(hostCtx(), {
      meta: { requestId: 'r5b-loop-limit-claim-1', expected: [
        { ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 }, { ref: session, revision: created.value.revision }] },
      input: { queryRunRef, sessionRef: session },
    });
    expect(claim).toMatchObject({ status: 'committed' });
    if (claim.status !== 'committed') throw new Error('Query claim did not commit: ' + JSON.stringify(claim));

    const prepared = await platform.runtime.prepareQuery(hostCtx(), { queryRunRef, requestId: 'r5b-loop-limit-prepare-1' });
    expect(prepared).toMatchObject({ status: 'ready' });
    if (prepared.status !== 'ready') throw new Error('Query preparation did not become ready');
    const started = await platform.runtime.startQuery(hostCtx(), { prepared: prepared.value, consumerId: 'r5b-loop-limit-consumer', requestId: 'r5b-loop-limit-start-1' });
    expect(started).toMatchObject({ status: 'ready' });
    if (started.status !== 'ready') throw new Error('Query start did not become ready');
    const record = started.value;

    // Stage-one red target: the real Kernel limit is observed as a formal
    // timeout, records NO answer and releases the original Session. The limited
    // Query must not be observed as an answered success.
    expect(scripted.calls(), 'the limited Query settles one call, then stops on the over-budget one').toBe(2);
    expect(record.run.run).toMatchObject({ status: 'closed', outcome: 'timeout' });
    expect(record.job.job).toMatchObject({ status: 'closed', closeReason: { code: 'timeout' } });
    expect(record.answer).toBeNull();
    expect(record.job.job.answerRefs).toEqual([]);
    expect(record.session.occupancy).toBeNull();

    // A later Query on the SAME released Session is claimable; its real Kernel
    // Turn consumes the original projected prefix (the abandoned declaration is
    // omitted, the settled first call/result remain) and answers normally.
    const releasedRevision = record.session.revision;
    expect(await platform.queries.submitQueryJob(hostCtx(), submitRequest('r5b-loop-limit-submit-2', queryJobRef2, queryRunRef2, limitRuntimeBudget)))
      .toMatchObject({ status: 'committed', replayed: false });
    const reuse = await platform.queries.claimQuery(hostCtx(), {
      meta: { requestId: 'r5b-loop-limit-reuse-claim-1', expected: [
        { ref: queryJobRef2, revision: 1 }, { ref: queryRunRef2, revision: 1 }, { ref: session, revision: releasedRevision }] },
      input: { queryRunRef: queryRunRef2, sessionRef: session },
    });
    expect(reuse).toMatchObject({ status: 'committed' });
    if (reuse.status !== 'committed') throw new Error('the released Session did not accept the next Query: ' + JSON.stringify(reuse));
    expect(reuse.value.session.occupancy).toMatchObject({ kind: 'execution', executionRef: queryRunRef2, generation: releasedRevision + 1 });

    const reusePrepared = await platform.runtime.prepareQuery(hostCtx(), { queryRunRef: queryRunRef2, requestId: 'r5b-loop-limit-reuse-prepare-1' });
    expect(reusePrepared).toMatchObject({ status: 'ready' });
    if (reusePrepared.status !== 'ready') throw new Error('the successor Query preparation did not become ready');
    const reuseStarted = await platform.runtime.startQuery(hostCtx(), { prepared: reusePrepared.value, consumerId: 'r5b-loop-limit-consumer-2', requestId: 'r5b-loop-limit-reuse-start-1' });
    expect(reuseStarted).toMatchObject({ status: 'ready' });
    if (reuseStarted.status !== 'ready') throw new Error('the successor Query start did not become ready');
    expect(reuseStarted.value.run.run).toMatchObject({ status: 'answered', outcome: 'answered' });
    expect(reuseStarted.value.answer).not.toBeNull();
    expect(reuseStarted.value.session.occupancy).toBeNull();
    expect(scripted.calls(), 'the successor issues exactly one more provider call').toBe(3);
    const successorRequest = scripted.requests[2];
    expect(successorRequest).toBeDefined();
    if (successorRequest !== undefined) {
      const assistantCalls = successorRequest.messages.flatMap((message) =>
        message.role === 'assistant' ? message.toolCalls.map((call) => call.callId) : []);
      expect(assistantCalls).toContain('r5b-loop-limit-1');
      expect(assistantCalls).not.toContain('r5b-loop-limit-2');
    }
  } finally { await platform.close(); }
});
it('keeps the local workbench budget at the no-cumulative-limit default', () => {
  // Frozen contract: the local workbench reuses DEFAULT_RUNTIME_BUDGET, so an
  // ordinary read is not truncated by hidden per-run request/tool/time caps and
  // one response still carries the declared 4096 output tokens.
  expect(LOCAL_WORKBENCH_BUDGET).toEqual(DEFAULT_RUNTIME_BUDGET);
  expect(LOCAL_WORKBENCH_BUDGET.inputTokens).toBeNull();
  expect(LOCAL_WORKBENCH_BUDGET.outputTokens).toBeNull();
  expect(LOCAL_WORKBENCH_BUDGET.maxRequests).toBeNull();
  expect(LOCAL_WORKBENCH_BUDGET.maxToolCalls).toBeNull();
  expect(LOCAL_WORKBENCH_BUDGET.timeoutMs).toBeNull();
  expect(LOCAL_WORKBENCH_BUDGET.perResponseTokens).toBe(4096);
});

it('keeps explicit numeric and deadline ModelBudget limits while a null token budget imposes no cumulative cap', () => {
  // The frozen narrow persistent-budget shape: `tokenBudget: null` skips only
  // the cumulative sum, never the deadline, and is not 0/Infinity.
  const persist = async () => {};
  const taskBudget = (tokenBudget: number | null, deadline: string | null): ModelTokenBudget =>
    ({ tokenBudget, deadline });
  const numeric = new ModelBudget(runtimeBudget, persist, undefined, taskBudget(512, null), () => AT);
  expect(() => numeric.assertTaskBudgetAdmissible(256, 512)).toThrow(BudgetExceeded);
  const deadline = new ModelBudget(runtimeBudget, persist, undefined,
    taskBudget(null, '2026-09-26T00:00:00.000Z'), () => '2026-09-26T00:00:01.000Z');
  expect(() => deadline.assertTaskBudgetAdmissible(1, 1)).toThrow(BudgetExceeded);
  const uncapped = new ModelBudget(runtimeBudget, persist, undefined, taskBudget(null, null), () => AT);
  expect(() => uncapped.assertTaskBudgetAdmissible(999_999, 999_999)).not.toThrow();
  expect(uncapped.exhausted).toBe(false);
  expect(kernelRunLimits(DEFAULT_RUNTIME_BUDGET, taskBudget(null, '2026-09-26T00:00:10.000Z'), () => AT))
    .toMatchObject({ maxTotalTokens: null, deadlineMs: 10_000 });
});
