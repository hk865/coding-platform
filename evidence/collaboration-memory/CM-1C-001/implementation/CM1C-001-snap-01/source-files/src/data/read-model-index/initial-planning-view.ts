import type { StateLedger } from '../../contracts/ledger.js';
import type { QueryJobAnswerSnapshot, QueryRunRef } from '../../contracts/query-job.js';
import type { PlanRevisionSnapshot } from '../../contracts/plan.js';
import { initialPlanIdFor, parseInitialPlanningResponse, type InitialPlanAssignment } from '../../contracts/initial-planning.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import type { ScopeCatalogPort } from '../../contracts/scope-catalog.js';
type Scope = {
    projectId: string;
    workspaceId: string;
    goalId: string;
};
type ProposalView = { status: 'needs_decision'; summary: string; questions: string[] } | { status: 'plan'; plan: { planId: string; origin: { summary: string; assignments: InitialPlanAssignment[] } } };
export class InitialPlanningView<TRun extends { runRef: QueryRunRef } = { runRef: QueryRunRef }> {
    constructor(private readonly h: {
        ledger: StateLedger;
        observedCursor(): import('../../contracts/command-event.js').CommitCursor | null;
    }, private readonly catalog: Pick<ScopeCatalogPort, 'jobs'>, private readonly queries: { all(): TRun[] }) { }
    async view(scope: Scope) {
        const rows = [];
        for (const snapshot of (await this.catalog.jobs(scope)).filter(row => row.job.intent.execution?.kind === 'initial_coordination' && row.job.intent.execution.implementationAuthorization)) {
            const job = snapshot.job;
            if (job.projectId !== scope.projectId || job.workspaceId !== scope.workspaceId || job.goalId !== scope.goalId)
                continue;
            const answer = job.answerRefs.at(-1) ? await this.h.ledger.load(job.answerRefs.at(-1)!) : null;
            let proposal: ProposalView | null = null, accepted = false, issue: string | null = job.closeReason?.message ?? null;
            if (answer?.status === 'found')
                try {
                    const source = (answer.snapshot as QueryJobAnswerSnapshot).answer;
                    if (source.stale) throw Error('initial planning source mismatch');
                    const parsed = parseInitialPlanningResponse(source.answer);
                    if (parsed.status === 'needs_decision') proposal = parsed;
                    else {
                        const planId = initialPlanIdFor(job.intent);
                        // A preview displays the model's words; only an exact canonical
                        // plan origin changes the view to plan_accepted.
                        proposal = { status: 'plan', plan: { planId, origin: { summary: parsed.summary, assignments: parsed.assignments } } };
                        const loaded = await this.h.ledger.load({ aggregateType: 'PlanRevision', projectId: scope.projectId, planId });
                        const plan = loaded.status === 'found' ? loaded.snapshot as PlanRevisionSnapshot : null;
                        accepted = !!plan?.origin && canonicalJson(plan.origin.answerRef) === canonicalJson(answer.snapshot.ref) && plan.origin.answerDigest === sha256Hex(source.answer);
                        if (accepted && plan?.origin) proposal = { status: 'plan', plan: { planId, origin: plan.origin } };
                    }
                }
                catch (error) {
                    issue = String(error);
                }
            rows.push({
                queryJobId: job.queryJobId, requestId: job.intent.execution!.implementationAuthorization!.requestId, status: accepted ? 'plan_accepted' : proposal?.status === 'needs_decision' ? 'needs_decision' : job.status, proposal, issue,
                runs: this.queries.all().filter(run => run.runRef.queryJobId === job.queryJobId && run.runRef.projectId === scope.projectId && run.runRef.workspaceId === scope.workspaceId), sourceCursor: this.h.observedCursor()
            });
        }
        return rows;
    }
}
