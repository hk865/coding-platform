import type { PickBasisV1 } from '../../contracts/pick-basis.js';
import type { SessionCard } from '../../core/work-graph/model/session-contracts.js';

export type PickCandidateV1 = {
  card: SessionCard;
  responsibleTask: boolean;      // key 1: open `responsible` link to the Task
  responsibleModule: boolean;    // key 2: open `responsible` link to the Task's module
  sameGoalRun: boolean;          // key 3: an ended Run of this Goal names this Session
  activityAt: string;            // key 5: latestActivityAt(card.record.createdAt, [line.lastActivityAt, record.lastActivityAt])
};

export type PickOrderKeyV1 = Exclude<PickBasisV1['rank'], 'none'>;

/** The first L15 key on which `left` is strictly ahead of `right`; null when all six agree. */
export function firstPickKey(left: PickCandidateV1, right: PickCandidateV1): PickOrderKeyV1 | null {
  if (left.responsibleTask !== right.responsibleTask) {
    return left.responsibleTask ? 'responsible_task' : null;
  }
  if (left.responsibleModule !== right.responsibleModule) {
    return left.responsibleModule ? 'responsible_module' : null;
  }
  if (left.sameGoalRun !== right.sameGoalRun) {
    return left.sameGoalRun ? 'same_goal_history' : null;
  }
  if (left.activityAt !== right.activityAt) {
    return left.activityAt > right.activityAt ? 'latest_activity' : null;
  }
  if (left.card.record.ref.projectId !== right.card.record.ref.projectId) {
    return left.card.record.ref.projectId < right.card.record.ref.projectId ? 'session_key' : null;
  }
  if (left.card.record.ref.sessionId !== right.card.record.ref.sessionId) {
    return left.card.record.ref.sessionId < right.card.record.ref.sessionId ? 'session_key' : null;
  }
  return null;
}

/** L15's order: 1 responsible_task, 2 responsible_module, 3 same_goal_history,
 *  4 duty (constant after the filter; kept for 7D's scoped duties), 5 latest_activity
 *  (later first), 6 Session key (`projectId`, then `sessionId`, ascending). */
export function comparePickCandidates(left: PickCandidateV1, right: PickCandidateV1): number {
  if (firstPickKey(left, right) !== null) return -1;
  if (firstPickKey(right, left) !== null) return 1;
  return 0;
}

/** The key that decided: firstPickKey(ranked[0], ranked[1]) or 'none' for fewer than two. */
export function pickBasisRank(ranked: readonly PickCandidateV1[]): PickBasisV1['rank'] {
  if (ranked.length < 2) return 'none';
  return firstPickKey(ranked[0]!, ranked[1]!) ?? 'none';
}
