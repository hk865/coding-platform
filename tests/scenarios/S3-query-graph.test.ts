/**
 * Slice 3 §5.11, case SC02 (one run on SQLite, scripted provider only).
 *
 * The AG2b harness Host has a fixed scope, a fixed plan and a fixed grant
 * without `look_graph`/`find_graph` (lead decision 3, `tests/scenarios/harness.ts`
 * stays unchanged), so this scenario builds its OWN composition root with the
 * same exported building blocks and the same pattern the harness's platform mode
 * uses: one SQLite ledger + Kernel store, the real owners, a scripted provider,
 * and the real `claim_task` / `prepare` / `start` performed through the Workflow
 * (`platform.workflow.advanceWork`). The shared root lives in
 * `tests/scenarios/support/S3-host.ts`.
 *
 * It seeds the §5.1 graph (scope `p/w`, Goal `g`, Plan `p1`, stage `Main`,
 * tA/tB, obligation `oB` with verification `vB`, the edge `tB -> tA: artifact
 * A.out`, the legacy declaration `old-A` under the real completed owner Run of
 * `tA`) and grants `look_graph`/`find_graph` in the Work AND Query bindings.
 *
 * A work Run asks the old main conversation ("进度如何") and waits; the derived
 * read-only Query answers through the scripted query provider, which first asks
 * for the read-only graph tools (`find_graph`, `look_graph` node, `look_graph`
 * history) and then answers. The Answer is saved as the message response body.
 * The second half of the row reads the saved body, checks the tool results carry
 * `tB`'s status/obligations and the history versions, proves graph expansion and
 * history paging add 0 model requests, and drives the Host attention loop over
 * a large graph change (one notification <= 16384 bytes, consumed once, a second
 * scan sends 0).
 *
 * Part 1 has stubs (`createGraphTools` is unwired, `renderAttentionChanges` is a
 * stub), so this scenario is RED by design; the failure must be an assertion or
 * `not implemented: ...`, never a fixture/setup error.
 */
import { afterEach, expect, it } from 'vitest';
import { createAttentionObserver, createAttentionScanner, type AttentionSnapshot } from '../../src/app/attention-observer.js';
import { renderAttentionChanges } from '../../src/core/agent-runtime/context-assembler.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { AttentionChangesV1, GraphAttentionDetailV1 } from '../../src/contracts/graph-context.js';
import type { TaskExecutionHistoryRequest } from '../../src/core/agent-runtime/execution-history-contracts.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import {
  AG2B_CONSUMER_ID, AG2B_QUERY_BUDGET, AG2B_QUERY_ROLE, AG2B_QUERY_ROLE_BINDING, AG2B_RUNTIME_BUDGET,
} from '../helpers/AG2b-collaboration-fixture.js';
import { attentionConfig } from '../helpers/orchestration-fixture.js';
import { cleanupScenarios } from './harness.js';
import { toolOutputJson } from './support/common.js';
import { G, GOAL_REF, P, PLAN_REF, SCOPE, WORK_TASK, openS3Host, type S3Host } from './support/S3-host.js';

// ---------------------------------------------------------------------------
// SC02 identities
// ---------------------------------------------------------------------------

const QUESTION = '进度如何';
const ANSWER = 'SC02: the graph facts say the work is on track';
const B = (value: string): number => Buffer.byteLength(value, 'utf8');

afterEach(async () => {
  await cleanupScenarios();
});

// ---------------------------------------------------------------------------
// Host attention loop over the real scanner/observer (§4.5)
// ---------------------------------------------------------------------------

function taskRef(taskId: string): import('../../src/contracts/graph-context.js').GraphNodeRefV1 {
  return { kind: 'task', ref: { projectId: P, goalId: G, taskId }, planRef: PLAN_REF };
}

function attentionDetail(key: string, state: string, version: string, digest: string): GraphAttentionDetailV1 {
  return { node: taskRef(key.replace(/^task:/, '')), name: key, summary: key, state, version,
    contentDigest: digest, sources: [] };
}

/** The large graph change: the baseline plus 2000 added task nodes. */
function largeChange(baseline: AttentionSnapshot): AttentionSnapshot {
  const graph = baseline.graph ?? { nodes: [], edges: [], statuses: {}, details: {} };
  const added = Array.from({ length: 2_000 }, (_v, index) => `task:n${String(index).padStart(4, '0')}`);
  const statuses: Record<string, string> = { ...graph.statuses };
  const details: Record<string, GraphAttentionDetailV1> = { ...(graph.details ?? {}) };
  for (const key of added) {
    statuses[key] = 'ready';
    details[key] = attentionDetail(key, 'ready', 'v1', 'd1');
  }
  return { ...baseline, graph: { ...graph, nodes: [...graph.nodes, ...added], statuses, details } };
}

/** The Host renders the change DTO the observer attached to its `graph_delta` signal. */
function attentionChanges(delivery: import('../../src/app/attention-observer.js').AttentionDelivery | null): AttentionChangesV1 {
  const signal = delivery?.signals.find(candidate => candidate.kind === 'graph_delta');
  const graph = signal?.kind === 'graph_delta' ? signal.changes : undefined;
  return { scope: SCOPE, goalRef: GOAL_REF, nodes: graph?.nodes ?? [], edges: graph?.edges ?? [],
    revision: graph?.revision ?? null, files: [], heartbeat: null, feedbackIds: [] };
}

// ---------------------------------------------------------------------------

it('SC02: the old main-conversation Query answers through the read-only graph tools and the Answer is saved', async () => {
  let h: S3Host | undefined;
  try {
    const send = { callId: 'sc02-send', name: 'send_session_message',
      args: { recipient: {}, text: QUESTION, intent: 'inquiry', needsReply: true, waitAfterSend: true } as Record<string, unknown> };
    const historyReply = { kind: 'calls' as const, calls: [{ callId: 'sc02-history', name: 'look_graph',
      args: { mode: 'history' as const, runRef: { aggregateType: 'Run' as const, projectId: P, goalId: G,
        runId: 'placeholder-tA-run' } as RunRef } }] };
    const queryReplies: ScriptedReply[] = [
      { kind: 'calls', calls: [{ callId: 'sc02-find', name: 'find_graph', args: { needle: WORK_TASK.taskId } }] },
      { kind: 'calls', calls: [{ callId: 'sc02-look', name: 'look_graph', args: { mode: 'node', target: { kind: 'task', ref: WORK_TASK, planRef: PLAN_REF } } }] },
      historyReply,
      { kind: 'text', text: ANSWER },
    ];
    // tA's own real Run consumes the first independent text reply; the original
    // SC02 send reply stays for the later work.
    h = await openS3Host('s3-query', { replies: [{ kind: 'text', text: 'SC02: tA completed' },
      { kind: 'calls', calls: [send] }, { kind: 'text', text: 'SC02: the reply was read' }], queryReplies });
    // The history lookup names the real Run the Workflow generated for tA
    // (mutating the scripted reply once the public step returned its RunRef).
    historyReply.calls[0]!.args.runRef = h.runA;
    // The history page carries the Kernel execution identity of the Run, not its
    // platform RunRef; read that locator from the same Run's public record so the
    // assertion names tA's real execution, not a literal.
    const taExecution = await executionOf(h, h.runA);
    const taKernelRunId = taExecution.run.executionHistory?.kernel.runId;
    expect(taKernelRunId).toBeDefined();
    if (taKernelRunId === undefined) throw new Error('the completed tA Run must index its execution history');

    // The read-only participant Session the work Run asks.
    const created = await h.platform.runtime.createSession(h.ctx(), {
      workspace: SCOPE, role: AG2B_QUERY_ROLE, recommendedRefs: [],
      initialLinks: [{ target: { kind: 'task', ref: WORK_TASK }, relation: 'participates' }],
      meta: { requestId: 'sc02-recipient', expected: [] },
    });
    if (created.status !== 'completed') throw new Error(`the recipient Session was not created: ${JSON.stringify(created)}`);
    const recipient: SessionRef = { projectId: created.value.ref.projectId, sessionId: created.value.ref.sessionId };
    send.args['recipient'] = { projectId: recipient.projectId, sessionId: recipient.sessionId };

    // The work Run asks and yields with a durable continuation (P5).
    const waiting = await h.advance(h.select('sc02-1', WORK_TASK.taskId));
    expect(waiting.state).toBe('waiting');
    const yielded = await executionOf(h, await selectedRunOf(h));
    const messageRef = yielded.run.continuation?.messageRef;
    expect(messageRef).toBeDefined();
    if (messageRef === undefined) return;

    // The derived read-only Query answers; its Answer is saved as a real
    // content-addressed response body, not a transient string.
    const answered = await h.platform.workflow.consumeConsultation(h.ctx(), {
      schemaVersion: 1, messageRef, goalRef: GOAL_REF, roleBinding: AG2B_QUERY_ROLE_BINDING,
      runtimeBudget: AG2B_RUNTIME_BUDGET, budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID,
    });
    expect(answered).toMatchObject({ status: 'ready', value: { state: 'responded' } });
    const messageRead = await h.platform.messages.readMessage(h.ctx(), messageRef);
    expect(messageRead).toMatchObject({ status: 'ready',
      value: { status: 'responded', response: { bodyRef: { kind: 'artifact', digest: expect.any(String) } } } });
    // Read the saved Answer body and compare its exact text.
    const answerBody = await h.platform.messages.readMessageBody(h.ctx(), { messageRef, part: 'response' });
    expect(answerBody).toMatchObject({ status: 'ready', value: { part: 'response', text: ANSWER } });

    // The Query provider really asked for the graph tools; their results report
    // the Task status/obligations and the history version (not a workspace write).
    const queryRequests = h.query?.requests ?? [];
    expect(queryRequests.length).toBeGreaterThan(0);
    const nodeResult = queryRequests.map(request => toolOutputJson(request, 'sc02-look')).find(value => value !== undefined);
    expect(nodeResult).toMatchObject({ status: 'ready' });
    expect(JSON.stringify(nodeResult)).toContain(WORK_TASK.taskId);
    expect(JSON.stringify(nodeResult)).toContain('oB');
    expect(JSON.stringify(nodeResult)).toContain('vB');
    const historyResult = queryRequests.map(request => toolOutputJson(request, 'sc02-history')).find(value => value !== undefined);
    expect(historyResult).toBeDefined();
    expect(JSON.stringify(historyResult)).toContain(taKernelRunId);
    // A Query never receives a workspace-write tool.
    const toolNames = queryRequests.flatMap(request => request.tools.map(tool => tool.name));
    expect(toolNames).not.toContain('write');
    expect(toolNames).not.toContain('edit');

    // Graph expansion and history paging add 0 model requests.
    const queryCallsBefore = h.query?.calls() ?? 0;
    const workCallsBefore = h.work.calls();
    const graphRead = await h.platform.plans.queryTaskGraph(h.ctx(), { goalRef: GOAL_REF });
    expect(graphRead.status).toBe('ready');
    const pageRequest: TaskExecutionHistoryRequest = { runRef: await selectedRunOf(h), afterCursor: null, limit: 20 };
    await h.platform.runtime.readTaskExecutionHistory(h.ctx(), pageRequest);
    expect(h.query?.calls() ?? 0).toBe(queryCallsBefore);
    expect(h.work.calls()).toBe(workCallsBefore);

    // After a large graph change the Host sends one notification of at most
    // 16384 bytes, it is consumed once, and a second scan sends 0.
    const scanner = createAttentionScanner({ workspace: h.platform.workspace, messages: h.platform.messages,
      readAttentionGraph: h.platform.runtime.readAttentionGraph.bind(h.platform.runtime) });
    const scope = { scope: SCOPE, paths: [], maxBytes: 1024, goalRef: GOAL_REF, targetSession: null,
      config: attentionConfig({ graph: { minChangedElements: 1, minRatio: 0 } }) };
    const baseline = await scanner.scan(h.ctx(), scope);
    const observer = createAttentionObserver(attentionConfig({ graph: { minChangedElements: 1, minRatio: 0 } }));
    observer.prime(baseline);
    const after = largeChange(baseline);
    const delivery = observer.observe(after, 1_000);
    expect(delivery?.signals.some(signal => signal.kind === 'graph_delta')).toBe(true);
    const sends: string[] = [];
    const text = renderAttentionChanges(attentionChanges(delivery));
    expect(B(text)).toBeLessThanOrEqual(16_384);
    sends.push(text);
    observer.markDelivered(after, delivery?.signals);
    observer.markProcessed(after, delivery?.signals);
    expect(sends).toHaveLength(1);
    expect(observer.observe(after, 2_000)).toBeNull();
    expect(sends).toHaveLength(1);
  } finally {
    await h?.close();
  }
}, 120_000);

// ---------------------------------------------------------------------------
// Platform readers
// ---------------------------------------------------------------------------

async function selectedRunOf(h: S3Host): Promise<RunRef> {
  const read = await h.platform.plans.queryTaskGraph(h.ctx(), { goalRef: GOAL_REF });
  if (read.status !== 'ready') throw new Error(`the task graph must be readable: ${JSON.stringify(read)}`);
  const row = read.value.tasks.find(candidate => candidate.ref.taskId === WORK_TASK.taskId);
  if (row === undefined || row.execution === null) throw new Error(`the Task ${WORK_TASK.taskId} must select a Run`);
  return row.execution;
}

async function executionOf(h: S3Host, runRef: RunRef): Promise<{ run: {
  inputBinding?: unknown;
  continuation?: { messageRef: import('../../src/contracts/core/session-message.js').SessionMessageRef };
  executionHistory?: { kernel: { runId: string; turnId: string } };
} }> {
  const read = await h.platform.executions.readExecution(h.ctx(), runRef);
  if (read.status !== 'ready') throw new Error(`the Run must be readable: ${JSON.stringify(read)}`);
  return read.value as unknown as { run: { executionHistory?: { kernel: { runId: string; turnId: string } } } };
}
