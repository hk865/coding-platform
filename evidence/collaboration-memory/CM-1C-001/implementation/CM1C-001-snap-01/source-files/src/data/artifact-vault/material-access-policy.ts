import type { StateLedger, GoalSnapshot } from '../../contracts/ledger.js';
import type { RunSnapshot } from '../../contracts/dispatch.js';
import type { MaterialAccessResolver, MaterialAccessGrantLookup, MaterialAccessGrantViewResult, SourceApplicabilityPort } from '../../contracts/material-access.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import { materialSourcePinIsCurrent } from '../workspace-reader/source-applicability.js';

/** ArtifactVault's read-time policy resolves recorded grants and rejects stale
 * authority even before its candidate projection catches up. No runtime is called. */
export function createMaterialAccessResolver(ledger: StateLedger, index: {
  materialAccessCandidates(query: MaterialAccessGrantLookup): Promise<MaterialAccessGrantViewResult>;
}, sourceApplicability?: SourceApplicabilityPort): MaterialAccessResolver {
  return { grantsFor: async (material, reader) => {
    const principal = await ledger.load(reader);
    if (principal.status !== 'found') return [];
    const workspaceId = reader.aggregateType === 'Run'
      ? (principal.snapshot as RunSnapshot).workspaceSnapshot.workspaceId : reader.workspaceId;
    const candidates = await index.materialAccessCandidates({ reader, material });
    if (candidates.status !== 'ready') return [];
    const goals = new Map<string, boolean>();
    const grants = [];
    for (const candidate of candidates.grants) {
      // The projection is a candidate finder only. Revocation must take effect
      // as soon as its ledger transaction commits, even with a lagging index.
      const canonical = await ledger.load(candidate.ref);
      if (canonical.status !== 'found' || canonical.snapshot.revision !== 1 ||
          (canonical.snapshot as import('../../contracts/material-access.js').MaterialAccessGrantSnapshot).revocation) continue;
      const grant = (canonical.snapshot as import('../../contracts/material-access.js').MaterialAccessGrantSnapshot).grant;
      if (grant.history) {
        const owner = grant.history.owner;
        if (owner.projectId !== reader.projectId) continue;
        const source = await ledger.load(owner);
        if (source.status !== 'found') continue;
        const sourceWorkspace = owner.aggregateType === 'Run' ? (source.snapshot as RunSnapshot).workspaceSnapshot.workspaceId : owner.workspaceId;
        const cross = grant.history.crossWorkspace;
        if (sourceWorkspace !== workspaceId ? cross?.sourceWorkspaceId !== sourceWorkspace || cross?.authorizedBy?.kind !== 'human' || !cross.authorizedBy.id : cross !== undefined) continue;
        if ((await ledger.load({ aggregateType: 'Workspace', projectId: reader.projectId, workspaceId: sourceWorkspace })).status !== 'found') continue;
        if (owner.aggregateType === 'Run') {
          const sourceGoal = await ledger.load({ aggregateType: 'Goal', projectId: owner.projectId, goalId: owner.goalId });
          if (sourceGoal.status !== 'found' || (sourceGoal.snapshot as GoalSnapshot).workspaceRef.workspaceId !== sourceWorkspace) continue;
        }
      }
      if (grant.scope.projectId !== reader.projectId || grant.scope.workspaceId !== workspaceId ||
          (reader.aggregateType === 'Run' && grant.scope.goalId !== reader.goalId)) continue;
      if (!goals.has(grant.scope.goalId)) {
        const goal = await ledger.load({ aggregateType: 'Goal', projectId: reader.projectId, goalId: grant.scope.goalId });
        const bound = goal.status === 'found' ? (goal.snapshot as GoalSnapshot).workspaceRef : null;
        goals.set(grant.scope.goalId, bound?.projectId === reader.projectId && bound.workspaceId === workspaceId);
      }
      if (goals.get(grant.scope.goalId)) grants.push((canonical.snapshot as import('../../contracts/material-access.js').MaterialAccessGrantSnapshot).grant);
    }
    return grants;
  }, currentBasisValid: async grant => {
    // Source I/O can take time. Do it before the final canonical authority
    // checks so a revocation committed during capture cannot authorize a read.
    if (!grant.history && (grant.basis.sourceDigest !== null || grant.basis.sourcePin !== undefined) &&
      !await materialSourcePinIsCurrent(sourceApplicability, grant.basis.sourcePin, grant.scope)) return false;
    const workspace = await ledger.load({ aggregateType: 'Workspace', projectId: grant.scope.projectId, workspaceId: grant.scope.workspaceId });
    if (workspace.status !== 'found' || (grant.basis.workspaceRevision !== null && workspace.snapshot.revision !== grant.basis.workspaceRevision)) return false;
    const goal = await ledger.load({ aggregateType: 'Goal', projectId: grant.scope.projectId, goalId: grant.scope.goalId });
    if (goal.status !== 'found') return false;
    const activePlan = (goal.snapshot as GoalSnapshot).activePlanRevision;
    if (grant.basis.planRef !== null && activePlan !== null && canonicalJson(activePlan) !== canonicalJson(grant.basis.planRef)) return false;
    if (grant.reader.aggregateType === 'Run' && grant.basis.planRef !== null) {
      const run = await ledger.load(grant.reader);
      if (run.status !== 'found' || canonicalJson((run.snapshot as RunSnapshot).planRef) !== canonicalJson(grant.basis.planRef)) return false;
    }
    const canonical = await ledger.load({ aggregateType: 'MaterialAccessGrant', ...grant.scope, grantId: grant.grantId });
    return canonical.status === 'found' && canonical.snapshot.revision === 1 &&
      !(canonical.snapshot as import('../../contracts/material-access.js').MaterialAccessGrantSnapshot).revocation &&
      canonicalJson((canonical.snapshot as import('../../contracts/material-access.js').MaterialAccessGrantSnapshot).grant) === canonicalJson(grant);
  } };
}
