/**
 * C2 runtime-platform consumer fixture (Stage 1 skeleton).
 *
 * It composes the REAL TaskClaim fixture (Goal/Plan/Session/Role/claim over a
 * real SQLite RecordStore and a real Kernel Session) with the production
 * `createTargetPlatform` composition root. Scope/plan governance and the
 * coordination matrix are trusted fixture seeds. The exact RoleSpec is installed
 * and activated through its real writer; the claim, two Sessions, prepared
 * manifest and every material/mailbox fact also come from formal producers.
 *
 * The two Sessions are created through the real lifecycle
 * (`createSession(requestId, { kind: 'role_spec', pin })`) and claimed with an
 * explicit `sessionRef`; the fixture never rewrites a persisted Session role.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { MaterialBasisV1 } from '../../src/contracts/material-access.js';
import type { RuntimeHostBindings, RuntimeExecutionDependencies } from '../../src/core/agent-runtime/execution-contracts.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { roleSpecContentDigest, type RoleSpecContentV1 } from '../../src/contracts/role-spec.js';
import { coordinationPolicyContentDigest, type CoordinationPolicyContentV1 } from '../../src/contracts/human-role-collaboration.js';
import { SESSION_MAILBOX_TOOL_NAMES } from '../../src/core/agent-runtime/communication-tools.js';
import { WHITEBOARD_TOOL_NAMES } from '../../src/core/agent-runtime/whiteboard-tools.js';
import { createTaskClaimFixture, type TaskClaimFixture } from './task-claim-fixture.js';
import { B2_AT, createScriptedModel, type ScriptedModel, type ScriptedReply } from './B2-runtime-fixture.js';

export { B2_AT as C2_AT };

export const ALL_PLATFORM_TOOL_NAMES = [...SESSION_MAILBOX_TOOL_NAMES, ...WHITEBOARD_TOOL_NAMES];
/** The REAL deployed skill root; the fixture never fabricates skill files. */
export const C2_SKILL_ROOT = resolve(import.meta.dirname, '../../resources/skills');
export const C2_SAFETY_PATH = resolve(import.meta.dirname, '../../vendor/coding-agent/resources/skills/coding-safety/content.md');
export const C2_SKILL_IDS = ['platform-secretary', 'platform-adviser', 'platform-scribe'] as const;

export type C2RuntimePlatformOptions = {
  toolNames?: string[];
  scriptedReplies?: readonly ScriptedReply[];
  beforeReply?: (request: import('../../vendor/coding-agent/dist/public-api.js').ModelRequest, index: number, signal: AbortSignal) => Promise<void>;
  /** The Host source-read policy; false returns a real `forbidden`, never an allowsRead:false ready. */
  allowSourceRead?: boolean;
  /** Explicit enabled Skill ids; defaults to the three real deployed role skills. */
  skillIds?: string[];
  systemInstruction?: string | null;
  writeScope?: string[];
};

export type C2RuntimePlatformFixture = {
  fixture: TaskClaimFixture;
  platform: Awaited<ReturnType<typeof createTargetPlatform>>;
  scripted: ScriptedModel;
  host: RuntimeHostBindings;
  ctx: CoreCallContext;
  scope: TaskClaimFixture['scope'];
  claim: TaskClaim;
  runRef: RunRef;
  firstSession: TaskClaimFixture['sessions']['first'];
  secondSession: TaskClaimFixture['sessions']['second'];
  sessionRef: TaskClaimFixture['sessions']['first'];
  toolNames: string[];
  directory: string;
  skillRoot: string;
  authorizeCalls(): number;
  allowRun(ref: RunRef): void;
  setMaterialBasis(basis: MaterialBasisV1 | null): void;
  close(): Promise<void>;
};

export async function createC2RuntimePlatform(options: C2RuntimePlatformOptions = {}): Promise<C2RuntimePlatformFixture> {
  const toolNames = options.toolNames ?? [...ALL_PLATFORM_TOOL_NAMES];
  const systemInstruction = options.systemInstruction === undefined
    ? await readFile(C2_SAFETY_PATH, 'utf8') : options.systemInstruction;
  const f = await createTaskClaimFixture('sqlite');
  await writeFile(join(f.directory, 'c2-read.txt'), 'C2_REAL_READ_CONTENT');

  // Use the delivered RoleSpec install/activate writers. Only the coordination
  // matrix below lacks a production writer and is explicitly seeded.
  const actor = f.ctx.principal.kind === 'host' ? f.ctx.principal.actor : { kind: 'system' as const, id: 'c2-unreachable' };
  const content: RoleSpecContentV1 = { schemaVersion: 1, label: 'C2 platform tools', purpose: 'C2_PLATFORM_TOOL_PIN',
    responsibility: ['execution'], requiredMaterials: [{ kind: 'contract', reason: 'Read the assigned Plan/Task' }],
    optionalMaterials: [], permissions: { tools: [...toolNames], writeScope: 'none' },
    budget: { source: 'task-budget', scope: 'assigned-task' },
    requiredOutputs: [{ kind: 'implementation-result', reason: 'Report actual results' }],
    exit: { success: 'Report result', stop: 'Stop on missing permission', handoff: 'Keep references' } };
  const installed = await f.roleService.installRoleSpec(f.ctx, { commandId: 'c2-install-role',
    commandType: 'InstallRoleSpecRevision', schemaVersion: 1, correlationId: 'c2-role', submittedAt: B2_AT,
    identity: { projectId: f.scope.projectId, actor, idempotencyKey: 'c2-install-role' },
    payload: { roleId: 'builder', revision: 1, content, contentDigest: roleSpecContentDigest(content, 'builder', 1) } });
  if (installed.status !== 'committed') throw Error(`C2 Role install: ${JSON.stringify(installed)}`);
  const pin = { ref: installed.revisionRef, digest: installed.contentDigest };
  const activated = await f.roleService.activateRoleSpec(f.ctx, { commandId: 'c2-activate-role',
    commandType: 'ActivateRoleSpecRevision', schemaVersion: 1, correlationId: 'c2-role', submittedAt: B2_AT,
    identity: { projectId: f.scope.projectId, actor, idempotencyKey: 'c2-activate-role' },
    aggregateId: 'builder', expectedRevision: 1, payload: { target: pin } });
  if (activated.status !== 'committed') throw Error(`C2 Role activation: ${JSON.stringify(activated)}`);
  const policy: CoordinationPolicyContentV1 = { schemaVersion: 1,
    budget: { maxAutonomousReworks: 0, maxClarifications: 0 },
    allowed: { inScopeRework: false, inScopeTesting: true },
    scope: { changesRequireHumanDecision: ['requirement', 'acceptance', 'baseline'] },
    upgrade: { path: 'manual-decision', note: 'Host decides' },
    roles: { catalog: { builder: pin }, coordinator: { roleId: 'builder', note: 'Coordinate' } } };
  const policyId = 'c2-runtime-policy';
  const policyRef = { aggregateType: 'CoordinationPolicyRevision' as const, projectId: f.scope.projectId, policyId, revision: 1 };
  const matrix = await f.commitRaw([
    { refKey: canonicalJson(policyRef as unknown as JsonValue), schemaId: 'CoordinationPolicyRevisionSnapshot@1', revision: 1,
      json: JSON.stringify({ ref: policyRef, revision: 1, schemaVersion: 1, policyId, contentRevision: 1, content: policy,
        contentDigest: coordinationPolicyContentDigest(policy, policyId, 1), installedAt: B2_AT }) },
    { refKey: canonicalJson({ aggregateType: 'ProjectCoordinationPolicyActive', projectId: f.scope.projectId } as unknown as JsonValue),
      schemaId: 'ProjectCoordinationPolicyActiveSnapshot@1', revision: 1,
      json: JSON.stringify({ ref: { aggregateType: 'ProjectCoordinationPolicyActive', projectId: f.scope.projectId }, revision: 1,
        projectId: f.scope.projectId, activeRevision: policyRef }) },
  ]);
  if (matrix.status !== 'committed') throw Error(`C2 matrix seed: ${JSON.stringify(matrix)}`);

  // Real Session lifecycle: new Sessions are created with the exact RoleSpec pin.
  const roleSpec: RoleConfigurationRef = { kind: 'role_spec', pin };
  const firstSession = await f.createSession('c2-session-first', roleSpec);
  const secondSession = await f.createSession('c2-session-second', roleSpec);
  const claimed = await f.service.claimTask(f.ctx, await f.buildRequest({ input: { sessionRef: firstSession } }));
  if (claimed.status !== 'committed') throw Error(`C2 claim failed: ${JSON.stringify(claimed)}`);
  const claim = claimed.value;

  const scripted = createScriptedModel(options.scriptedReplies ?? [{ kind: 'text', text: 'C2 scripted answer' }], options.beforeReply);
  const allowedRuns = new Set<string>([canonicalJson(claim.runRef as unknown as JsonValue)]);
  let materialBasis: MaterialBasisV1 | null = null;
  let authorizeCalls = 0;
  const host: RuntimeHostBindings = {
    async resolveConfiguration(ctx, request) {
      if (ctx.projectId !== f.scope.projectId || ctx.workspaceId !== f.scope.workspaceId
        || !allowedRuns.has(canonicalJson(request.runRef as unknown as JsonValue))) {
        return { status: 'rejected', code: 'forbidden', reason: 'C2 Host is not bound to this complete Run/scope' };
      }
      if (request.roleResolution.status === 'inadmissible') {
        return { status: 'rejected', code: 'forbidden', reason: 'C2 Host refuses the current Role' };
      }
      return { status: 'ready', value: {
        configurationRevision: 'c2-host-config@1',
        model: { configuration: { revision: 'c2-host-config@1', provider: 'deepseek', model: 'c2-local-scripted', baseUrl: 'http://127.0.0.1' },
          client: scripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 'c2-fixture-counter' }) } },
        budget: { contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 12, maxToolCalls: 16, timeoutMs: 30000, perResponseTokens: 512 },
        tools: [...toolNames], writeScope: [...(options.writeScope ?? [])], hostTemplate: null,
        skills: { resourceRoot: C2_SKILL_ROOT, enabledIds: [...(options.skillIds ?? C2_SKILL_IDS)] },
        systemInstruction,
        deniedPrefixes: [], processSandboxOptions: {}, materialBasis,
      } };
    },
  };
  const workspaceHost: RuntimeExecutionDependencies['workspaceHost'] = {
    async resolveRoot(scope) {
      return scope.projectId === f.scope.projectId && scope.workspaceId === f.scope.workspaceId
        ? { status: 'ready', value: { root: f.directory, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'forbidden', reason: 'C2 unknown workspace' };
    },
    async authorize(ctx, scope) {
      authorizeCalls += 1;
      if (ctx.projectId !== f.scope.projectId || ctx.workspaceId !== f.scope.workspaceId
        || scope.projectId !== ctx.projectId || scope.workspaceId !== ctx.workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'C2 Host workspace scope mismatch' };
      }
      // A platform-only Run must never need the workspace source read policy.
      if (options.allowSourceRead !== true) {
        return { status: 'rejected', code: 'forbidden', reason: 'C2 Host denies the workspace source read' };
      }
      return { status: 'ready', value: { subjectKey: canonicalJson(ctx.principal as unknown as JsonValue),
        permissionRevision: 'c2-workspace-read@1', allowsRead: (path: string) => path === 'c2-read.txt' } };
    },
  };

  const directory = f.directory;
  await f.closeBackend();
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory }, workspace: workspaceHost, now: () => B2_AT,
    kernelStores: { entries: [{ adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store',
      workspace: f.scope, databasePath: join(directory, 'kernel.sqlite') }] },
    runtime: host,
  });

  return {
    fixture: f, platform, scripted, host, ctx: f.ctx, scope: f.scope, claim, runRef: claim.runRef,
    firstSession, secondSession, sessionRef: firstSession, toolNames, directory, skillRoot: C2_SKILL_ROOT,
    authorizeCalls: () => authorizeCalls,
    allowRun: ref => { allowedRuns.add(canonicalJson(ref as unknown as JsonValue)); },
    setMaterialBasis: basis => { materialBasis = basis; },
    async close() { await platform.close(); await f.close(); },
  };
}
