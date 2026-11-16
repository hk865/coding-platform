/**
 * G8A (decision 121-136, `g8-rulings.md` 测试行 C2, C3, C5, C6). World: the S6C request-candidate world as G7 uses it
 * (`G7-plan-round.test.ts:44-49`), read-only main workspace; where a row needs installed checks, the Host's check list
 * is its input (`G7-check-taskids.test.ts:43-45`). Real calls; public routes; memory only (S3). A refused call's output
 * is read off the next model request (CPL's way). Working assumption: a plan's own checks are `checks` on the plan,
 * beside `tasks` (`G8-world.ts`); the lead reconciles the name at merge. Every row is red today.
 * - C2 (refusal reason: product rule A2, every required requirement needs a check that applies): `g8-seed-check` lists
 *   only `g8-seed-work`; a new Goal's first plan round submits a plan without checks. Red today at the reason, which
 *   says a new check "cannot be given in this round" (`plan-validation.ts:300-304`); green when it says to propose a
 *   check with `taskIds` in this plan. Mutation: the reason still sends the person to approve (today's code).
 * - C3 (refusal reason: safety, an installed check runs commands; A3): a second workspace of the project opened through
 *   `workspaces/open` with write and without commands (`addS7D2SecondWorkspace`); the person proposes and applies a plan
 *   carrying `g8-c3-check`. Red before the package at the apply, which committed and installed nothing. Green when the
 *   whole adoption fails naming the check and the command grant, the Goal keeps no plan and the workspace no check.
 *   Mutations shown: adoption and install not one whole (the pre-package code); the install's grant test without its
 *   command half (`host-settings.ts:1273`, only `writeAllowed` left), red at the apply.
 * - C5 (refusal reason: coordination, one id one content per workspace; A1): installed `g8-c5-all`; a change round on
 *   Goal 1 submits that id with another command, then the identical check. Red today at the first refusal (the strict
 *   form refuses the `checks` key, `answer-tools.ts:455-464`, naming no check). Green when it names `g8-c5-all` and the
 *   identical check counts as installed: nothing new, so the platform adopts plan v2 itself (121-112). Mutation: the
 *   same id overwrites the installed check (the first submit is accepted).
 * - C6 (refusal reason: product rule, the round's own submit tools; 121-111 names it; A6): a change round calls
 *   `submit_initial_plan`, which it does not offer, then `submit_plan_round`. Red today at the refusal text (Kernel
 *   `unknown_tool: 工具不可用`, `tool-dispatcher.js:34`); green when it lists every submit tool the round offers. The
 *   second call ending the same round with an answer is green today (the Kernel goes on after `unknown_tool`).
 *   Mutation: the refusal without the list (today's code).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { g8Check, g8NewGoal, g8PlanCall, g8PlanDraft, g8PlanForm, g8SplitChecks, g8Steps, type G8Check } from '../helpers/G8-world.js';
import { adoptPLPlanDraft } from '../helpers/PL-workflow-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { initializeProject } from '../helpers/S6A-history-fixture.js';
import { openS6AHostWorld, type S6AHostWorld, type S6AReply } from '../helpers/S6A-host-fixture.js';
import { OPERATOR, S6A_GOAL_1, S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { checkConfiguration, committed, ready } from '../helpers/S7A-fixture.js';
import { addS7D2SecondWorkspace } from '../helpers/S7D2-role-line-world.js';
import { toolOutputJson } from './support/common.js';
import { waitFor } from './harness.js';

const worlds: S6AHostWorld[] = [];
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
  await Promise.allSettled(cleanup.splice(0).map(remove => remove()));
});

type Refusal = { status: string; problems: { section: string; reason: string }[] };
const ROLE = S6A_WORK_ROLE.templateId;

async function openWorld(checks?: G8Check[]): Promise<S6AHostWorld> {
  const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'on', ...(checks === undefined
    ? {} : { checks: { ...checkConfiguration({ kind: 'human', id: OPERATOR.id }), checks } }) } });
  worlds.push(world);
  await initializeProject(world);
  return world;
}
/** The model request that carried `callId`'s result: the call did not end the round. */
const servedAfter = async (world: S6AHostWorld, session: S6ASession, callId: string) =>
  (await world.scripted.requests(session)).find(request =>
    request.messages.some(entry => entry.role === 'tool' && entry.callId === callId));
const problemsAfter = async (world: S6AHostWorld, session: S6ASession, callId: string) =>
  toolOutputJson(await servedAfter(world, session, callId), callId) as Refusal | undefined;

/** Goal 1 with plan v1 (`g8-base-work` and the gate), then a change request on Goal 1 answered by `replies`. */
async function changeRound(world: S6AHostWorld, tag: string, replies: S6AReply[]) {
  await adoptPLPlanDraft(s6aCardsWorkspace(world, S6A_SCOPE), S6A_GOAL_1, g8PlanDraft(S6A_GOAL_1, 'g8-base', ROLE), tag);
  const steps = g8Steps(world, S6A_SCOPE, tag);
  const a = await steps.line(`${tag}-secretary`);
  await world.scripted.script(a, replies, S6A_SCOPE);
  const asked = await steps.ask(tag, a, S6A_GOAL_1);
  return { a, round: await steps.readRound(asked.requestRoot, asked.round) };
}

describe('G8A: a later plan brings its own checks (the plan round form and the person\'s adoption)', () => {
  it('C2: no installed check covers the new Goal\'s tasks; the refusal says to propose one in this plan', async () => {
    const world = await openWorld([g8Check('g8-seed-check', ['g8-seed-work'])]);
    const { secretary } = await g8NewGoal(g8Steps(world, S6A_SCOPE, 'g8-c2'), 'g8-c2', [
      g8PlanCall('g8-c2-plan', g8PlanForm('g8-c2', ROLE)), { kind: 'calls', calls: [{ callId: 'g8-c2-questions',
        name: 'submit_plan_round', args: { answerKind: 'questions', summary: 'G8 C2', questions: ['Which check?'] } }] }]);
    const refused = await problemsAfter(world, secretary, 'g8-c2-plan');
    expect(refused?.status, 'the plan without checks was accepted').toBe('rejected');
    const reason = refused!.problems.find(problem => problem.reason.includes('g8-c2-work'))?.reason ?? '';
    expect(reason, JSON.stringify(refused!.problems)).toMatch(/\btaskIds\b/);
    expect(reason).toMatch(/\b(propos\w*|add)\b/i);
    expect(reason).toMatch(/\bplan\b/i);
    expect(reason).not.toMatch(/cannot be (given|added) in this round|ask the person to approve/i);
  }, 180_000);

  it('C3: the person adopts a plan bringing a check where writes but not commands are granted; nothing changes', async () => {
    const world = await openWorld();
    // Opened through the Host's `workspaces/open` with write and without commands (review g8cr item 6).
    const second = await addS7D2SecondWorkspace(world, 'g8-c3', { writeAllowed: true, commandsAllowed: false });
    cleanup.push(second.remove);
    const steps = g8Steps(world, second.scope, 'g8-c3');
    expect(await steps.settingsEntry()).toMatchObject({ writeAllowed: true, commandsAllowed: false });
    const { draft, checks } = g8SplitChecks(g8PlanDraft(second.goal, 'g8-c3', ROLE,
      [g8Check('g8-c3-check', ['g8-c3-work'], 'echo G8_C3')]));
    const proposed = committed<{ ref: unknown; revision: number }>(await steps.post('plans/propose', graphWrite(second.scope,
      { goalRef: second.goal, basedOn: null, draft, checks, reason: { text: 'G8 C3 plan with its check', sources: [] } },
      'g8-c3-propose')), 'plans/propose');
    const applied = await steps.post('plans/apply', graphWrite(second.scope, { proposalRef: proposed.ref,
      expectedProposalRevision: proposed.revision, decisionRefs: [] }, 'g8-c3-apply')) as { status: string; reason?: string };
    expect(applied.status, JSON.stringify(applied)).not.toBe('committed');
    expect(applied.reason).toContain('g8-c3-check');
    expect(applied.reason).toMatch(/command/i);
    expect((await steps.read<{ goal: { activePlanRevision: unknown } }>('goals/read', second.goal)).goal.activePlanRevision)
      .toBeNull();
    expect(JSON.stringify(await steps.settingsEntry())).not.toContain('g8-c3-check');
  }, 180_000);

  it('C5: the same check id with other content is refused naming it; the identical check counts as installed', async () => {
    const world = await openWorld([g8Check('g8-c5-all', 'all', 'echo G8_C5')]);
    const { a, round } = await changeRound(world, 'g8-c5', [
      g8PlanCall('g8-c5-other', g8PlanForm('g8-c5', ROLE, [g8Check('g8-c5-all', 'all', 'echo G8_C5_OTHER')], true)),
      g8PlanCall('g8-c5-same', g8PlanForm('g8-c5', ROLE, [g8Check('g8-c5-all', 'all', 'echo G8_C5')], true))]);
    const refused = await problemsAfter(world, a, 'g8-c5-other');
    expect(refused?.status, 'the first submit was not refused with its problems').toBe('rejected');
    expect(refused!.problems.some(problem => problem.reason.includes('g8-c5-all')), JSON.stringify(refused!.problems))
      .toBe(true);
    expect(await servedAfter(world, a, 'g8-c5-same'), 'the identical check was refused').toBeUndefined();
    expect(round.closeCode).toBeNull();
    // Nothing new to install: the platform adopts the change itself (121-112), as it does a plan without checks.
    expect(await waitFor(async () => ready<{ plan: { planRevision: number } }>(await world.post('tasks/query',
      plain(S6A_SCOPE, { goalRef: S6A_GOAL_1 })), 'tasks/query').plan.planRevision, revision => revision === 2, 'plan v2'))
      .toBe(2);
  }, 180_000);

  it('C6: a submit tool this round does not offer is refused with the round\'s submit tools; the round goes on', async () => {
    const world = await openWorld();
    const { a, round } = await changeRound(world, 'g8-c6', [
      { kind: 'calls', calls: [{ callId: 'g8-c6-initial', name: 'submit_initial_plan', args: { summary: 'G8 C6' } }] },
      g8PlanCall('g8-c6-plan', g8PlanForm('g8-c6', ROLE, undefined, true))]);
    const served = await servedAfter(world, a, 'g8-c6-initial');
    const offered = (served?.tools ?? []).map(tool => tool.name).filter(name => name.startsWith('submit_'));
    expect(offered).toContain('submit_plan_round');
    expect(offered).not.toContain('submit_initial_plan');
    const result = served?.messages.find(entry => entry.role === 'tool' && entry.callId === 'g8-c6-initial');
    for (const name of offered) expect(JSON.stringify(result), `the refusal names ${name}`).toContain(name);
    expect(await servedAfter(world, a, 'g8-c6-plan'), 'the plan call did not end the round').toBeUndefined();
    expect({ status: round.status, closeCode: round.closeCode }).toEqual({ status: 'ended', closeCode: null });
    expect(round.answer).toContain('g8-c6-work');
  }, 180_000);
});
