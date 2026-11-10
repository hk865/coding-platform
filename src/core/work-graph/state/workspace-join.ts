/**
 * The second workspace's join operation as a narrowed view of O1a's one `role_line` arm, and its pure three-phase
 * machine over `WORKSPACE_JOIN_PHASES`. The vocabulary and the stored shape live in `./role-line-action.ts`; this file
 * only narrows the arm and moves the phase pointer, and the workspace-join owner writes the record.
 */
import { WORKSPACE_JOIN_PHASES } from './role-line-action.js';
import type { ExplorationDepthV1, WorkspaceJoinActionV1, WorkspaceJoinPhaseV1 } from './role-line-action.js';
import { DEFAULT_EXPLORATION_DEPTH } from './exploration-control.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { ArchitectureCatalogPinV1 } from '../../../contracts/architecture-catalog.js';

/** One join operation per (project, workspace): the ref is derived, not scanned. */
export function workspaceJoinOperationRef(projectId: string, workspaceId: string): OperationRef {
  return { aggregateType: 'CoreOperation', projectId, operationId: `workspace_join:${workspaceId}` };
}

export function newWorkspaceJoinAction(depth: ExplorationDepthV1 = DEFAULT_EXPLORATION_DEPTH): WorkspaceJoinActionV1 {
  return { kind: 'role_line', action: 'workspace_join', phase: 'coarse_split', lastCompleted: null,
    steps: [], result: null, pendingRegions: [], explorations: [], batchRefs: [],
    route: 'split', baseCatalogPin: null, goalRef: null, depth };
}

/** Depth 1's join skips the region phase: one coarse round, one planned round. */
export function skipJoinRegions(action: WorkspaceJoinActionV1,
  pin: ArchitectureCatalogPinV1): WorkspaceJoinActionV1 {
  return { ...action, phase: 'proposals', lastCompleted: 'regions', baseCatalogPin: pin, plannedRounds: 1 };
}

/** The payload's phase pointer is the first unfinished phase, one step past `lastCompleted`. */
export function workspaceJoinPhaseProblem(action: WorkspaceJoinActionV1): string | null {
  const phase = WORKSPACE_JOIN_PHASES.indexOf(action.phase);
  if (phase < 0) return 'the workspace-join phase is not one of the three';
  const completed = action.lastCompleted === null ? -1 : WORKSPACE_JOIN_PHASES.indexOf(action.lastCompleted);
  // `proposals` is the terminal phase: a RUNNING proposals phase has lastCompleted `regions`; a COMPLETED
  // operation keeps phase `proposals` and sets lastCompleted `proposals` in the same commit.
  if (action.phase === 'proposals' && action.lastCompleted === 'proposals') return null;
  return completed === phase - 1 ? null : 'the workspace-join phase is not the first unfinished phase';
}

/** Exactly one phase per commit: the caller advances `phase` and sets `lastCompleted` to the old phase. */
export function advanceWorkspaceJoinPhase(
  action: WorkspaceJoinActionV1,
  patch: Omit<Partial<WorkspaceJoinActionV1>, 'kind' | 'action' | 'lastCompleted'>,
): WorkspaceJoinActionV1 {
  const current = action.phase;
  if (current === 'proposals') throw new Error('the workspace-join proposals phase is terminal');
  const next = WORKSPACE_JOIN_PHASES[WORKSPACE_JOIN_PHASES.indexOf(current) + 1];
  return { ...action, ...patch, phase: next as WorkspaceJoinPhaseV1, lastCompleted: current };
}

/** The record's envelope, born in the later workspace's registration commit; the composition root encodes it. */
export function newWorkspaceJoinOperation(input: { projectId: string; workspaceId: string; occurredAt: string;
  depth?: ExplorationDepthV1 }) {
  return { ref: workspaceJoinOperationRef(input.projectId, input.workspaceId), revision: 1,
    workspaceId: input.workspaceId, action: newWorkspaceJoinAction(input.depth), phase: 'running' as const,
    requestedAt: input.occurredAt, updatedAt: input.occurredAt, observation: null, failure: null };
}
