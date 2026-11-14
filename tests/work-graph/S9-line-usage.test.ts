/**
 * S9 G7 M1-query / M4-mixed (memory). M1: predecessor 500000 → auto handoff; head 11→100, 22→200 → latest
 * 200/0/0/2/0, complete, refs 200 then 100. The predecessor's pages go in with the head's: only the head's
 * rounds count (mutation: predecessor as a round → refs/lineKey/observed). Other mutations: sum rounds (300),
 * first per round (22), missing page 0.
 * M4(a) usage(120000,0) → latest 120000/0/0/1; (b) no usage → run_total/null/0/[]/false; 400000 → over 0,
 * 500000 → over 1. Mutations: Run total as lastInput, (b) latest, unknown reported, threshold >= 400_000.
 */
import { afterEach, expect, it } from 'vitest';
import type { QueryRunSnapshot } from '../../src/contracts/query-job.js';
import type { SessionPage } from '../../src/core/work-graph/model/session-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { ensureProjectPointers, openingLinesOf, openS6AHostWorld, usageOf, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { openPLReadingsWorld, usage } from '../helpers/PL-readings-fixture.js';
import { waitFor } from '../scenarios/harness.js';
const opened: S6AHostWorld[] = []; afterEach(async () => { for (const world of opened.splice(0)) await world.close(); });
const readUsageOf = async (world: S6AHostWorld, line: S6ASession) => {
  // @ts-ignore -- readLineUsage lands with G7; absent today.
  const answer = await world.platform.activity.readLineUsage(world.humanContext(), { lineKey: line.ref });
  if (answer.status !== 'ready') throw new Error(`readLineUsage: ${answer.status}`);
  return answer.value;
};

it('S9 M1-query: only the new head, newest sample', async () => {
  const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'on' } });
  opened.push(world);
  const secretary = (await openingLinesOf(world)).secretary;
  await ensureProjectPointers(world);
  await world.scripted.script(secretary, [{ kind: 'text', usage: usageOf(500000),
    text: JSON.stringify({ schemaVersion: 1, body: 'M1 long', ideas: [], goalCardDrafts: [] }) }]);
  const submitted = await world.submit({ commandId: 's9-m1-handoff', goalId: S6A_GOAL_1.goalId, text: 'M1 handoff' });
  if (submitted.status !== 'queued') throw new Error(`M1 submit: ${JSON.stringify(submitted)}`);
  await world.waitForRequest(submitted.requestRoot, v => v.rounds[0]?.status === 'ended', 'the M1 handoff round');
  const headRow = await waitFor(async () => {
    const body = (await world.post('lines/list', plain(S6A_SCOPE, { workspace: S6A_SCOPE }))).body as
      { status: string; value: { rows: { key: S6ASession['ref']; duty: string }[] } };
    return body.status === 'ready' ? body.value.rows.find(row => row.duty === 'secretary'
      && row.key.sessionId !== secretary.ref.sessionId) : undefined;
  }, row => row !== undefined, 'the automatic handoff head');
  if (headRow === undefined) throw new Error('M1: no handoff head');
  const card = await world.readSession(headRow.key);
  // The Session record's own ref is the real reference the Query page carries (the claim keeps the
  // caller's exact shape); `lines/list` hands out the plain projection of the same Session.
  const head: S6ASession = { label: 'handoff-head', ref: card.record.ref, aggregateRef: card.record.ref,
    role: card.record.role, createdAt: card.record.createdAt };
  for (const [first, last, tag] of [[11, 100, 'a'], [22, 200, 'b']] as const) {
    await world.scripted.script(head, [{ kind: 'calls', calls: [{ callId: `m1-${tag}-1`, name: 'read', args: { path: 'src/module.ts' } }], usage: usageOf(first) },
      { kind: 'text', text: `M1 ${tag}`, usage: usageOf(last) }]);
    await world.finishQuery(await world.occupy(head));
  }
  const pagesOf = async (sessionRef: S6ASession['ref'], cursor: string | null = null): Promise<SessionPage<QueryRunSnapshot>[]> => {
    const body = (await world.post('sessions/queries', plain(S6A_SCOPE, { sessionRef, page: { limit: 1, ...(cursor === null ? {} : { cursor }) } }))).body as { status: string; value: SessionPage<QueryRunSnapshot> };
    if (body.status !== 'ready') throw new Error(`M1 queries: ${body.status} (whole-page reject; the ruled incomplete case needs a missing page public steps cannot make)`);
    return body.value.nextCursor === null ? [body.value] : [body.value, ...await pagesOf(sessionRef, body.value.nextCursor)];
  };
  // The predecessor Session's pages carry its 500000 handoff round. Both Sessions'
  // pages go in together: the line's newest Session is the head, so only its two
  // rounds count (mutation: treat the predecessor as another round → refs/lineKey).
  const predecessorPages = await pagesOf(secretary.ref);
  const headPages = await pagesOf(head.ref);
  const predecessor500k = predecessorPages.flatMap(page => page.items)
    .flatMap(item => item.run.executionState?.requests ?? [])
    .filter(request => request.inputTokens === 500000);
  expect(predecessor500k).toHaveLength(1);
  const sampleSourceRefOf = (tokens: number) => {
    const item = headPages.flatMap(page => page.items).find(i => (i.run.executionState?.requests ?? []).filter(r => r.inputTokens !== null).at(-1)?.inputTokens === tokens);
    if (item === undefined) throw new Error(`M1: no ${tokens} sample`);
    return { runRef: item.ref, requestId: (item.run.executionState?.requests ?? []).filter(r => r.inputTokens !== null).at(-1)!.requestId };
  };
  // @ts-ignore -- scripts/measure/line-usage.mjs lands with G7; absent today.
  const { queryLineUsageOf } = await import('../../scripts/measure/line-usage.mjs');
  const { usage: queryUsage } = queryLineUsageOf([...predecessorPages, ...headPages]);
  expect(queryUsage).toEqual({ lineKey: head.ref, headSessionRef: head.ref, lastInputTokens: 200, lastCachedInputTokens: 0, hitRate: 0, observedRounds: 2, overThresholdRounds: 0, usageStatus: 'reported', complete: true, basis: 'latest', sourceRefs: [sampleSourceRefOf(200), sampleSourceRefOf(100)] });
});

it('S9 M4-mixed: Work line latest and run_total', async () => {
  const fixture = await openPLReadingsWorld({ taskIds: ['m4-a', 'm4-b'] });
  opened.push(fixture.world);
  const [aTask, bTask] = fixture.tasks;
  if (aTask === undefined || bTask === undefined) throw new Error('M4: the Plan needs two tasks');
  const lineA = await fixture.line('m4-a', [aTask]);
  const lineB = await fixture.line('m4-b', [bTask]);
  const runA = await fixture.runTask({ line: lineA, taskId: aTask.taskId, flowId: 'm4-a', replies: [{ kind: 'text', text: 'M4 A', usage: usage(120000, 0) }] });
  await fixture.runTask({ line: lineB, taskId: bTask.taskId, flowId: 'm4-b', replies: [{ kind: 'text', text: 'M4 B' }] });
  const readUsage = async (line: S6ASession) => await readUsageOf(fixture.world, line);
  const usageA = await readUsage(lineA);
  const history = (await fixture.world.post('sessions/history', plain(S6A_SCOPE, { sessionRef: lineA.ref, afterCursor: null, throughCursor: null, limit: 100 }))).body as { status: string; value: { items: { kind: string; body: { text?: string } }[] } };
  const requestId = /"requestId":"([^"]+)"/.exec(history.value.items.find(entry => entry.kind === 'agent_event' && entry.body.text?.includes('"type":"model.request_started"'))?.body.text ?? '')?.[1];
  if (requestId === undefined) throw new Error(`M4: no platform request id: ${JSON.stringify(history)}`);
  expect(usageA).toEqual({ lineKey: lineA.ref, headSessionRef: lineA.ref, lastInputTokens: 120000, lastCachedInputTokens: 0, hitRate: 0, observedRounds: 1, overThresholdRounds: 0, usageStatus: 'reported', complete: true, basis: 'latest', sourceRefs: [{ runRef: runA, requestId }] });
  expect(await readUsage(lineB)).toEqual({ lineKey: lineB.ref, headSessionRef: lineB.ref, lastInputTokens: null, lastCachedInputTokens: null, hitRate: null, observedRounds: 0, overThresholdRounds: 0, usageStatus: 'unknown', complete: false, basis: 'run_total', sourceRefs: [] });
});

// The boundary is `SECRETARY_HANDOFF_INPUT_TOKENS` = 500_000 (request-contracts.ts:28,
// used at activity-read-model.ts:1343); lead's s9g7 mutation ruling (next1113c-lead-rulings.md:387)
// asks for 400,000 → 0 and 500,000 → 1. Mutation: `>= 400_000` makes the 400,000 entry 1.
it.each([
  { tokens: 400000, overThresholdRounds: 0 },
  { tokens: 500000, overThresholdRounds: 1 },
])('S9 Work over-threshold: $tokens → $overThresholdRounds', async ({ tokens, overThresholdRounds }) => {
  const fixture = await openPLReadingsWorld({ taskIds: ['m4-boundary'] });
  opened.push(fixture.world);
  const task = fixture.tasks[0];
  if (task === undefined) throw new Error('M4 boundary: the Plan needs one task');
  const line = await fixture.line('m4-boundary', [task]);
  await fixture.runTask({ line, taskId: task.taskId, flowId: `m4-${tokens}`,
    replies: [{ kind: 'text', text: 'M4 boundary', usage: usage(tokens, 0) }] });
  const value = await readUsageOf(fixture.world, line);
  expect({ lastInputTokens: value.lastInputTokens, overThresholdRounds: value.overThresholdRounds })
    .toEqual({ lastInputTokens: tokens, overThresholdRounds });
});
