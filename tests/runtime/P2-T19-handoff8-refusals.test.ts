/**
 * P2 T19 (frozen row :334, handoff 8): the lease dispatch guard. A Work Task
 * whose lease is still held must answer `busy`, even when an adviser planning
 * round asks. Frozen §2.5 (:179) gives two sentences: a live claim is
 * "任务正在做" (`... lease is still held by a running Run`), and a last Run
 * whose outcome is unknown and still under review (P3) gets "lease is still
 * held (… awaits review)". The named mutation removes the lease arm in
 * `dispatchTaskProblem` (`action-request.ts:290`) and must turn both red.
 *
 * Two worlds, one per sentence. The running Run is P1's world (tB held at its
 * model request). The review lease is K3L3's SQLite crash world
 * (`K3L3-adviser-world.ts`, lead 11-23 ruling 3): the Work Run's `shell` call is
 * held, the Host crashes, the takeover writes the unknown-outcome record
 * (`pending_review`) and the person continues the interrupted Goal. The Work
 * binding may run the read-only command and the read-only sandbox answers
 * available (the K3-19 stand-in, as K3L3's R9), so the Workflow's review gate
 * opens the record's review round on the Work line (`task-gate.ts` UR1); that
 * review Run, held at its model request, holds the Task's lease while the record
 * still awaits review. A person's direct intervention then opens the Goal
 * adviser's planning round, held at its model request, and the action owner is
 * called with that round's own `query_run` context (rule sheet A3,
 * `captureAnswerContexts`), as T30 does.
 *
 * The copy / unknown-duty / non-planning-adviser groups need a public copy or
 * unknown-duty round that this world cannot open; they are reported blocked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { heartbeatUntilModel } from '../helpers/IV-host-fixture.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { crashK3L3Command, openK3L3World, readK3L3Review, selectK3L3 } from '../helpers/K3L3-adviser-world.js';
import { waitFor } from '../scenarios/harness.js';
import { p1Worlds, write } from '../helpers/P1-reads.js';
import { captureAnswerContexts } from '../helpers/query-context-capture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { committed } from '../helpers/S7A-fixture.js';

// K3L3's world needs the test file's shell seam and the commit barrier's two mocks (`K3L3-adviser-world.ts` header).
// The read-only sandbox: the real one for P1's world, the K3-19 stand-in (available) for the review round.
const sandbox = vi.hoisted(() => ({ available: true as boolean, real: true as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  const { createProcessSandboxSwitch } = await import('../scenarios/support/process-sandbox-standin.js');
  return { ...actual, ProcessSandbox: createProcessSandboxSwitch(actual, sandbox) };
});
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]):
    ToolDefinition => (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;
vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

afterEach(() => { shellSeam.release(); commitBarrier.reset(); sandbox.real = true; sandbox.available = true; });

describe('P2 T19: handoff-8 refusals', () => {
  it('refuses a dispatch while the lease is held by a running Run with the frozen busy sentence', async () => {
    const worlds = p1Worlds();
    const p1 = await worlds.open({ running: true });
    try {
      const a = await p1.hold(p1.lines.A, 'p2-t19');
      const dispatch = await p1.world.platform.actionRequests.requestDispatch(a.ctx,
        write({ taskRef: p1.task.tB, reason: 'P2 T19 review lease' }, 'p2-t19-dispatch'));
      expect(dispatch).toMatchObject({ status: 'rejected', code: 'busy' });
      if (dispatch.status === 'rejected') {
        expect(dispatch.reason, 'the lease sentence').toContain('lease is still held');
        expect(dispatch.reason, 'a running Run, not an outcome awaiting review').toContain('by a running Run');
      }
    } finally {
      await worlds.closeAll();
    }
  }, 240_000);

  it('refuses a dispatch while the review lease is held with the frozen review sentence', async () => {
    sandbox.real = false;
    const w = await openK3L3World('p2-t19-review', { readonlyCommands: true });
    try {
      const runRef = await crashK3L3Command(w, 'p2-t19-review');
      // The takeover wrote the unknown-outcome record; it waits for its review.
      expect(await readK3L3Review(w, runRef)).toMatchObject({ status: 'pending_review', activeRound: null });
      // The Workflow opens the record's review round on the Work line; its Run is held at its model request.
      await w.world.scripted.script(w.workLine, [{ kind: 'text', text: 'P2 T19 review round answer' }]);
      const reviewModel = await w.world.gates.modelRequest(w.workLine);
      let failure: unknown = null;
      const reviewDrive = driveWorkflow(w.world.ag2b, selectK3L3(w, 'p2-t19-review-round'))
        .catch(error => { failure = error; });
      let reached = false;
      void reviewModel.reached.then(() => { reached = true; });
      await waitFor(async () => reached || failure !== null, done => done, 'T19: the review Run at its model request');
      if (failure !== null) throw failure;
      expect(await readK3L3Review(w, runRef)).toMatchObject({ status: 'pending_review',
        activeRound: { phase: 'review' } });
      await w.world.scripted.script(w.adviser, [{ kind: 'text', text: 'P2 T19 review-lease round answer' }]);
      const model = await w.world.gates.modelRequest(w.adviser);
      const capture = captureAnswerContexts();
      try {
        committed(await w.world.post('messages/send', graphWrite(S6A_SCOPE, {
          recipient: w.adviser.ref, text: 'P2 T19 open the adviser round', entry: 'person_intervention',
          needsReply: true, goalRef: w.goal,
        }, 'p2-t19-review-open')), 'the T19 opening message');
        const { settled } = await heartbeatUntilModel(w.world, model);
        // The round is held at its model request: its own context, as the Runtime handed it to the round's tools.
        const occupancy = (await w.world.readSession(w.adviser)).record.occupancy;
        const ctx = occupancy?.kind === 'execution' ? capture.ofRun(occupancy.executionRef.runId) : undefined;
        if (ctx === undefined) throw new Error('T19: no held adviser round context');
        const dispatch = await w.world.platform.actionRequests.requestDispatch(ctx,
          write({ taskRef: w.task, reason: 'P2 T19 review lease' }, 'p2-t19-review-dispatch'));
        expect(dispatch).toMatchObject({ status: 'rejected', code: 'busy' });
        if (dispatch.status === 'rejected') {
          expect(dispatch.reason, 'the lease sentence').toContain('lease is still held');
          expect(dispatch.reason, 'the unknown outcome awaiting review').toContain('awaits review');
        }
        model.release();
        await settled;
      } finally {
        capture.restore();
        reviewModel.release();
        await reviewDrive;
      }
    } finally {
      await w.world.close();
    }
  }, 300_000); // K3L3's read-only review path (its R9) runs on the same budget.
});
