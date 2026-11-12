/**
 * `verification/round` (§1–§2): one formal round's checks, its subject chain
 * and the adopted Plan's delivery/acceptance projection. Read only: it opens
 * no report body, writes nothing and re-judges no outcome.
 *
 * Three stored reads at most: the anchor (the round, the Goal or the subject
 * Run), the anchored Plan, and one `readSubjectChain`. Everything else is
 * assembled in memory from the records those reads returned. The chain rules,
 * the 32-row limit and the display status are the state owner's, never a
 * second copy.
 */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { RunRef, RunSnapshot, TaskTriple } from '../../../contracts/dispatch.js';
import type { EvidenceCoverageV1, EvidenceOutcome, EvidenceSnapshot } from '../../../contracts/evidence.js';
import { canonicalOf, sameJson } from '../../../contracts/fingerprint.js';
import type { PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask } from '../../../contracts/plan.js';
import type {
  CheckHostActor, RoundCheckIncompleteCause, RoundCheckSnapshot, RoundReverifyFactV1, RoundSnapshot,
  VerificationRoundRef,
} from '../../../contracts/verification.js';
import { reviewPacketItemOf } from '../../../contracts/verification.js';
import { isRecord } from '../../../contracts/validation/common.js';
import type { EvidencePort } from '../model/evidence-contracts.js';
import { decodeRun } from '../persistence/run-record-codecs.js';
import { decodeEvidenceSnapshot } from '../persistence/evidence-record-codecs.js';
import { runRefProblem, taskTripleProblem } from '../persistence/rework-codecs.js';
import { displayRoundStatus, type RoundDisplayStatus } from '../state/verification-machine.js';
import { readBatch, readGoal, readPlan } from '../tasks/plan-readers.js';
import { readSubjectChain, type Records } from '../evidence/evidence-service.js';

export type VerificationRoundReadInputV1 = {
  roundRef?: VerificationRoundRef;
  taskRef?: TaskTriple;
  subjectRunRef?: RunRef;
};

export type VerificationRoundCheckReadV1 = {
  checkId: string;
  phase: 'pending' | 'executing' | 'finished' | 'interrupted';
  outcome: EvidenceOutcome | null;
  /** Legacy checks without the field read as null. */
  incompleteCause: RoundCheckIncompleteCause | null;
  reportRef: ArtifactRef | null;
  command: string;
  /** The first matching gap message, or null; the report body is not opened. */
  reason: string | null;
};

export type VerificationRoundDeliveryObligationV1 = {
  obligationId: string;
  title: string;
  requirementLevel: string;
  taskIds: string[];
  appliesToSelectedTask: boolean;
};

export type VerificationRequirementState = 'pass' | 'fail' | 'inconclusive' | 'pending' | 'missing';

export type VerificationRoundDeliveryRequirementV1 = {
  obligationId: string;
  obligationTitle: string;
  requirementId: string;
  requirementLevel: string;
  kind: string;
  description: string;
  state: VerificationRequirementState;
  checks: {
    roundOrdinal: number;
    roundRef: VerificationRoundRef;
    checkId: string;
    outcome: EvidenceOutcome | null;
    incompleteCause: RoundCheckIncompleteCause | null;
    reportRef: ArtifactRef | null;
    executor: CheckHostActor;
    command: string;
  }[];
};

export type VerificationRoundReadV1 = {
  roundRef: VerificationRoundRef;
  revision: number;
  taskRef: TaskTriple;
  subject: TaskTriple;
  subjectRunRef: RunRef;
  taskKind: 'work' | 'gate';
  planRef: PlanRevisionRef;
  status: 'open' | 'finalized';
  displayStatus: RoundDisplayStatus;
  outcome: EvidenceOutcome | null;
  executor: CheckHostActor;
  checks: VerificationRoundCheckReadV1[];
  failingCheckIds: string[];
  gaps: { code: string; message: string; coverage?: EvidenceCoverageV1 }[];
  chain: {
    ordinal: number;
    roundRef: VerificationRoundRef;
    predecessorRoundRef: VerificationRoundRef | null;
    length: number;
    isHead: boolean;
    autoCount: number;
    reverify: RoundReverifyFactV1 | null;
    rounds: {
      ordinal: number;
      roundRef: VerificationRoundRef;
      revision: number;
      status: 'open' | 'finalized';
      displayStatus: string;
      outcome: EvidenceOutcome | null;
      counts: {
        total: number; pass: number; fail: number; inconclusive: number;
        pending: number; executing: number; interrupted: number;
      };
      failingCheckIds: string[];
    }[];
  };
  delivery: {
    planRef: PlanRevisionRef;
    taskRef: TaskTriple;
    taskKind: 'work' | 'gate';
    obligations: VerificationRoundDeliveryObligationV1[];
    requirements: VerificationRoundDeliveryRequirementV1[];
    summary: {
      obligations: number; requirements: number; pass: number; fail: number;
      inconclusive: number; pending: number; missing: number; rounds: number;
    };
  };
};

export interface VerificationRoundReadPort {
  readVerificationRound(ctx: CoreCallContext, input: VerificationRoundReadInputV1):
    Promise<ReadResult<VerificationRoundReadV1>>;
}

export type VerificationRoundReadDependencies = {
  records: Records;
  evidence: Pick<EvidencePort, 'readVerification'>;
};

const EXACTLY_ONE = 'the round read requires exactly one of roundRef, taskRef or subjectRunRef';

/** The route's shape/mutex rules in the order §1 lists them; every reason is the frozen one. */
function parseInput(raw: unknown): { ok: true; input: VerificationRoundReadInputV1 } | { ok: false; rejection: CoreRejection } {
  if (!isRecord(raw)) return { ok: false, rejection: rejected('invalid', 'the round read requires an object') };
  const roundRef = raw['roundRef'];
  const taskRef = raw['taskRef'];
  const subjectRunRef = raw['subjectRunRef'];
  if (roundRef !== undefined) {
    if (taskRef !== undefined || subjectRunRef !== undefined) {
      return { ok: false, rejection: rejected('invalid', EXACTLY_ONE) };
    }
    return { ok: true, input: { roundRef: roundRef as VerificationRoundRef } };
  }
  if (taskRef !== undefined) {
    const problem = taskTripleProblem(taskRef, 'the subject');
    if (problem !== null) return { ok: false, rejection: rejected('invalid', problem) };
    if (subjectRunRef !== undefined) {
      const runProblem = runRefProblem(subjectRunRef, 'subjectRunRef');
      if (runProblem !== null) return { ok: false, rejection: rejected('invalid', runProblem) };
      return { ok: true, input: { taskRef: taskRef as TaskTriple, subjectRunRef: subjectRunRef as RunRef } };
    }
    return { ok: true, input: { taskRef: taskRef as TaskTriple } };
  }
  if (subjectRunRef !== undefined) {
    const problem = runRefProblem(subjectRunRef, 'subjectRunRef');
    if (problem !== null) return { ok: false, rejection: rejected('invalid', problem) };
    return { ok: true, input: { subjectRunRef: subjectRunRef as RunRef } };
  }
  return { ok: false, rejection: rejected('invalid', EXACTLY_ONE) };
}

/** One Run read (the "only subjectRunRef" anchor); a missing row is not_found, damage is unavailable. */
async function readSubjectRun(records: Records, ref: RunRef): Promise<ReadResult<RunSnapshot>> {
  const key = canonicalOf(ref);
  if (key === null) return rejected('invalid', 'subjectRunRef must be a complete RunRef');
  const read = await readBatch(records, [key]);
  if (read.status !== 'ready') return read;
  const record = read.batch.present.get(key);
  if (record === undefined) return { status: 'not_found' };
  const decoded = decodeRun(record);
  if (!decoded.ok) return rejected('unavailable', `the subject Run is damaged: ${decoded.reason}`);
  return { status: 'ready', value: decoded.value };
}

/** The first gap whose coverage names one of the check's requirement pairs; no match is null. */
function checkReasonOf(round: RoundSnapshot, check: RoundCheckSnapshot): string | null {
  const gap = round.gaps.find((candidate) => candidate.coverage !== undefined
    && check.coverage.some((coverage) => sameJson(coverage, candidate.coverage)));
  return gap === undefined ? null : gap.message;
}

function checksOf(round: RoundSnapshot): VerificationRoundCheckReadV1[] {
  // `RoundSnapshot.checks` is built in `verificationPlan.checks` order
  // (`pendingRoundChecks`), so it is already the plan's full order; no sort.
  return round.checks.map((check) => ({
    checkId: check.checkId,
    phase: check.phase,
    outcome: check.outcome,
    incompleteCause: check.incompleteCause ?? null,
    reportRef: check.reportRef,
    command: check.definition.command,
    reason: checkReasonOf(round, check),
  }));
}

function failingCheckIdsOf(round: RoundSnapshot): string[] {
  return round.checks.filter((check) => check.outcome === 'FAIL').map((check) => check.checkId);
}

function roundCountsOf(round: RoundSnapshot): {
  total: number; pass: number; fail: number; inconclusive: number;
  pending: number; executing: number; interrupted: number;
} {
  const counts = { total: round.checks.length, pass: 0, fail: 0, inconclusive: 0, pending: 0, executing: 0, interrupted: 0 };
  for (const check of round.checks) {
    if (check.outcome === 'PASS') counts.pass += 1;
    else if (check.outcome === 'FAIL') counts.fail += 1;
    else if (check.outcome === 'INCONCLUSIVE') counts.inconclusive += 1;
    if (check.phase === 'pending') counts.pending += 1;
    else if (check.phase === 'executing') counts.executing += 1;
    else if (check.phase === 'interrupted') counts.interrupted += 1;
  }
  return counts;
}

function chainRoundOf(round: RoundSnapshot): VerificationRoundReadV1['chain']['rounds'][number] {
  return {
    ordinal: round.chain.ordinal,
    roundRef: round.ref,
    revision: round.revision,
    status: round.status,
    displayStatus: displayRoundStatus(round),
    outcome: round.outcome,
    counts: roundCountsOf(round),
    failingCheckIds: failingCheckIdsOf(round),
  };
}

/** §2: FAIL beats a gap; then INCONCLUSIVE; then anything still running; then PASS; otherwise missing. */
function requirementStateOf(checks: readonly RoundCheckSnapshot[]): VerificationRequirementState {
  if (checks.some((check) => check.outcome === 'FAIL')) return 'fail';
  if (checks.some((check) => check.outcome === 'INCONCLUSIVE')) return 'inconclusive';
  if (checks.some((check) => check.phase === 'pending' || check.phase === 'executing')) return 'pending';
  if (checks.some((check) => check.outcome === 'PASS')) return 'pass';
  return 'missing';
}

/**
 * Slice 9 (lead ruling s9g2 #6): a requirement the round's `review-packet` item covers is answered by the booked
 * review, not by a check: open → pending; finalized → the review Evidence's outcome (FAIL beats a gap on the pair),
 * none booked → missing.
 */
function reviewStateOf(round: RoundSnapshot, coverage: EvidenceCoverageV1, reviews: readonly EvidenceSnapshot[]):
VerificationRequirementState {
  if (round.status === 'open') return 'pending';
  const review = reviews.find((snapshot) => snapshot.evidence.coverage.some((entry) => sameJson(entry, coverage)));
  if (review === undefined) return 'missing';
  if (review.evidence.outcome === 'FAIL') return 'fail';
  const gap = round.gaps.some((entry) => entry.coverage !== undefined && sameJson(entry.coverage, coverage));
  return review.evidence.outcome === 'INCONCLUSIVE' || gap ? 'inconclusive' : 'pass';
}

/** The finalized round's booked review Evidence (its refs whose Evidence names no check); none for an open round. */
async function readRoundReviews(records: Records, round: RoundSnapshot):
Promise<{ ok: true; reviews: EvidenceSnapshot[] } | { ok: false; rejection: CoreRejection }> {
  if (round.status === 'open' || reviewPacketItemOf(round.verificationPlan) === undefined) {
    return { ok: true, reviews: [] };
  }
  const keys = round.evidenceRefs.map((ref) => canonicalOf(ref)).filter((key): key is string => key !== null);
  const read = await readBatch(records, keys);
  if (read.status !== 'ready') return { ok: false, rejection: rejected('unavailable', 'the round Evidence could not be read') };
  const reviews: EvidenceSnapshot[] = [];
  for (const key of keys) {
    const record = read.batch.present.get(key);
    const decoded = record === undefined ? null : decodeEvidenceSnapshot(record);
    if (decoded === null || decoded.status !== 'decoded') return { ok: false, rejection: rejected('unavailable', 'a round Evidence is missing or damaged') };
    if (decoded.value.evidence.source.checkId === null) reviews.push(decoded.value);
  }
  return { ok: true, reviews };
}

function deliveryOf(plan: PlanRevisionSnapshot, subject: TaskTriple, taskKind: 'work' | 'gate', round: RoundSnapshot,
  reviews: readonly EvidenceSnapshot[]): VerificationRoundReadV1['delivery'] {
  const reviewItem = reviewPacketItemOf(round.verificationPlan);
  // Slice 9: a round belongs to one Task (`compileVerificationPlan` keeps its Task's obligations), so only those
  // have requirements here; every other obligation stays listed with `appliesToSelectedTask: false`.
  const applicable = plan.obligations.filter((obligation) => obligation.taskIds.includes(subject.taskId));
  const obligations = plan.obligations.map((obligation) => ({
    obligationId: obligation.obligationId,
    title: obligation.title,
    requirementLevel: obligation.requirementLevel,
    taskIds: [...obligation.taskIds],
    appliesToSelectedTask: applicable.includes(obligation),
  }));
  const requirements = applicable.flatMap((obligation) =>
    obligation.verificationRequirements.map((requirement) => {
      const coverage = { obligationId: obligation.obligationId, requirementId: requirement.requirementId };
      const covering = round.checks.filter((check) => check.coverage.some((entry) => sameJson(entry, coverage)));
      return {
        obligationId: obligation.obligationId,
        obligationTitle: obligation.title,
        requirementId: requirement.requirementId,
        requirementLevel: requirement.requirementLevel,
        kind: requirement.kind,
        description: requirement.description,
        state: reviewItem !== undefined && reviewItem.coverage.some((entry) => sameJson(entry, coverage))
          ? reviewStateOf(round, coverage, reviews) : requirementStateOf(covering),
        checks: covering.map((check) => ({
          roundOrdinal: round.chain.ordinal,
          roundRef: round.ref,
          checkId: check.checkId,
          outcome: check.outcome,
          incompleteCause: check.incompleteCause ?? null,
          reportRef: check.reportRef,
          executor: round.executor,
          command: check.definition.command,
        })),
      };
    }));
  const summary = { obligations: applicable.length, requirements: requirements.length, pass: 0, fail: 0,
    inconclusive: 0, pending: 0, missing: 0, rounds: 0 };
  for (const requirement of requirements) summary[requirement.state] += 1;
  return { planRef: plan.ref, taskRef: subject, taskKind, obligations, requirements, summary };
}

export function createVerificationRoundRead(deps: VerificationRoundReadDependencies): VerificationRoundReadPort {
  return {
    async readVerificationRound(ctx, raw) {
      const shape = parseInput(raw);
      if (!shape.ok) return shape.rejection;
      const scope = ctx.workspaceId === undefined || ctx.workspaceId.length === 0
        ? null : { projectId: ctx.projectId, workspaceId: ctx.workspaceId };
      if (scope === null) return rejected('forbidden', 'the verification round read requires a bound project/workspace context');
      const input = shape.input;

      // ① The anchor: the exact round, the subject Run, or (a gate chain) the Goal.
      let round: RoundSnapshot | null = null;
      let subject: TaskTriple;
      let runRef: RunRef | null = null;
      let planRef: PlanRevisionRef;
      if (input.roundRef !== undefined) {
        const read = await deps.evidence.readVerification(ctx, input.roundRef);
        if (read.status !== 'ready') return read;                       // exact read carries its own scope/errors
        round = read.value;
        subject = round.subject;
        runRef = round.subjectRunRef;
        planRef = round.adoptedPlanRef;
      } else if (input.subjectRunRef !== undefined) {
        if (input.subjectRunRef.projectId !== scope.projectId) {
          return rejected('forbidden', 'the subject Run is outside the trusted Host scope');
        }
        const run = await readSubjectRun(deps.records, input.subjectRunRef);
        if (run.status !== 'ready') return run;
        if (run.value.ref.projectId !== scope.projectId
            || run.value.workspaceSnapshot.workspaceId !== scope.workspaceId) {
          return rejected('forbidden', 'the subject Run is outside the trusted Host scope');
        }
        if (input.taskRef !== undefined && !sameJson(run.value.task, input.taskRef)) {
          return rejected('invalid', 'the subject Run does not belong to the requested Task');
        }
        subject = run.value.task;
        runRef = run.value.ref;
        planRef = run.value.planRef;
      } else {
        // `parseInput` guarantees exactly one shape, so this arm always names `taskRef`.
        if (input.taskRef!.projectId !== scope.projectId) {
          return rejected('forbidden', 'the task is outside the trusted Host scope');
        }
        const goal = await readGoal(deps.records, { aggregateType: 'Goal', projectId: scope.projectId,
          goalId: input.taskRef!.goalId });
        if (goal.status !== 'ready') return goal.code === 'not_found' ? { status: 'not_found' } : goal;
        if (goal.goal.workspaceRef.projectId !== scope.projectId
            || goal.goal.workspaceRef.workspaceId !== scope.workspaceId) {
          return rejected('forbidden', 'the task is outside the trusted Host scope');
        }
        if (goal.goal.activePlanRevision === null) return { status: 'not_found' };
        subject = input.taskRef!;
        planRef = goal.goal.activePlanRevision;
      }

      // ② The anchored Plan: taskKind and the delivery obligations.
      if (planRef.projectId !== scope.projectId) {
        return rejected('forbidden', 'the adopted Plan is outside the trusted Host scope');
      }
      const planRead = await readPlan(deps.records, planRef);
      if (planRead.status !== 'ready') {
        return rejected('unavailable', `the accepted Plan ${planRef.planId} could not be read: ${planRead.reason}`);
      }
      const plan = planRead.plan;
      if (plan.goalRef.goalId !== subject.goalId) {
        return rejected('forbidden', 'the adopted Plan is outside the trusted Host scope');
      }
      const planTask: RuntimeTask | undefined = plan.tasks.find((task) => task.taskId === subject.taskId);
      if (planTask === undefined) return rejected('unavailable', 'the subject Task is not in its adopted Plan');
      const taskKind = planTask.taskKind;
      if (input.taskRef !== undefined && input.subjectRunRef === undefined && taskKind !== 'gate') {
        return rejected('invalid', 'a work chain requires subjectRunRef');
      }

      // ③ One chain read: work chains by the subject Run, gate chains by the Task.
      const chainRead = await readSubjectChain(deps.records, scope, subject, taskKind === 'gate' ? null : runRef);
      if (!chainRead.ok) return chainRead.rejection;
      const chain = chainRead.chain;
      if (chain.kind === 'none') return { status: 'not_found' };
      if (chain.kind === 'invalid') {
        return rejected('incomplete', `the verification round chain is invalid (${chain.reason}); refusing to guess its head`);
      }
      const selected = round ?? chain.head;
      if (round !== null && !chain.chain.some((candidate) => candidate.ref.roundId === round!.ref.roundId)) {
        return rejected('unavailable', 'the requested round is not in its indexed chain');
      }

      const reviews = await readRoundReviews(deps.records, selected);
      if (!reviews.ok) return reviews.rejection;
      const delivery = deliveryOf(plan, subject, taskKind, selected, reviews.reviews);
      return { status: 'ready', value: {
        roundRef: selected.ref,
        revision: selected.revision,
        taskRef: subject,
        subject,
        subjectRunRef: selected.subjectRunRef,
        taskKind,
        planRef,
        status: selected.status,
        displayStatus: displayRoundStatus(selected),
        outcome: selected.outcome,
        executor: selected.executor,
        checks: checksOf(selected),
        failingCheckIds: failingCheckIdsOf(selected),
        gaps: selected.gaps,
        chain: {
          ordinal: selected.chain.ordinal,
          roundRef: selected.ref,
          predecessorRoundRef: selected.chain.predecessorRoundRef,
          length: chain.chain.length,
          isHead: selected.ref.roundId === chain.head.ref.roundId,
          autoCount: selected.chain.autoCount,
          reverify: selected.chain.reverify,
          rounds: chain.chain.map(chainRoundOf),
        },
        delivery: { ...delivery, summary: { ...delivery.summary, rounds: chain.chain.length } },
      } };
    },
  };
}
