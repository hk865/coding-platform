/**
 * Slice 2C work-line read/write ports (spec §2).
 *
 * The WorkGraph boundary for the line reads, the node-detail reads and the pin
 * write. DTOs live in `src/contracts/work-line.ts`.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { GoalRef, WorkspaceSnapshot } from '../../../contracts/ledger.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import type {
  ArchivedLinePageV1, GraphHoverReadV1, LineConversationSourceV1, NodeDetailRequestV1, NodeDetailV1,
  WorkLineDetailV1, WorkLineListV1, WorkLineSectionPageV1,
} from '../../../contracts/work-line.js';
import type { GraphWrite, SessionDirectoryPort } from './session-contracts.js';

export type SessionDutyReadPort =
  (role: RoleConfigurationRef, ctx: CoreCallContext) => Promise<ReadResult<PlatformDutyV1 | 'unknown'>>;
export type LineSettingsSessionRead = SessionDirectoryPort['readSession'];  // 组合根注入（L9）
export interface WorkLineReadPort {
  listWorkLines(ctx: CoreCallContext, input: { workspace: WorkspaceScope }): Promise<ReadResult<WorkLineListV1>>;
  listArchivedLines(ctx: CoreCallContext, input: { workspace: WorkspaceScope;
    page: { limit: number; cursor?: string } }): Promise<ReadResult<ArchivedLinePageV1>>;             // limit 1..100
  readWorkLine(ctx: CoreCallContext, input: { workspace: WorkspaceScope; key: SessionRef }):
    Promise<ReadResult<WorkLineDetailV1 | { kind: 'branched'; heads: SessionRef[] }>>;                // key 是线里任一 Session
  readWorkLinePage(ctx: CoreCallContext, input: { workspace: WorkspaceScope; key: SessionRef;
    section: WorkLineSectionPageV1['section']; page: { limit: number; cursor?: string } }):
    Promise<ReadResult<WorkLineSectionPageV1>>;
  readWorkLineConversationSource(ctx: CoreCallContext, input: { workspace: WorkspaceScope; key: SessionRef }):
    Promise<ReadResult<LineConversationSourceV1>>;                                                    // 只给段（L12）
}
export interface NodeDetailReadPort {
  readGraphHover(ctx: CoreCallContext, input: { goalRef: GoalRef }): Promise<ReadResult<GraphHoverReadV1>>;
  readNodeDetail(ctx: CoreCallContext, input: NodeDetailRequestV1): Promise<ReadResult<NodeDetailV1>>;
}
export interface WorkLineSettingsPort {
  setLinePins(ctx: CoreCallContext, request: GraphWrite<{
    workspace: WorkspaceScope; add: SessionRef[]; remove: SessionRef[];
  }>): Promise<WriteResult<WorkspaceSnapshot>>;
}
