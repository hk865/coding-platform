/**
 * AG1 Stage 1 consumer skeleton (frozen for the implementation phase).
 *
 * Every fact is produced by the formal writers over the real C2
 * runtime-platform fixture (real SQLite ledger, Kernel Session, installed
 * RoleSpec, accepted Plan and claim). The Runtime performs
 * send_session_message to the task-linked Session; `look_graph` covers the
 * removed discovery reads.
 */
import { afterEach, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, SessionWorkLinkRef, WorkLinkRelation, WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import { createC2RuntimePlatform, type C2RuntimePlatformFixture } from '../helpers/C2-runtime-platform-fixture.js';

const fixtures: C2RuntimePlatformFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });
const signal = () => new AbortController().signal;

/** A real `linkSessionWork` writer call: one Session joins an existing
 * accepted-Plan Task. The formal target is returned so the scripted provider
 * uses the same value the directory was asked to index. */
async function linkSessionToTask(
  fx: C2RuntimePlatformFixture, session: SessionRef, relation: WorkLinkRelation, requestId: string,
): Promise<WorkLinkTarget> {
  const target: WorkLinkTarget = { kind: 'task', ref: fx.fixture.tasks.first };
  const card = await fx.platform.sessions.readSession(fx.ctx, session);
  if (card.status !== 'ready') throw Error(`AG1 Session card unavailable: ${JSON.stringify(card)}`);
  const linkRef: SessionWorkLinkRef = { ...session, aggregateType: 'SessionWorkLink', target, relation };
  const linked = await fx.platform.sessions.linkSessionWork(fx.ctx, { meta: { requestId, expected: [
    { ref: card.value.record.ref, revision: card.value.record.revision }, { ref: linkRef, revision: 0 } ] },
    input: { sessionRef: session, target, relation, active: true } });
  expect(linked, JSON.stringify(linked)).toMatchObject({ status: 'committed' });
  return target;
}

it('sends a consultation to the task-linked Session', async () => {
  const consultation = 'AG1 consultation: who owns the implement-a shared reader?';
  let consultant: SessionRef | undefined;
  const replies: ScriptedReply[] = [
    { kind: 'calls', calls: [{ callId: 'ag1-send', name: 'send_session_message', args: { recipient: {}, text: consultation } }] },
    { kind: 'text', text: 'AG1 consulted the related Session' },
  ];
  const fx = await createC2RuntimePlatform({
    toolNames: ['send_session_message'],
    scriptedReplies: replies,
    beforeReply: async (request, index) => {
      if (index === 0 && consultant !== undefined) {
        const args = replies[0]?.kind === 'calls' ? replies[0].calls[0]?.args : undefined;
        if (args !== undefined) args['recipient'] = { ...consultant };
      }
    },
  });
  fixtures.push(fx);
  consultant = fx.secondSession;
  await linkSessionToTask(fx, fx.secondSession, 'participates', 'ag1-link-consultant');

  const prepared = await fx.platform.runtime.prepareExecution(fx.ctx, { runRef: fx.runRef, requestId: 'ag1-prepare-discovery' });
  expect(prepared.status, JSON.stringify(prepared)).toBe('ready');
  if (prepared.status !== 'ready') return;
  const started = await fx.platform.runtime.startRun(fx.ctx, { prepared: prepared.value, consumerId: 'ag1-driver', requestId: 'ag1-start-discovery' });
  // The entered Run performs the consultation through the unified send tool.
  expect(started, JSON.stringify(started)).toMatchObject({ status: 'ready', value: { run: { status: 'ended' }, session: { occupancy: null } } });

  // The send issued no extra model call; it landed in the real inbox.
  expect(fx.scripted.calls()).toBe(2);
  const inbox = await fx.platform.messages.readInbox(fx.ctx, { recipient: fx.secondSession, page: { limit: 10 } });
  expect(inbox).toMatchObject({ status: 'ready', value: { items: [{ recipient: fx.secondSession, status: 'pending' }] } });
  if (inbox.status === 'ready') {
    const message = inbox.value.items[0]!;
    expect(await fx.platform.messages.readMessageBody(fx.ctx, { messageRef: message.ref, part: 'message' }))
      .toMatchObject({ status: 'ready', value: { text: consultation, usage: 'message' } });
  }
  // Consultation is durable mail, not a wake-up: the recipient stays standby.
  expect(await fx.platform.sessions.readSession(fx.ctx, fx.secondSession))
    .toMatchObject({ status: 'ready', value: { availability: 'idle', record: { lifecycle: 'active', occupancy: null } } });
  // A platform discovery read never resolves the workspace source policy.
  expect(fx.authorizeCalls()).toBe(0);
});

it('binds directory reads to the real Run workspace and keeps writes Host-only', async () => {
  const fx = await createC2RuntimePlatform();
  fixtures.push(fx);
  const target = await linkSessionToTask(fx, fx.secondSession, 'participates', 'ag1-boundary-link-second');
  await linkSessionToTask(fx, fx.firstSession, 'investigated', 'ag1-boundary-link-first');
  const execution = await fx.platform.executions.readExecution(fx.ctx, fx.runRef);
  if (execution.status !== 'ready') throw Error('AG1 formal Run unavailable');
  const ctx: CoreCallContext = { projectId: fx.scope.projectId, workspaceId: fx.scope.workspaceId,
    principal: { kind: 'work_run', runRef: fx.runRef, roleBinding: execution.value.run.roleBinding },
    materialReader: { kind: 'run', requester: fx.runRef }, signal: signal() };
  const request = { workspace: fx.scope, target, includeArchived: false, page: { limit: 1 } };
  const found = await fx.platform.sessions.findSessions(ctx, request);
  expect(found, JSON.stringify(found)).toMatchObject({ status: 'ready' });
  if (found.status !== 'ready') return;
  expect(found.value.items).toHaveLength(1);
  expect(typeof found.value.nextCursor).toBe('string');
  if (found.value.nextCursor === null) throw Error('AG1 expected another linked Session');
  expect(await fx.platform.sessions.readSession(ctx, fx.secondSession)).toMatchObject({ status: 'ready' });
  // A real Run in A cannot declare workspace B, even if the requested record is in A.
  expect(await fx.platform.sessions.readSession({ ...ctx, workspaceId: 'ag1-other-workspace' }, fx.secondSession))
    .toMatchObject({ status: 'rejected', code: 'forbidden' });
  expect(await fx.platform.sessions.findSessions(fx.ctx, {
    ...request, page: { limit: 1, cursor: found.value.nextCursor },
  })).toMatchObject({ status: 'rejected', code: 'invalid' });
  expect(await fx.platform.sessions.linkSessionWork(ctx, { meta: { requestId: 'ag1-work-link', expected: [] },
    input: { sessionRef: fx.secondSession, target, relation: 'responsible', active: true } }))
    .toMatchObject({ status: 'rejected', code: 'forbidden' });
});
