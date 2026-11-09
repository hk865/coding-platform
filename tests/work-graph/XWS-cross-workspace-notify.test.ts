/**
 * XWS — multi-workspace message delivery, the mailbox layer (R1–R4).
 *
 * R1: a Host system `notify` whose recipient Session lives in ANOTHER
 * workspace of the same project is accepted, and the message record lives in
 * the RECIPIENT's workspace; the sender's workspace inbox never shows it.
 * R2: the replay identity stays the sender's (sender workspace + sender
 * identity + requestId): the same requestId replays one message, a changed
 * recipient is `idempotency_conflict`, and the message id is the sender
 * workspace's hash (hand-computed below, never `hostMessageId`).
 * R3: apart from the Host system `notify` and `action_request`, every
 * cross-workspace send is refused exactly as today.
 * R4 follows from R1 (the record's event lives with the record).
 *
 * XW-1 runs on memory and SQLite (S3: the recipient index and the receipt
 * replay); XW-2 also both (S3: the receipt identity); XW-3 and XW-4 are
 * business rows on memory. XW-5 (R7) is not proven here: the two-workspace
 * world configures no Runtime and no Workflow binding for the second
 * workspace (`tests/helpers/S6A-request-fixture.ts:946–:951`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import { systemRoundContext } from '../../src/contracts/plan-round.js';
import { decodeKernelEntry } from '../../src/core/agent-runtime/kernel-turn-facts.js';
import type { SessionHistoryEntry } from '../../src/core/agent-runtime/session-operations.js';
import type {
  SessionMessage, SessionMessageSendInputV1,
} from '../../src/core/work-graph/model/communication-contracts.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import {
  openS6ATwoWorkspaceWorld, S6A_SCOPE, S6A_SECOND_SCOPE, S6A_WORK_ROLE,
  type S6AExtraBinding, type S6ARequestWorld,
} from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { claimedRunOf, ready, S7A_REPLY_TOOLS } from '../helpers/S7A-fixture.js';

const P = S6A_SCOPE.projectId;
const A_WORKSPACE = S6A_SCOPE.workspaceId;
const B_WORKSPACE = S6A_SECOND_SCOPE.workspaceId;
/** The Host system-round identity, handwritten (F8): `SYSTEM_ROUND_ACTOR` is not imported. */
const HOST_SYSTEM = { kind: 'system', id: 'host:plan-round' } as const;
/** The world's human operator, handwritten (F8). */
const OPERATOR = { kind: 'human', id: 's6a-operator' } as const;

/**
 * The frozen Host message-id formula (`src/contracts/plan-round.ts:112–:127`'s
 * comment): sender workspace + Host actor + requestId. It names the id, not the
 * record's workspace, so the cross-workspace rows use it to name the message.
 */
const idOf = (actor: { kind: 'human' | 'system'; id: string }, requestId: string): string =>
  'session-message-' + sha256Hex(canonicalJson({
    projectId: P, workspaceId: B_WORKSPACE, sender: { kind: 'host', actor: { ...actor } }, requestId,
  } as never));

const worlds: S6ARequestWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

async function openWorld(backend: 'memory' | 'sqlite', extraBindings: readonly S6AExtraBinding[] = []) {
  const { world } = await openS6ATwoWorkspaceWorld({ backend,
    ...(extraBindings.length === 0 ? {} : { extraBindings }) });
  worlds.push(world);
  return { world, a: s6aCardsWorkspace(world, S6A_SCOPE), b: s6aCardsWorkspace(world, S6A_SECOND_SCOPE) };
}

/** The Host system-round context of the second workspace: the cross-workspace sender. */
const senderContext = () => systemRoundContext({ ...S6A_SECOND_SCOPE }, new AbortController().signal);

/** One Host system send from the second workspace, through the public mailbox owner. */
const systemSend = (world: S6ARequestWorld, requestId: string, input: SessionMessageSendInputV1['input']) =>
  world.platform.messages.sendMessage(senderContext(), { input, meta: { requestId, expected: [] } });

/** One workspace's inbox read; `S7B-F-support.inboxOf` is A-only (it hardcodes `S6A_SCOPE`), so this takes the
 * workspace the read runs in. */
async function inboxIn(ws: S6ACardsWorkspace, recipient: SessionRef): Promise<SessionMessage[]> {
  return ready<{ items: SessionMessage[] }>(await ws.route('messages/inbox', { recipient, page: { limit: 100 } }),
    `the inbox of ${recipient.sessionId} in ${ws.scope.workspaceId}`).items;
}

async function bodyOf(ws: S6ACardsWorkspace, message: SessionMessage['ref']): Promise<string> {
  return ready<{ text: string }>(await ws.route('messages/body', { messageRef: message, part: 'message' }),
    `the body of ${message.messageId}`).text;
}

describe.each(['memory', 'sqlite'] as const)('XWS cross-workspace delivery (%s)', (backend) => {
  it('XW-1 accepts a Host system notify into the recipient workspace, replays it as one message, and keeps it out of the sender inbox', async () => {
    /* Named mutation: the cross-workspace send writes its record under the sender workspace
       (`src/core/work-graph/communication/mailbox-send.ts:574–:576`, the SessionMessage ref the send
       commits) instead of the recipient's. Then `expect(aItems).toHaveLength(1)` goes red, the body
       read finds no message, and the sender-workspace inbox turns non-empty. */
    const { world, a, b } = await openWorld(backend);
    const lineA = await createS6BLine(a, { label: 'xws-line-a', role: S6A_WORK_ROLE });
    const text = 'XWS-1 跨工作区通知';
    const expectedRef = { aggregateType: 'SessionMessage', projectId: P, workspaceId: A_WORKSPACE,
      messageId: idOf(HOST_SYSTEM, 'xws-1') } as const;

    const first = await systemSend(world, 'xws-1', { recipient: lineA.ref, intent: 'notify', text });
    expect(first.status, `the first send: ${JSON.stringify(first)}`).toBe('committed');
    if (first.status !== 'committed') throw new Error(`XW-1: the first send was not committed: ${JSON.stringify(first)}`);
    expect(first.value.ref).toEqual(expectedRef);
    expect(first.value.revision).toBe(1);

    const second = await systemSend(world, 'xws-1', { recipient: lineA.ref, intent: 'notify', text });
    expect(second.status, `the replay: ${JSON.stringify(second)}`).toBe('committed');
    if (second.status !== 'committed') throw new Error(`XW-1: the replay was not committed: ${JSON.stringify(second)}`);
    expect(second.value.ref).toEqual(expectedRef);
    expect(second.value.revision).toBe(1);

    const aItems = (await inboxIn(a, lineA.ref)).filter(item => item.ref.messageId === expectedRef.messageId);
    expect(aItems).toHaveLength(1);
    expect(await bodyOf(a, expectedRef)).toBe(text);
    expect(await inboxIn(b, lineA.ref)).toEqual([]);
  });

  it('XW-2 keeps the replay identity on the sender when the recipient changes', async () => {
    /* Named mutation: key the send receipt by the recipient workspace
       (`src/core/work-graph/communication/mailbox-send.ts:350`, `identityKeyOf('send', …)`). The second
       send is then a new identity and commits into A, so `expect(second).toMatchObject(…)` goes red and
       the A inbox gains the message id. */
    const { world, a, b } = await openWorld(backend);
    const lineA = await createS6BLine(a, { label: 'xws-line-a', role: S6A_WORK_ROLE });
    const lineB = await createS6BLine(b, { label: 'xws-line-b', role: S6A_WORK_ROLE });
    const first = await systemSend(world, 'xws-2', { recipient: lineB.ref, intent: 'notify', text: 'XWS-2' });
    expect(first.status, `the first send: ${JSON.stringify(first)}`).toBe('committed');
    if (first.status !== 'committed') throw new Error(`XW-2: the first send was not committed: ${JSON.stringify(first)}`);
    expect(first.value.ref.workspaceId).toBe('s6a-second-workspace');

    const second = await systemSend(world, 'xws-2', { recipient: lineA.ref, intent: 'notify', text: 'XWS-2' });
    expect(second).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect((await inboxIn(a, lineA.ref)).map(item => item.ref.messageId))
      .not.toContain(idOf(HOST_SYSTEM, 'xws-2'));
  });
});

describe('XWS a Host system action_request crosses', () => {
  it('XW-3b delivers a Host system action_request into the recipient workspace', async () => {
    /* Named mutation: narrow the cross-workspace condition back to `notify` only
       (`src/core/work-graph/communication/mailbox-send.ts`, the recipient-scope refusal). The send is then
       refused `not_found`, so the committed assertion and the recipient-inbox row go red. */
    const { world, a } = await openWorld('memory');
    const lineA = await createS6BLine(a, { label: 'xws-line-a', role: S6A_WORK_ROLE });
    const messageId = idOf(HOST_SYSTEM, 'xws-3b');
    const sent = await systemSend(world, 'xws-3b', { recipient: lineA.ref, intent: 'action_request', text: 'XWS-3b' });
    expect(sent.status, `the send: ${JSON.stringify(sent)}`).toBe('committed');
    if (sent.status !== 'committed') throw new Error(`XW-3b: the send was not committed: ${JSON.stringify(sent)}`);
    expect((await inboxIn(a, lineA.ref)).map(item => item.ref.messageId)).toContain(messageId);
  });
});

type XW3Send = (world: S6ARequestWorld, b: S6ACardsWorkspace, lineA: SessionRef) => Promise<unknown>;
type XW3Case = { label: string; messageId: string; send: XW3Send };

const XW3_CASES: readonly XW3Case[] = [
  /* Named mutation a: relax the actor check so any Host send is admitted and only the intent is read
     (`src/core/work-graph/state/message-machine.ts:731–:734`, the recipient-scope refusal). The person's
     notify then commits into A, so the `toMatchObject(not_found)` and `not.toContain` assertions below
     go red. */
  { label: "a person's messages/send notify", messageId: idOf(OPERATOR, 'xws-3a'),
    send: async (_world, b, lineA) => b.post('messages/send', graphWrite(S6A_SECOND_SCOPE,
      { recipient: lineA, intent: 'notify', text: 'XWS-3a' }, 'xws-3a', [])) },
];

describe('XWS the refusals stay as they are', () => {
  it.each(XW3_CASES)('XW-3 refuses $label and writes nothing', async ({ messageId, send }) => {
    const { world, a, b } = await openWorld('memory');
    const lineA = await createS6BLine(a, { label: 'xws-line-a', role: S6A_WORK_ROLE });
    expect(await send(world, b, lineA.ref)).toMatchObject({ status: 'rejected', code: 'not_found',
      reason: 'the requested record does not exist' });
    for (const ws of [a, b]) {
      expect((await inboxIn(ws, lineA.ref)).map(item => item.ref.messageId)).not.toContain(messageId);
    }
  });

  it('XW-4 refuses an Agent Work Run notify into another workspace', async () => {
    /* Named mutation: relax the sender check so a work_run notify is admitted across workspaces
       (`message-machine.ts:731–:734`). The tool's JSON part is then a committed message, so the
       `toMatchObject({ status: 'rejected', … })` assertion goes red. */
    const { world, a, b } = await openWorld('memory',
      [S7A_REPLY_TOOLS, { ...S7A_REPLY_TOOLS, mergeTools: ['send_session_message'] }]);
    const lineB = await createS6BLine(b, { label: 'xws-line-b', role: S6A_WORK_ROLE });
    await governS6B(world, a, world.goals);
    const { tasks } = await adoptS6BPlan(a, world.goals.first, { label: 'xws-4',
      taskIds: ['xws-4-task'], role: S6A_WORK_ROLE.templateId });
    const lineA = await createS6BLine(a, { label: 'xws-line-a', role: S6A_WORK_ROLE, tasks });
    world.scriptReplies([
      { kind: 'calls', calls: [{ callId: 'xws-4-send', name: 'send_session_message',
        args: { recipient: lineB.ref, intent: 'notify', text: 'XWS-4' } }] },
      { kind: 'text', text: 'XWS-4 answered' },
    ]);
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: world.goals.first, flowId: 'xws-4',
      sessionHint: lineA.ref, kind: 'select_work', taskId: tasks[0]!.taskId }, { receipts });
    const { run } = claimedRunOf(receipts, 'the XWS-4 sender');

    const history = ready<{ items: SessionHistoryEntry[] }>(
      await a.route('executions/history', { runRef: run, limit: 200 }), 'the XWS-4 execution history');
    let output: Record<string, unknown> | undefined;
    for (const entry of history.items) {
      const decoded = decodeKernelEntry(entry);
      if (decoded === null || decoded.record.recordType !== 'agent.event') continue;
      const event = decoded.record.payload.event;
      if (event.type !== 'tool.completed' && event.type !== 'tool.failed' && event.type !== 'tool.cancelled') continue;
      if (event.payload.callId !== 'xws-4-send') continue;
      output = event.payload.result.output.find(part => part.kind === 'json')?.value as
        Record<string, unknown> | undefined;
    }
    expect(output).toMatchObject({ status: 'rejected', code: 'not_found',
      reason: 'the requested record does not exist' });
    for (const ws of [a, b]) {
      const texts: string[] = [];
      for (const item of await inboxIn(ws, lineB.ref)) texts.push(await bodyOf(ws, item.ref));
      expect(texts).not.toContain('XWS-4');
    }
  });
});
