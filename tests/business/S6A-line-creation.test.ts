/**
 * The line-creation entry (book §3.4.7, §3.12; spec §0.3 L4, §5.2 R-01a). The
 * entry runs over the REAL Session directory and the REAL `createSession` on a
 * real in-memory/SQLite RecordStore with a real Kernel store; no record is built
 * by hand and `createSession` is never stubbed. The capacity rows use the
 * Host's real `secretaryOpenCap` adapter over the same directory and duty
 * resolver.
 *
 * The one fault injection is the frozen `S6A-registration-double` (book §5.1,
 * check 3 A6): its first `recordSessionCreated` throws, so the real
 * `createSession` answers `accepted`, and the replay registers the same Session.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { GOAL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/record-codecs.js';
import { SESSION_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createSessionOperations, type SessionOperationsPort } from '../../src/core/agent-runtime/session-operations.js';
import { createSessionDutyResolver } from '../../src/composition/session-duty.js';
import { createSecretaryOpenCapCapacity } from '../../src/composition/create-platform.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import {
  createAlwaysAdmitCapacity, createLineCreation, type LineCapacityPort, type LineCreationInput,
} from '../../src/business/workflow/line-creation.js';
import { registrationDouble } from '../helpers/S6A-registration-double.js';

vi.mock('../../src/core/work-graph/sessions/session-directory.js', async (importOriginal) =>
  (await import('../helpers/S6A-registration-double.js')).registrationDoubleModule(importOriginal));

const at = '2026-10-23T09:00:00.000Z';
const projectId = 's6a-line-project';
const workspaceId = 's6a-line-workspace';
const scope = { projectId, workspaceId };
const actor = { kind: 'human' as const, id: 's6a-line-operator' };
const secretaryRole = platformRoleProfile('secretary').template;
const ctx: CoreCallContext = {
  projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal,
};
const input: LineCreationInput = {
  commandId: 'request-6a-1:line',
  duty: 'secretary',
  scope: { kind: 'project' },
  reason: 'secretary_needed',
  provenance: { schemaVersion: 1, kind: 'new' },
  roleConfiguration: secretaryRole,
  // The two optional handoff positions, read back as null for an ordinary line.
  replaces: null,
  parentOperation: null,
};
const schemas: RecordBackendSchemas = {
  records: [...GOAL_RECORD_SCHEMAS.records, ...SESSION_RECORD_SCHEMAS.records],
  events: [...GOAL_RECORD_SCHEMAS.events, ...SESSION_RECORD_SCHEMAS.events,
    ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events],
  lookups: SESSION_RECORD_SCHEMAS.lookups ?? [],
};
const directories: string[] = [];

afterEach(async () => {
  registrationDouble.reset();
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function open(kind: 'memory' | 'sqlite') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 's6a-line-'));
  directories.push(directory);
  const backend = kind === 'memory'
    ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ schemas, path: path.join(directory, 'ledger.sqlite') });
  let eventNo = 0;
  const bootstrap = createProjectBootstrapServices({
    records: backend.records, now: () => at, eventId: () => 's6a-line-scope-event-' + String(++eventNo),
  });
  const createdProject = await bootstrap.projects.createProject(ctx, {
    meta: { requestId: 's6a-line-project', expected: [{ ref: { aggregateType: 'Project', projectId }, revision: 0 }] },
    input: { projectId },
  });
  if (createdProject.status !== 'committed') throw new Error(`project registration failed: ${JSON.stringify(createdProject)}`);
  const registered = await bootstrap.projects.registerWorkspace(ctx, {
    meta: { requestId: 's6a-line-workspace', expected: [
      { ref: { aggregateType: 'Project', projectId }, revision: 1 },
      { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 0 },
    ] },
    input: { workspace: scope },
  });
  if (registered.status !== 'committed') throw new Error(`workspace registration failed: ${JSON.stringify(registered)}`);
  const directoryPort = createSessionDirectory({ records: backend.records, lookups: backend.records });
  const kernelStores = await createKernelStoreRegistry({ entries: [{
    adapterId: 's6a-line-kernel', storeKey: 's6a-line-key', workspace: scope,
    databasePath: path.join(directory, 'kernel.sqlite'),
  }] });
  const runtime = createSessionOperations({ sessions: directoryPort, kernelStores });
  const entry = createLineCreation({ sessions: runtime, operations: directoryPort, capacity: createAlwaysAdmitCapacity() });
  return { backend, directory: directoryPort, runtime, entry };
}

/**
 * The operation ref the real creation receipt carries for a line command: the
 * same public line-creation request replayed through the Session owner. A1
 * allows the platform-issued ref to be used as it was returned.
 */
async function creationOperationRef(runtime: SessionOperationsPort, commandId: string) {
  const receipt = await runtime.createSession(ctx, {
    workspace: scope,
    role: secretaryRole,
    recommendedRefs: [],
    initialLinks: [],
    meta: { requestId: commandId, expected: [] },
    provenance: { schemaVersion: 1, kind: 'new' },
    creation: { duty: 'secretary', scope: { kind: 'project' }, reason: 'secretary_needed', creator: actor },
  });
  if (receipt.status !== 'completed') {
    throw new Error(`the line creation receipt was not completed: ${JSON.stringify(receipt)}`);
  }
  return receipt.operationRef;
}

/**
 * The Host's `secretaryOpenCap` adapter. The RoleSpec branch is unreachable
 * for the legacy platform secretary template; a read there fails the row.
 */
const duty = createSessionDutyResolver({
  readRoleSpec: async () => { throw new Error('a legacy secretary template reads no RoleSpec'); },
  configuration: undefined,
});

describe.each(['memory', 'sqlite'] as const)('S6A-1 line creation over the real %s store', kind => {
  it('creates a line whose admission stores the intent and whose Session keeps the provenance and role', async () => {
    const { backend, directory, runtime, entry } = await open(kind);
    try {
      expect(await entry.findLine(ctx, { commandId: input.commandId })).toEqual({ status: 'ready', value: { status: 'none' } });
      const created = await entry.ensureLine(ctx, input);
      expect(created.status).toBe('created');
      if (created.status !== 'created') return;

      const card = await directory.readSession(ctx, created.session);
      expect(card.status).toBe('ready');
      if (card.status !== 'ready') return;
      expect(card.value.record.provenance).toEqual({ schemaVersion: 1, kind: 'new' });
      expect(card.value.record.role).toEqual(secretaryRole);

      const operation = await directory.getSessionOperation(ctx,
        await creationOperationRef(runtime, input.commandId));
      expect(operation.status).toBe('ready');
      if (operation.status !== 'ready') return;
      expect(operation.value.action.kind).toBe('create');
      if (operation.value.action.kind !== 'create') return;
      expect(operation.value.action.creation).toEqual({
        duty: 'secretary', scope: { kind: 'project' }, reason: 'secretary_needed', creator: actor,
      });
      expect(operation.value.phase).toBe('completed');
      expect(await entry.findLine(ctx, { commandId: input.commandId })).toEqual({ status: 'ready', value: { status: 'found', input } });
    } finally { await backend.close(); }
  });

  it('replays the same commandId to the same Session and leaves one operation', async () => {
    const { backend, directory, runtime, entry } = await open(kind);
    try {
      const first = await entry.ensureLine(ctx, input);
      expect(first.status).toBe('created');
      if (first.status !== 'created') return;
      const operationRef = await creationOperationRef(runtime, input.commandId);
      const before = await directory.getSessionOperation(ctx, operationRef);
      expect(before.status).toBe('ready');
      if (before.status !== 'ready') return;

      const replay = await entry.ensureLine(ctx, input);
      expect(replay).toEqual({ status: 'replayed', session: first.session });
      const after = await directory.getSessionOperation(ctx, operationRef);
      expect(after.status).toBe('ready');
      if (after.status !== 'ready') return;
      // One operation: the original admission instant and revision are unchanged.
      expect(after.value.requestedAt).toBe(before.value.requestedAt);
      expect(after.value.revision).toBe(before.value.revision);
      expect(after.value.phase).toBe('completed');
      const page = await directory.findSessions(ctx, { workspace: scope, includeArchived: false, page: { limit: 10 } });
      expect(page.status).toBe('ready');
      if (page.status === 'ready') expect(page.value.items.map(item => item.record.ref))
        .toEqual([{ aggregateType: 'Session', ...first.session }]);
    } finally { await backend.close(); }
  });

  it('finds the stored input of a line admitted but not yet registered', async () => {
    const { backend, entry } = await open(kind);
    try {
      registrationDouble.failNext(1);
      const pending = await entry.ensureLine(ctx, input);
      expect(pending.status).toBe('accepted');
      if (pending.status !== 'accepted') return;
      expect(await entry.findLine(ctx, { commandId: input.commandId })).toEqual({ status: 'ready', value: { status: 'found', input } });
    } finally { await backend.close(); }
  });
  it('stores creation null for a creation that opens no line and replays it', async () => {
    const { backend, directory, runtime, entry } = await open(kind);
    try {
      const request = {
        workspace: scope, role: secretaryRole, recommendedRefs: [], initialLinks: [],
        meta: { requestId: 's6a-plain-session', expected: [] },
      };
      const first = await runtime.createSession(ctx, request);
      expect(first.status).toBe('completed');
      if (first.status !== 'completed') return;
      const replay = await runtime.createSession(ctx, request);
      expect(replay.status).toBe('completed');
      if (replay.status !== 'completed') return;
      expect(replay.replayed).toBe(true);
      expect(replay.value.ref).toEqual(first.value.ref);
      const operation = await directory.getSessionOperation(ctx, first.operationRef);
      expect(operation.status).toBe('ready');
      if (operation.status !== 'ready') return;
      expect(operation.value.action.kind).toBe('create');
      if (operation.value.action.kind !== 'create') return;
      expect(operation.value.action.creation).toBeNull();
      expect(await entry.findLine(ctx, { commandId: 's6a-plain-session' })).toEqual({ status: 'ready', value: { status: 'none' } });
    } finally { await backend.close(); }
  });
});

describe.each(['memory', 'sqlite'] as const)('S6A-1 line creation refusals and capacity (%s)', kind => {
  describe('rejects: a non-project scope', () => {
    it('rejects it before any capacity count or write', async () => {
      const { backend, directory, runtime } = await open(kind);
      try {
        const calls: string[] = [];
        const always = createAlwaysAdmitCapacity();
        const counting: LineCapacityPort = {
          async admit(callCtx, request) { calls.push(request.duty); return always.admit(callCtx, request); },
        };
        const entry = createLineCreation({ sessions: runtime, operations: directory, capacity: counting });
        const goalScoped = { ...input, scope: { kind: 'goal', goalId: 's6a-goal-1' } } as unknown as LineCreationInput;
        const refused = await entry.ensureLine(ctx, goalScoped);
        expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
        expect(calls).toEqual([]);
        expect(await entry.findLine(ctx, { commandId: input.commandId })).toEqual({ status: 'ready', value: { status: 'none' } });
        const page = await directory.findSessions(ctx, { workspace: scope, includeArchived: false, page: { limit: 10 } });
        expect(page.status).toBe('ready');
        if (page.status === 'ready') expect(page.value.items).toEqual([]);
      } finally { await backend.close(); }
    });
  });

  it('refuses a fresh line at the real secretaryOpenCap and writes nothing', async () => {
    const { backend, directory, runtime } = await open(kind);
    try {
      // A3: the real Host adapter, counted; each call's input is remembered and
      // its answer returned unchanged.
      const realCap = createSecretaryOpenCapCapacity({ limit: 1, sessions: directory, duty });
      const planned: SessionRef[] = [];
      const replaced: (SessionRef | null)[] = [];
      const counted: LineCapacityPort = {
        async admit(callCtx, request) {
          planned.push(structuredClone(request.plannedSessionRef));
          replaced.push(request.replaces);
          return realCap.admit(callCtx, request);
        },
      };
      const capped = createLineCreation({ sessions: runtime, operations: directory, capacity: counted });
      const first = await capped.ensureLine(ctx, { ...input, commandId: 'request-6a-1:cap-first' });
      expect(first.status).toBe('created');
      if (first.status !== 'created') return;
      const beforeRefused = planned.length;
      expect(await capped.ensureLine(ctx, input)).toEqual({ status: 'capacity_blocked', duty: 'secretary' });
      // One fresh line request asks the capacity port exactly once, with the
      // stable planned Session of this command (a new id, in this project).
      const asked = planned.slice(beforeRefused);
      expect(asked).toHaveLength(1);
      expect(replaced.slice(beforeRefused)).toEqual([null]);
      expect(asked[0]).toEqual({ projectId, sessionId: expect.stringMatching(/^session-[0-9a-f]{64}$/) });
      expect(asked[0]!.sessionId).not.toBe(first.session.sessionId);
      expect(await capped.findLine(ctx, { commandId: input.commandId }))
        .toEqual({ status: 'ready', value: { status: 'none' } });
      const page = await directory.findSessions(ctx, { workspace: scope, includeArchived: false, page: { limit: 10 } });
      expect(page.status).toBe('ready');
      if (page.status === 'ready') {
        expect(page.value.items.map(item => item.record.ref)).toEqual([{ aggregateType: 'Session', ...first.session }]);
      }
    } finally { await backend.close(); }
  });

  it('turns the registration double’s one thrown call into accepted and registers it on replay', async () => {
    const { backend, directory, entry } = await open(kind);
    try {
      registrationDouble.failNext(1);
      const pending = await entry.ensureLine(ctx, input);
      expect(pending.status).toBe('accepted');
      if (pending.status !== 'accepted') return;
      expect(registrationDouble.injected).toBe(1);
      expect(registrationDouble.forwarded).toBe(0);

      const replay = await entry.ensureLine(ctx, input);
      expect(replay.status).toBe('replayed');
      if (replay.status !== 'replayed') return;
      expect(registrationDouble.armed).toBe(0);
      expect(registrationDouble.forwarded).toBe(1);
      const operation = await directory.getSessionOperation(ctx, pending.operationRef);
      expect(operation.status).toBe('ready');
      if (operation.status !== 'ready') return;
      expect(operation.value.action.kind).toBe('create');
      if (operation.value.action.kind !== 'create') return;
      expect(operation.value.action.plannedSessionRef).toEqual(replay.session);
      const card = await directory.readSession(ctx, replay.session);
      expect(card.status).toBe('ready');
      if (card.status !== 'ready') return;
      expect(card.value.record.provenance).toEqual({ schemaVersion: 1, kind: 'new' });
      expect(card.value.record.role).toEqual(secretaryRole);
    } finally { await backend.close(); }
  });
});
