/** Validate and group current failure material into a bounded rework proposal.
 * Compilation performs no I/O; Control alone accepts a new PlanRevision. */
import type { AcceptanceObligation, PlanRevisionSnapshot, PlanTaskAssignment, RuntimeTask } from '../../contracts/plan.js';
import { revisionAssignments } from '../../contracts/plan.js';
import type { GoalRef } from '../../contracts/ledger.js';
import { PLAN_CHANGE_MAX_TASK_DELTAS } from '../../contracts/goal-change.js';
import { REWORK_MAX_ISSUES_PER_PROPOSAL, reworkTaskIdFor, type ReworkCompileRejectionCode, type ReworkCompileRequestV1, type ReworkCompileResultV1, type ReworkNeedsDecisionCode } from '../../contracts/rework/proposal.js';
import { reworkIssueFactFor, reworkIssueUnaddressed, type ReworkIssueViewV1 } from '../../contracts/rework/issues.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import { buildTaskSetDelta, buildProposal, type ReworkGroup } from './rework-proposal.js';

type PendingGroup = { sourceTask: RuntimeTask; sourceAssignment: PlanTaskAssignment | null; issues: ReworkIssueViewV1[]; obligations: AcceptanceObligation[] };
type Diagnostic = { code: string; issueId: string | null; message: string };

/**
 * 拒绝码的优先级。为什么要显式排序：结论必须只由「问题集合」决定，而不是由「哪条问题
 * 先被遍历到」决定；把最根本的问题（作用域/当前性）排在前面，人拿到的主码也最可操作。
 */
const REJECTION_PRECEDENCE: readonly ReworkCompileRejectionCode[] = [
  'invalid_request',
  'issue_out_of_scope',
  'issue_not_current',
  'issue_identity_conflict',
  'issue_identity_inconsistent',
  'issue_without_failed_requirements',
  'issue_task_not_in_plan',
  'replaceable_task_without_assignment',
  'obligation_not_in_plan',
  'obligation_not_carried_by_task',
  'rework_task_already_in_plan',
  'delta_exceeds_bound',
  'too_many_issues',
  'empty_issue_set',
];

const rankOf = (code: string): number => {
  const index = REJECTION_PRECEDENCE.indexOf(code as ReworkCompileRejectionCode);
  return index === -1 ? REJECTION_PRECEDENCE.length : index;
};

/** 诊断的确定性排序：同一批问题得到逐字相同的诊断列表，与调用方的输入顺序无关。 */
function orderedDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => {
    const rank = rankOf(a.code) - rankOf(b.code);
    if (rank !== 0) return rank;
    const issue = (a.issueId ?? '').localeCompare(b.issueId ?? '');
    return issue !== 0 ? issue : a.message.localeCompare(b.message);
  });
}

const diagnosticLines = (diagnostics: Diagnostic[]): string[] =>
  diagnostics.map((entry) =>
    entry.issueId === null ? entry.code + ': ' + entry.message : entry.code + ' [' + entry.issueId + ']: ' + entry.message,
  );

function rejected(code: ReworkCompileRejectionCode, diagnostics: Diagnostic[]): ReworkCompileResultV1 {
  const ordered = orderedDiagnostics(diagnostics);
  return {
    status: 'rejected',
    code,
    message: ordered[0]?.message ?? code,
    issues: diagnosticLines(ordered),
  };
}

function needsDecision(code: ReworkNeedsDecisionCode, diagnostics: Diagnostic[]): ReworkCompileResultV1 {
  const ordered = orderedDiagnostics(diagnostics);
  return {
    status: 'needs_decision',
    code,
    message: ordered[0]?.message ?? code,
    issues: diagnosticLines(ordered),
  };
}

/**
 * 返工提案编译器。没有构造依赖（无时钟、无账本、无端口），compile 是同步纯函数——
 * 这样「编译不产生任何账本写入」不是承诺，而是没有可写入的入口。
 */
export class ReworkPlanCompiler {
  compile(request: ReworkCompileRequestV1): ReworkCompileResultV1 {
    const shapeIssue = validateRequest(request);
    if (shapeIssue !== null) {
      return rejected('invalid_request', [{ code: 'invalid_request', issueId: null, message: shapeIssue }]);
    }
    const activePlan = request.activePlan;

    if (request.issues.length === 0) {
      return rejected('empty_issue_set', [
        {
          code: 'empty_issue_set',
          issueId: null,
          message: '没有要处置的未处置问题：空集合既不构成一次计划变更，也不能用来证明完成',
        },
      ]);
    }
    if (request.issues.length > REWORK_MAX_ISSUES_PER_PROPOSAL) {
      return rejected('too_many_issues', [
        {
          code: 'too_many_issues',
          issueId: null,
          message:
            '未处置问题 ' + request.issues.length + ' 条超过上限 ' + REWORK_MAX_ISSUES_PER_PROPOSAL + ' 条；请先收敛范围或分批返工',
        },
      ]);
    }

    // 规范化：按 issueId 排序；同 id 且事实一致的去重，事实冲突的整批拒绝
    // （问题身份必须唯一对应一组事实，不能任选一份）。
    const deduped: ReworkIssueViewV1[] = [];
    const conflicts: Diagnostic[] = [];
    for (const issue of [...request.issues].sort((a, b) => a.issueId.localeCompare(b.issueId))) {
      const previous = deduped.find((candidate) => candidate.issueId === issue.issueId);
      if (previous === undefined) {
        deduped.push(issue);
        continue;
      }
      if (canonicalJson(reworkIssueFactFor(previous) as never) !== canonicalJson(reworkIssueFactFor(issue) as never)) {
        conflicts.push({
          code: 'issue_identity_conflict',
          issueId: issue.issueId,
          message: '同一 issueId 出现了内容不同的问题；问题身份必须唯一对应一组事实，不能任选一份',
        });
      }
    }
    if (conflicts.length > 0) return rejected('issue_identity_conflict', conflicts);

    // 源 revision 的指派（RW-07）：一律经契约的唯一读取入口取，不自己挑字段。
    const assignmentByTask = new Map(revisionAssignments(activePlan).map((entry) => [entry.taskId, entry]));

    // 逐条核对。全部问题检查完再决定结论：结论只由问题集合决定，不由遍历顺序决定。
    const rejections: Diagnostic[] = [];
    const decisions: Diagnostic[] = [];
    const pending = new Map<string, PendingGroup>();

    for (const issue of deduped) {
      const scopeIssue = checkScope(request, issue);
      if (scopeIssue !== null) {
        rejections.push(scopeIssue);
        continue;
      }
      const currentIssue = checkCurrent(activePlan, issue);
      if (currentIssue !== null) {
        rejections.push(currentIssue);
        continue;
      }
      // 返工任务 id 必须就是契约函数推导出的那一个：视图值与推导值不一致，说明这条问题
      // 的身份被改写或来自别的实现，重复提案将无法去重。
      const derivedTaskId = reworkTaskIdFor(issue.issueId);
      if (issue.reworkTaskId !== derivedTaskId) {
        rejections.push({
          code: 'issue_identity_inconsistent',
          issueId: issue.issueId,
          message:
            '问题携带的返工任务 id ' + issue.reworkTaskId + ' 与 reworkTaskIdFor 推导的 ' + derivedTaskId + ' 不一致',
        });
        continue;
      }
      if (issue.failedRequirements.length === 0) {
        rejections.push({
          code: 'issue_without_failed_requirements',
          issueId: issue.issueId,
          message: '问题没有列出任何未通过的验收要求；没有失败要求就没有返工对象',
        });
        continue;
      }
      const sourceTask = activePlan.tasks.find((task) => task.taskId === issue.taskId);
      if (sourceTask === undefined) {
        rejections.push({
          code: 'issue_task_not_in_plan',
          issueId: issue.issueId,
          message:
            '问题指向的任务 ' + issue.taskId + ' 不在当前 active plan revision（' + activePlan.ref.planId + '@' + activePlan.planRevision + '）里',
        });
        continue;
      }
      // 被取代者必须在源 revision 里是 active。已经 superseded／cancelled／deferred 的任务
      // 不能再被取代（那是链式取代或推翻既有处置），属于必须由人决定的范围。
      if (sourceTask.disposition !== 'active') {
        const soleCarriers = activePlan.obligations
          .filter((obligation) => obligation.taskIds.length === 1 && obligation.taskIds[0] === issue.taskId)
          .map((obligation) => obligation.obligationId);
        decisions.push({
          code: 'task_not_replaceable',
          issueId: issue.issueId,
          message:
            '任务 ' + issue.taskId + ' 在源 revision 里已经是 ' + sourceTask.disposition + '，不能被再次取代' +
            (soleCarriers.length > 0 ? '（且它是义务 ' + soleCarriers.join('、') + ' 的唯一承担者，取消该承担者会让这些义务没有承担者）' : '') +
            '；继续处置需要人的决定',
        });
        continue;
      }
      // 返工任务的指派由「被取代任务的指派 + 失败事实」推导。work 任务的源指派缺失时
      // role 无从推导，本模块不猜（猜出来的承担者角色等于伪造授权），直接拒绝；gate 任务本来
      // 就没有实现指派（初始规划与守卫 f1 同一约定），返工后仍是没有指派的 gate。
      const sourceAssignment = sourceTask.taskKind === 'work' ? assignmentByTask.get(issue.taskId) ?? null : null;
      if (sourceTask.taskKind === 'work' && sourceAssignment === null) {
        rejections.push({
          code: 'replaceable_task_without_assignment',
          issueId: issue.issueId,
          message:
            '任务 ' + issue.taskId + ' 在源 revision ' + activePlan.ref.planId + '@' + activePlan.planRevision +
            ' 里没有 assignment（role／instruction）：返工任务的承担者角色只能取自被取代任务的指派，不从别处推断、也不新造授权',
        });
        continue;
      }
      for (const requirement of issue.failedRequirements) {
        const obligation = activePlan.obligations.find(
          (candidate) => candidate.obligationId === requirement.obligationId,
        );
        if (obligation === undefined) {
          rejections.push({
            code: 'obligation_not_in_plan',
            issueId: issue.issueId,
            message:
              '失败要求 ' + requirement.obligationId + '/' + requirement.requirementId + ' 指向的义务不在源 revision 里；返工不能发明义务',
          });
          continue;
        }
        if (!obligation.taskIds.includes(issue.taskId)) {
          rejections.push({
            code: 'obligation_not_carried_by_task',
            issueId: issue.issueId,
            message:
              '义务 ' + requirement.obligationId + ' 在源 revision 里不由任务 ' + issue.taskId + ' 承担（承担者：' +
              (obligation.taskIds.join('、') || '无') + '）；问题与计划事实不一致',
          });
        }
      }
      const existing = pending.get(issue.taskId);
      if (existing === undefined) {
        // 接手的是该任务在源 revision 里承担的**全部**义务，而不只是失败的那几条：
        // 被取代任务退出执行后它的每一项义务都必须有人继续承担，否则新 revision 会失去
        // 义务承担者（P1-02 非空守卫），那就不是"只换承担者"了。
        pending.set(issue.taskId, {
          sourceTask,
          sourceAssignment,
          issues: [issue],
          obligations: activePlan.obligations.filter((obligation) => obligation.taskIds.includes(issue.taskId)),
        });
      } else {
        existing.issues.push(issue);
      }
    }

    // 结构不一致优先于需要决定：输入与 canonical 对不上时，先要修的是输入本身。
    if (rejections.length > 0) {
      const ordered = orderedDiagnostics(rejections);
      const decisionsOrdered = orderedDiagnostics(decisions);
      // 需要人的决定的判定也一并列出：主码是拒绝码，但人能看到同一批问题里还有哪些需要决定。
      return rejected(ordered[0]!.code as ReworkCompileRejectionCode, [...ordered, ...decisionsOrdered]);
    }
    if (decisions.length > 0) {
      const ordered = orderedDiagnostics(decisions);
      return needsDecision(ordered[0]!.code as ReworkNeedsDecisionCode, ordered);
    }

    const groups = this.groupRework(pending, activePlan);
    if (typeof groups === 'string') {
      // groupRework 只在发现"返工任务 id 与源 revision 冲突"时返回诊断说明，
      // 属于输入与 canonical 事实不一致，按 rejected 处理（不猜、不换 id）。
      const diagnostics = orderedDiagnostics([
        { code: 'rework_task_already_in_plan', issueId: null, message: groups },
      ]);
      return rejected('rework_task_already_in_plan', diagnostics);
    }

    const delta = buildTaskSetDelta(groups, activePlan);
    if (delta.length > PLAN_CHANGE_MAX_TASK_DELTAS) {
      return rejected('delta_exceeds_bound', [
        {
          code: 'delta_exceeds_bound',
          issueId: null,
          message:
            '推导出的任务集增量 ' + delta.length + ' 条操作超过受理上限 ' + PLAN_CHANGE_MAX_TASK_DELTAS + ' 条；请分批返工',
        },
      ]);
    }

    return { status: 'proposal', proposal: buildProposal(request, deduped, groups, delta) };
  }

  /**
   * 把「问题 → 任务」的分组转成返工任务分组：一个被取代任务恰好一个返工任务。
   *
   * 同一任务被多条问题指向时（例如同一任务先后两轮验证各留下一条问题）只生成一个返工
   * 任务：一次取代只能有一个取代者，两条 replaceTask 指向同一个被取代任务是非法的
   * （checkTaskSetDelta 会拒绝）。返工任务 id 取排序最前的问题身份推导值，确定性且稳定。
   */
  private groupRework(pending: Map<string, PendingGroup>, activePlan: PlanRevisionSnapshot): ReworkGroup[] | string {
    const groups: ReworkGroup[] = [];
    for (const [taskId, group] of pending) {
      const ordered = [...group.issues].sort((a, b) => a.issueId.localeCompare(b.issueId));
      const primaryIssueId = ordered[0]!.issueId;
      const reworkTaskId = reworkTaskIdFor(primaryIssueId);
      // 新增任务的 id 已经存在于源 revision：本模块不换 id、不改名，直接拒绝，
      // 否则会覆盖一个已有任务或把两条不同的返工混成一个身份。
      if (activePlan.tasks.some((task) => task.taskId === reworkTaskId)) {
        return '推导出的返工任务 id ' + reworkTaskId + ' 已经存在于源 revision（问题 ' + primaryIssueId + '）；不覆盖既有任务，需人工处置';
      }
      if (group.obligations.length === 0) {
        return '任务 ' + taskId + ' 在源 revision 里不承担任何义务，无法推导"只换承担者"的增量';
      }
      groups.push({
        sourceTask: group.sourceTask,
        sourceAssignment: group.sourceAssignment,
        issues: ordered,
        obligations: group.obligations,
        primaryIssueId,
        reworkTaskId,
      });
    }
    // 组的顺序按被取代任务 id：增量的书写顺序由此确定，不随输入顺序变化。
    return groups.sort((a, b) => a.sourceTask.taskId.localeCompare(b.sourceTask.taskId));
  }
}

// --------------------------------------------------------------------------- //
// 输入校验与逐条核对                                                          //
// --------------------------------------------------------------------------- //

function validateRequest(request: ReworkCompileRequestV1): string | null {
  if (request === null || request === undefined || typeof request !== 'object') return '编译请求是必填项';
  if (request.schemaVersion !== 1) return 'schemaVersion 必须为 1';
  if (!request.projectId) return 'projectId 是必填项';
  if (!request.workspaceId) return 'workspaceId 是必填项';
  const goalRef: GoalRef | undefined = request.goalRef;
  if (!goalRef || goalRef.aggregateType !== 'Goal' || goalRef.projectId !== request.projectId || !goalRef.goalId) {
    return 'goalRef 必须指向本 project 下的 Goal';
  }
  if (typeof request.goalObjective !== 'string' || request.goalObjective.trim().length === 0) {
    return 'goalObjective 必须是当前目标正文（返工逐字沿用它，不从别处推断目标）';
  }
  const plan: PlanRevisionSnapshot | undefined = request.activePlan;
  if (!plan || plan.ref?.aggregateType !== 'PlanRevision') return 'activePlan 必须是 PlanRevision 快照';
  if (plan.ref.projectId !== request.projectId) return 'activePlan 不属于本 project';
  if (canonicalJson(plan.goalRef as never) !== canonicalJson(goalRef as never)) return 'activePlan 不是该 Goal 的计划';
  if (!Number.isInteger(plan.planRevision) || plan.planRevision < 1) return 'activePlan.planRevision 必须是从 1 开始的整数';
  if (!Array.isArray(request.issues)) return 'issues 必须是数组';
  return null;
}

/** 问题必须属于被编译的这个作用域：跨作用域的问题不能混进同一份提案。 */
function checkScope(request: ReworkCompileRequestV1, issue: ReworkIssueViewV1): Diagnostic | null {
  if (issue.schemaVersion !== 1) {
    return { code: 'invalid_request', issueId: issue.issueId, message: '问题的 schemaVersion 必须是 1' };
  }
  if (
    issue.projectId !== request.projectId ||
    issue.workspaceId !== request.workspaceId ||
    issue.goalId !== request.goalRef.goalId
  ) {
    return {
      code: 'issue_out_of_scope',
      issueId: issue.issueId,
      message:
        '问题属于 ' + issue.projectId + '/' + issue.workspaceId + '/' + issue.goalId + '，与本次编译的 ' +
        request.projectId + '/' + request.workspaceId + '/' + request.goalRef.goalId + ' 不一致',
    };
  }
  return null;
}

/**
 * 问题必须**尚未处置**，并且能够落到这份 active revision 上。三条判据都用问题自身的机械身份，
 * 不依赖视图推断：
 *   1. 处置事实（RC-01）必须是"尚未处置"——contracts/rework/issues.ts 的 reworkIssueUnaddressed 是唯一
 *      判据（unaddressed／carried_by_task）。superseded（承担者已换人或已重验通过）与 unknown
 *      都不能用来授权一次自动受理。disposition 缺失的手写视图回落到 currentness=open。
 *   2. anchor 与当前 active revision 同一身份时：问题带的 revision 号非 0 就必须一致
 *      （独立审阅来源的问题不带 revision 号，记为 0——这是明确记录"该字段没有信息"）。
 *   3. anchor 已失效但处置事实是 carried_by_task（计划推进让 anchor 失效，而失败义务仍由原任务
 *      承担、也没有在当前 revision 上重验通过）时**允许**：这正是 RC-01 要修的形态——分组 A 的
 *      受理推进 revision 之后，同一批里尚未处置的分组 B 必须仍能被接手。这里不放松任何来源判据：
 *      边界 (a) 仍然要求每一条失败要求在它自己的 anchor revision 上有已提交的非 PASS 结论
 *      （RW-04 的 triggerSourceIssues），下面逐条核对还会再确认任务仍在、仍是 active、仍承担这些义务。
 */
function checkCurrent(activePlan: PlanRevisionSnapshot, issue: ReworkIssueViewV1): Diagnostic | null {
  if (!reworkIssueUnaddressed(issue)) {
    return {
      code: 'issue_not_current',
      issueId: issue.issueId,
      message:
        '问题的处置事实为 ' + dispositionText(issue) + '（当前性 ' + String(issue.currentness?.status ?? 'unknown') +
        '：' + (issue.currentness?.issues.join('；') || '无说明') + '）；只有尚未处置的问题才能推导返工',
    };
  }
  const samePlan = canonicalJson(issue.planRef as never) === canonicalJson(activePlan.ref as never);
  if (samePlan) {
    if (issue.planRevision !== 0 && issue.planRevision !== activePlan.planRevision) {
      return {
        code: 'issue_not_current',
        issueId: issue.issueId,
        message:
          '问题成立时的 revision 是 ' + issue.planRevision + '，与当前 active revision ' + activePlan.planRevision + ' 不一致',
      };
    }
    return null;
  }
  if (issue.disposition?.status !== 'carried_by_task') {
    return {
      code: 'issue_not_current',
      issueId: issue.issueId,
      message:
        '问题来自 ' + issue.planRef.planId + '，当前 active revision 是 ' + activePlan.ref.planId +
        '；处置事实为 ' + dispositionText(issue) + '，只有 carried_by_task（失败义务仍由原任务承担且尚未处置）才允许在推进后的 revision 上推导返工',
    };
  }
  return null;
}

/** 处置事实的人可读描述：缺失时如实写"未提供"，不猜。 */
function dispositionText(issue: ReworkIssueViewV1): string {
  const disposition = issue.disposition;
  if (disposition === undefined) return '未提供（disposition 缺失）';
  return disposition.status + '（承担者 ' + (disposition.carrierTaskIds.join('、') || '无 active 承担者') + '；' +
    (disposition.issues.join('；') || '无说明') + '）';
}