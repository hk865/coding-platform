/**
 * K3-35: the production Runtime over the S5 review world.
 *
 * Every Run of the K3-35 chain (the eight archived anchors, the record's own
 * ninth Run and the continuation) is claimed by the public claim owner and then
 * goes through the production `RuntimeExecutionPort`:
 *
 *   the real `prepare` is the production `createExecutionPreparation` in
 *   `K3-35-prepare.ts` (with the required `readTaskClosure` from
 *   `plan-readers.ts`, also wired below for the Runtime's own prepare path); and
 *   `startRun` → the production execution driver's authorize / begin /
 *   `recordExecutionEntered` with the Kernel facts the real turn produced.
 *
 * The only injected dependencies are the Host configuration (a scripted model,
 * the §5.1 shell stand-in) and the fixture's clock/id sources. No manifest,
 * envelope, prepared input or Kernel position is built here.
 */
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import { artifactBodyDigest } from '../../src/contracts/artifact.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RuntimeExecutionDependencies, RuntimeHostBindings, ResolvedRuntimeConfiguration } from '../../src/core/agent-runtime/execution-contracts.js';
import type { AgentRuntimeService } from '../../src/core/agent-runtime/ports.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import { createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';
import { createExecutionHistoryReader } from '../../src/core/agent-runtime/observation-recovery.js';
import { createGraphExecutionHistoryReader } from '../../src/core/agent-runtime/graph-execution-history.js';
import type { KernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createExecutionHistoryService } from '../../src/core/work-graph/tasks/execution-history-service.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createModelCallService } from '../../src/core/work-graph/tasks/model-call-service.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import { readTaskClosure } from '../../src/core/work-graph/tasks/plan-readers.js';
import type { AuthorizeConfiguration } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { ScriptedModel } from './B2-runtime-fixture.js';
import type { K3ReviewCardWorld } from './K3-review-card-fixture.js';
import { GOAL_B } from './S5-decision-fixture.js';

/** The Host configuration revision every K3-35 Run is prepared and started with. */
export const K3_35_HOST_REVISION = 'k3-35-runtime-host@1';
export const K3_35_HOST_TEMPLATE = { templateId: 'builder', revision: '1',
  digest: artifactBodyDigest('k3-35 runtime host template') } as const;

export type K3_35RuntimeOptions = {
  /** The scripted Kernel model of this Run (an injected dependency, never a fact). */
  model: ScriptedModel;
  /** The Host tool grant: `shell` adds the §5.1 stand-in and needs the whole-workspace grant. */
  tools: readonly string[];
  writeScope: readonly string[];
  now: () => string;
  eventId: () => string;
  newId: () => string;
  kernelStores: KernelStoreRegistry;
  /** The real Workspace revision the fixture stores (the Run's snapshot must agree). */
  workspaceRevision: () => Promise<number>;
  /**
   * The Session mailbox / user-decision ports the coordination-tool selection
   * needs when the Host grants `send_user_message`. These are injected
   * dependencies of the Runtime, never facts; the test's §5.1 mailbox seam
   * replaces the tool factory itself.
   */
  messages?: RuntimeExecutionDependencies['messages'];
  decisionMessages?: RuntimeExecutionDependencies['decisionMessages'];
  /**
   * L19a: the ONE production recognizer the shell hook shares with the CRR
   * owner (`createCommandRecognizer`, over the fixture's real workspace
   * reader). Absent on the review/proposal rounds, which never install the
   * blocked-shell hook; a Work Run with a non-empty blocked binding must pass
   * it or the hook fails closed before the shell call.
   */
  commandRecognizer?: RuntimeExecutionDependencies['commandRecognizer'];
};

export type K3_35Runtime = {
  runtime: AgentRuntimeService;
  deps: RuntimeExecutionDependencies;
};

/** The ONE trusted Host grant every K3-35 Run is prepared and started with. */
export function k3_35Configuration(
  tools: readonly string[], writeScope: readonly string[],
  client: ResolvedRuntimeConfiguration['model']['client'],
): ResolvedRuntimeConfiguration {
  const shells = tools.includes('shell');
  return {
    configurationRevision: K3_35_HOST_REVISION,
    model: {
      configuration: { revision: 'k3-35-model@1', provider: 'deepseek', model: 'k3-35-test', baseUrl: 'http://127.0.0.1' },
      client,
    },
    budget: { contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
      maxRequests: 8, maxToolCalls: 64, timeoutMs: null, perResponseTokens: 512 },
    hostTemplate: { ...K3_35_HOST_TEMPLATE },
    tools: [...tools],
    writeScope: [...writeScope],
    ...(shells ? { shellWorkspaceAccess: 'all_except_denied' as const } : {}),
    // L18 Host layer 1: the review/proposal rounds' fixed read-only command
    // grant. The whole workspace is readable in this fixture world.
    readonlyCommandAccess: 'all_except_denied' as const,
    skills: { resourceRoot: 'resources/skills', enabledIds: [] },
    systemInstruction: 'Static executor system instruction: platform facts only.',
    deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
    platformDuty: 'executor', contextResidentBytes: 4096,
  };
}

/** The production entry owner's configuration authorization, shared with prepare. */
export const k3_35AuthorizeConfiguration: AuthorizeConfiguration = async (_ctx, input) => {
  if (input.configurationRevision !== K3_35_HOST_REVISION
    || input.run.ref.projectId !== GOAL_B.projectId || input.run.ref.goalId !== GOAL_B.goalId
    || input.sessionRole.kind !== 'legacy_template'
    || input.sessionRole.templateId !== K3_35_HOST_TEMPLATE.templateId
    || input.sessionRole.templateRevision !== K3_35_HOST_TEMPLATE.revision) {
    return { status: 'rejected', code: 'forbidden',
      reason: 'the K3-35 Host does not authorize this configuration' };
  }
  return { status: 'ready', value: { configurationRevision: K3_35_HOST_REVISION,
    permissions: structuredClone(input.permissions), hostTemplate: structuredClone(input.hostTemplate) } };
};

/**
 * Build ONE production Runtime over the S5 world's records/bodies. The caller
 * hands the prepared value of a claimed Run to `runtime.port.startRun`.
 */
export function createK3_35Runtime(world: K3ReviewCardWorld, options: K3_35RuntimeOptions): K3_35Runtime {
  const records = world.records;
  const bodies = world.fixture.bodies;
  const now = options.now;
  const eventId = options.eventId;
  const newId = options.newId;
  const executions = createRunStateReader({ records });
  const roles = createRoleConfigurationService({ records, now, eventId });
  const materialReads = createMaterialRecordReaders(records);
  const materials = createMaterialService({ bodies, authority: materialReads.authority, now });
  const sessions = world.fixture.b2.base.sessionsPort;
  const sessionOperations = createSessionOperations({ sessions, kernelStores: options.kernelStores });
  const activity = createExecutionHistoryReader({ history: sessionOperations });
  const graphHistory = createGraphExecutionHistoryReader({ executions, history: activity });
  const sourceAuthority = () => createSourceAuthorityReader({ authority: materialReads.authority });
  const host: RuntimeHostBindings = {
    async resolveConfiguration(ctx, input) {
      if (ctx.projectId !== GOAL_B.projectId || ctx.workspaceId !== world.fixture.base.scope.workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'the K3-35 Runtime is not bound to this workspace' };
      }
      if (input.roleResolution.status === 'inadmissible') {
        return { status: 'rejected', code: 'forbidden', reason: 'the current Role binding is inadmissible' };
      }
      return { status: 'ready', value: k3_35Configuration(options.tools, options.writeScope, options.model.client) };
    },
  };
  // The production entry owner the Runtime drives: it authorizes exactly the
  // configuration the Host just returned, for the fixture's legacy Session role.
  const authorizeConfiguration = k3_35AuthorizeConfiguration;
  const entry = createExecutionEntryService({ records, reads: executions, roles, bodies: { read: ref => bodies.read(ref) },
    authorizeConfiguration, now, eventId, newId });
  const modelRequests = createModelCallService({ records, reads: executions, roles, bodies,
    authorizeConfiguration, now, eventId });
  const workspaceHost = {
    async resolveRoot(requested: { projectId: string; workspaceId: string }) {
      if (requested.projectId !== GOAL_B.projectId || requested.workspaceId !== world.fixture.base.scope.workspaceId) {
        return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'the workspace is not registered in the K3-35 world' };
      }
      return { status: 'ready' as const, value: { root: world.fixture.base.directory, workspaceRevision: await options.workspaceRevision() } };
    },
    async authorize() {
      return { status: 'ready' as const, value: { subjectKey: 'k3-35-runtime-host',
        permissionRevision: K3_35_HOST_REVISION, allowsRead: () => true } };
    },
  };
  // Item 2: `readTaskClosure` is a REQUIRED prepare dependency; it is the
  // production reader over the same records, never an absent default.
  const deps: RuntimeExecutionDependencies = {
    claims: world.fixture.b2.base.service,
    executions,
    entry,
    historyWriter: createExecutionHistoryService({ records, now, eventId }),
    modelRequests,
    roles,
    plans: world.fixture.b2.base.plans,
    sessions,
    materials,
    bodies,
    activity,
    graphHistory,
    sessionOperations,
    kernelStores: options.kernelStores,
    workspaceHost,
    sourceAuthority,
    host,
    kernel,
    ...(options.messages === undefined ? {} : { messages: options.messages }),
    ...(options.decisionMessages === undefined ? {} : { decisionMessages: options.decisionMessages }),
    ...(options.commandRecognizer === undefined ? {} : { commandRecognizer: options.commandRecognizer }),
    unknownCallReviews: world.reviews,
    commandRerunRequests: world.commandRerun,
    readTaskClosure: async (_ctx: CoreCallContext, task: { projectId: string; goalId: string; taskId: string }) =>
      readTaskClosure(records, { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId }, task.taskId),
    now,
    newId,
  };
  return { runtime: createAgentRuntime(deps), deps };
}
