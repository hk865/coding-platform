/**
 * Wiring package 1, W14 (spec §3 W1-ANOM-01, §4.2, L7-L9): the graph reader's
 * optional `extensions` provider (`views/context-extensions.ts`).
 *
 * AN01-AN06/AN09 drive `createContextExtensionsReader` directly with a plain
 * double for `listSessionAnomalies` into which only the real anchor shape is
 * fed. AN07 wires the real provider into a real graph reader (its own
 * memory/SQLite `describe.each`) and reads through the real anchor owner.
 *
 * Part 1: the provider body is `throw new Error('not implemented: …')`, so the
 * direct rows fail with that stub throw and AN07 fails on the reader's real
 * refusal. No other failure is expected.
 */
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RoleBindingRefV1, RunRef } from '../../src/contracts/dispatch.js';
import type { ContextExtensionsV1, ContextIndexRowV1 } from '../../src/contracts/graph-context.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type {
  ArchiveChangedFilesV1, SessionAnomalyAnchorV1, SessionAnomalyViewV1,
} from '../../src/contracts/session-anomaly.js';
import type { ContextReadRequestV1 } from '../../src/core/work-graph/model/graph-context-contracts.js';
import type { SessionPage } from '../../src/core/work-graph/model/session-contracts.js';
import type { SessionAnomalyPort } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import { sessionAnomalyRefKey } from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
import { createContextExtensionsReader } from '../../src/core/work-graph/views/context-extensions.js';
import { afterEach, describe, expect, it } from 'vitest';
import { openAnomalyReaderFixture, t0, type AnomalyReaderFixture } from '../helpers/WP1-entry-fixture.js';

const PROJECT_ID = 'p';
const WORKSPACE_ID = 'w';
const GOAL_ID = 'g';
const GOAL_REF: GoalRef = { aggregateType: 'Goal', projectId: PROJECT_ID, goalId: GOAL_ID };
const CURSOR = 'wp1-an-source-cursor' as CommitCursor;
const HOST_ACTOR: Extract<ActorRef, { kind: 'human' | 'system' }> = { kind: 'system', id: 'wp1-an-host' };
const FOCUS_RUN: RunRef = { aggregateType: 'Run', projectId: PROJECT_ID, goalId: GOAL_ID, runId: 'focus-run' };
const ROLE_BINDING: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 'wp1-an-binding', templateId: 'builder', templateRevision: '1',
  bindingVersion: 1, policyRevision: 'wp1-an-policy',
};
const REQUEST: ContextReadRequestV1 = { goalRef: GOAL_REF, focusTaskIds: [] };

function hostCtx(signal: AbortSignal): CoreCallContext {
  return {
    projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
    principal: { kind: 'host', actor: HOST_ACTOR },
    materialReader: { kind: 'host', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, actor: HOST_ACTOR },
    signal,
  };
}

function workCtx(signal: AbortSignal): CoreCallContext {
  return {
    projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
    principal: { kind: 'work_run', runRef: FOCUS_RUN, roleBinding: ROLE_BINDING },
    materialReader: { kind: 'run', requester: FOCUS_RUN },
    signal,
  };
}

function anchor(options: {
  runId: string; taskId: string; cause?: SessionAnomalyAnchorV1['cause'];
}): SessionAnomalyAnchorV1 {
  const { runId, taskId } = options;
  const changedFiles: ArchiveChangedFilesV1 = {
    source: 'kernel', status: 'known', confirmed: [], possible: [], omitted: 0,
    baseCommit: null, runBaselineKnown: false, reason: null,
  };
  return {
    ref: { aggregateType: 'SessionAnomalyAnchor', projectId: PROJECT_ID, goalId: GOAL_ID, runId },
    revision: 1, schemaVersion: 1, workspaceId: WORKSPACE_ID,
    task: { projectId: PROJECT_ID, goalId: GOAL_ID, taskId },
    planRef: { aggregateType: 'PlanRevision', projectId: PROJECT_ID, planId: 'p1' },
    lineHead: { projectId: PROJECT_ID, sessionId: 'S' },
    sessionRef: { projectId: PROJECT_ID, sessionId: 'S' },
    role: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
    runRef: { aggregateType: 'Run', projectId: PROJECT_ID, goalId: GOAL_ID, runId },
    attemptRef: { aggregateType: 'TaskAttempt', projectId: PROJECT_ID, goalId: GOAL_ID, taskId, attemptId: 'a1' },
    cause: options.cause ?? 'archive_interrupted',
    archiveRequestId: `req-${runId}`,
    archiveRequestReceipt: { identityKey: `key-${runId}`, fingerprint: `fp-${runId}` },
    archivedBy: HOST_ACTOR,
    recordedAt: t0,
    changedFiles,
    resultVerification: 'not_checked',
  };
}

function view(anchorValue: SessionAnomalyAnchorV1, pickedUpBy: RunRef | null = null): SessionAnomalyViewV1 {
  return { anchor: anchorValue, pickedUpBy };
}

function page(items: SessionAnomalyViewV1[], nextCursor: string | null = null):
ReadResult<SessionPage<SessionAnomalyViewV1>> {
  return { status: 'ready', value: { items, nextCursor, sourceCursor: CURSOR } };
}

type AnomalyInput = Parameters<SessionAnomalyPort['listSessionAnomalies']>[1];
type AnomalyDouble = {
  anomalies: Pick<SessionAnomalyPort, 'listSessionAnomalies'>;
  calls: Array<{ ctx: CoreCallContext; input: AnomalyInput }>;
};

function anomalyDouble(
  respond: (call: number, input: AnomalyInput) => ReadResult<SessionPage<SessionAnomalyViewV1>>,
): AnomalyDouble {
  const calls: AnomalyDouble['calls'] = [];
  return {
    calls,
    anomalies: {
      async listSessionAnomalies(ctx, input) {
        calls.push({ ctx, input: { ...input, page: { ...input.page } } });
        return respond(calls.length, input);
      },
    },
  };
}

function expectedExtensions(rows: ContextIndexRowV1[]): ContextExtensionsV1 {
  const ni = { availability: 'not_implemented' as const, rows: [] as ContextIndexRowV1[] };
  return {
    notes: { availability: 'not_implemented', understanding: { rows: [], norms: [], normsOmitted: 0 }, general: [] },
    anomalies: { availability: 'available', rows }, footprint: ni,
    goalSettings: { availability: 'not_implemented', autonomy: null }, decisions: ni,
  };
}

function expectReadyExtensions(result: ReadResult<ContextExtensionsV1>): ContextExtensionsV1 {
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error(`expected a ready extension read: ${JSON.stringify(result)}`);
  return result.value;
}

function anchorText(anchorValue: SessionAnomalyAnchorV1): string {
  return anchorValue.cause === 'retired_archive'
    ? `中断，待核对：任务 ${anchorValue.task.taskId} 的执行 ${anchorValue.runRef.runId} 因线退役被归档中断，改动没撤销也没核对`
    : `中断，待核对：任务 ${anchorValue.task.taskId} 的执行 ${anchorValue.runRef.runId} 被归档中断，改动没撤销也没核对`;
}

describe('WP1 context extensions provider (W1-ANOM-01, §4.2)', () => {
  it('AN01 projects one not-yet-picked-up archive_interrupted anchor with the L9 row shape', async () => {
    const a = anchor({ runId: 'r1', taskId: 't1' });
    const b = anchor({ runId: 'r2', taskId: 't2' });
    const pickedUpBy: RunRef = { aggregateType: 'Run', projectId: PROJECT_ID, goalId: GOAL_ID, runId: 'consumer' };
    const { anomalies, calls } = anomalyDouble(() => page([view(a), view(b, pickedUpBy)]));
    const read = createContextExtensionsReader({ anomalies, hostActor: HOST_ACTOR });
    const result = await read(hostCtx(new AbortController().signal), REQUEST);
    expectReadyExtensions(result);
    expect(calls[0]!.input).toEqual({ goalRef: REQUEST.goalRef, page: { limit: 100 } });
    expect(result).toEqual({ status: 'ready', value: expectedExtensions([{
      key: `anomaly:${sessionAnomalyRefKey(a.ref)}`,
      node: { kind: 'task', ref: a.task, planRef: a.planRef },
      text: anchorText(a),
      sources: [{ kind: 'record', ref: a.ref, revision: 1, digest: null }],
    }]) });
  });

  it('AN02 returns the four not_implemented extensions and an empty available anomaly list', async () => {
    const { anomalies } = anomalyDouble(() => page([]));
    const read = createContextExtensionsReader({ anomalies, hostActor: HOST_ACTOR });
    const result = await read(hostCtx(new AbortController().signal), REQUEST);
    expect(result).toEqual({ status: 'ready', value: expectedExtensions([]) });
  });

  it('AN03 pages 100 + 50 with the previous cursor, sorts 150 rows and texts retired_archive', async () => {
    const anchors = Array.from({ length: 150 }, (_, index) => anchor({
      runId: `r${String(index).padStart(3, '0')}`,
      taskId: `t${String(index).padStart(3, '0')}`,
      cause: index === 120 ? 'retired_archive' : 'archive_interrupted',
    }));
    // Feed the two pages deliberately out of key order, so an implementation
    // that merely preserves the input order cannot pass the ascending-key check.
    const ordered = [...anchors].reverse().map(item => view(item));
    const { anomalies, calls } = anomalyDouble((call) => call === 1
      ? page(ordered.slice(0, 100), 'page-1-cursor')
      : page(ordered.slice(100), null));
    const read = createContextExtensionsReader({ anomalies, hostActor: HOST_ACTOR });
    const result = await read(hostCtx(new AbortController().signal), REQUEST);
    const value = expectReadyExtensions(result);
    expect(calls.length).toBe(2);
    expect(calls[0]!.input).toEqual({ goalRef: REQUEST.goalRef, page: { limit: 100 } });
    expect(calls[1]!.input.page).toEqual({ limit: 100, cursor: 'page-1-cursor' });
    const rows = value.anomalies.rows;
    expect(rows.length).toBe(150);
    const expectedKeys = anchors
      .map(item => `anomaly:${sessionAnomalyRefKey(item.ref)}`)
      .sort();
    expect(rows.map(row => row.key)).toEqual(expectedKeys);
    const retired = rows.find(row => row.key === `anomaly:${sessionAnomalyRefKey(anchors[120]!.ref)}`);
    expect(retired?.text).toBe('中断，待核对：任务 t120 的执行 r120 因线退役被归档中断，改动没撤销也没核对');
  });

  it('AN04 returns a real rejection unchanged and maps a thrown read to unavailable', async () => {
    const rejection = { status: 'rejected', code: 'unavailable', reason: 'x' } as const;
    const first = anomalyDouble(() => rejection);
    const firstRead = createContextExtensionsReader({ anomalies: first.anomalies, hostActor: HOST_ACTOR });
    expect(await firstRead(hostCtx(new AbortController().signal), REQUEST)).toEqual(rejection);
    const second = anomalyDouble(() => { throw new Error('boom'); });
    const secondRead = createContextExtensionsReader({ anomalies: second.anomalies, hostActor: HOST_ACTOR });
    expect(await secondRead(hostCtx(new AbortController().signal), REQUEST)).toEqual({
      status: 'rejected', code: 'unavailable', reason: 'the anomaly anchor read failed: boom',
    });
  });

  it('AN05 stops at 25 pages and reports anomaly_index_page_limit', async () => {
    const one = anchor({ runId: 'r1', taskId: 't1' });
    const { anomalies, calls } = anomalyDouble(call => page([view(one)], `cursor-${String(call)}`));
    const read = createContextExtensionsReader({ anomalies, hostActor: HOST_ACTOR });
    const result = await read(hostCtx(new AbortController().signal), REQUEST);
    expect(calls.length).toBe(25);
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error(`expected a rejection: ${JSON.stringify(result)}`);
    expect(result.code).toBe('incomplete');
    expect(result.reason.startsWith('anomaly_index_page_limit:')).toBe(true);
  });

  it('AN06 (a) rebinds a work_run ctx to the host actor (b)/(c) refuses an unbound or foreign ctx', async () => {
    const one = anchor({ runId: 'r1', taskId: 't1' });
    const first = anomalyDouble(() => page([view(one)]));
    const read = createContextExtensionsReader({ anomalies: first.anomalies, hostActor: HOST_ACTOR });
    const signal = new AbortController().signal;
    const bound = workCtx(signal);
    const result = await read(bound, REQUEST);
    expectReadyExtensions(result);
    expect(first.calls.length).toBe(1);
    expect(first.calls[0]!.ctx.projectId).toBe(bound.projectId);
    expect(first.calls[0]!.ctx.workspaceId).toBe(bound.workspaceId);
    expect(first.calls[0]!.ctx.principal).toEqual({ kind: 'host', actor: HOST_ACTOR });
    expect(first.calls[0]!.ctx.materialReader).toEqual({
      kind: 'host', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, actor: HOST_ACTOR,
    });
    expect(first.calls[0]!.ctx.signal).toBe(signal);

    const unbound: CoreCallContext = {
      projectId: PROJECT_ID,
      principal: { kind: 'host', actor: HOST_ACTOR },
      materialReader: { kind: 'host', projectId: PROJECT_ID, actor: HOST_ACTOR },
      signal: new AbortController().signal,
    };
    const second = anomalyDouble(() => page([]));
    const secondRead = createContextExtensionsReader({ anomalies: second.anomalies, hostActor: HOST_ACTOR });
    expect(await secondRead(unbound, REQUEST)).toEqual({
      status: 'rejected', code: 'forbidden', reason: 'the context extensions need a bound project/workspace context',
    });
    expect(second.calls.length).toBe(0);

    const third = anomalyDouble(() => page([]));
    const thirdRead = createContextExtensionsReader({ anomalies: third.anomalies, hostActor: HOST_ACTOR });
    const foreign: ContextReadRequestV1 = { goalRef: { aggregateType: 'Goal', projectId: 'other', goalId: GOAL_ID }, focusTaskIds: [] };
    // (c) the spec pins only status/code and no owner call; not the reason.
    const foreignResult = await thirdRead(hostCtx(new AbortController().signal), foreign);
    expect(foreignResult.status).toBe('rejected');
    if (foreignResult.status !== 'rejected') {
      throw new Error(`AN06 (c) expected a rejection: ${JSON.stringify(foreignResult)}`);
    }
    expect(foreignResult.code).toBe('forbidden');
    expect(third.calls.length).toBe(0);
  });

  it('AN09 (a) maps a later not_ready page to incomplete (b) refuses an aborted signal before the owner', async () => {
    const one = anchor({ runId: 'r1', taskId: 't1' });
    const { anomalies, calls } = anomalyDouble(call => call === 1
      ? page([view(one)], 'page-1-cursor')
      : { status: 'not_ready', observed: null, required: { kind: 'platform', cursor: CURSOR } });
    const read = createContextExtensionsReader({ anomalies, hostActor: HOST_ACTOR });
    const result = await read(hostCtx(new AbortController().signal), REQUEST);
    expect(calls.length).toBe(2);
    expect(result).toEqual({
      status: 'rejected', code: 'incomplete',
      reason: 'the Goal anomaly anchors are not readable at the required watermark',
    });

    const aborted = new AbortController();
    aborted.abort();
    const second = anomalyDouble(() => page([]));
    const secondRead = createContextExtensionsReader({ anomalies: second.anomalies, hostActor: HOST_ACTOR });
    const cancelled = await secondRead(hostCtx(aborted.signal), REQUEST);
    expect(cancelled.status).toBe('rejected');
    if (cancelled.status !== 'rejected') throw new Error(`expected a rejection: ${JSON.stringify(cancelled)}`);
    expect(cancelled.code).toBe('cancelled');
    expect(second.calls.length).toBe(0);
  });
});

describe.each(['memory', 'sqlite'] as const)('WP1 real anomaly provider through the graph reader (%s)', (kind) => {
  let fixture: AnomalyReaderFixture | undefined;
  afterEach(async () => {
    const current = fixture;
    fixture = undefined;
    if (current !== undefined) await current.close();
  });

  it('AN07 reads the same unclaimed anchor row for the host ctx and another task run ctx in the Goal', async () => {
    const f = await openAnomalyReaderFixture(kind);
    fixture = f;
    const graph = f.graphReader(createContextExtensionsReader({ anomalies: f.anomalies, hostActor: f.hostActor }));
    const host = await graph.readContextFacts(f.hostCtx, f.request);
    const work = await graph.readContextFacts(f.workCtx, f.request);
    expect(host.status).toBe('ready');
    expect(work.status).toBe('ready');
    if (host.status !== 'ready' || work.status !== 'ready') {
      throw new Error(`AN07 expected two ready reads: ${JSON.stringify({ host, work })}`);
    }
    const row: ContextIndexRowV1 = {
      key: `anomaly:${sessionAnomalyRefKey(f.anchor.ref)}`,
      node: { kind: 'task', ref: f.anchor.task, planRef: f.anchor.planRef },
      text: anchorText(f.anchor),
      sources: [{ kind: 'record', ref: f.anchor.ref, revision: 1, digest: null }],
    };
    expect(host.value.extensions.anomalies).toEqual({ availability: 'available', rows: [row] });
    expect(work.value.extensions.anomalies).toEqual({ availability: 'available', rows: [row] });
  });
});
