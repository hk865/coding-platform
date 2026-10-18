/**
 * K3-17 (L19 ②): the disposition commit guards the Goal revision it read in
 * THIS call, not only the review record. The interleaving is the §5.1 "two
 * orders" wrapper: the wrapped records port runs a real `setGoalControl(pause)`
 * through the public Goal owner immediately before the first
 * `UnknownCallReviewChanged` / `disposition_applied` commit. The target's own
 * guard then decides.
 *
 * Today the disposition still commits while the Goal is paused (RED); with the
 * guard it is `revision_conflict`, the retry is `busy`, and after the public
 * resume the same answer applies.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { DecisionSourceV1 } from '../../src/contracts/goal-decisions.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { createDecisionActions } from '../../src/business/workflow/decision-actions.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { readGoalPhase } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import {
  createK3NeedsDecisionRecord, openK3ReviewCardWorld, type K3ReviewCardWorld,
} from '../helpers/K3-review-card-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { GOAL_B, WORKSPACE_SCOPE } from '../helpers/S5-decision-fixture.js';
import { goalAt } from '../helpers/S5-application-support.js';

// §5.1's stand-in `shell`: the real record's one blocked call is held until the
// recognition path has read the draft (the real shell needs bwrap, which DSH
// does not have). The mock is per test file, so this file owns it.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]) =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of worlds.splice(0)) await world.close();
});

async function cardOf(world: K3ReviewCardWorld, record: UnknownCallReviewV1) {
  const page = await world.cardSource.readPage(world.fixture.ctx, { workspace: WORKSPACE_SCOPE, goalRef: GOAL_B,
    page: { limit: 100 } });
  if (page.status !== 'ready') throw new Error(`the card page failed: ${JSON.stringify(page)}`);
  const key = decisionSourceKey({ kind: 'unknown_call_review', reviewRef: record.ref, revision: record.revision });
  const card = page.value.items.find(item => item.source.key === key);
  if (card === undefined) throw new Error(`the card ${key} is not on the source page`);
  return card;
}

function goalPhaseRef() {
  return { aggregateType: 'GoalPhase' as const, projectId: GOAL_B.projectId, goalId: GOAL_B.goalId };
}

/** A records port that runs the real Goal pause once, right before the disposition commit. */
function pausedBeforeDisposition(records: K3ReviewCardWorld['records'], pause: () => Promise<void>) {
  let fired = false;
  const wrapped: K3ReviewCardWorld['records'] = {
    ...records,
    async commit(batch: Parameters<K3ReviewCardWorld['records']['commit']>[0]) {
      const isDisposition = batch.events.some((event) => {
        if (event.eventType !== 'UnknownCallReviewChanged') return false;
        const body = JSON.parse(event.json) as { change?: unknown };
        return body.change === 'disposition_applied';
      });
      if (!fired && isDisposition) {
        fired = true;
        await pause();
      }
      return records.commit(batch);
    },
  };
  return wrapped;
}

describe('K3-17 (L19) ② guards the Goal it read', () => {
  // The real record is recognized through the shared Host chain on both backends.
  it.each(['memory', 'sqlite'] as const)(
    'K3-17 %s: a Goal pause before the disposition commit makes ② a revision_conflict, then busy, then applies after resume',
    async kind => {
      const world = await openK3ReviewCardWorld(kind);
      worlds.push(world);
      const record = await createK3NeedsDecisionRecord(world, 'k3-20-a');
      const card = await cardOf(world, record);
      const answered = await world.decisions.answerDecision(world.fixture.ctx, {
        input: { source: card.source, selection: { kind: 'option', optionId: 'rerun_as_is' },
          text: 'answer while the Goal is paused', annotations: [] },
        meta: { requestId: 'k3-17-goal-guard-answer', expected: card.source.pins },
      });
      expect(answered).toMatchObject({ status: 'committed' });
      if (answered.status !== 'committed') return;

      const goals = createGoalService({ records: world.records, now: world.fixture.now,
        eventId: world.fixture.newId }).tasks;
      const control = async (action: 'pause' | 'resume', requestId: string) => {
        const goal = await goalAt(world.records, GOAL_B);
        const phase = await readGoalPhase(world.records, goalPhaseRef());
        if (phase.status !== 'ready') throw new Error(`the GoalPhase read failed: ${JSON.stringify(phase)}`);
        return goals.setGoalControl(world.fixture.ctx, {
          input: { goalRef: GOAL_B, control: action, reason: null },
          meta: { requestId, expected: [
            { ref: GOAL_B, revision: goal.revision },
            { ref: goalPhaseRef(), revision: phase.snapshot?.revision ?? 0 },
          ] },
        });
      };

      const wrapped = pausedBeforeDisposition(world.records, async () => {
        const paused = await control('pause', 'k3-17-goal-guard-pause');
        expect(paused).toMatchObject({ status: 'committed', value: { desiredState: 'paused' } });
      });
      const reads = createRunStateReader({ records: wrapped });
      let seq = 0;
      const reviews = createUnknownCallReviewService({ records: wrapped, reads,
        readAnswerText: async (ctx: CoreCallContext, { source }: { source: DecisionSourceV1 }) => {
          const read = await world.decisions.readDecisionAnswer(ctx, { source });
          if (read.status !== 'ready') return read;
          return { status: 'ready' as const, value: read.value.body === null ? null : read.value.body.text };
        },
        now: () => world.fixture.now(), eventId: () => `k3-17-goal-guard-review-${String(++seq)}` });
      // The same finite coordinator shape the Workflow uses for UR7: ② then ③.
      const advance = createDecisionActions({
        decisionMessages: {
          answerDecision: world.decisions.answerDecision.bind(world.decisions),
          readDecisionAnswer: world.decisions.readDecisionAnswer.bind(world.decisions),
          recordDecisionApplication: world.decisions.recordDecisionApplication.bind(world.decisions),
        },
        applicationReceipt: world.applicationReceipt,
        decisionApplications: {
          unknown_call_review: {
            async apply(ctx, input) {
              const action = await reviews.applyDisposition(ctx, {
                input: { source: input.source, selection: input.selection, decisionMessageRef: input.answerRef },
                meta: { requestId: input.requestId, expected: input.expected },
              });
              return { status: 'ready', value: { action, receipt: null } };
            },
          },
        },
      });
      const request = {
        input: { source: card.source, selection: { kind: 'option' as const, optionId: 'rerun_as_is' },
          decisionMessageRef: answered.value.ref },
        meta: { requestId: 'k3-17-goal-guard-advance', expected: card.source.pins },
      };

      // Today: the stale-record-only guard commits while the Goal is paused.
      const first = await advance.advanceReviewDisposition(world.fixture.ctx, request);
      expect(first).toMatchObject({ status: 'ready', value: {
        state: 'application_not_recorded',
        action: { status: 'rejected', code: 'revision_conflict' },
      } });
      expect(await world.reviews.readReview(world.fixture.ctx, { ref: record.ref })).toMatchObject({
        status: 'ready', value: { status: 'needs_decision', revision: record.revision },
      });

      // Still paused: the retry waits for the resume, writing nothing.
      const second = await advance.advanceReviewDisposition(world.fixture.ctx, request);
      expect(second).toMatchObject({ status: 'ready', value: {
        state: 'awaiting_resume', action: { status: 'rejected', code: 'busy' },
      } });
      expect(await world.reviews.readReview(world.fixture.ctx, { ref: record.ref })).toMatchObject({
        status: 'ready', value: { status: 'needs_decision', revision: record.revision },
      });

      const resumed = await control('resume', 'k3-17-goal-guard-resume');
      expect(resumed).toMatchObject({ status: 'committed', value: { desiredState: 'active' } });

      const third = await advance.advanceReviewDisposition(world.fixture.ctx, request);
      expect(third).toMatchObject({ status: 'ready', value: { state: 'applied' } });
      if (third.status !== 'ready' || third.value.action === null || third.value.action.status !== 'committed') {
        throw new Error(`the resumed disposition must commit: ${JSON.stringify(third)}`);
      }
      expect(third.value.action.value).toMatchObject({ status: 'resolved', revision: record.revision + 1,
        disposition: { choice: 'rerun_as_is', source: 'card' } });
    }, 120_000);
});
