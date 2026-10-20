/**
 * Wiring package 2, group D (spec §5.2 rows F01-F15, entries E1-E3; §2.1, §4.2,
 * §4.3, §4.4, L3/L4/L7): the production `createTargetPlatform` composition.
 *
 * The rows exercise the real composition root: a real pinned role Session, a
 * real claimed/entered Work Run, the scripted Kernel model and the formal
 * mailbox/decision/runtime ports. No internal function is mocked and no fact is
 * read back from a side channel; expected values are the spec's literal values
 * and the commands' own receipts.
 */
import { afterEach, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { RuntimeBudget } from '../../src/contracts/runtime-budget.js';
import type { QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { RoleSpecContentV1 } from '../../src/contracts/role-spec.js';
import { roleSpecContentDigest } from '../../src/contracts/role-spec.js';
import {
  claimSuccessorRun, createWP2Platform, decisionRequestArgs, observeStage, preparedBundle,
  preparedBundleInput, requestText, type WP2PlatformFixture,
} from '../helpers/WP2-platform-support.js';
import { moveKernelAside, restoreKernel } from '../helpers/A2-restart-fixture.js';

const GOAL: GoalRef = { aggregateType: 'Goal', projectId: 'r4c-claim-project', goalId: 'r4c-claim-goal' };

const fixtures: WP2PlatformFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });
async function open(options: Parameters<typeof createWP2Platform>[0]): Promise<WP2PlatformFixture> {
  const fixture = await createWP2Platform(options);
  fixtures.push(fixture);
  return fixture;
}

/**
 * Spec §5.2 line 308/§8.5: a READING stage makes no new commit and calls no
 * scripted model. The production `commitObserver` log and BOTH scripted model
 * counters are the independent observation.
 */
async function quietRead<T>(f: WP2PlatformFixture, read: () => Promise<T>): Promise<T> {
  const commitsBefore = f.commits().length;
  const callsBefore = f.scripted.calls();
  const queryCallsBefore = f.queryScripted.calls();
  const value = await read();
  expect(f.commits().length).toBe(commitsBefore);
  expect(f.scripted.calls()).toBe(callsBefore);
  expect(f.queryScripted.calls()).toBe(queryCallsBefore);
  return value;
}

/**
 * The reply command's own committed response identity (the approved full-commit
 * observation seam): the replied body ref, respondedAt and the commit cursor.
 * Never a readback of the record under test.
 */
function responseIdentityOf(f: WP2PlatformFixture, messageId: string):
  { cursor: string; responseRef: { kind: string; digest: string }; respondedAt: string } | null {
  const types = ['SessionMessageResponded', 'SessionMessageDecisionAnswered'];
  const commit = f.preparedCommits().find(entry => entry.events.some(event =>
    types.includes(event.eventType)
    && (JSON.parse(event.json) as { message?: { ref?: { messageId?: string } } }).message?.ref?.messageId === messageId));
  if (commit === undefined) return null;
  const event = commit.events.find(candidate => types.includes(candidate.eventType))!;
  const parsed = JSON.parse(event.json) as
    { message?: { response?: { bodyRef?: { kind: string; digest: string }; respondedAt?: string } } };
  const responseRef = parsed.message?.response?.bodyRef;
  const respondedAt = parsed.message?.response?.respondedAt;
  if (responseRef === undefined || respondedAt === undefined) return null;
  return { cursor: commit.cursor, responseRef, respondedAt };
}

/**
 * The real E3 reply world: S enters and sends an inquiry to D through its
 * entered Run (the scripted model's tool group drives the owner); D enters and
 * saves a reply through its entered Run. Every write is the production owner's;
 * the commit log is the composition's own `commitObserver` seam.
 */
async function openReplyWorld(label: string, options: Parameters<typeof createWP2Platform>[0] = {}) {
  let action: (() => Promise<void>) | null = null;
  const f = await open({
    duty: 'secretary', secondWorld: true, ownedHost: true,
    scriptedReplies: [{ kind: 'text', text: `${label} sender done` }, { kind: 'text', text: `${label} replier done` }],
    beforeReply: async () => { const run = action; action = null; if (run !== null) await run(); },
    ...options,
  });
  const readPage = async (limit: number) => {
    // §5.2 line 308/§8.5: a notices read makes no commit and calls no model.
    const commitsBefore = f.commits().length;
    const callsBefore = f.scripted.calls();
    const queryCallsBefore = f.queryScripted.calls();
    const page = await f.platform.decisions.queryDecisionQueue(f.ctx, { workspace: f.scope,
      sections: ['notices'], categories: ['undelivered_reply'], page: { limit } });
    expect(f.commits().length).toBe(commitsBefore);
    expect(f.scripted.calls()).toBe(callsBefore);
    expect(f.queryScripted.calls()).toBe(queryCallsBefore);
    if (page.status !== 'ready') throw new Error(`${label} notices: ${JSON.stringify(page)}`);
    return page.value;
  };
  const readNotices = async () => (await readPage(100)).notices;
  const sendInquiry = async (): Promise<SessionMessage> => {
    let sent: SessionMessage | null = null;
    const prepared = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.runRef!, requestId: `${label}-prepare-s` }));
    if (prepared.status !== 'ready') throw new Error(`${label} prepare S: ${JSON.stringify(prepared)}`);
    action = async () => {
      const result = await f.platform.messages.sendMessage(f.workCtx(), { input: { recipient: f.secondSessionRef!,
        text: `${label} which file?`, intent: 'inquiry', needsReply: true, waitAfterSend: false },
        meta: { requestId: `${label}-send`, expected: [] } });
      if (result.status !== 'committed') throw new Error(`${label} send: ${JSON.stringify(result)}`);
      sent = result.value;
    };
    await f.platform.runtime.startRun(f.ctx, { prepared: prepared.value, consumerId: `${label}-s`, requestId: `${label}-start-s` });
    return sent!;
  };
  const reply = async (message: SessionMessage): Promise<{ cursor: string; responded: SessionMessage }> => {
    let cursor: string | null = null;
    let responded: SessionMessage | null = null;
    const prepared = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.secondRunRef!, requestId: `${label}-prepare-d` }));
    if (prepared.status !== 'ready') throw new Error(`${label} prepare D: ${JSON.stringify(prepared)}`);
    action = async () => {
      const replied = await f.platform.messages.respondMessage(f.secondWorkCtx(), { input: { messageRef: message.ref,
        text: `${label} use result.txt` },
        meta: { requestId: `${label}-reply`, expected: [{ ref: message.ref, revision: message.revision }] } });
      if (replied.status !== 'committed') throw new Error(`${label} reply: ${JSON.stringify(replied)}`);
      cursor = String(replied.cursor);
      responded = replied.value;
    };
    await f.platform.runtime.startRun(f.ctx, { prepared: prepared.value, consumerId: `${label}-d`, requestId: `${label}-start-d` });
    return { cursor: cursor!, responded: responded! };
  };
  /** Record the real health observation and return the commit-log cursor of the
   * one new Session-record commit (the spec's independent R source). A
   * `missing` Kernel is reached by moving the real database aside and probing
   * it; the mapped database is restored before the next Kernel step. */
  const recordHealth = async (verdict: 'missing' | 'ready'): Promise<string> => {
    const before = f.commits().length;
    const aside = verdict === 'missing' ? await moveKernelAside(f.directory) : null;
    try {
      const card = await f.platform.sessions.readSession(f.ctx, f.sessionRef);
      if (card.status !== 'ready') throw new Error(`${label} health Session read: ${JSON.stringify(card)}`);
      const probe = await f.platform.reconcile.probe(card.value.record, f.ctx.signal);
      const observed = await f.platform.reconcile.recordSessionHealth(f.ctx, { sessionRef: f.sessionRef, probe });
      if ((observed as { status?: string }).status === 'rejected') throw new Error(`${label} health: ${JSON.stringify(observed)}`);
    } finally {
      if (aside !== null) await restoreKernel(f.directory, aside);
    }
    const healthCommits = f.commits().slice(before)
      .filter(notice => notice.aggregates.some(aggregate => aggregate.aggregateType === 'Session'));
    if (healthCommits.length !== 1) throw new Error(`${label} health commits: ${JSON.stringify(f.commits().slice(before))}`);
    return String(healthCommits[0]!.cursor);
  };
  const markSeen = async (): Promise<void> => {
    const page = await readPage(1);
    if (page.notices.length === 0) throw new Error(`${label} has nothing to mark seen`);
    const workspaceRead = await f.platform.projects.readWorkspaceRegistration(f.ctx, f.scope);
    if (workspaceRead.status !== 'ready') throw new Error(`${label} workspace read failed`);
    const marked = await f.platform.workspaceDecisionSettings.markNoticesSeen(f.ctx, {
      input: { workspace: f.scope, displayToken: page.displayToken!, seenThrough: page.seenThrough },
      meta: { requestId: `${label}-seen`, expected: [{ ref: workspaceRead.value.workspace.ref, revision: workspaceRead.value.workspace.revision }] },
    });
    if (marked.status !== 'committed') throw new Error(`${label} mark seen: ${JSON.stringify(marked)}`);
  };
  return { f, readNotices, sendInquiry, reply, recordHealth, markSeen };
}

/** A real second RoleSpec revision, activated through the delivered writers, so
 * the Session's fixed pin no longer matches the active role facts. */
async function activateSecondRoleRevision(f: WP2PlatformFixture): Promise<void> {
  const content: RoleSpecContentV1 = {
    schemaVersion: 1, platformDuty: 'secretary', label: 'WP2 platform role', purpose: 'WP2_PLATFORM_DUTY_PIN',
    responsibility: ['human_decision_support'],
    requiredMaterials: [{ kind: 'contract', reason: 'Read the assigned Plan/Task' }],
    optionalMaterials: [], permissions: { tools: ['read'], writeScope: 'none' },
    budget: { source: 'task-budget', scope: 'assigned-task' },
    requiredOutputs: [{ kind: 'answer-with-sources', reason: 'Report the actual result' }],
    exit: { success: 'Report result', stop: 'Stop on missing permission', handoff: 'Keep references' },
  };
  const installed = await f.platform.roles.installRoleSpec(f.ctx, {
    commandId: 'wp2-install-role-2', commandType: 'InstallRoleSpecRevision', schemaVersion: 1,
    correlationId: 'wp2-role-2', submittedAt: '2026-09-26T00:00:00.000Z',
    identity: { projectId: f.scope.projectId, actor: { kind: 'human', id: 'r4c-claim-operator' }, idempotencyKey: 'wp2-install-role-2' },
    payload: { roleId: 'builder', revision: 2, content, contentDigest: roleSpecContentDigest(content, 'builder', 2) },
  });
  if (installed.status !== 'committed') throw new Error(`WP2 role revision 2 install: ${JSON.stringify(installed)}`);
  const activated = await f.platform.roles.activateRoleSpec(f.ctx, {
    commandId: 'wp2-activate-role-2', commandType: 'ActivateRoleSpecRevision', schemaVersion: 1,
    correlationId: 'wp2-role-2', submittedAt: '2026-09-26T00:00:00.000Z',
    identity: { projectId: f.scope.projectId, actor: { kind: 'human', id: 'r4c-claim-operator' }, idempotencyKey: 'wp2-activate-role-2' },
    aggregateId: 'builder', expectedRevision: 1, payload: { target: { ref: installed.revisionRef, digest: installed.contentDigest } },
  });
  if (activated.status !== 'committed') throw new Error(`WP2 role revision 2 activate: ${JSON.stringify(activated)}`);
}

it('F01 a real entered secretary Run calling send_user_message commits and leaves exactly one waiting decision card', async () => {
  const f = await open({
    duty: 'secretary',
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 'f01-send', name: 'send_user_message',
        args: decisionRequestArgs(GOAL, { text: '需要你决定：现在继续吗？',
          options: [{ id: 'continue', label: '继续', effect: 'apply' }, { id: 'stop', label: '停止', effect: 'reject' }] }) }] },
      { kind: 'text', text: 'F01 asked the user to decide' },
    ],
  });
  const prepared = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.runRef!, requestId: 'f01-prepare' }));
  expect(prepared.status).toBe('ready');
  if (prepared.status !== 'ready') return;
  const started = await f.platform.runtime.startRun(f.ctx, {
    prepared: prepared.value, consumerId: 'f01-driver', requestId: 'f01-start',
  });
  expect(started).toMatchObject({ status: 'ready' });
  expect(f.scripted.calls()).toBe(2);

  const queue = await quietRead(f, () => f.platform.decisions.queryDecisionQueue(f.ctx, {
    workspace: f.scope, goalRef: f.goalRef, sections: ['waiting_answer'], page: { limit: 100 },
  }));
  expect(queue.status).toBe('ready');
  if (queue.status !== 'ready') return;
  expect(queue.value.waitingAnswer).toHaveLength(1);
  const card = queue.value.waitingAnswer[0]!;
  expect(card.source.kind).toBe('message');
  expect(card.state).toBe('waiting_answer');
  expect(card.options).toEqual([
    { id: 'continue', label: '继续', effect: 'apply' },
    { id: 'stop', label: '停止', effect: 'reject' },
  ]);
});

it('F02 an executor and an ordinary reviewer Run may notify but a decision request is refused and leaves no card', async () => {
  for (const duty of ['executor', 'reviewer'] as const) {
    const f = await open({
      duty,
      scriptedReplies: [
        { kind: 'calls', calls: [
          { callId: `${duty}-notify`, name: 'send_user_message',
            args: decisionRequestArgs(GOAL, { intent: 'notify', text: '请知悉：工作已推进' }) },
          { callId: `${duty}-decide`, name: 'send_user_message',
            args: decisionRequestArgs(GOAL, { intent: 'decision_request', text: '请你决定：继续吗' }) },
        ] },
        { kind: 'text', text: `${duty} finished the tool group` },
      ],
    });
    const prepared = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.runRef!, requestId: `${duty}-prepare` }));
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') return;
    expect(await f.platform.runtime.startRun(f.ctx, {
      prepared: prepared.value, consumerId: `${duty}-driver`, requestId: `${duty}-start`,
    })).toMatchObject({ status: 'ready' });

    const toolResults = f.scripted.requests.flatMap(request => request.messages
      .flatMap(message => message.role === 'tool' ? [{ callId: message.callId, result: message.result }] : []));
    const notifyResult = toolResults.find(entry => entry.callId === `${duty}-notify`)?.result;
    const decideResult = toolResults.find(entry => entry.callId === `${duty}-decide`)?.result;
    // The permitted notify really committed; the refused decision did not.
    expect(notifyResult).toMatchObject({ status: 'success' });
    if (notifyResult?.status !== 'success') return;
    expect(notifyResult.output[0]).toMatchObject({ kind: 'json', value: { waiting: false, message: { status: 'pending', intent: 'notify' } } });
    expect(decideResult).toMatchObject({ status: 'error', error: { code: 'execution_failed' } });
    if (decideResult?.status !== 'error') return;
    expect(decideResult.output[0]).toMatchObject({ kind: 'json', value: { status: 'rejected', code: 'forbidden' } });

    const queue = await quietRead(f, () => f.platform.decisions.queryDecisionQueue(f.ctx, {
      workspace: f.scope, goalRef: f.goalRef, sections: ['waiting_answer'], page: { limit: 100 },
    }));
    expect(queue.status).toBe('ready');
    if (queue.status !== 'ready') return;
    expect(queue.value.waitingAnswer).toEqual([]);
  }
});

it('F03 a read-only copy Session is refused at the real claim admission and produces no decision card', async () => {
  const f = await open({
    duty: 'secretary',
    provenanceKind: 'readonly_copy',
    skipClaim: true,
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 'f03-send', name: 'send_user_message',
        args: decisionRequestArgs(GOAL, { text: '只读副本不该发信' }) }] },
      { kind: 'text', text: 'F03 finished' },
    ],
  });
  // The real earlier admission refuses the ordinary claim; no Run ever enters,
  // so the scripted model is never called.
  const claimed = await f.platform.claims.claimTask(f.ctx, f.claimRequest);
  expect(claimed).toMatchObject({ status: 'rejected', code: 'forbidden' });
  expect(f.scripted.calls()).toBe(0);
  const queue = await quietRead(f, () => f.platform.decisions.queryDecisionQueue(f.ctx, {
    workspace: f.scope, goalRef: f.goalRef, sections: ['waiting_answer'], page: { limit: 100 },
  }));
  expect(queue).toMatchObject({ status: 'ready', value: { waitingAnswer: [] } });
});

it('F04 after a successful tool request, broken role facts refuse the next request, the original request identity replays, and the card count is unchanged', async () => {
  const originalArgs = decisionRequestArgs(GOAL, { text: '原始请求' });
  const f = await open({
    duty: 'secretary',
    secondWorld: true,
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 'f04-original', name: 'send_user_message', args: originalArgs }] },
      { kind: 'text', text: 'F04 original done' },
      { kind: 'text', text: 'F04 second world should never run' },
    ],
  });
  // The scripted model really calls the tool inside an entered Run (F01 setup).
  const prepared1 = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.runRef!, requestId: 'f04-prepare' }));
  expect(prepared1.status).toBe('ready');
  if (prepared1.status !== 'ready') return;
  expect(await f.platform.runtime.startRun(f.ctx, {
    prepared: prepared1.value, consumerId: 'f04-driver', requestId: 'f04-start',
  })).toMatchObject({ status: 'ready' });
  const results = f.scripted.requests.flatMap(request => request.messages
    .flatMap(message => message.role === 'tool' ? [{ callId: message.callId, result: message.result }] : []));
  const original = results.find(entry => entry.callId === 'f04-original')?.result;
  expect(original).toMatchObject({ status: 'success' });
  if (original?.status !== 'success') return;
  const originalValue = original.output[0];
  expect(originalValue).toMatchObject({ kind: 'json', value: { message: { status: 'pending', revision: 1 } } });
  if (originalValue?.kind !== 'json') return;
  const message = (originalValue.value as { message: SessionMessage }).message;

  // The active role facts now disagree with the Sessions' fixed pin.
  await activateSecondRoleRevision(f);

  // A NEW request on the other Run is refused at the real admission, before any model call.
  const prepared2 = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.secondRunRef!, requestId: 'f04-prepare-2' }));
  const second = prepared2.status === 'ready'
    ? await f.platform.runtime.startRun(f.ctx, { prepared: prepared2.value, consumerId: 'f04-driver-2', requestId: 'f04-start-2' })
    : prepared2;
  expect(second).toMatchObject({ status: 'rejected', code: 'forbidden' });
  expect(f.scripted.calls()).toBe(2);

  // F04 audit fix: the ORIGINAL request id is observed independently from the
  // first command's own committed event (the approved full-commit observation
  // seam), never recomputed with the production algorithm.
  const requestCommits = f.preparedCommits().filter(commit => commit.events.some(event =>
    event.eventType === 'SessionMessageSent'
    && (JSON.parse(event.json) as { message?: { ref?: { messageId?: string } } }).message?.ref?.messageId === message.ref.messageId));
  expect(requestCommits).toHaveLength(1);
  const originalRequestId = (JSON.parse(requestCommits[0]!.events.find(event =>
    event.eventType === 'SessionMessageSent')!.json) as { requestId?: string }).requestId;
  expect(typeof originalRequestId).toBe('string');
  if (originalRequestId === undefined) return;
  const reissued = await f.platform.decisionMessages.sendUserMessage(f.workCtx(), {
    input: originalArgs as never, meta: { requestId: originalRequestId, expected: [] } });
  expect(reissued).toMatchObject({ status: 'committed', replayed: true });
  expect((reissued as { value: SessionMessage }).value).toEqual(message);

  // The original result is unchanged: the same one pending message and one card.
  const reread = await quietRead(f, () => f.platform.messages.readMessage(f.ctx, message.ref));
  expect(reread).toMatchObject({ status: 'ready', value: { revision: 1, status: 'pending' } });
  const queue = await quietRead(f, () => f.platform.decisions.queryDecisionQueue(f.ctx, {
    workspace: f.scope, goalRef: f.goalRef, sections: ['waiting_answer'], page: { limit: 100 },
  }));
  expect(queue).toMatchObject({ status: 'ready', value: { waitingAnswer: [expect.objectContaining({ state: 'waiting_answer' })] } });
  if (queue.status !== 'ready') return;
  expect(queue.value.waitingAnswer).toHaveLength(1);
});

it('F05 a changed autonomy level reaches the new prepared context while the already-bound input does not move', async () => {
  const f = await open({ duty: 'secretary', allowAnyRun: true, scriptedReplies: [{ kind: 'text', text: 'F05 bound run done' }] });
  const request = { goalRef: f.goalRef, focusTaskIds: [] as string[] };
  const beforeRead = await f.platform.goalSettings.readGoalSettings(f.ctx, { goalRef: f.goalRef });
  expect(beforeRead).toMatchObject({ status: 'ready', value: { settings: { autonomy: 'after_plan_confirmation' } } });
  if (beforeRead.status !== 'ready') return;
  const before = await quietRead(f, () => f.platform.graphContext.readContextFacts(f.ctx, request));
  expect(before).toMatchObject({ status: 'ready', value: { extensions: { goalSettings: { availability: 'available', autonomy: 'after_plan_confirmation' } } } });
  if (before.status !== 'ready') return;

  // E2 (§5.2 F05): prepare while the autonomy is still the old value, read the
  // saved manifest body, then START it to bind the input. The stage is observed
  // (no new commit, no scripted model call).
  const { prepared, input: firstInput } = await preparedBundle(f, f.runRef!, 'f05-prepare');
  expect(firstInput).toContain('autonomy: after_plan_confirmation');
  const started = await f.platform.runtime.startRun(f.ctx, { prepared,
    consumerId: 'f05-driver', requestId: 'f05-start' });
  expect(started).toMatchObject({ status: 'ready' });

  const changed = await f.platform.goalSettings.setGoalSettings(f.ctx, {
    input: { goalRef: f.goalRef, autonomy: 'every_step', waitForGoalRef: null },
    meta: { requestId: 'f05-set-every-step', expected: [{ ref: f.goalRef, revision: beforeRead.value.goal.revision }] },
  });
  expect(changed).toMatchObject({ status: 'committed' });

  // The already-bound execution keeps the ORIGINAL prepared input: its stored
  // envelope still names the bundle assembled under the old autonomy.
  const record = await f.platform.executions.readExecution(f.ctx, f.runRef!);
  expect(record).toMatchObject({ status: 'ready' });
  if (record.status !== 'ready') return;
  const boundRef = record.value.run.envelope?.bundleRef ?? prepared.envelope.bundleRef;
  // §5.2 line 308/§8.5: reading the already-bound saved input commits nothing
  // and calls neither model.
  const bound = await observeStage(f, () => f.platform.materials.openArtifact(f.workCtx(),
    { ref: boundRef, usage: 'historical_explanation' }));
  if (bound.status !== 'ready') throw new Error(`F05 bound bundle: ${JSON.stringify(bound)}`);
  const boundText = (JSON.parse(bound.value.body) as { input: string }).input;
  expect(boundText).toContain('autonomy: after_plan_confirmation');
  expect(boundText).not.toContain('autonomy: every_step');

  // F05 audit fix: after the change, prepare a NEW, still-unbound Run through
  // the public claim owner and assert the NEW prepared input carries the new
  // level. The already-bound input above stays as it was.
  const primaryCard = await f.platform.sessions.readSession(f.ctx, f.sessionRef);
  if (primaryCard.status !== 'ready') throw new Error(`F05 primary Session: ${JSON.stringify(primaryCard)}`);
  const successorSession = await f.platform.runtime.createSession(f.ctx, { workspace: f.scope,
    role: primaryCard.value.record.role, recommendedRefs: [], initialLinks: [],
    meta: { requestId: 'f05-successor-session', expected: [] } });
  expect(successorSession).toMatchObject({ status: 'completed' });
  if (successorSession.status !== 'completed') return;
  const successorRef: SessionRef = { projectId: successorSession.value.ref.projectId, sessionId: successorSession.value.ref.sessionId };
  const successorRun = await claimSuccessorRun(f, f.goalRef, 'implement-b', successorRef, 'f05-claim-successor');
  const newInput = await preparedBundleInput(f, successorRun, 'f05-next');
  expect(newInput).toContain('autonomy: every_step');
  expect(newInput).not.toContain('autonomy: after_plan_confirmation');

  const after = await quietRead(f, () => f.platform.graphContext.readContextFacts(f.ctx, request));
  expect(after).toMatchObject({ status: 'ready', value: { extensions: { goalSettings: { availability: 'available', autonomy: 'every_step' } } } });
  if (after.status !== 'ready') return;
  // §0.3: the Goal-record content is exactly the same binding before and after;
  // only the rendered autonomy changed.
  const goalDigest = (sources: typeof after.value.sources) => sources.find(
    (source): source is Extract<typeof source, { kind: 'record' }> => source.kind === 'record'
      && (source.ref as { aggregateType?: string }).aggregateType === 'Goal')?.digest;
  expect(goalDigest(after.value.sources)).toBe(goalDigest(before.value.sources));
  expect(goalDigest(after.value.sources)).toBeDefined();
});

it('F06 a waiting decision card becomes a decision reminder row, disappears after the answer, and missing card sources get hint rows', async () => {
  let f!: WP2PlatformFixture;
  const captured = { message: null as SessionMessage | null };
  f = await open({
    duty: 'secretary',
    allowAnyRun: true,
    scriptedReplies: [{ kind: 'text', text: 'F06 sent the question' }],
    beforeReply: async () => {
      const sent = await f.platform.decisionMessages.sendUserMessage(f.workCtx(), {
        input: { goalRef: f.goalRef, intent: 'decision_request', text: '请你决定：是否继续',
          needsReply: true, waitAfterSend: false,
          options: [{ id: 'continue', label: '继续', effect: 'apply' }, { id: 'stop', label: '停止', effect: 'reject' }],
          objects: [] },
        meta: { requestId: 'f06-question', expected: [] },
      });
      if (sent.status === 'committed') captured.message = sent.value;
    },
  });
  const prepared = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.runRef!, requestId: 'f06-prepare' }));
  expect(prepared.status).toBe('ready');
  if (prepared.status !== 'ready') return;
  await f.platform.runtime.startRun(f.ctx, { prepared: prepared.value, consumerId: 'f06-driver', requestId: 'f06-start' });
  expect(captured.message).not.toBeNull();
  if (captured.message === null) return;

  // The real prepared reminder input of the NEXT execution (a real successor
  // Run for implement-b, claimed but not started) carries the card row and the
  // missing-source hint rows.
  const sourceCard = await f.platform.sessions.readSession(f.ctx, f.sessionRef);
  if (sourceCard.status !== 'ready') throw new Error(`F06 source Session: ${JSON.stringify(sourceCard)}`);
  const successorSession = await f.platform.runtime.createSession(f.ctx, { workspace: f.scope,
    role: sourceCard.value.record.role, recommendedRefs: [], initialLinks: [],
    meta: { requestId: 'f06-successor-session', expected: [] } });
  expect(successorSession).toMatchObject({ status: 'completed' });
  if (successorSession.status !== 'completed') return;
  const successorRef: SessionRef = { projectId: successorSession.value.ref.projectId, sessionId: successorSession.value.ref.sessionId };
  const successorRun = await claimSuccessorRun(f, f.goalRef, 'implement-b', successorRef, 'f06-claim-successor');
  const preparedInput = async (requestId: string) => preparedBundleInput(f, successorRun, requestId);

  const queue = await quietRead(f, () => f.platform.decisions.queryDecisionQueue(f.ctx, {
    workspace: f.scope, goalRef: f.goalRef, sections: ['waiting_answer'], page: { limit: 100 },
  }));
  expect(queue.status).toBe('ready');
  if (queue.status !== 'ready') return;
  const card = queue.value.waitingAnswer.find(candidate => candidate.source.kind === 'message');
  expect(card).toBeDefined();
  if (card === undefined) return;
  const cardRowText = JSON.stringify(`待决定：message；source=${card.source.key}`).slice(1, -1);
  const beforeAnswer = await preparedInput('f06-next-before');
  expect(beforeAnswer).toContain(cardRowText);
  // 4C-2 wiring: the note_review card source is registered, so its capability is
  // available and the "尚未接入" hint row is gone; message_release keeps its row.
  expect(beforeAnswer).not.toContain(JSON.stringify('待决来源尚未接入：note_review').slice(1, -1));

  const answered = await f.platform.decisionMessages.answerDecision(f.ctx, {
    input: { source: card.source, selection: { kind: 'option', optionId: 'continue' }, text: '继续', annotations: [] },
    meta: { requestId: 'f06-answer', expected: [...card.source.pins, { ref: captured.message.ref, revision: captured.message.revision }] },
  });
  expect(answered).toMatchObject({ status: 'committed' });

  const afterAnswer = await preparedInput('f06-next-after');
  expect(afterAnswer).not.toContain(cardRowText);
});

it('F06 [budget] a real continuation is kept whole while reminder rows that do not fit are cut from the E2 prepared input', async () => {
  // A real failed attempt, then the real requeue writer makes the next Run a
  // continuation; under the constrained resident budget the continuation brief
  // and the required sections stay whole and the reminder rows are cut.
  const f = await open({ duty: 'secretary', allowAnyRun: true, ownedHost: true, contextResidentBytes: 0,
    scriptedReplies: [{ kind: 'text', text: 'F06 budget crashed attempt' }],
    beforeReply: async () => { throw new Error('F06 budget first attempt fails'); } });
  const { prepared, input: crashedInput } = await preparedBundle(f, f.runRef!, 'f06-budget-prepare');
  // The crashed attempt itself carries no continuation brief.
  expect(crashedInput).not.toContain('## 接续说明');
  const started = await f.platform.runtime.startRun(f.ctx, { prepared,
    consumerId: 'f06-budget-driver', requestId: 'f06-budget-start' });
  expect(started.status).toBe('ready');
  const crashed = await f.platform.executions.readExecution(f.ctx, f.runRef!);
  if (crashed.status !== 'ready') throw new Error(`F06 budget record: ${JSON.stringify(crashed)}`);
  expect(crashed.value.run).toMatchObject({ status: 'ended', outcome: 'crashed' });

  const goal = await f.platform.plans.queryGoal(f.ctx, f.goalRef);
  if (goal.status !== 'ready') throw new Error(`F06 budget goal: ${JSON.stringify(goal)}`);
  const requeueTask = f.platform.claims.requeueTask;
  if (requeueTask === undefined) throw new Error('the platform does not expose the requeue owner');
  const requeued = await requeueTask.call(f.platform.claims, f.ctx, {
    input: { taskRef: crashed.value.outbox.claim.task, afterRunRef: f.runRef!,
      reason: 'F06 budget retry', newInputRefs: [] },
    meta: { requestId: 'f06-budget-requeue', expected: [{ ref: f.goalRef, revision: goal.value.goal.revision },
      { ref: f.runRef!, revision: crashed.value.run.revision }] },
  });
  expect(requeued).toMatchObject({ status: 'committed' });
  if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') {
    throw new Error(`F06 budget requeue: ${JSON.stringify(requeued)}`);
  }
  const continuationRun = await claimSuccessorRun(f, f.goalRef, 'implement-a', f.sessionRef,
    'f06-budget-claim', f.fixture.planRef, requeued.value.requeue.ref);

  const input = await preparedBundleInput(f, continuationRun, 'f06-budget-next');
  // §5.2 F06/§4.3.6: the required sections are whole, including the real brief.
  expect(input).toContain('## Role');
  expect(input).toContain('## Goal');
  expect(input).toContain('## Accepted task');
  expect(input).toContain('instruction: Implement A');
  // The FULL continuation brief is present, asserted through its tail: the
  // title, the digest marker, the requeue section with the creating command's
  // own literal reason, and the fixed standing-instruction block's last line.
  // A truncated continuation brief would miss that final line.
  expect(input).toContain('## 接续说明');
  expect(input).toContain('[continuation-brief v1 sha256:');
  expect(input).toContain('### 重新入队');
  expect(input).toContain('- 原因（人工）：F06 budget retry');
  expect(input).toContain('- 没有新输入。');
  expect(input).toContain('### 继续之前');
  expect(input.endsWith('- 本说明只陈述持久记录中的事实；写明“无法确定”的地方不代表没有变化。')).toBe(true);
  // The reminder rows did not fit. Because even the k=0 marker structure exceeds
  // the zero-byte resident budget, EVERY non-empty optional section is reported
  // once on the required card (`<sectionName>: 另有 N 条，用‘看’读`,
  // context-assembler.ts:226-246) and no hint row is half rendered. The complete
  // omitted-row outcome is exactly this one literal line.
  const omissionHeader = '## Context omissions\n';
  const omissionEnd = input.indexOf('\n\n## 接续说明');
  expect(omissionEnd).toBeGreaterThan(input.indexOf(omissionHeader));
  // HAND COUNT after 4C-2 B and L8: the note_review missing-source hint no longer
  // exists (its source is registered/available), the message_release missing-source
  // hint still counts 1, the goal-understanding update-due reminder still counts 1,
  // and the new architecture reminder section contributes 1 `还没有观测` row
  // (no successful observation in this preparation):
  // 0 + 1 + 1 + 1 = 3 omitted reminder rows.
  expect(input.slice(input.indexOf(omissionHeader) + omissionHeader.length, omissionEnd))
    .toBe('reminders: 另有 3 条，用‘看’读');
  expect(input).not.toContain('待决来源尚未接入：note_review');
});

it('F07 a focus task keeps the real Task-linked goal_cause card and another focus excludes it', async () => {
  const f = await open({ duty: 'secretary', skipClaim: true, deferredGoal: true, allowAnyRun: true, scriptedReplies: [] });
  const goalRef = f.deferredGoalRef;
  if (goalRef === null) throw new Error('F07 needs the deferred-required-work Goal');
  const read = (focusTaskIds: string[]) => quietRead(f, () =>
    f.platform.graphContext.readContextFacts(f.ctx, { goalRef, focusTaskIds }));

  // The product's goal-decision reader prepared the real Task-linked card from
  // the Goal's `required_task_deferred` cause. The expected identity is a
  // LITERAL fixture value written here (the Goal/Task/cause the fixture's own
  // Plan writers create), never the returned card: a change to the reader must
  // fail this test. Task-linked cards also come from the unknown-outcome, stop,
  // rework and automation-confirmation causes
  // (`src/core/work-graph/tasks/goal-decision-reader.ts`), and no preparable
  // claim for the same Task coexists with them in the paths checked; the
  // assembled-input half of F07 stays an accepted documented omission.
  const DEFERRED_CAUSE_KEY = '{"affected":[{"ref":{"aggregateType":"Task","goalId":"wp2-deferred-goal",'
    + '"projectId":"r4c-claim-project","taskId":"wp2-deferred-work"},"revision":0}],'
    + '"code":"required_task_deferred","goalRef":{"aggregateType":"Goal","goalId":"wp2-deferred-goal",'
    + '"projectId":"r4c-claim-project"},"kind":"goal_cause"}';
  const queue = await quietRead(f, () => f.platform.decisions.queryDecisionQueue(f.ctx, {
    workspace: f.scope, goalRef, sections: ['waiting_answer'], page: { limit: 100 } }));
  expect(queue.status).toBe('ready');
  if (queue.status !== 'ready') return;
  const card = queue.value.waitingAnswer.find(candidate => candidate.cardKey === DEFERRED_CAUSE_KEY);
  expect(card).toBeDefined();
  if (card === undefined) return;
  // The card's own identity is the literal cause key; the Task pin is the
  // formal association (revision 0, never a persistent aggregate).
  expect(card.source.kind).toBe('goal_cause');
  expect(card.cardKey).toBe(card.source.key);
  expect(card.source.key).toBe(DEFERRED_CAUSE_KEY);
  const taskPinOf = (pin: { ref: unknown }) => pin.ref as { aggregateType?: string; taskId?: string };
  expect(card.source.pins.map(taskPinOf).some(ref => ref.aggregateType === 'Task'
    && ref.taskId === 'wp2-deferred-work')).toBe(true);

  // §4.3.4 L5 literal: `待决定：<source.kind>；source=<source.key>`. A focus that
  // names the card's Task keeps it, another focus excludes it, and the empty
  // focus keeps every Goal card. Key and text are the literals above.
  const rowOf = (rows: readonly { key: string; text: string }[]) =>
    rows.find(row => row.key === `decision:${DEFERRED_CAUSE_KEY}`);
  const focused = await read(['wp2-deferred-work']);
  expect(focused).toMatchObject({ status: 'ready', value: { extensions: { decisions: { availability: 'available' } } } });
  if (focused.status !== 'ready') return;
  expect(rowOf(focused.value.extensions.decisions.rows)).toMatchObject({
    text: `待决定：goal_cause；source=${DEFERRED_CAUSE_KEY}` });

  const other = await read(['implement-b']);
  expect(other).toMatchObject({ status: 'ready' });
  if (other.status !== 'ready') return;
  expect(rowOf(other.value.extensions.decisions.rows)).toBeUndefined();

  const all = await read([]);
  expect(all).toMatchObject({ status: 'ready' });
  if (all.status !== 'ready') return;
  expect(rowOf(all.value.extensions.decisions.rows)).toMatchObject({
    text: `待决定：goal_cause；source=${DEFERRED_CAUSE_KEY}` });
});

it('F08 real Work preparation carries the installed extensions in the bound scope, Query preparation stays copy/planning, and a foreign scope is refused', async () => {
  let action: (() => Promise<void>) | null = null;
  let sent: SessionMessage | null = null;
  const runtimeBudget: RuntimeBudget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
    maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };
  const f = await open({ duty: 'secretary', ownedHost: true,
    scriptedReplies: [{ kind: 'text', text: 'F08 work done' }],
    queryReplies: [{ kind: 'text', text: 'F08 query answer' }],
    beforeReply: async () => { const run = action; action = null; if (run !== null) await run(); } });

  // Real Work preparation: the saved bundle body is the exact assembled input.
  const prepared = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.runRef!, requestId: 'f08-work-prepare' }));
  expect(prepared.status).toBe('ready');
  if (prepared.status !== 'ready') return;
  const bundle = await observeStage(f, () => f.platform.materials.openArtifact(f.workCtx(),
    { ref: prepared.value.envelope.bundleRef, usage: 'historical_explanation' }));
  if (bundle.status !== 'ready') throw new Error(`F08 bundle: ${JSON.stringify(bundle)}`);
  expect(bundle).toMatchObject({ status: 'ready' });
  if (bundle.status !== 'ready') return;
  const workInput = (JSON.parse(bundle.value.body) as { input: string }).input;
  expect(workInput).toContain('## Goal');
  expect(workInput).toContain('## Accepted task');
  // The installed decisions extension really reached the prepared input.
  // 4C-2 wiring: the note_review source is now registered, so it is available
  // and no "尚未接入" hint row is emitted for it.
  expect(workInput).not.toContain('待决来源尚未接入：note_review');

  // Real Query preparation through the public consultation: the Query host's
  // assembled context stays copy/planning and never adds the decision rows.
  const sourceSession = await f.platform.sessions.readSession(f.ctx, f.sessionRef);
  if (sourceSession.status !== 'ready') throw new Error(`F08 source Session: ${JSON.stringify(sourceSession)}`);
  const recipient = await f.platform.runtime.createSession(f.ctx, {
    workspace: f.scope, role: sourceSession.value.record.role, recommendedRefs: [], initialLinks: [],
    meta: { requestId: 'f08-query-recipient', expected: [] } });
  expect(recipient).toMatchObject({ status: 'completed' });
  if (recipient.status !== 'completed') return;
  const recipientRef: SessionRef = { projectId: recipient.value.ref.projectId, sessionId: recipient.value.ref.sessionId };
  const preparedS = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.runRef!, requestId: 'f08-question-prepare' }));
  if (preparedS.status !== 'ready') throw new Error(`F08 question prepare: ${JSON.stringify(preparedS)}`);
  action = async () => {
    const result = await f.platform.messages.sendMessage(f.workCtx(), { input: { recipient: recipientRef,
      text: 'F08 which file?', intent: 'inquiry', needsReply: true, waitAfterSend: false },
      meta: { requestId: 'f08-send', expected: [] } });
    if (result.status !== 'committed') throw new Error(`F08 send: ${JSON.stringify(result)}`);
    sent = result.value;
  };
  await f.platform.runtime.startRun(f.ctx, { prepared: preparedS.value, consumerId: 'f08-s', requestId: 'f08-start-s' });
  const message = sent!;
  const consultation = await f.platform.workflow.consumeConsultation!(f.ctx, {
    schemaVersion: 1, messageRef: message.ref, goalRef: f.goalRef, roleBinding: f.roleBinding,
    runtimeBudget, budget: { maxTokens: 200000, deadline: null }, consumerId: 'wp2-f08-consumer' });
  expect(consultation).toMatchObject({ status: 'ready', value: { state: 'responded' } });
  expect(requestText(f.queryScripted)).not.toContain('待决来源尚未接入：note_review');
  // Query preparation commits its binding by design
  // (`src/core/agent-runtime/query-preparation.ts:390`), so the zero-commit /
  // zero-model bracket cannot wrap the whole Query operation. The bracket below
  // covers the read/assembly stage's SAVED input: opening the manifest the
  // preparation stored commits nothing and calls neither model. (The one Query
  // model call belongs to the Query turn, not to this read.)
  if (consultation.status !== 'ready') return;
  const preparedQuery = consultation.value.query?.run.run.executionState?.prepared ?? null;
  if (preparedQuery === null) throw new Error('the F08 consultation Query saved no prepared manifest');
  const savedQueryInput = await observeStage(f, async () => {
    const opened = await f.platform.materials.openArtifact(f.ctx, { ref: preparedQuery.bundleRef, usage: 'historical_explanation' });
    if (opened.status !== 'ready') throw new Error(`F08 Query manifest: ${JSON.stringify(opened)}`);
    return (JSON.parse(opened.value.body) as { input: string }).input;
  });
  // Spec line 240 / W2-C02 (spec line 208): Query stays copy/planning only, so
  // the assembled Query input has the literal copy/planning markers and NEVER a
  // reminder section or a decision hint row, even though the decisions
  // extension is installed and available (spec line 287).
  expect(savedQueryInput).toContain('# Verified read-only Query input');
  expect(savedQueryInput).toContain('## Runtime context');
  expect(savedQueryInput).toContain('## Goal');
  expect(savedQueryInput).toContain('## Question');
  expect(savedQueryInput).not.toContain('## Reminders');
  expect(savedQueryInput).not.toContain('## Context omissions');
  expect(savedQueryInput).not.toContain('待决来源尚未接入');

  // A foreign project is refused by the composition/scope guard before the new
  // read owners are reached; no seemingly-successful context is returned.
  const foreignProject = { aggregateType: 'Goal' as const, projectId: 'other-project', goalId: f.goalRef.goalId };
  expect(await quietRead(f, () => f.platform.graphContext.readContextFacts(f.ctx, { goalRef: foreignProject, focusTaskIds: [] })))
    .toMatchObject({ status: 'rejected', code: 'forbidden' });
  // A Goal that is not part of the bound scope is never served as a successful
  // context with the installed sources.
  const missingGoal = { ...f.goalRef, goalId: 'wp2-missing-goal' };
  expect(await quietRead(f, () => f.platform.graphContext.readContextFacts(f.ctx, { goalRef: missingGoal, focusTaskIds: [] })))
    .not.toMatchObject({ status: 'ready' });

  // F08 audit fix: an INSTALLED extension source whose read fails rejects the
  // whole E2 preparation; it is never turned into a successful empty context.
  // The fault is injected at the source boundary (the same production factory
  // the composition installs), and the spec prefixes are literal.
  for (const fault of [
    { options: { failGoalSettingsRead: true }, prefix: 'goal_settings_read_failed:' },
    { options: { failDecisionsRead: true }, prefix: 'decision_queue_read_failed:' },
  ] as const) {
    const broken = await open({ duty: 'secretary', ownedHost: true, ...fault.options });
    const rejected = await observeStage(broken, () => broken.platform.runtime.prepareExecution(broken.ctx, {
      runRef: broken.runRef!, requestId: `f08-fault-${fault.prefix}` }));
    expect(rejected).toMatchObject({ status: 'rejected', code: 'unavailable' });
    if (rejected.status !== 'rejected') continue;
    expect(rejected.reason.startsWith(fault.prefix)).toBe(true);
  }
});

it.each(['memory', 'sqlite'] as const)('F11 [%s] marking one displayed notice leaves the later same-cursor notice and a later reply unseen, before and after a reopen', async (kind) => {
  let action: (() => Promise<void>) | null = null;
  const sent: SessionMessage[] = [];
  let r: string | null = null;
  const f = await open({
    kind,
    duty: 'secretary',
    secondWorld: true,
    ownedHost: true,
    // The composition generates Run ids with randomUUID; pin the memory seed
    // claim through the fixture's deterministic id owner so the message ids (and
    // therefore the item-key order) are reproducible on both backends.
    deterministicClaimIds: true,
    scriptedReplies: [{ kind: 'text', text: `F11 ${kind} sender done` }, { kind: 'text', text: `F11 ${kind} replier done` }],
    beforeReply: async () => { const run = action; action = null; if (run !== null) await run(); },
  });
  const secondSession = f.secondSessionRef!;
  const workS = f.workCtx();
  const workD = f.secondWorkCtx();
  type CommittedReply = { value: SessionMessage; cursor: string };

  const send = async (label: string): Promise<SessionMessage> => {
    const result = await f.platform.messages.sendMessage(workS, { input: { recipient: secondSession,
      text: `F11 ${label}`, intent: 'inquiry', needsReply: true, waitAfterSend: false },
      meta: { requestId: `f11-${kind}-send-${label}`, expected: [] } });
    if (result.status !== 'committed') throw new Error(`F11 send ${label}: ${JSON.stringify(result)}`);
    sent.push(result.value);
    return result.value;
  };
  const reply = async (message: SessionMessage, label: string): Promise<CommittedReply> => {
    const result = await f.platform.messages.respondMessage(workD, { input: { messageRef: message.ref,
      text: `F11 reply ${label}` },
      meta: { requestId: `f11-${kind}-reply-${label}`, expected: [{ ref: message.ref, revision: message.revision }] } });
    if (result.status !== 'committed') throw new Error(`F11 reply ${label}: ${JSON.stringify(result)}`);
    return { value: result.value, cursor: String(result.cursor) };
  };

  const preparedS = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.runRef!, requestId: `f11-${kind}-prepare-s` }));
  if (preparedS.status !== 'ready') throw new Error(`F11 prepare S: ${JSON.stringify(preparedS)}`);
  action = async () => { await send('m1'); await send('m2'); await send('m3'); };
  await f.platform.runtime.startRun(f.ctx, { prepared: preparedS.value, consumerId: `f11-${kind}-s`, requestId: `f11-${kind}-start-s` });
  expect(sent).toHaveLength(3);

  let rep1!: CommittedReply; let rep2!: CommittedReply; let rep3!: CommittedReply;
  const preparedD = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.secondRunRef!, requestId: `f11-${kind}-prepare-d` }));
  if (preparedD.status !== 'ready') throw new Error(`F11 prepare D: ${JSON.stringify(preparedD)}`);
  action = async () => {
    // §5.2 F11 handwritten history: reply m1 and m2 first, then the ONE health
    // commit makes S unavailable (shared position R), then reply m3 (position P3).
    rep1 = await reply(sent[0]!, 'm1');
    rep2 = await reply(sent[1]!, 'm2');
    const before = f.commits().length;
    // F11's shared position R: the real health observation of an unreadable
    // Kernel. The mapped database is moved aside, probed, observed, and restored
    // before the next reply Turn (m3) reads or writes the Kernel.
    const aside = await moveKernelAside(f.directory);
    try {
      const card = await f.platform.sessions.readSession(f.ctx, f.sessionRef);
      if (card.status !== 'ready') throw new Error(`F11 health Session read: ${JSON.stringify(card)}`);
      const probe = await f.platform.reconcile.probe(card.value.record, f.ctx.signal);
      const observed = await f.platform.reconcile.recordSessionHealth(f.ctx, { sessionRef: f.sessionRef, probe });
      if ((observed as { status?: string }).status === 'rejected') throw new Error(`F11 health: ${JSON.stringify(observed)}`);
    } finally {
      await restoreKernel(f.directory, aside);
    }
    const healthCommits = f.commits().slice(before).filter(notice =>
      notice.aggregates.some(aggregate => aggregate.aggregateType === 'Session'));
    if (healthCommits.length !== 1) throw new Error(`F11 health commits: ${JSON.stringify(f.commits().slice(before))}`);
    r = String(healthCommits[0]!.cursor);
    rep3 = await reply(sent[2]!, 'm3');
  };
  await f.platform.runtime.startRun(f.ctx, { prepared: preparedD.value, consumerId: `f11-${kind}-d`, requestId: `f11-${kind}-start-d` });
  expect(r).not.toBeNull();

  // §2.5/L8: two replies saved before the one health commit share position R;
  // their mutual order is the complete item key's, whose first varying field is
  // the creating command's own message id. The message ids are pinned: with
  // `deterministicClaimIds` the memory and SQLite worlds both produce fixed
  // creating-command identities, so the expected order is written here as a
  // LITERAL list (memory sorts m2 before m1; sqlite sorts m1 before m2; the
  // post-health reply is always last). Nothing is read back from the notice
  // source and no ternary accommodates whichever item came first.
  const messageIdOf = (item: { objects: readonly { kind: string; pin?: { ref?: unknown } }[] }): string => {
    const first = item.objects[0];
    const ref = first?.kind === 'aggregate' ? first.pin?.ref : undefined;
    const id = ref !== null && typeof ref === 'object' && 'messageId' in ref ? ref.messageId : undefined;
    if (typeof id !== 'string') throw new Error(`F11 notice has no message identity: ${JSON.stringify(item.objects)}`);
    return id;
  };
  // The creating commands' own ids, hardcoded per backend. A fixture change must
  // fail the identity assertion rather than silently reorder the expectation.
  const LITERAL_IDS = kind === 'memory'
    ? {
      m1: 'session-message-fcf597af8c5924fad3e443bb9221237a4e0e896b60af956c72c66f91e7f1907b',
      m2: 'session-message-54ab4e38972a0c7bd3eee940c022763b1b57f82870397567c344b429381c3410',
      m3: 'session-message-0fe0a2e1acba06e6f2fafb16718fc32f96a14853d1fc6ebf0626a7d65567c549',
      order: ['m2', 'm1', 'm3'] as const,
    }
    : {
      m1: 'session-message-0dd5c1f8147295f97e07c8bb4ae65bc0c5f51e4cce74b59e21cd567ee268c542',
      m2: 'session-message-edad01ed6fc97af15d85fa3cd33c2f8f82a053183c8eb6f5264cfb4bf11bd891',
      m3: 'session-message-3a361c11e02ba6a598a42b3315deff1ffed3e286dad7a0ef1d9573ef9fc40641',
      order: ['m1', 'm2', 'm3'] as const,
    };
  const literalById = { m1: LITERAL_IDS.m1, m2: LITERAL_IDS.m2, m3: LITERAL_IDS.m3 };
  expect(sent.map(message => message.ref.messageId)).toEqual([LITERAL_IDS.m1, LITERAL_IDS.m2, LITERAL_IDS.m3]);
  const expectedOrder = LITERAL_IDS.order.map(id => literalById[id]);
  const expectedCursors = [r!, r!, rep3.cursor];

  const notices = async (limit = 100) => {
    const page = await f.platform.decisions.queryDecisionQueue(f.ctx, { workspace: f.scope,
      sections: ['notices'], categories: ['undelivered_reply'], page: { limit } });
    if (page.status !== 'ready') throw new Error(`F11 notices: ${JSON.stringify(page)}`);
    return page.value;
  };
  // §5.2 line 308/§8.5: a notices read neither commits nor calls either model.
  const quietRead = async (limit = 100) => {
    const commitsBefore = f.commits().length;
    const callsBefore = f.scripted.calls();
    const queryCallsBefore = f.queryScripted.calls();
    const page = await notices(limit);
    expect(f.commits().length).toBe(commitsBefore);
    expect(f.scripted.calls()).toBe(callsBefore);
    expect(f.queryScripted.calls()).toBe(queryCallsBefore);
    return page;
  };
  const cursorOf = (item: { position: { kind: string; cursor?: string } }): string => {
    if (item.position.kind !== 'commit') throw new Error('F11 notice is not a commit position');
    return item.position.cursor!;
  };

  const all = await quietRead();
  expect(all.notices.map(messageIdOf)).toEqual(expectedOrder);
  expect(all.notices.map(cursorOf)).toEqual(expectedCursors);

  // Explicit first-page and tail sequences: the first display shows exactly the
  // first same-cursor item, and a two-item page shows both pre-health items in
  // the predetermined order before the later reply. F11 rejects a wrong first
  // item instead of accommodating whichever the implementation returned.
  const firstPage = await quietRead(1);
  expect(firstPage.notices.map(messageIdOf)).toEqual([expectedOrder[0]]);
  expect(firstPage.notices.map(cursorOf)).toEqual([r!]);
  const headPair = await quietRead(2);
  expect(headPair.notices.map(messageIdOf)).toEqual([expectedOrder[0], expectedOrder[1]]);
  const workspaceRead = await f.platform.projects.readWorkspaceRegistration(f.ctx, f.scope);
  if (workspaceRead.status !== 'ready') throw new Error('F11 workspace read failed');
  const marked = await f.platform.workspaceDecisionSettings.markNoticesSeen(f.ctx, {
    input: { workspace: f.scope, displayToken: firstPage.displayToken!, seenThrough: firstPage.seenThrough },
    meta: { requestId: `f11-${kind}-seen`, expected: [{ ref: workspaceRead.value.workspace.ref, revision: workspaceRead.value.workspace.revision }] },
  });
  expect(marked).toMatchObject({ status: 'committed' });
  const afterSeen = await quietRead();
  expect(afterSeen.notices.map(messageIdOf)).toEqual([expectedOrder[1], expectedOrder[2]]);
  expect(afterSeen.notices.map(cursorOf)).toEqual([r!, rep3.cursor]);

  // The seen set survives an SQLite reopen: the same predetermined tail remains.
  if (kind === 'sqlite') {
    await f.reopen();
    const afterReopen = await quietRead();
    expect(afterReopen.notices.map(messageIdOf)).toEqual([expectedOrder[1], expectedOrder[2]]);
    expect(afterReopen.notices.map(cursorOf)).toEqual([r!, rep3.cursor]);
  }
});

it.each(['memory', 'sqlite'] as const)('F13 [%s] the real responsible link and wait transfer keep the notice; a successor execution accepting the reply removes it', async (kind) => {
  let action: (() => Promise<void>) | null = null;
  const sendArgs: Record<string, unknown> = { recipient: {}, text: 'F13 which file?', intent: 'inquiry', needsReply: true, waitAfterSend: true };
  const f = await open({
    kind,
    duty: 'secretary',
    secondWorld: true,
    workflowBound: true,
    allowAnyRun: true,
    ownedHost: true,
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 'f13-send', name: 'send_session_message', args: sendArgs }] },
      { kind: 'text', text: 'F13 replier done' },
      { kind: 'text', text: 'F13 successor done' },
    ],
    beforeReply: async () => {
      if (f.secondSessionRef !== null && Object.keys(sendArgs['recipient'] as object).length === 0) {
        sendArgs['recipient'] = f.secondSessionRef;
      }
      const run = action; action = null; if (run !== null) await run();
    },
  });
  const sessionRef = f.sessionRef;
  const dSession = f.secondSessionRef!;
  const workD = f.secondWorkCtx();

  const notices = async (): Promise<number> => {
    const commitsBefore = f.commits().length;
    const callsBefore = f.scripted.calls();
    const queryCallsBefore = f.queryScripted.calls();
    const page = await f.platform.decisions.queryDecisionQueue(f.ctx, { workspace: f.scope,
      sections: ['notices'], categories: ['undelivered_reply'], page: { limit: 100 } });
    expect(f.commits().length).toBe(commitsBefore);
    expect(f.scripted.calls()).toBe(callsBefore);
    expect(f.queryScripted.calls()).toBe(queryCallsBefore);
    if (page.status !== 'ready') throw new Error(`F13 notices: ${JSON.stringify(page)}`);
    return page.value.notices.length;
  };

  // The real responsible link through the public Session lifecycle, so the
  // archive anchor can transfer the open responsibility.
  const sessionCard = await f.platform.sessions.readSession(f.ctx, sessionRef);
  if (sessionCard.status !== 'ready') throw new Error(`F13 session read: ${JSON.stringify(sessionCard)}`);
  const linkRef = { ...sessionRef, aggregateType: 'SessionWorkLink' as const,
    target: { kind: 'task' as const, ref: { projectId: f.scope.projectId, goalId: f.goalRef.goalId, taskId: 'implement-a' } },
    relation: 'responsible' as const };
  const linked = await f.platform.sessions.linkSessionWork(f.ctx, { input: { sessionRef,
    target: linkRef.target, relation: 'responsible', active: true },
    meta: { requestId: 'f13-link', expected: [
      { ref: sessionCard.value.record.ref, revision: sessionCard.value.record.revision },
      { ref: linkRef, revision: 0 }] } });
  expect(linked).toMatchObject({ status: 'committed' });

  // S enters and yields a real wait for D.
  const preparedS = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.runRef!, requestId: 'f13-prepare-s' }));
  if (preparedS.status !== 'ready') throw new Error(`F13 prepare S: ${JSON.stringify(preparedS)}`);
  await f.platform.runtime.startRun(f.ctx, { prepared: preparedS.value, consumerId: 'f13-s', requestId: 'f13-start-s' });
  const sExecution = await f.platform.executions.readExecution(f.ctx, f.runRef!);
  if (sExecution.status !== 'ready') throw new Error(`F13 S execution: ${JSON.stringify(sExecution)}`);
  expect(sExecution.value.run).toMatchObject({ status: 'ended', outcome: 'yielded', continuation: { kind: 'wait_reply' } });
  const messageRef = sExecution.value.run.continuation?.messageRef;
  if (messageRef === undefined) throw new Error('F13 S Run must name its wait message');
  expect(await notices()).toBe(0);

  // S really becomes unavailable, then D saves the reply (reply AFTER R). The
  // real Kernel database is moved aside for the probe and restored before D's
  // preparation reads it.
  const aside = await moveKernelAside(f.directory);
  try {
    const card = await f.platform.sessions.readSession(f.ctx, sessionRef);
    if (card.status !== 'ready') throw new Error(`F13 health Session read: ${JSON.stringify(card)}`);
    const probe = await f.platform.reconcile.probe(card.value.record, f.ctx.signal);
    const observed = await f.platform.reconcile.recordSessionHealth(f.ctx, { sessionRef, probe });
    expect((observed as { status?: string }).status).not.toBe('rejected');
  } finally {
    await restoreKernel(f.directory, aside);
  }
  const preparedD = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.secondRunRef!, requestId: 'f13-prepare-d' }));
  if (preparedD.status !== 'ready') throw new Error(`F13 prepare D: ${JSON.stringify(preparedD)}`);
  action = async () => {
    const replied = await f.platform.messages.respondMessage(workD, { input: { messageRef, text: 'F13 saved reply' },
      meta: { requestId: 'f13-reply', expected: [{ ref: messageRef, revision: 1 }] } });
    if (replied.status !== 'committed') throw new Error(`F13 reply: ${JSON.stringify(replied)}`);
  };
  await f.platform.runtime.startRun(f.ctx, { prepared: preparedD.value, consumerId: 'f13-d', requestId: 'f13-start-d' });
  expect(await notices()).toBe(1);

  // The real archive line transfers the open responsibility and the wait to D.
  const currentCard = await f.platform.sessions.readSession(f.ctx, sessionRef);
  if (currentCard.status !== 'ready') throw new Error(`F13 current card: ${JSON.stringify(currentCard)}`);
  const archived = await f.platform.workflow.archiveLine(f.ctx, { input: { sessionRef,
    reason: 'F13 transfer and archive',
    tasks: [{ target: linkRef.target, disposition: { kind: 'transfer', to: dSession } }],
    wait: { kind: 'transfer', runRef: f.runRef!, messageRef, to: dSession } },
    meta: { requestId: 'f13-archive', expected: [{ ref: currentCard.value.record.ref, revision: currentCard.value.record.revision }] } });
  expect(archived).toMatchObject({ status: 'ready', value: { state: 'archived' } });
  // Transfer and archive do not remove the notice.
  expect(await notices()).toBe(1);
  const transferred = await f.platform.messages.readMessage(f.ctx, messageRef);
  if (transferred.status !== 'ready') throw new Error(`F13 transferred read: ${JSON.stringify(transferred)}`);
  expect(transferred.value.replyHandler?.sessionRef).toEqual(dSession);

  // A successor execution in D consumes the reply as the real handler; the
  // Runtime observer records the acceptance through the Kernel's own position,
  // so the notice disappears and no position is synthesized here.
  const driven = await f.platform.workflow.advanceWork(f.ctx, { schemaVersion: 1, goalRef: f.goalRef,
    flowId: 'f13-successor', sessionHint: dSession, kind: 'select_work', taskId: 'implement-a' });
  expect(driven.status).toBe('ready');
  if (driven.status !== 'ready') return;
  let next = driven.value.next;
  for (let step = 0; next !== null && step < 16; step += 1) {
    const advanced = await f.platform.workflow.advanceWork(f.ctx, next);
    expect(advanced.status).toBe('ready');
    if (advanced.status !== 'ready') return;
    next = advanced.value.next;
  }
  const consumed = await f.platform.messages.readMessage(f.ctx, messageRef);
  if (consumed.status !== 'ready') throw new Error(`F13 consumed read: ${JSON.stringify(consumed)}`);
  expect((consumed.value.acceptedInputs ?? []).filter(entry => entry.part === 'response')).toHaveLength(1);
  expect(await notices()).toBe(0);
});

it.each(['memory', 'sqlite'] as const)('F15 [%s] a failed reply or health commit leaves no half state, and a committed reply recovers exactly once on retry', async (kind) => {
  let action: (() => Promise<void>) | null = null;
  const out: Record<string, unknown> = {};
  let sent: SessionMessage | null = null;
  const f = await open({
    kind,
    duty: 'secretary',
    secondWorld: true,
    ownedHost: true,
    scriptedReplies: [{ kind: 'text', text: 'F15 sender done' }, { kind: 'text', text: 'F15 replier done' }],
    beforeReply: async () => { const run = action; action = null; if (run !== null) await run(); },
  });
  const sessionRef = f.sessionRef;
  const preparedS = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.runRef!, requestId: 'f15-prepare-s' }));
  if (preparedS.status !== 'ready') throw new Error(`F15 prepare S: ${JSON.stringify(preparedS)}`);
  action = async () => {
    const result = await f.platform.messages.sendMessage(f.workCtx(), { input: { recipient: f.secondSessionRef!,
      text: 'F15 reply me', intent: 'inquiry', needsReply: true, waitAfterSend: false },
      meta: { requestId: 'f15-send', expected: [] } });
    if (result.status !== 'committed') throw new Error(`F15 send: ${JSON.stringify(result)}`);
    sent = result.value;
  };
  await f.platform.runtime.startRun(f.ctx, { prepared: preparedS.value, consumerId: 'f15-s', requestId: 'f15-start-s' });
  const message = sent!;
  const workD = f.secondWorkCtx();
  const readNotices = async (): Promise<number> => {
    const commitsBefore = f.commits().length;
    const callsBefore = f.scripted.calls();
    const queryCallsBefore = f.queryScripted.calls();
    const page = await f.platform.decisions.queryDecisionQueue(f.ctx, { workspace: f.scope,
      sections: ['notices'], categories: ['undelivered_reply'], page: { limit: 100 } });
    expect(f.commits().length).toBe(commitsBefore);
    expect(f.scripted.calls()).toBe(callsBefore);
    expect(f.queryScripted.calls()).toBe(queryCallsBefore);
    if (page.status !== 'ready') throw new Error(`F15 notices: ${JSON.stringify(page)}`);
    return page.value.notices.length;
  };
  const replyRequest = { input: { messageRef: message.ref, text: 'F15 saved reply' },
    meta: { requestId: 'f15-reply', expected: [{ ref: message.ref, revision: message.revision }] } };

  const preparedD = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.secondRunRef!, requestId: 'f15-prepare-d' }));
  if (preparedD.status !== 'ready') throw new Error(`F15 prepare D: ${JSON.stringify(preparedD)}`);
  action = async () => {
    // 1. the reply commit fails: no response half state and no notice.
    f.failNextWrite();
    try { out['failedReply'] = await f.platform.messages.respondMessage(workD, replyRequest); }
    catch (error) { out['failedReply'] = error; }
    const afterFail = await f.platform.messages.readMessage(f.ctx, message.ref);
    out['messageAfterFail'] = afterFail.status === 'ready'
      ? { status: afterFail.value.status, response: afterFail.value.response } : afterFail;
    out['noticesAfterReplyFail'] = await readNotices();

    // 2. the reply commits once.
    out['replied'] = await f.platform.messages.respondMessage(workD, replyRequest);

    // 3. the health commit fails: the Session stays available with no position.
    // The mapped Kernel is moved aside for the real probe and restored before
    // step 4 and the retried reply Turn touch it again.
    const failedAside = await moveKernelAside(f.directory);
    try {
      const card = await f.platform.sessions.readSession(f.ctx, sessionRef);
      if (card.status !== 'ready') throw new Error(`F15 health Session read: ${JSON.stringify(card)}`);
      const probe = await f.platform.reconcile.probe(card.value.record, f.ctx.signal);
      f.failNextWrite();
      try { out['failedHealth'] = await f.platform.reconcile.recordSessionHealth(f.ctx, { sessionRef, probe }); }
      catch (error) { out['failedHealth'] = error; }
    } finally {
      await restoreKernel(f.directory, failedAside);
    }
    const afterHealthFail = await f.platform.sessions.readSession(f.ctx, sessionRef);
    out['sessionAfterHealthFail'] = afterHealthFail.status === 'ready'
      ? afterHealthFail.value.record
      : afterHealthFail;
    out['noticesAfterHealthFail'] = await readNotices();

    // 4. the health commit succeeds: exactly one notice.
    const observedAside = await moveKernelAside(f.directory);
    try {
      const card = await f.platform.sessions.readSession(f.ctx, sessionRef);
      if (card.status !== 'ready') throw new Error(`F15 observed Session read: ${JSON.stringify(card)}`);
      const probe = await f.platform.reconcile.probe(card.value.record, f.ctx.signal);
      out['observed'] = await f.platform.reconcile.recordSessionHealth(f.ctx, { sessionRef, probe });
    } finally {
      await restoreKernel(f.directory, observedAside);
    }
    out['noticesAfterUnavailable'] = await readNotices();

    // 5. the retried reply replays exactly once; the response slot is unchanged.
    out['replay'] = await f.platform.messages.respondMessage(workD, replyRequest);
    const finalMessage = await f.platform.messages.readMessage(f.ctx, message.ref);
    out['finalRevision'] = finalMessage.status === 'ready' ? finalMessage.value.revision : null;
    out['finalNotices'] = await readNotices();
  };
  await f.platform.runtime.startRun(f.ctx, { prepared: preparedD.value, consumerId: 'f15-d', requestId: 'f15-start-d' });

  expect(out['failedReply']).toMatchObject({ status: 'rejected' });
  expect(out['messageAfterFail']).toEqual({ status: 'pending', response: null });
  expect(out['noticesAfterReplyFail']).toBe(0);
  expect(out['replied']).toMatchObject({ status: 'committed' });
  expect(out['failedHealth']).toMatchObject({ status: 'rejected' });
  expect(out['sessionAfterHealthFail']).toMatchObject({ health: 'available' });
  // The failed health commit left no interruption position at all: the field is
  // ABSENT from the failed Session read, not present with a null/undefined value.
  const failedHealthRecord = out['sessionAfterHealthFail'] as Record<string, unknown>;
  expect(failedHealthRecord.health).toBe('available');
  expect(Object.prototype.hasOwnProperty.call(failedHealthRecord, 'unavailableSince')).toBe(false);
  expect(out['noticesAfterHealthFail']).toBe(0);
  expect(out['observed']).not.toMatchObject({ status: 'rejected' });
  expect(out['noticesAfterUnavailable']).toBe(1);
  expect(out['replay']).toMatchObject({ status: 'committed', replayed: true });
  expect(out['finalRevision']).toBe(2);
  expect(out['finalNotices']).toBe(1);
});

it('F15 [sqlite] a committed reply whose receipt was lost recovers exactly once after a reopen', async () => {
  let action: (() => Promise<void>) | null = null;
  let sent: SessionMessage | null = null;
  const f = await open({
    kind: 'sqlite',
    duty: 'secretary',
    secondWorld: true,
    ownedHost: true,
    scriptedReplies: [{ kind: 'text', text: 'F15-loss sender done' }, { kind: 'text', text: 'F15-loss replier done' }],
    beforeReply: async () => { const run = action; action = null; if (run !== null) await run(); },
  });
  const preparedS = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.runRef!, requestId: 'f15-loss-prepare-s' }));
  if (preparedS.status !== 'ready') throw new Error(`F15-loss prepare S: ${JSON.stringify(preparedS)}`);
  action = async () => {
    const result = await f.platform.messages.sendMessage(f.workCtx(), { input: { recipient: f.secondSessionRef!,
      text: 'F15-loss reply me', intent: 'inquiry', needsReply: true, waitAfterSend: false },
      meta: { requestId: 'f15-loss-send', expected: [] } });
    if (result.status !== 'committed') throw new Error(`F15-loss send: ${JSON.stringify(result)}`);
    sent = result.value;
  };
  await f.platform.runtime.startRun(f.ctx, { prepared: preparedS.value, consumerId: 'f15-loss-s', requestId: 'f15-loss-start-s' });
  const message = sent!;
  const workD = f.secondWorkCtx();
  const replyRequest = { input: { messageRef: message.ref, text: 'F15-loss saved reply' },
    meta: { requestId: 'f15-loss-reply', expected: [{ ref: message.ref, revision: message.revision }] } };

  const preparedD = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.secondRunRef!, requestId: 'f15-loss-prepare-d' }));
  if (preparedD.status !== 'ready') throw new Error(`F15-loss prepare D: ${JSON.stringify(preparedD)}`);
  action = async () => {
    // The reply commits, and the caller's process boundary loses the receipt:
    // the returned value is deliberately discarded, never stored or compared.
    const lost = await f.platform.messages.respondMessage(workD, replyRequest);
    if (lost.status !== 'committed') throw new Error(`F15-loss reply: ${JSON.stringify(lost)}`);
  };
  await f.platform.runtime.startRun(f.ctx, { prepared: preparedD.value, consumerId: 'f15-loss-d', requestId: 'f15-loss-start-d' });

  // An independent read of the committed business state (the message itself,
  // not the lost receipt) before the process boundary.
  const before = await f.platform.messages.readMessage(f.ctx, message.ref);
  expect(before).toMatchObject({ status: 'ready', value: { status: 'responded', revision: message.revision + 1 } });
  if (before.status !== 'ready') return;
  const committedResponse = before.value.response;

  // The real process boundary: the composition is closed and reopened on the
  // same SQLite files, so the first receipt no longer exists in memory.
  await f.reopen();

  const recovered = await f.platform.messages.respondMessage(workD, replyRequest);
  expect(recovered).toMatchObject({ status: 'committed', replayed: true });
  const after = await f.platform.messages.readMessage(f.ctx, message.ref);
  expect(after).toMatchObject({ status: 'ready', value: { status: 'responded', revision: message.revision + 1 } });
  if (after.status !== 'ready') return;
  // Exactly one response: the replay changed nothing and the single response
  // slot is byte-identical to the independently-read committed value.
  expect(after.value.response).toEqual(committedResponse);
  expect(after.value.acceptedInputs ?? []).toEqual([]);
});

it.each(['memory', 'sqlite'] as const)('F14 [%s] the Work reply position equals the reply receipt cursor and survives a retry and a reopen', async (kind) => {
  let action: (() => Promise<void>) | null = null;
  let sent: SessionMessage | null = null;
  let firstReply: { value: SessionMessage; cursor: string } | null = null;
  let replay: unknown;
  const f = await open({
    kind,
    duty: 'secretary',
    secondWorld: true,
    ownedHost: true,
    scriptedReplies: [{ kind: 'text', text: 'F14 sender done' }, { kind: 'text', text: 'F14 replier done' }],
    beforeReply: async () => { const run = action; action = null; if (run !== null) await run(); },
  });
  const sessionRef = f.sessionRef;
  const preparedS = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.runRef!, requestId: 'f14-prepare-s' }));
  if (preparedS.status !== 'ready') throw new Error(`F14 prepare S: ${JSON.stringify(preparedS)}`);
  action = async () => {
    const result = await f.platform.messages.sendMessage(f.workCtx(), { input: { recipient: f.secondSessionRef!,
      text: 'F14 reply me', intent: 'inquiry', needsReply: true, waitAfterSend: false },
      meta: { requestId: 'f14-send', expected: [] } });
    if (result.status !== 'committed') throw new Error(`F14 send: ${JSON.stringify(result)}`);
    sent = result.value;
  };
  await f.platform.runtime.startRun(f.ctx, { prepared: preparedS.value, consumerId: 'f14-s', requestId: 'f14-start-s' });
  const message = sent!;
  const workD = f.secondWorkCtx();
  const readNotices = async () => {
    const commitsBefore = f.commits().length;
    const callsBefore = f.scripted.calls();
    const queryCallsBefore = f.queryScripted.calls();
    const page = await f.platform.decisions.queryDecisionQueue(f.ctx, { workspace: f.scope,
      sections: ['notices'], categories: ['undelivered_reply'], page: { limit: 100 } });
    expect(f.commits().length).toBe(commitsBefore);
    expect(f.scripted.calls()).toBe(callsBefore);
    expect(f.queryScripted.calls()).toBe(queryCallsBefore);
    if (page.status !== 'ready') throw new Error(`F14 notices: ${JSON.stringify(page)}`);
    return page.value.notices;
  };
  const replyRequest = { input: { messageRef: message.ref, text: 'F14 saved reply' },
    meta: { requestId: 'f14-reply', expected: [{ ref: message.ref, revision: message.revision }] } };

  // The wait is interrupted BEFORE the reply, so the reply commit is the later
  // of the two positions and §5.2 F14's expected value is the command's cursor.
  // R is the ONE new Session-record commit, read from the commit log.
  const beforeHealth = f.commits().length;
  // The real unreadable-Kernel probe: move the mapped database aside, observe,
  // then restore it before D's preparation reads it.
  const aside = await moveKernelAside(f.directory);
  try {
    const card = await f.platform.sessions.readSession(f.ctx, sessionRef);
    if (card.status !== 'ready') throw new Error(`F14 health Session read: ${JSON.stringify(card)}`);
    const probe = await f.platform.reconcile.probe(card.value.record, f.ctx.signal);
    const observed = await f.platform.reconcile.recordSessionHealth(f.ctx, { sessionRef, probe });
    if ((observed as { status?: string }).status === 'rejected') throw new Error(`F14 health: ${JSON.stringify(observed)}`);
  } finally {
    await restoreKernel(f.directory, aside);
  }
  const healthCommits = f.commits().slice(beforeHealth)
    .filter(notice => notice.aggregates.some(aggregate => aggregate.aggregateType === 'Session'));
  expect(healthCommits).toHaveLength(1);
  const r = String(healthCommits[0]!.cursor);

  const preparedD = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.secondRunRef!, requestId: 'f14-prepare-d' }));
  if (preparedD.status !== 'ready') throw new Error(`F14 prepare D: ${JSON.stringify(preparedD)}`);
  action = async () => {
    const replied = await f.platform.messages.respondMessage(workD, replyRequest);
    if (replied.status !== 'committed') throw new Error(`F14 reply: ${JSON.stringify(replied)}`);
    firstReply = { value: replied.value, cursor: String(replied.cursor) };
    // Retrying the identical reply request replays the original receipt.
    replay = await f.platform.messages.respondMessage(workD, replyRequest);
  };
  await f.platform.runtime.startRun(f.ctx, { prepared: preparedD.value, consumerId: 'f14-d', requestId: 'f14-start-d' });

  expect(firstReply).not.toBeNull();
  if (firstReply === null) return;
  const first = firstReply as { value: SessionMessage; cursor: string };
  expect(first.cursor).not.toBe(r);
  // The literal saved reply body is readable through the public body port.
  const firstBody = await quietRead(f, () => f.platform.messages.readMessageBody(f.ctx,
    { messageRef: message.ref, part: 'response' }));
  expect(firstBody).toMatchObject({ status: 'ready', value: { part: 'response', text: 'F14 saved reply' } });
  // The same-request retry replays the COMPLETE first value and cursor.
  expect(replay).toMatchObject({ status: 'committed', replayed: true });
  const replayedReply = replay as { status: string; cursor: string; value: SessionMessage };
  if (replayedReply.status !== 'committed') return;
  expect(replayedReply.cursor).toBe(first.cursor);
  expect(replayedReply.value).toEqual(first.value);

  const beforeReopen = await readNotices();
  expect(beforeReopen).toHaveLength(1);
  const position = beforeReopen[0]!.position;
  expect(position.kind).toBe('commit');
  if (position.kind !== 'commit') return;
  // The independent expected value: the reply command's own receipt cursor.
  expect(position.cursor).toBe(first.cursor);
  // Both stored positions reach the DTO (R from the health commit log, P from
  // the reply command's own receipt).
  const replyIdentity = responseIdentityOf(f, message.ref.messageId);
  expect(replyIdentity).not.toBeNull();
  if (replyIdentity === null) return;
  const readReplies = f.platform.messages.readUndeliveredReplies;
  if (readReplies === undefined) throw new Error('the platform mailbox does not expose readUndeliveredReplies');
  const dto = await quietRead(f, () => readReplies(f.ctx, { sessionRef: f.sessionRef, page: { limit: 100 } }));
  expect(dto).toMatchObject({ status: 'ready' });
  if (dto.status !== 'ready') return;
  expect(dto.value.items).toEqual([{ kind: 'retired_reply', messageRef: message.ref, sourceSessionRef: f.sessionRef,
    responseRef: replyIdentity.responseRef, respondedAt: replyIdentity.respondedAt, hasContinuation: false,
    requiresUserRecipient: true, unavailableSince: r, responseSince: first.cursor }]);

  // The same reply request after closing and reopening the SQLite root replays
  // the complete first value and cursor, and the position is unchanged.
  if (kind === 'sqlite') {
    await f.reopen();
    const reissued = await f.platform.messages.respondMessage(workD, replyRequest);
    expect(reissued).toMatchObject({ status: 'committed', replayed: true });
    if (reissued.status !== 'committed') return;
    expect(reissued.cursor).toBe(first.cursor);
    expect(reissued.value).toEqual(first.value);
    const afterReopen = await readNotices();
    expect(afterReopen).toHaveLength(1);
    expect(afterReopen[0]!.position).toEqual(position);
    expect(afterReopen[0]!.itemKey).toBe(beforeReopen[0]!.itemKey);
  }
});

it.each(['memory', 'sqlite'] as const)('F09 [%s] a reply saved after its Session already became unavailable appears once and archiving keeps it', async (kind) => {
  const { f, readNotices, sendInquiry, reply, recordHealth } = await openReplyWorld(`f09-${kind}`, { kind });
  const message = await sendInquiry();
  // R first, through the real health writer.
  const r = await recordHealth('missing');
  // P later, through the real reply writer.
  const p = (await reply(message)).cursor;
  expect(p).not.toBe(r);
  const first = await readNotices();
  expect(first).toHaveLength(1);
  const position = first[0]!.position;
  expect(position.kind).toBe('commit');
  if (position.kind !== 'commit') return;
  // §5.2 F09: the later saved reply is the position.
  expect(position.cursor).toBe(p);

  // Archiving the already-unavailable Session keeps the notice unchanged.
  const sessionRead = await f.platform.sessions.readSession(f.ctx, f.sessionRef);
  if (sessionRead.status !== 'ready') throw new Error(`F09 session read: ${JSON.stringify(sessionRead)}`);
  const archived = await f.platform.sessions.archiveSession(f.ctx, { input: { sessionRef: f.sessionRef, reason: `F09 ${kind} archive` },
    meta: { requestId: `f09-${kind}-archive`, expected: [{ ref: sessionRead.value.record.ref, revision: sessionRead.value.record.revision }] } });
  expect(archived).toMatchObject({ status: 'committed' });
  const after = await readNotices();
  expect(after).toHaveLength(1);
  expect(after[0]!.itemKey).toBe(first[0]!.itemKey);
  expect(after[0]!.position).toEqual(position);

  // F09 audit fix (continuation case): derive a real continuation Session from
  // the unavailable line through the public Session lifecycle. The notice set is
  // unchanged, the DTO reports the continuation, and the successor accepted no
  // input.
  const claim = f.claim;
  if (claim === null) throw new Error('F09 needs the real primary claim');
  const continuation = await f.platform.runtime.createSession(f.ctx, {
    workspace: f.scope, role: sessionRead.value.record.role, recommendedRefs: [], initialLinks: [],
    provenance: { schemaVersion: 1, kind: 'continuation', from: f.sessionRef, reason: 'interrupted', task: claim.task },
    meta: { requestId: `f09-${kind}-continuation`, expected: [] },
  });
  expect(continuation).toMatchObject({ status: 'completed' });

  const withContinuation = await readNotices();
  expect(withContinuation).toHaveLength(1);
  expect(withContinuation[0]!.itemKey).toBe(first[0]!.itemKey);
  expect(withContinuation[0]!.position).toEqual(position);

  const readReplies = f.platform.messages.readUndeliveredReplies;
  if (readReplies === undefined) throw new Error('the platform mailbox does not expose readUndeliveredReplies');
  const dto = await quietRead(f, () => readReplies(f.ctx, { sessionRef: f.sessionRef, page: { limit: 100 } }));
  expect(dto).toMatchObject({ status: 'ready' });
  if (dto.status !== 'ready') return;
  expect(dto.value.items).toHaveLength(1);
  expect(dto.value.items[0]).toMatchObject({ kind: 'retired_reply', hasContinuation: true, requiresUserRecipient: false });

  // No successor execution accepted the reply: the one response slot records no
  // accepted input.
  const repliedMessage = await f.platform.messages.readMessage(f.ctx, message.ref);
  if (repliedMessage.status !== 'ready') throw new Error(`F09 reply read: ${JSON.stringify(repliedMessage)}`);
  expect(repliedMessage.value.acceptedInputs ?? []).toEqual([]);
});

it.each(['memory', 'sqlite'] as const)('F10 [%s] a reply saved before its Session becomes unavailable becomes a new unseen notice at the later health position', async (kind) => {
  const { readNotices, sendInquiry, reply, recordHealth } = await openReplyWorld(`f10-${kind}`, { kind });
  const message = await sendInquiry();
  // P first: the reply is saved while the Session is still available.
  const p = (await reply(message)).cursor;
  expect(await readNotices()).toEqual([]);
  // R later, through the real health writer.
  const r = await recordHealth('missing');
  expect(r).not.toBe(p);
  const notices = await readNotices();
  expect(notices).toHaveLength(1);
  const position = notices[0]!.position;
  expect(position.kind).toBe('commit');
  if (position.kind !== 'commit') return;
  // §5.2 F10: max(P, R) is R, the later health commit (not the reply cursor).
  expect(position.cursor).toBe(r);
});

it.each(['memory', 'sqlite'] as const)('F10 [%s] (Work reconcile) the real reconcile of an in-flight Run retires the Session and the saved reply becomes a notice at that commit', async (kind) => {
  let releaseS!: () => void;
  const gate = new Promise<void>(resolve => { releaseS = resolve; });
  let sInFlight!: () => void;
  const sInFlightP = new Promise<void>(resolve => { sInFlight = resolve; });
  let sent: SessionMessage | null = null;
  let replyReceipt: { cursor: string; value: SessionMessage } | null = null;
  let call = 0;
  const f = await open({
    kind,
    duty: 'secretary',
    secondWorld: true,
    ownedHost: true,
    allowAnyRun: true,
    scriptedReplies: [{ kind: 'text', text: 'F10r S send done' }, { kind: 'text', text: 'F10r D reply done' }],
    beforeReply: async () => {
      const index = call++;
      if (index === 0) {
        // S: send the inquiry through the real mailbox owner, then stay in flight
        // so the Run is genuinely `running` when the Host reconciles it.
        const result = await f.platform.messages.sendMessage(f.workCtx(), { input: { recipient: f.secondSessionRef!,
          text: 'F10r which file should S use?', intent: 'inquiry', needsReply: true, waitAfterSend: false },
          meta: { requestId: 'f10r-send', expected: [] } });
        if (result.status !== 'committed') throw new Error(`F10r send: ${JSON.stringify(result)}`);
        sent = result.value;
        sInFlight();
        await gate;
        throw new Error('F10r S interrupted after the reply was saved');
      }
      // D: save the reply (P) while S is still running and available.
      const message = sent!;
      const replied = await f.platform.messages.respondMessage(f.secondWorkCtx(), {
        input: { messageRef: message.ref, text: 'F10r use result.txt' },
        meta: { requestId: 'f10r-reply', expected: [{ ref: message.ref, revision: message.revision }] } });
      if (replied.status !== 'committed') throw new Error(`F10r reply: ${JSON.stringify(replied)}`);
      replyReceipt = { cursor: String(replied.cursor), value: replied.value };
    },
  });
  const readNotices = async () => {
    const commitsBefore = f.commits().length;
    const callsBefore = f.scripted.calls();
    const queryCallsBefore = f.queryScripted.calls();
    const page = await f.platform.decisions.queryDecisionQueue(f.ctx, { workspace: f.scope,
      sections: ['notices'], categories: ['undelivered_reply'], page: { limit: 100 } });
    expect(f.commits().length).toBe(commitsBefore);
    expect(f.scripted.calls()).toBe(callsBefore);
    expect(f.queryScripted.calls()).toBe(queryCallsBefore);
    if (page.status !== 'ready') throw new Error(`F10r notices: ${JSON.stringify(page)}`);
    return page.value.notices;
  };

  const preparedS = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.runRef!, requestId: 'f10r-prepare-s' }));
  if (preparedS.status !== 'ready') throw new Error(`F10r prepare S: ${JSON.stringify(preparedS)}`);
  const runningS = f.platform.runtime.startRun(f.ctx, { prepared: preparedS.value, consumerId: 'f10r-s', requestId: 'f10r-start-s' });
  await sInFlightP;
  const preparedD = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.secondRunRef!, requestId: 'f10r-prepare-d' }));
  if (preparedD.status !== 'ready') throw new Error(`F10r prepare D: ${JSON.stringify(preparedD)}`);
  await f.platform.runtime.startRun(f.ctx, { prepared: preparedD.value, consumerId: 'f10r-d', requestId: 'f10r-start-d' });
  expect(replyReceipt).not.toBeNull();
  const p = replyReceipt!.cursor;

  // P first: before the reconcile the Session is available, so there is no notice.
  expect(await readNotices()).toEqual([]);

  // The real Work reconcile of the RAW in-flight Run with a readable open Turn
  // (row W-11, `interrupted_clean`) retires S in the reconcile commit.
  const record = await f.platform.executions.readExecution(f.ctx, f.runRef!);
  if (record.status !== 'ready') throw new Error(`F10r record: ${JSON.stringify(record)}`);
  expect(record.value.run.status).toBe('running');
  const beforeReconcile = f.commits().length;
  const probe = await f.platform.reconcile.probe(record.value.session, f.ctx.signal);
  const reconciled = await f.platform.reconcile.reconcileRun(f.ctx, { record: record.value,
    hostInstanceId: 'wp2-host', probe });
  expect(reconciled).toMatchObject({ row: 'W-11', status: 'reconciled' });
  // R is the ONE new Session-record commit of the real reconcile, from the log.
  const healthCommits = f.commits().slice(beforeReconcile)
    .filter(notice => notice.aggregates.some(aggregate => aggregate.aggregateType === 'Session'));
  expect(healthCommits).toHaveLength(1);
  const r = String(healthCommits[0]!.cursor);
  expect(r).not.toBe(p);
  const notices = await readNotices();
  expect(notices).toHaveLength(1);
  expect(notices[0]!.position).toMatchObject({ kind: 'commit', cursor: r });
  expect(notices[0]!.summary).toContain('未送达回复');
  // Both stored positions reach the mailbox DTO.
  const replyIdentity = responseIdentityOf(f, sent!.ref.messageId);
  expect(replyIdentity).not.toBeNull();
  if (replyIdentity !== null) {
    const readReplies = f.platform.messages.readUndeliveredReplies;
    if (readReplies === undefined) throw new Error('the platform mailbox does not expose readUndeliveredReplies');
    const dto = await quietRead(f, () => readReplies(f.ctx, { sessionRef: f.sessionRef, page: { limit: 100 } }));
    expect(dto).toMatchObject({ status: 'ready' });
    if (dto.status === 'ready') {
      expect(dto.value.items).toEqual([{ kind: 'retired_reply', messageRef: sent!.ref, sourceSessionRef: f.sessionRef,
        responseRef: replyIdentity.responseRef, respondedAt: replyIdentity.respondedAt, hasContinuation: false,
        requiresUserRecipient: true, unavailableSince: r, responseSince: p }]);
    }
  }

  // Let the interrupted Run settle BEFORE any reopen: the platform close drains
  // pending Runtime calls, so an unreleased in-flight Run would deadlock it.
  releaseS();
  try { await runningS; } catch { /* the interrupted Run may settle after the reconcile */ }

  // The position survives an SQLite reopen.
  if (kind === 'sqlite') {
    await f.reopen();
    const afterReopen = await readNotices();
    expect(afterReopen).toHaveLength(1);
    expect(afterReopen[0]!.position).toMatchObject({ kind: 'commit', cursor: r });
  }
});

it.each(['memory', 'sqlite'] as const)('F12 [%s] SES-13 recovery removes the notice and a later re-entry produces a new unseen one', async (kind) => {
  const { readNotices, sendInquiry, reply, recordHealth, markSeen } = await openReplyWorld(`f12-${kind}`, { kind });
  const message = await sendInquiry();
  const r1 = await recordHealth('missing');
  const p = (await reply(message)).cursor;
  const first = await readNotices();
  expect(first).toHaveLength(1);
  const firstItem = first[0]!;
  expect(firstItem.position.kind).toBe('commit');
  if (firstItem.position.kind === 'commit') expect(firstItem.position.cursor).toBe(p);

  await markSeen();
  expect(await readNotices()).toEqual([]);

  // SES-13: a ready probe returns the Session to available and keeps the line out.
  const recovered = await recordHealth('ready');
  expect(recovered).not.toBe(r1);
  expect(await readNotices()).toEqual([]);

  // A later re-entry writes a NEW R, so the same message+reply pair becomes a
  // new unseen notice at the new health commit.
  const r2 = await recordHealth('missing');
  expect(r2).not.toBe(r1);
  const again = await readNotices();
  expect(again).toHaveLength(1);
  expect(again[0]!.itemKey).toBe(firstItem.itemKey);
  const againPosition = again[0]!.position;
  expect(againPosition.kind).toBe('commit');
  if (againPosition.kind !== 'commit') return;
  expect(againPosition.cursor).toBe(r2);
  expect(againPosition.cursor).not.toBe(p);
});

it.each(['memory', 'sqlite'] as const)('F14 [%s] the user-answer writer preserves its one response across a retry and a reopen', async (kind) => {
  let f!: WP2PlatformFixture;
  let captured: SessionMessage | null = null;
  f = await open({
    kind,
    duty: 'secretary',
    ownedHost: true,
    scriptedReplies: [{ kind: 'text', text: 'F14 user-answer sender done' }],
    beforeReply: async () => {
      const sent = await f.platform.decisionMessages.sendUserMessage(f.workCtx(), {
        input: { goalRef: f.goalRef, intent: 'decision_request', text: '请你决定：用户答复写入测试',
          needsReply: true, waitAfterSend: false,
          options: [{ id: 'continue', label: '继续', effect: 'apply' }, { id: 'stop', label: '停止', effect: 'reject' }],
          objects: [] },
        meta: { requestId: 'f14-user-question', expected: [] },
      });
      if (sent.status !== 'committed') throw new Error(`F14 user question: ${JSON.stringify(sent)}`);
      captured = sent.value;
    },
  });
  const prepared = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.runRef!, requestId: 'f14-user-prepare' }));
  if (prepared.status !== 'ready') throw new Error(`F14 user prepare: ${JSON.stringify(prepared)}`);
  await f.platform.runtime.startRun(f.ctx, { prepared: prepared.value, consumerId: 'f14-user-s', requestId: 'f14-user-start' });
  const message = captured!;

  const queue = await quietRead(f, () => f.platform.decisions.queryDecisionQueue(f.ctx, {
    workspace: f.scope, goalRef: f.goalRef, sections: ['waiting_answer'], page: { limit: 100 } }));
  if (queue.status !== 'ready') throw new Error(`F14 user queue: ${JSON.stringify(queue)}`);
  const card = queue.value.waitingAnswer[0]!;
  const answerRequest = { input: { source: card.source, selection: { kind: 'option' as const, optionId: 'continue' },
    text: '继续', annotations: [] },
    meta: { requestId: 'f14-user-answer', expected: [...card.source.pins, { ref: message.ref, revision: message.revision }] } };
  const answered = await f.platform.decisionMessages.answerDecision(f.ctx, answerRequest);
  expect(answered).toMatchObject({ status: 'committed' });
  if (answered.status !== 'committed') return;
  const firstAnswered = { value: answered.value, cursor: String(answered.cursor) };
  // Literal reply content/options: the selected option and no annotations.
  expect(firstAnswered.value.response).toMatchObject({
    decision: { selection: { kind: 'option', optionId: 'continue' }, annotations: [] } });

  const readMessage = async () => {
    const read = await f.platform.messages.readMessage(f.ctx, message.ref);
    if (read.status !== 'ready') throw new Error(`F14 user read: ${JSON.stringify(read)}`);
    return read.value;
  };
  const first = await readMessage();
  // The complete stored record equals the complete first receipt value; the
  // pending reply position is the answer command's own receipt cursor (P).
  expect(first).toEqual(firstAnswered.value);
  expect(first.responseSince).toBe(firstAnswered.cursor);
  // The literal answer body is readable through the public body port.
  const answerBody = await quietRead(f, () => f.platform.messages.readMessageBody(f.ctx,
    { messageRef: message.ref, part: 'response' }));
  expect(answerBody).toMatchObject({ status: 'ready', value: { part: 'response', text: '继续' } });

  const replay = await f.platform.decisionMessages.answerDecision(f.ctx, answerRequest);
  expect(replay).toMatchObject({ status: 'committed', replayed: true });
  if (replay.status !== 'committed') return;
  // Spec §2.3 L11: the retry restores the complete first value and cursor.
  expect(replay.cursor).toBe(firstAnswered.cursor);
  expect(replay.value).toEqual(firstAnswered.value);

  // Spec §2.3/L7/L8 (finding 2): the mailbox DTO carries both stored positions
  // for every qualifying original work_run message, whatever the reply sender.
  const beforeHealth = f.commits().length;
  // The real unreadable-Kernel observation: the mapped database is moved aside,
  // probed, observed, and restored for the reads that follow.
  const answerAside = await moveKernelAside(f.directory);
  try {
    const card = await f.platform.sessions.readSession(f.ctx, f.sessionRef);
    if (card.status !== 'ready') throw new Error(`F14 answer health Session read: ${JSON.stringify(card)}`);
    const probe = await f.platform.reconcile.probe(card.value.record, f.ctx.signal);
    const health = await f.platform.reconcile.recordSessionHealth(f.ctx, { sessionRef: f.sessionRef, probe });
    expect((health as { status?: string }).status).not.toBe('rejected');
  } finally {
    await restoreKernel(f.directory, answerAside);
  }
  const healthCommits = f.commits().slice(beforeHealth)
    .filter(notice => notice.aggregates.some(aggregate => aggregate.aggregateType === 'Session'));
  expect(healthCommits).toHaveLength(1);
  const r = String(healthCommits[0]!.cursor);
  expect(r).not.toBe(firstAnswered.cursor);
  const replyIdentity = responseIdentityOf(f, message.ref.messageId);
  expect(replyIdentity).not.toBeNull();
  if (replyIdentity === null) return;
  const readReplies = f.platform.messages.readUndeliveredReplies;
  if (readReplies === undefined) throw new Error('the platform mailbox does not expose readUndeliveredReplies');
  const dto = await quietRead(f, () => readReplies(f.ctx, { sessionRef: f.sessionRef, page: { limit: 100 } }));
  expect(dto).toMatchObject({ status: 'ready' });
  if (dto.status !== 'ready') return;
  expect(dto.value.items).toEqual([{ kind: 'retired_reply', messageRef: message.ref, sourceSessionRef: f.sessionRef,
    responseRef: replyIdentity.responseRef, respondedAt: replyIdentity.respondedAt, hasContinuation: false,
    requiresUserRecipient: true, unavailableSince: r, responseSince: firstAnswered.cursor }]);

  // F14 audit fix: the user answer becomes a real notice at R (the later health
  // commit), both for the Goal and unfiltered for the workspace, read through
  // the production queue.
  const noticePage = async (goalRef?: typeof f.goalRef) => {
    const page = await quietRead(f, () => f.platform.decisions.queryDecisionQueue(f.ctx, {
      workspace: f.scope, ...(goalRef === undefined ? {} : { goalRef }),
      sections: ['notices'], categories: ['undelivered_reply'], page: { limit: 100 } }));
    if (page.status !== 'ready') throw new Error(`F14 user notices: ${JSON.stringify(page)}`);
    return page.value.notices;
  };
  const goalNotices = await noticePage(f.goalRef);
  expect(goalNotices).toHaveLength(1);
  expect(goalNotices[0]!.position).toMatchObject({ kind: 'commit', cursor: r });
  const workspaceNotices = await noticePage();
  expect(workspaceNotices).toHaveLength(1);
  expect(workspaceNotices[0]!.position).toMatchObject({ kind: 'commit', cursor: r });

  // The same request after a reopen replays the complete first value and cursor.
  if (kind === 'sqlite') await f.reopen();
  const after = await readMessage();
  expect(after).toEqual(first);
  if (kind === 'sqlite') {
    const reopened = await f.platform.decisionMessages.answerDecision(f.ctx, answerRequest);
    expect(reopened).toMatchObject({ status: 'committed', replayed: true });
    if (reopened.status !== 'committed') return;
    expect(reopened.cursor).toBe(firstAnswered.cursor);
    expect(reopened.value).toEqual(firstAnswered.value);
    const reopenedNotices = await noticePage(f.goalRef);
    expect(reopenedNotices).toHaveLength(1);
    expect(reopenedNotices[0]!.position).toMatchObject({ kind: 'commit', cursor: r });
  }
});

it.each(['memory', 'sqlite'] as const)('F14 [%s] (Query Answer) a consultation answer saved after the real health commit carries R and P across a retry and a reopen', async (kind) => {
  let action: (() => Promise<void>) | null = null;
  let sent: SessionMessage | null = null;
  const runtimeBudget: RuntimeBudget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
    maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };
  const f = await open({
    kind,
    duty: 'secretary',
    ownedHost: true,
    allowSourceRead: true,
    scriptedReplies: [{ kind: 'text', text: 'F14q sender done' }],
    queryReplies: [{ kind: 'text', text: 'F14q consultation answer' }],
    beforeReply: async () => { const run = action; action = null; if (run !== null) await run(); },
  });

  // A real read-only Query recipient Session through the public lifecycle, with
  // the SAME installed role_spec the primary Session pins (the active policy
  // matrix registers `builder`).
  const sourceSession = await f.platform.sessions.readSession(f.ctx, f.sessionRef);
  if (sourceSession.status !== 'ready') throw new Error(`F14q source Session: ${JSON.stringify(sourceSession)}`);
  const recipient = await f.platform.runtime.createSession(f.ctx, {
    workspace: f.scope, role: sourceSession.value.record.role, recommendedRefs: [], initialLinks: [],
    meta: { requestId: 'f14q-recipient', expected: [] } });
  expect(recipient).toMatchObject({ status: 'completed' });
  if (recipient.status !== 'completed') return;
  const recipientRef: SessionRef = { projectId: recipient.value.ref.projectId, sessionId: recipient.value.ref.sessionId };

  // S enters and sends the inquiry.
  const preparedS = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.runRef!, requestId: 'f14q-prepare-s' }));
  if (preparedS.status !== 'ready') throw new Error(`F14q prepare S: ${JSON.stringify(preparedS)}`);
  action = async () => {
    const result = await f.platform.messages.sendMessage(f.workCtx(), { input: { recipient: recipientRef,
      text: 'F14q which file?', intent: 'inquiry', needsReply: true, waitAfterSend: false },
      meta: { requestId: 'f14q-send', expected: [] } });
    if (result.status !== 'committed') throw new Error(`F14q send: ${JSON.stringify(result)}`);
    sent = result.value;
  };
  await f.platform.runtime.startRun(f.ctx, { prepared: preparedS.value, consumerId: 'f14q-s', requestId: 'f14q-start-s' });
  const message = sent!;

  // R: the real health writer makes S unavailable, taken from the commit log.
  const beforeHealth = f.commits().length;
  // The real unreadable-Kernel observation: the mapped database is moved aside,
  // probed, observed, and restored for the reads that follow.
  const queryAside = await moveKernelAside(f.directory);
  try {
    const card = await f.platform.sessions.readSession(f.ctx, f.sessionRef);
    if (card.status !== 'ready') throw new Error(`F14q health Session read: ${JSON.stringify(card)}`);
    const probe = await f.platform.reconcile.probe(card.value.record, f.ctx.signal);
    const health = await f.platform.reconcile.recordSessionHealth(f.ctx, { sessionRef: f.sessionRef, probe });
    expect((health as { status?: string }).status).not.toBe('rejected');
  } finally {
    await restoreKernel(f.directory, queryAside);
  }
  const healthCommits = f.commits().slice(beforeHealth)
    .filter(notice => notice.aggregates.some(aggregate => aggregate.aggregateType === 'Session'));
  expect(healthCommits).toHaveLength(1);
  const r = String(healthCommits[0]!.cursor);

  const readDto = async () => {
    const read = f.platform.messages.readUndeliveredReplies;
    if (read === undefined) throw new Error('the platform mailbox does not expose readUndeliveredReplies');
    // §5.2 line 308/§8.5: the DTO read commits nothing and calls no model.
    const commitsBefore = f.commits().length;
    const callsBefore = f.scripted.calls();
    const queryCallsBefore = f.queryScripted.calls();
    const dto = await read(f.ctx, { sessionRef: f.sessionRef, page: { limit: 100 } });
    expect(f.commits().length).toBe(commitsBefore);
    expect(f.scripted.calls()).toBe(callsBefore);
    expect(f.queryScripted.calls()).toBe(queryCallsBefore);
    if (dto.status !== 'ready') throw new Error(`F14q DTO: ${JSON.stringify(dto)}`);
    return dto.value.items;
  };
  const readNoticePosition = async () => {
    const page = await quietRead(f, () => f.platform.decisions.queryDecisionQueue(f.ctx, {
      workspace: f.scope, goalRef: f.goalRef, sections: ['notices'], categories: ['undelivered_reply'], page: { limit: 100 } }));
    if (page.status !== 'ready') throw new Error(`F14q notices: ${JSON.stringify(page)}`);
    expect(page.value.notices).toHaveLength(1);
    return page.value.notices[0]!.position;
  };

  // P: the real Query Answer writer through the public Workflow consultation.
  const consultationRequest = { schemaVersion: 1 as const, messageRef: message.ref, goalRef: f.goalRef,
    roleBinding: f.roleBinding, runtimeBudget, budget: { maxTokens: 200000, deadline: null }, consumerId: 'wp2-f14q-consumer' };
  const answered = await f.platform.workflow.consumeConsultation!(f.ctx, consultationRequest);
  if (answered.status !== 'ready' || answered.value.state !== 'responded') {
    throw new Error(`F14q consultation: ${JSON.stringify(answered)}`);
  }
  expect(answered).toMatchObject({ status: 'ready', value: { state: 'responded' } });
  const firstAnswer = answered.value;
  // P and the reply identity come from the reply command's own committed event
  // (the approved full-commit observation seam), never from a read of the record.
  const replyCommit = f.preparedCommits().find(commit => commit.events.some(event =>
    event.eventType === 'SessionMessageResponded'
    && (JSON.parse(event.json) as { message?: { ref?: { messageId?: string } } }).message?.ref?.messageId === message.ref.messageId));
  expect(replyCommit).toBeDefined();
  if (replyCommit === undefined) return;
  const replyEvent = JSON.parse(replyCommit.events.find(event => event.eventType === 'SessionMessageResponded')!.json) as
    { message?: { response?: { bodyRef?: { kind: string; digest: string }; respondedAt?: string } } };
  const responseRef = replyEvent.message?.response?.bodyRef;
  const respondedAt = replyEvent.message?.response?.respondedAt;
  expect(responseRef).toBeDefined();
  expect(typeof respondedAt).toBe('string');
  if (responseRef === undefined || respondedAt === undefined) return;
  const p = replyCommit.cursor;
  expect(p).not.toBe(r);

  const readMessage = async () => {
    const read = await f.platform.messages.readMessage(f.ctx, message.ref);
    if (read.status !== 'ready') throw new Error(`F14q message read: ${JSON.stringify(read)}`);
    return read.value;
  };
  const first = await readMessage();
  expect(first.status).toBe('responded');
  expect(first.responseSince).toBe(p);
  // The literal Query answer body is readable through the public body port.
  const answerBody = await quietRead(f, () => f.platform.messages.readMessageBody(f.ctx,
    { messageRef: message.ref, part: 'response' }));
  expect(answerBody).toMatchObject({ status: 'ready', value: { part: 'response', text: 'F14q consultation answer' } });

  const expectedItem = { kind: 'retired_reply' as const, messageRef: message.ref, sourceSessionRef: f.sessionRef,
    responseRef, respondedAt, hasContinuation: false,
    requiresUserRecipient: true, unavailableSince: r, responseSince: p };
  expect(await readDto()).toEqual([expectedItem]);
  // The Query answer's notice position is P (the answer is later than R).
  expect(await readNoticePosition()).toMatchObject({ kind: 'commit', cursor: p });

  // Same-request retry. NOTE (UNSPECIFIED): no public entry reaches the
  // `respondFromQueryAnswer` writer's OWN receipt replay with the same request
  // identity. The writer is wired only inside the Workflow port's
  // `consultations.messages` (create-platform.ts:1185-1188), not on the public
  // `messages` port (create-platform.ts:955-969), and a retried
  // `consumeConsultation` returns at consultation.ts:152 before the writer. This
  // retry therefore exercises the consultation's early-return projection (the
  // one saved reply and P do not move), not the writer's replay.
  const retried = await f.platform.workflow.consumeConsultation!(f.ctx, consultationRequest);
  expect(retried).toMatchObject({ status: 'ready', value: { state: 'responded' } });
  expect(await readDto()).toEqual([expectedItem]);
  const afterRetry = await readMessage();
  expect(afterRetry.response).toEqual(first.response);
  expect(afterRetry.responseSince).toBe(p);
  if (retried.status === 'ready') expect(retried.value).toEqual(firstAnswer);

  // Reopen: the SAME request is reissued through the public Workflow, and the
  // complete result, the complete DTO, the notice position and the stored
  // message all stay identical (no second reply).
  if (kind === 'sqlite') await f.reopen();
  const reopened = await f.platform.workflow.consumeConsultation!(f.ctx, consultationRequest);
  expect(reopened).toMatchObject({ status: 'ready', value: { state: 'responded' } });
  if (reopened.status === 'ready') expect(reopened.value).toEqual(firstAnswer);
  expect(await readDto()).toEqual([expectedItem]);
  expect(await readNoticePosition()).toMatchObject({ kind: 'commit', cursor: p });
  const afterReopen = await readMessage();
  expect(afterReopen.response).toEqual(first.response);
  expect(afterReopen.responseSince).toBe(p);
});





it.each(['memory', 'sqlite'] as const)('F10 [%s] (Query recovery) the real Query recovery retires its Session at the recovery commit and the position survives a retry and a reopen', async (kind) => {
  let releaseQ!: () => void;
  const gate = new Promise<void>(resolve => { releaseQ = resolve; });
  let qEntered!: () => void;
  const qEnteredP = new Promise<void>(resolve => { qEntered = resolve; });
  let action: (() => Promise<void>) | null = null;
  let sent: SessionMessage | null = null;
  const runtimeBudget: RuntimeBudget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
    maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };
  const f = await open({
    kind,
    duty: 'secretary',
    ownedHost: true,
    allowSourceRead: true,
    allowAnyRun: true,
    scriptedReplies: [{ kind: 'text', text: 'F10q sender done' }],
    queryReplies: [{ kind: 'text', text: 'F10q query answer' }],
    beforeReply: async () => { const run = action; action = null; if (run !== null) await run(); },
    beforeQueryReply: async () => { qEntered(); await gate; },
  });
  const readNotices = async () => {
    const page = await quietRead(f, () => f.platform.decisions.queryDecisionQueue(f.ctx, {
      workspace: f.scope, sections: ['notices'], categories: ['undelivered_reply'], page: { limit: 100 } }));
    if (page.status !== 'ready') throw new Error(`F10q notices: ${JSON.stringify(page)}`);
    return page.value.notices;
  };

  // S enters and sends an inquiry; the consultation then derives its read-only
  // Query Session and stays in flight on the gated Query model.
  const preparedS = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.runRef!, requestId: 'f10q-prepare-s' }));
  if (preparedS.status !== 'ready') throw new Error(`F10q prepare S: ${JSON.stringify(preparedS)}`);
  action = async () => {
    const result = await f.platform.messages.sendMessage(f.workCtx(), { input: { recipient: f.sessionRef,
      text: 'F10q which file?', intent: 'inquiry', needsReply: true, waitAfterSend: false },
      meta: { requestId: 'f10q-send', expected: [] } });
    if (result.status !== 'committed') throw new Error(`F10q send: ${JSON.stringify(result)}`);
    sent = result.value;
  };
  await f.platform.runtime.startRun(f.ctx, { prepared: preparedS.value, consumerId: 'f10q-s', requestId: 'f10q-start-s' });
  const message = sent!;
  const consulting = f.platform.workflow.consumeConsultation!(f.ctx, { schemaVersion: 1, messageRef: message.ref,
    goalRef: f.goalRef, roleBinding: f.roleBinding, runtimeBudget, budget: { maxTokens: 200000, deadline: null },
    consumerId: 'wp2-f10q-consumer' });
  await qEnteredP;

  // The in-flight QueryRun and its real Session come from the public directory.
  const listed = await f.platform.sessions.findSessions(f.ctx, { workspace: f.scope, includeArchived: true, page: { limit: 100 } });
  if (listed.status !== 'ready') throw new Error(`F10q sessions: ${JSON.stringify(listed)}`);
  const queryCard = listed.value.items.map(card => card.record).find(record =>
    record.occupancy?.kind === 'execution' && record.occupancy.executionRef.aggregateType === 'QueryRun');
  if (queryCard === undefined || queryCard.occupancy?.kind !== 'execution') throw new Error('F10q has no in-flight Query Session');
  const qref = queryCard.occupancy.executionRef;
  if (qref.aggregateType !== 'QueryRun') throw new Error('F10q occupancy is not a QueryRun');
  // The derived Query Session is not the original message sender, so it authors
  // no replied message: the notice source correctly reports no notice for it.
  expect(await readNotices()).toEqual([]);

  const read = await f.platform.reconcile.readQueryExecution(f.ctx, qref);
  if (read.status !== 'ready') throw new Error(`F10q read: ${JSON.stringify(read)}`);
  expect(read.value.run.run.executionState?.phase).toBe('entered');
  const beforeRecovery = f.commits().length;
  const probe = await f.platform.reconcile.probe(read.value.session, f.ctx.signal);
  const reconciled = await f.platform.reconcile.reconcileQuery(f.ctx, { record: read.value,
    hostInstanceId: 'wp2-host', probe });
  expect(reconciled).toMatchObject({ row: 'Q-04', status: 'reconciled' });
  // R is the ONE new Session-record commit of the real recovery, from the log.
  const healthCommits = f.commits().slice(beforeRecovery)
    .filter(notice => notice.aggregates.some(aggregate => aggregate.aggregateType === 'Session'));
  expect(healthCommits).toHaveLength(1);
  const r = String(healthCommits[0]!.cursor);
  const querySession = await f.platform.sessions.readSession(f.ctx, queryCard.ref);
  if (querySession.status !== 'ready') throw new Error(`F10q Session read: ${JSON.stringify(querySession)}`);
  expect(querySession.value.record).toMatchObject({ health: 'unavailable', unavailableSince: r });

  // The identical recovery request replays: the stored position does not move.
  const retryProbe = await f.platform.reconcile.probe(read.value.session, f.ctx.signal);
  const replayed = await f.platform.reconcile.reconcileQuery(f.ctx, { record: read.value,
    hostInstanceId: 'wp2-host', probe: retryProbe });
  expect(replayed).toMatchObject({ status: 'reconciled' });
  const afterRetry = await f.platform.sessions.readSession(f.ctx, queryCard.ref);
  expect(afterRetry.status === 'ready' ? afterRetry.value.record.unavailableSince : null).toBe(r);

  // Let the recovered Query settle before any reopen (platform close drains it).
  releaseQ();
  try { await consulting; } catch { /* the interrupted Query may settle after the recovery */ }

  // §5.2 F10: the derived Query Session authors no replied message, so its
  // correct notice set is the empty one — read AFTER the recovery on BOTH
  // backends, not only after an SQLite reopen.
  expect(await readNotices()).toEqual([]);
  if (kind === 'sqlite') {
    await f.reopen();
    const afterReopen = await f.platform.sessions.readSession(f.ctx, queryCard.ref);
    expect(afterReopen.status === 'ready' ? afterReopen.value.record.unavailableSince : null).toBe(r);
    expect(await readNotices()).toEqual([]);
  }
});

it.each(['memory', 'sqlite'] as const)('F10 [%s] (Query recovery, positive) a standalone Query on the reply-authoring Session retires it at the recovery commit and the saved reply becomes a notice', async (kind) => {
  let releaseQ!: () => void;
  const gate = new Promise<void>(resolve => { releaseQ = resolve; });
  let qEntered!: () => void;
  const qEnteredP = new Promise<void>(resolve => { qEntered = resolve; });
  let action: (() => Promise<void>) | null = null;
  let sent: SessionMessage | null = null;
  const runtimeBudget: RuntimeBudget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
    maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };
  const f = await open({
    kind,
    duty: 'secretary',
    secondWorld: true,
    ownedHost: true,
    allowSourceRead: true,
    allowAnyRun: true,
    scriptedReplies: [{ kind: 'text', text: 'F10p sender done' }, { kind: 'text', text: 'F10p replier done' }],
    queryReplies: [{ kind: 'text', text: 'F10p standalone query answer' }],
    beforeReply: async () => { const run = action; action = null; if (run !== null) await run(); },
    beforeQueryReply: async () => { qEntered(); await gate; },
  });
  const readNotices = async () => {
    const page = await quietRead(f, () => f.platform.decisions.queryDecisionQueue(f.ctx, {
      workspace: f.scope, sections: ['notices'], categories: ['undelivered_reply'], page: { limit: 100 } }));
    if (page.status !== 'ready') throw new Error(`F10p notices: ${JSON.stringify(page)}`);
    return page.value.notices;
  };

  // S's own Work Run sends the inquiry and ends, so S is an ordinary idle
  // Session that authors the message the reply will answer.
  const preparedS = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.runRef!, requestId: 'f10p-prepare-s' }));
  if (preparedS.status !== 'ready') throw new Error(`F10p prepare S: ${JSON.stringify(preparedS)}`);
  action = async () => {
    const result = await f.platform.messages.sendMessage(f.workCtx(), { input: { recipient: f.secondSessionRef!,
      text: 'F10p which file?', intent: 'inquiry', needsReply: true, waitAfterSend: false },
      meta: { requestId: 'f10p-send', expected: [] } });
    if (result.status !== 'committed') throw new Error(`F10p send: ${JSON.stringify(result)}`);
    sent = result.value;
  };
  await f.platform.runtime.startRun(f.ctx, { prepared: preparedS.value, consumerId: 'f10p-s', requestId: 'f10p-start-s' });
  const message = sent!;

  // A standalone semantic Query on the SAME Session, with no consultation
  // binding (query-execution.ts:910 keeps consultation optional): submit, claim,
  // prepare and start through the public ports. The Query enters and confirms
  // its inputs before the reply exists.
  const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', projectId: f.scope.projectId,
    workspaceId: f.scope.workspaceId, queryJobId: 'f10p-positive-job' };
  const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', projectId: f.scope.projectId,
    workspaceId: f.scope.workspaceId, queryJobId: 'f10p-positive-job', runId: 'f10p-positive-run' };
  const goalRead = await f.platform.plans.queryGoal(f.ctx, f.goalRef);
  const workspaceRead = await f.platform.projects.readWorkspaceRegistration(f.ctx, f.scope);
  const sessionCard = await f.platform.sessions.readSession(f.ctx, f.sessionRef);
  if (goalRead.status !== 'ready' || workspaceRead.status !== 'ready' || sessionCard.status !== 'ready') {
    throw new Error('F10p could not read the submit pins');
  }
  const intent: QueryJobIntentV1 = { schemaVersion: 1, intentId: queryJobRef.queryJobId,
    projectId: f.scope.projectId, workspaceId: f.scope.workspaceId, goalId: f.goalRef.goalId,
    question: 'read the current goal', focusTaskRefs: [], budget: { maxTokens: null, deadline: null },
    multiTurn: { maxRounds: 1 }, correlationId: 'f10p-positive-corr',
    execution: { kind: 'semantic_query', roleBinding: f.roleBinding, runtimeBudget } };
  const submitted = await f.platform.queries.submitQueryJob(f.ctx, { input: {
    queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent },
    meta: { requestId: 'f10p-submit', expected: [
      { ref: f.fixture.projectRef, revision: 1 }, { ref: f.fixture.workspaceRef, revision: workspaceRead.value.workspace.revision },
      { ref: f.goalRef, revision: goalRead.value.goal.revision },
      { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 }] } });
  expect(submitted).toMatchObject({ status: 'committed' });
  if (submitted.status !== 'committed') return;
  const claimed = await f.platform.queries.claimQuery(f.ctx, { input: { queryRunRef, sessionRef: f.sessionRef },
    meta: { requestId: 'f10p-claim', expected: [{ ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 },
      { ref: sessionCard.value.record.ref, revision: sessionCard.value.record.revision }] } });
  expect(claimed).toMatchObject({ status: 'committed' });
  if (claimed.status !== 'committed') return;
  const preparedQ = await f.platform.runtime.prepareQuery!(f.ctx, { queryRunRef, requestId: 'f10p-prepare-q' });
  expect(preparedQ).toMatchObject({ status: 'ready' });
  if (preparedQ.status !== 'ready') return;
  const startedQ = f.platform.runtime.startQuery!(f.ctx, { prepared: preparedQ.value, consumerId: 'f10p-q', requestId: 'f10p-start-q' });
  await qEnteredP;

  // The Work-origin reply is saved while the Query is in flight. The Query
  // already confirmed its inputs, so this late reply is never accepted; D's
  // Work Run finishes normally.
  const preparedD = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.secondRunRef!, requestId: 'f10p-prepare-d' }));
  if (preparedD.status !== 'ready') throw new Error(`F10p prepare D: ${JSON.stringify(preparedD)}`);
  action = async () => {
    const replied = await f.platform.messages.respondMessage(f.secondWorkCtx(), {
      input: { messageRef: message.ref, text: 'F10p saved reply' },
      meta: { requestId: 'f10p-reply', expected: [{ ref: message.ref, revision: message.revision }] } });
    if (replied.status !== 'committed') throw new Error(`F10p reply: ${JSON.stringify(replied)}`);
  };
  await f.platform.runtime.startRun(f.ctx, { prepared: preparedD.value, consumerId: 'f10p-d', requestId: 'f10p-start-d' });

  // The in-flight QueryRun and its Session come from the public directory.
  const listed = await f.platform.sessions.findSessions(f.ctx, { workspace: f.scope, includeArchived: true, page: { limit: 100 } });
  if (listed.status !== 'ready') throw new Error(`F10p sessions: ${JSON.stringify(listed)}`);
  const queryCard = listed.value.items.map(card => card.record).find(record =>
    record.occupancy?.kind === 'execution' && record.occupancy.executionRef.aggregateType === 'QueryRun');
  if (queryCard === undefined || queryCard.occupancy?.kind !== 'execution') throw new Error('F10p has no in-flight Query Session');
  expect(queryCard.ref).toEqual(sessionCard.value.record.ref);
  const qref = queryCard.occupancy.executionRef;
  if (qref.aggregateType !== 'QueryRun') throw new Error('F10p occupancy is not a QueryRun');

  // The real unknown-plus-recognition path makes S unavailable at its own
  // commit. R is the ONE new Session-record commit of the recognition writer.
  const read = await f.platform.reconcile.readQueryExecution(f.ctx, qref);
  if (read.status !== 'ready') throw new Error(`F10p read: ${JSON.stringify(read)}`);
  // The real unreadable-Kernel path: move the mapped database aside, probe the
  // Query's own Session, record the unknown end, and restore the database before
  // the recognition writer reads the Kernel.
  const aside = await moveKernelAside(f.directory);
  try {
    const probe = await f.platform.reconcile.probe(read.value.session, f.ctx.signal);
    const unknown = await f.platform.reconcile.reconcileQuery(f.ctx, { record: read.value,
      hostInstanceId: 'wp2-host', probe });
    expect(unknown).toMatchObject({ row: 'Q-05', status: 'reconciled' });
  } finally {
    await restoreKernel(f.directory, aside);
  }
  const unknownRead = await f.platform.reconcile.readQueryExecution(f.ctx, qref);
  if (unknownRead.status !== 'ready') throw new Error(`F10p unknown read: ${JSON.stringify(unknownRead)}`);
  const beforeRecovery = f.commits().length;
  const recognized = await f.platform.resolveUnknownQueryRun(f.ctx, { input: { queryRunRef: qref, reason: 'F10p recognition' },
    meta: { requestId: 'f10p-recognize', expected: [{ ref: qref, revision: unknownRead.value.run.revision }] } });
  expect(recognized).toMatchObject({ status: 'committed' });
  const healthCommits = f.commits().slice(beforeRecovery)
    .filter(notice => notice.aggregates.some(aggregate => aggregate.aggregateType === 'Session'));
  expect(healthCommits).toHaveLength(1);
  const r = String(healthCommits[0]!.cursor);

  // Let the recovered Query settle before reading (platform close drains it).
  releaseQ();
  try { await startedQ; } catch { /* the interrupted Query may settle after the recognition */ }

  // §5.2 F10: the reply saved on S becomes a new unseen notice at R. The
  // notice is already visible at the recognition commit; it is not a readback.
  const notices = await readNotices();
  expect(notices).toHaveLength(1);
  expect(notices[0]!.position).toMatchObject({ kind: 'commit', cursor: r });
  expect(notices[0]!.summary).toContain('未送达回复');
  // The in-flight Query never accepted the late reply.
  const repliedMessage = await f.platform.messages.readMessage(f.ctx, message.ref);
  expect(repliedMessage.status === 'ready'
    ? (repliedMessage.value.acceptedInputs ?? []).filter(entry => entry.part === 'response')
    : []).toHaveLength(0);

  if (kind === 'sqlite') {
    await f.reopen();
    const afterReopen = await readNotices();
    expect(afterReopen).toHaveLength(1);
    expect(afterReopen[0]!.position).toMatchObject({ kind: 'commit', cursor: r });
  }
});


it.each(['memory', 'sqlite'] as const)('F10 [%s] (Work recognition) attesting the unknown end of an in-flight Run retires the Session and the saved reply becomes a notice at that commit', async (kind) => {
  let releaseS!: () => void;
  const gate = new Promise<void>(resolve => { releaseS = resolve; });
  let sInFlight!: () => void;
  const sInFlightP = new Promise<void>(resolve => { sInFlight = resolve; });
  let sent: SessionMessage | null = null;
  let replyReceipt: { cursor: string; value: SessionMessage } | null = null;
  let call = 0;
  const f = await open({
    kind,
    duty: 'secretary',
    secondWorld: true,
    ownedHost: true,
    allowAnyRun: true,
    scriptedReplies: [{ kind: 'text', text: 'F10n S send done' }, { kind: 'text', text: 'F10n D reply done' }],
    beforeReply: async () => {
      const index = call++;
      if (index === 0) {
        const result = await f.platform.messages.sendMessage(f.workCtx(), { input: { recipient: f.secondSessionRef!,
          text: 'F10n which file should S use?', intent: 'inquiry', needsReply: true, waitAfterSend: false },
          meta: { requestId: 'f10n-send', expected: [] } });
        if (result.status !== 'committed') throw new Error(`F10n send: ${JSON.stringify(result)}`);
        sent = result.value;
        sInFlight();
        await gate;
        throw new Error('F10n S interrupted after the reply was saved');
      }
      const message = sent!;
      const replied = await f.platform.messages.respondMessage(f.secondWorkCtx(), {
        input: { messageRef: message.ref, text: 'F10n use result.txt' },
        meta: { requestId: 'f10n-reply', expected: [{ ref: message.ref, revision: message.revision }] } });
      if (replied.status !== 'committed') throw new Error(`F10n reply: ${JSON.stringify(replied)}`);
      replyReceipt = { cursor: String(replied.cursor), value: replied.value };
    },
  });
  const readNotices = async () => {
    const page = await quietRead(f, () => f.platform.decisions.queryDecisionQueue(f.ctx, { workspace: f.scope,
      sections: ['notices'], categories: ['undelivered_reply'], page: { limit: 100 } }));
    if (page.status !== 'ready') throw new Error(`F10n notices: ${JSON.stringify(page)}`);
    return page.value.notices;
  };

  const preparedS = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.runRef!, requestId: 'f10n-prepare-s' }));
  if (preparedS.status !== 'ready') throw new Error(`F10n prepare S: ${JSON.stringify(preparedS)}`);
  const runningS = f.platform.runtime.startRun(f.ctx, { prepared: preparedS.value, consumerId: 'f10n-s', requestId: 'f10n-start-s' });
  await sInFlightP;
  const preparedD = await observeStage(f, () => f.platform.runtime.prepareExecution(f.ctx, { runRef: f.secondRunRef!, requestId: 'f10n-prepare-d' }));
  if (preparedD.status !== 'ready') throw new Error(`F10n prepare D: ${JSON.stringify(preparedD)}`);
  await f.platform.runtime.startRun(f.ctx, { prepared: preparedD.value, consumerId: 'f10n-d', requestId: 'f10n-start-d' });
  expect(replyReceipt).not.toBeNull();
  const p = replyReceipt!.cursor;
  expect(await readNotices()).toEqual([]);

  // The Host's real reconcile cannot read the Kernel: the Run becomes
  // `outcome_unknown` (row W-14) and the Session is still available. The mapped
  // database is moved aside for the probe and restored before the recognition
  // writer reads it.
  const inFlight = await f.platform.executions.readExecution(f.ctx, f.runRef!);
  if (inFlight.status !== 'ready') throw new Error(`F10n record: ${JSON.stringify(inFlight)}`);
  const aside = await moveKernelAside(f.directory);
  try {
    const probe = await f.platform.reconcile.probe(inFlight.value.session, f.ctx.signal);
    const unknown = await f.platform.reconcile.reconcileRun(f.ctx, { record: inFlight.value,
      hostInstanceId: 'wp2-host', probe });
    expect(unknown).toMatchObject({ row: 'W-14', status: 'reconciled' });
  } finally {
    await restoreKernel(f.directory, aside);
  }
  const unknownRun = await f.platform.executions.readExecution(f.ctx, f.runRef!);
  if (unknownRun.status !== 'ready') throw new Error(`F10n unknown record: ${JSON.stringify(unknownRun)}`);
  expect(unknownRun.value.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });

  // Recognition: the operator attests the unknown end; this is the real
  // recognition writer and it binds R in its original commit.
  const beforeResolve = f.commits().length;
  const resolved = await f.platform.resolveUnknownRun(f.ctx, { input: { runRef: f.runRef!, reason: 'F10n recognition' },
    meta: { requestId: 'f10n-resolve', expected: [{ ref: f.runRef!, revision: unknownRun.value.run.revision }] } });
  expect(resolved).toMatchObject({ status: 'committed' });
  const healthCommits = f.commits().slice(beforeResolve)
    .filter(notice => notice.aggregates.some(aggregate => aggregate.aggregateType === 'Session'));
  expect(healthCommits).toHaveLength(1);
  const r = String(healthCommits[0]!.cursor);
  expect(r).not.toBe(p);
  const notices = await readNotices();
  expect(notices).toHaveLength(1);
  expect(notices[0]!.position).toMatchObject({ kind: 'commit', cursor: r });
  expect(notices[0]!.summary).toContain('未送达回复');

  // Let the interrupted Run settle BEFORE any reopen (close drains it).
  releaseS();
  try { await runningS; } catch { /* the interrupted Run may settle after the recognition */ }

  if (kind === 'sqlite') {
    await f.reopen();
    const afterReopen = await readNotices();
    expect(afterReopen).toHaveLength(1);
    expect(afterReopen[0]!.position).toMatchObject({ kind: 'commit', cursor: r });
  }
});
