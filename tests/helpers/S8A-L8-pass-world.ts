/**
 * The L8 PASS world (book `l8-rework-1` §2 item 7), shared by `tests/composition/S8A-L8-pass-capture.test.ts`
 * and `tests/composition/P6F-F3-catalog-trailing-slash.test.ts`.
 *
 * The real composition root over a real temporary workspace, then the public bootstrap writers (Project,
 * Workspace, completion policy). The registered static command check (`echo S8A_L8_PASS`) runs through the real
 * Kernel ProcessSandbox, so a row needs real bubblewrap. The automatic capture is the real
 * `createAutoCaptureDriver`, connected to `onArchitectureCaptureTrigger` through a mutable sink the way host.ts
 * does it; every notification is counted at that one sink. `adoptBeforeCapture` adopts that catalog before the
 * sink is connected, so it is no capture request; any later `adopt` is one. `seedGoal` writes the Goal, the
 * one-work-Task Plan (one required static requirement plus the Goal gate) and the executor line through public
 * writers. `drive` is the Host loop over the real Workflow. No observation, request, round or check result is
 * hand-written.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type {
  WorkflowAdvanceInput, WorkflowOperation, WorkflowStepReceipt,
} from '../../src/business/workflow/contracts.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import { AUTO_CAPTURE_ACTOR, createAutoCaptureDriver } from '../../src/app/auto-capture-driver.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { seedPlatformLine } from './A2-restart-fixture.js';
import { createScriptedModel } from './B2-runtime-fixture.js';

const AT = '2026-10-18T00:00:00.000Z';
export const L8_PASS_CHECK_ID = 's8a-l8-pass-check';
/** The task's literal command: the check really runs it in the Kernel sandbox. */
const CHECK_COMMAND = 'echo S8A_L8_PASS';
const GRANT = 's8a-l8-pass-grant-1';
const hostActor = { kind: 'human' as const, id: 's8a-l8-pass-operator' };
const builder = { kind: 'legacy_template' as const, templateId: 'builder', templateRevision: '1' };
const roleBinding = { schemaVersion: 1 as const, bindingId: 's8a-l8-pass-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
const runtimeBudget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
  maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };
const DEFAULT_FILES: Readonly<Record<string, string>> = { 'src/a.ts': 'export const a = 1;\n', 'notes.md': '# Notes\n' };

export type L8Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
type TriggerEvent = { kind: 'catalog_adopted' | 'catalog_revised' | 'check_passed'; projectId: string };

function contextFor(projectId: string, workspaceId: string): CoreCallContext {
  return { projectId, workspaceId, principal: { kind: 'host', actor: hostActor },
    materialReader: { kind: 'host', projectId, workspaceId, actor: hostActor }, signal: new AbortController().signal };
}

function runtimeHost(projectId: string, workspaceId: string,
  scripted: ReturnType<typeof createScriptedModel>): RuntimeHostBindings {
  // A-07: the one scope check and configuration body both resolutions share.
  const resolveFor = (context: CoreCallContext, role: RoleConfigurationRef) => {
    if (context.projectId !== projectId || context.workspaceId !== workspaceId) {
      return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'the runtime Host is not bound to this workspace' };
    }
    return { status: 'ready' as const, value: {
      configurationRevision: 's8a-l8-pass-host-config@1',
      model: { configuration: { revision: 's8a-l8-pass-host-config@1', provider: 'deepseek',
        model: 's8a-l8-pass-scripted', baseUrl: 'http://127.0.0.1' },
      client: scripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const,
        tokenizer: 's8a-l8-pass-counter' }) } },
      budget: runtimeBudget,
      hostTemplate: role.kind === 'legacy_template'
        ? { templateId: 'builder', revision: '1', digest: sha256Hex('S8A L8 trusted static role guidance') } : null,
      tools: ['read'], writeScope: [], skills: {
        resourceRoot: fileURLToPath(new URL('../../vendor/coding-agent/resources/skills', import.meta.url)),
        enabledIds: [] },
      systemInstruction: 'S8A L8 trusted static role guidance', deniedPrefixes: [],
      processSandboxOptions: {}, materialBasis: null,
    } };
  };
  return {
    async resolveConfiguration(context, request) {
      const resolved = resolveFor(context, request.role);
      if (resolved.status === 'rejected') return resolved;
      if (request.roleResolution.status === 'inadmissible') {
        return { status: 'rejected', code: 'forbidden', reason: 'the current Role binding is inadmissible' };
      }
      return resolved;
    },
    // A-07: the no-Run lookup the pre-claim check reads; without a Run it gets only the Role.
    async resolveRoleConfiguration(context, input) {
      return resolveFor(context, input.role);
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

/** A catalog module: `paths` as the caller writes them (the rows' public input). */
export const l8Module = (projectId: string, moduleId: string, paths: string[], responsibility = `The ${moduleId} files`):
ModuleDefinition => ({ ref: { projectId, moduleId }, name: moduleId, responsibility, paths, interfaces: [] });

/**
 * Returns `root` (the real workspace root), `notifications()` (every real `onArchitectureCaptureTrigger`
 * notification, counted at the sink), `pins()` (the current Project and Workspace pins from the public
 * registration read), `adopt` (the public initial adoption), `seedGoal` and `close` (the driver stops before the
 * platform drains, then the temp tree goes).
 */
export async function openL8PassWorld(options: { backend: 'memory' | 'sqlite'; projectId: string;
  files?: Readonly<Record<string, string>>; adoptBeforeCapture?: ModuleDefinition[] }) {
  const { backend, projectId } = options;
  const directory = await mkdtemp(join(tmpdir(), `s8a-l8-pass-${backend}-`));
  const closers: Array<() => Promise<void>> = [() => rm(directory, { recursive: true, force: true })];
  const close = async () => { for (const closer of closers.splice(0).reverse()) await closer().catch(() => undefined); };
  try {
    const root = join(directory, 'workspace');
    await mkdir(root, { recursive: true });
    for (const [path, body] of Object.entries(options.files ?? DEFAULT_FILES)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), body);
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
          ? { status: 'ready', value: { root, workspaceRevision: workspaceState.revision } }
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
      checks: [{ checkId: L8_PASS_CHECK_ID, kind: 'static', command: CHECK_COMMAND, cwd: '.', timeoutMs: 60_000,
        taskIds: 'all' }],
    };
    const workflow: WorkflowHostConfiguration = {
      consumerId: 's8a-l8-pass-consumer',
      bindings: [{ workspace: scope, sessionRole: builder, roleBinding, budget: { tokenBudget: 100000, deadline: null } }],
    };
    // The mutable sink exists BEFORE the driver, exactly as host.ts does it.
    let sink: ((event: TriggerEvent) => void) | undefined;
    // The notification is fired synchronously inside the awaited owner call, so this count is an exact
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
    closers.push(() => platform.close());

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

    const pins = async () => {
      const read = await platform.projects.readWorkspaceRegistration(ctx, scope);
      if (read.status !== 'ready') throw new Error(`the workspace registration read failed: ${JSON.stringify(read)}`);
      return [{ ref: projectRef, revision: read.value.project.revision },
        { ref: workspaceRef, revision: read.value.workspace.revision }];
    };
    const adopt = async (modules: ModuleDefinition[], description = 'The src module boundary') =>
      platform.architecture.adoptInitialArchitecture(ctx, { meta: { requestId: projectId + '-adopt', expected: await pins() },
        input: { baselineId: projectId + '-baseline', description, constraints: [],
          catalog: { requireDag: true, dependencies: [], modules } } });
    if (options.adoptBeforeCapture !== undefined) {
      const adopted = await adopt(options.adoptBeforeCapture);
      if (adopted.status !== 'committed') throw new Error(`architecture adoption failed: ${JSON.stringify(adopted)}`);
    }

    const driver = createAutoCaptureDriver({ architecture: platform.architecture, boundWorkspaces: () => [scope],
      actor: AUTO_CAPTURE_ACTOR });
    closers.push(() => driver.close());
    sink = event => { driver.projectChanged(event.projectId, event.kind); };

    const seedGoal = async () => {
      const goal = await platform.goals.createGoal(ctx, { meta: { requestId: projectId + '-goal', expected: await pins() },
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
      // A-25: picking no longer makes a line, so the world seeds the executor line.
      await seedPlatformLine(platform, ctx, 'line-work-1',
        { workspace: scope, role: builder, targets: [{ projectId, goalId: goalRef.goalId, taskId: 'work-1' }] });
    };
    return { projectId, workspaceId, scope, ctx, goalRef, root, platform, scripted, driver,
      notifications: () => notificationCount, pins, adopt, seedGoal, close };
  } catch (error) {
    await close();
    throw error;
  }
}
export type L8PassWorld = Awaited<ReturnType<typeof openL8PassWorld>>;

export const selectWork = (world: L8PassWorld, flowId: string): WorkflowAdvanceInput =>
  ({ schemaVersion: 1, goalRef: world.goalRef, flowId, sessionHint: null, kind: 'select_work', taskId: 'work-1' });
type Perform = Extract<WorkflowAdvanceInput, { kind: 'perform' }>;
export const performs = (kind: WorkflowOperation['kind']) => (input: WorkflowAdvanceInput): boolean =>
  input.kind === 'perform' && input.operation.kind === kind;

export type L8Driven = { stopped: Perform | null; state: string; reason: string | null; receipts: WorkflowStepReceipt[] };
/** The Host drives every returned `next` until `stopBefore` names the next request or the Workflow settles. */
export async function drive(world: L8PassWorld, first: WorkflowAdvanceInput,
  stopBefore: (input: WorkflowAdvanceInput) => boolean = () => false): Promise<L8Driven> {
  const receipts: WorkflowStepReceipt[] = [];
  let input = first;
  for (let guard = 0; guard < 64; guard += 1) {
    if (stopBefore(input)) return { stopped: input as Perform, state: 'stopped', reason: null, receipts };
    const result = await world.platform.workflow.advanceWork(world.ctx, input);
    if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
    if (result.value.receipt !== null) receipts.push(result.value.receipt);
    if (result.value.state === 'completed' || result.value.next === null) {
      return { stopped: null, state: result.value.state, reason: result.value.reason, receipts };
    }
    input = result.value.next;
  }
  throw new Error('the Workflow did not settle within the step guard');
}
