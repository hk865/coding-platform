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
const roleBinding = { schemaVersion: 1 as const, bindingId: 'r5b-loop-binding', templateId: 'advisor', templateRevision: '1', bindingVersion: 1, policyRevision: '1' };
const sessionRole = { kind: 'legacy_template' as const, templateId: 'advisor', templateRevision: '1' };
const runtimeBudget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };
const hostInstruction = 'R5b trusted read-only query guidance';

function hostCtx(): CoreCallContext {
  return { projectId, workspaceId, principal: { kind: 'host', actor: human },
    materialReader: { kind: 'host', projectId, workspaceId, actor: human }, signal: new AbortController().signal };
}
function initialCoordinationIntent(): QueryJobIntentV1 {
  return {
    schemaVersion: 1, intentId: queryJobRef.queryJobId, projectId, workspaceId, goalId: goalRef.goalId,
    question: 'Read the project sources and explain the goal',
    focusTaskRefs: [], budget: { maxTokens: 4096, deadline: null }, multiTurn: { maxRounds: 1 },
    correlationId: 'r5b-loop-corr', execution: { kind: 'initial_coordination', roleBinding, runtimeBudget },
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
    expect(await platform.queries.submitQueryJob(hostCtx(), submitRequest('r5b-loop-submit-1'))).toMatchObject({ status: 'committed', replayed: false });

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
