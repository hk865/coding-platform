/**
 * WK-restart (SR4 §4, book-7b §3.8): H's Host `start` and a same-directory `crash`/`reopen` with
 * `resumeOnStartup` off and on, over 19 real waits (open/answered/expired) and one released unprocessed
 * action on its own new Goal. The rebuild runs in both arms: it reads every Session's waits and the
 * released-action page. After the restart all 20 Goals carry a pending restart interruption, so decision
 * 97-9's `ask`/`off` hold leaves every one of them to a person: 0 advances in either arm, and
 * `goals/display` still shows `interrupted_pending_resume`. `queueAll`'s draining is proved by
 * `tests/app/S7B2-WK-registry.test.ts`'s `queueAll` case and WK-drain, not here.
 *
 * Public entry: `restartGoalWaits` (fixture step 5), `world.setResumeOnStartup`/`world.crash`. The observation
 * is the published `platform.workflow.advanceWork`, wrapped as a delegating A3 wrapper at the platform factory
 * (the same shape as `tests/app/S7A-host-gates.test.ts`): every real advance is forwarded unchanged and each
 * Goal's first advance (its wake) is recorded in drain order. SQLite only: the Host restarts on the same
 * directory.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoalDisplayHostReadV1 } from '../../src/app/goal-fan-out-driver.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { restartGoalWaits, type S7B2RestartWorld } from '../helpers/S7B2-WK-wake-world.js';

/** What the current platform wrapper saw; recording is off while the fixture builds its world. */
const observed = vi.hoisted(() => ({
  record: false,
  advances: [] as string[],
  releasedGoals: [] as string[],
}));

// A3: a delegating wrapper around the real platform factory, installed before the fixture's own capture spy.
// Every host start (the first one and each reopened one) gets the same forwarded methods.
vi.mock('../../src/composition/create-platform.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/composition/create-platform.js')>();
  return {
    ...actual,
    createTargetPlatform: async (...args: Parameters<typeof actual.createTargetPlatform>) => {
      const platform = await actual.createTargetPlatform(...args);
      const advance = platform.workflow.advanceWork;
      platform.workflow.advanceWork = async (ctx, input, internal) => {
        if (observed.record) {
          // One wake may take several Workflow steps; the first step of a Goal is its wake. Record that
          // step once, in drain order, so the list is the queue's wakes rather than every continuation step.
          const goalId = input.goalRef.goalId;
          if (!observed.advances.includes(goalId)) observed.advances.push(goalId);
        }
        return advance(ctx, input, internal);
      };
      const readReleased = platform.messageRelease.readReleasedActions;
      platform.messageRelease.readReleasedActions = async (ctx, input) => {
        const result = await readReleased(ctx, input);
        if (observed.record && result.status === 'ready') {
          for (const goal of result.value.goals) observed.releasedGoals.push(goal.goalId);
        }
        return result;
      };
      return platform;
    },
  };
});

const worlds: S7B2RestartWorld[] = [];

afterEach(async () => {
  observed.record = false;
  for (const fixture of worlds.splice(0)) await fixture.world.close();
});

describe('WK-restart', () => {
  it('runs the rebuild and holds every Goal with a pending restart interruption in ask and off', async () => {
    const fixture = await restartGoalWaits({ backend: 'sqlite' });
    worlds.push(fixture);
    const waitGoalIds = fixture.waitGoals.map(goal => goal.goalId);
    expect(new Set(waitGoalIds).size).toBe(19);
    // The released action has its own Goal, distinct from the 19 wait Goals.
    expect(waitGoalIds).not.toContain(fixture.releasedGoal.goalId);

    // Recovery off: the rebuild's reads still run, but the loop is unarmed and drains nothing.
    await fixture.world.setResumeOnStartup(false);
    observed.record = true;
    observed.advances.length = 0;
    observed.releasedGoals.length = 0;
    await fixture.world.crash();
    expect(observed.releasedGoals).toContain(fixture.releasedGoal.goalId);
    expect(observed.advances).toEqual([]);

    // Recovery on, `ask`: the rebuild reads the released page, then the 97-9 hold leaves all 20 interrupted
    // Goals to a person, so the armed loop records no wake.
    const snapshot = await fixture.world.settings('snapshot', {});
    if (snapshot.status !== 'ready') throw new Error(`WK-restart: the settings read is ${snapshot.status}`);
    await fixture.world.settings('automation/save', { autoReworkLimit: snapshot.value.automation.autoReworkLimit,
      resumeOnStartup: 'ask' });
    observed.advances.length = 0;
    observed.releasedGoals.length = 0;
    await fixture.world.crash();
    expect(observed.releasedGoals).toContain(fixture.releasedGoal.goalId);
    const releasedDisplay = ready<GoalDisplayHostReadV1>(await fixture.world.post('goals/display',
      plain(S6A_SCOPE, { goalRef: fixture.releasedGoal })), 'the released Goal display');
    expect(releasedDisplay.display.cause).toMatchObject({ code: 'interrupted_pending_resume',
      source: 'host_restart' });
    const waitDisplay = ready<GoalDisplayHostReadV1>(await fixture.world.post('goals/display',
      plain(S6A_SCOPE, { goalRef: fixture.waitGoals[0]! })), 'the wait Goal display');
    expect(waitDisplay.display.cause).toMatchObject({ code: 'interrupted_pending_resume',
      source: 'host_restart' });
    expect(observed.advances).toEqual([]);
  }, 240_000);
});
