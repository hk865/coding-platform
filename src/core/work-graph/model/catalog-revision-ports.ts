/**
 * Narrow ports the catalog revision planner reads through. The implementations
 * live in `tasks/` and `sessions/` and are bound by the composition root, so
 * `architecture/` never imports those subsystems (module boundary).
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { WorkspaceScope } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { PendingSessionWorkLink, SessionRecord, SessionWorkLink } from '../../../contracts/core/session.js';
import type { ResponsibilityMoveV1 } from '../../../contracts/note.js';
import type { RoleLineBindingIntentV1, RoleScopeClaimChangeV1 } from '../../../contracts/role-lines.js';
import type { GoalRecordTransactionPort, RecordGuard } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { SessionMessageCommitFragment } from './decision-contracts.js';
import type { ReanchorEventMaterialV1 } from '../state/reanchor.js';

/** The closure of one declared module task, read from the canonical Task facts. */
export type CatalogTaskClosureV1 = 'open' | 'satisfied' | 'cancelled' | 'superseded';

export type CatalogPlanTaskFactV1 = {
  taskId: string;
  moduleIds: readonly string[];
  closure: CatalogTaskClosureV1;
};

/** One Goal's current plan window and the pointer revision it was read at. */
export type CatalogPlanFactsV1 = {
  goalRef: GoalRef;
  revision: number;
  planRef: PlanRevisionRef | null;
  tasks: readonly CatalogPlanTaskFactV1[];
};

/**
 * One project-wide enumeration of the Goals and the ledger watermark its FIRST
 * read observed, before the enumeration finished. The planner turns the
 * watermark into the delete commit's `ledgerHorizon`, so a Goal or plan added
 * while the delete is being planned is `revision_conflict`, never a silent
 * delete.
 */
export type CatalogPlanFactsReadV1 = {
  plans: readonly CatalogPlanFactsV1[];
  watermark: CommitCursor | null;
};

export interface CatalogPlanFactsPort {
  /** G5 binds: `readGoalsByProject` + `readGoalPlanWindow` + `readCanonicalTaskFacts` + `taskClosureOf`. */
  read(records: GoalRecordTransactionPort & RecordLookupPort, projectId: string):
    Promise<ReadResult<CatalogPlanFactsReadV1>>;
}

export type CatalogResponsibilityFactsV1 = {
  sessions: ReadonlyMap<string, SessionRecord>;
  links: ReadonlyMap<string, SessionWorkLink>;
  guards: readonly RecordGuard[];
  /** The project's active catalog revision this call read, not a shared platform value. */
  activeRevision: number;
};

export type CatalogResponsibilityPlanInputV1 = {
  sessions: readonly SessionRecord[];
  links: readonly { link: SessionWorkLink['ref']; next: PendingSessionWorkLink | null }[];
  claimChanges: readonly RoleScopeClaimChangeV1[];
  bindings: readonly RoleLineBindingIntentV1[];
  events: readonly ReanchorEventMaterialV1[];
  guards: readonly RecordGuard[];
  identityKey: string;
  occurredAt: string;
  /** The project and active revision this contribution was planned against. */
  projectId: string;
  catalogRevision: number;
};

export interface CatalogResponsibilityPort {
  /** G5 binds: `readReanchorFacts` (duty/goals/guards) plus the open links and their
   * Sessions of the scope; `contribution` binds `roleLineCommitContribution`.
   * `moves` is this revision's own move list: the delete rule adds the closed
   * destination links those moves reopen to its facts, with their real
   * revisions as guards. */
  readFacts(records: GoalRecordTransactionPort & RecordLookupPort, ctx: CoreCallContext,
    scope: WorkspaceScope, moves: readonly ResponsibilityMoveV1[]): Promise<ReadResult<CatalogResponsibilityFactsV1>>;
  contribution(input: CatalogResponsibilityPlanInputV1):
    { ok: true; fragment: SessionMessageCommitFragment } | { ok: false; rejection: CoreRejection };
}
