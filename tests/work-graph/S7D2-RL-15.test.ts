/**
 * RL-15 (`7d2-start-rulings.v4.md:8853`, with `later-rows-merged.md:217`; book `:1318`, §3.10): autonomy rules. A
 * project rule for `create_member` lets Q's Work Run and S's secretary round create directly, never widens E's
 * delegation, stops matching at `now === expiresAt`, and a revoke between judge and commit re-judges to the factory card.
 *
 * World: `openS7D2RulesWorld` (tests/helpers/S7D2-rules-world.ts). Prior of every instance (write-tests brief
 * `tests-7d2-o3b.txt:70`): `projects/role-limits/set {open:{adviser:2}}`, G `every_step`, one project rule from
 * `autonomy-rules/create {actions:['create_member'], scope:[{kind:'project'}], limits:{open:{}}, expiresAt:null,
 * approvedFrom:null}` (lead Q26). Times (lead Q16, the world's day): `expiresAt` `2026-10-24T00:00:00.000Z`; the
 * pre-expiry instance at `…23:59:59.000Z`, the held instance at `…23:59:59.500Z`, the expiry instance at `expiresAt`.
 * Only the held instance (a CAS) runs on SQLite too (S3). The O3a replay row (`7d2-o3a-fix1-reply.md:43`, `:52`;
 * lead Q19) is its own world.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { MemberRequestResultV1 } from '../../src/core/work-graph/tasks/member-service.js';
import { advanceUntil, driveWorkflow, readExecution } from '../helpers/A2-restart-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import type { S6ABackend } from '../helpers/S6A-request-fixture.js';
import { committed } from '../helpers/S7A-fixture.js';
import { askS7D2Member } from '../helpers/S7D2-role-line-world.js';
import { openS7D2RulesWorld, type S7D2RulesWorld } from '../helpers/S7D2-rules-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S7D2RulesWorld[] = [];
afterEach(async () => {
  expect(commitBarrier.reset()).toEqual([]);
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
});

const EXPIRES_AT = '2026-10-24T00:00:00.000Z';
const RULE = { actions: ['create_member'], scope: [{ kind: 'project' }], limits: { open: {} }, expiresAt: null,
  approvedFrom: null };
/** Q's and E's own Tasks and one member Task per caller, all on G (the member Task's goal is the affected goal). */
const TASKS = [{ taskId: 'rl15-q', role: 'platform-adviser' }, { taskId: 'rl15-e', role: 'platform-executor' },
  ...['rl15-mq', 'rl15-ms', 'rl15-me'].map(taskId => ({ taskId, role: 'platform-executor' }))];

async function openWorld(backend: S6ABackend = 'memory'): Promise<S7D2RulesWorld> {
  const world = await openS7D2RulesWorld({ backend, tasks: TASKS });
  worlds.push(world);
  return world;
}

/** The row's prior: the adviser cap 2 and the one project rule through the person routes. */
async function openPrior(backend: S6ABackend = 'memory'): Promise<S7D2RulesWorld> {
  const world = await openWorld(backend);
  await world.setOpen({ adviser: 2 }, 'rl15-cap-2');
  committed(await world.rules('create', RULE, 'rl15-rule'), 'the project rule');
  return world;
}

/** The instance's own `autonomy-rules/update` to `EXPIRES_AT`; answers the view read before it. */
async function expire(world: S7D2RulesWorld, requestId: string) {
  const before = await world.readRules();
  const rule = before.rules[0]!;
  committed(await world.rules('update', { ruleId: rule.ref.ruleId, expectedRevision: rule.revision,
    expectedSetRevision: before.set.revision, expiresAt: EXPIRES_AT }, requestId), 'the rule update');
  return before;
}

/** Q's first real `create_member` from its Work Run, for the member Task `rl15-mq`. */
async function askQ(world: S7D2RulesWorld, label: string): Promise<MemberRequestResultV1> {
  if (world.lines.adviser === null) throw new Error('RL-15: the world has no adviser line Q');
  return await askS7D2Member(world.world, { caller: world.lines.adviser, goal: world.g,
    callerTask: world.gTask('rl15-q'), memberTask: world.gTask('rl15-mq'), label });
}

const createdNotices = async (world: S7D2RulesWorld) =>
  (await world.main.readNotices({ goal: world.g, categories: ['member_created'] })).notices.length;
/** Each `member_creation` card on G as `[cardKey, subject]`. */
const memberCards = async (world: S7D2RulesWorld) => (await world.main.readCards(world.g))
  .filter(card => card.source.kind === 'member_creation').map(card => [card.source.key, card.subject]);
const cardKeyOf = (result: MemberRequestResultV1) => result.status === 'needs_decision' ? result.cardKey : null;

describe('RL-15: autonomy rules', () => {
  /* Named mutation: `create_member`'s judge never reads the rule set (the factory every-step default only):
     Q's and S's `{status:'created'}`, the notice counts and the empty card list turn red. */
  it('base instance: E forbidden, Q and S direct with one notice each, E2 and Q’s child within bounds, update +1', async () => {
    const world = await openPrior();
    expect(await askS7D2Member(world.world, { caller: world.lines.noCreate, goal: world.g,
      callerTask: world.gTask('rl15-e'), memberTask: world.gTask('rl15-me'), label: 'rl15-e' })).toEqual({
      status: 'rejected', code: 'forbidden', reason: 'the member caller Run is not admitted to create a member' });
    const q = await askQ(world, 'rl15-q');
    expect(q).toMatchObject({ status: 'created' });
    expect(await createdNotices(world)).toBe(1);
    expect(await memberCards(world)).toEqual([]);
    const s = await world.secretaryMember(world.gTask('rl15-ms'), 'rl15-s');
    expect(s).toMatchObject({ status: 'created' });
    expect(await createdNotices(world)).toBe(2);
    expect(await memberCards(world)).toEqual([]);
    if (q.status !== 'created' || s.status !== 'created') throw new Error('RL-15: Q or S created no member');

    // E2 (brief :71, lead ruling 11-04 18:0x on reply 7.1): the envelope E2's first Run prepares carries
    // `createMember: false` (read as `S7C-M-secretary.test.ts` `prepareChild` does: claim, then stop before start).
    const e2Claim = await advanceUntil(world.world.ag2b, { schemaVersion: 1, goalRef: world.g, flowId: 'rl15-e2',
      sessionHint: s.session, kind: 'select_work', taskId: 'rl15-ms' }, 'claim_task');
    const e2Receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(world.world.ag2b, e2Claim, { stopBefore: 'start', receipts: e2Receipts });
    const e2Prepare = e2Receipts.find(receipt => receipt.kind === 'prepare');
    if (e2Prepare === undefined || e2Prepare.result.status !== 'ready') {
      throw new Error(`RL-15: E2 did not prepare: ${JSON.stringify(e2Receipts)}`);
    }
    expect(e2Prepare.result.value.envelope.permissions.createMember).toBe(false);
    // Q's child: its tools are a subset of Q's own accepted Run tools.
    const qRun = await world.main.taskRun(world.g, 'rl15-q');
    if (qRun === null) throw new Error('RL-15: Q’s Task holds no Run');
    const qTools = (await readExecution(world.world.ag2b, qRun)).run.envelope?.permissions.tools;
    const childTools = (await world.world.readSession(q.session)).record.delegationCeiling?.tools;
    expect(childTools).toBeDefined();
    expect(qTools).toEqual(expect.arrayContaining(childTools!));

    const before = await expire(world, 'rl15-update');
    const after = await world.readRules();
    expect(after.set.revision).toBe(before.set.revision + 1);
    expect(after.rules).toMatchObject([{ expiresAt: EXPIRES_AT }]);
  });

  /* Named mutation: the matcher counts every rule with a non-null `expiresAt` as expired: `{status:'created'}`
     and the one notice turn red (the expiry instance stays green). */
  it('pre-expiry instance: one second before expiresAt, Q’s first create_member still matches', async () => {
    const world = await openPrior();
    await expire(world, 'rl15-update-2');
    world.world.clock.set('2026-10-23T23:59:59.000Z');
    expect(await askQ(world, 'rl15-q2')).toMatchObject({ status: 'created' });
    expect(await createdNotices(world)).toBe(1);
  });

  /* Named mutation: the member accept commit does not guard the rule-set revision: the held commit lands after the
     revoke, so `needs_decision`, the one card with that key and the unchanged Session count turn red. */
  it.each(['memory', 'sqlite'] as const)('held instance (%s): a revoke between judge and commit re-judges to the one factory card', async backend => {
    const world = await openPrior(backend);
    await expire(world, 'rl15-update-3');
    world.world.clock.set('2026-10-23T23:59:59.500Z');
    const view = await world.readRules();
    const rule = view.rules[0]!;
    const sessions = (await world.world.listSessions()).length;
    const held = commitBarrier.hold(commit => commit.identityKey.startsWith('member.request:'), 'rl15-q-accept');
    const asked = askQ(world, 'rl15-q3');
    asked.catch(() => undefined);
    await held.reached;
    committed(await world.rules('revoke', { ruleId: rule.ref.ruleId, expectedRevision: rule.revision,
      expectedSetRevision: view.set.revision }, 'rl15-revoke'), 'the revoke');
    held.release();
    const result = await asked;
    expect(result).toMatchObject({ status: 'needs_decision', cardKey: expect.any(String) });
    expect(await memberCards(world)).toEqual([[cardKeyOf(result), { kind: 'goal', goalRef: world.g }]]);
    expect((await world.world.listSessions()).length).toBe(sessions);
    expect((await world.readRules()).rules).toMatchObject([{ state: 'revoked', expiresAt: EXPIRES_AT }]);
  });

  /* Named mutation (v4 :8853): match by scope only, ignore expiry: Q's call answers `created`, so
     `needs_decision`, the one card, the zero notices and the unchanged Session count turn red. */
  it('expiry instance: at now === expiresAt no rule matches; the factory card, no notice, no Session', async () => {
    const world = await openPrior();
    await expire(world, 'rl15-update-4');
    world.world.clock.set(EXPIRES_AT);
    const sessions = (await world.world.listSessions()).length;
    const result = await askQ(world, 'rl15-q4');
    expect(result).toMatchObject({ status: 'needs_decision', cardKey: expect.any(String) });
    expect(await memberCards(world)).toEqual([[cardKeyOf(result), { kind: 'goal', goalRef: world.g }]]);
    expect(await createdNotices(world)).toBe(0);
    expect((await world.world.listSessions()).length).toBe(sessions);
  });

  /* Named mutation: the cap read and `validateAutonomyRule` move back before the executor's receipt check: the
     same-requestId replay is refused `rule_limit_over_cap`, so `replayed: true` turns red. */
  it('replay after the executor cap is lowered: the committed create replays, a new command is refused', async () => {
    const world = await openWorld();
    const body = { actions: ['create_member'], scope: [{ kind: 'project' }], limits: { open: { executor: 16 } },
      expiresAt: null, approvedFrom: null };
    committed(await world.rules('create', body, 'rl15-replay'), 'the executor-16 rule');
    const ruleIds = (await world.readRules()).rules.map(rule => rule.ref.ruleId);
    expect(ruleIds).toHaveLength(1);
    await world.setOpen({ executor: 8 }, 'rl15-executor-8');
    expect((await world.rules('create', body, 'rl15-replay')).body).toMatchObject({ status: 'committed', replayed: true });
    expect((await world.readRules()).rules.map(rule => rule.ref.ruleId)).toEqual(ruleIds);
    expect((await world.rules('create', body, 'rl15-replay-new')).body).toEqual({ status: 'rejected', code: 'invalid',
      reason: 'rule_limit_over_cap: executor 16 exceeds the project open cap 8' });
  });
});

describe('rejects: autonomy-rules/create (v4 :3447, :3452–:3453)', () => {
  /* Named mutation, per entry: drop the `RuleActionV1` membership check / the per-duty limit ≤ cap check from
     `validateAutonomyRule`: that entry's create commits, so its `toEqual` and the unchanged view turn red. */
  it.each([
    ['rule_action_fixed', { actions: ['confirm_goal'], scope: [{ kind: 'project' }], limits: { open: {} },
      expiresAt: null, approvedFrom: null }, 'rule_action_fixed: actions must be a non-empty list of RuleActionV1'],
    ['rule_limit_over_cap', { actions: ['create_member'], scope: [{ kind: 'project' }],
      limits: { open: { adviser: 3 } }, expiresAt: null, approvedFrom: null },
    'rule_limit_over_cap: adviser 3 exceeds the project open cap 2'],
  ])('%s', async (name, input, reason) => {
    const world = await openPrior();
    const before = await world.readRules();
    expect((await world.rules('create', input, `rl15-${name}`)).body).toEqual({ status: 'rejected', code: 'invalid', reason });
    expect(await world.readRules()).toEqual(before);
  });
});
