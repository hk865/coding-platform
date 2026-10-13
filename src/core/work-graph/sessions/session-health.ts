/**
 * Session health observation (STATE-MACHINES-SPEC §8 SES-12, SES-13, SES-19,
 * §12.1 step 1, §12.6; A.2 step 5.6).
 *
 * Only the Host start reconcile observes Session health, under this Host's
 * instance lease (D-18, L-10): the Runtime probes the Session's Kernel mapping
 * (`SessionHistoryCursorOwner.probe`), and this owner write asks the Session
 * machine and commits the record through `observeSessionHealthRecord` with one
 * `SessionHealthObserved` event. A same-value observation (SES-19) and an
 * inconclusive probe (`host_config`, `transient`, `cancelled`) write nothing;
 * a `ready` probe never clears `kernel_turn_open` while the Kernel session
 * head still names an active Run (LA-1).
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { CoreError, CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalRecordTransactionPort, StoreFailure } from '../../record-store/ports.js';
import {
  SESSION_HEALTH_OBSERVED_EVENT, encodeSessionHealthObservedEvent, sessionHealthObservedPayloadFromEvent,
  type SessionHealthObservedEventV1,
} from './lifecycle-record-codecs.js';
import {
  decodeSessionRecord, encodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey,
} from './session-record-codecs.js';
import {
  bindSessionUnavailableCursor, observeSessionHealthRecord, sessionMachineStateOf, transitionSession, type SessionProbeVerdict,
} from '../state/session-availability.js';

/** One probe of the Session's Kernel mapping; `activeRunId` is the Kernel session head a `ready` probe read. */
export type SessionHealthProbe = { verdict: SessionProbeVerdict; activeRunId: string | null };

export type SessionHealthResult =
  /** SES-12/13 committed (or replayed). */
  | { status: 'observed'; session: SessionRecord }
  /** SES-19, or an inconclusive probe, or a kept `kernel_turn_open`: nothing written. */
  | { status: 'unchanged'; session: SessionRecord; reason: string }
  | CoreRejection;

export interface SessionHealthPort {
  recordSessionHealth(ctx: CoreCallContext, input: { sessionRef: SessionRef; probe: SessionHealthProbe }): Promise<SessionHealthResult>;
}

export type SessionHealthDependencies = {
  records: GoalRecordTransactionPort;
  /** This Host instance and whether it holds the instance lease (D-18); absent = not held. */
  hostInstance?: { hostInstanceId: string; lease: 'owned' | 'held_by_other' };
  now(): string;
  eventId(): string;
};

function rejected(code: CoreError, reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}
function storeFailure(failure: StoreFailure): CoreRejection {
  return failure.code === 'revision_conflict' ? rejected('revision_conflict', failure.reason)
    : rejected(failure.code === 'invalid' || failure.code === 'not_found' ? failure.code : 'unavailable', failure.reason);
}

export function createSessionHealthService(deps: SessionHealthDependencies): SessionHealthPort {
  const records = deps.records;

  async function readSession(sessionRef: SessionRef): Promise<ReadResult<SessionRecord>> {
    const key = sessionAggregateRefKey(plainSessionRefToAggregate(sessionRef));
    const batch = await records.readMany([key]);
    if (batch.status !== 'ready') return rejected('unavailable', `the Session could not be read: ${batch.reason}`);
    const found = batch.value.records.find(record => record.refKey === key);
    if (found === undefined) return { status: 'not_found' };
    const decoded = decodeSessionRecord(found);
    if (decoded.status !== 'decoded') return rejected('unavailable', `the Session is damaged: ${decoded.reason}`);
    return { status: 'ready', value: decoded.value };
  }

  return {
    async recordSessionHealth(ctx, input) {
      if (ctx.principal.kind !== 'host') return rejected('forbidden', 'only the Host start reconcile observes Session health');
      if (input.sessionRef.projectId !== ctx.projectId) return rejected('forbidden', 'the Session belongs to another project');
      const host = deps.hostInstance;
      try {
        const read = await readSession(input.sessionRef);
        if (read.status === 'not_found') return rejected('not_found', 'the Session does not exist');
        if (read.status !== 'ready') return read.status === 'rejected' ? read : rejected('incomplete', 'the Session is not readable');
        const session = read.value;
        if (session.workspaceId !== ctx.workspaceId) return rejected('forbidden', 'the Session belongs to another workspace');
        const verdict = input.probe.verdict;
        const observed = verdict === 'ready' ? 'available' : 'unavailable';
        const header = verdict === 'ready' ? { activeRunId: input.probe.activeRunId } : null;
        const decided = transitionSession(sessionMachineStateOf(session), { kind: 'health_observed', observed }, {
          caller: 'reconcile', hostLease: host === undefined ? null : host.lease, pin: null, holder: null,
          probe: verdict, kernelHeader: header, openResponsibleLink: null, creation: null, link: null,
        });
        if (!decided.ok) {
          // An inconclusive probe or an open Kernel Turn is reported, not written (SG-9, LA-1).
          if (decided.code === 'unavailable') return { status: 'unchanged', session, reason: decided.detail };
          return rejected(decided.code, decided.detail);
        }
        const effect = decided.effects.find(candidate => candidate.kind === 'observe_health');
        if (effect === undefined || effect.kind !== 'observe_health') {
          return { status: 'unchanged', session, reason: `the Session is already ${session.health}` };
        }
        if (host === undefined) throw new Error('an accepted health observation names this Host instance');
        const next = observeSessionHealthRecord(session, effect.health === 'available'
          ? { health: 'available', conclusion: null } : { health: 'unavailable', conclusion: effect.conclusion });
        const identityKey = 'a2-session-health:' + sha256Hex(canonicalJson({ sessionRef: input.sessionRef,
          hostInstanceId: host.hostInstanceId, revision: session.revision } as unknown as JsonValue));
        const fingerprint = sha256Hex(canonicalJson({ probe: verdict, header, observed } as unknown as JsonValue));
        const lookup = await records.lookupCommit({ identityKey, fingerprint });
        if (lookup.status === 'ready') return await replayed(lookup.value.cursor);
        if (lookup.code !== 'not_found') return storeFailure(lookup);
        const nowIso = deps.now();
        const event: SessionHealthObservedEventV1 = { eventId: deps.eventId(), eventType: SESSION_HEALTH_OBSERVED_EVENT,
          schemaVersion: 1, occurredAt: nowIso, projectId: session.ref.projectId, hostInstanceId: host.hostInstanceId,
          observed, probe: verdict === 'ready' ? 'ready' : verdict === 'missing' ? 'missing' : 'damaged',
          kernelHeader: header, session: next };
        const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(input.sessionRef));
        const receipt = await records.commit({ identityKey, fingerprint,
          guards: [{ refKey: sessionAggregateRefKey(plainSessionRefToAggregate(input.sessionRef)), expectedRevision: session.revision }],
          records: [encodeSessionRecord(next)], claims: [], indexGuards: [], indexChanges: [],
          // Spec §2.3 P01: an available→unavailable observation writes the
          // explicit pending entry placeholder; this same commit binds it.
          ...(next.unavailableSince === null
            ? { commitCursorBindings: [{ refKey: sessionKey, field: 'unavailableSince' as const }] }
            : {}),
          events: [encodeSessionHealthObservedEvent(event)] });
        if (receipt.status !== 'committed') return storeFailure(receipt);
        if (receipt.replayed) return await replayed(receipt.cursor);
        return { status: 'observed', session: bindSessionUnavailableCursor(next, receipt.cursor) };
      } catch (error) {
        return rejected('unavailable', `the health observation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };

  async function replayed(cursor: Parameters<GoalRecordTransactionPort['eventAt']>[0]): Promise<SessionHealthResult> {
    const at = await records.eventAt(cursor);
    if (at.status !== 'ready') return storeFailure(at);
    const decoded = sessionHealthObservedPayloadFromEvent(at.value.event);
    if (decoded.status !== 'decoded') return rejected('unavailable', `the recorded health observation is damaged: ${decoded.reason}`);
    // Spec §2.3 L11-1: the replay returns the same bound field as the first result.
    return { status: 'observed', session: bindSessionUnavailableCursor(decoded.value.session, cursor) };
  }
}
