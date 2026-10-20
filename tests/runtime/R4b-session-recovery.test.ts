/** R4b implementation acceptance. These cases are deliberately red while the
 * SessionDirectory and Runtime bridge return unsupported. Do not replace their
 * real stores with an in-process fake to make them pass. */
import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { GOAL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/record-codecs.js';
import { SESSION_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';
import type { SessionHistoryEntry } from '../../src/core/agent-runtime/session-operations.js';
import { createR4HistoryWorld } from '../helpers/R4-history-turn-support.js';

const at = '2026-09-24T00:00:00.000Z';
const projectId = 'session-project';
const workspaceId = 'workspace-a';
const actor = { kind: 'human' as const, id: 'session-operator' };
const ctx: CoreCallContext = {
  projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal,
};
const workspace = { projectId, workspaceId };
const role = { kind: 'legacy_template' as const, templateId: 'implementer', templateRevision: '1' };
const creation = (requestId: string) => ({
  input: { workspace, role, recommendedRefs: [], initialLinks: [] },
  meta: { requestId, expected: [] },
});
const schemas: RecordBackendSchemas = {
  records: [...GOAL_RECORD_SCHEMAS.records, ...SESSION_RECORD_SCHEMAS.records],
  events: [...GOAL_RECORD_SCHEMAS.events, ...SESSION_RECORD_SCHEMAS.events,
    ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events],
  lookups: SESSION_RECORD_SCHEMAS.lookups ?? [],
};
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

async function open(kind: 'memory' | 'sqlite') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'next-r4b-acceptance-'));
  directories.push(directory);
  const ledgerPath = path.join(directory, 'ledger.sqlite');
  const backend = kind === 'memory'
    ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ schemas, path: ledgerPath });
  // The real public bootstrap owns the Project/Workspace snapshot and its event.
  let bootstrapSeq = 0;
  const bootstrap = createProjectBootstrapServices({ records: backend.records, now: () => at,
    eventId: () => `session-bootstrap-${++bootstrapSeq}` });
  const projectRef = { aggregateType: 'Project' as const, projectId };
  const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
  const project = await bootstrap.projects.createProject(ctx, { input: { projectId },
    meta: { requestId: 'session-create-project', expected: [{ ref: projectRef, revision: 0 }] } });
  if (project.status !== 'committed') throw new Error(`project bootstrap failed: ${JSON.stringify(project)}`);
  const registered = await bootstrap.projects.registerWorkspace(ctx, { input: { workspace },
    meta: { requestId: 'session-register-workspace', expected: [
      { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] } });
  if (registered.status !== 'committed') throw new Error(`workspace bootstrap failed: ${JSON.stringify(registered)}`);
  const sessions = createSessionDirectory({ records: backend.records, lookups: backend.records });
  const kernelStores = await createKernelStoreRegistry({ entries: [{
    adapterId: 'workspace-kernel', storeKey: 'workspace-key', workspace,
    databasePath: path.join(directory, 'kernel.sqlite'),
  }] });
  const runtime = createSessionOperations({ sessions, kernelStores });
  return { backend, sessions, runtime, kernelStores, ledgerPath };
}

describe('R4b SQLite recovery and raw history acceptance', () => {
  it('reuses the committed Kernel create after its response is lost', async () => {
    const { backend, sessions, kernelStores } = await open('sqlite');
    let loseCreateResponse = true;
    const faulty = { ...kernelStores, withStore: async <T>(adapterId: string,
      use: Parameters<typeof kernelStores.withStore<T>>[1]): Promise<T> => kernelStores.withStore(adapterId, async store => {
        if (!loseCreateResponse) return use(store);
        const proxy = new Proxy(store, { get(target, property) {
          if (property === 'create') return async (...args: Parameters<typeof store.create>) => {
            await target.create(...args);
            loseCreateResponse = false;
            throw new Error('create response lost after SQLite commit');
          };
          const member: unknown = Reflect.get(target, property);
          return typeof member === 'function' ? member.bind(target) : member;
        } });
        return use(proxy);
      }) };
    const runtime = createSessionOperations({ sessions, kernelStores: faulty });
    try {
      const request = { ...creation('lost-kernel-response').input, meta: creation('lost-kernel-response').meta };
      const first = await runtime.createSession(ctx, request);
      expect(first.status).toMatch(/accepted|rejected/);
      const recovered = await runtime.createSession(ctx, request);
      expect(recovered.status).toBe('completed');
      if (recovered.status !== 'completed') return;
      const page = await kernelStores.withStore(recovered.value.kernel.adapterId,
        store => store.list(null, 10, { signal: ctx.signal }));
      expect(page.sessions.map(item => item.sessionId)).toEqual([recovered.value.kernel.kernelSessionId]);
    } finally { await backend.close(); }
  });

  it('repairs a failed platform mapping after reopening the real SQLite Store', async () => {
    const first = await open('sqlite');
    let rejectRegistration = true;
    const faulty = { ...first.sessions, recordSessionCreated: async (...args: Parameters<typeof first.sessions.recordSessionCreated>) => {
      if (rejectRegistration) { rejectRegistration = false; return { status: 'rejected' as const,
        code: 'unavailable' as const, reason: 'injected post-Kernel WG outage' }; }
      return first.sessions.recordSessionCreated(...args);
    } };
    const request = { ...creation('lost-wg-registration').input, meta: creation('lost-wg-registration').meta };
    try {
      const interrupted = await createSessionOperations({ sessions: faulty, kernelStores: first.kernelStores }).createSession(ctx, request);
      expect(interrupted.status).toMatch(/accepted|rejected/);
    } finally { await first.backend.close(); }
    const backend = createSqliteRecordBackend({ schemas, path: first.ledgerPath });
    try {
      const sessions = createSessionDirectory({ records: backend.records, lookups: backend.records });
      const recovered = await createSessionOperations({ sessions, kernelStores: first.kernelStores }).createSession(ctx, request);
      expect(recovered.status).toBe('completed');
      if (recovered.status !== 'completed') return;
      const page = await first.kernelStores.withStore(recovered.value.kernel.adapterId,
        store => store.list(null, 10, { signal: ctx.signal }));
      expect(page.sessions.map(item => item.sessionId)).toEqual([recovered.value.kernel.kernelSessionId]);
    } finally { await backend.close(); }
  });

  it('never moves an accepted create to a new default Kernel store after registration is interrupted', async () => {
    const first = await open('sqlite');
    const request = { ...creation('pinned-kernel-route').input, meta: creation('pinned-kernel-route').meta };
    const originalLocation = first.kernelStores.byAdapterId('workspace-kernel');
    if (!originalLocation) throw Error('missing initial Kernel route');
    const replacementPath = path.join(path.dirname(first.ledgerPath), 'replacement-kernel.sqlite');
    const interruptedDirectory = {
      ...first.sessions,
      recordSessionCreated: async () => ({ status: 'rejected' as const, code: 'unavailable' as const,
        reason: 'injected outage after Kernel create' }),
    };
    let originalKernelSessionId: string;
    try {
      const interrupted = await createSessionOperations({ sessions: interruptedDirectory,
        kernelStores: first.kernelStores }).createSession(ctx, request);
      expect(interrupted.status).toBe('accepted');
      const original = await first.kernelStores.withStore('workspace-kernel',
        store => store.list(null, 10, { signal: ctx.signal }));
      expect(original.sessions).toHaveLength(1);
      originalKernelSessionId = original.sessions[0]!.sessionId;
    } finally { await first.backend.close(); }

    const backend = createSqliteRecordBackend({ schemas, path: first.ledgerPath });
    try {
      const sessions = createSessionDirectory({ records: backend.records, lookups: backend.records });
      const changedDefault = await createKernelStoreRegistry({ entries: [{
        adapterId: 'replacement-kernel', storeKey: 'replacement-key', workspace, databasePath: replacementPath,
      }] });
      const refused = await createSessionOperations({ sessions, kernelStores: changedDefault }).createSession(ctx, request);
      expect(refused).toMatchObject({ status: 'rejected', code: 'unsupported' });
      await expect(access(replacementPath)).rejects.toMatchObject({ code: 'ENOENT' });

      const restored = await createKernelStoreRegistry({ entries: [{
        adapterId: originalLocation.adapterId, storeKey: originalLocation.storeKey,
        workspace, databasePath: originalLocation.databasePath,
      }] });
      const recovered = await createSessionOperations({ sessions, kernelStores: restored }).createSession(ctx, request);
      expect(recovered.status).toBe('completed');
      if (recovered.status !== 'completed') return;
      expect(recovered.value.kernel).toMatchObject({ adapterId: 'workspace-kernel',
        kernelSessionId: originalKernelSessionId });
      const original = await restored.withStore('workspace-kernel', store => store.list(null, 10, { signal: ctx.signal }));
      expect(original.sessions.map(item => item.sessionId)).toEqual([originalKernelSessionId]);
    } finally { await backend.close(); }
  });

  it('binds raw history continuation to its original adapter, Session and upper record position', async () => {
    const world = await createR4HistoryWorld();
    try {
      // The SAME real Session runs twice; an old page cursor must keep pointing
      // at the first Run's frozen upper bound after the second Run grows it.
      const firstRun = await world.run({ text: 'first' });
      const first = await world.history.readSessionHistory(world.ctx, { sessionRef: firstRun.sessionRef,
        afterCursor: null, throughCursor: null, limit: 2 });
      expect(first.status).toBe('ready');
      if (first.status !== 'ready') return;
      expect(first.value.items).toHaveLength(2);
      expect(first.value.nextCursor).not.toBeNull();
      const secondRun = await world.run({ text: 'later' });
      const continued = await world.history.readSessionHistory(world.ctx, { sessionRef: firstRun.sessionRef,
        afterCursor: first.value.nextCursor, throughCursor: null, limit: 20 });
      expect(continued.status).toBe('ready');
      if (continued.status !== 'ready') return;
      const items: SessionHistoryEntry[] = [...continued.value.items];
      let cursor = continued.value.nextCursor;
      while (cursor !== null) {
        const page = await world.history.readSessionHistory(world.ctx, { sessionRef: firstRun.sessionRef,
          afterCursor: cursor, throughCursor: null, limit: 20 });
        expect(page.status).toBe('ready');
        if (page.status !== 'ready') return;
        items.push(...page.value.items);
        cursor = page.value.nextCursor;
      }
      expect(items.length).toBeGreaterThan(0);
      const belongsTo = (entry: SessionHistoryEntry,
        identity: typeof firstRun.identity): boolean => {
        if (!('text' in entry.body)) return false;
        const record = JSON.parse(entry.body.text) as {
          recordType: string;
          payload: { run?: { runId?: string; turn?: { turnId?: string } };
            event?: { meta?: { runId?: string; turnId?: string } } };
        };
        return record.recordType === 'turn.started'
          ? record.payload.run?.runId === identity.runId && record.payload.run?.turn?.turnId === identity.turnId
          : record.recordType === 'agent.event'
            ? record.payload.event?.meta?.runId === identity.runId && record.payload.event?.meta?.turnId === identity.turnId
            : false;
      };
      for (const item of items) {
        expect({ position: item.source.position, first: belongsTo(item, firstRun.identity),
          second: belongsTo(item, secondRun.identity) })
          .toEqual({ position: item.source.position, first: true, second: false });
      }
      // The same cursor on another Session is the R-18 row below.
    } finally { await world.close(); }
  });

  describe('rejects: a raw history continuation cursor bound to another Session', () => {
    it('rejects the first Session cursor on the second Session and changes nothing', async () => {
      const world = await createR4HistoryWorld();
      try {
        // Prior state (A1), as in the continuation row above: the first Session runs
        // twice, its cursor coming from the limit-2 page read in between.
        const firstRun = await world.run({ text: 'first' });
        const first = await world.history.readSessionHistory(world.ctx, { sessionRef: firstRun.sessionRef,
          afterCursor: null, throughCursor: null, limit: 2 });
        expect(first.status).toBe('ready');
        if (first.status !== 'ready') return;
        expect(first.value.nextCursor).not.toBeNull();
        await world.run({ text: 'later' });
        // R-18: the public whole-history reads of both mapped Sessions, before and after.
        const histories = () => Promise.all([world.sessions.first, world.sessions.second].map(sessionRef =>
          world.history.readSessionHistory(world.ctx, { sessionRef, afterCursor: null, throughCursor: null, limit: 200 })));
        const before = await histories();
        expect(before.map(read => read.status)).toEqual(['ready', 'ready']);
        const wrongSession = await world.history.readSessionHistory(world.ctx, { sessionRef: world.sessions.second,
          afterCursor: first.value.nextCursor, throughCursor: null, limit: 2 });
        expect(wrongSession).toMatchObject({ status: 'rejected', code: 'invalid' });
        expect(await histories()).toEqual(before);
      } finally { await world.close(); }
    });
  });
});
