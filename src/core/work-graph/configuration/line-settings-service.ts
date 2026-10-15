/**
 * Slice 2C configuration owner: Workspace line pins (L9, route `lines/pin`,
 * row S2C-PIN-01).
 *
 * `setLinePins` is the ONE Workspace pin owner: it verifies the operator, reads
 * the current Workspace, checks every newly added Session through the injected
 * `SessionDirectoryPort['readSession']` (present in this workspace, not a
 * read-only copy), and commits ONE Workspace record plus the
 * `WorkspaceLinePinsChanged@1` event through `state/line-pin-machine.ts`. The
 * service holds no Session decoder: `configuration` may depend only on
 * `model`/`state`/`persistence`, so the composition root injects the read.
 *
 * Refusal order is the machine's: forbidden → invalid → capacity →
 * revision_conflict. A request whose final table equals the current one is
 * still accepted and still commits the event, but writes no record, so the
 * Workspace revision is unchanged (the same no-op path as `markNoticesSeen`).
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { SessionRef, VersionPin } from '../../../contracts/core/identity.js';
import type { WorkspaceSnapshot } from '../../../contracts/ledger.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { isAutomationActor } from '../../../contracts/task-requeue.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { LineSettingsSessionRead, WorkLineSettingsPort } from '../model/work-line-contracts.js';
import { canonicalRefKey, decodeWorkspaceSnapshot, encodeWorkspaceSnapshot } from '../persistence/record-codecs.js';
import { WORKSPACE_LINE_PINS_CHANGED_EVENT,
  decodeWorkspaceLinePinsChangedEvent, encodeWorkspaceLinePinsChangedEvent } from '../persistence/line-settings-codecs.js';
import type { LinePinGuardV1 } from '../state/line-pin-machine.js';
import { transitionLinePins } from '../state/line-pin-machine.js';

export type LineSettingsRecordsPort = GoalRecordTransactionPort & RecordLookupPort;

export type LineSettingsDependencies = {
  records: LineSettingsRecordsPort;
  /** Injected by composition: `SessionDirectoryPort['readSession']` (L9). */
  sessionRead: LineSettingsSessionRead;
  now: () => string;
  operatorActor?: Extract<ActorRef, { kind: 'human' | 'system' }>;
};

// --------------------------------------------------------------------------
// Small shared value helpers
// --------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function sameActor(left: unknown, right: unknown): boolean {
  return isObject(left) && isObject(right) && left['kind'] === right['kind'] && left['id'] === right['id'];
}
function canonicalOf(value: unknown): string | null {
  try {
    return canonicalJson(value as JsonValue);
  } catch {
    return null;
  }
}
function reject(code: CoreError, reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}

type Owned = { projectId: string; workspaceId: string; principal: CoreCallContext['principal']; signal: AbortSignal };
function ownScope(ctx: CoreCallContext): Owned | CoreRejection {
  if (!isObject(ctx) || !nonEmpty(ctx.projectId) || !nonEmpty(ctx.workspaceId)
    || !isObject(ctx.principal) || !isObject(ctx.signal)) {
    return reject('forbidden', 'the line-settings owner requires a trusted bound call context');
  }
  return { projectId: ctx.projectId, workspaceId: ctx.workspaceId, principal: ctx.principal, signal: ctx.signal };
}
function isOwned(value: Owned | CoreRejection): value is Owned {
  return 'projectId' in value;
}

/**
 * `meta.expected` must be exactly one well-formed pin for the bound Workspace:
 * no extras, no duplicates, a safe non-negative revision. A malformed pin is
 * `invalid`, never a stale-pin `revision_conflict`.
 */
function boundWorkspacePin(expected: unknown, owned: Owned): { pin: VersionPin } | CoreRejection {
  if (!Array.isArray(expected) || expected.length !== 1) {
    return reject('invalid', 'meta.expected must carry exactly the bound Workspace version pin');
  }
  const pin = expected[0] as unknown;
  if (!isObject(pin) || !isObject(pin['ref'])) {
    return reject('invalid', 'meta.expected carries a malformed Workspace version pin');
  }
  const revision = pin['revision'];
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    return reject('invalid', 'the Workspace version pin revision must be a safe non-negative integer');
  }
  const workspaceRef = { aggregateType: 'Workspace', projectId: owned.projectId, workspaceId: owned.workspaceId };
  if (canonicalOf(pin['ref']) !== canonicalOf(workspaceRef)) {
    return reject('invalid', 'meta.expected does not name the bound Workspace');
  }
  return { pin: pin as VersionPin };
}

function duplicateKeys(refs: readonly unknown[]): boolean {
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = canonicalOf(ref);
    if (key === null || seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

// --------------------------------------------------------------------------
// The factory
// --------------------------------------------------------------------------

export function createLineSettingsService(deps: LineSettingsDependencies): WorkLineSettingsPort {
  const records = deps.records;
  type Receipt = Extract<Awaited<ReturnType<typeof records.commit>>, { status: 'committed' }>;

  async function loadWorkspace(owned: Owned): Promise<ReadResult<WorkspaceSnapshot>> {
    const key = canonicalRefKey({ aggregateType: 'Workspace', projectId: owned.projectId, workspaceId: owned.workspaceId });
    let read: Awaited<ReturnType<typeof records.readMany>>;
    try {
      read = await records.readMany([key]);
    } catch {
      return reject('unavailable', 'the Workspace record could not be read');
    }
    if (read.status !== 'ready') {
      return { status: 'rejected', code: read.code === 'not_found' ? 'not_found' : 'unavailable', reason: read.reason };
    }
    const record = read.value.records.find(candidate => candidate.refKey === key);
    if (record === undefined) return { status: 'not_found' };
    const decoded = decodeWorkspaceSnapshot(record);
    if (decoded.status !== 'decoded') return reject('unavailable', `the Workspace record is damaged: ${decoded.reason}`);
    return { status: 'ready', value: decoded.value };
  }

  async function replayWorkspace(receipt: Receipt): Promise<WriteResult<WorkspaceSnapshot>> {
    if (receipt.eventIds.length !== 1 || !nonEmpty(receipt.eventIds[0])) {
      return reject('unavailable', 'the line-pin receipt does not name exactly one event');
    }
    let located: Awaited<ReturnType<typeof records.eventAt>>;
    try {
      located = await records.eventAt(receipt.cursor);
    } catch {
      return reject('unavailable', 'the recorded line-pin event could not be read');
    }
    if (located.status !== 'ready') return { status: 'rejected', code: 'unavailable', reason: located.reason };
    if (String(located.value.cursor) !== String(receipt.cursor) || located.value.event.eventId !== receipt.eventIds[0]) {
      return reject('unavailable', 'the recorded line-pin event disagrees with the receipt');
    }
    const decoded = decodeWorkspaceLinePinsChangedEvent(located.value.event);
    if (decoded.status !== 'decoded') return reject('unavailable', `the line-pin event is damaged: ${decoded.reason}`);
    // The event carries the exact post-write Workspace, not the current one.
    return { status: 'committed', value: decoded.value.payload.value, replayed: true, cursor: receipt.cursor };
  }

  return {
    async setLinePins(ctx: CoreCallContext, request): Promise<WriteResult<WorkspaceSnapshot>> {
      const owned = ownScope(ctx);
      if (!isOwned(owned)) return owned;
      const raw = request as unknown as Record<string, unknown> | null | undefined;
      if (!isObject(raw) || !isObject(raw['meta']) || !nonEmpty(raw['meta']['requestId'])
        || !Array.isArray(raw['meta']['expected']) || !isObject(raw['input'])) {
        return reject('invalid', 'setLinePins requires an input object and meta.requestId/expected');
      }
      const input = raw['input'];
      const workspace = input['workspace'];
      if (!isObject(workspace) || workspace['projectId'] !== owned.projectId
        || workspace['workspaceId'] !== owned.workspaceId) {
        return reject('forbidden', 'the line-pin workspace is outside the bound scope');
      }
      const add = input['add'];
      const remove = input['remove'];
      if (!Array.isArray(add) || !Array.isArray(remove)) {
        return reject('invalid', 'setLinePins requires add and remove arrays');
      }
      if (owned.signal.aborted) return reject('cancelled', 'the pin change was cancelled before validation');
      const operator = deps.operatorActor;
      if (operator === undefined) return reject('unsupported', 'no configured operator can pin work lines');
      if (owned.principal.kind !== 'host' || !sameActor(owned.principal.actor, operator)
        || isAutomationActor(owned.principal.actor)) {
        return reject('forbidden', 'only the configured operator may pin work lines');
      }
      const requestId = raw['meta']['requestId'] as string;
      const expected = raw['meta']['expected'] as VersionPin[];
      const pinVerdict = boundWorkspacePin(expected, owned);
      if ('status' in pinVerdict) return pinVerdict;
      const { pin } = pinVerdict;

      const identityKey = 'workspace-line-pins:' + sha256Hex(canonicalJson({
        projectId: owned.projectId, workspaceId: owned.workspaceId, operator: { ...operator }, requestId,
      } as unknown as JsonValue));
      const fingerprint = sha256Hex(canonicalJson({
        projectId: owned.projectId, workspaceId: owned.workspaceId,
        payload: { add, remove }, expected,
      } as unknown as JsonValue));
      if (owned.signal.aborted) return reject('cancelled', 'the pin change was cancelled before the idempotency lookup');
      const existing = await records.lookupCommit({ identityKey, fingerprint });
      if (existing.status === 'ready') return replayWorkspace(existing.value);
      if (existing.code !== 'not_found') {
        return reject(existing.code === 'idempotency_conflict' ? 'idempotency_conflict'
          : existing.code === 'revision_conflict' ? 'revision_conflict' : 'unavailable', existing.reason);
      }

      const workspaceRead = await loadWorkspace(owned);
      if (workspaceRead.status !== 'ready') {
        if (workspaceRead.status === 'rejected') return workspaceRead;
        return reject(workspaceRead.status === 'not_found' ? 'not_found' : 'incomplete',
          'the Workspace record is not readable at the required watermark');
      }
      const current = workspaceRead.value;
      const currentPinned = current.lineSettings?.pinned ?? [];
      const currentKeys = new Set(currentPinned.map(item => canonicalOf(item.sessionRef) ?? ''));
      const removeKeys = new Set(remove.map(canonicalOf));
      const addKeys = new Set(add.map(canonicalOf));

      // Only Sessions newly entering the table are validated (L9).
      let addedInWorkspace = true;
      let addedNotCopies = true;
      for (const ref of add) {
        if (currentKeys.has(canonicalOf(ref) ?? '')) continue;
        let read: Awaited<ReturnType<LineSettingsSessionRead>>;
        try {
          read = await deps.sessionRead(ctx, ref as SessionRef);
        } catch {
          return reject('unavailable', 'the newly added Session could not be read');
        }
        if (read.status !== 'ready') {
          if (read.status === 'rejected' && read.code !== 'not_found') {
            return { status: 'rejected', code: read.code, reason: read.reason };
          }
          if (read.status === 'not_ready') {
            return reject('unavailable', 'the newly added Session is not readable at the required watermark');
          }
          addedInWorkspace = false;
          continue;
        }
        const record = read.value.record;
        if (record.ref.projectId !== owned.projectId || record.workspaceId !== owned.workspaceId) {
          addedInWorkspace = false;
        }
        if (record.provenance?.kind === 'readonly_copy') addedNotCopies = false;
      }

      const finalKeys = new Set([...currentKeys].filter(key => !removeKeys.has(key)));
      for (const key of addKeys) if (key !== null) finalKeys.add(key);
      const overlap = add.some(key => removeKeys.has(canonicalOf(key)));
      const occurredAt = deps.now();
      const facts: LinePinGuardV1 = {
        operator: true,
        pinMatches: canonicalOf(pin.ref) === canonicalOf(current.ref) && pin.revision === current.revision,
        noDuplicates: !duplicateKeys(add) && !duplicateKeys(remove),
        noOverlap: !overlap,
        addedInWorkspace,
        addedNotCopies,
        finalUnderCap: finalKeys.size <= 100,
      };
      const transition = transitionLinePins(current, {
        type: 'line_pins_changed', add: add as SessionRef[], remove: remove as SessionRef[], at: occurredAt,
      }, facts);
      if (!transition.ok) return reject(transition.code, transition.detail);

      const moved = transition.effects.length > 0;
      const encoded = encodeWorkspaceLinePinsChangedEvent({
        eventId: sha256Hex(`${identityKey}|line-pins`),
        eventType: WORKSPACE_LINE_PINS_CHANGED_EVENT,
        schemaVersion: 1,
        occurredAt,
        identityKey,
        fingerprint,
        projectId: owned.projectId,
        workspaceId: owned.workspaceId,
        actor: { ...operator },
        requestId,
        payload: { value: transition.next, proof: null },
      });
      const guards = [{ refKey: canonicalRefKey(current.ref), expectedRevision: current.revision }];
      let receipt: Awaited<ReturnType<typeof records.commit>>;
      try {
        receipt = await records.commit({
          identityKey, fingerprint, guards,
          records: moved ? [encodeWorkspaceSnapshot(transition.next)] : [],
          claims: [], indexGuards: [], indexChanges: [], events: [encoded],
        });
      } catch {
        const restored = await records.lookupCommit({ identityKey, fingerprint });
        if (restored.status === 'ready') return replayWorkspace(restored.value);
        return reject('unavailable', 'the line-pin commit failed before completing');
      }
      if (receipt.status !== 'committed') {
        const restored = await records.lookupCommit({ identityKey, fingerprint });
        if (restored.status === 'ready') return replayWorkspace(restored.value);
        return reject(receipt.code === 'revision_conflict' ? 'revision_conflict'
          : receipt.code === 'unique_conflict' ? 'revision_conflict' : 'unavailable', receipt.reason);
      }
      if (receipt.replayed) return replayWorkspace(receipt);
      return { status: 'committed', value: transition.next, replayed: false, cursor: receipt.cursor };
    },
  };
}
