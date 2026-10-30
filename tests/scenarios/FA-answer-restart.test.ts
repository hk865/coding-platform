/**
 * FA-7 (decision 97-3 §2): a real accepted submit answers a request round even
 * when the Host dies between the Kernel terminal and the answer's commit. The
 * restart reconcile reads the same Kernel history through the Query observer
 * (Q-03), so `requests/read` shows the answer.
 *
 * SQLite only: the row crashes the Host and starts a new one on the same
 * database. The answer terminal commit is held by the existing backend barrier;
 * the model reply calls `submit_initial_questions` on the goal-less main scope.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { FA_INITIAL_QUESTIONS_FORM, faInitialQuestionsStored, roundOf } from '../helpers/FA-forms.js';
import { waitForRound } from '../helpers/S6A-history-fixture.js';
import {
  crashS6B3Host, holdS6B3AnswerTerminalGate, holdS6B3RequestAnswer, openS6B3World, type S6B3World,
} from '../helpers/S6B3-fixture.js';

// The answer terminal gate is the commit barrier, so the file owns its two backend mocks.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6B3World[] = [];

afterEach(async () => {
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
});

describe('FA-7: an accepted submit survives the Host stopping before its commit (SQLite only)', () => {
  it('books the answer through Q-03 and requests/read shows it after the restart', async () => {
    const world = await openS6B3World({ backend: 'sqlite' });
    worlds.push(world);
    const held = await holdS6B3RequestAnswer(world, {
      scope: world.mainScope,
      label: 'fa7',
      goalId: null,
      executionKind: 'initial_coordination',
      reply: () => ({
        kind: 'calls',
        calls: [{ callId: 'fa7-submit', name: 'submit_initial_questions', args: FA_INITIAL_QUESTIONS_FORM }],
      }),
    });
    // Arm the terminal gate before the round runs; the crash starts the new Host
    // while the old answer commit is still held, so only Q-03 can book it.
    const terminal = holdS6B3AnswerTerminalGate(world, async () => {
      await crashS6B3Host(world);
    }, held.round);
    held.gate.release();
    await terminal;

    const view = await waitForRound(world.host, held.request.requestRoot, held.round, 'ended');
    const ended = roundOf(view, held.round);
    if (ended.answer === null) throw new Error('FA-7: the restarted Host booked no answer');
    expect(JSON.parse(ended.answer)).toEqual(faInitialQuestionsStored());
    expect(ended).toMatchObject({ status: 'ended', closeCode: null });

    // The same round through the Host route after the restart.
    const read = await world.host.post('requests/read', plain(world.mainScope, { requestRoot: held.request.requestRoot }));
    expect(read.httpStatus).toBe(200);
    const body = read.body as { status: string; value: RequestCoreViewV1 };
    expect(body.status).toBe('ready');
    const shown = roundOf(body.value, held.round);
    if (shown.answer === null) throw new Error('FA-7: requests/read shows no answer after the restart');
    expect(JSON.parse(shown.answer)).toEqual(faInitialQuestionsStored());
  }, 120_000);
});
