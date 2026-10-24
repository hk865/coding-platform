/**
 * Slice 2B BE1 platform-mode fixture.
 *
 * What it builds and through which public calls:
 *   - one real SQLite ledger + Kernel store through the accepted
 *     `createTaskClaimFixture`; an exact RoleSpec is installed and activated
 *     through the real `RoleConfigurationService`, the coordination policy
 *     through the fixture's `commitRaw` seat, one Session is created through the
 *     real lifecycle with that exact `role_spec` pin, and the Run is claimed
 *     through the formal `TaskClaimPort` (spec §7; same shape as
 *     `C2-runtime-platform-fixture.ts`);
 *   - the production `createTargetPlatform` composition root over the same
 *     directory (the claim fixture's backend is closed first, exactly as the C2
 *     fixture does), with the real Runtime and the frozen Kernel;
 *   - the Host model binding is a local scripted provider that never uses the
 *     network and can report a `usage_snapshot` per request (§7: "脚本模型能报
 *     用量");
 *   - the clock is the ONLY global replacement (`vi.useFakeTimers({toFake:
 *     ['Date']})`); the platform's `now` and the Kernel's `new Date()` both read
 *     it, so the test moves it between scripted replies (F14, F36). The budget
 *     has `timeoutMs: null` and room for the rows' calls/requests;
 *   - the workspace host uses `<claim fixture directory>/workspace` as the real root (lead, 2026-10-15:
 *     the stores `ledger.sqlite` and `kernel.sqlite` stay in the parent directory, outside the agent's
 *     workspace, so a shell snapshot never sees the platform's own writes) and
 *     exposes a configurable `allowsRead` (for the read-permission Hook row), and
 *     `writeScope`/`shell`/`readonlyCommandAccess` as the row needs.
 *
 * Assertions in the BE1 tests read only `platform.activity.readRunActivities`,
 * `platform.activity.readActivityCalendar` and
 * `platform.decisions.queryGoalConflicts`; nothing here writes a record
 * directly.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile as writeFileOnDisk } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import {
  coordinationPolicyContentDigest, type CoordinationPolicyContentV1,
} from '../../src/contracts/human-role-collaboration.js';
import { roleSpecContentDigest, type RoleSpecContentV1 } from '../../src/contracts/role-spec.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { ActivityReadPort, RunActivityViewV1, ActivityCalendarV1 } from '../../src/core/work-graph/views/activity-read-model.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { ModelClientPort, ModelEvent, ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { createTaskClaimFixture, type TaskClaimFixture } from './task-claim-fixture.js';

/** One slow BE1 case may take up to 30 minutes (spec §7, `S2A_SCALE_TIMEOUT_MS` pattern). */
export const S2B_SLOW_TIMEOUT_MS = 1_800_000;

/** The fixture's first platform time; tests set their own literal times from here. */
export const S2B_BE1_AT = '2026-10-15T10:00:00.000Z';

/** The real deployed skill root; this fixture never fabricates skill files. */
const SKILL_ROOT = resolve(import.meta.dirname, '../../resources/skills');

export type Be1Usage = {
  inputTokens: number; outputTokens: number; cachedInputTokens: number; costUsdMicros: number | null;
};

export type Be1Reply =
  | { kind: 'text'; text: string; usage?: Be1Usage }
  | { kind: 'calls'; calls: ReadonlyArray<{ callId: string; name: string; args: Record<string, unknown> }>; usage?: Be1Usage };

export type Be1ScriptedModel = {
  client: ModelClientPort;
  requests: ModelRequest[];
  calls(): number;
};

/** Local scripted provider (never the network) that can also emit a usage snapshot. */
export function createBe1ScriptedModel(
  replies: readonly Be1Reply[],
  beforeReply?: (request: ModelRequest, index: number, signal: AbortSignal) => Promise<void>,
): Be1ScriptedModel {
  let round = 0;
  const requests: ModelRequest[] = [];
  const client: ModelClientPort = {
    async *stream(request, options) {
      options.signal.throwIfAborted();
      const index = round++;
      const snapshot = structuredClone(request);
      requests.push(snapshot);
      await beforeReply?.(snapshot, index, options.signal);
      const reply = replies[index];
      if (reply === undefined) throw new Error(`S2B BE1 scripted model ran out of replies at round ${index}`);
      const base = { schemaVersion: 1 as const, requestId: request.requestId };
      let sequence = 0;
      if (reply.usage !== undefined) {
        yield { ...base, sequence: ++sequence, type: 'usage_snapshot', usage: { ...reply.usage } } satisfies ModelEvent;
      }
      if (reply.kind === 'text') {
        yield { ...base, sequence: ++sequence, type: 'text_delta', delta: reply.text };
        yield { ...base, sequence: ++sequence, type: 'completed', reason: 'final_answer' };
        return;
      }
      for (const [ordinal, call] of reply.calls.entries()) {
        yield { ...base, sequence: ++sequence, type: 'tool_call_started', callId: call.callId, name: call.name, ordinal };
        yield { ...base, sequence: ++sequence, type: 'tool_arguments_delta', callId: call.callId, delta: JSON.stringify(call.args) };
      }
      yield { ...base, sequence: ++sequence, type: 'completed', reason: 'tool_calls' };
    },
  };
  return { client, requests, calls: () => requests.length };
}

export type S2BBe1PlatformOptions = {
  /** The exact Host+Role tool grant for the claimed Run. */
  toolNames: readonly string[];
  /** The Host whole-workspace write grant; `[]` is a read-only Work. */
  writeScope?: readonly string[];
  scriptedReplies: readonly Be1Reply[];
  beforeReply?: (request: ModelRequest, index: number, signal: AbortSignal) => Promise<void>;
  /** The real Host read policy; defaults to the whole workspace. */
  allowsRead?: (path: string) => boolean;
  /** `shell`: the Host's explicit all-except-denied process grant. */
  shell?: boolean;
  /** `readonlyCommandAccess`: the Host grants `run_readonly_command`. */
  readonlyCommands?: boolean;
  maxToolCalls?: number;
  maxRequests?: number;
  initialAt?: string;
  /** Real workspace files to write under the Host root before the Run. */
  workspaceFiles?: Readonly<Record<string, string>>;
  /** The Plan tasks to claim (one Run each); defaults to the first work task. */
  taskIds?: readonly string[];
};

export type S2BBe1PlatformFixture = {
  claimFixture: TaskClaimFixture;
  platform: Awaited<ReturnType<typeof createTargetPlatform>>;
  scripted: Be1ScriptedModel;
  claim: TaskClaim;
  runRef: RunRef;
  /** One claimed Run per requested task. */
  runs: Array<{ ref: RunRef; sessionRef: SessionRef; taskId: string }>;
  goalRef: GoalRef;
  scope: TaskClaimFixture['scope'];
  ctx: CoreCallContext;
  sessionRef: SessionRef;
  directory: string;
  /** Move the only replaced clock (the global `Date`). */
  setClock(at: string): void;
  /** sha256 of the file bytes, the `expectedRevision` the `edit` tool checks. */
  revisionOf(content: string): string;
  /** Write one real workspace file (the tool's own root). */
  writeWorkspaceFile(relativePath: string, content: string): Promise<string>;
  /** prepare -> start -> observe the claimed Run through the public Runtime. */
  run(requestId?: string): Promise<TaskExecutionRecord>;
  /** Same, for the Run claimed at `runs[index]`. */
  runAt(index: number, requestId?: string): Promise<TaskExecutionRecord>;
  readRuns(runRefs?: readonly RunRef[]): Promise<RunActivityViewV1[]>;
  calendar(input: { goalRef?: GoalRef; from: string; to: string; granularity: 'hour' | 'day'; timeZone: string;
    sessionRefs?: SessionRef[] }): Promise<ActivityCalendarV1>;
  close(): Promise<void>;
};

function refKey(value: object): string {
  return canonicalJson(value as unknown as JsonValue);
}

export async function createS2BBe1Platform(options: S2BBe1PlatformOptions): Promise<S2BBe1PlatformFixture> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(options.initialAt ?? S2B_BE1_AT));

  const f = await createTaskClaimFixture('sqlite');
  const writeScope = [...(options.writeScope ?? [])];
  const roleWriteScope: 'none' | 'workspace' = writeScope.length === 0 ? 'none' : 'workspace';
  const actor = f.ctx.principal.kind === 'host' ? f.ctx.principal.actor : { kind: 'system' as const, id: 's2b-be1-unreachable' };

  // Real RoleSpec install/activate; the grant (tools + workspace write ceiling)
  // is the exact Host/Role intersection the Runtime will re-check (execution-preparation).
  const content: RoleSpecContentV1 = {
    schemaVersion: 1, label: 'S2B BE1 role', purpose: 'S2B_BE1_ROLE_PIN', responsibility: ['execution'],
    requiredMaterials: [{ kind: 'contract', reason: 'Read the assigned Plan/Task' }], optionalMaterials: [],
    permissions: { tools: [...options.toolNames], writeScope: roleWriteScope },
    budget: { source: 'task-budget', scope: 'assigned-task' },
    requiredOutputs: [{ kind: 'implementation-result', reason: 'Report actual results' }],
    exit: { success: 'Report result', stop: 'Stop on missing permission', handoff: 'Keep references' },
  };
  const installed = await f.roleService.installRoleSpec(f.ctx, { commandId: 's2b-be1-install-role',
    commandType: 'InstallRoleSpecRevision', schemaVersion: 1, correlationId: 's2b-be1-role', submittedAt: S2B_BE1_AT,
    identity: { projectId: f.scope.projectId, actor, idempotencyKey: 's2b-be1-install-role' },
    payload: { roleId: 'builder', revision: 1, content, contentDigest: roleSpecContentDigest(content, 'builder', 1) } });
  if (installed.status !== 'committed') throw new Error(`S2B BE1 Role install: ${JSON.stringify(installed)}`);
  const pin = { ref: installed.revisionRef, digest: installed.contentDigest };
  const activated = await f.roleService.activateRoleSpec(f.ctx, { commandId: 's2b-be1-activate-role',
    commandType: 'ActivateRoleSpecRevision', schemaVersion: 1, correlationId: 's2b-be1-role', submittedAt: S2B_BE1_AT,
    identity: { projectId: f.scope.projectId, actor, idempotencyKey: 's2b-be1-activate-role' },
    aggregateId: 'builder', expectedRevision: 1, payload: { target: pin } });
  if (activated.status !== 'committed') throw new Error(`S2B BE1 Role activation: ${JSON.stringify(activated)}`);

  const policy: CoordinationPolicyContentV1 = { schemaVersion: 1,
    budget: { maxAutonomousReworks: 0, maxClarifications: 0 },
    allowed: { inScopeRework: false, inScopeTesting: true },
    scope: { changesRequireHumanDecision: ['requirement', 'acceptance', 'baseline'] },
    upgrade: { path: 'manual-decision', note: 'Host decides' },
    roles: { catalog: { builder: pin }, coordinator: { roleId: 'builder', note: 'Coordinate' } } };
  const policyId = 's2b-be1-policy';
  const policyRef = { aggregateType: 'CoordinationPolicyRevision' as const, projectId: f.scope.projectId, policyId, revision: 1 };
  const matrix = await f.commitRaw([
    { refKey: refKey(policyRef), schemaId: 'CoordinationPolicyRevisionSnapshot@1', revision: 1,
      json: JSON.stringify({ ref: policyRef, revision: 1, schemaVersion: 1, policyId, contentRevision: 1, content: policy,
        contentDigest: coordinationPolicyContentDigest(policy, policyId, 1), installedAt: S2B_BE1_AT }) },
    { refKey: refKey({ aggregateType: 'ProjectCoordinationPolicyActive', projectId: f.scope.projectId }),
      schemaId: 'ProjectCoordinationPolicyActiveSnapshot@1', revision: 1,
      json: JSON.stringify({ ref: { aggregateType: 'ProjectCoordinationPolicyActive', projectId: f.scope.projectId }, revision: 1,
        projectId: f.scope.projectId, activeRevision: policyRef }) },
  ]);
  if (matrix.status !== 'committed') throw new Error(`S2B BE1 matrix seed: ${JSON.stringify(matrix)}`);

  const sessionRef = await f.createSession('s2b-be1-session', { kind: 'role_spec', pin });
  const taskIds = options.taskIds ?? [f.tasks.first.taskId];
  const runs: Array<{ ref: RunRef; sessionRef: SessionRef; taskId: string }> = [];
  let claim!: TaskClaim;
  for (const [index, taskId] of taskIds.entries()) {
    const runSession = index === 0 ? sessionRef : await f.createSession(`s2b-be1-session-${taskId}`, { kind: 'role_spec', pin });
    const claimed = await f.service.claimTask(f.ctx, await f.buildRequest({ input: { sessionRef: runSession, taskId } }));
    if (claimed.status !== 'committed') throw new Error(`S2B BE1 claim failed: ${JSON.stringify(claimed)}`);
    if (index === 0) claim = claimed.value;
    runs.push({ ref: claimed.value.runRef, sessionRef: runSession, taskId });
  }
  const runRef = runs[0]!.ref;

  const scripted = createBe1ScriptedModel(options.scriptedReplies, options.beforeReply);
  const allowedRuns = new Set<string>(runs.map(run => refKey(run.ref)));
  const allowsRead = options.allowsRead ?? (() => true);
  const host: RuntimeHostBindings = {
    async resolveConfiguration(ctx, request) {
      if (ctx.projectId !== f.scope.projectId || ctx.workspaceId !== f.scope.workspaceId
        || !allowedRuns.has(refKey(request.runRef))) {
        return { status: 'rejected', code: 'forbidden', reason: 'S2B BE1 Host is not bound to this complete Run/scope' };
      }
      if (request.roleResolution.status === 'inadmissible') {
        return { status: 'rejected', code: 'forbidden', reason: 'S2B BE1 Host refuses the current Role' };
      }
      return { status: 'ready', value: {
        configurationRevision: 's2b-be1-host@1',
        model: { configuration: { revision: 's2b-be1-host@1', provider: 'deepseek', model: 's2b-local-scripted', baseUrl: 'http://127.0.0.1' },
          client: scripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 's2b-be1-counter' }) } },
        budget: { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
          maxRequests: options.maxRequests ?? 128, maxToolCalls: options.maxToolCalls ?? 256,
          timeoutMs: null, perResponseTokens: 4096 },
        tools: [...options.toolNames], writeScope: [...writeScope],
        hostTemplate: null,
        ...(options.shell === true ? { shellWorkspaceAccess: 'all_except_denied' as const } : {}),
        ...(options.readonlyCommands === true ? { readonlyCommandAccess: 'all_except_denied' as const } : {}),
        skills: { resourceRoot: SKILL_ROOT, enabledIds: [] },
        systemInstruction: null,
        deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };
  const workspaceDir = join(f.directory, 'workspace');
  await mkdir(workspaceDir, { recursive: true });
  const workspaceHost: WorkspaceHostBindings = {
    async resolveRoot(scope) {
      return scope.projectId === f.scope.projectId && scope.workspaceId === f.scope.workspaceId
        ? { status: 'ready', value: { root: workspaceDir, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'forbidden', reason: 'S2B BE1 unknown workspace' };
    },
    async authorize(ctx, scope) {
      if (ctx.projectId !== f.scope.projectId || ctx.workspaceId !== f.scope.workspaceId
        || scope.projectId !== ctx.projectId || scope.workspaceId !== ctx.workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'S2B BE1 Host workspace scope mismatch' };
      }
      return { status: 'ready', value: { subjectKey: refKey(ctx.principal), permissionRevision: 's2b-be1-read@1',
        allowsRead: (path: string) => allowsRead(path) } };
    },
  };

  const directory = f.directory;
  await f.closeBackend();
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory }, workspace: workspaceHost,
    now: () => new Date().toISOString(),
    kernelStores: { entries: [{ adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store',
      workspace: f.scope, databasePath: join(directory, 'kernel.sqlite') }] },
    runtime: host,
  });

  const activityPort = (platform as unknown as { activity?: Pick<ActivityReadPort, 'readRunActivities' | 'readActivityCalendar'> }).activity;
  if (activityPort === undefined) {
    throw new Error('the composition root exposes no activity read port (Slice 2B §6): wiring is missing');
  }

  for (const [relativePath, body] of Object.entries(options.workspaceFiles ?? {})) {
    const path = join(workspaceDir, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFileOnDisk(path, body);
  }

  async function runAt(index: number, requestId = `s2b-be1-run-${String(index)}`): Promise<TaskExecutionRecord> {
    const target = runs[index]?.ref;
    if (target === undefined) throw new Error(`S2B BE1 has no claimed Run at index ${String(index)}`);
    const prepared = await platform.runtime.prepareExecution(f.ctx, { runRef: target, requestId: `${requestId}-prepare` });
    if (prepared.status !== 'ready') throw new Error(`S2B BE1 prepare failed: ${JSON.stringify(prepared)}`);
    const started = await platform.runtime.startRun(f.ctx, { prepared: prepared.value,
      consumerId: `${requestId}-driver`, requestId: `${requestId}-start` });
    if (started.status !== 'ready') throw new Error(`S2B BE1 start failed: ${JSON.stringify(started)}`);
    const observed = await platform.runtime.observeRun(f.ctx, { runRef: target });
    if (observed.status !== 'ready') throw new Error(`S2B BE1 observe failed: ${JSON.stringify(observed)}`);
    return observed.value;
  }
  const run = (requestId = 's2b-be1-run'): Promise<TaskExecutionRecord> => runAt(0, requestId);

  return {
    claimFixture: f, platform, scripted, claim, runRef, runs, goalRef: f.goalRef, scope: f.scope, ctx: f.ctx,
    sessionRef, directory: workspaceDir,
    setClock: at => { vi.setSystemTime(new Date(at)); },
    revisionOf: content => createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex'),
    async writeWorkspaceFile(relativePath, body) {
      const path = join(workspaceDir, relativePath);
      await mkdir(dirname(path), { recursive: true });
      await writeFileOnDisk(path, body);
      return createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex');
    },
    run,
    runAt,
    async readRuns(runRefs = [runRef]) {
      const result = await activityPort.readRunActivities(f.ctx, { runRefs: [...runRefs] });
      if (result.status !== 'ready') throw new Error(`S2B BE1 readRunActivities failed: ${JSON.stringify(result)}`);
      return result.value;
    },
    async calendar(input) {
      const result = await activityPort.readActivityCalendar(f.ctx, {
        scope: { kind: 'goal', goalRef: input.goalRef ?? f.goalRef },
        from: input.from, to: input.to, granularity: input.granularity, timeZone: input.timeZone,
        ...(input.sessionRefs === undefined ? {} : { sessionRefs: input.sessionRefs }) });
      if (result.status !== 'ready') throw new Error(`S2B BE1 readActivityCalendar failed: ${JSON.stringify(result)}`);
      return result.value;
    },
    async close() {
      try { await platform.close(); } finally { await f.close(); vi.useRealTimers(); }
    },
  };
}
