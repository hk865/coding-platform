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
import { rejected } from '../../../contracts/core/rejections.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { EncodedRecord, GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import { lookupAll } from '../persistence/lookup-all.js';
import type { RoleLineOperationV1 } from '../model/session-contracts.js';     // O1a's actual model type
import type { MemberCreateActionV1 } from '../state/member-creation.js';
import {
  CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP, decodeSessionOperationRecord,
} from '../sessions/session-record-codecs.js';

/** One row per `role_line`/`member_create` operation, derived by `action.kind`; the writer's record is the row. */
export type RoleLineOperationReadV1 =
  | {
    operation: OperationRef;
    action: 'role_line';
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
  }
  | {
    operation: OperationRef;
    action: 'member_create';
    phase: RoleLineOperationV1['phase'];
    progress: MemberCreateActionV1['progress'];         // member has no steps/result
  };
export interface RoleLineOperationReadPort {
  readRoleLineOperations(ctx: CoreCallContext, input: { workspace: WorkspaceScope }):
    Promise<ReadResult<readonly RoleLineOperationReadV1[]>>;
}

const RECORD_PHASES = ['accepted', 'running', 'completed', 'failed', 'unknown'] as const;

export function createRoleLineOperationsRead(deps: {
  records: GoalRecordTransactionPort & RecordLookupPort;
}): RoleLineOperationReadPort {
  return {
    async readRoleLineOperations(ctx, input) {
      const workspace = isRecord(input) && isRecord(input.workspace) ? input.workspace : null;
      if (workspace === null || !nonEmpty(workspace.projectId) || !nonEmpty(workspace.workspaceId)) {
        return rejected('invalid', 'role-lines/operations requires a {projectId,workspaceId} workspace');
      }
      if (workspace.projectId !== ctx.projectId) return rejected('forbidden', 'the workspace belongs to another project');
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
            rows.push({ operation: record.ref, action: 'role_line', phase: record.phase, actionPhase: action.phase,
              steps: action.steps, result: action.result, lastCompleted: action.lastCompleted,
              candidate: action.candidate, pendingRegions: action.pendingRegions, explorations: action.explorations,
              batchRefs: action.batchRefs, route: action.route, baseCatalogPin: action.baseCatalogPin });
          } else if (action.kind === 'member_create') {
            rows.push({ operation: record.ref, action: 'member_create', phase: record.phase,
              progress: action.progress });
          }
        }
      }
      return { status: 'ready', value: rows };
    },
  };
}
