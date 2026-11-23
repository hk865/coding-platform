/**
 * The all-Session consumption view: one bounded walk of the Session directory that answers, per
 * candidate, its availability, the busy reason and the offerable input kinds. It reads published facts only and
 * writes nothing: the directory scan is the Session owner's, the delivery verdict is the one `deliveryEligibility`
 * rule, and the offer order is the one `compareSessionInputCandidates`. `after`/`next` are Session keys
 * (`plainSessionRefKey`), never the opaque directory cursor that turns `source_stale` after any commit. A line whose
 * own facts cannot be read is `skipped` with its reason; the other lines are still answered.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import { isUserMessageRecipient, type SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { CoreError, ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { parseInitialPlanningResponseV2 } from '../../../contracts/initial-planning-parse.js';
import { interventionPlanningQueryRefs, queryJobRefFor, type QueryRunRef } from '../../../contracts/query-job.js';

import type { SessionAvailability } from '../state/session-availability.js';
import type { SessionCard, SessionDirectoryPort, SessionPageRequest } from '../model/session-contracts.js';
import type { SessionMailboxPort } from '../model/communication-contracts.js';
import { consultationFacts, interventionGoalRefOf, type SessionMessage } from '../model/communication-contracts.js';
import type { ExecutionReadPort } from '../model/execution-read-contracts.js';
import type { PlanTaskPort } from '../model/plan-contracts.js';
import type { UnknownCallReviewReadPort } from '../model/unknown-call-review-contracts.js';
import type { QueryJobPort } from '../queries/contracts.js';
import type {
  DeliveryEligibilityFactsPort, SessionFactsPort, SessionSettlementDuePort,
} from '../model/session-facts-contracts.js';
import { deliveryEligibility, isMessageAgentSender, isSecretaryRequestMessage, isWaitMessage,
  waitFactsOfRecord, waitStateOf } from '../state/message-machine.js';
import { plainSessionRefKey } from '../sessions/session-record-codecs.js';
import { compareSessionInputCandidates, sessionMessageRefKey } from '../sessions/message-record-codecs.js';
import { chainTailIsSource, hostContextIn, interventionProposalRefOf, interventionQueryWorkspaceOf, overlapNoteOf,
  requestCandidateChainEndOf, trustedSystemRoundOfMessage, type CandidateChainEndDeps } from '../tasks/plan-lineage.js';
import type { OverlapGatePort } from '../tasks/overlap-gates.js';

/**
 * The kinds an offer can name. `notify` is the no-turn case. `person_message`, `system_round`,
 * `agent_wake` and `decision_answer` all route to the one intervention dispatch (the recipient duty decides the
 * planning/text shape there). `action_request` names only a settlement close-out. A reply is never a kind: it is
 * supplied at the line's safe point or its next round, not by opening one.
 */
export type ConsumableSessionKindV1 =
  | 'person_message' | 'system_round' | 'agent_wake' | 'decision_answer'
  | 'notify' | 'action_request';
/** The busy reasons, in the order the view applies them. */
export type ConsumableSessionBusyV1 =
  | 'copy' | 'archive_request' | 'health' | 'claim_not_started' | 'run' | 'query' | 'unknown';
export type ConsumableSessionOfferV1 = {
  kind: ConsumableSessionKindV1;
  messageRef: SessionMessageRef;
  /**
   * This offer continues the line's own claimed/prepared `intervention_planning` Query, so it is not a new round:
   * the Host keeps the line's wait and delivery facts but does not require an idle, unoccupied line. The named
   * `resumeQueryRunRef` is the run the view checked; the Host re-checks that the line's occupancy is still it.
   */
  resume?: true;
  /** Only a `resume` offer carries this: the QueryRun whose occupancy the Host re-checks before skipping the gates. */
  resumeQueryRunRef?: QueryRunRef;
  /**
   * This `action_request` close-out has its one fixed notice already committed and owes exactly one reply slot: the
   * source R (`source`) or the executor's original wait M (`original`; `M === R` names either, the same message). The
   * Host runs the association step alone, before any model profile, and sends no notice.
   */
  missingReply?: 'source' | 'original';
};
export type ConsumableSessionV1 = {
  session: SessionRef;
  /** the Session's role; the Host matches its profile by `scope` + `sessionRole`. */
  role: RoleConfigurationRef;
  availability: SessionAvailability;
  /**
   * non-null means no queued offer; only a line's own unentered intervention planning Query keeps its source message,
   * and an unoccupied line with a pending archive request keeps its settlement close-outs (window 3).
   */
  busy: ConsumableSessionBusyV1 | null;
  /** offerable kinds in precedence order (person first); `['notify']` is the no-turn case. */
  kinds: readonly ConsumableSessionKindV1[];
  /** the first non-`notify` offer, or null; the Host reads this one message and opens one turn. */
  nextMessage: ConsumableSessionOfferV1 | null;
};
/** A line whose own facts could not be read this pass; it is left whole for a later pass (121-105). */
export type ConsumableSessionSkipV1 = {
  session: SessionRef;
  /** the failed read's rejection code, or `not_found`/`not_ready` for a read that returned that status */
  code: CoreError | 'not_ready';
  reason: string;
};
export type ConsumableSessionsPageV1 = {
  items: ConsumableSessionV1[];
  /** the walked lines that were skipped, in walk order; they use no quota. */
  skipped: ConsumableSessionSkipV1[];
  /** the last walked Session key, an item or a skip (plainSessionRefKey); null when the walk reached the end (wrap next heartbeat). */
  next: string | null;
};
/**
 * Completion proof for one finished round's fixed closing notice. The Host's notice writer keys the notice by the
 * source message and the round's frozen part, so a read keyed the same way can never see another round's notice.
 * `true` is committed, `false` is not committed yet (an absent receipt is `false`, not a read failure); a real read
 * failure is returned. The Host supplies this read beside its notice writer; when it is absent the view cannot
 * prove the notice and keeps the older classification. `reason` narrows the proof to the one closing reason this
 * read asks about (the formal `no_answer` conclusion); absent proves any reason.
 */
export type InterventionClosingNoticeRead = (ctx: CoreCallContext, input: {
  sourceMessageRef: SessionMessageRef;
  part: 'message' | 'decision_answer';
  reason?: 'no_answer';
}) => Promise<ReadResult<boolean>>;
export type ConsumableSessionsDependencies = {
  directory: Pick<SessionDirectoryPort, 'findSessions'>;
  executions: Pick<ExecutionReadPort, 'readExecution'>;
  queries: Pick<QueryJobPort, 'readQueryJob' | 'readQueryAnswer'>;
  messages: Pick<SessionMailboxPort,
    'readInbox' | 'readOutbox' | 'readMessage' | 'readMessageBody' | 'readHostSendMessageRef'>;
  /** The candidate and the source's Goal (where its Query lives) `settlementOfferOf` reads; it never writes a record.
   *  `queryGoalDisplay` is optional on the port and is the Goal-completion fact the ordinary-wake split reads. */
  plans: Pick<PlanTaskPort, 'readPlanProposal' | 'queryGoal' | 'queryGoalDisplay'>;
  /** The delivery-eligibility facts the offer rule reads (`session-facts-contracts.ts:79`). */
  eligibility: DeliveryEligibilityFactsPort;
  /** The fixed closing notice of a finished round, by its frozen source and part; never a second notice identity. */
  closingNotice?: InterventionClosingNoticeRead;
  /**
   * The line's own bound wait: the Run that yielded on it (`SessionFactsV1.wait`). An optional fact that keeps an
   * ordinary wake in the box while the line is waiting; absent keeps today's idle-line behavior.
   */
  sessionFacts?: Pick<SessionFactsPort, 'readSessionFacts'>;
  /**
   * The overlap gates' saved `noteRequest.messageRef`: an optional fact that classifies a gate's note as the
   * platform's note round. Absent keeps today's ordinary-wake classification.
   */
  overlapGates?: Pick<OverlapGatePort, 'readOverlapGates'>;
  /**
   * A12: the Goal's trusted successor relation (plan readers' `candidateSuccessorsOf`), so a close-out's candidate
   * chain also follows verified `planfix:` successors. Absent keeps the formal replacement edges only.
   */
  candidateSuccessors?: CandidateChainEndDeps['successors'];
  /**
   * The existing `UnknownCallReview` read: an optional fact that lets the one trusted-system-round recognizer
   * compare an `unknown_call` round's formally carried Task with the named review record's `task`. Absent keeps
   * today's recognition, where that round writes no checkable Task.
   */
  readReview?: UnknownCallReviewReadPort['readReview'];
};
export interface ConsumableSessionsPort {
  readConsumableSessions(ctx: CoreCallContext,
    input: { workspace: WorkspaceScope; after: string | null; limit: number }):
    Promise<ReadResult<ConsumableSessionsPageV1>>;
}

export function createConsumableSessions(deps: ConsumableSessionsDependencies):
  Pick<ConsumableSessionsPort, 'readConsumableSessions'> & SessionSettlementDuePort {
  type CandidateOffer = {
    kind: ConsumableSessionKindV1;
    message: SessionMessage;
    cursor: () => CommitCursor;
    /** Only a claimed/prepared Query's own source carries this; see `resumeOfferOf`. */
    resume?: true;
    /** Only a resume offer carries this: the QueryRun whose occupancy the Host re-checks. */
    resumeQueryRunRef?: QueryRunRef;
    /** Only a close-out whose notice is committed and one reply slot is missing carries this; see `missingReply`. */
    missingReply?: 'source' | 'original';
  };
  /**
   * One settlement read's verdict: a close-out offer (`action_request`, possibly naming the one missing reply slot) or
   * one of the two non-offer ends. `deferred` is an executor wait still holding its candidate/questions reply.
   */
  type SettlementVerdict =
    | { kind: ConsumableSessionKindV1; missingReply?: 'source' | 'original' }
    | 'deferred' | 'ended';
  type OfferSet = {
    kinds: ConsumableSessionKindV1[];
    nextMessage: ConsumableSessionOfferV1 | null;
  };

  const ready = <T>(value: T): ReadResult<T> => ({ status: 'ready', value });

  /**
   * The kinds that open a new round of their own. A person's B20 `person_message` takes its new-Goal branch, and
   * `action_request`/`notify` open no turn. A completed Goal holds every one of these kinds (`newRoundHeld`); a line's
   * bound wait holds only the agent's `agent_wake` and `decision_answer`, and the platform's `system_round` still opens.
   */
  const isNewRoundKind = (kind: ConsumableSessionKindV1): boolean =>
    kind === 'agent_wake' || kind === 'system_round' || kind === 'decision_answer';

  /**
   * Whether an ordinary wake must stay in the box for this candidate: no Goal and a line that yielded on a wait both
   * leave the wake queued. A completed Goal is `newRoundHeld`'s, which every new non-B20 round shares. An existing
   * Query's resume is not a new wake and does not call this.
   */
  async function ordinaryWakeHeld(message: SessionMessage,
    lineBoundWait: () => Promise<ReadResult<boolean>>): Promise<ReadResult<boolean>> {
    if (interventionGoalRefOf(message) === null) return ready(true);
    return lineBoundWait();
  }

  /**
   * Whether a new non-B20 round must stay where it is because its Goal is complete. The Host opens no such round and
   * the message stays readable (design 2.3), so offering it would hold the queue head on every pass. Only a fresh
   * offer reads this: an existing round's close-out is judged before it, an existing Query's resume keeps its own
   * entry, a person's B20 message keeps its new-Goal request, and `notify` and a late reply open no round.
   */
  async function newRoundHeld(ctx: CoreCallContext, offer: CandidateOffer): Promise<ReadResult<boolean>> {
    if (!isNewRoundKind(offer.kind)) return ready(false);
    return goalCompletedOf(ctx, offer.message);
  }

  /**
   * Whether the message's Goal is complete. The Goal display's `phase` is the existing completion fact that
   * `handleIntervention` also reads; without the optional display read today's classification stays.
   */
  async function goalCompletedOf(ctx: CoreCallContext, message: SessionMessage): Promise<ReadResult<boolean>> {
    const display = deps.plans.queryGoalDisplay;
    const goalRef = interventionGoalRefOf(message);
    if (display === undefined || goalRef === null) return ready(false);
    const goalWorkspace = await interventionQueryWorkspaceOf(ctx, deps.plans, message);
    if (goalWorkspace.status !== 'ready') return goalWorkspace;
    const read = await display(hostContextIn(ctx, goalWorkspace.value), { goalRef });
    if (read.status !== 'ready') return read;
    return ready(read.value.display.phase === 'COMPLETED');
  }

  /**
   * The stored-fact classification of one inbox message. Only the persisted entry, the trusted system round,
   * the gate's saved note reference, the sender kind, `wake` and the card's `decision` decide; no body text chooses
   * a shape. A `null` result is a message this pass does not offer; `notify` is the no-turn case and never reaches
   * the Host's dispatch.
   */
  async function offerKindOf(ctx: CoreCallContext, message: SessionMessage):
    Promise<ReadResult<ConsumableSessionKindV1 | null>> {
    // A copy question is consumed by the Host by its inquiry identity and never by the original line's busy/idle scan.
    if (message.answeredBy === 'copy') return ready(null);
    // A person's direct intervention is the only B20 input. The entry is written by the Host entry, never by a
    // model, and a withdrawn one is no input at all.
    if (message.entry !== undefined) {
      return ready(message.sender.kind === 'host' && message.sender.actor.kind === 'human'
        && message.withdrawnAt === null ? 'person_message' : null);
    }
    // A platform/request card (carrying `decision`, but not an agent's `ask_person` card read from its sender's
    // outbox) is settled by its answer path or goes to the request queue; it never opens a round.
    if (message.decision !== undefined) return ready(null);
    // `wake:false` is the platform's notify: the input waits for the line's next natural round.
    if (!message.wake) return ready('notify');
    // A gate's saved `noteRequest.messageRef` classifies its own message as the platform's note round before the
    // ordinary wake split; the match is the complete message reference, never the body or the intent.
    const overlapNote = await overlapNoteOf(ctx, { plans: deps.plans, gates: deps.overlapGates }, message);
    if (overlapNote.status !== 'ready') return overlapNote;
    if (overlapNote.value !== null) return ready('system_round');
    // The one trusted-system-round read the reply slot and both input supplies share: the fixed sender only
    // proposes; the Host's sent receipt decides. An ordinary body or a forward copy falls through to the sender split.
    const trusted = await trustedSystemRoundOfMessage(ctx, deps, message);
    if (trusted.status !== 'ready') return trusted;
    if (trusted.value !== null) return ready('system_round');
    // Agent lines and the platform's own system-automation messages wake an idle line. A Host message from a
    // human is not a platform wake (a person's forward copy keeps the original sender and `wake`, and carries no
    // `entry`); it waits for the line's next natural round. The recipient's duty decides the planning/text shape
    // in the Host's one dispatch, not here.
    if (isMessageAgentSender(message.sender)
      || (message.sender.kind === 'host' && message.sender.actor.kind === 'system')) return ready('agent_wake');
    return ready('notify');
  }

  /**
   * The busy reasons, in the order they apply. A non-ready execution/query read is returned
   * unchanged, never guessed into a busy kind.
   */
  async function busyReasonOf(ctx: CoreCallContext, record: SessionCard['record']):
    Promise<ReadResult<ConsumableSessionBusyV1 | null>> {
    if (record.provenance.kind === 'readonly_copy') return ready('copy');
    if (record.archiveRequest != null) return ready('archive_request');
    if (record.health !== 'available' || record.lifecycle === 'archived') return ready('health');
    const occupancy = record.occupancy;
    if (occupancy === null) return ready(null);
    if (occupancy.kind === 'maintenance') return ready('archive_request');
    const executionRef = occupancy.executionRef;
    if (executionRef.aggregateType === 'Run') {
      // The Run is read where it runs, with the caller's original Host identity: a line in this
      // workspace may be executing another workspace's Run in the same project (ruling R1/W).
      const read = await deps.executions.readExecution(ctx, executionRef, { scope: 'project' });
      if (read.status !== 'ready') return read;
      const run = read.value.run;
      if (run.status === 'starting') return ready('claim_not_started');
      if (run.outcome === 'outcome_unknown') return ready('unknown');
      return ready('run');
    }
    // The same for a QueryRun: a joined workspace's exploration Query may run on a line of this workspace.
    const read = await deps.queries.readQueryJob(ctx,
      queryJobRefFor(executionRef.projectId, executionRef.workspaceId, executionRef.queryJobId), { scope: 'project' });
    if (read.status !== 'ready') return read;
    const phase = read.value.run.run.executionState?.phase;
    if (phase === 'claimed' || phase === 'prepared' || phase === 'entering' || phase === 'entered') {
      return ready('query');
    }
    return ready(phase === 'unknown' ? 'unknown' : null);
  }

  /**
   * One message as an offer, through the one eligibility rule and the one `consultationFacts` conversion. A
   * `decision_answer` reads the card's formal response facts (its one input identity) and keeps the card's own
   * sender line. An ordinary reply is never offered here: it is supplied at a safe point or the next round.
   */
  async function offerOf(ctx: CoreCallContext, message: SessionMessage,
    part: 'message' | 'decision_answer',
    target: SessionRef, cursor: () => CommitCursor, noteRound = false): Promise<ReadResult<CandidateOffer | null>> {
    const extra = await deps.eligibility.readDeliveryEligibilityFacts(ctx, { messageRef: message.ref });
    if (extra.status !== 'ready') return extra;
    const facts = consultationFacts(message, part === 'decision_answer' ? 'response' : part, extra.value, target);
    if (!deliveryEligibility(facts).offerable) return ready(null);
    if (part === 'decision_answer') return ready({ kind: 'decision_answer', message, cursor });
    // A resumed overlap-note round is named by the gate proof its Query froze, not by the gate's current
    // `noteRequest`, which a later basis change clears.
    if (noteRound) return ready({ kind: 'system_round', message, cursor });
    const kind = await offerKindOf(ctx, message);
    if (kind.status !== 'ready') return kind;
    return ready(kind.value === null ? null : { kind: kind.value, message, cursor });
  }

  /**
   * The one closing-notice proof of a finished round, by the round's frozen source and part; `undefined` when the
   * Host's read is not wired, so the caller keeps the older classification. `reason` narrows the proof to that one
   * closing reason (the formal `no_answer` conclusion).
   */
  async function closingNoticeOf(ctx: CoreCallContext, source: SessionMessage,
    part: 'message' | 'decision_answer', reason?: 'no_answer'):
  Promise<ReadResult<boolean | undefined>> {
    const read = deps.closingNotice;
    if (read === undefined) return ready(undefined);
    const notice = await read(ctx, { sourceMessageRef: source.ref, part,
      ...(reason === undefined ? {} : { reason }) });
    return notice.status === 'ready' ? ready(notice.value) : notice;
  }

  /**
   * The executor's original wait M a planresume/planfix Query froze (`repliesToMessageRef`), when it is still an open,
   * unanswered executor wait. `null` for no reply target, a closed wait, a saved reply or a non-executor sender; the
   * stored sender and wait facts decide, never the body.
   */
  async function openOriginalWaitOf(ctx: CoreCallContext, repliesTo: SessionMessageRef | undefined):
  Promise<ReadResult<SessionMessage | null>> {
    if (repliesTo === undefined) return ready(null);
    const wait = await deps.messages.readMessage(hostContextIn(ctx, repliesTo.workspaceId), repliesTo);
    if (wait.status !== 'ready') return wait;
    const message = wait.value;
    const executorSender = message.sender.kind === 'work_run' || message.sender.kind === 'secretary_round';
    return ready(executorSender && isWaitMessage(message) && message.response === null
      && waitStateOf(message, waitFactsOfRecord(message)).state === 'open' ? message : null);
  }

  /** The one chain-end read's dependencies: the candidate reads and, when wired, the trusted successor relation. */
  const chainDeps: CandidateChainEndDeps = { plans: deps.plans,
    ...(deps.candidateSuccessors === undefined ? {} : { successors: deps.candidateSuccessors }) };

  /**
   * Which single reply slot a close-out still owes once its one fixed notice is committed (A12). The candidate chain's
   * end decides first, before the `M === R` split: `incomplete` → nothing now, read again next pass; `pending` → only
   * R, and only when R is not the executor's open wait M itself; `accepted` → the adoption recovery owns M, so again
   * only such an R; `abandoned` → M is replied by the chain tail's formal Answer: this source does it (M first, then
   * the still-empty R) only when the tail is its own round, otherwise the Goal loop's recovery does and R waits until
   * M is no longer open. A round that wrote no candidate fills M first, then R. `null` is nothing to fill yet.
   * `sourceIsOpenWait` is R's own open executor wait.
   */
  async function missingReplyOf(ctx: CoreCallContext, source: SessionMessage,
    repliesTo: SessionMessageRef | undefined, goalCtx: CoreCallContext, workspaceId: string, goalId: string,
    part: 'message' | 'decision_answer', sourceIsOpenWait: boolean): Promise<ReadResult<'source' | 'original' | null>> {
    const original = await openOriginalWaitOf(ctx, repliesTo);
    if (original.status !== 'ready') return original;
    const distinct = original.value !== null
      && sessionMessageRefKey(original.value.ref) !== sessionMessageRefKey(source.ref);
    const proposal = await deps.plans.readPlanProposal(goalCtx,
      interventionProposalRefOf(source.ref, workspaceId, goalId, part));
    if (proposal.status !== 'ready' && proposal.status !== 'not_found') return proposal;
    if (proposal.status === 'ready') {
      const end = await requestCandidateChainEndOf(goalCtx, chainDeps, proposal.value);
      if (end.status !== 'ready') return end;
      if (end.value.kind === 'incomplete') return ready(null);
      if (end.value.kind !== 'abandoned') return ready(distinct || !sourceIsOpenWait ? 'source' : null);
      // Another tail's Answer replies M on the Goal loop; R follows once M is no longer an open wait.
      if (!chainTailIsSource(end.value, source.ref, part)) return ready(distinct || sourceIsOpenWait ? null : 'source');
    }
    return ready(distinct ? 'original' : 'source');
  }

  /**
   * C-25/A12: the one effect left after a candidate chain ends not adopted is the executor's original wait M's
   * reply. R's own reply and the round's one fixed notice are already committed; only M is still open and
   * unanswered. The chain is followed to its end first: a successor still pending or adopted replies M through its
   * own round or the adoption recovery, so only an abandoned end leaves M here. A missing proposal record is a
   * round that wrote no candidate. The stored proposals and M's own wait facts decide, never the body.
   */
  async function missingOriginalReplyOf(ctx: CoreCallContext, source: SessionMessage,
    repliesTo: SessionMessageRef | undefined, goalCtx: CoreCallContext, workspaceId: string, goalId: string,
    part: 'message' | 'decision_answer'): Promise<ReadResult<boolean>> {
    if (repliesTo === undefined) return ready(false);
    const proposal = await deps.plans.readPlanProposal(goalCtx,
      interventionProposalRefOf(source.ref, workspaceId, goalId, part));
    if (proposal.status === 'not_found') return ready(false);
    if (proposal.status !== 'ready') return proposal;
    // Only an abandoned chain whose tail is this round replies M from here; another tail's M is the Goal loop's.
    const end = await requestCandidateChainEndOf(goalCtx, chainDeps, proposal.value);
    if (end.status !== 'ready') return end;
    if (end.value.kind !== 'abandoned' || !chainTailIsSource(end.value, source.ref, part)) return ready(false);
    const wait = await openOriginalWaitOf(ctx, repliesTo);
    if (wait.status !== 'ready') return wait;
    return ready(wait.value !== null);
  }

  /**
   * §5.5.2's recovery read: the settlement of one traversed source, in either the inbox or the sender's outbox. It
   * derives that source's one deterministic intervention Query by the source's frozen part, then proves only the
   * effects that round owes by its frozen `answerShape` and its formal conclusion: the candidate (a planning-shape
   * round whose saved Answer is a plan), the question cards (the saved Answer's own read projection), the reply (a
   * `needsReply:true` ordinary source) and the Host's one fixed closing notice. `action_request` is a terminal Query
   * with an owed effect still missing, or a formal `no_answer` whose notice/withdrawal did not finish; `ended` is a
   * round with every owed effect present or a withdrawn source (the queue head must yield); `deferred` is an executor
   * M's open wait deferring its candidate/questions reply (C-25). A close-out whose one fixed notice is committed and
   * one reply slot is missing is an `action_request` carrying `missingReply` (`original` for the executor's wait M, also
   * when `M === R`; `source` for R itself): the Host associates that one slot without a model profile and sends no
   * second notice. A card-answer round writes no reply; a saved reply
   * proves no notice, because the adopted recovery can write the reply alone. Both the Query and its
   * candidate are read by identity; Session occupancy is never consulted and nothing is written or re-delivered. An
   * accepted candidate's executor reply belongs to the adopted recovery (6.1.6), so it is not this read's close-out.
   * The Query and its candidate live in the workspace of the Goal the source names, read as the Host of that workspace.
   */
  async function settlementOfferOf(ctx: CoreCallContext, source: SessionMessage):
    Promise<ReadResult<SettlementVerdict | null>> {
    const queryWorkspace = await interventionQueryWorkspaceOf(ctx, deps.plans, source);
    if (queryWorkspace.status !== 'ready') return queryWorkspace;
    const workspaceId = queryWorkspace.value;
    const goalCtx = hostContextIn(ctx, workspaceId);
    // A card-answer round freezes its own `decision_answer` part: recomputing the ordinary message part would
    // collide with the round opened from the same message as a plain source. Only an agent `ask_person` card
    // addressed to the user opens one; a card addressed to a line stays an ordinary source.
    const sourcePart = source.decision !== undefined && source.response !== null
      && isMessageAgentSender(source.sender) && isUserMessageRecipient(source.recipient)
        ? 'decision_answer' as const : 'message' as const;
    const refs = interventionPlanningQueryRefs(source.ref, workspaceId, sourcePart);
    const read = await deps.queries.readQueryJob(goalCtx, refs.queryJobRef);
    if (read.status === 'not_found') return ready(null);
    if (read.status !== 'ready') return read;
    const record = read.value;
    const execution = record.job.job.intent.execution;
    if (execution.kind !== 'intervention_planning') return ready(null);
    // The deterministic key already binds the frozen part; the record read by that key must carry the same part.
    const frozenPart = execution.sourcePart === 'decision_answer' ? 'decision_answer' : 'message';
    if (frozenPart !== sourcePart) return ready(null);
    // The commit entry admits an intervention Query only with its source and a real Goal (`query-job.ts:394`,
    // `query-job-service.ts:259`), so both are present on every stored record this read can see.
    const storedSource = execution.sourceMessageRef as SessionMessageRef;
    if (sessionMessageRefKey(storedSource) !== sessionMessageRefKey(source.ref)) return ready(null);
    const jobStatus = record.job.job.status;
    const runEnded = record.run.run.status === 'closed'
      || record.run.run.executionState?.phase === 'settled';
    if (jobStatus !== 'answered' && jobStatus !== 'closed' && !runEnded) return ready(null);
    // A withdrawn source is consumed by its withdrawal; the round has nothing left to close out.
    if (source.withdrawnAt !== null) return ready('ended');
    // A committed `no_answer` notice is the formal no-answer conclusion: the round ended without a reply even when a
    // stored Answer yields none (an invalid formal conclusion), so no reply is owed. The person's B20 source still
    // owes the withdrawal that follows its notice; an agent source is never withdrawn, and the notice alone ends it.
    const noAnswer = await closingNoticeOf(ctx, source, sourcePart, 'no_answer');
    if (noAnswer.status !== 'ready') return noAnswer;
    if (noAnswer.value === true) {
      return source.entry === 'person_intervention' ? ready({ kind: 'action_request' }) : ready('ended');
    }
    // The ordinary source's saved reply ends its round once the round's one fixed notice is committed too: the adopted
    // recovery can write the reply alone (6.1.6), so a reply is no notice receipt. A missing notice reads on below,
    // where a questions round owes none; without the optional notice read the older `ended` stays. A card's own
    // `response` is the answer that opened the `decision_answer` round, not its close-out, so it never ends that read.
    if (sourcePart === 'message' && source.response !== null) {
      const notice = await closingNoticeOf(ctx, source, sourcePart);
      if (notice.status !== 'ready') return notice;
      if (notice.value === true) {
        // C-25/A12: an abandoned candidate leaves only the executor's original wait M without its reply. R's reply and
        // the round's one fixed notice are already there, so the Host runs the association step alone, never a second
        // notice. A `replaced` candidate is not this close-out; the replacing round replies M.
        const missing = await missingOriginalReplyOf(ctx, source, execution.repliesToMessageRef, goalCtx, workspaceId,
          record.job.job.goalId as string, sourcePart);
        if (missing.status !== 'ready') return missing;
        if (missing.value) return ready({ kind: 'action_request', missingReply: 'original' });
        return ready('ended');
      }
      if (notice.value !== false) return ready('ended');
    }
    const answerRef = record.job.job.answerRefs.at(-1);
    if (answerRef === undefined) {
      // A formal `no_answer` ends this round's consumption. Only the B20 source's close-out is the fixed notice and
      // then the source withdrawal; while it is still here that close-out is unfinished, so offer it again (the Host
      // replays the one notice and withdraws) and the existing Query ensures this never opens a new round.
      if (source.entry !== 'person_intervention') {
        // An agent source is not withdrawn (the sender's wait expires on its own). Once the Host has committed the
        // round's one fixed notice there is nothing left to replay, so the queue head must yield; a missing notice is
        // still the close-out. Without the optional notice read the older `ended` classification stays.
        const notice = await closingNoticeOf(ctx, source, sourcePart);
        if (notice.status !== 'ready') return notice;
        if (notice.value !== false) return ready('ended');
      }
      return ready({ kind: 'action_request' });
    }
    const answer = await deps.queries.readQueryAnswer(goalCtx, answerRef);
    if (answer.status !== 'ready') return answer;
    let terminal: 'settled' | 'candidate' | 'questions' | 'adopted' = 'settled';
    let candidateMissing = false;
    // Only a planning-shape round's Answer can owe a candidate or question cards. A text round's answer is never
    // parsed as a plan (design 2.3) and every review/advice shape settles through its own conclusion, so a body there
    // that happens to parse as a plan waits for no candidate.
    if (execution.answerShape === 'plan_round') {
      const parsed = parseInitialPlanningResponseV2(answer.value.answer.answer);
      if (parsed.status === 'parsed' && parsed.response.kind === 'needs_decision') {
        terminal = 'questions';
      } else if (parsed.status === 'parsed' && parsed.response.kind === 'plan') {
        // The candidate's deterministic identity is the intervention's propose identity for this source, carrying
        // the frozen part exactly as the round's Query key does.
        const proposal = await deps.plans.readPlanProposal(goalCtx,
          interventionProposalRefOf(source.ref, workspaceId, record.job.job.goalId as string, sourcePart));
        if (proposal.status !== 'ready' && proposal.status !== 'not_found') return proposal;
        // The saved Answer fixes the candidate as this round's deterministic effect; whether the proposal record
        // exists yet is exactly what the close-out check reads.
        candidateMissing = proposal.status === 'not_found';
        // A stored `candidate` whose `basedOn` moved on is the same class (the handler's proposal read derives it).
        if (proposal.status === 'ready' && proposal.value.status === 'candidate') terminal = 'candidate';
        // An accepted candidate only completes R here; the executor M's one reply belongs to the adopted-candidate
        // recovery (6.1.6), exactly as §5.5.2 class 1 says.
        if (proposal.status === 'ready' && proposal.value.status === 'accepted') terminal = 'adopted';
      }
    }
    // Only an ordinary `needsReply:true` source owes a reply (design 2.6). A card-answer round writes none: the card's
    // own response is the person's answer that opened the round, not its close-out. The question cards are the saved
    // Answer's own read projection (`tasks/planning-question-reader.ts` parses the same Answer with this same parser),
    // so a needs_decision Answer has nothing left to write.
    const ordinarySource = sourcePart === 'message';
    const executorSender = ordinarySource
      && (source.sender.kind === 'work_run' || source.sender.kind === 'secretary_round');
    // A saved reply is no longer owed. The executor M's accepted-candidate reply belongs to the adopted recovery
    // (6.1.6), so that round owes no reply here either, only its notice.
    const replyOwed = ordinarySource && source.needsReply === true && source.response === null
      && !(executorSender && terminal === 'adopted');
    const executorWait = executorSender
      && isWaitMessage(source)
      && waitStateOf(source, waitFactsOfRecord(source)).state === 'open';
    // Only a wait that is still open defers its candidate/questions reply. The candidate itself is never deferred, so
    // it outranks the deferred reply.
    if (candidateMissing) {
      // A plan Answer owes its candidate until the round's notice is committed. The Host commits the notice only after
      // the candidate step, so a committed notice with no candidate means the round's conclusion wrote none, and only
      // an owed reply is left. Without the optional notice read the candidate stays owed.
      const notice = await closingNoticeOf(ctx, source, sourcePart);
      if (notice.status !== 'ready') return notice;
      if (notice.value !== true) return ready({ kind: 'action_request' });
      if (!replyOwed) return ready('ended');
      const slot = await missingReplyOf(ctx, source, execution.repliesToMessageRef, goalCtx, workspaceId,
        record.job.job.goalId as string, sourcePart, executorWait);
      if (slot.status !== 'ready') return slot;
      return ready(slot.value === null ? 'deferred' : { kind: 'action_request', missingReply: slot.value });
    }
    if (executorWait && (terminal === 'candidate' || terminal === 'questions')) {
      // A candidate round's notice is committed before the deferred reply; a missing notice still closes out now.
      // A questions round sends none (the cards say it).
      if (terminal === 'candidate') {
        const notice = await closingNoticeOf(ctx, source, sourcePart);
        if (notice.status !== 'ready') return notice;
        if (notice.value === false) return ready({ kind: 'action_request' });
      }
      return ready('deferred');
    }
    // The Host commits the round's notice before its reply. A committed notice leaves only the reply, which the Host
    // associates before choosing a model profile and without a second notice; a missing notice still closes out here
    // and replays it with the reply.
    if (replyOwed) {
      const notice = await closingNoticeOf(ctx, source, sourcePart);
      if (notice.status !== 'ready') return notice;
      if (notice.value === true) {
        const slot = await missingReplyOf(ctx, source, execution.repliesToMessageRef, goalCtx, workspaceId,
          record.job.job.goalId as string, sourcePart, executorWait);
        if (slot.status !== 'ready') return slot;
        return ready(slot.value === null ? 'deferred' : { kind: 'action_request', missingReply: slot.value });
      }
      return ready({ kind: 'action_request' });
    }
    // With no reply owed (a card-answer round, a `needsReply:false` source, a saved reply, the executor's adopted
    // candidate), the last owed effect is the one fixed notice; a questions round sends none (the cards say it).
    if (terminal === 'questions') return ready('ended');
    const notice = await closingNoticeOf(ctx, source, sourcePart);
    if (notice.status !== 'ready') return notice;
    return ready(notice.value === false ? { kind: 'action_request' } : 'ended');
  }

  /**
   * The inbox and the Session's whole outbox, walked to the end; person offers first, then commit order.
   * `settlementOnly` keeps only the settlement offers (window 3: an archive-requested line takes no new input,
   * but the Host still closes out an ended Query, so the archive can finish). A card-answer round's close-out
   * lives on the card's sender line, so the outbox is walked in this mode too; only its close-out is offered.
   */
  async function offersOf(ctx: CoreCallContext, record: SessionCard['record'], settlementOnly = false):
    Promise<ReadResult<OfferSet>> {
    // The mailbox ports take a plain SessionRef; the record's ref carries `aggregateType` for the store.
    const session: SessionRef = { projectId: record.ref.projectId, sessionId: record.ref.sessionId };
    // The one bound-wait read of this line, taken only when a new round needs it; a line with no such offer
    // never reads the facts. Absent the optional fact the line is never waiting.
    const lineFacts = deps.sessionFacts;
    let lineWait: Promise<ReadResult<boolean>> | null = null;
    const lineBoundWait = (): Promise<ReadResult<boolean>> => {
      if (lineFacts === undefined) return Promise.resolve(ready(false));
      lineWait ??= (async () => {
        const read = await lineFacts.readSessionFacts(ctx, session);
        if (read.status !== 'ready') return read;
        return ready(read.value.wait !== null);
      })();
      return lineWait;
    };
    const offers: CandidateOffer[] = [];
    let inboxCursor: string | undefined;
    for (;;) {
      // The mailbox page bound the existing supply loops use.
      const read = await deps.messages.readInbox(ctx, { recipient: session, page: {
        limit: 100, ...(inboxCursor === undefined ? {} : { cursor: inboxCursor }) } });
      if (read.status !== 'ready') return read;
      const page = read.value;
      for (const [index, message] of page.items.entries()) {
        const cursor = (): CommitCursor => page.cursors[index]!;
        // §5.5.2: read any existing round for this source before offering a new one. A complete or withdrawn
        // round yields the queue head; a missing close-out is the settlement offer and outranks the round a
        // fresh delivery would open.
        const settlement = await settlementOfferOf(ctx, message);
        if (settlement.status !== 'ready') return settlement;
        if (settlement.value === 'ended' || settlement.value === 'deferred') continue;
        if (settlement.value !== null) {
          offers.push({ kind: settlement.value.kind, message, cursor,
            ...(settlement.value.missingReply === undefined ? {} : { missingReply: settlement.value.missingReply }) });
          continue;
        }
        if (settlementOnly) continue;
        const offer = await offerOf(ctx, message, 'message', session, cursor);
        if (offer.status !== 'ready') return offer;
        if (offer.value !== null) {
          // A line that yielded on a bound wait takes no new agent round: the Host refuses it, so offering it would
          // hold the queue head forever. A person's B20 claim is the one source that may consume the wait and is
          // never held here; the platform's own system round (`refine:` and the rest) is its loop, not mail between
          // lines, and still opens beside the wait as before P2 (lead 11-23, P-A 2). These holds select the queue
          // head only; an existing Query's resume (`resumeOfferOf`) is not a new wake.
          if (offer.value.kind === 'agent_wake') {
            const held = await ordinaryWakeHeld(message, lineBoundWait);
            if (held.status !== 'ready') return held;
            if (held.value) continue;
          }
          const goalDone = await newRoundHeld(ctx, offer.value);
          if (goalDone.status !== 'ready') return goalDone;
          if (goalDone.value) continue;
          offers.push(offer.value);
        }
      }
      const next = page.nextCursor ?? undefined;
      if (next === undefined) break;
      inboxCursor = next;
    }
    let outboxCursor: string | undefined;
    for (;;) {
      const read = await deps.messages.readOutbox!(ctx, { senderSession: session, page: {
        limit: 100, ...(outboxCursor === undefined ? {} : { cursor: outboxCursor }) } });
      if (read.status !== 'ready') return read;
      const page = read.value;
      for (const message of page.items) {
        if (message.status !== 'responded' || message.response === null) continue;
        // A secretary request's reply and expiry belong to the request queue; this outbox pass never takes them.
        if (isSecretaryRequestMessage(message)) continue;
        // A platform/request card is settled by its answer path or the request queue, never by a round here.
        if (message.decision !== undefined && !isMessageAgentSender(message.sender)) continue;
        const cursor = (): CommitCursor => message.responseSince!;
        // Only an answered agent `ask_person` card addressed to the user is a card-answer round keyed by the
        // card's sender line (this outbox) and the `decision_answer` part. An ordinary reply is supplied at the
        // line's safe point or its next round, never by a round opened here.
        const cardAnswer = message.decision !== undefined && isMessageAgentSender(message.sender)
          && isUserMessageRecipient(message.recipient);
        if (!cardAnswer) continue;
        // The card-answer round lives on this sender line. Read that round by its frozen part before offering
        // a fresh decision-answer turn: a missing candidate or notice is the close-out to re-offer, and only a
        // not-yet-created round opens the ordinary `decision_answer` offer.
        const settlement = await settlementOfferOf(ctx, message);
        if (settlement.status !== 'ready') return settlement;
        if (settlement.value === 'ended' || settlement.value === 'deferred') continue;
        if (settlement.value !== null) {
          offers.push({ kind: settlement.value.kind, message, cursor,
            ...(settlement.value.missingReply === undefined ? {} : { missingReply: settlement.value.missingReply }) });
          continue;
        }
        if (settlementOnly) continue;
        const offer = await offerOf(ctx, message, 'decision_answer', session, cursor);
        if (offer.status !== 'ready') return offer;
        if (offer.value !== null) {
          // A card-answer round is a new round too, offered only from this outbox pass: a line that yielded on a
          // bound wait keeps it queued, as the inbox pass keeps an agent wake, so the Host's wait gate never leaves it
          // at the queue head.
          const bound = await lineBoundWait();
          if (bound.status !== 'ready') return bound;
          const goalDone = await newRoundHeld(ctx, offer.value);
          if (goalDone.status !== 'ready') return goalDone;
          if (!bound.value && !goalDone.value) offers.push(offer.value);
        }
      }
      const next = page.nextCursor ?? undefined;
      if (next === undefined) break;
      outboxCursor = next;
    }
    const person = offers.filter(offer => offer.kind === 'person_message')
      .sort(compareSessionInputCandidates);
    const rest = offers.filter(offer => offer.kind !== 'person_message')
      .sort(compareSessionInputCandidates);
    const ordered: CandidateOffer[] = [...person, ...rest];
    const kinds: ConsumableSessionKindV1[] = [];
    for (const offer of ordered) if (!kinds.includes(offer.kind)) kinds.push(offer.kind);
    const first = ordered.find(offer => offer.kind !== 'notify');
    return ready({
      kinds,
      nextMessage: first === undefined ? null : { kind: first.kind, messageRef: first.message.ref,
        ...(first.missingReply === undefined ? {} : { missingReply: first.missingReply }) },
    });
  }

  /**
   * The one offer a claimed or prepared `intervention_planning` Query keeps on its own line: its recorded
   * source message, built by the ordinary `offerOf` eligibility rule, and only when that source belongs to this
   * line. An ordinary source is addressed to the line; a card-answer round is owned by the CARD'S sender line,
   * not by the card's recipient (the person). The Query has not entered a turn yet, so the Host may enter again
   * and let the intervention handler continue the same Query; entering/entered are a running turn and offer
   * nothing. Any other Query, any other line, and a paused Goal offer nothing.
   */
  async function resumeOfferOf(ctx: CoreCallContext, record: SessionCard['record']):
    Promise<ReadResult<CandidateOffer | null>> {
    const occupancy = record.occupancy;
    if (occupancy === null || occupancy.kind !== 'execution'
      || occupancy.executionRef.aggregateType !== 'QueryRun') return ready(null);
    // The one QueryRun this offer continues; the Host re-checks the line's occupancy against it.
    const queryRunRef = occupancy.executionRef;
    const read = await deps.queries.readQueryJob(ctx, queryJobRefFor(
      queryRunRef.projectId, queryRunRef.workspaceId,
      queryRunRef.queryJobId), { scope: 'project' });
    if (read.status !== 'ready') return read;
    const execution = read.value.job.job.intent.execution;
    if (execution.kind !== 'intervention_planning') return ready(null);
    const state = read.value.run.run.executionState;
    if (state === undefined || (state.phase !== 'claimed' && state.phase !== 'prepared')) return ready(null);
    const source = execution.sourceMessageRef;
    if (source === undefined) return ready(null);
    // The exact recorded source, never the queue head: a newer message stays queued. One offer needs no order.
    const message = await deps.messages.readMessage(ctx, source);
    if (message.status !== 'ready') return message;
    const session: SessionRef = { projectId: record.ref.projectId, sessionId: record.ref.sessionId };
    const decisionAnswer = execution.sourcePart === 'decision_answer';
    if (decisionAnswer) {
      // §2.3: a card-answer round continues on the card's sender line, not on the recipient (the person). A
      // non-line card sender can never resume it.
      const sender = message.value.sender;
      if (!isMessageAgentSender(sender) || sender.sessionRef.projectId !== session.projectId
        || sender.sessionRef.sessionId !== session.sessionId) return ready(null);
    } else {
      // An ordinary source is resumed only by the line it is addressed to: a user recipient (`'kind' in
      // recipient`) is not a line, and another line's message stays with its own recipient.
      const recipient = message.value.recipient;
      if ('kind' in recipient || recipient.projectId !== session.projectId
        || recipient.sessionId !== session.sessionId) return ready(null);
    }
    const offer = await offerOf(ctx, message.value, decisionAnswer ? 'decision_answer' : 'message', session,
      () => { throw new Error('a resume offer is never sorted'); }, execution.overlapNote === true);
    if (offer.status !== 'ready') return offer;
    // The Host's new-round gates apply to a fresh round; this one only enters the Query already holding the line.
    return ready(offer.value === null ? null
      : { ...offer.value, resume: true, resumeQueryRunRef: queryRunRef });
  }

  /**
   * One line's item: its busy reason, then its offers (idle, or only its settlement close-outs while an archive
   * request is pending) or its resume offer (a Query not entered yet).
   */
  async function consumableLineOf(ctx: CoreCallContext, card: SessionCard): Promise<ReadResult<ConsumableSessionV1>> {
    const busyRead = await busyReasonOf(ctx, card.record);
    if (busyRead.status !== 'ready') return busyRead;
    let kinds: ConsumableSessionKindV1[] = [];
    let nextMessage: ConsumableSessionOfferV1 | null = null;
    // Window 3: an unoccupied line with a pending archive request offers only the close-out of an ended Query's
    // source (the archive's final guard waits for it), never new input.
    const archiveSettles = busyRead.value === 'archive_request' && card.record.archiveRequest != null
      && card.record.occupancy === null;
    if (busyRead.value === null || archiveSettles) {
      const offers = await offersOf(ctx, card.record, archiveSettles);
      if (offers.status !== 'ready') return offers;
      kinds = offers.value.kinds;
      nextMessage = offers.value.nextMessage;
    } else if (busyRead.value === 'query') {
      const resumed = await resumeOfferOf(ctx, card.record);
      if (resumed.status !== 'ready') return resumed;
      if (resumed.value !== null) {
        kinds = [resumed.value.kind];
        nextMessage = { kind: resumed.value.kind, messageRef: resumed.value.message.ref, resume: true,
          ...(resumed.value.resumeQueryRunRef === undefined
            ? {} : { resumeQueryRunRef: resumed.value.resumeQueryRunRef }) };
      }
    }
    return ready({
      session: { projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId },
      role: card.record.role,
      availability: card.availability,
      busy: busyRead.value,
      kinds,
      nextMessage,
    });
  }

  async function readConsumableSessions(ctx: CoreCallContext,
    input: { workspace: WorkspaceScope; after: string | null; limit: number }):
    Promise<ReadResult<ConsumableSessionsPageV1>> {
    // `limit` counts candidate Sessions only: a busy card is returned with its reason but does not use the quota,
    // so the directory is walked page by page until the quota or the directory's end.
    const items: ConsumableSessionV1[] = [];
    const skipped: ConsumableSessionSkipV1[] = [];
    let candidates = 0;
    let next: string | null = null;
    let after = input.after;
    for (;;) {
      const found = await deps.directory.findSessions(ctx, {
        workspace: input.workspace,
        includeArchived: false,
        page: { limit: 50,
          ...(after === null ? {} : { afterSessionKey: after }) },
      });
      if (found.status !== 'ready') return found;
      for (const card of found.value.items) {
        if (candidates >= input.limit) return ready({ items, skipped, next });
        let line: ReadResult<ConsumableSessionV1>;
        try {
          line = await consumableLineOf(ctx, card);
        } catch (error) {
          // A read that throws (some owners pass a store I/O throw on) is this line's failure too, never the page's.
          line = rejected('unavailable',
            `the line's facts could not be read: ${error instanceof Error ? error.message : String(error)}`);
        }
        next = plainSessionRefKey(card.record.ref);
        if (line.status !== 'ready') {
          // 121-105: one line's failed read skips that whole line (no later message of it is offered first) and
          // the walk goes on; a cancelled call is never degraded into a skip and returns as a whole.
          if (line.status === 'rejected' && line.code === 'cancelled') return line;
          if (ctx.signal.aborted) return rejected('cancelled', 'the consumable view was cancelled');
          skipped.push({ session: { projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId },
            code: line.status === 'rejected' ? line.code : line.status,
            reason: line.status === 'rejected' ? line.reason : `a fact of the line is ${line.status}` });
          continue;
        }
        items.push(line.value);
        if (line.value.busy === null) candidates += 1;
      }
      if (found.value.nextCursor === null) return ready({ items, skipped, next: null });
      if (candidates >= input.limit) return ready({ items, skipped, next });
      after = next;
    }
  }

  /** The archive guard's one settlement fact: the same inbox and outbox close-out walk, settlement offers only. */
  async function readSettlementDue(ctx: CoreCallContext, session: SessionCard['record']):
    Promise<ReadResult<boolean>> {
    const offers = await offersOf(ctx, session, true);
    return offers.status === 'ready' ? ready(offers.value.nextMessage !== null) : offers;
  }

  return { readConsumableSessions, readSettlementDue };
}
