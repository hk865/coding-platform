/**
 * Slice 5 configuration owner: Workspace decision settings (F19; §3.3, rows
 * S5-NT-01/S5-NT-02).
 *
 * `markNoticesSeen` is the ONE Workspace owner: it verifies the display-page
 * token with the injected `NoticeDisplayTokenPort`, reads the current Workspace,
 * lets the injected `NoticePositionComparatorPort` compute each category's
 * movement, and commits one Workspace snapshot through
 * `state/notice-settings-machine.ts`. It never touches a key, a clock or a
 * notice source; `configuration → state` is the only new dependency edge.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { NoticeCategoryV1, NoticePositionV1 } from '../../../contracts/goal-decisions.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { isAutomationActor } from '../../../contracts/task-requeue.js';
import type { WorkspaceSnapshot } from '../../../contracts/ledger.js';
import type { RecordGuard } from '../../record-store/ports.js';
import type { WorkspaceDecisionSettingsDependencies,
  WorkspaceDecisionSettingsPort } from '../model/decision-contracts.js';
import { canonicalRefKey, decodeWorkspaceSnapshot, effectiveWorkspaceDecisionSettings,
  encodeWorkspaceSnapshot } from '../persistence/record-codecs.js';
import { decodeWorkspaceNoticeSeenChangedEvent,
  encodeWorkspaceNoticeSeenChangedEvent } from '../persistence/decision-record-codecs.js';
import { transitionNoticeSettings, type NoticeSeenUpdateV1,
  type NoticeSettingsEventV1 } from '../state/notice-settings-machine.js';

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
    return reject('forbidden', 'the decision-settings owner requires a trusted bound call context');
  }
  return { projectId: ctx.projectId, workspaceId: ctx.workspaceId, principal: ctx.principal, signal: ctx.signal };
}
function isOwned(value: Owned | CoreRejection): value is Owned {
  return 'projectId' in value;
}

/**
 * §3.3 line 625: `markNoticesSeen.meta.expected` must be EXACTLY one well-formed
 * pin for the bound Workspace (no extras, no duplicates, non-negative safe
 * revision). A malformed pin is `invalid`, never a stale-pin `revision_conflict`.
 */
function workspacePinProblem(expected: readonly VersionPin[], owned: Owned): CoreRejection | null {
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
  return null;
}

export function createDecisionSettingsService(
  deps: WorkspaceDecisionSettingsDependencies,
): WorkspaceDecisionSettingsPort {
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
    if (read.status !== 'ready') return { status: 'rejected', code: read.code === 'not_found' ? 'not_found' : 'unavailable', reason: read.reason };
    const record = read.value.records.find((candidate) => candidate.refKey === key);
    if (record === undefined) return { status: 'not_found' };
    const decoded = decodeWorkspaceSnapshot(record);
    if (decoded.status !== 'decoded') return reject('unavailable', `the Workspace record is damaged: ${decoded.reason}`);
    return { status: 'ready', value: decoded.value };
  }

  async function replayWorkspace(receipt: Receipt): Promise<WriteResult<WorkspaceSnapshot>> {
    if (receipt.eventIds.length !== 1 || !nonEmpty(receipt.eventIds[0])) {
      return reject('unavailable', 'the notice-seen receipt does not name exactly one event');
    }
    let located: Awaited<ReturnType<typeof records.eventAt>>;
    try {
      located = await records.eventAt(receipt.cursor);
    } catch {
      return reject('unavailable', 'the recorded notice-seen event could not be read');
    }
    if (located.status !== 'ready') return { status: 'rejected', code: 'unavailable', reason: located.reason };
    if (String(located.value.cursor) !== String(receipt.cursor) || located.value.event.eventId !== receipt.eventIds[0]) {
      return reject('unavailable', 'the recorded notice-seen event disagrees with the receipt');
    }
    const decoded = decodeWorkspaceNoticeSeenChangedEvent(located.value.event);
    if (decoded.status !== 'decoded') return reject('unavailable', `the notice-seen event is damaged: ${decoded.reason}`);
    return { status: 'committed', value: decoded.value.payload.value, replayed: true, cursor: receipt.cursor };
  }

  return {
    async markNoticesSeen(ctx: CoreCallContext, request: {
      input: {
        workspace: { projectId: string; workspaceId: string };
        displayToken: string;
        seenThrough: Partial<Record<NoticeCategoryV1, NoticePositionV1>>;
      };
      meta: { requestId: string; expected: VersionPin[] };
    }): Promise<WriteResult<WorkspaceSnapshot>> {
      const owned = ownScope(ctx);
      if (!isOwned(owned)) return owned;
      const raw = request as unknown as Record<string, unknown> | null | undefined;
      if (!isObject(raw) || !isObject(raw['meta']) || !nonEmpty(raw['meta']['requestId'])
        || !Array.isArray(raw['meta']['expected']) || !isObject(raw['input'])) {
        return reject('invalid', 'markNoticesSeen requires an input object and meta.requestId/expected');
      }
      const input = raw['input'];
      const workspace = input['workspace'];
      const displayToken = input['displayToken'];
      const seenThrough = input['seenThrough'];
      if (!isObject(workspace) || workspace['projectId'] !== owned.projectId || workspace['workspaceId'] !== owned.workspaceId) {
        return reject('forbidden', 'the notice-seen workspace is outside the bound scope');
      }
      if (!nonEmpty(displayToken)) return reject('invalid', 'markNoticesSeen requires a display token');
      if (!isObject(seenThrough)) return reject('invalid', 'markNoticesSeen requires the seenThrough positions');
      if (owned.signal.aborted) return reject('cancelled', 'the notice mark was cancelled before validation');
      const operator = deps.operatorActor;
      if (operator === undefined) return reject('unsupported', 'no configured operator can mark notices seen');
      if (owned.principal.kind !== 'host' || !sameActor(owned.principal.actor, operator)
        || isAutomationActor(owned.principal.actor)) {
        return reject('forbidden', 'only the configured operator may mark notices seen');
      }
      const requestId = raw['meta']['requestId'] as string;
      const expected = raw['meta']['expected'] as VersionPin[];
      // §3.3 line 625: meta.expected must be exactly one well-formed pin for the
      // bound Workspace. A duplicate/extra/negative/fractional/malformed pin is
      // `invalid`, never a stale-pin `revision_conflict`.
      const pinProblem = workspacePinProblem(expected, owned);
      if (pinProblem !== null) return pinProblem;
      const identityKey = 'workspace-notice-seen:' + sha256Hex(canonicalJson({
        projectId: owned.projectId, workspaceId: owned.workspaceId, operator: { ...operator }, requestId,
      } as unknown as JsonValue));
      const fingerprint = sha256Hex(canonicalJson({
        projectId: owned.projectId, workspaceId: owned.workspaceId,
        payload: { displayToken, seenThrough }, expected,
      } as unknown as JsonValue));
      if (owned.signal.aborted) return reject('cancelled', 'the notice mark was cancelled before the idempotency lookup');
      const existing = await records.lookupCommit({ identityKey, fingerprint });
      if (existing.status === 'ready') return replayWorkspace(existing.value);
      if (existing.code !== 'not_found') {
        return reject(existing.code === 'idempotency_conflict' ? 'idempotency_conflict'
          : existing.code === 'revision_conflict' ? 'revision_conflict' : 'unavailable', existing.reason);
      }

      const payload = deps.displayTokens.verify(displayToken);
      if (payload === null) return reject('invalid', 'the notice display token is invalid');
      if (payload.workspace.projectId !== owned.projectId || payload.workspace.workspaceId !== owned.workspaceId) {
        return reject('invalid', 'the notice display token belongs to another workspace');
      }
      if (!sameActor(payload.operator, operator) || payload.goalRef !== null) {
        return reject('invalid', 'the notice display token belongs to another caller or filter');
      }
      const requested = Object.entries(seenThrough) as [NoticeCategoryV1, NoticePositionV1][];
      let tokenCoversUpdates = true;
      for (const [category, position] of requested) {
        const delivered = payload.seenThrough[category];
        if (category === undefined || delivered === undefined
          || canonicalOf(delivered) !== canonicalOf(position)
          || !payload.categories.includes(category)) {
          tokenCoversUpdates = false;
          break;
        }
      }

      const workspaceRead = await loadWorkspace(owned);
      if (workspaceRead.status !== 'ready') {
        if (workspaceRead.status === 'rejected') return workspaceRead;
        return reject(workspaceRead.status === 'not_found' ? 'not_found' : 'incomplete',
          'the Workspace record is not readable at the required watermark');
      }
      const current = workspaceRead.value;
      const pin = expected.length === 1 ? expected[0] : undefined;
      const pinMatches = pin !== undefined && canonicalOf(pin.ref) === canonicalOf(current.ref) && pin.revision === current.revision;
      // §2.2/L3: the default-applying reader, never an inline default here.
      const base = effectiveWorkspaceDecisionSettings(current);
      const updates: NoticeSeenUpdateV1[] = requested.map(([category, position]) => {
        const saved = base.noticeSeen[category];
        const movement: NoticeSeenUpdateV1['movement'] = saved === undefined
          ? 'forward'
          : deps.positions.compare(position, saved) > 0 ? 'forward'
            : deps.positions.compare(position, saved) === 0 ? 'same' : 'backward';
        return { category, position, movement };
      });
      const event: NoticeSettingsEventV1 = { type: 'notices_seen', updates };
      const transition = transitionNoticeSettings(current, event, {
        operator: true, tokenValid: true, tokenCoversUpdates, pinMatches,
      });
      if (!transition.ok) return reject(transition.code, transition.detail);

      const occurredAt = deps.now();
      const moved = transition.effects.length > 0;
      const encoded = encodeWorkspaceNoticeSeenChangedEvent({
        eventId: sha256Hex(`${identityKey}|seen`),
        eventType: 'WorkspaceNoticeSeenChanged',
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
      const guards: RecordGuard[] = [{ refKey: canonicalRefKey(current.ref), expectedRevision: current.revision }];
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
        return reject('unavailable', 'the notice-seen commit failed before completing');
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
