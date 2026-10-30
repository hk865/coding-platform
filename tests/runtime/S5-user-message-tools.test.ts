/** Slice 5 TU01–TU07: real mailbox/decision owners and Runtime input supply. */
import { afterEach, describe, expect, it } from 'vitest';
import type { UserDecisionBodyV1 } from '../../src/contracts/goal-decisions.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createSessionMailboxTools, USER_DECISION_TOOL_NAMES, type SessionMailboxToolsConfig } from '../../src/core/agent-runtime/communication-tools.js';
import { createMailboxInputSupply, deriveInputId, formatDecisionResponseInput } from '../../src/core/agent-runtime/execution-inputs.js';
import type { WorkflowPort } from '../../src/business/workflow/ports.js';
import { createCollaborationDriver, type CollaborationDriver,
  type CollaborationStartInput, type CollaborationState } from '../../src/app/collaboration-driver.js';
import type { WorkbenchQueryProfile } from '../../src/app/runtime-configuration.js';
import { WorkspaceSandbox, type ToolCall, type ToolResult } from '../../vendor/coding-agent/dist/public-api.js';
import { openS5DecisionFixture, type S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { committed, ready, realOwners, workContext, refKey, sendDecision, answerPins,
  decisionInput, modelRequests, type RealOwners } from '../helpers/S5-user-message-support.js';
import { createWP2Platform, decisionRequestArgs, type WP2PlatformFixture } from '../helpers/WP2-platform-support.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';

const signal = (): AbortSignal => new AbortController().signal;
const fixtures: S5DecisionFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });
async function openFixture(): Promise<S5DecisionFixture> {
  const fixture = await openS5DecisionFixture('memory');
  fixtures.push(fixture);
  return fixture;
}

function toolCall(name: string, callId: string, args: Record<string, unknown>): ToolCall {
  return { schemaVersion: 1, callId, name, arguments: args as ToolCall['arguments'] };
}
function outputValue(result: ToolResult): unknown {
  const first = result.output[0];
  return first !== undefined && first.kind === 'json' ? first.value : undefined;
}

type DecisionPort = NonNullable<SessionMailboxToolsConfig['decisionMessages']>;
/** Observe entry invocation; every invocation reaches the real owner. */
function countingOwner(real: DecisionPort) {
  const calls = { sends: 0, reads: 0, applications: 0 };
  const port: DecisionPort = {
    async sendUserMessage(ctx, request) { calls.sends++; return real.sendUserMessage(ctx, request); },
    async recordDecisionApplication(ctx, request) { calls.applications++; return real.recordDecisionApplication(ctx, request); },
    async readDecisionAnswer(ctx, input) { calls.reads++; return real.readDecisionAnswer(ctx, input); },
  };
  return { port, calls };
}

async function buildUserTools(f: S5DecisionFixture, owners: RealOwners,
  onWaitRegistered?: (message: SessionMessage) => void) {
  const owner = countingOwner(owners.decisionMessages);
  const handle = createSessionMailboxTools({
    mailbox: owners.mailbox, context: workContext(f), sessionRef: f.sessionS,
    requestIdForCall: call => `tu:${call.name}:${call.callId}`, decisionMessages: owner.port,
    ...(onWaitRegistered === undefined ? {} : { onWaitRegistered }),
  });
  const definitions = handle.create(await WorkspaceSandbox.create(f.base.directory));
  const byName = (name: string) => {
    const definition = definitions.find(candidate => candidate.name === name);
    if (definition === undefined) throw new Error(`missing tool ${name}`);
    return definition;
  };
  return { handle, definitions, byName, calls: owner.calls };
}

async function answerFromRun(f: S5DecisionFixture, owners: RealOwners, run: RunSnapshot,
  body: UserDecisionBodyV1, requestId: string) {
  const { message, card } = await sendDecision(f, owners, `${requestId}-send`, run);
  const answer = committed(await owners.decisions.answerDecision(f.ctx, {
    input: { source: card.source, selection: body.selection, text: body.text, annotations: body.annotations },
    meta: { requestId: `${requestId}-answer`, expected: answerPins(message) },
  }));
  expect(answer.value).toMatchObject({ ref: message.ref, status: 'responded', revision: 2,
    response: { decision: { source: { kind: 'message',
      key: decisionSourceKey({ kind: 'message', messageRef: message.ref }) },
      selection: body.selection, annotations: body.annotations } } });
  expect(ready(await owners.mailbox.readMessage(f.ctx, message.ref))).toEqual(answer.value);
  return answer.value;
}

describe('S5 user-decision runtime tools', () => {
  it('TU01 adviser send_user_message registers the actual committed wait once', async () => {
    const f = await openFixture();
    const owners = realOwners(f, ['adviser']);
    const waits: SessionMessage[] = [];
    const tools = await buildUserTools(f, owners, message => waits.push(message));
    const before = await f.storeSnapshot();
    const result = await tools.byName('send_user_message').handler.execute(
      toolCall('send_user_message', 'tu01-call', decisionInput(f)), { signal: signal() });
    expect(result.status).toBe('success');
    expect(tools.calls).toEqual({ sends: 1, reads: 0, applications: 0 });
    expect(waits).toHaveLength(1);
    const wait = waits[0];
    if (wait === undefined) throw new Error('committed user wait not registered');
    const saved = ready(await owners.mailbox.readMessage(f.ctx, wait.ref));
    // Rebase onto slice 1 (lead): the stored Message reads with the slice-1 §2.9 defaults.
    expect(saved).toEqual({ ...wait, replyHandler: null, archiveWaitDisposition: null });
    expect(outputValue(result)).toMatchObject({ message: wait });
    expect(saved).toMatchObject({ recipient: { kind: 'user', projectId: 'P', workspaceId: 'W' },
      status: 'pending', revision: 1, intent: 'decision_request', needsReply: true, waitAfterSend: true,
      sender: { kind: 'work_run', sessionRef: f.sessionS, runRef: f.runRA.ref } });
    expect(result.effects.sideEffect).toBe('none');
    const after = await f.storeSnapshot();
    expect(after.eventCount - before.eventCount).toBe(1);
    expect(modelRequests(after)).toEqual(modelRequests(before));
  });

  it('TU02 model-supplied operatorActor is invalid_arguments with zero owner calls and no send', async () => {
    const f = await openFixture();
    const tools = await buildUserTools(f, realOwners(f, ['adviser']));
    const args = { ...decisionInput(f), operatorActor: { kind: 'human', id: 'forged' } };
    expect(tools.byName('send_user_message').inputSchema.safeParse(args).success).toBe(false);
    const before = await f.storeSnapshot();
    const allocations = { ...f.allocationCounts };
    const result = await tools.byName('send_user_message').handler.execute(
      toolCall('send_user_message', 'tu02-call', args), { signal: signal() });
    expect(result).toMatchObject({ status: 'error', error: { code: 'invalid_arguments' } });
    expect(tools.calls).toEqual({ sends: 0, reads: 0, applications: 0 });
    expect(await f.storeSnapshot()).toEqual(before);
    expect(f.allocationCounts).toEqual(allocations);
  });

  it('TU03 executor decision send preserves owner forbidden and registers no wait', async () => {
    const f = await openFixture();
    const waits: SessionMessage[] = [];
    const tools = await buildUserTools(f, realOwners(f, ['executor']), message => waits.push(message));
    const before = await f.storeSnapshot();
    const result = await tools.byName('send_user_message').handler.execute(
      toolCall('send_user_message', 'tu03-call', decisionInput(f)), { signal: signal() });
    expect(result).toMatchObject({ status: 'error', error: { code: 'execution_failed' } });
    expect(outputValue(result)).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(waits).toEqual([]);
    expect(tools.calls).toEqual({ sends: 1, reads: 0, applications: 0 });
    expect(await f.storeSnapshot()).toEqual(before);
  });

  it('TU04 an option-only answer has nonempty wire payload, empty original text and complete formatted input', async () => {
    const f = await openFixture();
    const owners = realOwners(f, ['adviser']);
    const run = await f.enterClaim(f.claimRB);
    const original: UserDecisionBodyV1 = { schemaVersion: 1, kind: 'user_decision_response',
      selection: { kind: 'option', optionId: 'accept' }, text: '', annotations: [] };
    const message = await answerFromRun(f, owners, run, original, 'tu04');
    expect(message.response).not.toBeNull();
    if (message.response === null) throw new Error('fixture has no original response');
    // Read wire bytes at the body store, separately from the public original-text reader.
    const wire = await f.bodies.read(message.response.bodyRef);
    expect(wire.status).toBe('ready');
    if (wire.status !== 'ready') throw new Error('original wire body missing');
    const envelope: { text: string } = JSON.parse(wire.value.body);
    expect(envelope.text).toBe(canonicalJson(original));
    expect(Buffer.byteLength(envelope.text, 'utf8')).toBeGreaterThan(0);
    const before = await f.storeSnapshot();
    if (message.decision === undefined) throw new Error('fixture answer has no source');
    const answer = ready(await owners.decisions.readDecisionAnswer(f.ctx, { source: message.decision.source }));
    expect(answer.body).not.toBeNull();
    if (answer.body === null) throw new Error('readDecisionAnswer omitted the original body');
    expect(answer).toEqual({ message, body: original });
    const body = ready(await owners.mailbox.readMessageBody(f.ctx, { messageRef: message.ref, part: 'response' }));
    expect(body.text).toBe('');
    expect(formatDecisionResponseInput(PLATFORM_PROMPT_PACK_V1, answer.body, [])).toBe('用户答复\n' + canonicalJson(original));
    const supply = createMailboxInputSupply({ messages: owners.mailbox, context: () => workContext(f, run),
      sessionRef: f.claimRB.sessionRef, runRef: run.ref, texts: PLATFORM_PROMPT_PACK_V1, toolNames: [] });
    const inputs = await supply({ sessionId: f.claimRB.sessionRef.sessionId, runId: run.ref.runId,
      turnId: 'tu-turn', afterEventSequence: 0, acceptedInputIds: [] }, { signal: signal() });
    expect(inputs).toEqual([{ inputId: deriveInputId(message.ref, 'response'),
      text: '用户答复\n' + canonicalJson(original), sourceRef: { kind: 'SessionMessage', messageRef: message.ref, part: 'response' } }]);
    expect(await f.storeSnapshot()).toEqual(before);
  });

  it('TU05 supplies the exact answer once and skips it after the real accepted-input commit', async () => {
    const f = await openFixture();
    const run = await f.enterClaim(f.claimRB);
    const owners = realOwners(f, ['adviser']);
    const body: UserDecisionBodyV1 = { schemaVersion: 1, kind: 'user_decision_response',
      selection: { kind: 'option', optionId: 'accept' }, text: '  keep this\n\nexactly  ',
      annotations: [{ objectKey: refKey(decisionInput(f).objects[1]!), text: 'fm annotation' }] };
    const message = await answerFromRun(f, owners, run, body, 'tu05');
    const ref = message.ref;
    const sessionRef = f.claimRB.sessionRef;
    const supply = createMailboxInputSupply({ messages: owners.mailbox, context: () => workContext(f, run), sessionRef, runRef: run.ref,
      texts: PLATFORM_PROMPT_PACK_V1, toolNames: [] });
    const point = { sessionId: sessionRef.sessionId, runId: run.ref.runId, turnId: 'tu-turn', afterEventSequence: 0, acceptedInputIds: [] };
    const before = await f.storeSnapshot();
    const first = await supply(point, { signal: signal() });
    expect(first).toEqual([{ inputId: deriveInputId(ref, 'response'), text: '用户答复\n' + canonicalJson(body),
      sourceRef: { kind: 'SessionMessage', messageRef: ref, part: 'response' } }]);
    expect(await f.storeSnapshot()).toEqual(before);
    const execution = ready(await createRunStateReader({ records: f.records }).readExecution(f.ctx, run.ref));
    const kernel = execution.run.executionHistory?.kernel;
    if (kernel === undefined) throw new Error('entered Run has no saved Kernel history');
    const recordAccepted = owners.mailbox.recordInputAccepted;
    if (recordAccepted === undefined) throw new Error('mailbox lacks accepted-input owner');
    const accepted = committed(await recordAccepted(workContext(f, run), {
      input: { messageRef: ref, part: 'response', executionRef: run.ref, kernel: { ...kernel, position: 7 } },
      meta: { requestId: 'tu05-accept', expected: [] },
    }));
    expect(accepted.value).toMatchObject({ status: 'responded', revision: 3,
      acceptedInputs: [{ inputId: deriveInputId(ref, 'response'), part: 'response', executionRef: run.ref,
        kernel: { ...kernel, position: 7 }, acceptedAt: '2026-10-08T00:00:00.000Z' }] });
    expect(ready(await owners.mailbox.readMessage(f.ctx, ref))).toEqual(accepted.value);
    const afterAccepted = await f.storeSnapshot();
    expect(afterAccepted.eventCount - before.eventCount).toBe(1);
    const second = await supply(point, { signal: signal() });
    expect(second).toEqual([]);
    expect(await f.storeSnapshot()).toEqual(afterAccepted);
    expect(first[0]?.text).toBe('用户答复\n' + canonicalJson(body));
    expect(modelRequests(afterAccepted)).toEqual(modelRequests(before));
  });

  it('TU06 exposes no answer_decision and reads the original answer without writes', async () => {
    const f = await openFixture();
    const owners = realOwners(f, ['adviser']);
    const original: UserDecisionBodyV1 = { schemaVersion: 1, kind: 'user_decision_response',
      selection: { kind: 'option', optionId: 'accept' }, text: '', annotations: [] };
    const message = await answerFromRun(f, owners, f.runRA, original, 'tu06');
    const tools = await buildUserTools(f, owners);
    expect([...tools.handle.names]).not.toContain('answer_decision');
    expect(USER_DECISION_TOOL_NAMES).not.toContain('answer_decision');
    expect(tools.definitions.find(definition => definition.name === 'answer_decision')).toBeUndefined();
    expect(tools.byName('read_user_decision').effectClass).toBe('read_only');
    if (message.decision === undefined) throw new Error('original answer source missing');
    const before = await f.storeSnapshot();
    const allocations = { ...f.allocationCounts };
    const result = await tools.byName('read_user_decision').handler.execute(
      toolCall('read_user_decision', 'tu06-read', { source: message.decision.source }), { signal: signal() });
    expect(result.status).toBe('success');
    expect(outputValue(result)).toEqual({ message, body: original });
    expect(tools.calls).toEqual({ sends: 0, reads: 1, applications: 0 });
    expect(await f.storeSnapshot()).toEqual(before);
    expect(f.allocationCounts).toEqual(allocations);
  });
});

// TU07 drives the real Runtime and the real Workflow: the scripted model sends
// its wait through the real tool and is then held at a real gate; the driver's
// consultation pump is the only consumer of a Session wait, and the real
// consultation consumer refuses the user-recipient message.
type ChangeFeed = { onChange: () => void; version: () => number; wait: (seen: number) => Promise<void> };
function changeFeed(): ChangeFeed {
  let version = 0;
  const waiters: Array<() => void> = [];
  return {
    onChange() { version += 1; for (const resolve of waiters.splice(0)) resolve(); },
    version: () => version,
    wait(seen) {
      if (version > seen) return Promise.resolve();
      return new Promise<void>(resolve => { waiters.push(resolve); });
    },
  };
}

type PumpWorld = {
  p: WP2PlatformFixture;
  claim: NonNullable<WP2PlatformFixture['claim']>;
  roleBinding: RunSnapshot['roleBinding'];
  driver: CollaborationDriver;
  feed: ChangeFeed;
  input: CollaborationStartInput;
  replyReached: Promise<void>;
  releaseReply: () => void;
  consultReached: Promise<void>;
  releaseConsult: () => void;
  consultFinished: Promise<void>;
  consumeCalls: () => number;
  advanceCalls: () => number;
};

/**
 * One real WP2 world: the composition's real Runtime/Workflow, the claimed Run's
 * real prepared value, an idle recipient Session and the scripted model's real
 * `send_user_message`/`send_session_message` call. Every wrapper only counts,
 * holds the real dependency at a gate, and returns its result unchanged.
 */
async function openPump(recipient: 'user' | 'session'): Promise<PumpWorld> {
  let releaseReply!: () => void;
  const replyGate = new Promise<void>(resolve => { releaseReply = resolve; });
  let replyReached!: () => void;
  const replyReachedPromise = new Promise<void>(resolve => { replyReached = resolve; });
  const scriptedReplies: ScriptedReply[] = [];
  const p = await createWP2Platform({
    kind: 'memory', duty: 'secretary', check: true, checkRequirementKind: 'static',
    workflowBound: true, ownedHost: true, allowAnyRun: true,
    allowSourceRead: true,
    scriptedReplies,
    queryReplies: [{ kind: 'text', text: 'TU07 consultation answer' }],
    // The user wait does not yield: the model's next request after the real send
    // is the controlled gate. A Session wait does yield (the real Runtime's
    // after-group barrier), so its own saved wait is the controlled hold.
    ...(recipient === 'user' ? {
      beforeReply: async (_request: unknown, index: number) => {
        if (index === 1) { replyReached(); await replyGate; }
      },
    } : {}),
  });
  try {
    const claim = p.claim;
    if (claim === null) throw new Error('TU07 needs a claimed Run');
    const source = ready(await p.platform.sessions.readSession(p.ctx, p.sessionRef));
    const run = ready(await p.platform.executions.readExecution(p.ctx, claim.runRef));
    const created = await p.platform.runtime.createSession(p.ctx, {
      workspace: p.scope, role: source.record.role, recommendedRefs: [], initialLinks: [],
      meta: { requestId: 'tu07-recipient', expected: [] } });
    if (created.status !== 'completed') throw new Error(`TU07 recipient Session: ${JSON.stringify(created)}`);
    const recipientRef = { projectId: created.value.ref.projectId, sessionId: created.value.ref.sessionId };
    scriptedReplies.push(
      { kind: 'calls', calls: [recipient === 'user'
        ? { callId: 'tu07-user-send', name: 'send_user_message',
          args: decisionRequestArgs(p.goalRef, { waitAfterSend: false }) }
        : { callId: 'tu07-inquiry-send', name: 'send_session_message',
          args: { recipient: recipientRef, text: 'Please inspect this.', intent: 'inquiry',
            needsReply: true, waitAfterSend: true } }] },
      { kind: 'text', text: 'TU07 final reply' },
    );
    const prepared = await p.platform.runtime.prepareExecution(p.ctx, {
      runRef: claim.runRef, requestId: 'tu07-prepare' });
    if (prepared.status !== 'ready') throw new Error(`TU07 prepareExecution: ${JSON.stringify(prepared)}`);

    const real = p.platform.workflow;
    const consume = real.consumeConsultation;
    if (consume === undefined) throw new Error('TU07 the real Workflow has no consultation consumer');
    let consumeCalls = 0;
    let advanceCalls = 0;
    let releaseConsult!: () => void;
    const consultGate = new Promise<void>(resolve => { releaseConsult = resolve; });
    let consultReached!: () => void;
    const consultReachedPromise = new Promise<void>(resolve => { consultReached = resolve; });
    let consultFinished!: () => void;
    const consultFinishedPromise = new Promise<void>(resolve => { consultFinished = resolve; });
    const workflow: WorkflowPort = {
      handleGoalInput: real.handleGoalInput,
      async advanceWork(ctx, input, internal) {
        advanceCalls += 1;
        return real.advanceWork(ctx, input, internal);
      },
      async consumeConsultation(ctx, input) {
        consumeCalls += 1;
        consultReached();
        await consultGate;
        try { return await consume.call(real, ctx, input); }
        finally { consultFinished(); }
      },
    };
    const profile: WorkbenchQueryProfile = {
      id: 'tu-profile', label: 'TU profile', scope: p.scope,
      runtimeBindingId: 'tu-binding', sessionRole: source.record.role, roleBinding: run.run.roleBinding,
      runtimeBudget: DEFAULT_RUNTIME_BUDGET, budget: { maxTokens: null, deadline: null },
      consumerId: 'tu-consumer',
    };
    const feed = changeFeed();
    const driver = createCollaborationDriver({
      workflow, runtime: p.platform.runtime, sessions: p.platform.sessions,
      executions: p.platform.executions, mailbox: p.platform.messages,
      controls: p.platform.controls, profiles: [profile], onChange: feed.onChange,
    });
    const input: CollaborationStartInput = {
      advance: { schemaVersion: 1, goalRef: p.goalRef, flowId: 'tu-flow', sessionHint: claim.sessionRef,
        taskId: claim.task.taskId,
        kind: 'perform', operation: { kind: 'start', request: {
          prepared: prepared.value, consumerId: 'tu07-work', requestId: 'tu07-start',
        } } },
      queryProfileIds: ['tu-profile'],
    };
    return { p, claim, roleBinding: run.run.roleBinding, driver, feed, input,
      replyReached: replyReachedPromise, releaseReply,
      consultReached: consultReachedPromise, releaseConsult,
      consultFinished: consultFinishedPromise,
      consumeCalls: () => consumeCalls, advanceCalls: () => advanceCalls };
  } catch (error) {
    await p.close();
    throw error;
  }
}

/** Read the real saved wait through the sender Run's public outbox. */
async function outboxMessage(world: PumpWorld): Promise<SessionMessage> {
  const readOutbox = world.p.platform.messages.readOutbox;
  if (readOutbox === undefined) throw new Error('TU07 the mailbox has no readOutbox');
  const read = ready(await readOutbox.call(world.p.platform.messages,
    world.p.workCtx(world.claim.runRef), { senderRun: world.claim.runRef, page: { limit: 10 } }));
  const message = read.items.find(candidate => candidate.sender.kind === 'work_run');
  if (message === undefined) throw new Error('TU07 the real send saved no wait message');
  return message;
}

/** The public reads a no-op consumer call must leave untouched, plus the real commit log. */
async function publicState(world: PumpWorld, message: SessionMessage) {
  return {
    message: ready(await world.p.platform.messages.readMessage(world.p.ctx, message.ref)),
    session: ready(await world.p.platform.sessions.readSession(world.p.ctx, world.p.sessionRef)),
    goal: ready(await world.p.platform.plans.queryGoal(world.p.ctx, world.p.goalRef)),
    commits: world.p.commits().length,
  };
}

/** Wait on the driver's real change feed (never a sleep) for one public state. */
async function waitForDriverState(world: PumpWorld, wanted: CollaborationState): Promise<void> {
  let seen = world.feed.version();
  for (;;) {
    const read = ready(await world.driver.read(world.p.ctx, { goalRef: world.p.goalRef }));
    if (read.state === wanted) return;
    if (read.state === 'failed'
      || (wanted === 'waiting_for_reply' && read.state !== 'running')
      || (wanted === 'completed' && read.state !== 'running' && read.state !== 'waiting_for_reply')) {
      throw new Error(`TU07 expected ${wanted}: ${JSON.stringify(read)}`);
    }
    await world.feed.wait(seen);
    seen = world.feed.version();
  }
}

describe('S5 user-decision consultation pump', () => {
  it('TU07 keeps a user decision wait out of the real Session consultation consumer and pump', async () => {
    const user = await openPump('user');
    try {
      ready(await user.driver.start(user.p.ctx, user.input));
      await user.replyReached;
      await waitForDriverState(user, 'waiting_for_reply');
      const message = await outboxMessage(user);
      expect(user.consumeCalls()).toBe(0);
      expect(user.p.queryScripted.calls()).toBe(0);
      const before = await publicState(user, message);
      const consume = user.p.platform.workflow.consumeConsultation;
      if (consume === undefined) throw new Error('TU07 the real Workflow has no consultation consumer');
      const refused = await consume.call(user.p.platform.workflow, user.p.ctx, {
        schemaVersion: 1, messageRef: message.ref, goalRef: user.p.goalRef,
        roleBinding: user.roleBinding, runtimeBudget: DEFAULT_RUNTIME_BUDGET,
        budget: { maxTokens: null, deadline: null }, consumerId: 'tu07-consumer' });
      expect(refused).toMatchObject({ status: 'rejected', code: 'unsupported' });
      expect(user.p.queryScripted.calls()).toBe(0);
      expect(await publicState(user, message)).toEqual(before);
      expect(user.p.commits().length).toBe(before.commits);
      user.releaseReply();
      await waitForDriverState(user, 'completed');
      expect(user.advanceCalls()).toBeGreaterThan(0);
    } finally {
      user.releaseReply();
      await user.driver.close();
      await user.p.close();
    }

    const other = await openPump('session');
    try {
      ready(await other.driver.start(other.p.ctx, other.input));
      await waitForDriverState(other, 'waiting_for_reply');
      await other.consultReached;
      expect(other.consumeCalls()).toBe(1);
      other.releaseConsult();
      await other.consultFinished;
      expect(other.consumeCalls()).toBe(1);
      expect(other.p.queryScripted.calls()).toBe(1);
      other.releaseReply();
      await waitForDriverState(other, 'completed');
    } finally {
      other.releaseConsult();
      other.releaseReply();
      await other.driver.close();
      await other.p.close();
    }
  });
});
