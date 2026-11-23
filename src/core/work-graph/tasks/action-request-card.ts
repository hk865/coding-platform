/**
 * The `action_release` card's one facts builder (`book :392–:396`, `:417–:435`). Both the card source (`views/`) and
 * the source handler (`communication/`) need the same source, objects, options and close reason, and `tasks/` is the
 * one submodule both may import.
 *
 * The card is derived from the persisted `ActionRequest` (dispatch or stop) and its Goal — never from a message. Its
 * key carries the request's creation revision (1); the request's own CAS revision stays in `source.pins`. The Task a
 * request names and the stop card's Run are the card's display refs, never source pins, so the card source and the
 * answer accept the same pin set.
 */
import type {
  DecisionObjectV1, DecisionOptionV1, DecisionSourceV1, ActionReleaseCardItemV1,
} from '../../../contracts/goal-decisions.js';
import { decisionSourceKey, ACTION_RELEASE_OPTIONS } from '../../../contracts/goal-decisions.js';
import type { GoalSnapshot } from '../../../contracts/ledger.js';
import type { ActionRequestRef } from '../../../contracts/action-request.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import { storedDispatchBasis } from '../model/action-request-contracts.js';
import type { ActionRequestV1 } from '../state/action-request.js';
import { goalDecisionBasis } from './goal-basis.js';
import { UNKNOWN_CALL_APPROVAL_OPTION_LABELS } from './unknown-call-review-card.js';

export type ActionRequestCardFactsV1 = ActionReleaseCardItemV1 & {
  /** The canonical natural source: `requestRef` + creation revision. */
  source: DecisionSourceV1;
  objects: DecisionObjectV1[];
  options: DecisionOptionV1[];
  /** The request's own intake time. */
  openedAt: string;
  /** `null` = the card still waits for the person; a reason closes it (answered, withdrawn, void, or cancelled Goal). */
  closedReason: 'goal_cancelled' | 'source_resolved' | null;
};

/** `needs_decision` request key: the card source's kind plus the request and its creation revision. */
export function actionReleaseCardKey(requestRef: ActionRequestRef): string {
  return decisionSourceKey({ kind: 'action_release', requestRef, revision: 1 });
}

/** The card's facts from the request record and its Goal alone. */
export function actionRequestCardFacts(input: {
  request: ActionRequestV1;
  goal: GoalSnapshot;
}): ActionRequestCardFactsV1 {
  const { request, goal } = input;
  const source: DecisionSourceV1 = {
    kind: 'action_release',
    key: actionReleaseCardKey(request.ref),
    subject: { kind: 'goal', goalRef: { ...goal.ref } },
    pins: [
      { ref: structuredClone(request.ref), revision: request.revision },
      { ref: structuredClone(goal.ref), revision: goal.revision },
    ],
    goalBases: [goalDecisionBasis(goal)],
  };
  const objects: DecisionObjectV1[] = [
    { kind: 'aggregate', pin: { ref: structuredClone(request.ref), revision: request.revision }, label: '动作请求' },
  ];
  const options: DecisionOptionV1[] = [
    { id: ACTION_RELEASE_OPTIONS.approve, label: UNKNOWN_CALL_APPROVAL_OPTION_LABELS.approve, effect: 'apply' },
    { id: ACTION_RELEASE_OPTIONS.deny, label: UNKNOWN_CALL_APPROVAL_OPTION_LABELS.decline, effect: 'apply' },
  ];
  const closedReason: ActionRequestCardFactsV1['closedReason'] =
    goal.desiredState === 'cancelled' ? 'goal_cancelled'
      : request.state === 'pending' ? null
        : 'source_resolved';
  const common = {
    requestRef: request.ref,
    creationRevision: 1,
    requestRoot: request.basis?.requestRoot ?? null,
    task: { ...request.task },
    requester: { ...request.requester.session },
    reason: request.reason,
    requestedAt: request.requestedAt,
  };
  let item: ActionReleaseCardItemV1;
  if (request.kind === 'dispatch') {
    const expected = storedDispatchBasis(request.expected);
    if (expected === null) throw new Error('a dispatch action request carries no stored dispatch basis');
    item = { ...common, kind: 'dispatch', expected,
      preferredLine: request.preferredLine === null ? null : { ...request.preferredLine } };
  } else {
    if (request.frozen === null) throw new Error('a stop action request carries no frozen Run');
    item = { ...common, kind: 'stop', run: { ...request.frozen.run } };
  }
  return { ...item, source, objects, options, openedAt: request.requestedAt, closedReason };
}

/**
 * §2.8: the plan the claiming Run actually read (`outcome.run` → `Run.planRef`). The task card and the closed
 * `action_release` card share this one derivation; `null` when nothing claimed the Task or the Run is absent from the
 * read set.
 */
export function claimedPlanRefOf(
  request: { outcome: ActionRequestV1['outcome'] },
  runs: readonly RunSnapshot[],
): PlanRevisionRef | null {
  const applied = request.outcome;
  if (applied === null || applied.kind !== 'applied') return null;
  const run = runs.find((candidate) => canonicalKey(candidate.ref) === canonicalKey(applied.run));
  return run === undefined ? null : structuredClone(run.planRef);
}
