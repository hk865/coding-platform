/**
 * The C directory world (fixture spec v2.2 §2 step 1; SR3 C.7): one real memory-or-SQLite Host world with a
 * Session for every C-candidates busy/idle kind, plus the separate paging world for the `sessions/find` row.
 * Every state is a public step: `sessions/create` (`createWorkSession`/`createS6BLine`), `messages/send` as the
 * Host's human actor, `queries/submit`+`queries/claim` (`occupy`), `queries/prepare`+`queries/start`
 * (`startBusyQuery`), `sessions/archive-line` (`requestArchive`), `makeReadonlyCopy`, `goals/control`
 * (`pauseS7AGoal`), Workflow `claim_task` (`workflow/advance`, stopped before `prepare`), and the real
 * `world.crash`; no store read, hand-built record/`CoreCallContext`, impersonated Host/Runtime or wall-clock.
 * `unknown` is a real crashed plain Query (SQLite only): its model starts `list_files`, the Host crashes with
 * the call unresolved, and the reconcile marks the QueryRun `unknown` (QRR-05), Session health still available.
 * `health` is the SQLite-only unavailable Session of `makeUnavailableSecretary`; `recoverable` has no public
 * writer (`session-availability.ts:472`) and unavailable needs that restart, which memory refuses, so memory
 * has no `health` case. Both are `null` on memory.
 * Keys are `plainSessionRefKey` (`session-record-codecs.ts:1167`), never hand-typed; `paging.keys` is the
 * directory order the row pages (page 1, a real send, then page 1's last key as `page.afterSessionKey`).
 */
import * as hostModule from '../../src/app/host.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionFactsV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import { plainSessionRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { advanceUntil, driveWorkflow } from './A2-restart-fixture.js';
import { AG2B_CONSUMER_ID, AG2B_QUERY_BUDGET, AG2B_RUNTIME_BUDGET, graphWrite, plain, startBusyQuery } from './AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from './S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld, type S6AHostWorldOptions } from './S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, S6A_WORK_ROLE_BINDING, S6A_AT, S6A_SECRETARY_PROFILE_ID,
  type S6ASession, type S6AWorldOptions } from './S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from './S6B1-fixture.js';
import { committed, pauseS7AGoal, ready, replyS7AMessage, S7A_REPLY_TOOLS, sessionOf } from './S7A-fixture.js';
import { expireS7BWait, listed, sendS7BWaitingInquiry } from './S7B-fixture.js';

export type S7B2DirectorySession = { readonly session: S6ASession; readonly key: string };

export type S7B2DirectoryName = 'idlePerson' | 'idleInquiry' | 'notifyOnly' | 'claimedNotStarted'
  | 'queryClaimed' | 'queryEntered' | 'unknown' | 'health' | 'archiveRequested' | 'readonlyCopy' | 'pausedGoalPerson';

export type S7B2PagingWorld = {
  readonly world: S6AHostWorld;
  /** The paging Sessions in directory-key order. */
  readonly sessions: readonly S6ASession[];
  /** `plainSessionRefKey` of each paging Session, same order. */
  readonly keys: readonly string[];
};

export type S7B2DirectoryWorld = {
  readonly backend: S6AWorldOptions['backend'];
  readonly world: S6AHostWorld;
  /** The Host world's own trusted human context (its actor and scope); never built in this file. */
  readonly ctx: CoreCallContext;
  /** Every named Session with its canonical key; `unknown`/`health` are `null` where no public step exists. */
  readonly sessions: Readonly<Record<S7B2DirectoryName, S7B2DirectorySession | null>>;
  readonly paging: S7B2PagingWorld;
  /** Closes the paging world and the directory world. */
  close(): Promise<void>;
};

function handleOf(session: S6ASession | null): S7B2DirectorySession | null {
  return session === null ? null : { session, key: plainSessionRefKey(session.ref) };
}

/** One real `messages/send` as the Host's human actor; the route's own result envelope decides success. */
async function sendMessage(world: S6AHostWorld, to: S6ASession, requestId: string,
  input: Record<string, unknown>): Promise<void> {
  const answer = await world.post('messages/send', graphWrite(S6A_SCOPE, {
    recipient: to.ref, text: `S7B2 ${requestId}`, ...input,
  }, requestId));
  committed(answer.body, `the message ${requestId}`);
}

export async function openS7B2DirectoryWorld(options: S6AWorldOptions): Promise<S7B2DirectoryWorld> {
  const world = await openS6AHostWorld({ ...options });
  await world.setResumeOnStartup(false);
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  await governS6B(world, main, world.goals);

  // Goal 2: the C-M2 paused-Goal person message, on a real Work line with a real Task.
  const pausedPlan = await adoptS6BPlan(main, world.goals.second, {
    label: 's7b2-paused', taskIds: ['s7b2-paused'], role: S6A_WORK_ROLE.templateId });
  const pausedGoalPerson = await sessionOf(world, await createS6BLine(main, {
    label: 's7b2-paused-goal-person', role: S6A_WORK_ROLE, tasks: [pausedPlan.tasks[0]!] }));
  await sendMessage(world, pausedGoalPerson, 's7b2-paused-person', {
    intent: 'action_request', needsReply: true, goalRef: world.goals.second, taskRef: pausedPlan.tasks[0] });
  await pauseS7AGoal(world, world.goals.second);

  const idlePerson = await world.createWorkSession('s7b2-idle-person');
  const idleInquiry = await world.createWorkSession('s7b2-idle-inquiry');
  const notifyOnly = await world.createWorkSession('s7b2-notify-only');
  await sendMessage(world, idlePerson, 's7b2-person-inquiry', { intent: 'inquiry', needsReply: true });
  await sendMessage(world, idlePerson, 's7b2-person', { intent: 'action_request', needsReply: true,
    goalRef: world.goals.first });
  await sendMessage(world, idleInquiry, 's7b2-inquiry', { intent: 'inquiry', needsReply: true });
  await sendMessage(world, notifyOnly, 's7b2-notify', { intent: 'notify' });

  // SQLite only: a plain Query crashed while its real `list_files` call has no result (QRR-05).
  let unknown: S6ASession | null = null;
  if (world.backend === 'sqlite') {
    unknown = await world.createWorkSession('s7b2-unknown');
    await world.scripted.script(unknown, [{ kind: 'calls', calls: [
      { callId: 's7b2-unknown-list', name: 'list_files', args: { prefix: '.' } }] }]);
    const refs = await world.occupy(unknown);
    const tool = await world.gates.toolCall(unknown, 'list_files');
    void startBusyQuery(world.ag2b, refs, refs.suffix).catch(() => undefined);
    await tool.reached;
    await world.crash();
    const read = ready<{ run: { run: { executionState?: { phase?: string } } } }>(
      await world.post('queries/read', plain(S6A_SCOPE, refs.queryJobRef)), 'the unknown QueryRun');
    if (read.run.run.executionState?.phase !== 'unknown') {
      throw new Error(`S7B2: the crashed QueryRun is ${String(read.run.run.executionState?.phase)}, not unknown`);
    }
  }

  // SQLite only: the host restart of `makeUnavailableSecretary` leaves one unoccupied unavailable line.
  const health = world.backend === 'sqlite' ? await world.makeUnavailableSecretary('s7b2-health') : null;

  // A Work Task claimed, the start commit never made: the Run stays `starting`.
  const { tasks } = await adoptS6BPlan(main, world.goals.first, {
    label: 's7b2', taskIds: ['s7b2-claim'], role: S6A_WORK_ROLE.templateId });
  const claimedNotStarted = await sessionOf(world, await createS6BLine(main, {
    label: 's7b2-claimed-not-started', role: S6A_WORK_ROLE, tasks: [tasks[0]!] }));
  const select = { schemaVersion: 1 as const, goalRef: world.goals.first, flowId: 's7b2-claim',
    sessionHint: claimedNotStarted.ref, kind: 'select_work' as const, taskId: tasks[0]!.taskId };
  const claimInput = await advanceUntil(world.ag2b, select, 'claim_task');
  await driveWorkflow(world.ag2b, claimInput, { stopBefore: 'prepare' });
  const claimedFacts = ready<SessionFactsV1>(await world.post('sessions/facts',
    plain(S6A_SCOPE, claimedNotStarted.ref)), 'the claimed Session facts');
  const claimedRun = claimedFacts.latestWork === null ? null : ready<{ run: { status: string } }>(
    await world.post('executions/read', plain(S6A_SCOPE, claimedFacts.latestWork.runRef)), 'the claimed Run');
  if (claimedRun === null || claimedRun.run.status !== 'starting') {
    throw new Error('S7B2: the claimed Run did not stay starting');
  }

  const archiveRequested = await world.createWorkSession('s7b2-archive-requested');
  await world.requestArchive(archiveRequested);
  const readonlyCopy = (await world.makeReadonlyCopy(await world.createWorkSession('s7b2-copy-source'),
    's7b2-readonly-copy')).copy;

  const queryClaimed = await world.createWorkSession('s7b2-query-claimed');
  await world.occupy(queryClaimed);
  const queryEntered = await world.createWorkSession('s7b2-query-entered');
  const entered = await world.occupy(queryEntered);
  const enteredHold = await world.gates.modelRequest(queryEntered);
  world.scriptReplies([{ kind: 'text', text: 'S7B2 entered Query answer' }]);
  void startBusyQuery(world.ag2b, entered, entered.suffix).catch(() => undefined);
  await enteredHold.reached;

  const pagingWorld = await openS6AHostWorld({ backend: world.backend });
  const pagingSessions: S6ASession[] = [];
  for (const label of ['a', 'b', 'c', 'd']) {
    pagingSessions.push(await pagingWorld.createWorkSession(`s7b2-page-${label}`));
  }
  pagingSessions.sort((left, right) =>
    plainSessionRefKey(left.ref) < plainSessionRefKey(right.ref) ? -1 : 1);
  const pagingKeys = pagingSessions.map(session => plainSessionRefKey(session.ref));

  return {
    backend: world.backend, world, ctx: world.humanContext(),
    sessions: {
      idlePerson: handleOf(idlePerson), idleInquiry: handleOf(idleInquiry), notifyOnly: handleOf(notifyOnly),
      claimedNotStarted: handleOf(claimedNotStarted), queryClaimed: handleOf(queryClaimed),
      queryEntered: handleOf(queryEntered), unknown: handleOf(unknown), health: handleOf(health),
      archiveRequested: handleOf(archiveRequested), readonlyCopy: handleOf(readonlyCopy),
      pausedGoalPerson: handleOf(pausedGoalPerson),
    },
    paging: { world: pagingWorld, sessions: pagingSessions, keys: pagingKeys },
    async close() {
      const closed = await Promise.allSettled([world.close(), pagingWorld.close()]);
      const failures = closed.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map(result => result.reason as unknown);
      if (failures.length > 0) throw new AggregateError(failures, 'S7B2 directory world cleanup failed');
    },
  };
}
/**
 * The H-consume world (fixture spec v2.2 §2 step 2): the first open carries the one 25 ms consumer (H-L2); ten
 * eligible person messages, notify-only, unmatched role, goal-less person and two ordinary late replies.
 */
export type S7B2ConsumeWorld = {
  readonly world: S6AHostWorld;
  /** The ten eligible Sessions in key (= page) order. */
  readonly eligible: readonly S6ASession[];
  readonly notify: S6ASession; readonly unmatchedRole: S6ASession; readonly goalLess: S6ASession;
  /** The no-wait and the consumed-wait sending Sessions; each outbox carries the responded message. */
  readonly replies: readonly [S6ASession, S6ASession];
};
async function personSend(world: S6AHostWorld, to: S6ASession, requestId: string,
  extra: Record<string, unknown> = {}): Promise<void> {
  // An inquiry opens the consultation turn; a person action_request on a never-run Task is refused `busy` by the
  // intervention claim (its released prior Run is missing), so the batch's eligible person messages are inquiries.
  committed((await world.post('messages/send', graphWrite(S6A_SCOPE, {
    recipient: to.ref, text: `S7B2 consume ${requestId}`, intent: 'inquiry', needsReply: true, ...extra,
  }, requestId))).body, `the person message ${requestId}`);
}
/**
 * The scenario's own Host input (H-06): the frozen S6A fixture cannot add a Work profile through
 * `extraHostOptions`/`extraBindings`, so this wraps `createLocalWorkbenchHost` the way its `hostStart` does
 * (`S6A-host-fixture.ts:533`/`:539`), adding the Work role's Query profile before the real factory runs.
 */
async function openConsumeHostWorld(options: S6AHostWorldOptions): Promise<S6AHostWorld> {
  const original = hostModule.createLocalWorkbenchHost;
  const wrapper: typeof original = async hostOptions => {
    const configuration = hostOptions.runtimeConfiguration;
    configuration?.queryProfiles.push({
      id: 's6a-work-profile', label: 'S6A work continuation', scope: S6A_SCOPE,
      runtimeBindingId: 's6a-work-binding', sessionRole: structuredClone(S6A_WORK_ROLE),
      roleBinding: structuredClone(S6A_WORK_ROLE_BINDING),
      runtimeBudget: structuredClone(AG2B_RUNTIME_BUDGET), budget: structuredClone(AG2B_QUERY_BUDGET),
      consumerId: AG2B_CONSUMER_ID,
    });
    return await original(hostOptions);
  };
  Object.defineProperty(hostModule, 'createLocalWorkbenchHost', { value: wrapper, configurable: true, writable: true });
  try {
    return await openS6AHostWorld(options);
  } finally {
    Object.defineProperty(hostModule, 'createLocalWorkbenchHost', { value: original, configurable: true, writable: true });
  }
}
export async function openS7B2ConsumeWorld(): Promise<S7B2ConsumeWorld> {
  const world = await openConsumeHostWorld({ backend: 'memory',
    extraBindings: [S7A_REPLY_TOOLS, { ...S7A_REPLY_TOOLS, mergeTools: ['send_session_message'] }],
    extraHostOptions: { inputConsumers: [{ scope: S6A_SCOPE,
      sessionRef: { projectId: S6A_SCOPE.projectId, sessionId: 's7b2-consume-period' },
      goalRef: { aggregateType: 'Goal' as const, projectId: S6A_SCOPE.projectId, goalId: 's7b2-consume-period' },
      queryProfileId: S6A_SECRETARY_PROFILE_ID, heartbeatMs: 25 }] } });
  // Two real empty passes settle the start before any message exists; the clock then returns to the world's first
  // instant so setup's small advances keep the 25 ms consumer throttled until the row measures a heartbeat.
  for (const advance of [5_000, 5_000]) {
    const settled = world.consumeBarrier(); world.clock.advance(advance); await settled;
  }
  world.clock.set(S6A_AT);
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  await governS6B(world, main, world.goals);
  const tasks = (await adoptS6BPlan(main, world.goals.first, { label: 's7b2-consume',
    taskIds: Array.from({ length: 12 }, (_, index) => `s7b2-consume-task-${index + 1}`),
    role: S6A_WORK_ROLE.templateId })).tasks;
  const eligible: S6ASession[] = [];
  for (const [index, number] of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].entries()) {
    const label = `s7b2-consume-eligible-${number}`;
    const session = await sessionOf(world, await createS6BLine(main, { label, role: S6A_WORK_ROLE, tasks: [tasks[index]!] }));
    await personSend(world, session, label, { goalRef: world.goals.first, taskRef: tasks[index]! });
    eligible.push(session);
  }
  const notify = await sessionOf(world, await createS6BLine(main, { label: 's7b2-consume-notify-3', role: S6A_WORK_ROLE }));
  committed((await world.post('messages/send', graphWrite(S6A_SCOPE, { recipient: notify.ref,
    text: 'S7B2 consume notify', intent: 'notify' }, 's7b2-consume-notify'))).body, 'the notify message');
  const unmatchedRole = await world.createUnprofiledSecretary('s7b2-consume-unmatched-13');
  await personSend(world, unmatchedRole, 's7b2-consume-unmatched', { goalRef: world.goals.first });
  const goalLess = await sessionOf(world, await createS6BLine(main, { label: 's7b2-consume-goalless-4', role: S6A_WORK_ROLE }));
  await personSend(world, goalLess, 's7b2-consume-goalless');
  const noWaitSender = await sessionOf(world, await createS6BLine(main, {
    label: 's7b2-consume-nowait-sender-23', role: S6A_WORK_ROLE, tasks: [tasks[10]!] }));
  const noWaitRecipient = await sessionOf(world, await createS6BLine(main, {
    label: 's7b2-consume-nowait-recipient-11', role: S6A_WORK_ROLE }));
  await world.scripted.script(noWaitSender, [{ kind: 'calls', calls: [{ callId: 's7b2-consume-nowait',
    name: 'send_session_message', args: { recipient: noWaitRecipient.ref, text: 'S7B2 consume no-wait',
      intent: 'inquiry', needsReply: true, waitAfterSend: false } }] }]);
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: world.goals.first, flowId: 's7b2-consume-nowait',
    sessionHint: noWaitSender.ref, kind: 'select_work', taskId: tasks[10]!.taskId }, { stopBefore: 'open_checks' });
  const sent = (await listed(world, 'outbox', noWaitSender)).find(item => item.sender.kind === 'work_run');
  if (sent === undefined) throw new Error('S7B2: the no-wait send is not in its outbox');
  await replyS7AMessage(world, { goal: world.goals.first, recipient: noWaitRecipient, messageRef: sent.ref,
    taskId: tasks[11]!.taskId, label: 's7b2-consume-nowait', text: 'S7B2 consume no-wait reply' });
  const waitGoal = (await main.createGoal('s7b-goal-s7b2-consume-wait-24', 'S7B2 consume wait goal')).ref;
  const waitPlan = await adoptS6BPlan(main, waitGoal, { label: 's7b-s7b2-consume-wait-24',
    taskIds: ['s7b-s7b2-consume-wait-24-send', 's7b-s7b2-consume-wait-24-reply'], role: S6A_WORK_ROLE.templateId });
  const waitSender = await sessionOf(world, await createS6BLine(main, {
    label: 's7b-s7b2-consume-wait-24-sender', role: S6A_WORK_ROLE, tasks: [waitPlan.tasks[0]!] }));
  const waitRecipient = await sessionOf(world, await createS6BLine(main, {
    label: 's7b-s7b2-consume-wait-24-recipient', role: S6A_WORK_ROLE }));
  const waitSent = await sendS7BWaitingInquiry(world, {
    goal: waitGoal, session: waitSender, taskId: waitPlan.tasks[0]!.taskId, label: 's7b2-consume-wait-24',
    body: { recipient: waitRecipient.ref, text: 'S7B2 consume wait', intent: 'inquiry',
      needsReply: true, waitAfterSend: true, deadlineMs: 1 },
  });
  world.clock.advance(2);
  await expireS7BWait(world, { messageRef: waitSent.ref });
  await world.scripted.script(waitSender, [{ kind: 'text', text: 'S7B2 consume wait continuation' }]);
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: waitGoal, flowId: 's7b2-consume-wait-claim',
    sessionHint: waitSender.ref, kind: 'select_work', taskId: waitPlan.tasks[0]!.taskId });
  await replyS7AMessage(world, { goal: waitGoal, recipient: waitRecipient, messageRef: waitSent.ref,
    taskId: waitPlan.tasks[1]!.taskId, label: 's7b2-consume-wait', text: 'S7B2 consume consumed-wait reply' });
  eligible.sort((left, right) => plainSessionRefKey(left.ref) < plainSessionRefKey(right.ref) ? -1 : 1);
  // The first measured heartbeat crosses the consumer throttle at this instant; the row's barrier observes that pass.
  world.clock.set(new Date(Date.parse(S6A_AT) + 10_000).toISOString());
  return { world, eligible, notify, unmatchedRole, goalLess, replies: [noWaitSender, waitSender] };
}
export { openConsumeHostWorld };
