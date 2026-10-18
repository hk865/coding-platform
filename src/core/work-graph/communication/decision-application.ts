/**
 * Slice 5 §3.3 application-receipt proof reader (F40).
 *
 * SPEC §3.3 line 616 names this reader factory `readApplicationReceiptFacts`;
 * SPEC line 686 fixes the reader it returns with the exact
 * `DecisionSourceFactsPort.readApplication` signature, so `createDecisionSourceFacts`
 * wires it directly and `recordDecisionApplication` reaches it through `sources`.
 *
 * The proof is read ONLY from the formal receipt: look up the original commit
 * identity+fingerprint, require cursor/eventIds to agree, read the formal event
 * at that cursor, decode it through the named whitelist and compare the changed
 * objects' `before` pins (and the acknowledgement ref) with the answer's
 * canonical source. It never accepts caller-supplied actualVersions/PASS and
 * never guesses an application from current values.
 *
 * [lead S5-T3-D4] `receiptReadable` means "the formal receipt and its event were
 * found"; a missing/undecodable receipt is returned here, before the state call.
 * [lead L1] Only `GoalSettingsChanged` and `PlanRevisionAccepted` are whitelisted;
 * an architecture/completion-policy change is `unsupported`.
 */
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { DecisionApplicationV1 } from '../../../contracts/core/session-message.js';
import type { CoreError, ReadResult } from '../../../contracts/core/results.js';
import type { DecisionChangeProofV1 } from '../../../contracts/goal-decisions.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { EncodedDomainEvent, StoreFailure } from '../../record-store/ports.js';
import type { DecisionSourceFactsPort, S5RecordPort } from '../model/decision-contracts.js';
import { decodeGoalSettingsChangedEvent, decisionChangeProofProblem } from '../persistence/decision-record-codecs.js';
import { noteDispositionChangedEventFromEvent } from '../persistence/note-record-codecs.js';
import { decodePlanRevisionAcceptedEvent } from '../persistence/plan-record-codecs.js';
import { unknownCallReviewChangedEventFromEvent } from '../tasks/unknown-call-review-codecs.js';
import { commandRerunRequestChangedEventFromEvent } from '../tasks/command-rerun-request-codecs.js';

function canonicalOf(value: unknown): string | null {
  try {
    return canonicalJson(value as JsonValue);
  } catch {
    return null;
  }
}

function reject(code: CoreError, reason: string, current?: VersionPin[]): ReadResult<never> {
  return { status: 'rejected', code, reason, ...(current === undefined ? {} : { current }) };
}

function mapStoreFailure(failure: StoreFailure): ReadResult<never> {
  switch (failure.code) {
    case 'not_found': return reject('incomplete', failure.reason);
    case 'revision_conflict': return reject('revision_conflict', failure.reason);
    case 'unsupported': return reject('unsupported', failure.reason);
    default: return reject('unavailable', failure.reason);
  }
}

/** The event body of a formal, whitelisted decision write. */
type ProofEvent = {
  actor: DecisionApplicationV1['actor'];
  appliedAt: string;
  proof: DecisionChangeProofV1 | null;
};

/**
 * §3.3/4C-2: the whitelisted proof-event decoder table, keyed by event type.
 * `ArchitectureCatalogAdopted`/`ProjectCompletionPolicyActivated` stay explicit
 * `unsupported` rows (slice 6); an unknown type stays `incomplete`.
 */
type ProofEventDecoder = (event: EncodedDomainEvent) => ProofEvent | ReadResult<never>;

const PROOF_EVENT_DECODERS: Readonly<Record<string, ProofEventDecoder>> = {
  GoalSettingsChanged: (event) => {
    const decoded = decodeGoalSettingsChangedEvent(event);
    if (decoded.status !== 'decoded') return reject('unavailable', `the GoalSettingsChanged event is damaged: ${decoded.reason}`);
    return { actor: decoded.value.actor, appliedAt: decoded.value.occurredAt, proof: decoded.value.payload.proof };
  },
  PlanRevisionAccepted: (event) => {
    const decoded = decodePlanRevisionAcceptedEvent(event);
    if (decoded.status !== 'decoded') return reject('unavailable', `the PlanRevisionAccepted event is damaged: ${decoded.reason}`);
    return { actor: decoded.value.actor, appliedAt: decoded.value.occurredAt,
      proof: decoded.value.payload.decisionApplication ?? null };
  },
  // 4C-2: an ordinary disposition carries no proof (stays `incomplete` below); a
  // formal disposition proof is validated exactly like the other rows.
  NoteDispositionChanged: (event) => {
    const decoded = noteDispositionChangedEventFromEvent(event);
    if (decoded.status !== 'decoded') return reject('unavailable', `the NoteDispositionChanged event is damaged: ${decoded.reason}`);
    return { actor: decoded.value.actor as DecisionApplicationV1['actor'],
      appliedAt: decoded.value.occurredAt, proof: decoded.value.proof };
  },
  // K3 L19/§3.2: a non-application review change carries no proof and stays
  // `incomplete`; the two application changes carry the formal `DecisionChangeProofV1`.
  UnknownCallReviewChanged: (event) => {
    const decoded = unknownCallReviewChangedEventFromEvent(event);
    if (decoded.status !== 'decoded') {
      return reject('unavailable', `the UnknownCallReviewChanged event is damaged: ${decoded.reason}`);
    }
    return { actor: decoded.value.actor, appliedAt: decoded.value.occurredAt, proof: decoded.value.proof ?? null };
  },
  // K3 L19a/ruling 2: the three card-application changes carry the formal
  // `DecisionChangeProofV1`; the non-application changes carry none.
  CommandRerunRequestChanged: (event) => {
    const decoded = commandRerunRequestChangedEventFromEvent(event);
    if (decoded.status !== 'decoded') {
      return reject('unavailable', `the CommandRerunRequestChanged event is damaged: ${decoded.reason}`);
    }
    return { actor: decoded.value.actor, appliedAt: decoded.value.occurredAt, proof: decoded.value.proof ?? null };
  },
  // [lead L1] The initial architecture/completion-policy proof is slice 6.
  ArchitectureCatalogAdopted: () => reject('unsupported',
    'only GoalSettingsChanged, PlanRevisionAccepted, NoteDispositionChanged, UnknownCallReviewChanged and CommandRerunRequestChanged applications are provable in this slice'),
  ProjectCompletionPolicyActivated: () => reject('unsupported',
    'only GoalSettingsChanged, PlanRevisionAccepted, NoteDispositionChanged, UnknownCallReviewChanged and CommandRerunRequestChanged applications are provable in this slice'),
};

function decodeProofEvent(event: EncodedDomainEvent): ProofEvent | ReadResult<never> {
  const decode = PROOF_EVENT_DECODERS[event.eventType];
  if (decode === undefined) return reject('incomplete', 'the receipt is not a formal decision-application event');
  return decode(event);
}

/** §3.3: the reader proving one recorded decision application from its receipt. */
export function readApplicationReceiptFacts(
  records: S5RecordPort,
): DecisionSourceFactsPort['readApplication'] {
  return async (_ctx, input): Promise<ReadResult<DecisionApplicationV1>> => {
    const { answer, receipt } = input;
    let lookup: Awaited<ReturnType<S5RecordPort['lookupCommit']>>;
    try {
      lookup = await records.lookupCommit({ identityKey: receipt.identityKey, fingerprint: receipt.fingerprint });
    } catch {
      return reject('unavailable', 'the formal receipt could not be looked up');
    }
    if (lookup.status === 'rejected' && lookup.code === 'not_found') {
      return reject('incomplete', 'the formal receipt was not found');
    }
    if (lookup.status !== 'ready') return mapStoreFailure(lookup);
    if (String(lookup.value.cursor) !== String(receipt.cursor)) {
      return reject('revision_conflict', 'the caller receipt cursor disagrees with the recorded commit');
    }

    let located: Awaited<ReturnType<S5RecordPort['eventAt']>>;
    try {
      located = await records.eventAt(receipt.cursor);
    } catch {
      return reject('unavailable', 'the formal receipt event could not be read');
    }
    if (located.status === 'rejected' && located.code === 'not_found') {
      return reject('incomplete', 'the formal receipt event was not found');
    }
    if (located.status !== 'ready') return mapStoreFailure(located);
    if (String(located.value.cursor) !== String(receipt.cursor)) {
      return reject('revision_conflict', 'the receipt cursor disagrees with the formal event');
    }
    if (!lookup.value.eventIds.includes(located.value.event.eventId)) {
      return reject('unavailable', 'the formal event is not one of the receipt event ids');
    }

    const decoded = decodeProofEvent(located.value.event);
    if ('status' in decoded) return decoded;
    if (decoded.proof === null || decoded.proof === undefined) {
      return reject('incomplete', 'the formal event carries no decision change proof');
    }
    const problem = decisionChangeProofProblem(decoded.proof);
    if (problem !== null) return reject('unavailable', `the decision change proof is damaged: ${problem}`);
    const proof = decoded.proof;
    if (canonicalOf(proof.acknowledgementRef) !== canonicalOf(answer.ref)) {
      return reject('invalid', 'the receipt is not associated with this answer');
    }
    for (const change of proof.changes) {
      const afterKey = canonicalOf(change.after.ref);
      if (afterKey === null
        || !lookup.value.versions.some((version) => version.refKey === afterKey && version.revision === change.after.revision)) {
        return reject('revision_conflict', 'the receipt after version does not match the formal commit');
      }
    }
    // §3.3 line 616/623: every changed object's `before` must match the answer's
    // captured source pin, or a named §2.8 basisRebase must prove the actual
    // before. When the answer already carries a recorded application the
    // service's own same/different-application verdict takes precedence (AP16),
    // and the proof was already validated when that application was first
    // recorded, so the reader does not re-judge it here.
    if (answer.application === undefined || answer.application === null) {
      const capturedPins = answer.response !== null && 'decision' in answer.response
        ? answer.response.decision.source.pins ?? [] : [];
      const rebases = proof.basisRebases ?? [];
      for (const change of proof.changes) {
        const refKey = canonicalOf(change.before.ref);
        const captured = capturedPins.find((pin) => canonicalOf(pin.ref) === refKey);
        // D8/§3.3: only a changed aggregate that appears in the answer's
        // captured source pins is checked; a modified object the answer never
        // captured (SC01 replaces the stale candidate U2 before the adopting
        // change) is recorded as-is and not re-checked.
        if (captured === undefined) continue;
        if (captured.revision === change.before.revision) continue;
        const rebase = rebases.find((candidate) => canonicalOf(candidate.captured.ref) === refKey
          && candidate.captured.revision === captured.revision
          && canonicalOf(candidate.actualBefore.ref) === refKey
          && candidate.actualBefore.revision === change.before.revision);
        if (rebase !== undefined) continue;
        return reject('revision_conflict', 'a changed object does not match the captured answer source pin', [captured]);
      }
    }
    return {
      status: 'ready',
      value: {
        schemaVersion: 1,
        actor: decoded.actor,
        appliedAt: decoded.appliedAt,
        receipt: { identityKey: receipt.identityKey, fingerprint: receipt.fingerprint, cursor: receipt.cursor },
        changes: proof.changes.map((change) => ({ before: change.before, after: change.after })),
        ...(proof.basisRebases === undefined ? {} : { basisRebases: proof.basisRebases }),
      },
    };
  };
}
