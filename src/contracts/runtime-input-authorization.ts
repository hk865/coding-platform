import type { AggregateRef, AggregateSnapshot, ExpectedVersion } from './ledger.js';
import type { RunSnapshot, RuntimeInputBindingV1 } from './dispatch.js';
import type { DeliverySnapshot } from './coordination.js';
import type { MaterialAccessGrantSnapshot } from './material-access.js';
import { validMaterialSourcePin } from './material-access.js';
import { canonicalJson } from './fingerprint.js';
import { validateArtifactRefRef } from './validation/evidence.js';

/** Pure authority check used by Control and by the ledger under its transaction.
 * The provider attempt CAS must cover the exact mutable grants selected by Host.
 * Source filesystem currentness remains the Host's capture check at that boundary. */
export function runtimeInputMaterialGuards(run: RunSnapshot, binding: RuntimeInputBindingV1,
  get: (ref: AggregateRef) => AggregateSnapshot | undefined): ExpectedVersion[] | null {
  const envelope = run.envelope;
  if (!envelope || !Array.isArray(binding.deliveryRefs) || !Array.isArray(binding.materialAccessRefs) ||
      binding.deliveryRefs.length > 64 || binding.materialAccessRefs.length > 64) return null;
  const guards: ExpectedVersion[] = [];
  const bodies = new Set<string>();
  const grantBodies = new Set<string>();
  const seen = new Set<string>();
  const additional = binding.additionalMaterialRefs === undefined ? [] : binding.additionalMaterialRefs;
  if (!Array.isArray(additional) || additional.length > 64) return null;
  for (const body of additional) {
    const issues: import('./validation/common.js').ValidationIssue[] = [];
    validateArtifactRefRef(body, 'additionalMaterialRefs', issues);
    if (!body || issues.length || bodies.has(canonicalJson(body))) return null;
    bodies.add(canonicalJson(body));
  }
  for (const ref of binding.deliveryRefs) {
    if (ref.aggregateType !== 'Delivery' || ref.projectId !== run.ref.projectId || ref.workspaceId !== envelope.workspaceId || seen.has(canonicalJson(ref))) return null;
    seen.add(canonicalJson(ref));
    const snapshot = get(ref) as DeliverySnapshot | undefined;
    if (!snapshot || canonicalJson(snapshot.ref) !== canonicalJson(ref)) return null;
    guards.push({ ref, revision: snapshot.revision });
    if (snapshot.delivery.bodyRef) bodies.add(canonicalJson(snapshot.delivery.bodyRef));
  }
  for (const ref of binding.materialAccessRefs) {
    if (ref.aggregateType !== 'MaterialAccessGrant' || ref.projectId !== run.ref.projectId || ref.workspaceId !== envelope.workspaceId ||
        ref.goalId !== run.ref.goalId || seen.has(canonicalJson(ref))) return null;
    seen.add(canonicalJson(ref));
    const snapshot = get(ref) as MaterialAccessGrantSnapshot | undefined;
    if (!snapshot || snapshot.revision !== 1 || snapshot.revocation || canonicalJson(snapshot.ref) !== canonicalJson(ref)) return null;
    const grant = snapshot.grant;
    if (canonicalJson(grant.reader) !== canonicalJson(run.ref) || grant.scope.projectId !== run.ref.projectId ||
        grant.scope.workspaceId !== envelope.workspaceId || grant.scope.goalId !== run.ref.goalId || grant.history ||
        canonicalJson(grant.basis.planRef) !== canonicalJson(envelope.planRef) ||
        grant.basis.workspaceRevision !== envelope.workspaceSnapshot.revision || !validMaterialSourcePin(grant.basis.sourcePin) ||
        grant.basis.sourcePin.projectId !== run.ref.projectId || grant.basis.sourcePin.workspaceId !== envelope.workspaceId ||
        grant.basis.sourceDigest !== grant.basis.sourcePin.manifestDigest) return null;
    guards.push({ ref, revision: snapshot.revision });
    for (const body of grant.materials) {
      const key = canonicalJson(body);
      if (!bodies.has(key)) return null;
      grantBodies.add(key);
    }
  }
  if (bodies.size !== grantBodies.size) return null;
  return guards;
}
