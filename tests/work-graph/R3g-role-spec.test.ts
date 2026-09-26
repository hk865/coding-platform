import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type { EncodedRecord, PreparedCommit, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { GOAL_RECORD_SCHEMAS, encodeProjectSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { ROLE_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/role-record-codecs.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { makeCommitCursor, seqOfCommitCursor, type ProjectSnapshot } from '../../src/contracts/ledger.js';
import { coordinationPolicyContentDigest, type CoordinationPolicyContentV1,
  type CoordinationPolicyRevisionSnapshot, type ProjectCoordinationPolicyActiveSnapshot }
  from '../../src/contracts/human-role-collaboration.js';
import { roleSpecContentDigest, type RoleSpecContentV1, type RoleSpecPinV1,
  type InstallRoleSpecRevisionCommand, type ActivateRoleSpecRevisionCommand }
  from '../../src/contracts/role-spec.js';
import type { RoleBindingRefV1 } from '../../src/contracts/dispatch.js';

const at = '2026-09-24T00:00:00.000Z';
const projectId = 'r3g-roles';
const actor = { kind: 'human' as const, id: 'role-admin' };
const project: ProjectSnapshot = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
const ctx: CoreCallContext = { projectId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, actor }, signal: new AbortController().signal };
const content: RoleSpecContentV1 = { schemaVersion: 1, label: 'Builder', purpose: 'Build assigned work',
  responsibility: ['execution'], requiredMaterials: [{ kind: 'contract', reason: 'Follow the task contract' }],
  optionalMaterials: [], permissions: { tools: ['read', 'edit'], writeScope: 'workspace' },
  budget: { source: 'task-budget', scope: 'assigned-task' },
  requiredOutputs: [{ kind: 'implementation-result', reason: 'Deliver a result' }],
  exit: { success: 'Result accepted', stop: 'Budget or permission exhausted', handoff: 'State remaining work' } };
const schemas: RecordBackendSchemas = { records: [...GOAL_RECORD_SCHEMAS.records, ...ROLE_RECORD_SCHEMAS.records],
  events: [...GOAL_RECORD_SCHEMAS.events, ...ROLE_RECORD_SCHEMAS.events,
    { eventType: 'ScopeSeeded', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }],
  lookups: [] };
const key = (ref: object) => canonicalJson(ref as JsonValue);
const encode = (snapshot: { ref: object; revision: number }): EncodedRecord => ({
  refKey: key(snapshot.ref), schemaId: `${(snapshot.ref as { aggregateType: string }).aggregateType}Snapshot@1`,
  revision: snapshot.revision, json: JSON.stringify(snapshot),
});
const seedProject: PreparedCommit = { identityKey: 'r3g-project-seed', fingerprint: 'r3g-project-seed-v1',
  guards: [{ refKey: key(project.ref), expectedRevision: null }], records: [encodeProjectSnapshot(project)],
  events: [{ eventId: 'r3g-project-seed-event', eventType: 'ScopeSeeded', schemaVersion: 1, occurredAt: at,
    json: JSON.stringify({ eventId: 'r3g-project-seed-event', eventType: 'ScopeSeeded', schemaVersion: 1,
      occurredAt: at }) }], claims: [], indexGuards: [], indexChanges: [] };

function installCommand(revision: number, id: string,
  spec: RoleSpecContentV1 = content, roleId = 'builder'): InstallRoleSpecRevisionCommand {
  return { commandId: id, commandType: 'InstallRoleSpecRevision', schemaVersion: 1,
    identity: { projectId, actor, idempotencyKey: id }, correlationId: id, submittedAt: at,
    payload: { roleId, revision, content: spec,
      contentDigest: roleSpecContentDigest(spec, roleId, revision) } };
}
function activateCommand(pin: RoleSpecPinV1, id: string): ActivateRoleSpecRevisionCommand {
  return { commandId: id, commandType: 'ActivateRoleSpecRevision', schemaVersion: 1,
    identity: { projectId, actor, idempotencyKey: id }, aggregateId: pin.ref.roleId, expectedRevision: 1,
    correlationId: id, submittedAt: at, payload: { target: { ref: { ...pin.ref }, digest: pin.digest } } };
}
function binding(revision: number, policyRevision: string): RoleBindingRefV1 {
  return { schemaVersion: 1, bindingId: `binding-builder-${revision}`, templateId: 'builder',
    templateRevision: String(revision), bindingVersion: 1, policyRevision };
}
function policyRecords(pin: RoleSpecPinV1, policyId = 'roles-policy') {
  const ref = { aggregateType: 'CoordinationPolicyRevision' as const, projectId, policyId, revision: 1 };
  const activeRef = { aggregateType: 'ProjectCoordinationPolicyActive' as const, projectId };
  const policyContent: CoordinationPolicyContentV1 = { schemaVersion: 1,
    budget: { maxAutonomousReworks: 0, maxClarifications: 0 },
    allowed: { inScopeRework: false, inScopeTesting: true },
    scope: { changesRequireHumanDecision: ['requirement', 'acceptance', 'baseline'] },
    upgrade: { path: 'manual-decision', note: 'Ask a human' },
    roles: { catalog: { builder: pin }, coordinator: { roleId: 'builder', note: 'Own delivery' } } };
  const revision: CoordinationPolicyRevisionSnapshot = { ref, revision: 1, schemaVersion: 1,
    policyId, contentRevision: 1, content: policyContent,
    contentDigest: coordinationPolicyContentDigest(policyContent, policyId, 1), installedAt: at };
  const active: ProjectCoordinationPolicyActiveSnapshot = { ref: activeRef, projectId,
    activeRevision: ref, revision: 1 };
  return { revision, active };
}
type Backend = ReturnType<typeof createInMemoryRecordBackend>;
async function seedPolicy(backend: Backend, pin: RoleSpecPinV1) {
  const { revision, active } = policyRecords(pin);
  const event = { eventId: 'r3g-policy-seed-event', eventType: 'ScopeSeeded', schemaVersion: 1, occurredAt: at };
  return backend.records.commit({ identityKey: 'r3g-policy-seed', fingerprint: 'r3g-policy-seed-v1',
    guards: [revision.ref, active.ref].map(ref => ({ refKey: key(ref), expectedRevision: null })),
    records: [encode(revision), encode(active)], events: [{ ...event, json: JSON.stringify(event) }],
    claims: [], indexGuards: [], indexChanges: [] });
}
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

it.each(['memory', 'sqlite'] as const)('%s: role install, active pin and matrix resolution use canonical Store facts', async kind => {
  const dir = kind === 'sqlite' ? await mkdtemp(join(tmpdir(), 'next-r3g-role-')) : null;
  if (dir !== null) dirs.push(dir);
  const backend = kind === 'memory' ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ path: join(dir!, 'records.sqlite'), schemas });
  try {
    expect(await backend.records.commit(seedProject)).toMatchObject({ status: 'committed' });
    let sequence = 0;
    const roles = createRoleConfigurationService({ records: backend.records, now: () => at,
      eventId: () => `r3g-role-${++sequence}` });
    const command = installCommand(1, 'install-builder-1');
    const installed = await roles.installRoleSpec(ctx, command);
    expect(installed).toMatchObject({ status: 'committed', replayed: false,
      revisionRef: { aggregateType: 'RoleSpecRevision', projectId, roleId: 'builder', revision: 1 },
      contentDigest: command.payload.contentDigest });
    if (installed.status !== 'committed') throw Error('role install did not commit');
    const pin = { ref: installed.revisionRef, digest: installed.contentDigest };
    expect(await roles.installRoleSpec(ctx, command)).toMatchObject({ status: 'committed', replayed: true,
      revisionRef: installed.revisionRef, commitCursor: installed.commitCursor });
    expect(await backend.records.readMany([key({ aggregateType: 'ProjectRoleSpecActive', projectId,
      roleId: 'builder' })])).toMatchObject({ status: 'ready', value: { missing: [
      key({ aggregateType: 'ProjectRoleSpecActive', projectId, roleId: 'builder' }),
    ] } });
    expect(await roles.readRoleSpec(ctx, { pin })).toMatchObject({ status: 'ready', value: {
      ref: pin.ref, contentRevision: 1, contentDigest: pin.digest, content,
    } });
    expect(await roles.resolveRoleBinding(ctx, { roleBinding: binding(1, 'legacy-template'),
      declaredPermissions: { tools: ['read'], writeScope: [] } })).toMatchObject({ status: 'ready',
      value: { status: 'absent' } });

    expect(await seedPolicy(backend, pin)).toMatchObject({ status: 'committed' });
    expect(await roles.resolveRoleBinding(ctx, { roleBinding: binding(1, 'matrix:roles-policy@1#' + pin.digest.slice(0, 16)),
      declaredPermissions: { tools: ['read'], writeScope: [] } })).toMatchObject({ status: 'ready',
      value: { status: 'inadmissible', reasons: [{ detail: 'role_spec_stale' }] } });

    const active = await roles.activateRoleSpec(ctx, activateCommand(pin, 'activate-builder-1'));
    expect(active).toMatchObject({ status: 'committed', replayed: false, activeRevision: pin.ref });
    if (active.status !== 'committed') throw Error('role activation did not commit');
    expect(await roles.activateRoleSpec(ctx, activateCommand(pin, 'activate-builder-1')))
      .toMatchObject({ status: 'committed', replayed: true, commitCursor: active.commitCursor });
    const policyOrigin = `matrix:roles-policy@1#${pin.digest.slice(0, 16)}`;
    expect(await roles.resolveRoleBinding(ctx, { roleBinding: binding(1, policyOrigin),
      declaredPermissions: { tools: ['read'], writeScope: [] } })).toMatchObject({ status: 'ready',
      value: { status: 'resolved', roleId: 'builder', revision: pin.ref, spec: content } });
    expect(await roles.resolveRoleBinding(ctx, { roleBinding: binding(1, policyOrigin),
      declaredPermissions: { tools: ['delete'], writeScope: [] } })).toMatchObject({ status: 'ready',
      value: { status: 'inadmissible', reasons: [{ code: 'role_binding_not_admissible',
        detail: 'permissions_exceed_spec' }] } });
    // policyRevision records issuance provenance, not an authorization grant.
    expect(await roles.resolveRoleBinding(ctx, { roleBinding: binding(1, 'arbitrary-caller-marker'),
      declaredPermissions: { tools: ['delete'], writeScope: [] } })).toMatchObject({ status: 'ready',
      value: { status: 'inadmissible', reasons: [{ detail: 'permissions_exceed_spec' }] } });
    // Workspace writeScope is an allowed category here; it is not a path grant.
    expect(await roles.resolveRoleBinding(ctx, { roleBinding: binding(1, policyOrigin),
      declaredPermissions: { tools: [], writeScope: ['/workspace'] } })).toMatchObject({ status: 'ready',
      value: { status: 'resolved' } });
    expect(await roles.resolveRoleBinding(ctx, { roleBinding: { ...binding(1, policyOrigin),
      templateId: 'unregistered' }, declaredPermissions: { tools: [], writeScope: [] } }))
      .toMatchObject({ status: 'ready', value: { status: 'inadmissible', reasons: [
        { code: 'role_binding_not_admissible', detail: 'role_not_registered' },
      ] } });

    const second = await roles.installRoleSpec(ctx, installCommand(2, 'install-builder-2'));
    expect(second).toMatchObject({ status: 'committed', revisionRef: { revision: 2 } });
    if (second.status !== 'committed') throw Error('second role revision did not commit');
    expect(await roles.readRoleSpec(ctx, { pin })).toMatchObject({ status: 'ready',
      value: { ref: pin.ref, contentDigest: pin.digest } });
    expect(await roles.resolveRoleBinding(ctx, { roleBinding: binding(2, policyOrigin),
      declaredPermissions: { tools: [], writeScope: [] } })).toMatchObject({ status: 'ready',
      value: { status: 'inadmissible', reasons: [{ detail: 'role_spec_stale' }] } });
    expect(await roles.activateRoleSpec(ctx, activateCommand({ ref: second.revisionRef,
      digest: second.contentDigest }, 'activate-builder-2'))).toMatchObject({ status: 'committed' });
    expect(await roles.resolveRoleBinding(ctx, { roleBinding: binding(1, policyOrigin),
      declaredPermissions: { tools: [], writeScope: [] } })).toMatchObject({ status: 'ready',
      value: { status: 'inadmissible', reasons: [{ detail: 'role_spec_stale' }] } });
    expect(await roles.readRoleSpec(ctx, { pin })).toMatchObject({ status: 'ready', value: { ref: pin.ref } });
  } finally { await backend.close(); }
});

it.each(['memory', 'sqlite'] as const)('%s: role commands reject stale identity and one CAS contender loses', async kind => {
  const dir = kind === 'sqlite' ? await mkdtemp(join(tmpdir(), 'next-r3g-guards-')) : null;
  if (dir !== null) dirs.push(dir);
  const backend = kind === 'memory' ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ path: join(dir!, 'records.sqlite'), schemas });
  try {
    expect(await backend.records.commit(seedProject)).toMatchObject({ status: 'committed' });
    let sequence = 0;
    const roles = createRoleConfigurationService({ records: backend.records, now: () => at,
      eventId: () => `r3g-guards-${++sequence}` });
    const first = installCommand(1, 'guards-install-1');
    const wrongDigest = { ...first, commandId: 'bad-digest',
      identity: { ...first.identity, idempotencyKey: 'bad-digest' },
      payload: { ...first.payload, contentDigest: '0'.repeat(64) } };
    expect(await roles.installRoleSpec(ctx, wrongDigest)).toMatchObject({ status: 'rejected',
      code: 'digest_mismatch' });
    const malformed = { ...first, commandId: 'bad-content',
      identity: { ...first.identity, idempotencyKey: 'bad-content' },
      payload: { ...first.payload, content: { ...content, requiredOutputs: [] } } };
    malformed.payload.contentDigest = roleSpecContentDigest(malformed.payload.content, 'builder', 1);
    expect(await roles.installRoleSpec(ctx, malformed)).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await roles.installRoleSpec({ ...ctx, projectId: 'another-project' }, first))
      .toMatchObject({ status: 'rejected' });
    expect(await roles.installRoleSpec({ ...ctx, principal: { kind: 'host',
      actor: { kind: 'human', id: 'another-human' } } }, first)).toMatchObject({ status: 'rejected' });
    const installed1 = await roles.installRoleSpec(ctx, first);
    const installed2 = await roles.installRoleSpec(ctx, installCommand(2, 'guards-install-2'));
    expect(installed1).toMatchObject({ status: 'committed' });
    expect(installed2).toMatchObject({ status: 'committed' });
    if (installed1.status !== 'committed' || installed2.status !== 'committed') throw Error('install failed');
    const differentContent = { ...content, label: 'Different builder' };
    expect(await roles.installRoleSpec(ctx, { ...first, payload: { ...first.payload,
      content: differentContent, contentDigest: roleSpecContentDigest(differentContent, 'builder', 1) } }))
      .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    const pin1 = { ref: installed1.revisionRef, digest: installed1.contentDigest };
    const pin2 = { ref: installed2.revisionRef, digest: installed2.contentDigest };
    expect(await roles.readRoleSpec({ ...ctx, projectId: 'another-project' }, { pin: pin1 }))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await roles.activateRoleSpec({ ...ctx, principal: { kind: 'host',
      actor: { kind: 'system', id: 'other-actor' } } }, activateCommand(pin1, 'wrong-actor-activation')))
      .toMatchObject({ status: 'rejected' });
    expect(await roles.installRoleSpec({ ...ctx, principal: { kind: 'work_run',
      runRef: { aggregateType: 'Run', projectId, goalId: 'g', runId: 'r' },
      roleBinding: binding(1, 'legacy-mark') } }, installCommand(3, 'run-cannot-install')))
      .toMatchObject({ status: 'rejected' });
    expect(await roles.readRoleSpec(ctx, { pin: { ...pin1, digest: 'wrong' } }))
      .toMatchObject({ status: 'rejected' });
    expect(await roles.readRoleSpec(ctx, { pin: { ref: { ...pin1.ref, revision: 9 },
      digest: pin1.digest } })).toMatchObject({ status: 'not_found' });
    expect(await roles.activateRoleSpec(ctx, activateCommand({ ...pin1, digest: 'wrong' },
      'bad-activation'))).toMatchObject({ status: 'rejected', code: 'digest_mismatch' });
    const [left, right] = await Promise.all([
      roles.activateRoleSpec(ctx, activateCommand(pin1, 'cas-left')),
      roles.activateRoleSpec(ctx, activateCommand(pin2, 'cas-right')),
    ]);
    expect([left, right].filter(result => result.status === 'committed')).toHaveLength(1);
    expect([left, right].filter(result => result.status === 'rejected'))
      .toMatchObject([{ status: 'rejected', code: 'revision_conflict' }]);
    const activeKey = key({ aggregateType: 'ProjectRoleSpecActive', projectId, roleId: 'builder' });
    const active = await backend.records.readMany([activeKey]);
    expect(active).toMatchObject({ status: 'ready', value: { records: [{ revision: 1 }] } });
    if (active.status !== 'ready') throw Error('active pointer cannot be read');
    const winner = left.status === 'committed' ? left.activeRevision : right.status === 'committed'
      ? right.activeRevision : null;
    expect(JSON.parse(active.value.records[0]!.json).activeRevision).toEqual(winner);
    // Extra review case: different roles install concurrently and own distinct
    // active aggregates. A project-wide lock or shared role key would reject one.
    const verifier = installCommand(1, 'install-verifier', { ...content, label: 'Verifier' }, 'verifier');
    const reviewer = installCommand(1, 'install-reviewer', { ...content, label: 'Reviewer' }, 'reviewer');
    const [installedVerifier, installedReviewer] = await Promise.all([
      roles.installRoleSpec(ctx, verifier), roles.installRoleSpec(ctx, reviewer),
    ]);
    expect(installedVerifier).toMatchObject({ status: 'committed',
      revisionRef: { roleId: 'verifier', revision: 1 } });
    expect(installedReviewer).toMatchObject({ status: 'committed',
      revisionRef: { roleId: 'reviewer', revision: 1 } });
    if (installedVerifier.status !== 'committed' || installedReviewer.status !== 'committed') {
      throw Error('independent role install failed');
    }
    const verifierPin = { ref: installedVerifier.revisionRef, digest: installedVerifier.contentDigest };
    const reviewerPin = { ref: installedReviewer.revisionRef, digest: installedReviewer.contentDigest };
    const [verifierActive, reviewerActive] = await Promise.all([
      roles.activateRoleSpec(ctx, activateCommand(verifierPin, 'activate-verifier')),
      roles.activateRoleSpec(ctx, activateCommand(reviewerPin, 'activate-reviewer')),
    ]);
    expect(verifierActive).toMatchObject({ status: 'committed', activeRevision: verifierPin.ref });
    expect(reviewerActive).toMatchObject({ status: 'committed', activeRevision: reviewerPin.ref });
    const independent = await backend.records.readMany([activeKey,
      key({ aggregateType: 'ProjectRoleSpecActive', projectId, roleId: 'verifier' }),
      key({ aggregateType: 'ProjectRoleSpecActive', projectId, roleId: 'reviewer' })]);
    expect(independent).toMatchObject({ status: 'ready', value: { records: [
      { revision: 1 }, { revision: 1 }, { revision: 1 },
    ] } });
    if (independent.status !== 'ready') throw Error('independent role pointers unavailable');
    expect(JSON.parse(independent.value.records[0]!.json).activeRevision).toEqual(winner);
    expect(JSON.parse(independent.value.records[1]!.json).activeRevision).toEqual(verifierPin.ref);
    expect(JSON.parse(independent.value.records[2]!.json).activeRevision).toEqual(reviewerPin.ref);
  } finally { await backend.close(); }
});

it.each(['memory', 'sqlite'] as const)('%s: a matrix pin without an installed spec is inadmissible', async kind => {
  const dir = kind === 'sqlite' ? await mkdtemp(join(tmpdir(), 'next-r3g-uninstalled-')) : null;
  if (dir !== null) dirs.push(dir);
  const backend = kind === 'memory' ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ path: join(dir!, 'records.sqlite'), schemas });
  try {
    expect(await backend.records.commit(seedProject)).toMatchObject({ status: 'committed' });
    const proposedPin: RoleSpecPinV1 = { ref: { aggregateType: 'RoleSpecRevision', projectId,
      roleId: 'builder', revision: 1 }, digest: roleSpecContentDigest(content, 'builder', 1) };
    expect(await seedPolicy(backend, proposedPin)).toMatchObject({ status: 'committed' });
    const roles = createRoleConfigurationService({ records: backend.records, now: () => at,
      eventId: () => 'r3g-uninstalled-event' });
    expect(await roles.resolveRoleBinding(ctx, { roleBinding: binding(1, 'old-compatible-mark'),
      declaredPermissions: { tools: ['read'], writeScope: [] } })).toMatchObject({ status: 'ready',
      value: { status: 'inadmissible', reasons: [{ code: 'role_binding_not_admissible',
        detail: 'role_spec_not_installed' }] } });
  } finally { await backend.close(); }
});

it.each(['memory', 'sqlite'] as const)('%s: an unregistered coordination schema cannot mean no matrix', async kind => {
  const dir = kind === 'sqlite' ? await mkdtemp(join(tmpdir(), 'next-r3g-unknown-schema-')) : null;
  if (dir !== null) dirs.push(dir);
  const incompleteSchemas: RecordBackendSchemas = { ...schemas,
    records: schemas.records.filter(schema => schema.aggregateType !== 'ProjectCoordinationPolicyActive') };
  const backend = kind === 'memory' ? createInMemoryRecordBackend({ schemas: incompleteSchemas })
    : createSqliteRecordBackend({ path: join(dir!, 'records.sqlite'), schemas: incompleteSchemas });
  try {
    expect(await backend.records.commit(seedProject)).toMatchObject({ status: 'committed' });
    const roles = createRoleConfigurationService({ records: backend.records, now: () => at,
      eventId: () => 'r3g-unknown-schema-event' });
    expect(await roles.resolveRoleBinding(ctx, { roleBinding: binding(1, 'legacy-mark'),
      declaredPermissions: { tools: [], writeScope: [] } })).toMatchObject({ status: 'rejected' });
  } finally { await backend.close(); }
});

it('sqlite: installed and activated role survives reopening the physical Store', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'next-r3g-reopen-'));
  dirs.push(dir);
  const path = join(dir, 'records.sqlite');
  const first = createSqliteRecordBackend({ path, schemas });
  let pin: RoleSpecPinV1;
  try {
    expect(await first.records.commit(seedProject)).toMatchObject({ status: 'committed' });
    const roles = createRoleConfigurationService({ records: first.records, now: () => at,
      eventId: () => 'r3g-reopen-first-event' });
    const installed = await roles.installRoleSpec(ctx, installCommand(1, 'reopen-install'));
    expect(installed).toMatchObject({ status: 'committed' });
    if (installed.status !== 'committed') throw Error('install before reopen failed');
    pin = { ref: installed.revisionRef, digest: installed.contentDigest };
    expect(await roles.activateRoleSpec(ctx, activateCommand(pin, 'reopen-activate')))
      .toMatchObject({ status: 'committed' });
    expect(await seedPolicy(first, pin)).toMatchObject({ status: 'committed' });
  } finally { await first.close(); }
  const reopened = createSqliteRecordBackend({ path, schemas });
  try {
    const roles = createRoleConfigurationService({ records: reopened.records, now: () => at,
      eventId: () => 'r3g-reopen-second-event' });
    expect(await roles.readRoleSpec(ctx, { pin: pin! })).toMatchObject({ status: 'ready',
      value: { ref: pin!.ref, contentDigest: pin!.digest } });
    expect(await roles.resolveRoleBinding(ctx, { roleBinding: binding(1, 'old-compatible-mark'),
      declaredPermissions: { tools: ['read'], writeScope: [] } })).toMatchObject({ status: 'ready',
      value: { status: 'resolved', revision: pin!.ref } });
    expect(await roles.installRoleSpec(ctx, installCommand(1, 'reopen-install')))
      .toMatchObject({ status: 'committed', replayed: true });
    expect(await roles.activateRoleSpec(ctx, activateCommand(pin!, 'reopen-activate')))
      .toMatchObject({ status: 'committed', replayed: true });
  } finally { await reopened.close(); }
});

it.each(['memory', 'sqlite'] as const)('%s: verified absence differs from corrupt role governance', async kind => {
  const dir = kind === 'sqlite' ? await mkdtemp(join(tmpdir(), 'next-r3g-corrupt-')) : null;
  if (dir !== null) dirs.push(dir);
  // A permissive physical codec represents an already persisted legacy/bad
  // row. The service must decode canonical governance itself and fail closed.
  const corruptSchemas: RecordBackendSchemas = { ...schemas,
    records: schemas.records.map(schema => schema.aggregateType === 'ProjectCoordinationPolicyActive'
      ? { ...schema, validate: (record: EncodedRecord) => ({ status: 'decoded' as const, value: record }) }
      : schema) };
  const backend = kind === 'memory' ? createInMemoryRecordBackend({ schemas: corruptSchemas })
    : createSqliteRecordBackend({ path: join(dir!, 'records.sqlite'), schemas: corruptSchemas });
  try {
    expect(await backend.records.commit(seedProject)).toMatchObject({ status: 'committed' });
    const roles = createRoleConfigurationService({ records: backend.records, now: () => at,
      eventId: () => 'r3g-corrupt-service-event' });
    const request = { roleBinding: binding(1, 'legacy-mark'),
      declaredPermissions: { tools: [] as string[], writeScope: [] as string[] } };
    // Extra review case: malformed or omitted declaredPermissions must never
    // be defaulted to the empty set, even when this project has no matrix.
    const malformedRequests: unknown[] = [
      { roleBinding: binding(1, 'legacy-mark') },
      { roleBinding: binding(1, 'legacy-mark'), declaredPermissions: { tools: 'read', writeScope: [] } },
      { roleBinding: binding(1, 'legacy-mark'), declaredPermissions: { tools: [], writeScope: 'workspace' } },
      { roleBinding: binding(1, 'legacy-mark'), declaredPermissions: { tools: [], writeScope: [17] } },
    ];
    for (const malformed of malformedRequests) {
      expect(await roles.resolveRoleBinding(ctx, malformed as Parameters<typeof roles.resolveRoleBinding>[1]))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
    }
    expect(await roles.resolveRoleBinding(ctx, request)).toMatchObject({ status: 'ready',
      value: { status: 'absent' } });
    const missingPin: RoleSpecPinV1 = { ref: { aggregateType: 'RoleSpecRevision', projectId,
      roleId: 'builder', revision: 1 }, digest: '0'.repeat(64) };
    expect(await roles.readRoleSpec(ctx, { pin: missingPin })).toMatchObject({ status: 'not_found' });
    const current = await backend.records.readMany([key(project.ref)]);
    expect(current).toMatchObject({ status: 'ready' });
    if (current.status !== 'ready' || current.value.readThrough === null) throw Error('Store watermark unavailable');
    const future = makeCommitCursor(seqOfCommitCursor(current.value.readThrough) + 1_000);
    expect(await roles.readRoleSpec(ctx, { pin: missingPin }, { atLeastCursor: future }))
      .toMatchObject({ status: 'not_ready', required: { kind: 'platform', cursor: future } });
    const corruptRef = { aggregateType: 'ProjectCoordinationPolicyActive', projectId };
    const missingPolicyRef = { aggregateType: 'CoordinationPolicyRevision', projectId,
      policyId: 'missing-policy', revision: 1 };
    const missingEvent = { eventId: 'r3g-missing-policy-event', eventType: 'ScopeSeeded',
      schemaVersion: 1, occurredAt: at };
    expect(await backend.records.commit({ identityKey: 'r3g-missing-policy-seed',
      fingerprint: 'r3g-missing-policy-seed-v1',
      guards: [{ refKey: key(corruptRef), expectedRevision: null }],
      records: [{ refKey: key(corruptRef), schemaId: 'ProjectCoordinationPolicyActiveSnapshot@1',
        revision: 1, json: JSON.stringify({ ref: corruptRef, projectId, revision: 1,
          activeRevision: missingPolicyRef }) }],
      events: [{ ...missingEvent, json: JSON.stringify(missingEvent) }],
      claims: [], indexGuards: [], indexChanges: [] })).toMatchObject({ status: 'committed' });
    expect(await roles.resolveRoleBinding(ctx, request)).toMatchObject({ status: 'rejected' });
    const corruptEvent = { eventId: 'r3g-corrupt-seed-event', eventType: 'ScopeSeeded',
      schemaVersion: 1, occurredAt: at };
    expect(await backend.records.commit({ identityKey: 'r3g-corrupt-seed', fingerprint: 'r3g-corrupt-seed-v1',
      guards: [{ refKey: key(corruptRef), expectedRevision: 1 }],
      records: [{ refKey: key(corruptRef), schemaId: 'ProjectCoordinationPolicyActiveSnapshot@1',
        revision: 2, json: JSON.stringify({ ref: corruptRef, projectId, revision: 2,
          activeRevision: null }) }],
      events: [{ ...corruptEvent, json: JSON.stringify(corruptEvent) }],
      claims: [], indexGuards: [], indexChanges: [] })).toMatchObject({ status: 'committed' });
    expect(await roles.resolveRoleBinding(ctx, request)).toMatchObject({ status: 'rejected' });
  } finally { await backend.close(); }
});

it.each(['memory', 'sqlite'] as const)('%s: review race never combines a stale matrix with a newer Store watermark', async kind => {
  const dir = kind === 'sqlite' ? await mkdtemp(join(tmpdir(), 'next-r3g-window-')) : null;
  if (dir !== null) dirs.push(dir);
  const backend = kind === 'memory' ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ path: join(dir!, 'records.sqlite'), schemas });
  try {
    expect(await backend.records.commit(seedProject)).toMatchObject({ status: 'committed' });
    let sequence = 0;
    const roles = createRoleConfigurationService({ records: backend.records, now: () => at,
      eventId: () => `r3g-window-${++sequence}` });
    const installed = await roles.installRoleSpec(ctx, installCommand(1, 'window-install'));
    expect(installed).toMatchObject({ status: 'committed' });
    if (installed.status !== 'committed') throw Error('window role install failed');
    const pin = { ref: installed.revisionRef, digest: installed.contentDigest };
    expect(await roles.activateRoleSpec(ctx, activateCommand(pin, 'window-activate')))
      .toMatchObject({ status: 'committed' });
    expect(await seedPolicy(backend, pin)).toMatchObject({ status: 'committed' });

    const old = policyRecords(pin).revision;
    const nextRef = { ...old.ref, revision: 2 };
    const nextContent: CoordinationPolicyContentV1 = { ...old.content };
    delete nextContent.roles;
    const nextPolicy: CoordinationPolicyRevisionSnapshot = { ...old, ref: nextRef, contentRevision: 2,
      content: nextContent, contentDigest: coordinationPolicyContentDigest(nextContent, old.policyId, 2) };
    const nextEvent = { eventId: 'r3g-next-policy-event', eventType: 'ScopeSeeded',
      schemaVersion: 1, occurredAt: at };
    expect(await backend.records.commit({ identityKey: 'r3g-next-policy', fingerprint: 'r3g-next-policy-v1',
      guards: [{ refKey: key(nextRef), expectedRevision: null }], records: [encode(nextPolicy)],
      events: [{ ...nextEvent, json: JSON.stringify(nextEvent) }],
      claims: [], indexGuards: [], indexChanges: [] })).toMatchObject({ status: 'committed' });

    const activeKey = key({ aggregateType: 'ProjectCoordinationPolicyActive', projectId });
    let advancePolicy = true;
    const racing = createRoleConfigurationService({ records: {
      ...backend.records,
      async readMany(keys) {
        const batch = await backend.records.readMany(keys);
        if (advancePolicy && batch.status === 'ready' && keys.includes(activeKey)) {
          advancePolicy = false;
          const event = { eventId: 'r3g-policy-swap-event', eventType: 'ScopeSeeded',
            schemaVersion: 1, occurredAt: at };
          const swapped = { ref: { aggregateType: 'ProjectCoordinationPolicyActive', projectId },
            projectId, revision: 2, activeRevision: nextRef };
          expect(await backend.records.commit({ identityKey: 'r3g-policy-swap', fingerprint: 'r3g-policy-swap-v1',
            guards: [{ refKey: activeKey, expectedRevision: 1 }],
            records: [encode(swapped)],
            events: [{ ...event, json: JSON.stringify(event) }],
            claims: [], indexGuards: [], indexChanges: [] })).toMatchObject({ status: 'committed' });
        }
        return batch;
      },
    }, now: () => at, eventId: () => `r3g-race-${++sequence}` });
    const result = await racing.resolveRoleBinding(ctx, { roleBinding: binding(1, 'legacy-mark'),
      declaredPermissions: { tools: ['read'], writeScope: [] } });
    expect(advancePolicy).toBe(false);
    if (result.status === 'ready') expect(result.value.status).toBe('absent');
    else expect(result.status).toBe('rejected');
  } finally { await backend.close(); }
});

it.each(['memory', 'sqlite'] as const)('%s: review mutation after invocation cannot rewrite role commands', async kind => {
  const dir = kind === 'sqlite' ? await mkdtemp(join(tmpdir(), 'next-r3g-input-')) : null;
  if (dir !== null) dirs.push(dir);
  const backend = kind === 'memory' ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ path: join(dir!, 'records.sqlite'), schemas });
  try {
    expect(await backend.records.commit(seedProject)).toMatchObject({ status: 'committed' });
    let sequence = 0;
    const roles = createRoleConfigurationService({ records: backend.records, now: () => at,
      eventId: () => `r3g-input-${++sequence}` });
    const mutableContent = structuredClone(content);
    const command = installCommand(1, 'input-install', mutableContent);
    const originalDigest = command.payload.contentDigest;
    const pendingInstall = roles.installRoleSpec(ctx, command);
    mutableContent.label = 'Mutated after invocation';
    mutableContent.permissions.tools.push('delete');
    const installed = await pendingInstall;
    expect(installed).toMatchObject({ status: 'committed', contentDigest: originalDigest });
    if (installed.status !== 'committed') throw Error('role input was not cloned');
    const pin = { ref: installed.revisionRef, digest: originalDigest };
    expect(await roles.readRoleSpec(ctx, { pin })).toMatchObject({ status: 'ready',
      value: { content: content, contentDigest: originalDigest } });
    const readOptions = { atLeastCursor: installed.commitCursor };
    const pendingRead = roles.readRoleSpec(ctx, { pin }, readOptions);
    readOptions.atLeastCursor = makeCommitCursor(seqOfCommitCursor(installed.commitCursor) + 1_000);
    expect(await pendingRead).toMatchObject({ status: 'ready', value: { ref: pin.ref } });
    const commandToActivate = activateCommand(pin, 'input-activate');
    const pendingActivate = roles.activateRoleSpec(ctx, commandToActivate);
    commandToActivate.payload.target.ref.revision = 2;
    commandToActivate.payload.target.digest = '0'.repeat(64);
    expect(await pendingActivate).toMatchObject({ status: 'committed', activeRevision: pin.ref });
    expect(await backend.records.readMany([key({ aggregateType: 'ProjectRoleSpecActive', projectId,
      roleId: 'builder' })])).toMatchObject({ status: 'ready', value: { records: [
      { revision: 1, json: expect.any(String) },
    ] } });
  } finally { await backend.close(); }
});

it.each(['memory', 'sqlite'] as const)('%s: review replay rejects an event attributed to another actor', async kind => {
  const dir = kind === 'sqlite' ? await mkdtemp(join(tmpdir(), 'next-r3g-replay-actor-')) : null;
  if (dir !== null) dirs.push(dir);
  const backend = kind === 'memory' ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ path: join(dir!, 'records.sqlite'), schemas });
  try {
    expect(await backend.records.commit(seedProject)).toMatchObject({ status: 'committed' });
    let sequence = 0;
    const roles = createRoleConfigurationService({ records: backend.records, now: () => at,
      eventId: () => `r3g-replay-actor-${++sequence}` });
    const install = installCommand(1, 'actor-install');
    const installed = await roles.installRoleSpec(ctx, install);
    expect(installed).toMatchObject({ status: 'committed' });
    if (installed.status !== 'committed') throw Error('role install failed before replay check');
    const pin = { ref: installed.revisionRef, digest: installed.contentDigest };
    const activate = activateCommand(pin, 'actor-activate');
    expect(await roles.activateRoleSpec(ctx, activate)).toMatchObject({ status: 'committed' });
    const before = await backend.records.readMany([key(project.ref)]);
    expect(before).toMatchObject({ status: 'ready' });
    if (before.status !== 'ready') throw Error('ledger cursor unavailable');

    const alteredEventReader = createRoleConfigurationService({ records: {
      ...backend.records,
      async eventAt(cursor) {
        const stored = await backend.records.eventAt(cursor);
        if (stored.status !== 'ready') return stored;
        const body = JSON.parse(stored.value.event.json) as Record<string, unknown>;
        body.actor = { kind: 'human', id: 'other-actor' };
        return { status: 'ready' as const, value: { ...stored.value,
          event: { ...stored.value.event, json: JSON.stringify(body) } } };
      },
    }, now: () => at, eventId: () => `r3g-replay-read-${++sequence}` });
    expect(await alteredEventReader.installRoleSpec(ctx, install)).toMatchObject({ status: 'rejected' });
    expect(await alteredEventReader.activateRoleSpec(ctx, activate)).toMatchObject({ status: 'rejected' });
    const after = await backend.records.readMany([key(project.ref),
      key({ aggregateType: 'ProjectRoleSpecActive', projectId, roleId: 'builder' })]);
    expect(after).toMatchObject({ status: 'ready', value: { records: [
      { revision: 1 }, { revision: 1 },
    ], readThrough: before.value.readThrough } });
  } finally { await backend.close(); }
});
