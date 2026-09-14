/** Verification supplies failure provenance; Control projects current obligation disposition. Reads do not accept proposals. */
import type { ArtifactRef } from '../artifact.js';
import type { EvidenceRef } from '../evidence.js';
import type { PlanRevisionRef, PlanRevisionSnapshot } from '../plan.js';
import type { RunRef } from '../dispatch.js';
import { canonicalJson, sha256Hex } from '../fingerprint.js';

export const REWORK_MAX_ISSUES = 32;

export const REWORK_MAX_FAILED_REQUIREMENTS = 64;

/** 一个返工问题来自哪条已提交事实。两类来源互不替代，也都不改写成对方的形状。 */
export type ReworkIssueSourceV1 =
  | {
      kind: 'verification_round';
      /** 轮次记录身份（VerificationEngine 的持久 journal 文件名/receipt requestId）。 */
      roundId: string;
      requestId: string;
      /** 轮次整体结论；失败问题只在 outcome 非 PASS 时成立。 */
      outcome: 'FAIL' | 'INCONCLUSIVE';
      status: 'completed' | 'interrupted';
      sourceDigest: string | null;
    }
  | {
      kind: 'review_verdict';
      reviewId: string;
      requestId: string;
      /** 独立 Reviewer 的正式结果身份（Control 账本中的 ReviewResult）。 */
      resultRef: string;
    };

/**
 * 命令检查失败的确定性分类取值。这些值由 CommandCheckProvider 在执行时判定、随原始
 * 检查报告一起持久化，本契约只把它们**声明**出来供返工提案与界面穷举展示。
 *
 * 为什么这里不是第二套分类：投影只读不判——category 一律原样透传提供者已经持久化的值；
 * 若提供者将来新增取值，读取侧保留原值并在该条事实的 gaps 中标注，绝不映射成别的类别。
 */
export const COMMAND_CHECK_CATEGORIES = [
  'tool_check',
  'timeout',
  'cancelled',
  'runtime_error',
  'stale_source',
  'unknown_effects',
  'environment_error',
] as const;

/**
 * stderr 摘要的字节上限。为什么要有界：问题投影要能解释失败，但它的用途是「为什么失败」
 * 而不是搬运日志正文；完整正文始终留在 ArtifactVault，由 reportRef 按权限读取。
 */
export const REWORK_FAILURE_STDERR_MAX_BYTES = 2048;

/**
 * 一条失败要求的结构化失败事实：回答「为什么 fail」，而不是只给一个 result。
 *
 * 来源与权威：
 *   - checkId／command／timeoutMs／category／result／sourceDigest／reportRef 取自
 *     VerificationEngine 已持久化的检查记录（journal 的 checks）及其引用的原始报告；
 *   - exitCode／timedOut／stderrExcerpt／精确耗时只存在于原始报告正文里，因此需要报告
 *     读取端口；读不到时字段为 null 并在 gaps 写明原因。
 *
 * 取舍：字段一律存在，取不到就用 null + gaps 表达，不允许「少一个字段」这种静默省略；
 * 缺口只说明「读不到」，绝不因此把该要求当成通过。
 */
export type ReworkFailureFactV1 = {
  /** 决定该条要求结论的检查身份；reviewer 类要求由审阅逐条结论承载，此处为 null。 */
  checkId: string | null;
  /** 同一要求下全部未通过的检查身份（按身份排序）；checkId 只是其中被选作主事实的一条。 */
  failedCheckIds: string[];
  kind: 'static' | 'dynamic' | 'reviewer';
  /** 失败分类原值（见 COMMAND_CHECK_CATEGORIES）；reviewer 类要求为 null，不另立分类。 */
  category: string | null;
  /** 该检查的结论；null 表示检查没有产生结论（例如轮次中断或检查未执行）。 */
  result: 'FAIL' | 'INCONCLUSIVE' | null;
  /** 实际注册并执行的命令原文（trusted configuration，不是从失败文本推断的）；无则为 null。 */
  command: string | null;
  /** 单次工具超时预算，毫秒；解释 timeout 分类时必须与它一起看。 */
  timeoutMs: number | null;
  exitCode: number | null;
  timedOut: boolean | null;
  /** 工具实际耗时，毫秒：优先用原始报告的执行计时，其次用检查记录的起止时间。 */
  durationMs: number | null;
  /** 有界 stderr 摘要（不超过 REWORK_FAILURE_STDERR_MAX_BYTES 字节）；空字符串表示命令没有 stderr 输出。 */
  stderrExcerpt: string | null;
  /** 该失败成立时的源码摘要；与轮次 materialIdentity.sourceDigest 同一身份。 */
  sourceDigest: string | null;
  /** 原始报告引用：工具检查指向命令检查报告，独立审阅指向审阅报告；正文保留在 Vault，不复制。 */
  reportRef: ArtifactRef | null;
  /** 事实缺口：每个取不到的字段为什么取不到；空数组表示该事实完整。 */
  gaps: string[];
};

/** 一条具体的未满足验收要求；obligationId+requirementId 与 Evidence.coverage 同一键。 */
export type ReworkFailedRequirementV1 = {
  obligationId: string;
  requirementId: string;
  /** 该要求的验证种类；reviewer 类要求由独立审阅覆盖，其余由工具轮次覆盖。 */
  kind: 'static' | 'dynamic' | 'reviewer';
  /** 该要求在本问题来源中失败的原因（来自工具结论或审阅逐条结论）。 */
  reason: string;
  /**
   * 结构化的失败事实。必填：即使事实不完整也必须显式给出缺口原因，
   * 不允许用「没有这个字段」代替「我没有读到」。
   */
  failure: ReworkFailureFactV1;
};

/**
 * 一个问题 = 某任务在某个具体版本上、由某条已提交验证事实留下的未满足验收要求集合。
 * issueId 是确定性身份：同一事实重复读取得到同一 id，避免重复返工。
 */
export type ReworkIssueV1 = {
  schemaVersion: 1;
  issueId: string;
  projectId: string;
  workspaceId: string;
  goalId: string;
  /** 留下问题的任务与 Run；返工任务不是它，也不改它的历史。 */
  taskId: string;
  runRef: RunRef;
  /** 问题成立时生效的 plan revision；返工会在新 revision 上重验。 */
  planRef: PlanRevisionRef;
  planRevision: number;
  source: ReworkIssueSourceV1;
  failedRequirements: ReworkFailedRequirementV1[];
  evidenceRefs: EvidenceRef[];
  /** 人类可读的问题摘要与来源说明（不代替上面的机械身份）。 */
  summary: string;
  detectedAt: string;
};

/**
 * issueId 只由「哪条事实 + 哪个任务 + 哪些要求」决定；摘要与时间不参与。
 *
 * 失败事实（failure）同样不参与身份：它是同一要求的解释材料，可能因为报告已被清理或
 * 读取端口未注入而变得不完整，身份不能随之变化，否则同一条失败会在重启后变成新问题。
 */
export function reworkIssueIdFor(input: {
  taskId: string;
  source: ReworkIssueSourceV1;
  failedRequirements: ReworkFailedRequirementV1[];
}): string {
  const sourceKey = input.source.kind === 'verification_round'
    ? { kind: input.source.kind, roundId: input.source.roundId }
    : { kind: input.source.kind, reviewId: input.source.reviewId };
  const requirements = [...input.failedRequirements]
    .map((r) => ({ obligationId: r.obligationId, requirementId: r.requirementId }))
    .sort((a, b) => canonicalJson(a as never).localeCompare(canonicalJson(b as never)));
  return 'rework-issue-' + sha256Hex(canonicalJson({ taskId: input.taskId, source: sourceKey, requirements } as never)).slice(0, 40);
}

/**
 * 由视图取回问题的机械事实（去掉 currentness／reworkTaskId 这类相对当前 revision 的
 * 派生标注）。提案落账后是长期记录，不能把会立刻过期的视图判断写进去。
 *
 * 同一要求集合可能以不同顺序出现，这里按 (obligationId, requirementId) 规范化排序：
 * 问题的身份本来就只由集合决定（见 reworkIssueIdFor），顺序不承载信息。这不是重新判定，
 * 而是把集合写成一个确定的形状——否则同一组事实会因为遍历顺序不同而产生不同的提案字节。
 */
export function reworkIssueFactFor(view: ReworkIssueViewV1): ReworkIssueV1 {
  return {
    schemaVersion: 1,
    issueId: view.issueId,
    projectId: view.projectId,
    workspaceId: view.workspaceId,
    goalId: view.goalId,
    taskId: view.taskId,
    runRef: { ...view.runRef },
    planRef: { ...view.planRef },
    planRevision: view.planRevision,
    source: { ...view.source },
    failedRequirements: [...view.failedRequirements]
      .map((requirement) => ({
        ...requirement,
        failure: {
          ...requirement.failure,
          failedCheckIds: [...requirement.failure.failedCheckIds],
          gaps: [...requirement.failure.gaps],
        },
      }))
      .sort((a, b) =>
        a.obligationId === b.obligationId
          ? a.requirementId.localeCompare(b.requirementId)
          : a.obligationId.localeCompare(b.obligationId),
      ),
    evidenceRefs: [...view.evidenceRefs]
      .map((ref) => ({ ...ref }))
      .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)),
    summary: view.summary,
    detectedAt: view.detectedAt,
  };
}

/**
 * 问题的**处置事实**——它列出的失败义务在当前 revision 上有没有明确承担者、是否已经
 * 在当前 revision 上重新验证通过。
 *
 * 为什么与 currentness 是两条正交的轴：
 *   - currentness 说的是「证据 anchor 是否仍生效」：anchor 变化只说明**旧 FAIL 不再直接适用于
 *     当前 revision**（历史证据失效）；
 *   - disposition 说的是「义务是否已经被处置」：只有承担者换人（返工任务接手）或该要求已在
 *     当前 revision 上重验通过，才算处置。
 * 一次触发受理了分组 A 之后，分组 B 的问题 anchor 因为计划推进而失效，
 * 它既没有被任何返工任务接手、也没有重验通过，却被标成 superseded。用「历史证据失效」冒充
 * 「问题已被处置」，会让尚未处置的失败义务凭空消失。因此两者必须分别表达。
 */
export type ReworkIssueDispositionV1 = {
  /**
   * - unaddressed：证据 anchor 就是当前 active revision，问题尚未处置；
   * - carried_by_task：anchor 已失效，但当前 revision 里这些义务仍由**原来那个任务**承担
   *   （该任务仍是 active），且没有在当前 revision 上重验通过 → 仍未处置，但落点明确；
   * - disposed_by_rework：承担者已经换人（原任务不再承担这些义务，改由别的 active 任务承担，
   *   通常是返工任务）；
   * - disposed_by_reverification：这些要求已经在当前 revision 上重新验证通过；
   * - unknown：读不到 canonical 计划，无法判断（**不得**当成已处置）。
   */
  status: 'unaddressed' | 'carried_by_task' | 'disposed_by_rework' | 'disposed_by_reverification' | 'unknown';
  /** 当前 revision 里承担这些失败义务的 active 任务 id（升序）；读不到计划时为空数组。 */
  carrierTaskIds: string[];
  /** 判断依据：取证来源与理由（引用 canonical 事实），供人核对，不含自由判断。 */
  issues: string[];
};

/** 便于人阅读的问题视图：把问题的机械身份与当前任务相位放在一起展示。 */
export type ReworkIssueViewV1 = ReworkIssueV1 & {
  currentness: { status: 'open' | 'superseded' | 'unknown'; issues: string[] };
  /**
   * 处置事实。可选：VerificationOpenIssues 返回 Control 投影的正式义务处置结果。
   * 手写／替身视图省略该字段即表示「本次没有给出这项事实」，消费方必须 fail-closed
   * （不得把「没给」当成「有承担者」，也不得当成「已处置」）。
   */
  disposition?: ReworkIssueDispositionV1;
  reworkTaskId: string;
};

/**
 * 这条问题是否**尚未处置**（可以由返工接手）。
 *
 * 唯一实现：驱动（DispatchEngine 的返工触发）用它挑出要处理的分组，PlanCompiler 用它作
 * 授权判据，两处不可能各判一套。判据是处置事实而不是「证据 anchor 是否仍生效」——一次受理
 * 推进计划之后，同一批里其它尚未处置的问题 anchor 也会失效，但它们并没有被处置。
 *
 * disposition 缺失（手写／替身视图没有给出该事实）时回落到 currentness：只有 open 才算未处置。
 * 缺少事实就不放行，不猜——这与「读不到就是读不到」的既有约定一致。
 */
export function reworkIssueUnaddressed(issue: ReworkIssueViewV1): boolean {
  const disposition = issue.disposition;
  if (disposition === undefined) return issue.currentness?.status === 'open';
  return disposition.status === 'unaddressed' || disposition.status === 'carried_by_task';
}

/**
 * 「这些义务在当前 revision 里由谁承担」的**唯一**判据。
 *
 * 返回当前 revision 里承担这些义务的 **active** 任务 id（升序），以及在计划里根本找不到的
 * 义务（missing）。判据只有两条 canonical 事实：义务的 taskIds 与任务的 disposition。
 * 为什么不看 replacedByTaskId：换人之后承担者就是义务集合里的 active 任务，读它就是最终答案；
 * 读 replacedByTaskId 反而会漏掉「义务被并给另一个既有任务」的形态。
 *
 * 用途（同一判据，避免各判一套）：Control 据此投影问题处置事实，
 * 返工驱动据此交代每一项失败义务的落点。
 */
export function obligationCarrierTaskIds(
  plan: PlanRevisionSnapshot,
  obligationIds: readonly string[],
): { taskIds: string[]; missing: string[] } {
  const wanted = [...new Set(obligationIds)].sort();
  const active = new Set(plan.tasks.filter((task) => task.disposition === 'active').map((task) => task.taskId));
  const taskIds = new Set<string>();
  const missing: string[] = [];
  for (const obligationId of wanted) {
    const obligation = plan.obligations.find((candidate) => candidate.obligationId === obligationId);
    if (obligation === undefined) {
      missing.push(obligationId);
      continue;
    }
    for (const taskId of obligation.taskIds) if (active.has(taskId)) taskIds.add(taskId);
  }
  return { taskIds: [...taskIds].sort(), missing };
}

/** VerificationEngine 提供的问题只读投影；调用方据此提案或展示，不能直接改正式状态。 */
export type OpenIssuesViewV1 =
  | { status: 'ready'; issues: ReworkIssueViewV1[]; gaps: string[] }
  | { status: 'none'; gaps: string[] }
  | { status: 'unavailable'; code: 'scope_not_found' | 'unavailable'; message: string };

export type OpenIssuesRequestV1 = {
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  goalId: string;
  /** 限定任务时只返回这些任务的问题；空表示该 Goal 下的全部任务。 */
  taskIds: string[];
};

/** Control explains current obligation carriers and effective admitted evidence.
 * Input issues retain their original verification provenance; this read cannot
 * accept a proposal or change a Task. */
export interface ReworkDispositionPort {
  projectIssues(request: OpenIssuesRequestV1, issues: ReworkIssueViewV1[]): Promise<ReworkIssueViewV1[]>;
}
