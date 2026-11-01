import type { CoreRejection } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { RoleSpecResolutionV1 } from '../../../contracts/role-spec-materials.js';
import type { TaskEnvelopeV1 } from '../../../contracts/task-envelope.js';

/** The trusted Host grant a permission projection starts from. */
type HostPermissionGrantV1 = {
  tools: readonly string[];
  writeScope: readonly string[];
  shellWorkspaceAccess?: 'all_except_denied';
  createMember?: boolean;
};

/**
 * The ONE projection from a current Host grant, the resolved Role and the
 * creator ceiling to the permissions a Run would prepare. Preparation and the
 * read-only pre-claim check both call it, so the two never disagree about what
 * the same Host/Role pair admits. A review round fixes its own tool names and
 * writes nothing; the Host/Role intersection does not apply to that purpose.
 */
export function projectRunPermissions(input: {
  policyRevision: string;
  host: HostPermissionGrantV1;
  roleResolution: RoleSpecResolutionV1;
  ceiling: Pick<TaskEnvelopeV1['permissions'], 'tools' | 'writeScope' | 'createMember'> | null;
  secretaryCreated: boolean;
  reviewTools?: readonly string[];
}): { ok: true; permissions: TaskEnvelopeV1['permissions'] } | { ok: false; rejection: CoreRejection } {
  const writeScopeResult = input.reviewTools !== undefined
    ? { ok: true as const, writeScope: [] as string[] }
    : validateWriteScope(input.host.writeScope, input.roleResolution, input.host.shellWorkspaceAccess);
  if (!writeScopeResult.ok) return { ok: false, rejection: writeScopeResult.rejection };
  const ceiling = input.ceiling;
  if (ceiling !== null && writeScopeResult.writeScope.some(path => !ceiling.writeScope.includes(path))) {
    return { ok: false, rejection: rejected('forbidden', 'the prepared write scope is outside the creator ceiling') };
  }
  const grantedTools = input.reviewTools !== undefined
    ? [...input.reviewTools]
    : intersectTools(input.host.tools, input.roleResolution);
  let createMember = input.host.createMember === true;
  if (ceiling !== null) createMember = createMember && ceiling.createMember;
  if (input.secretaryCreated) createMember = false;
  const permissions: TaskEnvelopeV1['permissions'] = {
    policyRevision: input.policyRevision,
    tools: ceiling === null ? grantedTools : grantedTools.filter(tool => ceiling.tools.includes(tool)),
    writeScope: writeScopeResult.writeScope,
    createMember,
  };
  const hasShell = permissions.tools.includes('shell');
  if (hasShell && (input.host.shellWorkspaceAccess !== 'all_except_denied'
    || permissions.writeScope.length !== 1 || permissions.writeScope[0] !== '.')) {
    return { ok: false, rejection: rejected('unsupported',
      'shell requires Host shellWorkspaceAccess=all_except_denied, a shell grant and an explicit whole-workspace write scope') };
  }
  return { ok: true, permissions };
}

/** Intersect the Host's real tool grant with the Role ceiling. Absent Role spec
 * keeps the legacy semantics (Host grant is the only ceiling). */
function intersectTools(hostTools: readonly string[], roleResolution: RoleSpecResolutionV1): string[] {
  if (roleResolution.status !== 'resolved') return [...hostTools];
  const ceiling = new Set(roleResolution.spec.permissions.tools);
  return hostTools.filter(tool => ceiling.has(tool));
}

/** This batch supports exactly two write shapes: no writes, or an explicit Host
 * whole-workspace grant. A narrower path scope is unsupported, never widened. */
function validateWriteScope(hostWriteScope: readonly string[], roleResolution: RoleSpecResolutionV1,
  hostShell: 'all_except_denied' | undefined): { ok: true; writeScope: string[] } | { ok: false; rejection: CoreRejection } {
  const writeScope = [...hostWriteScope];
  const wholeWorkspace = writeScope.length === 1 && writeScope[0] === '.';
  if (writeScope.length !== 0 && !wholeWorkspace) {
    return { ok: false, rejection: rejected('unsupported',
      'a narrower write scope than the whole workspace is not supported by this runtime batch') };
  }
  if (roleResolution.status === 'resolved' && roleResolution.spec.permissions.writeScope === 'none' && writeScope.length !== 0) {
    return { ok: false, rejection: rejected('forbidden', 'the Role spec is read-only but the Host grant allows writes') };
  }
  if (hostShell !== undefined && !wholeWorkspace) {
    return { ok: false, rejection: rejected('unsupported', 'shell requires an explicit whole-workspace write grant') };
  }
  return { ok: true, writeScope };
}

export function hostRolePermissionsAdmitted(input: {
  permissions: TaskEnvelopeV1['permissions'];
  host: HostPermissionGrantV1;
  role: { tools: readonly string[]; writeScope: 'none' | readonly string[] } | null;
}): { ok: true } | { ok: false; code: 'forbidden'; reason: string } {
  const p = input.permissions;
  const role = input.role;
  const toolsOk = p.tools.every(tool => input.host.tools.includes(tool)
    && (role === null || role.tools.includes(tool)));
  const writesOk = p.writeScope.every(path => input.host.writeScope.includes(path));
  const roleNoneOk = role === null || role.writeScope !== 'none' || p.writeScope.length === 0;
  // The canonical shell clause (create-platform.ts:665–666), preserved verbatim.
  const shellOk = !p.tools.includes('shell') || (input.host.shellWorkspaceAccess === 'all_except_denied'
    && p.writeScope.length === 1 && p.writeScope[0] === '.');
  const memberOk = p.createMember !== true || input.host.createMember === true;
  return toolsOk && writesOk && roleNoneOk && shellOk && memberOk
    ? { ok: true }
    : { ok: false, code: 'forbidden',
      reason: 'the prepared permissions are not allowed by the current Host and Role ceilings' };
}
