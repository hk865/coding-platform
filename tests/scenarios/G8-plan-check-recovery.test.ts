/**
 * G8A row C7 (decision 121-136; `g8-rulings.md` "审查后的修改" 1-4 after Astra g8cr; lead 11-16 晚): the person's
 * adoption of a plan bringing checks, around its install. World as C3/C4: the S6A host world, a second workspace
 * opened through `workspaces/open` with write and commands (`addS7D2SecondWorkspace`), the person's `plans/propose`
 * and `plans/apply`, the Host settings `snapshot` and `checks/approve`; memory, and SQLite only for the restart (S3).
 * Rewritten from the builder's scratch rows; nothing is written to a store or the settings file by hand.
 * - C7a (item 4): a plan whose check equals an installed one is adopted on the read-only main workspace.
 * - C7b (item 3), C7e (re-check `g8rr` item 3) on C1's new project: P adopted with its check, then the person's
 *   `checks/approve` of the seed answer's list replaces the whole list. C7b: the same `plans/apply` replayed answers
 *   its receipt while P's current Goal cannot be read (a read fault for the replay: only the path past the early
 *   receipt reads it, and refuses) and does not install P's check again (g8rr2 item 2: without the fault, the plain
 *   adoption past the early receipt would replay the receipt too). C7e: P applied again under a new request id is
 *   refused (not a pending candidate) and P's check stays out; red on 05d7937b (the check comes back), green from the
 *   builder's re-check commits (g8stack f9ae2f37: one gate, a finished candidate goes to the adoption's own refusal).
 * - C7c (item 2): an adoption refused after its install, in a workspace with no checks before, takes the check off the
 *   settings and the Host: the next adoption installs it again and records the person's approval.
 * - C7d (item 1, SQLite): the adoption's own commit is held after its install (RULES A3 gate) and the Host goes down
 *   there (crash fixture); the next Host's start takes the check back, the plan stays unadopted, a new adoption
 *   installs it. C7a-C7d: red on g8ab 4d46b7a6, green on 05d7937b; all five green on g8stack f9ae2f37. Mutations
 *   shown in `g8t-reply.md`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { canonicalRefKey } from '../../src/core/work-graph/persistence/record-codecs.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { g8Check, g8PlanDraft, g8SplitChecks, g8Steps, openG8Project, type G8Check } from '../helpers/G8-world.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { initializeProject } from '../helpers/S6A-history-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { OPERATOR, S6A_GOAL_1, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { checkConfiguration, committed, ready } from '../helpers/S7A-fixture.js';
import { addS7D2SecondWorkspace } from '../helpers/S7D2-role-line-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const cleanup: (() => Promise<void>)[] = [];
// C7d leaves the abandoned Host's adoption held; the reset lets it go before the world closes.
afterEach(async () => { commitBarrier.reset(); await Promise.allSettled(cleanup.splice(0).reverse().map(close => close())); });

const ROLE = S6A_WORK_ROLE.templateId;
async function openC7World(backend: 'memory' | 'sqlite', checks?: G8Check[]): Promise<S6AHostWorld> {
  const world = await openS6AHostWorld({ backend, extraHostOptions: { requestDriver: 'on', ...(checks === undefined
    ? {} : { checks: { ...checkConfiguration({ kind: 'human', id: OPERATOR.id }), checks } }) } });
  cleanup.push(() => world.close());
  await initializeProject(world);
  return world;
}
async function proposeWithChecks(world: S6AHostWorld, scope: WorkspaceScope, goal: GoalRef, tag: string,
  checks: G8Check[], role = ROLE) {
  const { draft, checks: own } = g8SplitChecks(g8PlanDraft(goal, tag, role, checks));
  return committed<{ ref: unknown; revision: number }>(await world.post('plans/propose', graphWrite(scope, { goalRef: goal,
    basedOn: null, draft, checks: own, reason: { text: tag, sources: [] } }, `${tag}-propose`)), 'plans/propose');
}
/** A granted second workspace, its Goal, and the person's proposal of a plan bringing `check`. */
async function proposed(world: S6AHostWorld, tag: string, check: G8Check) {
  const second = await addS7D2SecondWorkspace(world, tag, { writeAllowed: true, commandsAllowed: true });
  cleanup.push(second.remove);
  return { scope: second.scope, goal: second.goal, steps: g8Steps(world, second.scope, tag),
    proposal: await proposeWithChecks(world, second.scope, second.goal, tag, [check]) };
}
const apply = async (world: S6AHostWorld, scope: WorkspaceScope, proposal: { ref: unknown; revision: number },
  commandId: string, revision = proposal.revision) => (await world.post('plans/apply', graphWrite(scope,
  { proposalRef: proposal.ref, expectedProposalRevision: revision, decisionRefs: [] }, commandId))).body;
/**
 * C1's new project (its seed answer proposed `g8-seed-check`): the person adopts P, a new Goal's plan bringing
 * `<tag>-own`, then approves the seed answer's list through `checks/approve`, which replaces the whole list.
 */
async function adoptedThenReplaced(tag: string) {
  const seed = g8Check('g8-seed-check', ['g8-seed-work', 'g8-seed-gate']);
  const project = await openG8Project(tag, [seed]);
  cleanup.push(project.close);
  const goal = (await s6aCardsWorkspace(project.world, project.scope).createGoal(`${tag}-goal`)).ref;
  const proposal = await proposeWithChecks(project.world, project.scope, goal, tag,
    [g8Check(`${tag}-own`, [`${tag}-work`], 'echo G8_C7_P')], 'local-workbench');
  expect(await apply(project.world, project.scope, proposal, `${tag}-apply`)).toMatchObject({ status: 'committed' });
  expect(JSON.stringify(await project.settingsEntry())).toContain(`${tag}-own`);
  expect((await project.world.settings('checks/approve', { scope: project.scope, answerRef: project.seedAnswer,
    checks: [seed] })).status).toBe('ready');
  expect(JSON.stringify(await project.settingsEntry())).not.toContain(`${tag}-own`);
  return { project, goal, proposal };
}
const installed = async (steps: ReturnType<typeof g8Steps>, check: G8Check) => {
  const entry = await steps.settingsEntry();
  expect(entry.checks?.find(item => item.checkId === check.checkId), JSON.stringify(entry)).toMatchObject(check);
  expect(JSON.stringify(entry)).toContain('"approvedBy":{"kind":"person"}');
};

describe('G8A C7: the person\'s adoption that installs a plan\'s checks recovers, rolls back and replays', () => {
  it('C7a: a plan whose check is identical to an installed one is adopted where nothing is granted', async () => {
    const check = g8Check('g8-c7a-all', 'all', 'echo G8_C7A');
    const world = await openC7World('memory', [check]);
    const proposal = await proposeWithChecks(world, S6A_SCOPE, S6A_GOAL_1, 'g8-c7a', [check]);
    expect(await apply(world, S6A_SCOPE, proposal, 'g8-c7a-apply')).toMatchObject({ status: 'committed' });
  }, 180_000);

  it('C7b: after the whole list is replaced, the same adoption replayed answers its receipt and installs nothing', async () => {
    const { project, goal, proposal } = await adoptedThenReplaced('g8-c7b');
    // A dependency fault (A2 at the A4 seam): reading P's Goal fails during the replay. The receipt path never reads it;
    // the candidate read past that path does (`host.ts:2650`) and then refuses, so only the receipt answers `committed`.
    // (The one read the fault counts on the receipt path is the adoption export's, after the answer: not asserted.)
    const goalRead = commitBarrier.failReads(canonicalRefKey(goal), 'throw-always');
    const replayed = await apply(project.world, project.scope, proposal, 'g8-c7b-apply');
    goalRead.release();
    expect(replayed, 'the replay went past the receipt to the candidate read').toMatchObject({ status: 'committed',
      replayed: true });
    expect(JSON.stringify(await project.settingsEntry())).not.toContain('g8-c7b-own');
  }, 180_000);

  it('C7e: the adopted plan applied again under a new request id is refused and its check stays out', async () => {
    const { project, proposal } = await adoptedThenReplaced('g8-c7e');
    expect(await apply(project.world, project.scope, proposal, 'g8-c7e-again')).toMatchObject({ status: 'rejected' });
    expect(JSON.stringify(await project.settingsEntry())).not.toContain('g8-c7e-own');
  }, 180_000);

  it('C7c: a refused adoption in a workspace with no checks takes its check off the settings and the Host', async () => {
    const world = await openC7World('memory');
    const check = g8Check('g8-c7c-check', ['g8-c7c-work'], 'echo G8_C7C');
    const { scope, steps, proposal } = await proposed(world, 'g8-c7c', check);
    expect(await apply(world, scope, proposal, 'g8-c7c-stale', proposal.revision + 1)).toMatchObject({ status: 'rejected' });
    expect(JSON.stringify(await steps.settingsEntry())).not.toContain('g8-c7c-check');
    expect(await apply(world, scope, proposal, 'g8-c7c-apply')).toMatchObject({ status: 'committed' });
    await installed(steps, check);
  }, 180_000);

  it('C7d: the Host stops between the install and the adoption; its next start takes the check back', async () => {
    const world = await openC7World('sqlite');
    const check = g8Check('g8-c7d-check', ['g8-c7d-work'], 'echo G8_C7D');
    const { scope, goal, steps, proposal } = await proposed(world, 'g8-c7d', check);
    const adoption = commitBarrier.hold(byIdentityPrefix('plan-apply:'), 'g8-c7d adoption');
    void apply(world, scope, proposal, 'g8-c7d-apply').catch(() => undefined);
    // Held here, the install has run and the settings stay busy with this adoption until the Host goes down.
    await adoption.reached;
    await world.crash();
    expect(JSON.stringify(await steps.settingsEntry())).not.toContain('g8-c7d-check');
    expect(ready<{ goal: { activePlanRevision: unknown } }>(await world.post('goals/read', plain(scope, goal)), 'goals/read')
      .goal.activePlanRevision).toBeNull();
    expect(await apply(world, scope, proposal, 'g8-c7d-retry')).toMatchObject({ status: 'committed' });
    await installed(steps, check);
  }, 240_000);
});
