/**
 * RL-19 (`7d2-start-rulings.v4.md:8857`; the resolver v4 `:5315–:5386`, the send sites `:5443–:5509`;
 * `book-7d2.md:570–:591`; write-tests brief `tests-7d2-o4b2.txt:26–:54`; o4b2 rulings 2 (b), 3, 12, 23, 24): a member's
 * report goes to the goal's responsible adviser, never to the member's creator; the creator, when it is a live
 * Session other than the recipient, gets one `notify` copy; with no responsible line and no live creator nothing is
 * sent and the goal shows the `no_adviser` card.
 *
 * World: one `openS7D2RoleLineWorld({ backend: 'memory', extraBindings: [S7D2_ADVISER_WORK] })` per cell (the frozen
 * steps (3)→(4)→(5) cannot run on one A: a full handoff archives it; brief `:28`, precedent RL-13). G = goal 1.
 * - A: `role-lines/open {duty:'adviser',scope:[]}`, no scope link. B (every cell but C6): `role-lines/open` on
 *   `[goal G]`; read through `sessions/find {target: goal G}`, B is the one line with an open responsible link to G
 *   (the opening adviser holds only the project link).
 * - goal 2's Plan: `callerA`, `callerB` (the platform adviser role); G's Plan: `m` (the world's Work role). No
 *   dependency and no placeholder: no refinement round, so nothing allocates an adviser to G.
 * - E: A's real `create_member` for `m`, called from A's Work Run on `callerA` (`askS7D2Member`), `created` directly
 *   under G's default `after_plan_confirmation`; prior: E's executor holder `creator` is A (7D1's derivation).
 * - Per cell: C1 B's `create_member` for `m` answers `reused` (E); C3 `sessions/archive-line` A with `callerA`
 *   dropped (o4b2 ruling 12), creator `lapsed`; C4 C3 then `sessions/reactivate` A, creator A; C5 the person's full
 *   handoff of A to an adviser (`handoffS7D2Line`, brief `:28`), creator the successor A′; C6 no B and C3.
 * - The report: E's one Run fails (`driveS7D2MemberDeviation`, a `stop` deviation; the Task-pinned drive never
 *   selects the deviation), then one goal-level `workflow/advance` of `select_work` on G with no `taskId` (o4b2
 *   ruling 24), driven until the Workflow stops.
 * - No adviser line opens a model round from its inbox in this world, by the world's configuration: the adviser role
 *   has no query profile (`tests/helpers/S6A-request-fixture.ts:196–:201`), so the Host skips it as `no_profile`
 *   (`src/app/host.ts:2172–:2178`).
 * Reads: `messages/inbox` and `messages/body` per line, `role-lines/allocation`, `sessions/find`, `sessions/read`,
 * `decisions/queue`. The copy's request id (`recipient-copy:<rid>:<key>`, v4 `:5504–:5506`) is on no public read and
 * is not asserted (brief `:40`).
 *
 * Expected (by hand): the round's request id is `rid = deviation:<G's goalId>:<m's taskId>:stop:1` (the format v4
 * `:5485–:5488` keeps; G's first adopted Plan is version 1) and the first line of its body; it is an
 * `action_request` with `needsReply: true` and `goalRef: G`. The copy is one `notify` with `goalRef: G` and the body
 * `请知悉（抄送，不需要回复）：任务 <m's taskId> 的偏差已发给负责的参谋（<rid>）。` (o4b2 rulings 3, 23). Per cell:
 * C0 B the round, A the copy; C1 the same (reuse rewrites no creator); C3 B the round, A nothing (lapsed); C4 A the
 * copy again; C5 A′ the copy, A nothing; C6 no adviser gets the round or a copy, and one `goal_cause/no_adviser`
 * card (o4b2 ruling 2 (b)). The creator half (successor, lapsed, restored, reuse) is 7D1's and only a prior here.
 */
import { afterEach, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { CreatorContactV1 } from '../../src/contracts/role-lines.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { driveWorkflow, type AdvanceValue } from '../helpers/A2-restart-fixture.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { readBody } from '../helpers/IV-host-fixture.js';
import { adoptPLMixedPlan, PL_ADVISER_ROLE } from '../helpers/PL-consumption-fixture.js';
import { refOf } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { sessionOf } from '../helpers/S7A-fixture.js';
import { inboxOf } from '../helpers/S7B-F-support.js';
import {
  askS7D2Member, driveS7D2MemberDeviation, handoffS7D2Line, openS7D2RoleLineWorld, openTargetsOf,
  S7D2_ADVISER_WORK, type S7D2RoleLineWorld,
} from '../helpers/S7D2-role-line-world.js';
import { waitFor } from '../scenarios/harness.js';

const worlds: S7D2RoleLineWorld[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(world => world.close())); });

type Cell = 'C0' | 'C1' | 'C3' | 'C4' | 'C5' | 'C6';

/** The shared prior of a cell (brief `:30–:38`, steps 1–4). */
type Prior = {
  readonly handle: S7D2RoleLineWorld;
  readonly a: S6ASession;
  readonly b: S6ASession | null;
  readonly e: S6ASession;
  readonly callerA: TaskTriple;
  readonly callerB: TaskTriple;
  readonly m: TaskTriple;
};

type Received = { readonly message: SessionMessage; readonly text: string };

const firstLine = (text: string): string => text.split('\n')[0] ?? '';
const notifies = (items: readonly Received[]): Received[] => items.filter(item => item.message.intent === 'notify');
const actionRequests = (items: readonly Received[]): Received[] =>
  items.filter(item => item.message.intent === 'action_request');
const withFirstLine = (items: readonly Received[], rid: string): Received[] =>
  items.filter(item => firstLine(item.text) === rid);

/** `messages/inbox` of one line (`inboxOf`) with each message's saved body (`messages/body`, part `message`). */
async function receivedBy(handle: S7D2RoleLineWorld, line: S6ASession | SessionRef): Promise<Received[]> {
  const received: Received[] = [];
  for (const message of await inboxOf(handle.world, refOf(line))) {
    received.push({ message, text: await readBody(handle.world, message.ref, 'message') });
  }
  return received;
}

/** The lines `sessions/find {target: goal G}` names with an open responsible link to G. */
async function goalLines(handle: S7D2RoleLineWorld): Promise<string[]> {
  const g = handle.goal;
  return (await handle.findByTarget({ kind: 'goal', ref: g }))
    .filter(card => openTargetsOf(card).some(target => target.kind === 'goal' && target.ref.goalId === g.goalId))
    .map(card => card.record.ref.sessionId).sort();
}

/** E's executor holder `creator` in `role-lines/allocation` (the derived contact; a prior only, brief `:52`). */
async function holderCreatorOf(handle: S7D2RoleLineWorld, line: S6ASession): Promise<CreatorContactV1 | null> {
  return (await handle.allocation()).duties.executor.holders
    .find(holder => holder.session.sessionId === line.ref.sessionId)?.creator ?? null;
}

/** Steps 1–4 of the shared prior (brief `:31–:34`). */
async function openPrior(withB: boolean): Promise<Prior> {
  const handle = await openS7D2RoleLineWorld({ backend: 'memory', extraBindings: [S7D2_ADVISER_WORK] });
  worlds.push(handle);
  const g = handle.goal;
  const a = await handle.lineOf('rl19-a', (await handle.open({ duty: 'adviser', scope: [], requestId: 'rl19-a' }))
    .result);
  const b = withB ? await handle.lineOf('rl19-b', (await handle.open({ duty: 'adviser',
    scope: [{ kind: 'goal', goalRef: g }], requestId: 'rl19-b' })).result) : null;
  expect(await goalLines(handle)).toEqual(b === null ? [] : [b.ref.sessionId]);

  const second = handle.world.goals.second;
  const callers = await adoptPLMixedPlan(handle.world, { goal: second, label: 'rl19-callers', tasks: [
    { taskId: 'rl19-caller-a', role: PL_ADVISER_ROLE.templateId },
    { taskId: 'rl19-caller-b', role: PL_ADVISER_ROLE.templateId }] });
  const member = await adoptPLMixedPlan(handle.world, { goal: g, label: 'rl19-member',
    tasks: [{ taskId: 'rl19-m', role: S6A_WORK_ROLE.templateId }] });
  const [callerA, callerB] = callers.tasks;
  const m = member.tasks[0]!;

  const created = await askS7D2Member(handle.world, { caller: a, goal: second, callerTask: callerA!, memberTask: m,
    label: 'rl19-e' });
  expect(created).toMatchObject({ status: 'created' });
  if (created.status !== 'created') throw new Error(`RL-19: E was not created: ${JSON.stringify(created)}`);
  const e = await sessionOf(handle.world, { label: 'rl19-e', ref: created.session, operation: created.operation });
  expect(await holderCreatorOf(handle, e)).toEqual({ kind: 'session', session: refOf(a) });
  return { handle, a, b, e, callerA: callerA!, callerB: callerB!, m };
}

/** C3's archive (o4b2 ruling 12): `sessions/archive-line` A with its open `callerA` link dropped. */
async function archiveA(p: Prior): Promise<void> {
  const card = await p.handle.readCard(p.a);
  valueOf((await p.handle.world.post('sessions/archive-line', graphWrite(S6A_SCOPE, {
    sessionRef: p.a.ref, reason: 'RL-19: A archived without a handoff',
    tasks: [{ target: { kind: 'task', ref: p.callerA }, disposition: { kind: 'drop' } }], wait: null,
  }, 'rl19-archive-a', [{ ref: card.record.ref, revision: card.record.revision }]))).body, 'ready', 'the archive of A');
  expect((await p.handle.readCard(p.a)).record.lifecycle).toBe('archived');
}

/**
 * Each cell's own creator step (brief table, column "前置"), after the shared prior and before the report; answers
 * the line the copy is expected on (null: no live creator other than the recipient gets one).
 */
async function cellPrior(cell: Cell, p: Prior): Promise<SessionRef | null> {
  switch (cell) {
    case 'C0':
      return refOf(p.a);
    case 'C1': {
      const reused = await askS7D2Member(p.handle.world, { caller: p.b!, goal: p.handle.world.goals.second,
        callerTask: p.callerB, memberTask: p.m, label: 'rl19-reuse' });
      expect(reused).toMatchObject({ status: 'reused', session: refOf(p.e) });
      expect(await holderCreatorOf(p.handle, p.e)).toEqual({ kind: 'session', session: refOf(p.a) });
      return refOf(p.a);
    }
    case 'C3':
    case 'C6':
      await archiveA(p);
      expect(await holderCreatorOf(p.handle, p.e)).toEqual({ kind: 'lapsed' });
      return null;
    case 'C4':
      await archiveA(p);
      await p.handle.reactivate(p.a, 'RL-19: A reactivated');
      expect(await holderCreatorOf(p.handle, p.e)).toEqual({ kind: 'session', session: refOf(p.a) });
      return refOf(p.a);
    case 'C5': {
      const { successor } = await handoffS7D2Line(p.handle.world, { source: p.a, duty: 'adviser',
        commandId: 'rl19-handoff' });
      await waitFor(() => p.handle.readCard(p.a), card => card.record.lifecycle === 'archived',
        'A archived after its full handoff');
      expect(await holderCreatorOf(p.handle, p.e)).toEqual({ kind: 'session', session: refOf(successor) });
      return refOf(successor);
    }
  }
}

/** Steps 7–8: E's failed Run leaves the `stop` deviation; one goal-level advance on G sends what it selects. */
async function report(p: Prior, cell: Cell): Promise<AdvanceValue[]> {
  const label = `rl19-${cell.toLowerCase()}`;
  await driveS7D2MemberDeviation(p.handle.world, { member: p.e, goal: p.handle.goal, task: p.m, label });
  return await driveWorkflow(p.handle.world.ag2b, { schemaVersion: 1, goalRef: p.handle.goal,
    flowId: `${label}-send`, sessionHint: null, kind: 'select_work' });
}

/** Any step of the drive whose `next` is the perform of `send_system_round`. */
const sendSteps = (steps: readonly AdvanceValue[]): AdvanceValue[] => steps.filter(step => step.next !== null
  && step.next.kind === 'perform' && step.next.operation.kind === 'send_system_round');

/** G's `goal_cause` cards whose key `code` is `no_adviser` (read as `PL-38-no-adviser-deviation.test.ts:117`). */
const noAdviserCards = (cards: readonly DecisionCardV1[]): DecisionCardV1[] => cards.filter(card => {
  if (card.source.kind !== 'goal_cause') return false;
  try { return (JSON.parse(card.source.key) as { code?: unknown }).code === 'no_adviser'; } catch { return false; }
});

/*
 * Named mutation (v4 :8857): "Copy to the creator instead of the responsible line" -> in C0 the round goes to A:
 * B's `action_request` list (`[rid]`) and A's whole-inbox `toEqual` (one `notify`) turn red; C1, C4 and C5 turn red
 * the same way (the creator is live); C3 and C6 stay green (the creator is null there).
 * Each cell's own break (brief `:42–:49`), and the sentence it turns red:
 * - C0: the copy sent as an `action_request` -> A's whole-inbox `toEqual` (intent `notify`).
 * - C1: the reuse rewrites the creator to B -> B is recipient and creator, the copy is null: A's `toEqual` red (the
 *   prior's "E's holder `creator` is still A" turns red first).
 * - C3: the resolver reads `lapsed` as A -> A gets a `notify`: A's `notifies` `toEqual([])` red.
 * - C4: the creator still read as lapsed after the re-enable -> A gets nothing: A's `toEqual` red.
 * - C5: the resolver reads the raw `creator` (A), not the derived contact (A′) -> the copy goes to the archived A
 *   (an archived line still receives): A′'s `toEqual` and A's `notifies` `toEqual([])` red.
 * - C6: the person arm falls back to a workspace adviser or the secretary -> the opening adviser gets the round: the
 *   `send_system_round` steps `toEqual([])` and the opening adviser's `withFirstLine` `toEqual([])` red; the
 *   `no_adviser` cause still read from the workspace's advisers -> no card: the card wait times out.
 */
it.each<{ cell: Cell; steps: string }>([
  { cell: 'C0', steps: '(1)(2) B answers the round, A gets one notify copy, a replay adds nothing' },
  { cell: 'C1', steps: '(6) E reused by B: the creator stays A' },
  { cell: 'C3', steps: '(4) A archived without a handoff: lapsed, no copy' },
  { cell: 'C4', steps: '(5) A reactivated: the copy is A\'s again' },
  { cell: 'C5', steps: '(3) A handed off in full: the copy goes to A\'s successor' },
  { cell: 'C6', steps: '(7)(8) no responsible line, no live creator: nothing sent, one no_adviser card' },
])('RL-19 $cell (memory): $steps', async ({ cell }) => {
  const p = await openPrior(cell !== 'C6');
  const { handle, a, b, m } = p;
  const g = handle.goal;
  const rid = `deviation:${g.goalId}:${m.taskId}:stop:1`;
  const copyText = `请知悉（抄送，不需要回复）：任务 ${m.taskId} 的偏差已发给负责的参谋（${rid}）。`;
  const copyTo = await cellPrior(cell, p);
  const lp = handle.lines.adviser;

  const steps = await report(p, cell);
  if (b === null) {
    expect(sendSteps(steps)).toEqual([]);
  } else {
    // Bounded: the round is on some adviser's inbox (any recipient, so a wrong one reds below, not here).
    const advisers = [lp.ref, a.ref, b.ref, ...(copyTo === null ? [] : [copyTo])];
    const rounds = async (): Promise<number> => {
      let found = 0;
      for (const line of advisers) found += withFirstLine(await receivedBy(handle, line), rid).length;
      return found;
    };
    await waitFor(rounds, found => found > 0, `the round ${rid} on an adviser`);
    const bInbox = await receivedBy(handle, b);
    expect(actionRequests(bInbox).map(item => firstLine(item.text))).toEqual([rid]);
    expect(actionRequests(bInbox)[0]!.message).toMatchObject({ needsReply: true, goalRef: g });
    expect(notifies(bInbox)).toEqual([]);
  }

  const copy = { intent: 'notify', goalRef: g, text: copyText };
  const shape = (items: readonly Received[]) =>
    items.map(item => ({ intent: item.message.intent, goalRef: item.message.goalRef, text: item.text }));
  if (copyTo !== null) expect(shape(await receivedBy(handle, copyTo))).toEqual([copy]);
  if (copyTo === null || copyTo.sessionId !== a.ref.sessionId) {
    expect(notifies(await receivedBy(handle, a))).toEqual([]);
  }

  if (cell === 'C0') {
    expect(withFirstLine(await receivedBy(handle, lp), rid)).toEqual([]);
    // The replay: one more goal-level drive adds no message to A or B.
    const before = { a: await receivedBy(handle, a), b: await receivedBy(handle, b!) };
    await driveWorkflow(handle.world.ag2b, { schemaVersion: 1, goalRef: g, flowId: 'rl19-c0-replay',
      sessionHint: null, kind: 'select_work' });
    expect({ a: await receivedBy(handle, a), b: await receivedBy(handle, b!) }).toEqual(before);
  }

  if (cell === 'C6') {
    // v4 :8857 "writes zero messages": no opening line and not A has the round; no adviser has a notify.
    for (const line of [lp, a]) {
      const items = await receivedBy(handle, line);
      expect(withFirstLine(items, rid)).toEqual([]);
      expect(notifies(items)).toEqual([]);
    }
    for (const line of [handle.lines.secretary, handle.lines.scribe]) {
      expect(withFirstLine(await receivedBy(handle, line), rid)).toEqual([]);
    }
    expect(await goalLines(handle)).toEqual([]);
    const cards = await waitFor(() => handle.main.readCards(g), found => noAdviserCards(found).length > 0,
      'the no_adviser card of G');
    expect(noAdviserCards(cards)).toHaveLength(1);
  }
}, 300_000);
