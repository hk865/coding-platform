/**
 * C2 Runtime platform-tool consumer (Stage 1 skeleton).
 *
 * Adapter-shape cases are GREEN: the frozen names, the read-only registration
 * label and the structured domain rejection are pure adapter behaviour.
 *
 * The real-consumer cases run over the production `createTargetPlatform`
 * composition (real SQLite ledger + real Kernel Session + real deployed Skill
 * resources + local scripted provider). They establish the prerequisites
 * successfully and then require the Runtime to actually consume the selected
 * platform tools. That consumer path is the phase-2 target; the Stage 1 seam
 * returns an explicit `unsupported` before the provider, so those cases are RED
 * for exactly that reason and are frozen for the implementation phase.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { SessionMailboxPort } from '../../src/core/work-graph/communication/contracts.js';
import { createSessionMailboxTools, SESSION_MAILBOX_TOOL_NAMES } from '../../src/core/agent-runtime/communication-tools.js';
import { WHITEBOARD_TOOL_NAMES } from '../../src/core/agent-runtime/whiteboard-tools.js';
import type { ModelRequest, ToolCall, ToolResult, WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import { ALL_PLATFORM_TOOL_NAMES, C2_SAFETY_PATH, C2_SKILL_IDS, createC2RuntimePlatform, type C2RuntimePlatformFixture } from '../helpers/C2-runtime-platform-fixture.js';

const fixtures: C2RuntimePlatformFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

const signal = () => new AbortController().signal;
const PROJECT = 'c2-tool-project';
const WORKSPACE = 'c2-tool-workspace';
const SESSION: SessionRef = { projectId: PROJECT, sessionId: 'c2-session' };

function toolCall(name: string, callId: string, args: Record<string, unknown>): ToolCall {
  return { schemaVersion: 1, callId, name, arguments: args as ToolCall['arguments'] };
}
function trustedContext(signalValue: AbortSignal): CoreCallContext {
  return { projectId: PROJECT, workspaceId: WORKSPACE,
    principal: { kind: 'work_run', runRef: { aggregateType: 'Run', projectId: PROJECT, goalId: 'c2-goal', runId: 'c2-run' },
      roleBinding: { schemaVersion: 1, bindingId: 'c2-binding', templateId: 'builder', templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' } },
    materialReader: { kind: 'run', requester: { aggregateType: 'Run', projectId: PROJECT, goalId: 'c2-goal', runId: 'c2-run' } },
    signal: signalValue };
}
function outputValue(result: ToolResult): unknown {
  const first = result.output[0];
  return first !== undefined && first.kind === 'json' ? first.value : undefined;
}
function toolMessage(request: ModelRequest | undefined, callId: string) {
  return request?.messages.find(message => message.role === 'tool' && message.callId === callId);
}
function toolJson(request: ModelRequest | undefined, callId: string): unknown {
  const message = toolMessage(request, callId);
  if (message === undefined || message.role !== 'tool' || message.result.status !== 'success') return undefined;
  const block = message.result.output.find(candidate => candidate.kind === 'json');
  return block?.kind === 'json' ? block.value : undefined;
}
function callArgs(reply: ScriptedReply | undefined): Record<string, unknown> | undefined {
  return reply !== undefined && reply.kind === 'calls' ? reply.calls[0]?.args : undefined;
}
async function skillBodies(): Promise<Record<string, string>> {
  const entries = await Promise.all(C2_SKILL_IDS.map(async id =>
    [id, await readFile(join(new URL('../../resources/skills', import.meta.url).pathname, id, 'content.md'), 'utf8')] as const));
  return Object.fromEntries(entries);
}

describe('C2 platform tool adapters', () => {
  it('publishes the six frozen mailbox names and the workspace_read read-only registration label', () => {
    const port: SessionMailboxPort = {
      async sendMessage() { return { status: 'rejected', code: 'unsupported', reason: 'unused' }; },
      async readMessage() { return { status: 'not_found' }; },
      async readMessageBody() { return { status: 'not_found' }; },
      async readInbox() { return { status: 'not_found' }; },
      async ackMessage() { return { status: 'rejected', code: 'unsupported', reason: 'unused' }; },
      async respondMessage() { return { status: 'rejected', code: 'unsupported', reason: 'unused' }; },
    };
    const handle = createSessionMailboxTools({ mailbox: port, context: trustedContext(signal()), sessionRef: SESSION,
      requestIdForCall: call => `c2:${call.name}:${call.callId}` });
    const definitions = handle.create(null as unknown as WorkspaceSandbox);
    expect(handle.names).toEqual([...SESSION_MAILBOX_TOOL_NAMES]);
    expect(definitions.map(definition => definition.name)).toEqual([...SESSION_MAILBOX_TOOL_NAMES]);
    for (const name of ['read_session_inbox', 'read_session_message', 'read_session_message_body']) {
      const definition = definitions.find(candidate => candidate.name === name)!;
      expect(definition.effectClass).toBe('read_only');
      expect(definition.requiredCapabilities).toEqual(['workspace_read']);
      expect(definition.independentReadOnly).toBe(true);
    }
    for (const name of ['send_session_message', 'ack_session_message', 'respond_session_message']) {
      const definition = definitions.find(candidate => candidate.name === name)!;
      expect(definition.effectClass).not.toBe('read_only');
      expect(definition.requiredCapabilities).toEqual([]);
      expect(definition.independentReadOnly).toBe(false);
    }
    expect(new Set([...SESSION_MAILBOX_TOOL_NAMES, ...WHITEBOARD_TOOL_NAMES]).size)
      .toBe(SESSION_MAILBOX_TOOL_NAMES.length + WHITEBOARD_TOOL_NAMES.length);
    for (const builtin of ['read', 'write', 'edit', 'shell', 'check']) expect(ALL_PLATFORM_TOOL_NAMES).not.toContain(builtin);
  });

  it('keeps a typed domain rejection in the JSON output instead of flattening it to execution_failed', async () => {
    const rejectedWrite = { status: 'rejected' as const, code: 'capacity' as const, reason: 'message text exceeds the bound' };
    const notReadyRead = { status: 'not_ready' as const, observed: null, required: { kind: 'platform' as const, cursor: 'c0000000005' as CommitCursor } };
    const port: SessionMailboxPort = {
      async sendMessage() { return rejectedWrite; },
      async readMessage() { return { status: 'not_found' }; },
      async readMessageBody() { return { status: 'not_found' }; },
      async readInbox() { return notReadyRead; },
      async ackMessage() { return rejectedWrite; },
      async respondMessage() { return rejectedWrite; },
    };
    const handle = createSessionMailboxTools({ mailbox: port, context: trustedContext(signal()), sessionRef: SESSION,
      requestIdForCall: call => `c2:${call.name}:${call.callId}` });
    const definitions = handle.create(null as unknown as WorkspaceSandbox);
    const send = definitions.find(candidate => candidate.name === 'send_session_message')!;
    const sendResult = await send.handler.execute(toolCall('send_session_message', 'call-send', { recipient: SESSION, text: 'hi' }), { signal: signal() });
    expect(sendResult.status).toBe('error');
    expect(outputValue(sendResult)).toEqual(rejectedWrite);
    const inbox = definitions.find(candidate => candidate.name === 'read_session_inbox')!;
    const inboxResult = await inbox.handler.execute(toolCall('read_session_inbox', 'call-inbox', { page: { limit: 10 } }), { signal: signal() });
    expect(outputValue(inboxResult)).toEqual(notReadyRead);
  });
});

describe('C2 real Runtime consumer over the production composition (phase-2 target)', () => {
  it('runs a real inbox -> body -> respond round through the model with the three deployed skills (RED)', async () => {
    const bodies = await skillBodies();
    const safety = await readFile(C2_SAFETY_PATH, 'utf8');
    expect(safety.trim().length).toBeGreaterThan(0);
    let messageRef: SessionMessageRef | undefined;
    let messageRevision: number | undefined;
    const replies: ScriptedReply[] = [
      { kind: 'calls', calls: [{ callId: 'c2-inbox-1', name: 'read_session_inbox', args: { page: { limit: 10 } } }] },
      { kind: 'calls', calls: [{ callId: 'c2-body-1', name: 'read_session_message_body', args: { messageRef: {}, part: 'message' } }] },
      { kind: 'calls', calls: [{ callId: 'c2-respond-1', name: 'respond_session_message', args: { messageRef: {}, expectedRevision: 1, text: 'C2 response text' } }] },
      { kind: 'text', text: 'C2 responded to the mailbox statement' },
    ];
    const fx = await createC2RuntimePlatform({ toolNames: ['read_session_inbox', 'read_session_message_body', 'respond_session_message'],
      scriptedReplies: replies,
      beforeReply: async (request, index) => {
        if (index === 1) {
          const inbox = toolJson(request, 'c2-inbox-1') as { items?: Array<{ ref: SessionMessageRef; revision: number }> } | undefined;
          expect(inbox).toMatchObject({ items: [{ ref: { aggregateType: 'SessionMessage' }, revision: 1 }] });
          messageRef = inbox?.items?.[0]?.ref;
          messageRevision = inbox?.items?.[0]?.revision;
          const args = callArgs(replies[1]);
          if (args !== undefined) args['messageRef'] = structuredClone(messageRef);
        }
        if (index === 2) {
          expect(toolJson(request, 'c2-body-1')).toMatchObject({ text: 'C2 inbox statement', part: 'message', usage: 'message' });
          const args = callArgs(replies[2]);
          if (args !== undefined) { args['messageRef'] = structuredClone(messageRef); args['expectedRevision'] = messageRevision; }
        }
      } });
    fixtures.push(fx);
    // Real prerequisite: the Host delivers a body to the execution Session.
    const sent = await fx.platform.messages.sendMessage(fx.ctx, { input: { recipient: fx.sessionRef, text: 'C2 inbox statement' }, meta: { requestId: 'c2-host-send', expected: [] } });
    expect(sent).toMatchObject({ status: 'committed' });
    if (sent.status !== 'committed') return;
    const prepared = await fx.platform.runtime.prepareExecution(fx.ctx, { runRef: fx.runRef, requestId: 'c2-prepare-mail' });
    expect(prepared.status, JSON.stringify(prepared)).toBe('ready');
    if (prepared.status !== 'ready') return;
    const started = await fx.platform.runtime.startRun(fx.ctx, { prepared: prepared.value, consumerId: 'c2-driver', requestId: 'c2-start-mail' });
    // Phase-2 target: real Kernel round, four provider calls, success results.
    expect(started, JSON.stringify(started)).toMatchObject({ status: 'ready', value: { run: { status: 'ended' }, session: { occupancy: null } } });
    expect(fx.scripted.calls()).toBe(4);
    const responseResult = toolMessage(fx.scripted.requests[3], 'c2-respond-1');
    expect(responseResult?.role === 'tool' ? responseResult.result.status : undefined).toBe('success');
    // The three deployed skill bodies and the trusted Host safety content are in
    // the first real request.
    const systemPrompt = fx.scripted.requests[0]?.systemPrompt ?? '';
    for (const id of C2_SKILL_IDS) expect(systemPrompt).toContain(bodies[id]);
    expect(systemPrompt).toContain(safety);
    // Public ledger proof: the original message is responded with the domain body.
    const stored = await fx.platform.messages.readMessage(fx.ctx, sent.value.ref);
    expect(stored).toMatchObject({ status: 'ready', value: { status: 'responded' } });
    if (stored.status !== 'ready') return;
    expect(stored.value.response?.sender).toEqual({ kind: 'work_run', sessionRef: fx.firstSession,
      runRef: fx.claim.runRef, roleBinding: fx.fixture.roleBinding, generation: fx.claim.generation });
    expect((stored.value.sender as { kind: string }).kind).toBe('host');
    expect(await fx.platform.messages.readMessageBody(fx.ctx, { messageRef: sent.value.ref, part: 'response' }))
      .toMatchObject({ status: 'ready', value: { text: 'C2 response text' } });
  });

  it('exposes only the granted platform tools, skips the source authorization, and honors an explicit empty Skill set (RED)', async () => {
    const toolNames = ['read_session_inbox', 'query_task_graph'];
    const fx = await createC2RuntimePlatform({ toolNames, skillIds: [], allowSourceRead: false,
      scriptedReplies: [
        { kind: 'calls', calls: [{ callId: 'c2-graph-1', name: 'query_task_graph', args: {} }] },
        { kind: 'text', text: 'C2 queried the graph without file read' },
      ] });
    fixtures.push(fx);
    const prepared = await fx.platform.runtime.prepareExecution(fx.ctx, { runRef: fx.runRef, requestId: 'c2-prepare-min' });
    expect(prepared.status, JSON.stringify(prepared)).toBe('ready');
    if (prepared.status !== 'ready') return;
    const started = await fx.platform.runtime.startRun(fx.ctx, { prepared: prepared.value, consumerId: 'c2-driver', requestId: 'c2-start-min' });
    expect(started, JSON.stringify(started)).toMatchObject({ status: 'ready' });
    expect(fx.scripted.calls()).toBe(2);
    // A platform-only Run never resolves the source read policy.
    expect(fx.authorizeCalls()).toBe(0);
    const names = (fx.scripted.requests[0]?.tools ?? []).map(spec => spec.name);
    expect([...names].sort()).toEqual([...toolNames].sort());
    for (const forbidden of ['read', 'edit', 'write', 'shell', 'list_files', 'project_source', 'send_session_message']) {
      expect(names).not.toContain(forbidden);
    }
    // An explicit empty Skill set must not fall back to any deployed skill.
    const bodies = await skillBodies();
    for (const id of C2_SKILL_IDS) expect(fx.scripted.requests[0]?.systemPrompt ?? '').not.toContain(bodies[id]);
  });

  it('rejects an ungranted builtin at the real Kernel boundary, with no source authorization and no file body (RED)', async () => {
    const fx = await createC2RuntimePlatform({ toolNames: ['read_session_inbox'], allowSourceRead: false,
      scriptedReplies: [
        { kind: 'calls', calls: [{ callId: 'c2-builtin-read', name: 'read', args: { path: 'c2-read.txt' } }] },
        { kind: 'text', text: 'C2 after the denied read' },
      ] });
    fixtures.push(fx);
    const prepared = await fx.platform.runtime.prepareExecution(fx.ctx, { runRef: fx.runRef, requestId: 'c2-prepare-denied' });
    expect(prepared.status, JSON.stringify(prepared)).toBe('ready');
    if (prepared.status !== 'ready') return;
    const started = await fx.platform.runtime.startRun(fx.ctx, { prepared: prepared.value, consumerId: 'c2-driver', requestId: 'c2-start-denied' });
    expect(started, JSON.stringify(started)).toMatchObject({ status: 'ready' });
    expect(fx.authorizeCalls()).toBe(0);
    const message = toolMessage(fx.scripted.requests[1], 'c2-builtin-read');
    expect(message).toBeDefined();
    if (message !== undefined && message.role === 'tool') {
      expect(message.result.status).toBe('error');
      if (message.result.status === 'error') expect(['unknown_tool', 'permission_denied']).toContain(message.result.error.code);
    }
    const requestText = JSON.stringify(fx.scripted.requests[1]?.messages ?? []);
    expect(requestText).not.toContain('C2_REAL_READ_CONTENT');
  });
});
