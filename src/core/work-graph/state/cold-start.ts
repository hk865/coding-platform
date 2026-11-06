/**
 * The cold-start operation as a narrowed view of O1a's one `role_line` arm (no second operation kind), and its pure
 * six-phase machine over `COLD_START_PHASES`. The vocabulary and the stored shape live in `./role-line-action.ts`;
 * this file only narrows the arm and moves the phase pointer, and the cold-start owner writes the record.
 */
import { COLD_START_PHASES } from './role-line-action.js';
import type { ColdStartExplorationQueryRefV1, ColdStartPhaseV1, RoleLineActionV1 } from './role-line-action.js';
import type { QueryJobAnswerRef, QueryRunRef } from '../../../contracts/query-job.js';
import type { ArchitectureCatalogPinV1 } from '../../../contracts/architecture-catalog.js';
import type { ArchitectureProposalBatchRef } from '../../../contracts/architecture-proposal.js';
import type { ModuleRef } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';

/** O1a's one `role_line` arm; the intersection tightens `action`/`phase` and requires the payload (a distributive
 *  `Extract` would be `never`, because `action` is a property union inside a single arm, not a union of arms). */
export type ColdStartActionV1 = RoleLineActionV1 & {
  action: 'cold_start';
  /** The first unfinished phase: the resume point after a crash. */
  phase: ColdStartPhaseV1;
  /** The last phase whose commit completed; null before `candidates`. */
  lastCompleted: ColdStartPhaseV1 | null;
  /** Only the original Query/answer ref; no candidate body and no second binding (BK-7d2-14). */
  candidate: { queryRunRef: QueryRunRef; answerRef: QueryJobAnswerRef } | null;
  pendingRegions: ModuleRef[];
  explorations: ColdStartExplorationQueryRefV1[];
  batchRefs: ArchitectureProposalBatchRef[];
  route: 'map' | 'split' | null;
  baseCatalogPin: ArchitectureCatalogPinV1 | null;
};

/** One cold-start operation per project: the ref is derived, not scanned. */
export function coldStartOperationRef(projectId: string): OperationRef {
  return { aggregateType: 'CoreOperation', projectId, operationId: `cold_start:${projectId}` };
}

export function newColdStartAction(): ColdStartActionV1 {
  return { kind: 'role_line', action: 'cold_start', phase: 'candidates', lastCompleted: null,
    steps: [], result: null, candidate: null, pendingRegions: [], explorations: [], batchRefs: [],
    route: null, baseCatalogPin: null, goalRef: null };
}

/** The payload's phase pointer is the first unfinished phase, one step past `lastCompleted`. */
export function coldStartPhaseProblem(action: ColdStartActionV1): string | null {
  const phase = COLD_START_PHASES.indexOf(action.phase);
  if (phase < 0) return 'the cold-start phase is not one of the six';
  const completed = action.lastCompleted === null ? -1 : COLD_START_PHASES.indexOf(action.lastCompleted);
  // `proposals` is the terminal phase: a RUNNING proposals phase has lastCompleted `regions`; a COMPLETED
  // operation (d10) keeps phase `proposals` and sets lastCompleted `proposals` in the same commit.
  if (action.phase === 'proposals' && action.lastCompleted === 'proposals') return null;
  return completed === phase - 1 ? null : 'the cold-start phase is not the first unfinished phase';
}

/** Exactly one phase per commit: the caller advances `phase` and sets `lastCompleted` to the old phase. */
export function advanceColdStartPhase(
  action: ColdStartActionV1,
  patch: Omit<Partial<ColdStartActionV1>, 'kind' | 'action' | 'lastCompleted'>,
): ColdStartActionV1 {
  const current = action.phase;
  if (current === 'proposals') throw new Error('the cold-start proposals phase is terminal');
  const next = COLD_START_PHASES[COLD_START_PHASES.indexOf(current) + 1];
  return { ...action, ...patch, phase: next as ColdStartPhaseV1, lastCompleted: current };
}
