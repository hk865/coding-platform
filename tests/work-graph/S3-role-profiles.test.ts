/**
 * Slice 3 §5.7, cases RP01–RP06 (6 semantic cases on both the memory and the
 * SQLite backend = 12 runs).
 *
 * The code under test is the real one:
 * - `platformRoleProfile` / `PlatformRoleProfileV1` (§2.5), the pure platform
 *   duty table (five duties, never a default member, never an install);
 * - the real role install/read service
 *   (`configuration/role-memory-service.ts`) over the real Memory/SQLite
 *   record stores;
 * - `validateRoleSpecContent` (`contracts/validation/role.ts`) for the closed
 *   duty enum;
 * - the production context assembler (`agent-runtime/context-assembler.ts`)
 *   for the role section RP01 checks (a part-1 stub, so RP01 fails with
 *   `not implemented: ContextAssembler.assembleTask`);
 * - `effectivePlatformDuty` (`state/context-input.ts`), a part-1 stub, so its
 *   cases fail with `not implemented: effectivePlatformDuty` (never with a
 *   setup error).
 *
 * The fixture values follow spec §5.1: scope `p/w`, the Workspace at revision 7,
 * the §2.5 duty table and the legacy `platform-*` templates with
 * `templateRevision: 's3.1'`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type {
  GoalRecordTransactionPort, PreparedCommit, RecordBackendSchemas,
} from '../../src/core/record-store/ports.js';
import {
  GOAL_RECORD_SCHEMAS, encodeProjectSnapshot, encodeWorkspaceSnapshot,
} from '../../src/core/work-graph/persistence/record-codecs.js';
import { ROLE_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/role-record-codecs.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { platformRoleProfile, type PlatformRoleProfileV1 } from '../../src/core/agent-runtime/role-profiles.js';
import { createContextAssembler } from '../../src/core/agent-runtime/context-assembler.js';
import { effectivePlatformDuty } from '../../src/core/work-graph/state/context-input.js';
import { validateRoleSpecContent } from '../../src/contracts/validation/role.js';
import type { ValidationIssue } from '../../src/contracts/validation/common.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import type { PlatformDutyV1 } from '../../src/contracts/platform-duty.js';
import type { ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import {
  roleSpecContentDigest, type InstallRoleSpecRevisionCommand, type RoleSpecContentV1, type RoleSpecPinV1,
} from '../../src/contracts/role-spec.js';

const at = '2026-09-24T00:00:00.000Z';
const projectId = 'p';
const workspaceId = 'w';
const actor = { kind: 'human' as const, id: 's3-role-admin' };
const ctx: CoreCallContext = { projectId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, actor }, signal: new AbortController().signal };
const projectRef = { aggregateType: 'Project' as const, projectId };
const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
const project: ProjectSnapshot = { ref: projectRef, revision: 1 };
// §5.1 unified fixture: the Workspace is seeded at revision 7.
const workspace: WorkspaceSnapshot = { ref: workspaceRef, revision: 7 };
const key = (ref: object): string => canonicalJson(ref as JsonValue);
const refKey = (ref: object): string => key(ref);

const schemas: RecordBackendSchemas = {
  records: [...GOAL_RECORD_SCHEMAS.records, ...ROLE_RECORD_SCHEMAS.records],
  events: [...GOAL_RECORD_SCHEMAS.events, ...ROLE_RECORD_SCHEMAS.events,
    { eventType: 'ScopeSeeded', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }],
  lookups: [],
};
const seedEvent = { eventId: 's3-role-seed-event', eventType: 'ScopeSeeded', schemaVersion: 1, occurredAt: at };
const seed: PreparedCommit = {
  identityKey: 's3-role-seed', fingerprint: 's3-role-seed-v1',
  guards: [{ refKey: refKey(projectRef), expectedRevision: null }, { refKey: refKey(workspaceRef), expectedRevision: null }],
  records: [encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspace)],
  events: [{ ...seedEvent, json: JSON.stringify(seedEvent) }],
  claims: [], indexGuards: [], indexChanges: [],
};

/** §2.5 exact configuration table. */
const DUTIES = ['executor', 'secretary', 'adviser', 'scribe', 'reviewer'] as const satisfies readonly PlatformDutyV1[];
const EXPECTED: Readonly<Record<PlatformDutyV1, {
  label: string; purpose: string; responsibility: string[]; behaviorSkillId: string; templateId: string;
}>> = {
  executor: { label: 'Executor', purpose: 'Execute the assigned task.', responsibility: ['execution'],
    behaviorSkillId: 'platform-work', templateId: 'platform-executor' },
  secretary: { label: 'Secretary', purpose: "Handle the user's bounded request.",
    responsibility: ['human_decision_support', 'planning'], behaviorSkillId: 'platform-secretary',
    templateId: 'platform-secretary' },
  adviser: { label: 'Adviser', purpose: 'Investigate technical choices and coordinate work.',
    responsibility: ['investigation', 'integration'], behaviorSkillId: 'platform-adviser',
    templateId: 'platform-adviser' },
  scribe: { label: 'Scribe', purpose: 'Check and consolidate project facts.',
    responsibility: ['fact_consolidation'], behaviorSkillId: 'platform-scribe', templateId: 'platform-scribe' },
  reviewer: { label: 'Reviewer', purpose: 'Review the assigned work independently.',
    responsibility: ['verification'], behaviorSkillId: 'platform-reviewer', templateId: 'platform-reviewer' },
};

/** A valid RoleSpec content for one duty; `platformDuty` is the §2.5 value. */
function contentFor(duty: PlatformDutyV1): RoleSpecContentV1 {
  const profile = platformRoleProfile(duty);
  return {
    schemaVersion: 1,
    platformDuty: duty,
    label: profile.label,
    purpose: profile.purpose,
    responsibility: [...profile.responsibility],
    requiredMaterials: [{ kind: 'contract', reason: 'Follow the assigned task contract' }],
    optionalMaterials: [],
    permissions: { tools: ['read'], writeScope: 'none' },
    budget: { source: 'task-budget', scope: 'assigned-task' },
    requiredOutputs: [{ kind: 'implementation-result', reason: 'Deliver a result' }],
    exit: { success: 'Result accepted', stop: 'Permission or budget exhausted', handoff: 'State the remaining work' },
  };
}

function installCommand(roleId: string, content: RoleSpecContentV1, id: string, revision = 1): InstallRoleSpecRevisionCommand {
  return {
    commandId: id, commandType: 'InstallRoleSpecRevision', schemaVersion: 1,
    identity: { projectId, actor, idempotencyKey: id }, correlationId: id, submittedAt: at,
    payload: { roleId, revision, content, contentDigest: roleSpecContentDigest(content, roleId, revision) },
  };
}

type Journal = { committedKeys: string[]; readKeys: string[] };

/** Observes the physical record calls of the real service without replacing it. */
function observeRecords(records: GoalRecordTransactionPort, journal: Journal): GoalRecordTransactionPort {
  return {
    readMany(refKeys) { journal.readKeys.push(...refKeys); return records.readMany(refKeys); },
    lookupCommit(input) { return records.lookupCommit(input); },
    commit(input) { journal.committedKeys.push(...input.records.map(record => record.refKey)); return records.commit(input); },
    eventAt(cursor) { return records.eventAt(cursor); },
  };
}

type Roles = ReturnType<typeof createRoleConfigurationService>;
type Backend = ReturnType<typeof createInMemoryRecordBackend> | ReturnType<typeof createSqliteRecordBackend>;

const dirs: string[] = [];
const backends: Backend[] = [];
afterEach(async () => {
  for (const backend of backends.splice(0)) await backend.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function openRoles(kind: 'memory' | 'sqlite'): Promise<{ backend: Backend; roles: Roles; journal: Journal }> {
  const dir = kind === 'sqlite' ? await mkdtemp(join(tmpdir(), 'next-s3-role-')) : null;
  if (dir !== null) dirs.push(dir);
  const backend: Backend = kind === 'memory' ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ path: join(dir!, 'records.sqlite'), schemas });
  backends.push(backend);
  const seeded = await backend.records.commit(seed);
  if (seeded.status !== 'committed') throw new Error(`the role profile fixture seed failed: ${seeded.reason}`);
  const journal: Journal = { committedKeys: [], readKeys: [] };
  let sequence = 0;
  const roles = createRoleConfigurationService({ records: observeRecords(backend.records, journal),
    now: () => at, eventId: () => `s3-role-${++sequence}` });
  return { backend, roles, journal };
}

describe.each(['memory', 'sqlite'] as const)('%s: S3 role profiles', kind => {
  it('RP01: the five duty profiles install and read explicitly, creating no Session and activating nothing', async () => {
    for (const duty of DUTIES) {
      const profile: PlatformRoleProfileV1 = platformRoleProfile(duty);
      const expected = EXPECTED[duty];
      expect(profile).toEqual({ duty, label: expected.label, purpose: expected.purpose,
        responsibility: expected.responsibility, behaviorSkillId: expected.behaviorSkillId,
        template: { kind: 'legacy_template', templateId: expected.templateId, templateRevision: 's3.1' } });
      // Fresh clone: a caller cannot rewrite the shared table.
      profile.responsibility.push('verification');
      expect(platformRoleProfile(duty).responsibility).toEqual(expected.responsibility);
    }
    const { backend, roles, journal } = await openRoles(kind);
    const installed: Array<{ duty: PlatformDutyV1; pin: RoleSpecPinV1 }> = [];
    for (const duty of DUTIES) {
      const expected = EXPECTED[duty];
      const content = contentFor(duty);
      const command = installCommand(expected.templateId, content, `rp01-install-${duty}`);
      const receipt = await roles.installRoleSpec(ctx, command);
      expect(receipt).toMatchObject({ status: 'committed', replayed: false,
        revisionRef: { aggregateType: 'RoleSpecRevision', projectId, roleId: expected.templateId, revision: 1 },
        contentDigest: command.payload.contentDigest });
      if (receipt.status !== 'committed') throw new Error(`RP01 install did not commit: ${receipt.code}`);
      installed.push({ duty, pin: { ref: receipt.revisionRef, digest: receipt.contentDigest } });
    }
    for (const { duty, pin } of installed) {
      const read = await roles.readRoleSpec(ctx, { pin });
      expect(read).toMatchObject({ status: 'ready', value: {
        roleId: EXPECTED[duty].templateId, contentRevision: 1, revision: 1,
        content: contentFor(duty), contentDigest: pin.digest } });
      if (read.status !== 'ready') throw new Error(`RP01 read was not ready: ${read.status}`);
      // The production assembler consumes the same configuration table: its role
      // section names this exact duty, label, purpose and responsibility. The
      // row is checked through the assembler, not only through the table.
      const assembled = await createContextAssembler({} as never).assembleTask(ctx, {
        execution: {} as never,
        role: { status: 'resolved', roleId: read.value.roleId, revision: read.value.ref, spec: read.value.content },
        configuration: {} as never,
        permissions: { policyRevision: 's3-role', tools: [], writeScope: [] },
      });
      expect(assembled).toMatchObject({ status: 'ready' });
      if (assembled.status !== 'ready') throw new Error(`RP01 assembler role section was not ready: ${assembled.status}`);
      const roleSection = assembled.value.input;
      expect(roleSection).toContain('## Runtime context');
      expect(roleSection).toContain(`duty: ${duty}`);
      expect(roleSection).toContain(`label: ${EXPECTED[duty].label}`);
      expect(roleSection).toContain(`purpose: ${EXPECTED[duty].purpose}`);
      for (const responsibility of EXPECTED[duty].responsibility) {
        expect(roleSection).toContain(responsibility);
      }
    }
    const activeKeys = DUTIES.map(duty => key({ aggregateType: 'ProjectRoleSpecActive', projectId, roleId: EXPECTED[duty].templateId }));
    expect(await backend.records.readMany(activeKeys)).toMatchObject({ status: 'ready', value: { missing: activeKeys } });
    // No Session record was written by the profile path.
    expect(journal.committedKeys.filter(entry => entry.includes('"aggregateType":"Session"'))).toEqual([]);
  });

  it('RP02: an old Role without a duty keeps its exact content digest and reads as executor', async () => {
    const { roles } = await openRoles(kind);
    const roleId = EXPECTED.executor.templateId;
    const legacy = contentFor('executor');
    delete legacy.platformDuty;
    expect(legacy).not.toHaveProperty('platformDuty');
    const command = installCommand(roleId, legacy, 'rp02-install-legacy');
    const expectedDigest = roleSpecContentDigest(legacy, roleId, 1);
    expect(expectedDigest).toBe(sha256Hex(canonicalJson({ schemaVersion: 1, roleId, revision: 1, content: legacy } as JsonValue)));
    const install = await roles.installRoleSpec(ctx, command);
    expect(install).toMatchObject({ status: 'committed', contentDigest: expectedDigest });
    if (install.status !== 'committed') throw new Error(`RP02 install did not commit: ${install.code}`);
    const pin = { ref: install.revisionRef, digest: install.contentDigest };
    const read = await roles.readRoleSpec(ctx, { pin });
    expect(read).toMatchObject({ status: 'ready', value: { content: legacy, contentDigest: expectedDigest } });
    if (read.status !== 'ready') throw new Error(`RP02 read was not ready: ${read.status}`);
    expect(read.value.content).not.toHaveProperty('platformDuty');
    // The optional duty is never written into old content, and no default is invented.
    expect(effectivePlatformDuty({ roleDuty: undefined, hostDuty: undefined }))
      .toMatchObject({ status: 'ready', value: 'executor' });
  });

  it('RP03: a coordinator duty is invalid and never commits', async () => {
    const { roles, journal } = await openRoles(kind);
    const content = { ...contentFor('executor'), platformDuty: 'coordinator' } as unknown as RoleSpecContentV1;
    const issues: ValidationIssue[] = [];
    validateRoleSpecContent(content, 'content', issues);
    expect(issues.map(issue => [issue.path, issue.code])).toEqual([['content.platformDuty', 'bad_enum']]);
    const commitsBefore = journal.committedKeys.length;
    expect(await roles.installRoleSpec(ctx, installCommand('platform-executor', content, 'rp03-install-coordinator')))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(journal.committedKeys.length).toBe(commitsBefore);
  });

  it('RP04: a repeated install identity replays the original receipt and does not rewrite the revision', async () => {
    const { backend, roles, journal } = await openRoles(kind);
    const roleId = EXPECTED.scribe.templateId;
    const command = installCommand(roleId, contentFor('scribe'), 'rp04-install-scribe');
    const first = await roles.installRoleSpec(ctx, command);
    expect(first).toMatchObject({ status: 'committed', replayed: false, contentDigest: command.payload.contentDigest });
    if (first.status !== 'committed') throw new Error(`RP04 first install did not commit: ${first.code}`);
    const commitsAfterFirst = journal.committedKeys.length;
    expect(await roles.installRoleSpec(ctx, command)).toMatchObject({ status: 'committed', replayed: true,
      revisionRef: first.revisionRef, contentDigest: first.contentDigest, commitCursor: first.commitCursor });
    expect(journal.committedKeys.length).toBe(commitsAfterFirst);
    expect(await roles.readRoleSpec(ctx, { pin: { ref: first.revisionRef, digest: first.contentDigest } }))
      .toMatchObject({ status: 'ready', value: { revision: 1, contentRevision: 1, contentDigest: first.contentDigest } });
    expect(await backend.records.readMany([refKey(first.revisionRef)]))
      .toMatchObject({ status: 'ready', value: { records: [{ revision: 1 }] } });
  });

  it('RP05: a resolved secretary with a Host adviser is forbidden and never switches duty', async () => {
    const { roles } = await openRoles(kind);
    const roleId = EXPECTED.secretary.templateId;
    const install = await roles.installRoleSpec(ctx, installCommand(roleId, contentFor('secretary'), 'rp05-install-secretary'));
    expect(install).toMatchObject({ status: 'committed' });
    if (install.status !== 'committed') throw new Error(`RP05 install did not commit: ${install.code}`);
    expect(await roles.readRoleSpec(ctx, { pin: { ref: install.revisionRef, digest: install.contentDigest } }))
      .toMatchObject({ status: 'ready', value: { content: { platformDuty: 'secretary' } } });
    expect(effectivePlatformDuty({ roleDuty: 'secretary', hostDuty: 'adviser' }))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
  });

  it('RP06: two configured skills add no second duty and the role pin is unchanged', async () => {
    const { roles } = await openRoles(kind);
    const roleId = EXPECTED.secretary.templateId;
    const install = await roles.installRoleSpec(ctx, installCommand(roleId, contentFor('secretary'), 'rp06-install-secretary'));
    expect(install).toMatchObject({ status: 'committed' });
    if (install.status !== 'committed') throw new Error(`RP06 install did not commit: ${install.code}`);
    const pin = { ref: install.revisionRef, digest: install.contentDigest };
    // AG6 may configure several behaviour skills at once. The role is pinned to
    // one duty (secretary) and the trusted configuration enables exactly the two
    // profile skills `platform-secretary` and `platform-scribe`.
    const configuredSkills = ['platform-work',
      platformRoleProfile('secretary').behaviorSkillId, platformRoleProfile('scribe').behaviorSkillId];
    expect(configuredSkills).toEqual(['platform-work', 'platform-secretary', 'platform-scribe']);
    // Each duty profile still names exactly one skill and one duty.
    expect([platformRoleProfile('secretary').behaviorSkillId, platformRoleProfile('scribe').behaviorSkillId])
      .toEqual(['platform-secretary', 'platform-scribe']);
    expect([platformRoleProfile('secretary').duty, platformRoleProfile('scribe').duty]).toEqual(['secretary', 'scribe']);
    // The two configured skills never add a second platformDuty to the immutable
    // revision, and the Session role is still the one immutable pin: reading it
    // back through the Session's role ref yields the pin's secretary duty.
    const sessionRole: RoleConfigurationRef = { kind: 'role_spec', pin };
    expect(await roles.readRoleSpec(ctx, { pin: sessionRole.pin })).toMatchObject({ status: 'ready', value: {
      ref: { aggregateType: 'RoleSpecRevision', projectId, roleId: EXPECTED.secretary.templateId, revision: 1 },
      content: { platformDuty: 'secretary' }, contentDigest: pin.digest } });
    // The effective duty is the one duty of the pin, whatever skills are loaded.
    expect(effectivePlatformDuty({ roleDuty: 'secretary', hostDuty: 'secretary' }))
      .toMatchObject({ status: 'ready', value: 'secretary' });
    // §2.5: the legacy Session role stays the immutable legacy template of the
    // pin; the two skills switch neither the duty nor the template revision.
    expect(platformRoleProfile('secretary').template).toEqual({
      kind: 'legacy_template', templateId: EXPECTED.secretary.templateId, templateRevision: 's3.1' });
  });
});
