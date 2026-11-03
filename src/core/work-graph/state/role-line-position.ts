/**
 * Role-line positions (pure; imports only `src/contracts`): the goal position an adviser line may take, the region
 * burden of a module and the one value `role-lines/read` carries per scope. Nothing here reads a store.
 */
import type { AdoptedArchitecture } from '../../../contracts/architecture-catalog.js';
import type { FileGraphPageNodeV1 } from '../../../contracts/architecture-inspection.js';
import type { ModuleRef, SessionRef } from '../../../contracts/core/identity.js';
import type { GoalPhaseSnapshot } from '../../../contracts/goal-phase.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { NoteScopeV1 } from '../../../contracts/note.js';
import type { GoalScreeningV1 } from '../../../contracts/query-job.js';
import { pathOwnershipOf } from '../../../contracts/path-ownership.js';

export const MAX_GOALS_PER_ADVISER = 3;
export const REGION_SLOT_LINE_BUDGET = 15_000;
export const SCRIBE_SLOT_NOTE_LIMIT = 500;

/** The goal links of every adviser line, read once by the caller (no second link read). */
export type AdviserGoalLinkV1 = {
  session: SessionRef; goal: GoalRef; inProgress: boolean;
  size: GoalScreeningV1['size'] | null;
  /** `goal_queue_assign` by a person (actor not the platform); outside the 3-count. */
  assignedByPerson: boolean;
};

export type GoalPositionV1 = {
  inProgress: boolean;
  /** A `small` screened goal may share; no screening / medium / large / unknown takes one line. */
  shareable: boolean;
  /** Lines that may take this goal, in input order; empty → O4a's queue. */
  candidates: readonly SessionRef[];
};

export function goalPositionOf(input: {
  goal: GoalSnapshot; phase: GoalPhaseSnapshot | null; screening: GoalScreeningV1 | null;
  adviserLinks: readonly AdviserGoalLinkV1[];
}): GoalPositionV1 {
  const inProgress = input.goal.desiredState === 'active' && input.phase?.phase !== 'COMPLETED';
  const shareable = input.screening?.size === 'small';
  const lines = new Map<string, { session: SessionRef; goals: AdviserGoalLinkV1[] }>();
  for (const link of input.adviserLinks) {
    const key = link.session.sessionId;
    const line = lines.get(key) ?? { session: link.session, goals: [] };
    line.goals.push(link); lines.set(key, line);
  }
  const candidates: SessionRef[] = [];
  if (inProgress) for (const line of lines.values()) {
    const counted = line.goals.filter(goal => goal.inProgress && !goal.assignedByPerson);
    if (counted.length >= MAX_GOALS_PER_ADVISER) continue;
    if (counted.length > 0 && !(shareable && line.goals.every(goal => goal.size === 'small'))) continue;
    candidates.push(line.session);
  }
  return { inProgress, shareable, candidates };
}

export type RegionBurdenUnknownReason =
  | 'observation_missing' | 'observation_failed' | 'observation_incomplete'
  | 'ownership_ambiguous' | 'containment_unknown';

export type RegionPositionV1 =
  | { status: 'region'; moduleRef: ModuleRef; burden: number }
  | { status: 'descend'; moduleRef: ModuleRef; burden: number; children: readonly ModuleRef[] }
  | { status: 'unknown'; moduleRef: ModuleRef; reason: RegionBurdenUnknownReason };

export function regionPositionOf(input: {
  moduleRef: ModuleRef; catalog: AdoptedArchitecture | null;
  observation:
    | { status: 'ready'; complete: boolean; files: readonly Pick<FileGraphPageNodeV1, 'path' | 'nonBlankLines'>[] }
    | { status: 'missing' | 'failed' | 'incomplete' };
}): RegionPositionV1 {
  const unknown = (reason: RegionBurdenUnknownReason): RegionPositionV1 =>
    ({ status: 'unknown', moduleRef: input.moduleRef, reason });
  if (input.catalog === null) return unknown('containment_unknown');
  if (input.observation.status !== 'ready') {
    return unknown(input.observation.status === 'missing' ? 'observation_missing'
      : input.observation.status === 'failed' ? 'observation_failed' : 'observation_incomplete');
  }
  if (!input.observation.complete) return unknown('observation_incomplete');
  if (!input.catalog.modules.some(module => module.ref.projectId === input.moduleRef.projectId
    && module.ref.moduleId === input.moduleRef.moduleId)) return unknown('containment_unknown');
  // 8B: an absent field means the revision declared no containment at all ("unknown"), and only an
  // explicit `{parentOf: []}` is a flat catalog. The children read never treats absence as flat.
  const containment = input.catalog.containment;
  if (containment === undefined) return unknown('containment_unknown');
  const candidates = input.catalog.modules.map(module => ({ value: module.ref, paths: module.paths }));
  let burden = 0;
  for (const file of input.observation.files) {
    const owner = pathOwnershipOf(file.path, candidates);
    if (owner.status === 'tie') return unknown('ownership_ambiguous');
    if (owner.status === 'owner' && owner.owner.moduleId === input.moduleRef.moduleId) burden += file.nonBlankLines;
  }
  const children = containment.parentOf
    .filter(edge => edge.parent.projectId === input.moduleRef.projectId
      && edge.parent.moduleId === input.moduleRef.moduleId)
    .map(edge => edge.child);
  return burden <= REGION_SLOT_LINE_BUDGET || children.length === 0
    ? { status: 'region', moduleRef: input.moduleRef, burden }
    : { status: 'descend', moduleRef: input.moduleRef, burden, children };
}

/** One line's scope positions; a scribe scope's `current: null` is “count unreadable”. This is the value
 * `role-lines/read` carries unchanged as its additive `position` (O5a); the line's effective responsibility
 * scope stays `RoleScopeV1`, never this type. */
export type RoleLinePositionV1 =
  | { kind: 'goal'; goalRef: GoalRef; position: GoalPositionV1 }
  | { kind: 'region'; moduleRef: ModuleRef; position: RegionPositionV1 }
  | { kind: 'scribe'; scope: NoteScopeV1; current: number | null };
