/**
 * Common-orchestration mechanism tests for the Host-facing seams.
 *
 * Two mechanisms are exercised without any model or network:
 *   - the mechanical attention observer (heartbeat, added+deleted file deltas,
 *     graph deltas, coalescing, no semantic pre-filter, no model on no change);
 *   - the unified SessionMailbox send intent (independent intent / needsReply /
 *     waitAfterSend, legacy replyMode normalization, and the one real wait
 *     registration that the Kernel barrier turns into a yielded Run).
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAttentionObserver,
  graphChangedElements,
  lineDelta,
} from '../../src/app/attention-observer.js';
import { createSessionMailboxTools } from '../../src/core/agent-runtime/communication-tools.js';
import type { SessionMailboxPort, SessionMessage } from '../../src/core/work-graph/communication/contracts.js';
import type { ToolCall, WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';
import {
  attentionConfig,
  fileStamp,
  graphStamp,
} from '../helpers/orchestration-fixture.js';
import { createC1Harness, type C1Harness } from '../helpers/C1-mailbox-fixture.js';

describe('mechanical attention observer', () => {
  it('produces no delivery and no model work when nothing changed', () => {
    const observer = createAttentionObserver(attentionConfig());
    const snapshot = { messageCursor: null, pendingInputs: 0, files: [], graph: null };
    expect(observer.observe(snapshot, 0)).toBeNull();
    expect(observer.observe(snapshot, 10_000)).toBeNull();
    expect(observer.processed).toBeNull();
  });

  it('derives a real same-size replacement from the two texts', () => {
    expect(lineDelta('a\nb\nc', 'a\nx\nc')).toEqual({ added: 1, deleted: 1, totalLines: 3 });
    const observer = createAttentionObserver(attentionConfig({ files: { minChangedLines: 2, minRatio: 1, scopePrefixes: ['.'] } }));
    observer.prime({ messageCursor: null, pendingInputs: 0, files: [fileStamp('src/a.ts', 'v1', 'a\nb\nc')], graph: null });
    const delivery = observer.observe({ messageCursor: null, pendingInputs: 0, files: [fileStamp('src/a.ts', 'v2', 'a\nx\nc')], graph: null }, 10);
    expect(delivery?.signals[0]).toEqual({ kind: 'file_delta', added: 1, deleted: 1, changedFiles: ['src/a.ts'] });
  });

  it('treats a removed path as a real tombstone deletion', () => {
    const observer = createAttentionObserver(attentionConfig({ files: { minChangedLines: 1, minRatio: 1, scopePrefixes: ['.'] } }));
    observer.prime({ messageCursor: null, pendingInputs: 0, files: [fileStamp('src/a.ts', 'v1', 'a\nb')], graph: null });
    const removed = observer.observe({ messageCursor: null, pendingInputs: 0, files: [fileStamp('src/a.ts', null, null)], graph: null }, 10);
    expect(removed?.signals[0]).toEqual({ kind: 'file_delta', added: 0, deleted: 2, changedFiles: ['src/a.ts'] });
  });

  it('does not re-deliver an unchanged version and clears a reverted buffered change', () => {
    const observer = createAttentionObserver(attentionConfig({ files: { minChangedLines: 1, minRatio: 1, scopePrefixes: ['.'] } }));
    const changed = { messageCursor: null, pendingInputs: 0, files: [fileStamp('src/a.ts', 'v2', 'a\nx')], graph: null };
    const delivered = observer.observe(changed, 0);
    expect(delivered?.signals[0]?.kind).toBe('file_delta');
    observer.markDelivered(changed, delivered!.signals);
    expect(observer.observe(changed, 1_000)).toBeNull();
  });

  it('buffers a below-threshold change and still runs the heartbeat', () => {
    const observer = createAttentionObserver(attentionConfig({ heartbeatMs: 100, maxCoalesceMs: 5_000, files: { minChangedLines: 100, minRatio: 0.5, scopePrefixes: ['.'] } }));
    const big = (head: string): string => Array.from({ length: 1_000 }, (_value, index) => (index === 0 ? head : `line-${index}`)).join('\n');
    observer.prime({ messageCursor: null, pendingInputs: 0, files: [fileStamp('src/a.ts', 'v0', big('a'))], graph: null });
    const snapshot = { messageCursor: null, pendingInputs: 0, files: [fileStamp('src/a.ts', 'v1', big('b'))], graph: null };
    expect(observer.observe(snapshot, 0)).toBeNull();
    expect(observer.observe(snapshot, 4_999)).toBeNull();
    const delivery = observer.observe(snapshot, 5_000);
    expect(delivery?.coalesced).toBe(true);
    expect(delivery?.signals[0]?.kind).toBe('file_delta');
    const withPending = { messageCursor: 'm1', pendingInputs: 1, files: [fileStamp('b.ts', 'v1', 'a\nb')], graph: null };
    const beat = observer.observe(withPending, 5_100);
    expect(beat?.signals.map(signal => signal.kind)).toContain('heartbeat');
  });

  it('delivers explicit member feedback once, deduped by id', () => {
    const observer = createAttentionObserver(attentionConfig({ files: { minChangedLines: 10_000, minRatio: 1, scopePrefixes: ['.'] } }));
    const snapshot = { messageCursor: null, pendingInputs: 0, files: [], graph: null, memberFeedback: [{ id: 'msg-1', source: 'agent:builder' }] };
    expect(observer.observe(snapshot, 0)?.signals[0]).toEqual({ kind: 'member_feedback', items: ['msg-1'] });
    observer.markProcessed(snapshot);
    expect(observer.observe(snapshot, 10)).toBeNull();
  });

  it('keeps delivery separate from the processed watermark and scopes files', () => {
    const observer = createAttentionObserver(attentionConfig({ files: { minChangedLines: 1, minRatio: 1, scopePrefixes: ['src'] } }));
    const baseline = { messageCursor: 'm1', pendingInputs: 0, files: [fileStamp('docs/x.md', 'd1', 'd')], graph: null };
    observer.markProcessed(baseline);
    const delivery = observer.observe({ messageCursor: 'm1', pendingInputs: 0, files: [fileStamp('docs/x.md', 'd2', 'd\ne'), fileStamp('src/a.ts', 'v2', 'x')], graph: null }, 100);
    expect(delivery?.signals[0]).toMatchObject({ kind: 'file_delta', added: 1, deleted: 0, changedFiles: ['src/a.ts'] });
    expect(observer.processed?.files.map(stamp => stamp.path)).toEqual([]);
    observer.markProcessed({ messageCursor: 'm2', pendingInputs: 0, files: [fileStamp('src/a.ts', 'v2', 'x')], graph: null });
    expect(observer.processed?.messageCursor).toBe('m2');
  });

  it('carries independent file and graph changes in one mechanical notification', () => {
    const before = graphStamp(['n1', 'n2'], ['e1'], { n1: 'running' });
    const after = graphStamp(['n1', 'n2', 'n3'], ['e1', 'e2'], { n1: 'satisfied' });
    expect(graphChangedElements(before, after)).toEqual({ changedElements: 3, nodes: 1, edges: 1, statuses: 1 });
    const observer = createAttentionObserver(attentionConfig({ files: { minChangedLines: 1, minRatio: 1, scopePrefixes: ['.'] }, graph: { minChangedElements: 3, minRatio: 1 } }));
    const first = { messageCursor: null, pendingInputs: 0, files: [fileStamp('src/a.ts', 'v1', 'a')], graph: before };
    const initial = observer.observe(first, 0);
    observer.markDelivered(first, initial!.signals);
    const delivery = observer.observe({ messageCursor: null, pendingInputs: 0, files: [fileStamp('src/a.ts', 'v2', 'a\nb')], graph: after }, 10);
    expect(delivery?.signals.map(signal => signal.kind).sort()).toEqual(['file_delta', 'graph_delta']);
  });
});

// --------------------------------------------------------------------------
// Unified send intent
// --------------------------------------------------------------------------

type CapturedSend = { input: { intent?: string; needsReply?: boolean; waitAfterSend?: boolean; replyMode?: string } };

function messageStub(): SessionMessage {
  return {
    ref: { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'w', messageId: 'm-1' },
    schemaVersion: 1,
    revision: 1,
    sender: { kind: 'host', actor: { kind: 'human', id: 'operator' } },
    recipient: { projectId: 'p', sessionId: 's-recipient' },
    bodyRef: { kind: 'artifact', contentType: 'text/plain', digest: 'a'.repeat(64), sizeBytes: 1,
      source: { kind: 'workspace', refId: 'w', revision: '1' } },
    sourceRef: { kind: 'workspace', refId: 'w', revision: '1' },
    createdAt: '2026-09-28T00:00:00.000Z',
    status: 'pending',
    readAt: null,
    response: null,
  };
}

function mailboxToolHarness(): {
  tools: ReturnType<typeof createSessionMailboxTools>;
  captured: CapturedSend[];
  waits: SessionMessage[];
} {
  const captured: CapturedSend[] = [];
  const waits: SessionMessage[] = [];
  const mailbox = {
    async sendMessage(_ctx: unknown, request: { input: CapturedSend['input'] }) {
      captured.push({ input: structuredClone(request.input) });
      return { status: 'committed' as const, value: messageStub(), replayed: false, cursor: 'c-1' as never };
    },
  } as unknown as SessionMailboxPort;
  const tools = createSessionMailboxTools({
    mailbox,
    context: {
      projectId: 'p', workspaceId: 'w',
      principal: { kind: 'host', actor: { kind: 'human', id: 'operator' } },
      materialReader: { kind: 'host', projectId: 'p', workspaceId: 'w' },
      signal: new AbortController().signal,
    } as never,
    sessionRef: { projectId: 'p', sessionId: 's-sender' },
    requestIdForCall: () => 'req-1',
    onWaitRegistered: message => waits.push(message),
  });
  return { tools, captured, waits };
}

async function callSend(
  tools: ReturnType<typeof createSessionMailboxTools>,
  args: Record<string, unknown>,
): Promise<{ output: unknown; status: string }> {
  const definition = tools.create({} as WorkspaceSandbox).find(candidate => candidate.name === 'send_session_message')!;
  const call = { schemaVersion: 1, callId: 'call-1', name: 'send_session_message', arguments: args } as unknown as ToolCall;
  const result = await definition.handler.execute(call, { signal: new AbortController().signal });
  return { status: result.status, output: result.output };
}

describe('unified SessionMailbox send intent', () => {
  it('persists explicit intent/needsReply/waitAfterSend and registers exactly one real wait', async () => {
    const { tools, captured, waits } = mailboxToolHarness();
    const result = await callSend(tools, {
      recipient: { projectId: 'p', sessionId: 's-recipient' }, text: 'question',
      intent: 'inquiry', needsReply: true, waitAfterSend: true,
    });
    expect(result.status).toBe('success');
    expect(captured[0]?.input).toEqual({ recipient: { projectId: 'p', sessionId: 's-recipient' }, text: 'question', intent: 'inquiry', needsReply: true, waitAfterSend: true });
    expect(waits).toHaveLength(1);
    expect(result.output).toMatchObject([{ kind: 'json', value: { waiting: true, response: null } }]);
  });

  it('normalizes the legacy replyMode=wait into the same single wait path', async () => {
    const { tools, captured, waits } = mailboxToolHarness();
    const result = await callSend(tools, { recipient: { projectId: 'p', sessionId: 's-recipient' }, text: 'legacy', replyMode: 'wait' });
    expect(result.status).toBe('success');
    expect(captured[0]?.input['replyMode']).toBe('wait');
    expect(waits).toHaveLength(1);
  });

  it('never registers a wait for a plain fire-and-forget notice', async () => {
    const { tools, captured, waits } = mailboxToolHarness();
    const result = await callSend(tools, { recipient: { projectId: 'p', sessionId: 's-recipient' }, text: 'notice', intent: 'notify', needsReply: false });
    expect(result.status).toBe('success');
    expect(captured[0]?.input).toEqual({ recipient: { projectId: 'p', sessionId: 's-recipient' }, text: 'notice', intent: 'notify', needsReply: false });
    expect(waits).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// Real mailbox persistence of the unified send intent
// --------------------------------------------------------------------------

describe('unified send intent against the real mailbox', () => {
  let harness: C1Harness | null = null;
  afterEach(async () => {
    if (harness !== null) { const closing = harness; harness = null; await closing.close(); }
  });

  it('persists and reads back intent/needsReply/waitAfterSend through the real service', async () => {
    harness = await createC1Harness('memory');
    const waits: SessionMessage[] = [];
    const tools = createSessionMailboxTools({
      mailbox: harness.mailbox,
      context: harness.ctxWork,
      sessionRef: harness.busySession,
      requestIdForCall: call => 'orch:' + call.callId,
      onWaitRegistered: message => waits.push(message),
    });
    const definition = tools.create({} as WorkspaceSandbox).find(candidate => candidate.name === 'send_session_message')!;
    const call = {
      schemaVersion: 1, callId: 'real-send', name: 'send_session_message',
      arguments: { recipient: harness.busySession, text: 'persisted question', intent: 'inquiry', needsReply: true, waitAfterSend: true },
    } as unknown as ToolCall;
    const result = await definition.handler.execute(call, { signal: new AbortController().signal });
    expect(result.status).toBe('success');
    const value = (result.output[0] as { kind: 'json'; value: { message: SessionMessage } }).value.message;
    expect(value).toMatchObject({ intent: 'inquiry', needsReply: true, waitAfterSend: true });
    expect(waits).toHaveLength(1);

    const read = await harness.mailbox.readMessage(harness.ctxWork, value.ref);
    expect(read).toMatchObject({ status: 'ready', value: { intent: 'inquiry', needsReply: true, waitAfterSend: true } });
  });
});

it('runs two explicitly selected same-Goal Tasks in independent Sessions with overlapping real provider calls', async () => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const fx = await import('../helpers/AG2b-collaboration-fixture.js');
  const publicDir = await mkdtemp(join(tmpdir(), 'orchestration-parallel-public-'));
  const build = spawnSync(process.execPath, ['scripts/build-workbench.mjs'], {
    cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, WORKBENCH_OUT_DIR: publicDir },
  });
  if (build.status !== 0) throw new Error(`workbench build failed: ${build.stdout}\n${build.stderr}`);
  const replies: import('../helpers/B2-runtime-fixture.js').ScriptedReply[] = [];
  const entered = new Map<string, number>();
  const left = new Map<string, number>();
  let release!: () => void;
  const overlap = new Promise<void>(resolve => { release = resolve; });
  const taskIds = ['parallel-left', 'parallel-right'];
  const host = await fx.startAG2bHost(publicDir, {
    replies, checkCommand: `node -e "const fs=require('node:fs');for(const id of ['parallel-left','parallel-right'])if(fs.readFileSync('src/'+id+'.txt','utf8')!=='result:'+id)process.exit(3)"`,
    beforeReply: async (request, index, signal) => {
      const transcript = JSON.stringify(request.messages);
      const taskId = taskIds.find(id => transcript.includes(`Perform independent work ${id}`));
      if (taskId === undefined) throw new Error('formal Task assignment was absent from Kernel context');
      if (!entered.has(taskId)) {
        entered.set(taskId, performance.now());
        if (entered.size === 2) release();
        // This gate is inside the real provider stream, not a fake driver or
        // scheduler. A serial implementation times out rather than passing.
        await Promise.race([overlap, new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error('the second Task never entered the provider concurrently')), 8_000);
          timer.unref();
          signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
        })]);
        left.set(taskId, performance.now());
        replies[index] = { kind: 'calls', calls: [{ callId: `write-${taskId}`, name: 'edit',
          args: { mode: 'create', path: `src/${taskId}.txt`, newText: `result:${taskId}` } }] };
      } else {
        replies[index] = { kind: 'text', text: `Completed ${taskId}` };
      }
    },
  });
  type Advance = import('../../src/business/workflow/contracts.js').WorkflowAdvanceInput;
  type Result = import('../../src/business/workflow/contracts.js').WorkflowAdvanceResult;
  const advance = async (input: Advance): Promise<Extract<Result, { status: 'ready' }>['value']> => {
    const response = await fx.corePost(host.base, 'workflow/advance', host.token, fx.plain(fx.AG2B_SCOPE, input));
    expect(response.status).toBe(200);
    const result = await response.json() as Result;
    if (result.status !== 'ready') throw new Error(JSON.stringify(result));
    return result.value;
  };
  const untilStart = async (input: Advance): Promise<Advance> => {
    for (let step = 0; step < 12; step++) {
      if (input.kind === 'perform' && input.operation.kind === 'start') return input;
      const result = await advance(input);
      if (result.next === null) throw new Error(`setup stopped: ${JSON.stringify(result)}`);
      input = result.next;
    }
    throw new Error('setup did not reach the real Runtime start');
  };
  try {
    await fx.seedAG2bWorkGraph(host, taskIds);
    const sessions = await Promise.all(taskIds.map(id => fx.createAG2bSession(host, `session-${id}`, fx.AG2B_WORK_ROLE)));
    expect(sessions[0]!.sessionRef).not.toEqual(sessions[1]!.sessionRef);
    // Only preparation is serial; both public start calls are dispatched together.
    const starts: Advance[] = [];
    for (let index = 0; index < taskIds.length; index++) starts.push(await untilStart({
      schemaVersion: 1, goalRef: fx.AG2B_GOAL_REF, flowId: `flow-${taskIds[index]}`, kind: 'select_work',
      taskId: taskIds[index]!, sessionHint: sessions[index]!.sessionRef,
    }));
    const started = await Promise.all(starts.map(advance));
    expect(entered.size).toBe(2);
    expect(Math.max(...entered.values())).toBeLessThanOrEqual(Math.min(...left.values()));
    // Both writes settle before checks snapshot the shared source. Completing
    // Tasks serially avoids introducing an unrelated concurrent Goal commit race.
    for (let index = 0; index < started.length; index++) {
      let result = started[index]!;
      let completed = false;
      for (let step = 0; step < 20; step++) {
        if (result.receipt?.kind === 'complete_task') {
          expect(result.receipt.result.status, JSON.stringify(result)).toBe('committed');
          completed = true;
          break;
        }
        if (result.next === null) throw new Error(`Task ${taskIds[index]} stopped: ${JSON.stringify(result)}`);
        result = await advance(result.next);
      }
      expect(completed, `formal completion of ${taskIds[index]}`).toBe(true);
    }
    for (const taskId of taskIds) expect(await readFile(join(host.root, `src/${taskId}.txt`), 'utf8')).toBe(`result:${taskId}`);
  } finally {
    release();
    await host.host.close();
    await rm(publicDir, { recursive: true, force: true });
    await fx.cleanupAG2b();
  }
}, 60_000);

it('delivers a real Host attention change into the original idle Session once', async () => {
  const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { spawnSync } = await import('node:child_process');
  const f = await import('../helpers/AG2b-collaboration-fixture.js');
  const publicDir = await mkdtemp(join(tmpdir(), 'attention-public-'));
  const build = spawnSync(process.execPath, ['scripts/build-workbench.mjs'], {
    cwd: resolve(fileURLToPath(new URL('../../', import.meta.url))), encoding: 'utf8',
    env: { ...process.env, WORKBENCH_OUT_DIR: publicDir },
  });
  expect(build.status, build.stderr).toBe(0);
  let host: Awaited<ReturnType<typeof f.startAG2bHost>> | undefined;
  try {
    host = await f.startAG2bHost(publicDir);
    await f.seedAG2bWorkGraph(host);
    const member = await f.createAG2bSession(host, 'attention-recipient');
    const { root, database } = host;
    await host.host.close();
    host = await f.startAG2bHost(publicDir, { root, database,
      queryReplies: [{ kind: 'text', text: 'The source change was read; no architecture decision is implied.' }],
      hostOptions: {
        inputConsumers: [{ scope: f.AG2B_SCOPE, sessionRef: member.sessionRef, goalRef: f.AG2B_GOAL_REF, queryProfileId: f.AG2B_QUERY_PROFILE_ID, heartbeatMs: 25 }],
        attention: [{ scope: f.AG2B_SCOPE, targetSession: member.sessionRef, goalRef: f.AG2B_GOAL_REF,
          paths: ['src/module.ts'], maxBytes: 4096, config: attentionConfig({ heartbeatMs: 25, maxCoalesceMs: 50,
            files: { minChangedLines: 1, minRatio: 1, scopePrefixes: ['src'] } }) }],
      },
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(host.queryScripted.calls()).toBe(0);
    await writeFile(join(root, 'src/module.ts'), 'export const ag2bMarker = "ATTENTION_CHANGED";\n');
    let message: SessionMessage | undefined;
    let answered = false;
    const until = Date.now() + 15_000;
    while (Date.now() < until) {
      const response = await f.corePost(host.base, 'messages/inbox', host.token,
        f.plain(f.AG2B_SCOPE, { recipient: member.sessionRef, page: { limit: 20 } }));
      const inbox = await response.json() as { status: string; value?: { items: SessionMessage[] } };
      message = inbox.value?.items.find(item => (item.acceptedInputs ?? []).some(input => input.executionRef.aggregateType === 'QueryRun'));
      if (message !== undefined) {
        const accepted = message.acceptedInputs!.find(input => input.executionRef.aggregateType === 'QueryRun')!;
        const ref = accepted.executionRef;
        if (ref.aggregateType === 'QueryRun') {
          const query = await f.corePost(host.base, 'queries/read', host.token, f.plain(f.AG2B_SCOPE,
            { aggregateType: 'QueryJob', projectId: ref.projectId, workspaceId: ref.workspaceId, queryJobId: ref.queryJobId }));
          const result = await query.json() as { status: string; value?: { job: { job: { answerRefs: unknown[] } } } };
          if ((result.value?.job.job.answerRefs.length ?? 0) > 0) { answered = true; break; }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(answered, 'the accepting original Query has a formal Answer').toBe(true);
    expect(message?.acceptedInputs?.[0]?.kernel.kernelSessionId).toBeDefined();
    expect(message?.recipient).toEqual(member.sessionRef);
    expect(message?.response).toBeNull(); // notify is processed, not a fabricated reply request
    expect(host.queryScripted.calls()).toBe(1);
    const cards = await f.listSessions(host);
    expect(cards).toHaveLength(1); // ordinary attention did not fork A′
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(host.queryScripted.calls()).toBe(1);
    const final = await f.corePost(host.base, 'messages/inbox', host.token,
      f.plain(f.AG2B_SCOPE, { recipient: member.sessionRef, page: { limit: 20 } }));
    expect((await final.json() as { value: { items: unknown[] } }).value.items).toHaveLength(1);
  } finally {
    await host?.host.close();
    if (host !== undefined) { await rm(host.root, { recursive: true, force: true }); await rm(host.database, { recursive: true, force: true }); }
    await rm(publicDir, { recursive: true, force: true });
  }
}, 60_000);

it('automatically answers an inquiry without making its sender wait', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { spawnSync } = await import('node:child_process');
  const f = await import('../helpers/AG2b-collaboration-fixture.js');
  const publicDir = await mkdtemp(join(tmpdir(), 'inquiry-public-'));
  const build = spawnSync(process.execPath, ['scripts/build-workbench.mjs'], {
    cwd: resolve(fileURLToPath(new URL('../../', import.meta.url))), encoding: 'utf8',
    env: { ...process.env, WORKBENCH_OUT_DIR: publicDir },
  });
  expect(build.status, build.stderr).toBe(0);
  let host: Awaited<ReturnType<typeof f.startAG2bHost>> | undefined;
  try {
    const replies: import('../helpers/B2-runtime-fixture.js').ScriptedReply[] = [
      { kind: 'calls', calls: [{ callId: 'async-question', name: 'send_session_message', args: {} }] },
      { kind: 'text', text: 'Question sent; continue independently.' },
    ];
    host = await f.startAG2bHost(publicDir, { replies });
    await f.seedAG2bWorkGraph(host);
    const member = await f.createAG2bSession(host, 'nonwaiting-recipient');
    const sender = await f.createAG2bSession(host, 'nonwaiting-sender', f.AG2B_WORK_ROLE);
    replies[0] = { kind: 'calls', calls: [{ callId: 'async-question', name: 'send_session_message', args: {
      recipient: member.sessionRef, text: 'Please inspect the recorded context; no change is requested.',
      intent: 'inquiry', needsReply: true, waitAfterSend: false,
    } }] };
    type Advance = import('../../src/business/workflow/contracts.js').WorkflowAdvanceInput;
    let input: Advance | null = { schemaVersion: 1, goalRef: f.AG2B_GOAL_REF, flowId: 'nonwaiting-flow', kind: 'select_work', taskId: f.AG2B_WORK_TASK_ID, sessionHint: sender.sessionRef };
    let ended = false;
    for (let step = 0; step < 12 && input !== null; step++) {
      const response = await f.corePost(host.base, 'workflow/advance', host.token, f.plain(f.AG2B_SCOPE, input));
      const result = await response.json() as import('../../src/business/workflow/contracts.js').WorkflowAdvanceResult;
      if (result.status !== 'ready') throw Error(JSON.stringify(result));
      if (input.kind === 'perform' && input.operation.kind === 'start') { ended = true; break; }
      input = result.value.next;
    }
    expect(ended).toBe(true);
    expect(host.scripted.calls()).toBe(2);
    const inboxRead = await f.corePost(host.base, 'messages/inbox', host.token, f.plain(f.AG2B_SCOPE, { recipient: member.sessionRef, page: { limit: 20 } }));
    const saved = await inboxRead.json() as { value: { items: SessionMessage[] } };
    const original = { value: saved.value.items[0]! };
    expect(original.value.sender.kind).toBe('work_run');
    if (original.value.sender.kind !== 'work_run') throw Error('the inquiry was not sent by the real Work');
    const endedRun = await f.corePost(host.base, 'executions/read', host.token, f.plain(f.AG2B_SCOPE, original.value.sender.runRef));
    expect(await endedRun.json()).toMatchObject({ status: 'ready', value: { run: { status: 'ended', outcome: 'completed' } } });
    expect(original.value.response).toBeNull();
    const { root, database } = host;
    await host.host.close();
    host = await f.startAG2bHost(publicDir, { root, database, builderQueryProfile: true,
      replies: [{ kind: 'text', text: 'Read the late answer in my original context; no Work restart.' }],
      queryReplies: [{ kind: 'text', text: 'The saved context was inspected without changing the source.' }],
      hostOptions: { inputConsumers: [{ scope: f.AG2B_SCOPE, sessionRef: member.sessionRef,
        goalRef: f.AG2B_GOAL_REF, queryProfileId: f.AG2B_QUERY_PROFILE_ID, heartbeatMs: 25 }, { scope: f.AG2B_SCOPE, sessionRef: sender.sessionRef, goalRef: f.AG2B_GOAL_REF, queryProfileId: 'ag2b-builder-query', heartbeatMs: 25 }] },
    });
    let message: SessionMessage | undefined;
    const until = Date.now() + 15_000;
    while (Date.now() < until) {
      const response = await f.corePost(host.base, 'messages/inbox', host.token,
        f.plain(f.AG2B_SCOPE, { recipient: member.sessionRef, page: { limit: 20 } }));
      const inbox = await response.json() as { value?: { items: SessionMessage[] } };
      message = inbox.value?.items.find(item => item.ref.messageId === original.value.ref.messageId);
      if (message?.status === 'responded' && message.acceptedInputs?.some(input => input.part === 'response')) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(message).toMatchObject({ intent: 'inquiry', status: 'responded', response: { sender: { kind: 'query_run' } } });
    expect(message?.waitAfterSend).not.toBe(true);
    expect(message?.replyMode).not.toBe('wait');
    expect(message?.consultationDerivation?.childSessionRef).not.toEqual(member.sessionRef);
    expect(message?.response?.sender.sessionRef).toEqual(message?.consultationDerivation?.childSessionRef);
    const accepted = message?.acceptedInputs?.find(input => input.part === 'response');
    expect(accepted?.executionRef.aggregateType).toBe('QueryRun');
    const senderCard = (await f.listSessions(host)).find(card => card.record.ref.sessionId === sender.sessionRef.sessionId)!;
    expect(accepted?.kernel.kernelSessionId).toBe(senderCard.record.kernel.kernelSessionId);
    expect(JSON.stringify(host.scripted.lastRequest()?.messages)).toContain('The saved context was inspected without changing the source.');
    expect(host.scripted.calls()).toBe(1);
    if (accepted?.executionRef.aggregateType !== 'QueryRun') throw Error('missing response Query');
    const acceptedRef = accepted.executionRef;
    const queryRead = await f.corePost(host.base, 'queries/read', host.token, f.plain(f.AG2B_SCOPE, {
      aggregateType: 'QueryJob', projectId: acceptedRef.projectId, workspaceId: acceptedRef.workspaceId, queryJobId: acceptedRef.queryJobId,
    }));
    const query = await queryRead.json() as { value: { job: { job: { answerRefs: unknown[] } } } };
    expect(query.value.job.job.answerRefs).toHaveLength(1);
    expect(host.queryScripted.calls()).toBe(1);
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(host.queryScripted.calls()).toBe(1);
  } finally {
    await host?.host.close();
    if (host !== undefined) { await rm(host.root, { recursive: true, force: true }); await rm(host.database, { recursive: true, force: true }); }
    await rm(publicDir, { recursive: true, force: true });
    await f.cleanupAG2b();
  }
}, 60_000);
