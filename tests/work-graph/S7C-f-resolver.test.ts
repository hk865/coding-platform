/**
 * F-resolver: the two duty resolvers over real Session and request worlds.
 *
 * The adviser/secretary/scribe half is `openS6BProjectWorld`: its main workspace gets real `sessions/create` lines
 * and a real `sessions/archive-line`; the goalless workspace proves `null`. The goal-secretary half is
 * `openS6AHostWorld` + `holdS6BRequestRound` with the goal's own `goalId`: `requests/read` shows the held round
 * `running` and `queries/read` shows it `entered`, and the round's owner is its secretary. One no-goal round answers
 * a goal card draft, and `goals/confirm-draft` attributes that root to the new Goal afterwards.
 * Every read is the platform's real port; the goal-secretary factory gets the platform's own records port
 * (`platform.disconnect.records`, the same backend the platform reads) and its real `requestFacts`. The only
 * wrappers are the two named read faults.
 */
import { describe, expect, it } from 'vitest';
import { createGoalSecretary } from '../../src/core/work-graph/tasks/goal-secretary.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import type { GoalConfirmDraftReceiptV1 } from '../../src/contracts/goal-card.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import { workspaceOf } from '../../src/core/work-graph/tasks/request-service.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCRIBE_ROLE, S6A_SCOPE, S6A_SECRETARY_ROLE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { openS6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { dutyOf } from '../helpers/S7C-duty-fixture.js';
import { createS6BLine, holdS6BRequestRound, openS6BProjectWorld } from '../helpers/S6B1-fixture.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';

const ADVISER = platformRoleProfile('adviser').template;
const smallest = (refs: SessionRef[]): SessionRef =>
  [...refs].sort((left, right) => left.sessionId < right.sessionId ? -1 : left.sessionId > right.sessionId ? 1 : 0)[0]!;

describe('F-resolver', () => {
  it('resolves adviser, secretary and scribe by duty, smallest sessionId, active only, else null', async () => {
    const project = await openS6BProjectWorld({ backend: 'memory' });
    try {
      const world = project.world;
      const ctx = world.humanContext();
      const main = project.main;
      const adviserA = await createS6BLine(main, { label: 'f-resolver-adviser-a', role: ADVISER });
      const adviserB = await createS6BLine(main, { label: 'f-resolver-adviser-b', role: ADVISER });
      const secretaryA = await createS6BLine(main, { label: 'f-resolver-secretary-a', role: S6A_SECRETARY_ROLE });
      const secretaryB = await createS6BLine(main, { label: 'f-resolver-secretary-b', role: S6A_SECRETARY_ROLE });
      const scribeA = project.scribe.line;
      const scribeB = await createS6BLine(main, { label: 'f-resolver-scribe-b', role: S6A_SCRIBE_ROLE });
      await createS6BLine(main, { label: 'f-resolver-work', role: S6A_WORK_ROLE });
      const duty = dutyOf(world);
      const expected = { adviser: smallest([adviserA.ref, adviserB.ref]),
        secretary: smallest([secretaryA.ref, secretaryB.ref]), scribe: smallest([scribeA.ref, scribeB.ref]) };
      for (const name of ['adviser', 'secretary', 'scribe'] as const) {
        const got = await duty.resolveDutyRecipient(ctx, { workspace: workspaceOf(ctx), duty: name });
        expect(got.status).toBe('ready');
        if (got.status !== 'ready') throw new Error(`the ${name} resolver must be ready`);
        expect(got.value?.sessionId).toBe(expected[name].sessionId);
      }
      // The byte-equivalent public scribe arm over the same real directory.
      const publicScribe = await world.platform.notes.resolveScribeRecipient(ctx);
      expect(publicScribe.status).toBe('ready');
      if (publicScribe.status !== 'ready') throw new Error('the public scribe resolver must be ready');
      expect(publicScribe.value?.sessionId).toBe(expected.scribe.sessionId);
      // The goalless workspace has no line of any duty.
      const secondCtx = project.goalless.humanContext();
      for (const name of ['adviser', 'secretary', 'scribe'] as const) {
        expect(await duty.resolveDutyRecipient(secondCtx, { workspace: workspaceOf(secondCtx), duty: name }))
          .toEqual({ status: 'ready', value: null });
      }
      // Archive the smaller scribe: the resolver's own `active` filter must skip it.
      const smaller = expected.scribe;
      const larger = smaller === scribeA.ref ? scribeB.ref : scribeA.ref;
      const card = await world.readSession(smaller);
      await world.archive({ label: 'f-resolver-archived', ref: smaller,
        aggregateRef: card.record.ref, role: card.record.role, createdAt: card.record.createdAt });
      const got = await duty.resolveDutyRecipient(ctx, { workspace: workspaceOf(ctx), duty: 'scribe' });
      expect(got.status).toBe('ready');
      if (got.status !== 'ready') throw new Error('the scribe resolver must be ready');
      expect(got.value?.sessionId).toBe(larger.sessionId);
    } finally {
      await project.close();
    }
  });

  it('takes the newest kept root owner, else duty; a failed effective-goal or owner read is unavailable', async () => {
    const host = await openS6AHostWorld({ backend: 'memory' });
    try {
      const ctx = host.humanContext();
      const goal = host.goals.first;
      const duty = dutyOf(host);
      const records = host.platform.disconnect.records;
      const facts = host.platform.requestFacts;
      const goalSecretary = createGoalSecretary({ ordered: records, requestFacts: facts, duty });
      const owners: SessionRef[] = [];
      const runRound = (label: string, goalId: string | null, answer?: string) =>
        holdS6BRequestRound(host, { label, goalId,
          ...(answer === undefined ? {} : { replies: () => [{ kind: 'text' as const, text: answer }] }) },
        async round => {
          const view = await host.readRequest(round.request.requestRoot);
          expect(view.rounds.find(entry => entry.ref.queryJobId === round.request.round.queryJobId)?.status)
            .toBe('running');
          expect((await readQuery(host.ag2b, round.request.requestRoot)).run.run.executionState?.phase)
            .toBe('entered');
          owners.push(round.secretary!.ref);
          return { round: round.request.round, secretary: round.secretary! };
        });
      const first = await runRound('f-resolver-goal-a', goal.goalId);
      expect(await goalSecretary.resolveGoalSecretary(ctx, { goalRef: goal }))
        .toEqual({ status: 'ready', value: owners[0] });
      // No kept root at all: the workspace's secretary duty. The host seed has no Session, so the first
      // publicly created secretary is the duty answer (the directory's aggregate ref).
      expect(await goalSecretary.resolveGoalSecretary(ctx, { goalRef: host.goals.second }))
        .toEqual({ status: 'ready', value: first.value.secretary.aggregateRef });
      await runRound('f-resolver-goal-b', goal.goalId);
      expect(await goalSecretary.resolveGoalSecretary(ctx, { goalRef: goal }))
        .toEqual({ status: 'ready', value: owners[1] });
      // A newer no-goal root is not kept while it has no Goal. Its answer carries a goal card draft;
      // confirming the draft attributes the root to the new Goal, whose secretary is that round's owner.
      const noGoal = await runRound('f-resolver-no-goal', null,
        JSON.stringify({ schemaVersion: 2, kind: 'needs_decision', summary: 'S6B no-goal summary',
          questions: ['S6B no-goal question'],
          goalCardDrafts: [{ objective: 'S6B attributed Goal', completion: ['S6B attributed Goal done'],
            autonomy: 'after_plan_confirmation', screening: null }] }));
      expect(await goalSecretary.resolveGoalSecretary(ctx, { goalRef: goal }))
        .toEqual({ status: 'ready', value: owners[1] });
      const confirmed = await host.post('goals/confirm-draft', plain(S6A_SCOPE, {
        commandId: 'f-resolver-confirm-no-goal', round: noGoal.value.round, index: 0 }));
      expect(confirmed.body).toMatchObject({ status: 'committed' });
      const attributed = (confirmed.body as { value: GoalConfirmDraftReceiptV1 }).value.goal.ref;
      expect(await goalSecretary.resolveGoalSecretary(ctx, { goalRef: attributed }))
        .toEqual({ status: 'ready', value: owners[2] });
      // Every failed owner/effective-goal read, `not_found` included, is `unavailable`.
      const ownerFault = createGoalSecretary({ ordered: records, duty,
        requestFacts: { effectiveGoalOf: facts.effectiveGoalOf,
          ownerOf: async () => ({ status: 'not_found' as const }) } });
      expect(await ownerFault.resolveGoalSecretary(ctx, { goalRef: goal }))
        .toMatchObject({ status: 'rejected', code: 'unavailable' });
      const goalFault = createGoalSecretary({ ordered: records, duty,
        requestFacts: { ownerOf: facts.ownerOf,
          effectiveGoalOf: async () => ({ status: 'rejected' as const, code: 'unavailable' as const,
            reason: 'the effective goal is not readable' }) } });
      expect(await goalFault.resolveGoalSecretary(ctx, { goalRef: goal }))
        .toMatchObject({ status: 'rejected', code: 'unavailable' });
    } finally {
      await host.close();
    }
  });
});
