/**
 * The exploration control's pure state: the person's stop/release, the “reopen once” mark, and the one
 * planned-round formula. It lives beside the `role_line` arm and writes no record; the owners below
 * `sessions/` call these constructors and commit the result.
 */
import type { ColdStartExplorationQueryRefV1, ExplorationDepthV1, RoleLineActionV1 } from './role-line-action.js';

export const DEFAULT_EXPLORATION_DEPTH: ExplorationDepthV1 = 2;
export const EXPLORATION_STOP_REASON = 'stopped_by_person';

export function explorationDepthOf(action: Pick<RoleLineActionV1, 'depth'>): ExplorationDepthV1 {
  return action.depth ?? DEFAULT_EXPLORATION_DEPTH;
}

/** The person's stop: `waiting` is the existing “a person must move it, the Host does not drive” state. */
export function holdExploration(action: RoleLineActionV1): RoleLineActionV1 {
  return { ...action, result: { status: 'waiting', reason: EXPLORATION_STOP_REASON } };
}

/** The person's continue: clears the hold; the phase, rounds and depth stay put. */
export function releaseExploration(action: RoleLineActionV1): RoleLineActionV1 {
  return action.result === null ? action : { ...action, result: null };
}

/** Marks each named round “reopen once”; a round already marked keeps its first mark. */
export function markRoundReopen(action: RoleLineActionV1,
  refs: readonly ColdStartExplorationQueryRefV1[], reason: string | null): RoleLineActionV1 {
  const marked = new Set(refs);
  return { ...action, explorations: (action.explorations ?? []).map((entry) =>
    marked.has(entry) && entry.reopen === undefined ? { ...entry, reopen: { reason } } : entry) };
}

/**
 * The one planned-round formula: `map` is one round; `split` is one coarse round plus `depth - 1` rounds
 * per selected block. The caller gives the count of the full selected set, not the part left to do.
 */
export function plannedExplorationRounds(input: {
  depth: ExplorationDepthV1; route: 'map' | 'split'; topLevelModuleCount: number;
}): number {
  if (input.route === 'map') return 1;
  return 1 + (input.depth - 1) * input.topLevelModuleCount;
}
