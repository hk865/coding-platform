/**
 * C1 SessionMailbox tool-adapter contract (Stage 1 skeleton, RED where it needs
 * real mailbox behavior).
 *
 * The suite never starts a model: it builds the fixed tool definitions and
 * executes their handlers directly with trusted Kernel-shaped `ToolCall`s. The
 * strict schemas, the trusted closure, the requestId derivation and the effect
 * classes are exercised against a recording mailbox; the real end-to-end flow
 * (send -> inbox -> body -> ack -> response -> sender read) uses the REAL
 * SessionMailbox over the REAL Memory/SQLite Store and MaterialPort.
 *
 * The Stage 1 mailbox skeleton genuinely returns `unsupported`, so the
 * end-to-end success assertions are RED and frozen for the implementation
 * phase.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createC1Harness, type C1Harness } from '../helpers/C1-mailbox-fixture.js';
import type { ClaimFixtureKind } from '../helpers/task-claim-fixture.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import { SESSION_MESSAGE_CONTENT_TYPE } from '../../src/core/work-graph/communication/message-record-codecs.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import type { SessionMailboxPort, SessionMessage } from '../../src/core/work-graph/communication/contracts.js';
import { createSessionMailboxTools, SESSION_MAILBOX_TOOL_NAMES } from '../../src/core/agent-runtime/communication-tools.js';
import type { ToolCall, ToolResult, WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';

const AT = '2026-09-26T00:00:00.000Z';
const KINDS = ['memory', 'sqlite'] as const;
const signal = () => new AbortController().signal;

function toolCall(name: string, callId: string, args: Record<string, unknown>): ToolCall {
  return { schemaVersion: 1, callId, name, arguments: args as ToolCall['arguments'] };
}

function outputValue(result: ToolResult): unknown {
  if (result.status !== 'success') return undefined;
  const first = result.output[0];
  return first !== undefined && first.kind === 'json' ? first.value : undefined;
}

// --------------------------------------------------------------------------
// Recording mailbox: adapter-level tests observe the exact accepted command.
// --------------------------------------------------------------------------

function fakeMessage(recipient: SessionRef, text: string): SessionMessage {
  const ref: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: recipient.projectId, workspaceId: 'c1-tool-workspace', messageId: `m-${text}` };
  const source = { kind: 'workspace' as const, refId: 'c1-tool-workspace', revision: '1' };
  return {
    ref, schemaVersion: 1, revision: 1,
    sender: { kind: 'host', actor: { kind: 'human', id: 'c1-tool-host' } },
    recipient, bodyRef: { kind: 'artifact', contentType: SESSION_MESSAGE_CONTENT_TYPE, digest: 'a'.repeat(64), sizeBytes: 1, source },
    sourceRef: source, createdAt: AT, status: 'pending', readAt: null, response: null,
  };
}

type RecordedSend = { ctx: CoreCallContext; request: { input: { recipient: SessionRef; text: string }; meta: { requestId: string; expected: readonly unknown[] } } };
type RecordedWrite = { ctx: CoreCallContext; request: { input: unknown; meta: { requestId: string; expected: readonly unknown[] } } };

function recordingMailbox() {
  const sends: RecordedSend[] = [];
  const acks: RecordedWrite[] = [];
  const responds: RecordedWrite[] = [];
  let seq = 0;
  const cursor = () => `c${String(++seq).padStart(10, '0')}` as CommitCursor;
  const port: SessionMailboxPort = {
    async sendMessage(ctx, request) {
      sends.push({ ctx, request: request as unknown as RecordedSend['request'] });
      return { status: 'committed', value: fakeMessage(request.input.recipient, request.input.text), replayed: false, cursor: cursor() };
    },
    async readMessage() { return { status: 'not_found' }; },
    async readMessageBody() { return { status: 'not_found' }; },
    async readInbox() { return { status: 'ready', value: { items: [], nextCursor: null, sourceCursor: cursor() } }; },
    async ackMessage(ctx, request) {
      acks.push({ ctx, request: request as unknown as RecordedWrite['request'] });
      return { status: 'committed', value: fakeMessage({ projectId: request.input.messageRef.projectId, sessionId: 'recipient' }, 'ack'), replayed: false, cursor: cursor() };
    },
    async respondMessage(ctx, request) {
      responds.push({ ctx, request: request as unknown as RecordedWrite['request'] });
      return { status: 'committed', value: fakeMessage({ projectId: request.input.messageRef.projectId, sessionId: 'recipient' }, 'respond'), replayed: false, cursor: cursor() };
    },
  };
  return { port, sends, acks, responds };
}

const hostCtx = (projectId: string, workspaceId: string): CoreCallContext => ({
  projectId, workspaceId,
  principal: { kind: 'host', actor: { kind: 'human', id: 'c1-tool-host' } },
  materialReader: { kind: 'host', projectId, workspaceId, actor: { kind: 'human', id: 'c1-tool-host' } },
  signal: signal(),
});

const HOST_WORKSPACE = 'c1-tool-workspace';
const HOST_PROJECT = 'c1-tool-project';
const recipient: SessionRef = { projectId: HOST_PROJECT, sessionId: 'c1-tool-recipient' };
const messageRef: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: HOST_PROJECT, workspaceId: HOST_WORKSPACE, messageId: 'm-1' };

function buildTools(mailbox: SessionMailboxPort, context: CoreCallContext = hostCtx(HOST_PROJECT, HOST_WORKSPACE), sessionRef: SessionRef = recipient) {
  const handle = createSessionMailboxTools({ mailbox, context, sessionRef, requestIdForCall: call => `c1:${call.callId}` });
  const definitions = handle.create(null as unknown as WorkspaceSandbox);
  const byName = (name: string) => {
    const definition = definitions.find(candidate => candidate.name === name);
    if (definition === undefined) throw new Error(`missing tool ${name}`);
    return definition;
  };
  return { handle, definitions, byName };
}

// --------------------------------------------------------------------------
// Adapter group (items 9, 10, 12)
// --------------------------------------------------------------------------

describe('C1 SessionMailbox tool adapter', () => {
  it('publishes exactly the six fixed names and matching definitions', () => {
    const { port } = recordingMailbox();
    const { handle, definitions } = buildTools(port);
    expect(handle.names).toEqual([...SESSION_MAILBOX_TOOL_NAMES]);
    expect(definitions.map(definition => definition.name)).toEqual([...SESSION_MAILBOX_TOOL_NAMES]);
  });

  it('rejects every forbidden permission/source field instead of ignoring it', async () => {
    const { port, sends } = recordingMailbox();
    const { byName } = buildTools(port);
    const definition = byName('send_session_message');
    const base = { recipient, text: 'hi' };
    const forbidden: Record<string, unknown>[] = [
      { sender: { kind: 'host', actor: { kind: 'human', id: 'x' } } },
      { runRef: { aggregateType: 'Run', projectId: HOST_PROJECT, goalId: 'g', runId: 'r' } },
      { roleBinding: { schemaVersion: 1, bindingId: 'b', templateId: 't', templateRevision: '1', bindingVersion: 1, policyRevision: 'p' } },
      { principal: { kind: 'host', actor: { kind: 'human', id: 'x' } } },
      { materialReader: { kind: 'host', projectId: HOST_PROJECT } },
      { generation: 1 },
      { requestId: 'forged' },
      { bodyRef: { kind: 'artifact', digest: 'a'.repeat(64) } },
      { source: { kind: 'workspace', refId: HOST_WORKSPACE, revision: '1' } },
      { expected: [] },
    ];
    for (const extra of forbidden) {
      const result = await definition.handler.execute(
        toolCall('send_session_message', 'call-forbidden', { ...base, ...extra }), { signal: signal() });
      expect(result).toMatchObject({ status: 'error', error: { code: 'invalid_arguments' } });
    }
    expect(sends).toHaveLength(0);
  });

  it('derives one requestId from the trusted call id and freezes the accepted arguments', async () => {
    const { port, sends } = recordingMailbox();
    const { byName } = buildTools(port);
    const definition = byName('send_session_message');
    const firstArgs: Record<string, unknown> = { recipient: { ...recipient }, text: 'snapshot' };
    const firstCall = toolCall('send_session_message', 'call-stable', firstArgs);
    const pending = definition.handler.execute(firstCall, { signal: signal() });
    // Mutating the caller's argument object after acceptance must not change it.
    (firstArgs['recipient'] as Record<string, unknown>)['sessionId'] = 'mutated';
    firstArgs['text'] = 'mutated';
    await pending;
    expect(sends[0]?.request.meta.requestId).toBe('c1:call-stable');
    expect(sends[0]?.request.meta.expected).toEqual([]);
    expect(sends[0]?.request.input.recipient).toEqual(recipient);
    expect(sends[0]?.request.input.text).toBe('snapshot');

    await definition.handler.execute(toolCall('send_session_message', 'call-stable', { recipient, text: 'again' }), { signal: signal() });
    await definition.handler.execute(toolCall('send_session_message', 'call-other', { recipient, text: 'again' }), { signal: signal() });
    expect(sends[1]?.request.meta.requestId).toBe('c1:call-stable');
    expect(sends[2]?.request.meta.requestId).toBe('c1:call-other');
  });

  it('builds exactly one message pin for ack/respond and never accepts a model expected', async () => {
    const { port, acks, responds } = recordingMailbox();
    const { byName } = buildTools(port);
    const ack = await byName('ack_session_message').handler.execute(
      toolCall('ack_session_message', 'call-ack', { messageRef, expectedRevision: 3 }), { signal: signal() });
    expect(ack).toMatchObject({ status: 'success' });
    expect(acks[0]?.request.meta.expected).toEqual([{ ref: messageRef, revision: 3 }]);

    const respond = await byName('respond_session_message').handler.execute(
      toolCall('respond_session_message', 'call-respond', { messageRef, expectedRevision: 2, text: 'done' }), { signal: signal() });
    expect(respond).toMatchObject({ status: 'success' });
    expect(responds[0]?.request.meta.expected).toEqual([{ ref: messageRef, revision: 2 }]);

    const withExtraExpected = await byName('ack_session_message').handler.execute(
      toolCall('ack_session_message', 'call-extra', { messageRef, expectedRevision: 3, expected: [] }), { signal: signal() });
    expect(withExtraExpected).toMatchObject({ status: 'error', error: { code: 'invalid_arguments' } });
  });

  it('declares read_only for reads and a real platform side effect for writes', () => {
    const { port } = recordingMailbox();
    const { byName } = buildTools(port);
    expect(byName('read_session_inbox').effectClass).toBe('read_only');
    expect(byName('read_session_message').effectClass).toBe('read_only');
    expect(byName('read_session_message_body').effectClass).toBe('read_only');
    for (const name of ['send_session_message', 'ack_session_message', 'respond_session_message']) {
      expect(byName(name).effectClass).not.toBe('read_only');
    }
  });

  it('never falls back to a Host or a silent success on cancel, rejection or a failed binding', async () => {
    const { port } = recordingMailbox();
    const { byName } = buildTools(port);
    const definition = byName('send_session_message');
    const aborted = new AbortController();
    aborted.abort();
    const cancelled = await definition.handler.execute(toolCall('send_session_message', 'call-cancel', { recipient, text: 'x' }), { signal: aborted.signal });
    expect(cancelled).toMatchObject({ status: 'cancelled' });

    const rejecting: SessionMailboxPort = { ...port, async sendMessage() { return { status: 'rejected', code: 'forbidden', reason: 'not permitted' }; } };
    const rejected = await buildTools(rejecting).byName('send_session_message').handler.execute(
      toolCall('send_session_message', 'call-reject', { recipient, text: 'x' }), { signal: signal() });
    expect(rejected).toMatchObject({ status: 'error', error: { code: 'execution_failed' } });

    const throwing = buildTools(port, hostCtx(HOST_PROJECT, HOST_WORKSPACE));
    const withFailedBinding = createSessionMailboxTools({
      mailbox: port, context: hostCtx(HOST_PROJECT, HOST_WORKSPACE), sessionRef: recipient,
      requestIdForCall: () => { throw new Error('no bound Run'); },
    });
    const failed = await withFailedBinding.create(null as unknown as WorkspaceSandbox)
      .find(candidate => candidate.name === 'send_session_message')!
      .handler.execute(toolCall('send_session_message', 'call-nobind', { recipient, text: 'x' }), { signal: signal() });
    expect(failed).toMatchObject({ status: 'error', error: { code: 'execution_failed' } });
    expect(throwing.definitions).toHaveLength(6);
  });
});

// --------------------------------------------------------------------------
// Real end-to-end group (item 11) over the real mailbox/material/store
// --------------------------------------------------------------------------

const realHarnesses: C1Harness[] = [];
async function openReal(kind: ClaimFixtureKind): Promise<C1Harness> {
  const harness = await createC1Harness(kind);
  realHarnesses.push(harness);
  return harness;
}
afterEach(async () => {
  for (const harness of realHarnesses.splice(0)) await harness.close();
});

describe.each(KINDS)('C1 SessionMailbox tools against the real %s mailbox', kind => {
  it('drives send -> inbox -> body -> ack -> response -> sender read and only reports committed writes', async () => {
    const h = await openReal(kind);
    const tools = buildTools(h.mailbox, h.ctxWork, h.busySession);

    const sent = await tools.byName('send_session_message').handler.execute(
      toolCall('send_session_message', 'call-send', { recipient: h.busySession, text: 'tool message' }), { signal: signal() });
    expect(sent).toMatchObject({ status: 'success' });
    const receipt = outputValue(sent) as { value: SessionMessage; replayed: boolean; cursor: CommitCursor } | undefined;
    expect(receipt).toMatchObject({replayed:false});
    const sentValue = receipt?.value;
    if (sentValue === undefined) return;

    const inbox = await tools.byName('read_session_inbox').handler.execute(
      toolCall('read_session_inbox', 'call-inbox', { page: { limit: 10 } }), { signal: signal() });
    expect(inbox).toMatchObject({ status: 'success' });
    const inboxValue = outputValue(inbox) as { items: SessionMessage[] } | undefined;
    expect(inboxValue?.items.map(item => item.ref.messageId)).toContain(sentValue.ref.messageId);

    const body = await tools.byName('read_session_message_body').handler.execute(
      toolCall('read_session_message_body', 'call-body', { messageRef: sentValue.ref, part: 'message' }), { signal: signal() });
    expect(body).toMatchObject({ status: 'success' });
    expect(outputValue(body)).toMatchObject({ text: 'tool message', usage: 'message' });

    const acked = await tools.byName('ack_session_message').handler.execute(
      toolCall('ack_session_message', 'call-ack', { messageRef: sentValue.ref, expectedRevision: sentValue.revision }), { signal: signal() });
    expect(acked).toMatchObject({ status: 'success' });

    const responded = await tools.byName('respond_session_message').handler.execute(
      toolCall('respond_session_message', 'call-respond', { messageRef: sentValue.ref, expectedRevision: 2, text: 'done' }), { signal: signal() });
    expect(responded).toMatchObject({ status: 'success' });

    const senderRead = await tools.byName('read_session_message').handler.execute(
      toolCall('read_session_message', 'call-read', { messageRef: sentValue.ref }), { signal: signal() });
    expect(senderRead).toMatchObject({ status: 'success' });
    expect(outputValue(senderRead)).toMatchObject({ status: 'responded' });
  });

  it('rejects a cross-scope recipient through the real mailbox', async () => {
    const h = await openReal(kind);
    const tools = buildTools(h.mailbox, h.ctxHost, h.busySession);
    const foreign: SessionRef = { projectId: 'c1-other-project', sessionId: 'c1-other-session' };
    const result = await tools.byName('send_session_message').handler.execute(
      toolCall('send_session_message', 'call-foreign', { recipient: foreign, text: 'cross scope' }), { signal: signal() });
    expect(result).toMatchObject({ status: 'error' });
  });

  it('does not change the Session record or open a model when the factory is built', async () => {
    const h = await openReal(kind);
    const sessions = createSessionDirectory({ records: h.backend.records, lookups: h.backend.records });
    const before = await sessions.readSession(h.ctxHost, h.busySession);
    expect(before).toMatchObject({ status: 'ready' });
    if (before.status !== 'ready') return;
    buildTools(h.mailbox, h.ctxWork, h.busySession);
    const after = await sessions.readSession(h.ctxHost, h.busySession);
    expect(after).toMatchObject({ status: 'ready' });
    if (after.status === 'ready') expect(after.value.record).toEqual(before.value.record);
  });
});
