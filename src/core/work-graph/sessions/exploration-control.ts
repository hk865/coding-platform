/**
 * The exploration control: the person's stop/continue of the initialization exploration, and the coarse-split half
 * of “不对，重新提”. It commits only through the one `executeWriteCommand` with the delayed read/decide, so a
 * replayed public request never re-reads the target or re-judges whether the operation can still be stopped (M2).
 * The region-batch repropose creates the follow-up operation via the one shared birth.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { GraphWrite } from '../model/task-contracts.js';
import type { RoleLineOperationV1 } from '../model/session-contracts.js';
import type { ArchitectureProposalBatchRef } from '../../../contracts/architecture-proposal.js';
import { queryJobRefFor } from '../../../contracts/query-job.js';
import type { QueryRunRef } from '../../../contracts/query-job.js';
import { sameJson } from '../../../contracts/fingerprint.js';
import { catalogPinOf, readCurrentCatalogWindow } from '../architecture/catalog-service.js';
import {
  explorationDepthOf, holdExploration, markRoundReopen, releaseExploration,
} from '../state/exploration-control.js';
import { explorationGroupsOf } from '../state/role-line-action.js';
import type {
  ColdStartExplorationQueryRefV1, ColdStartPhaseV1, ExplorationDepthV1,
} from '../state/role-line-action.js';
import { newExplorationFollowUpAction } from '../state/exploration-followup.js';
import {
  readColdStartRecord, readWorkspaceJoinRecord, type ColdStartServiceDeps,
} from './cold-start-service.js';
import {
  ensureExplorationFollowUp, repairNoticeOf, repairReadBase, reproposeSourcesOf,
} from './exploration-followup-service.js';
import { failedRoleLineRecordOf } from './role-line-operations.js';
import { roleLineOperationCommit, writeRoleLineOperation } from './role-line-operation-write.js';
import { trustedContext } from './trusted-context.js';
import type { executeWriteCommand } from '../persistence/command-executor.js';

export type ExplorationControlViewV1 = {
  operation: { aggregateType: 'CoreOperation'; projectId: string; operationId: string };
  revision: number;
  action: 'cold_start' | 'workspace_join';
  phase: 'accepted' | 'running' | 'completed' | 'failed' | 'unknown';   // the record's phase
  actionPhase: ColdStartPhaseV1 | 'coarse_split' | 'regions' | 'proposals';  // the payload phase
  held: boolean;
  depth: ExplorationDepthV1;
  plannedRounds: number | null;
};

export type ExplorationCancelPort = (ctx: CoreCallContext, runs: readonly QueryRunRef[]) => Promise<void>;

export type ExplorationControlDeps = Pick<ColdStartServiceDeps,
  'records' | 'queries' | 'proposals' | 'sessions' | 'knowledge' | 'now'> & {
  /** The executor itself; the control passes its delayed `read`/`decide` and the shared commit shape. */
  write: typeof executeWriteCommand;
  /** R-03: abort the marked rounds through the Runtime's one entered-Turn table, after the hold commit. */
  cancel: ExplorationCancelPort;
};

type TargetV1 = { kind: 'cold_start' | 'workspace_join'; record: RoleLineOperationV1;
  action: { phase: string; explorations?: ColdStartExplorationQueryRefV1[]; result: RoleLineOperationV1['action']['result'];
    depth?: ExplorationDepthV1; plannedRounds?: number } };

type WorkspaceInput = { projectId: string; workspaceId: string };

function targetReadFailure(read: { status: string; code?: string; reason?: string }): CoreRejection {
  return read.status === 'rejected'
    ? read as CoreRejection
    : rejected('invalid', 'this workspace has no unfinished exploration');
}

function viewOf(target: TargetV1): ExplorationControlViewV1 {
  const action = target.action;
  return { operation: { ...target.record.ref }, revision: target.record.revision, action: target.kind,
    phase: target.record.phase as ExplorationControlViewV1['phase'], actionPhase: action.phase as ExplorationControlViewV1['actionPhase'],
    held: action.result?.status === 'waiting', depth: explorationDepthOf(action),
    plannedRounds: action.plannedRounds ?? null };
}

/** The one target read: this workspace's join first, then this workspace's cold start. A replayed receipt still
 *  answers after the operation completed, so its fresh view read includes finished records (M2). */
async function findTarget(deps: ExplorationControlDeps, workspace: WorkspaceInput,
  includeFinished = false): Promise<ReadResult<TargetV1>> {
  const unfinished = (phase: string): boolean => phase === 'accepted' || phase === 'running';
  const join = await readWorkspaceJoinRecord(deps.records, workspace.projectId, workspace.workspaceId);
  if (join.status === 'rejected') return join;
  if (join.status === 'ready' && (includeFinished || unfinished(join.value.record.phase))) {
    return { status: 'ready', value: { kind: 'workspace_join', record: join.value.record, action: join.value.action } };
  }
  const cold = await readColdStartRecord(deps.records, workspace.projectId);
  if (cold.status === 'rejected') return cold;
  if (cold.status === 'ready' && cold.value.record.workspaceId === workspace.workspaceId
    && (includeFinished || unfinished(cold.value.record.phase))) {
    return { status: 'ready', value: { kind: 'cold_start', record: cold.value.record, action: cold.value.action } };
  }
  return rejected('invalid', 'this workspace has no unfinished exploration');
}

/** The last round of every group that has not answered; those are the rounds a stop marks (R-04). */
async function unansweredGroupTails(deps: ExplorationControlDeps, ctx: CoreCallContext, target: TargetV1):
  Promise<ReadResult<ColdStartExplorationQueryRefV1[]>> {
  const tails: ColdStartExplorationQueryRefV1[] = [];
  for (const group of explorationGroupsOf(target.action.explorations ?? [])) {
    const last = group.at(-1)!;
    const read = await deps.queries.readQueryJob(ctx,
      queryJobRefFor(last.queryRunRef.projectId, last.queryRunRef.workspaceId, last.queryRunRef.queryJobId));
    if (read.status !== 'ready') return read;
    if (read.value.job.job.status === 'answered') continue;
    tails.push(last);
  }
  return { status: 'ready', value: tails };
}

export type ExplorationControlPort = {
  stop(ctx: CoreCallContext, request: GraphWrite<{ workspace: WorkspaceInput }>):
    Promise<WriteResult<ExplorationControlViewV1>>;
  resume(ctx: CoreCallContext, request: GraphWrite<{ workspace: WorkspaceInput }>):
    Promise<WriteResult<ExplorationControlViewV1>>;
  beginRepropose(ctx: CoreCallContext, input: {
    projectId: string; workspaceId: string; batchRef: ArchitectureProposalBatchRef; reason: string;
  }): Promise<WriteResult<{ target: 'coarse_split' | 'followup'; operation: OperationRef }>>;
  /** WD-03/04: mark the join failed and abort its entered rounds; no join or an already ended one is a rejection. */
  endJoin(ctx: CoreCallContext, input: { projectId: string; workspaceId: string }):
    Promise<WriteResult<{ operation: OperationRef; revision: number; ended: boolean }>>;
};

export function createExplorationControl(deps: ExplorationControlDeps): ExplorationControlPort {
  async function controlWrite(ctx: CoreCallContext, request: GraphWrite<{ workspace: WorkspaceInput }>,
    command: 'stop' | 'continue'): Promise<WriteResult<ExplorationControlViewV1>> {
    const trusted = trustedContext(ctx, 'an exploration control write');
    if (!trusted.ok) return trusted.rejection;
    const workspace = request.input.workspace;
    let prior: RoleLineOperationV1 | null = null;
    let next: RoleLineOperationV1 | null = null;
    let cancelRefs: ColdStartExplorationQueryRefV1[] = [];
    const written = await deps.write(deps.records, {
      operation: 'role-line-operation',
      principal: ctx.principal as never,
      commandId: `exploration-${command}:${request.meta.requestId}`,
      // M2: the receipt identity is the public request (its scope and id), not the target the body names, so the
      // same id with another target is the receipt's fingerprint conflict rather than a second read.
      scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null },
      fingerprintInput: { workspace } as never,
      read: async () => {
        const target = await findTarget(deps, workspace);
        if (target.status !== 'ready') return targetReadFailure(target);
        if (command === 'continue') {
          if (target.value.action.result?.status !== 'waiting') {
            return rejected('invalid', 'this exploration is not stopped');
          }
          return { status: 'ready', facts: { target: target.value, refs: [] } };
        }
        const tails = await unansweredGroupTails(deps, ctx, target.value);
        if (tails.status !== 'ready') return targetReadFailure(tails);
        return { status: 'ready', facts: { target: target.value, refs: tails.value } };
      },
      decide: (facts: { target: TargetV1; refs: ColdStartExplorationQueryRefV1[] }) => {
        prior = facts.target.record;
        const action = command === 'stop'
          ? markRoundReopen(holdExploration(prior.action), facts.refs, null) : releaseExploration(prior.action);
        next = { ...prior, revision: prior.revision + 1, updatedAt: deps.now(), action };
        cancelRefs = facts.refs;
        return { decision: null };
      },
      ...roleLineOperationCommit({ now: deps.now }, trusted.actor, () => ({ prior, next: next! })),
    });
    if (written.status === 'refused') return rejected('invalid', 'the exploration command was refused');
    if (written.status !== 'committed') return written;
    if (command === 'stop' && cancelRefs.length > 0) {
      await deps.cancel(ctx, cancelRefs.map((ref) => ref.queryRunRef));
    }
    // The committed view is the record the write left behind; a replayed receipt never ran `decide`, so the fresh
    // target read is also what answers the replay. The read happens after the receipt, never before it.
    const fresh = await findTarget(deps, workspace, written.replayed);
    if (fresh.status !== 'ready') return targetReadFailure(fresh);
    const value = viewOf(fresh.value);
    // A replayed receipt answers with the first commit's revision; the later record only supplies the display
    // fields (M2: the receipt, not the current target, is the replay's answer).
    return { status: 'committed', value: written.replayed ? { ...value, revision: written.value.revision } : value,
      replayed: written.replayed, cursor: written.cursor };
  }

  /** WD-03/04: the owner's one way to end a join a person withdrew. Only the real failed-record write is
   *  committed; a missing or already ended join is a rejection, never a fake `committed` with a zero cursor. */
  async function endJoin(ctx: CoreCallContext, input: { projectId: string; workspaceId: string }):
    Promise<WriteResult<{ operation: OperationRef; revision: number; ended: boolean }>> {
    const trusted = trustedContext(ctx, 'a join end write');
    if (!trusted.ok) return trusted.rejection;
    const join = await readWorkspaceJoinRecord(deps.records, input.projectId, input.workspaceId);
    if (join.status === 'rejected') return join;
    if (join.status === 'not_found') return rejected('not_found', 'this workspace has no join operation');
    const prior = join.value.record;
    if (prior.phase !== 'accepted' && prior.phase !== 'running') {
      return rejected('invalid', 'the join operation already ended');
    }
    // WD-04: the same target read and unanswered-tail read `stop` uses; the Runtime only aborts entered rounds.
    const target = await findTarget(deps, input, true);
    if (target.status !== 'ready') return targetReadFailure(target);
    const tails = await unansweredGroupTails(deps, ctx, target.value);
    if (tails.status !== 'ready') return targetReadFailure(tails);
    const next = failedRoleLineRecordOf(prior, prior.action,
      rejected('cancelled', 'the join was withdrawn'), deps.now());
    const written = await writeRoleLineOperation(deps, ctx, prior, next,
      { commandId: `workspace-join-end:${input.workspaceId}`,
        fingerprintInput: { workspaceId: input.workspaceId } });
    if (written.status !== 'committed') return written;
    if (tails.value.length > 0) await deps.cancel(ctx, tails.value.map((tail) => tail.queryRunRef));
    return { status: 'committed',
      value: { operation: { ...prior.ref }, revision: written.value.revision, ended: true },
      replayed: written.replayed, cursor: written.cursor };
  }

  async function beginRepropose(ctx: CoreCallContext, input: {
    projectId: string; workspaceId: string; batchRef: ArchitectureProposalBatchRef; reason: string;
  }): Promise<WriteResult<{ target: 'coarse_split' | 'followup'; operation: RoleLineOperationV1['ref'] }>> {
    const sources = await reproposeSourcesOf(ctx,
      { proposals: deps.proposals, sessions: deps.sessions, records: deps.records }, input.batchRef);
    if (sources.status !== 'ready') {
      return sources.status === 'rejected' ? sources
        : rejected('invalid', 'the proposal batch has no resolvable exploration source');
    }
    if (sources.value.length === 0) return rejected('invalid', 'the proposal batch has no members');
    const first = sources.value[0]!;
    const coarse = sources.value.every((source) => sameJson(source.operation.ref, first.operation.ref))
      && first.operation.action.action === 'cold_start' && first.operation.action.phase === 'coarse_split';
    if (!coarse) {
      const modules = new Map<string, { projectId: string; moduleId: string }>();
      for (const source of sources.value) {
        if (source.region === null) return rejected('invalid', 'a region batch source names no region block');
        modules.set(source.region.moduleId, { ...source.region });
      }
      // KC-3: “不对，重新提” on a repair batch is another repair of the same notice (its source round's operation says
      // which): its base is the record, and its question carries the places that round was given (计划 :198).
      const notice = await repairNoticeOf(deps.records, first.operation);
      if (notice.status !== 'ready') return notice;
      // R-18: the follow-up's base pin is the window at its birth, not the rejected batch's older pin.
      const window = await readCurrentCatalogWindow(deps.records, input.projectId,
        { lines: deps.knowledge, caller: ctx, ...repairReadBase(notice.value) });
      if (window.status !== 'ready') {
        return window.status === 'rejected' ? window
          : rejected('invalid', 'the project has no current architecture window');
      }
      const places = notice.value === null ? null : first.operation.action.followUp?.reason ?? null;
      const action = newExplorationFollowUpAction({ depth: explorationDepthOf(first.operation.action), kind: 'repropose',
        moduleRefs: [...modules.values()], reason: places === null ? input.reason : `${places}\n\n${input.reason}`,
        sourceBatchRef: input.batchRef, baseCatalogPin: catalogPinOf(window) });
      const scopedCtx: CoreCallContext = ctx.workspaceId === first.round.queryRunRef.workspaceId
        ? ctx : { ...ctx, workspaceId: first.round.queryRunRef.workspaceId };
      const born = await ensureExplorationFollowUp({ records: deps.records, sessions: deps.sessions, now: deps.now },
        scopedCtx, { projectId: input.projectId, workspaceId: first.round.queryRunRef.workspaceId,
          key: `repropose:${input.batchRef.batchId}`, action });
      if (born.status !== 'committed') return born;
      return { status: 'committed', value: { target: 'followup', operation: { ...born.value.operation } },
        replayed: born.replayed, cursor: born.cursor };
    }
    // The coarse card is still in `coarse_split`: mark its one group's last round and keep the operation there.
    const trusted = trustedContext(ctx, 'an exploration repropose write');
    if (!trusted.ok) return trusted.rejection;
    let prior: RoleLineOperationV1 | null = null;
    let next: RoleLineOperationV1 | null = null;
    const groupRef = first.operation.ref;
    const workspaceId = first.operation.workspaceId;
    const scopedCtx: CoreCallContext = ctx.workspaceId === workspaceId ? ctx : { ...ctx, workspaceId };
    const written = await deps.write(deps.records, {
      operation: 'role-line-operation',
      principal: ctx.principal as never,
      commandId: `exploration-repropose:${input.batchRef.batchId}`,
      scope: { projectId: input.projectId, workspaceId },
      fingerprintInput: { batchRef: input.batchRef, reason: input.reason } as never,
      read: async () => {
        const op = await deps.sessions.getSessionOperation(scopedCtx, groupRef);
        if (op.status !== 'ready') return targetReadFailure(op);
        const action = op.value.action;
        if (action.kind !== 'role_line' || action.action !== 'cold_start' || action.phase !== 'coarse_split') {
          return rejected('invalid', 'the coarse split is no longer waiting for another proposal');
        }
        const group = explorationGroupsOf(action.explorations ?? []).find((candidate) =>
          candidate[0]!.segment === 'coarse_split');
        if (group === undefined) return rejected('invalid', 'the coarse split has no exploration round');
        return { status: 'ready', facts: { record: op.value, last: group.at(-1)! } };
      },
      decide: (facts: { record: RoleLineOperationV1; last: ColdStartExplorationQueryRefV1 }) => {
        prior = facts.record;
        next = facts.last.reopen?.reason === input.reason ? prior
          : { ...prior, revision: prior.revision + 1, updatedAt: deps.now(),
            action: markRoundReopen(prior.action, [facts.last], input.reason) };
        return { decision: null };
      },
      ...roleLineOperationCommit({ now: deps.now }, trusted.actor, () => ({ prior, next: next! })),
    });
    if (written.status === 'refused') return rejected('invalid', 'the exploration command was refused');
    if (written.status !== 'committed') return written;
    return { status: 'committed', value: { target: 'coarse_split', operation: { ...groupRef } },
      replayed: written.replayed, cursor: written.cursor };
  }

  return {
    stop: (ctx, request) => controlWrite(ctx, request, 'stop'),
    resume: (ctx, request) => controlWrite(ctx, request, 'continue'),
    beginRepropose,
    endJoin,
  };
}
