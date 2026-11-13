/**
 * The one source-lineage walk behind `planfix:` and `planresume:` (slice-PL-SPEC
 * §6.3.1). A candidate's `sourceMessageRef` can be a repair round or a resumed
 * round; both continue the same chain. The walk reads only the first line's
 * system-round head and follows records that point to earlier commits, so it
 * needs no cycle guard.
 *
 * Every read failure is returned as-is; the walk never guesses a root. The
 * `messages` dependency is the existing mailbox port (both members), but the
 * walk needs only the saved body: a message's first line decides the next hop.
 *
 * A joined workspace's round lands in the recipient line's workspace while its
 * Query and candidates stay with the Goal: each message is read where it lives,
 * each parent candidate and original Query where the Goal lives.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { WorkspaceScope } from '../../../contracts/core/identity.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { interventionPlanningQueryRefs, queryJobRefFor } from '../../../contracts/query-job.js';
import { systemRoundContext, systemRoundOfText } from '../../../contracts/plan-round.js';
import { interventionGoalRefOf, type SessionMailboxPort, type SessionMessage } from '../model/communication-contracts.js';
import {
  NO_ACCEPTED_ANSWER, reviewQueryEnded, type ReviewQueryReads, type ReviewSessionDuty,
} from '../model/evidence-contracts.js';
import type { PlanProposal, PlanTaskPort } from '../model/plan-contracts.js';
import type { QueryJobPort } from '../queries/contracts.js';
import { handoffContextOf } from '../sessions/session-handoff-service.js';

export type PlanSourceLineageV1 = {
  /** The earliest source message on the chain: the executor's M or the first system R. */
  rootMessage: SessionMessageRef;
  /** The nearest `planfix:` round crossed on the chain, or null. */
  fixRound: SessionMessageRef | null;
  /** The candidate that round had to repair; null when there is no fixRound. */
  fixBase: PlanProposal | null;
};

export type PlanSourceLineageDeps = {
  messages: Pick<SessionMailboxPort, 'readMessage' | 'readMessageBody'>;
  queries: Pick<QueryJobPort, 'readQueryJob'>;
  plans: Pick<PlanTaskPort, 'readPlanProposal'>;
};

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
 * Walk from a candidate's `sourceMessageRef` (or a `planresume:` message) to the
 * earliest source. `planfix:` reads the parent candidate and continues from its
 * source message; `planresume:` reads the original QueryJob and continues from
 * its `execution.sourceMessageRef`. Any other first line ends the walk with the
 * current message as `rootMessage`. The parent candidates and original Queries
 * live in `goalWorkspaceId`, the workspace of the chain's Goal.
 */
export async function planSourceLineageOf(
  ctx: CoreCallContext,
  deps: PlanSourceLineageDeps,
  source: SessionMessageRef,
  goalWorkspaceId: string = ctx.workspaceId ?? source.workspaceId,
): Promise<ReadResult<PlanSourceLineageV1>> {
  const goalCtx = hostContextIn(ctx, goalWorkspaceId);
  let current = source;
  let fixRound: SessionMessageRef | null = null;
  let fixBase: PlanProposal | null = null;

  for (;;) {
    const body = await deps.messages.readMessageBody(hostContextIn(ctx, current.workspaceId),
      { messageRef: current, part: 'message' });
    if (body.status !== 'ready') return body;

    const head = systemRoundOfText(body.value.text);
    if (head === null || (head.kind !== 'planfix' && head.kind !== 'planresume')) {
      return { status: 'ready', value: { rootMessage: current, fixRound, fixBase } };
    }

    if (head.kind === 'planfix') {
      const parentRead = await deps.plans.readPlanProposal(goalCtx, {
        aggregateType: 'PlanProposal',
        projectId: current.projectId,
        workspaceId: goalWorkspaceId,
        proposalId: head.proposalId,
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
      continue;
    }

    const jobRead = await deps.queries.readQueryJob(
      goalCtx,
      queryJobRefFor(current.projectId, goalWorkspaceId, head.queryJobId),
    );
    if (jobRead.status !== 'ready') return jobRead;
    current = jobRead.value.job.job.intent.execution.sourceMessageRef!;
  }
}
