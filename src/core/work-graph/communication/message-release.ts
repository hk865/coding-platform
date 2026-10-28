/**
 * The release owner and the bounded candidate read, the message release's two server-side jobs.
 *
 * The release is one R2 command: the message and the Goal facts it is released against are the command's own
 * facts, the machine decides the release, and the one commit's companions are the ones a direct send already
 * builds. The candidate read is the port's declared index: a page of approved messages, each with the Goal's
 * current block reason; it never sets `activity_conflict`, because a read holds no stored activity fact.
 *
 * The release owner is called only by internal code with the Host's system context; it adds no caller, scope or
 * `approvalRevision` check (list B). A read failure is the failure, never an empty page or a released message.
 */
import type { CoreCallContext, HostPrincipal } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import type { SendRejectionV1, SessionMessageRef } from '../../../contracts/core/session-message.js';
import { canonicalJson, sha256Hex } from '../../../contracts/fingerprint.js';
import { decodeKeysetCursor, encodeKeysetCursor, type KeysetCursorV1 } from '../../../contracts/keyset-cursor.js';
import type { DispatchBasisV1, GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { DispatchBasisFactsPort, DispatchBasisFactsV1 } from '../model/dispatch-basis-contracts.js';
import type { MessageSender, SessionMessage } from '../model/communication-contracts.js';
import type {
  MessageCommandWritePort, MessageReleaseCandidateV1, MessageReleaseCandidatesInputV1,
  MessageReleaseCandidatesPageV1, MessageReleaseCandidatesPort, MessageReleasePort, SessionMessageWriteCommandV1,
} from '../model/decision-contracts.js';
import { executeWriteCommand, type WriteCommand } from '../persistence/command-executor.js';
import { canonicalRefKey } from '../persistence/record-codecs.js';
import { ownerReadStoreFailureToRejection } from '../persistence/read-result-failures.js';
import {
  S7A2_RELEASE_BY_GOAL_LOOKUP, S7A2_RELEASE_BY_WORKSPACE_LOOKUP, decodeSessionMessageRecord, sessionMessageRefKey,
} from '../sessions/message-record-codecs.js';
import { sessionActivityRefOf } from '../sessions/session-activity.js';
import { readGoal } from '../tasks/plan-readers.js';
import {
  basisConflictCurrent, basisPinsOf, dispatchCurrentOf, eventIdOf, judge, mapReadResult, messageWriteResult,
  ownContext, readProgress, readSessionMessageRecord, refusalOf, releaseDecidedResult, releasedMessageCompanions,
  sameBasis, type Owned,
} from './mailbox-service.js';

export type MessageReleaseOwnerDependencies = {
  /** The one backend; `lookupOrdered` reads the R-idx index. */
  records: GoalRecordTransactionPort & RecordOrderedLookupPort;
  /** The mailbox's non-committing writer (`createMessageWriteOwner`, `mailbox-service.ts:4836`). */
  writes: Pick<MessageCommandWritePort, 'prepare'>;
  /** D's one facts read (`createDispatchBasisReader`, `W/tasks/dispatch-basis.ts:64`). */
  dispatchBasis: DispatchBasisFactsPort;
  now(): string;
};

type ReleaseApprovedFacts =
  | { branch: 'action_request'; message: SessionMessage; goal: GoalSnapshot; basis: DispatchBasisFactsV1 }
  | { branch: 'goal_only'; message: SessionMessage; goal: GoalSnapshot; basis: null };

type ReleaseApprovedDecision = {
  before: SessionMessage;
  goal: GoalSnapshot;
  basis: DispatchBasisFactsV1 | null;
  pins: DispatchBasisV1 | null;
};

/** Rules 2–4: the machine's release verdict, the active Goal, and the `action_request` pins. */
function decideReleaseApproved(owned: Owned, facts: ReleaseApprovedFacts):
  { refuse: SendRejectionV1 } | { decision: ReleaseApprovedDecision } {
  const { decided, ctx } = judge(owned.principal, facts.message, { type: 'message_released' }, {});
  if (!decided.ok) return { refuse: refusalOf(decided, ctx) };
  if (facts.goal.desiredState !== 'active') return { refuse: reject('busy', 'the Goal is not active') };
  if (facts.branch === 'goal_only') {
    return { decision: { before: facts.message, goal: facts.goal, basis: null, pins: null } };
  }
  const pins = facts.message.pins;
  if (pins === null || !sameBasis(pins, facts.basis.values)) {
    return { refuse: {
      ...reject('revision_conflict', 'the dispatch basis moved since it was read', basisPinsOf(facts.basis)),
      dispatchCurrent: dispatchCurrentOf(facts.basis),
    } };
  }
  return { decision: {
    before: facts.message, goal: facts.basis.goal, basis: facts.basis, pins: facts.basis.values,
  } };
}

/** Book §3.8 items 2–3: the two-branch release and the bounded candidate read. L publishes both. */
export function createMessageReleaseOwner(deps: MessageReleaseOwnerDependencies):
  Pick<MessageReleasePort, 'releaseApproved'> & MessageReleaseCandidatesPort {
  const records = deps.records;

  async function releaseApproved(ctx: CoreCallContext,
    input: { messageRef: SessionMessageRef; approvalRevision: number }):
    Promise<Extract<WriteResult<SessionMessage>, { status: 'committed' }> | SendRejectionV1> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    const context: Owned = owned;
    const messageRef: SessionMessageRef = {
      aggregateType: 'SessionMessage',
      projectId: input.messageRef.projectId,
      workspaceId: input.messageRef.workspaceId,
      messageId: input.messageRef.messageId,
    };
    const approvalRevision = input.approvalRevision;
    const commandId = sha256Hex(canonicalJson({ messageRef, approvalRevision }));

    // Only the activity companion retries (rule 6): its guard is the one retryable key. The action_request facts
    // and the message's ref key survive the executor's retry loop for the one post-conflict consistent read.
    const retry: { activityRefKey: string | null; actionBasis: DispatchBasisFactsV1 | null;
      releasedMessageKey: string | null } = { activityRefKey: null, actionBasis: null, releasedMessageKey: null };

    async function readApprovedReleaseFacts(): Promise<{ status: 'ready'; facts: ReleaseApprovedFacts } | CoreRejection> {
      const loaded = await readSessionMessageRecord(records, context.signal, messageRef);
      if (loaded.status !== 'ready') return mapReadResult(loaded) as CoreRejection;
      const message = loaded.value;
      const recipient = message.recipient as SessionRef;
      retry.activityRefKey = canonicalRefKey(sessionActivityRefOf(recipient));
      const goalRef = message.goalRef;
      if (goalRef === null) return reject('unavailable', 'the approved message has no Goal');
      if (message.intent === 'action_request') {
        const facts = await deps.dispatchBasis.readDispatchFacts(ctx, { goalRef });
        if (facts.status !== 'ready') return mapReadResult(facts) as CoreRejection;
        retry.actionBasis = facts.value;
        retry.releasedMessageKey = sessionMessageRefKey(message.ref);
        return { status: 'ready', facts: {
          branch: 'action_request', message, goal: facts.value.goal, basis: facts.value,
        } };
      }
      const goal = await readGoal(records, goalRef);
      if (goal.status !== 'ready') return goal;
      return { status: 'ready', facts: { branch: 'goal_only', message, goal: goal.goal, basis: null } };
    }

    const command: WriteCommand<ReleaseApprovedFacts, ReleaseApprovedDecision, SendRejectionV1,
      SessionMessage, SessionMessage> = {
      operation: 'message.releaseApproved',
      // The message ref's own project and workspace; the caller is trusted and its context is never compared.
      scope: { projectId: messageRef.projectId, workspaceId: messageRef.workspaceId },
      principal: null,
      commandId,
      fingerprintInput: { messageRef, approvalRevision },
      read: readApprovedReleaseFacts,
      decide: (facts) => decideReleaseApproved(context, facts),
      build: async (decision, keys) => {
        const at = deps.now();
        const message = decision.before;
        const companions = await releasedMessageCompanions(records, {
          at,
          messageRef: message.ref,
          recipient: message.recipient as SessionRef,
          intent: message.intent ?? null,
          deadlineMs: message.deadlineMs,
          basis: decision.basis,
        });
        if (!companions.ok) return companions.rejection;
        const actor: MessageSender = { kind: 'host', actor: (context.principal as HostPrincipal).actor };
        const write: SessionMessageWriteCommandV1 = {
          operation: 'message.releaseApproved',
          messageRef: message.ref,
          before: message,
          expectedRevision: message.revision,
          event: {
            eventId: eventIdOf(keys.identityKey, 'SessionMessageReleased'),
            occurredAt: at,
            requestId: commandId,
            projectId: message.ref.projectId,
            workspaceId: message.ref.workspaceId,
            actor,
          },
          change: { kind: 'released', releasedAt: at, deadline: companions.value.deadline, pins: decision.pins },
        };
        return deps.writes.prepare(ctx, write, {
          records: companions.value.records,
          events: [],
          guards: [
            { refKey: canonicalRefKey(decision.goal.ref), expectedRevision: decision.goal.revision },
            ...companions.value.guards,
          ],
          claims: [],
        });
      },
      result: { ...releaseDecidedResult, eventType: 'SessionMessageReleased' as const },
      retryable: {
        guard: (refKey) => retry.activityRefKey !== null && refKey === retry.activityRefKey,
      },
    };
    // The executor's own result, kept whole: a refusal is the release's business answer, not a commit conflict.
    const written = await executeWriteCommand(records, command);
    if (written.status === 'rejected' && written.code === 'revision_conflict'
      && retry.actionBasis !== null && retry.releasedMessageKey !== null) {
      const basis = retry.actionBasis;
      const refKeys = new Set([...basis.guards.map((guard) => guard.refKey), retry.releasedMessageKey]);
      return basisConflictCurrent(messageWriteResult(written), refKeys,
        () => deps.dispatchBasis.readDispatchFacts(ctx, { goalRef: basis.goal.ref }));
    }
    // An activity-only conflict spent the retry bound: report the conflict, with no dispatch projection.
    if (written.status === 'rejected' && written.code === 'busy'
      && written.cause !== undefined && 'store' in written.cause
      && written.cause.store.code === 'revision_conflict') {
      return reject('revision_conflict', written.reason, written.current);
    }
    return messageWriteResult(written);
  }

  async function readReleaseCandidates(ctx: CoreCallContext, input: MessageReleaseCandidatesInputV1):
    Promise<ReadResult<MessageReleaseCandidatesPageV1>> {
    const goalRef: GoalRef | null = input.goalRef === null ? null : { ...input.goalRef };
    const scope = { projectId: input.scope.projectId, workspaceId: input.scope.workspaceId };
    const checked = releaseCandidatePageInput({ goalRef, after: input.after, limit: input.limit });
    if (!checked.ok) return checked.rejection;
    const goalId = goalRef === null ? null : goalRef.goalId;
    let page: Awaited<ReturnType<typeof records.lookupOrdered>>;
    try {
      page = await records.lookupOrdered({
        index: goalRef === null ? S7A2_RELEASE_BY_WORKSPACE_LOOKUP : S7A2_RELEASE_BY_GOAL_LOOKUP,
        values: goalRef === null
          ? [scope.projectId, scope.workspaceId, 'approved']
          : [scope.projectId, scope.workspaceId, 'approved', goalRef.goalId],
        direction: 'asc',
        ...(checked.after === null ? {} : { after: checked.after }),
        limit: input.limit,
      });
    } catch {
      return reject('unavailable', 'the release-candidate lookup failed');
    }
    if (page.status !== 'ready') return ownerReadStoreFailureToRejection(page);
    const progress = readProgress(page.value.readThrough, undefined);
    if (!progress.ok) return progress.result;

    type Candidate = { index: number; message: SessionMessage; goalRef: GoalRef };
    type GoalBlock = { desiredState: GoalSnapshot['desiredState']; currentValues: DispatchBasisV1 | null };
    const candidates: Candidate[] = [];
    for (const record of page.value.records) {
      const decoded = decodeSessionMessageRecord(record);
      if (decoded.status !== 'decoded') {
        return reject('unavailable', `the message record is damaged: ${decoded.reason}`);
      }
      // A withdrawn message is not a candidate; the page continues with the lookup's own next cursor.
      if (decoded.value.withdrawnAt !== null) continue;
      const goalRef = decoded.value.goalRef;
      if (goalRef === null) return reject('unavailable', 'the approved message has no Goal');
      candidates.push({ index: candidates.length, message: decoded.value, goalRef });
    }

    // One read per Goal of the page: the facts for a Goal with an action_request, the Goal alone otherwise.
    const goals = new Map<string, { goalRef: GoalRef; action: boolean; members: Candidate[] }>();
    for (const candidate of candidates) {
      const seen = goals.get(candidate.goalRef.goalId);
      if (seen === undefined) {
        goals.set(candidate.goalRef.goalId, {
          goalRef: candidate.goalRef,
          action: candidate.message.intent === 'action_request',
          members: [candidate],
        });
      } else {
        seen.members.push(candidate);
        if (candidate.message.intent === 'action_request') seen.action = true;
      }
    }
    // The Goal reads are grouped below; the page's own approval order is the item order.
    const items: MessageReleaseCandidateV1[] = [];
    for (const entry of goals.values()) {
      let goal: GoalBlock;
      if (entry.action) {
        const facts = await deps.dispatchBasis.readDispatchFacts(ctx, { goalRef: entry.goalRef });
        if (facts.status !== 'ready') return mapReadResult(facts) as CoreRejection;
        goal = { desiredState: facts.value.goal.desiredState, currentValues: facts.value.values };
      } else {
        const read = await readGoal(records, entry.goalRef);
        if (read.status !== 'ready') return read;
        goal = { desiredState: read.goal.desiredState, currentValues: null };
      }
      for (const candidate of entry.members) {
        items[candidate.index] = {
          messageRef: candidate.message.ref,
          revision: candidate.message.revision,
          // A message becomes awaiting only at creation, and creation writes revision 1.
          creationRevision: 1,
          pins: candidate.message.pins,
          deadline: candidate.message.deadline,
          blockedReason: releaseCandidateBlockedReason(candidate.message, goal),
        };
      }
    }
    return { status: 'ready', value: {
      items,
      readThrough: progress.readThrough,
      nextCursor: page.value.next === null ? null : encodeKeysetCursor(goalId, page.value.next),
    } };
  }

  return { releaseApproved, readReleaseCandidates };
}

/**
 * The page input's pure checks: `limit` in 1–100, and the opaque cursor decoded with the shared
 * `decodeKeysetCursor` (`C/keyset-cursor.ts`, E0.2) under the input's `goalId` (`null` for the workspace page). A
 * `limit` outside 1–100, or a cursor that decodes to `null`, is `invalid`. The decoded `after` (its `order` is
 * `string | number`, the ordered port's `OrderedLookupValue`, `lookup-ports.ts:45`) is passed to the port's `after`
 * (`:53`) unchanged.
 */
export function releaseCandidatePageInput(input: { goalRef: GoalRef | null; after: string | null; limit: number }):
  { ok: true; after: KeysetCursorV1['after'] | null } | { ok: false; rejection: CoreRejection } {
  if (input.limit < 1 || input.limit > 100) {
    return { ok: false, rejection: reject('invalid', 'the release-candidate page limit must be between 1 and 100') };
  }
  if (input.after === null) return { ok: true, after: null };
  const after = decodeKeysetCursor(input.after, input.goalRef === null ? null : input.goalRef.goalId);
  if (after === null) {
    return { ok: false, rejection: reject('invalid', 'the release-candidate cursor does not belong to this page') };
  }
  return { ok: true, after };
}

/** One candidate's block reason (candidate read item 5). It never returns `activity_conflict`. */
export function releaseCandidateBlockedReason(
  message: Pick<SessionMessage, 'intent' | 'pins'>,
  goal: { desiredState: GoalSnapshot['desiredState']; currentValues: DispatchBasisV1 | null },
): Exclude<MessageReleaseCandidateV1['blockedReason'], 'activity_conflict'> {
  if (goal.desiredState !== 'active') return 'goal_not_active';
  if (message.intent === 'action_request'
    && (message.pins === null || goal.currentValues === null || !sameBasis(message.pins, goal.currentValues))) {
    return 'stale_pins';
  }
  return null;
}
