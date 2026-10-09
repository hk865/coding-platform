/**
 * The shared autonomy policy and user-message admission
 * (docs/refactor/design/orchestration-2026-10/slices/slice-5-SPEC.md §3.2).
 *
 * `decisionActionPolicy` is the ONE table every entry (owner service, tool,
 * Workflow, route) consults; `automationDecisionCause` derives the named
 * `automation_confirmation_required` cause from the same policy plus the saved
 * affected refs and the existing rework counters. `canSendUserMessage` is the
 * trusted-duties admission of S5-AU-04. All three are pure and read no clock,
 * id, cipher or storage; the owner supplies the already counted facts.
 */
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { DecisionActionV1, GoalAutonomyV1 } from '../../../contracts/goal-decisions.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { Phase, RuntimeTask } from '../../../contracts/plan.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import type { TaskFailureFactsV1 } from '../../../contracts/task-failure.js';
import type { ReworkActorClass, TaskReworkRefusalCode } from '../../../contracts/task-requeue.js';
import { ROUND_CHAIN_MAX } from '../../../contracts/verification.js';
import { unreachable } from './transition.js';
import { reverifyExemptionOfFacts, successorAutoCount } from './verification-machine.js';

/** §3.2: only these duties may send a "please decide" request. */
const DECISION_REQUEST_DUTIES: ReadonlySet<PlatformDutyV1> = new Set<PlatformDutyV1>(
  ['secretary', 'adviser', 'scribe'],
);

/** §3.2 autonomy table: the four verdicts for one action under one autonomy level. */
export function decisionActionPolicy(input: {
  autonomy: GoalAutonomyV1; action: DecisionActionV1;
  actorClass: ReworkActorClass; countedNext: number | null; cap: number;
}): 'user_only' | 'needs_decision' | 'automatic' | 'automatic_notice' {
  const everyStep = input.autonomy === 'every_step';
  switch (input.action) {
    // The user's own choices: never automatic at either autonomy level.
    case 'confirm_goal':
    case 'adopt_first_plan':
    case 'remember_user_preference':
      return 'user_only';
    case 'refine_future':
    case 'minor_semantic_patch':
      return everyStep ? 'needs_decision' : 'automatic';
    case 'system_requeue':
    case 'agent_requeue':
    case 'auto_reverify':
      // "countedNext>cap 时两档都是 needs_decision"; the existing fences stay.
      if (input.countedNext !== null && input.countedNext > input.cap) return 'needs_decision';
      return everyStep ? 'needs_decision' : 'automatic_notice';
    case 'secretary_action':
    case 'secretary_inquiry':
      return everyStep ? 'needs_decision' : 'automatic';
    case 'short_handoff':
      return everyStep ? 'needs_decision' : 'automatic_notice';
    case 'secretary_too_long':
      return 'automatic_notice';
    case 'structural_patch':
    case 'change_goal':
    case 'exceed_budget':
    case 'escalate':
    case 'long_handoff':
    case 'change_duty':
      return 'needs_decision';
    default:
      return unreachable(input.action, 'decision action');
  }
}

/** S5-AU-04: `notify` needs any formal duty; `decision_request` needs secretary/adviser/scribe. */
export function canSendUserMessage(input: {
  duties: readonly PlatformDutyV1[]; readOnlyCopy: boolean;
  independentReview: boolean; intent: 'notify' | 'decision_request';
}): boolean {
  // A read-only copy / independent reviewer is never a sender, whatever the duty.
  if (input.readOnlyCopy || input.independentReview) return false;
  if (input.intent === 'notify') return input.duties.length > 0;
  return input.duties.some((duty) => DECISION_REQUEST_DUTIES.has(duty));
}

/** §2.8/§3.1: the derived automation-confirmation cause, sorted and de-duplicated affected refs. */
export function automationDecisionCause(input: {
  autonomy: GoalAutonomyV1; action: DecisionActionV1; actorClass: ReworkActorClass;
  countedNext: number | null; cap: number; affected: VersionPin[];
}): null | { code: 'automation_confirmation_required'; action: DecisionActionV1; affected: VersionPin[] } {
  const verdict = decisionActionPolicy({
    autonomy: input.autonomy,
    action: input.action,
    actorClass: input.actorClass,
    countedNext: input.countedNext,
    cap: input.cap,
  });
  if (verdict !== 'needs_decision') return null;
  const byKey = new Map<string, VersionPin>();
  for (const pin of input.affected) byKey.set(canonicalJson(pin as JsonValue), pin);
  const affected = [...byKey.keys()].sort().map((key) => byKey.get(key)!);
  return { code: 'automation_confirmation_required', action: input.action, affected };
}

/**
 * §4.5/§3.3 line 629: the ONE derivation of the Workflow's automation cause and
 * its affected pins, shared by `automationConfirmation` and the source-2 reader
 * so both produce the same `source.key`. The Task pin is the §2.1 absence pin
 * (a Task is not a stored aggregate); the failure Run pin is added when the
 * caller resolved its formal revision. Past the cap the existing owner fence
 * stays (`automationConfirmation`'s early return), so no automation cause is
 * derived.
 *
 * (§3.3 line 629 / defect-1) A Run is a STORED aggregate, so `0` is not a legal
 * pin for it: `isAbsencePin` is false and the §3.3 pin check would reject the
 * card with `revision_conflict`. When the failure facts read the Run the formal
 * revision is passed in; the two callers otherwise read the Run's formal
 * revision through their own canonical Run reader before calling this helper
 * (the reader via `revisionPinOf`, the Workflow via `sourceAuthority.load`). A
 * still-null revision only means the Run fact was never read, so no Run version
 * exists to claim and the pin is omitted rather than fabricated.
 */
export function automationConfirmationCause(input: {
  autonomy: GoalAutonomyV1; action: 'system_requeue' | 'auto_reverify';
  countedNext: number; cap: number;
  goalRef: GoalRef; taskId: string; runRef: RunRef | null; runRevision: number | null;
}): null | { code: 'automation_confirmation_required'; action: DecisionActionV1; affected: VersionPin[] } {
  if (input.countedNext > input.cap) return null;
  const affected: VersionPin[] = [
    { ref: { aggregateType: 'Task', projectId: input.goalRef.projectId, goalId: input.goalRef.goalId,
      taskId: input.taskId } as unknown as VersionPin['ref'], revision: 0 },
  ];
  if (input.runRef !== null && input.runRevision !== null) {
    affected.push({ ref: input.runRef, revision: input.runRevision });
  }
  return automationDecisionCause({
    autonomy: input.autonomy, action: input.action, actorClass: 'system',
    countedNext: input.countedNext, cap: input.cap, affected,
  });
}

/**
 * GOAL-27 `awaiting_gate` / GV-5 coverage: the work Tasks inside a gate's scope
 * (goal: every one; stage: its stage; module: its module). The ONE pure
 * coverage derivation. `plan-service.ts`'s `gateCoverage` delegates here, and
 * `gateFixInProgress` below is the single rule that turns coverage plus the
 * covered Tasks' requirement/disposition/effective phase into GV-5, so the
 * emitted gate card and its §8.2-paused re-derivation cannot diverge.
 */
export function gateCoveredTaskIds(tasks: readonly RuntimeTask[], gate: RuntimeTask): string[] {
  if (gate.taskKind !== 'gate') return [];
  const scope = gate.scope;
  return tasks.filter((task) => {
    if (task.taskKind !== 'work') return false;
    switch (scope.kind) {
      case 'goal': return true;
      case 'stage': return task.scope.kind !== 'goal' && task.scope.stageId === scope.stageId;
      case 'module': return task.scope.kind === 'module' && task.scope.stageId === scope.stageId
        && task.scope.moduleRef === scope.moduleRef;
      default: return false;
    }
  }).map((task) => task.taskId);
}

/**
 * GV-5: a required, active work Task inside the gate's scope is not yet
 * `satisfied`. `phaseOf` is the caller's own `effectivePhase` projection of the
 * read rows (`facts.byTaskId` in the Plan service, `TaskRow.effectivePhase` in
 * the §4.2 reader); an unknown phase is not satisfied.
 */
export function gateFixInProgress(
  tasks: readonly RuntimeTask[], gate: RuntimeTask, phaseOf: (taskId: string) => Phase | undefined,
): boolean {
  return gateCoveredTaskIds(tasks, gate).some((taskId) => {
    const covered = tasks.find((candidate) => candidate.taskId === taskId);
    return covered !== undefined && covered.requirementLevel === 'required' && covered.disposition === 'active'
      && phaseOf(taskId) !== 'satisfied';
  });
}

/** A fresh (not stale) refusal under one of `codes` stops the named operation. */
function freshRefusal(
  refusal: TaskFailureFactsV1['automation']['lastRefusal'], codes: readonly TaskReworkRefusalCode[],
): boolean {
  return refusal !== null && !refusal.stale && codes.includes(refusal.code);
}

/**
 * §4.5 line 888 / F1(a): the automatic action the AV/GV tables WOULD name for
 * one saved failure whose Goal is now paused (not cancelled). While the Goal is
 * not active `workVerdict`/`gateVerdict` short-circuit to `none` at AV-0/GV-0,
 * so a card the Workflow emitted before the pause can no longer be re-derived
 * from `automation.verdict` (rule §8.2 line 1357: a pause must not make the
 * card disappear). This helper reads only the `TaskFailureFactsV1` the Task row
 * carries plus the row's own active projection and re-derives the same action
 * and count; every stop or fence the facts can prove returns `null`.
 *
 * The facts are enough for a work Task: `failureClass`, `round` (status,
 * ordinal, autoCount, failing checks and gap codes), `automation` (cap, counts
 * and refusals), `stop` and `interruption` are all saved. A gate's GV table
 * additionally depends on `fixInProgress` (GV-5); the caller passes the ONE
 * `gateFixInProgress` derivation over the same plan/task read, so the paused
 * re-derivation names exactly the action the emitted card did.
 */
export function pausedAutomationAction(input: {
  taskDispositionActive: boolean; failure: TaskFailureFactsV1;
  /** GV-5 for a gate, from the shared `gateFixInProgress`; ignored for a work Task. */
  gateFixInProgress?: boolean;
}): null | { action: 'system_requeue' | 'auto_reverify'; countedNext: number } {
  const { failure } = input;
  // AV-1 / GV-1: a non-active Task is never advanced.
  if (!input.taskDispositionActive) return null;
  // AV-3: a covering TaskRequeue already owns the Run.
  if (failure.automation.coveringRequeue !== null) return null;
  // AV-4 / AV-5: a paused interruption or a person's pointer stops every action.
  if (failure.interruption !== null && failure.interruption.kind === 'paused') return null;
  if (failure.stop !== null && failure.stop.requester === 'human') return null;

  if (failure.subjectKind === 'work') {
    const failureClass = failure.failureClass;
    if (failureClass === null) return null;
    if (failureClass === 'check_incomplete') {
      const head = failure.round;
      // FC-13 (an open head with only interrupted checks) is finalized first;
      // `automaticReverify` returns no step while `needsFinalize` holds.
      if (head === null || head.status !== 'finalized') return null;
      const exemption = reverifyExemptionOfFacts({ checks: head.failingChecks, gapCodes: head.gapCodes });
      if (head.ordinal >= ROUND_CHAIN_MAX) return null; // AV-7b
      if (head.autoCount + 1 > failure.automation.cap && exemption !== 'host_interruption') return null; // AV-7a
      if (freshRefusal(failure.automation.lastReverifyRefusal, ['no_new_basis', 'verification_uncovered'])) {
        return null; // AV-7c
      }
      return { action: 'auto_reverify', countedNext: successorAutoCount(head.autoCount, 'system', exemption) };
    }
    // AV-8: past the automatic cap the existing requeue fence stands.
    if (failureClass !== 'interrupted'
      && failure.automation.requeueAutoCount + 1 > failure.automation.cap) return null;
    if (freshRefusal(failure.automation.lastRefusal, ['no_new_basis'])) return null; // AV-9
    // LB-1 (`stopped/budget_exhausted`) and AV-12 both perform a system requeue.
    return { action: 'system_requeue',
      countedNext: failure.automation.requeueAutoCount + (failureClass === 'interrupted' ? 0 : 1) };
  }
  // gate: GV-1..GV-10 without GV-0 (the Goal is non-active by construction).
  const head = failure.round;
  if (head === null || head.status !== 'finalized') return null; // GV-2, GV-3/GV-3′
  if (failure.failureClass === null) return null; // GV-4: a finalized PASS head is never reworked.
  if (input.gateFixInProgress === true) return null; // GV-5
  const exemption = reverifyExemptionOfFacts({ checks: head.failingChecks, gapCodes: head.gapCodes });
  if (head.autoCount + 1 > failure.automation.cap && exemption !== 'host_interruption') return null; // GV-6
  if (head.ordinal >= ROUND_CHAIN_MAX) return null; // GV-7
  if (freshRefusal(failure.automation.lastReverifyRefusal, ['no_new_basis', 'verification_uncovered'])) {
    return null; // GV-8
  }
  if (freshRefusal(failure.automation.lastReverifyRefusal, ['source_unchanged']) && head.outcome === 'FAIL') {
    return null; // GV-8: `gate_needs_fix`
  }
  // GV-9 (FAIL, onlyIfSourceChanged) and GV-10 (INCONCLUSIVE) are the same
  // automatic successor round; the cause needs only the action and the count the
  // Workflow's `reverify_round` step would use.
  return { action: 'auto_reverify', countedNext: successorAutoCount(head.autoCount, 'system', exemption) };
}
