/** One SQLite composition root owns role configuration and observed source facts.
 * The Project/Workspace seed below is a fixture, not a production bootstrap API. */
import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { PersistedSourceCaptureRef } from '../../src/contracts/core/source.js';
import type { ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { InstallRoleSpecRevisionCommand, ActivateRoleSpecRevisionCommand,
  RoleSpecContentV1, RoleSpecPinV1 } from '../../src/contracts/role-spec.js';
import { roleSpecContentDigest } from '../../src/contracts/role-spec.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { GOAL_RECORD_SCHEMAS, canonicalRefKey, encodeProjectSnapshot,
  encodeWorkspaceSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { OBSERVED_ARCHITECTURE_RECORD_SCHEMAS } from '../../src/core/work-graph/architecture/architecture-record-codecs.js';
import { PLAN_GOVERNANCE_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-readers.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';

const at = '2026-09-24T00:00:00.000Z';
const projectId = 'composed-roles-architecture';
const workspaceId = 'main';
const scope = { projectId, workspaceId };
const actor = { kind: 'human' as const, id: 'composition-owner' };
const ctx: CoreCallContext = { projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };
const content: RoleSpecContentV1 = { schemaVersion: 1, label: 'Builder', purpose: 'Build assigned work',
  responsibility: ['execution'], requiredMaterials: [{ kind: 'contract', reason: 'Read task contract' }],
  optionalMaterials: [], permissions: { tools: ['read', 'edit'], writeScope: 'workspace' },
  budget: { source: 'task-budget', scope: 'assigned-task' },
  requiredOutputs: [{ kind: 'implementation-result', reason: 'Deliver implementation' }],
  exit: { success: 'Delivered', stop: 'Stopped', handoff: 'Describe remaining work' } };
const project: ProjectSnapshot = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
const workspace: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', ...scope }, revision: 1 };
const mappings = [
  { id: 'Alpha', kind: 'module' as const, paths: ['src/alpha.ts'] },
  { id: 'Beta', kind: 'module' as const, paths: ['src/beta.ts'] },
];
const seedSchemas: RecordBackendSchemas = { records: GOAL_RECORD_SCHEMAS.records,
  events: [...GOAL_RECORD_SCHEMAS.events, { eventType: 'TrustedCompositionScopeSeeded', schemaVersion: 1,
    validate: event => ({ status: 'decoded', value: event }) }], lookups: [] };
const inspectSchemas: RecordBackendSchemas = {
  records: [...GOAL_RECORD_SCHEMAS.records, ...PLAN_GOVERNANCE_RECORD_SCHEMAS.records,
    ...OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.records],
  events: [...GOAL_RECORD_SCHEMAS.events, ...OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.events],
  lookups: OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.lookups ?? [],
};
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

function installRole(): InstallRoleSpecRevisionCommand {
  return { commandId: 'composed-install-builder', commandType: 'InstallRoleSpecRevision', schemaVersion: 1,
    identity: { projectId, actor, idempotencyKey: 'composed-install-builder' },
    correlationId: 'composed-install-builder', submittedAt: at,
    payload: { roleId: 'builder', revision: 1, content,
      contentDigest: roleSpecContentDigest(content, 'builder', 1) } };
}
function activateRole(pin: RoleSpecPinV1): ActivateRoleSpecRevisionCommand {
  return { commandId: 'composed-activate-builder', commandType: 'ActivateRoleSpecRevision', schemaVersion: 1,
    identity: { projectId, actor, idempotencyKey: 'composed-activate-builder' },
    aggregateId: 'builder', expectedRevision: 1, correlationId: 'composed-activate-builder', submittedAt: at,
    payload: { target: pin } };
}
const capture = (requestId: string, previous: PersistedSourceCaptureRef | null = null) => ({
  meta: { requestId, expected: [] }, input: { workspace: scope, mappings, previous },
});

it('keeps role pins and both observed architecture versions after restart without replay recapture', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'next-composed-r3d-r3g-'));
  directories.push(directory);
  await mkdir(join(directory, 'src'));
  const files = new Map<string, string>([
    ['tsconfig.json', JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', noLib: true },
      include: ['src/**/*.ts'] })],
    ['src/alpha.ts', 'import { beta } from "./beta";\nexport function alpha() { return beta(); }\n'],
    ['src/beta.ts', 'import { alpha } from "./alpha";\nexport function beta() { return alpha(); }\n'],
  ]);
  await Promise.all([...files].map(([name, body]) => writeFile(join(directory, name), body)));
  const databasePath = join(directory, 'ledger.sqlite');
  const seedBackend = createSqliteRecordBackend({ path: databasePath, schemas: seedSchemas });
  try {
    const event = { eventId: 'composed-scope-seed', eventType: 'TrustedCompositionScopeSeeded',
      schemaVersion: 1, occurredAt: at };
    expect(await seedBackend.records.commit({ identityKey: 'composed-scope-seed', fingerprint: 'composed-scope-seed-v1',
      guards: [{ refKey: canonicalRefKey(project.ref), expectedRevision: null },
        { refKey: canonicalRefKey(workspace.ref), expectedRevision: null }],
      records: [encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspace)],
      events: [{ ...event, json: JSON.stringify(event) }], claims: [], indexGuards: [], indexChanges: [],
    })).toMatchObject({ status: 'committed' });
  } finally { await seedBackend.close(); }

  let authorizationGate: Promise<void> | null = null;
  let authorizationEntered: (() => void) | null = null;
  const host: WorkspaceHostBindings = {
    async resolveRoot(requested) { return requested.projectId === projectId && requested.workspaceId === workspaceId
      ? { status: 'ready', value: { root: directory, workspaceRevision: 1 } }
      : { status: 'rejected', code: 'forbidden', reason: 'unknown workspace' }; },
    async authorize(bound, requested) {
      const permitted = bound.projectId === projectId && bound.workspaceId === workspaceId &&
      bound.principal.kind === 'host' && bound.principal.actor.id === actor.id &&
      bound.materialReader.kind === 'host' && bound.materialReader.actor.id === actor.id &&
      requested.projectId === projectId && requested.workspaceId === workspaceId;
      if (!permitted) return { status: 'rejected', code: 'forbidden', reason: 'no current source read grant' };
      if (authorizationGate !== null) {
        authorizationEntered?.();
        await authorizationGate;
      }
      return { status: 'ready', value: { subjectKey: 'composed-human-reader', permissionRevision: 'read-v1',
        allowsRead: (path: string) => files.has(path) } };
    },
  };
  const options = { storage: { kind: 'sqlite' as const, directory }, workspace: host, now: () => at,
    architectureSource: { provider: 'typescript' as const, configPath: 'tsconfig.json' } };
  const first = await createTargetPlatform(options);
  let pin: RoleSpecPinV1;
  let firstCapture: Awaited<ReturnType<typeof first.architecture.captureSourceChanges>>;
  let secondCapture: Awaited<ReturnType<typeof first.architecture.captureSourceChanges>>;
  try {
    const installed = await first.roles.installRoleSpec(ctx, installRole());
    expect(installed).toMatchObject({ status: 'committed', replayed: false,
      revisionRef: { aggregateType: 'RoleSpecRevision', projectId, roleId: 'builder', revision: 1 },
      contentDigest: installRole().payload.contentDigest });
    if (installed.status !== 'committed') throw Error('role install failed');
    pin = { ref: installed.revisionRef, digest: installed.contentDigest };
    expect(await first.roles.activateRoleSpec(ctx, activateRole(pin))).toMatchObject({ status: 'committed',
      replayed: false, activeRevision: pin.ref });
    expect(await first.roles.readRoleSpec(ctx, { pin })).toMatchObject({ status: 'ready', value: {
      ref: pin.ref, content: content, contentDigest: pin.digest,
    } });
    firstCapture = await first.architecture.captureSourceChanges(ctx, capture('composed-observe-a'));
    expect(firstCapture).toMatchObject({ status: 'committed', replayed: false });
    if (firstCapture.status !== 'committed') throw Error('first capture failed');
    const before = await first.architecture.queryArchitecture(ctx, { selection: {
      kind: 'observed', capture: firstCapture.value }, depth: 2, relations: ['dependency'], page: { limit: 20 } });
    expect(before).toMatchObject({ status: 'ready', value: { noVerdict: true,
      nodes: [{ nodeId: 'module:Alpha' }, { nodeId: 'module:Beta' }] } });
    if (before.status !== 'ready') throw Error('first graph unavailable');
    expect(before.value.edges.map(edge => [edge.fromNode, edge.toNode])).toEqual(expect.arrayContaining([
      ['module:Alpha', 'module:Beta'], ['module:Beta', 'module:Alpha'],
    ]));

    const changed = 'export function beta() { return 2; }\n';
    files.set('src/beta.ts', changed);
    await writeFile(join(directory, 'src/beta.ts'), changed);
    secondCapture = await first.architecture.captureSourceChanges(ctx,
      capture('composed-observe-b', firstCapture.value));
    expect(secondCapture).toMatchObject({ status: 'committed', replayed: false });
    if (secondCapture.status !== 'committed') throw Error('second capture failed');
    const comparison = await first.architecture.compareArchitecture(ctx, {
      before: { kind: 'observed', capture: firstCapture.value },
      after: { kind: 'observed', capture: secondCapture.value },
    });
    expect(comparison).toMatchObject({ status: 'ready', value: { noVerdict: true } });
    if (comparison.status !== 'ready') throw Error('comparison unavailable');
    expect(comparison.value.changes.length).toBeGreaterThan(0);
  } finally { await first.close(); }

  const reopened = await createTargetPlatform(options);
  try {
    expect(await reopened.roles.readRoleSpec(ctx, { pin: pin! })).toMatchObject({ status: 'ready', value: {
      ref: pin!.ref, contentDigest: pin!.digest, content,
    } });
    expect(await reopened.roles.installRoleSpec(ctx, installRole())).toMatchObject({ status: 'committed',
      replayed: true, revisionRef: pin!.ref });
    expect(await reopened.roles.activateRoleSpec(ctx, activateRole(pin!))).toMatchObject({ status: 'committed',
      replayed: true, activeRevision: pin!.ref });
    if (firstCapture!.status !== 'committed' || secondCapture!.status !== 'committed') throw Error('capture missing');
    const historical = await reopened.architecture.queryArchitecture(ctx, { selection: {
      kind: 'observed', capture: firstCapture!.value }, depth: 2, relations: ['dependency'], page: { limit: 20 } });
    expect(historical).toMatchObject({ status: 'ready', value: { noVerdict: true,
      nodes: [{ nodeId: 'module:Alpha' }, { nodeId: 'module:Beta' }] } });
    if (historical.status !== 'ready') throw Error('historical graph unavailable');
    expect(historical.value.edges.map(edge => [edge.fromNode, edge.toNode])).toEqual(expect.arrayContaining([
      ['module:Alpha', 'module:Beta'], ['module:Beta', 'module:Alpha'],
    ]));
    const replay = await reopened.architecture.captureSourceChanges(ctx, capture('composed-observe-a'));
    expect(replay).toMatchObject({ status: 'committed', replayed: true,
      value: firstCapture!.value, cursor: firstCapture!.cursor });

    // A historical read owns its Host authorization and body access until it
    // finishes. close() must drain that call before closing those resources.
    let releaseAuthorization!: () => void;
    authorizationGate = new Promise<void>(resolve => { releaseAuthorization = resolve; });
    const authorizationStarted = new Promise<void>(resolve => { authorizationEntered = resolve; });
    const historicalInput = { selection: { kind: 'observed' as const, capture: firstCapture!.value },
      depth: 2, relations: ['dependency' as const], page: { limit: 20 } };
    const inFlight = reopened.architecture.queryArchitecture(ctx, historicalInput);
    try {
      await authorizationStarted;
      let closed = false;
      const closing = reopened.close().then(() => { closed = true; });
      await Promise.resolve();
      expect(closed).toBe(false);
      releaseAuthorization();
      expect(await inFlight).toMatchObject({ status: 'ready', value: { noVerdict: true,
        nodes: [{ nodeId: 'module:Alpha' }, { nodeId: 'module:Beta' }] } });
      await closing;
      expect(await reopened.architecture.queryArchitecture(ctx, historicalInput))
        .toMatchObject({ status: 'rejected', code: 'unavailable' });
    } finally {
      releaseAuthorization();
      authorizationGate = null;
      authorizationEntered = null;
    }
  } finally { await reopened.close(); }

  const inspect = createSqliteRecordBackend({ path: databasePath, schemas: inspectSchemas });
  try {
    const currentRef = { aggregateType: 'WorkspaceArchitectureObservationCurrent', ...scope };
    const observed = await inspect.records.readMany([canonicalJson(currentRef as JsonValue)]);
    expect(observed).toMatchObject({ status: 'ready', value: { records: [{ revision: 2 }] } });
    if (observed.status !== 'ready') throw Error('current observation unavailable');
    expect(observed.value.readThrough).toBe(secondCapture!.status === 'committed' ? secondCapture!.cursor : null);
    const current = JSON.parse(observed.value.records[0]!.json);
    expect(current.observedRef).toEqual({ aggregateType: 'ObservedArchitecture', ...scope,
      captureId: secondCapture!.status === 'committed' ? secondCapture!.value.capture.captureId : '' });
    expect(await inspect.records.readMany([canonicalJson({ aggregateType: 'ProjectArchitectureBaselineActive',
      projectId } as JsonValue)])).toMatchObject({ status: 'ready', value: { records: [],
      missing: [canonicalJson({ aggregateType: 'ProjectArchitectureBaselineActive', projectId } as JsonValue)] } });
  } finally { await inspect.close(); }
});
