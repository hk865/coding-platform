/**
 * XWR-0 owner rows: the consume-view rules the acceptance rows R0-1..R0-5 do not cover.
 * - O-1: a joined workspace's exploration Query that occupies the main workspace's adviser is that line's
 *   `busy: 'query'`; the main workspace's page stays ready (the view's own QueryRun read is project-scoped).
 * - O-2: a line whose facts cannot be read is skipped whole with its reason, and the Host's consume status records it
 *   `unreadable`; the other lines of the page are still served.
 * - O-4: the same when one line's read throws instead of returning a failure (`unavailable`).
 * - O-5: a skipped line uses no page quota: with `limit: 1` the walk goes past it to the next idle line.
 *   Named mutation: the skip branch also counts `candidates += 1` → the page ends right after the skip, red.
 * - O-3: a main-workspace line holding a message about the joined workspace's Task reads that Task's block in the
 *   Goal's workspace, so the line is offered, not skipped.
 * Memory only: no row is about storage (tests/RULES.md S3).
 */
import { afterEach, expect, it, vi } from 'vitest';
import { canonicalKey } from '../../src/contracts/fingerprint.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { sessionMessageRefKey } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { plainSessionRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { heartbeatUntil, readPlanningQuery } from '../helpers/IV-host-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { openS7D2RoleLineWorld } from '../helpers/S7D2-role-line-world.js';
import { adoptSecondPlan, openXWS2AWorld } from '../helpers/XWS2A-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  commitBarrier.reset();
  await Promise.allSettled(closers.splice(0).map(close => close()));
});

const mainPage = (host: S6AHostWorld) => host.platform.consumableSessions.readConsumableSessions(host.systemContext(),
  { workspace: S6A_SCOPE, after: null, limit: 50 });

/** A new main-workspace secretary line with one person action_request; `extra` adds the message's Goal/Task. */
async function lineWithMessage(host: S6AHostWorld, label: string, extra: { goalRef: GoalRef; taskRef?: unknown }):
  Promise<{ line: S6ASession; sent: SessionMessage }> {
  const line = await host.createSecretary(label);
  const sent = valueOf<SessionMessage>((await host.post('messages/send', graphWrite(S6A_SCOPE, {
    recipient: line.ref, text: `${label}: please plan this`, intent: 'action_request', needsReply: true, ...extra,
  }, `${label}-person`))).body, 'committed', `the ${label} person message`);
  await host.scripted.script(line, [{ kind: 'text', text: `${label} answer` }]);
  return { line, sent };
}

it('O-1 the join exploration Query on the main adviser is busy query, and the main page stays ready', async () => {
  // A3 gate: the claim of the join's exploration round (a QueryRun outside the main workspace) is held after it lands.
  const claim = commitBarrier.holdAfter(commit => commit.records.some(record => {
    const value = JSON.parse(record.json) as { ref?: { aggregateType?: string; workspaceId?: string };
      run?: { executionState?: { phase?: string } } };
    return value.ref?.aggregateType === 'QueryRun' && value.ref.workspaceId !== S6A_SCOPE.workspaceId
      && value.run?.executionState?.phase === 'claimed';
  }), 'XWR0 O-1: the join exploration claim');
  const world = await openXWS2AWorld({ backend: 'memory' });
  closers.push(() => world.close());
  await claim.reached;
  const page = await mainPage(world.base.world);
  claim.release();
  expect(page.status).toBe('ready');
  if (page.status !== 'ready') return;
  expect(page.value.items.find(item => item.session.sessionId === world.adviser.ref.sessionId)?.busy).toBe('query');
  expect(page.value.skipped).toEqual([]);
}, 120_000);

it('O-2 an unreadable line is skipped with its reason, the Host records it unreadable and serves the others', async () => {
  const base = await openS7D2RoleLineWorld({ backend: 'memory', extraHostOptions: { scribeReminderPeriodMs: 25 } });
  closers.push(() => base.close());
  const host = base.world;
  const unreadable = await lineWithMessage(host, 'xwr0-o2-unreadable', { goalRef: host.goals.first });
  const served = await lineWithMessage(host, 'xwr0-o2-served', { goalRef: host.goals.first });
  // A2: every store read of the first line's message fails, so only that line's facts cannot be read.
  commitBarrier.failReads(sessionMessageRefKey(unreadable.sent.ref), 'throw-always');
  const query = await heartbeatUntil(host, () => readPlanningQuery(host, served.sent.ref), found => found !== null, 10);
  expect(query).not.toBeNull();
  const page = await mainPage(host);
  expect(page.status).toBe('ready');
  if (page.status !== 'ready') return;
  expect(page.value.skipped.map(entry => ({ session: entry.session, code: entry.code })))
    .toEqual([{ session: unreadable.line.ref, code: 'unavailable' }]);
  expect(page.value.items.some(item => item.session.sessionId === unreadable.line.ref.sessionId)).toBe(false);
  expect(host.host.consumeStatus).toContainEqual({ sessionRef: unreadable.line.ref, reason: 'unreadable' });
}, 120_000);

it('O-4 a line whose read throws is skipped as unavailable; the other line is still served', async () => {
  const base = await openS7D2RoleLineWorld({ backend: 'memory', extraHostOptions: { scribeReminderPeriodMs: 25 } });
  closers.push(() => base.close());
  const host = base.world;
  const throwing = await lineWithMessage(host, 'xwr0-o4-throwing', { goalRef: host.goals.second });
  const served = await lineWithMessage(host, 'xwr0-o4-served', { goalRef: host.goals.first });
  // A2: every store read of the second Goal throws; the Goal read does not map a thrown read into a result.
  commitBarrier.failReads(canonicalKey(host.goals.second), 'throw-always');
  expect(await heartbeatUntil(host, () => readPlanningQuery(host, served.sent.ref), found => found !== null, 10))
    .not.toBeNull();
  const page = await mainPage(host);
  expect(page.status === 'ready' ? page.value.skipped.map(entry => ({ session: entry.session, code: entry.code }))
    : page).toEqual([{ session: throwing.line.ref, code: 'unavailable' }]);
}, 120_000);

it('O-5 a skipped line uses no quota: with limit 1 the next idle line after it is still served', async () => {
  const base = await openS7D2RoleLineWorld({ backend: 'memory', extraHostOptions: { scribeReminderPeriodMs: 25 } });
  closers.push(() => base.close());
  const host = base.world;
  const lines = [await lineWithMessage(host, 'xwr0-o5-a', { goalRef: host.goals.first }),
    await lineWithMessage(host, 'xwr0-o5-b', { goalRef: host.goals.first })];
  const whole = await mainPage(host);
  if (whole.status !== 'ready') throw new Error(`XWR0 O-5: the whole page is ${JSON.stringify(whole)}`);
  // The unreadable line is the new line the walk meets first, so at least one idle line (the other) follows it.
  const order = whole.value.items;
  const at = order.findIndex(item => lines.some(entry => entry.line.ref.sessionId === item.session.sessionId));
  const unreadable = lines.find(entry => entry.line.ref.sessionId === order[at]!.session.sessionId)!;
  const firstIdle = order.findIndex((item, index) => index > at && item.busy === null);
  commitBarrier.failReads(sessionMessageRefKey(unreadable.sent.ref), 'throw-always');
  const page = await host.platform.consumableSessions.readConsumableSessions(host.systemContext(),
    { workspace: S6A_SCOPE, after: at === 0 ? null : plainSessionRefKey(order[at - 1]!.session), limit: 1 });
  expect(page.status === 'ready' ? { skipped: page.value.skipped.map(entry => entry.session),
    items: page.value.items.map(item => item.session) } : page)
    .toEqual({ skipped: [unreadable.line.ref], items: order.slice(at + 1, firstIdle + 1).map(item => item.session) });
}, 120_000);

it('O-3 a main line holding a message on the joined workspace Task is offered, its Task block read there', async () => {
  const world = await openXWS2AWorld({ backend: 'memory' });
  closers.push(() => world.close());
  const host = world.base.world;
  const goal = world.second.goal;
  const { taskId } = await adoptSecondPlan(host, world.second.workspace, goal, 'xwr0-o3');
  const { line, sent } = await lineWithMessage(host, 'xwr0-o3-line',
    { goalRef: goal, taskRef: { projectId: goal.projectId, goalId: goal.goalId, taskId } });
  const page = await mainPage(host);
  expect(page.status).toBe('ready');
  if (page.status !== 'ready') return;
  expect(page.value.skipped.filter(entry => entry.session.sessionId === line.ref.sessionId)).toEqual([]);
  expect(page.value.items.find(item => item.session.sessionId === line.ref.sessionId)?.nextMessage?.messageRef)
    .toEqual(sent.ref);
}, 120_000);
