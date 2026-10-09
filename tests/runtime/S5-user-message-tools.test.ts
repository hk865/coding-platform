/** Slice 5 TU01–TU07: real mailbox/decision owners and Runtime input supply. */
import { afterEach, describe, expect, it } from 'vitest';
import type { PreparedTaskExecution, PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import { artifactBodyDigest } from '../../src/contracts/artifact.js';
import type { UserDecisionBodyV1 } from '../../src/contracts/goal-decisions.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createExecutionEntryService, MANIFEST_CONTENT_TYPE } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createQueryJobService } from '../../src/core/work-graph/queries/query-job-service.js';
import { createSessionMailboxTools, USER_DECISION_TOOL_NAMES, type SessionMailboxToolsConfig } from '../../src/core/agent-runtime/communication-tools.js';
import { createMailboxInputSupply, deriveInputId, formatDecisionResponseInput } from '../../src/core/agent-runtime/execution-inputs.js';
import { createConsultationConsumer } from '../../src/business/workflow/consultation.js';
import type { ConsultationInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { RuntimeExecutionPort } from '../../src/core/agent-runtime/ports.js';
import { createCollaborationDriver, type CollaborationDriver, type CollaborationDriverDependencies,
  type CollaborationStartInput, type CollaborationState } from '../../src/app/collaboration-driver.js';
import type { WorkbenchQueryProfile } from '../../src/app/runtime-configuration.js';
import { WorkspaceSandbox, type ToolCall, type ToolResult } from '../../vendor/coding-agent/dist/public-api.js';
import { GOAL_B, T, openS5DecisionFixture, type S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { committed, ready, realOwners, workContext, refKey, sendDecision, answerPins,
  decisionInput, modelRequests, type RealOwners } from '../helpers/S5-user-message-support.js';

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
    expect(formatDecisionResponseInput(answer.body)).toBe('用户答复\n' + canonicalJson(original));
    const supply = createMailboxInputSupply({ messages: owners.mailbox, context: () => workContext(f, run),
      sessionRef: f.claimRB.sessionRef, runRef: run.ref });
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
    const supply = createMailboxInputSupply({ messages: owners.mailbox, context: () => workContext(f, run), sessionRef, runRef: run.ref });
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

// TU07 keeps the matching-profile positive control and drives the real pump.
// RB is authorized before start; the workflow callback enters it and sends its
// message while the pump is running, matching the driver's freshStart guard.
async function preparePumpRun(f: S5DecisionFixture) {
  const templateEnvelope = f.runRA.envelope;
  if (templateEnvelope === null) throw new Error('entered RA has no saved envelope');
  const raw = await f.bodies.read(templateEnvelope.bundleRef);
  if (raw.status !== 'ready') throw new Error('entered RA manifest missing');
  const template: PreparedTaskManifestV1 = JSON.parse(raw.value.body);
  const claim = f.claimRB;
  const manifest: PreparedTaskManifestV1 = { ...template, claim };
  const json = JSON.stringify(manifest);
  const stored = await f.bodies.put({ body: json, contentType: MANIFEST_CONTENT_TYPE,
    sourceRefs: [{ kind: 'workspace', refId: 'W', revision: '3' }],
    origin: { kind: 'run', owner: claim.runRef }, requestedAt: T });
  if (stored.status !== 'ready') throw new Error('RB manifest could not be stored');
  const prepared: PreparedTaskExecution = {
    kind: 'task', claim,
    envelope: { ...templateEnvelope, taskId: claim.task.taskId, runRef: claim.runRef,
      attemptRef: claim.attemptRef, planRef: claim.planRef, bundleRef: stored.value.ref },
    inputBinding: { schemaVersion: 1, inputDigest: manifest.inputDigest,
      manifestDigest: artifactBodyDigest(json), materialAccessRefs: [], additionalMaterialRefs: [], deliveryRefs: [] },
  };
  const reads = createRunStateReader({ records: f.records });
  const entry = createExecutionEntryService({ records: f.records, reads,
    roles: createRoleConfigurationService({ records: f.records, now: f.now, eventId: f.newId }),
    bodies: f.bodies, now: f.now, eventId: f.newId, newId: f.newId,
    authorizeConfiguration: async (_ctx, input) => ({ status: 'ready', value: {
      configurationRevision: input.configurationRevision,
      permissions: structuredClone(input.permissions), hostTemplate: structuredClone(input.hostTemplate),
    } }),
  });
  const read = () => reads.readExecution(f.ctx, claim.runRef).then(ready);
  const before = await read();
  expect(before.run).toMatchObject({ status: 'starting', revision: 1 });
  const authorized = committed(await entry.authorizeRuntimeEntry(f.ctx, {
    input: { prepared, consumerId: 'tu07-work' },
    meta: { requestId: 'tu07-authorize', expected: [{ ref: claim.runRef, revision: before.run.revision }] },
  }));
  expect((await read()).run.executionAuthorization).toMatchObject({ phase: 'authorized' });
  return { prepared, reads, async enter() {
    const current = await read();
    const kernel = { adapterId: current.session.kernel.adapterId, kernelSessionId: current.session.kernel.kernelSessionId,
      runId: 'tu07-kernel-run', turnId: 'tu07-kernel-turn' };
    const begun = committed(await entry.beginRuntimeEntry(f.ctx, {
      input: { permit: authorized.value, kernel },
      meta: { requestId: 'tu07-begin', expected: [{ ref: claim.runRef, revision: current.run.revision }] },
    }));
    const entering = await read();
    return committed(await entry.recordExecutionEntered(f.ctx, {
      input: { permit: { ...authorized.value, authorizationRevision: begun.value.authorization.revision },
        enteredAt: T, kernelSource: { ...kernel, position: 3 },
        history: { kernel, startPosition: 2, observedThroughPosition: 3, endPosition: null } },
      meta: { requestId: 'tu07-enter', expected: [{ ref: claim.runRef, revision: entering.run.revision }] },
    })).value;
  } };
}

const unused = async (): Promise<never> => { throw new Error('TU07 reached an unused dependency'); };
function observedRuntime() {
  let queryStarts = 0;
  const runtime: RuntimeExecutionPort = {
    capabilities: unused, createSession: unused, readSessionHistory: unused, readExecutionHistory: unused,
    readTaskExecutionHistory: unused, prepareExecution: unused, startRun: unused, observeRun: unused,
    prepareQuery: unused, observeQuery: unused,
    startQuery: async () => { queryStarts++; throw new Error('TU07 must not start a Query model'); },
  };
  return { runtime, queryStarts: () => queryStarts };
}

function completedAdvance(): WorkflowAdvanceResult {
  return { status: 'ready', value: { state: 'completed', receipt: null, next: null, reason: 'pump scope finished' } };
}

async function pumpHarness(f: S5DecisionFixture, recipient: 'user' | 'session') {
  const prepared = await preparePumpRun(f);
  const owners = realOwners(f, ['adviser']);
  const sessions = createSessionDirectory({ records: f.records, lookups: f.records });
  // The profile exists and matches a real idle recipient in BOTH branches.
  const recipientSession = await f.createS5Session('tu07-recipient');
  const recipientCard = ready(await sessions.readSession(f.ctx, recipientSession));
  const profile: WorkbenchQueryProfile = {
    id: 'tu-profile', label: 'TU profile', scope: f.base.scope,
    runtimeBindingId: 'tu-binding', sessionRole: recipientCard.record.role, roleBinding: f.runRB.roleBinding,
    runtimeBudget: DEFAULT_RUNTIME_BUDGET, budget: { maxTokens: null, deadline: null }, consumerId: 'tu-consumer',
  };
  const observed = observedRuntime();
  let consumeCalls = 0;
  let message: SessionMessage | undefined;
  let resolveMessage!: (value: SessionMessage) => void;
  let rejectMessage!: (error: unknown) => void;
  const sent = new Promise<SessionMessage>((resolve, reject) => { resolveMessage = resolve; rejectMessage = reject; });
  let finish!: (result: WorkflowAdvanceResult) => void;
  const ongoing = new Promise<WorkflowAdvanceResult>(resolve => { finish = resolve; });
  const dependencies: CollaborationDriverDependencies = {
    workflow: {
      handleGoalInput: unused,
      async advanceWork() {
        try {
          const run = await prepared.enter();
          message = recipient === 'user'
            ? (await sendDecision(f, owners, 'tu07-user-send', run)).message
            : committed(await owners.mailbox.sendMessage(workContext(f, run), {
              input: { recipient: recipientSession, text: 'Please inspect this.', intent: 'inquiry', needsReply: true, waitAfterSend: true },
              meta: { requestId: 'tu07-inquiry-send', expected: [] },
            })).value;
          resolveMessage(message);
          return await ongoing;
        } catch (error) {
          // Surface a setup stub directly to the test, never as a pump timeout.
          rejectMessage(error);
          throw error;
        }
      },
      async consumeConsultation() {
        consumeCalls++;
        if (message === undefined) throw new Error('consultation before the real send');
        // Hold the first consultation until the assertion finishes, so a slow
        // test runner cannot turn the positive control into repeated polls.
        await ongoing;
        return { status: 'ready', value: { state: 'waiting', message, query: null, answer: null,
          reason: 'ordinary Session consultation reached its consumer' } };
      },
    },
    runtime: observed.runtime, sessions, executions: prepared.reads, mailbox: owners.mailbox,
    controls: { submitControl: unused, readControl: unused }, profiles: [profile],
  };
  const input: CollaborationStartInput = {
    advance: { schemaVersion: 1, goalRef: GOAL_B, flowId: 'tu-flow', sessionHint: f.claimRB.sessionRef,
      kind: 'perform', operation: { kind: 'start', request: {
        prepared: prepared.prepared, consumerId: 'tu07-work', requestId: 'tu07-start',
      } } },
    queryProfileIds: ['tu-profile'],
  };
  return { f, owners, sessions, input, sent, finish, ...observed,
    driver: createCollaborationDriver(dependencies), consumeCalls: () => consumeCalls };
}

async function waitForState(f: S5DecisionFixture, driver: CollaborationDriver, wanted: CollaborationState) {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const read = ready(await driver.read(f.ctx, { goalRef: GOAL_B }));
    if (read.state === wanted) return;
    if (read.state === 'failed' || Date.now() > deadline) throw new Error(`TU07 expected ${wanted}: ${JSON.stringify(read)}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('TU07 ordinary consultation never reached its consumer');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

describe('S5 user-decision consultation pump', () => {
  it('TU07 keeps a user decision wait out of the real Session consultation consumer and pump', async () => {
    const f = await openFixture();
    const userPump = await pumpHarness(f, 'user');
    try {
      ready(await userPump.driver.start(f.ctx, userPump.input));
      const message = await userPump.sent;
      await waitForState(f, userPump.driver, 'waiting_for_reply');
      expect(userPump.consumeCalls()).toBe(0);
      expect(userPump.queryStarts()).toBe(0);
      const before = await f.storeSnapshot();
      const recordDerivation = userPump.owners.mailbox.recordConsultationDerivation;
      if (recordDerivation === undefined) throw new Error('real mailbox lacks consultation derivation');
      const consumer = createConsultationConsumer({
        sessions: userPump.sessions,
        plans: createPlanService({ records: f.records, now: f.now, eventId: f.newId }),
        runtime: userPump.runtime,
        consultations: {
          messages: {
            readMessage: userPump.owners.mailbox.readMessage,
            readMessageBody: userPump.owners.mailbox.readMessageBody,
            respondFromQueryAnswer: userPump.owners.mailbox.respondFromQueryAnswer,
            recordConsultationDerivation: recordDerivation,
          },
          queries: createQueryJobService({ records: f.records, now: f.now, eventId: f.newId }),
          projects: { createProject: unused, registerWorkspace: unused, readWorkspaceRegistration: unused },
        },
      });
      const input: ConsultationInput = { schemaVersion: 1, messageRef: message.ref, goalRef: GOAL_B,
        roleBinding: f.runRB.roleBinding, runtimeBudget: DEFAULT_RUNTIME_BUDGET,
        budget: { maxTokens: null, deadline: null }, consumerId: 'tu07-consumer' };
      expect(await consumer(f.ctx, input)).toMatchObject({ status: 'rejected', code: 'unsupported' });
      expect(userPump.queryStarts()).toBe(0);
      expect(await f.storeSnapshot()).toEqual(before);
      userPump.finish(completedAdvance());
      await waitForState(f, userPump.driver, 'completed');
    } finally {
      userPump.finish(completedAdvance());
      await userPump.driver.close();
    }

    const other = await openFixture();
    const sessionPump = await pumpHarness(other, 'session');
    try {
      ready(await sessionPump.driver.start(other.ctx, sessionPump.input));
      await sessionPump.sent;
      await waitForState(other, sessionPump.driver, 'waiting_for_reply');
      await waitUntil(() => sessionPump.consumeCalls() > 0);
      expect(sessionPump.consumeCalls()).toBe(1);
      sessionPump.finish(completedAdvance());
      await waitForState(other, sessionPump.driver, 'completed');
    } finally {
      sessionPump.finish(completedAdvance());
      await sessionPump.driver.close();
    }
  });
});
