import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');
const write=(p,s)=>fs.writeFileSync(p,s);
const vp='src/control/verification-engine/verification-open-issues.ts';
let s=read(vp);
const method=s.slice(s.indexOf('  private withCurrentness('),s.indexOf('  /**\n   * RC-01：这条问题'));
const control=`import type { StateLedger, GoalSnapshot, ExpectedVersion } from '../../contracts/ledger.js';
import type { PlanRevisionRef, PlanRevisionSnapshot } from '../../contracts/plan.js';
import type { OpenIssuesRequestV1, ReworkIssueViewV1, ReworkIssueDispositionV1 } from '../../contracts/rework.js';
import { obligationCarrierTaskIds } from '../../contracts/rework.js';
import type { ReworkDispositionPort } from '../../contracts/rework-disposition.js';
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
          for (const key of Object.keys(effective.coverageByRequirement)) context.reverified.add(taskId + '\\u0000' + key);
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
${method.replace('if (samePlan) {','if (this.reverifiedOn(context, issue)) {\n      return { ...issue, currentness: { status: samePlan ? \'open\' : \'superseded\', issues: [] }, disposition: { status: \'disposed_by_reverification\', carrierTaskIds: carriers.taskIds, issues: [\'当前适用且正式接纳的 Evidence 已覆盖全部失败要求\'] } };\n    }\n    if (samePlan) {')}
  private reverifiedOn(context: CurrentnessContext, issue: ReworkIssueViewV1): boolean {
    return issue.failedRequirements.length > 0 && issue.failedRequirements.every(r => context.reverified.has(issue.taskId + '\\u0000' + r.obligationId + '\\u0000' + r.requirementId));
  }
}
type CurrentnessContext = { activePlanRef: PlanRevisionRef | null; activePlan: PlanRevisionSnapshot | null; reverified: Set<string> };
`;
write('src/control/control-engine/rework-disposition.ts',control);
s=s.replace("import type { StateLedger } from '../../contracts/ledger.js';", "import type { ReworkDispositionPort } from '../../contracts/rework-disposition.js';");
s=s.replace("import type { GoalSnapshot } from '../../contracts/ledger.js';\n",'');
s=s.replace("    ledger: Pick<StateLedger, 'load'>;",'    disposition: ReworkDispositionPort;');
const a=s.indexOf('    const goal = await this.loadGoal(request);'), b=s.indexOf('    // 同一任务同一问题',a);
s=s.slice(0,a)+`    const gaps: string[] = [];
    const raw = [...await this.roundIssues(request, gaps), ...this.reviewIssues(request, gaps)];
    const issues = await this.deps.disposition.projectIssues(request, raw);

`+s.slice(b);
const la=s.indexOf('  private async loadGoal('),lb=s.indexOf('  private coveredTasks(',la);s=s.slice(0,la)+s.slice(lb);
const ma=s.indexOf('  /**\n   * 标注一条问题'),mb=s.indexOf('/** 检查记录里已经有的耗时近似',ma);
s=s.slice(0,ma)+'}\n\n'+s.slice(mb);
s=s.replace(/import type \{ PlanRevisionRef, PlanRevisionSnapshot \}/,'import type { PlanRevisionRef }');
s=s.replace('  obligationCarrierTaskIds,\n','').replace('  type ReworkIssueDispositionV1,\n','');
write(vp,s);
