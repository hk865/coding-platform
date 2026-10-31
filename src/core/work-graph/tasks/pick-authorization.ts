import type { TaskEnvelopeV1 } from '../../../contracts/task-envelope.js';
export function hostRolePermissionsAdmitted(input: {
  permissions: TaskEnvelopeV1['permissions'];
  host: { tools: readonly string[]; writeScope: readonly string[];
    shellWorkspaceAccess?: 'all_except_denied'; createMember?: boolean };
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
