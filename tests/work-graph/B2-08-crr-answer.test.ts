/**
 * B2-08/B2-09 (answer half) / L19a: a real CRR card answered through the ONE
 * `resolveDecision` coordinator. `allow_rerun`/`deny`/`deny_final` write the
 * request state (read back through the public request read); the event codec's
 * proof/usedBy shape is the pure `B2-command-rerun-request-event-pure.test.ts`
 * row (rework 9 F-024), so these rows never read the event store. A paused Goal
 * is `busy` and writes nothing; a Task that is no longer active closes the
 * request and refuses the answer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setK3TaskDisposition, openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { blockedRecord, CRR_COMMAND, crrCardOf, crrSourceOf, requestRerunOf } from '../helpers/B2-crr-world.js';
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
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

function ctxOf(world: K3ReviewCardWorld) { return world.fixture.ctx; }

async function answerCrr(world: K3ReviewCardWorld, optionId: string, requestId: string) {
  const card = await crrCardOf(world);
  return await world.decisionActions.resolveDecision(ctxOf(world), {
    input: { source: card.source, selection: { kind: 'option', optionId }, text: '', annotations: [] },
    meta: { requestId, expected: card.source.pins },
  });
}

async function pauseGoal(world: K3ReviewCardWorld): Promise<void> {
  const goal = await world.fixture.b2.base.plans.queryGoal(ctxOf(world), GOAL_B);
  if (goal.status !== 'ready') throw new Error(JSON.stringify(goal));
  const written = await world.fixture.b2.base.goals.setGoalControl(ctxOf(world), {
    input: { goalRef: GOAL_B, control: 'pause', reason: 'B2-08 pause' },
    meta: { requestId: 'b2-08-pause', expected: [{ ref: GOAL_B, revision: goal.value.goal.revision },
      { ref: { aggregateType: 'GoalPhase', projectId: GOAL_B.projectId, goalId: GOAL_B.goalId }, revision: 0 }] },
  });
  expect(written).toMatchObject({ status: 'committed' });
}

describe.each(['memory', 'sqlite'] as const)('B2-08/B2-09: CRR answers (%s)', kind => {
  it.each([
    ['allow_rerun', 'allowed'],
    ['deny', 'denied'],
    ['deny_final', 'denied_final'],
  ] as const)('B2-08: %s writes the request state and the public read agrees', async (optionId, state) => {
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
    worlds.push(world);
    const record = await blockedRecord(world, 'k3-20-a', `b2-08-${optionId}`,
      [{ callId: `k3-08-${optionId}`, command: CRR_COMMAND }]);
    await requestRerunOf(world, record, `b2-08-${optionId}-request`);
    const result = await answerCrr(world, optionId, `b2-08-${optionId}-answer`);
    expect(result).toMatchObject({ status: 'ready', value: { state: 'applied',
      action: { status: 'committed', value: { state } } } });
    if (result.status !== 'ready' || result.value.action === null || result.value.action.status !== 'committed') {
      throw new Error(JSON.stringify(result));
    }
    const committedAction = result.value.action as unknown as { value: { state: string; ref: never } };
    const read = await world.commandRerun.readRequest(ctxOf(world), { ref: committedAction.value.ref });
    expect(read).toMatchObject({ status: 'ready', value: { state } });
  }, 120_000);

  it('B2-08: a paused Goal answers busy and writes nothing', async () => {
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
    worlds.push(world);
    const record = await blockedRecord(world, 'k3-20-a', 'b2-08-paused',
      [{ callId: 'k3-08-paused', command: CRR_COMMAND }]);
    const request = await requestRerunOf(world, record, 'b2-08-paused-request');
    await pauseGoal(world);
    const result = await answerCrr(world, 'allow_rerun', 'b2-08-paused-answer');
    expect(result).toMatchObject({ status: 'ready', value: { state: 'awaiting_resume',
      action: { status: 'rejected', code: 'busy' } } });
    expect(await world.commandRerun.readRequest(ctxOf(world), { ref: request.ref })).toMatchObject({
      status: 'ready', value: { state: 'pending', revision: request.revision } });
  }, 120_000);

  it('B2-08: a Task that is no longer active closes the request and refuses the answer', async () => {
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
    worlds.push(world);
    const record = await blockedRecord(world, 'k3-20-a', 'b2-08-inactive',
      [{ callId: 'k3-08-inactive', command: CRR_COMMAND }]);
    const request = await requestRerunOf(world, record, 'b2-08-inactive-request');
    await setK3TaskDisposition(world, 'k3-20-a', 'cancelled');
    const read = await world.commandRerun.readRequest(ctxOf(world), { ref: request.ref });
    expect(read).toMatchObject({ status: 'ready', value: { state: 'closed' } });
    const refused = await world.decisionActions.resolveDecision(ctxOf(world), {
      input: { source: crrSourceOf(request, read.status === 'ready' ? read.value.revision : request.revision),
        selection: { kind: 'option', optionId: 'allow_rerun' }, text: '', annotations: [] },
      meta: { requestId: 'b2-08-inactive-answer',
        expected: [{ ref: request.ref, revision: request.revision }] },
    });
    // The card is closed, its options are gone: the answer itself is refused.
    expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
    const after = await world.commandRerun.readRequest(ctxOf(world), { ref: request.ref });
    expect(after).toMatchObject({ status: 'ready', value: { state: 'closed' } });
  }, 120_000);
});
