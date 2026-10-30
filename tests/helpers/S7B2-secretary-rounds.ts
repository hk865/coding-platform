/** The secretary round worlds: one real Host world and the public steps that produce reply/expiry rounds. */
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type {
  RequestCoreViewV1, RequestRoundViewV1,
} from '../../src/core/work-graph/model/request-contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionWorkWaitV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { graphWrite } from './AG2b-collaboration-fixture.js';
import { followUp, secretaryAnswer } from './S6A-history-fixture.js';
import { callPublishedOwnerAsHost, openS6AHostWorld, type S6AHostWorld } from './S6A-host-fixture.js';
import { claimWithSecretaryProfile, prepareAttempt, start } from './request-claim-steps.js';
import {
  S6A_SCOPE, S6A_WORK_ROLE, type S6AClock, type S6ASession, type S6AWorldOptions,
} from './S6A-request-fixture.js';
import { byIdentityPrefix } from './S6A-commit-barrier.js';
import { s6aCardsWorkspace } from './S6A-cards-fixture.js';
import {
  adoptS6BPlan, createS6BLine, governS6B, holdS6BRequestRound, type S6BHeldRound,
} from './S6B1-fixture.js';
import { driveS6BHandoff } from './S6B2-fixture.js';
import { s6b2Accept } from './S6B2-handoff-scene.js';
import {
  S7A_REPLY_TOOLS, committed, crashS7AHost, holdS7ACommitter, holdS7AQueryRound, sameSession, sessionOf,
} from './S7A-fixture.js';
import { answerS7BWait, readS7BMessage } from './S7B-fixture.js';

/** One held round's two sent messages with the two Work recipient lines and the goal/Tasks their replies use. */
export type S7B2SentRound = {
  round: S6BHeldRound;
  goal: GoalRef;
  tasks: readonly [TaskTriple, TaskTriple];
  recipients: readonly [S6ASession, S6ASession];
  messages: readonly [SessionMessage, SessionMessage];
};

/** Every user message of one model request, joined: a delivered input is its own user message. */
export function requestUserText(request: ModelRequest): string {
  return request.messages.flatMap(candidate => candidate.role === 'user' ? [candidate.content] : []).join('\n');
}

/** The reply/expiry rounds of one `requests/read`, in the view's order. */
export function s7b2WaitRounds(view: RequestCoreViewV1, kind: 'reply' | 'expiry'): RequestRoundViewV1[] {
  return view.rounds.filter(round => round.kind === kind);
}

/** Scripts the one answer of a reply/expiry round. */
export async function scriptS7B2RoundAnswer(world: S6AHostWorld, input: {
  round: S6BHeldRound; label: string;
}): Promise<void> {
  const kind = input.round.manifest.request?.executionKind;
  await world.scripted.script(input.round.secretary, [{ kind: 'text', text: kind === 'initial_coordination'
    ? JSON.stringify({ schemaVersion: 2, kind: 'needs_decision', summary: `S7B2 ${input.label}`,
      questions: [`S7B2 ${input.label} question`] })
    : secretaryAnswer({ body: `S7B2 ${input.label} reply round answer` }) }]);
}

/** Opens one real Host world with the reply/send Work binding and one secretary. */
export async function openS7B2RoundWorld(options: S6AWorldOptions): Promise<{
  world: S6AHostWorld; clock: S6AClock; secretary: S6ASession;
}> {
  const world = await openS6AHostWorld({ ...options,
    extraHostOptions: { ...(options.extraHostOptions ?? {}),
      requestDriver: options.extraHostOptions?.['requestDriver'] ?? 'on' },
    extraBindings: [S7A_REPLY_TOOLS, { ...S7A_REPLY_TOOLS, mergeTools: ['send_session_message'] }] });
  await governS6B(world, s6aCardsWorkspace(world, S6A_SCOPE), world.goals);
  const secretary = await world.createSecretary('s7b2-round-secretary');
  return { world, clock: world.clock, secretary };
}

/** Reopens the world with the request driver on. */
export async function startS7B2RoundDriver(world: S6AHostWorld, backend: 'memory' | 'sqlite'): Promise<void> {
  await world.reopen({ ...(backend === 'memory' ? { sharedMemoryStore: true as const } : {}),
    extraHostOptions: { requestDriver: 'on' } });
}

/** Step 10: one real held secretary round whose `query_run` sends two messages; `use` runs at its handling point. */
export async function runS7B2Round<T = undefined>(world: S6AHostWorld, input: {
  label: string; use?: (sent: S7B2SentRound) => Promise<T>;
}): Promise<S7B2SentRound & { use: T | undefined }> {
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  const goal = (await main.createGoal(`s7b2-goal-${input.label}`, 'S7B2 round goal')).ref;
  const { tasks } = await adoptS6BPlan(main, goal, { label: `s7b2-${input.label}`, role: S6A_WORK_ROLE.templateId,
    taskIds: [`s7b2-${input.label}-a`, `s7b2-${input.label}-b`] });
  const recipients = [
    await sessionOf(world, await createS6BLine(main, { label: `s7b2-${input.label}-a`, role: S6A_WORK_ROLE })),
    await sessionOf(world, await createS6BLine(main, { label: `s7b2-${input.label}-b`, role: S6A_WORK_ROLE })),
  ] as const;
  let used: T | undefined;
  const value = await holdS7AQueryRound(world, { label: `s7b2-${input.label}`, goalId: null },
    async (context, round) => {
      const messages: SessionMessage[] = [];
      for (const [index, recipient] of recipients.entries()) {
        const saved = await world.platform.messages.sendMessage(context, {
          input: { recipient: recipient.ref, text: `S7B2 ${input.label} message ${index}`,
            intent: 'inquiry' as const, needsReply: true, waitAfterSend: true, deadlineMs: 60_000 },
          meta: { requestId: `s7b2-send-${input.label}-${index}`, expected: [] },
        });
        if (saved.status !== 'committed') {
          throw new Error(`S7B2: the round's mailbox send was refused: ${JSON.stringify(saved)}`);
        }
        const message = await readS7BMessage(world, saved.value.ref);
        if (message.sender.kind !== 'secretary_round'
          || !sameSession(message.sender.sessionRef, round.secretary.ref)
          || message.sender.requestRoot.queryJobId !== round.request.requestRoot.queryJobId) {
          throw new Error(`S7B2: the message ${index} is not this round's: ${JSON.stringify(message.sender)}`);
        }
        messages.push(message);
      }
      const sent: S7B2SentRound = { round, goal, tasks: [tasks[0]!, tasks[1]!], recipients,
        messages: [messages[0]!, messages[1]!] };
      used = input.use === undefined ? undefined : await input.use(sent);
      return sent;
    });
  return { ...value, use: used };
}

/** One reply through the Work recipient or one expiry through the published owner. */
export async function replyOrExpireS7B2Round(world: S6AHostWorld, input:
  | { kind: 'reply'; goal: GoalRef; recipient: S6ASession; message: SessionMessage['ref'];
    task: TaskTriple; label: string }
  | { kind: 'expiry'; messageRef: SessionMessage['ref'] }): Promise<{
  kind: 'reply' | 'expiry'; message: SessionMessage; wait: SessionWorkWaitV1 | null;
}> {
  if (input.kind === 'reply') {
    return { kind: 'reply', message: await answerS7BWait(world, input), wait: null };
  }
  await callPublishedOwnerAsHost(world, 'S7B', {
    owner: 'messageExpiry.recordExpiry', wave: '7B-1 L', scope: S6A_SCOPE,
  }, { messageRef: input.messageRef });
  const message = await readS7BMessage(world, input.messageRef);
  return { kind: 'expiry', message, wait: null };
}

/** The two replies of the held round at its one handling point. */
export async function twoRepliesS7B2Round(world: S6AHostWorld, input: {
  sent: S7B2SentRound; label: string;
}): Promise<{ replies: readonly [SessionMessage, SessionMessage] }> {
  const replies: SessionMessage[] = [];
  for (const [index, message] of input.sent.messages.entries()) {
    if (index > 0) world.clock.advance(1);
    replies.push(await answerS7BWait(world, { goal: input.sent.goal, recipient: input.sent.recipients[index]!,
      message: message.ref, task: input.sent.tasks[index]!, label: `${input.label}-${index}` }));
  }
  return { replies: [replies[0]!, replies[1]!] as const };
}

/** Accepts a real handoff to a new successor and drives it. */
export async function handoffS7B2Round(world: S6AHostWorld, input: {
  source: SessionRef; label: string;
}): Promise<{ operation: OperationRef; successor: SessionRef;
  drive: Awaited<ReturnType<typeof driveS6BHandoff>> }> {
  const successor = await world.createSecretary(`s7b2-handoff-${input.label}-successor`);
  const operation = await s6b2Accept(world, {
    commandId: `s7b2-handoff-${input.label}`, source: input.source, target: successor.ref,
    trigger: 'manual', tasks: [],
  });
  return { operation, successor: successor.ref, drive: await driveS6BHandoff(world, { operation }) };
}

/** Holds the entered commit, crashes the real SQLite Host and reads the recovered reply. */
export async function crashS7B2Round(world: S6AHostWorld, input: {
  reply: () => Promise<unknown>; messageRef: SessionMessage['ref']; requestRoot: QueryJobRef;
}): Promise<{ message: SessionMessage; view: RequestCoreViewV1 }> {
  const hold = holdS7ACommitter(world, byIdentityPrefix('r5b-query-execution:entered:'));
  await input.reply();
  await hold.reached;
  await crashS7AHost(world, hold);
  const message = await readS7BMessage(world, input.messageRef);
  return { message, view: await world.readRequest(input.requestRoot) };
}

/** One notify plus a late reply, then a real follow-up request round. */
export async function notifyOnlyS7B2Supply(world: S6AHostWorld, input: {
  sent: S7B2SentRound; label: string;
}): Promise<{ notify: SessionMessage; lateReply: SessionMessage; view: RequestCoreViewV1;
  requests: ModelRequest[] }> {
  await scriptS7B2RoundAnswer(world, { round: input.sent.round, label: input.label });
  const saved = committed<SessionMessage>(await world.dispatch('messages/send', world.systemContext(),
    graphWrite(S6A_SCOPE, {
      recipient: input.sent.round.secretary.ref, text: `S7B2 notify ${input.label}`, intent: 'notify',
    }, `s7b2-notify-${input.label}`)), `the ${input.label} notify`);
  const notify = await readS7BMessage(world, saved.ref);
  const lateReply = await answerS7BWait(world, { goal: input.sent.goal,
    recipient: input.sent.recipients[0]!, message: input.sent.messages[0]!.ref,
    task: input.sent.tasks[0]!, label: `${input.label}-late` });
  const root = input.sent.round.request.requestRoot;
  const follow = await world.submit(followUp(`s7b2-followup-${input.label}`, root, `S7B2 ${input.label} follow-up`));
  if (follow.status !== 'queued') {
    throw new Error(`S7B2: the ${input.label} follow-up was refused: ${JSON.stringify(follow)}`);
  }
  const claimed = await claimWithSecretaryProfile(world, follow.round, input.sent.round.secretary,
    `s7b2-followup-${input.label}-claim`);
  if (claimed['status'] !== 'committed') {
    throw new Error(`S7B2: the ${input.label} follow-up was not claimed: ${JSON.stringify(claimed)}`);
  }
  const prepared = await prepareAttempt(world, follow.round, `s7b2-followup-${input.label}-prepare`);
  await start(world, prepared, `s7b2-followup-${input.label}-start`);
  const view = await world.waitForRequest(root,
    current => current.rounds.some(round => round.kind === 'followup' && round.status === 'ended'),
    `the ${input.label} follow-up round`);
  return { notify, lateReply, view, requests: await world.scripted.requests(input.sent.round.secretary) };
}
