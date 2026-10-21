/**
 * Rework 4 item 5: ONE 401-Run world for B2-18 and B2-16.
 *
 * The world is built once (vitest isolates files): the real first blocked
 * record, then R = 401 real continuation Runs, one CRR request each: 400
 * refused through the real `decisions/answer` owner and the LAST (page 3)
 * really allowed. The rows then measure only reads:
 *   B2-16 (iii): the hook call reads ONE record, exactly 3 `k3-crr-by-task`
 *     pages [200,200,200], ONE Task closure and at most 2 distinct
 *     `package.json` files.
 *   F-032: the exact command of the allowed request on the last page is
 *     allowed (the one-time allowance is consumed) — a one-page read would
 *     see only the first 200 requests and no allowance.
 *   rework 2 item 4 / B2-18: the 402nd request reads exactly 3 task pages
 *     [200,200,200], no other CRR index and no point read, and writes ONE CRR;
 *     after the allowance was consumed it is still `requested`.
 *
 * The continuation end is reported (UNSPECIFIED, lead-approved): a natural text
 * reply leaves the Task verifying and the public requeue refuses it with
 * `{"status":"rejected","code":"busy","reason":"the selected Run is verifying; finalize its round first"}`
 * (task-machine.ts:1218), and a tools:[] text Run has no review record to claim
 * a round from. The Runtime therefore ends each continuation
 * through the scripted model's `beforeReply` fault (`run_crashed`), the one
 * public crashed end rework 4 item 1 names; nothing is hand-written.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { runHook } from '../helpers/B2-blocked-runtime.js';

// §5.1's stand-in `shell`, hoisted per test file: the seed's real Run uses it.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

import { B401_R, openB401World, shellCall, type B401World } from '../helpers/B2-401-world.js';
import {
  K3_CRR_BY_GOAL_STATE_LOOKUP, K3_CRR_BY_TASK_ALIAS_LOOKUP, K3_CRR_BY_TASK_LOOKUP,
} from '../../src/core/work-graph/tasks/command-rerun-request-codecs.js';

let shared: B401World | undefined;

async function sharedWorld(): Promise<B401World> {
  if (shared === undefined) shared = await openB401World();
  return shared;
}

afterAll(async () => { await shared?.close(); });

describe('B2-401 world', () => {
  it('B2-16 (iii): R = 401 reads exactly three pages and ONE closure read for the hook call', async () => {
    const row = Date.now();
    const w = await sharedWorld();
    const buildMs = w.buildMs;
    w.resetCounters();
    // A non-exact form so the recognizer (and its package reads) really runs.
    expect(await runHook(w.hook, shellCall('b2-401-hook-call-1', 'bash -c "cd app && npm run db:migrate"')))
      .toMatchObject({ point: 'before_tool', kind: 'block' });
    expect(w.requestCount).toBe(B401_R);
    expect(w.counters.recordReads).toHaveLength(1);
    const taskPages = w.counters.pages.get(K3_CRR_BY_TASK_LOOKUP) ?? [];
    // Exactly ceil(401/200) = 3 physical pages, 200 each.
    expect(taskPages).toHaveLength(3);
    expect(taskPages.map(page => page.limit)).toEqual([200, 200, 200]);
    expect(taskPages[0]!.after).toBeUndefined();
    expect(new Set(taskPages.slice(1).map(page => page.after)).size).toBe(2);
    // Item 2: the whole 3-page hook call reads the Task closure exactly once.
    expect(w.counters.closureReads).toEqual([w.task.taskId]);
    expect(w.counters.packageReads.length).toBeLessThanOrEqual(2);
    expect(new Set(w.counters.packageReads).size).toBe(w.counters.packageReads.length);
    console.log(`B2-401 world build ${String(buildMs)} ms; B2-16 (iii) row ${String(Date.now() - row)} ms`);
  }, 1_200_000);

  it('F-032 hook: the one-time allowance on the LAST of 401 task pages allows the exact command', async () => {
    const row = Date.now();
    const w = await sharedWorld();
    expect(w.requestCount).toBe(B401_R);
    // The LAST built request is the last in canonical task-page order, so the
    // hook can only reach it after the third page.
    const last = w.lastRequest;
    expect(last.ref.requestId).toBe('b2-401-request-401');
    expect(last.usedBy).toBeNull();
    w.resetCounters();
    const call = shellCall('b2-401-hook-allowed', last.command);
    const decision = await runHook(w.hook, call);
    const taskPages = w.counters.pages.get(K3_CRR_BY_TASK_LOOKUP) ?? [];
    // The whole Task set: 200 + 200 + 1 physical pages. Removing the
    // cross-page read would see only the first 200 requests and no allowance.
    expect(taskPages).toHaveLength(3);
    expect(taskPages.map(page => page.limit)).toEqual([200, 200, 200]);
    expect(taskPages.map(page => page.records.length)).toEqual([200, 200, 1]);
    expect(taskPages[0]!.records).not.toContain(w.lastRequestRefKey);
    expect(taskPages[1]!.records).not.toContain(w.lastRequestRefKey);
    // The allowed request is the ONLY record on the last page, and it really
    // changes the answer: the same exact command is allowed, not blocked.
    expect(taskPages[2]!.records).toEqual([w.lastRequestRefKey]);
    // Item 2: the whole hook call reads the Task closure exactly once.
    expect(w.counters.closureReads).toEqual([w.task.taskId]);
    expect(decision).toEqual({ point: 'before_tool', kind: 'continue' });
    // The request captured before the hook was the real unused `allow_rerun`.
    expect(w.lastRequest).toMatchObject({ state: 'allowed', usedBy: null });
    // The one-time allowance is `used` through the PUBLIC request read, by the
    // exact Run call that consumed it.
    const read = await w.requestService.readRequest(w.ctx, { ref: last.ref });
    expect(read).toMatchObject({ status: 'ready', value: { state: 'used',
      usedBy: { runId: w.record.runRef.runId, callId: call.callId } } });
    console.log(`B2-401 world build ${String(w.buildMs)} ms; F-032 hook row ${String(Date.now() - row)} ms`);
  }, 1_200_000);

  it('rework 2 item 4 / B2-18 request reads: R = 401 reads exactly three task pages for one request call', async () => {
    const row = Date.now();
    const w = await sharedWorld();
    w.resetCounters();
    // The 402nd request runs in its own REAL continuation Run (requeue +
    // claim + production prepare/startRun, held in flight before its end).
    const next = await w.startNext();
    try {
      const asked = await w.requestService.requestRerun(next.ctx, {
        input: { task: w.task, runRef: next.entered.run.ref, command: 'npm run db:migrate',
          reason: 'the measured 402nd round' },
        meta: { requestId: 'b2-401-request-402', expected: [] },
      });
      // Item 8: a real CRR-01 write returns the request plus its outcome. The
      // F-032 row above consumed the only allowance, so the alias has no
      // pending/allowed request left and this is a genuinely NEW request.
      expect(asked).toMatchObject({ status: 'committed', value: { outcome: { status: 'requested' } } });
      const taskPages = w.counters.pages.get(K3_CRR_BY_TASK_LOOKUP) ?? [];
      // The 401 existing rows: exactly ceil(401/200) = 3 pages, 200 each.
      expect(taskPages).toHaveLength(3);
      expect(taskPages.map(page => page.limit)).toEqual([200, 200, 200]);
      expect(taskPages[0]!.after).toBeUndefined();
      expect(new Set(taskPages.slice(1).map(page => page.after)).size).toBe(2);
      // NO other request read: no other CRR index and no point read of a request.
      expect(w.counters.pages.get(K3_CRR_BY_GOAL_STATE_LOOKUP) ?? []).toHaveLength(0);
      expect(w.counters.pages.get(K3_CRR_BY_TASK_ALIAS_LOOKUP) ?? []).toHaveLength(0);
      expect(w.counters.pointReadKeys).toEqual([]);
      // Exactly ONE CRR write for the measured request.
      expect(w.counters.crrWrites).toBe(1);
    } finally {
      next.release();
      await next.started.catch(() => undefined);
      await w.close();
    }
    expect(w.counters.crrWrites).toBe(1);
    console.log(`B2-401 world build ${String(w.buildMs)} ms; B2-18 request row ${String(Date.now() - row)} ms`);
  }, 1_200_000);
});
