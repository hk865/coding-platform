/** Runtime input isolation and history cursor boundaries over real stores. */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { GOAL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/record-codecs.js';
import { SESSION_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import type { SessionDirectoryPort } from '../../src/core/work-graph/model/session-contracts.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createSessionOperations, type CreateSessionRequest } from '../../src/core/agent-runtime/session-operations.js';
import { createR4HistoryWorld, type R4HistoryRun, type R4HistoryWorld } from '../helpers/R4-history-turn-support.js';

const at = '2026-09-24T00:00:00.000Z';
const projectId = 'session-boundary-project';
const workspaceId = 'workspace-a';
const actor = { kind: 'human' as const, id: 'original-operator' };
const ctx: CoreCallContext = {
  projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal,
};
const workspace = { projectId, workspaceId };
const schemas: RecordBackendSchemas = {
  records: [...GOAL_RECORD_SCHEMAS.records, ...SESSION_RECORD_SCHEMAS.records],
  events: [...GOAL_RECORD_SCHEMAS.events, ...SESSION_RECORD_SCHEMAS.events,
    ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events],
  lookups: SESSION_RECORD_SCHEMAS.lookups ?? [],
};
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

function request(requestId: string): CreateSessionRequest {
  return { workspace, role: { kind: 'legacy_template', templateId: 'implementer', templateRevision: '1' },
    recommendedRefs: [], initialLinks: [], meta: { requestId, expected: [] } };
}

async function open() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'next-r4b-input-boundaries-'));
  directories.push(directory);
  const backend = createSqliteRecordBackend({ schemas, path: path.join(directory, 'ledger.sqlite') });
  // The real public bootstrap owns the Project/Workspace snapshot and its event.
  let bootstrapSeq = 0;
  const bootstrap = createProjectBootstrapServices({ records: backend.records, now: () => at,
    eventId: () => `boundary-bootstrap-${++bootstrapSeq}` });
  const projectRef = { aggregateType: 'Project' as const, projectId };
  const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
  const project = await bootstrap.projects.createProject(ctx, { input: { projectId },
    meta: { requestId: 'boundary-create-project', expected: [{ ref: projectRef, revision: 0 }] } });
  if (project.status !== 'committed') throw Error(`project bootstrap failed: ${JSON.stringify(project)}`);
  const registered = await bootstrap.projects.registerWorkspace(ctx, { input: { workspace },
    meta: { requestId: 'boundary-register-workspace', expected: [
      { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] } });
  if (registered.status !== 'committed') throw Error(`workspace bootstrap failed: ${JSON.stringify(registered)}`);
  const sessions = createSessionDirectory({ records: backend.records, lookups: backend.records });
  const kernelStores = await createKernelStoreRegistry({ entries: [{
    adapterId: 'workspace-kernel', storeKey: 'workspace-key', workspace,
    databasePath: path.join(directory, 'kernel.sqlite'),
  }] });
  return { backend, sessions, kernelStores };
}

it('keeps the original request identity and role when the caller mutates input after durable admission', async () => {
  const { backend, sessions, kernelStores } = await open();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  let originalOperation: string | null = null;
  const guarded: SessionDirectoryPort = {
    ...sessions,
    async admitSessionCreation(context, command) {
      const result = await sessions.admitSessionCreation(context, command);
      if (result.status === 'committed') {
        originalOperation = result.value.ref.operationId;
        entered();
        await gate;
      }
      return result;
    },
  };
  const runtime = createSessionOperations({ sessions: guarded, kernelStores });
  const input = request('original-request');
  const original = structuredClone(input);
  try {
    const pending = runtime.createSession(ctx, input);
    // If the current skeleton returns unsupported, fail immediately instead of
    // waiting forever for an admission callback it never invoked.
    await Promise.race([admitted, pending.then(() => { throw Error('createSession returned before durable admission'); })]);
    input.meta.requestId = 'mutated-request';
    input.role = { kind: 'legacy_template', templateId: 'mutated-role', templateRevision: '9' };
    release();
    const created = await pending;
    expect(created.status).toBe('completed');
    if (created.status !== 'completed') return;
    expect(created.operationRef.operationId).toBe(originalOperation);
    expect(created.value.role).toEqual(original.role);
    const retry = await createSessionOperations({ sessions, kernelStores }).createSession(ctx, original);
    expect(retry).toMatchObject({ status: 'completed', value: { ref: created.value.ref, kernel: created.value.kernel } });
    const kernel = await kernelStores.withStore(created.value.kernel.adapterId,
      store => store.list(null, 10, { signal: ctx.signal }));
    expect(kernel.sessions.map(item => item.sessionId)).toEqual([created.value.kernel.kernelSessionId]);
  } finally { release(); await backend.close(); }
});

describe('rejects: history limit outside 1..200 and a continuation cursor from another principal', () => {
  /**
   * R-18 frame for one refused history read. Prior state (A1): one real Run in the
   * fixture's first mapped Session (shared real-Turn helper). The row sends ONE
   * refused read; the public whole-history read of that Session, before and after,
   * shows that the refusal changed nothing.
   */
  async function expectRefusedWithoutChange(expected: { status: 'rejected'; code: 'invalid' },
    refuse: (world: R4HistoryWorld, run: R4HistoryRun) => Promise<unknown>): Promise<void> {
    const world = await createR4HistoryWorld();
    try {
      const run = await world.run({ text: 'history input' });
      const whole = () => world.history.readSessionHistory(world.ctx, { sessionRef: run.sessionRef,
        afterCursor: null, throughCursor: null, limit: 200 });
      const before = await whole();
      expect(before.status).toBe('ready');
      expect(await refuse(world, run)).toMatchObject(expected);
      expect(await whole()).toEqual(before);
    } finally { await world.close(); }
  }

  it.each([0, -1, 201])('rejects history limit %s', limit =>
    expectRefusedWithoutChange({ status: 'rejected', code: 'invalid' }, (world, run) =>
      world.history.readSessionHistory(world.ctx, { sessionRef: run.sessionRef,
        afterCursor: null, throughCursor: null, limit })));

  it('rejects a continuation cursor from another principal', () =>
    expectRefusedWithoutChange({ status: 'rejected', code: 'invalid' }, async (world, run) => {
      // The real Run appended Kernel records after the position-1 session.created,
      // so a one-line page still has a real continuation.
      const first = await world.history.readSessionHistory(world.ctx, { sessionRef: run.sessionRef,
        afterCursor: null, throughCursor: null, limit: 1 });
      expect(first.status).toBe('ready');
      if (first.status !== 'ready') return first;
      expect(first.value.nextCursor).not.toBeNull();
      const otherActor = { kind: 'human' as const, id: 'other-operator' };
      const other: CoreCallContext = { ...world.ctx, principal: { kind: 'host', actor: otherActor },
        materialReader: { kind: 'host', projectId: world.projectId, workspaceId: world.workspaceId, actor: otherActor } };
      return world.history.readSessionHistory(other, { sessionRef: run.sessionRef,
        afterCursor: first.value.nextCursor, throughCursor: null, limit: 1 });
    }));
});
