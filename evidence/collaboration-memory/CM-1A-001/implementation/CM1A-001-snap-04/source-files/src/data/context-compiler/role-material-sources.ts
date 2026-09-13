/**
 * RW-17 ContextCompiler — 角色必读材料 contract／evidence／decision 的**取材**。
 *
 * 权威：ADR 0003 D4-3（ContextCompiler 按规格取材，必读材料缺失返回 needs_material）、
 * ARCHITECTURE「Context 生命周期与编排」、module-boundaries「角色规格与真实 Context（D4）」。
 *
 * 本文件只做一件事：**把已经存在的 canonical 事实读出来、按本 Run 的范围筛一遍、连同来源与版本
 * 一起交给调用方**。它不授权、不写状态、不判定完成，也不复制任何模块的业务规则：
 *   - contract   ← 本 Run 所在 PlanRevision 的**已接受事实**：本任务、本任务承担的义务与验收要求、
 *                  直接依赖、随 revision 一起被接受的指派指令，以及计划**固定**的契约／治理 pin
 *                  （CompletionPolicy 与 ArchitectureBaseline 的精确 ref+digest）。
 *                  计划是 immutable snapshot，因此这些事实不可能被事后改写。
 *   - evidence   ← canonical `TaskEvidenceIndex`（每任务的已接纳证据索引，按接纳顺序）与它指向的
 *                  `Evidence` 聚合（逐条复核 subject 就是本任务／直接前驱）。沿用既有
 *                  `evidenceRefs` 语义：**只索引**，不把未读取的正文当作已核验事实。
 *   - decision   ← 本 Goal 上**已落账**的变更决定：`UserDecisionRecorded` 与 `GoalRevisionRecorded`
 *                  事件给出候选，随后按精确 ref `load` canonical 聚合逐字段复核（事件只是索引，
 *                  聚合才是事实）。没有这条事实时如实说"本 Goal 还没有已接受的变更决定"。
 *
 * ── 「确定为空」与「材料缺失」不是一回事（本票不放松判据）────────────────────────
 *   - **材料缺失**（通道不存在／读不到／越权／版本不符／索引与聚合不一致）→ 返回 `unavailable`，
 *     调用方据此 fail-closed（needs_material，模型调用之前终止这次运行）。
 *   - **确定为空**（例如该任务首次运行、`TaskEvidenceIndex` 从未被创建）→ 返回 `empty`：
 *     这是**可核对的事实**（依据与该聚合的 ref/revision 一起写进材料），既不是"未核对"，
 *     也不是"已满足"。把它当成"缺失"会让第一次运行永远无法开始，把它当成"已满足"才是伪造。
 *
 * ── 为什么这些事实不可能被伪造 ───────────────────────────────────────────────
 *   - contract 来自已接受的 PlanRevision 快照（CAS 受理后不可改写）；
 *   - evidence 来自 `SubmitEvidence` 守卫写入的不可变聚合（每条 evidenceId 只创建一次）；
 *   - decision 来自 `RecordUserDecision`／`applyPlanChange` 的落账事件，并且**再按精确 ref
 *     读回聚合逐字段复核**——事件与聚合不一致时按缺失处理，不采信事件里的自报字段。
 *   模型自述、调用方声明与"运行有 read 工具"都不在这条路径上。
 */
import type { StateLedger, EventPage } from '../../contracts/ledger.js';
import type { CommitCursor } from '../../contracts/command-event.js';
import type { SourceRefV1 } from '../../contracts/dispatch.js';
import type { PlanRevisionRef, PlanRevisionSnapshot } from '../../contracts/plan.js';
import { revisionAssignments } from '../../contracts/plan.js';
import type { EvidenceSnapshot, TaskEvidenceIndexSnapshot } from '../../contracts/evidence.js';
import { evidenceRefFor, taskEvidenceIndexRefFor } from '../../contracts/evidence.js';
import type { GoalRevisionSnapshot, UserDecisionRecordedEvent, UserDecisionSnapshot, UserDecisionV1, GoalRevisionRecordedEvent, GoalRevisionV1 } from '../../contracts/goal-change.js';
import type { RuntimeContextText, RuntimeRoleMaterialEntryV1 } from '../../contracts/runtime-context-materials.js';
import { canonicalJson, type JsonValue } from '../../contracts/fingerprint.js';
import { artifactBodyDigest } from '../../contracts/artifact.js';

/** 取材结果。`unavailable` = 材料缺失（调用方按 fail-closed 处理）；`supplied` = 有带来源的答案。 */
export type RoleMaterialSourceResult =
  | {
      status: 'supplied';
      /** `selected` = 选入了具体条目；`empty` = 读到了"本次范围内确实没有"这一确定事实。 */
      selection: 'selected' | 'empty';
      /** 供 RuntimeContextMaterials 既有通道使用（contract → rules）。 */
      rules: RuntimeContextText[];
      /** 供 RuntimeContextMaterials.roleMaterials 使用（逐条带理由与来源版本）。 */
      entries: RuntimeRoleMaterialEntryV1[];
      /** 供既有 evidenceRefs 语义使用。 */
      evidenceRefs: SourceRefV1[];
      /** 本类别在本 Run 里的来源汇总（写进角色规格记录，便于 manifest 处逐类核对）。 */
      sourceRefs: SourceRefV1[];
      /** 这一类的取材结果（与 entries[].selection 同义，供角色规格记录使用）。 */
      detail: string;
      materialIds: string[];
      /** 上限造成的未选入等如实说明（由调用方写进 gaps，绝不静默裁剪）。 */
      notes?: string[];
    }
  | { status: 'unavailable'; message: string };

export type ContractMaterialRequest = {
  plan: PlanRevisionSnapshot;
  taskId: string;
  workspaceId: string;
  workspaceRevision: number;
};

/**
 * contract：已接受任务包里的规则与义务 + 计划固定的契约／治理版本。
 *
 * 取材范围严格是本 Run 的 revision 快照：任务不在该 revision 里 → 缺失（不猜、不退回当前计划）。
 */
export function selectContractMaterial(request: ContractMaterialRequest): RoleMaterialSourceResult {
  const { plan, taskId, workspaceId, workspaceRevision } = request;
  const task = plan.tasks.find((candidate) => candidate.taskId === taskId);
  if (!task) {
    return { status: 'unavailable', message: '本 Run 的任务 ' + taskId + ' 不在计划 revision ' + plan.ref.planId + ' 内：没有可取材的已接受任务包' };
  }
  const obligations = plan.obligations.filter((obligation) => obligation.taskIds.includes(taskId));
  const dependencies = plan.executionDag.dependsOn
    .filter((edge) => edge.taskId === taskId)
    .map((edge) => ({ dependsOnId: edge.dependsOnId, requires: edge.requires }));
  const assignment = revisionAssignments(plan).find((candidate) => candidate.taskId === taskId) ?? null;
  const sourceRefs: SourceRefV1[] = [
    { kind: 'plan-revision', refId: plan.ref.planId, revision: String(plan.planRevision) },
    { kind: 'workspace', refId: workspaceId, revision: String(workspaceRevision) },
    { kind: 'governance', refId: plan.effectiveCompletionPolicy.ref.policyId, revision: String(plan.effectiveCompletionPolicy.ref.revision), digest: plan.effectiveCompletionPolicy.digest },
    { kind: 'governance', refId: plan.effectiveArchitectureBaseline.ref.baselineId, revision: String(plan.effectiveArchitectureBaseline.ref.revision), digest: plan.effectiveArchitectureBaseline.digest },
  ];
  const body = canonicalJson({
    schemaVersion: 1,
    kind: 'contract',
    planRef: plan.ref,
    planRevision: plan.planRevision,
    acceptedAt: plan.acceptedAt,
    goalRef: plan.goalRef,
    task: { taskId: task.taskId, title: task.title, requirementLevel: task.requirementLevel, taskKind: task.taskKind, disposition: task.disposition, scope: task.scope },
    obligations: obligations.map((obligation) => ({
      obligationId: obligation.obligationId,
      title: obligation.title,
      requirementLevel: obligation.requirementLevel,
      verificationRequirements: obligation.verificationRequirements.map((requirement) => ({
        requirementId: requirement.requirementId,
        requirementLevel: requirement.requirementLevel,
        kind: requirement.kind,
        description: requirement.description,
      })),
    })),
    dependencies,
    assignment,
    planPins: {
      completionPolicy: plan.effectiveCompletionPolicy,
      architectureBaseline: plan.effectiveArchitectureBaseline,
    },
    qualification: '已接受计划事实（本 Run 的 revision 快照）：本次实现的边界与验收语义；不授予额外权限，也不替代当前验收',
  } as JsonValue);
  const rule: RuntimeContextText = {
    content: body,
    digest: artifactBodyDigest(body),
    sourceRefs,
    ruleKey: 'role-material:contract:accepted-task',
    topics: [taskId],
    selectedBecause: '角色规格必读材料「contract」：本 Run 所在 PlanRevision 的已接受任务、义务与验收要求、直接依赖与指派指令，' +
      '以及计划固定的契约／治理 pin（CompletionPolicy ' + plan.effectiveCompletionPolicy.ref.policyId + '@' + plan.effectiveCompletionPolicy.ref.revision +
      '，ArchitectureBaseline ' + plan.effectiveArchitectureBaseline.ref.baselineId + '@' + plan.effectiveArchitectureBaseline.ref.revision + '）。' +
      '验收语义的唯一来源仍是这份计划与 CompletionPolicy，本材料只是把它如实带进本次运行。',
  };
  return {
    status: 'supplied',
    selection: 'selected',
    rules: [rule],
    entries: [],
    evidenceRefs: [],
    sourceRefs,
    detail: '由本 Run 的已接受 PlanRevision 快照供应（任务、义务／验收要求、依赖、指派与契约／治理 pin）',
    materialIds: [rule.ruleKey!],
  };
}

export type EvidenceMaterialRequest = {
  ledger: Pick<StateLedger, 'load'>;
  projectId: string;
  goalId: string;
  taskId: string;
  workspaceId: string;
  workspaceRevision: number;
  planRef: PlanRevisionRef;
  planRevision: number;
  maxEntries: number;
  /** 直接前驱任务（来自本 revision 的 executionDag）：它们的证据索引同样是本任务的取材范围。 */
  predecessorTaskIds: readonly string[];
};

/**
 * evidence：本任务与**直接前驱**任务的 canonical 证据索引 + 已接纳 Evidence（只索引，不读正文）。
 *
 * 缺失（索引指向的证据读不到／subject 不属于该任务）→ `unavailable`（fail-closed）。
 * 该任务从未有证据被接纳（索引聚合不存在）→ `empty`：可核对的确定事实。
 */
export async function selectEvidenceMaterial(request: EvidenceMaterialRequest): Promise<RoleMaterialSourceResult> {
  const taskIds = [request.taskId, ...request.predecessorTaskIds.filter((id) => id !== request.taskId)];
  const indexes: Array<{ taskId: string; ref: ReturnType<typeof taskEvidenceIndexRefFor>; revision: number; evidenceIds: string[] }> = [];
  const rows: Array<Record<string, unknown>> = [];
  const evidenceRefs: SourceRefV1[] = [];
  for (const taskId of taskIds) {
    const ref = taskEvidenceIndexRefFor(request.projectId, request.goalId, taskId);
    const loaded = await request.ledger.load(ref);
    if (loaded.status !== 'found') {
      // 从未有证据被接纳：这是索引聚合不存在这一确定事实（不是读取失败）。
      indexes.push({ taskId, ref, revision: 0, evidenceIds: [] });
      continue;
    }
    if (loaded.snapshot.ref.aggregateType !== 'TaskEvidenceIndex') {
      return { status: 'unavailable', message: '任务 ' + taskId + ' 的证据索引聚合类型不符：不采信' };
    }
    const index = loaded.snapshot as TaskEvidenceIndexSnapshot;
    indexes.push({ taskId, ref, revision: index.revision, evidenceIds: index.evidenceIds });
    const kept = index.evidenceIds.slice(Math.max(0, index.evidenceIds.length - request.maxEntries));
    for (const evidenceId of kept) {
      const evidenceLoad = await request.ledger.load(evidenceRefFor(request.projectId, evidenceId));
      if (evidenceLoad.status !== 'found' || evidenceLoad.snapshot.ref.aggregateType !== 'Evidence') {
        return {
          status: 'unavailable',
          message: '任务 ' + taskId + ' 的证据索引列出了 ' + evidenceId + '，但该 Evidence 聚合读不到：索引与证据不一致，按缺失处理（不补造条目）',
        };
      }
      const evidence = (evidenceLoad.snapshot as EvidenceSnapshot).evidence;
      if (evidence.subject.projectId !== request.projectId || evidence.subject.goalId !== request.goalId || evidence.subject.taskId !== taskId) {
        return { status: 'unavailable', message: '证据 ' + evidenceId + ' 的 subject 不属于本任务 ' + taskId + '：不把它当作本次材料' };
      }
      rows.push({
        taskId,
        evidenceId,
        kind: evidence.kind,
        outcome: evidence.outcome,
        coverage: evidence.coverage.map((entry) => ({ obligationId: entry.obligationId, requirementId: entry.requirementId })),
        anchor: {
          planRef: evidence.anchor.planRef,
          planRevision: evidence.anchor.planRevision,
          workspaceRevision: evidence.anchor.workspaceRevision,
          pinnedCompletionPolicy: evidence.anchor.pinnedCompletionPolicy,
          pinnedArchitectureBaseline: evidence.anchor.pinnedArchitectureBaseline,
        },
        producedByRun: evidence.source.runRef,
        admittedAt: (evidenceLoad.snapshot as EvidenceSnapshot).admittedAt,
      });
      evidenceRefs.push({
        kind: 'artifact',
        refId: 'evidence:' + evidenceId,
        revision: '1',
        ...(evidence.summary.artifactRef ? { digest: evidence.summary.artifactRef.digest } : {}),
      });
    }
  }
  const sourceRefs: SourceRefV1[] = [
    { kind: 'plan-revision', refId: request.planRef.planId, revision: String(request.planRevision) },
    { kind: 'workspace', refId: request.workspaceId, revision: String(request.workspaceRevision) },
    ...indexes.map((index) => ({
      kind: 'artifact' as const,
      refId: 'task-evidence-index:' + index.taskId,
      revision: String(index.revision),
    })),
  ];
  const content = canonicalJson({
    schemaVersion: 1,
    kind: 'evidence',
    taskId: request.taskId,
    predecessorTaskIds: taskIds.slice(1),
    indexes: indexes.map((index) => ({ taskId: index.taskId, aggregate: index.ref, revision: index.revision, evidenceIds: index.evidenceIds })),
    evidence: rows,
    indexOnly: '这只是已接纳证据的索引与结论字段（kind／outcome／coverage／anchor／产出运行）：正文在产物库里，本材料不把它当作已核验事实',
    qualification: '已提交事实的引用：不表示本 Run 已经完成任何工作，也不替代当前验收',
  } as JsonValue);
  const materialId = 'evidence-index:' + request.taskId;
  const entry: RuntimeRoleMaterialEntryV1 = {
    kind: 'evidence',
    materialId,
    content,
    digest: artifactBodyDigest(content),
    sourceRefs,
    selectedBecause: '角色规格必读材料「evidence」：本任务与直接前驱（' + (taskIds.slice(1).join(',') || '无') + '）的 canonical TaskEvidenceIndex 与其中已接纳的 Evidence；' +
      '每条都复核了 subject 归属与接纳顺序。它说明"已有哪些正式结论"，不说明本次工作已完成。',
    selection: rows.length > 0 ? 'selected' : 'empty',
    qualification: 'reference',
    versions: { workspaceRevision: request.workspaceRevision, planRevision: request.planRevision },
  };
  return {
    status: 'supplied',
    selection: entry.selection,
    rules: [],
    entries: [entry],
    evidenceRefs,
    sourceRefs,
    detail: rows.length > 0
      ? 'canonical TaskEvidenceIndex 与已接纳 Evidence（' + rows.length + ' 条，沿用既有 evidenceRefs 语义）'
      : 'canonical TaskEvidenceIndex 读取成功但本次范围内没有任何已接纳证据（可核对的确定事实）',
    materialIds: [materialId],
  };
}

export type DecisionMaterialRequest = {
  ledger: Pick<StateLedger, 'load'>;
  /** 缺省表示宿主没有接线事件读取：此时 decision 类别按缺失处理（不猜）。 */
  events?: Pick<StateLedger, 'events'>;
  projectId: string;
  workspaceId: string;
  goalId: string;
  planRef: PlanRevisionRef;
  planRevision: number;
  workspaceRevision: number;
  maxEntries: number;
};

/** 事件扫描上限：超过即如实报缺失，不用"扫到多少算多少"冒充完整。 */
export const DECISION_SCAN_PAGE_SIZE = 1000;
export const DECISION_SCAN_MAX_PAGES = 20;

/**
 * decision：本 Goal 上已接受的变更决定（UserDecision／GoalRevision）。
 *
 * 事实来源：事件只作**索引**，canonical 聚合才是事实——每条候选都按精确 ref 读回并逐字段复核；
 * 读不到或字段不符即按缺失处理（不采信事件里的自报字段）。
 */
export async function selectDecisionMaterial(request: DecisionMaterialRequest): Promise<RoleMaterialSourceResult> {
  if (request.events === undefined) {
    return { status: 'unavailable', message: '宿主未接线事件读取能力（StateLedger.events）：无法核对本 Goal 的已接受决定' };
  }
  const decisions = new Map<string, UserDecisionV1>();
  const revisions = new Map<number, GoalRevisionV1>();
  let cursor: CommitCursor | null = null;
  let pages = 0;
  let complete = false;
  for (let pageIndex = 0; pageIndex < DECISION_SCAN_MAX_PAGES; pageIndex++) {
    let page: EventPage;
    try {
      page = await request.events.events({ afterCursor: cursor, limit: DECISION_SCAN_PAGE_SIZE });
    } catch (error) {
      return { status: 'unavailable', message: '账本事件读取失败：' + (error instanceof Error ? error.message : '未知原因') };
    }
    pages++;
    for (const positioned of page.events) {
      const projectId = (positioned.event as { projectId?: string }).projectId;
      if (projectId !== request.projectId) continue;
      if (positioned.event.eventType === 'UserDecisionRecorded') {
        const decision = (positioned.event as UserDecisionRecordedEvent).payload?.decision;
        if (decision?.subject?.goalRef?.goalId === request.goalId) decisions.set(decision.decisionId, decision);
      } else if (positioned.event.eventType === 'GoalRevisionRecorded') {
        const change = (positioned.event as GoalRevisionRecordedEvent).payload?.change;
        if (change?.goalRef?.goalId === request.goalId && Number.isSafeInteger(change.revision)) revisions.set(change.revision, change);
      }
    }
    if (!page.hasMore) { complete = true; break; }
    if (page.throughCursor === null) break;
    cursor = page.throughCursor;
  }
  if (!complete) {
    return { status: 'unavailable', message: '账本事件扫描超过上限（' + DECISION_SCAN_MAX_PAGES + '×' + DECISION_SCAN_PAGE_SIZE + ' 条）：无法证明本 Goal 的已接受决定已读全，按缺失处理' };
  }
  const rows: Array<Record<string, unknown>> = [];
  const sourceRefs: SourceRefV1[] = [
    { kind: 'plan-revision', refId: request.planRef.planId, revision: String(request.planRevision) },
    { kind: 'workspace', refId: request.workspaceId, revision: String(request.workspaceRevision) },
  ];
  const ordered = [...decisions.values()].sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : a.decidedAt > b.decidedAt ? -1 : a.decisionId.localeCompare(b.decisionId)));
  for (const decision of ordered.slice(0, request.maxEntries)) {
    const loaded = await request.ledger.load({ aggregateType: 'UserDecision', projectId: request.projectId, workspaceId: decision.workspaceId, decisionId: decision.decisionId });
    if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'UserDecision') {
      return { status: 'unavailable', message: '决定 ' + decision.decisionId + ' 的事件存在但聚合法读不到：按缺失处理（不采信事件里的自报字段）' };
    }
    const canonical = (loaded.snapshot as UserDecisionSnapshot).decision;
    if (canonical.decisionId !== decision.decisionId || canonical.projectId !== request.projectId ||
      canonical.workspaceId !== decision.workspaceId || canonical.subject?.goalRef?.goalId !== request.goalId) {
      return { status: 'unavailable', message: '决定 ' + decision.decisionId + ' 的聚合字段与事件不一致：按缺失处理' };
    }
    rows.push({
      decisionId: canonical.decisionId,
      outcome: canonical.outcome,
      authority: canonical.authority,
      actor: canonical.actor,
      decidedAt: canonical.decidedAt,
      summary: canonical.summary,
      proposalRef: canonical.proposalRef,
      subject: canonical.subject,
      affectsCurrentPlan: canonical.subject?.sourcePlanRef?.planId === request.planRef.planId,
    });
    sourceRefs.push({ kind: 'governance', refId: 'user-decision:' + canonical.decisionId, revision: '1' });
  }
  const revisionRows: Array<Record<string, unknown>> = [];
  const orderedRevisions = [...revisions.values()].sort((a, b) => b.revision - a.revision);
  for (const change of orderedRevisions.slice(0, request.maxEntries)) {
    const loaded = await request.ledger.load({ aggregateType: 'GoalRevision', projectId: request.projectId, workspaceId: request.workspaceId, goalId: request.goalId, revision: change.revision });
    if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'GoalRevision') {
      return { status: 'unavailable', message: 'GoalRevision ' + change.revision + ' 的事件存在但聚合法读不到：按缺失处理' };
    }
    const canonical = (loaded.snapshot as GoalRevisionSnapshot).change;
    if (canonical.revision !== change.revision || canonical.goalRef?.goalId !== request.goalId) {
      return { status: 'unavailable', message: 'GoalRevision ' + change.revision + ' 的聚合字段与事件不一致：按缺失处理' };
    }
    revisionRows.push({
      revision: canonical.revision,
      activePlanRef: canonical.activePlanRef,
      supersededPlanRefs: canonical.supersededPlanRefs,
      changedAt: canonical.changedAt,
      reason: canonical.reason,
      affectsCurrentPlan: canonical.activePlanRef?.planId === request.planRef.planId ||
        canonical.supersededPlanRefs.some((ref) => ref.planId === request.planRef.planId),
    });
    sourceRefs.push({ kind: 'governance', refId: 'goal-revision:' + request.goalId + '/' + canonical.revision, revision: String(canonical.revision) });
  }
  const content = canonicalJson({
    schemaVersion: 1,
    kind: 'decision',
    goalId: request.goalId,
    planRef: request.planRef,
    planRevision: request.planRevision,
    scan: { pages, decisions: decisions.size, goalRevisions: revisions.size, complete: true },
    userDecisions: rows,
    goalRevisions: revisionRows,
    qualification: '已接受的变更决定（canonical 聚合逐字段复核）：它们是本次工作的边界，不授予新权限，也不能被重新解释成"未定"',
  } as JsonValue);
  const materialId = 'decisions:' + request.goalId;
  const entry: RuntimeRoleMaterialEntryV1 = {
    kind: 'decision',
    materialId,
    content,
    digest: artifactBodyDigest(content),
    sourceRefs,
    selectedBecause: '角色规格必读材料「decision」：本 Goal 上已落账的 UserDecision（' + rows.length + ' 条）与 GoalRevision（' + revisionRows.length +
      ' 条），每条都按精确 ref 读回 canonical 聚合并逐字段复核；事件只作索引。' +
      (rows.length + revisionRows.length === 0
        ? '本次扫描完整且没有任何已接受的变更决定（这是可核对的确定事实，不是"未核对"）。'
        : '影响本 Run 当前计划（' + request.planRef.planId + '）的条目在 content.affectsCurrentPlan 上标出。'),
    selection: rows.length + revisionRows.length > 0 ? 'selected' : 'empty',
    qualification: 'reference',
    versions: { workspaceRevision: request.workspaceRevision, planRevision: request.planRevision },
  };
  return {
    status: 'supplied',
    selection: entry.selection,
    rules: [],
    entries: [entry],
    evidenceRefs: [],
    sourceRefs,
    detail: rows.length + revisionRows.length > 0
      ? '本 Goal 的已接受决定（UserDecision ' + rows.length + ' 条、GoalRevision ' + revisionRows.length + ' 条，canonical 聚合复核）'
      : '账本扫描完整但本 Goal 还没有任何已接受的变更决定（可核对的确定事实）',
    materialIds: [materialId],
  };
}

/** 直接前驱任务 id：来自本 Run 的 PlanRevision 快照（executionDag 的 dependsOn 边）。 */
export function predecessorTaskIdsFor(plan: PlanRevisionSnapshot, taskId: string): string[] {
  return plan.executionDag.dependsOn.filter((edge) => edge.taskId === taskId).map((edge) => edge.dependsOnId);
}
