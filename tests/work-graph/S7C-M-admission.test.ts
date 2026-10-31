/**
 * M-admission (book-7c.md:1356): the one shared Host/Role judgment and the Query role projection.
 *
 * `hostRolePermissionsAdmitted` is the one pure judgment `recheckHostRoleAdmission` and L1's composition adapter call;
 * its cases are A5. `rolePayload` renders exactly the permission object it is handed: the two Query recipes construct
 * the three-field `RolePayloadPermissionsV1` (a fourth field is a TypeScript error there), while the Work caller passes
 * the full envelope, so a Work render carries `createMember` and a Query render does not.
 *
 * DEFERRED (L1): the public-start half of M-admission — a real preparation handing out `createMember: true`, the Host
 * grant then narrowed, the next `workflow/advance` start refused through the public path — is L1's, because
 * `create-platform.ts:660-666` is L1's wiring. It is not faked here.
 */
import { describe, expect, it } from 'vitest';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import { rolePayload, type RolePayloadPermissionsV1 } from '../../src/core/agent-runtime/context-fact-text.js';
import { hostRolePermissionsAdmitted } from '../../src/core/work-graph/tasks/pick-authorization.js';

const ROLE = { status: 'absent' as const, roleId: 'builder', reason: 'the trusted legacy template' };
const queryPermissions: RolePayloadPermissionsV1 = { policyRevision: 'p', tools: ['read'], writeScope: [] };

const permissions = (overrides: Partial<TaskEnvelopeV1['permissions']> = {}): TaskEnvelopeV1['permissions'] => ({
  policyRevision: 'p', tools: ['read'], writeScope: [], createMember: false, ...overrides,
});
const host = (overrides: Record<string, unknown> = {}) => ({
  tools: ['read', 'shell'], writeScope: ['.'], shellWorkspaceAccess: 'all_except_denied' as const, createMember: false,
  ...overrides,
});
const role = (overrides: Record<string, unknown> = {}) => ({ tools: ['read', 'shell'], writeScope: ['.'], ...overrides });

const ADMISSION_CASES: ReadonlyArray<readonly [string, {
  permissions: TaskEnvelopeV1['permissions']; host: ReturnType<typeof host>; role: ReturnType<typeof role> | null;
}, RegExp | null]> = [
  ['an ordinary read-only executor grant', { permissions: permissions(), host: host(), role: role() }, null],
  ['a createMember grant the Host also holds', {
    permissions: permissions({ createMember: true }), host: host({ createMember: true }), role: role() }, null],
  ['a createMember grant while the Host grant is false', {
    permissions: permissions({ createMember: true }), host: host({ createMember: false }), role: role() },
  /not allowed by the current Host and Role ceilings/],
  ['a createMember grant while the Host grant is absent', {
    permissions: permissions({ createMember: true }), host: host({ createMember: undefined }), role: role() },
  /not allowed by the current Host and Role ceilings/],
  ['a tool the Host does not hold', {
    permissions: permissions({ tools: ['write'] }), host: host(), role: role() },
  /not allowed by the current Host and Role ceilings/],
  ['a tool the Role does not hold', {
    permissions: permissions({ tools: ['write'] }), host: host({ tools: ['read', 'write', 'shell'] }), role: role() },
  /not allowed by the current Host and Role ceilings/],
  ['a write scope the Host does not hold', {
    permissions: permissions({ writeScope: ['other'] }), host: host(), role: role() },
  /not allowed by the current Host and Role ceilings/],
  ['a write under a Role whose write scope is none', {
    permissions: permissions({ writeScope: ['.'] }), host: host(), role: role({ writeScope: 'none' }) },
  /not allowed by the current Host and Role ceilings/],
  ['an empty write scope under a Role whose write scope is none', {
    permissions: permissions({ writeScope: [] }), host: host(), role: role({ writeScope: 'none' }) }, null],
  ['shell with the canonical single-dot scope and the Host shell clause', {
    permissions: permissions({ tools: ['shell'], writeScope: ['.'] }), host: host(), role: role() }, null],
  ['shell without the Host shell clause', {
    permissions: permissions({ tools: ['shell'], writeScope: ['.'] }), host: host({ shellWorkspaceAccess: undefined }), role: role() },
  /not allowed by the current Host and Role ceilings/],
];

describe('M-admission: hostRolePermissionsAdmitted', () => {
  it.each(ADMISSION_CASES)('judges %s', (_label, input, expected) => {
    const result = hostRolePermissionsAdmitted(input);
    if (expected === null) expect(result).toEqual({ ok: true });
    else expect(result).toMatchObject({ ok: false, code: 'forbidden', reason: expected });
  });
});

// Both recipes type their local as RolePayloadPermissionsV1 (three fields); a fourth field there is a type error.
describe('M-admission: the Query role projection', () => {
  it('renders the Query three fields and the Work four fields exactly as handed', () => {
    const query = rolePayload(ROLE, queryPermissions, 'adviser', 4_096);
    expect(query).toContain('{"policyRevision":"p","tools":["read"],"writeScope":[]}');
    expect(query).not.toContain('createMember');

    const workPermissions: TaskEnvelopeV1['permissions'] = { ...queryPermissions, createMember: true };
    const work = rolePayload(ROLE, workPermissions, 'executor', 4_096);
    expect(work).toContain('{"policyRevision":"p","tools":["read"],"writeScope":[],"createMember":true}');
  });
});
