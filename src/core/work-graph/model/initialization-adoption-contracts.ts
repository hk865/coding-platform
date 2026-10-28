import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { WorkspaceScope } from '../../../contracts/core/identity.js';
import type {
  AdoptionContinueInputV1, AdoptionSaveAfterInputV1, AdoptionSaveBeforeInputV1, AdoptionStageWriteResultV1,
  ChecksConfigurationPinV1,
  ChecksConfirmationV1, ChecksSaveResultV1, ChecksSettingsSourceV1, InitializationAdoptInputV1,
  InitializationAdoptResultV1, InitializationAdoptionReadV1, InitializationAdoptionRecordV1,
  InitializationAdoptionRef,
} from '../../../contracts/initialization-adoption.js';
import type { RegisteredCommandCheck } from '../../../contracts/verification.js';

export interface InitializationAdoptionPort {
  /** The only entry that raises the record's generation (a new authorized submission); a retry replays. */
  accept(ctx: CoreCallContext, input: InitializationAdoptInputV1): Promise<
    { status: 'accepted'; operationRef: InitializationAdoptionRef; replayed: boolean;
      generation: number; cursor: CommitCursor }
    | CoreRejection>;
  /** The one explicit continue; it never replays the original receipt and never raises the generation. With no
   *  stored stop and no committed result it returns an unpersisted synthesized pending acknowledgement. */
  resume(ctx: CoreCallContext, input: AdoptionContinueInputV1): Promise<InitializationAdoptResultV1>;
  /** The recovery read: revision, generation, the next stage, the marks and the stored result. */
  read(ctx: CoreCallContext, input: { operationRef: InitializationAdoptionRef }):
    Promise<ReadResult<InitializationAdoptionReadV1>>;
  saveBefore(ctx: CoreCallContext, input: AdoptionSaveBeforeInputV1):
    Promise<AdoptionStageWriteResultV1>;
  saveAfter(ctx: CoreCallContext, input: AdoptionSaveAfterInputV1):
    Promise<AdoptionStageWriteResultV1>;
}
export interface ChecksEntryPort {
  applyChecksForAdoption(ctx: CoreCallContext, input: {
    scope: { projectId: string; workspaceId: string };
    source: ChecksConfigurationPinV1;
    child: { commandId: string; identityKey: string; fingerprint: string };
    previous: ChecksConfigurationPinV1 | null;
  }): Promise<ChecksSaveResultV1>;
}
export interface ChecksConfirmationPort {
  confirmInstalledChecks(ctx: CoreCallContext,
    input: { scope: { projectId: string; workspaceId: string } }): Promise<ReadResult<ChecksConfirmationV1>>;
}
/** The roles one workspace serves, from the in-memory Workflow configuration; synchronous, so no `unavailable` arm. */
export interface ServedRolesPort {
  readServedRoles(scope: WorkspaceScope): readonly string[];
}
/** The saved settings state one adoption stage compares after a reopen: the source, the full checks and the
 *  child that wrote them. `child: null` is a direct Host approval (the persisted field is absent, not null). */
export type StoredChecksStateV1 = {
  source: ChecksSettingsSourceV1;
  checks: readonly RegisteredCommandCheck[];
  checksRevision: number;                    // the save counter of this saved pair; 0 when absent
  child: { commandId: string; identityKey: string; fingerprint: string } | null;
};
/** The named saved-state read port (R6B3-07): the settings file's own facts, never the installed configuration. */
export interface SavedChecksReadPort {
  readSavedChecks(ctx: CoreCallContext,
    input: { scope: { projectId: string; workspaceId: string } }): Promise<ReadResult<StoredChecksStateV1>>;
}
/** J's one settings queue, published to L; an operation inside it must not call a queued settings route again. */
export interface SettingsSerialGatePort {
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
}
