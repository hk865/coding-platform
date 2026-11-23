/**
 * The one source-lineage walk behind `planfix:` and `planresume:` (slice-PL-SPEC
 * §6.3.1). A candidate's `sourceMessageRef` can be a repair round or a resumed
 * round; both continue the same chain. `planresume:`/`planfix:` only continue
 * the walk in a trusted system round (`trustedSystemRoundOf`); every other
 * message ends it. Records point to earlier commits, so it needs no cycle guard.
 *
 * Every read failure is returned as-is; the walk never guesses a root. The
 * `messages` dependency is the existing mailbox port (both members), and a
 * message's first line only proposes the round: the Host's own send receipt
 * decides whether the round is real.
 *
 * A joined workspace's round lands in the recipient line's workspace while its
 * Query and candidates stay with the Goal: each message is read where it lives,
 * each parent candidate and original Query where the Goal lives.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { isUserMessageRecipient, type SessionMessageRef } from '../../../contracts/core/session-message.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { interventionPlanningQueryRefs, queryJobRefFor } from '../../../contracts/query-job.js';
import {
  checkReviewSubjectOfText, commandRerunAdviceSubjectOfText, commandReviewSubjectOfText,
  planResumeOriginalQueryOfText, systemRoundOfText, systemRoundRequestId, systemRoundContext,
  unknownCallAdviceSubjectOfText, type SystemRoundV1,
} from '../../../contracts/plan-round.js';
import { interventionGoalRefOf, type SessionMailboxPort, type SessionMessage } from '../model/communication-contracts.js';
import type { UnknownCallReviewReadPort } from '../model/unknown-call-review-contracts.js';
import type { OverlapGatePort } from './overlap-gates.js';
import { isMessageAgentSender } from '../state/message-machine.js';
import { isSystemRoundSender, sessionMessageRefKey } from '../sessions/message-record-codecs.js';
import { candidateRequestRef, planProposalRefKey } from '../persistence/plan-record-codecs.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import {
  NO_ACCEPTED_ANSWER, reviewQueryEnded, type ReviewQueryReads, type ReviewSessionDuty,
} from '../model/evidence-contracts.js';
import type { PlanProposal, PlanProposalRef, PlanTaskPort } from '../model/plan-contracts.js';
import type { OverlapNoteMatchV1, QueryJobPort } from '../queries/contracts.js';
import { handoffContextOf } from '../sessions/session-handoff-service.js';
import { execReviewPacketOfText } from './exec-review-packet.js';
import { planProposalIdFor } from './plan-service.js';
import type { RequestFactsPort } from './request-facts.js';

export type PlanSourceLineageV1 = {
  /** The earliest source message on the chain: the executor's M or the first system R. */
  rootMessage: SessionMessageRef;
  /** The nearest `planfix:` round crossed on the chain, or null. */
  fixRound: SessionMessageRef | null;
  /** The candidate that round had to repair; null when there is no fixRound. */
  fixBase: PlanProposal | null;
};

/** One enumerated candidate whose own source chain (or request-slot probe) could not be read. */
export type CandidateSourceIncompleteV1 = {
  /** The candidate the failure belongs to. */
  proposalRef: PlanProposalRef;
  /** The first read failure on that candidate's own chain; never `ready`. `not_found` is a failure too. */
  failure: Exclude<ReadResult<unknown>, { status: 'ready' }>;
};

export type PlanSourceLineageDeps = {
  /** The source messages and bodies, and the Host's own sent-round receipt a system round is recognized by. */
  messages: Pick<SessionMailboxPort, 'readMessage' | 'readMessageBody' | 'readHostSendMessageRef'>;
  queries: Pick<QueryJobPort, 'readQueryJob'>;
  plans: Pick<PlanTaskPort, 'readPlanProposal'>;
  /**
   * Optional: the existing `UnknownCallReview` read. When supplied, an `unknown_call` round's formally carried Task is
   * the named review's `task`; absent, the round is recognized without that check, exactly as before.
   */
  readReview?: UnknownCallReviewReadPort['readReview'];
};

/** 写出一份候选的那条线（G8B B1a）：`via` 说明是从哪一项读出来的。 */
export type CandidateSourceLineV1 = {
  session: SessionRef | null;
  via: 'request' | 'message' | 'agent_write' | 'unknown';
  /**
   * G8B B5：改动来自人的话时，人的原话（前 `PERSON_WORDS_MAX` 字）：来源消息由人发出时是这条消息的正文，请求候选是
   * 写出它的那一轮请求的原文；其余为 null。
   */
  personWords: string | null;
};

/** G8B B5：卡上引用人的原话最多这么多字。 */
export const PERSON_WORDS_MAX = 1_000;

/** 读作者用的口：来源消息的正文，请求候选按候选号读那一轮；不读 Host 发送回执。 */
export type CandidateSourceLineDeps = {
  messages: Pick<SessionMailboxPort, 'readMessage' | 'readMessageBody'>;
  requests: Pick<RequestFactsPort, 'readRequest'>;
};

/**
 * 写出这份候选的那条线，只在这一处读（G8B B1a；批准者选择和候选卡共用）。
 * - 来源消息带 `sourcePart: 'decision_answer'`（卡答叫醒的轮）：来源是卡，作者是卡的发件线，不是你；只有正式卡答
 *   （agent 的 `ask_person` 卡发给你且答案已存）才认，卡答不完整时 `session: null`、`via: 'unknown'`，由调用方出卡；
 * - 其余有来源消息（干预规划、细化轮、返修轮、`planresume`）：开轮的那条收件线（不是发件线）；
 * - 请求候选（`requestRef` 是请求根）：按候选号找到写出它的那一轮，读那一轮的 Session，不读请求当前的主人（换手后
 *   会认错）；找不到那一轮时 `session: null`；
 * - 只有 `submittedBy`（执行者 Run 的 `propose_future_plan`）：写它的 Session；
 * - 都没有：`session: null`，`via: 'unknown'`。
 * 人的原话（G8B B5）在同一次读里取。读失败原样返回，不猜。职责由调用方用自己现成的解析器换。
 */
export async function candidateSourceLineOf(ctx: CoreCallContext, deps: CandidateSourceLineDeps,
  proposal: PlanProposal): Promise<ReadResult<CandidateSourceLineV1>> {
  if (proposal.sourceMessageRef !== null) {
    const source = proposal.sourceMessageRef;
    const sourceCtx = hostContextIn(ctx, source.workspaceId);
    const message = await deps.messages.readMessage(sourceCtx, source);
    if (message.status !== 'ready') return message;
    const recipient = message.value.recipient;
    const sender = message.value.sender;
    // 卡答叫醒的轮把来源部分冻结成 `decision_answer`：作者是卡的发件线，不是你（卡的收件人）。普通来源候选
    // 认开轮的那条收件线；发给人的消息没有线，不猜。
    if (proposal.sourcePart === 'decision_answer') {
      if (!isMessageAgentSender(sender) || !isUserMessageRecipient(recipient)
        || message.value.decision === undefined || message.value.response === null) {
        return { status: 'ready', value: { session: null, via: 'unknown', personWords: null } };
      }
      return { status: 'ready', value: { session: sender.sessionRef, via: 'message', personWords: null } };
    }
    // 发给人的消息没有写出这一版的线：读不全，`unknown`，调用方出卡、不自动采用。
    const session = isUserMessageRecipient(recipient) ? null : recipient;
    const via = session === null ? 'unknown' as const : 'message' as const;
    if (sender.kind !== 'host' || sender.actor.kind !== 'human') {
      return { status: 'ready', value: { session, via, personWords: null } };
    }
    const body = await deps.messages.readMessageBody(sourceCtx, { messageRef: source, part: 'message' });
    if (body.status !== 'ready') return body;
    return { status: 'ready', value: { session, via, personWords: body.value.text.slice(0, PERSON_WORDS_MAX) } };
  }
  if (proposal.requestRef !== undefined && proposal.requestRef !== null) {
    const requestRoot = proposal.requestRef;
    const request = await deps.requests.readRequest(hostContextIn(ctx, requestRoot.workspaceId), { requestRoot });
    if (request.status !== 'ready') return request;
    // 写出它的那一轮：候选号由那一轮推出，找法同 `business/workflow/request-candidate.ts` 的 `proposeFromPlanTurn`。
    const round = request.value.rounds.find((entry) => planProposalIdFor({ projectId: proposal.ref.projectId,
      workspaceId: proposal.ref.workspaceId, goalId: proposal.goalRef.goalId,
      requestId: `request-candidate:${entry.ref.queryJobId}` }) === proposal.ref.proposalId);
    // 找不到写出它的那一轮：读不全，`unknown`，不猜请求当前的主人。
    return round === undefined
      ? { status: 'ready', value: { session: null, via: 'unknown', personWords: null } }
      : { status: 'ready', value: { session: round.session, via: 'request',
        personWords: round.input.slice(0, PERSON_WORDS_MAX) } };
  }
  if (proposal.submittedBy !== undefined) {
    return { status: 'ready', value: { session: proposal.submittedBy.sessionRef, via: 'agent_write', personWords: null } };
  }
  return { status: 'ready', value: { session: null, via: 'unknown', personWords: null } };
}

/**
 * The same trusted Host call bound to another workspace of its project: a message, its body and its reply are read
 * where the message lives, a Goal's Query and candidates where the Goal lives. Only a Host principal moves; an agent
 * principal keeps its own scope, so its reads stay refused outside it.
 */
export function hostContextIn(ctx: CoreCallContext, workspaceId: string): CoreCallContext {
  const principal = ctx.principal;
  if (ctx.workspaceId === workspaceId || principal.kind !== 'host') return ctx;
  return handoffContextOf({ ...ctx, workspaceId }, principal);
}

/**
 * Where the Goal's system round of `requestId` landed: the Host's own send receipt on the fixed `host:plan-round`
 * identity of its sender, the Goal's workspace `scope`. The only way a sender finds its sent round: a ref built from the
 * request id is right only when the recipient line shares the sender's workspace. `not_found` is "not sent".
 */
export async function sentSystemRoundRef(messages: Pick<SessionMailboxPort, 'readHostSendMessageRef'>,
  scope: WorkspaceScope, requestId: string, signal: AbortSignal): Promise<ReadResult<SessionMessageRef>> {
  const read = messages.readHostSendMessageRef;
  if (read === undefined) return rejected('unsupported', 'the Host sent-message read is not wired');
  return read(systemRoundContext(scope, signal), { requestId, scope });
}

/**
 * The Task a round formally carries, or `null` when this round writes no `taskRef`. An `unknown_call` round writes the
 * Task of the review record it names; without the optional `readReview` port it writes no checkable Task, exactly as
 * before. Every read failure is returned as-is.
 */
async function carriedTaskOfRound(
  ctx: CoreCallContext,
  deps: Pick<PlanSourceLineageDeps, 'readReview'>,
  round: SystemRoundV1,
): Promise<ReadResult<SessionMessage['taskRef']>> {
  if (round.kind === 'deviation') {
    return { status: 'ready', value: {
      projectId: round.goalRef.projectId, goalId: round.goalRef.goalId, taskId: round.taskId,
    } };
  }
  if (round.kind === 'command_rerun') {
    const request = round.subject.requestRef;
    return { status: 'ready', value: {
      projectId: request.projectId, goalId: request.goalId, taskId: request.taskId,
    } };
  }
  if (round.kind === 'command_review') {
    // A Query command's round writes no Task; only a Work Run's does.
    return { status: 'ready', value: round.subject.run.kind === 'run'
      ? { projectId: round.subject.projectId, goalId: round.subject.goalId, taskId: round.subject.run.taskId }
      : null };
  }
  if (round.kind === 'unknown_call' && deps.readReview !== undefined) {
    const review = await deps.readReview(ctx, { ref: round.subject.reviewRef });
    if (review.status !== 'ready') return review;
    return { status: 'ready', value: review.value.task };
  }
  return { status: 'ready', value: null };
}

/** The reads `trustedSystemRoundOfMessage` needs: the recognition's own, the stored body and the Goal's workspace. */
export type TrustedSystemRoundMessageDeps = Pick<PlanSourceLineageDeps, 'messages' | 'readReview'> & {
  plans: Pick<PlanTaskPort, 'queryGoal'>;
};

/**
 * Whether one stored message is a trusted platform system round's source, read one way by every reader (design 2.2,
 * 2.6; `p2-frozen.md:150`): the fixed `host:plan-round` sender only proposes it, then the stored body, the workspace
 * of the message's Goal and `trustedSystemRoundOf` (the Host's send receipt names this complete message) decide. Any
 * other sender is `null` without a read, and so is a `messages/forward` copy, which keeps the sender but is not the
 * receipt's message. The consumable view, the reply slot and both input supplies share it; every read failure is
 * returned as-is.
 */
export async function trustedSystemRoundOfMessage(ctx: CoreCallContext, deps: TrustedSystemRoundMessageDeps,
  message: SessionMessage): Promise<ReadResult<SystemRoundV1 | null>> {
  if (!isSystemRoundSender(message.sender)) return { status: 'ready', value: null };
  const body = await deps.messages.readMessageBody(ctx, { messageRef: message.ref, part: 'message' });
  if (body.status !== 'ready') return body;
  const goalWorkspace = await interventionQueryWorkspaceOf(ctx, deps.plans, message);
  if (goalWorkspace.status !== 'ready') return goalWorkspace;
  return await trustedSystemRoundOf(ctx, deps, message, body.value.text, goalWorkspace.value);
}

/**
 * The ONE trusted-system-round recognition. The first line only proposes the round: this
 * function returns it only when all four checks pass, and `null` otherwise. Callers never parse the head themselves.
 *
 * 1. The Goal's workspace: `goalWorkspaceId` is the Goal's workspace where the Host send receipt lives (a round may
 *    land in the recipient line's workspace).
 * 2. The fixed sender: `isSystemRoundSender` (exactly `host:plan-round`).
 * 3. The complete message ref and the recipient line: the receipt read by the round's request id carries this message's
 *    ref, so the complete reference is this message, whose recipient is this line (never the person).
 * 4. Only the objects this round formally carries: `goalRef` always; `taskRef` only for the rounds that write one
 *    (`carriedTaskOfRound`). A round that writes no `taskRef` is never rejected for a missing one. An `unknown_call`
 *    round's Task comes from the named review record when the optional `readReview` port is supplied; without it the
 *    round is recognized exactly as before.
 *
 * The first line does not carry a `refine:` target kind (both kinds share one request id); the returned target is the
 * stage shape, and no reader of this result consumes `target` (only `kind` and the fields the round's own kind names).
 * Every read failure is returned as-is; "not sent", "not this message" and "not a trusted round" are `ready` `null`.
 */
export async function trustedSystemRoundOf(
  ctx: CoreCallContext,
  deps: Pick<PlanSourceLineageDeps, 'messages' | 'readReview'>,
  message: SessionMessage,
  text: string,
  goalWorkspaceId: string,
): Promise<ReadResult<SystemRoundV1 | null>> {
  if (!isSystemRoundSender(message.sender) || isUserMessageRecipient(message.recipient)) {
    return { status: 'ready', value: null };
  }
  const goalRef = message.goalRef;
  if (goalRef === null) return { status: 'ready', value: null };
  const head = systemRoundOfText(text);
  if (head === null) return { status: 'ready', value: null };

  let round: SystemRoundV1;
  switch (head.kind) {
    case 'refine': {
      if (head.goalId !== goalRef.goalId) return { status: 'ready', value: null };
      // The head carries no target kind; the target kind never changes the request id.
      round = { kind: 'refine', goalRef, target: { kind: 'stage', stageId: head.stageOrTaskId },
        planRevision: head.planRevision };
      break;
    }
    case 'deviation': {
      if (head.goalId !== goalRef.goalId) return { status: 'ready', value: null };
      round = { kind: 'deviation', goalRef, taskId: head.taskId, cause: head.cause,
        planRevision: head.planRevision };
      break;
    }
    case 'planreview': case 'planfix': {
      round = { kind: head.kind, goalRef, proposalId: head.proposalId, proposalRevision: head.proposalRevision };
      break;
    }
    case 'planresume': {
      const original = planResumeOriginalQueryOfText(text);
      if (original === null || head.goalId !== goalRef.goalId) return { status: 'ready', value: null };
      round = { kind: 'planresume', goalRef, queryJobId: head.queryJobId, originalMessageRef: original };
      break;
    }
    case 'exec_review': {
      const packet = execReviewPacketOfText(text);
      if (packet.status !== 'ready') return { status: 'ready', value: null };
      const roundRef = packet.value.packet.roundRef;
      if (roundRef.projectId !== goalRef.projectId || roundRef.goalId !== goalRef.goalId) {
        return { status: 'ready', value: null };
      }
      round = { kind: 'exec_review', goalRef, roundRef };
      break;
    }
    case 'unknown_call': {
      const subject = unknownCallAdviceSubjectOfText(text);
      if (subject === null || subject.reviewRef.projectId !== goalRef.projectId
        || subject.reviewRef.goalId !== goalRef.goalId) return { status: 'ready', value: null };
      round = { kind: 'unknown_call', goalRef, subject };
      break;
    }
    case 'command_review': {
      const subject = commandReviewSubjectOfText(text);
      if (subject === null || subject.projectId !== goalRef.projectId || subject.goalId !== goalRef.goalId) {
        return { status: 'ready', value: null };
      }
      round = { kind: 'command_review', goalRef, subject };
      break;
    }
    case 'command_rerun': {
      const subject = commandRerunAdviceSubjectOfText(text);
      if (subject === null || subject.requestRef.projectId !== goalRef.projectId
        || subject.requestRef.goalId !== goalRef.goalId) return { status: 'ready', value: null };
      round = { kind: 'command_rerun', goalRef, subject };
      break;
    }
    case 'check_review': {
      const subject = checkReviewSubjectOfText(text);
      if (subject === null || subject.goalRef.projectId !== goalRef.projectId
        || subject.goalRef.goalId !== goalRef.goalId) return { status: 'ready', value: null };
      round = { kind: 'check_review', goalRef, subject };
      break;
    }
  }

  const requestId = systemRoundRequestId(round);
  if (requestId.status !== 'ready') return { status: 'ready', value: null };
  const sent = await sentSystemRoundRef(deps.messages, {
    projectId: goalRef.projectId, workspaceId: goalWorkspaceId,
  }, requestId.value, ctx.signal);
  if (sent.status === 'not_found') return { status: 'ready', value: null };
  if (sent.status !== 'ready') return sent;
  if (sessionMessageRefKey(sent.value) !== sessionMessageRefKey(message.ref)) {
    return { status: 'ready', value: null };
  }

  // The receipt's complete ref is this message, so its sender, recipient and goalRef are the ones
  // already checked above; only the Task this round formally carries is compared.
  const taskRead = await carriedTaskOfRound(ctx, deps, round);
  if (taskRead.status !== 'ready') return taskRead;
  const carriedTask = taskRead.value;
  if (carriedTask !== null) {
    const carried = message.taskRef;
    if (carried === null || carried.projectId !== carriedTask.projectId
      || carried.goalId !== carriedTask.goalId || carried.taskId !== carriedTask.taskId) {
      return { status: 'ready', value: null };
    }
  }
  return { status: 'ready', value: round };
}

/**
 * The Goal's candidate chain relation (plan readers' `candidateSuccessorsOf`): every candidate of the Goal, any status,
 * and the trusted `planfix:` successors (`successorParentsOf`: parent proposal key → the candidates whose fix round
 * repaired it). Any unreadable candidate source is a failure of the whole relation for this read.
 */
export type CandidateSuccessorRelationV1 = {
  proposals: readonly PlanProposal[];
  successors: ReadonlyMap<string, readonly PlanProposal[]>;
  failures: readonly unknown[];
};
export type CandidateChainEndDeps = {
  plans: Pick<PlanTaskPort, 'readPlanProposal'>;
  /** Absent: a narrow world without the plan readers reads only the candidate's formal replacements, forward. */
  successors?: (goalRef: GoalRef) => Promise<ReadResult<CandidateSuccessorRelationV1>>;
};

/**
 * The end of one candidate chain (A12). `accepted` belongs to the adoption recovery, a live end is `pending`, an end
 * neither adopted nor replaced is `abandoned`; `incomplete` is a relation with an unreadable source (read again
 * later, never guessed as abandoned). `tail` is the candidate whose round's formal Answer is bound to the chain's M.
 */
export type CandidateChainEndV1 =
  | { kind: 'pending' | 'accepted' | 'abandoned'; tail: PlanProposal }
  | { kind: 'incomplete' };

/** A formal replacement link stays inside one request; another request's candidate is that request's to decide. */
function sameCandidateRequest(left: PlanProposal, right: PlanProposal): boolean {
  const leftRequest = candidateRequestRef(left);
  const rightRequest = candidateRequestRef(right);
  return leftRequest !== null && rightRequest !== null && rightRequest.projectId === leftRequest.projectId
    && rightRequest.workspaceId === leftRequest.workspaceId && rightRequest.queryJobId === leftRequest.queryJobId;
}

/**
 * The ONE chain judgment (A12), pure over one relation. A candidate's links are its formal `notAdopted.replacedBy` of
 * the SAME request and every verified `planfix:` successor (the old candidate may still read `candidate`). From any
 * candidate the chain is first walked back to its root, then forward to its end, so every candidate of one chain —
 * and therefore the executor M the chain answers — reads the same end: an adopted branch decides, then a live one,
 * then the last abandoned one. A branch that ended abandoned while another branch of the same chain still lives is
 * not the end, so M is never replied early. A formal replacement by another request reads `pending` (that request
 * decides). The consumable view, the Workflow's endings, the Goal loop's abandoned recovery and the restart rebuild
 * all read this one judgment.
 */
export function candidateChainEndOf(relation: CandidateSuccessorRelationV1, proposal: PlanProposal): CandidateChainEndV1 {
  if (relation.failures.length > 0) return { kind: 'incomplete' };
  const proposalKey = (candidate: PlanProposal): string => planProposalRefKey(candidate.ref);
  const byKey = new Map<string, PlanProposal>();
  for (const candidate of relation.proposals) byKey.set(proposalKey(candidate), candidate);
  if (!byKey.has(proposalKey(proposal))) byKey.set(proposalKey(proposal), proposal);
  const linksOf = (current: PlanProposal): PlanProposal[] | 'other_request' => {
    const next = [...(relation.successors.get(proposalKey(current)) ?? [])];
    const replacedBy = current.status === 'not_adopted' ? current.notAdopted?.replacedBy ?? null : null;
    if (replacedBy !== null) {
      const successor = byKey.get(planProposalRefKey(replacedBy));
      if (successor !== undefined && sameCandidateRequest(current, successor)) next.push(successor);
      else if (next.length === 0) return 'other_request';
    }
    return next;
  };
  const parentOf = new Map<string, PlanProposal>();
  for (const candidate of byKey.values()) {
    const links = linksOf(candidate);
    if (links === 'other_request') continue;
    for (const child of links) if (!parentOf.has(proposalKey(child))) parentOf.set(proposalKey(child), candidate);
  }
  let root = byKey.get(proposalKey(proposal)) as PlanProposal;
  const climbed = new Set<string>([proposalKey(root)]);
  for (let parent = parentOf.get(proposalKey(root)); parent !== undefined && !climbed.has(proposalKey(parent));
    parent = parentOf.get(proposalKey(root))) {
    root = parent;
    climbed.add(proposalKey(root));
  }
  const seen = new Set<string>();
  const follow = (current: PlanProposal): CandidateChainEndV1 => {
    if (current.status === 'accepted') return { kind: 'accepted', tail: current };
    seen.add(proposalKey(current));
    const links = linksOf(current);
    if (links === 'other_request') return { kind: 'pending', tail: current };
    let pending: CandidateChainEndV1 | null = null;
    let abandoned: CandidateChainEndV1 | null = null;
    for (const successor of links) {
      if (seen.has(proposalKey(successor))) continue;
      const end = follow(successor);
      if (end.kind === 'accepted') return end;
      if (end.kind === 'pending') pending ??= end;
      else abandoned = end;
    }
    return pending ?? abandoned ?? { kind: current.status === 'candidate' ? 'pending' : 'abandoned', tail: current };
  };
  return follow(root);
}

/** Whether `proposal` is its chain's end of `kind` (the candidate whose Answer is the one bound to the chain's M). */
export function candidateIsChainEnd(relation: CandidateSuccessorRelationV1, proposal: PlanProposal,
  kind: 'pending' | 'abandoned'): boolean {
  const end = candidateChainEndOf(relation, proposal);
  return end.kind === kind && planProposalRefKey(end.tail.ref) === planProposalRefKey(proposal.ref);
}

/**
 * The same judgment read from one candidate: the Goal's relation when the plan readers are wired, otherwise (a narrow
 * world) the candidate's formal replacements read forward. A read failure is returned, never guessed.
 */
export async function requestCandidateChainEndOf(goalCtx: CoreCallContext, deps: CandidateChainEndDeps,
  proposal: PlanProposal): Promise<ReadResult<CandidateChainEndV1>> {
  if (deps.successors !== undefined) {
    const relation = await deps.successors(proposal.goalRef);
    if (relation.status !== 'ready') return relation;
    return { status: 'ready', value: candidateChainEndOf(relation.value, proposal) };
  }
  const proposals: PlanProposal[] = [proposal];
  const read = new Set<string>([planProposalRefKey(proposal.ref)]);
  for (let current = proposal; ;) {
    const replacedBy = current.status === 'not_adopted' ? current.notAdopted?.replacedBy ?? null : null;
    if (replacedBy === null || read.has(planProposalRefKey(replacedBy))) break;
    const successor = await deps.plans.readPlanProposal(goalCtx, replacedBy);
    if (successor.status !== 'ready') return successor;
    proposals.push(successor.value);
    read.add(planProposalRefKey(replacedBy));
    current = successor.value;
  }
  return { status: 'ready', value: candidateChainEndOf({ proposals, successors: new Map(), failures: [] }, proposal) };
}

/** Whether a chain end's tail is the round of `source` (its own formal Answer is the one bound to M). */
export function chainTailIsSource(end: CandidateChainEndV1, source: SessionMessageRef,
  part: 'message' | 'decision_answer'): boolean {
  if (end.kind === 'incomplete' || end.tail.sourceMessageRef === null) return false;
  const tailPart = end.tail.sourcePart === 'decision_answer' ? 'decision_answer' : 'message';
  return tailPart === part && sessionMessageRefKey(end.tail.sourceMessageRef) === sessionMessageRefKey(source);
}

/** The reads the overlap-note match needs: the Goal's workspace and the gate owner's paged read. */
type OverlapNoteDeps = {
  plans: Pick<PlanTaskPort, 'queryGoal'>;
  gates: Pick<OverlapGatePort, 'readOverlapGates'> | undefined;
};

/**
 * The module-overlap gate whose saved note request is `message` (design 5.1), with the gate revision read; null when
 * none. The gate stores the complete `noteRequest.messageRef`, and that reference — never the body or the intent —
 * names the one message the gate asked for. The gate record lives in the Goal's workspace, which can differ from the
 * message's own when a joined Goal reaches a line in the main workspace, so the read runs as that workspace's Host.
 * The existing paged owner read is followed to its end. The consumable view, the Workflow and the Query owner's
 * submit share this one read. Without the optional gate read today's classification stays; every read failure is
 * returned as-is.
 */
export async function overlapNoteOf(
  ctx: CoreCallContext,
  deps: OverlapNoteDeps,
  message: SessionMessage,
): Promise<ReadResult<OverlapNoteMatchV1 | null>> {
  const gates = deps.gates;
  if (gates === undefined || message.sender.kind !== 'host'
    || message.sender.actor.kind !== 'system') return { status: 'ready', value: null };
  const goalRef = interventionGoalRefOf(message);
  if (goalRef === null) return { status: 'ready', value: null };
  const goalWorkspace = await interventionQueryWorkspaceOf(ctx, deps.plans, message);
  if (goalWorkspace.status !== 'ready') return goalWorkspace;
  const gateCtx = hostContextIn(ctx, goalWorkspace.value);
  const wanted = sessionMessageRefKey(message.ref);
  let cursor: string | undefined;
  for (;;) {
    const read = await gates.readOverlapGates(gateCtx, { goalRef,
      page: { limit: 100, ...(cursor === undefined ? {} : { cursor }) } });
    if (read.status !== 'ready') return read;
    const matched = read.value.gates.find(gate => gate.noteRequest !== null
      && gate.noteRequest.recipient !== null && gate.noteRequest.messageRef !== undefined
      && sessionMessageRefKey(gate.noteRequest.messageRef) === wanted);
    if (matched !== undefined) return { status: 'ready', value: { gate: { ...matched.ref }, revision: matched.revision } };
    if (read.value.nextCursor === null) return { status: 'ready', value: null };
    cursor = read.value.nextCursor;
  }
}

/**
 * An adviser round's accepted answer, read one way for every adviser round owner (K3 layering, 121-110): the system
 * message of `requestId` (`sentSystemRoundRef` in the sender's `scope`), its intervention-planning Query, the Session
 * that answered and the answer `parse` reads. A Query not created or not ended is `incomplete` (the caller waits); an
 * ended Query without an answer that parses is `invalid` `NO_ACCEPTED_ANSWER`. Safety and the product rule (009,
 * 121-110): the answer is only what the round's submit tool wrote in `shape`, and only an adviser answers. The owner
 * keeps its own subject, revision and state checks.
 */
export async function readAdviserRoundAnswer<T extends { status: 'parsed' }>(deps: {
  queries?: ReviewQueryReads; sessionDuty?: ReviewSessionDuty; messages?: Pick<SessionMailboxPort, 'readHostSendMessageRef'>;
}, ctx: CoreCallContext, input: { scope: WorkspaceScope; goalId: string; requestId: string;
  shape: 'unknown_call_advice' | 'command_rerun_advice'; parse: (text: string) => T | CoreRejection },
): Promise<{ ok: true; value: T } | { ok: false; rejection: CoreRejection }> {
  const adviserReadRefusal = (rejection: CoreRejection) => ({ ok: false as const, rejection });
  if (deps.queries === undefined || deps.sessionDuty === undefined || deps.messages === undefined) {
    return adviserReadRefusal(rejected('unavailable', 'the adviser Query, duty and sent-message reads are not wired'));
  }
  const notCreated = rejected('incomplete', 'the adviser Query has not been created; the round waits');
  const sent = await sentSystemRoundRef(deps.messages, input.scope, input.requestId, ctx.signal);
  if (sent.status === 'not_found') return adviserReadRefusal(notCreated);
  if (sent.status !== 'ready') {
    return adviserReadRefusal(sent.status === 'rejected' ? sent : rejected('unavailable', 'the adviser round message is not readable'));
  }
  const read = await deps.queries.readQueryJob(ctx,
    interventionPlanningQueryRefs(sent.value, input.scope.workspaceId).queryJobRef);
  if (read.status === 'not_found') return adviserReadRefusal(notCreated);
  if (read.status !== 'ready') {
    return adviserReadRefusal(read.status === 'rejected' ? read : rejected('incomplete', 'the adviser Query is not readable yet'));
  }
  const job = read.value.job.job;
  if (!reviewQueryEnded(job)) return adviserReadRefusal(rejected('incomplete', 'the adviser Query has not ended; the round waits'));
  const execution = job.intent.execution;
  if (execution.kind !== 'intervention_planning' || execution.answerShape !== input.shape || job.goalId !== input.goalId
    || canonicalJson(execution.sourceMessageRef as unknown as JsonValue) !== canonicalJson(sent.value as unknown as JsonValue)) {
    return adviserReadRefusal(rejected('invalid', `the adviser Query was not asked by this round's message in the ${input.shape} shape`));
  }
  const answerRef = job.answerRefs.at(-1);
  if (answerRef === undefined) return adviserReadRefusal(rejected('invalid', NO_ACCEPTED_ANSWER));
  const sessionRef = read.value.run.run.executionState?.sessionRef;
  if (sessionRef === undefined) return adviserReadRefusal(rejected('unavailable', 'the answered adviser Query names no entering Session'));
  const session = await deps.sessionDuty.readSession(ctx, sessionRef, 'project');
  if (session.status !== 'ready') return adviserReadRefusal(rejected('unavailable', 'the adviser Session could not be read'));
  const duty = await deps.sessionDuty.dutyOfRole(ctx, session.value.record.role);
  if (duty.status !== 'ready' || duty.value === 'unknown') {
    return adviserReadRefusal(rejected('unavailable', 'the adviser Session duty could not be read'));
  }
  if (duty.value !== 'adviser') return adviserReadRefusal(rejected('forbidden', `the Session that answered has duty ${duty.value}, not adviser`));
  const stored = await deps.queries.readQueryAnswer(ctx, answerRef);
  if (stored.status !== 'ready') {
    return adviserReadRefusal(stored.status === 'rejected' ? stored : rejected('unavailable', 'the adviser answer is not readable'));
  }
  const parsed = input.parse(stored.value.answer.answer);
  return parsed.status === 'parsed' ? { ok: true, value: parsed } : adviserReadRefusal(rejected('invalid', NO_ACCEPTED_ANSWER));
}

/**
 * The workspace a message's one intervention-planning Query lives in: that of the Goal the message names
 * (`interventionGoalRefOf`), or the message's own when it names none. A Goal ref carries no workspace, so the Goal is
 * read by project (decision 104-1); a failed read is returned.
 */
export async function interventionQueryWorkspaceOf(ctx: CoreCallContext, plans: Pick<PlanTaskPort, 'queryGoal'>,
  message: SessionMessage): Promise<ReadResult<string>> {
  const goalRef = interventionGoalRefOf(message);
  if (goalRef === null) return { status: 'ready', value: message.ref.workspaceId };
  const goal = await plans.queryGoal(ctx, goalRef, { scope: 'project' });
  if (goal.status !== 'ready') return goal;
  return { status: 'ready', value: goal.value.goal.workspaceRef.workspaceId };
}

/**
 * The intervention's one candidate request id for its source: `intervention:<key>:propose`, or the card-answer
 * round's `intervention:<key>:decision_answer:propose`, so the two rounds of one card never share a candidate.
 * The candidate address and the propose command's receipt identity both read this one formula.
 */
export function interventionProposalRequestIdOf(message: SessionMessageRef,
    part: 'message' | 'decision_answer'): string {
  return part === 'decision_answer'
    ? `intervention:${sessionMessageRefKey(message)}:decision_answer:propose`
    : `intervention:${sessionMessageRefKey(message)}:propose`;
}

/**
 * The intervention's one candidate address for its source: `intervention:<key>:propose`, or the card-answer
 * round's `intervention:<key>:decision_answer:propose`, so the two rounds of one card never share a candidate.
 * The project is the source message's; the workspace is the Goal's.
 */
export function interventionProposalRefOf(message: SessionMessageRef, workspaceId: string, goalId: string,
    part: 'message' | 'decision_answer'): PlanProposalRef {
  const projectId = message.projectId;
  const requestId = interventionProposalRequestIdOf(message, part);
  return { aggregateType: 'PlanProposal', projectId, workspaceId,
    proposalId: planProposalIdFor({ projectId, workspaceId, goalId, requestId }) };
}

/**
 * Walk from a candidate's `sourceMessageRef` (or a `planresume:` message) to the
 * earliest source. `planfix:` reads the parent candidate and continues from its
 * source message; `planresume:` reads the original QueryJob and continues from
 * its `execution.sourceMessageRef`. Only a `trustedSystemRoundOf` round continues
 * the walk; any other message ends it with the current message as `rootMessage`.
 * The parent candidates and original Queries live in `goalWorkspaceId`, the
 * workspace of the chain's Goal (and the round's sender scope).
 *
 * `sourcePart` is the part the round actually read from `source` (a candidate's or a Query's frozen
 * `sourcePart`; a plain message is `message`): a card-answer round (`decision_answer`) read the saved answer, so
 * that hop reads `response`, and a failed read is returned as-is. Each hop carries its own part: a `planfix:` hop the
 * parent candidate's `sourcePart`, a `planresume:` hop the original Query's `execution.sourcePart`.
 */
export async function planSourceLineageOf(
  ctx: CoreCallContext,
  deps: PlanSourceLineageDeps,
  source: SessionMessageRef,
  goalWorkspaceId: string = ctx.workspaceId ?? source.workspaceId,
  sourcePart: 'message' | 'decision_answer' = 'message',
): Promise<ReadResult<PlanSourceLineageV1>> {
  const goalCtx = hostContextIn(ctx, goalWorkspaceId);
  let current = source;
  let part = sourcePart;
  let fixRound: SessionMessageRef | null = null;
  let fixBase: PlanProposal | null = null;

  for (;;) {
    const message = await deps.messages.readMessage(hostContextIn(ctx, current.workspaceId), current);
    if (message.status !== 'ready') return message;
    // A card answer's round read the saved answer (`response`); it is never a trusted system round (an agent's card
    // to the person), so the recognition below ends the walk at it.
    const body = await deps.messages.readMessageBody(hostContextIn(ctx, current.workspaceId),
      { messageRef: current, part: part === 'decision_answer' ? 'response' : 'message' });
    if (body.status !== 'ready') return body;

    const trusted = await trustedSystemRoundOf(ctx, deps, message.value, body.value.text, goalWorkspaceId);
    if (trusted.status !== 'ready') return trusted;
    const round = trusted.value;
    if (round === null || (round.kind !== 'planfix' && round.kind !== 'planresume')) {
      return { status: 'ready', value: { rootMessage: current, fixRound, fixBase } };
    }

    if (round.kind === 'planfix') {
      const parentRead = await deps.plans.readPlanProposal(goalCtx, {
        aggregateType: 'PlanProposal',
        projectId: current.projectId,
        workspaceId: goalWorkspaceId,
        proposalId: round.proposalId,
      });
      if (parentRead.status !== 'ready') return parentRead;
      const parent = parentRead.value;
      // The nearest fix is the first one met walking backwards; later hops never
      // replace it.
      if (fixRound === null) {
        fixRound = current;
        fixBase = parent;
      }
      // A Work Run candidate has no source message, so the fix round is the root.
      if (parent.sourceMessageRef === null) {
        return { status: 'ready', value: { rootMessage: current, fixRound, fixBase } };
      }
      current = parent.sourceMessageRef;
      part = parent.sourcePart ?? 'message';
      continue;
    }

    const jobRead = await deps.queries.readQueryJob(
      goalCtx,
      queryJobRefFor(current.projectId, goalWorkspaceId, round.queryJobId),
    );
    if (jobRead.status !== 'ready') return jobRead;
    const execution = jobRead.value.job.job.intent.execution;
    current = execution.sourceMessageRef!;
    part = execution.sourcePart ?? 'message';
  }
}

/**
 * The executor message M a candidate's formal Answer replies to (§6.1.4 / §6.3.1): the candidate's planning Query's
 * `repliesToMessageRef` is read first and named directly; only a Query without one walks the source chain
 * (`planSourceLineageOf`) to its root. The Query lives in `goalWorkspaceId` (the candidate's Goal) and its identity
 * carries the candidate's frozen `sourcePart`. The Workflow's reply association and the restart wake rebuild both
 * read M here. Every read failure is returned as-is.
 */
export async function candidateReplyTargetOf(
  ctx: CoreCallContext,
  deps: PlanSourceLineageDeps,
  source: SessionMessageRef,
  sourcePart: 'decision_answer' | undefined,
  goalWorkspaceId: string,
): Promise<ReadResult<SessionMessageRef>> {
  const query = await deps.queries.readQueryJob(ctx,
    interventionPlanningQueryRefs(source, goalWorkspaceId,
      sourcePart === 'decision_answer' ? 'decision_answer' : 'message').queryJobRef);
  if (query.status !== 'ready') return query;
  const repliesTo = query.value.job.job.intent.execution.repliesToMessageRef;
  if (repliesTo !== undefined) return { status: 'ready', value: repliesTo };
  const lineage = await planSourceLineageOf(ctx, deps, source);
  return lineage.status === 'ready' ? { status: 'ready', value: lineage.value.rootMessage } : lineage;
}
