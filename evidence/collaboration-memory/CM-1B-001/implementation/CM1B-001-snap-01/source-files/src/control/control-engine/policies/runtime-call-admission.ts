import type { StateLedger, ExpectedVersion } from '../../../contracts/ledger.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import type { RoleSpecRevisionSnapshot, ProjectRoleSpecActiveSnapshot } from '../../../contracts/role-spec.js';
import { projectRoleSpecActiveRefFor } from '../../../contracts/role-spec.js';
import { runtimeInputMaterialGuards } from '../../../contracts/runtime-input-authorization.js';
import type { AggregateSnapshot } from '../../../contracts/ledger.js';
import { canonicalJson } from '../../../contracts/fingerprint.js';
import { resolveActiveCoordinationPolicy } from './coordination-policy.js';
import { evaluateRoleBindingAdmission } from './role-binding-admission.js';

/** Reuse claim's role policy at the actual call boundary. Every canonical read,
 * including an absent active policy, joins the same ledger CAS as the permit. */
export async function runtimeCallAdmission(ledger: Pick<StateLedger, 'load'>, run: RunSnapshot): Promise<
  { allowed: true; guards: ExpectedVersion[] } | { allowed: false }
> {
  if (!run.envelope || run.status === 'ended' || run.controlState?.desiredState === 'cancelled' || run.controlState?.desiredState === 'paused') return { allowed: false };
  if (run.executionAuthorization && run.executionAuthorization.phase !== 'entered') return { allowed: false };
  const guards: ExpectedVersion[] = [];
  const tracked: Pick<StateLedger, 'load'> = { async load(ref) {
    const result = await ledger.load(ref);
    const revision = result.status === 'found' ? result.snapshot.revision : 0;
    const prior = guards.find(g => canonicalJson(g.ref) === canonicalJson(ref));
    if (prior && prior.revision !== revision) throw Error('Authorization changed during read');
    if (!prior) guards.push({ ref, revision });
    return result;
  } };
  if (run.inputBinding) {
    const loaded = new Map<string, AggregateSnapshot>();
    if (!Array.isArray(run.inputBinding.materialAccessRefs) || !Array.isArray(run.inputBinding.deliveryRefs) ||
        run.inputBinding.materialAccessRefs.length > 64 || run.inputBinding.deliveryRefs.length > 64) return { allowed: false };
    for (const ref of [...run.inputBinding.deliveryRefs, ...run.inputBinding.materialAccessRefs]) {
      const result = await tracked.load(ref);
      if (result.status !== 'found') return { allowed: false };
      loaded.set(canonicalJson(ref), result.snapshot);
    }
    if (!runtimeInputMaterialGuards(run, run.inputBinding, ref => loaded.get(canonicalJson(ref)))) return { allowed: false };
  }
  const policy = await resolveActiveCoordinationPolicy(tracked, run.ref.projectId);
  if (!policy && guards.some(g => g.ref.aggregateType === 'ProjectCoordinationPolicyActive' && g.revision > 0)) return { allowed: false };
  const matrix = policy?.content.roles ?? null;
  const roleId = run.envelope.roleBinding.templateId;
  const pin = matrix && Object.hasOwn(matrix.catalog, roleId) ? matrix.catalog[roleId] : undefined;
  let pinnedSpec: RoleSpecRevisionSnapshot | null = null;
  let activeRevision: ProjectRoleSpecActiveSnapshot['activeRevision'] | null = null;
  if (pin) {
    const installed = await tracked.load(pin.ref);
    if (installed.status === 'found') pinnedSpec = installed.snapshot as RoleSpecRevisionSnapshot;
    const active = await tracked.load(projectRoleSpecActiveRefFor(run.ref.projectId, roleId));
    if (active.status === 'found') activeRevision = (active.snapshot as ProjectRoleSpecActiveSnapshot).activeRevision;
  }
  const result = evaluateRoleBindingAdmission({ roleBinding: run.envelope.roleBinding,
    declaredPermissions: run.envelope.permissions, matrix, pinnedSpec, activeRevision });
  return result.admissible ? { allowed: true, guards } : { allowed: false };
}
