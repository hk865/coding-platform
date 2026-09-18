/** Select the exact bounded collaboration facts used by Query answers and their
 * applicability check. Absence and derived target progress are facts too. */
import type { StateLedger } from '../../contracts/ledger.js';
import type { PlanRevisionSnapshot } from '../../contracts/plan.js';
import { revisionAssignments } from '../../contracts/plan.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
export type QueryArchitectureFacts = (scope: { projectId: string; workspaceId: string }) => Promise<import('../../contracts/architecture-review.js').ArchitectureReviewView>;
type PrerequisiteObservation = { taskId: string; dependencies: string[]; reduction: { phase: import('../../contracts/reduction.js').TaskReductionPhase } | null; reductionMatchesPlan: boolean };
/** Presentation index of recorded reductions, never a readiness or completion reducer. */
export function summarizeQueryPrerequisites(work: readonly PrerequisiteObservation[]) {
  const byTask = new Map(work.map(row => [row.taskId, row]));
  return work.filter(row => row.dependencies.length > 0).map(row => {
    const taskIds = [...new Set(row.dependencies)];
    const recordedSatisfiedTaskIds: string[] = [], unknownAcceptanceTaskIds: string[] = [], historicalAcceptanceTaskIds: string[] = [], unobservedTaskIds: string[] = [];
    const otherRecordedPhases: { taskId: string; phase: import('../../contracts/reduction.js').TaskReductionPhase }[] = [];
    for (const taskId of taskIds) {
      const dependency = byTask.get(taskId);
      if (!dependency) unobservedTaskIds.push(taskId);
      else if (!dependency.reduction) unknownAcceptanceTaskIds.push(taskId);
      else if (!dependency.reductionMatchesPlan) historicalAcceptanceTaskIds.push(taskId);
      else if (dependency.reduction.phase === 'satisfied') recordedSatisfiedTaskIds.push(taskId);
      else otherRecordedPhases.push({ taskId, phase: dependency.reduction.phase });
    }
    return { taskId: row.taskId, prerequisiteTaskIds: taskIds, recordedSatisfiedTaskIds, unknownAcceptanceTaskIds,
      historicalAcceptanceTaskIds, unobservedTaskIds, otherRecordedPhases, currentSourceReadiness: 'not_assessed' as const };
  });
}
export async function selectQueryCollaborationFacts(deps: { ledger: Pick<StateLedger, 'load'>; architectureActivation?: import('../../contracts/governance-view.js').ArchitectureActivationReader; architectureReviews?: QueryArchitectureFacts; verificationFacts?: import('../../contracts/query-quality-facts.js').QueryVerificationFactsPort['queryFacts']; humanActions?: import('../../contracts/query-quality-facts.js').QueryHumanActionsPort['queryHumanActions'] }, scope: { projectId: string; workspaceId: string; goalId: string }, acceptedPlan: PlanRevisionSnapshot | null) {
    const { projectId, workspaceId, goalId } = scope;
    const selectedSources: { kind: string; refKey: string; version: string }[] = [];
    const collaborationWork: Array<{ taskId: string; assignment: import('../../contracts/plan.js').PlanTaskAssignment | null;
      dependencies: string[]; reduction: import('../../contracts/reduction.js').TaskReductionSnapshot | null; reductionMatchesPlan: boolean;
      latestRun: { ref: import('../../contracts/dispatch.js').RunRef; revision: number; planRef: PlanRevisionSnapshot['ref']; status: string; outcome: string | null; exitCode: number | null; startedAt: string | null; endedAt: string | null; matchesCurrentPlan: boolean } | null }> = [];
    const dynamicFactVersions: import('../../contracts/ledger.js').VersionedRef[] = [];
    let goalPhase = null;
    if (goalId) {
      const ref = { aggregateType: 'GoalPhase' as const, projectId, goalId };
      const loaded = await deps.ledger.load(ref);
      if (loaded.status === 'found') {
        if (loaded.snapshot.ref.aggregateType !== 'GoalPhase' || canonicalJson(loaded.snapshot.ref) !== canonicalJson(ref)) throw Error('Goal phase scope mismatch');
        const phase = loaded.snapshot as import('../../contracts/goal-phase.js').GoalPhaseSnapshot;
        if (phase.planRef && phase.planRef.projectId !== projectId) throw Error('Goal phase plan scope mismatch');
        goalPhase = { ref: phase.ref, revision: phase.revision, planRef: phase.planRef, phase: phase.phase,
          reasonCodes: phase.reasonCodes, reducedAt: phase.reducedAt,
          matchesCurrentPlan: canonicalJson(phase.planRef) === canonicalJson(acceptedPlan?.ref ?? null),
          authority: 'Independent committed GoalPhase from the StateLedger reducer, not inferred from Task results or model statements. This is the last recorded formal state at reducedAt. matchesCurrentPlan compares Plan identity only; it does not prove acceptance of the currently observed source. No verification-to-current-source applicability witness is supplied here. Cite recorded completion as such, never as renewed source acceptance. A different Plan is historical; absence means unknown formal Goal state.' };
        dynamicFactVersions.push({ ref: phase.ref, revision: phase.revision });
        selectedSources.push({ kind: 'goal-phase', refKey: canonicalJson(ref), version: String(phase.revision) });
      }
    }
    if (acceptedPlan) {
      const assignments = revisionAssignments(acceptedPlan);
      for (const task of acceptedPlan.tasks.slice(0, 64)) {
        const ref = { aggregateType: 'TaskReduction' as const, projectId, goalId: goalId, taskId: task.taskId };
        const loaded = await deps.ledger.load(ref);
        const reduction = loaded.status === 'found' && loaded.snapshot.ref.aggregateType === 'TaskReduction'
          ? loaded.snapshot as import('../../contracts/reduction.js').TaskReductionSnapshot : null;
        const lease = await deps.ledger.load({ aggregateType: 'TaskLease', projectId, goalId: goalId, taskId: task.taskId });
        let latestRun = null;
        if (lease.status === 'found' && lease.snapshot.ref.aggregateType === 'TaskLease') {
          const holder = lease.snapshot as import('../../contracts/dispatch.js').TaskLeaseSnapshot;
          const run = await deps.ledger.load({ aggregateType: 'Run', projectId, goalId: goalId, runId: holder.holderRunId });
          if (run.status !== 'found' || run.snapshot.ref.aggregateType !== 'Run') throw Error('Claimed task run unavailable');
          const fact = run.snapshot as import('../../contracts/dispatch.js').RunSnapshot;
          if (fact.task.taskId !== task.taskId || fact.workspaceSnapshot.workspaceId !== workspaceId) throw Error('Task run scope mismatch');
          latestRun = { ref: fact.ref, revision: fact.revision, planRef: fact.planRef, status: fact.status, outcome: fact.outcome, exitCode: fact.exitCode,
            startedAt: fact.startedAt, endedAt: fact.endedAt, matchesCurrentPlan: canonicalJson(fact.planRef) === canonicalJson(acceptedPlan.ref) };
          dynamicFactVersions.push({ ref: holder.ref, revision: holder.revision }, { ref: fact.ref, revision: fact.revision });
        }
        collaborationWork.push({ taskId: task.taskId, assignment: assignments.find(a => a.taskId === task.taskId) ?? null,
          dependencies: acceptedPlan.executionDag.dependsOn.filter(edge => edge.taskId === task.taskId).map(edge => edge.dependsOnId),
          latestRun, reduction, reductionMatchesPlan: reduction !== null && canonicalJson(reduction.planRef) === canonicalJson(acceptedPlan.ref) && reduction.planRevision === acceptedPlan.planRevision });
        if (reduction) selectedSources.push({ kind: 'task-reduction', refKey: canonicalJson(ref), version: String(reduction.revision) });
      }
    }
    let architectureReviews: { status: 'ready'; observedCursor: import('../../contracts/command-event.js').CommitCursor | null; rows: import('../../contracts/fingerprint.js').JsonValue[] } | { status: 'unavailable'; reason: string } = { status: 'unavailable', reason: 'Architecture review read capability is not configured; absence cannot be inferred.' };
    if (deps.architectureReviews && !goalId) architectureReviews = { status: 'unavailable', reason: 'Architecture review observation requires an explicit Goal; project-wide absence cannot be inferred.' };
    // The reader is authorized by scope, not by the existence of a current Plan.
    // A recorded decision can remain observable without being currently applicable.
    if (goalId && deps.architectureReviews) {
      try {
        const view = await deps.architectureReviews({ projectId, workspaceId });
        const rows = view.rows.filter(row => row.review.reporterRunRef.goalId === goalId);
        if (rows.some(row => row.review.ref.projectId !== projectId || row.review.ref.workspaceId !== workspaceId)) throw Error('Architecture review scope mismatch');
        architectureReviews = { status: 'ready', observedCursor: view.observedCursor, rows: rows.map(row => {
          const { brief, proposal, review } = row;
          if (row.decisionFacts) {
            const { version, ...facts } = row.decisionFacts;
            if (canonicalJson(facts.scope) !== canonicalJson(scope) || canonicalJson(facts.ref) !== canonicalJson(review.ref)
              || facts.revision !== review.revision || facts.recordedAt !== review.recordedAt
              || canonicalJson(facts.acceptedProposal.decisionRef) !== canonicalJson(review.decisionRef)
              || sha256Hex(canonicalJson(facts)) !== version)
              throw Error('Architecture decision observation identity or version mismatch');
          }
          if (brief.projectId !== projectId || brief.workspaceId !== workspaceId ||
            review.briefRef.projectId !== projectId || review.briefRef.workspaceId !== workspaceId ||
            brief.briefId !== review.briefRef.briefId || brief.planRef.projectId !== projectId ||
            brief.baselinePin.ref.projectId !== projectId ||
            proposal.projectId !== projectId || proposal.workspaceId !== workspaceId ||
            review.proposalRef.projectId !== projectId || review.proposalRef.workspaceId !== workspaceId ||
            proposal.proposalId !== review.proposalRef.proposalId ||
            canonicalJson(brief.planRef) !== canonicalJson(proposal.planRef) ||
            (proposal.selectedBriefRef != null && canonicalJson(proposal.selectedBriefRef) !== canonicalJson(review.briefRef)))
            throw Error('Architecture conflict provenance mismatch');
          const conflict = { reportSummary: row.reportSummary, impact: brief.impact, briefRef: review.briefRef,
            planRef: brief.planRef, baselinePin: brief.baselinePin,
            matchesCurrentPlan: acceptedPlan !== null && canonicalJson(brief.planRef) === canonicalJson(acceptedPlan.ref),
            authority: 'Recorded original report reason and declared impact, not proof of implementation. A different Plan is historical explanation, not current acceptance.' };
          dynamicFactVersions.push({ ref: row.review.ref, revision: row.review.revision });
          return { ref: row.review.ref, revision: row.review.revision, status: row.review.status, proposalDigest: row.review.proposalDigest,
            proposalContent: row.review.proposalContent, summary: row.review.summary, decisionRef: row.review.decisionRef, conflict,
            ...(row.decisionFacts ? { decisionFacts: row.decisionFacts } : {}),
            targets: row.targets, allNotified: row.allNotified, allRequiredAttempted: row.allRequiredAttempted,
            authority: 'Human decision and delivery facts only; acceptance does not activate a baseline or prove implementation, migration or verification.' };
        }) };
      } catch { throw Error('Current architecture review facts unavailable; retry instead of assuming no decision.'); }
    }
    if (dynamicFactVersions.length) selectedSources.push({ kind: 'collaboration-facts', refKey: canonicalJson({ projectId, workspaceId, goalId: goalId }), version: sha256Hex(canonicalJson(dynamicFactVersions)) });
    // Cursor includes unrelated Query writes; only model-visible semantic facts
    // participate. Null task facts and the complete selected review set are kept.
    const semanticArchitecture = architectureReviews.status === 'ready' ? { status: 'ready', rows: architectureReviews.rows } : architectureReviews;
    const prerequisiteAcceptance = summarizeQueryPrerequisites(collaborationWork);
    const verificationStages = goalId && deps.verificationFacts ? await deps.verificationFacts(scope) : undefined;
    if (verificationStages && (canonicalJson(verificationStages.scope) !== canonicalJson(scope) || !/^[a-f0-9]{64}$/.test(verificationStages.version))) throw Error('Verification observation scope or version mismatch');
    if (verificationStages && [...verificationStages.rounds, ...verificationStages.reviews].some(record =>
      record.scope.projectId !== scope.projectId || record.scope.workspaceId !== scope.workspaceId || record.scope.goalId !== scope.goalId))
      throw Error('Verification child record scope mismatch');
    const humanActions = goalId && deps.humanActions ? await deps.humanActions(scope) : undefined;
    if (humanActions) {
      const { observedAt: _time, version, ...stable } = humanActions;
      if (canonicalJson(humanActions.scope) !== canonicalJson(scope) || sha256Hex(canonicalJson(stable)) !== version)
        throw Error('Human-action observation scope or version mismatch');
    }
    const architectureActivation = deps.architectureActivation ? await deps.architectureActivation({ projectId, workspaceId }) : undefined;
    if (architectureActivation) {
      const { observedAt: _time, version, ...stable } = architectureActivation;
      if (architectureActivation.scope.projectId !== projectId || sha256Hex(canonicalJson(stable)) !== version ||
          (architectureActivation.active && architectureActivation.active.ref.projectId !== projectId)) throw Error('Architecture activation scope or version mismatch');
      selectedSources.push({ kind: 'architecture-activation', refKey: canonicalJson(architectureActivation.scope), version });
    }
    const dynamicFactSet = { schemaVersion: 1 as const, digest: sha256Hex(canonicalJson({ goalPhase, collaborationWork, prerequisiteAcceptance, architectureReviews: semanticArchitecture, ...(architectureActivation ? { architectureActivationVersion: architectureActivation.version } : {}),
      ...(verificationStages ? { verificationVersion: verificationStages.version } : {}), ...(humanActions ? { humanActionsVersion: humanActions.version } : {}) })) };
    selectedSources.push({ kind: 'collaboration-fact-set', refKey: canonicalJson(scope), version: dynamicFactSet.digest });
    if (verificationStages) selectedSources.push({ kind: 'verification-stages', refKey: canonicalJson(scope), version: verificationStages.version });
    if (humanActions) selectedSources.push({ kind: 'human-actions', refKey: canonicalJson(scope), version: humanActions.version });
    return { goalPhase, collaborationWork, prerequisiteAcceptance, architectureReviews, architectureActivation, verificationStages, humanActions, dynamicFactVersions, dynamicFactSet, selectedSources };
}
