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
 * `receiptReadable` means "the formal receipt and its event were
 * found"; a missing/undecodable receipt is returned here, before the state call.
 * Only the event types in `PROOF_EVENT_DECODERS` are whitelisted;
 * an architecture/completion-policy change is `unsupported`.
 */
import type {
  ApplicationProofV1, DecisionApplicationReceiptV1, DecisionApplicationV1, SessionMessageRef,
} from '../../../contracts/core/session-message.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { DecisionChangeProofV1 } from '../../../contracts/goal-decisions.js';
import type { AggregateRef } from '../../../contracts/ledger.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import { canonicalOf } from '../../../contracts/fingerprint.js';
import { rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import type { EncodedDomainEvent, StoreFailure } from '../../record-store/ports.js';
import type { DecisionSourceFactsPort, S5RecordPort } from '../model/decision-contracts.js';
import { decodeMessageReleaseProofEvent } from './decision-change-proof.js';
import { decodeGoalSettingsChangedEvent, decisionChangeProofProblem } from '../persistence/decision-record-codecs.js';
import { noteDispositionChangedEventFromEvent } from '../persistence/note-record-codecs.js';
import { decodePlanRevisionAcceptedEvent, decodePlanProposalRecordedEvent } from '../persistence/plan-record-codecs.js';
import { taskClaimedEventFromEvent, taskRequeuedEventFromEvent } from '../tasks/claim-record-codecs.js';
import { unknownCallReviewChangedEventFromEvent } from '../tasks/unknown-call-review-codecs.js';
import { commandRerunRequestChangedEventFromEvent } from '../tasks/command-rerun-request-codecs.js';
import {
  verificationRoundEventFromEvent, VERIFICATION_ROUND_REVERIFIED_EVENT_TYPE,
  type VerificationRoundEvent,
} from '../persistence/evidence-record-codecs.js';

function mapStoreFailure(failure: StoreFailure): ReadResult<never> {
  switch (failure.code) {
    case 'not_found': return rejectedWithCurrent('incomplete', failure.reason);
    case 'revision_conflict': return rejectedWithCurrent('revision_conflict', failure.reason);
    case 'unsupported': return rejectedWithCurrent('unsupported', failure.reason);
    default: return rejectedWithCurrent('unavailable', failure.reason);
  }
}

/**
 * 7A §3.5 item 1: one effect event's formal facts. `ref` is the effect ref the caller's `effect.ref` is compared with
 * (`:229`); `party` is the Work Run the effect belongs to, or `null` when the effect belongs to no Run (`RunRef | null`,
 * D8-17); `after` is the post-effect version from the receipt's own commit; the event time is `ProofEvent.appliedAt`
 * and the audit actor is `ProofEvent.actor`, so neither is repeated here.
 */
export type EffectProofV1 = {
  kind: ApplicationProofV1['effect']['kind'];
  ref: AggregateRef;
  party: RunRef | null;
  after: VersionPin;
  /** §3.5 item 2: absent on a real old call without an acknowledgement; such an effect can never be applied. */
  acknowledgement?: SessionMessageRef;
};

/** The event body of a formal, whitelisted decision write. */
type ProofEvent = {
  actor: DecisionApplicationV1['actor'];
  appliedAt: string;
  proof: DecisionChangeProofV1 | null;
  effect?: EffectProofV1;                                  // present only on the five effect rows
};

/**
 * §3.3/4C-2: the whitelisted proof-event decoder table, keyed by event type.
 * `ArchitectureCatalogAdopted`/`ProjectCompletionPolicyActivated` stay explicit
 * `unsupported` rows (slice 6); an unknown type stays `incomplete`.
 */
type ProofEventDecoder = (event: EncodedDomainEvent, commit: CommittedReceiptRow) => ProofEvent | ReadResult<never>;

/** §3.5 item 1: the post-effect version of one effect, from the receipt's commit versions (one copy for five rows). */
function effectPinOf(commit: CommittedReceiptRow, ref: AggregateRef): VersionPin | null {
  const version = commit.versions.find((entry) => entry.refKey === canonicalOf(ref));
  return version === undefined ? null : { ref, revision: version.revision };
}

const PROOF_EVENT_DECODERS: Readonly<Record<string, ProofEventDecoder>> = {
  GoalSettingsChanged: (event) => {
    const decoded = decodeGoalSettingsChangedEvent(event);
    if (decoded.status !== 'decoded') return rejectedWithCurrent('unavailable', `the GoalSettingsChanged event is damaged: ${decoded.reason}`);
    return { actor: decoded.value.actor, appliedAt: decoded.value.occurredAt, proof: decoded.value.payload.proof };
  },
  PlanRevisionAccepted: (event) => {
    const decoded = decodePlanRevisionAcceptedEvent(event);
    if (decoded.status !== 'decoded') return rejectedWithCurrent('unavailable', `the PlanRevisionAccepted event is damaged: ${decoded.reason}`);
    return { actor: decoded.value.actor, appliedAt: decoded.value.occurredAt,
      proof: decoded.value.payload.decisionApplication ?? null };
  },
  // 4C-2: an ordinary disposition carries no proof (stays `incomplete` below); a
  // formal disposition proof is validated exactly like the other rows.
  NoteDispositionChanged: (event) => {
    const decoded = noteDispositionChangedEventFromEvent(event);
    if (decoded.status !== 'decoded') return rejectedWithCurrent('unavailable', `the NoteDispositionChanged event is damaged: ${decoded.reason}`);
    return { actor: decoded.value.actor as DecisionApplicationV1['actor'],
      appliedAt: decoded.value.occurredAt, proof: decoded.value.proof };
  },
  // K3 L19/§3.2: a non-application review change carries no proof and stays
  // `incomplete`; the two application changes carry the formal `DecisionChangeProofV1`.
  UnknownCallReviewChanged: (event) => {
    const decoded = unknownCallReviewChangedEventFromEvent(event);
    if (decoded.status !== 'decoded') {
      return rejectedWithCurrent('unavailable', `the UnknownCallReviewChanged event is damaged: ${decoded.reason}`);
    }
    return { actor: decoded.value.actor, appliedAt: decoded.value.occurredAt, proof: decoded.value.proof ?? null };
  },
  // K3 L19a/ruling 2: the three card-application changes carry the formal
  // `DecisionChangeProofV1`; the non-application changes carry none.
  CommandRerunRequestChanged: (event) => {
    const decoded = commandRerunRequestChangedEventFromEvent(event);
    if (decoded.status !== 'decoded') {
      return rejectedWithCurrent('unavailable', `the CommandRerunRequestChanged event is damaged: ${decoded.reason}`);
    }
    return { actor: decoded.value.actor, appliedAt: decoded.value.occurredAt, proof: decoded.value.proof ?? null };
  },
  SessionMessageReleaseDecided: decodeMessageReleaseProofEvent,
  // 7A §3.5 item 1: claim_created → the RunRef the claim created; the party is that Run.
  TaskClaimed: (event, commit) => {
    const decoded = taskClaimedEventFromEvent(event);
    if (decoded.status !== 'decoded') return rejectedWithCurrent('unavailable', `the TaskClaimed event is damaged: ${decoded.reason}`);
    const claim = decoded.value.claim;
    const after = effectPinOf(commit, claim.runRef);
    if (after === null) return rejectedWithCurrent('invalid', 'the receipt does not commit the claimed Run');
    return { actor: decoded.value.actor, appliedAt: decoded.value.occurredAt, proof: null,
      effect: { kind: 'claim_created', ref: claim.runRef, party: claim.runRef, after,
        ...(decoded.value.acknowledgement === undefined ? {} : { acknowledgement: decoded.value.acknowledgement }) } };
  },
  // proposal_created → the new PlanProposal's ref. The party is the event's own actor when it is an Agent: the Work
  // proposal writes `writer.actor` (`W/tasks/plan-service.ts:3298–:3303`, `actor` at `:3302`) and an agent `ActorRef`
  // carries `runRef` (`src/contracts/command-event.ts:20–:27`), so that Run is the real party (D8-17, rd7a2b-05). A
  // Host proposal's actor is a person or the system and belongs to no Run.
  PlanProposalRecorded: (event, commit) => {
    const decoded = decodePlanProposalRecordedEvent(event);
    if (decoded.status !== 'decoded') return rejectedWithCurrent('unavailable', `the PlanProposalRecorded event is damaged: ${decoded.reason}`);
    const ref = decoded.value.payload.proposal.ref;
    const after = effectPinOf(commit, ref);
    if (after === null) return rejectedWithCurrent('invalid', 'the receipt does not commit the proposal');
    const actor = decoded.value.actor;
    return { actor, appliedAt: decoded.value.occurredAt, proof: null,
      effect: { kind: 'proposal_created', ref, party: actor.kind === 'agent' ? actor.runRef : null, after,
        ...(decoded.value.acknowledgement === undefined ? {} : { acknowledgement: decoded.value.acknowledgement }) } };
  },
  // requeue → the TaskRequeue ref; the party is the Run the requeue covers.
  TaskRequeued: (event, commit) => {
    const decoded = taskRequeuedEventFromEvent(event);
    if (decoded.status !== 'decoded') return rejectedWithCurrent('unavailable', `the TaskRequeued event is damaged: ${decoded.reason}`);
    const requeue = decoded.value.requeue;
    const after = effectPinOf(commit, requeue.ref);
    if (after === null) return rejectedWithCurrent('invalid', 'the receipt does not commit the requeue');
    return { actor: decoded.value.actor, appliedAt: decoded.value.occurredAt, proof: null,
      effect: { kind: 'requeue', ref: requeue.ref, party: requeue.afterRunRef, after,
        ...(decoded.value.acknowledgement === undefined ? {} : { acknowledgement: decoded.value.acknowledgement }) } };
  },
  // recheck → the successor VerificationRound ref; the party is the Run whose round was reverified. The table already
  // dispatched on the event type and `verificationRoundEventFromEvent` checks the envelope against the body
  // (`persistence/evidence-record-codecs.ts:492`), so there is no runtime re-check: the union is narrowed at the type
  // level (rd7a2b-21), and the acknowledgement — a key only the `reverified` arm declares
  // (`evidence-record-codecs.ts:115–:117`) — is read from that arm (rd7a2b-08).
  VerificationRoundReverified: (event, commit) => {
    const decoded = verificationRoundEventFromEvent(event);
    if (decoded.status !== 'decoded') return rejectedWithCurrent('unavailable', `the VerificationRoundReverified event is damaged: ${decoded.reason}`);
    const reverified = decoded.value as Extract<VerificationRoundEvent,
      { eventType: typeof VERIFICATION_ROUND_REVERIFIED_EVENT_TYPE }>;
    const round = reverified.result;
    const after = effectPinOf(commit, round.ref);
    if (after === null) return rejectedWithCurrent('invalid', 'the receipt does not commit the successor round');
    return { actor: decoded.value.actor, appliedAt: decoded.value.occurredAt, proof: null,
      effect: { kind: 'recheck', ref: round.ref, party: round.subjectRunRef, after,
        ...(reverified.acknowledgement === undefined ? {} : { acknowledgement: reverified.acknowledgement }) } };
  },
  // The initial architecture/completion-policy proof is slice 6.
  ArchitectureCatalogAdopted: () => rejectedWithCurrent('unsupported',
    'only GoalSettingsChanged, PlanRevisionAccepted, NoteDispositionChanged, UnknownCallReviewChanged, CommandRerunRequestChanged and SessionMessageReleaseDecided applications are provable in this slice'),
  ProjectCompletionPolicyActivated: () => rejectedWithCurrent('unsupported',
    'only GoalSettingsChanged, PlanRevisionAccepted, NoteDispositionChanged, UnknownCallReviewChanged, CommandRerunRequestChanged and SessionMessageReleaseDecided applications are provable in this slice'),
};

export function decodeProofEvent(event: EncodedDomainEvent, commit: CommittedReceiptRow): ProofEvent | ReadResult<never> {
  const decode = PROOF_EVENT_DECODERS[event.eventType];
  if (decode === undefined) return rejectedWithCurrent('incomplete', 'the receipt is not a formal decision-application event');
  return decode(event, commit);
}

type CommittedReceiptRow = Extract<Awaited<ReturnType<S5RecordPort['lookupCommit']>>, { status: 'ready' }>['value'];
/** 7A §3.5: the formal receipt check both proofs share (the commit, its cursor and the one event it names). */
export async function readFormalReceiptEvent(
  records: Pick<S5RecordPort, 'lookupCommit' | 'eventAt'>,
  receipt: DecisionApplicationReceiptV1,
): Promise<ReadResult<{ commit: CommittedReceiptRow; event: EncodedDomainEvent }>> {
  let lookup: Awaited<ReturnType<S5RecordPort['lookupCommit']>>;
  try {
    lookup = await records.lookupCommit({ identityKey: receipt.identityKey, fingerprint: receipt.fingerprint });
  } catch {
    return rejectedWithCurrent('unavailable', 'the formal receipt could not be looked up');
  }
  if (lookup.status === 'rejected' && lookup.code === 'not_found') {
    return rejectedWithCurrent('incomplete', 'the formal receipt was not found');
  }
  if (lookup.status !== 'ready') return mapStoreFailure(lookup);
  if (String(lookup.value.cursor) !== String(receipt.cursor)) {
    return rejectedWithCurrent('revision_conflict', 'the caller receipt cursor disagrees with the recorded commit');
  }

  let located: Awaited<ReturnType<S5RecordPort['eventAt']>>;
  try {
    located = await records.eventAt(receipt.cursor);
  } catch {
    return rejectedWithCurrent('unavailable', 'the formal receipt event could not be read');
  }
  if (located.status === 'rejected' && located.code === 'not_found') {
    return rejectedWithCurrent('incomplete', 'the formal receipt event was not found');
  }
  if (located.status !== 'ready') return mapStoreFailure(located);
  if (String(located.value.cursor) !== String(receipt.cursor)) {
    return rejectedWithCurrent('revision_conflict', 'the receipt cursor disagrees with the formal event');
  }
  if (!lookup.value.eventIds.includes(located.value.event.eventId)) {
    return rejectedWithCurrent('unavailable', 'the formal event is not one of the receipt event ids');
  }

  return { status: 'ready', value: { commit: lookup.value, event: located.value.event } };
}

/** §3.3: the reader proving one recorded decision application from its receipt. */
export function readApplicationReceiptFacts(
  records: S5RecordPort,
): DecisionSourceFactsPort['readApplication'] {
  return async (_ctx, input): Promise<ReadResult<DecisionApplicationV1>> => {
    const { answer, receipt } = input;
    const checked = await readFormalReceiptEvent(records, receipt);
    if (checked.status !== 'ready') return checked;
    const { commit, event } = checked.value;

    const decoded = decodeProofEvent(event, commit);
    if ('status' in decoded) return decoded;
    if (decoded.proof === null || decoded.proof === undefined) {
      return rejectedWithCurrent('incomplete', 'the formal event carries no decision change proof');
    }
    const problem = decisionChangeProofProblem(decoded.proof);
    if (problem !== null) return rejectedWithCurrent('unavailable', `the decision change proof is damaged: ${problem}`);
    const proof = decoded.proof;
    if (canonicalOf(proof.acknowledgementRef) !== canonicalOf(answer.ref)) {
      return rejectedWithCurrent('invalid', 'the receipt is not associated with this answer');
    }
    for (const change of proof.changes) {
      const afterKey = canonicalOf(change.after.ref);
      if (afterKey === null
        || !commit.versions.some((version) => version.refKey === afterKey && version.revision === change.after.revision)) {
        return rejectedWithCurrent('revision_conflict', 'the receipt after version does not match the formal commit');
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
        return rejectedWithCurrent('revision_conflict', 'a changed object does not match the captured answer source pin', [captured]);
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
