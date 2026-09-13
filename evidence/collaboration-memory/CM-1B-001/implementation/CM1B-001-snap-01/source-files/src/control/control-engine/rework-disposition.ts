import type { StateLedger, GoalSnapshot, ExpectedVersion } from '../../contracts/ledger.js';
import type { PlanRevisionRef, PlanRevisionSnapshot } from '../../contracts/plan.js';
import type { OpenIssuesRequestV1, ReworkIssueViewV1, ReworkIssueDispositionV1 } from '../../contracts/rework/issues.js';
import { obligationCarrierTaskIds } from '../../contracts/rework/issues.js';
import type { ReworkDispositionPort } from '../../contracts/rework/issues.js';
import { evidenceRefFor, taskEvidenceIndexRefFor, type EvidenceSnapshot, type EvidenceV1, type TaskEvidenceIndexSnapshot } from '../../contracts/evidence.js';
import { buildCurrentEffectivityAnchor } from './task-reducer.js';
import { qualifyReviewEvidence } from './reviewer-work.js';
import { selectEffectiveEvidenceSet } from './policies/evidence.js';

/** Obligation disposition is a Control policy. Journal PASS is not admission:
 * use canonical evidence, the reducer's current tuple and reviewer qualification. */
export class ControlReworkDisposition implements ReworkDispositionPort {
  constructor(private readonly ledger: StateLedger) {}
  async projectIssues(request: OpenIssuesRequestV1, issues: ReworkIssueViewV1[]): Promise<ReworkIssueViewV1[]> {
    const goalRef = { aggregateType: 'Goal' as const, projectId: request.projectId, goalId: request.goalId };
    const loaded = await this.ledger.load(goalRef);
    const goal = loaded.status === 'found' && loaded.snapshot.ref.aggregateType === 'Goal' ? loaded.snapshot as GoalSnapshot : null;
    const activePlanRef = goal?.workspaceRef.workspaceId === request.workspaceId ? goal.activePlanRevision : null;
    const planLoad = activePlanRef ? await this.ledger.load(activePlanRef) : null;
    const activePlan = planLoad?.status === 'found' && planLoad.snapshot.ref.aggregateType === 'PlanRevision' ? planLoad.snapshot as PlanRevisionSnapshot : null;
    const context: CurrentnessContext = { activePlanRef, activePlan, reverified: new Set() };
    const versions: ExpectedVersion[] = [{ ref: goalRef, revision: goal?.revision ?? 0 }];
    if (goal && activePlan) {
      const workspace = await this.ledger.load(goal.workspaceRef);
      if (workspace.status === 'found') {
        versions.push({ ref: goal.workspaceRef, revision: workspace.snapshot.revision });
        const anchor = buildCurrentEffectivityAnchor({ plan: activePlan, workspaceRevision: workspace.snapshot.revision });
        for (const taskId of new Set(issues.map(issue => issue.taskId))) {
          const ref = taskEvidenceIndexRefFor(request.projectId, request.goalId, taskId);
          const index = await this.ledger.load(ref);
          versions.push({ ref, revision: index.status === 'found' ? index.snapshot.revision : 0 });
          if (index.status !== 'found' || index.snapshot.ref.aggregateType !== 'TaskEvidenceIndex') continue;
          const evidence: EvidenceV1[] = [];
          let complete = true;
          for (const id of (index.snapshot as TaskEvidenceIndexSnapshot).evidenceIds) {
            const item = await this.ledger.load(evidenceRefFor(request.projectId,id));
            if (item.status !== 'found' || item.snapshot.ref.aggregateType !== 'Evidence') { complete = false; break; }
            const fact = (item.snapshot as EvidenceSnapshot).evidence;
            if (fact.subject.projectId !== request.projectId || fact.subject.goalId !== request.goalId || fact.subject.taskId !== taskId) { complete = false; break; }
            evidence.push(fact);
          }
          if (!complete) continue;
          const qualified = await qualifyReviewEvidence(this.ledger, activePlan, { projectId: request.projectId, goalId: request.goalId, taskId }, evidence, versions);
          const effective = selectEffectiveEvidenceSet(qualified, activePlan, anchor);
          for (const key of Object.keys(effective.coverageByRequirement)) context.reverified.add(taskId + '\u0000' + key);
        }
      }
    }
    for (const version of versions) {
      const current = await this.ledger.load(version.ref);
      if ((current.status === 'found' ? current.snapshot.revision : 0) !== version.revision) {
        return issues.map(issue => ({ ...issue, currentness: { status: 'unknown', issues: ['Canonical facts changed during disposition lookup'] }, disposition: { status: 'unknown', carrierTaskIds: [], issues: ['Canonical facts changed during disposition lookup'] } }));
      }
    }
    return issues.map(issue => this.withCurrentness(issue, context));
  }
  private withCurrentness(issue: ReworkIssueViewV1, context: CurrentnessContext): ReworkIssueViewV1 {
    const activePlanRef = context.activePlanRef;
    if (activePlanRef === null) {
      return {
        ...issue,
        currentness: { status: 'unknown', issues: ['Goal 当前没有可解析的 active plan revision；无法判断该问题是否仍属当前版本'] },
        disposition: {
          status: 'unknown',
          carrierTaskIds: [],
          issues: ['没有可解析的 active plan revision：这些义务现在由谁承担无法确认，因此不按"已处置"处理'],
        },
      };
    }
    // currentness 只由"证据 anchor 是不是当前 revision"决定（不需要读计划本身）。
    const samePlan = activePlanRef.projectId === issue.planRef.projectId && activePlanRef.planId === issue.planRef.planId;
    if (context.activePlan === null) {
      // 计划快照读不到：currentness 照旧可判，但处置事实无法核对——如实给 unknown，不当作已处置。
      const carrierUnknown: ReworkIssueDispositionV1 = {
        status: 'unknown',
        carrierTaskIds: [],
        issues: ['读不到当前 active plan revision（' + activePlanRef.planId + '）的计划快照：这些义务现在由谁承担无法确认，因此不按"已处置"处理'],
      };
      return samePlan
        ? { ...issue, currentness: { status: 'open', issues: [] }, disposition: carrierUnknown }
        : {
            ...issue,
            currentness: { status: 'superseded', issues: ['该问题来自已不再生效的 plan revision；既有 FAIL 与报告仍保留在账本中'] },
            disposition: carrierUnknown,
          };
    }
    // 承担者判据复用 contracts/rework/issues.ts 的唯一实现（与返工驱动读的是同一条规则）。
    const carriers = obligationCarrierTaskIds(context.activePlan, issue.failedRequirements.map((requirement) => requirement.obligationId));

    if (this.reverifiedOn(context, issue)) {
      return { ...issue, currentness: { status: samePlan ? 'open' : 'superseded', issues: [] }, disposition: { status: 'disposed_by_reverification', carrierTaskIds: carriers.taskIds, issues: ['全部失败要求已由当前适用且正式接纳的 Evidence 重新验证通过'] } };
    }
    if (samePlan) {
      return {
        ...issue,
        currentness: { status: 'open', issues: [] },
        disposition: {
          status: 'unaddressed',
          carrierTaskIds: carriers.taskIds,
          issues: carriers.missing.length === 0
            ? []
            : ['失败要求指向的义务 ' + carriers.missing.join('、') + ' 不在当前 revision 里：承担者无法核对，该问题未处置'],
        },
      };
    }

    // anchor 已失效。先排除"读不到归属"的情形，再判"未处置"与"已处置"。
    if (carriers.missing.length > 0) {
      return {
        ...issue,
        currentness: { status: 'superseded', issues: ['该问题来自已不再生效的 plan revision；既有 FAIL 与报告仍保留在账本中'] },
        disposition: {
          status: 'unknown',
          carrierTaskIds: carriers.taskIds,
          issues: ['失败要求指向的义务 ' + carriers.missing.join('、') + ' 不在当前 revision（' + activePlanRef.planId + '）里：无法判断这些义务归谁承担，不当作已处置'],
        },
      };
    }
    // 义务在当前 revision 里连一个 active 承担者都没有：说不出"谁接手了"，因此不报已处置。
    // 这一条是 RC-01 的反面保险——把"没人承担"写成"已被处置"正是本票要修的缺陷形态。
    if (carriers.taskIds.length === 0) {
      return {
        ...issue,
        currentness: { status: 'superseded', issues: ['该问题来自已不再生效的 plan revision；既有 FAIL 与报告仍保留在账本中'] },
        disposition: {
          status: 'unknown',
          carrierTaskIds: [],
          issues: [
            '当前 revision（' + activePlanRef.planId + '）里义务 ' + carriers.missing.join('、') +
              ' 没有任何 active 承担者：说不出谁接手了这些失败要求，因此不当作已处置（需要人核对）',
          ],
        },
      };
    }
    if (carriers.taskIds.includes(issue.taskId)) {
      return {
        ...issue,
        currentness: { status: 'superseded', issues: ['该问题来自已不再生效的 plan revision；既有 FAIL 与报告仍保留在账本中'] },
        disposition: {
          status: 'carried_by_task',
          carrierTaskIds: carriers.taskIds,
          issues: [
            '证据 anchor 属于 ' + issue.planRef.planId + '（已不生效），但当前 revision（' + activePlanRef.planId +
              '）里这些义务仍由任务 ' + carriers.taskIds.join('、') + ' 承担（disposition=active），且没有在当前 revision 上重验通过：该失败**尚未处置**',
          ],
        },
      };
    }
    return {
      ...issue,
      currentness: { status: 'superseded', issues: ['该问题来自已不再生效的 plan revision；既有 FAIL 与报告仍保留在账本中'] },
      disposition: {
        status: 'disposed_by_rework',
        carrierTaskIds: carriers.taskIds,
        issues: [
          '当前 revision（' + activePlanRef.planId + '）里这些义务已经不由任务 ' + issue.taskId + ' 承担，改由 ' +
            (carriers.taskIds.join('、') || '（没有 active 承担者）') + ' 承担：承担者已换人',
        ],
      },
    };
  }


  private reverifiedOn(context: CurrentnessContext, issue: ReworkIssueViewV1): boolean {
    return issue.failedRequirements.length > 0 && issue.failedRequirements.every(r => context.reverified.has(issue.taskId + '\u0000' + r.obligationId + '\u0000' + r.requirementId));
  }
}
type CurrentnessContext = { activePlanRef: PlanRevisionRef | null; activePlan: PlanRevisionSnapshot | null; reverified: Set<string> };
