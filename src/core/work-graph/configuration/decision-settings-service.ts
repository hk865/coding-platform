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
import type { CoreRejection, WriteResult } from '../../../contracts/core/results.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { NoticeCategoryV1, NoticePositionV1 } from '../../../contracts/goal-decisions.js';
import { canonicalJson, sha256Hex, canonicalOf, type JsonValue } from '../../../contracts/fingerprint.js';
import { isAutomationActor } from '../../../contracts/task-requeue.js';
import type { WorkspaceSnapshot } from '../../../contracts/ledger.js';
import type { RecordGuard } from '../../record-store/ports.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { WorkspaceDecisionSettingsDependencies,
  WorkspaceDecisionSettingsPort } from '../model/decision-contracts.js';
import { canonicalRefKey, effectiveWorkspaceDecisionSettings,
  encodeWorkspaceSnapshot } from '../persistence/record-codecs.js';
import { decodeWorkspaceNoticeSeenChangedEvent,
  encodeWorkspaceNoticeSeenChangedEvent } from '../persistence/decision-record-codecs.js';
import { transitionNoticeSettings, type NoticeSeenUpdateV1,
  type NoticeSettingsEventV1 } from '../state/notice-settings-machine.js';
import {
  isOwned, loadWorkspace, ownScope, replayWorkspace, sameActor,
  workspacePinProblem as sharedWorkspacePinProblem, type Owned, type WorkspaceReplayTexts,
} from './workspace-settings-reads.js';

/**
 * §3.3 line 625: `markNoticesSeen.meta.expected` must be EXACTLY one well-formed
 * pin for the bound Workspace (no extras, no duplicates, non-negative safe
 * revision). A malformed pin is `invalid`, never a stale-pin `revision_conflict`.
 */
function workspacePinProblem(expected: readonly VersionPin[], owned: Owned): CoreRejection | null {
  const verdict = sharedWorkspacePinProblem(expected, owned);
  return 'status' in verdict ? verdict : null;
}

const DECISION_REPLAY_TEXTS: WorkspaceReplayTexts = {
  receipt: 'the notice-seen receipt does not name exactly one event',
  read: 'the recorded notice-seen event could not be read',
  disagree: 'the recorded notice-seen event disagrees with the receipt',
  damaged: 'the notice-seen event is damaged: ',
};

export function createDecisionSettingsService(
  deps: WorkspaceDecisionSettingsDependencies,
): WorkspaceDecisionSettingsPort {
  const records = deps.records;

  return {
    async markNoticesSeen(ctx: CoreCallContext, request: {
      input: {
        workspace: { projectId: string; workspaceId: string };
        displayToken: string;
        seenThrough: Partial<Record<NoticeCategoryV1, NoticePositionV1>>;
      };
      meta: { requestId: string; expected: VersionPin[] };
    }): Promise<WriteResult<WorkspaceSnapshot>> {
      const owned = ownScope(ctx, 'the decision-settings owner requires a trusted bound call context');
      if (!isOwned(owned)) return owned;
      const raw = request as unknown as Record<string, unknown> | null | undefined;
      if (!isRecord(raw) || !isRecord(raw['meta']) || !nonEmpty(raw['meta']['requestId'])
        || !Array.isArray(raw['meta']['expected']) || !isRecord(raw['input'])) {
        return rejected('invalid', 'markNoticesSeen requires an input object and meta.requestId/expected');
      }
      const input = raw['input'];
      const workspace = input['workspace'];
      const displayToken = input['displayToken'];
      const seenThrough = input['seenThrough'];
      if (!isRecord(workspace) || workspace['projectId'] !== owned.projectId || workspace['workspaceId'] !== owned.workspaceId) {
        return rejected('forbidden', 'the notice-seen workspace is outside the bound scope');
      }
      if (!nonEmpty(displayToken)) return rejected('invalid', 'markNoticesSeen requires a display token');
      if (!isRecord(seenThrough)) return rejected('invalid', 'markNoticesSeen requires the seenThrough positions');
      if (owned.signal.aborted) return rejected('cancelled', 'the notice mark was cancelled before validation');
      const operator = deps.operatorActor;
      if (operator === undefined) return rejected('unsupported', 'no configured operator can mark notices seen');
      if (owned.principal.kind !== 'host' || !sameActor(owned.principal.actor, operator)
        || isAutomationActor(owned.principal.actor)) {
        return rejected('forbidden', 'only the configured operator may mark notices seen');
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
      if (owned.signal.aborted) return rejected('cancelled', 'the notice mark was cancelled before the idempotency lookup');
      const existing = await records.lookupCommit({ identityKey, fingerprint });
      if (existing.status === 'ready') {
        return replayWorkspace(records, existing.value, DECISION_REPLAY_TEXTS, decodeWorkspaceNoticeSeenChangedEvent);
      }
      if (existing.code !== 'not_found') {
        return rejected(existing.code === 'idempotency_conflict' ? 'idempotency_conflict'
          : existing.code === 'revision_conflict' ? 'revision_conflict' : 'unavailable', existing.reason);
      }

      const payload = deps.displayTokens.verify(displayToken);
      if (payload === null) return rejected('invalid', 'the notice display token is invalid');
      if (payload.workspace.projectId !== owned.projectId || payload.workspace.workspaceId !== owned.workspaceId) {
        return rejected('invalid', 'the notice display token belongs to another workspace');
      }
      if (!sameActor(payload.operator, operator) || payload.goalRef !== null) {
        return rejected('invalid', 'the notice display token belongs to another caller or filter');
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

      const workspaceRead = await loadWorkspace(records, owned);
      if (workspaceRead.status !== 'ready') {
        if (workspaceRead.status === 'rejected') return workspaceRead;
        return rejected(workspaceRead.status === 'not_found' ? 'not_found' : 'incomplete',
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
      if (!transition.ok) return rejected(transition.code, transition.detail);

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
        if (restored.status === 'ready') {
          return replayWorkspace(records, restored.value, DECISION_REPLAY_TEXTS, decodeWorkspaceNoticeSeenChangedEvent);
        }
        return rejected('unavailable', 'the notice-seen commit failed before completing');
      }
      if (receipt.status !== 'committed') {
        const restored = await records.lookupCommit({ identityKey, fingerprint });
        if (restored.status === 'ready') {
          return replayWorkspace(records, restored.value, DECISION_REPLAY_TEXTS, decodeWorkspaceNoticeSeenChangedEvent);
        }
        return rejected(receipt.code === 'revision_conflict' ? 'revision_conflict'
          : receipt.code === 'unique_conflict' ? 'revision_conflict' : 'unavailable', receipt.reason);
      }
      if (receipt.replayed) {
        return replayWorkspace(records, receipt, DECISION_REPLAY_TEXTS, decodeWorkspaceNoticeSeenChangedEvent);
      }
      return { status: 'committed', value: transition.next, replayed: false, cursor: receipt.cursor };
    },
  };
}
