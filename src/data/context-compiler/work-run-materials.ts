/**
 * Compile work identity, role materials and authorized history before dispatch.
 * The result enters the existing bundle and manifest; it grants no permissions
 * and cannot satisfy formal evidence requirements. Each selection records its
 * source, version, reason and bounded omissions. Unavailable required material
 * stops before the model call; proven absence remains distinct from missing data.
 * WorkspaceReader owns source I/O; this module owns material selection and
 * rechecks canonical scope after I/O. Historical material is explanation only.
 */
import type { ArtifactPort, ArtifactRef } from '../../contracts/artifact.js';
import type { StateLedger } from '../../contracts/ledger.js';
import type { RoleBindingRefV1, RunRef, SourceRefV1 } from '../../contracts/dispatch.js';
import type { PlanRevisionRef } from '../../contracts/plan.js';
import type { TaskEnvelopeV1 } from '../../contracts/task-envelope.js';
import type {
  RuntimeContextMaterials,
  RuntimeContextText,
  RuntimeHistoryMaterial,
  RuntimeRoleMaterialEntryV1,
  RuntimeWorkContextMaterials,
} from '../../contracts/runtime-context-materials.js';
import type { RoleSourceIndexPort } from '../../contracts/role-material-channels.js';
import type { PlanRevisionSnapshot } from '../../contracts/plan.js';
import {
  selectContractMaterial,
  selectDecisionMaterial,
  selectEvidenceMaterial,
  predecessorTaskIdsFor,
  type RoleMaterialSourceResult,
} from './role-material-sources.js';
import { selectCodeMaterial } from './role-source-index.js';
import type { WorkContextPort } from '../../contracts/work-context-port.js';
import type { RoleSpecReadPort } from '../../contracts/role-spec-materials.js';
import type { RuntimeRoleSpecMaterials } from '../../contracts/role-spec-materials.js';
import type { RoleMaterialKindV1 } from '../../contracts/role-spec.js';
import type { CompletedWorkContextPort } from '../../contracts/completed-work-context.js';
import type { ExecutionNoteSnapshot, WorkContextBindingSnapshot } from '../../contracts/context-continuity.js';
import {
  WORK_CONTEXT_BUNDLE_MAX_BYTES,
  executionNoteRefFor,
  workContextRefFor,
} from '../../contracts/context-continuity.js';
import { artifactBodyDigest } from '../../contracts/artifact.js';
import { canonicalJson, type JsonValue } from '../../contracts/fingerprint.js';

/** Channels supplied by this compiler; role requirements use a separate vocabulary. */
export type WorkRunMaterialKind = 'work-identity' | 'work-notes' | 'history' | 'contract' | 'code' | 'evidence' | 'decision';

/** Exhaustive mapping from role requirements to source channels. A null channel
 * fails closed when required. Each available channel still verifies material,
 * source and authorization; a declared channel is not proof of satisfaction. */
export type RoleMaterialChannelV1 = { channel: WorkRunMaterialKind | null; suppliedBy: string };
export const ROLE_MATERIAL_CHANNEL_V1: Record<RoleMaterialKindV1, RoleMaterialChannelV1> = {
  history: { channel: 'history', suppliedBy: '本入口的相关已完成工作选材（CompletedWorkContextPort）' },
  contract: { channel: 'contract', suppliedBy: '本入口的已接受任务包选材（RuntimeContextMaterials.rules：任务、义务与验收要求、依赖、指派指令与计划固定的契约／治理 pin）' },
  code: { channel: 'code', suppliedBy: 'WorkspaceReader／内核既有的受权限、按版本工作区读取（RoleSourceIndexPort → 有界源码索引与任务模块前缀下的有界正文）' },
  evidence: { channel: 'evidence', suppliedBy: 'canonical TaskEvidenceIndex 与已接纳 Evidence（沿用既有 evidenceRefs 语义；只索引，不把正文当作已核验事实）' },
  decision: { channel: 'decision', suppliedBy: '本 Goal 已落账的 UserDecision／GoalRevision（事件只作索引，canonical 聚合逐字段复核）' },
};

export const WORK_RUN_DEFAULT_REQUIRED_MATERIALS: readonly WorkRunMaterialKind[] = ['work-identity'];
export const WORK_RUN_DEFAULT_MAX_NOTES = 8;
export const WORK_RUN_DEFAULT_MAX_HISTORY_ITEMS = 4;
export const WORK_RUN_DEFAULT_MAX_HISTORY_NOTES = 3;
/** 角色必读材料 categories 的取材上限（超限如实进 gaps，不静默裁剪）。 */
export const ROLE_MATERIAL_EVIDENCE_MAX_ITEMS = 32;
export const ROLE_MATERIAL_DECISION_MAX_ITEMS = 16;

export type WorkRunMaterialLimits = {
  maxNotes: number;
  maxHistoryItems: number;
  maxHistoryNotesPerItem: number;
};

export type WorkRunMaterialRequest = {
  schemaVersion: 1;
  scope: { projectId: string; workspaceId: string; goalId: string; taskId: string; runId: string };
  planRef: PlanRevisionRef;
  workspaceSnapshot: TaskEnvelopeV1['workspaceSnapshot'];
  roleBinding: RoleBindingRefV1;
  /** Run 在信封上被 Control 确定的权限（不是本编译器授予的，也不是它可以扩大的）。 */
  permissions: TaskEnvelopeV1['permissions'];
  /** DispatchEngine 按确定性规则解析出的工作身份（见 control/dispatch-engine/work-identity.ts）。 */
  workId: string;
  requiredMaterials?: readonly WorkRunMaterialKind[];
  limits?: Partial<WorkRunMaterialLimits>;
};

export type WorkRunMaterialGap = {
  kind: WorkRunMaterialKind | 'work-context' | 'completed-work' | 'role-materials';
  message: string;
};

export type WorkRunMaterialResult =
  | { status: 'ready'; materials: RuntimeContextMaterials }
  | { status: 'needs_material'; gaps: WorkRunMaterialGap[] }
  | {
      status: 'rejected';
      code: 'invalid_request' | 'work_not_found' | 'unavailable' | 'role_binding_inadmissible' | 'role_permission_mismatch';
      message: string;
    };

export type WorkRunMaterialCompilerDeps = {
  /** 只读 canonical 事实：`load` 取精确快照；`events` 只用于把"候选决定"索引出来再按 ref 复核。 */
  ledger: Pick<StateLedger, 'load' | 'events'>;
  vault: ArtifactPort;
  workContext: WorkContextPort;
  /** 相关已完成工作的选材端口（P1-17）。缺省表示宿主没有接线，必须报缺口而不是假装没有历史。 */
  completedWork?: CompletedWorkContextPort;
  /**
   * 角色规格只读端口（RW-11）。缺省表示宿主没有接线：此时无法按规格取材，必须显式报缺口
   * （不是"跳过角色校验"）。实现由组合根注入 ControlEngine 自己的受理判据，见
   * contracts/role-spec-materials.ts 与 control/dispatch-engine/role-spec-read.ts。
   */
  roleSpec?: RoleSpecReadPort;
  /**
   * 「code」类必读材料的宿主侧能力——受权限约束、按工作区版本读取的有界源码索引。
   * 缺省表示宿主没有接线：该类别按**缺失**处理（fail-closed），不退回"没有源码也能开工"。
   * 实现归 WorkspaceReader（data/workspace-reader/role-source-reader.ts），复用本 Module 与内核既有的
   * 工作区读取路径；本 Module 只消费端口（data/context-compiler/role-source-index.ts）。
   */
  sourceIndex?: RoleSourceIndexPort;
};

export class WorkRunMaterialCompiler {
  constructor(private readonly deps: WorkRunMaterialCompilerDeps) {}

  async compile(request: WorkRunMaterialRequest): Promise<WorkRunMaterialResult> {
    // 步骤 1／7：请求自身不合法就直接拒绝，不做任何读取。
    const rejected = validateRequest(request);
    if (rejected) return { status: 'rejected', code: 'invalid_request', message: rejected };
    let required = [...(request.requiredMaterials ?? WORK_RUN_DEFAULT_REQUIRED_MATERIALS)];
    const limits: WorkRunMaterialLimits = {
      maxNotes: request.limits?.maxNotes ?? WORK_RUN_DEFAULT_MAX_NOTES,
      maxHistoryItems: request.limits?.maxHistoryItems ?? WORK_RUN_DEFAULT_MAX_HISTORY_ITEMS,
      maxHistoryNotesPerItem: request.limits?.maxHistoryNotesPerItem ?? WORK_RUN_DEFAULT_MAX_HISTORY_NOTES,
    };
    const scope = request.scope;
    const runRef: RunRef = { aggregateType: 'Run', projectId: scope.projectId, goalId: scope.goalId, runId: scope.runId };
    const gaps: WorkRunMaterialGap[] = [];
    /** 早期返回时也要把已经收集到的角色材料带出去：缺工作身份不代表角色材料凭空消失。 */
    let collected: { rules: RuntimeContextText[]; evidenceRefs: SourceRefV1[]; entries: RuntimeRoleMaterialEntryV1[] } =
      { rules: [], evidenceRefs: [], entries: [] };

    // 步骤 2／7：角色规格 —— 这次运行「必读什么材料、权限上界在哪」。
    //   判据全部来自 ControlEngine 的策略（deps.roleSpec），本编译器只消费解析结果：
    //   越权／revision 不符即拒绝该次派发（零写入）；规格里有本入口不拥有的必读类别（桥表值为 null）
    //   就立刻 fail-closed（needs_material），写清缺哪一类、应由哪条通道供应。
    const role = await this.resolveRoleSpec(request);
    if (role.status === 'rejected') return { status: 'rejected', code: role.code, message: role.message };
    const roleRecord = role.status === 'resolved' ? role.record : undefined;
    if (role.status === 'resolved') {
      for (const kind of role.requiredOwned) if (!required.includes(kind)) required.push(kind);
      if (role.unowned.length > 0) {
        for (const unowned of role.unowned) {
          gaps.push({
            kind: 'role-materials',
            message: '角色规格 ' + role.record.roleId + ' 要求必读材料「' + unowned.kind + '」（理由：' + unowned.reason +
              '）：该类别**不由本运行入口供应**，本次运行不开始（fail-closed，在模型调用之前）。' +
              '供应它的通道是：' + unowned.suppliedBy + '。在通道接通之前，本入口不会把"未核对"当成已满足。',
          });
        }
        return { status: 'needs_material', gaps };
      }
    } else {
      gaps.push({
        kind: 'role-materials',
        message: '本次运行没有角色规格可依（' + role.reason + '）：角色取材未生效。' +
          '这只是如实说明，不降低本次运行的权限、来源与验收判据。',
      });
    }

    // 步骤 3／7：角色必读材料取材 —— contract／code／evidence／decision 四类各走自己的通道
    //   （事实范围见 role-material-sources.ts；「code」见 role-source-index.ts 的窄端口消费）。
    //   判据：**缺失**（通道不可用／越权／版本不符／读不到）即 fail-closed；**确定为空**（例如该任务首次
    //   运行、还没有任何已接纳证据）是可核对的事实，随材料写进 manifest 与 gaps 的说明。
    const plan = await this.loadPlan(request);
    /** 本次要取的类别：必读先来（含规格追加的），可选后补，去重后逐类取材。 */
    const roleMaterialKinds: WorkRunMaterialKind[] = [];
    for (const kind of required) if (!roleMaterialKinds.includes(kind)) roleMaterialKinds.push(kind);
    const optionalKinds: WorkRunMaterialKind[] = role.status === 'resolved' ? [...role.optionalOwned] : [];
    for (const kind of optionalKinds) if (!roleMaterialKinds.includes(kind)) roleMaterialKinds.push(kind);
    const selection = await this.collectRoleMaterials(request, plan, roleMaterialKinds, required, gaps);
    if (selection.status === 'needs_material') return { status: 'needs_material', gaps };
    collected = { rules: selection.rules, evidenceRefs: selection.evidenceRefs, entries: selection.entries };

    // 步骤 4／7：把逐类取材结果登记进角色规格记录 —— manifest 的 role-spec 条目因此能逐类回答
    //   "这一类来自哪里、选入了什么、是选入了条目还是读到了确定为空"（`history` 在步骤 6 之后补写）。
    if (roleRecord) this.recordRoleMaterials(roleRecord, selection.byKind);

    // 步骤 5／7：工作身份与工作上下文留痕（只读 canonical 绑定，不新建、不修补身份）。
    const work = await this.loadWorkIdentityAndNotes(request, required, limits, gaps);
    if (work.status === 'rejected') return { status: 'rejected', code: 'unavailable', message: work.message };
    if (work.status === 'incomplete') {
      // 缺的是哪一类、它是不是必读，决定这是 fail-closed 还是"如实交付空材料包"。
      return required.includes(work.requires)
        ? { status: 'needs_material', gaps }
        : { status: 'ready', materials: emptyMaterials(request, gaps, roleRecord, collected) };
    }
    const { binding, bindingRevision, bundleRefDigest, notes } = work;
    // 步骤 6／7：相关已完成工作（history）—— 只经既有 P1-17 端口选材，适用性判定原样保留在材料里。
    const history = await this.selectHistory(request, runRef, binding.planRevision, limits, gaps);
    if (required.includes('history') && history.length === 0) {
      // 规格把它列为必读而本次一条都没有：显式失败，绝不静默通过。
      return {
        status: 'needs_material',
        gaps: gaps.concat([{
          kind: 'history',
          message: '角色规格要求必读「history」材料，本次没有选入任何相关已完成工作' +
            (this.deps.completedWork === undefined ? '（宿主未接线 CompletedWorkContextPort）' : '') + '：必须显式失败而不是静默通过。',
        }]),
      };
    }

    // `history` 是既有通道，取材之后把结果如实登记进角色规格记录（缺项不在这里改写）。
    if (roleRecord) this.recordHistoryMaterial(roleRecord, history);

    // 步骤 7／7：组装既有 RuntimeContextMaterials（材料 + 逐条缺口）。
    const materials: RuntimeContextMaterials = {
      schemaVersion: 1,
      scope: { ...scope },
      planRef: { ...request.planRef },
      workspaceSnapshot: { ...request.workspaceSnapshot },
      /** `rules` 承载「contract」类必读材料（本 Run 的已接受任务包与计划固定 pin，见
       *  ROLE_MATERIAL_CHANNEL_V1）。前驱报告材料仍由既有通道各自供应，本编译器不重复它们。 */
      rules: [...collected.rules],
      predecessors: [],
      /** 「evidence」类沿用既有 evidenceRefs 语义——本任务与直接前驱的已接纳证据**索引**。 */
      evidenceRefs: dedupeSources([...collected.evidenceRefs]),
      gaps: gaps.map((g) => '[' + g.kind + '] ' + g.message),
      workContext: {
        schemaVersion: 1,
        identity: {
          workId: request.workId,
          workKind: binding.workKind,
          goalId: binding.goalId,
          taskId: binding.taskId,
          planRef: binding.planRef === null ? null : { ...binding.planRef },
          planRevision: binding.planRevision,
          workspaceRevision: request.workspaceSnapshot.revision,
          linkedRunIds: binding.linkedRunRefs.map((ref) => ref.runId),
          createdAt: binding.createdAt,
          sourceRefs: dedupeSources([
            { kind: 'artifact', refId: 'work-context-bundle:' + request.workId, revision: String(bindingRevision), digest: bundleRefDigest },
            { kind: 'workspace', refId: scope.workspaceId, revision: String(request.workspaceSnapshot.revision) },
            ...(binding.planRef && binding.planRevision !== null
              ? [{ kind: 'plan-revision' as const, refId: binding.planRef.planId, revision: String(binding.planRevision) }]
              : []),
          ]),
          selectedBecause: '本 Run 的持久工作身份：DispatchEngine 在派发收口按确定性规则建立并 link 本 Run。' +
            '身份只是标识与版本（连续执行的对象），不是授权，也不代表任何完成状态。',
        },
        notes,
        history,
        gaps: gaps.map((g) => '[' + g.kind + '] ' + g.message),
      },
      ...(collected.entries.length > 0 ? { roleMaterials: { schemaVersion: 1 as const, entries: collected.entries } } : {}),
      ...(roleRecord ? { roleSpec: roleRecord } : {}),
    };
    return { status: 'ready', materials };
  }

  /**
   * 步骤 3 的事实来源：本 Run 所在 PlanRevision 的**已接受**快照。
   * 读不到 → `null`：由各类取材自己如实报缺失，而不是在这里兜底或退回"当前计划"。
   */
  private async loadPlan(request: WorkRunMaterialRequest): Promise<PlanRevisionSnapshot | null> {
    const planLoad = await this.deps.ledger.load(request.planRef);
    return planLoad.status === 'found' && planLoad.snapshot.ref.aggregateType === 'PlanRevision'
      ? planLoad.snapshot as PlanRevisionSnapshot
      : null;
  }

  /**
   * 步骤 3：逐类取材。返回 `null` 的类别表示它由**既有通道**供应
   * （work-identity／work-notes／history），这里不重复取材。判据只有两条，都不放宽：
   *   - 必读类别 `unavailable`（通道不可用／越权／版本不符／读不到）→ `needs_material`；
   *   - 可选类别 `unavailable` → 只记缺口，不阻断本次运行；
   *   - `selection: 'empty'`（本次范围内确实没有条目）是**读到的确定事实**，写进材料与 gaps。
   */
  private async collectRoleMaterials(
    request: WorkRunMaterialRequest,
    plan: PlanRevisionSnapshot | null,
    kinds: readonly WorkRunMaterialKind[],
    required: readonly WorkRunMaterialKind[],
    gaps: WorkRunMaterialGap[],
  ): Promise<
    | {
        status: 'collected';
        rules: RuntimeContextText[];
        evidenceRefs: SourceRefV1[];
        entries: RuntimeRoleMaterialEntryV1[];
        byKind: Map<WorkRunMaterialKind, RoleMaterialSourceResult>;
      }
    | { status: 'needs_material' }
  > {
    const rules: RuntimeContextText[] = [];
    const entries: RuntimeRoleMaterialEntryV1[] = [];
    const evidenceRefs: SourceRefV1[] = [];
    const byKind = new Map<WorkRunMaterialKind, RoleMaterialSourceResult>();
    for (const kind of kinds) {
      const outcome = await this.selectRoleMaterial(kind, request, plan);
      if (outcome === null) continue;
      byKind.set(kind, outcome);
      const isRequired = required.includes(kind);
      if (outcome.status === 'unavailable') {
        gaps.push({
          kind,
          message: '角色必读材料「' + kind + '」' + (isRequired ? '缺失，本次运行不开始（fail-closed，在模型调用之前）' : '本次没有取到') +
            '：' + outcome.message + '。本入口不会把"未核对"当成已满足。',
        });
        if (isRequired) return { status: 'needs_material' };
        continue;
      }
      rules.push(...outcome.rules);
      entries.push(...outcome.entries);
      evidenceRefs.push(...outcome.evidenceRefs);
      for (const note of outcome.notes ?? []) gaps.push({ kind, message: '角色必读材料「' + kind + '」：' + note });
      if (outcome.selection === 'empty') {
        gaps.push({
          kind,
          message: '角色必读材料「' + kind + '」本次范围内没有条目（' + outcome.detail + '）：这是**读到的确定事实**，' +
            '既不是"未核对"，也不是"已满足"；材料条目与来源已随本次运行写入 manifest。',
        });
      }
    }
    return { status: 'collected', rules, entries, evidenceRefs, byKind };
  }

  /**
   * 步骤 4：把逐类取材结果写进角色规格记录 —— manifest 的 role-spec 条目因此能逐类回答
   * "这一类来自哪里、选入了什么、是选入了条目还是读到了确定为空"。
   * `history` 是既有通道，由 recordHistoryMaterial 在步骤 6 之后补写。
   */
  private recordRoleMaterials(
    roleRecord: RuntimeRoleSpecMaterials,
    byKind: Map<WorkRunMaterialKind, RoleMaterialSourceResult>,
  ): void {
    for (const requirement of roleRecord.requiredMaterials) {
      const channel = (ROLE_MATERIAL_CHANNEL_V1 as Record<string, RoleMaterialChannelV1>)[requirement.kind]?.channel ?? null;
      if (channel === null || channel === 'history' || channel === 'work-identity' || channel === 'work-notes') continue;
      const outcome = byKind.get(channel);
      if (outcome === undefined) continue;
      requirement.supplied = outcome.status === 'supplied';
      if (outcome.status !== 'supplied') continue;
      requirement.selection = outcome.selection;
      requirement.materialIds = [...outcome.materialIds];
      requirement.sourceRefs = dedupeSources([...outcome.sourceRefs]);
    }
  }

  /** `history` 走既有通道：取材之后只把结果如实登记，缺项不在这里改写。 */
  private recordHistoryMaterial(roleRecord: RuntimeRoleSpecMaterials, history: RuntimeHistoryMaterial[]): void {
    for (const requirement of roleRecord.requiredMaterials) {
      const channel = (ROLE_MATERIAL_CHANNEL_V1 as Record<string, RoleMaterialChannelV1>)[requirement.kind]?.channel ?? null;
      if (channel !== 'history') continue;
      requirement.supplied = history.length > 0;
      requirement.selection = history.length > 0 ? 'selected' : 'empty';
      requirement.materialIds = history.map((item) => item.materialId);
      requirement.sourceRefs = dedupeSources(history.flatMap((item) => item.sourceRefs));
    }
  }

  /**
   * 步骤 5：工作身份与工作上下文留痕。只读 canonical 事实，不新建、不修补身份。三种结果：
   *   - `incomplete`：身份未登记，或工作上下文包组装／正文打开失败。`requires` 说明缺的是哪一类，
   *     调用方据此决定"必读 → needs_material"还是"如实交付空材料包"；
   *   - `rejected`：工作上下文正文不是有效 JSON 或结构不受支持（不猜内容）；
   *   - `ready`：canonical 绑定、逐条留痕材料，以及本 Run 取材时那一份包的 revision 与正文摘要
   *     （材料包的 sourceRefs 要它们，所以随结果带出，不在这里另取一次）。
   */
  private async loadWorkIdentityAndNotes(
    request: WorkRunMaterialRequest,
    required: readonly WorkRunMaterialKind[],
    limits: WorkRunMaterialLimits,
    gaps: WorkRunMaterialGap[],
  ): Promise<
    | {
        status: 'ready';
        binding: WorkContextBindingSnapshot['binding'];
        bindingRevision: number;
        bundleRefDigest: string;
        notes: RuntimeHistoryMaterial[];
      }
    | { status: 'incomplete'; requires: 'work-identity' | 'work-notes' }
    | { status: 'rejected'; message: string }
  > {
    const scope = request.scope;
    const runRef: RunRef = { aggregateType: 'Run', projectId: scope.projectId, goalId: scope.goalId, runId: scope.runId };

    // 5a) 工作身份：只读 canonical 绑定，不新建、不修补。
    const bindingLoad = await this.deps.ledger.load(workContextRefFor(scope.projectId, scope.workspaceId, request.workId));
    if (bindingLoad.status !== 'found' || bindingLoad.snapshot.ref.aggregateType !== 'WorkContextBinding') {
      const gap: WorkRunMaterialGap = {
        kind: 'work-identity',
        message: '工作身份 ' + request.workId + ' 未在账本中登记：DispatchEngine 的派发收口没有建立它，',
      };
      gap.message += '因此本 Run 没有可继承的同工作留痕（不新建身份、不退回"没有历史"的静默状态）。';
      gaps.push(gap);
      return { status: 'incomplete', requires: 'work-identity' };
    }
    const binding = (bindingLoad.snapshot as WorkContextBindingSnapshot).binding;
    const bindingRevision = bindingLoad.snapshot.revision;
    if (binding.linkedRunRefs.every((ref) => canonicalJson(ref as never) !== canonicalJson(runRef as never))) {
      gaps.push({
        kind: 'work-identity',
        message: '本 Run 尚未被 link 进工作身份 ' + request.workId + '；同工作留痕不会被认为属于本 Run。',
      });
    }

    // 5b) WorkContext 有界包：材料范围、版本与预算由既有端口判定，缺什么由端口说，不由本编译器兜底。
    const assembled = await this.deps.workContext.assembleWorkContext({
      schemaVersion: 1,
      workContextRef: workContextRefFor(scope.projectId, scope.workspaceId, request.workId),
      requestedByRunRef: runRef,
      roleBindingRef: { ...request.roleBinding },
      declaredPermissions: { tools: [...request.permissions.tools], writeScope: [...request.permissions.writeScope] },
      requiredMaterial: required.includes('work-notes') ? ['binding', 'notes'] : ['binding'],
      maxBundleBytes: WORK_CONTEXT_BUNDLE_MAX_BYTES,
      /** 空数组 = 不按 kind 过滤（全部留痕种类都可能是关键取舍）。 */
      noteKinds: [],
      maxNotes: limits.maxNotes,
    });
    if (assembled.status !== 'ready') {
      const detail = assembled.status === 'needs_material'
        ? assembled.gaps.map((g) => g.code + ': ' + g.message).join('; ')
        : assembled.code + ': ' + assembled.message;
      gaps.push({ kind: 'work-context', message: '工作上下文未被组装（' + assembled.status + '）：' + detail });
      return { status: 'incomplete', requires: 'work-notes' };
    }
    for (const truncated of assembled.manifest.truncated) {
      gaps.push({
        kind: 'work-notes',
        message: '工作留痕按上限未全部选入（maxNotes=' + limits.maxNotes + '，未选入 ' + truncated.noteIds.length +
          ' 条：' + truncated.noteIds.join(',') + '）：' + truncated.reason,
      });
    }

    const opened = await this.deps.vault.open(assembled.bundleRef, { requesterRunRef: runRef });
    if (opened.status !== 'ready') {
      gaps.push({ kind: 'work-context', message: '工作上下文正文当前不可读取：' + opened.status });
      return { status: 'incomplete', requires: 'work-notes' };
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(opened.record.body) as Record<string, unknown>;
    } catch {
      return { status: 'rejected', message: '工作上下文正文不是有效 JSON' };
    }
    if (body['schemaVersion'] !== 1 || !Array.isArray(body['bucketRows'])) {
      return { status: 'rejected', message: '工作上下文正文版本或结构不受支持' };
    }
    const bucketRows = body['bucketRows'] as Array<Record<string, unknown>>;

    // 5c) 逐条留痕材料：canonical ExecutionNote 提供理由与来源；版本不一致或缺正文即缺口。
    const notes: RuntimeHistoryMaterial[] = [];
    for (const row of bucketRows) {
      const noteId = typeof row['noteId'] === 'string' ? row['noteId'] : null;
      if (noteId === null) {
        gaps.push({ kind: 'work-notes', message: '工作留痕行缺少 noteId，未作为材料选入。' });
        continue;
      }
      const loadedNote = await this.deps.ledger.load(
        executionNoteRefFor(scope.projectId, scope.workspaceId, request.workId, noteId),
      );
      if (loadedNote.status !== 'found' || loadedNote.snapshot.ref.aggregateType !== 'ExecutionNote') {
        gaps.push({ kind: 'work-notes', message: '留痕 ' + noteId + ' 的 canonical 记录不可读取，未作为材料选入（不补造正文）。' });
        continue;
      }
      const note = (loadedNote.snapshot as ExecutionNoteSnapshot).note;
      const historical = row['historical'] === true;
      const content = canonicalJson({
        workId: request.workId,
        noteId,
        kind: note.kind,
        summary: note.summary,
        reason: note.reason,
        alternatives: note.alternatives,
        runRef: note.runRef,
        createdAt: note.createdAt,
        applicableVersions: note.applicableVersions,
        authoredByLinkedRun: !historical,
        qualification: '历史解释材料：不是当前事实，不授予权限，不满足当前验收',
      } as JsonValue);
      notes.push({
        materialId: noteId,
        content,
        digest: artifactBodyDigest(content),
        sourceRefs: dedupeSources([
          { kind: 'artifact', refId: noteId, revision: String(loadedNote.snapshot.revision), digest: note.bodyRef.digest },
          { kind: 'workspace', refId: scope.workspaceId, revision: String(note.applicableVersions.workspaceRevision) },
          ...(note.applicableVersions.planRef && note.applicableVersions.planRevision !== null
            ? [{ kind: 'plan-revision' as const, refId: note.applicableVersions.planRef.planId, revision: String(note.applicableVersions.planRevision) }]
            : []),
        ]),
        selectedBecause: '本 Run 的工作身份 ' + request.workId + ' 的既有留痕（' + note.kind + '）：' +
          (historical
            ? '由未 link 到本工作的 Run 记录，只作历史解释。'
            : '同一段连贯工作的关键取舍／未解项，属于必须继承的理由材料。') +
          '它只是参考，不授予权限、不满足验收。',
        applicability: 'historical_explanation',
        versions: { workspaceRevision: note.applicableVersions.workspaceRevision, planRevision: note.applicableVersions.planRevision },
      });
    }
    if (notes.length === 0) {
      gaps.push({
        kind: 'work-notes',
        message: '工作身份 ' + request.workId + ' 当前没有可用的留痕材料' +
          (binding.linkedRunRefs.length <= 1 ? '（这是该工作的第一个 Run）' : '') + '；不是"没有历史"的静默通过。',
      });
    }
    return { status: 'ready', binding, bindingRevision, bundleRefDigest: assembled.bundleRef.digest, notes };
  }

  /**
   * 解析本 Run 绑定到的角色规格。**不复制 ControlEngine 的规则**：判据由 deps.roleSpec 提供
   * （组合根注入的是 ControlEngine 自己的 evaluateRoleBindingAdmission）。这里只做三件事：
   *   1. 端口缺失 → 报缺口，不假装"没有角色要求"；
   *   2. inadmissible（角色不存在／revision 过期／权限越界）→ 拒绝该次派发材料，零写入；
   *   3. resolved → 把规格正文转成可审计记录，并把必读材料分成"本入口拥有"与"本入口不拥有"两类。
   */
  private async resolveRoleSpec(request: WorkRunMaterialRequest): Promise<
    | { status: 'absent'; reason: string }
    | { status: 'rejected'; code: 'role_binding_inadmissible' | 'role_permission_mismatch'; message: string }
    | {
        status: 'resolved';
        record: RuntimeRoleSpecMaterials;
        requiredOwned: WorkRunMaterialKind[];
        /** 可选材料里本入口拥有的通道（按规格顺序、去重）。它们照常取材，但缺失只是缺口。 */
        optionalOwned: WorkRunMaterialKind[];
        unowned: Array<{ kind: string; reason: string; suppliedBy: string }>;
      }
  > {
    if (this.deps.roleSpec === undefined) {
      return { status: 'absent', reason: '宿主未接线 RoleSpecReadPort，无法解析角色规格' };
    }
    const declaredPermissions = { tools: [...request.permissions.tools], writeScope: [...request.permissions.writeScope] };
    const resolution = await this.deps.roleSpec.resolve({
      projectId: request.scope.projectId,
      roleBinding: { ...request.roleBinding },
      declaredPermissions,
    });
    if (resolution.status === 'absent') return { status: 'absent', reason: resolution.reason };
    if (resolution.status === 'inadmissible') {
      const permissionsExceed = resolution.reasons.some(
        (reason) => reason.code === 'role_binding_not_admissible' && reason.detail === 'permissions_exceed_spec',
      );
      return {
        status: 'rejected',
        code: permissionsExceed ? 'role_permission_mismatch' : 'role_binding_inadmissible',
        message: '角色 ' + resolution.roleId + ' 的绑定未被受理：' + resolution.reasons.map((reason) => reason.message).join(' | '),
      };
    }
    const spec = resolution.spec;
    /** 本运行入口**拥有**的材料通道：全键穷尽的桥表（见 ROLE_MATERIAL_CHANNEL_V1）。 */
    const owned = ROLE_MATERIAL_CHANNEL_V1;
    const requiredOwned: WorkRunMaterialKind[] = [];
    const optionalOwned: WorkRunMaterialKind[] = [];
    const unowned: Array<{ kind: string; reason: string; suppliedBy: string }> = [];
    for (const requirement of spec.requiredMaterials) {
      const mapped = owned[requirement.kind].channel;
      if (mapped === null) unowned.push({ kind: requirement.kind, reason: requirement.reason, suppliedBy: owned[requirement.kind].suppliedBy });
      else if (!requiredOwned.includes(mapped)) requiredOwned.push(mapped);
    }
    for (const requirement of spec.optionalMaterials) {
      const mapped = owned[requirement.kind].channel;
      if (mapped === null || requiredOwned.includes(mapped) || optionalOwned.includes(mapped)) continue;
      optionalOwned.push(mapped);
    }
    const record: RuntimeRoleSpecMaterials = {
      schemaVersion: 1,
      roleId: resolution.roleId,
      revision: resolution.revision.revision,
      label: spec.label,
      purpose: spec.purpose,
      responsibility: [...spec.responsibility],
      requiredMaterials: spec.requiredMaterials.map((requirement) => {
        const mapped = owned[requirement.kind].channel;
        return {
          kind: requirement.kind,
          reason: requirement.reason,
          /** true = 本入口在该通道上给出了带来源的答案（`selection` 说明是选入了条目还是读到了
           *  "确定为空"）；false = 本入口拥有该通道但这次没有供应（可选材料）；null = 本入口不拥有它。
           *  注：桥表全键接通之后 null 分支不可达 —— 不拥有的类别在 compile() 里直接 fail-closed；
           *  这里保留它，是为了让本记录与桥表逐键同构：将来新增一行通道时不必再改记录形状。 */
          supplied: mapped === null ? null : true,
          detail: mapped === null
            ? '本运行入口不拥有该通道：本次运行 fail-closed，不把它当成已满足；应由 ' + owned[requirement.kind].suppliedBy + ' 供应'
            : '由本运行入口的通道供应：' + owned[requirement.kind].suppliedBy
              + (spec.requiredMaterials.includes(requirement) ? '（必读）' : '（可选：缺失只记缺口，不阻断本次运行）'),
        };
      }),
      /**
       * 这是角色的**声明性产出期望**（供 Agent 与读者参考），随既有通道进入 ContextBundle；
       * 它**不是**完成判据 —— 缺项不降级轮次结论、不扣留归约（见
       * control/verification-engine/role-output-completeness.ts 文件头的取舍与退出条件）。
       */
      requiredOutputs: spec.requiredOutputs.map((output) => ({ kind: output.kind, reason: output.reason })),
      sourceRefs: [{
        kind: 'governance',
        refId: resolution.roleId,
        revision: String(resolution.revision.revision),
      }],
      selectedBecause: '本 Run 绑定的角色规格（' + resolution.roleId + ' revision ' + resolution.revision.revision +
        '）：决定这次工作的必读材料、权限上界与必产出。规格只是要求，不授予额外权限。',
    };
    return { status: 'resolved', record, requiredOwned, optionalOwned, unowned };
  }

  /**
   * 按类别取「角色必读材料」。
   *
   * 返回 `null` 表示这一类由**既有通道**供应（work-identity／work-notes／history），本方法不重复取材；
   * 返回 `unavailable` 表示**材料缺失**（通道不可用／越权／版本不符／读不到）→ 必读时 fail-closed；
   * 返回 `supplied` 表示给出了带来源与版本的答案（可能是"确定为空"这一事实）。
   *
   * 每一条判据都不在这里重新发明：
   *   - contract／evidence／decision 的事实范围来自 canonical 账本（PlanRevision／TaskEvidenceIndex／
   *     Evidence／UserDecision／GoalRevision），读取与复核在 role-material-sources.ts；
   *   - code 的权限与版本判据来自本 Run 的信封（TaskEnvelope.permissions 与 workspaceSnapshot），
   *     与 canonical Workspace 版本核对后才调用宿主注入的 RoleSourceIndexPort。
   */
  private async selectRoleMaterial(
    kind: WorkRunMaterialKind,
    request: WorkRunMaterialRequest,
    plan: PlanRevisionSnapshot | null,
  ): Promise<RoleMaterialSourceResult | null> {
    if (kind === 'work-identity' || kind === 'work-notes' || kind === 'history') return null;
    const scope = request.scope;
    if (kind === 'contract') {
      if (plan === null) return { status: 'unavailable', message: '本 Run 的 PlanRevision 快照读不到（' + request.planRef.planId + '）：没有可核对的已接受任务包' };
      return selectContractMaterial({
        plan,
        taskId: scope.taskId,
        workspaceId: scope.workspaceId,
        workspaceRevision: request.workspaceSnapshot.revision,
      });
    }
    if (kind === 'evidence') {
      if (plan === null) return { status: 'unavailable', message: '本 Run 的 PlanRevision 快照读不到（' + request.planRef.planId + '）：无法确定直接前驱范围' };
      return selectEvidenceMaterial({
        ledger: this.deps.ledger,
        projectId: scope.projectId,
        goalId: scope.goalId,
        taskId: scope.taskId,
        workspaceId: scope.workspaceId,
        workspaceRevision: request.workspaceSnapshot.revision,
        planRef: request.planRef,
        planRevision: plan.planRevision,
        maxEntries: ROLE_MATERIAL_EVIDENCE_MAX_ITEMS,
        predecessorTaskIds: predecessorTaskIdsFor(plan, scope.taskId),
      });
    }
    if (kind === 'decision') {
      // 决定材料要回答"哪些决定影响了**本 Run 当前计划**"：计划快照读不到就不猜，按缺失处理。
      if (plan === null) return { status: 'unavailable', message: '本 Run 的 PlanRevision 快照读不到（' + request.planRef.planId + '）：无法核对已接受决定与当前计划的关系' };
      return selectDecisionMaterial({
        ledger: this.deps.ledger,
        events: this.deps.ledger,
        projectId: scope.projectId,
        workspaceId: scope.workspaceId,
        goalId: scope.goalId,
        planRef: request.planRef,
        planRevision: plan.planRevision,
        workspaceRevision: request.workspaceSnapshot.revision,
        maxEntries: ROLE_MATERIAL_DECISION_MAX_ITEMS,
      });
    }
    // 「code」类由 role-source-index.ts 消费 WorkspaceReader 的窄端口（工作区访问实现不在本 Module）。
    return selectCodeMaterial(this.deps, request, plan);
  }

  /**
   * P1-17 选材 + RW-18 跨工作历史的**访问准入**（取代原来的"只读运行才给历史"）。
   *
   * 准入判据按用户对上一轮报告的指示拆开来看，只有三件事：
   *   1. **谁申请**：就是本 Run（`runRef`），不是"某一类运行"；
   *   2. **申请哪段工作的历史**：选中的那段工作的留痕正文（canonical `ExecutionNote` 的 `bodyRef`）；
   *   3. **是否被授权**：交给**既有授权权威**判定 —— `ArtifactVault.open(bodyRef, { requesterRunRef: runRef,
   *      usage: 'historical_explanation', currentBasis })`。Vault 只认"记录在案且未撤销、由材料所有者或
   *      Control 签发、覆盖这条**精确**材料、读者就是本 Run"的历史授权（`MaterialAccessGrant` 的
   *      `history` 授权），规则没有第二份实现。未获授权（forbidden／stale／unavailable）即**不选入**
   *      并如实记缺口，绝不静默放行。
   *
   * 与工作区授权**正交**：信封的 tools／writeScope 与租约只决定这条运行能读写什么。有写权限**不会**
   * 自动获得别人历史的访问权；只读也**不会**自动获得（未授权的只读运行同样记缺口）—— 这正是原来那条
   * "只读才给历史"判据的问题（它把"本运行是否只读"当成了"能不能读那段历史"）。
   *
   * 边界（RW-18 d）：本约束只针对**其它工作的运行历史**。同一段工作自己的留痕走 work-notes 通道，
   * 不受此限；记忆／开发记忆是平台的长期记忆，允许被检索，也不受此限。
   *
   * 记录口径：被授权读到的正文引用（含摘要与长度）随材料进入 sourceRefs；授权本身是可审计的账本事实
   * （读者 = 本 Run、材料 = 该正文），本方法不复制授权记录、也不发明"哪一条 grant"的措辞。
   */
  private async selectHistory(
    request: WorkRunMaterialRequest,
    runRef: RunRef,
    bindingPlanRevision: number | null,
    limits: WorkRunMaterialLimits,
    gaps: WorkRunMaterialGap[],
  ): Promise<RuntimeHistoryMaterial[]> {
    if (!this.deps.completedWork) {
      gaps.push({ kind: 'completed-work', message: '宿主未接线 CompletedWorkContextPort，本次没有相关已完成工作材料。' });
      return [];
    }
    /** 本次运行自己冻结的版本基线：Vault 用它核对历史上的授权是否仍然适用（旧授权不随新版本继承）。 */
    const currentBasis = {
      planRef: { ...request.planRef },
      workspaceRevision: request.workspaceSnapshot.revision,
      sourceDigest: null,
    };
    const selection = await this.deps.completedWork.assembleCompletedWorkContext({
      schemaVersion: 1,
      requestId: 'work-history-' + request.scope.runId,
      projectId: request.scope.projectId,
      workspaceId: request.scope.workspaceId,
      newWorkGoalId: request.scope.goalId,
      newWorkKind: 'task',
      relatedRefs: [{ kind: 'spec', refKey: request.planRef.planId, version: String(bindingPlanRevision ?? '') || null }],
      applicableVersions: {
        planRef: { ...request.planRef },
      planRevision: bindingPlanRevision,
      workspaceRevision: request.workspaceSnapshot.revision,
      governanceRevision: request.permissions.policyRevision,
    },
    requestedByRunRef: runRef,
    /** 如实回显本 Run 实际持有的权限。它是审计信息，**不是**历史访问的准入判据。 */
    declaredPermissions: { tools: [...request.permissions.tools], writeScope: [...request.permissions.writeScope] },
    budget: { maxSelected: limits.maxHistoryItems, maxBundleBytes: WORK_CONTEXT_BUNDLE_MAX_BYTES },
  });
  if (selection.status !== 'ready') {
    const detail = selection.status === 'needs_material'
      ? selection.gaps.map((g) => g.code + ': ' + g.message).join('; ')
      : selection.code + ': ' + selection.message;
    gaps.push({ kind: 'completed-work', message: '相关已完成工作未被选入（' + selection.status + '）：' + detail });
    return [];
  }
  const opened = await this.deps.vault.open(selection.selectionRef, { requesterRunRef: runRef });
  if (opened.status !== 'ready') {
    gaps.push({ kind: 'completed-work', message: '已完成工作选材正文当前不可读取：' + opened.status });
    return [];
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(opened.record.body) as Record<string, unknown>;
  } catch {
    gaps.push({ kind: 'completed-work', message: '已完成工作选材正文不是有效 JSON，未作为材料选入。' });
    return [];
  }
  const selected = Array.isArray(body['selected']) ? (body['selected'] as Array<Record<string, unknown>>) : [];
  const history: RuntimeHistoryMaterial[] = [];
  for (const item of selected.slice(0, limits.maxHistoryItems)) {
    const workRef = item['workRef'] as { workId?: unknown } | undefined;
    const workId = typeof workRef?.workId === 'string' ? workRef.workId : null;
    if (workId === null) {
      gaps.push({ kind: 'completed-work', message: '已完成工作选材条目缺少 workId，未作为材料选入。' });
      continue;
    }
    const allNotes = Array.isArray(item['notes']) ? (item['notes'] as Array<Record<string, unknown>>) : [];
    const kept = allNotes.slice(0, limits.maxHistoryNotesPerItem);
    if (allNotes.length > kept.length) {
      gaps.push({
        kind: 'completed-work',
        message: '已完成工作 ' + workId + ' 的留痕按上限只选入前 ' + String(limits.maxHistoryNotesPerItem) + ' 条（共 ' +
          allNotes.length + ' 条）：未选入的条目存在但不在本次材料内。',
      });
    }
    // 逐条向既有授权权威求证"本 Run 能不能读这段工作的这条历史"。
    const authorized: Array<{ noteId: string; note: ExecutionNoteSnapshot['note']; bodyRef: ArtifactRef }> = [];
    let unauthorized = 0;
    for (const entry of kept) {
      const noteId = typeof entry['noteId'] === 'string' ? entry['noteId'] : null;
      if (noteId === null) {
        gaps.push({ kind: 'completed-work', message: '已完成工作 ' + workId + ' 的留痕条目缺少 noteId，未作为材料选入。' });
        continue;
      }
      const noteRef = executionNoteRefFor(request.scope.projectId, request.scope.workspaceId, workId, noteId);
      const loaded = await this.deps.ledger.load(noteRef);
      if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'ExecutionNote') {
        unauthorized += 1;
        gaps.push({ kind: 'completed-work', message: '已完成工作 ' + workId + ' 的留痕 ' + noteId + ' 当前不可读取（canonical ExecutionNote 缺失）：不选入，也不猜它的正文。' });
        continue;
      }
      const note = (loaded.snapshot as ExecutionNoteSnapshot).note;
      if (note.projectId !== request.scope.projectId || note.workspaceId !== request.scope.workspaceId || note.workId !== workId) {
        unauthorized += 1;
        gaps.push({ kind: 'completed-work', message: '留痕 ' + noteId + ' 的 canonical 记录不属于所选的这段工作（' + note.projectId + '/' + note.workspaceId + '/' + note.workId + '）：不选入。' });
        continue;
      }
      let access: Awaited<ReturnType<ArtifactPort['open']>>;
      try {
        access = await this.deps.vault.open(note.bodyRef, { requesterRunRef: runRef, usage: 'historical_explanation', currentBasis });
      } catch (error) {
        unauthorized += 1;
        gaps.push({ kind: 'completed-work', message: '历史访问授权核对失败（' + (error instanceof Error ? error.message : String(error)) + '）：留痕 ' + noteId + ' 不选入。' });
        continue;
      }
      if (access.status !== 'ready' || access.record.applicability !== 'historical_explanation') {
        unauthorized += 1;
        gaps.push({
          kind: 'completed-work',
          message: '跨工作历史未获授权：其它工作 ' + workId + ' 的留痕 ' + noteId + '（正文 ' + note.bodyRef.digest.slice(0, 16) + '…）对本次运行不可读（' +
            (access.status === 'ready' ? '读到的资格不是历史解释' : access.status + ('code' in access && typeof access.code === 'string' ? '/' + access.code : '')) +
            '）：不选入，也不为了取到它伪造更窄的权限声明。要继承这段历史，需要一条有来源、带版本、可撤销的历史访问授权' +
            '（MaterialAccessGrant 的 history 授权：读者 = 本 Run、材料 = 该留痕正文）。',
        });
        continue;
      }
      authorized.push({ noteId, note, bodyRef: note.bodyRef });
    }
    if (authorized.length === 0) {
      gaps.push({
        kind: 'completed-work',
        message: '已完成工作 ' + workId + ' 的历史本次一条都没有选入' +
          (unauthorized > 0 ? '（' + String(unauthorized) + ' 条留痕未获授权或不可读）' : '') +
          '：这不是"没有历史"，是这次运行没有被授权读它的历史。',
      });
      continue;
    }
    const applicability = (item['applicability'] ?? {}) as Record<string, unknown>;
    const content = canonicalJson({
      workId,
      workKind: item['workKind'] ?? null,
      taskId: item['taskId'] ?? null,
      /** P1-17 自己的工程适用性判定原样保留，不被本节改写。 */
      completedWorkApplicability: applicability,
      notes: authorized.map((entry) => ({
        noteId: entry.noteId,
        kind: entry.note.kind,
        summary: entry.note.summary,
        reason: entry.note.reason,
        createdAt: entry.note.createdAt,
      })),
      notices: allNotes.length > kept.length ? ['留痕按上限截断，截断数量见 manifest gaps'] : [],
      qualification: '历史解释材料：不继承旧授权、旧完成状态或旧验收结论',
    } as JsonValue);
    history.push({
      materialId: workId,
      content,
      digest: artifactBodyDigest(content),
      sourceRefs: dedupeSources([
        ...authorized.map((entry) => ({ kind: 'artifact' as const, refId: entry.noteId, revision: '1', digest: entry.bodyRef.digest })),
        { kind: 'artifact', refId: 'completed-work:' + workId, revision: '1', digest: selection.selectionRef.digest },
        { kind: 'workspace', refId: request.scope.workspaceId, revision: String(request.workspaceSnapshot.revision) },
      ]),
      selectedBecause: '相关已完成工作 ' + workId + '（' + String(applicability['status'] ?? 'unknown') + '：' +
        String(applicability['because'] ?? '') + '）；' + String(authorized.length) + ' 条留痕已由既有授权权威（ArtifactVault + Control 登记的历史授权）' +
        '确认本 Run 有权读取，未获授权的留痕不在材料内。历史材料提供可继承的工程事实与理由，但不继承授权与完成状态。',
      applicability: 'historical_explanation',
      versions: { workspaceRevision: request.workspaceSnapshot.revision, planRevision: bindingPlanRevision },
    });
    }
    return history;
  }
}

function dedupeSources(refs: SourceRefV1[]): SourceRefV1[] {
  const seen = new Set<string>();
  const out: SourceRefV1[] = [];
  for (const ref of refs) {
    const key = canonicalJson(ref as never);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

/**
 * 早期返回时使用的空材料包：**已经取到的**角色材料照常交付（它们与工作身份无关），
 * 缺口照常写进 gaps。缺什么就说什么，不用"整包为空"掩盖已经成立的事实。
 */
function emptyMaterials(
  request: WorkRunMaterialRequest,
  gaps: WorkRunMaterialGap[],
  roleSpec?: RuntimeRoleSpecMaterials,
  collected?: { rules: RuntimeContextText[]; evidenceRefs: SourceRefV1[]; entries: RuntimeRoleMaterialEntryV1[] },
): RuntimeContextMaterials {
  return {
    schemaVersion: 1,
    scope: { ...request.scope },
    planRef: { ...request.planRef },
    workspaceSnapshot: { ...request.workspaceSnapshot },
    rules: collected ? [...collected.rules] : [],
    predecessors: [],
    evidenceRefs: collected ? dedupeSources([...collected.evidenceRefs]) : [],
    gaps: gaps.map((g) => '[' + g.kind + '] ' + g.message),
    ...(collected && collected.entries.length > 0 ? { roleMaterials: { schemaVersion: 1 as const, entries: collected.entries } } : {}),
    ...(roleSpec ? { roleSpec } : {}),
  };
}

function validateRequest(request: WorkRunMaterialRequest): string | null {
  if (request.schemaVersion !== 1) return 'only schemaVersion 1 is supported';
  const scope = request.scope;
  if (!scope || !scope.projectId || !scope.workspaceId || !scope.goalId || !scope.taskId || !scope.runId) {
    return 'scope ids are required';
  }
  if (!request.workId || !request.planRef || !request.workspaceSnapshot || !request.roleBinding || !request.permissions) {
    return 'workId, planRef, workspaceSnapshot, roleBinding and permissions are required';
  }
  if (request.planRef.projectId !== scope.projectId || request.planRef.aggregateType !== 'PlanRevision') {
    return 'planRef is outside the run scope';
  }
  if (request.workspaceSnapshot.workspaceId !== scope.workspaceId) return 'workspaceSnapshot is outside the run scope';
  return null;
}

export type { RuntimeWorkContextMaterials };
