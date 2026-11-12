/**
 * P4-tools, P5-history — slice 9 (G1's rows, landed with G3 per S9-N2), shared S9 world.
 * Named mutations: P4 `look_graph` keeps its history mode in the review Query (red at `p4-history`); P5 the history
 * schema takes `runRef` and hands it to the read (red at `p5-runref`).
 * Today (no G3) red at: the world's guard "sent no exec review round" (no review Query exists yet).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { readQueryAnswer, readPlanningQuery } from '../helpers/IV-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import {
  answerS9Review, openS9ReviewRound, openS9ReviewWorld, s9ToolResult, type S9ReviewWorld,
} from '../helpers/S9-review-fixture.js';

const worlds: S9ReviewWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

type HistoryPage = { items: unknown[]; nextCursor: string | null; executionIdentity: { turnId: string } };

describe('P4-tools: the exec review Query tool list and strict schemas', () => {
  it('read-only list with the two exec tools; findings and history-mode look_graph refused; one answer', async () => {
    const review = await openS9ReviewWorld();
    worlds.push(review);
    const round = await openS9ReviewRound({ review });
    const query = await answerS9Review(review, [
      { kind: 'calls', calls: [
        { callId: 'p4-findings', name: 'submit_exec_review',
          args: { verdict: 'fix', basis: 'P4 basis', report: 'P4 report', findings: [] } },
        { callId: 'p4-history', name: 'look_graph', args: { mode: 'history', runRef: round.subjectRunRef } }] },
      { kind: 'calls', calls: [{ callId: 'p4-pass', name: 'submit_exec_review',
        args: { verdict: 'pass', basis: 'P4 basis', report: 'P4 report' } }] },
    ], { round });
    const toolNames = query.manifest.promptSet.toolNames;
    expect(toolNames).toEqual(expect.arrayContaining(
      ['submit_exec_review', 'read_execution_history', 'read', 'look_graph', 'find_graph']));
    for (const name of ['edit', 'shell', 'write', 'record_note', 'submit_plan_review']) expect(toolNames).not.toContain(name);
    expect(await s9ToolResult(review, 'p4-findings')).toMatchObject({ status: 'error' });
    expect(await s9ToolResult(review, 'p4-history')).toMatchObject({ status: 'error' });
    const job = await readPlanningQuery(review.world, query.messageRef);
    expect(job?.job.job.answerRefs).toHaveLength(1);
    expect(await readQueryAnswer(review.world, query.queryJobRef))
      .toBe('{"schemaVersion":1,"kind":"exec_review","verdict":"pass","basis":"P4 basis","report":"P4 report"}');
  }, 120_000);
});

describe('P5-history: read_execution_history pages the frozen subject Run', () => {
  it('two pages equal the subject Run\'s executions/history pages; a runRef argument is refused', async () => {
    const review = await openS9ReviewWorld();
    worlds.push(review);
    const round = await openS9ReviewRound({ review });
    const page = async (afterCursor: string | null): Promise<HistoryPage> => ready<HistoryPage>(
      await review.world.post('executions/history', plain(S6A_SCOPE,
        { runRef: round.subjectRunRef, afterCursor, limit: 1 })), 'the subject Run history');
    const first = await page(null);
    const second = await page(first.nextCursor);
    await answerS9Review(review, [
      { kind: 'calls', calls: [
        { callId: 'p5-first', name: 'read_execution_history', args: { limit: 1 } },
        { callId: 'p5-second', name: 'read_execution_history', args: { afterCursor: first.nextCursor, limit: 1 } },
        { callId: 'p5-runref', name: 'read_execution_history', args: { runRef: round.subjectRunRef, limit: 1 } }] },
      { kind: 'calls', calls: [{ callId: 'p5-pass', name: 'submit_exec_review',
        args: { verdict: 'pass', basis: 'P5 basis', report: 'P5 report' } }] },
    ], { round });
    const toolPage = async (callId: string): Promise<HistoryPage> => {
      const result = await s9ToolResult(review, callId);
      expect(result, callId).toMatchObject({ status: 'success', output: [{ kind: 'json', value: { status: 'ready' } }] });
      return (result.output![0]!.value as { value: HistoryPage }).value;
    };
    const toolFirst = await toolPage('p5-first');
    expect(toolFirst.items).toHaveLength(1);
    expect(toolFirst.nextCursor).not.toBeNull();
    expect(toolFirst.executionIdentity.turnId).not.toBe('');
    expect({ items: toolFirst.items, nextCursor: toolFirst.nextCursor })
      .toEqual({ items: first.items, nextCursor: first.nextCursor });
    expect(JSON.stringify(toolFirst.items)).toContain('Do the S9 reviewed work');
    const toolSecond = await toolPage('p5-second');
    expect(toolSecond.items).toEqual(second.items);
    expect(toolSecond.items).not.toEqual(toolFirst.items);
    expect(await s9ToolResult(review, 'p5-runref')).toMatchObject({ status: 'error' });
  }, 120_000);
});
