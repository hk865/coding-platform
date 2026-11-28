/**
 * `role-lines/operations` (v4 :5934–:5979, moved to O1b): one row per `role_line`/`member_create` operation of a
 * workspace, derived by `action.kind`; the writer's record is the row. It pages the one unfinished-operation index
 * over the five record phases and decodes with the one operation codec; a damaged record is `unavailable`, never a
 * skipped row, and no field is fabricated.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { WorkspaceScope } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { ArchitectureProposalRef, ProposalRead } from '../../../contracts/architecture-proposal.js';
import type { DecisionSourceV1 } from '../../../contracts/goal-decisions.js';
import type { QueryRunRef } from '../../../contracts/query-job.js';
import type { EncodedRecord, GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import { readProjectBatches } from '../architecture/proposal-service.js';
import { lookupAll } from '../persistence/lookup-all.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import type { RoleLineOperationV1 } from '../model/session-contracts.js';     // O1a's actual model type
import type { MemberCreateActionV1 } from '../state/member-creation.js';
import { readMainWorkspace } from '../sessions/role-line-operations.js';
import {
  CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP, decodeSessionOperationRecord,
} from '../sessions/session-record-codecs.js';
import { findAnswerMessage } from '../tasks/decision-answer-lookup.js';
import type { WorkspaceGraphFactsV1 } from './workspace-graph-facts.js';

/** One row per `role_line`/`member_create` operation, derived by `action.kind`; the writer's record is the row. */
export type RoleLineOperationReadV1 =
  | {
    operation: OperationRef;
    action: 'role_line';
    main: boolean;                                       // this workspace is the project's main workspace
    inGraph: boolean;                                    // this workspace owns a module in the adopted architecture
    /** The coarse-split batch of this operation is frozen and its top-level module card is still unanswered. */
    awaitingTopLevelApproval: boolean;
    phase: RoleLineOperationV1['phase'];                // the record's phase
    actionPhase: RoleLineOperationV1['action']['phase']; // O1a's payload `action.phase`, a separate field
    steps: RoleLineOperationV1['action']['steps'];      // the fields sit under `action`
    result: RoleLineOperationV1['action']['result'];
    lastCompleted: RoleLineOperationV1['action']['lastCompleted'];
    candidate: RoleLineOperationV1['action']['candidate'];
    pendingRegions: RoleLineOperationV1['action']['pendingRegions'];
    explorations: RoleLineOperationV1['action']['explorations'];
    batchRefs: RoleLineOperationV1['action']['batchRefs'];
    route: RoleLineOperationV1['action']['route'];
    baseCatalogPin: RoleLineOperationV1['action']['baseCatalogPin'];
    depth: RoleLineOperationV1['action']['depth'];
    plannedRounds: RoleLineOperationV1['action']['plannedRounds'];
    followUp: RoleLineOperationV1['action']['followUp'];
  }
  | {
    operation: OperationRef;
    action: 'member_create';
    main: boolean;
    inGraph: boolean;
    phase: RoleLineOperationV1['phase'];
    progress: MemberCreateActionV1['progress'];         // member has no steps/result
  };
export interface RoleLineOperationReadPort {
  readRoleLineOperations(ctx: CoreCallContext, input: { workspace: WorkspaceScope }):
    Promise<ReadResult<readonly RoleLineOperationReadV1[]>>;
}

const RECORD_PHASES = ['accepted', 'running', 'completed', 'failed', 'unknown'] as const;

type RoleLineOperationsReadDeps = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  /** The composition root injects `workspaceGraphFacts`; the view layer never imports composition. */
  graph: {
    facts(ctx: CoreCallContext, projectId: string, workspaceId: string, main: string | null):
      Promise<ReadResult<WorkspaceGraphFactsV1>>;
  };
  /** The composition root injects the one proposal read; the view layer never imports composition. */
  proposal: {
    read(ctx: CoreCallContext, proposalRef: ArchitectureProposalRef): Promise<ReadResult<ProposalRead>>;
  };
};

/**
 * The coarse-split rounds whose frozen batch still shows a matching top-level module card unanswered. The round's
 * proposal names its `queryRunRef`, which is the only link before the operation's `batchRefs` are backfilled at
 * `proposals`; the proposal read gives the member's state and its batch card's key. The card is open while the
 * member is still `pending` and answered once a saved answer exists. The answer is its own commit before its
 * application moves the members, so a pending member with an answer is a closed card. A proposal or answer that
 * cannot be read is the read's failure, never "no card".
 */
async function unansweredCoarseRounds(deps: RoleLineOperationsReadDeps, ctx: CoreCallContext,
  workspace: WorkspaceScope, queryRunRefs: readonly QueryRunRef[]): Promise<ReadResult<ReadonlySet<string>>> {
  const wanted = new Set(queryRunRefs.map(canonicalKey));
  const batches = await readProjectBatches(deps.records, workspace.projectId);
  if (batches.status !== 'ready') return batches;
  const unanswered = new Set<string>();
  for (const batch of batches.value) {
    for (const memberRef of batch.members) {
      const read = await deps.proposal.read(ctx, memberRef);
      if (read.status !== 'ready') {
        return read.status === 'not_found'
          ? rejected('unavailable', `the proposal member ${canonicalKey(memberRef)} was not read`)
          : storeFailureToRejection(read, 'current' in read ? read.current : undefined);
      }
      const { proposal, cardKey } = read.value;
      if (proposal.state !== 'pending' || proposal.queryRunRef === null || proposal.queryRunRef === undefined
        || !wanted.has(canonicalKey(proposal.queryRunRef))) continue;
      if (cardKey === null) {
        return rejected('unavailable', `the proposal member ${canonicalKey(memberRef)} has no batch card`);
      }
      const source: DecisionSourceV1 = {
        kind: 'structural_proposal',
        key: cardKey,
        subject: { kind: 'project', projectRef: { projectId: workspace.projectId } },
        pins: [],
      };
      let answer;
      try {
        answer = await findAnswerMessage(deps.records, workspace, source);
      } catch (error) {
        const reason = isRecord(error) && typeof error['reason'] === 'string'
          ? error['reason'] : messageOf(error);
        return rejected('unavailable', `the top-level proposal card answer could not be read: ${reason}`);
      }
      if (answer === null) unanswered.add(canonicalKey(proposal.queryRunRef));
    }
  }
  return { status: 'ready', value: unanswered };
}

export function createRoleLineOperationsRead(deps: RoleLineOperationsReadDeps): RoleLineOperationReadPort {
  return {
    async readRoleLineOperations(ctx, input) {
      const workspace = isRecord(input) && isRecord(input.workspace) ? input.workspace : null;
      if (workspace === null || !nonEmpty(workspace.projectId) || !nonEmpty(workspace.workspaceId)) {
        return rejected('invalid', 'role-lines/operations requires a {projectId,workspaceId} workspace');
      }
      if (workspace.projectId !== ctx.projectId) return rejected('forbidden', 'the workspace belongs to another project');
      // The main workspace is one read for the request, not one per row (R-M3).
      const main = await readMainWorkspace(deps.records, workspace.projectId);
      if (main.status !== 'ready') return main;
      const graph = await deps.graph.facts(ctx, workspace.projectId, workspace.workspaceId, main.value);
      if (graph.status !== 'ready') return graph;
      const rows: RoleLineOperationReadV1[] = [];
      for (const phase of RECORD_PHASES) {
        let items: readonly EncodedRecord[];
        try {
          items = (await lookupAll<EncodedRecord>(deps.records, CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP,
            [workspace.projectId, workspace.workspaceId, phase])).items;
        } catch (error) {
          return rejected('unavailable', `the role-line operations could not be read: ${String(error)}`);
        }
        for (const encoded of items) {
          const decoded = decodeSessionOperationRecord(encoded);
          if (decoded.status !== 'decoded') return rejected('unavailable', `an operation is damaged: ${decoded.reason}`);
          const record = decoded.value;
          const action = record.action;
          if (action.kind === 'role_line') {
            rows.push({ operation: record.ref, action: 'role_line', main: graph.value.main,
              inGraph: graph.value.inGraph, awaitingTopLevelApproval: false,
              phase: record.phase, actionPhase: action.phase,
              steps: action.steps, result: action.result, lastCompleted: action.lastCompleted,
              candidate: action.candidate, pendingRegions: action.pendingRegions, explorations: action.explorations,
              batchRefs: action.batchRefs, route: action.route, baseCatalogPin: action.baseCatalogPin,
              depth: action.depth, plannedRounds: action.plannedRounds, followUp: action.followUp });
          } else if (action.kind === 'member_create') {
            rows.push({ operation: record.ref, action: 'member_create', main: graph.value.main,
              inGraph: graph.value.inGraph, phase: record.phase, progress: action.progress });
          }
        }
      }
      // The coarse-split round is named by its exploration entry, not by `batchRefs`: the operation's batches are
      // backfilled only at the later `proposals` phase, while the frozen batch and its card already exist.
      const coarse: { row: Extract<RoleLineOperationReadV1, { action: 'role_line' }>;
        queryRunRef: QueryRunRef }[] = [];
      for (const row of rows) {
        if (row.action !== 'role_line' || row.actionPhase !== 'coarse_split') continue;
        const round = row.explorations?.findLast(entry => entry.segment === 'coarse_split');
        if (round === undefined) continue;
        coarse.push({ row, queryRunRef: round.queryRunRef });
      }
      if (coarse.length > 0) {
        const unanswered = await unansweredCoarseRounds(deps, ctx,
          { projectId: workspace.projectId, workspaceId: workspace.workspaceId },
          coarse.map(entry => entry.queryRunRef));
        if (unanswered.status !== 'ready') return unanswered;
        for (const { row, queryRunRef } of coarse) {
          row.awaitingTopLevelApproval = unanswered.value.has(canonicalKey(queryRunRef));
        }
      }
      return { status: 'ready', value: rows };
    },
  };
}
