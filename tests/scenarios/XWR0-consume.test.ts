/**
 * XWR-0 acceptance rows R0-1…R0-5 (lead rulings 11-12 "XWR-0 开工"; spec draft §4). "Dispatched" = the message's
 * intervention Query reads through `queries/read`. Assumed shape: a `skipped` entry is matched on `session.sessionId`
 * and `code` (the failed read's code) only. One A2 wrapper on the view's real inbox read: an armed line reads
 * `unavailable` (R0-1's adviser stays unreadable after the fix); a read on the armed signal aborts that signal first,
 * so R0-4's cancellation comes from a real read in the middle of the walk.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { ConsumableSessionsDependencies } from '../../src/core/work-graph/views/consumable-sessions.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { heartbeatUntil, readPlanningQuery } from '../helpers/IV-host-fixture.js';
import type { S6ACardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { openS7D2ColdStartWorld } from '../helpers/S7D2-coldstart-world.js';
import { openS7D2RoleLineWorld } from '../helpers/S7D2-role-line-world.js';
import { openXWS2AWorld } from '../helpers/XWS2A-world.js';

const armed = vi.hoisted(() => ({ unreadable: new Set<string>(), abort: null as AbortController | null }));
vi.mock('../../src/core/work-graph/views/consumable-sessions.js', async importOriginal => {
  const real = await importOriginal<typeof import('../../src/core/work-graph/views/consumable-sessions.js')>();
  return { ...real, createConsumableSessions: (deps: ConsumableSessionsDependencies) => real.createConsumableSessions({
    ...deps, messages: { readMessage: (...args) => deps.messages.readMessage(...args),
      readOutbox: (...args) => deps.messages.readOutbox!(...args), async readInbox(ctx, input) {
        if (ctx.signal === armed.abort?.signal) armed.abort?.abort();
        if (!armed.unreadable.has(input.recipient.sessionId)) return await deps.messages.readInbox(ctx, input);
        return { status: 'rejected', code: 'unavailable', reason: 'XWR0: the inbox is unreadable' };
      } } }) };
});
vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  armed.unreadable.clear(); armed.abort = null; commitBarrier.reset();
  await Promise.allSettled(closers.splice(0).map(close => close()));
});
async function opened<W extends { close(): Promise<void> }>(opening: Promise<W>): Promise<W> {
  const world = await opening; closers.push(() => world.close()); return world;
}
const fast = { backend: 'memory' as const, extraHostOptions: { scribeReminderPeriodMs: 25 } };
const joined = async () => { const world = await opened(openXWS2AWorld(fast)); await world.waitCoarseAnswered(); return world; };
const page = (host: S6AHostWorld, ctx = host.systemContext()) =>
  host.platform.consumableSessions.readConsumableSessions(ctx, { workspace: S6A_SCOPE, after: null, limit: 50 });
const readyPage = async (host: S6AHostWorld) => {
  const read = await page(host);
  if (read.status !== 'ready') throw new Error(`XWR0: the page is not ready: ${JSON.stringify(read)}`);
  return read.value;
};
const send = async (host: S6AHostWorld, recipient: SessionRef, label: string): Promise<SessionMessageRef> =>
  valueOf<SessionMessage>((await host.post('messages/send', graphWrite(S6A_SCOPE, { recipient, text: `${label}: plan this`,
    intent: 'action_request', needsReply: true, goalRef: host.goals.first }, label))).body, 'committed', label).ref;
const dispatched = async (host: S6AHostWorld, ref: SessionMessageRef, passes: number): Promise<boolean> =>
  (await heartbeatUntil(host, () => readPlanningQuery(host, ref), query => query !== null, passes)) !== null;
async function refineRound(ws: S6ACardsWorkspace, goal: GoalRef, label: string): Promise<SessionRef | null> {
  const draft = { schemaVersion: 2, planId: label, planRevision: 1, goalId: goal.goalId, stages: [], tasks: [{
    taskId: label, title: label, requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
    scope: { kind: 'goal' }, executionIntent: 'plan_only', sizeClass: 'small' }], assignments: [], obligations: [],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [] };
  const proposed = valueOf<{ ref: unknown; revision: number }>(await ws.post('plans/propose', graphWrite(ws.scope,
    { goalRef: goal, basedOn: null, draft, reason: { text: label, sources: [] } }, `${label}-propose`)), 'committed', label);
  valueOf(await ws.post('plans/apply', graphWrite(ws.scope, { proposalRef: proposed.ref,
    expectedProposalRevision: proposed.revision, decisionRefs: [] }, `${label}-apply`)), 'committed', label);
  let input: WorkflowAdvanceInput = { schemaVersion: 1, goalRef: goal, flowId: label, sessionHint: null, kind: 'select_work' };
  let recipient: SessionRef | null = null;
  for (let step = 0; step < 8; step += 1) {
    const result = await ws.route('workflow/advance', input) as WorkflowAdvanceResult;
    if (result.status !== 'ready' || result.value.next === null) break;
    input = result.value.next;
    if (input.kind === 'perform' && (input.operation.kind as string) === 'send_system_round') {
      recipient = (input.operation as unknown as { request: { recipient: SessionRef } }).request.recipient;
    }
  }
  return recipient;
}

// R0-1 · mutation: a non-cancelled line read fails the whole page again (isolation removed) · red today: the other line's message is never dispatched.
it('R0-1 an unreadable main adviser no longer stops the other main lines; it shows only in skipped', async () => {
  const world = await joined();
  const host = world.base.world;
  armed.unreadable.add(world.adviser.ref.sessionId);
  const secretary = await host.createSecretary('r01-secretary');
  expect(await dispatched(host, await send(host, secretary.ref, 'r01-person'), 10)).toBe(true);
  const read = await readyPage(host);
  expect(read.items.map(item => item.session.sessionId)).not.toContain(world.adviser.ref.sessionId);
  expect(read.skipped).toContainEqual(expect.objectContaining({ code: 'unavailable',
    session: expect.objectContaining({ sessionId: world.adviser.ref.sessionId }) }));
}, 180_000);

// R0-2 · mutation: the delivery facts read the recipient's last QueryRun (workflow.ts:1418) or the message Goal (:1387) without the project scope · red today: the person's message to the adviser is never dispatched.
it('R0-2 the main adviser holding a second-workspace round and Query is consumed again', async () => {
  const world = await joined();
  const host = world.base.world;
  expect((await refineRound(world.second.workspace, world.second.goal, 'r02-round'))?.sessionId)
    .toBe(world.adviser.ref.sessionId);
  expect(await dispatched(host, await send(host, world.adviser.ref, 'r02-person'), 10)).toBe(true);
  expect((await readyPage(host)).skipped.map(entry => entry.session.sessionId)).not.toContain(world.adviser.ref.sessionId);
}, 180_000);

// R0-3 · mutation: the delivery facts read the recipient's last Run (workflow.ts:1410) without the project scope · red today: the person's message to the adviser is never dispatched.
it('R0-3 the main adviser whose last execution is a second-workspace Run is consumed again', async () => {
  const world = await joined();
  await world.workRun({ label: 'r03', replies: [{ kind: 'text', text: 'R0-3 Run done' }] });
  expect(await dispatched(world.base.world, await send(world.base.world, world.adviser.ref, 'r03-person'), 10)).toBe(true);
}, 180_000);

// R0-4 · mutation: a cancelled line read goes into skipped too · guard, green today: the page answers the cancellation whole.
it('R0-4 a page read cancelled in the middle of its walk is answered cancelled, not degraded', async () => {
  const host = (await opened(openS7D2RoleLineWorld({ backend: 'memory' }))).world;
  await send(host, (await host.createSecretary('r04-secretary')).ref, 'r04-person');
  armed.abort = new AbortController();
  expect(await page(host, { ...host.systemContext(), signal: armed.abort.signal }))
    .toMatchObject({ status: 'rejected', code: 'cancelled' });
}, 180_000);

// R0-5 · mutation: the exploration's please-act is left pending when its round ends (settle removed) · red today: the please-act is still pending.
it('R0-5 after the cold start the exploration please-act is settled and a later refine round on that line is dispatched', async () => {
  const cold = await opened(openS7D2ColdStartWorld(fast));
  await cold.walkToCompleted();
  const goal = (await cold.main.createGoal('r05-goal', 'R0-5 goal')).ref;
  const inbox = await listed(cold.host, 'inbox', { ref: (await refineRound(cold.main, goal, 'r05-round'))! } as S6ASession);
  const pleaseActs = inbox.filter(message => message.sender.kind === 'host' && message.sender.actor.kind === 'system'
    && message.intent === 'action_request' && message.goalRef === null);
  expect(pleaseActs.length).toBeGreaterThan(0);
  expect(pleaseActs.filter(message => message.response === null && message.withdrawnAt === null)).toEqual([]);
  expect(await dispatched(cold.host, inbox.find(message => message.goalRef?.goalId === goal.goalId)!.ref, 6)).toBe(true);
}, 240_000);
