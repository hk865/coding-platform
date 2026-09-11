/**
 * RW-12／RW-15／RW-17 ContextCompiler — 派发时编译的「工作身份 + 历史材料 + 角色必读材料」。
 *
 * 覆盖：
 *   - 选材条目带理由与来源（含版本）、缺失项进 gaps、必读缺失返回 needs_material（RW-12／RW-15）；
 *   - RW-17：规格必读的 contract／code／evidence／decision 四类**各有真实通道**，
 *     装 executor 规格（真实 source 内容）的普通运行能取到带来源与版本的条目；
 *   - 判据没有放松：通道缺失／越权／工作区版本前进／索引与证据不一致 → 仍然 fail-closed；
 *     "本次范围内确定为空"（首次运行没有证据、账本里没有已接受决定）是**读到的确定事实**，
 *     既写成材料也写进 gaps，不当成"未核对"，更不当成"已满足"；
 *   - 有界：上限造成的未选入如实进 gaps。
 */
import { describe, expect, it } from 'vitest';
import { ArtifactVault } from '../../src/data/artifact-vault/artifact-vault.js';
import { ROLE_MATERIAL_CHANNEL_V1, WorkRunMaterialCompiler, type RoleMaterialChannelV1 } from '../../src/data/context-compiler/work-run-materials.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { artifactBodyDigest } from '../../src/contracts/artifact.js';
import type { ArtifactPort, ArtifactRef } from '../../src/contracts/artifact.js';
import type { StateLedger, SnapshotResult, AggregateSnapshot, EventPage, EventQuery } from '../../src/contracts/ledger.js';
import type { WorkContextPort, WorkContextAssemblyResultV1 } from '../../src/contracts/work-context-port.js';
import type { RoleSpecReadPort, RoleSpecResolutionV1 } from '../../src/contracts/role-spec-materials.js';
import type { RoleSourceIndexPort, RoleSourceIndexRequestV1, RoleSourceIndexResultV1 } from '../../src/contracts/role-material-channels.js';
import { ROLE_MATERIAL_KINDS, type RoleMaterialKindV1, type RoleSpecContentV1 } from '../../src/contracts/role-spec.js';
import { ROLE_SOURCE_EXECUTOR, ROLE_SPEC_SOURCES_V1 } from '../../src/fixtures/role-spec-fixtures.js';
import { executionNoteRefFor, workContextRefFor } from '../../src/contracts/context-continuity.js';
import type { ExecutionNoteSnapshot, WorkContextBindingSnapshot } from '../../src/contracts/context-continuity.js';
import { taskEvidenceIndexRefFor, evidenceRefFor } from '../../src/contracts/evidence.js';
import type { EvidenceSnapshot, TaskEvidenceIndexSnapshot } from '../../src/contracts/evidence.js';
import type { UserDecisionSnapshot, GoalRevisionSnapshot } from '../../src/contracts/goal-change.js';
import { P107_ROLE_BINDING_READER_V1 } from '../contract-support/fixtures/workspace-fixtures.js';
import { COMPLETION_POLICY_FIXTURE_V1, ARCHITECTURE_BASELINE_FIXTURE_V1 } from '../../src/fixtures/governance-fixtures.js';
import { completionPolicyPinFor, architectureBaselinePinFor } from '../../src/contracts/governance.js';
import { buildInstallCommand } from '../../src/contracts/commands/governance.js';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UserDecisionV1, GoalRevisionV1 } from '../../src/contracts/goal-change.js';
import type { WorkRunMaterialRequest } from '../../src/data/context-compiler/work-run-materials.js';
import type { CompletedWorkContextPort } from '../../src/contracts/completed-work-context.js';
import type { MaterialAccessGrantV1 } from '../../src/contracts/material-access.js';

const AT = '2026-09-10T00:00:00.000Z';
const PROJECT = 'proj-rw17';
const WORKSPACE = 'ws-rw17';
const GOAL = 'goal-rw17';
const TASK = 'task-rw17';
const RUN = 'real-rw17';
const WORK_ID = 'work-rw17-identity';
const PLAN_REF = { aggregateType: 'PlanRevision' as const, projectId: PROJECT, planId: 'plan-rw17' };
const runRef: RunRef = { aggregateType: 'Run', projectId: PROJECT, goalId: GOAL, runId: RUN };
const WORKSPACE_REVISION = 1;

/** 真实的 executor 规格 source（RW-11 的版本化 source）：必读 contract／code／evidence。 */
const EXECUTOR_SPEC: RoleSpecContentV1 = ROLE_SPEC_SOURCES_V1.find((source) => source.roleId === ROLE_SOURCE_EXECUTOR)!.content;

const COMMAND_DEPS = { commandId: 'install', correlationId: 'install', submittedAt: AT, projectId: PROJECT, idempotencyKey: 'install', actor: { kind: 'human' as const, id: 'user-1' } };
const COMPLETION_POLICY = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, COMMAND_DEPS) as Extract<ReturnType<typeof buildInstallCommand>, { commandType: 'InstallCompletionPolicyRevision' }>;
const ARCHITECTURE_BASELINE = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, { ...COMMAND_DEPS, commandId: 'install-2', idempotencyKey: 'install-2' }) as Extract<ReturnType<typeof buildInstallCommand>, { commandType: 'InstallArchitectureBaselineRevision' }>;
const COMPLETION_POLICY_PIN = completionPolicyPinFor(COMPLETION_POLICY);
const ARCHITECTURE_BASELINE_PIN = architectureBaselinePinFor(ARCHITECTURE_BASELINE);

const bindingSnapshot: WorkContextBindingSnapshot = {
  ref: workContextRefFor(PROJECT, WORKSPACE, WORK_ID),
  revision: 1,
  schemaVersion: 1,
  binding: {
    schemaVersion: 1, workId: WORK_ID, projectId: PROJECT, workspaceId: WORKSPACE, workKind: 'task',
    goalId: GOAL, taskId: TASK, planRef: PLAN_REF, planRevision: 1, roleBindingRef: P107_ROLE_BINDING_READER_V1,
    initialRunRef: runRef, linkedRunRefs: [runRef], status: 'active', createdAt: AT,
  },
};

/** 本 Run 所在 revision 的已接受计划快照（contract／evidence 两类材料的事实来源）。 */
const PLAN_SNAPSHOT: PlanRevisionSnapshot = {
  ref: PLAN_REF,
  revision: 1,
  schemaVersion: 1,
  goalRef: { aggregateType: 'Goal', projectId: PROJECT, goalId: GOAL },
  planId: PLAN_REF.planId,
  planRevision: 1,
  acceptedAt: AT,
  effectiveCompletionPolicy: COMPLETION_POLICY_PIN,
  effectiveArchitectureBaseline: ARCHITECTURE_BASELINE_PIN,
  stages: [{ stageId: 'stage-1', title: '工作' }],
  tasks: [{
    taskId: TASK, stageId: 'stage-1', title: '实现一点东西', requirementLevel: 'required', taskKind: 'work',
    disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: 'stage-1' },
  }],
  assignments: [{ taskId: TASK, role: ROLE_SOURCE_EXECUTOR, instruction: '实现 src/hello.ts 并报告结果' }],
  obligations: [{
    obligationId: 'ob-1', title: '实现结果可核对', requirementLevel: 'required', taskIds: [TASK],
    verificationRequirements: [{ requirementId: 'vr-1', requirementLevel: 'required', kind: 'dynamic', description: '跑一次命令检查' }],
  }],
  taskHierarchy: { parentOf: [] },
  executionDag: { dependsOn: [] },
};

function noteSnapshot(noteId: string, kind: 'key_choice' | 'unresolved'): ExecutionNoteSnapshot {
  return {
    ref: executionNoteRefFor(PROJECT, WORKSPACE, WORK_ID, noteId), revision: 1, schemaVersion: 1,
    recordedAt: AT,
    note: {
      schemaVersion: 1, noteId, workId: WORK_ID, projectId: PROJECT, workspaceId: WORKSPACE, runRef,
      attemptRef: null, roleBindingRef: P107_ROLE_BINDING_READER_V1, kind,
      summary: '摘要-' + noteId, reason: '理由-' + noteId, alternatives: ['备选-' + noteId],
      sourceRefs: [{ kind: 'event', refKey: 'goal:' + GOAL, version: 1, label: 'goal' }],
      applicableVersions: { planRef: PLAN_REF, planRevision: 1, workspaceRevision: WORKSPACE_REVISION, governanceRevision: null },
      verification: { status: 'unverified', evidenceRefs: [] },
      bodyRef: { kind: 'artifact', contentType: 'application/json', digest: artifactBodyDigest('body-' + noteId), sizeBytes: 4, source: { kind: 'artifact', refId: noteId, revision: '1' } },
      noFullTranscript: true, createdAt: AT,
    },
  };
}

function evidenceSnapshot(evidenceId: string, taskId: string, outcome: 'PASS' | 'FAIL'): EvidenceSnapshot {
  return {
    ref: evidenceRefFor(PROJECT, evidenceId), revision: 1, schemaVersion: 1, admittedAt: AT,
    evidence: {
      schemaVersion: 1, evidenceId, kind: 'verdict', outcome,
      source: { actor: { kind: 'system', id: 'check' }, runRef: null, checkId: 'check-1' },
      subject: { projectId: PROJECT, goalId: GOAL, taskId },
      coverage: [{ obligationId: 'ob-1', requirementId: 'vr-1' }],
      anchor: { schemaVersion: 1, planRef: PLAN_REF, planRevision: 1, workspaceRevision: WORKSPACE_REVISION, pinnedCompletionPolicy: COMPLETION_POLICY_PIN, pinnedArchitectureBaseline: ARCHITECTURE_BASELINE_PIN },
      verificationPlanRef: { planId: 'vp-1', planDigest: 'a'.repeat(64) },
      summary: { text: '检查结论', artifactRef: null },
    },
  };
}

function userDecisionSnapshot(decision: UserDecisionV1): UserDecisionSnapshot {
  return { ref: { aggregateType: 'UserDecision', projectId: PROJECT, workspaceId: WORKSPACE, decisionId: decision.decisionId }, revision: 1, schemaVersion: 1, decision, recordedAt: AT };
}

function goalRevisionSnapshot(change: GoalRevisionV1): GoalRevisionSnapshot {
  return { ref: { aggregateType: 'GoalRevision', projectId: PROJECT, workspaceId: WORKSPACE, goalId: GOAL, revision: change.revision }, revision: 1, schemaVersion: 1, change, recordedAt: AT };
}

const USER_DECISION: UserDecisionV1 = {
  schemaVersion: 1, decisionId: 'decision-rw17', projectId: PROJECT, workspaceId: WORKSPACE,
  proposalRef: { aggregateType: 'PlanProposal', projectId: PROJECT, workspaceId: WORKSPACE, proposalId: 'proposal-rw17' },
  subject: { goalRef: { aggregateType: 'Goal', projectId: PROJECT, goalId: GOAL }, sourcePlanRef: PLAN_REF, sourcePlanRevision: 1 },
  outcome: 'accept', actor: { kind: 'human', id: 'user-1' }, authority: { strategy: 'user', delegator: null, policyVersion: 'v1' },
  authorizedTarget: { goalId: GOAL, newObjective: null, sourcePlanDigest: 'b'.repeat(64) },
  summary: '接受这份计划变更', decidedAt: AT,
};

const GOAL_REVISION: GoalRevisionV1 = {
  schemaVersion: 1, goalRef: { aggregateType: 'Goal', projectId: PROJECT, goalId: GOAL }, revision: 2,
  activePlanRef: PLAN_REF, supersededPlanRefs: [], changedAt: AT, reason: '返工受理',
};

type LedgerOptions = {
  notes?: ExecutionNoteSnapshot[];
  plan?: PlanRevisionSnapshot | null;
  workspaceRevision?: number | null;
  evidenceIndex?: { taskId: string; evidenceIds: string[] } | null;
  evidence?: EvidenceSnapshot[];
  decisions?: UserDecisionV1[];
  goalRevisions?: GoalRevisionV1[];
  /** 索引里列出但读不到的 evidenceId（用于证明"索引与证据不一致即缺失"）。 */
  danglingEvidenceId?: string;
  eventsError?: string;
  /** RW-18：额外挂到账本上的 canonical 聚合（例如"其它工作"的 ExecutionNote）。 */
  extra?: AggregateSnapshot[];
};

function ledgerFor(options: LedgerOptions = {}): Pick<StateLedger, 'load' | 'events'> {
  const notes = options.notes ?? [noteSnapshot('note-1', 'key_choice')];
  const rows = new Map<string, AggregateSnapshot>();
  rows.set(canonicalJson(bindingSnapshot.ref as never), bindingSnapshot as AggregateSnapshot);
  for (const note of notes) rows.set(canonicalJson(note.ref as never), note as AggregateSnapshot);
  if (options.plan !== null) rows.set(canonicalJson(PLAN_REF as never), (options.plan ?? PLAN_SNAPSHOT) as AggregateSnapshot);
  const workspaceRevision = options.workspaceRevision === undefined ? WORKSPACE_REVISION : options.workspaceRevision;
  if (workspaceRevision !== null) {
    rows.set(canonicalJson({ aggregateType: 'Workspace', projectId: PROJECT, workspaceId: WORKSPACE } as never), {
      ref: { aggregateType: 'Workspace', projectId: PROJECT, workspaceId: WORKSPACE }, revision: workspaceRevision,
    } as AggregateSnapshot);
  }
  if (options.evidenceIndex) {
    const ref = taskEvidenceIndexRefFor(PROJECT, GOAL, options.evidenceIndex.taskId);
    rows.set(canonicalJson(ref as never), { ref, revision: options.evidenceIndex.evidenceIds.length, schemaVersion: 1, evidenceIds: options.evidenceIndex.evidenceIds } as TaskEvidenceIndexSnapshot as AggregateSnapshot);
  }
  for (const evidence of options.evidence ?? []) rows.set(canonicalJson(evidence.ref as never), evidence as AggregateSnapshot);
  for (const decision of options.decisions ?? []) {
    const snapshot = userDecisionSnapshot(decision);
    rows.set(canonicalJson(snapshot.ref as never), snapshot as AggregateSnapshot);
  }
  for (const change of options.goalRevisions ?? []) {
    const snapshot = goalRevisionSnapshot(change);
    rows.set(canonicalJson(snapshot.ref as never), snapshot as AggregateSnapshot);
  }
  for (const snapshot of options.extra ?? []) rows.set(canonicalJson(snapshot.ref as never), snapshot);
  const events: EventPage = {
    afterCursor: null,
    throughCursor: null,
    hasMore: false,
    events: [
      ...(options.decisions ?? []).map((decision, index) => ({
        cursor: 'cursor-decision-' + index,
        event: { eventId: 'e' + index, eventType: 'UserDecisionRecorded', schemaVersion: 1, projectId: PROJECT, workspaceId: WORKSPACE, payload: { decision, recordedAt: AT } },
      })),
      ...(options.goalRevisions ?? []).map((change, index) => ({
        cursor: 'cursor-goal-' + index,
        event: { eventId: 'g' + index, eventType: 'GoalRevisionRecorded', schemaVersion: 1, projectId: PROJECT, workspaceId: WORKSPACE, payload: { change, recordedAt: AT } },
      })),
    ] as unknown as EventPage['events'],
  };
  return {
    load: async (ref): Promise<SnapshotResult> => {
      const found = rows.get(canonicalJson(ref as never));
      if (options.danglingEvidenceId !== undefined && canonicalJson(evidenceRefFor(PROJECT, options.danglingEvidenceId) as never) === canonicalJson(ref as never)) {
        return { status: 'not_found', ref };
      }
      return found ? { status: 'found', snapshot: found } : { status: 'not_found', ref };
    },
    events: async (query: EventQuery): Promise<EventPage> => {
      if (options.eventsError !== undefined) throw Error(options.eventsError);
      return { ...events, afterCursor: query.afterCursor };
    },
  };
}

/** 真实 ArtifactVault + 一个把有界包真正放进 Vault 的 WorkContextPort 替身。 */
function workContextReturning(rows: Array<Record<string, unknown>>, existing?: ArtifactVault): { port: WorkContextPort; vault: ArtifactVault } {
  // RW-18：调用方可以传入**同一个** Vault（历史授权与工作身份材料落在同一个 Vault 里才是真实形态）。
  const vault = existing ?? new ArtifactVault();
  const port: WorkContextPort = {
    assembleWorkContext: async (): Promise<WorkContextAssemblyResultV1> => {
      const body = canonicalJson({ schemaVersion: 1, workContextRef: bindingSnapshot.ref, binding: bindingSnapshot.binding, bucketRows: rows, latestContinuation: null, selectedSources: [], generatedAt: AT } as never);
      const put = await vault.put({ contentType: 'application/json', body, sourceRefs: [{ kind: 'workspace', refId: WORKSPACE, revision: String(WORKSPACE_REVISION) }], ownerRef: runRef, requestedAt: AT });
      if (put.status !== 'stored') throw Error('fixture put failed');
      return {
        status: 'ready',
        bundleRef: put.ref,
        manifest: { bundleRef: put.ref, selected: [], truncated: [], gaps: [], freshness: { bindingCursor: null, notesCursor: null, continuationCursor: null, observedCursor: null }, totalBytes: body.length },
      };
    },
  };
  return { port, vault };
}

/** 一个"真实"的源码索引端口替身：只记录被调用的请求，并按用例返回结果。 */
function sourceIndex(behaviour?: (request: RoleSourceIndexRequestV1) => RoleSourceIndexResultV1) {
  const calls: RoleSourceIndexRequestV1[] = [];
  const port: RoleSourceIndexPort = {
    readSourceIndex: async (request) => {
      calls.push(structuredClone(request));
      if (behaviour) return behaviour(request);
      return {
        status: 'sourced',
        provenance: { workspace: 'kernel-workspace-identity' },
        entries: [{ path: 'src/hello.ts' }, { path: 'README.md' }],
        entryCount: 2,
        truncated: false,
        excerpts: [{ path: 'src/hello.ts', revision: 'rev-hello', content: 'export const hello = 1;\n' }],
        excerptNotes: [],
      };
    },
  };
  return { port, calls };
}

function request(overrides: Partial<WorkRunMaterialRequest> = {}): WorkRunMaterialRequest {
  return {
    schemaVersion: 1,
    scope: { projectId: PROJECT, workspaceId: WORKSPACE, goalId: GOAL, taskId: TASK, runId: RUN },
    planRef: PLAN_REF,
    workspaceSnapshot: { workspaceId: WORKSPACE, revision: WORKSPACE_REVISION },
    roleBinding: P107_ROLE_BINDING_READER_V1,
    permissions: { policyRevision: 'p', tools: ['read', 'write', 'shell'], writeScope: ['*'] },
    workId: WORK_ID,
    ...overrides,
  };
}

function roleSpecContent(overrides: Partial<RoleSpecContentV1> = {}): RoleSpecContentV1 {
  return {
    schemaVersion: 1, label: '实现者', purpose: '在已授权范围内实现已接受的任务',
    responsibility: ['execution'],
    requiredMaterials: [{ kind: 'history', reason: '相关已完成工作的工程事实' }],
    optionalMaterials: [],
    permissions: { tools: ['read', 'write', 'shell'], writeScope: 'workspace' },
    budget: { source: 'task-budget', scope: 'assigned-task' },
    requiredOutputs: [{ kind: 'implementation-result', reason: '必须给出实现结果' }],
    exit: { success: '任务产出可核对', stop: '预算耗尽或缺少授权', handoff: '已做事项与未解问题' },
    ...overrides,
  };
}

function rolePort(resolution: RoleSpecResolutionV1): RoleSpecReadPort {
  return { resolve: async () => resolution };
}

const executorResolution: RoleSpecResolutionV1 = {
  status: 'resolved', roleId: ROLE_SOURCE_EXECUTOR,
  revision: { aggregateType: 'RoleSpecRevision', projectId: PROJECT, roleId: ROLE_SOURCE_EXECUTOR, revision: 1 },
  spec: EXECUTOR_SPEC,
};

describe('RW-17 角色必读材料的真实通道', () => {
  it('装 executor 规格（真实 source）后，普通运行能取到 contract／code／evidence 三类带理由与来源的条目', async () => {
    const { port, vault } = workContextReturning([{ noteId: 'note-1', kind: 'key_choice', summary: '摘要-note-1', runRef, createdAt: AT, sourceCursor: null, truncated: false, historical: false }]);
    const index = sourceIndex();
    const compiler = new WorkRunMaterialCompiler({
      ledger: ledgerFor(), vault, workContext: port, roleSpec: rolePort(executorResolution), sourceIndex: index.port,
    });
    const result = await compiler.compile(request());
    expect(result.status, JSON.stringify(result)).toBe('ready');
    if (result.status !== 'ready') return;
    const materials = result.materials;

    // 1) contract 走既有 rules 小节：本 Run 的已接受任务包 + 计划固定的契约／治理 pin。
    expect(materials.rules).toHaveLength(1);
    const contract = materials.rules[0]!;
    expect(contract.ruleKey).toBe('role-material:contract:accepted-task');
    expect(contract.content).toContain('ob-1');
    expect(contract.content).toContain(COMPLETION_POLICY_PIN.ref.policyId);
    expect(contract.content).toContain('实现 src/hello.ts 并报告结果');
    expect(contract.digest).toBe(artifactBodyDigest(contract.content));
    expect(contract.sourceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'plan-revision', refId: PLAN_REF.planId, revision: '1' }),
      expect.objectContaining({ kind: 'workspace', revision: String(WORKSPACE_REVISION) }),
      expect.objectContaining({ kind: 'governance', refId: COMPLETION_POLICY_PIN.ref.policyId }),
      expect.objectContaining({ kind: 'governance', refId: ARCHITECTURE_BASELINE_PIN.ref.baselineId }),
    ]));
    expect(contract.selectedBecause).toContain('contract');

    // 2) code／evidence 走 roleMaterials：每条带 selectedBecause、sourceRefs（含版本）与 qualification。
    const entries = materials.roleMaterials!.entries;
    const code = entries.find((entry) => entry.kind === 'code')!;
    expect(code, 'code 材料条目缺失').toBeDefined();
    expect(code.qualification).toBe('reference');
    expect(code.selection).toBe('selected');
    expect(code.content).toContain('src/hello.ts');
    expect(code.content).toContain('export const hello = 1;');
    expect(code.digest).toBe(artifactBodyDigest(code.content));
    expect(code.sourceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'workspace', revision: String(WORKSPACE_REVISION) }),
      expect.objectContaining({ kind: 'artifact', refId: 'source-file:src/hello.ts', revision: 'rev-hello' }),
    ]));
    expect(code.selectedBecause).toContain('code');
    // 端口收到的就是信封上的权限与 claim 时的工作区版本（没有被放大）。
    expect(index.calls).toHaveLength(1);
    expect(index.calls[0]!.declaredTools).toEqual(['read', 'write', 'shell']);
    expect(index.calls[0]!.workspaceRevision).toBe(WORKSPACE_REVISION);

    const evidence = entries.find((entry) => entry.kind === 'evidence')!;
    expect(evidence).toBeDefined();
    expect(evidence.selection).toBe('empty');
    // "确定为空"也要能回到 canonical 来源：索引聚合的 ref 与 revision 都在材料里。
    expect(evidence.content).toContain('"aggregateType":"TaskEvidenceIndex"');
    expect(evidence.sourceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'artifact', refId: 'task-evidence-index:' + TASK, revision: '0' }),
    ]));
    expect(evidence.sourceRefs.every((ref) => ref.revision.length > 0)).toBe(true);
    expect(materials.evidenceRefs).toEqual([]);

    // 3) 逐类记录写进角色规格条目（manifest 的 role-spec 条目据此可逐类核对）。
    const required = materials.roleSpec!.requiredMaterials;
    expect(required.map((entry) => entry.kind)).toEqual(['contract', 'code', 'evidence']);
    for (const entry of required) {
      expect(entry.supplied, entry.kind).toBe(true);
      expect(entry.detail!.length).toBeGreaterThan(0);
      expect(entry.materialIds!.length).toBeGreaterThan(0);
      expect(entry.sourceRefs!.every((ref) => ref.revision.length > 0)).toBe(true);
    }
    expect(required.find((entry) => entry.kind === 'evidence')!.selection).toBe('empty');
    // 4) "确定为空"必须如实说出来（既不当成未核对，也不当成已满足）。
    expect(materials.gaps.join('\n')).toContain('确定事实');
    // 5) 材料不改变权限：条目的资格只有"参考"，也没有任何完成状态。
    expect(entries.every((entry) => entry.qualification === 'reference')).toBe(true);
    expect(JSON.stringify(materials)).not.toContain('"completed"');
  });

  it('code 取材受信封权限约束：信封没有 read 就不读取（端口一次都不会被调用）', async () => {
    const { port, vault } = workContextReturning([]);
    const index = sourceIndex(() => { throw Error('端口不该被调用：信封没有 read'); });
    const compiler = new WorkRunMaterialCompiler({
      ledger: ledgerFor(), vault, workContext: port, roleSpec: rolePort(executorResolution), sourceIndex: index.port,
    });
    const result = await compiler.compile(request({ permissions: { policyRevision: 'p', tools: ['write'], writeScope: ['*'] } }));
    expect(result.status).toBe('needs_material');
    if (result.status !== 'needs_material') return;
    const gaps = result.gaps.filter((gap) => gap.kind === 'code').map((gap) => gap.message).join('\n');
    expect(gaps).toContain('fail-closed');
    expect(gaps).toContain('read');
    expect(index.calls).toHaveLength(0);
  });

  it('code 取材受工作区版本约束：信封版本与 canonical 不一致即 stale 失败（不读取）', async () => {
    const { port, vault } = workContextReturning([]);
    const index = sourceIndex();
    const compiler = new WorkRunMaterialCompiler({
      ledger: ledgerFor({ workspaceRevision: WORKSPACE_REVISION + 5 }), vault, workContext: port, roleSpec: rolePort(executorResolution), sourceIndex: index.port,
    });
    const result = await compiler.compile(request());
    expect(result.status).toBe('needs_material');
    if (result.status !== 'needs_material') return;
    const gaps = result.gaps.filter((gap) => gap.kind === 'code').map((gap) => gap.message).join('\n');
    expect(gaps).toContain('stale');
    expect(gaps).toContain('工作区版本已前进');
    expect(index.calls).toHaveLength(0);
  });

  it('宿主未接线源码索引端口：code 按缺失处理（不退回"没有源码也能开工"）', async () => {
    const { port, vault } = workContextReturning([]);
    const compiler = new WorkRunMaterialCompiler({ ledger: ledgerFor(), vault, workContext: port, roleSpec: rolePort(executorResolution) });
    const result = await compiler.compile(request());
    expect(result.status).toBe('needs_material');
    if (result.status !== 'needs_material') return;
    expect(result.gaps.map((gap) => gap.kind)).toContain('code');
    expect(result.gaps.find((gap) => gap.kind === 'code')!.message).toContain('RoleSourceIndexPort');
  });

  it('evidence：索引列出的证据读不到（索引与证据不一致）即按缺失处理', async () => {
    const { port, vault } = workContextReturning([]);
    const index = sourceIndex();
    const compiler = new WorkRunMaterialCompiler({
      ledger: ledgerFor({ evidenceIndex: { taskId: TASK, evidenceIds: ['evidence-missing'] }, danglingEvidenceId: 'evidence-missing' }),
      vault, workContext: port, roleSpec: rolePort(executorResolution), sourceIndex: index.port,
    });
    const result = await compiler.compile(request());
    expect(result.status).toBe('needs_material');
    if (result.status !== 'needs_material') return;
    const gaps = result.gaps.filter((gap) => gap.kind === 'evidence').map((gap) => gap.message).join('\n');
    expect(gaps).toContain('evidence-missing');
    expect(gaps).toContain('fail-closed');
  });

  it('evidence：已接纳证据按 subject 复核后进入材料与既有 evidenceRefs 索引', async () => {
    const { port, vault } = workContextReturning([]);
    const index = sourceIndex();
    const compiler = new WorkRunMaterialCompiler({
      ledger: ledgerFor({
        evidenceIndex: { taskId: TASK, evidenceIds: ['evidence-1'] },
        evidence: [evidenceSnapshot('evidence-1', TASK, 'PASS')],
      }),
      vault, workContext: port, roleSpec: rolePort(executorResolution), sourceIndex: index.port,
    });
    const result = await compiler.compile(request());
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    const evidence = result.materials.roleMaterials!.entries.find((entry) => entry.kind === 'evidence')!;
    expect(evidence.selection).toBe('selected');
    expect(evidence.content).toContain('evidence-1');
    expect(evidence.content).toContain('PASS');
    expect(result.materials.evidenceRefs).toEqual([
      expect.objectContaining({ kind: 'artifact', refId: 'evidence:evidence-1', revision: '1' }),
    ]);
    expect(result.materials.roleSpec!.requiredMaterials.find((entry) => entry.kind === 'evidence')!.selection).toBe('selected');
  });

  it('decision：账本里已落账的决定逐条按 canonical 聚合复核并带来源；扫完确实没有则如实说"确定为空"', async () => {
    const { port, vault } = workContextReturning([]);
    const index = sourceIndex();
    const withDecision = new WorkRunMaterialCompiler({
      ledger: ledgerFor({ decisions: [USER_DECISION], goalRevisions: [GOAL_REVISION] }),
      vault, workContext: port, sourceIndex: index.port,
      roleSpec: rolePort({ ...executorResolution, spec: { ...EXECUTOR_SPEC, requiredMaterials: [{ kind: 'decision', reason: '已接受决定是边界' }] } }),
    });
    const selected = await withDecision.compile(request());
    expect(selected.status).toBe('ready');
    if (selected.status !== 'ready') return;
    const decision = selected.materials.roleMaterials!.entries.find((entry) => entry.kind === 'decision')!;
    expect(decision.selection).toBe('selected');
    expect(decision.content).toContain('decision-rw17');
    expect(decision.content).toContain('返工受理');
    expect(decision.sourceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'governance', refId: 'user-decision:decision-rw17' }),
      expect.objectContaining({ kind: 'governance', refId: 'goal-revision:' + GOAL + '/2' }),
    ]));

    const empty = new WorkRunMaterialCompiler({
      ledger: ledgerFor(), vault, workContext: port, sourceIndex: index.port,
      roleSpec: rolePort({ ...executorResolution, spec: { ...EXECUTOR_SPEC, requiredMaterials: [{ kind: 'decision', reason: '已接受决定是边界' }] } }),
    });
    const none = await empty.compile(request());
    expect(none.status).toBe('ready');
    if (none.status !== 'ready') return;
    const noneEntry = none.materials.roleMaterials!.entries.find((entry) => entry.kind === 'decision')!;
    expect(noneEntry.selection).toBe('empty');
    expect(noneEntry.content).toContain('"complete":true');
    expect(none.materials.gaps.join('\n')).toContain('确定事实');
  });

  it('decision：宿主没有事件读取能力时按缺失处理（不猜）', async () => {
    const { port, vault } = workContextReturning([]);
    const index = sourceIndex();
    const ledger = ledgerFor();
    const compiler = new WorkRunMaterialCompiler({
      ledger: { load: ledger.load, events: async () => { throw Error('事件读取不可用'); } },
      vault, workContext: port, sourceIndex: index.port,
      roleSpec: rolePort({ ...executorResolution, spec: { ...EXECUTOR_SPEC, requiredMaterials: [{ kind: 'decision', reason: '已接受决定是边界' }] } }),
    });
    const result = await compiler.compile(request());
    expect(result.status).toBe('needs_material');
    if (result.status !== 'needs_material') return;
    expect(result.gaps.find((gap) => gap.kind === 'decision')!.message).toContain('事件读取失败');
  });

  it('有界：源码索引超限与正文未取全如实进 gaps（不静默裁剪）', async () => {
    const { port, vault } = workContextReturning([]);
    const index = sourceIndex((source) => ({
      status: 'sourced',
      provenance: { workspace: 'kernel-workspace-identity' },
      entries: [{ path: 'src/hello.ts' }],
      entryCount: 1,
      truncated: true,
      excerpts: [],
      excerptNotes: ['索引清单达到上限 ' + source.maxEntries + ' 条：未列出的路径不在本次材料内'],
    }));
    const compiler = new WorkRunMaterialCompiler({
      ledger: ledgerFor(), vault, workContext: port, roleSpec: rolePort(executorResolution), sourceIndex: index.port,
    });
    const result = await compiler.compile(request());
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    const gaps = result.materials.gaps.join('\n');
    expect(gaps).toContain('索引清单达到上限');
    expect(gaps).toContain('未列出的路径不在本次材料内');
    expect(result.materials.roleMaterials!.entries.find((entry) => entry.kind === 'code')!.content).toContain('"truncated":true');
  });

  it('桥表全键穷尽且四类都已接通（值不再是 null），每一类都写明实际通道', async () => {
    const bridge: Record<RoleMaterialKindV1, RoleMaterialChannelV1> = ROLE_MATERIAL_CHANNEL_V1;
    expect(Object.keys(bridge).sort()).toEqual([...ROLE_MATERIAL_KINDS].sort());
    for (const kind of ROLE_MATERIAL_KINDS) {
      expect(bridge[kind].suppliedBy.length, kind).toBeGreaterThan(0);
      // RW-17：五类全部有真实通道（历史／契约／源码／证据／决定）；null 只留给将来新增的类别。
      expect(bridge[kind].channel, kind).not.toBeNull();
    }
    expect(bridge.contract.channel).toBe('contract');
    expect(bridge.code.channel).toBe('code');
    expect(bridge.evidence.channel).toBe('evidence');
    expect(bridge.decision.channel).toBe('decision');
    expect(bridge.history.channel).toBe('history');
  });

  it('把工作身份与同工作留痕编译成带理由与来源的材料；历史材料只能是历史解释', async () => {
    const { port, vault } = workContextReturning([{ noteId: 'note-1', kind: 'key_choice', summary: '摘要-note-1', runRef, createdAt: AT, sourceCursor: null, truncated: false, historical: false }]);
    const compiler = new WorkRunMaterialCompiler({ ledger: ledgerFor(), vault, workContext: port });
    const result = await compiler.compile(request());
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    const work = result.materials.workContext!;
    expect(work.identity.workId).toBe(WORK_ID);
    expect(work.identity.linkedRunIds).toEqual([RUN]);
    expect(work.identity.sourceRefs.length).toBeGreaterThan(0);
    expect(work.identity.sourceRefs.every((ref) => ref.refId.length > 0 && ref.revision.length > 0)).toBe(true);
    expect(work.identity.selectedBecause).toContain('工作身份');

    expect(work.notes).toHaveLength(1);
    const note = work.notes[0]!;
    expect(note.applicability).toBe('historical_explanation');
    expect(note.materialId).toBe('note-1');
    expect(note.content).toContain('理由-note-1');
    expect(note.selectedBecause).toContain(WORK_ID);
    expect(note.digest).toBe(artifactBodyDigest(note.content));
    expect(note.sourceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'artifact', refId: 'note-1', revision: '1' }),
      expect.objectContaining({ kind: 'workspace', revision: '1' }),
      expect.objectContaining({ kind: 'plan-revision', revision: '1' }),
    ]));
    expect(result.materials.gaps.join('\n')).toContain('CompletedWorkContextPort');
  });

  it('RW-18：选材端口报缺料时如实转述缺口（历史不是"随便取"的材料）', async () => {
    const { port, vault } = workContextReturning([]);
    const compiler = new WorkRunMaterialCompiler({
      ledger: ledgerFor(), vault, workContext: port,
      completedWork: { assembleCompletedWorkContext: async () => ({ status: 'needs_material', gaps: [{ code: 'no_records', message: 'no completed work records in scope' }], selectedRefs: [] }) },
    });
    const result = await compiler.compile(request());
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    const gaps = result.materials.gaps.join('\n');
    expect(gaps).toContain('no completed work records in scope');
  });

  it('工作身份缺失：必读时返回 needs_material 并写清缺哪一类、为什么', async () => {
    const { port, vault } = workContextReturning([]);
    const compiler = new WorkRunMaterialCompiler({
      ledger: { load: async (ref) => ({ status: 'not_found' as const, ref: ref as never }), events: async () => ({ afterCursor: null, throughCursor: null, hasMore: false, events: [] }) },
      vault, workContext: port,
    });
    const result = await compiler.compile(request());
    expect(result.status).toBe('needs_material');
    if (result.status !== 'needs_material') return;
    expect(result.gaps.map((gap) => gap.kind)).toContain('work-identity');
    expect(result.gaps.some((gap) => gap.message.includes('DispatchEngine'))).toBe(true);
  });

  it('上限造成的未选入写进 gaps：不静默裁剪', async () => {
    const rows = Array.from({ length: 3 }, (_, index) => ({ noteId: 'note-' + String(index + 1), kind: 'checkpoint', summary: 's', runRef, createdAt: AT, sourceCursor: null, truncated: false, historical: false }));
    const notes = rows.map((row) => noteSnapshot(String(row['noteId']), 'key_choice'));
    const { port, vault } = workContextReturning(rows);
    const truncating: WorkContextPort = {
      assembleWorkContext: async (req) => {
        const assembled = await port.assembleWorkContext(req);
        if (assembled.status !== 'ready') return assembled;
        return { ...assembled, manifest: { ...assembled.manifest, truncated: [{ noteIds: ['note-3'], reason: 'notes beyond maxNotes=2 are not included' }] } };
      },
    };
    const compiler = new WorkRunMaterialCompiler({ ledger: ledgerFor({ notes }), vault, workContext: truncating });
    const result = await compiler.compile(request({ limits: { maxNotes: 2 } }));
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.materials.gaps.join('\n')).toContain('未全部选入');
    expect(result.materials.gaps.join('\n')).toContain('note-3');
  });

  it('角色规格：必读 history（既有通道）缺失即 needs_material', async () => {
    const { port, vault } = workContextReturning([]);
    const compiler = new WorkRunMaterialCompiler({
      ledger: ledgerFor(), vault, workContext: port,
      roleSpec: rolePort({
        status: 'resolved', roleId: 'executor',
        revision: { aggregateType: 'RoleSpecRevision', projectId: PROJECT, roleId: 'executor', revision: 1 },
        spec: roleSpecContent({ requiredMaterials: [{ kind: 'history', reason: '相关已完成工作的工程事实' }] }),
      }),
    });
    const result = await compiler.compile(request());
    expect(result.status).toBe('needs_material');
    if (result.status !== 'needs_material') return;
    expect(result.gaps.map((gap) => gap.kind)).toContain('history');
  });

  it('角色规格：权限越界由 ControlEngine 的判据判定，本编译器拒绝该次派发材料', async () => {
    const { port, vault } = workContextReturning([]);
    const compiler = new WorkRunMaterialCompiler({
      ledger: ledgerFor(), vault, workContext: port,
      roleSpec: rolePort({
        status: 'inadmissible', roleId: 'reader',
        reasons: [{ code: 'role_binding_not_admissible', roleId: 'reader', detail: 'permissions_exceed_spec', message: '声明了规格未授权的工具：shell' }],
      }),
    });
    const result = await compiler.compile(request());
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.code).toBe('role_permission_mismatch');
  });

  it('角色规格：缺省端口时如实报缺口（不假装没有角色要求）；规格必产出被如实记录', async () => {
    const { port, vault } = workContextReturning([]);
    const resolvedPort = rolePort({
      status: 'resolved', roleId: 'executor',
      revision: { aggregateType: 'RoleSpecRevision', projectId: PROJECT, roleId: 'executor', revision: 1 },
      spec: roleSpecContent({ requiredMaterials: [], optionalMaterials: [] }),
    });
    const withPort = new WorkRunMaterialCompiler({
      ledger: ledgerFor(), vault, workContext: port, roleSpec: resolvedPort, sourceIndex: sourceIndex().port,
    });
    const resolved = await withPort.compile(request());
    expect(resolved.status).toBe('ready');
    if (resolved.status !== 'ready') return;
    expect(resolved.materials.roleSpec?.roleId).toBe('executor');
    expect(resolved.materials.roleSpec?.requiredOutputs).toEqual([{ kind: 'implementation-result', reason: '必须给出实现结果' }]);
    expect(JSON.stringify(resolved.materials.roleSpec)).not.toContain('"completed"');

    const withoutPort = new WorkRunMaterialCompiler({ ledger: ledgerFor(), vault, workContext: port });
    const absent = await withoutPort.compile(request());
    expect(absent.status).toBe('ready');
    if (absent.status !== 'ready') return;
    expect(absent.materials.roleSpec).toBeUndefined();
    expect(absent.materials.gaps.join('\n')).toContain('RoleSpecReadPort');
  });



// ------------------------------------------------------------------------ //
// RW-18：跨工作历史的权限判据（与"跨工作区"分离）                            //
// ------------------------------------------------------------------------ //

const OLD_GOAL = 'goal-rw18-old';
const OLD_RUN: RunRef = { aggregateType: 'Run', projectId: PROJECT, goalId: OLD_GOAL, runId: 'real-rw18-old' };
const OLD_WORK_ID = 'work-rw18-old';
const OLD_NOTE_ID = 'note-rw18-old';
const oldNoteRef = executionNoteRefFor(PROJECT, WORKSPACE, OLD_WORK_ID, OLD_NOTE_ID);

/** 一段**其它工作**的留痕：正文先落 Vault（body-first），再由选材端口选中它。 */
async function otherWorkNote(vault: ArtifactVault): Promise<{ snapshot: ExecutionNoteSnapshot; body: string }> {
  const body = canonicalJson({ schemaVersion: 1, noteId: OLD_NOTE_ID, summary: '旧工作的关键取舍', reason: '旧工作的理由' } as never);
  const put = await vault.put({
    contentType: 'application/json', body,
    sourceRefs: [{ kind: 'workspace', refId: WORKSPACE, revision: String(WORKSPACE_REVISION) }],
    ownerRef: OLD_RUN, requestedAt: AT,
  });
  if (put.status !== 'stored') throw Error('fixture put failed');
  const snapshot: ExecutionNoteSnapshot = {
    ref: oldNoteRef, revision: 1, schemaVersion: 1, recordedAt: AT,
    note: {
      schemaVersion: 1, noteId: OLD_NOTE_ID, workId: OLD_WORK_ID, projectId: PROJECT, workspaceId: WORKSPACE,
      runRef: OLD_RUN, attemptRef: null, roleBindingRef: P107_ROLE_BINDING_READER_V1, kind: 'key_choice',
      summary: '旧工作的关键取舍', reason: '旧工作的理由', alternatives: [],
      sourceRefs: [], applicableVersions: { planRef: PLAN_REF, planRevision: 1, workspaceRevision: WORKSPACE_REVISION, governanceRevision: null },
      verification: { status: 'unverified', evidenceRefs: [] },
      bodyRef: put.ref, noFullTranscript: true, createdAt: AT,
    },
  };
  return { snapshot, body };
}

/** 选材端口替身：真实地写一份 selection 正文到 Vault（owned by 申请者），并记录收到的请求。 */
function completedWorkSelecting(vault: ArtifactVault, requester: RunRef) {
  const calls: Array<Record<string, unknown>> = [];
  const port: CompletedWorkContextPort = {
    assembleCompletedWorkContext: async (incoming) => {
      calls.push(structuredClone(incoming) as unknown as Record<string, unknown>);
      const body = canonicalJson({
        schemaVersion: 1, selectionId: 'sel-rw18', selected: [{
          workRef: workContextRefFor(PROJECT, WORKSPACE, OLD_WORK_ID),
          workKind: 'task', goalId: OLD_GOAL, taskId: 'task-rw18-old',
          applicability: { status: 'applicable', because: '同模块范围内的旧工作记录仍适用' },
          notes: [{ noteId: OLD_NOTE_ID, kind: 'key_choice', summary: '旧工作的关键取舍', createdAt: AT, sourceCursor: null }],
        }], gaps: [], changedPremises: [], generatedAt: AT,
      } as never);
      const put = await vault.put({
        contentType: 'application/json', body,
        sourceRefs: [{ kind: 'workspace', refId: WORKSPACE, revision: String(WORKSPACE_REVISION) }],
        ownerRef: requester, requestedAt: AT,
      });
      if (put.status !== 'stored') throw Error('fixture put failed');
      return {
        status: 'ready', selectionRef: put.ref,
        manifest: { requestId: 'sel-rw18', selectedCount: 1, gapCount: 0, changedPremiseCount: 0, freshness: { observedCursor: null, worksCursor: null, notesCursor: null }, totalBytes: body.length },
      };
    },
  };
  return { port, calls };
}

/**
 * 一份**记录在案的历史访问授权**（既有 P1-18 授权条款）。材料所有者是旧工作那条 Run，
 * 读者是申请者 Run，材料是那条留痕的正文；判据仍由 ArtifactVault 自己执行。
 */
function historyGrant(reader: RunRef, material: ArtifactRef, overrides: Partial<MaterialAccessGrantV1> = {}): MaterialAccessGrantV1 {
  return {
    schemaVersion: 1, grantId: 'grant-rw18-history',
    scope: { projectId: PROJECT, workspaceId: WORKSPACE, goalId: reader.goalId },
    materials: [material], reader,
    issuedBy: { aggregateType: 'Control', projectId: PROJECT, goalId: reader.goalId },
    purpose: '人显式授权：让相关新任务继承这段旧工作的历史',
    basis: { planRef: null, workspaceRevision: null, sourceDigest: null },
    grantedAt: AT,
    history: { owner: OLD_RUN, usage: 'historical_explanation' },
    ...overrides,
  };
}

/** 带授权解析器的真实 ArtifactVault（宿主注入的就是这种解析器；这里给出最笨的一份，判据仍在 Vault 里）。 */
function vaultWithGrants(grants: MaterialAccessGrantV1[]): ArtifactVault {
  return new ArtifactVault(new Map(), {
    grants: { grantsFor: async () => grants, currentBasisValid: async () => true },
  });
}

describe('RW-18 跨工作历史的准入按"历史访问权限"判定', () => {
  it('写入型运行获得历史访问授权时**可以**继承别的工作的历史（授权由既有 Vault 判定）', async () => {
    // 正文的 artifact 引用由内容决定：先在裸 Vault 里落一次拿到引用，再把同一份正文放进带授权的 Vault。
    const probe = await otherWorkNote(new ArtifactVault());
    const note = probe.snapshot;
    const vault = vaultWithGrants([historyGrant(runRef, note.note.bodyRef)]);
    const put = await vault.put({ contentType: 'application/json', body: probe.body, sourceRefs: [{ kind: 'workspace', refId: WORKSPACE, revision: String(WORKSPACE_REVISION) }], ownerRef: OLD_RUN, requestedAt: AT });
    expect(put.status).toBe('stored');
    if (put.status !== 'stored') return;
    expect(put.ref).toEqual(note.note.bodyRef);

    const selection = completedWorkSelecting(vault, runRef);
    const compiler = new WorkRunMaterialCompiler({
      ledger: ledgerFor({ extra: [note as AggregateSnapshot] }),
      vault, workContext: workContextReturning([], vault).port, completedWork: selection.port,
    });
    const result = await compiler.compile(request({ permissions: { policyRevision: 'p', tools: ['read', 'write', 'shell'], writeScope: ['*'] } }));
    expect(result.status, JSON.stringify(result)).toBe('ready');
    if (result.status !== 'ready') return;
    const history = result.materials.workContext!.history;
    expect(history).toHaveLength(1);
    expect(history[0]!.materialId).toBe(OLD_WORK_ID);
    expect(history[0]!.content).toContain('旧工作的理由');
    expect(history[0]!.applicability).toBe('historical_explanation');
    expect(history[0]!.selectedBecause).toContain('历史授权');
    // 来源带版本：材料正文引用（含摘要）随材料进入 manifest。
    expect(history[0]!.sourceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'artifact', refId: OLD_NOTE_ID, digest: note.note.bodyRef.digest }),
    ]));
    // 选材端口收到的是**如实**的权限回显（没有再伪造成只读）。
    expect(selection.calls[0]!['declaredPermissions']).toEqual({ tools: ['read', 'write', 'shell'], writeScope: ['*'] });
    expect(result.materials.gaps.join('\n')).not.toContain('未获授权');
  });

  it('未获授权即如实缺项：写入型与只读型都一样（只读**不**自动获得历史访问权）', async () => {
    for (const permissions of [
      { policyRevision: 'p', tools: ['read', 'write', 'shell'], writeScope: ['*'] },
      { policyRevision: 'p', tools: ['read'], writeScope: [] as string[] },
    ]) {
      const vault = vaultWithGrants([]);
      const note = (await otherWorkNote(vault)).snapshot;
      const selection = completedWorkSelecting(vault, runRef);
      const compiler = new WorkRunMaterialCompiler({
        ledger: ledgerFor({ extra: [note as AggregateSnapshot] }),
        vault, workContext: workContextReturning([], vault).port, completedWork: selection.port,
      });
      const result = await compiler.compile(request({ permissions }));
      expect(result.status, JSON.stringify(result)).toBe('ready');
      if (result.status !== 'ready') return;
      // 一条留痕都没有选入：不是"没有历史"，是这次运行没有被授权读它的历史。
      expect(result.materials.workContext!.history).toEqual([]);
      const gaps = result.materials.gaps.join('\n');
      expect(gaps).toContain('跨工作历史未获授权');
      expect(gaps).toContain('没有被授权读它的历史');
      expect(gaps).toContain('MaterialAccessGrant');
      expect(gaps).not.toContain('只读');
    }
  });

  it('工作区权限与历史权限互不替代：授权说明的读者不是本 Run 时同样不选入', async () => {
    const probe = await otherWorkNote(new ArtifactVault());
    const note = probe.snapshot;
    // 授权是签给**另一条运行**的：本 Run 不在授权范围内，写权限再多也不能替代它。
    const otherReader: RunRef = { aggregateType: 'Run', projectId: PROJECT, goalId: GOAL, runId: 'real-rw18-other' };
    const vault = vaultWithGrants([historyGrant(otherReader, note.note.bodyRef)]);
    expect((await vault.put({ contentType: 'application/json', body: probe.body, sourceRefs: [{ kind: 'workspace', refId: WORKSPACE, revision: String(WORKSPACE_REVISION) }], ownerRef: OLD_RUN, requestedAt: AT })).status).toBe('stored');
    const selection = completedWorkSelecting(vault, runRef);
    const compiler = new WorkRunMaterialCompiler({
      ledger: ledgerFor({ extra: [note as AggregateSnapshot] }),
      vault, workContext: workContextReturning([], vault).port, completedWork: selection.port,
    });
    const result = await compiler.compile(request({ permissions: { policyRevision: 'p', tools: ['read', 'write', 'shell'], writeScope: ['*'] } }));
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.materials.workContext!.history).toEqual([]);
    expect(result.materials.gaps.join('\n')).toContain('跨工作历史未获授权');
  });

  it('边界：本工作自己的留痕与记忆不受此限（同一段工作的留痕照常选入，不需要历史授权）', async () => {
    const { port, vault } = workContextReturning([{ noteId: 'note-1', kind: 'key_choice', summary: '摘要-note-1', runRef, createdAt: AT, sourceCursor: null, truncated: false, historical: false }]);
    const compiler = new WorkRunMaterialCompiler({
      ledger: ledgerFor(), vault, workContext: port,
      // 没有接线 CompletedWork 端口：跨工作历史缺失，但同一段工作自己的留痕照常供应。
    });
    const result = await compiler.compile(request({ permissions: { policyRevision: 'p', tools: ['read', 'write', 'shell'], writeScope: ['*'] } }));
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.materials.workContext!.notes).toHaveLength(1);
    expect(result.materials.workContext!.notes[0]!.materialId).toBe('note-1');
    expect(result.materials.workContext!.history).toEqual([]);
  });
});

  it('拒绝畸形请求（作用域/计划不属于本次运行）', async () => {
    const { port, vault } = workContextReturning([]);
    const compiler = new WorkRunMaterialCompiler({ ledger: ledgerFor(), vault, workContext: port });
    const bad = await compiler.compile(request({ planRef: { aggregateType: 'PlanRevision', projectId: 'other', planId: 'p' } }));
    expect(bad.status).toBe('rejected');
    const noScope = await compiler.compile({ ...request(), scope: undefined as never });
    expect(noScope.status).toBe('rejected');
  });
});
