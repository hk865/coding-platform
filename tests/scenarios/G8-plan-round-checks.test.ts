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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_WORKBENCH_ROLE, LOCAL_WORKBENCH_TEMPLATE_ID } from '../../src/app/runtime-configuration.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import { checkDigestOf } from '../../src/contracts/check-review.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { canonicalOf, sha256Hex } from '../../src/contracts/fingerprint.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { RegisteredCommandCheck, VerificationRoundRef } from '../../src/contracts/verification.js';
import type { PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import {
  g8Check, g8NewGoal, g8PlanCall, g8PlanDraft, g8PlanForm, g8SplitChecks, g8Steps, openG8Project, type G8Check,
  type G8Workspace,
} from '../helpers/G8-world.js';
import { g8bCheckReview, G8B_ROLE, secretaryChange } from '../helpers/G8B-world.js';
import { heartbeatUntil } from '../helpers/IV-host-fixture.js';
import { adoptPLPlanDraft } from '../helpers/PL-workflow-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { initializeProject } from '../helpers/S6A-history-fixture.js';
import { openS6AHostWorld, type S6AHostWorld, type S6AReply } from '../helpers/S6A-host-fixture.js';
import { OPERATOR, S6A_GOAL_1, S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import {
  armS6B3SettingsFaultsAt, disposeS6B3SettingsWrapper, installS6B3SettingsSpy,
} from '../helpers/S6B3-fixture.js';
import { checkConfiguration, committed, ready } from '../helpers/S7A-fixture.js';
import { addS7D2SecondWorkspace } from '../helpers/S7D2-role-line-world.js';
import { toolOutputJson } from './support/common.js';
import { waitFor } from './harness.js';

// A4: one real in-memory records backend and one real body store, shared by every Host start of a row; both leave
// the store open on `close`, so T0b's `reopen({ sharedMemoryStore: true })` is a real same-store restart (the seam
// `tests/scenarios/DRV-goal-driver-p.test.ts:23-40` and `tests/app/S7A-host-gates.test.ts:29-42` use).
const shared = vi.hoisted(() => ({ backend: undefined as unknown, bodies: undefined as unknown }));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>();
  return { ...actual, createInMemoryRecordBackend: (options: Parameters<typeof actual.createInMemoryRecordBackend>[0]) => {
    if (shared.backend === undefined) {
      shared.backend = { ...actual.createInMemoryRecordBackend(options), close: async () => undefined };
    }
    return shared.backend;
  } };
});
vi.mock('../../src/core/record-store/body-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/body-store.js')>();
  return { ...actual, RawArtifactBodyStore: class SharedRawArtifactBodyStore {
    constructor() {
      shared.bodies ??= new actual.RawArtifactBodyStore();
      return shared.bodies as never;
    }
  } as never };
});

const worlds: S6AHostWorld[] = [];
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
  await Promise.allSettled(cleanup.splice(0).map(remove => remove()));
  shared.backend = undefined;
  shared.bodies = undefined;
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
const servedAfter = async (world: S6AHostWorld, session: S6ASession, callId: string, scope?: WorkspaceScope) =>
  (await world.scripted.requests(session, scope)).find(request =>
    request.messages.some(entry => entry.role === 'tool' && entry.callId === callId));
const problemsAfter = async (world: S6AHostWorld, session: S6ASession, callId: string, scope?: WorkspaceScope) =>
  toolOutputJson(await servedAfter(world, session, callId, scope), callId) as Refusal | undefined;

/** Goal 1 with plan v1 (`g8-base-work` and the gate), then a change request on Goal 1 answered by `replies`. */
async function changeRound(world: S6AHostWorld, tag: string, replies: S6AReply[]) {
  await adoptPLPlanDraft(s6aCardsWorkspace(world, S6A_SCOPE), S6A_GOAL_1, g8PlanDraft(S6A_GOAL_1, 'g8-base', ROLE), tag);
  const steps = g8Steps(world, S6A_SCOPE, tag);
  const a = await steps.line(`${tag}-secretary`);
  await world.scripted.script(a, replies, S6A_SCOPE);
  const asked = await steps.ask(tag, a, S6A_GOAL_1);
  return { a, round: await steps.readRound(asked.requestRoot, asked.round) };
}

/** T0/T0b: the production project world, its Goal's first plan carrying the baseline checks, adopted by the
 *  person. A plan check is what makes the same id replaceable; the seed check is the workspace's approved-list
 *  check, kept outside `planChecks`. T0b and the rollback cell pass more than one baseline check. */
const R1_ROLE = LOCAL_WORKBENCH_TEMPLATE_ID;
const R1_OLD = 'echo G8_R1_OLD';
const R1_NEW = 'echo G8_R1_NEW';
const r1OldCheck = g8Check('g8-r1-check', 'all', R1_OLD);
const r1NewCheck = g8Check('g8-r1-check', 'all', R1_NEW);
const r1SecondCheck = g8Check('g8-r1-second', 'all', 'echo G8_R1_SECOND');
const r1RollbackChecks = [g8Check('g8-r1-a', 'all', 'echo G8_R1_A'),
  g8Check('g8-r1-b', 'all', 'echo G8_R1_B'), g8Check('g8-r1-c', 'all', 'echo G8_R1_C')];
const r1BNewCheck = g8Check('g8-r1-b', 'all', 'echo G8_R1_B_NEW');
const r1OldDigest = checkDigestOf(r1OldCheck);
const r1NewDigest = checkDigestOf(r1NewCheck);
const r1BNewDigest = checkDigestOf(r1BNewCheck);
const r1SeedCheck = g8Check('g8-r1-seed-check', ['g8-seed-work', 'g8-seed-gate']);
type R1Round = { roundRef: VerificationRoundRef; checks: { checkId: string; command: string | null }[] };

async function openR1World(label: string, checks: G8Check[] = [r1OldCheck]) {
  const project = await openG8Project(label, [r1SeedCheck]);
  cleanup.push(project.close);
  const flow = await g8NewGoal(project, label, [
    g8PlanCall(`${label}-plan`, g8PlanForm(label, R1_ROLE, checks))]);
  const head = await project.candidate(flow.goal, flow.requestRoot);
  // The driver starts when this first plan is adopted: its Work line must have a reply waiting, as C1 does.
  const executor = await project.line(`${label}-exec`, LOCAL_WORKBENCH_ROLE);
  await project.world.scripted.script(executor, [{ kind: 'text', text: `${label} first work` }], project.scope);
  expect(await project.apply(flow.goal, head, `${label}-apply`), 'the first plan with the baseline checks was not adopted')
    .toMatchObject({ status: 'committed' });
  return { project, flow, head, executor };
}

/** The public check list of one workspace as the settings snapshot publishes it (order and definitions). */
const r1PublicChecks = async (world: S6AHostWorld, scope: { projectId: string; workspaceId: string }) =>
  (await r1Workspace(world, scope)).checks ?? [];
const r1CheckIds = (checks: RegisteredCommandCheck[]) => checks.map(check => check.checkId);
const r1CheckDigests = (checks: RegisteredCommandCheck[]) => checks.map(check => checkDigestOf(check));

/**
 * T0b/rollback: `plans/propose` a plan bringing `changes`, then `plans/apply` it while the fixture's real settings
 * fault gate (`S6B3-fixture.ts:950-961`, installed at `:970`, armed at `:994`) fails the notify right after the
 * checks are staged in the settings file. The arm is released only after the call ends, so the rollback's own notify fails too:
 * the pending record survives the failed call, exactly the "restore wrote, close did not run" state, and the next
 * Host start has to settle it again. `reached` proves the gate was reached (today it is not: the apply is refused
 * before the settings stage).
 */
async function r1InterruptedReplacement(label: string, project: G8Workspace, goal: GoalRef, changes: G8Check[]):
Promise<{ applied: { status: string; code?: string; reason?: string }; reached: Promise<void> }> {
  const active = (await project.read<{ goal: { activePlanRevision: PlanRevisionRef } }>('goals/read', goal))
    .goal.activePlanRevision;
  const baseline = g8PlanDraft(goal, label, R1_ROLE, changes);
  // The baseline adoption installed plan revision 1; this is its one future revision.
  const { draft, checks } = g8SplitChecks({ ...baseline, planId: `${label}-replace-plan`, planRevision: 2 });
  const proposed = committed<{ ref: PlanProposalRef; revision: number }>(await project.post('plans/propose',
    graphWrite(project.scope, { goalRef: goal, basedOn: active, draft, checks,
      reason: { text: `${label} replacement`, sources: [] } }, `${label}-replace-propose`)), 'plans/propose');
  const goalRead = await project.read<{ goal: { revision: number } }>('goals/read', goal);
  const fault = armS6B3SettingsFaultsAt(project.world.settingsDirectoryOf(), 'before-notify');
  try {
    const applied = await project.post('plans/apply', graphWrite(project.scope, { proposalRef: proposed.ref,
      expectedProposalRevision: proposed.revision, decisionRefs: [] }, `${label}-replace-apply`,
      [{ ref: goal, revision: goalRead.goal.revision }])) as {
      status: string; code?: string; reason?: string };
    return { applied, reached: fault.reached };
  } finally {
    fault.release();
  }
}

/** After the reopen: a second Goal of the same project gets its first plan (no checks of its own) adopted and its
 *  Work task runs under the recovered configuration; its first check round reads what the Host actually installs. */
async function r1NewRound(world: S6AHostWorld, steps: G8Workspace, executor: S6ASession, label: string): Promise<R1Round> {
  await world.scripted.script(executor, [{ kind: 'text', text: `${label} work` }], steps.scope);
  const next = await g8NewGoal(steps, label, [g8PlanCall(`${label}-plan`, g8PlanForm(label, R1_ROLE))]);
  const head = await steps.candidate(next.goal, next.requestRoot);
  expect(await steps.apply(next.goal, head, `${label}-apply`), 'the new Goal\'s first plan was not adopted')
    .toMatchObject({ status: 'committed' });
  return await r1Round(steps, next.goal, `${label}-work`, `the new Goal's first check round`);
}

/** The first check round of `taskId` under the Goal's active plan, read through `verification/round`. */
async function r1Round(project: G8Workspace, goal: GoalRef, taskId: string, what: string): Promise<R1Round> {
  const planRef = (await project.read<{ goal: { activePlanRevision: unknown } }>('goals/read', goal)).goal
    .activePlanRevision;
  const node = { kind: 'task', ref: { projectId: goal.projectId, goalId: goal.goalId, taskId }, planRef };
  const items = await waitFor(async () => (await project.read<{ items: { round: { ref: VerificationRoundRef } }[] }>(
    'graph/look', { goalRef: goal, target: { kind: 'node', node }, relation: 'checks',
      page: { afterCursor: null, limit: 10 } })).items, list => list.length > 0, what);
  const read = await project.read<{ roundRef: VerificationRoundRef;
    checks: { checkId: string; command: string | null }[] }>('verification/round', { roundRef: items[0]!.round.ref });
  return { roundRef: read.roundRef, checks: read.checks };
}

/** What the settings snapshot publishes. The workspace entry has `checks`/`checkApprovals` but no `checkOrigins`
 *  (`host-settings-types.ts:44-58`); `adoptedPlanChecks` is the snapshot's top level, one entry per scope, each with
 *  `{checkId, digest}` (ruling 0.4, `rc-rulings.md:61-64`). See reply F2 for the missing `checkOrigins` read. */
type R1AdoptedCheck = { checkId: string; digest: string };
type R1SnapshotWorkspace = {
  scope: { projectId: string; workspaceId: string };
  checks?: RegisteredCommandCheck[];
  checkApprovals?: { checkId: string; plan: { proposalRef: PlanProposalRef; checksDigest: string } }[];
};
type R1Snapshot = {
  workspaces: R1SnapshotWorkspace[];
  adoptedPlanChecks?: { scope: { projectId: string; workspaceId: string }; checks: R1AdoptedCheck[] }[];
};
const r1Snapshot = async (world: S6AHostWorld) =>
  ready<R1Snapshot>(await world.settings('snapshot', {}), 'settings/snapshot');
const r1Workspace = async (world: S6AHostWorld, scope: { projectId: string; workspaceId: string }) => {
  const snapshot = await r1Snapshot(world);
  const entry = snapshot.workspaces.find(item => item.scope.projectId === scope.projectId
    && item.scope.workspaceId === scope.workspaceId);
  if (entry === undefined) throw new Error(`G8: the snapshot lists no ${scope.workspaceId}`);
  return entry;
};
/** The top-level `adoptedPlanChecks` entry for one scope (ruling 0.4). */
const r1AdoptedPlanChecks = (snapshot: R1Snapshot, scope: { projectId: string; workspaceId: string }) =>
  snapshot.adoptedPlanChecks?.find(item => item.scope.projectId === scope.projectId
    && item.scope.workspaceId === scope.workspaceId)?.checks ?? [];

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
    // Here the installed `g8-c5-all` is Host start-up configuration, not a plan check: a non-plan source
    // with the same id and other content is still judged a conflict. This guards the source check L-2 keeps
    // (a replacement is only legal for a plan check adopted by the person).
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

  it('T0: a plan check is replaced by the same id with a new command when the person adopts; the old round stays frozen', async () => {
    // Red today at the replacement plan round: `answer-tools.ts:674-681` calls `proposedCheckSplit`, which has no
    // `replaced` bucket, so the `checks` problem is `checkConflictProblem` and the round is refused (`status:
    // 'rejected'`). The adoption entry (`host-settings.ts:1761-1762`) would refuse the same id for the same reason.
    // Named mutation (unproven, production not landed): empty the `replaceable` set passed to `proposedCheckSplit`.
    expect(r1NewDigest).not.toBe(r1OldDigest);
    const { project, flow, executor } = await openR1World('g8-r1');
    const oldRound = await r1Round(project, flow.goal, 'g8-r1-work', 'the first check round of g8-r1-work');
    expect(oldRound.checks.find(check => check.checkId === 'g8-r1-check')?.command).toBe('echo G8_R1_OLD');

    // A second Work reply is waiting for the Task the replacement plan adds; both checks apply to `all`.
    await project.world.scripted.script(executor, [{ kind: 'text', text: 'g8-r1 second work' }], project.scope);
    const change = await project.line('g8-r1-change');
    await project.world.scripted.script(change, [
      g8PlanCall('g8-r1-replace', g8PlanForm('g8-r1b', R1_ROLE, [r1NewCheck], true)),
      { kind: 'calls', calls: [{ callId: 'g8-r1-stop', name: 'submit_plan_round',
        args: { answerKind: 'questions', summary: 'G8 R1 stop', questions: ['Continue?'] } }] },
    ], project.scope);
    const asked = await project.ask('g8-r1-replace', change, flow.goal);
    const refusal = await problemsAfter(project.world, change, 'g8-r1-replace', project.scope);
    const checksProblems = refusal?.problems.filter(problem => problem.section === 'checks') ?? [];
    expect(checksProblems, JSON.stringify(refusal?.problems)).toEqual([]);
    expect(await servedAfter(project.world, change, 'g8-r1-replace', project.scope),
      'the replacement submit did not end the round').toBeUndefined();

    const replacement = await project.candidate(flow.goal, asked.requestRoot);
    expect(await project.apply(flow.goal, replacement, 'g8-r1-replace-apply')).toMatchObject({ status: 'committed' });

    const workspace = await r1Workspace(project.world, project.scope);
    const snapshot = await r1Snapshot(project.world);
    const installed = workspace.checks?.find(check => check.checkId === 'g8-r1-check');
    expect(installed, JSON.stringify(workspace.checks)).toMatchObject({ command: 'echo G8_R1_NEW' });
    expect(checkDigestOf(installed!)).toBe(r1NewDigest);
    const approvals = workspace.checkApprovals?.filter(entry => entry.checkId === 'g8-r1-check') ?? [];
    expect(approvals, JSON.stringify(workspace.checkApprovals)).toHaveLength(1);
    expect(approvals[0]!.plan.proposalRef.proposalId).toBe(replacement.ref.proposalId);
    // The approval carries the digest of the whole check set, not one check's digest (F1).
    expect(approvals[0]!.plan.checksDigest).toBe(sha256Hex(canonicalOf([r1NewCheck])!));
    // `checkOrigins` has no public read (`host-settings-types.ts:44-58`); see reply F2.
    const adoptedPlanChecks = r1AdoptedPlanChecks(snapshot, project.scope);
    expect(adoptedPlanChecks, JSON.stringify(snapshot.adoptedPlanChecks))
      .toContainEqual({ checkId: 'g8-r1-check', digest: r1NewDigest });
    expect(adoptedPlanChecks).not.toContainEqual({ checkId: 'g8-r1-check', digest: r1OldDigest });

    const currentRound = await r1Round(project, flow.goal, 'g8-r1b-work', 'the check round after the replacement');
    expect(currentRound.checks.find(check => check.checkId === 'g8-r1-check')?.command).toBe('echo G8_R1_NEW');
    const frozen = await project.read<{ checks: { checkId: string; command: string | null }[] }>('verification/round',
      { roundRef: oldRound.roundRef });
    expect(frozen.checks.find(check => check.checkId === 'g8-r1-check')?.command).toBe('echo G8_R1_OLD');
  }, 180_000);

  it('T0 coverage: the new definition alone covers the Task this plan adds', async () => {
    // Ruling 0.3 (`rc-rulings.md:51`): `checksWithProposed` judges coverage by id, taking the candidate's new
    // definition (the candidate wins) rather than only merging `added`; `replaced` overwrites the old entry. Here the
    // installed plan check covers only the old Tasks and the same id's new definition covers only the added Task. The
    // plan round is the public place that shows per-Task coverage: its `plan` problem names every uncovered Task and
    // the checks that apply to it (`plan-validation.ts:311-345`), so an empty problem list for the added Task is the
    // coverage evidence. The checks conflict that T0 pins is asserted after it.
    // RED today at the `newTaskProblems` assertion: the plan round answers `... task g8-r1n-new-work, but neither an
    // installed check nor one this plan proposes does. The checks that apply, installed or proposed, by task:
    // g8-r1n-new-work: none ...` because the same id is judged a conflict and only `added` joins the coverage.
    // Named mutation (unproven, production not landed): make `checksWithProposed` merge only `added` and not the
    // same-id `replaced` new definition; this cell's added Task loses its only covering check and turns red again.
    const oldCheck = g8Check('g8-r1-check', ['g8-r1n-work', 'g8-r1n-gate'], R1_OLD);
    const newCheck = g8Check('g8-r1-check', ['g8-r1n-new-work'], R1_NEW);
    const { project, flow } = await openR1World('g8-r1n', [oldCheck]);
    expect((await r1Workspace(project.world, project.scope)).checks?.find(check => check.checkId === 'g8-r1-check')
      ?.taskIds, 'the installed old definition does not cover the old Tasks').toEqual(['g8-r1n-work', 'g8-r1n-gate']);

    const change = await project.line('g8-r1n-change');
    await project.world.scripted.script(change, [
      g8PlanCall('g8-r1n-replace', g8PlanForm('g8-r1n-new', R1_ROLE, [newCheck], true)),
      { kind: 'calls', calls: [{ callId: 'g8-r1n-stop', name: 'submit_plan_round',
        args: { answerKind: 'questions', summary: 'G8 R1n stop', questions: ['Continue?'] } }] },
    ], project.scope);
    const asked = await project.ask('g8-r1n-replace', change, flow.goal);
    const refusal = await problemsAfter(project.world, change, 'g8-r1n-replace', project.scope);
    const newTaskProblems = refusal?.problems.filter(problem => problem.section === 'plan'
      && problem.reason.includes('g8-r1n-new-work')) ?? [];
    expect(newTaskProblems, `the added Task is not covered by the candidate's new definition: `
      + `${JSON.stringify(refusal?.problems)}`).toEqual([]);
    expect(refusal?.problems.filter(problem => problem.section === 'checks') ?? [], JSON.stringify(refusal?.problems))
      .toEqual([]);
    expect(await servedAfter(project.world, change, 'g8-r1n-replace', project.scope),
      'the replacement submit did not end the round').toBeUndefined();

    const replacement = await project.candidate(flow.goal, asked.requestRoot);
    expect(await project.apply(flow.goal, replacement, 'g8-r1n-replace-apply')).toMatchObject({ status: 'committed' });
    const workspace = await r1Workspace(project.world, project.scope);
    expect(workspace.checks?.find(check => check.checkId === 'g8-r1-check'),
      JSON.stringify(workspace.checks)).toMatchObject({ command: R1_NEW, taskIds: ['g8-r1n-new-work'] });
    const adoptedPlanChecks = r1AdoptedPlanChecks(await r1Snapshot(project.world), project.scope);
    expect(adoptedPlanChecks, JSON.stringify(adoptedPlanChecks))
      .toContainEqual({ checkId: 'g8-r1-check', digest: checkDigestOf(newCheck) });
    expect(adoptedPlanChecks).not.toContainEqual({ checkId: 'g8-r1-check', digest: checkDigestOf(oldCheck) });
  });

  it('T0b: a replacement cut off after its checks are staged puts the old plan checks back, in order, at the next Host start', async () => {
    // Today red at the replacement's `plans/apply`: `proposedCheckSplit` (`host-settings.ts:1761`) still judges the
    // same id with other content a conflict and answers `invalid`, naming `g8-r1-check`; the settings stage and the
    // real fault gate below are never reached, so the rollback is unproven until production lands.
    // Named mutation (unproven, production not landed): "when the candidate was not adopted, drop only this plan's
    // new entry and do not put the displaced old entries back" — `g8-r1-check` disappears from the snapshot.
    const restore = installS6B3SettingsSpy();
    try {
      const { project, flow, head, executor } = await openR1World('g8-r1t', [r1OldCheck, r1SecondCheck]);
      const before = await r1PublicChecks(project.world, project.scope);
      const beforeIds = r1CheckIds(before);
      const beforeDigests = r1CheckDigests(before);
      expect(beforeIds).toEqual(expect.arrayContaining(['g8-r1-check', 'g8-r1-second']));
      expect(new Set(beforeIds).size, `duplicate check ids before the replacement: ${beforeIds.join(', ')}`)
        .toBe(beforeIds.length);

      const { applied, reached } = await r1InterruptedReplacement('g8-r1t', project, flow.goal, [r1NewCheck]);
      expect(applied, 'the replacement was refused before its checks were staged; the real fault gate was not '
        + `reached: ${JSON.stringify(applied)}`)
        .toMatchObject({ status: 'rejected', code: 'unavailable' });
      expect(applied.reason ?? '').toMatch(/still pending/);
      await reached;

      await project.world.reopen({ sharedMemoryStore: true });
      const after = await r1PublicChecks(project.world, project.scope);
      expect(r1CheckIds(after), 'the rollback did not restore the checks adopted before').toEqual(beforeIds);
      expect(r1CheckDigests(after), 'the rollback did not restore the old definitions').toEqual(beforeDigests);
      expect(new Set(r1CheckIds(after)).size, `the rollback installed a duplicate check id: ${r1CheckIds(after).join(', ')}`)
        .toBe(r1CheckIds(after).length);
      expect(r1CheckDigests(after), 'the half-replacement definition stayed installed').not.toContain(r1NewDigest);
      // The restored check keeps its old plan as its public approval source: one entry, the old proposal (T0b).
      const workspace = await r1Workspace(project.world, project.scope);
      const approvals = workspace.checkApprovals?.filter(entry => entry.checkId === 'g8-r1-check') ?? [];
      expect(approvals, JSON.stringify(workspace.checkApprovals)).toHaveLength(1);
      expect(approvals[0]!.plan.proposalRef.proposalId, 'the restored check is no longer approved by the old plan')
        .toBe(head.ref.proposalId);

      // A new round after the restart reads the Host's installed configuration, not only the saved settings file.
      const round = await r1NewRound(project.world, project, executor, 'g8-r1t-next');
      expect(round.checks.find(check => check.checkId === 'g8-r1-check')?.command,
        'the new round did not run the recovered old definition').toBe(R1_OLD);
      expect(round.checks.find(check => check.checkId === 'g8-r1-second')?.command).toBe('echo G8_R1_SECOND');
      // The pending record's removal has no public read: unproven here (supplementary T0b ruling, reply F3).
    } finally {
      await disposeS6B3SettingsWrapper();
      restore();
    }
  });

  it('§0.3 counterexample: a failed replacement of the middle check puts the old order back without duplicates', async () => {
    // Today red at the same place as T0b: the middle replacement's `plans/apply` is refused (`invalid`, the id is
    // "already installed") before the settings stage, so neither the real fault gate nor the rollback is reached.
    // This cell pins the ruling's `[A,B] -> [B,A'] -> [B,A]` order swap and its crash-after-first-restore
    // `[B,A,A]` duplicate (rccr.out.md:10).
    // Named mutation (unproven, production not landed): "put the old entry back by appending it to the end instead
    // of inserting it at its original position" — the rollback returns `[A,C,B]`, and the second settle appends
    // `B` again (`[A,C,B,B]`).
    const restore = installS6B3SettingsSpy();
    try {
      const { project, flow } = await openR1World('g8-r1c', r1RollbackChecks);
      const before = await r1PublicChecks(project.world, project.scope);
      const beforeIds = r1CheckIds(before);
      const beforeDigests = r1CheckDigests(before);
      expect(beforeIds).toEqual(expect.arrayContaining(['g8-r1-a', 'g8-r1-b', 'g8-r1-c']));
      expect(new Set(beforeIds).size).toBe(beforeIds.length);
      // B is the middle plan check: appending it moves it past C, which the old-order assertion below sees.
      expect(beforeIds.indexOf('g8-r1-b')).toBeLessThan(beforeIds.indexOf('g8-r1-c'));

      const { applied, reached } = await r1InterruptedReplacement('g8-r1c', project, flow.goal, [r1BNewCheck]);
      expect(applied, `the middle replacement was refused before its checks were staged: ${JSON.stringify(applied)}`)
        .toMatchObject({ status: 'rejected', code: 'unavailable' });
      expect(applied.reason ?? '').toMatch(/still pending/);
      await reached;

      // The first settle's result is read before the restart: the rollback itself must put the old entries back
      // in place and exactly once, not only the next start's second settle.
      const settled = await r1PublicChecks(project.world, project.scope);
      expect(r1CheckIds(settled), 'the first settle did not restore the original order').toEqual(beforeIds);
      expect(r1CheckDigests(settled), 'the first settle did not restore the old definitions').toEqual(beforeDigests);
      expect(new Set(r1CheckIds(settled)).size, `the first settle left duplicate check ids: ${r1CheckIds(settled).join(', ')}`)
        .toBe(r1CheckIds(settled).length);

      await project.world.reopen({ sharedMemoryStore: true });
      const after = await r1PublicChecks(project.world, project.scope);
      expect(r1CheckIds(after), 'the rollback moved the old check out of its original position').toEqual(beforeIds);
      expect(r1CheckDigests(after), 'the rollback did not restore the old definitions').toEqual(beforeDigests);
      expect(new Set(r1CheckIds(after)).size, `the rollback left duplicate check ids: ${r1CheckIds(after).join(', ')}`)
        .toBe(r1CheckIds(after).length);
      expect(r1CheckDigests(after)).not.toContain(r1BNewDigest);
      expect(after.filter(check => check.checkId === 'g8-r1-b'), 'the restored middle check is not exactly one')
        .toHaveLength(1);
      // The pending record's removal has no public read: unproven here.
    } finally {
      await disposeS6B3SettingsWrapper();
      restore();
    }
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

  it('L-2: a plan round replaces an agent-approved plan check by the installed definition\'s plan source', async () => {
    // Today red at `conflictProblems` below: the change round calls `answer-tools.ts:679`
    // `proposedCheckSplit(installed, proposed)` with no replaceable set, so this same id with other content is
    // `checkConflictProblem` ("check g8-l2-check is already installed ... with other content") and the answer is
    // refused (`section: 'checks'`). The old definition here is installed from a plan and its `approvedBy.kind` is
    // `agent`; the public `settings/snapshot` read below proves both. Ruling §0.3/L-2 (rccr.out.md:12;
    // rc-rulings.md:40-51,61-64): the submit side judges replacement by the current installed definition's `plan`
    // source, not by the person-adopted `adoptedPlanChecks` set; AV-7e and the confirmation gate keep reading the
    // person-adopted `(id,digest)`. Other problems of the round (if any) are left alone: only the same-id conflict
    // is asserted absent.
    // Named mutation: replace "judge replaceable by the installed definition's plan source" with "only the
    // person-adopted `adoptedPlanChecks` set" (the pre-package submit rule). This agent-approved check is not in
    // that set, so this cell turns red again at the same `checks` conflict. The mutation cannot be executed today:
    // the source-side rule is not landed (unproven).
    const tag = 'g8-l2';
    const oldCheck = g8Check(`${tag}-check`, [`${tag}-work`], 'test -f g8-l2-before.txt');
    const newCheck = g8Check(`${tag}-check`, [`${tag}-next-work`], 'echo G8_L2_NEW');
    const r = await secretaryChange(tag, oldCheck, [g8bCheckReview(`${tag}-approve`,
      [{ checkId: oldCheck.checkId, decision: 'approve', reason: '改动前确实失败，查的正是新任务' }])]);
    cleanup.push(r.w.close);
    // The candidate head is read before the adviser's approval is processed; adoption is the public readable step.
    const head = await r.head();
    const observed = await heartbeatUntil(r.w.world, async () => ({
      entry: await r.w.steps.settingsEntry(),
      planRevision: await r.w.planRevision(r.goal),
    }), value => value.entry.checkApprovals?.some(approval => approval.checkId === oldCheck.checkId
      && approval.approvedBy.kind === 'agent') === true && value.planRevision === 2, 40);
    const entry = observed.entry;
    // Public snapshot: the old definition is installed, its source is this plan, and an agent approved it.
    expect(entry.checkApprovals?.some(item => item.checkId === oldCheck.checkId && item.approvedBy.kind === 'agent'),
      JSON.stringify(entry.checkApprovals)).toBe(true);
    expect(entry.checks?.find(check => check.checkId === oldCheck.checkId), JSON.stringify(entry.checks))
      .toMatchObject(oldCheck);
    const approval = entry.checkApprovals!.find(item => item.checkId === oldCheck.checkId)!;
    expect(approval.plan.proposalRef.proposalId).toBe(head.ref.proposalId);
    expect(approval.approvedBy.kind).toBe('agent');
    expect(await r.w.planRevision(r.goal)).toBe(2);

    // A later plan round brings the same id with a new definition (and covers the Task this plan adds).
    await r.w.world.scripted.script(r.secretary, [g8PlanCall(`${tag}-next-plan`,
      g8PlanForm(`${tag}-next`, G8B_ROLE, [newCheck], true))], r.w.scope);
    await r.w.steps.ask(`${tag}-next`, r.secretary, r.goal);
    const refusal = await problemsAfter(r.w.world, r.secretary, `${tag}-next-plan`, r.w.scope);
    // The plan round must accept the submit, not only omit the same-id checks conflict: the Task this plan adds
    // also has to be covered, and an accepted tool call ends the round (no served follow-up request).
    const newTaskProblems = (refusal?.problems ?? []).filter(problem => problem.section === 'plan'
      && problem.reason.includes(`${tag}-next-work`));
    expect(newTaskProblems, `the added Task is not covered by the candidate's new definition: `
      + `${JSON.stringify(refusal?.problems)}`).toEqual([]);
    expect(await servedAfter(r.w.world, r.secretary, `${tag}-next-plan`, r.w.scope),
      'the replacement submit did not end the round').toBeUndefined();
    const conflictProblems = (refusal?.problems ?? []).filter(problem => problem.section === 'checks'
      && (problem.reason.includes(oldCheck.checkId) || /already installed/i.test(problem.reason)));
    expect(conflictProblems, JSON.stringify(refusal?.problems)).toEqual([]);
  });
});
