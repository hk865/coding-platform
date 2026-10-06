/**
 * A.2 step 5.4 through the public composition root on SQLite
 * (docs/refactor/STATE-MACHINES-SPEC.md §4 P4, TASK-03, TASK-16, TASK-28, 4.3
 * "处理步骤"; §5 ATT-16; §6 RUN-01/02/07; §9 VR-01 cover, VR-09; §13 ND-3, ND-9;
 * decisions D-3, C1, C3, C8, LA-5; lead decision LD-1).
 *
 * The Host drives the real Workflow over a real Kernel with the scripted model,
 * a real ProcessSandbox for the registered check (`test -f fixed.txt`) and one
 * SQLite ledger. The operator requeues through `claims.requeueTask`:
 *
 * 1. Run 1 completes and its round finalizes FAIL: the Task is `failed` with
 *    the C1 failure facts (class `check_failed`, the human may requeue, the
 *    automation verdict is AV-12 `requeue`, judged since 5.8; the Workflow
 *    does not act on it yet, so the operator requeues here).
 * 2. TASK-16: the operator's requeue commits TaskRequeue@1 (afterRoundRef = the
 *    FAIL head, its evidence superseded, the history source of Run 1's Kernel
 *    terminal); the Task projects P4 `pending/requeued` with `requeueRef`. The
 *    same request replays; another request on the same afterRun is
 *    `revision_conflict` with `current = [TaskRequeue@1]`; VR-01 refuses a
 *    new round on the covered Run.
 * 3. TASK-03 / ATT-16 / RUN-01: the Workflow claims with that `requeueRef` in
 *    Run 1's Session; RUN-02 binds the continuation brief (C3), whose marker
 *    reaches the model, and `readContinuationBrief` returns it; RUN-07 writes
 *    `terminalPayload`.
 * 4. TASK-28: Run 2 fails the same way on the same source; a second requeue
 *    with nothing new is the committed `no_new_basis` refusal
 *    (TaskReworkRefusal@1 keyed by Run 2, matched to the first requeue), shown
 *    in `TaskRow.failure.automation.lastRefusal`; a requeue with an operator
 *    note (stored as an Artifact, a new input) is accepted.
 * 5. Run 3's round passes once the source is fixed and the Task completes:
 *    the earlier FAIL evidence is excluded (TD-2).
 *
 * No real model is called: three scripted text replies.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { continuationBriefDigest, continuationBriefMarker } from '../../src/contracts/continuation-brief.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { TaskRequeueOutcomeV1 } from '../../src/contracts/task-requeue.js';
import type { RoundSnapshot, TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { RequeueTaskInput } from '../../src/core/work-graph/tasks/claim-contracts.js';
import type { RecordCommitObserver } from '../../src/composition/commit-observer.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';

const AT = '2026-10-05T00:00:00.000Z';
const projectId = 'a2-requeue-project';
const workspaceId = 'a2-requeue-workspace';
const scope = { projectId, workspaceId };
const hostActor = { kind: 'human' as const, id: 'a2-requeue-operator' };
const projectRef = { aggregateType: 'Project' as const, projectId };
const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
const goalRef = { aggregateType: 'Goal' as const, projectId, goalId: 'a2-requeue-goal' };
const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: 'a2-requeue-policy', revision: 1 };
const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId };
const roleBinding = { schemaVersion: 1 as const, bindingId: 'a2-requeue-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
const runtimeBudget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
  maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };
const CHECK_ID = 'a2-requeue-check';
const TASK = { projectId, goalId: goalRef.goalId, taskId: 'work-1' };

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
const directories: string[] = [];
const platforms: Platform[] = [];
afterEach(async () => {
  for (const platform of platforms.splice(0)) await platform.close().catch(() => undefined);
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

function ctx(): CoreCallContext {
  return { projectId, workspaceId, principal: { kind: 'host', actor: hostActor },
    materialReader: { kind: 'host', projectId, workspaceId, actor: hostActor }, signal: new AbortController().signal };
}

function workspaceBindings(directory: string, state: { revision: number }): WorkspaceHostBindings {
  return {
    async resolveRoot(requested) {
      if (requested.projectId !== projectId || requested.workspaceId !== workspaceId) {
        return { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered in this Host' };
      }
      return { status: 'ready', value: { root: directory, workspaceRevision: state.revision } };
    },
    async authorize() {
      return { status: 'ready', value: { subjectKey: 'a2-requeue-host', permissionRevision: 'a2-requeue-grant-1', allowsRead: () => true } };
    },
  };
}

function runtimeHost(scripted: ReturnType<typeof createScriptedModel>): RuntimeHostBindings {
  return {
    async resolveConfiguration(context, request) {
      if (context.projectId !== projectId || context.workspaceId !== workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'the runtime Host is not bound to this workspace' };
      }
      if (request.roleResolution.status === 'inadmissible') {
        return { status: 'rejected', code: 'forbidden', reason: 'the current Role binding is inadmissible' };
      }
      return { status: 'ready', value: {
        configurationRevision: 'a2-requeue-host-config@1',
        model: { configuration: { revision: 'a2-requeue-host-config@1', provider: 'deepseek', model: 'a2-requeue-scripted',
          baseUrl: 'http://127.0.0.1' },
        client: scripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const,
          tokenizer: 'a2-requeue-counter' }) } },
        budget: runtimeBudget,
        hostTemplate: request.role.kind === 'legacy_template'
          ? { templateId: 'builder', revision: '1', digest: sha256Hex('A2 requeue trusted static role guidance') } : null,
        tools: ['read'], writeScope: [], skills: { resourceRoot: fileURLToPath(new URL('../../vendor/coding-agent/resources/skills',
          import.meta.url)), enabledIds: [] },
        systemInstruction: 'A2 requeue trusted static role guidance', deniedPrefixes: [],
        processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };
}

function planDraft(): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId: 'a2-requeue-plan', planRevision: 1, goalId: goalRef.goalId, stages: [],
    tasks: [
      { taskId: 'work-1', title: 'Ordinary work', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: 'goal-gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 'work-1', role: 'builder', instruction: 'Do the ordinary work' }],
    obligations: [{ obligationId: 'a2-requeue-obligation', title: 'Deliver the work', requirementLevel: 'required',
      taskIds: ['work-1', 'goal-gate'],
      verificationRequirements: [{ requirementId: 'a2-requeue-static', requirementLevel: 'required', kind: 'static',
        description: 'Registered static command check' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

type Environment = { platform: Platform; scripted: ReturnType<typeof createScriptedModel>; workspaceRoot: string;
  workspaceRevision: number };

async function openEnvironment(commitObserver?: RecordCommitObserver): Promise<Environment> {
  const directory = await mkdtemp(join(tmpdir(), 'next-a2-requeue-'));
  directories.push(directory);
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'next-a2-requeue-source-'));
  directories.push(workspaceRoot);
  await writeFile(join(workspaceRoot, 'source.txt'), 'A2 requeue registered workspace source\n');
  const state = { revision: 1 };
  const scripted = createScriptedModel(Array.from({ length: 3 }, (_, index) => ({ kind: 'text' as const,
    text: `A2 requeue work result ${index + 1}` })));
  const checks: TrustedCheckConfiguration = {
    configurationRevision: 'a2-requeue-checks-1', workspace: workspaceRef, executor: hostActor,
    permissionRevision: 'a2-requeue-grant-1', sourceAccess: 'verification_workspace', processAccess: 'all_except_denied',
    deniedPrefixes: ['.git'],
    checks: [{ checkId: CHECK_ID, kind: 'static', command: 'test -f fixed.txt', cwd: '.', timeoutMs: 60_000, taskIds: 'all' }],
  };
  const workflow: WorkflowHostConfiguration = {
    consumerId: 'a2-requeue-consumer',
    bindings: [{ workspace: scope, sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding, budget: { tokenBudget: 100000, deadline: null } }],
  };
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory }, workspace: workspaceBindings(workspaceRoot, state), now: () => AT,
    kernelStores: { entries: [{ adapterId: 'a2-requeue-kernel', storeKey: 'a2-requeue-kernel-store',
      workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] },
    runtime: runtimeHost(scripted), checks, workflow, ...(commitObserver === undefined ? {} : { commitObserver }),
  });
  platforms.push(platform);
  const host = ctx();
  expect(await platform.projects.createProject(host, { meta: { requestId: 'a2-project',
    expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId } })).toMatchObject({ status: 'committed' });
  const registered = await platform.projects.registerWorkspace(host, { meta: { requestId: 'a2-workspace',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: scope } });
  if (registered.status !== 'committed') throw new Error('Workspace registration failed');
  state.revision = registered.value.revision;
  const installed = await platform.completionPolicies.installCompletionPolicy(host, { meta: { requestId: 'a2-policy',
    expected: [{ ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 }] },
    input: { policyId: 'a2-requeue-policy', contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } } });
  if (installed.status !== 'committed') throw new Error('policy install failed');
  expect(await platform.completionPolicies.activateCompletionPolicy(host, { meta: { requestId: 'a2-policy-active',
    expected: [{ ref: projectRef, revision: 1 }, { ref: activeRef, revision: 0 }] },
    input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } } })).toMatchObject({ status: 'committed' });
  expect(await platform.architecture.adoptInitialArchitecture(host, { meta: { requestId: 'a2-baseline',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: state.revision }] },
    input: { baselineId: 'a2-baseline', description: 'The A2 requeue module boundary', constraints: [], catalog: {
      requireDag: true, dependencies: [], modules: [{ ref: { projectId, moduleId: 'a2-requeue' }, name: 'A2 requeue',
        responsibility: 'Rework failed work', paths: ['src'], interfaces: [] }] } } })).toMatchObject({ status: 'committed' });
  expect(await platform.goals.createGoal(host, { meta: { requestId: 'a2-goal',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: state.revision }] },
    input: { goalId: goalRef.goalId, workspace: scope, objective: 'Rework failed work through a requeue' } }))
    .toMatchObject({ status: 'committed' });
  const proposed = await platform.plans.proposePlan(host, { meta: { requestId: 'a2-plan-propose', expected: [] },
    input: { goalRef, basedOn: null, draft: planDraft(), reason: { text: 'Initial A2 requeue plan', sources: [] } } });
  if (proposed.status !== 'committed') throw new Error('Plan proposal failed');
  const applied = await platform.plans.applyPlanChange(host, { meta: { requestId: 'a2-plan-apply', expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error('Plan adoption failed');
  return { platform, scripted, workspaceRoot, workspaceRevision: state.revision };
}

const select = (flowId: string): WorkflowAdvanceInput =>
  ({ schemaVersion: 1, goalRef, flowId, sessionHint: null, kind: 'select_work', taskId: 'work-1' });

/** The Host drives every returned `next` until the Workflow settles. */
async function drive(platform: Platform, first: WorkflowAdvanceInput): Promise<WorkflowStepReceipt[]> {
  const receipts: WorkflowStepReceipt[] = [];
  let input = first;
  for (let guard = 0; guard < 64; guard += 1) {
    const result = await platform.workflow.advanceWork(ctx(), input);
    if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
    if (result.value.receipt !== null) receipts.push(result.value.receipt);
    if (result.value.state === 'completed' || result.value.next === null) return receipts;
    input = result.value.next;
  }
  throw new Error('the Workflow did not settle within the step guard');
}

async function taskRow(platform: Platform) {
  const graph = await platform.plans.queryTaskGraph(ctx(), { goalRef });
  if (graph.status !== 'ready') throw new Error('the task graph must be readable');
  const row = graph.value.tasks.find(candidate => candidate.ref.taskId === 'work-1');
  if (row === undefined) throw new Error('work-1 is not in the graph');
  return row;
}

async function readRun(platform: Platform, runRef: RunRef) {
  const read = await platform.executions.readExecution(ctx(), runRef);
  if (read.status !== 'ready') throw new Error(`the Run must be readable: ${JSON.stringify(read)}`);
  return read.value;
}

function roundOf(receipts: readonly WorkflowStepReceipt[]): RoundSnapshot {
  const receipt = receipts.find(candidate => candidate.kind === 'open_checks');
  if (receipt?.kind !== 'open_checks' || receipt.result.status !== 'committed') throw new Error('the open must commit');
  return receipt.result.value;
}

/** A Host requeue pinned to the Goal and the afterRun as they are now. */
async function requeue(platform: Platform, requestId: string, afterRunRef: RunRef,
  extra: Partial<RequeueTaskInput> = {}): Promise<WriteResult<TaskRequeueOutcomeV1>> {
  const goal = await platform.plans.queryGoal(ctx(), goalRef);
  if (goal.status !== 'ready') throw new Error('the Goal must be readable');
  const run = await readRun(platform, afterRunRef);
  return platform.claims.requeueTask!(ctx(), { meta: { requestId, expected: [{ ref: goalRef, revision: goal.value.goal.revision },
    { ref: afterRunRef, revision: run.run.revision }] },
    input: { taskRef: TASK, afterRunRef, reason: 'the registered check failed; try again', ...extra } });
}

it('D-3: FAIL → TaskRequeue (P4) → requeue claim with the continuation brief → no_new_basis refusal → note → PASS completes', async () => {
  const { platform, scripted, workspaceRoot } = await openEnvironment();

  // 1. Run 1 completes; `test -f fixed.txt` fails; the Task is failed with the C1 facts.
  const first = await drive(platform, select('a2-requeue-flow-1'));
  const round1 = roundOf(first);
  const failed = await taskRow(platform);
  expect(failed).toMatchObject({ effectivePhase: 'failed', phaseCause: { code: 'check_failed' },
    failure: { subjectKind: 'work', failureClass: 'check_failed', notReworkableCause: null,
      round: { roundRef: round1.ref, outcome: 'FAIL' },
      automation: { coveringRequeue: null, lastRefusal: null,
        verdict: { kind: 'requeue', failureClass: 'check_failed', retryAfterRefusal: false } } } });
  expect(failed.failure?.requeueActors).toContain('human');
  expect(failed.rework).toBeUndefined();
  expect(failed.requeueRef).toBeUndefined();
  const run1Ref = failed.execution;
  if (run1Ref === null) throw new Error('work-1 must have a selected Run');
  const run1 = await readRun(platform, run1Ref);
  // RUN-07 (C1): the Kernel terminal payload is kept on the ended Run.
  expect(run1.run).toMatchObject({ status: 'ended', outcome: 'completed', terminalPayload: { kind: 'completed' } });
  const failedRound = await platform.evidence.readVerification(ctx(), round1.ref);
  if (failedRound.status !== 'ready') throw new Error('round 1 must be readable');
  expect(failedRound.value).toMatchObject({ status: 'finalized', outcome: 'FAIL' });

  // 2. TASK-16: the operator's requeue writes TaskRequeue@1 and the Task projects P4.
  const requeued = await requeue(platform, 'a2-requeue-1', run1Ref);
  if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') throw new Error(`requeue 1: ${JSON.stringify(requeued)}`);
  const requeue1 = requeued.value.requeue;
  expect(requeue1).toMatchObject({ revision: 1, afterRunRef: run1Ref, afterOutcome: 'completed', afterRoundRef: round1.ref,
    failureClass: 'check_failed', basisComparison: 'compared', requestedBy: hostActor,
    automation: { automatic: false, counted: false, autoCount: 0, cap: null },
    supersededEvidenceIds: failedRound.value.evidenceRefs.map(ref => ref.evidenceId),
    historySource: { sessionRef: run1.run.executionHistory?.sessionRef, throughPosition: run1.run.executionHistory?.endPosition } });
  // The same request replays the committed value; another request on the same afterRun is stale.
  expect(await requeue(platform, 'a2-requeue-1', run1Ref)).toMatchObject({ status: 'committed', replayed: true,
    value: { kind: 'requeued', requeue: requeue1 } });
  expect(await requeue(platform, 'a2-requeue-1b', run1Ref)).toMatchObject({ status: 'rejected', code: 'revision_conflict',
    current: [{ ref: requeue1.ref, revision: 1 }] });
  const pending = await taskRow(platform);
  expect(pending).toMatchObject({ effectivePhase: 'pending', phaseCause: { code: 'requeued', detail: { requeueRef: requeue1.ref } },
    requeueRef: requeue1.ref, rework: { entries: [{ ref: requeue1.ref, afterRunRef: run1Ref, failureClass: 'check_failed',
      automatic: false }] } });
  // VR-01: the covered Run never opens a new chain.
  const reopened = await platform.evidence.openVerification(ctx(), { meta: { requestId: 'a2-reopen', expected: [] },
    input: { subject: TASK, subjectRunRef: run1Ref, planRef: round1.adoptedPlanRef } });
  expect(reopened).toMatchObject({ status: 'rejected', code: 'forbidden' });

  // 3. TASK-03: the Workflow claims with the requeueRef in Run 1's Session; the brief reaches the model.
  const second = await drive(platform, select('a2-requeue-flow-2'));
  const claim2 = second.find(receipt => receipt.kind === 'claim_task');
  expect(claim2).toMatchObject({ result: { status: 'committed' } });
  const failedAgain = await taskRow(platform);
  const run2Ref = failedAgain.execution;
  if (run2Ref === null || run2Ref.runId === run1Ref.runId) throw new Error('Run 2 must be the selected Run');
  const run2 = await readRun(platform, run2Ref);
  expect(run2.run).toMatchObject({ requeueRef: requeue1.ref, status: 'ended', outcome: 'completed' });
  expect(run2.run.executionHistory?.sessionRef).toEqual(run1.run.executionHistory?.sessionRef);
  const digest2 = run2.run.inputBinding?.continuationBriefDigest;
  if (digest2 === undefined) throw new Error('the requeue Run must bind its continuation brief');
  expect(JSON.stringify(scripted.requests[1])).toContain(continuationBriefMarker(digest2));
  expect(JSON.stringify(scripted.requests[0])).not.toContain('[continuation-brief v1');
  const brief2 = await platform.runtime.readContinuationBrief(ctx(), { runRef: run2Ref });
  if (brief2.status !== 'ready' || brief2.value === null) throw new Error(`the brief must be readable: ${JSON.stringify(brief2)}`);
  expect(brief2.value.digest).toBe(digest2);
  expect(continuationBriefDigest(brief2.value.brief)).toBe(digest2);
  expect(brief2.value.brief).toMatchObject({ runRef: run2Ref, task: TASK, requeueRef: requeue1.ref, mode: 'rework',
    failureClass: 'check_failed', trigger: { actorClass: 'human', goalResume: false, requeueNumber: 1, autoRework: null },
    previous: { runRef: run1Ref, outcome: 'completed' } });
  expect(await platform.runtime.readContinuationBrief(ctx(), { runRef: run1Ref })).toEqual({ status: 'ready', value: null });
  // Run 2's own chain finalizes FAIL again (the source did not change).
  expect(failedAgain).toMatchObject({ effectivePhase: 'failed', phaseCause: { code: 'check_failed' } });
  expect(roundOf(second).subjectRunRef).toEqual(run2Ref);

  // 4. TASK-28: the same failure on the same source with nothing new is the committed no_new_basis refusal.
  const refused = await requeue(platform, 'a2-requeue-2', run2Ref);
  if (refused.status !== 'committed' || refused.value.kind !== 'refused') throw new Error(`requeue 2: ${JSON.stringify(refused)}`);
  expect(refused.value.refusal).toMatchObject({ revision: 1, code: 'no_new_basis', failureClass: 'check_failed',
    matchedRequeueRef: requeue1.ref, afterRunRef: run2Ref, requestedBy: hostActor,
    ref: { operation: 'requeue', subjectId: run2Ref.runId } });
  // The committed refusal replays as itself (§1.2: a value, not a CoreError).
  expect(await requeue(platform, 'a2-requeue-2', run2Ref)).toMatchObject({ status: 'committed', replayed: true,
    value: { kind: 'refused', refusal: refused.value.refusal } });
  const stillFailed = await taskRow(platform);
  expect(stillFailed).toMatchObject({ effectivePhase: 'failed',
    failure: { automation: { lastRefusal: { code: 'no_new_basis', revision: 1, stale: false } } } });
  expect(stillFailed.requeueRef).toBeUndefined();
  // ND-9: an operator note is stored as an Artifact and is a new input: the requeue is accepted.
  const withNote = await requeue(platform, 'a2-requeue-3', run2Ref, { note: 'create fixed.txt before the check' });
  if (withNote.status !== 'committed' || withNote.value.kind !== 'requeued') throw new Error(`requeue 3: ${JSON.stringify(withNote)}`);
  const requeue2 = withNote.value.requeue;
  expect(requeue2.newInputRefs).toEqual([{ kind: 'artifact', ref: expect.objectContaining({ contentType: 'text/plain; charset=utf-8' }) }]);
  expect(requeue2.basis.digest).not.toBe(requeue1.basis.digest);

  // 5. The source is fixed; Run 3's round passes and the Task completes despite the earlier FAIL evidence (TD-2).
  await writeFile(join(workspaceRoot, 'fixed.txt'), 'fixed\n');
  const third = await drive(platform, select('a2-requeue-flow-3'));
  expect(third.find(receipt => receipt.kind === 'complete_task')).toMatchObject({ result: { status: 'committed' } });
  const done = await taskRow(platform);
  expect(done).toMatchObject({ effectivePhase: 'satisfied' });
  expect(done.failure).toBeUndefined();
  expect(done.rework?.entries.map(entry => entry.afterRunRef.runId)).toEqual([run1Ref.runId, run2Ref.runId]);
  const run3 = await readRun(platform, done.execution!);
  const brief3 = await platform.runtime.readContinuationBrief(ctx(), { runRef: run3.run.ref });
  expect(brief3).toMatchObject({ status: 'ready', value: { brief: { requeueRef: requeue2.ref,
    trigger: { requeueNumber: 2, earlierRequeues: [{ afterRunId: run1Ref.runId, failureClass: 'check_failed' }] } } } });
  expect(scripted.calls(), 'one model call per Run').toBe(3);
}, 120_000);

it('§4.3 / §4.4: 0-commit refusals of a requeue — shape, pins, a verifying Task and new inputs (ND-9)', async () => {
  const { platform } = await openEnvironment();
  // Run 1 completes; the Workflow stops before the open, so the Task is verifying (P11).
  let input: WorkflowAdvanceInput = select('a2-requeue-reject-flow');
  for (let guard = 0; guard < 32; guard += 1) {
    if (input.kind === 'perform' && input.operation.kind === 'open_checks') break;
    const result = await platform.workflow.advanceWork(ctx(), input);
    if (result.status !== 'ready' || result.value.next === null) throw new Error(`the Workflow must reach the open: ${JSON.stringify(result)}`);
    input = result.value.next;
  }
  const verifying = await taskRow(platform);
  expect(verifying).toMatchObject({ effectivePhase: 'verifying', phaseCause: { code: 'awaiting_verification' } });
  const run1Ref = verifying.execution!;
  // §4.4 verifying → busy; nothing is written.
  expect(await requeue(platform, 'a2-reject-verifying', run1Ref)).toMatchObject({ status: 'rejected', code: 'busy' });

  // The open, the check and the finalize: the Task is failed (P7).
  for (let guard = 0; guard < 32; guard += 1) {
    const result = await platform.workflow.advanceWork(ctx(), input);
    if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
    if (result.value.state === 'completed' || result.value.next === null) break;
    input = result.value.next;
  }
  expect(await taskRow(platform)).toMatchObject({ effectivePhase: 'failed', phaseCause: { code: 'check_failed' } });
  const goal = await platform.plans.queryGoal(ctx(), goalRef);
  if (goal.status !== 'ready') throw new Error('the Goal must be readable');
  const run1 = await readRun(platform, run1Ref);
  const pins = [{ ref: goalRef, revision: goal.value.goal.revision }, { ref: run1Ref, revision: run1.run.revision }];
  const write = (requestId: string, body: Record<string, unknown>, expected: unknown[] = pins) =>
    platform.claims.requeueTask!(ctx(), { meta: { requestId, expected: expected as never },
      input: { taskRef: TASK, afterRunRef: run1Ref, reason: 'retry', ...body } as RequeueTaskInput });
  // Request shape (§4.1): a non-empty reason, no unknown field, the Goal and afterRun pins.
  expect(await write('a2-reject-reason', { reason: '  ' })).toMatchObject({ status: 'rejected', code: 'invalid' });
  expect(await write('a2-reject-field', { actorClass: 'human' })).toMatchObject({ status: 'rejected', code: 'invalid' });
  expect(await write('a2-reject-pins', {}, [pins[0]])).toMatchObject({ status: 'rejected', code: 'invalid' });
  // §13.2 point 5: stale pins answer with the current version.
  expect(await write('a2-reject-goal', {}, [{ ...pins[0], revision: pins[0]!.revision + 1 }, pins[1]]))
    .toMatchObject({ status: 'rejected', code: 'revision_conflict', current: [pins[0]] });
  expect(await write('a2-reject-run', {}, [pins[0], { ...pins[1], revision: pins[1]!.revision - 1 }]))
    .toMatchObject({ status: 'rejected', code: 'revision_conflict', current: [pins[1]] });
  // ND-9: a new input must be a stored Artifact or an answered message.
  expect(await write('a2-reject-message', { newInputRefs: [{ kind: 'session_message', ref: { aggregateType: 'SessionMessage',
    projectId, workspaceId, messageId: 'no-such-message' } }] })).toMatchObject({ status: 'rejected', code: 'invalid' });
  // A message of another workspace is never a new input here: refused before it is read.
  expect(await write('a2-reject-foreign-message', { newInputRefs: [{ kind: 'session_message', ref: {
    aggregateType: 'SessionMessage', projectId, workspaceId: 'a2-requeue-other-workspace', messageId: 'answered-elsewhere' } }] }))
    .toMatchObject({ status: 'rejected', code: 'forbidden' });
  expect(await write('a2-reject-artifact', { newInputRefs: [{ kind: 'artifact', ref: { kind: 'artifact', contentType: 'text/plain',
    digest: 'f'.repeat(64), sizeBytes: 3, source: { kind: 'workspace', refId: workspaceId, revision: '1' } } }] }))
    .toMatchObject({ status: 'rejected', code: 'invalid' });
  // C1 (§4.4): a trigger belongs to the Goal fan-out only.
  expect(await write('a2-reject-trigger', { trigger: { kind: 'goal_resume', goalRef, resumedEpoch: 2, pausedEpoch: 1 } }))
    .toMatchObject({ status: 'rejected', code: 'invalid' });
  // Nothing above committed: the Task is still failed with no rework record.
  const untouched = await taskRow(platform);
  expect(untouched).toMatchObject({ effectivePhase: 'failed' });
  expect(untouched.rework).toBeUndefined();
  expect(untouched.requeueRef).toBeUndefined();
}, 120_000);

/** Advance the Workflow from `first` until its next step is `perform <kind>`, which is returned unperformed. */
async function advanceUntil(platform: Platform, first: WorkflowAdvanceInput, kind: string): Promise<WorkflowAdvanceInput> {
  let input = first;
  for (let guard = 0; guard < 32; guard += 1) {
    if (input.kind === 'perform' && input.operation.kind === kind) return input;
    const result = await platform.workflow.advanceWork(ctx(), input);
    if (result.status !== 'ready' || result.value.next === null) throw new Error(`the Workflow must reach ${kind}: ${JSON.stringify(result)}`);
    input = result.value.next;
  }
  throw new Error(`the Workflow did not reach ${kind}`);
}

function runRefOfPrepare(input: WorkflowAdvanceInput): RunRef {
  if (input.kind !== 'perform' || input.operation.kind !== 'prepare') throw new Error('not a prepare step');
  return input.operation.request.runRef;
}

it('TASK-03 (§4.3): the Workflow claims a requeue with the budget it pins; a claim with another budget is invalid', async () => {
  const { platform, workspaceRevision } = await openEnvironment();
  const round1 = roundOf(await drive(platform, select('a2-requeue-budget-flow-1')));
  const run1Ref = (await taskRow(platform)).execution;
  if (run1Ref === null) throw new Error('work-1 must have a selected Run');
  const run1 = await readRun(platform, run1Ref);
  const pinned = { tokenBudget: 200000, deadline: null };
  const requeued = await requeue(platform, 'a2-requeue-budget', run1Ref, { budget: pinned });
  if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') throw new Error(`requeue: ${JSON.stringify(requeued)}`);
  const requeueRef = requeued.value.requeue.ref;
  expect(requeued.value.requeue.budget).toEqual(pinned);
  // The read model names the pin beside the requeueRef.
  expect(await taskRow(platform)).toMatchObject({ effectivePhase: 'pending', requeueRef, requeueBudget: pinned });

  // TASK-03: a claim with the binding's budget is refused; nothing is claimed.
  const sessionRef = run1.outbox.claim.sessionRef;
  const goal = await platform.plans.queryGoal(ctx(), goalRef);
  const card = await platform.sessions.readSession(ctx(), sessionRef);
  if (goal.status !== 'ready' || card.status !== 'ready') throw new Error('the Goal and the Session must be readable');
  expect(await platform.claims.claimTask(ctx(), { meta: { requestId: 'a2-requeue-binding-budget', expected: [
    { ref: goalRef, revision: goal.value.goal.revision }, { ref: workspaceRef, revision: workspaceRevision },
    { ref: card.value.record.ref, revision: card.value.record.revision }] },
  input: { goalRef, planRef: round1.adoptedPlanRef, taskId: TASK.taskId, sessionRef, roleBinding,
    budget: { tokenBudget: 100000, deadline: null }, requeueRef } }))
    .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'the requeue pins the claim budget' });
  expect(await taskRow(platform)).toMatchObject({ effectivePhase: 'pending', requeueRef, execution: run1Ref });

  // W-21: the Workflow claims in Run 1's Session with the pinned budget.
  const second = await drive(platform, select('a2-requeue-budget-flow-2'));
  expect(second.find(receipt => receipt.kind === 'claim_task')).toMatchObject({ result: { status: 'committed' } });
  const run2Ref = (await taskRow(platform)).execution;
  if (run2Ref === null || run2Ref.runId === run1Ref.runId) throw new Error('Run 2 must be the selected Run');
  const run2 = await readRun(platform, run2Ref);
  expect(run2.run).toMatchObject({ requeueRef, budget: pinned });
  expect(run2.outbox.claim.sessionRef).toEqual(sessionRef);
}, 120_000);

it('C3 (§6.1 (e), RUN-02/03, I-19): a requeue Run binds one brief; prepare rehydrates it and the driver refuses another', async () => {
  // A start whose caller cancels right after the entry authorization commits: the Run is bound, not begun.
  let abortAfterRunCommit: AbortController | null = null;
  const observer: RecordCommitObserver = {
    started() { /* the head is not needed */ },
    committed(notice) {
      if (abortAfterRunCommit !== null && notice.aggregates.some(aggregate => aggregate.aggregateType === 'Run')) {
        abortAfterRunCommit.abort();
        abortAfterRunCommit = null;
      }
    },
  };
  const { platform, scripted, workspaceRoot } = await openEnvironment(observer);
  await drive(platform, select('a2-requeue-bind-flow-1'));
  const run1Ref = (await taskRow(platform)).execution;
  if (run1Ref === null) throw new Error('work-1 must have a selected Run');
  const requeued = await requeue(platform, 'a2-requeue-bind', run1Ref);
  if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') throw new Error(`requeue: ${JSON.stringify(requeued)}`);

  // The Workflow claims the requeue; its prepare is performed here twice, the source changing in between.
  const runRef = runRefOfPrepare(await advanceUntil(platform, select('a2-requeue-bind-flow-2'), 'prepare'));
  const prepare = () => platform.runtime.prepareExecution(ctx(), { runRef, requestId: 'a2-requeue-bind-prepare' });
  const first = await prepare();
  if (first.status !== 'ready') throw new Error(`prepare 1: ${JSON.stringify(first)}`);
  await writeFile(join(workspaceRoot, 'operator-note.txt'), 'changed between the two prepares\n');
  const other = await prepare();
  if (other.status !== 'ready') throw new Error(`prepare 2: ${JSON.stringify(other)}`);
  const firstDigest = first.value.inputBinding.continuationBriefDigest;
  if (firstDigest === undefined) throw new Error('a requeue Run prepares a continuation brief');
  expect(other.value.inputBinding.continuationBriefDigest).not.toBe(firstDigest);

  const consumerId = 'a2-requeue-bind-consumer';
  const controller = new AbortController();
  abortAfterRunCommit = controller;
  expect(await platform.runtime.startRun({ ...ctx(), signal: controller.signal },
    { prepared: first.value, consumerId, requestId: 'a2-requeue-bind-start-1' })).toMatchObject({ status: 'rejected', code: 'cancelled' });
  const bound = await readRun(platform, runRef);
  expect(bound.run).toMatchObject({ status: 'starting', inputBinding: first.value.inputBinding,
    executionAuthorization: { phase: 'authorized' } });
  expect(scripted.calls()).toBe(1);

  // §6.1 (e): prepare returns the bound value and assembles no new brief.
  expect(await prepare()).toEqual({ status: 'ready', value: first.value });
  // §6.3 driver check 1: another Prepared is refused before any WorkGraph write or Kernel call.
  expect(await platform.runtime.startRun(ctx(), { prepared: other.value, consumerId, requestId: 'a2-requeue-bind-start-2' }))
    .toMatchObject({ status: 'rejected', code: 'invalid' });
  expect((await readRun(platform, runRef)).run.revision).toBe(bound.run.revision);
  expect(scripted.calls()).toBe(1);
  // The bound Prepared enters exactly once and the model gets that brief.
  expect(await platform.runtime.startRun(ctx(), { prepared: first.value, consumerId, requestId: 'a2-requeue-bind-start-3' }))
    .toMatchObject({ status: 'ready', value: { run: { status: 'ended', inputBinding: first.value.inputBinding } } });
  expect(scripted.calls()).toBe(2);
  expect(JSON.stringify(scripted.requests[1])).toContain(continuationBriefMarker(firstDigest));
}, 120_000);

it('W-21 / C3: an archived afterRun Session moves the requeue to a new Session; the brief lists the message Run 1 accepted', async () => {
  const { platform, scripted } = await openEnvironment();
  // Run 1 is claimed; before it starts, an operator writes to its claim Session.
  const prepareRun1 = await advanceUntil(platform, select('a2-requeue-move-flow-1'), 'prepare');
  const run1Ref = runRefOfPrepare(prepareRun1);
  const sessionRef = (await readRun(platform, run1Ref)).outbox.claim.sessionRef;
  const mail = 'Operator: keep the fix inside the workspace root';
  const sent = await platform.messages.sendMessage(ctx(), { meta: { requestId: 'a2-requeue-mail', expected: [] },
    input: { recipient: { projectId, sessionId: sessionRef.sessionId }, text: mail } });
  if (sent.status !== 'committed') throw new Error(`send: ${JSON.stringify(sent)}`);
  // Run 1 accepts the message, completes, and its round FAILs.
  await drive(platform, prepareRun1);
  expect(await taskRow(platform)).toMatchObject({ effectivePhase: 'failed', execution: run1Ref });
  expect(JSON.stringify(scripted.requests[0])).toContain(mail);

  // The operator closes the Session's responsibility for the Task and archives it.
  const card = await platform.sessions.readSession(ctx(), sessionRef);
  if (card.status !== 'ready') throw new Error('the claim Session must be readable');
  const link = card.value.links.find(candidate => candidate.until === null);
  if (link === undefined) throw new Error('the claim Session is responsible for the Task');
  const closed = await platform.sessions.linkSessionWork(ctx(), { meta: { requestId: 'a2-requeue-unlink', expected: [
    { ref: card.value.record.ref, revision: card.value.record.revision }, { ref: link.ref, revision: link.revision }] },
  input: { sessionRef, target: link.ref.target, relation: link.ref.relation, active: false } });
  if (closed.status !== 'committed') throw new Error(`unlink: ${JSON.stringify(closed)}`);
  const unlinked = await platform.sessions.readSession(ctx(), sessionRef);
  if (unlinked.status !== 'ready') throw new Error('the claim Session must be readable');
  expect(await platform.sessions.archiveSession(ctx(), { meta: { requestId: 'a2-requeue-archive', expected: [
    { ref: unlinked.value.record.ref, revision: unlinked.value.record.revision }] },
  input: { sessionRef, reason: 'retire the first Session' } })).toMatchObject({ status: 'committed', value: { lifecycle: 'archived' } });

  // W-21: archived → the default selection without a hint creates a Session that claims with the requeue.
  const requeued = await requeue(platform, 'a2-requeue-move', run1Ref);
  if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') throw new Error(`requeue: ${JSON.stringify(requeued)}`);
  const second = await drive(platform, select('a2-requeue-move-flow-2'));
  expect(second.find(receipt => receipt.kind === 'create_session')).toMatchObject({ result: { status: 'completed' } });
  expect(second.find(receipt => receipt.kind === 'claim_task')).toMatchObject({ result: { status: 'committed' } });
  const run2Ref = (await taskRow(platform)).execution;
  if (run2Ref === null || run2Ref.runId === run1Ref.runId) throw new Error('Run 2 must be the selected Run');
  const run2 = await readRun(platform, run2Ref);
  expect(run2.run.requeueRef).toEqual(requeued.value.requeue.ref);
  expect(run2.outbox.claim.sessionRef.sessionId).not.toBe(sessionRef.sessionId);
  // C3 contract (e): the new Session is seeded with the archived Session's completed history (the four conditions
  // hold), and the brief says so (A.2 5.6); it still lists the message Run 1 accepted, as for any other Session.
  const brief = await platform.runtime.readContinuationBrief(ctx(), { runRef: run2Ref });
  expect(brief).toMatchObject({ status: 'ready', value: { brief: {
    session: { continuity: 'other_session_seeded', sessionRef: { sessionId: run2.outbox.claim.sessionRef.sessionId },
      seededFrom: { sessionRef: { sessionId: sessionRef.sessionId } } },
    acceptedInputs: { messages: [{ messageRef: sent.value.ref, part: 'message', excerpt: { text: mail, truncated: false } }],
      messagesOmitted: 0, steers: [], steersOmitted: 0 } } } });
  expect(JSON.stringify(scripted.requests[1])).toContain(mail);
  expect(scripted.calls()).toBe(2);
}, 120_000);
