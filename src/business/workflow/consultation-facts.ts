/**
 * The create operation is read first by the SAME stable identity the Session
 * directory derives; a found `create` with a payload is reused verbatim and
 * collection is skipped (§3.15 item 3). Otherwise the Runtime's completed
 * boundary decides: readable (including zero records) collects with the
 * boundary; a confirmed missing boundary collects `platform_facts` with a null
 * boundary; a transient/unreadable read keeps today's wait (§3.15 item 2).
 */
import { rejected } from '../../contracts/core/rejections.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { SessionMessageRef } from '../../contracts/core/session-message.js';
import type { SessionMessage } from '../../core/work-graph/model/communication-contracts.js';
import type {
  ConsultationCreateV1, SessionCard, SessionOperationRecord,
} from '../../core/work-graph/model/session-contracts.js';
import { stableSessionCreationIdentity } from '../../core/work-graph/sessions/session-directory.js';
import { asRejection, hashOf, type ConsultationConsumerDeps } from './consultation.js';
import type { Owned } from './workflow.js';

/**
 * §2.6/§3.15 item 3: decide the consultation payload once. A replay returns the
 * stored payload without re-collecting; an absent collector returns `null` and
 * keeps today's boundary-only create path.
 */
export async function consultationCreateOf(
  owned: Owned,
  deps: ConsultationConsumerDeps,
  message: SessionMessage,
  messageRef: SessionMessageRef,
  card: SessionCard,
): Promise<{ value: ConsultationCreateV1 | null } | { rejection: CoreRejection }> {
  // §3.15 item 3: the operation is the replay identity; a retry reads it first.
  const stable = stableSessionCreationIdentity(owned.actor, owned.projectId,
    `consultation-child:${hashOf(messageRef)}`);
  let existing: ReadResult<SessionOperationRecord>;
  try {
    existing = await deps.sessions.getSessionOperation(owned.ctx, stable.operationRef);
  } catch {
    return { rejection: rejected('unavailable', 'the consultation create operation could not be read') };
  }
  if (existing.status !== 'ready' && existing.status !== 'not_found') {
    return { rejection: asRejection(existing, 'the consultation create operation') };
  }
  if (existing.status === 'ready' && existing.value.action.kind === 'create'
    && existing.value.action.consultation !== null) {
    return { value: structuredClone(existing.value.action.consultation) };
  }

  const factsPort = deps.consultationFacts;
  // No injected collector: keep today's path; the caller still reads the boundary for the derivation.
  if (factsPort === undefined) return { value: null };
  if (deps.runtime.readCompletedBoundary === undefined) {
    return {
      rejection: rejected('unsupported',
        'the Runtime does not expose the Kernel completed-boundary reader required for an isolated derivation'),
    };
  }
  const boundary = await deps.runtime.readCompletedBoundary(owned.ctx, { sessionRef: card.record.ref });
  const collect = async (pin: { cursor: string | null; position: number } | null) => {
    const facts = await factsPort.readConsultationFacts(owned.ctx, { source: card, boundary: pin });
    if (facts.status !== 'ready') return { rejection: asRejection(facts, 'the consultation facts') };
    // The frozen payload names the source as a plain `SessionRef`; the collector's card carries the aggregate form.
    return {
      value: {
        messageRef: { ...messageRef },
        ...facts.value,
        sourceRef: { projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId },
      },
    };
  };
  if (boundary.status === 'ready') return collect(boundary.value);
  // A confirmed missing or damaged boundary is `platform_facts` with no boundary, never an
  // empty payload: the collector still runs and keeps whatever facts are readable. A
  // transient/unreadable read (no `corrupt` class) keeps today's waiting below.
  if (boundary.status === 'not_found'
    || (boundary.status === 'rejected' && (boundary.code === 'not_found' || boundary.failure === 'corrupt'))) {
    return collect(null);
  }
  const failure = asRejection(boundary, 'the recipient completed boundary');
  return {
    rejection: failure.code === 'unavailable'
      ? rejected('incomplete', failure.reason)
      : failure,
  };
}
