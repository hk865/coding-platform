/**
 * Slice 2C group P shared pin fixture (rows 2C-07, 2C-19; spec §5.2, L9).
 *
 * It opens the accepted R4c.1 claim fixture (ONE real RecordStore, memory or
 * SQLite, through the real Project/Workspace/Goal/Plan/Session services) with
 * the slice-2C `WorkspaceLinePinsChanged@1` event registered, and builds the
 * line-settings owner over the SAME real records port. Every fixture fact is
 * created through the real public services:
 *   - plain Sessions through the fixture's `SessionDirectoryPort`;
 *   - `readonly_copy` Sessions through `admitSessionCreation` +
 *     `recordSessionCreated` with a `readonly_copy` provenance;
 *   - pins and notice marks through the services under test;
 *   - the injected clock is a controllable literal so `pinnedAt` is a known
 *     value the tests hand-compute.
 *
 * The current Workspace revision is read once at open only to build the next
 * request's `meta.expected` pin; no assertion reads the record store.
 */
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { SessionRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { SessionProvenanceV1 } from '../../src/contracts/core/session.js';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import { createLineSettingsService } from '../../src/core/work-graph/configuration/line-settings-service.js';
import type { SessionDutyReadPort, WorkLineReadPort,
  WorkLineSettingsPort } from '../../src/core/work-graph/model/work-line-contracts.js';
import type { SessionAnomalyPort } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import { createWorkLineReader, type WorkLineReaderDeps,
  type WorkLineStore } from '../../src/core/work-graph/views/work-line-reader.js';
import { LINE_SETTINGS_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/line-settings-codecs.js';
import { DECISION_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/decision-record-codecs.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { canonicalRefKey, decodeWorkspaceSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { CLAIM_FIXTURE_AT, createTaskClaimFixture, type ClaimFixtureKind,
  type TaskClaimFixture } from './task-claim-fixture.js';

/** The store registrations the fixture world needs: pin changes and notice marks. */
const PIN_FIXTURE_SCHEMAS: RecordBackendSchemas = {
  records: [...LINE_SETTINGS_RECORD_SCHEMAS.records, ...DECISION_RECORD_SCHEMAS.records],
  events: [...LINE_SETTINGS_RECORD_SCHEMAS.events, ...DECISION_RECORD_SCHEMAS.events],
  lookups: [...(LINE_SETTINGS_RECORD_SCHEMAS.lookups ?? []), ...(DECISION_RECORD_SCHEMAS.lookups ?? [])],
};

export const PIN_KERNEL_STORE = { adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store' } as const;
export const PIN_SESSION_ROLE = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' } as const;

export type S2CPinsFixture = {
  kind: ClaimFixtureKind;
  base: TaskClaimFixture;
  scope: WorkspaceScope;
  pins: WorkLineSettingsPort;
  /** Group L's real `lines/list` reader over the SAME store (rows, order, pins). */
  reader: WorkLineReadPort;
  operator: Extract<ActorRef, { kind: 'human' | 'system' }>;
  /** The trusted operator call context of the fixture. */
  operatorCtx: CoreCallContext;
  /** A work-Run (agent) call context; the settings owner refuses it. */
  agentCtx: CoreCallContext;
  /** The revision the next pin request must pin; tracked from write receipts. */
  revision(): number;
  /** Remembers the revision a committed write returned. */
  note(revision: number): void;
  /** Sets the literal clock new pins use. */
  setClock(value: string): void;
  /** Creates a plain Session through the real directory services. */
  createSession(requestId: string): Promise<SessionRef>;
  /** Creates a `readonly_copy` Session through the real directory services. */
  createCopySession(requestId: string): Promise<SessionRef>;
  /** Creates a `continuation` of `from` through the real directory services. */
  createContinuation(requestId: string, from: SessionRef): Promise<SessionRef>;
  /** The Workspace version pin for the tracked revision. */
  workspacePin(revision?: number): VersionPin;
  close(): Promise<void>;
};

async function readWorkspaceRevision(base: TaskClaimFixture): Promise<number> {
  const key = canonicalRefKey(base.workspaceRef);
  const read = await base.records.readMany([key]);
  if (read.status !== 'ready') throw new Error(`S2C-P workspace read failed: ${JSON.stringify(read)}`);
  const record = read.value.records.find(candidate => candidate.refKey === key);
  if (record === undefined) throw new Error('S2C-P workspace record is absent');
  const decoded = decodeWorkspaceSnapshot(record);
  if (decoded.status !== 'decoded') throw new Error(`S2C-P workspace decode failed: ${decoded.reason}`);
  return decoded.value.revision;
}

export async function openPinsFixture(kind: ClaimFixtureKind = 'memory'): Promise<S2CPinsFixture> {
  const base = await createTaskClaimFixture(kind, PIN_FIXTURE_SCHEMAS);
  const sessions = base.sessionsPort;
  let clock = CLAIM_FIXTURE_AT;
  let current = await readWorkspaceRevision(base);
  const operator = base.ctx.principal.kind === 'host' ? base.ctx.principal.actor : undefined;
  if (operator === undefined) throw new Error('S2C-P fixture requires a host operator context');

  async function createWithProvenance(requestId: string, provenance: SessionProvenanceV1 | undefined): Promise<SessionRef> {
    const admitted = await sessions.admitSessionCreation(base.ctx, {
      meta: { requestId: `s2c-p-admit-${requestId}`, expected: [] },
      input: {
        workspace: base.scope, kernelStore: PIN_KERNEL_STORE, role: PIN_SESSION_ROLE,
        recommendedRefs: [], initialLinks: [],
        ...(provenance === undefined ? {} : { provenance }),
      },
    });
    if (admitted.status !== 'committed') {
      throw new Error(`S2C-P Session admission failed: ${JSON.stringify(admitted)}`);
    }
    const registered = await sessions.recordSessionCreated(base.ctx, {
      meta: { requestId: `s2c-p-register-${requestId}`, expected: [] },
      input: {
        operationRef: admitted.value.ref, sessionRef: admitted.value.action.plannedSessionRef,
        adapterId: PIN_KERNEL_STORE.adapterId, kernelSessionId: `s2c-p-kernel-${requestId}`,
        historyCursor: null, observedAt: CLAIM_FIXTURE_AT,
      },
    });
    if (registered.status !== 'committed') {
      throw new Error(`S2C-P Session registration failed: ${JSON.stringify(registered)}`);
    }
    return admitted.value.action.plannedSessionRef;
  }

  const pins = createLineSettingsService({
    records: base.records, sessionRead: sessions.readSession, now: () => clock,
    operatorActor: operator,
  });

  const agentCtx: CoreCallContext = {
    projectId: base.scope.projectId, workspaceId: base.scope.workspaceId,
    principal: { kind: 'work_run',
      runRef: { aggregateType: 'Run', projectId: base.scope.projectId, goalId: base.goalRef.goalId,
        runId: 's2c-p-agent-run' },
      roleBinding: base.roleBinding },
    materialReader: base.ctx.materialReader,
    signal: new AbortController().signal,
  };

  const readerDeps: WorkLineReaderDeps = {
    records: base.records as unknown as WorkLineStore,
    dutyFor: (async () => ({ status: 'ready', value: 'executor' })) as SessionDutyReadPort,
    undeliveredRepliesFor: () => undefined,
    sessionAnomaliesFor: () => ({} as SessionAnomalyPort),
  };
  const reader = createWorkLineReader(readerDeps);

  return {
    kind, base, scope: base.scope, pins, reader, operator,
    operatorCtx: base.ctx, agentCtx,
    revision: () => current,
    note: revision => { current = revision; },
    setClock: value => { clock = value; },
    createSession: requestId => createWithProvenance(requestId, undefined),
    createCopySession: requestId => createWithProvenance(requestId, {
      schemaVersion: 1, kind: 'readonly_copy', from: base.sessions.first,
      messageRef: { aggregateType: 'SessionMessage', projectId: base.scope.projectId,
        workspaceId: base.scope.workspaceId, messageId: `s2c-p-copy-message-${requestId}` },
    }),
    createContinuation: (requestId, from) => createWithProvenance(requestId, {
      schemaVersion: 1, kind: 'continuation', from, reason: 'archived', task: base.tasks.first,
    }),
    workspacePin: (revision = current): VersionPin => ({ ref: base.workspaceRef, revision }),
    close: () => base.close(),
  };
}

export type PinRequest = {
  add: SessionRef[];
  remove: SessionRef[];
  requestId: string;
  revision?: number;
};

/** Builds the `lines/pin` request for a revision; the caller records the result. */
export function pinRequest(f: S2CPinsFixture, input: PinRequest) {
  return {
    input: { workspace: f.scope, add: input.add, remove: input.remove },
    meta: { requestId: input.requestId, expected: [f.workspacePin(input.revision ?? f.revision())] },
  };
}

/** Asserts a committed pin write, records the new revision and returns the value. */
export function acceptPin(f: S2CPinsFixture, result: WriteResult<WorkspaceSnapshot>): WorkspaceSnapshot {
  if (result.status !== 'committed') {
    throw new Error(`expected a committed pin write, got ${JSON.stringify(result)}`);
  }
  f.note(result.value.revision);
  return result.value;
}

/** Creates `count` plain Sessions through the real services. */
export async function createPlainSessions(f: S2CPinsFixture, count: number,
  prefix = 'pin'): Promise<SessionRef[]> {
  const created: SessionRef[] = [];
  for (let index = 0; index < count; index += 1) created.push(await f.createSession(`${prefix}-${index}`));
  return created;
}
