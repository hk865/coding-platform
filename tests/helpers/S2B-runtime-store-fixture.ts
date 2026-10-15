/**
 * Slice 2B BE1r Runtime/store fixture (lead decision P7).
 *
 * What it builds and through which public calls:
 *   - one real RecordStore (memory or SQLite) through the real
 *     `createTaskClaimFixture`, registered with exactly the schema groups
 *     `tests/helpers/B2-runtime-fixture.ts` registers
 *     (`EXECUTION_ENTRY_RECORD_SCHEMAS` plus `MODEL_REQUEST_RECORD_SCHEMAS`).
 *     The `RunActivity`/`ActivityRecording` records, their two events and the
 *     L14 indexes already ride inside those groups (Group F folded them in), so
 *     nothing is registered twice here;
 *   - a real accepted exact RoleSpec and coordination policy through the real
 *     `RoleConfigurationService` / `commitRaw` paths, a real accepted Plan and a
 *     real claim through the formal `TaskClaimPort`, and the full real
 *     Runtime/Kernel wiring, copied from `B2-runtime-fixture.ts`'s construction;
 *   - the live store handle (`records`), kept and exported, including across the
 *     SQLite `reopen()`;
 *   - the public activity reads through `createActivityReadModel`, bound to the
 *     live store and re-creatable over any caller-supplied store;
 *   - the goal executed-files reads through `createGoalExecutedFilesReader`,
 *     same binding.
 *
 * Nothing here writes a RunActivity/business fact directly: the governance seed
 * uses the same `commitRaw`/session overwrite the reviewed B2 fixture uses, and
 * every other fact comes from a real public service.
 */
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { TaskBudgetV1 } from '../../src/contracts/dispatch.js';
import { EXECUTION_ENTRY_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/execution-entry-codecs.js';
import { MODEL_REQUEST_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/model-request-codecs.js';
import { createSqliteRawArtifactStore } from '../../src/core/record-store/sqlite-body-store.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { roleSpecContentDigest, type RoleSpecContentV1 } from '../../src/contracts/role-spec.js';
import {
  coordinationPolicyContentDigest, type CoordinationPolicyContentV1,
} from '../../src/contracts/human-role-collaboration.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import type { AuthorizeConfiguration, ExecutionEntryPort } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import type { ModelRequestPort } from '../../src/core/work-graph/tasks/model-call-contracts.js';
import type { RuntimeExecutionDependencies, RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createExecutionHistoryService } from '../../src/core/work-graph/tasks/execution-history-service.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createModelCallService } from '../../src/core/work-graph/tasks/model-call-service.js';
import { createExecutionHistoryReader } from '../../src/core/agent-runtime/observation-recovery.js';
import { createGraphExecutionHistoryReader } from '../../src/core/agent-runtime/graph-execution-history.js';
import { createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { GoalExecutedFilesPort } from '../../src/core/work-graph/model/decision-contracts.js';
import { createActivityReadModel, type ActivityReadPort } from '../../src/core/work-graph/views/activity-read-model.js';
import { createGoalExecutedFilesReader } from '../../src/core/work-graph/tasks/goal-executed-files-reader.js';
import { createTaskClaimFixture, type ClaimFixtureKind, type TaskClaimFixture } from './task-claim-fixture.js';
import {
  B2_AT, createScriptedModel, createRuntimeHostDouble, digestOf,
  type B2RuntimeFixture, type B2RuntimeFixtureOverrides, type ScriptedReply,
} from './B2-runtime-fixture.js';

/** The live store handle: the B2 fixture's records port plus 2A's ordered lookup. */
export type S2BStore = TaskClaimFixture['records'] & RecordOrderedLookupPort;

/** The two public reads the BE1r rows assert through (`ActivityReadPort` calendar + runs). */
export type S2BActivityReads = Pick<ActivityReadPort, 'readActivityCalendar' | 'readRunActivities'>;

export type S2BRuntimeStoreFixtureOptions = {
  kind?: ClaimFixtureKind;
  scriptedReplies?: readonly ScriptedReply[];
  taskBudget?: TaskBudgetV1;
  host?: RuntimeHostBindings;
  beforeReply?: (request: ModelRequest, index: number, signal: AbortSignal) => Promise<void>;
  /** Extra registrations (for example `CONTROL_RECORD_SCHEMAS` for the R4 renderer). */
  additionalSchemas?: RecordBackendSchemas;
};

export type S2BRuntimeStoreFixture = B2RuntimeFixture & {
  /** The live store handle; reassigned by `reopen()` for SQLite. */
  records: S2BStore;
  /** `createActivityReadModel` over the live store. */
  activity: S2BActivityReads;
  /** `createActivityReadModel` over any caller-supplied (possibly faulty) store. */
  activityWith(records: S2BStore, readRecordCap?: number): S2BActivityReads;
  /** `createGoalExecutedFilesReader` over the live store. */
  goalExecutedFiles: GoalExecutedFilesPort;
  /** `createGoalExecutedFilesReader` over any caller-supplied store. */
  goalExecutedFilesWith(records: S2BStore): GoalExecutedFilesPort;
};

/**
 * Real Runtime/Kernel/store fixture with the BE1r extras. Its construction is
 * B2-runtime-fixture's, unchanged except for the exposed store handle, the
 * optional extra schema group and the two read-model bindings.
 */
export async function createS2BRuntimeStoreFixture(
  options: S2BRuntimeStoreFixtureOptions = {},
): Promise<S2BRuntimeStoreFixture> {
  const kind = options.kind ?? 'memory';
  const additional = options.additionalSchemas;
  const schemas = [EXECUTION_ENTRY_RECORD_SCHEMAS, MODEL_REQUEST_RECORD_SCHEMAS];
  const claimFixture = await createTaskClaimFixture(kind, {
    records: [...schemas.flatMap(s => s.records), ...(additional?.records ?? [])],
    events: [...schemas.flatMap(s => s.events), ...(additional?.events ?? [])],
    lookups: [...schemas.flatMap(s => s.lookups ?? []), ...(additional?.lookups ?? [])],
  });
  const skillRoot = join(claimFixture.directory, 'skills');
  await mkdir(join(skillRoot, 'b2-trusted-skill'), { recursive: true });
  await writeFile(join(skillRoot, 'b2-trusted-skill', 'skill.json'), JSON.stringify({ schemaVersion: 1, id: 'b2-trusted-skill', title: 'B2 trusted skill', kind: 'instruction', priority: 10, contentFile: 'content.md' }));
  await writeFile(join(skillRoot, 'b2-trusted-skill', 'content.md'), 'B2_SKILL_FROM_REAL_FILE');
  await writeFile(join(claimFixture.directory, 'b2-read.txt'), 'B2_REAL_TOOL_CONTENT');
  // Install/activate a real exact RoleSpec and matrix, then bind the existing Session.
  // This seeds governance only; it never seeds Run entered or terminal facts.
  const f = claimFixture; const actor = f.ctx.principal.kind === 'host' ? f.ctx.principal.actor : { kind: 'system' as const, id: 'unreachable' };
  const content: RoleSpecContentV1 = { schemaVersion: 1, label: 'B2 builder', purpose: 'B2_ROLE_EXACT_PIN', responsibility: ['execution'], requiredMaterials: [{ kind: 'contract', reason: 'Read the assigned Plan/Task' }], optionalMaterials: [], permissions: { tools: ['read'], writeScope: 'none' }, budget: { source: 'task-budget', scope: 'assigned-task' }, requiredOutputs: [{ kind: 'implementation-result', reason: 'Report actual results' }], exit: { success: 'Report result', stop: 'Stop on missing permission', handoff: 'Keep references' } };
  const installed = await f.roleService.installRoleSpec(f.ctx, { commandId: 'b2-install-role', commandType: 'InstallRoleSpecRevision', schemaVersion: 1, correlationId: 'b2-role', submittedAt: B2_AT, identity: { projectId: f.scope.projectId, actor, idempotencyKey: 'b2-install-role' }, payload: { roleId: 'builder', revision: 1, content, contentDigest: roleSpecContentDigest(content, 'builder', 1) } });
  if (installed.status !== 'committed') throw Error(`B2 Role install: ${JSON.stringify(installed)}`);
  const pin = { ref: installed.revisionRef, digest: installed.contentDigest };
  const activated = await f.roleService.activateRoleSpec(f.ctx, { commandId: 'b2-activate-role', commandType: 'ActivateRoleSpecRevision', schemaVersion: 1, correlationId: 'b2-role', submittedAt: B2_AT, identity: { projectId: f.scope.projectId, actor, idempotencyKey: 'b2-activate-role' }, aggregateId: 'builder', expectedRevision: 1, payload: { target: pin } });
  if (activated.status !== 'committed') throw Error(`B2 Role activation: ${JSON.stringify(activated)}`);
  const projectId = f.scope.projectId; const policyId = 'b2-runtime-policy';
  const policy: CoordinationPolicyContentV1 = { schemaVersion: 1, budget: { maxAutonomousReworks: 0, maxClarifications: 0 }, allowed: { inScopeRework: false, inScopeTesting: true }, scope: { changesRequireHumanDecision: ['requirement', 'acceptance', 'baseline'] }, upgrade: { path: 'manual-decision', note: 'Host decides' }, roles: { catalog: { builder: pin }, coordinator: { roleId: 'builder', note: 'Coordinate' } } };
  const policyRef = { aggregateType: 'CoordinationPolicyRevision', projectId, policyId, revision: 1 };
  const snapshots = [{ ref: policyRef, revision: 1, schemaVersion: 1, policyId, contentRevision: 1, content: policy, contentDigest: coordinationPolicyContentDigest(policy, policyId, 1), installedAt: B2_AT }, { ref: { aggregateType: 'ProjectCoordinationPolicyActive', projectId }, revision: 1, projectId, activeRevision: policyRef }];
  const matrix = await f.commitRaw(snapshots.map(snapshot => ({ refKey: refKey(snapshot.ref), schemaId: `${snapshot.ref.aggregateType}Snapshot@1`, revision: snapshot.revision, json: JSON.stringify(snapshot) })));
  if (matrix.status !== 'committed') throw Error(`B2 matrix seed: ${JSON.stringify(matrix)}`);
  await f.overwriteSession(f.sessions.first, record => ({ ...record, role: { kind: 'role_spec', pin } }));
  const request = await claimFixture.buildRequest(options.taskBudget ? { input: { budget: options.taskBudget } } : {});
  const claimed = await claimFixture.service.claimTask(claimFixture.ctx, request);
  if (claimed.status !== 'committed') throw new Error(`B2 fixture claim failed: ${JSON.stringify(claimed)}`);
  const claim = claimed.value;

  let clock = B2_AT;
  const now = () => clock;
  let seq = 0;
  const newId = () => `b2-runtime-id-${++seq}`;
  const eventId = () => `b2-runtime-event-${++seq}`;

  let records = claimFixture.records as S2BStore;
  let bodies = kind === 'sqlite' ? createSqliteRawArtifactStore(join(claimFixture.directory, 'artifacts.sqlite')) : new RawArtifactBodyStore();
  const scripted = createScriptedModel(options.scriptedReplies ?? [{ kind: 'text', text: 'B2 scripted answer' }], options.beforeReply);
  const allowedRuns = new Set([refKey(claim.runRef)]);
  const card = await claimFixture.sessionsPort.readSession(claimFixture.ctx, claim.sessionRef);
  if (card.status !== 'ready') throw Error('B2 mapped Session unavailable');
  const host = options.host ?? createRuntimeHostDouble({ runRefs: allowedRuns, scripted, root: claimFixture.directory, skillRoot, scope: claimFixture.scope, role: card.value.record.role });
  const kernelStores = await createKernelStoreRegistry({ entries: [{ adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store', workspace: claimFixture.scope, databasePath: join(claimFixture.directory, 'kernel.sqlite') }] });
  let entry!: ExecutionEntryPort; let modelRequests!: ModelRequestPort;
  function buildDeps(overrides: B2RuntimeFixtureOverrides = {}): RuntimeExecutionDependencies {
    const executions = createRunStateReader({ records });
    const roles = createRoleConfigurationService({ records, now, eventId });
    const reads = createMaterialRecordReaders(records);
    const materials = createMaterialService({ bodies, authority: reads.authority, now });
    const plans = createPlanService({ records, materials, now, eventId });
    const sessions = createSessionDirectory({ records, lookups: records });
    const selectedKernelStores = overrides.kernelStores ?? kernelStores;
    const sessionOperations = createSessionOperations({ sessions, kernelStores: selectedKernelStores });
    const activity = createExecutionHistoryReader({ history: sessionOperations });
    const activeHost = overrides.host ?? host;
    const authorizeConfiguration: AuthorizeConfiguration = async (ctx, input) => {
      const role = await roles.resolveRoleBinding(ctx, { roleBinding: input.run.roleBinding, declaredPermissions: input.permissions });
      if (role.status !== 'ready') return role;
      const configured = await activeHost.resolveConfiguration(ctx, { runRef: input.run.ref, role: input.sessionRole, roleResolution: role.value });
      if (configured.status !== 'ready') return configured;
      const value = configured.value;
      const template = input.sessionRole.kind === 'legacy_template' ? { templateId: 'builder', revision: '1', digest: digestOf('B2 trusted static role guidance') } : null;
      // The accepted Run is the grant being exercised. Current Host grants may
      // be wider, but every accepted capability must still fit both current
      // Host and Role ceilings; resolving the Role above validates its pins.
      const permissions = input.run.envelope?.permissions ?? input.permissions;
      const ceiling = role.value.status === 'resolved' ? role.value.spec.permissions : null;
      if (value.configurationRevision !== input.configurationRevision
        || refKey(permissions) !== refKey(input.permissions)
        || permissions.policyRevision !== input.run.roleBinding.policyRevision
        || !permissions.tools.every(tool => value.tools.includes(tool) && (!ceiling || ceiling.tools.includes(tool)))
        || !permissions.writeScope.every(path => value.writeScope.includes(path))
        || (ceiling?.writeScope === 'none' && permissions.writeScope.length !== 0)
        || refKey({ template }) !== refKey({ template: input.hostTemplate }))
        return { status: 'rejected', code: 'forbidden', reason: 'Persisted configuration differs from real current Host grant' };
      return { status: 'ready', value: { configurationRevision: value.configurationRevision, permissions: structuredClone(permissions), hostTemplate: template } };
    };
    const common = { records, reads: executions, roles, bodies, authorizeConfiguration,
      ...(overrides.hostInstance === undefined ? {} : { hostInstance: overrides.hostInstance }), now, eventId, newId };
    entry = createExecutionEntryService(common); modelRequests = createModelCallService(common);
    const runReconcile = overrides.runReconcile === true ? createRunReconcileService({ records, reads: executions,
      ...(overrides.hostInstance === undefined ? {} : { hostInstance: overrides.hostInstance }), now, eventId }) : undefined;
    return { claims: claimFixture.makeService(records), executions, entry: overrides.entry ?? entry, modelRequests: overrides.modelRequests ?? modelRequests,
      roles, plans, sessions, materials, bodies, historyWriter: createExecutionHistoryService({ records, now, eventId }), activity, graphHistory: createGraphExecutionHistoryReader({ executions, history: activity }), sessionOperations, kernelStores: selectedKernelStores,
      workspaceHost: overrides.workspaceHost ?? {
        async resolveRoot(scope) { return scope.projectId === claimFixture.scope.projectId && scope.workspaceId === claimFixture.scope.workspaceId ? { status: 'ready', value: { root: claimFixture.directory, workspaceRevision: 1 } } : { status: 'rejected', code: 'forbidden', reason: 'Unknown scope' }; },
        async authorize(ctx, scope) {
          if (ctx.projectId !== claimFixture.scope.projectId || ctx.workspaceId !== claimFixture.scope.workspaceId || scope.projectId !== ctx.projectId || scope.workspaceId !== ctx.workspaceId)
            return { status: 'rejected', code: 'forbidden', reason: 'Host workspace scope mismatch' };
          return { status: 'ready', value: { subjectKey: refKey(ctx.principal), permissionRevision: 'b2-workspace-read@1', allowsRead: path => path === 'b2-read.txt' } };
        },
      },
      sourceAuthority: overrides.sourceAuthority ?? (() => createSourceAuthorityReader({ authority: reads.authority })),
      ...(overrides.sourcePolicyFor ? { sourcePolicyFor: overrides.sourcePolicyFor } : {}),
      ...(runReconcile === undefined ? {} : { runReconcile }), host: activeHost, kernel, now, newId };
  }
  const deps = buildDeps();

  /** The public activity reads over any store (test faults pass their own). */
  function activityWith(target: S2BStore, readRecordCap?: number): S2BActivityReads {
    return createActivityReadModel({ records: target, now,
      ...(readRecordCap === undefined ? {} : { readRecordCap }) });
  }
  /** The public goal executed-files reads over any store. */
  function goalExecutedFilesWith(target: S2BStore): GoalExecutedFilesPort {
    return createGoalExecutedFilesReader({ records: target });
  }

  let secondary: Awaited<ReturnType<TaskClaimFixture['reopenService']>> | undefined;
  const fixture: S2BRuntimeStoreFixture = {
    claimFixture, claim, deps, runtime: createAgentRuntime(deps), host, entry, modelRequests, scripted, ctx: claimFixture.ctx, scope: claimFixture.scope, directory: claimFixture.directory,
    records,
    activity: activityWith(records),
    activityWith,
    goalExecutedFiles: goalExecutedFilesWith(records),
    goalExecutedFilesWith,
    allowRun: ref => { allowedRuns.add(refKey(ref)); }, setNow: at => { clock = at; },
    rebuild: overrides => createAgentRuntime(buildDeps(overrides)),
    rebuildDeps: overrides => buildDeps(overrides),
    async reopen() {
      if (kind !== 'sqlite') throw Error('SQLite reopen only');
      await claimFixture.closeBackend(); if ('close' in bodies) await bodies.close();
      secondary = await claimFixture.reopenService(); records = secondary.records as S2BStore;
      bodies = createSqliteRawArtifactStore(join(claimFixture.directory, 'artifacts.sqlite'));
      fixture.records = records;
      fixture.activity = activityWith(records);
      fixture.goalExecutedFiles = goalExecutedFilesWith(records);
      fixture.deps = buildDeps(); fixture.entry = entry; fixture.modelRequests = modelRequests; fixture.runtime = createAgentRuntime(fixture.deps);
    },
    async close() { await secondary?.close(); if ('close' in bodies) await bodies.close(); await claimFixture.close(); },
  };
  return fixture;
}

/** Canonical ref key (as `B2-runtime-fixture.ts`'s private `refKey`). */
function refKey(ref: object): string {
  return canonicalJson(ref as unknown as JsonValue);
}
