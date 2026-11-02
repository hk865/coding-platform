/**
 * PL-25: the goal loop's six narrow reads and the frozen cross-group
 * `readPlanReview` (§6.1.2 steps 3b/5/5b, §6.1.6, §6.7.1).
 *
 * Every fact below is produced by real public steps: the S6A Host world's own
 * goals and governance, `plans/propose` + `plans/apply` for the adopted plan,
 * `plans/propose` again for the pending candidate, and the platform's live
 * installed-check configuration. No record is written
 * by hand and no store is read; the shared `PL-reads-fixture` returns the
 * composition root's own published `planReaders`, whose receipt lookup is the
 * raw mailbox the platform already owns (L-04).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import { ag2bChecksConfiguration } from '../helpers/AG2b-collaboration-fixture.js';
import { openPlanReaders } from '../helpers/PL-reads-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { openS6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, governS6B } from '../helpers/S6B1-fixture.js';
import { refinementPlan } from '../helpers/S7B-V-fixture.js';
import { proposeCandidate } from '../scenarios/support/S5-decisions.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

/** One adopted Plan plus one independent pending candidate on its active version. */
async function seedPlanAndCandidate(world: S6AHostWorld): Promise<{
  goal: GoalRef; candidateRef: string; candidateRevision: number; basedOn: PlanRevisionSnapshot;
}> {
  const ws = s6aCardsWorkspace(world, S6A_SCOPE);
  await governS6B(world, ws, world.goals);
  const goal = world.goals.first;
  const adopted = await adoptS6BPlan(ws, goal, {
    label: 'pl25-base', taskIds: ['pl25-base-task'], role: S6A_WORK_ROLE.templateId,
  });
  const text = await refinementPlan(world, goal, {
    label: 'pl25-candidate', taskId: 'pl25-candidate-task', role: S6A_WORK_ROLE.templateId,
  });
  const draft = (JSON.parse(text) as { plan: PlanRevisionDraft }).plan;
  const candidate = await proposeCandidate(world.platform, world.humanContext(), {
    goalRef: goal, basedOn: adopted.plan.ref, draft, requestRef: null,
    requestId: 'pl25-candidate-propose',
  });
  return {
    goal, candidateRef: candidate.ref.proposalId,
    candidateRevision: candidate.revision, basedOn: adopted.plan,
  };
}

describe('PL-25 plan reads', () => {
  it('returns the adopted candidate, the pending agent candidate, the active goal and zero fixes', async () => {
    const world = await openS6AHostWorld({ backend: 'memory' });
    worlds.push(world);
    const seeded = await seedPlanAndCandidate(world);
    const readers = openPlanReaders(world);
    const ctx = world.humanContext();

    // `acceptedCandidatesOf` must NOT collapse to the active Plan version and
    // must return the adopted proposal itself.
    const accepted = await readers.acceptedCandidatesOf(seeded.goal);
    expect(accepted.status).toBe('ready');
    if (accepted.status !== 'ready') return;
    expect(accepted.value).toHaveLength(1);
    expect(accepted.value[0]?.status).toBe('accepted');
    expect(accepted.value[0]?.ref.proposalId).not.toBe(seeded.candidateRef);

    // The first Plan is excluded; the independent candidate on the active
    // version is the latest agent candidate.
    const latest = await readers.latestAgentCandidate(seeded.goal);
    expect(latest.status).toBe('ready');
    if (latest.status !== 'ready') return;
    expect(latest.value?.ref.proposalId, 'the pending candidate, not the adopted first plan').toBe(seeded.candidateRef);
    expect(latest.value?.status).toBe('candidate');
    expect(latest.value?.basedOn?.planId).toBe(seeded.basedOn.ref.planId);

    // A candidate written by no planfix round: completedFixes is a real 0.
    const fixes = await readers.completedFixes(seeded.goal, seeded.basedOn.ref);
    expect(fixes).toEqual({ status: 'ready', value: 0 });

    // One Goal: the pending candidate; no question group has this loop's source.
    const one = await readers.planCandidates(S6A_SCOPE, ctx, seeded.goal);
    expect(one.status).toBe('ready');
    if (one.status !== 'ready') return;
    expect(one.value.goals).toHaveLength(1);
    expect(one.value.goals[0]?.goalRef.goalId).toBe(seeded.goal.goalId);
    expect(one.value.goals[0]?.pending?.proposalRef.proposalId).toBe(seeded.candidateRef);
    expect(one.value.goals[0]?.questionGroups).toEqual([]);
    expect(one.value.goals[0]?.readThrough).not.toBeNull();

    // The workspace read keeps the other active Goal with a real empty pending
    // and an empty question-group list, not `not_found`.
    const all = await readers.planCandidates(S6A_SCOPE, ctx);
    expect(all.status).toBe('ready');
    if (all.status !== 'ready') return;
    expect(all.value.goals.map(goal => goal.goalRef.goalId).sort())
      .toEqual([world.goals.first.goalId, world.goals.second.goalId].sort());
    expect(all.value.goals.find(goal => goal.goalRef.goalId === world.goals.second.goalId)?.pending).toBeNull();

    // No `planreview:`/`planfix:` was ever sent for this candidate. The real
    // receipt lookup on the raw mailbox answers `not_committed`, so both reads
    // prove the four-state `not_sent` (尚未审阅), never a missing-dependency arm.
    const fix = await readers.planFixRead(seeded.goal, { aggregateType: 'PlanProposal',
      projectId: seeded.goal.projectId, workspaceId: S6A_SCOPE.workspaceId,
      proposalId: seeded.candidateRef }, seeded.candidateRevision);
    expect(fix).toEqual({ status: 'ready', value: { status: 'not_sent' } });
    const review = await readers.readPlanReview(ctx, {
      goalRef: seeded.goal,
      proposalRef: { aggregateType: 'PlanProposal', projectId: seeded.goal.projectId,
        workspaceId: S6A_SCOPE.workspaceId, proposalId: seeded.candidateRef },
      revision: seeded.candidateRevision,
    });
    expect(review).toEqual({ status: 'ready', value: { status: 'not_sent' } });
  }, 120_000);

  it('maps the real installed check configuration to capabilities', async () => {
    const world = await openS6AHostWorld({ backend: 'memory' });
    worlds.push(world);
    const readers = openPlanReaders(world);

    // The Host registered no configuration for this workspace: `null`, not `[]`.
    expect(await readers.planChecks(S6A_SCOPE)).toEqual({ status: 'ready', value: null });

    // A real configuration with one check maps to the evidence-service shape.
    world.platform.registerCheckConfiguration({
      configuration: ag2bChecksConfiguration({ actor: world.ag2b.actor, command: 'true' }),
    });
    expect(await readers.planChecks(S6A_SCOPE)).toEqual({ status: 'ready', value: [{
      checkId: 'ag2b-static', kind: 'static', coversKinds: ['static'], replayable: false,
    }] });

    // A configuration that exists but lists no check stays `[]`.
    world.platform.registerCheckConfiguration({
      configuration: { ...ag2bChecksConfiguration({ actor: world.ag2b.actor, command: 'true' }), checks: [] },
    });
    expect(await readers.planChecks(S6A_SCOPE)).toEqual({ status: 'ready', value: [] });
  }, 120_000);
});
