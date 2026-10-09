/**
 * Wiring package 1, W17 (wiring-1-SPEC §2.4, §4.1, rows DU01-DU09; L5/L6).
 *
 * `createSessionDutyResolver` reads only the Session's own fixed role facts:
 * a `role_spec` Session reads the pinned RoleSpec content's `platformDuty`, a
 * `legacy_template` Session is recognized by its exact platform template, and
 * the effective duty is decided by Slice-3 `effectivePlatformDuty`. When both
 * sides are absent the Slice-1 fallback applies (the role equals a Host Work
 * binding's `sessionRole` -> `executor`, otherwise `unknown`) and never the
 * Slice-3 default `executor`. Every outcome is `{status:'ready', value}`; read
 * failures, a missing ctx and throws all read as `'unknown'`.
 *
 * DU01-DU08 use plain `readRoleSpec` doubles and one literal
 * `WorkflowHostConfiguration`; DU09 drives the real maintenance service from
 * `openDutyMaintenanceFixture()`. DU01-DU08 fail RED on the production stub
 * throw; DU09 fails RED because the missing duty rule archives nothing yet.
 */
import { expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RoleBindingRefV1, TaskBudgetV1 } from '../../src/contracts/dispatch.js';
import type { PlatformDutyV1 } from '../../src/contracts/platform-duty.js';
import type { RoleSpecContentV1, RoleSpecPinV1, RoleSpecRevisionSnapshot } from '../../src/contracts/role-spec.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import type { RoleConfigurationPort } from '../../src/core/work-graph/model/configuration-contracts.js';
import { createSessionDutyResolver } from '../../src/composition/session-duty.js';
import { openDutyMaintenanceFixture } from '../helpers/WP1-units-fixture.js';

const PROJECT = 'du-project';
const WORKSPACE = 'du-workspace';
const T0 = '2026-10-08T00:00:00.000Z';
const operator = { kind: 'human' as const, id: 'du-operator' };
const ctx: CoreCallContext = {
  projectId: PROJECT, workspaceId: WORKSPACE,
  principal: { kind: 'host', actor: operator },
  materialReader: { kind: 'host', projectId: PROJECT, workspaceId: WORKSPACE, actor: operator },
  signal: new AbortController().signal,
};
const workspace: WorkspaceScope = { projectId: PROJECT, workspaceId: WORKSPACE };
const roleBinding: RoleBindingRefV1 = { schemaVersion: 1, bindingId: 'du-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'du-policy' };
const budget: TaskBudgetV1 = { tokenBudget: 4096, deadline: null };

type RoleSpecRef = Extract<RoleConfigurationRef, { kind: 'role_spec' }>;
type ReadRoleSpec = RoleConfigurationPort['readRoleSpec'];

function roleSpecRef(roleId: string): RoleSpecRef {
  return { kind: 'role_spec', pin: {
    ref: { aggregateType: 'RoleSpecRevision', projectId: PROJECT, roleId, revision: 1 },
    digest: `du-digest-${roleId}`,
  } };
}
function legacyRole(templateId: string, templateRevision: string): RoleConfigurationRef {
  return { kind: 'legacy_template', templateId, templateRevision };
}
function roleContent(platformDuty?: PlatformDutyV1): RoleSpecContentV1 {
  return {
    schemaVersion: 1,
    ...(platformDuty === undefined ? {} : { platformDuty }),
    label: 'Wiring-1 duty role',
    purpose: 'Own the assigned task',
    responsibility: ['execution'],
    requiredMaterials: [{ kind: 'contract', reason: 'Read the assigned Plan/Task' }],
    optionalMaterials: [],
    permissions: { tools: ['read'], writeScope: 'none' },
    budget: { source: 'task-budget', scope: 'assigned-task' },
    requiredOutputs: [{ kind: 'implementation-result', reason: 'Report actual results' }],
    exit: { success: 'Report the result', stop: 'Report the blocker', handoff: 'Keep references' },
  };
}
function roleSpecReady(role: RoleSpecRef, content: RoleSpecContentV1): ReadResult<RoleSpecRevisionSnapshot> {
  return { status: 'ready', value: { ref: role.pin.ref, revision: 1, schemaVersion: 1, roleId: role.pin.ref.roleId,
    contentRevision: 1, content, contentDigest: role.pin.digest, installedAt: T0 } };
}
function configurationWith(roles: readonly RoleConfigurationRef[]): WorkflowHostConfiguration {
  return { consumerId: 'du-consumer', bindings: roles.map((sessionRole, i) => ({
    workspace, sessionRole, roleBinding: { ...roleBinding, bindingId: `du-binding-${String(i + 1)}` }, budget })) };
}
function legacyOnlyReadRoleSpec(): ReadRoleSpec {
  return async (): Promise<ReadResult<RoleSpecRevisionSnapshot>> => {
    throw new Error('a legacy template must not be read as a RoleSpec');
  };
}

it('DU01 a pinned role_spec platformDuty decides and the owner sees the same ctx and pin', async () => {
  const role = roleSpecRef('r-du01');
  const readRoleSpec = vi.fn(async (_ctx: CoreCallContext, _input: { pin: RoleSpecPinV1 }):
  Promise<ReadResult<RoleSpecRevisionSnapshot>> => roleSpecReady(role, roleContent('secretary')));
  const resolver = createSessionDutyResolver({ readRoleSpec, configuration: configurationWith([role]) });
  expect(await resolver(role, ctx)).toEqual({ status: 'ready', value: 'secretary' });
  expect(readRoleSpec).toHaveBeenCalledTimes(1);
  expect(readRoleSpec.mock.calls[0]?.[0]).toBe(ctx);
  expect(readRoleSpec.mock.calls[0]?.[1]).toEqual({ pin: role.pin });
});

it('DU02 a pinned role_spec without platformDuty falls back to the Host Work binding executor rule', async () => {
  const role = roleSpecRef('r-du02');
  const readRoleSpec = vi.fn(async (): Promise<ReadResult<RoleSpecRevisionSnapshot>> =>
    roleSpecReady(role, roleContent()));
  const resolver = createSessionDutyResolver({ readRoleSpec, configuration: configurationWith([role]) });
  expect(await resolver(role, ctx)).toEqual({ status: 'ready', value: 'executor' });
  expect(readRoleSpec).toHaveBeenCalledTimes(1);
});

it('DU03 a pinned role_spec without platformDuty outside the Work bindings is unknown', async () => {
  const role = roleSpecRef('r-du03');
  const readRoleSpec = vi.fn(async (): Promise<ReadResult<RoleSpecRevisionSnapshot>> =>
    roleSpecReady(role, roleContent()));
  const resolver = createSessionDutyResolver({ readRoleSpec, configuration: configurationWith([roleSpecRef('r-other')]) });
  expect(await resolver(role, ctx)).toEqual({ status: 'ready', value: 'unknown' });
});

it('DU04 role_spec read failures are a ready unknown, never a rejection or a throw', async () => {
  const role = roleSpecRef('r-du04');
  const configuration = configurationWith([role]);
  const notFound = createSessionDutyResolver({ configuration,
    readRoleSpec: async (): Promise<ReadResult<RoleSpecRevisionSnapshot>> => ({ status: 'not_found' }) });
  expect(await notFound(role, ctx)).toEqual({ status: 'ready', value: 'unknown' });

  const unavailable = createSessionDutyResolver({ configuration,
    readRoleSpec: async (): Promise<ReadResult<RoleSpecRevisionSnapshot>> =>
      ({ status: 'rejected', code: 'unavailable', reason: 'du-unavailable' }) });
  expect(await unavailable(role, ctx)).toEqual({ status: 'ready', value: 'unknown' });

  const throws = createSessionDutyResolver({ configuration,
    readRoleSpec: async (): Promise<ReadResult<RoleSpecRevisionSnapshot>> => { throw new Error('du-boom'); } });
  await expect(throws(role, ctx)).resolves.toEqual({ status: 'ready', value: 'unknown' });
});

it('DU05 the exact platform-reviewer@s3.1 legacy template resolves to reviewer', async () => {
  const role = legacyRole('platform-reviewer', 's3.1');
  const readRoleSpec = vi.fn(legacyOnlyReadRoleSpec());
  const resolver = createSessionDutyResolver({ readRoleSpec, configuration: configurationWith([role]) });
  expect(await resolver(role, ctx)).toEqual({ status: 'ready', value: 'reviewer' });
  expect(readRoleSpec).not.toHaveBeenCalled();
});

it('DU06 builder@1 is an executor only while a Work binding names it', async () => {
  const role = legacyRole('builder', '1');
  const readRoleSpec = vi.fn(legacyOnlyReadRoleSpec());
  const bound = createSessionDutyResolver({ readRoleSpec, configuration: configurationWith([role]) });
  expect(await bound(role, ctx)).toEqual({ status: 'ready', value: 'executor' });

  const unbound = createSessionDutyResolver({ readRoleSpec,
    configuration: configurationWith([legacyRole('builder', '2')]) });
  expect(await unbound(role, ctx)).toEqual({ status: 'ready', value: 'unknown' });
});

it('DU07 platform-secretary@s3.0 is not one of the five platform templates and stays unknown', async () => {
  const role = legacyRole('platform-secretary', 's3.0');
  const readRoleSpec = vi.fn(legacyOnlyReadRoleSpec());
  const resolver = createSessionDutyResolver({ readRoleSpec,
    configuration: configurationWith([legacyRole('platform-secretary', 's3.1')]) });
  expect(await resolver(role, ctx)).toEqual({ status: 'ready', value: 'unknown' });
});

it('DU08 a role_spec without ctx is unknown and the owner is not read', async () => {
  const role = roleSpecRef('r-du08');
  const readRoleSpec = vi.fn(async (): Promise<ReadResult<RoleSpecRevisionSnapshot>> =>
    roleSpecReady(role, roleContent('secretary')));
  const resolver = createSessionDutyResolver({ readRoleSpec, configuration: configurationWith([role]) });
  expect(await resolver(role)).toEqual({ status: 'ready', value: 'unknown' });
  expect(readRoleSpec).not.toHaveBeenCalled();
});

it('DU09 the real maintenance archives the executor line and keeps the secretary line active', async () => {
  const f = await openDutyMaintenanceFixture();
  try {
    const duty = createSessionDutyResolver({ readRoleSpec: f.readRoleSpec, configuration: f.configuration });
    const result = await f.withSessionDuty(duty).maintainSessions(f.ctx, { workspace: f.scope, after: null });
    expect(result).toMatchObject({ status: 'ready', value: { archived: [f.S2] } });
    const s1 = await f.readSession(f.S1);
    expect(s1).toMatchObject({ status: 'ready', value: { record: { lifecycle: 'active' } } });
  } finally {
    await f.close();
  }
});
