/**
 * S7: the minimal, mechanical impact marker of one request candidate.
 *
 * It compares the candidate draft with the Plan its `head.basedOn` names, marks
 * every changed/cancelled/superseded Task with both complete frozen
 * definitions, lists the Runs still doing those Tasks (with the Session they
 * entered, if any), and lists the evidence related by subject or by the old
 * acceptance coverage. It reads only existing relations: no model, no written
 * record, no new index and no applicability verdict.
 */
import type { ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../../contracts/plan.js';
import { revisionAssignments } from '../../../contracts/plan.js';
import type { EvidenceSnapshot } from '../../../contracts/evidence.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import { decodeEvidenceSnapshot, decodeTaskEvidenceIndexSnapshot } from '../persistence/evidence-record-codecs.js';
import type { PlanImpactMarkV1, RequestCandidateImpactV1 } from '../model/plan-contracts.js';
import { readBatch, readDispositionChangeTaskFacts } from './plan-readers.js';
import { buildFrozenTaskDefinitions } from './plan-task-basis.js';
import { deriveFuturePlanDelta } from './plan-validation.js';

type ImpactRecords = GoalRecordTransactionPort & RecordLookupPort;
type ImpactEvidence = { evidenceId: string; obligationId: string; requirementId: string };

const evidenceIndexKey = (projectId: string, goalId: string, taskId: string): string =>
  canonicalJson({ aggregateType: 'TaskEvidenceIndex', projectId, goalId, taskId } as unknown as JsonValue);

const evidenceKey = (projectId: string, evidenceId: string): string =>
  canonicalJson({ aggregateType: 'Evidence', projectId, evidenceId } as unknown as JsonValue);

/**
 * The union of (a) evidence ABOUT each marked Task (all of its coverage) and
 * (b) evidence whose coverage names an obligation/requirement the marked Task
 * carried, read from the index of every carrier of those obligations. Every
 * index and every Evidence body is read once for all marks; an absent index is a
 * legal empty and triples are deduplicated with no outcome/applicability filter.
 */
async function readTaskImpactEvidence(
  records: ImpactRecords, projectId: string, goalId: string, source: PlanRevisionSnapshot, taskIds: readonly string[],
): Promise<ReadResult<Map<string, ImpactEvidence[]>>> {
  const coverageKeys = new Map<string, Set<string>>();
  const carriers = new Map<string, Set<string>>();
  const indexTasks = new Set<string>();
  for (const taskId of taskIds) {
    const keys = new Set<string>();
    const carrierSet = new Set<string>();
    for (const obligation of source.obligations) {
      if (!obligation.taskIds.includes(taskId)) continue;
      for (const requirement of obligation.verificationRequirements) {
        keys.add(`${obligation.obligationId}\u0000${requirement.requirementId}`);
      }
      for (const carrier of obligation.taskIds) carrierSet.add(carrier);
    }
    coverageKeys.set(taskId, keys);
    carriers.set(taskId, carrierSet);
    indexTasks.add(taskId);
    for (const carrier of carrierSet) indexTasks.add(carrier);
  }
  // One batch read for every marked Task's own index and every carrier index.
  const indexKeys = [...indexTasks].map((taskId) => evidenceIndexKey(projectId, goalId, taskId));
  const indexRead = await readBatch(records, indexKeys);
  if (indexRead.status !== 'ready') return indexRead;
  const evidenceIdsOf = new Map<string, readonly string[]>();
  for (const taskId of indexTasks) {
    const key = evidenceIndexKey(projectId, goalId, taskId);
    const record = indexRead.batch.present.get(key);
    if (record === undefined) {
      if (indexRead.batch.missing.has(key)) { evidenceIdsOf.set(taskId, []); continue; }
      return rejected('unavailable', `the TaskEvidenceIndex of ${taskId} was neither returned nor reported missing`);
    }
    const decoded = decodeTaskEvidenceIndexSnapshot(record);
    if (decoded.status !== 'decoded') {
      return rejected('unavailable', `the TaskEvidenceIndex of ${taskId} is damaged: ${decoded.reason}`);
    }
    evidenceIdsOf.set(taskId, decoded.value.evidenceIds);
  }
  // One batch read for every Evidence body any mark can list.
  const allEvidenceIds = [...new Set([...evidenceIdsOf.values()].flat())];
  const evidenceRead = allEvidenceIds.length === 0 ? null : await readBatch(records,
    allEvidenceIds.map((evidenceId) => evidenceKey(projectId, evidenceId)));
  if (evidenceRead !== null && evidenceRead.status !== 'ready') return evidenceRead;
  const evidenceOf = new Map<string, EvidenceSnapshot>();
  if (evidenceRead !== null) {
    for (const evidenceId of allEvidenceIds) {
      const key = evidenceKey(projectId, evidenceId);
      const record = evidenceRead.batch.present.get(key);
      if (record === undefined) {
        return rejected('unavailable', `Evidence ${evidenceId} was neither returned nor reported missing`);
      }
      const decoded = decodeEvidenceSnapshot(record);
      if (decoded.status !== 'decoded') {
        return rejected('unavailable', `Evidence ${evidenceId} is damaged: ${decoded.reason}`);
      }
      evidenceOf.set(evidenceId, decoded.value);
    }
  }
  const out = new Map<string, ImpactEvidence[]>();
  for (const taskId of taskIds) {
    const subjectIds = new Set(evidenceIdsOf.get(taskId) ?? []);
    const evidenceIds = [...new Set([...subjectIds, ...[...carriers.get(taskId)!].sort()
      .flatMap((carrier) => evidenceIdsOf.get(carrier) ?? [])])];
    const keys = coverageKeys.get(taskId)!;
    const rows: ImpactEvidence[] = [];
    const seen = new Set<string>();
    for (const evidenceId of evidenceIds) {
      const evidence = evidenceOf.get(evidenceId);
      if (evidence === undefined) continue;
      const all = subjectIds.has(evidenceId);
      for (const coverage of evidence.evidence.coverage) {
        if (!all && !keys.has(`${coverage.obligationId}\u0000${coverage.requirementId}`)) continue;
        const triple = `${evidenceId}\u0000${coverage.obligationId}\u0000${coverage.requirementId}`;
        if (seen.has(triple)) continue;
        seen.add(triple);
        rows.push({ evidenceId, obligationId: coverage.obligationId, requirementId: coverage.requirementId });
      }
    }
    out.set(taskId, rows);
  }
  return { status: 'ready', value: out };
}

/** The candidate's mechanical impact against the Plan its `basedOn` names. */
export async function readPlanImpact(
  records: ImpactRecords,
  goalRef: GoalRef,
  source: PlanRevisionSnapshot,
  draft: PlanRevisionDraft,
): Promise<ReadResult<RequestCandidateImpactV1>> {
  const deltaResult = deriveFuturePlanDelta(source, draft);
  if (deltaResult.status !== 'supported') return rejected('unsupported', deltaResult.reason);
  const delta = deltaResult.delta;
  const sourceDefinitions = buildFrozenTaskDefinitions({ tasks: source.tasks, assignments: revisionAssignments(source),
    inputRequirements: source.inputRequirements ?? [], obligations: source.obligations });
  const targetDefinitions = buildFrozenTaskDefinitions({ tasks: draft.tasks, assignments: revisionAssignments(draft),
    inputRequirements: draft.inputRequirements ?? [], obligations: draft.obligations });
  // One mark per Task: a disposition change wins over a definition change, and a supersession wins over a cancel.
  const changes = new Map<string, PlanImpactMarkV1['change']>();
  for (const taskId of delta.changedTaskIds) changes.set(taskId, 'changed');
  for (const change of delta.dispositionChanges) {
    if (change.to === 'cancelled') changes.set(change.taskId, 'cancelled');
    if (change.to === 'superseded') changes.set(change.taskId, 'superseded');
  }
  const taskIds = [...changes.keys()].sort();
  if (taskIds.length === 0) return { status: 'ready', value: { marks: [] } };
  const facts = await readDispositionChangeTaskFacts(records, goalRef, source, taskIds);
  if (facts.status !== 'ready') return facts;
  const evidence = await readTaskImpactEvidence(records, goalRef.projectId, goalRef.goalId, source, taskIds);
  if (evidence.status !== 'ready') return evidence;
  const factsById = new Map(facts.tasks.map((entry) => [entry.facts.taskId, entry.facts]));
  const marks: PlanImpactMarkV1[] = [];
  for (const taskId of taskIds) {
    // `removedTaskProblem` already refused a physically removed Task, so both definitions always exist.
    const before = sourceDefinitions.get(taskId)!;
    const after = targetDefinitions.get(taskId)!;
    const taskFacts = factsById.get(taskId);
    if (taskFacts === undefined) return rejected('unavailable', `the disposition facts of task ${taskId} were not read`);
    marks.push({
      taskId,
      change: changes.get(taskId) ?? 'changed',
      note: '有变化，要复查',
      before,
      after,
      lines: taskFacts.runs
        .filter((run) => run.status === 'starting' || run.status === 'running')
        .map((run) => ({ runRef: run.ref, sessionRef: run.executionHistory?.sessionRef ?? null })),
      evidence: evidence.value.get(taskId) ?? [],
    });
  }
  return { status: 'ready', value: { marks } };
}
