/**
 * Slice 2C row 2C-33 (LE4, L12): the `conversation` section is only the original
 * history, read one segment at a time through the AgentRuntime and never merged
 * by time.
 *
 * This file covers the reachable part in this sandbox: a single-segment line's
 * conversation pages exactly reproduce the entries of the direct
 * `sessions/history` route, in order, with the `before_header`/`header_only`
 * cursor boundary and no duplicate/missing entry. The predecessor P + head H
 * chain and the injected-clock reversal need the Workflow's fallback
 * continuation (Kernel close unavailable) plus a controllable clock; they are
 * reported, not faked.
 *
 * Entry LE4: `openHostScenario`, the real `lines/page` and `sessions/history`
 * routes.
 */
import { afterEach, expect, it } from 'vitest';
import { cleanupScenarios, openHostScenario, performs } from './harness.js';
import { AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_ROLE, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { readExecution, moveKernelAside } from '../helpers/A2-restart-fixture.js';
import { lineConversation, ready } from '../helpers/S2C-K-scenario-support.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { CreateSessionRequest } from '../../src/core/agent-runtime/session-operations.js';
import type { SessionHistoryEntry } from '../../src/core/agent-runtime/session-operations.js';
import type { WorkLineConversationPageV1 } from '../../src/app/core-http-types.js';

afterEach(cleanupScenarios);

function historyItems(page: WorkLineConversationPageV1): SessionHistoryEntry[] {
  return page.items.flatMap(item => item.kind === 'history' ? [item.entry] : []);
}

async function directHistory(h: Awaited<ReturnType<typeof openHostScenario>>, key: SessionRef): Promise<SessionHistoryEntry[]> {
  const direct = ready(await h.post<ReadResult<{ items: SessionHistoryEntry[]; nextCursor: string | null }>>('sessions/history',
    plain(AG2B_SCOPE, { sessionRef: key, afterCursor: null, throughCursor: null, limit: 200 })), `sessions/history ${key.sessionId}`);
  return direct.items;
}

it('2C-33 the conversation section pages the original history exactly as sessions/history, with the segment header first', async () => {
  const h = await openHostScenario({ script: { replies: [{ kind: 'text', text: '2C-33: one completed original Turn' }] } });
  await h.advance(h.select('s2c33-run', 'ag2b-work'), { stopBefore: performs('run_check') });
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Run must be selected');
  const session = (await readExecution(h.host, runRef)).session;
  const key: SessionRef = { projectId: session.ref.projectId, sessionId: session.ref.sessionId };

  const direct = ready(await h.post<ReadResult<{ items: SessionHistoryEntry[]; nextCursor: string | null }>>('sessions/history',
    plain(AG2B_SCOPE, { sessionRef: key, afterCursor: null, throughCursor: null, limit: 200 })), 'sessions/history');
  expect(direct.items.length).toBeGreaterThan(0);

  // Page with limit 2 to force the segment header and the cursor boundaries.
  const pages: WorkLineConversationPageV1[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 100; guard += 1) {
    const page = ready(await lineConversation(h, key, { limit: 2, ...(cursor === undefined ? {} : { cursor }) }),
      `lines/page conversation page ${guard}`);
    pages.push(page);
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  const flat = pages.flatMap(page => page.items);
  expect(flat[0]).toMatchObject({ kind: 'segment' });
  const first = flat[0];
  if (first?.kind !== 'segment') throw new Error('the first item must be the segment header');
  expect(first.segment.session).toEqual(key);
  expect(first.segment.history).toBe('readable');

  const streamed = pages.flatMap(historyItems);
  expect(streamed.map(entry => entry.cursor)).toEqual(direct.items.map(entry => entry.cursor));
  expect(streamed.map(entry => entry.kind)).toEqual(direct.items.map(entry => entry.kind));
  for (const item of flat) {
    if (item.kind === 'history') expect(item.session).toEqual(key);
  }

  // The section is the conversation one, and the last page reports no further cursor.
  for (const page of pages) expect(page.section).toBe('conversation');
  expect(pages.at(-1)?.nextCursor).toBeNull();
}, 240_000);

it('2C-33 (chain) a continuation head H pages its predecessor P first, then H, each segment exactly its own sessions/history', async () => {
  const h = await openHostScenario({ script: { replies: [{ kind: 'text', text: '2C-33: predecessor history' }] } });
  await h.advance(h.select('s2c33b-run', 'ag2b-work'), { stopBefore: performs('run_check') });
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Run must be selected');
  const p = (await readExecution(h.host, runRef)).session;
  const pKey: SessionRef = { projectId: p.ref.projectId, sessionId: p.ref.sessionId };

  // H is created as P's continuation through the same public `sessions/create` the Workflow uses.
  const created = await h.post<{ status: string; value: { ref: { projectId: string; sessionId: string } } }>('sessions/create',
    plain(AG2B_SCOPE, {
      workspace: AG2B_SCOPE, role: AG2B_WORK_ROLE, recommendedRefs: [], initialLinks: [],
      provenance: { schemaVersion: 1, kind: 'continuation', from: pKey, reason: 'interrupted',
        task: { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId: 'ag2b-work' } },
      meta: { requestId: 's2c33b-h', expected: [] },
    } satisfies CreateSessionRequest));
  expect(created.status).toBe('completed');
  const hKey: SessionRef = { projectId: created.value.ref.projectId, sessionId: created.value.ref.sessionId };

  const expectedP = await directHistory(h, pKey);
  const expectedH = await directHistory(h, hKey);
  expect(expectedP.length).toBeGreaterThan(0);
  expect(expectedH.length).toBeGreaterThan(0);

  const pages: WorkLineConversationPageV1[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 100; guard += 1) {
    const page = ready(await lineConversation(h, hKey, { limit: 3, ...(cursor === undefined ? {} : { cursor }) }),
      `lines/page chain page ${guard}`);
    pages.push(page);
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  const flat = pages.flatMap(page => page.items);
  const segments = flat.filter((item): item is Extract<typeof item, { kind: 'segment' }> => item.kind === 'segment');
  expect(segments.map(item => item.segment.session)).toEqual([pKey, hKey]);
  const streamed = pages.flatMap(historyItems);
  expect(streamed.map(entry => `${entry.source.kernelSessionId}:${entry.cursor}`))
    .toEqual([...expectedP, ...expectedH].map(entry => `${entry.source.kernelSessionId}:${entry.cursor}`));
  expect(streamed.map(entry => entry.kind)).toEqual([...expectedP, ...expectedH].map(entry => entry.kind));
  expect(pages.at(-1)?.nextCursor).toBeNull();
}, 240_000);

it('2C-33 (stale) a chain that gained a successor after page 1 makes the old cursor answer source_stale, and a fresh read is normal', async () => {
  const h = await openHostScenario({ script: { replies: [{ kind: 'text', text: '2C-33: single segment' }] } });
  await h.advance(h.select('s2c33c-run', 'ag2b-work'), { stopBefore: performs('run_check') });
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Run must be selected');
  const p = (await readExecution(h.host, runRef)).session;
  const pKey: SessionRef = { projectId: p.ref.projectId, sessionId: p.ref.sessionId };

  const first = ready(await lineConversation(h, pKey, { limit: 1 }), 'the first conversation page');
  expect(first.items).toHaveLength(1);
  expect(first.items[0]).toMatchObject({ kind: 'segment' });
  if (first.nextCursor === null) throw new Error('the first page must carry a cursor');

  // The chain gains a successor: the cursor's bound chain is now stale.
  const created = await h.post<{ status: string; value: { ref: { projectId: string; sessionId: string } } }>('sessions/create',
    plain(AG2B_SCOPE, {
      workspace: AG2B_SCOPE, role: AG2B_WORK_ROLE, recommendedRefs: [], initialLinks: [],
      provenance: { schemaVersion: 1, kind: 'continuation', from: pKey, reason: 'interrupted',
        task: { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId: 'ag2b-work' } },
      meta: { requestId: 's2c33c-h', expected: [] },
    } satisfies CreateSessionRequest));
  expect(created.status).toBe('completed');
  const stale = await lineConversation(h, pKey, { limit: 3, cursor: first.nextCursor });
  expect(stale).toMatchObject({ status: 'rejected', code: 'source_stale' });

  // A fresh read from the first page resolves the new head and reads both segments.
  const freshSegments: string[] = [];
  let freshCursor: string | undefined;
  for (let guard = 0; guard < 100; guard += 1) {
    const fresh = ready(await lineConversation(h, pKey, { limit: 3, ...(freshCursor === undefined ? {} : { cursor: freshCursor }) }),
      `the fresh read page ${guard}`);
    for (const item of fresh.items) if (item.kind === 'segment') freshSegments.push(item.segment.session.sessionId);
    if (fresh.nextCursor === null) break;
    freshCursor = fresh.nextCursor;
  }
  expect(freshSegments).toContain(pKey.sessionId);
  expect(freshSegments).toContain(created.value.ref.sessionId);
}, 240_000);

it('2C-33 (missing) a segment whose Kernel store is missing emits only its header and never reads the Runtime', async () => {
  let h: Awaited<ReturnType<typeof openHostScenario>> | undefined;
  h = await openHostScenario({ script: { replies: [
    { kind: 'calls', calls: [{ callId: 's2c33d-g1', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'text', text: '2C-33: the missing-Kernel Turn is never answered' },
  ] } });
  const held = h.holdReply(1);
  const toStart = await h.advance(h.select('s2c33d-run', 'ag2b-work'), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('the Workflow must reach the start');
  void h.post('workflow/advance', plain(AG2B_SCOPE, toStart.next)).catch(() => undefined);
  await held.reached;
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Run must be selected');
  const key: SessionRef = { projectId: runRef.projectId, sessionId: (await readExecution(h.host, runRef)).session.ref.sessionId };
  await moveKernelAside(h.database);
  await h.restart({ crash: true });

  const page = ready(await lineConversation(h, key, { limit: 5 }), 'the missing-segment conversation');
  const segments = page.items.filter(item => item.kind === 'segment');
  expect(segments).toHaveLength(1);
  const segment = segments[0];
  if (segment?.kind !== 'segment') throw new Error('the segment header is expected');
  expect(segment.segment.history).toBe('not_readable');
  expect(segment.segment.reason?.code).toBe('retired_missing');
  expect(page.items.filter(item => item.kind === 'history')).toHaveLength(0);
  expect(page.nextCursor).toBeNull();
}, 240_000);


