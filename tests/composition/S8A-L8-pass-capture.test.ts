/**
 * L8 PASS rows (book `l8-rework-1` §2 item 7; the assertions Codex set there).
 *
 * Three rows, each on BOTH stores:
 *
 * 1. the real Workflow's `finalize_checks` PASS;
 * 2. the public `platform.evidence.finalizeChecks` PASS, after the real
 *    registered check ran through `platform.checks.runRegisteredCheck`;
 * 3. the exact same finalize request sent again (same `meta.requestId`, same
 *    `input.roundRef`).
 *
 * Every fact is produced by the platform. The Project/Workspace, the policy,
 * the architecture baseline, the Goal and the Plan go through public writers;
 * a real Run is claimed and ended by the real Workflow/Kernel with the scripted
 * model; the registered static command check runs through the real Kernel
 * ProcessSandbox; and the automatic capture is the real
 * `createAutoCaptureDriver`, connected to `onArchitectureCaptureTrigger` the
 * way `S8A-L8-adoption-capture.test.ts` installs it. No observation, request,
 * round or check result is hand-written.
 *
 * These rows need real bubblewrap (`/usr/bin/bwrap`). This sandbox does not have
 * it (`DSH-BASELINE.md` A2), so each row fails at the real registered check with
 * the Kernel's `ENOENT: ... '/usr/bin/bwrap'` reason; the lead runs them with
 * bubblewrap.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { ArchitectureObservationStateV1 } from '../../src/contracts/architecture-observation.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { RoundSnapshot, TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type {
  WorkflowAdvanceInput, WorkflowOperation, WorkflowStepReceipt,
} from '../../src/business/workflow/contracts.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import { AUTO_CAPTURE_ACTOR, createAutoCaptureDriver, type AutoCaptureDriver } from '../../src/app/auto-capture-driver.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';

const AT = '2026-10-18T00:00:00.000Z';
const CHECK_ID = 's8a-l8-pass-check';
/** The task's literal command: the check really runs it in the Kernel sandbox. */
const CHECK_COMMAND = 'echo S8A_L8_PASS';
const GRANT = 's8a-l8-pass-grant-1';
const hostActor = { kind: 'human' as const, id: 's8a-l8-pass-operator' };
const roleBinding = { schemaVersion: 1 as const, bindingId: 's8a-l8-pass-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
const runtimeBudget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
  maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
type CheckResult = Awaited<ReturnType<Platform['checks']['runRegisteredCheck']>>;
type CurrentCaptureRef = NonNullable<ArchitectureObservationStateV1['current']>['captureRef'];
type TriggerEvent = { kind: 'catalog_adopted' | 'catalog_revised' | 'check_passed'; projectId: string };

const BACKENDS = ['memory', 'sqlite'] as const;
type Backend = (typeof BACKENDS)[number];

const directories: string[] = [];
const cleanups: Array<() => Promise<void>> = [];
const sleep = (milliseconds: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

afterEach(async () => {
  // Reverse order: the driver stops before the platform drains, then the temp tree goes.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => undefined);
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

function contextFor(projectId: string, workspaceId: string): CoreCallContext {
  return { projectId, workspaceId, principal: { kind: 'host', actor: hostActor },
    materialReader: { kind: 'host', projectId, workspaceId, actor: hostActor }, signal: new AbortController().signal };
}

function runtimeHost(projectId: string, workspaceId: string,
  scripted: ReturnType<typeof createScriptedModel>): RuntimeHostBindings {
  return {
    async resolveConfiguration(context, request) {
      if (context.projectId !== projectId || context.workspaceId !== workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'the runtime Host is not bound to this workspace' };
      }
      if (request.roleResolution.status === 'inadmissible') {
        return { status: 'rejected', code: 'forbidden', reason: 'the current Role binding is inadmissible' };
      }
      return { status: 'ready', value: {
        configurationRevision: 's8a-l8-pass-host-config@1',
        model: { configuration: { revision: 's8a-l8-pass-host-config@1', provider: 'deepseek',
          model: 's8a-l8-pass-scripted', baseUrl: 'http://127.0.0.1' },
        client: scripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const,
          tokenizer: 's8a-l8-pass-counter' }) } },
        budget: runtimeBudget,
        hostTemplate: request.role.kind === 'legacy_template'
          ? { templateId: 'builder', revision: '1', digest: sha256Hex('S8A L8 trusted static role guidance') } : null,
        tools: ['read'], writeScope: [], skills: {
          resourceRoot: fileURLToPath(new URL('../../vendor/coding-agent/resources/skills', import.meta.url)),
          enabledIds: [] },
        systemInstruction: 'S8A L8 trusted static role guidance', deniedPrefixes: [],
        processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };
}

/** One work Task with one required static requirement plus the Goal gate, as A2 uses. */
function planDraft(goalId: string): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId: 's8a-l8-pass-plan', planRevision: 1, goalId, stages: [],
    tasks: [
      { taskId: 'work-1', title: 'The PASS work', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: 'goal-gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 'work-1', role: 'builder', instruction: 'Produce the registered PASS' }],
    obligations: [{ obligationId: 's8a-l8-pass-obligation', title: 'Deliver the verified work',
      requirementLevel: 'required', taskIds: ['work-1', 'goal-gate'],
      verificationRequirements: [{ requirementId: 's8a-l8-pass-static', requirementLevel: 'required', kind: 'static',
        description: 'Registered static command check' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

type Fixture = {
  projectId: string;
  workspaceId: string;
  scope: WorkspaceScope;
  ctx: CoreCallContext;
  goalRef: GoalRef;
  platform: Platform;
  scripted: ReturnType<typeof createScriptedModel>;
  driver: AutoCaptureDriver;
  /** Every real `onArchitectureCaptureTrigger` notification, counted at the sink. */
  notifications(): number;
};

/**
 * The real composition root over a real temporary workspace, then the public
 * bootstrap writers. The architecture baseline is adopted BEFORE the driver's
 * sink is connected, so the first accepted request is the explicit real
 * `workspaceRegistered` trigger below (`requestSeq` 1).
 */
async function openEnvironment(backend: Backend, projectId: string): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), `s8a-l8-pass-${backend}-`));
  directories.push(directory);
  const workspaceRoot = join(directory, 'workspace');
  await mkdir(workspaceRoot, { recursive: true });
  for (const [path, body] of Object.entries({ 'src/a.ts': 'export const a = 1;\n', 'notes.md': '# Notes\n' })) {
    await mkdir(dirname(join(workspaceRoot, path)), { recursive: true });
    await writeFile(join(workspaceRoot, path), body);
  }
  const workspaceId = 'main';
  const scope: WorkspaceScope = { projectId, workspaceId };
  const projectRef = { aggregateType: 'Project' as const, projectId };
  const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId, goalId: 's8a-l8-pass-goal' };
  const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: 's8a-l8-pass-policy', revision: 1 };
  const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId };
  const workspaceState = { revision: 1 };

  const workspaceHost: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      return requested.projectId === projectId && requested.workspaceId === workspaceId
        ? { status: 'ready', value: { root: workspaceRoot, workspaceRevision: workspaceState.revision } }
        : { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered in this Host' };
    },
    async authorize() {
      return { status: 'ready', value: { subjectKey: 's8a-l8-pass-host', permissionRevision: GRANT,
        allowsRead: () => true } };
    },
  };
  const scripted = createScriptedModel([{ kind: 'text', text: 'S8A L8 work result' },
    { kind: 'text', text: 'S8A L8 second result' }]);
  const checks: TrustedCheckConfiguration = {
    configurationRevision: 's8a-l8-pass-checks-1', workspace: workspaceRef, executor: hostActor,
    permissionRevision: GRANT, sourceAccess: 'verification_workspace', processAccess: 'all_except_denied',
    deniedPrefixes: ['.git'],
    checks: [{ checkId: CHECK_ID, kind: 'static', command: CHECK_COMMAND, cwd: '.', timeoutMs: 60_000,
      taskIds: 'all' }],
  };
  const workflow: WorkflowHostConfiguration = {
    consumerId: 's8a-l8-pass-consumer',
    bindings: [{ workspace: scope, sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding, budget: { tokenBudget: 100000, deadline: null } }],
  };
  // The mutable sink exists BEFORE the driver, exactly as host.ts does it.
  let sink: ((event: TriggerEvent) => void) | undefined;
  // Every notification is counted at the ONE sink; the notification is fired
  // synchronously inside the awaited owner call, so this count is an exact
  // completion boundary for "did this call fire a trigger?".
  let notificationCount = 0;
  const platform = await createTargetPlatform({
    storage: backend === 'memory' ? { kind: 'memory' } : { kind: 'sqlite', directory },
    workspace: workspaceHost, now: () => AT,
    architectureSource: { provider: 'typescript', configPath: null },
    kernelStores: { entries: [{ adapterId: 's8a-l8-pass-kernel', storeKey: 's8a-l8-pass-kernel-store',
      workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] },
    runtime: runtimeHost(projectId, workspaceId, scripted),
    checks, workflow,
    onArchitectureCaptureTrigger: event => { notificationCount += 1; sink?.(event); },
  });
  cleanups.push(() => platform.close());

  const ctx = contextFor(projectId, workspaceId);
  const created = await platform.projects.createProject(ctx, { meta: {
    requestId: projectId + '-create-project', expected: [{ ref: projectRef, revision: 0 }],
  }, input: { projectId } });
  if (created.status !== 'committed') throw new Error('Project creation failed');
  const registered = await platform.projects.registerWorkspace(ctx, { meta: {
    requestId: projectId + '-register-workspace',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }],
  }, input: { workspace: scope } });
  if (registered.status !== 'committed') throw new Error('Workspace registration failed');
  workspaceState.revision = registered.value.revision;

  const installed = await platform.completionPolicies.installCompletionPolicy(ctx, { meta: {
    requestId: projectId + '-install-policy',
    expected: [{ ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 }],
  }, input: { policyId: 's8a-l8-pass-policy', contentRevision: 1,
    content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } } });
  if (installed.status !== 'committed') throw new Error('policy install failed');
  const activated = await platform.completionPolicies.activateCompletionPolicy(ctx, { meta: {
    requestId: projectId + '-activate-policy',
    expected: [{ ref: projectRef, revision: 1 }, { ref: activeRef, revision: 0 }],
  }, input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } } });
  if (activated.status !== 'committed') throw new Error('policy activation failed');

  const adopted = await platform.architecture.adoptInitialArchitecture(ctx, { meta: {
    requestId: projectId + '-adopt', expected: [{ ref: projectRef, revision: 1 },
      { ref: workspaceRef, revision: workspaceState.revision }],
  }, input: { baselineId: projectId + '-baseline', description: 'The src module boundary', constraints: [],
    catalog: { requireDag: true, dependencies: [], modules: [{ ref: { projectId, moduleId: 'A' }, name: 'A',
      responsibility: 'The src subtree', paths: ['src'], interfaces: [] }] } } });
  if (adopted.status !== 'committed') throw new Error('architecture adoption failed');

  const goal = await platform.goals.createGoal(ctx, { meta: { requestId: projectId + '-goal',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: workspaceState.revision }] },
  input: { goalId: goalRef.goalId, workspace: scope, objective: 'Verify the work through one real PASS' } });
  if (goal.status !== 'committed') throw new Error('Goal creation failed');
  const proposed = await platform.plans.proposePlan(ctx, { meta: { requestId: projectId + '-plan-propose',
    expected: [{ ref: goalRef, revision: 1 }] },
  input: { goalRef, basedOn: null, draft: planDraft(goalRef.goalId),
    reason: { text: 'Initial S8A L8 PASS plan', sources: [] } } });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
    throw new Error(`Plan proposal failed: ${JSON.stringify(proposed)}`);
  }
  const applied = await platform.plans.applyPlanChange(ctx, { meta: { requestId: projectId + '-plan-apply',
    expected: [{ ref: goalRef, revision: 1 }] },
  input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error('Plan adoption failed');

  const driver = createAutoCaptureDriver({
    architecture: platform.architecture,
    catalog: platform.architecture,
    boundWorkspaces: () => [scope],
    actor: AUTO_CAPTURE_ACTOR,
  });
  cleanups.push(() => driver.close());
  sink = event => { driver.projectChanged(event.projectId, event.kind); };
  return { projectId, workspaceId, scope, ctx, goalRef, platform, scripted, driver,
    notifications: () => notificationCount };
}

/** Bounded public poll: the only way the rows wait for a capture. */
async function readState(fixture: Fixture): Promise<ArchitectureObservationStateV1> {
  const read = await fixture.platform.architecture.observationState(fixture.ctx, { workspace: fixture.scope });
  expect(read, 'architecture/observation-state must be ready').toMatchObject({ status: 'ready' });
  if (read.status !== 'ready') throw new Error('observationState was not ready');
  return read.value;
}

async function waitForCapture(fixture: Fixture, requestSeq: number): Promise<ArchitectureObservationStateV1> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const state = await readState(fixture);
    if (state.autoCapture !== null && state.autoCapture.requestSeq === requestSeq &&
        state.autoCapture.pending === false && state.current !== null) return state;
    if (Date.now() >= deadline) {
      throw new Error('timed out waiting for capture request ' + requestSeq + ': ' + JSON.stringify(state));
    }
    await sleep(10);
  }
}

/** The platform's own refusal is the failure text; nothing is wrapped or invented. */
function requireReadyCheck(result: CheckResult): Extract<CheckResult, { status: 'ready' }> {
  expect(result.status, result.status === 'rejected'
    ? result.reason
    : 'the real registered check must return a persisted round').toBe('ready');
  if (result.status !== 'ready') throw new Error('the registered check did not return a ready round');
  return result;
}

const select = (fixture: Fixture, flowId: string): WorkflowAdvanceInput =>
  ({ schemaVersion: 1, goalRef: fixture.goalRef, flowId, sessionHint: null, kind: 'select_work', taskId: 'work-1' });
type Perform = Extract<WorkflowAdvanceInput, { kind: 'perform' }>;
const performs = (kind: WorkflowOperation['kind']) => (input: WorkflowAdvanceInput): boolean =>
  input.kind === 'perform' && input.operation.kind === kind;

type Driven = { stopped: Perform | null; state: string; reason: string | null; receipts: WorkflowStepReceipt[] };
/** The Host drives every returned `next` until `stopBefore` names the next request or the Workflow settles. */
async function drive(fixture: Fixture, first: WorkflowAdvanceInput,
  stopBefore: (input: WorkflowAdvanceInput) => boolean = () => false): Promise<Driven> {
  const receipts: WorkflowStepReceipt[] = [];
  let input = first;
  for (let guard = 0; guard < 64; guard += 1) {
    if (stopBefore(input)) return { stopped: input as Perform, state: 'stopped', reason: null, receipts };
    const result = await fixture.platform.workflow.advanceWork(fixture.ctx, input);
    if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
    if (result.value.receipt !== null) receipts.push(result.value.receipt);
    if (result.value.state === 'completed' || result.value.next === null) {
      return { stopped: null, state: result.value.state, reason: result.value.reason, receipts };
    }
    input = result.value.next;
  }
  throw new Error('the Workflow did not settle within the step guard');
}

function roundFromOpen(receipts: readonly WorkflowStepReceipt[]): RoundSnapshot {
  const receipt = receipts.find(candidate => candidate.kind === 'open_checks');
  if (receipt === undefined || receipt.kind !== 'open_checks' || receipt.result.status !== 'committed') {
    throw new Error('the Workflow must commit the real round open');
  }
  return receipt.result.value;
}

/** Row 1's check ran inside the Workflow; surface its own refusal when it could not run. */
function requireWorkflowCheckRan(driven: Driven): void {
  const receipt = driven.receipts.find(candidate => candidate.kind === 'run_check');
  if (receipt === undefined || receipt.kind !== 'run_check') {
    throw new Error('the Workflow must perform the real registered check');
  }
  requireReadyCheck(receipt.result);
}

/** The shared post-PASS assertions: one new satisfied request, a new current and the old current as previous. */
async function assertPassCapture(fixture: Fixture, oldCurrent: CurrentCaptureRef,
  expectedSequence: number): Promise<ArchitectureObservationStateV1> {
  expect(expectedSequence).toBe(2);
  const state = await waitForCapture(fixture, expectedSequence);
  expect(state.autoCapture).toMatchObject({ requestSeq: expectedSequence, trigger: 'check_passed',
    pending: false, status: 'requested', failure: null });
  expect(state.current).not.toBeNull();
  expect(state.current!.captureRef.captureId).not.toBe(oldCurrent.captureId);
  expect(state.previous).toEqual(oldCurrent);
  expect(typeof state.current!.observedAt).toBe('string');
  return state;
}

describe.each(BACKENDS)('S8A L8 PASS capture [%s]', backend => {
  it('row 1: the real Workflow finalize PASS starts one automatic capture', async () => {
    const fixture = await openEnvironment(backend, `s8a-l8-pass-${backend}-row1`);
    // A real registration trigger: request 1 is satisfied before the PASS.
    fixture.driver.workspaceRegistered(fixture.scope);
    const before = await waitForCapture(fixture, 1);
    expect(before.autoCapture).toMatchObject({ requestSeq: 1, trigger: 'workspace_registered', pending: false });
    const oldCurrent = before.current!.captureRef;

    const driven = await drive(fixture, select(fixture, 's8a-l8-row1-flow'), performs('finalize_checks'));
    // The real registered check (`echo S8A_L8_PASS`) ran through the Workflow and the Kernel.
    requireWorkflowCheckRan(driven);
    if (driven.stopped === null || driven.stopped.operation.kind !== 'finalize_checks') {
      throw new Error('the Workflow must reach the finalize');
    }
    const finalized = await fixture.platform.workflow.advanceWork(fixture.ctx, driven.stopped);
    if (finalized.status !== 'ready') throw new Error(`the finalize was not ready: ${JSON.stringify(finalized)}`);
    expect(finalized.value.receipt).toMatchObject({ kind: 'finalize_checks', result: {
      status: 'committed', replayed: false, value: { outcome: 'PASS', applicable: true } } });

    await assertPassCapture(fixture, oldCurrent, 2);
  });

  it('rows 2 and 3: the public finalizeChecks PASS starts one automatic capture, and the same finalize request replays and changes no capture state', async () => {
    const fixture = await openEnvironment(backend, `s8a-l8-pass-${backend}-row3`);
    fixture.driver.workspaceRegistered(fixture.scope);
    const before = await waitForCapture(fixture, 1);
    const oldCurrent = before.current!.captureRef;

    const opened = await drive(fixture, select(fixture, 's8a-l8-row3-flow'), performs('run_check'));
    const round = roundFromOpen(opened.receipts);
    const run = requireReadyCheck(await fixture.platform.checks.runRegisteredCheck(fixture.ctx, {
      input: { roundRef: round.ref, checkId: CHECK_ID },
      meta: { requestId: fixture.projectId + '-replayed-run',
        expected: [{ ref: round.ref, revision: round.revision }] },
    }));
    const finalizeRequest = { input: { roundRef: run.value.ref }, meta: {
      requestId: fixture.projectId + '-replayed-finalize',
      expected: [{ ref: run.value.ref, revision: run.value.revision }] } };
    const notificationsBeforeFirst = fixture.notifications();
    const first = await fixture.platform.evidence.finalizeChecks(fixture.ctx, finalizeRequest);
    expect(first).toMatchObject({ status: 'committed', replayed: false,
      value: { outcome: 'PASS', applicable: true } });
    // Control: a non-replayed PASS fires exactly one real notification, so the
    // count below is the right measure for "this call fired no trigger".
    expect(fixture.notifications()).toBe(notificationsBeforeFirst + 1);
    const afterPass = await assertPassCapture(fixture, oldCurrent, 2);

    // The exact same request: same meta.requestId, same input.roundRef.
    const notificationsBeforeReplay = fixture.notifications();
    const replayed = await fixture.platform.evidence.finalizeChecks(fixture.ctx, finalizeRequest);
    expect(replayed).toMatchObject({ status: 'committed', replayed: true, value: { outcome: 'PASS' } });
    // The notification is fired synchronously inside the awaited call, so the
    // count after it is the completion boundary: the replay fired no trigger.
    expect(fixture.notifications()).toBe(notificationsBeforeReplay);
    const after = await readState(fixture);
    expect(after.autoCapture).toMatchObject({ requestSeq: afterPass.autoCapture!.requestSeq,
      trigger: 'check_passed', pending: false });
    expect(after.current!.captureRef.captureId).toBe(afterPass.current!.captureRef.captureId);
    expect(after.current!.captureRef).toEqual(afterPass.current!.captureRef);
    expect(after.previous).toEqual(afterPass.previous);
  });
});
