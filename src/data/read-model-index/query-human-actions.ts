import type { StateLedger, GoalSnapshot } from '../../contracts/ledger.js';
import type { DomainEvent } from '../../contracts/events.js';
import type { CommitCursor } from '../../contracts/command-event.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../contracts/fingerprint.js';
import type { QueryFactScope, QueryHumanActionsFacts, HumanActionDomain } from '../../contracts/query-quality-facts.js';
import { initialDesignProposalDigest } from '../../contracts/human-role-collaboration.js';
import { decisionTargetFor } from '../../contracts/goal-change.js';
import { queryJobRefFor, type QueryJobSnapshot, type QueryJobAnswerSnapshot } from '../../contracts/query-job.js';
import { parseInitialPlanningResponse } from '../../contracts/initial-planning.js';
import { parseFeedbackResolution } from '../../contracts/execution-feedback.js';
import { architectureReviewView } from './architecture-review-view.js';
import type { GoalPhaseSnapshot } from '../../contracts/goal-phase.js';
import { reworkIssueUnaddressed } from '../../contracts/rework/issues.js';

type Deps = {
  ledger: Pick<StateLedger, 'load' | 'events'>;
  source?: import('../../contracts/query-execution-context.js').QuerySourceRevisionPort;
  /** Captured by the composition root through the existing read-only API. */
  rework?: import('../../contracts/rework/drive.js').ReworkDriveViewV1;
  reworkWitness?: { cursor: CommitCursor | null; verificationStable: boolean };
};
type Domain = QueryHumanActionsFacts['domains'][number];
const json = (v: unknown): JsonValue => JSON.parse(JSON.stringify(v));
const same = (a: unknown, b: unknown) => canonicalJson(json(a)) === canonicalJson(json(b));
const categories: HumanActionDomain[] = ['initial-design', 'initial-planning', 'execution-feedback', 'plan-change', 'architecture-review', 'unknown-side-effect', 'rework'];

/** Capture before reading external projections; consumers compare this exact
 * ledger position after their complete scan. No dependency on Dispatch. */
export async function humanActionCaptureCursor(ledger: Pick<StateLedger, 'events'>): Promise<CommitCursor | null> {
  let cursor: CommitCursor | null = null;
  for (let pageNumber = 0; pageNumber < 200; pageNumber++) {
    const page = await ledger.events({ afterCursor: cursor, limit: 1000 });
    for (const row of page.events) cursor = row.cursor;
    if (!page.hasMore) return cursor;
  }
  throw Error('Human-action capture history exceeds complete-result capacity');
}

/** Bounded observation of existing authorities. No commands, new request
 * authority, semantic interpretation of prose, or implicit task creation. */
export async function queryHumanActions(deps: Deps, scope: QueryFactScope): Promise<QueryHumanActionsFacts> {
  const facts: QueryHumanActionsFacts = { schemaVersion: 1, object: 'pending-human-items', scope: { ...scope },
    status: 'unavailable', observedAt: new Date().toISOString(), version: '', pendingCount: null,
    domains: categories.map(domain => ({ domain, status: 'ready-empty', coverage: 'recorded-exact-goal-' + domain, records: [], issues: [] })), issues: [] };
  const domain = (name: HumanActionDomain) => facts.domains.find(d => d.domain === name)!;
  const add = (name: HumanActionDomain, record: Domain['records'][number]) => { const d = domain(name); d.records.push(record); d.status = 'ready'; };
  const finish = () => {
    for (const d of facts.domains) d.records.sort((a, b) => canonicalJson(a.ref).localeCompare(canonicalJson(b.ref)));
    // Read time and unrelated cursor progress do not change semantic identity.
    const { observedAt: _time, version: _version, ...stable } = facts;
    facts.version = sha256Hex(canonicalJson(stable)); return facts;
  };
  try {
    if (Object.values(scope).some(v => typeof v !== 'string' || !v)) throw Error('Explicit human-action scope required');
    const goalRef = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId: scope.goalId };
    const g = await deps.ledger.load(goalRef);
    if (g.status !== 'found') { facts.status = 'not_found'; facts.domains = []; facts.issues = ['Goal not found in this scope']; return finish(); }
    const goal = g.snapshot as GoalSnapshot;
    if (goal.workspaceRef.workspaceId !== scope.workspaceId) throw Error('Human-action Goal workspace mismatch');
    const events: DomainEvent[] = [];
    let cursor: CommitCursor | null = null, complete = false;
    for (let i = 0; i < 200; i++) {
      const page = await deps.ledger.events({ afterCursor: cursor, limit: 1000 });
      for (const row of page.events) {
        cursor = row.cursor;
        if (row.event.projectId === scope.projectId && 'workspaceId' in row.event && row.event.workspaceId === scope.workspaceId)
          events.push(row.event);
      }
      if (!page.hasMore) { complete = true; break; }
    }
    if (!complete) throw Error('Human-action history exceeds complete-result capacity');
    const designs = events.filter((e): e is Extract<DomainEvent, { eventType: 'InitialDesignProposalRecorded' }> => e.eventType === 'InitialDesignProposalRecorded');
    const designDecisions = events.filter((e): e is Extract<DomainEvent, { eventType: 'InitialDesignDecisionRecorded' }> => e.eventType === 'InitialDesignDecisionRecorded');
    for (const event of designs) {
      const p = event.payload.proposal;
      if (!same(p.goalRef, goalRef)) continue;
      const ref = { aggregateType: 'InitialDesignProposal', projectId: scope.projectId, workspaceId: scope.workspaceId, designId: p.designId };
      const decisions = designDecisions.filter(d => same(d.payload.decision.proposalRef, ref)).map(d => d.payload.decision);
      if (decisions.some(d => d.subject.proposalRevision !== 1 || d.authorizedTarget.proposalDigest !== initialDesignProposalDigest(p)
          || d.authorizedTarget.designId !== p.designId || !p.options.some(o => o.optionId === d.authorizedTarget.optionId))) throw Error('Initial design decision binding mismatch');
      const applicable = p.planRef === null ? goal.activePlanRevision === null : same(p.planRef, goal.activePlanRevision);
      add('initial-design', { ref, revision: 1, recordedAt: event.payload.recordedAt, status: applicable ? 'ready' : 'stale',
        pendingHumanAction: decisions.length ? false : applicable ? true : null, authority: 'formal-proposal',
        value: json({ proposal: p, decisions, selectedCandidate: { coverage: 'exact-initial-design-option-decisions',
          records: decisions.filter(d => d.outcome === 'accept').map(d => ({ decisionId: d.decisionId, optionId: d.authorizedTarget.optionId, actor: d.actor, decidedAt: d.decidedAt })) },
          baselineActivation: 'not-observed-by-this-decision-protocol' }) });
    }
    const proposals = events.filter((e): e is Extract<DomainEvent, { eventType: 'PlanProposalRecorded' }> => e.eventType === 'PlanProposalRecorded');
    const userDecisions = events.filter((e): e is Extract<DomainEvent, { eventType: 'UserDecisionRecorded' }> => e.eventType === 'UserDecisionRecorded').map(e => e.payload.decision);
    for (const event of proposals) {
      const p = event.payload.proposal; if (!same(p.sourceGoalRef, goalRef)) continue;
      const ref = { aggregateType: 'PlanProposal', projectId: scope.projectId, workspaceId: scope.workspaceId, proposalId: p.proposalId };
      const decisions = userDecisions.filter(d => same(d.proposalRef, ref));
      if (decisions.some(d => !same(d.authorizedTarget, decisionTargetFor(p)) || !same(d.subject.goalRef, goalRef)
          || !same(d.subject.sourcePlanRef, p.sourcePlanRef) || d.subject.sourcePlanRevision !== p.sourcePlanRevision)) throw Error('Plan decision binding mismatch');
      add('plan-change', { ref, revision: 1, recordedAt: event.payload.recordedAt,
        status: same(p.sourcePlanRef, goal.activePlanRevision) ? 'ready' : 'stale', pendingHumanAction: decisions.length ? false : null,
        authority: 'formal-proposal', value: json({ proposal: p, decisions,
          pendingBoundary: 'An undecided proposal alone does not establish that human intervention is required; autonomous admission may apply.' }) });
    }
    const jobs: QueryJobSnapshot[] = [];
    for (const event of events) {
      if (event.eventType !== 'QueryJobSubmitted' || event.payload.job.goalId !== scope.goalId
          || !['initial_coordination', 'execution_coordination'].includes(event.payload.job.intent.execution?.kind ?? '')) continue;
      if (event.payload.job.intent.execution?.kind === 'initial_coordination' && !event.payload.job.intent.execution.implementationAuthorization) continue;
      const found = await deps.ledger.load(queryJobRefFor(scope.projectId, scope.workspaceId, event.payload.job.queryJobId));
      if (found.status !== 'found' || found.snapshot.ref.aggregateType !== 'QueryJob') throw Error('Recorded QueryJob missing');
      jobs.push(found.snapshot as QueryJobSnapshot);
    }
    const superseded = new Set(jobs.flatMap(j => j.job.intent.execution?.feedback?.supersedesQueryJobId ? [j.job.intent.execution.feedback.supersedesQueryJobId] : []));
    let source: string | null | undefined;
    for (const snapshot of jobs) {
      const j = snapshot.job, execution = j.intent.execution!;
      if (j.status !== 'answered' || superseded.has(j.queryJobId)) continue;
      const answerRef = j.answerRefs.at(-1); if (!answerRef) throw Error('Answered Query has no answer');
      const found = await deps.ledger.load(answerRef);
      if (found.status !== 'found' || found.snapshot.ref.aggregateType !== 'QueryJobAnswer') throw Error('Recorded question answer missing');
      const a = (found.snapshot as QueryJobAnswerSnapshot).answer;
      if (!same(a.queryJobRef, snapshot.ref) || !same(a.runRef, j.runRef)) throw Error('Question answer identity mismatch');
      const feedback = execution.feedback;
      const parsed = feedback ? parseFeedbackResolution(a.answer) : parseInitialPlanningResponse(a.answer);
      if ('action' in parsed ? parsed.action !== 'needs_decision' : parsed.status !== 'needs_decision') continue;
      if (source === undefined) source = deps.source ? await deps.source.sourceRevision(scope.projectId, scope.workspaceId) : null;
      const recordedSource = a.sources.find(s => s.kind === 'workspace_source')?.version;
      let status: Domain['records'][number]['status'] = a.stale ? 'stale' : source === null || !recordedSource ? 'unavailable' : source !== recordedSource ? 'stale' : 'ready';
      if (feedback) {
        const workspace = await deps.ledger.load({ aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId });
        if (workspace.status !== 'found') status = 'unavailable';
        else if (workspace.snapshot.revision !== feedback.workspaceRevision) status = 'stale';
      }
      if (feedback && !same(feedback.planRef, goal.activePlanRevision)) status = 'stale';
      if (!feedback && goal.activePlanRevision !== null) status = 'stale';
      const choiceId = 'feedback-choice-' + sha256Hex(canonicalJson(answerRef)).slice(0, 32) + '-decision';
      const decisions = feedback ? userDecisions.filter(d => d.decisionId === choiceId && same(d.subject.goalRef, goalRef)) : [];
      // A matching id alone is not proof that this question was resolved. The
      // existing exact-choice parser/authority remains with its owner; expose
      // these records without inferring a resolved state from their name.
      const decisionUnverified = decisions.length > 0;
      add(feedback ? 'execution-feedback' : 'initial-planning', { ref: json(answerRef), revision: found.snapshot.revision,
        recordedAt: a.answeredAt, status: decisionUnverified ? 'unavailable' : status, pendingHumanAction: decisionUnverified ? null : status === 'ready' ? true : null,
        authority: 'recorded-query-question', value: json({ question: parsed, jobRef: snapshot.ref, jobRevision: snapshot.revision, decisions,
          sourceVersion: recordedSource ?? null, observedSourceVersion: source, feedback: feedback ?? null,
          boundary: 'This is a recorded question, not a newly assigned task or proof that unrelated work is blocked. A matching decision id is supplied for inspection, not proof of an exact option selection.' }) });
    }
    const reviews = await architectureReviewView(deps.ledger, scope);
    for (const row of reviews.rows.filter(r => r.review.reporterRunRef.goalId === scope.goalId)) {
      const current = same(row.brief.planRef, goal.activePlanRevision);
      add('architecture-review', { ref: json(row.review.ref), revision: row.review.revision, recordedAt: row.review.recordedAt,
        status: current ? 'ready' : 'stale', pendingHumanAction: row.review.status !== 'pending' ? false : current ? true : null,
        authority: 'formal-proposal', value: json({ review: row.review, targets: row.targets, decisionFacts: row.decisionFacts,
          boundary: 'Only recorded resume targets wait on this proposal; notify targets and future migration conditions do not create current Gate prerequisites.' }) });
    }
    const phase = await deps.ledger.load({ aggregateType: 'GoalPhase', projectId: scope.projectId, goalId: scope.goalId });
    if (phase.status === 'found') {
      const p = phase.snapshot as GoalPhaseSnapshot;
      if (p.reasonCodes.includes('unknown_side_effect_needs_decision')) add('unknown-side-effect', {
        ref: json(p.ref), revision: p.revision, recordedAt: p.reducedAt, status: same(p.planRef, goal.activePlanRevision) ? 'ready' : 'stale',
        pendingHumanAction: same(p.planRef, goal.activePlanRevision) ? true : null, authority: 'formal-goal-phase', value: json(p) });
    }
    const rework = deps.rework;
    if (!rework) Object.assign(domain('rework'), { status: 'unavailable', issues: ['No complete current rework observation is bound here; process-local lastDrive is not durable authority.'] });
    else if (!same(rework.scope, scope)) throw Error('Captured rework scope mismatch');
    else if (!deps.reworkWitness || !deps.reworkWitness.verificationStable || deps.reworkWitness.cursor !== cursor
        || !same(rework.acceptance.activePlanRef, goal.activePlanRevision))
      Object.assign(domain('rework'), { status: 'unavailable', issues: ['Rework capture lacks a stable ledger, verification and active-Plan witness.'] });
    else if (rework.issues.status === 'unavailable') Object.assign(domain('rework'), { status: 'unavailable', issues: [rework.issues.message, ...rework.gaps] });
    else if (rework.issues.status === 'none') {
      if (rework.gaps.length || rework.issues.gaps.length) Object.assign(domain('rework'), { status: 'unavailable', issues: [...rework.gaps, ...rework.issues.gaps] });
    } else {
      const issues = rework.issues.issues;
      const open = issues.filter(reworkIssueUnaddressed);
      const uncertain = issues.some(i => i.disposition ? i.disposition.status === 'unknown' : i.currentness.status === 'unknown');
      const status = same(rework.acceptance.activePlanRef, goal.activePlanRevision) && !rework.gaps.length && !rework.issues.gaps.length && !uncertain ? 'ready' : 'unavailable';
      if (!issues.length && status !== 'ready') Object.assign(domain('rework'), { status, issues: ['Rework basis is unavailable'] });
      if (issues.length) add('rework', { ref: json({ ...goalRef, observation: 'current-rework-preview' }), revision: goal.revision,
        recordedAt: issues.map(i => i.detectedAt).sort().at(-1)!,
        status, pendingHumanAction: status !== 'ready' ? null : rework.proposal.status === 'needs_decision' ? true : open.length ? null : false,
        authority: 'current-rework-preview', value: json({ view: rework, boundary: 'A current compiler preview from durable issue and acceptance facts, not a historical human handoff, assigned task, or process-local lastDrive.' }) });
    }
    if (facts.domains.reduce((n, d) => n + d.records.length, 0) > 128) throw Error('Human-action records exceed complete-result capacity');
    const tail = await deps.ledger.events({ afterCursor: cursor, limit: 1 });
    if (tail.events.length || tail.hasMore || !same((await deps.ledger.load(goalRef)), g)) {
      facts.status = 'stale'; facts.domains = []; facts.issues = ['Human-action authorities changed during observation']; return finish();
    }
    const unavailable = facts.domains.some(d => !['ready', 'ready-empty'].includes(d.status) || d.records.some(r => r.pendingHumanAction === null));
    facts.status = unavailable ? 'unavailable' : facts.domains.some(d => d.records.length) ? 'ready' : 'ready-empty';
    facts.pendingCount = unavailable ? null : facts.domains.flatMap(d => d.records).filter(r => r.pendingHumanAction).length;
    return finish();
  } catch (error) {
    facts.status = 'failed'; facts.domains = []; facts.issues = [String(error)]; return finish();
  }
}
