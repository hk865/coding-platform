/**
 * Slice 3 §5.9: attention facts and the detailed change text (§4.5).
 *
 * AT01–AT12 run the REAL `createAttentionObserver`, the real attention scanner
 * (AT04, AT11) and the real `renderAttentionChanges`. The rows about the Host
 * send/consume path (AT01, AT09, AT10, AT12) drive those real components in the
 * exact order the Host attention loop uses (`src/app/host.ts`: prime, observe,
 * render, send, markDelivered, consume, markProcessed) against a recording
 * mailbox. The mailbox is the only fake and is a dependency the rows do not
 * test; no code under test is mocked.
 *
 * Part 1 ships the failing tests only: `graphChanges` and
 * `renderAttentionChanges` are stubs, and the observer does not yet attach the
 * detailed `changes` to its `graph_delta` signal. Those cases are RED for
 * exactly that reason and are frozen for the implementation phase.
 */
import { describe, expect, it } from 'vitest';
import {
  createAttentionObserver,
  createAttentionScanner,
} from '../../src/app/attention-observer.js';
import type {
  AttentionObserver, AttentionSignal, AttentionSnapshot,
} from '../../src/app/attention-observer.js';
import { renderAttentionChanges } from '../../src/core/agent-runtime/context-assembler.js';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import { attentionConfig, fileStamp } from '../helpers/orchestration-fixture.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type {
  AttentionChangesV1, AttentionNodeChangeV1, GraphAttentionDetailV1, GraphAttentionFactsV1,
  GraphChangesV1, GraphNodeRefV1,
} from '../../src/contracts/graph-context.js';
import type { GoalRef } from '../../src/contracts/ledger.js';

const P = 'p';
const W = 'w';
const G = 'g';
const B = (value: string): number => Buffer.byteLength(value, 'utf8');
const GOAL_REF: GoalRef = { aggregateType: 'Goal', projectId: P, goalId: G };
const ATTENTION_HEADER = '[attention s3-v1]';
const SCOPE = { projectId: P, workspaceId: W };
const TARGET_SESSION: SessionRef = { projectId: P, sessionId: 'target-1' };
const HOST_CTX: CoreCallContext = {
  projectId: P, workspaceId: W,
  principal: { kind: 'host', actor: { kind: 'human', id: 'u' } },
  materialReader: { kind: 'host', projectId: P, workspaceId: W, actor: { kind: 'human', id: 'u' } },
  signal: new AbortController().signal,
};

function taskRef(taskId: string): GraphNodeRefV1 {
  return {
    kind: 'task', ref: { projectId: P, goalId: G, taskId },
    planRef: { aggregateType: 'PlanRevision', projectId: P, planId: 'p1' },
  };
}

function detail(key: string, name: string, summary: string, state: string | null, version: string, digest: string): GraphAttentionDetailV1 {
  return { node: taskRef(key.replace(/^task:/, '')), name, summary, state, version, contentDigest: digest, sources: [] };
}

function graph(
  nodes: readonly string[],
  edges: readonly string[],
  statuses: Readonly<Record<string, string>>,
  revision: string | undefined,
  details: Record<string, GraphAttentionDetailV1>,
) {
  return { nodes: [...nodes], edges: [...edges], statuses: { ...statuses }, ...(revision === undefined ? {} : { revision }), details };
}

function config(overrides: { graph?: { minChangedElements: number; minRatio: number }; files?: { minChangedLines: number; minRatio: number; scopePrefixes: readonly string[] } } = {}) {
  return attentionConfig(overrides);
}

const BASE = graph(
  ['task:tA', 'task:tB'], [], { 'task:tA': 'ready', 'task:tB': 'pending' }, 'plan:p1',
  {
    'task:tA': detail('task:tA', 'A', 'Alpha', 'ready', 'vA1', 'dA1'),
    'task:tB': detail('task:tB', 'B', 'Beta', 'pending', 'vB1', 'dB1'),
  },
);

const CHANGED = graph(
  ['task:tA', 'task:tB'], [], { 'task:tA': 'satisfied', 'task:tB': 'pending' }, 'plan:p1',
  {
    'task:tA': detail('task:tA', 'A', 'Alpha', 'satisfied', 'vA2', 'dA1'),
    'task:tB': detail('task:tB', 'B', 'Beta', 'pending', 'vB1', 'dB1'),
  },
);

function snapshot(graphValue: typeof BASE, overrides: Record<string, unknown> = {}) {
  return { messageCursor: null, pendingInputs: 0, files: [], graph: graphValue, ...overrides };
}

function graphDelta(delivery: ReturnType<ReturnType<typeof createAttentionObserver>['observe']>) {
  return delivery?.signals.find(signal => signal.kind === 'graph_delta');
}

/** Parse a rendered notification: every line after the header is one JSON row. */
function jsonRows(text: string): Array<Record<string, unknown>> {
  return text.split('\n').slice(1).map(line => JSON.parse(line) as Record<string, unknown>);
}

/** Build the Host's change DTO from a delivery without any file/heartbeat parts. */
function changesInput(
  changes: GraphChangesV1 | undefined,
  scope: { projectId: string; workspaceId: string },
  goalRef: GoalRef | null,
): AttentionChangesV1 {
  return {
    scope, goalRef,
    nodes: changes?.nodes ?? [],
    edges: changes?.edges ?? [],
    revision: changes?.revision ?? null,
    files: [], heartbeat: null, feedbackIds: [],
  };
}

/** The formal plan dependency edge, formatted exactly as slice 0's `depends:` signature. */
type FormalDepends = { taskId: string; dependsOnId: string; requires: { kind: string; label: string } };

function planEdges(edges: readonly FormalDepends[]): string[] {
  return edges.map(edge => 'depends:' + edge.dependsOnId + '->' + edge.taskId + ':' + edge.requires.kind + ':' + edge.requires.label);
}

function attentionFacts(label: string): GraphAttentionFactsV1 {
  return {
    nodes: ['task:tA', 'task:tB'],
    edges: planEdges([{ taskId: 'tB', dependsOnId: 'tA', requires: { kind: 'artifact', label } }]),
    statuses: { 'task:tA': 'ready', 'task:tB': 'pending' },
    revision: 'plan:p1',
    details: {
      'task:tA': detail('task:tA', 'A', 'Alpha', 'ready', 'vA1', 'dA1'),
      'task:tB': detail('task:tB', 'B', 'Beta', 'pending', 'vB1', 'dB1'),
    },
  };
}

function scannerScope() {
  return {
    scope: { projectId: P, workspaceId: W }, paths: [], maxBytes: 1024,
    goalRef: GOAL_REF, targetSession: null, config: config(),
  };
}

// --------------------------------------------------------------------------
// The Host attention send/consume sequence (src/app/host.ts attention loop)
// --------------------------------------------------------------------------

type AttentionSend = { requestId: string; text: string; recipient: SessionRef; committed: boolean };
type HostAttentionCycle = { delivery: NonNullable<ReturnType<AttentionObserver['observe']>>; send: AttentionSend };

/** Only the changed files of the delivery, with the version the Host read. */
function changesFrom(
  scope: { projectId: string; workspaceId: string },
  goalRef: GoalRef | null,
  snapshotValue: AttentionSnapshot,
  signals: readonly AttentionSignal[],
): AttentionChangesV1 {
  const graphSignal = signals.find((signal): signal is Extract<AttentionSignal, { kind: 'graph_delta' }> => signal.kind === 'graph_delta');
  const fileSignal = signals.find((signal): signal is Extract<AttentionSignal, { kind: 'file_delta' }> => signal.kind === 'file_delta');
  const heartbeatSignal = signals.find((signal): signal is Extract<AttentionSignal, { kind: 'heartbeat' }> => signal.kind === 'heartbeat');
  const feedbackSignal = signals.find((signal): signal is Extract<AttentionSignal, { kind: 'member_feedback' }> => signal.kind === 'member_feedback');
  return {
    scope, goalRef,
    nodes: graphSignal?.changes?.nodes ?? [],
    edges: graphSignal?.changes?.edges ?? [],
    revision: graphSignal?.changes?.revision ?? null,
    files: (fileSignal?.changedFiles ?? []).map(path => ({
      path, version: snapshotValue.files.find(file => file.path === path)?.version ?? null,
    })),
    heartbeat: heartbeatSignal === undefined ? null : { pendingInputs: heartbeatSignal.pendingInputs, messageCursor: heartbeatSignal.messageCursor },
    feedbackIds: [...(feedbackSignal?.items ?? [])],
  };
}

/**
 * The Host's send/consume path: prime the observer, observe, render the change
 * text, send under a snapshot-derived requestId, mark delivered only on a
 * committed send, and mark processed only when the message is really consumed.
 * The mailbox is the only substitution.
 */
function createHostAttention(input: {
  scope: { projectId: string; workspaceId: string };
  goalRef: GoalRef | null;
  targetSession: SessionRef;
  paths: readonly string[];
  observer: AttentionObserver;
  failSends?: number;
}) {
  const sends: AttentionSend[] = [];
  const pending: { snapshot: AttentionSnapshot; signals: readonly AttentionSignal[] }[] = [];
  let failures = input.failSends ?? 0;
  let deliveredCalls = 0;
  let processedCalls = 0;

  function cycle(snapshotValue: AttentionSnapshot, atMs: number): HostAttentionCycle | null {
    // `prime` is idempotent; the Host establishes the baseline before notifying.
    input.observer.prime(snapshotValue);
    const delivery = input.observer.observe(snapshotValue, atMs);
    if (delivery === null) return null;
    const text = renderAttentionChanges(changesFrom(input.scope, input.goalRef, snapshotValue, delivery.signals));
    const requestId = 'attention:' + input.scope.workspaceId + ':' + sha256Hex(canonicalJson({
      targetSession: input.targetSession, paths: input.paths,
      files: snapshotValue.files.map(file => ({ path: file.path, version: file.version })),
      graph: snapshotValue.graph,
      signals: delivery.signals,
    } as never));
    const committed = failures === 0;
    if (!committed) failures -= 1;
    const send: AttentionSend = { requestId, text, recipient: input.targetSession, committed };
    sends.push(send);
    if (committed) {
      input.observer.markDelivered(snapshotValue, delivery.signals);
      deliveredCalls += 1;
      pending.push({ snapshot: snapshotValue, signals: delivery.signals });
    }
    return { delivery, send };
  }

  function consume(): boolean {
    const item = pending.shift();
    if (item === undefined) return false;
    input.observer.markProcessed(item.snapshot, item.signals);
    processedCalls += 1;
    return true;
  }

  return {
    sends, cycle, consume,
    get deliveredCalls() { return deliveredCalls; },
    get processedCalls() { return processedCalls; },
  };
}

describe('S3 attention context', () => {
  it('AT01 primes the baseline and delivers nothing on a repeated scan', () => {
    const observer = createAttentionObserver(config());
    const host = createHostAttention({ scope: SCOPE, goalRef: GOAL_REF, targetSession: TARGET_SESSION, paths: [], observer });
    expect(host.cycle(snapshot(BASE), 0)).toBeNull();
    expect(host.cycle(snapshot(BASE), 1_000)).toBeNull();
    expect(host.cycle(snapshot(BASE), 2_000)).toBeNull();
    // Host send count stays zero.
    expect(host.sends).toHaveLength(0);
    expect(host.deliveredCalls).toBe(0);
    expect(observer.processed).toBeNull();
  });

  it('AT02 reports only the changed tA node out of 1000 unchanged nodes, never the full graph', () => {
    const unchanged = Array.from({ length: 1_000 }, (_value, index) => `task:u${String(index).padStart(4, '0')}`);
    const statuses: Record<string, string> = { 'task:tA': 'ready' };
    const details: Record<string, GraphAttentionDetailV1> = { 'task:tA': detail('task:tA', 'A', 'Alpha', 'ready', 'vA1', 'dA1') };
    for (const key of unchanged) { statuses[key] = 'ready'; details[key] = detail(key, key, 'unchanged', 'ready', 'v1', 'd1'); }
    const before = graph(['task:tA', ...unchanged], [], statuses, 'plan:p1', details);
    const after = graph(
      ['task:tA', ...unchanged], [], { ...statuses, 'task:tA': 'satisfied' }, 'plan:p1',
      { ...details, 'task:tA': detail('task:tA', 'A', 'Alpha', 'satisfied', 'vA2', 'dA1') },
    );
    const observer = createAttentionObserver(config({ graph: { minChangedElements: 1, minRatio: 0 } }));
    observer.prime(snapshot(before));
    const delta = graphDelta(observer.observe(snapshot(after), 10));
    expect(delta?.kind).toBe('graph_delta');
    if (delta?.kind === 'graph_delta') {
      expect(delta.changes).toMatchObject({ nodes: [expect.objectContaining({ key: 'task:tA', change: 'changed' })] });
      // The notification text, not only the in-memory DTO, carries one row.
      const text = renderAttentionChanges(changesInput(delta.changes, SCOPE, GOAL_REF));
      const nodeRows = jsonRows(text).filter(row => row['kind'] === 'node');
      expect(nodeRows).toHaveLength(1);
      expect(nodeRows[0]).toMatchObject({ key: 'task:tA', change: 'changed' });
      for (const key of unchanged) expect(text).not.toContain(key);
      expect(text).not.toContain('task:tB');
    }
  });

  it('AT03 carries the removed tA tombstone with its old detail for locating it', () => {
    const after = graph(
      ['task:tB'], [], { 'task:tB': 'pending' }, 'plan:p1',
      { 'task:tB': detail('task:tB', 'B', 'Beta', 'pending', 'vB1', 'dB1') },
    );
    const observer = createAttentionObserver(config({ graph: { minChangedElements: 1, minRatio: 0 } }));
    observer.prime(snapshot(BASE));
    const delta = graphDelta(observer.observe(snapshot(after), 10));
    expect(delta?.kind).toBe('graph_delta');
    if (delta?.kind === 'graph_delta') {
      const removed = delta.changes?.nodes.find(change => change.key === 'task:tA');
      expect(removed).toMatchObject({ change: 'removed', beforeVersion: 'vA1', afterVersion: null });
      expect(removed?.detail.name).toBe('A');
      expect(removed?.detail.contentDigest).toBe('dA1');
      // The old detail keeps the node locator, and the rendered row exposes it.
      expect(removed?.detail.node).toEqual(taskRef('tA'));
      const nodeRows = jsonRows(renderAttentionChanges(changesInput(delta.changes, SCOPE, GOAL_REF)))
        .filter(row => row['kind'] === 'node');
      expect(nodeRows).toHaveLength(1);
      expect(nodeRows[0]).toMatchObject({ kind: 'node', key: 'task:tA', change: 'removed' });
      expect((nodeRows[0]!['node'] as { ref: { taskId: string } }).ref.taskId).toBe('tA');
    }
  });

  it('AT04 reports the removed old edge and the added new edge with both endpoints locatable and no [object Object]', async () => {
    let label = 'A.out';
    const scanner = createAttentionScanner({
      workspace: { readWorkspace: () => { throw new Error('unexpected readWorkspace'); } },
      plans: { queryTaskGraph: () => { throw new Error('unexpected legacy plan read'); } },
      architecture: { readArchitectureRevision: () => { throw new Error('unexpected legacy architecture read'); } },
      messages: { readInbox: () => { throw new Error('unexpected readInbox'); } },
      readAttentionGraph: async () => ({ status: 'ready', value: attentionFacts(label) }),
    } as never);
    const before = await scanner.scan(HOST_CTX, scannerScope());
    label = 'B.out';
    const after = await scanner.scan(HOST_CTX, scannerScope());
    const oldEdge = 'depends:tA->tB:artifact:A.out';
    const newEdge = 'depends:tA->tB:artifact:B.out';
    const observer = createAttentionObserver(config({ graph: { minChangedElements: 1, minRatio: 0 } }));
    observer.prime(before);
    const delta = graphDelta(observer.observe(after, 10));
    expect(delta?.kind).toBe('graph_delta');
    if (delta?.kind === 'graph_delta') {
      expect(delta.changes?.edges).toEqual(expect.arrayContaining([
        { key: oldEdge, change: 'removed' },
        { key: newEdge, change: 'added' },
      ]));
      const text = renderAttentionChanges(changesInput(delta.changes, SCOPE, GOAL_REF));
      expect(text).not.toContain('[object Object]');
      const rows = jsonRows(text);
      expect(rows.filter(row => row['kind'] === 'edge')).toEqual(expect.arrayContaining([
        { kind: 'edge', key: oldEdge, change: 'removed' },
        { kind: 'edge', key: newEdge, change: 'added' },
      ]));
      const nodeKeys = rows.filter(row => row['kind'] === 'node').map(row => row['key']);
      expect(nodeKeys).toEqual(expect.arrayContaining(['task:tA', 'task:tB']));
    }
  });

  it('AT05 reports one changed row when only the contentDigest changes, not letting a semantic change slip', () => {
    const before = graph(['task:tA'], [], { 'task:tA': 'ready' }, 'plan:p1', {
      'task:tA': detail('task:tA', 'A', 'Alpha', 'ready', 'vA1', 'digest-1'),
    });
    const after = graph(['task:tA'], [], { 'task:tA': 'ready' }, 'plan:p1', {
      'task:tA': detail('task:tA', 'A', 'Alpha', 'ready', 'vA1', 'digest-2'),
    });
    const observer = createAttentionObserver(config({ graph: { minChangedElements: 1, minRatio: 0 } }));
    observer.prime(snapshot(before));
    const delta = graphDelta(observer.observe(snapshot(after), 10));
    // The trigger itself must see the details-only change, not only graphChanges.
    expect(delta?.kind).toBe('graph_delta');
    if (delta?.kind === 'graph_delta') {
      expect(delta.changedElements).toBe(1);
      expect(delta.changes?.nodes).toHaveLength(1);
      expect(delta.changes?.nodes[0]).toMatchObject({ key: 'task:tA', change: 'changed' });
      const nodeRows = jsonRows(renderAttentionChanges(changesInput(delta.changes, SCOPE, GOAL_REF)))
        .filter(row => row['kind'] === 'node');
      expect(nodeRows).toHaveLength(1);
      expect(nodeRows[0]).toMatchObject({ key: 'task:tA', change: 'changed' });
    }
  });

  it('AT06 reports exactly one revision_change when only the revision changes, without every graph node', () => {
    const after = graph(['task:tA', 'task:tB'], [], { 'task:tA': 'ready', 'task:tB': 'pending' }, 'plan:p2', BASE.details);
    const observer = createAttentionObserver(config({ graph: { minChangedElements: 1, minRatio: 0 } }));
    observer.prime(snapshot(BASE));
    const delta = graphDelta(observer.observe(snapshot(after), 10));
    expect(delta?.kind).toBe('graph_delta');
    if (delta?.kind === 'graph_delta') {
      expect(delta.changes?.revision).toEqual({ before: 'plan:p1', after: 'plan:p2' });
      expect(delta.changes?.nodes).toEqual([]);
      const rows = jsonRows(renderAttentionChanges(changesInput(delta.changes, SCOPE, GOAL_REF)));
      expect(rows.filter(row => row['kind'] === 'revision')).toEqual([
        { kind: 'revision', key: 'graph', change: 'revision_change', beforeVersion: 'plan:p1', afterVersion: 'plan:p2' },
      ]);
      expect(rows.filter(row => row['kind'] === 'node')).toHaveLength(0);
    }
  });

  it('AT07 keeps the 2000-row text at or below 16384 UTF-8 bytes with an omitted count and parseable lines', () => {
    const rows = Array.from({ length: 2_000 }, (_value, index) => nodeChange(`task:n${String(index).padStart(4, '0')}`));
    const input: AttentionChangesV1 = {
      scope: { projectId: P, workspaceId: W }, goalRef: GOAL_REF,
      nodes: rows, edges: [], revision: null, files: [], heartbeat: null, feedbackIds: [],
    };
    const text = renderAttentionChanges(input);
    expect(B(text)).toBeLessThanOrEqual(16_384);
    const lines = text.split('\n');
    expect(lines[0]).toBe(ATTENTION_HEADER);
    expect(JSON.parse(lines[1]!)).toEqual({ kind: 'scope', projectId: P, workspaceId: W, goalId: G });
    const nodeLines = lines.slice(2).filter(line => (JSON.parse(line) as { kind: string }).kind === 'node');
    const actualNodes = nodeLines.length;
    const expectedOmitted = { kind: 'omitted', count: 2_000 - actualNodes, hint: `另有 ${2_000 - actualNodes} 条，用‘看’读` };
    expect(JSON.parse(lines[lines.length - 1]!)).toEqual(expectedOmitted);
    // The kept rows are the longest prefix: one more row would exceed 16384.
    const oneMore = [
      ...lines.slice(0, lines.length - 1),
      nodeLines[0]!,
      JSON.stringify({ kind: 'omitted', count: expectedOmitted.count - 1, hint: `另有 ${expectedOmitted.count - 1} 条，用‘看’读` }),
    ].join('\n');
    expect(B(oneMore)).toBeGreaterThan(16_384);
  });

  it('AT08 omits a single row larger than 16384 Chinese bytes without a half line or a replacement character', () => {
    const huge = '中'.repeat(20_000);
    const row = nodeChange('task:tA', { summary: huge });
    const input: AttentionChangesV1 = {
      scope: { projectId: P, workspaceId: W }, goalRef: GOAL_REF,
      nodes: [row], edges: [], revision: null, files: [], heartbeat: null, feedbackIds: [],
    };
    const text = renderAttentionChanges(input);
    expect(B(text)).toBeLessThanOrEqual(16_384);
    expect(text).not.toContain('\uFFFD');
    const lines = text.split('\n');
    expect(lines[0]).toBe(ATTENTION_HEADER);
    const scopeLine = JSON.stringify({ kind: 'scope', projectId: P, workspaceId: W, goalId: G });
    expect(JSON.parse(lines[1]!)).toEqual({ kind: 'scope', projectId: P, workspaceId: W, goalId: G });
    expect(lines.slice(2).map(line => JSON.parse(line) as unknown)).toEqual([
      { kind: 'omitted', count: 1, hint: '另有 1 条，用‘看’读' },
    ]);
    // One more row (the single huge row) would exceed 16384 bytes.
    const nodeLine = JSON.stringify({
      kind: 'node', key: row.key, change: row.change, beforeVersion: row.beforeVersion, afterVersion: row.afterVersion,
      node: row.detail.node, name: row.detail.name, summary: row.detail.summary, state: row.detail.state,
    });
    expect(B([ATTENTION_HEADER, scopeLine, nodeLine].join('\n'))).toBeGreaterThan(16_384);
  });

  it('AT09 retries the identical snapshot with the same notification and keeps delivered/processed at zero until success', () => {
    const observer = createAttentionObserver(config({ graph: { minChangedElements: 1, minRatio: 0 } }));
    const host = createHostAttention({
      scope: SCOPE, goalRef: GOAL_REF, targetSession: TARGET_SESSION, paths: [], observer, failSends: 1,
    });
    expect(host.cycle(snapshot(BASE), 0)).toBeNull();
    const failed = host.cycle(snapshot(CHANGED), 10)!;
    expect(failed.send.committed).toBe(false);
    expect(observer.delivered.graph?.statuses['task:tA']).toBe('ready');
    const retried = host.cycle(snapshot(CHANGED), 20)!;
    expect(retried.send.committed).toBe(true);
    expect(retried.delivery.signals).toEqual(failed.delivery.signals);
    // The retry keeps the identical requestId and text.
    expect(retried.send.requestId).toBe(failed.send.requestId);
    expect(retried.send.text).toBe(failed.send.text);
    expect(host.deliveredCalls).toBe(1);
    expect(host.processedCalls).toBe(0);
    expect(failed.delivery.signals.some(signal => signal.kind === 'graph_delta')).toBe(true);
    expect(observer.delivered.graph?.statuses['task:tA']).toBe('satisfied');
    expect(observer.processed).toBeNull();
  });

  it('AT10 marks the snapshot processed only after a real consumption and suppresses the same snapshot afterwards', () => {
    const observer = createAttentionObserver(config({ graph: { minChangedElements: 1, minRatio: 0 } }));
    const host = createHostAttention({ scope: SCOPE, goalRef: GOAL_REF, targetSession: TARGET_SESSION, paths: [], observer });
    expect(host.cycle(snapshot(BASE), 0)).toBeNull();
    const delivery = host.cycle(snapshot(CHANGED), 10)!;
    expect(delivery.send.committed).toBe(true);
    expect(host.deliveredCalls).toBe(1);
    // A committed send moves only the delivered watermark.
    expect(observer.processed).toBeNull();
    expect(host.consume()).toBe(true);
    expect(host.processedCalls).toBe(1);
    expect(observer.processed).not.toBeNull();
    expect(observer.processed?.graph?.statuses['task:tA']).toBe('satisfied');
    expect(observer.observe(snapshot(CHANGED), 20)).toBeNull();
  });

  it('AT11 keeps the old baseline and sends no full-graph deletion when the graph reader fails', async () => {
    const legacyCalls: string[] = [];
    const scanner = createAttentionScanner({
      workspace: { readWorkspace: () => { legacyCalls.push('workspace'); throw new Error('unexpected readWorkspace'); } },
      plans: { queryTaskGraph: () => { legacyCalls.push('plans'); throw new Error('unexpected legacy plan read'); } },
      architecture: { readArchitectureRevision: () => { legacyCalls.push('architecture'); throw new Error('unexpected legacy architecture read'); } },
      messages: { readInbox: () => { legacyCalls.push('messages'); throw new Error('unexpected readInbox'); } },
      readAttentionGraph: async () => ({ status: 'rejected', code: 'unavailable', reason: 'graph reader down' }),
    } as never);
    const failing = await scanner.scan(HOST_CTX, scannerScope());
    // Only the new read is used; the legacy plans/architecture reads never run.
    expect(legacyCalls).toEqual([]);
    expect(failing.graphUnreadable).toBe(true);
    expect(failing.graph).toBeNull();
    const observer = createAttentionObserver(config({ graph: { minChangedElements: 1, minRatio: 0 } }));
    observer.prime(snapshot(BASE));
    expect(observer.observe(failing, 1_000)).toBeNull();
    expect(observer.delivered.graph?.nodes).toEqual(BASE.nodes);
  });

  it('AT12 reports only the changed a.ts file, keeps the heartbeat count and does not swap the target Session', () => {
    const observer = createAttentionObserver(config({
      files: { minChangedLines: 1, minRatio: 0, scopePrefixes: ['.'] },
      graph: { minChangedElements: 1, minRatio: 0 },
    }));
    const baseline = {
      messageCursor: 'm1', pendingInputs: 1,
      files: [fileStamp('a.ts', 'a1', 'a'), fileStamp('b.ts', 'b1', 'b')], graph: BASE,
    };
    const changed = {
      messageCursor: 'm2', pendingInputs: 2,
      files: [fileStamp('a.ts', 'a2', 'a\nx'), fileStamp('b.ts', 'b1', 'b')], graph: BASE,
    };
    const targetSession: SessionRef = { projectId: P, sessionId: 'target-1' };
    const host = createHostAttention({ scope: SCOPE, goalRef: GOAL_REF, targetSession, paths: ['a.ts', 'b.ts'], observer });
    expect(host.cycle(baseline, 0)).toBeNull();
    const delivery = host.cycle(changed, 1_000)!;
    const fileSignal = delivery.delivery.signals.find(signal => signal.kind === 'file_delta');
    expect(fileSignal).toMatchObject({ kind: 'file_delta', changedFiles: ['a.ts'] });
    const heartbeat = delivery.delivery.signals.find(signal => signal.kind === 'heartbeat');
    expect(heartbeat).toMatchObject({ kind: 'heartbeat', pendingInputs: 2, messageCursor: 'm2' });
    // The rendered text carries exactly the changed file line, never b.ts.
    const rows = jsonRows(delivery.send.text);
    expect(rows.filter(row => row['kind'] === 'file')).toEqual([{ kind: 'file', key: 'a.ts', version: 'a2' }]);
    expect(rows.find(row => row['kind'] === 'heartbeat')).toEqual({
      kind: 'heartbeat', key: 'heartbeat', pendingInputs: 2, messageCursor: 'm2',
    });
    // The target Session is a Host scope field, not an observer field: it stays unchanged.
    expect(delivery.send.recipient).toEqual(targetSession);
    expect(targetSession).toEqual({ projectId: P, sessionId: 'target-1' });
    expect(Object.keys(observer)).not.toContain('targetSession');
  });
});

function nodeChange(key: string, overrides: { summary?: string; change?: AttentionNodeChangeV1['change'] } = {}): AttentionNodeChangeV1 {
  return {
    key,
    change: overrides.change ?? 'changed',
    beforeVersion: 'v1', afterVersion: 'v2',
    detail: detail(key, key, overrides.summary ?? 'row', 'ready', 'v2', 'digest'),
  };
}
