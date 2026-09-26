/** Composition contracts. Only Project/Workspace/governance are raw fixture seeds;
 * Goal/Plan/Session/claims, bodies, messages and grants use their real producers.
 * Missing public wiring fails an explicit surface assertion, never a fake port. */
import { afterEach, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTargetPlatform, type TargetPlatformOptions } from '../../src/composition/create-platform.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import type { SessionMailboxPort } from '../../src/core/work-graph/communication/contracts.js';
import type { MaterialGrantPort } from '../../src/core/work-graph/materials/grant-contracts.js';
import type { MaterialPort } from '../../src/core/work-graph/materials/contracts.js';
import { createTaskClaimFixture, CLAIM_FIXTURE_AT, type TaskClaimFixture } from '../helpers/task-claim-fixture.js';

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
// Future public shape only: actual properties/methods are asserted before use.
type ConsumerPlatform = Platform & { messages: SessionMailboxPort; materials: MaterialPort & MaterialGrantPort };
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

async function goalPin(platform: Platform, f: TaskClaimFixture) {
  const read = await platform.plans.queryGoal(f.ctx, f.goalRef);
  expect(read.status, JSON.stringify(read)).toBe('ready');
  if (read.status !== 'ready') throw Error('Goal unavailable');
  return { ref: f.goalRef, revision: read.value.goal.revision };
}

async function claim(platform: Platform, f: TaskClaimFixture, taskId: string,
  sessionRef: SessionRef, planRef: PlanRevisionRef, requestId: string) {
  const session = await platform.sessions.readSession(f.ctx, sessionRef);
  expect(session.status, JSON.stringify(session)).toBe('ready');
  if (session.status !== 'ready') throw Error('Session unavailable');
  const result = await platform.claims.claimTask(f.ctx, {
    meta: { requestId, expected: [await goalPin(platform, f), { ref: f.workspaceRef, revision: 1 },
      { ref: session.value.record.ref, revision: session.value.record.revision }] },
    input: { goalRef: f.goalRef, planRef, taskId, sessionRef, roleBinding: f.roleBinding, budget: f.budget },
  });
  expect(result.status, JSON.stringify(result)).toBe('committed');
  if (result.status !== 'committed') throw Error('Formal claim unavailable');
  return result.value;
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

it('M1: real producer/W1/consumer flow shares current source capture, and revoked grants stay denied after SQLite reopen', async () => {
  const t = await openFixture(); const { f } = t;
  const producer = await claim(t.platform, f, f.tasks.first.taskId, f.sessions.first, f.planRef, 'platform-material-producer');
  const producerCtx: CoreCallContext = { ...f.ctx,
    principal: { kind: 'work_run', runRef: producer.runRef, roleBinding: f.roleBinding },
    materialReader: { kind: 'run', requester: producer.runRef } };
  const stored = await t.platform.materials.storeArtifact(producerCtx, { body: 'Original producer material, retained exactly',
    contentType: 'text/plain', sources: [{ kind: 'workspace', refId: f.scope.workspaceId, revision: '1' }],
    origin: { kind: 'execution', ref: producer.runRef } });
  expect(stored.status, JSON.stringify(stored)).toBe('stored');
  if (stored.status !== 'stored') throw Error('Actual MaterialPort store failed');
  const p = f.plan;
  const draft: PlanRevisionDraft = { schemaVersion: 2, planId: 'platform-current-input', planRevision: p.planRevision + 1,
    goalId: f.goalRef.goalId, stages: structuredClone(p.stages), tasks: structuredClone(p.tasks),
    assignments: structuredClone(p.assignments ?? []), obligations: structuredClone(p.obligations),
    taskHierarchy: structuredClone(p.taskHierarchy), executionDag: structuredClone(p.executionDag), taskRelations: [],
    inputRequirements: [{ requirementId: 'producer-note', consumerTaskId: f.tasks.second.taskId, kind: 'artifact', artifactRef: stored.ref }] };
  const proposal = await t.platform.plans.proposePlan(f.ctx, {
    meta: { requestId: 'platform-material-proposal', expected: [await goalPin(t.platform, f)] },
    input: { goalRef: f.goalRef, basedOn: f.planRef, draft, reason: { text: 'Adopt the producer reference', sources: [] } },
  });
  expect(proposal.status, JSON.stringify(proposal)).toBe('committed');
  if (proposal.status !== 'committed') throw Error('Real W1 proposal failed');
  expect(proposal.value.issues).toEqual([]);
  const adopted = await t.platform.plans.applyPlanChange(f.ctx, {
    meta: { requestId: 'platform-material-adopt', expected: [await goalPin(t.platform, f)] },
    input: { proposalRef: proposal.value.ref, expectedProposalRevision: proposal.value.revision, decisionRefs: [] },
  });
  expect(adopted.status, JSON.stringify(adopted)).toBe('committed');
  if (adopted.status !== 'committed') throw Error('Real W1 adoption failed');
  const consumer = await claim(t.platform, f, f.tasks.second.taskId, f.sessions.second, adopted.value.ref, 'platform-material-consumer');
  const input = { goalRef: f.goalRef, planRef: adopted.value.ref, taskId: f.tasks.second.taskId, requirementId: 'producer-note' };
  const ungrantedCtx: CoreCallContext = { ...f.ctx,
    principal: { kind: 'work_run', runRef: consumer.runRef, roleBinding: f.roleBinding },
    materialReader: { kind: 'run', requester: consumer.runRef } };
  // W1 adoption records a reference; it cannot manufacture read authority.
  await expect(t.platform.plans.readTaskInput(ungrantedCtx, input)).resolves.toMatchObject({ status: 'rejected', code: 'forbidden' });
  expect(t.platform.materials.grantMaterialAccess, 'composition must publish the real grant writer').toBeTypeOf('function');
  expect(t.platform.materials.revokeMaterialAccess).toBeTypeOf('function');
  const granted = await t.platform.materials.grantMaterialAccess(f.ctx, {
    meta: { requestId: 'platform-material-grant', expected: [await goalPin(t.platform, f), { ref: f.workspaceRef, revision: 1 }] },
    input: { goalRef: f.goalRef, reader: consumer.runRef, materials: [stored.ref],
      sourceSet: { kind: 'workspace_paths', paths: ['src/input.txt'] }, purpose: 'Read the producer note for this adopted task' },
  });
  expect(granted).toMatchObject({ status: 'committed', replayed: false,
    value: { grant: { reader: consumer.runRef, materials: [stored.ref], basis: { planRef: adopted.value.ref, workspaceRevision: 1 } } } });
  if (granted.status !== 'committed') throw Error('Real grant writer failed');
  expect(granted.value.grant.basis.sourcePin).toBeDefined();
  expect(t.authorizations.length).toBeGreaterThan(0);
  const consumerCtx: CoreCallContext = { ...f.ctx,
    principal: { kind: 'work_run', runRef: consumer.runRef, roleBinding: f.roleBinding },
    materialReader: { kind: 'run', requester: consumer.runRef, currentBasis: granted.value.grant.basis } };
  const authorizationsBeforeRead = t.authorizations.length;
  await expect(t.platform.plans.readTaskInput(consumerCtx, input)).resolves.toMatchObject({ status: 'ready',
    value: { ref: stored.ref, body: 'Original producer material, retained exactly', ownerRunRef: producer.runRef, applicability: 'current' } });
  expect(t.authorizations.length).toBeGreaterThan(authorizationsBeforeRead);
  // The read resolver must share the live provider; a writer-only provider or a
  // cached grant digest would keep this newly changed file incorrectly current.
  await writeFile(join(f.directory, 'src/input.txt'), 'selected source changed after grant');
  await expect(t.platform.plans.readTaskInput(consumerCtx, input)).resolves.toMatchObject({ status: 'rejected', code: 'source_stale' });
  await writeFile(join(f.directory, 'src/input.txt'), 'selected source version one');
  await expect(t.platform.plans.readTaskInput(consumerCtx, input)).resolves.toMatchObject({ status: 'ready' });
  const revokeRequest = { meta: { requestId: 'platform-material-revoke', expected: [{ ref: granted.value.ref, revision: granted.value.revision }] },
    input: { grantRef: granted.value.ref, reason: 'Host withdraws this exact sharing grant' } };
  const revoked = await t.platform.materials.revokeMaterialAccess(f.ctx, revokeRequest);
  expect(revoked).toMatchObject({ status: 'committed', value: { revision: 2 } });
  if (revoked.status !== 'committed') throw Error('Real revoke writer failed');
  await expect(t.platform.plans.readTaskInput(consumerCtx, input)).resolves.toMatchObject({ status: 'rejected', code: 'forbidden' });
  await t.reopen();
  expect(t.platform.materials.revokeMaterialAccess).toBeTypeOf('function');
  await expect(t.platform.materials.revokeMaterialAccess(f.ctx, revokeRequest)).resolves.toEqual({ ...revoked, replayed: true });
  await expect(t.platform.plans.readTaskInput(consumerCtx, input)).resolves.toMatchObject({ status: 'rejected', code: 'forbidden' });
  await expect(t.platform.materials.openArtifact(f.ctx, { ref: stored.ref, usage: 'historical_explanation' }))
    .resolves.toMatchObject({ status: 'ready', value: { body: 'Original producer material, retained exactly', ownerRunRef: producer.runRef } });
  const execution = await t.platform.executions.readExecution(f.ctx, consumer.runRef);
  expect(execution).toMatchObject({ status: 'ready', value: { run: { status: 'starting', outcome: null } } });
});


it('M1: close drains a grant suspended in real source authorization and reopen recovers its committed receipt', async () => {
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let held = false;
  const t = await openFixture(async () => {
    if (!held) { held = true; enter(); await gate; }
  });
  const { f } = t;
  // The owner can also be a reader: this isolates the platform lifetime boundary
  // from W1 input selection, which the preceding composition test already covers.
  expect(t.platform.materials.grantMaterialAccess, 'composition must publish the real grant writer').toBeTypeOf('function');
  const producer = await claim(t.platform, f, f.tasks.first.taskId, f.sessions.first, f.planRef, 'platform-drain-producer');
  const producerCtx: CoreCallContext = { ...f.ctx,
    principal: { kind: 'work_run', runRef: producer.runRef, roleBinding: f.roleBinding },
    materialReader: { kind: 'run', requester: producer.runRef } };
  const stored = await t.platform.materials.storeArtifact(producerCtx, { body: 'Retain grant while platform closes',
    contentType: 'text/plain', sources: [{ kind: 'workspace', refId: f.scope.workspaceId, revision: '1' }],
    origin: { kind: 'execution', ref: producer.runRef } });
  expect(stored.status, JSON.stringify(stored)).toBe('stored');
  if (stored.status !== 'stored') throw Error('Actual MaterialPort store failed');
  const request = { meta: { requestId: 'platform-drain-grant',
    expected: [await goalPin(t.platform, f), { ref: f.workspaceRef, revision: 1 }] },
    input: { goalRef: f.goalRef, reader: producer.runRef, materials: [stored.ref],
      sourceSet: { kind: 'workspace_paths' as const, paths: ['src/input.txt'] }, purpose: 'Grant drains before owned stores close' } };
  const granting = t.platform.materials.grantMaterialAccess(f.ctx, request);
  let closing: Promise<void> | undefined;
  let closed = false;
  try {
    // A missing source provider must fail here rather than leave a hanging test.
    expect(await Promise.race([entered.then(() => 'entered'), granting.then(() => 'settled')])).toBe('entered');
    closing = t.platform.close().then(() => { closed = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(closed, 'close must wait for the outer grant, including source observation and ledger commit').toBe(false);
    await expect(t.platform.materials.grantMaterialAccess(f.ctx, { ...request,
      meta: { ...request.meta, requestId: 'platform-drain-late-grant' } })).resolves.toMatchObject({ status: 'rejected', code: 'unavailable' });
    release();
    const granted = await granting;
    expect(granted).toMatchObject({ status: 'committed', replayed: false });
    if (granted.status !== 'committed') throw Error('In-flight grant lost its owned stores during close');
    await closing;
    await t.reopen();
    const count = t.authorizations.length;
    await expect(t.platform.materials.grantMaterialAccess(f.ctx, request)).resolves.toEqual({ ...granted, replayed: true });
    expect(t.authorizations.length, 'receipt recovery must not restart source capture').toBe(count);
    const readerCtx: CoreCallContext = { ...producerCtx,
      materialReader: { kind: 'run', requester: producer.runRef, currentBasis: granted.value.grant.basis } };
    await expect(t.platform.materials.openArtifact(readerCtx, { ref: stored.ref, usage: 'current' }))
      .resolves.toMatchObject({ status: 'ready', value: { body: 'Retain grant while platform closes', applicability: 'current' } });
  } finally {
    release();
    await Promise.allSettled([granting, ...(closing ? [closing] : [])]);
  }
});
