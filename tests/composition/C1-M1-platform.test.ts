/** Composition contracts. Only Project/Workspace/governance are raw fixture seeds;
 * Goal/Plan/Session/claims, bodies and messages use their real producers.
 * Missing public wiring fails an explicit surface assertion, never a fake port. */
import { afterEach, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTargetPlatform, type TargetPlatformOptions } from '../../src/composition/create-platform.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionMailboxPort } from '../../src/core/work-graph/communication/contracts.js';
import type { MaterialPort } from '../../src/core/work-graph/materials/contracts.js';
import { createTaskClaimFixture, CLAIM_FIXTURE_AT } from '../helpers/task-claim-fixture.js';

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
// Future public shape only: actual properties/methods are asserted before use.
type ConsumerPlatform = Platform & { messages: SessionMailboxPort; materials: MaterialPort };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

async function openFixture(beforeAuthorize?: () => Promise<void>) {
  const f = await createTaskClaimFixture('sqlite');
  cleanups.push(() => f.close());
  await mkdir(join(f.directory, 'src'));
  await writeFile(join(f.directory, 'src/input.txt'), 'selected source version one');
  await f.closeBackend();
  const authorizations: CoreCallContext[] = [];
  const options: TargetPlatformOptions = {
    storage: { kind: 'sqlite', directory: f.directory }, now: () => CLAIM_FIXTURE_AT,
    kernelStores: { entries: [{ adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store',
      workspace: f.scope, databasePath: join(f.directory, 'kernel.sqlite') }] },
    workspace: {
      async resolveRoot(scope) {
        if (scope.projectId !== f.scope.projectId || scope.workspaceId !== f.scope.workspaceId)
          return { status: 'rejected', code: 'forbidden', reason: 'Unknown workspace' };
        return { status: 'ready', value: { root: f.directory, workspaceRevision: 1 } };
      },
      async authorize(ctx, scope) {
        // The composition-owned provider must bind the REAL scope to a trusted
        // Host, including a matching materialReader. No model root/pin. The
        // existing read resolver has no signal argument; do not invent one here.
        expect(ctx.signal).toBeInstanceOf(AbortSignal); expect(ctx.signal.aborted).toBe(false);
        expect(ctx.projectId).toBe(scope.projectId); expect(ctx.workspaceId).toBe(scope.workspaceId);
        expect(ctx.principal.kind).toBe('host'); expect(ctx.materialReader.kind).toBe('host');
        if (ctx.principal.kind !== 'host' || ctx.materialReader.kind !== 'host')
          return { status: 'rejected', code: 'forbidden', reason: 'Host source identity required' };
        expect(ctx.materialReader).toMatchObject({ projectId: f.scope.projectId, workspaceId: f.scope.workspaceId,
          actor: ctx.principal.actor });
        authorizations.push(ctx);
        await beforeAuthorize?.();
        return { status: 'ready', value: { subjectKey: `host:${ctx.principal.actor.kind}:${ctx.principal.actor.id}`,
          permissionRevision: 'c1-m1-platform-read@1', allowsRead: path => path === 'src/input.txt' } };
      },
    },
  };
  let platform = await createTargetPlatform(options) as ConsumerPlatform;
  cleanups.push(() => platform.close());
  return { f, authorizations, get platform() { return platform; },
    async reopen() { await platform.close(); platform = await createTargetPlatform(options) as ConsumerPlatform; } };
}

it('C1: platform-created Session receives Host mail, then SQLite reopen retains the body and original send receipt', async () => {
  const t = await openFixture(); const { f } = t;
  const created = await t.platform.runtime.createSession(f.ctx, { workspace: f.scope,
    role: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' }, recommendedRefs: [], initialLinks: [],
    meta: { requestId: 'platform-mail-session', expected: [] } });
  expect(created.status, JSON.stringify(created)).toBe('completed');
  if (created.status !== 'completed') throw Error('Real Kernel Session creation failed');
  const recipient = { projectId: f.scope.projectId, sessionId: created.value.ref.sessionId };
  const before = await t.platform.sessions.readSession(f.ctx, recipient);
  expect(t.platform.messages, 'composition must publish the real SessionMailboxPort').toBeDefined();
  expect(t.platform.messages.sendMessage).toBeTypeOf('function');
  expect(t.platform.messages.readMessageBody).toBeTypeOf('function');
  const request = { meta: { requestId: 'platform-mail-send', expected: [] },
    input: { recipient, text: 'Durable Host message through the composition root' } };
  const sent = await t.platform.messages.sendMessage(f.ctx, request);
  expect(sent).toMatchObject({ status: 'committed', replayed: false, value: { recipient, status: 'pending',
    sender: f.ctx.principal, readAt: null, response: null } });
  if (sent.status !== 'committed') throw Error('Real mailbox send failed');
  const bodyRequest = { messageRef: sent.value.ref, part: 'message' as const };
  await expect(t.platform.messages.readMessageBody(f.ctx, bodyRequest)).resolves.toMatchObject({ status: 'ready',
    value: { text: request.input.text, usage: 'message', messageRef: sent.value.ref } });
  expect(await t.platform.sessions.readSession(f.ctx, recipient)).toEqual(before);
  await t.reopen();
  expect(t.platform.messages).toBeDefined();
  await expect(t.platform.messages.sendMessage(f.ctx, request)).resolves.toEqual({ ...sent, replayed: true });
  await expect(t.platform.messages.readMessageBody(f.ctx, bodyRequest)).resolves.toMatchObject({ status: 'ready',
    value: { text: request.input.text, usage: 'message' } });
  const inbox = await t.platform.messages.readInbox(f.ctx, { recipient, page: { limit: 10 } });
  expect(inbox).toMatchObject({ status: 'ready', value: { items: [sent.value], nextCursor: null } });
  expect(await t.platform.sessions.readSession(f.ctx, recipient)).toEqual(before);
});
