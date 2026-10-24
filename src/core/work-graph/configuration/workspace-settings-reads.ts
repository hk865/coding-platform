/**
 * Shared Workspace-settings base operations for the two Workspace owners
 * (`decision-settings-service` and `line-settings-service`): the trusted bound
 * context, the one bound Workspace pin check, the one exact Workspace read and
 * the original-event replay.
 *
 * Each owner keeps its own business state transition, its own commit
 * conditions and the Workspace value it returns; only these protocol-identical
 * base operations live here. Replay reads the ORIGINAL recorded event, never
 * the current Workspace.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { WorkspaceSnapshot } from '../../../contracts/ledger.js';
import { canonicalOf } from '../../../contracts/fingerprint.js';
import { isNonNeg, isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type {
  DecodeResult,
  EncodedDomainEvent,
  GoalRecordTransactionPort,
  StoreCommitReceipt,
} from '../../record-store/ports.js';
import { canonicalRefKey, decodeWorkspaceSnapshot } from '../persistence/record-codecs.js';

export type Owned = {
  projectId: string;
  workspaceId: string;
  principal: CoreCallContext['principal'];
  signal: AbortSignal;
};

/** Only the two reads replay needs; both owners' ports include them. */
export type WorkspaceSettingsRecords = Pick<GoalRecordTransactionPort, 'readMany' | 'eventAt'>;

export type CommittedReceipt = Extract<StoreCommitReceipt, { status: 'committed' }>;

/** The owner's own exact receipt/event texts; `damaged` includes its trailing `: `. */
export type WorkspaceReplayTexts = {
  receipt: string;
  read: string;
  disagree: string;
  damaged: string;
};

export type WorkspaceEventDecoder = (
  event: EncodedDomainEvent,
) => DecodeResult<{ payload: { value: WorkspaceSnapshot } }>;

/** The trusted bound context; `forbiddenReason` is the owner's own exact text. */
export function ownScope(ctx: CoreCallContext, forbiddenReason: string): Owned | CoreRejection {
  if (!isRecord(ctx) || !nonEmpty(ctx.projectId) || !nonEmpty(ctx.workspaceId)
    || !isRecord(ctx.principal) || !isRecord(ctx.signal)) {
    return rejected('forbidden', forbiddenReason);
  }
  return { projectId: ctx.projectId, workspaceId: ctx.workspaceId, principal: ctx.principal, signal: ctx.signal };
}

export function isOwned(value: Owned | CoreRejection): value is Owned {
  return 'projectId' in value;
}

/**
 * `meta.expected` must be exactly one well-formed pin for the bound Workspace:
 * no extras, no duplicates, a safe non-negative revision. A malformed pin is
 * `invalid`, never a stale-pin `revision_conflict`. Returns the pin it read: the
 * line service compares with it; the decision service keeps its own later read
 * of `expected[0]` where it compares, as before.
 */
export function workspacePinProblem(expected: unknown, owned: Owned): { pin: VersionPin } | CoreRejection {
  if (!Array.isArray(expected) || expected.length !== 1) {
    return rejected('invalid', 'meta.expected must carry exactly the bound Workspace version pin');
  }
  const pin = expected[0] as unknown;
  if (!isRecord(pin) || !isRecord(pin['ref'])) {
    return rejected('invalid', 'meta.expected carries a malformed Workspace version pin');
  }
  if (!isNonNeg(pin['revision'])) {
    return rejected('invalid', 'the Workspace version pin revision must be a safe non-negative integer');
  }
  const workspaceRef = { aggregateType: 'Workspace', projectId: owned.projectId, workspaceId: owned.workspaceId };
  if (canonicalOf(pin['ref']) !== canonicalOf(workspaceRef)) {
    return rejected('invalid', 'meta.expected does not name the bound Workspace');
  }
  return { pin: pin as VersionPin };
}

/** One exact read of the bound Workspace, mapped to the owners' common protocol. */
export async function loadWorkspace(
  records: WorkspaceSettingsRecords,
  owned: Owned,
): Promise<ReadResult<WorkspaceSnapshot>> {
  const key = canonicalRefKey({ aggregateType: 'Workspace', projectId: owned.projectId, workspaceId: owned.workspaceId });
  let read: Awaited<ReturnType<WorkspaceSettingsRecords['readMany']>>;
  try {
    read = await records.readMany([key]);
  } catch {
    return rejected('unavailable', 'the Workspace record could not be read');
  }
  if (read.status !== 'ready') return { status: 'rejected', code: read.code === 'not_found' ? 'not_found' : 'unavailable', reason: read.reason };
  const record = read.value.records.find((candidate) => candidate.refKey === key);
  if (record === undefined) return { status: 'not_found' };
  const decoded = decodeWorkspaceSnapshot(record);
  if (decoded.status !== 'decoded') return rejected('unavailable', `the Workspace record is damaged: ${decoded.reason}`);
  return { status: 'ready', value: decoded.value };
}

/** Restores the recorded post-write Workspace from the ORIGINAL event. */
export async function replayWorkspace(
  records: WorkspaceSettingsRecords,
  receipt: CommittedReceipt,
  texts: WorkspaceReplayTexts,
  decode: WorkspaceEventDecoder,
): Promise<WriteResult<WorkspaceSnapshot>> {
  if (receipt.eventIds.length !== 1 || !nonEmpty(receipt.eventIds[0])) {
    return rejected('unavailable', texts.receipt);
  }
  let located: Awaited<ReturnType<WorkspaceSettingsRecords['eventAt']>>;
  try {
    located = await records.eventAt(receipt.cursor);
  } catch {
    return rejected('unavailable', texts.read);
  }
  if (located.status !== 'ready') return { status: 'rejected', code: 'unavailable', reason: located.reason };
  if (String(located.value.cursor) !== String(receipt.cursor) || located.value.event.eventId !== receipt.eventIds[0]) {
    return rejected('unavailable', texts.disagree);
  }
  const decoded = decode(located.value.event);
  if (decoded.status !== 'decoded') return rejected('unavailable', `${texts.damaged}${decoded.reason}`);
  return { status: 'committed', value: decoded.value.payload.value, replayed: true, cursor: receipt.cursor };
}
