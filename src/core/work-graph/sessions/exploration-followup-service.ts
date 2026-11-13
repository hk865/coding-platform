/**
 * The exploration follow-up operation: one `exploration_followup` `role_line` operation opened by “不对，重新提” or
 * “再深一层”. It owns no second round/batch/card machine: it finds or opens the existing region line, submits one
 * region round per requested block, lets `endingOf` reopen a marked round once, and freezes this operation's pending
 * proposals through the one batch freezer. The source resolver is shared by the card's option table and the answer
 * side, so a card never shows a button the answer side would refuse.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ModuleRef } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { canonicalKey, sameJson } from '../../../contracts/fingerprint.js';
import type {
  ArchitectureProposalBatchRef, ArchitectureProposalBatchV1, ArchitectureProposalV1,
} from '../../../contracts/architecture-proposal.js';
import type { ArchitectureCatalogPinV1 } from '../../../contracts/architecture-catalog.js';
import { readOwnerRecord } from '../persistence/owner-record-read.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { SessionDirectoryPort } from '../model/session-contracts.js';
import type { RoleLineOperationV1 } from '../model/session-contracts.js';
import { catalogPinOf, readCurrentCatalogWindow } from '../architecture/catalog-service.js';
import type { KnowledgeReadBaseV1 } from '../../../contracts/knowledge.js';
import { decodeArchitectureProposalBatchRecord } from '../architecture/proposal-record-codecs.js';
import type { ArchitectureProposalService } from '../architecture/proposal-service.js';
import { roleExplorationQuestion } from '../state/role-exploration.js';
import { moduleDepth } from '../state/role-scope.js';
import {
  appendExploration, explorationGroupsOf, setPlannedRounds,
  type ColdStartExplorationQueryRefV1, type ExplorationDepthV1, type RoleLineActionV1,
} from '../state/role-line-action.js';
import { DEFAULT_EXPLORATION_DEPTH, explorationDepthOf } from '../state/exploration-control.js';
import {
  completeFollowup, explorationFollowUpOperationRef, knowledgeConflictQuestion, newExplorationFollowUpAction,
  saveBatchRefs, type ExplorationFollowUpActionV1,
} from '../state/exploration-followup.js';
import {
  endingOf, openExploration, readColdStartRecord, readWorkspaceJoinRecord, regionOfRound, submitExploration,
  type ColdStartServiceDeps,
} from './cold-start-service.js';
import { writeRoleLineOperation } from './role-line-operation-write.js';

export type ExplorationFollowUpResultV1 = {
  operation: OperationRef; revision: number; completed: boolean; plannedRounds: number;
};

export type ExplorationFollowUpDeps = ColdStartServiceDeps & {
  proposals: ColdStartServiceDeps['proposals'] & Pick<ArchitectureProposalService, 'readArchitectureProposal'>;
};

/** One resolved source of a structural card: its proposal, the exploration operation and the exact round. */
export type ReproposeSourceV1 = {
  proposal: ArchitectureProposalV1;
  operation: RoleLineOperationV1;
  round: ColdStartExplorationQueryRefV1;
  /** Null for the coarse-split round: it explores the top level, not a region block (R-16). */
  region: ModuleRef | null;
};

const EXPLORATION_ACTIONS = new Set(['cold_start', 'workspace_join', 'exploration_followup']);
/** A knowledge_conflict follow-up's key is `conflict:<noticeId>` (`begin`, `explorationFollowUpOperationRef`). */
const CONFLICT_KEY = 'conflict:';

/**
 * KC-3 (121-106 ②): the knowledge_conflict notice an exploration operation repairs, null for any other: a
 * `knowledge_conflict` follow-up's own (its key), or the mark of the repair batch a “不对，重新提” follow-up re-proposes.
 * A repair reads, tries, freezes and approves on the catalog the records last adopted (`base: 'recorded'`).
 */
export async function repairNoticeOf(records: Pick<GoalRecordTransactionPort, 'readMany'>,
  operation: { ref: OperationRef; action: Pick<RoleLineActionV1, 'followUp'> }):
  Promise<{ status: 'ready'; value: string | null } | CoreRejection> {
  const followUp = operation.action.followUp;
  if (followUp?.kind === 'knowledge_conflict') {
    const prefix = explorationFollowUpOperationRef(operation.ref.projectId, CONFLICT_KEY).operationId;
    return { status: 'ready', value: operation.ref.operationId.slice(prefix.length) };
  }
  if (followUp?.kind !== 'repropose' || followUp.sourceBatchRef === null) return { status: 'ready', value: null };
  const batch = await readOwnerRecord({ store: records, refKey: canonicalKey(followUp.sourceBatchRef),
    decode: decodeArchitectureProposalBatchRecord,
    readError: () => rejected('unavailable', 'the re-proposed batch cannot be read') });
  if (!batch.ok) return 'notFound' in batch ? rejected('invalid', 'the re-proposed batch does not exist') : batch.rejection;
  return { status: 'ready', value: (batch.value as ArchitectureProposalBatchV1).knowledgeConflict?.noticeId ?? null };
}

/** KC-3: a repair's reads take the record as their base; every other read takes the files. */
export function repairReadBase(noticeId: string | null): { base?: KnowledgeReadBaseV1 } {
  return noticeId === null ? {} : { base: 'recorded' };
}

/**
 * The one “can this batch still be re-proposed” read (M6): member proposal → its `operationRef` → that operation →
 * the round named by its `queryRunRef` → the round's region. Any missing link refuses the option; nothing is guessed
 * from the answering person's workspace. Both the card source and the answer side call this.
 */
export async function reproposeSourcesOf(ctx: CoreCallContext, deps: {
  proposals: Pick<ArchitectureProposalService, 'readArchitectureProposal'>;
  sessions: Pick<SessionDirectoryPort, 'getSessionOperation'>;
  records: ColdStartServiceDeps['records'];
}, batchRef: ArchitectureProposalBatchRef): Promise<ReadResult<ReproposeSourceV1[]>> {
  const batch = await readOwnerRecord({ store: deps.records, refKey: canonicalKey(batchRef),
    decode: decodeArchitectureProposalBatchRecord,
    readError: () => rejected('unavailable', 'the proposal batch cannot be read') });
  if (!batch.ok) {
    return 'notFound' in batch ? rejected('invalid', 'the proposal batch does not exist') : batch.rejection;
  }
  return reproposeSourcesFromMembers(ctx, deps, (batch.value as ArchitectureProposalBatchV1).members);
}

/**
 * The members half of the source read: the card source has already read the batch and its members, so it hands them
 * in and no second batch/member read happens; the answer side reaches it through `reproposeSourcesOf`.
 */
export async function reproposeSourcesFromMembers(ctx: CoreCallContext, deps: {
  proposals: Pick<ArchitectureProposalService, 'readArchitectureProposal'>;
  sessions: Pick<SessionDirectoryPort, 'getSessionOperation'>;
}, members: readonly import('../../../contracts/architecture-proposal.js').ArchitectureProposalRef[]):
  Promise<ReadResult<ReproposeSourceV1[]>> {
  const out: ReproposeSourceV1[] = [];
  for (const member of members) {
    const read = await deps.proposals.readArchitectureProposal(ctx, { proposalRef: member });
    if (read.status !== 'ready') return read;
    const proposal = read.value.proposal;
    if (proposal.operationRef === null || proposal.operationRef === undefined
      || proposal.queryRunRef === null || proposal.queryRunRef === undefined) {
      return rejected('invalid', 'this proposal has no saved exploration source');
    }
    const originCtx = { ...ctx, workspaceId: proposal.queryRunRef.workspaceId };
    const operation = await deps.sessions.getSessionOperation(originCtx, proposal.operationRef);
    if (operation.status !== 'ready') {
      return operation.status === 'rejected' ? operation
        : rejected('invalid', 'the proposal source operation cannot be read');
    }
    const action = operation.value.action;
    if (action.kind !== 'role_line' || !EXPLORATION_ACTIONS.has(action.action)) {
      return rejected('invalid', 'this proposal was not produced by exploration');
    }
    const round = (action.explorations ?? []).find((entry) => sameJson(entry.queryRunRef, proposal.queryRunRef));
    if (round === undefined) return rejected('invalid', 'this proposal has no exploration round');
    const region = regionOfRound(round, proposal.ref.projectId);
    // The coarse-split round has no region; every other exploration round must name its block.
    if (region === null && round.segment !== 'coarse_split') {
      return rejected('invalid', 'this exploration round names no region block');
    }
    out.push({ proposal, operation: operation.value as RoleLineOperationV1, round, region });
  }
  return { status: 'ready', value: out };
}

function viewOf(operation: OperationRef, record: RoleLineOperationV1, action: ExplorationFollowUpActionV1):
  ExplorationFollowUpResultV1 {
  return { operation: { ...operation }, revision: record.revision, completed: record.phase === 'completed',
    plannedRounds: action.plannedRounds };
}

async function initializationOf(deps: ExplorationFollowUpDeps, projectId: string, workspaceId: string):
  Promise<ReadResult<{ completed: boolean; depth: ExplorationDepthV1 } | null>> {
  const join = await readWorkspaceJoinRecord(deps.records, projectId, workspaceId);
  if (join.status === 'rejected') return join;
  if (join.status === 'ready') {
    return { status: 'ready', value: { completed: join.value.record.phase === 'completed',
      depth: explorationDepthOf(join.value.action) } };
  }
  const cold = await readColdStartRecord(deps.records, projectId);
  if (cold.status === 'rejected') return cold;
  if (cold.status !== 'ready' || cold.value.record.workspaceId !== workspaceId) {
    return { status: 'ready', value: null };
  }
  return { status: 'ready', value: { completed: cold.value.record.phase === 'completed',
    depth: explorationDepthOf(cold.value.action) } };
}

/**
 * The one birth of a follow-up operation, shared by `begin` (deepen) and the exploration control's repropose. Its
 * explicit command id is the public key, so a retry replays the same operation instead of making a second one.
 */
export async function ensureExplorationFollowUp(deps: {
  records: ColdStartServiceDeps['records'];
  sessions: Pick<SessionDirectoryPort, 'getSessionOperation'>;
  now(): string;
}, ctx: CoreCallContext, input: {
  projectId: string; workspaceId: string; key: string; action: ExplorationFollowUpActionV1;
}): Promise<WriteResult<ExplorationFollowUpResultV1>> {
  const ref = explorationFollowUpOperationRef(input.projectId, input.key);
  const scopedCtx: CoreCallContext = ctx.workspaceId === input.workspaceId ? ctx : { ...ctx, workspaceId: input.workspaceId };
  const record: RoleLineOperationV1 = { ref, revision: 1, workspaceId: input.workspaceId, action: input.action,
    phase: 'running', requestedAt: deps.now(), updatedAt: deps.now(), observation: null, failure: null };
  const written = await writeRoleLineOperation(deps, scopedCtx, null, record,
    { commandId: `exploration-followup:${input.key}`, fingerprintInput: {
      projectId: input.projectId, workspaceId: input.workspaceId, action: input.action } as never });
  if (written.status !== 'committed') return written;
  return { status: 'committed', replayed: written.replayed, cursor: written.cursor,
    value: viewOf(ref, record, input.action) };
}

export function createExplorationFollowUpService(deps: ExplorationFollowUpDeps): {
  drive(ctx: CoreCallContext, input: { operation: OperationRef }): Promise<ReadResult<ExplorationFollowUpResultV1>>;
  begin(ctx: CoreCallContext, input: {
    projectId: string; workspaceId: string; kind: 'repropose' | 'deepen' | 'knowledge_conflict'; moduleRefs: ModuleRef[];
    reason: string | null; sourceBatchRef: ArchitectureProposalBatchRef | null; requestId: string;
    depth?: ExplorationDepthV1; baseCatalogPin?: ArchitectureCatalogPinV1;
  }): Promise<WriteResult<ExplorationFollowUpResultV1>>;
  beginDeepen(ctx: CoreCallContext, input: {
    workspace: { projectId: string; workspaceId: string }; module: ModuleRef; requestId: string;
  }): Promise<WriteResult<ExplorationFollowUpResultV1>>;
} {
  type AtV1 = { ctx: CoreCallContext; input: { projectId: string; workspaceId: string };
    op: RoleLineOperationV1; action: ExplorationFollowUpActionV1 };

  async function write(at: AtV1, action: ExplorationFollowUpActionV1, phase?: 'completed' | 'failed'):
    Promise<ReadResult<ExplorationFollowUpResultV1>> {
    const next: RoleLineOperationV1 = { ...at.op, revision: at.op.revision + 1, updatedAt: deps.now(), action,
      phase: phase ?? at.op.phase };
    const written = await writeRoleLineOperation(deps, at.ctx, at.op, next, {
      commandId: `${at.op.ref.operationId}:${next.revision}`,
      fingerprintInput: { revision: next.revision, action: next.action } as never });
    if (written.status !== 'committed') return written;
    return { status: 'ready', value: viewOf(at.op.ref, next, action) };
  }

  /** One round per requested block, all opened in the source round's workspace (M6), then one commit. */
  async function openRounds(at: AtV1): Promise<ReadResult<ExplorationFollowUpResultV1>> {
    const { projectId } = at.input;
    const pin = at.action.baseCatalogPin;
    if (pin === null) return rejected('invalid', 'the follow-up operation has no base pin');
    const notice = await repairNoticeOf(deps.records, at.op);
    if (notice.status !== 'ready') return notice;
    const window = await readCurrentCatalogWindow(deps.records, projectId,
      { lines: deps.knowledge, caller: at.ctx, ...repairReadBase(notice.value) });
    if (window.status !== 'ready') return window;
    const lines = await deps.regionLines.readOpenRegionLines(at.ctx, { projectId });
    if (lines.status !== 'ready') return lines;
    // A follow-up round runs where its source round ran; a deepen has no source round and stays in this workspace.
    const sourceWorkspaces = new Map<string, string>();
    if (at.action.followUp.kind === 'repropose' && at.action.followUp.sourceBatchRef !== null) {
      const sources = await reproposeSourcesOf(at.ctx, { proposals: deps.proposals, sessions: deps.sessions,
        records: deps.records }, at.action.followUp.sourceBatchRef);
      if (sources.status === 'ready') {
        for (const source of sources.value) {
          if (source.region === null) return rejected('invalid', 'a re-proposed follow-up needs region blocks');
          sourceWorkspaces.set(source.region.moduleId, source.round.queryRunRef.workspaceId);
        }
      }
    }
    let next = setPlannedRounds(at.action, at.action.followUp.moduleRefs.length) as ExplorationFollowUpActionV1;
    const added: ColdStartExplorationQueryRefV1[] = [];
    for (const module of at.action.followUp.moduleRefs) {
      const line = lines.value.find((candidate) => candidate.duty === 'adviser'
        && candidate.link.ref.target.kind === 'module'
        && candidate.link.ref.target.ref.projectId === module.projectId
        && candidate.link.ref.target.ref.moduleId === module.moduleId)?.session ?? null;
      let chosen = line;
      if (chosen === null) {
        const opened = await deps.lines.openRegionLine(at.ctx, {
          commandId: `followup-region:${at.op.ref.operationId}:${module.moduleId}`,
          parentOperation: at.op.ref, duty: 'adviser', module, ...repairReadBase(notice.value) });
        if (opened.status === 'capacity_blocked' || opened.status === 'accepted') return stop(at);
        if (opened.status === 'rejected') return opened;
        chosen = opened.value.session!;
      }
      const reason = at.action.followUp.reason;
      const base = at.action.followUp.kind === 'deepen'
        ? roleExplorationQuestion('region', module, (moduleDepth(window.catalog.catalog, module.moduleId) + 2) as 1 | 2 | 3)
        : roleExplorationQuestion('region', module, 1);
      // 4-8: the conflict round's text is written in exactly one place (`conflictRepairText`), the question here.
      const question = at.action.followUp.kind === 'knowledge_conflict' ? knowledgeConflictQuestion(module, reason ?? '')
        : reason === null ? base
          : `${base}\n\nA person rejected the previous proposal and asked for one more exploration round: ${reason}`;
      const round = await openExploration(deps, at, { ...repairReadBase(notice.value), line: chosen, segment: 'region', region: module,
        key: `followup:${module.moduleId}`, question,
        ids: { queryJobId: `followup-query:${at.op.ref.operationId}:${module.moduleId}`,
          runId: `followup-run:${at.op.ref.operationId}:${module.moduleId}` },
        workspaceId: sourceWorkspaces.get(module.moduleId) ?? at.input.workspaceId });
      if (round.status !== 'ready') return round;
      added.push(round.value);
      next = appendExploration(next, round.value) as ExplorationFollowUpActionV1;
    }
    return write(at, next);
  }

  function stop(at: AtV1): ReadResult<ExplorationFollowUpResultV1> {
    return { status: 'ready', value: viewOf(at.op.ref, at.op, at.action) };
  }

  /** This operation's own pending refs: the freezer reads project-wide, so the window narrows it here (M9). */
  async function ownPending(at: AtV1):
    Promise<ReadResult<import('../../../contracts/architecture-proposal.js').ArchitectureProposalRef[]>> {
    const pending = await deps.proposals.readPendingArchitectureProposals(at.ctx,
      { projectRef: { projectId: at.input.projectId } });
    if (pending.status !== 'ready') return pending;
    const own: import('../../../contracts/architecture-proposal.js').ArchitectureProposalRef[] = [];
    for (const ref of pending.value) {
      const read = await deps.proposals.readArchitectureProposal(at.ctx, { proposalRef: ref });
      if (read.status !== 'ready') return read;
      if (sameJson(read.value.proposal.operationRef, at.op.ref)) own.push(ref);
    }
    return { status: 'ready', value: own };
  }

  /** The recovery half: same pin, not saved, every member's source is this operation; never re-freeze. */
  async function ownFrozen(at: AtV1): Promise<ReadResult<ArchitectureProposalBatchRef[]>> {
    const frozen = await deps.proposals.readFrozenArchitectureBatches(at.ctx,
      { projectRef: { projectId: at.input.projectId }, baseCatalogPin: at.action.baseCatalogPin! });
    if (frozen.status !== 'ready') return frozen;
    const own: ArchitectureProposalBatchRef[] = [];
    for (const ref of frozen.value) {
      if (at.action.batchRefs.some((saved) => sameJson(saved, ref))) continue;
      const sources = await reproposeSourcesOf(at.ctx, { proposals: deps.proposals, sessions: deps.sessions,
        records: deps.records }, ref);
      if (sources.status === 'ready' && sources.value.every((source) => sameJson(source.operation.ref, at.op.ref))) {
        own.push(ref);
      }
    }
    return { status: 'ready', value: own };
  }

  async function drive(ctx: CoreCallContext, input: { operation: OperationRef }):
    Promise<ReadResult<ExplorationFollowUpResultV1>> {
    const read = await deps.sessions.getSessionOperation(ctx, input.operation);
    if (read.status !== 'ready') return read;
    const record = read.value as RoleLineOperationV1;
    if (record.action.kind !== 'role_line' || record.action.action !== 'exploration_followup') {
      return rejected('invalid', 'not an exploration follow-up operation');
    }
    const action = record.action as ExplorationFollowUpActionV1;
    if (record.phase === 'completed') {
      return { status: 'ready', value: viewOf(record.ref, record, action) };
    }
    if (record.phase !== 'accepted' && record.phase !== 'running') {
      return rejected('unavailable', `the exploration follow-up operation is ${record.phase}`);
    }
    const at: AtV1 = { ctx, input: { projectId: record.ref.projectId, workspaceId: record.workspaceId }, op: record, action };
    if (action.result?.status === 'waiting') return stop(at);
    if (action.explorations.length === 0) return openRounds(at);
    let unfinished = false;
    for (const group of explorationGroupsOf(action.explorations)) {
      const end = await endingOf(deps, at, group);
      if (end.status !== 'ready') return end;
      if (end.value.kind === 'reopen') return write(at, appendExploration(action, end.value.entry) as ExplorationFollowUpActionV1);
      if (end.value.kind === 'running') unfinished = true;
    }
    if (unfinished) return stop(at);
    const frozen = await ownFrozen(at);
    if (frozen.status !== 'ready') return frozen;
    if (frozen.value.length > 0) {
      return write(at, saveBatchRefs(action, [...action.batchRefs, ...frozen.value]));
    }
    const pending = await ownPending(at);
    if (pending.status !== 'ready') return pending;
    if (pending.value.length === 0) return write(at, completeFollowup(action), 'completed');
    const notice = await repairNoticeOf(deps.records, record);
    if (notice.status !== 'ready') return notice;
    const batch = await deps.proposals.freezeArchitectureProposalBatch(ctx,
      { proposalRefs: pending.value, baseCatalogPin: action.baseCatalogPin!,
        ...(notice.value === null ? {} : { knowledgeConflict: { noticeId: notice.value } }) });
    if (batch.status !== 'ready') return batch;
    return write(at, saveBatchRefs(action, [...action.batchRefs, ...batch.value.map((entry) => ({ ...entry.ref }))]));
  }

  async function begin(ctx: CoreCallContext, input: {
    projectId: string; workspaceId: string; kind: 'repropose' | 'deepen' | 'knowledge_conflict'; moduleRefs: ModuleRef[];
    reason: string | null; sourceBatchRef: ArchitectureProposalBatchRef | null; requestId: string;
    depth?: ExplorationDepthV1; baseCatalogPin?: ArchitectureCatalogPinV1;
  }): Promise<WriteResult<ExplorationFollowUpResultV1>> {
    const key = input.kind === 'repropose'
      ? `repropose:${input.sourceBatchRef?.batchId ?? input.requestId}`
      : input.kind === 'deepen' ? `deepen:${input.requestId}` : `${CONFLICT_KEY}${input.requestId}`;
    // KC-3: a knowledge_conflict round's base pin is the last adopted catalog's (the conflict may keep the files unread).
    const window = input.baseCatalogPin === undefined
      ? await readCurrentCatalogWindow(deps.records, input.projectId, { lines: deps.knowledge, caller: ctx,
        ...(input.kind === 'knowledge_conflict' ? { base: 'recorded' as const } : {}) }) : null;
    if (window !== null && window.status !== 'ready') {
      return window.status === 'rejected' ? window
        : rejected('invalid', 'the project has no current architecture window');
    }
    const pin = input.baseCatalogPin ?? catalogPinOf(window!);
    // `beginDeepen` already read the initialization and passes its depth; only a caller without one reads it here.
    let depth = input.depth;
    if (depth === undefined) {
      const initialization = await initializationOf(deps, input.projectId, input.workspaceId);
      if (initialization.status !== 'ready') {
        return initialization.status === 'rejected' ? initialization
          : rejected('unavailable', 'the workspace initialization cannot be read');
      }
      depth = initialization.value?.depth ?? DEFAULT_EXPLORATION_DEPTH;
    }
    const action = newExplorationFollowUpAction({ depth, kind: input.kind, moduleRefs: input.moduleRefs, reason: input.reason,
      sourceBatchRef: input.sourceBatchRef, baseCatalogPin: pin });
    return ensureExplorationFollowUp({ records: deps.records, sessions: deps.sessions, now: deps.now }, ctx,
      { projectId: input.projectId, workspaceId: input.workspaceId, key, action });
  }

  async function beginDeepen(ctx: CoreCallContext, input: {
    workspace: { projectId: string; workspaceId: string }; module: ModuleRef; requestId: string;
  }): Promise<WriteResult<ExplorationFollowUpResultV1>> {
    const { projectId, workspaceId } = input.workspace;
    const initialization = await initializationOf(deps, projectId, workspaceId);
    if (initialization.status !== 'ready') {
      return initialization.status === 'rejected' ? initialization
        : rejected('unavailable', 'the workspace initialization cannot be read');
    }
    if (initialization.value === null || !initialization.value.completed) {
      return rejected('invalid', 'initialization is not complete');
    }
    const window = await readCurrentCatalogWindow(deps.records, projectId, { lines: deps.knowledge, caller: ctx });
    if (window.status !== 'ready') {
      return window.status === 'rejected' ? window
        : rejected('invalid', 'the project has no current architecture window');
    }
    if (!window.catalog.catalog.modules.some((module) => module.ref.projectId === projectId
      && module.ref.moduleId === input.module.moduleId)) {
      return rejected('invalid', 'the block is not in the catalogue');
    }
    return begin(ctx, { projectId, workspaceId, kind: 'deepen', moduleRefs: [{ ...input.module }], reason: null,
      sourceBatchRef: null, requestId: input.requestId, depth: initialization.value.depth,
      baseCatalogPin: catalogPinOf(window) });
  }

  return { drive, begin, beginDeepen };
}
