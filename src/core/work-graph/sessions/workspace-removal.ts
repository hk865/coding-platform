/**
 * 7D2 WD: the owner that withdraws a workspace which never entered the
 * architecture graph, or removes one which did.
 *
 * Both kinds share the order below: the trusted Host boundary, one exact
 * registration read, the `removedAt` retry branch, the main-workspace rule and
 * the graph membership rule. `remove` additionally judges the workspace's
 * unfinished targets and closes the open region responsibility links; both
 * kinds then end the workspace's join and commit the four removal duties
 * through the frozen two-argument `removeWorkspaceKnowledge` seam.
 *
 * The owner reads no `configuration/` or `tasks/` service or type: the
 * reconcile candidate reader, the open-region-line reader, the registration
 * read and the catalog membership are injected as structural ports by the
 * composition root. Only contracts, `state/` and `model/` helpers are imported.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ProjectScope, SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { SessionWorkLink } from '../../../contracts/core/session.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import type { GoalSnapshot, ProjectSnapshot, WorkspaceRef, WorkspaceSnapshot } from '../../../contracts/ledger.js';
import type { NotifyProjectInputV1, ProjectNoticeV1, RoleLineDutyV1 } from '../../../contracts/role-lines.js';
import { rawModuleId } from '../../../contracts/workspace-module-id.js';
import type { WorkspaceRemovalViewV1 } from '../../../contracts/workspace-removal.js';
import type { GoalRecordTransactionPort, StoreFailure, StoreResult } from '../../record-store/ports.js';
import type { CommitFragment } from '../persistence/command-executor.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import type { GraphWrite } from '../model/task-contracts.js';
import { responsibilityClaimChanges } from '../state/role-scope.js';
import type { ExplorationControlPort } from './exploration-control.js';
import { roleLineCommitContribution } from './role-scope-commit.js';
import { sessionWorkLinkRefKey } from './session-record-codecs.js';
import { trustedContext } from './trusted-context.js';

/** One open region link and its line's fixed duty; structurally the `tasks` read's shape. */
export type OpenRegionLineV1 = { session: SessionRef; link: SessionWorkLink; duty: RoleLineDutyV1 };

/** The frozen seam's counts plus this call's real registration receipt (WD-26). */
type WorkspaceKnowledgeRemovalV1 = {
  releasedClaims: number;
  deletedIndexRows: number;
  deletedLinks: number;
  cursor: CommitCursor;
  replayed: boolean;
};

export type WorkspaceRemovalDeps = {
  records: GoalRecordTransactionPort;
  now(): string;
  registration: {
    read(ctx: CoreCallContext, scope: WorkspaceScope):
      Promise<ReadResult<{ project: ProjectSnapshot; workspace: WorkspaceSnapshot }>>;
  };
  targets: {
    listGoals(scope: WorkspaceScope, signal: AbortSignal):
      Promise<ReadResult<{ records: readonly GoalSnapshot[]; damaged: readonly string[] }>>;
    listRuns(scope: WorkspaceScope, status: 'starting' | 'running', signal: AbortSignal):
      Promise<ReadResult<{ records: readonly RunSnapshot[]; damaged: readonly string[] }>>;
  };
  regionLines: {
    readOpen(ctx: CoreCallContext, projectId: string): Promise<ReadResult<readonly OpenRegionLineV1[]>>;
  };
  knowledge: {
    /** `createWorkspaceKnowledgeRemoval`'s bound factory; the composition root injects it. */
    bind(ctx: CoreCallContext, requestId: string, contribution: CommitFragment): {
      removeWorkspaceKnowledge(projectRef: ProjectScope, workspaceRef: WorkspaceRef):
        Promise<StoreResult<WorkspaceKnowledgeRemovalV1>>;
    };
  };
  exploration: Pick<ExplorationControlPort, 'endJoin'>;
  notices: { notifyProject(input: NotifyProjectInputV1): Promise<WriteResult<ProjectNoticeV1>> };
  mainWorkspace(records: Pick<GoalRecordTransactionPort, 'readMany'>, projectId: string):
    Promise<ReadResult<string | null>>;
  catalog: {
    inGraph(ctx: CoreCallContext, projectId: string, workspaceId: string, main: string): Promise<ReadResult<boolean>>;
  };
};

export type WorkspaceRemovalRequestV1 = GraphWrite<{ workspace: WorkspaceScope; name?: string }>;

export function createWorkspaceRemoval(deps: WorkspaceRemovalDeps): {
  withdraw(ctx: CoreCallContext, request: WorkspaceRemovalRequestV1):
    Promise<WriteResult<WorkspaceRemovalViewV1>>;
  remove(ctx: CoreCallContext, request: WorkspaceRemovalRequestV1):
    Promise<WriteResult<WorkspaceRemovalViewV1>>;
} {
  return {
    withdraw: (ctx, request) => removeProjectWorkspace(deps, ctx, request, 'withdraw'),
    remove: (ctx, request) => removeProjectWorkspace(deps, ctx, request, 'remove'),
  };
}

/** A fragment with nothing in it; the registration write still stamps `removedAt` and emits its event. */
const EMPTY_COMMIT_FRAGMENT: CommitFragment = { records: [], claims: [], events: [], guards: [] };

async function removeProjectWorkspace(deps: WorkspaceRemovalDeps, ctx: CoreCallContext,
  request: WorkspaceRemovalRequestV1, kind: 'withdraw' | 'remove'):
  Promise<WriteResult<WorkspaceRemovalViewV1>> {
  const trusted = trustedContext(ctx, kind === 'withdraw' ? 'a workspace withdrawal' : 'a workspace removal');
  if (!trusted.ok) return trusted.rejection;
  const scope = request.input.workspace;
  const projectRef: ProjectScope = { projectId: scope.projectId };
  const workspaceRef: WorkspaceRef = {
    aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId,
  };
  const registration = await deps.registration.read(ctx, scope);
  if (registration.status !== 'ready') return readRejectionOf(registration, `workspace ${scope.workspaceId}`);
  // WD-21: an already marked workspace only finishes its index cleanup (and, for `remove`, its notice);
  // the main-workspace, graph and target judgements ran on the first call and are not repeated.
  if (registration.value.workspace.removedAt !== undefined) {
    return finishRemoval(deps, ctx, request, kind, scope, projectRef, workspaceRef);
  }
  const main = await deps.mainWorkspace(deps.records, scope.projectId);
  if (main.status !== 'ready') return readRejectionOf(main, 'the project main workspace');
  if (main.value === null) return rejected('unavailable', 'the project has no start_lines operation');
  if (main.value === scope.workspaceId) return rejected('invalid', 'the main workspace cannot be removed');
  const inGraph = await deps.catalog.inGraph(ctx, scope.projectId, scope.workspaceId, main.value);
  if (inGraph.status !== 'ready') return readRejectionOf(inGraph, 'the architecture graph membership');
  if (kind === 'withdraw' && inGraph.value) {
    return rejected('invalid', 'the workspace is already in the architecture graph; remove it instead');
  }
  if (kind === 'remove' && !inGraph.value) {
    return rejected('invalid', 'the workspace is not in the architecture graph; withdraw it instead');
  }

  let contribution = EMPTY_COMMIT_FRAGMENT;
  if (kind === 'remove') {
    const blocked = await unfinishedTargetsOf(deps, ctx, scope);
    if (blocked !== null) return blocked;
    const links = await openRegionLinksOf(deps, ctx, scope, main.value);
    if (links.status !== 'ready') return readRejectionOf(links, 'the open region links');
    const close = closeFragmentOf(projectRef, links.value);
    if (!close.ok) return close.rejection;
    contribution = close.fragment;
  }

  // WD-03/04: ending the join is best-effort skip only for "no join" and "already ended"; every other
  // refusal is the removal's own refusal. `withdraw` does it too, before the one commit.
  const join = await deps.exploration.endJoin(ctx,
    { projectId: scope.projectId, workspaceId: scope.workspaceId });
  if (join.status !== 'committed' && join.code !== 'not_found' && join.code !== 'invalid') return join;

  const counts = await deps.knowledge.bind(ctx, request.meta.requestId, contribution)
    .removeWorkspaceKnowledge(projectRef, workspaceRef);
  if (counts.status !== 'ready') return storeRejectionOf(counts);
  const removedAt = await reReadRemovedAt(deps, ctx, scope);
  if (removedAt.status !== 'ready') {
    return readRejectionOf(removedAt, `the workspace ${scope.workspaceId} registration`);
  }
  if (kind === 'remove') {
    const notice = await notifyRemoval(deps, request, scope, projectRef);
    if (notice.status !== 'committed') return notice;
  }
  return committedView(projectRef, workspaceRef, removedAt.value, counts.value);
}

/** WD-21's shared retry shape: continue the cleanup, then (for `remove`) replay the notice. */
async function finishRemoval(deps: WorkspaceRemovalDeps, ctx: CoreCallContext,
  request: WorkspaceRemovalRequestV1, kind: 'withdraw' | 'remove', scope: WorkspaceScope,
  projectRef: ProjectScope, workspaceRef: WorkspaceRef): Promise<WriteResult<WorkspaceRemovalViewV1>> {
  const counts = await deps.knowledge.bind(ctx, request.meta.requestId, EMPTY_COMMIT_FRAGMENT)
    .removeWorkspaceKnowledge(projectRef, workspaceRef);
  if (counts.status !== 'ready') return storeRejectionOf(counts);
  const removedAt = await reReadRemovedAt(deps, ctx, scope);
  if (removedAt.status !== 'ready') {
    return readRejectionOf(removedAt, `the workspace ${scope.workspaceId} registration`);
  }
  if (kind === 'remove') {
    const notice = await notifyRemoval(deps, request, scope, projectRef);
    if (notice.status !== 'committed') return notice;
  }
  return committedView(projectRef, workspaceRef, removedAt.value, counts.value);
}

/**
 * WD-08/WD-09: every goal not `cancelled` (active and paused both block) and every `starting`/`running`
 * Run block the removal with one `busy` sentence; a damaged target record is `unavailable`, never skipped.
 */
async function unfinishedTargetsOf(deps: WorkspaceRemovalDeps, ctx: CoreCallContext,
  scope: WorkspaceScope): Promise<CoreRejection | null> {
  const goals = await deps.targets.listGoals(scope, ctx.signal);
  if (goals.status !== 'ready') return readRejectionOf(goals, 'the workspace goals');
  const starting = await deps.targets.listRuns(scope, 'starting', ctx.signal);
  if (starting.status !== 'ready') return readRejectionOf(starting, 'the workspace starting runs');
  const running = await deps.targets.listRuns(scope, 'running', ctx.signal);
  if (running.status !== 'ready') return readRejectionOf(running, 'the workspace running runs');

  const liveGoals = goals.value.records.filter((goal) => goal.desiredState !== 'cancelled')
    .sort((left, right) => compareIds(left.ref.goalId, right.ref.goalId));
  const liveRuns = [...starting.value.records, ...running.value.records]
    .sort((left, right) => compareIds(left.ref.runId, right.ref.runId));
  const segments: string[] = [];
  if (liveGoals.length > 0) {
    segments.push(`goals ${liveGoals.map((goal) => `${goal.ref.goalId} (${goal.desiredState})`).join(', ')}`);
  }
  if (liveRuns.length > 0) {
    segments.push(`runs ${liveRuns.map((run) => `${run.ref.runId} (${run.status})`).join(', ')}`);
  }
  if (segments.length > 0) {
    return rejected('busy', `the workspace still has unfinished targets: ${segments.join('; ')}`);
  }
  const damaged = [...goals.value.damaged, ...starting.value.damaged, ...running.value.damaged]
    .sort(compareIds);
  if (damaged.length > 0) return rejected('unavailable', `a workspace target record is damaged: ${damaged[0]!}`);
  return null;
}

/** WD-11: the module `responsible` links whose module lives in the workspace being removed. */
async function openRegionLinksOf(deps: WorkspaceRemovalDeps, ctx: CoreCallContext, scope: WorkspaceScope,
  main: string): Promise<ReadResult<readonly OpenRegionLineV1[]>> {
  const read = await deps.regionLines.readOpen(ctx, scope.projectId);
  if (read.status !== 'ready') return read;
  return {
    status: 'ready',
    value: read.value.filter((line) => line.link.ref.relation === 'responsible'
      && line.link.until === null
      && line.link.ref.target.kind === 'module'
      && line.link.ref.target.ref.projectId === scope.projectId
      && (rawModuleId(line.link.ref.target.ref.moduleId).workspaceId ?? main) === scope.workspaceId),
  };
}

/** The close fragment is built only by `roleLineCommitContribution` and `responsibilityClaimChanges`. */
function closeFragmentOf(projectRef: ProjectScope, lines: readonly OpenRegionLineV1[]):
  { ok: true; fragment: CommitFragment } | { ok: false; rejection: CoreRejection } {
  return roleLineCommitContribution({
    projectRef,
    records: [],
    guards: lines.map((line) => ({
      refKey: sessionWorkLinkRefKey(line.link.ref), expectedRevision: line.link.revision,
    })),
    links: lines.map((line) => ({
      link: line.link.ref,
      next: { ...line.link, revision: line.link.revision + 1, until: null },
    })),
    claimChanges: responsibilityClaimChanges({
      projectRef,
      close: lines.map((line) => ({ link: line.link.ref, duty: line.duty })),
      open: [],
    }),
    // `until` is the closed link's null placeholder; the commit's real cursor fills it.
    bindings: lines.map((line) => ({ link: line.link.ref, field: 'until' as const })),
    events: [],
    allocation: null,
  }, null);
}

/** The registration re-read after the commit; `removedAt` must now be there (WD-21's receipt). */
async function reReadRemovedAt(deps: WorkspaceRemovalDeps, ctx: CoreCallContext,
  scope: WorkspaceScope): Promise<ReadResult<string>> {
  const registration = await deps.registration.read(ctx, scope);
  if (registration.status !== 'ready') {
    return rejected('unavailable', registration.status === 'rejected'
      ? registration.reason : `the workspace ${scope.workspaceId} registration is not ready`);
  }
  const removedAt = registration.value.workspace.removedAt;
  if (removedAt === undefined) return rejected('unavailable', 'the workspace removal did not record a removal time');
  return { status: 'ready', value: removedAt };
}

/** WD-14: the one `workspace_removed` notice; its operation identity makes a retry a replay. */
function notifyRemoval(deps: WorkspaceRemovalDeps, request: WorkspaceRemovalRequestV1,
  scope: WorkspaceScope, projectRef: ProjectScope): Promise<WriteResult<ProjectNoticeV1>> {
  const name = request.input.name ?? scope.workspaceId;
  const operation: OperationRef = {
    aggregateType: 'CoreOperation', projectId: scope.projectId,
    operationId: `workspace_remove:${scope.workspaceId}`,
  };
  return deps.notices.notifyProject({
    projectRef,
    kind: 'workspace_removed',
    summary: `the workspace ${name} was removed from this project`,
    operation,
  });
}

function committedView(projectRef: ProjectScope, workspaceRef: WorkspaceRef, removedAt: string,
  counts: WorkspaceKnowledgeRemovalV1): WriteResult<WorkspaceRemovalViewV1> {
  return {
    status: 'committed',
    value: {
      projectRef, workspaceRef, removedAt,
      releasedClaims: counts.releasedClaims,
      deletedIndexRows: counts.deletedIndexRows,
      deletedLinks: counts.deletedLinks,
    },
    replayed: counts.replayed,
    cursor: counts.cursor,
  };
}

/** A failed read keeps its own rejection; a missing or unready one is the caller's sentence. */
function readRejectionOf<T>(read: ReadResult<T>, what: string): CoreRejection {
  if (read.status === 'rejected') return read;
  return read.status === 'not_found'
    ? rejected('not_found', `${what} does not exist`)
    : rejected('unavailable', `${what} is not ready`);
}

/** The store result's own code and reason; a revision conflict keeps its pins. */
function storeRejectionOf(failure: StoreFailure): CoreRejection {
  return failure.code === 'revision_conflict'
    ? storeFailureToRejection(failure, failure.current)
    : storeFailureToRejection(failure);
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
