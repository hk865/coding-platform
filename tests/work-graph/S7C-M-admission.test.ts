/**
 * M-admission (book-7c.md:1356): the one shared Host/Role judgment and the Query role projection.
 *
 * `hostRolePermissionsAdmitted` is the one pure judgment `recheckHostRoleAdmission` and L1's composition adapter call;
 * its cases are A5. `rolePayload` renders exactly the permission object it is handed: the two Query recipes construct
 * the three-field `RolePayloadPermissionsV1` (a fourth field is a TypeScript error there), while the Work caller passes
 * the full envelope, so a Work render carries `createMember` and a Query render does not.
 *
 * The public-start half is the real preparation handing out `createMember: true`, the current Host grant then
 * narrowed, and the next `workflow/advance` start refused through `createAuthorizeConfiguration`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import { rolePayload, type RolePayloadPermissionsV1 } from '../../src/core/agent-runtime/context-fact-text.js';
import { hostRolePermissionsAdmitted } from '../../src/core/work-graph/tasks/pick-authorization.js';
import { advanceUntil, driveWorkflow, readExecution } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { openS7C1World, S7C1_CREATE_ROLE, type S7C1World } from '../helpers/S7C-member-fixture.js';

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

let world: S7C1World | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

describe('M-admission: the public start after the Host grant narrows', () => {
  it('prepares the module Task with createMember and refuses the start once the current grant is narrowed', async () => {
    const hostGrant = { createMember: true };
    world = await openS7C1World({ hostGrant });
    const task = world.tasks[1]!;
    // The module line is the creator Role; m2's Plan assignment is the create executor Role, and the picker
    // requires the exact Role. This real line carries that Role and its createMember grant.
    const line = await createS6BLine(world.main, { label: 's7c-admission', role: S7C1_CREATE_ROLE, tasks: [task] });
    const claimInput = await advanceUntil(world.world.ag2b, { schemaVersion: 1, goalRef: world.goal,
      flowId: 's7c-admission', sessionHint: line.ref, kind: 'select_work', taskId: task.taskId },
    'claim_task');
    const receipts: WorkflowStepReceipt[] = [];
    const steps = await driveWorkflow(world.world.ag2b, claimInput, { stopBefore: 'start', receipts });

    const claim = receipts.find(receipt => receipt.kind === 'claim_task');
    if (claim === undefined || claim.result.status !== 'committed') {
      throw new Error(`M-admission: the Task was not claimed: ${JSON.stringify(receipts)}`);
    }
    const runRef = claim.result.value.runRef;
    const execution = await readExecution(world.world.ag2b, runRef);
    expect(execution.run.ref).toEqual(runRef);

    const prepare = receipts.find(receipt => receipt.kind === 'prepare');
    if (prepare === undefined || prepare.result.status !== 'ready') {
      throw new Error(`M-admission: the Task did not prepare: ${JSON.stringify(receipts)}`);
    }
    expect(prepare.result.value.envelope.permissions.createMember).toBe(true);

    const startInput = steps[steps.length - 1]!.next;
    if (startInput === null || startInput.kind !== 'perform' || startInput.operation.kind !== 'start') {
      throw new Error(`M-admission: the Workflow did not stop before start: ${JSON.stringify(steps)}`);
    }
    hostGrant.createMember = false;
    const started = await world.world.post('workflow/advance', plain(S6A_SCOPE, startInput));
    expect(started.body).toMatchObject({ status: 'ready', value: { state: 'waiting', receipt: { kind: 'start',
      result: { status: 'rejected', code: 'forbidden',
        reason: 'the prepared permissions are not allowed by the current Host and Role ceilings' } } } });
  });
});
