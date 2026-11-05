// W/tasks/adviser-slots.ts — pure; the one cap is O2's. The queue service's adapter reads the facts (a formally
// completed goal is left out of `heldGoals` there, so this type carries no phase).
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { GoalScreeningV1 } from '../../../contracts/query-job.js';
import { MAX_GOALS_PER_ADVISER } from '../state/role-line-position.js';
import { plainSessionRefKey } from '../sessions/session-record-codecs.js';

export type AdviserSlotFactsV1 = {
  session: SessionRef;
  available: boolean;                        // health === 'available' && occupancy === null
  handingOff: boolean;                       // a live handoff fence exists
  lifecycle: 'active' | 'archived';
  retired: boolean;
  heldGoals: readonly { goalRef: GoalRef; desiredState: 'active' | 'paused' | 'cancelled';
    size: GoalScreeningV1['size'] | null }[];
  unendedTasks: number;                      // open responsible task links
  lastActivityAt: string;                    // latestActivityAt(createdAt, [activity, lastExecution])
};
export type AdviserCandidateV1 = { session: SessionRef; inProgressGoals: number;
  unendedTasks: number; lastActivityAt: string };

/**
 * Book :544–:548: eligibility first (available, not handing off, active, not retired, fewer than three in-progress
 * goals, and either none held or this goal and every in-progress one `small`), then the load order (in-progress goals,
 * unended tasks, the earliest last activity, the Session key). Secretary selection's comparator ranks other keys
 * (`secretary-selection.ts` `compareCandidates`), so it is not this one.
 */
export function adviserCandidateOf(input: { screening: GoalScreeningV1 | null;
  slots: readonly AdviserSlotFactsV1[] }): AdviserCandidateV1 | null {
  const eligible = input.slots.filter((slot) => {
    if (!slot.available || slot.handingOff || slot.lifecycle !== 'active' || slot.retired) return false;
    const active = slot.heldGoals.filter((goal) => goal.desiredState === 'active');
    if (active.length >= MAX_GOALS_PER_ADVISER) return false;              // the cap first
    if (active.length === 0) return true;                                  // holds none
    return input.screening?.size === 'small' && active.every((goal) => goal.size === 'small');
  });
  const ranked = eligible.map((slot) => ({ session: slot.session,
    inProgressGoals: slot.heldGoals.filter((goal) => goal.desiredState === 'active').length,
    unendedTasks: slot.unendedTasks, lastActivityAt: slot.lastActivityAt }));
  ranked.sort((left, right) => left.inProgressGoals - right.inProgressGoals
    || left.unendedTasks - right.unendedTasks
    || (left.lastActivityAt < right.lastActivityAt ? -1 : left.lastActivityAt > right.lastActivityAt ? 1 : 0)
    || plainSessionRefKey(left.session).localeCompare(plainSessionRefKey(right.session)));
  return ranked[0] ?? null;
}
