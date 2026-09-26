/**
 * R5b.2 chain one: pending QueryJob -> claim -> prepare -> start -> formal
 * readQueryJob/readQueryAnswer over ONE real records/body/Session backend.
 *
 * The whole path is produced by the real `createTargetPlatform` composition
 * root: public Project/Workspace/Goal bootstrap (NO Plan/Policy/baseline), the
 * formal R5b.1 pending submit, a formal Runtime `createSession`, then the R5b.2
 * claim/prepare/start/read seam. The model Host is a trusted double reached only
 * after claim; a real ScriptedModel counts every provider stream so a stage-one
 * run proves the Query path never called a model.
 *
 * Stage one: `claimQuery` is explicitly `unsupported` (the internal
 * QueryExecutionPort is wired with real dependencies but its algorithms are
 * declared only). The assertion below is EXPECTED to be red until the stage-two
 * implementation lands; every later assertion has NOT been reached by this
 * skeleton run. The test must not be relaxed to pass early.
 *
 * Specification: docs/refactor/tasks/R5b-query-planning-skeleton.md §10.3-§10.6.
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
const projectId = 'r5b-exec-project';
const workspaceId = 'r5b-exec-workspace';
const scope = { projectId, workspaceId };
const human = { kind: 'human' as const, id: 'r5b-exec-operator' };
const projectRef = { aggregateType: 'Project' as const, projectId };
const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
const goalRef = { aggregateType: 'Goal' as const, projectId, goalId: 'r5b-exec-goal' };
const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', projectId, workspaceId, queryJobId: 'r5b-exec-job' };
const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', projectId, workspaceId, queryJobId: 'r5b-exec-job', runId: 'r5b-exec-run' };
const roleBinding = { schemaVersion: 1 as const, bindingId: 'r5b-exec-binding', templateId: 'advisor', templateRevision: '1', bindingVersion: 1, policyRevision: '1' };
const sessionRole = { kind: 'legacy_template' as const, templateId: 'advisor', templateRevision: '1' };
const runtimeBudget = { contextWindowTokens: 128000, inputTokens: null, outputTokens: null, maxRequests: 4, maxToolCalls: 8, timeoutMs: null, perResponseTokens: 512 };
const hostInstruction = 'R5b read-only query role guidance';

function hostCtx(): CoreCallContext {
  return { projectId, workspaceId, principal: { kind: 'host', actor: human },
    materialReader: { kind: 'host', projectId, workspaceId, actor: human }, signal: new AbortController().signal };
}

function initialCoordinationIntent(): QueryJobIntentV1 {
  return {
    schemaVersion: 1, intentId: queryJobRef.queryJobId, projectId, workspaceId, goalId: goalRef.goalId,
    question: 'Explain the current goal and outline the next investigation',
    focusTaskRefs: [], budget: { maxTokens: 4096, deadline: null }, multiTurn: { maxRounds: 1 },
    correlationId: 'r5b-exec-corr', execution: { kind: 'initial_coordination', roleBinding, runtimeBudget },
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

type HostState = { revision: number | null; resolveRootCalls: number; authorizeCalls: number };
function workspaceBindings(directory: string, state: HostState): WorkspaceHostBindings {
  return {
    async resolveRoot(requested) {
      state.resolveRootCalls += 1;
      if (requested.projectId !== projectId || requested.workspaceId !== workspaceId || state.revision === null) {
        return { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered in this Host' };
      }
      return { status: 'ready', value: { root: directory, workspaceRevision: state.revision } };
    },
    async authorize() {
      state.authorizeCalls += 1;
      return { status: 'ready', value: { subjectKey: 'r5b-exec-host', permissionRevision: 'host-grant-1', allowsRead: () => true } };
    },
  };
}

async function bootstrap(platform: Awaited<ReturnType<typeof createTargetPlatform>>, state: HostState) {
  expect(await platform.projects.createProject(hostCtx(), { meta: { requestId: 'r5b-exec-project-1', expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId } }))
    .toMatchObject({ status: 'committed' });
  const registered = await platform.projects.registerWorkspace(hostCtx(), { meta: { requestId: 'r5b-exec-workspace-1', expected: [
    { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: scope } });
  expect(registered).toMatchObject({ status: 'committed' });
  if (registered.status !== 'committed') throw new Error('Workspace registration failed');
  state.revision = registered.value.revision;
  expect(await platform.goals.createGoal(hostCtx(), { meta: { requestId: 'r5b-exec-goal-1', expected: [
    { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
    input: { goalId: goalRef.goalId, workspace: scope, objective: 'Deliver one real read-only Query answer' } }))
    .toMatchObject({ status: 'committed' });
}

it('claims one real Session slot, prepares and answers the same QueryRun on one backend', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'next-r5b-exec-'));
  directories.push(directory);
  await writeFile(join(directory, 'notes.txt'), 'R5B_EXEC_REAL_WORKSPACE_CONTENT\n');
  const skillRoot = join(directory, 'skills');
  await mkdir(join(skillRoot, 'r5b-exec-skill'), { recursive: true });
  await writeFile(join(skillRoot, 'r5b-exec-skill', 'skill.json'), JSON.stringify({ schemaVersion: 1, id: 'r5b-exec-skill', title: 'R5b execution skill', kind: 'instruction', priority: 10, contentFile: 'content.md' }));
  await writeFile(join(skillRoot, 'r5b-exec-skill', 'content.md'), 'R5B_EXEC_SKILL_FROM_REAL_FILE');
  const state: HostState = { revision: null, resolveRootCalls: 0, authorizeCalls: 0 };

  const scripted = createScriptedModel([{ kind: 'text', text: 'R5b stage-two answer from the real Kernel loop' }]);
  // The trusted Host double is reached only after claim. It returns the exact
  // read-only Query grant and the versioned legacy template for the Session Role.
  const host: RuntimeHostBindings = {
    async resolveConfiguration() {
      return { status: 'rejected', code: 'unsupported', reason: 'this chain never runs Work execution' };
    },
    async resolveQueryConfiguration() {
      return { status: 'ready', value: {
        configurationRevision: 'r5b-exec-host@1',
        model: { configuration: { revision: 'r5b-exec-host@1', provider: 'deepseek', model: 'r5b-exec-scripted', baseUrl: 'http://127.0.0.1' }, client: scripted.client,
          inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 'r5b-fixture-counter' }) } },
        budget: runtimeBudget,
        tools: ['read', 'project_source'],
        writeScope: [], skills: { resourceRoot: skillRoot, enabledIds: ['r5b-exec-skill'] },
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
    kernelStores: { entries: [{ adapterId: 'r5b-exec-kernel', storeKey: 'r5b-exec-kernel-store', workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] },
    now: () => AT,
  });
  try {
    await bootstrap(platform, state);

    // 1. Formal pending submit, then the original pending pair is read back.
    const submitted = await platform.queries.submitQueryJob(hostCtx(), submitRequest('r5b-exec-submit-1'));
    expect(submitted).toMatchObject({ status: 'committed', replayed: false });
    if (submitted.status !== 'committed') throw new Error('pending submit did not commit');
    const pendingPair = submitted.value;
    expect(pendingPair.job).toMatchObject({ job: { status: 'pending', goalId: goalRef.goalId, runRef: queryRunRef, answerRefs: [] } });
    expect(await platform.queries.readQueryJob(hostCtx(), queryJobRef)).toMatchObject({ status: 'ready', value: pendingPair });

    // 2. Formal Session creation on the same backend. The Query claim must use
    // this exact Session's revision/occupancy slot.
    const created = await platform.runtime.createSession(hostCtx(), {
      workspace: scope, role: sessionRole, recommendedRefs: [], initialLinks: [],
      meta: { requestId: 'r5b-exec-session-1', expected: [] },
    });
    expect(created).toMatchObject({ status: 'completed' });
    if (created.status !== 'completed') throw new Error('Session creation did not complete');
    const sessionRef = created.value.ref;
    expect(created.value.occupancy).toBeNull();

    // 3. Claim. Stage one returns an explicit `unsupported`, so this is the
    // FIRST RED of the skeleton run; the rest of the chain is unreached.
    const claim = await platform.queries.claimQuery(hostCtx(), {
      meta: { requestId: 'r5b-exec-claim-1', expected: [
        { ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 }, { ref: sessionRef, revision: created.value.revision }] },
      input: { queryRunRef, sessionRef },
    });
    expect(claim).toMatchObject({ status: 'committed' });
    if (claim.status !== 'committed') throw new Error('Query claim did not commit: ' + JSON.stringify(claim));
    const claimed = claim.value;
    // Claim binds the SAME Session generation and records the QueryRun as the
    // occupancy holder; the Job is still pending until start.
    expect(claimed.session.ref).toEqual(sessionRef);
    expect(claimed.session.occupancy).toMatchObject({ kind: 'execution', executionRef: queryRunRef, generation: created.value.revision + 1 });
    expect(claimed.run.run.executionState).toMatchObject({ phase: 'claimed', sessionRef, sessionGeneration: created.value.revision + 1 });
    expect(await platform.queries.readQueryJob(hostCtx(), queryJobRef)).toMatchObject({ status: 'ready', value: { job: pendingPair.job, run: claimed.run } });

    // 4. Prepare reads the real Goal/Workspace and saves the bounded manifest
    // body owned by this QueryRun (no model call, no current material grant).
    const prepared = await platform.runtime.prepareQuery(hostCtx(), { queryRunRef, requestId: 'r5b-exec-prepare-1' });
    expect(prepared).toMatchObject({ status: 'ready' });
    if (prepared.status !== 'ready') throw new Error('Query preparation did not become ready');
    expect(prepared.value).toMatchObject({ queryRunRef, bundleRef: { kind: 'artifact' } });

    // 5. Start runs the ONE Kernel loop; the answer comes from the real turn.
    const started = await platform.runtime.startQuery(hostCtx(), { prepared: prepared.value, consumerId: 'r5b-exec-consumer', requestId: 'r5b-exec-start-1' });
    expect(started).toMatchObject({ status: 'ready' });
    if (started.status !== 'ready') throw new Error('Query start did not become ready');
    const record = started.value;
    expect(record.job.job.status).toBe('answered');
    expect(record.run.run).toMatchObject({ status: 'answered', executionState: { phase: 'settled', sessionRef, sessionGeneration: created.value.revision + 1 } });
    expect(record.session.ref).toEqual(sessionRef);
    expect(record.session.occupancy).toBeNull();
    expect(record.answer).not.toBeNull();
    const answerRef = record.answer?.ref as QueryJobAnswerRef | undefined;
    if (answerRef === undefined) throw new Error('the QueryRun did not record a formal answer');
    const answer = await platform.queries.readQueryAnswer(hostCtx(), answerRef);
    expect(answer).toMatchObject({ status: 'ready', value: { answer: { answerId: answerRef.answerId, queryJobRef, runRef: queryRunRef, roundIndex: 0, stale: false } } });

    // 6. Replaying the original submit must not execute a second time.
    expect(await platform.queries.submitQueryJob(hostCtx(), submitRequest('r5b-exec-submit-1')))
      .toMatchObject({ status: 'committed', replayed: true, value: submitted.value });
    expect(scripted.calls()).toBeGreaterThan(0);
  } finally { await platform.close(); }
});
