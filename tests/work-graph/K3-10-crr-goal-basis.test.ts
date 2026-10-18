/**
 * F-100: the ② CRR application's Goal-basis guard (`command-rerun-request-service.ts:959`
 * replay lookup, then the Goal basis at `:1035`). Each row FIRST forms "① saved,
 * ② not committed" with the one `crr-answer:` commit fault, so a later ② attempt
 * cannot short-circuit on the receipt replay.
 *
 * (a) changing Goal CONTENT between ① and ② through the public Goal settings
 *     owner refuses the answer with the contract's T02 reason;
 * (b) pause/resume changes only the Goal revision and the answer still applies.
 *
 * The prior state is public: a real blocked Run, the real CRR request owner, the
 * real CRR card source, the real decision coordinator and the real Goal owners.
 * The only injected behaviour is the A2/A3 delegating records wrapper below.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandRerunRequestV1 } from '../../src/contracts/command-rerun-request.js';
import { openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { blockedRecord, CRR_COMMAND, crrCardOf, requestRerunOf } from '../helpers/B2-crr-world.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { GOAL_B } from '../helpers/S5-decision-fixture.js';

// §5.1's blocking `shell` stand-in, hoisted per test file: the record Run's
// real Kernel Turn holds its first call so RUN-20/RUN-22 read a real
// unresolved call. The stand-in is an injected dependency, never a fact.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of worlds.splice(0)) await world.close();
});

/** The contract's literal T02 refusal (UNKNOWN_CALL_REVIEW_T02_REASON), not recomputed. */
const T02_REASON = 'the Goal content changed since the answer captured it';

type CrrFaults = {
  /** Fail the next N ② answer commits whose identity is the CRR application. */
  answerCommits: number;
};

/**
 * The A2/A3 wrapper: every call delegates to the ONE real backend except the one
 * `crr-answer:` ② commit, which is rejected BEFORE it reaches the real store.
 */
function faultingRecords(
  backend: K3ReviewCardWorld['records'], faults: CrrFaults,
): K3ReviewCardWorld['records'] {
  return {
    ...backend,
    async commit(batch: Parameters<K3ReviewCardWorld['records']['commit']>[0]) {
      if (faults.answerCommits > 0 && batch.identityKey.startsWith('crr-answer:')) {
        faults.answerCommits -= 1;
        return { status: 'rejected' as const, code: 'unavailable' as const,
          reason: 'injected ② commit failure' };
      }
      return backend.commit(batch);
    },
  } as K3ReviewCardWorld['records'];
}

/**
 * Form "① saved, ② not committed": the public coordinator answers the card and
 * the one `crr-answer:` ② commit is rejected by the wrapper. Neither the Goal
 * nor the request changes here.
 */
async function answerButUnapplied(world: K3ReviewCardWorld, label: string) {
  const record = await blockedRecord(world, 'k3-20-a', label, [{ callId: `${label}-call`, command: CRR_COMMAND }]);
  const request = await requestRerunOf(world, record, `${label}-request`);
  const card = await crrCardOf(world);
  const answered = await world.decisionActions.resolveDecision(world.fixture.ctx, {
    input: { source: card.source, selection: { kind: 'option', optionId: 'allow_rerun' }, text: '', annotations: [] },
    meta: { requestId: `${label}-answer`, expected: card.source.pins },
  });
  expect(answered, JSON.stringify(answered)).toMatchObject({ status: 'ready', value: {
    state: 'application_not_recorded', answer: { status: 'committed' }, application: null } });
  if (answered.status !== 'ready' || answered.value.answer.status !== 'committed') {
    throw new Error(JSON.stringify(answered));
  }
  // Public read: ② wrote nothing (the request is still pending at its first revision).
  const requestRead = await world.commandRerun.readRequest(world.fixture.ctx, { ref: request.ref });
  expect(requestRead.status).toBe('ready');
  if (requestRead.status !== 'ready') throw new Error(JSON.stringify(requestRead));
  expect(requestRead.value.state).toBe('pending');
  expect(requestRead.value.revision).toBe(request.revision);
  const answerRead = await world.decisions.readDecisionAnswer(world.fixture.ctx, { source: card.source });
  expect(answerRead.status).toBe('ready');
  if (answerRead.status !== 'ready' || answerRead.value.message === null || answerRead.value.body === null) {
    throw new Error(JSON.stringify(answerRead));
  }
  expect(answerRead.value.message.application).toBeNull();
  return { request, card, answerRef: answered.value.answer.value.ref,
    selection: answerRead.value.body.selection, answerMessage: answerRead.value.message };
}

/** The public post-② state: the request and the saved answer. */
async function publicState(world: K3ReviewCardWorld, request: CommandRerunRequestV1,
  source: Parameters<K3ReviewCardWorld['decisions']['readDecisionAnswer']>[1]['source']) {
  const requestRead = await world.commandRerun.readRequest(world.fixture.ctx, { ref: request.ref });
  expect(requestRead.status).toBe('ready');
  if (requestRead.status !== 'ready') throw new Error(JSON.stringify(requestRead));
  const answerRead = await world.decisions.readDecisionAnswer(world.fixture.ctx, { source });
  expect(answerRead.status).toBe('ready');
  if (answerRead.status !== 'ready' || answerRead.value.message === null) throw new Error(JSON.stringify(answerRead));
  return { request: requestRead.value, message: answerRead.value.message };
}

describe('F-100: the ② Goal-basis guard after a saved-but-uncommitted answer', () => {
  it.each(['memory', 'sqlite'] as const)('F-100a (%s): a Goal content change refuses ② with the exact T02 reason', async kind => {
    const faults: CrrFaults = { answerCommits: 1 };
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true,
      wrapRecords: records => faultingRecords(records, faults) });
    worlds.push(world);
    const label = `f100a-${kind}`;
    const state = await answerButUnapplied(world, label);

    // Change Goal CONTENT through the public Goal settings owner (the fixture's
    // initial autonomy is after_plan_confirmation; every_step is different).
    const goalRead = await world.goalSettings.readGoalSettings(world.fixture.ctx, { goalRef: GOAL_B });
    expect(goalRead.status).toBe('ready');
    if (goalRead.status !== 'ready') throw new Error(JSON.stringify(goalRead));
    expect(goalRead.value.settings.autonomy).toBe('after_plan_confirmation');
    const changed = await world.goalSettings.setGoalSettings(world.fixture.ctx, {
      input: { goalRef: GOAL_B, autonomy: 'every_step', waitForGoalRef: null },
      meta: { requestId: `${label}-settings`, expected: [{ ref: GOAL_B, revision: goalRead.value.goal.revision }] },
    });
    expect(changed.status, JSON.stringify(changed)).toBe('committed');
    if (changed.status !== 'committed') throw new Error(JSON.stringify(changed));
    expect(changed.value.settings?.autonomy).toBe('every_step');
    expect(changed.value.revision).toBe(goalRead.value.goal.revision + 1);

    // ② now refuses: the answer's captured content basis no longer matches.
    const advanced = await world.decisionActions.advanceReviewDisposition(world.fixture.ctx, {
      input: { source: state.card.source, selection: state.selection, decisionMessageRef: state.answerRef },
      meta: { requestId: `${label}-advance`, expected: [] },
    });
    expect(advanced, JSON.stringify(advanced)).toMatchObject({ status: 'ready', value: {
      state: 'application_not_recorded',
      action: { status: 'rejected', code: 'revision_conflict', reason: T02_REASON },
      application: null } });

    // Nothing was written: the request stays pending at its revision, ③ not recorded.
    const after = await publicState(world, state.request, state.card.source);
    expect(after.request.state).toBe('pending');
    expect(after.request.revision).toBe(state.request.revision);
    expect(after.message.application).toBeNull();
    expect(after.message.revision).toBe(state.answerMessage.revision);
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)('F-100b (%s): a pause/resume that changes only the Goal revision still applies ②', async kind => {
    const faults: CrrFaults = { answerCommits: 1 };
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true,
      wrapRecords: records => faultingRecords(records, faults) });
    worlds.push(world);
    const label = `f100b-${kind}`;
    const state = await answerButUnapplied(world, label);

    const goalRead = await world.goalSettings.readGoalSettings(world.fixture.ctx, { goalRef: GOAL_B });
    if (goalRead.status !== 'ready') throw new Error(JSON.stringify(goalRead));
    const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: GOAL_B.projectId, goalId: GOAL_B.goalId };
    // Pause then resume through the real Goal control owner: content unchanged.
    const paused = await world.fixture.b2.base.goals.setGoalControl(world.fixture.ctx, {
      input: { goalRef: GOAL_B, control: 'pause', reason: null },
      meta: { requestId: `${label}-pause`,
        expected: [{ ref: GOAL_B, revision: goalRead.value.goal.revision }, { ref: phaseRef, revision: 0 }] },
    });
    expect(paused.status, JSON.stringify(paused)).toBe('committed');
    if (paused.status !== 'committed') throw new Error(JSON.stringify(paused));
    expect(paused.value.desiredState).toBe('paused');
    const resumed = await world.fixture.b2.base.goals.setGoalControl(world.fixture.ctx, {
      input: { goalRef: GOAL_B, control: 'resume', reason: null },
      meta: { requestId: `${label}-resume`,
        expected: [{ ref: GOAL_B, revision: paused.value.revision }, { ref: phaseRef, revision: 0 }] },
    });
    expect(resumed.status, JSON.stringify(resumed)).toBe('committed');
    if (resumed.status !== 'committed') throw new Error(JSON.stringify(resumed));
    expect(resumed.value.desiredState).toBe('active');
    // Hand computation: each control writes the Goal once, so pause+resume is +2.
    expect(resumed.value.revision).toBe(goalRead.value.goal.revision + 2);
    expect(resumed.value.objective).toBe(goalRead.value.goal.objective);
    expect(resumed.value.settings).toEqual(goalRead.value.goal.settings);

    // ② accepts: only the Goal revision moved, the captured content basis matches.
    const advanced = await world.decisionActions.advanceReviewDisposition(world.fixture.ctx, {
      input: { source: state.card.source, selection: state.selection, decisionMessageRef: state.answerRef },
      meta: { requestId: `${label}-advance`, expected: [] },
    });
    expect(advanced, JSON.stringify(advanced)).toMatchObject({ status: 'ready', value: {
      state: 'applied', action: { status: 'committed', value: { state: 'allowed' } },
      application: { status: 'committed' } } });
    const after = await publicState(world, state.request, state.card.source);
    expect(after.request.state).toBe('allowed');
    expect(after.request.revision).toBe(state.request.revision + 1);
    expect(after.message.application).not.toBeNull();
    expect(after.message.revision).toBe(state.answerMessage.revision + 1);
  }, 120_000);
});
