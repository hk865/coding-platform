/**
 * ORCHESTRATION §9/A11 no-progress keys (docs/refactor/STATE-MACHINES-SPEC.md
 * §13.1, §13.7; §9 "失败事实").
 *
 * Pure key builders shared by the two rework owners:
 *  - `noProgressKey`: the requeue key stored on `TaskRequeue.basis` and compared
 *    by the TASK-16/17/27 guard against every earlier TaskRequeue of the Task;
 *  - `reverifyBasis`: the successor-round key compared by VR-14 against the
 *    chain's earlier `basisDigests`; the two key spaces are never compared;
 *  - `roundFailureFacts`: the non-PASS checks and gap codes of one round, used
 *    by both keys (without `reportRef`), the failure-facts read model and the
 *    continuation brief.
 *
 * The keys hold only facts that are comparable across rounds and Runs (ND-1):
 * no ids, report digests, times, `reason`, actor or actor class, requested
 * budget, trigger or automatic count. The owner does every read: the source
 * stamp comes from its own capture (ND-2, LA-5), the basis Plan from
 * `buildEffectiveTaskBasis` (L-4) and `newInputRefs` are already verified by
 * `newBasisInputProblem` (ND-9). There is no record or effect here: the
 * comparison itself is a guard of `task-machine.ts` / `verification-machine.ts`.
 */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { RunOutcome, RunSnapshot, TaskTriple } from '../../../contracts/dispatch.js';
import type { ArchitectureBaselinePin, CompletionPolicyPin } from '../../../contracts/governance.js';
import type {
  NewBasisInputRefV1, NoProgressCheckFactV1, NoProgressKeyV1, RunFailureOrigin, SourceStampV1,
} from '../../../contracts/no-progress.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { FailingCheckFactV1 } from '../../../contracts/task-failure.js';
import type { ReverifyBasisV1, RoundSnapshot } from '../../../contracts/verification.js';
import { accept, reject, unreachable, type Transition } from './transition.js';

// ------------------------------------------------------------------------ //
// Inputs                                                                    //
// ------------------------------------------------------------------------ //
/** The failure facts of one round: every non-PASS check with its report, and the gap codes. */
export type RoundFailureFactsV1 = {
  /** Sorted by checkId; includes `interrupted` and not-run checks (`outcome: null`). */
  checks: FailingCheckFactV1[];
  /** Sorted, without duplicates. */
  gapCodes: string[];
};
/**
 * What `buildEffectiveTaskBasis(activePlan).get(taskId)` returns
 * (`tasks/plan-task-basis.ts:89-103`); the owner passes it through unchanged.
 * Anything but a PlanRevisionRef is an unresolvable basis (`incomplete`).
 */
export type TaskBasisLookupV1 = PlanRevisionRef | { status: 'unsupported'; reason: string } | undefined;
/** The round fields both keys read; legacy rounds without a chain qualify. */
export type KeyRoundV1 = Pick<RoundSnapshot, 'ref' | 'status' | 'checks' | 'gaps'>;
/** §13.1 inputs, read by `tasks/requeue-service.ts` in one fact window. */
export type NoProgressKeyInputV1 = {
  taskRef: TaskTriple;
  /** The selected Run the requeue covers. */
  afterRun: Pick<RunSnapshot, 'ref' | 'status' | 'outcome' | 'budget' | 'reconciliation'>;
  /** The afterRun round-chain head (C5, §9 VD-14); null without a round. */
  head: KeyRoundV1 | null;
  /** Digest-only capture of the whole workspace taken at requeue time (ND-2, ND-4, LA-5). */
  source: SourceStampV1;
  /** The Task's effective basis Plan (L-4), not `Goal.activePlanRevision`. */
  basisPlan: TaskBasisLookupV1;
  /** Verified new inputs, including a stored human `note`; order and repeats do not matter. */
  newInputRefs: readonly NewBasisInputRefV1[];
};
/** §13.7 point 1 inputs, read by `evidence-service.ts` `reverifyRound` after its full capture. */
export type ReverifyBasisInputV1 = {
  subject: TaskTriple;
  /** work: the selected Run; gate: the anchored producer Run (§9 VD-15). */
  subjectRunId: string;
  /** The chain head being reverified. */
  predecessor: KeyRoundV1;
  /** The full capture that also opens the successor round (LA-5). */
  source: SourceStampV1;
  /** The configuration the successor will freeze (C5 "冻结的检查配置"). */
  configuration: { configurationRevision: string; configurationDigest: string };
  basisPlan: TaskBasisLookupV1;
  completionPolicyPin: CompletionPolicyPin;
  architectureBaselinePin: ArchitectureBaselinePin;
  newInputRefs: readonly NewBasisInputRefV1[];
};

/** The key builders answer in the shared machine shape: `next` is the key, `effects` is always `[]`. */
export type NoProgressKeyResult = Transition<NoProgressKeyV1, NoProgressKeyInputV1, never>;
export type ReverifyBasisResult = Transition<ReverifyBasisV1, ReverifyBasisInputV1, never>;

// ------------------------------------------------------------------------ //
// Failure facts                                                             //
// ------------------------------------------------------------------------ //
/**
 * Every check whose outcome is not PASS (FAIL, INCONCLUSIVE, and `null` for an
 * interrupted, pending or executing check), sorted by checkId, plus the sorted
 * distinct gap codes. A legacy check without `incompleteCause` reads `cause: null`.
 */
export function roundFailureFacts(round: Pick<RoundSnapshot, 'checks' | 'gaps'>): RoundFailureFactsV1 {
  const checks: FailingCheckFactV1[] = round.checks
    .filter((check) => check.outcome !== 'PASS')
    .map((check) => ({
      checkId: check.checkId,
      phase: check.phase,
      outcome: check.outcome,
      cause: check.incompleteCause ?? null,
      reportRef: check.reportRef,
    }));
  checks.sort(compareCheckFacts);
  return { checks, gapCodes: sortedDistinct(round.gaps.map((gap) => gap.code)) };
}

/** The key form of failing checks: `reportRef` removed (ND-1), sorted by checkId. */
export function keyCheckFacts(checks: readonly FailingCheckFactV1[]): NoProgressCheckFactV1[] {
  const facts = checks.map((check) => ({
    checkId: check.checkId, phase: check.phase, outcome: check.outcome, cause: check.cause,
  }));
  facts.sort(compareCheckFacts);
  return facts;
}

/**
 * ND-5: where the afterRun's known outcome came from. A clean Host-restart
 * interruption that ended `crashed` (RUN-19, and RUN-24 paused-interrupted) is
 * `host_interrupted`; an operator attestation (RUN-22) is `human_attested`;
 * everything else is `observed`, including the RUN-23 reconcile-time cancel
 * (`interrupted_clean` with outcome `cancelled`) and a not-entered cancel.
 */
export function runFailureOrigin(run: Pick<RunSnapshot, 'outcome' | 'reconciliation'>): RunFailureOrigin {
  const observation = run.reconciliation?.observation;
  if (observation === undefined) return 'observed';
  switch (observation.kind) {
    case 'interrupted_clean':
      return run.outcome === 'crashed' ? 'host_interrupted' : 'observed';
    case 'human_attested':
      return 'human_attested';
    case 'runtime_terminal':
    case 'unresolved':
    case 'not_entered':
      return 'observed';
    default:
      return unreachable(observation, 'reconciliation observation');
  }
}

/**
 * §13.1 / §13.7 `newInputDigest`: sha256 over the verified inputs as a canonical
 * set; null without inputs. Each ref is reduced to its identity (`KeyInputRefV1`),
 * then duplicates are dropped and the rest sorted by canonical text, so request
 * order, a repeated ref, an extra runtime member or another `source` on an
 * Artifact already used never make it read as new (hard limit 2, §13.4 #20,
 * #22). The spec's "按序 canonical" is read as this canonical order, not
 * request order.
 */
export function newBasisInputDigest(refs: readonly NewBasisInputRefV1[]): string | null {
  if (refs.length === 0) return null;
  const byText = new Map<string, KeyInputRefV1>();
  for (const ref of refs) {
    const declared = keyInputRef(ref);
    byText.set(canonicalText(declared), declared);
  }
  const inputs = [...byText.entries()].sort(([left], [right]) => compareText(left, right)).map(([, ref]) => ref);
  return digestOf(inputs);
}

// ------------------------------------------------------------------------ //
// Keys                                                                      //
// ------------------------------------------------------------------------ //
/**
 * §13.1 `NoProgressKeyV1`. The owner has already rejected every
 * `runUnresolvedBlocker` case, an invalid chain and a non-active Task in the
 * §13.2 step 3 order; this builder refuses only what would make the key
 * meaningless, in that same order: a Run without a known outcome (`busy`), an
 * open head (`busy`, `finalize_first:`) and an unresolvable basis (`incomplete`).
 */
export function noProgressKey(input: NoProgressKeyInputV1): NoProgressKeyResult {
  const run = input.afterRun;
  const outcome = knownOutcome(run);
  if (typeof outcome !== 'string') return outcome;
  if (input.head !== null && input.head.status === 'open') return openRound(input.head);
  const plan = resolvedBasis(input.basisPlan, input.taskRef.taskId);
  if (!isPlanRevisionRef(plan)) return plan;
  const facts: RoundFailureFactsV1 = input.head === null ? { checks: [], gapCodes: [] } : roundFailureFacts(input.head);
  const body: Omit<NoProgressKeyV1, 'digest'> = {
    taskRef: triple(input.taskRef),
    actionKind: 'requeue',
    failure: {
      outcome,
      origin: runFailureOrigin(run),
      exhaustedTokenBudget: outcome === 'budget_exhausted' ? run.budget.tokenBudget : null,
      checks: keyCheckFacts(facts.checks),
      gapCodes: facts.gapCodes,
    },
    source: stamp(input.source),
    plan,
    newInputDigest: newBasisInputDigest(input.newInputRefs),
  };
  return accept({ ...body, digest: digestOf(body) });
}

/**
 * §13.7 point 1 `ReverifyBasisV1`. No Run outcome, origin or exhausted budget:
 * a round has no Run terminal. `verificationInputs` names the basis Plan and
 * the two pins, never `planDigest`/`taskDigest` (an unrelated adoption or a
 * disposition-only change would otherwise move the key, §9 VD-7, VD-13).
 */
export function reverifyBasis(input: ReverifyBasisInputV1): ReverifyBasisResult {
  if (input.predecessor.status === 'open') return openRound(input.predecessor);
  const basisPlanRef = resolvedBasis(input.basisPlan, input.subject.taskId);
  if (!isPlanRevisionRef(basisPlanRef)) return basisPlanRef;
  const facts = roundFailureFacts(input.predecessor);
  const body: Omit<ReverifyBasisV1, 'digest'> = {
    subject: triple(input.subject),
    subjectRunId: input.subjectRunId,
    actionKind: 'reverify',
    failure: { checks: keyCheckFacts(facts.checks), gapCodes: facts.gapCodes },
    source: stamp(input.source),
    configuration: {
      configurationRevision: input.configuration.configurationRevision,
      configurationDigest: input.configuration.configurationDigest,
    },
    verificationInputs: {
      basisPlanRef,
      completionPolicyPin: {
        ref: {
          aggregateType: 'CompletionPolicyRevision',
          projectId: input.completionPolicyPin.ref.projectId,
          policyId: input.completionPolicyPin.ref.policyId,
          revision: input.completionPolicyPin.ref.revision,
        },
        digest: input.completionPolicyPin.digest,
      },
      architectureBaselinePin: {
        ref: {
          aggregateType: 'ArchitectureBaselineRevision',
          projectId: input.architectureBaselinePin.ref.projectId,
          baselineId: input.architectureBaselinePin.ref.baselineId,
          revision: input.architectureBaselinePin.ref.revision,
        },
        digest: input.architectureBaselinePin.digest,
      },
    },
    newInputDigest: newBasisInputDigest(input.newInputRefs),
  };
  return accept({ ...body, digest: digestOf(body) });
}

// ------------------------------------------------------------------------ //
// Guards and helpers                                                        //
// ------------------------------------------------------------------------ //
type KeyRejection = Transition<never, never, never>;

/** Hard limit 1: an unknown or missing outcome is answered "reconcile first", never compared. */
function knownOutcome(run: NoProgressKeyInputV1['afterRun']): Exclude<RunOutcome, 'outcome_unknown'> | KeyRejection {
  switch (run.status) {
    case 'starting':
    case 'running':
      return reject('guard_failed', 'busy', `run ${run.ref.runId} is ${run.status} and has not ended`);
    case 'ended':
      break;
    default:
      return unreachable(run.status, 'run status');
  }
  const outcome = run.outcome;
  if (outcome === null) return reject('guard_failed', 'busy', `run ${run.ref.runId} ended without an outcome`);
  switch (outcome) {
    case 'outcome_unknown':
      return reject('guard_failed', 'busy', `run ${run.ref.runId} ended with an unknown outcome; reconcile it first`);
    case 'completed':
    case 'failed':
    case 'cancelled':
    case 'budget_exhausted':
    case 'crashed':
    case 'yielded':
      return outcome;
    default:
      return unreachable(outcome, 'run outcome');
  }
}

function openRound(round: KeyRoundV1): KeyRejection {
  return reject('guard_failed', 'busy', `finalize_first: round ${round.ref.roundId} is open`);
}

function resolvedBasis(lookup: TaskBasisLookupV1, taskId: string): PlanRevisionRef | KeyRejection {
  if (lookup === undefined) {
    return reject('guard_failed', 'incomplete', `task ${taskId} has no effective basis in the active Plan`);
  }
  if (!isPlanRevisionRef(lookup)) {
    return reject('guard_failed', 'incomplete', `task ${taskId} basis is unresolvable: ${lookup.reason}`);
  }
  return { aggregateType: 'PlanRevision', projectId: lookup.projectId, planId: lookup.planId };
}

function isPlanRevisionRef(value: PlanRevisionRef | object): value is PlanRevisionRef {
  return (value as { aggregateType?: unknown }).aggregateType === 'PlanRevision';
}

/** Only the declared members enter a key, so a wider object never changes its digest. */
function triple(task: TaskTriple): TaskTriple {
  return { projectId: task.projectId, goalId: task.goalId, taskId: task.taskId };
}

function stamp(source: SourceStampV1): SourceStampV1 {
  return { workspaceRevision: source.workspaceRevision, sourceDigest: source.sourceDigest };
}

/**
 * The identity of one new input inside a key. An Artifact is its content key
 * only, the fields `sameArtifactRef` compares (`material-access.ts:194`): the
 * store keeps the first ref for a body and content type and finds and verifies
 * a body by that key, ignoring `source` (`artifact.ts:8-10`,
 * `record-store/body-store.ts:49-58`). Another `source` on a body already used
 * is therefore the same input (§13.1 "按正文与内容类型去重", §13.4 #20).
 */
type KeyInputRefV1 =
  | { kind: 'artifact'; ref: Pick<ArtifactRef, 'kind' | 'contentType' | 'digest' | 'sizeBytes'> }
  | { kind: 'session_message'; ref: SessionMessageRef };

function keyInputRef(input: NewBasisInputRefV1): KeyInputRefV1 {
  switch (input.kind) {
    case 'artifact': {
      const { ref } = input;
      return {
        kind: 'artifact',
        ref: { kind: 'artifact', contentType: ref.contentType, digest: ref.digest, sizeBytes: ref.sizeBytes },
      };
    }
    case 'session_message':
      return {
        kind: 'session_message',
        ref: {
          aggregateType: 'SessionMessage', projectId: input.ref.projectId,
          workspaceId: input.ref.workspaceId, messageId: input.ref.messageId,
        },
      };
    default:
      return unreachable(input, 'new basis input kind');
  }
}

/** checkId in UTF-16 code unit order (as `canonicalJson`); the whole fact breaks ties. */
function compareCheckFacts(left: NoProgressCheckFactV1, right: NoProgressCheckFactV1): number {
  const byId = compareText(left.checkId, right.checkId);
  if (byId !== 0) return byId;
  return compareText(canonicalText(keyFact(left)), canonicalText(keyFact(right)));
}

function keyFact(check: NoProgressCheckFactV1): NoProgressCheckFactV1 {
  return { checkId: check.checkId, phase: check.phase, outcome: check.outcome, cause: check.cause };
}

function sortedDistinct(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The JSON round trip drops `undefined` optional members (as `plan-task-basis.ts` does). */
function canonicalText(value: unknown): string {
  return canonicalJson(JSON.parse(JSON.stringify(value)) as JsonValue);
}

function digestOf(value: unknown): string {
  return sha256Hex(canonicalText(value));
}
