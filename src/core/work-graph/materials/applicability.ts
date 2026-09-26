import type { ArtifactOwnerRunRef, ArtifactRef } from '../../../contracts/artifact.js';
import type { MaterialReader } from '../../../contracts/core/call-context.js';
import type { MaterialAccessResolver } from '../../../contracts/material-access.js';
import type { SourceApplicabilityPort } from '../../../contracts/material-access.js';
import type { MaterialOrigin } from '../../record-store/body-ports.js';
import type { GoalSnapshot } from '../../../contracts/ledger.js';
import type { MaterialAuthorityReads, MaterialCandidateReads } from './record-ports.js';
export type { MaterialAuthorityReads } from './record-ports.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import type { MaterialAccessGrantSnapshot, MaterialAccessGrantV1 } from '../../../contracts/material-access.js';
import { materialBasisEquals, materialBasisIsUnconditional, materialPrincipalInScope, sameArtifactOwnerRunRef, sameArtifactRef, validMaterialSourcePin } from '../../../contracts/material-access.js';
import { canonicalJson } from '../../../contracts/fingerprint.js';
import { materialSourcePinIsCurrent } from '../../workspace/source-applicability.js';

/** Exact material, current basis, revocation, source pin and Host provenance policy live here. */
export type MaterialApplicability = {
  reader: MaterialReader;
  ref: ArtifactRef;
  origin: MaterialOrigin;
  /** undefined preserves legacy open's owner-only default semantics. */
  usage: 'current' | 'historical_explanation' | undefined;
};

type MaterialAdmission =
  | { status: 'allowed'; applicability?: 'current' | 'historical_explanation' }
  | { status: 'rejected'; code: 'forbidden' | 'source_stale' | 'unsupported'; reason: string };

export function createMaterialApplicability(deps: {
  authority: MaterialAuthorityReads;
  grants: MaterialAccessResolver;
}): (input: MaterialApplicability) => Promise<MaterialAdmission> {
  return async input => {
    const reader = input.reader;
    if (reader.kind === 'host') return hostAdmission(deps.authority, reader, input);
    return runAdmission(deps.grants, reader, input);
  };
}

async function hostAdmission(
  authority: MaterialAuthorityReads,
  reader: Extract<MaterialReader, { kind: 'host' }>,
  input: MaterialApplicability,
): Promise<MaterialAdmission> {
  if (input.usage === 'current') {
    return rejected('source_stale', 'a Host current read needs a verified source pin, which this batch has no trusted entry for');
  }
  if (input.usage !== 'historical_explanation') {
    return rejected('unsupported', 'a Host material read must be an explicit current or historical usage');
  }
  const origin = input.origin;
  // A platform operation records its own trusted scope at write time; a Host may
  // read it back directly without inventing a Run. A workspace-restricted Host
  // never crosses workspace, and material with no trusted workspace association
  // is unreadable for it. Legacy owner-less records still establish no scope.
  if (origin.kind === 'platform_operation') {
    if (origin.projectId !== reader.projectId) {
      return rejected('forbidden', 'the platform material belongs to another project');
    }
    if (reader.workspaceId !== undefined && reader.workspaceId !== origin.workspaceId) {
      return rejected('forbidden', 'the workspace-restricted Host cannot read platform material outside its workspace');
    }
    return { status: 'allowed', applicability: 'historical_explanation' };
  }
  const owner = materialOwnerFromOrigin(input.origin);
  if (owner === null) {
    return rejected('forbidden', 'the material has no canonical Run/QueryRun owner to scope a Host read');
  }
  const canonical = await authority.load(owner);
  if (canonical.status !== 'found') {
    return rejected('forbidden', 'the canonical material owner could not be loaded');
  }
  // Only the requested full canonical ref may vouch for a workspace: a load that
  // answers with a different ref is not the owner's scope.
  const canonicalRef = (canonical.snapshot as { ref?: ArtifactOwnerRunRef }).ref ?? null;
  if (!sameArtifactOwnerRunRef(canonicalRef, owner)) {
    return rejected('forbidden', 'the canonical owner load did not return the requested full ref');
  }
  const sourceWorkspaceId = owner.aggregateType === 'Run'
    ? (canonical.snapshot as RunSnapshot).workspaceSnapshot.workspaceId
    : owner.workspaceId;
  if (owner.projectId !== reader.projectId || (reader.workspaceId !== undefined && reader.workspaceId !== sourceWorkspaceId)) {
    return rejected('forbidden', 'the material owner is outside the trusted Host project/workspace scope');
  }
  return { status: 'allowed', applicability: 'historical_explanation' };
}

async function runAdmission(
  grants: MaterialAccessResolver,
  reader: Extract<MaterialReader, { kind: 'run' }>,
  input: MaterialApplicability,
): Promise<MaterialAdmission> {
  const requester = reader.requester;
  const owner = materialOwnerFromOrigin(input.origin);
  if (input.usage !== 'current' && sameArtifactOwnerRunRef(owner, requester)) {
    return input.usage === 'historical_explanation'
      ? { status: 'allowed', applicability: 'historical_explanation' }
      : { status: 'allowed' };
  }
  const candidates = await grants.grantsFor(input.ref, requester);
  const forMaterial = candidates.filter(grant =>
    sameArtifactOwnerRunRef(grant.reader, requester) &&
    materialPrincipalInScope(grant.reader, grant.scope) &&
    grant.materials.some(material => sameArtifactRef(material, input.ref)) &&
    grantIssuerOwnsMaterial(grant, owner));
  if (forMaterial.length === 0) {
    return rejected('forbidden', 'the requester is neither the recorded owner run nor authorized by a recorded grant');
  }
  const current = reader.currentBasis;
  const applicable: MaterialAccessGrantV1[] = [];
  for (const grant of forMaterial) {
    if (input.usage === 'current' && (grant.history || !validMaterialSourcePin(grant.basis.sourcePin) || !grants.currentBasisValid)) continue;
    if (!grant.history && (grant.basis.sourceDigest !== null || grant.basis.sourcePin !== undefined) && (!validMaterialSourcePin(grant.basis.sourcePin) || !grants.currentBasisValid)) continue;
    if (!(materialBasisIsUnconditional(grant.basis) || (current !== undefined && materialBasisEquals(grant.basis, current)))) continue;
    if (grants.currentBasisValid && !await grants.currentBasisValid(grant)) continue;
    applicable.push(grant);
  }
  if (applicable.length === 0) {
    return rejected('source_stale', 'a recorded grant covers this material but its current basis/source cannot be verified or it only authorizes history');
  }
  if (!applicable.some(grant => grantIssuerOwnsMaterial(grant, owner))) {
    return rejected('forbidden', 'the recorded grant was not issued by the material owner or by Control');
  }
  if (input.usage === 'current') return { status: 'allowed', applicability: 'current' };
  if (applicable.every(grant => !!grant.history) || input.usage === 'historical_explanation') {
    return { status: 'allowed', applicability: 'historical_explanation' };
  }
  return { status: 'allowed' };
}

/** The single provenance rule: a raw origin names a Run/QueryRun owner or nothing. */
export function materialOwnerFromOrigin(origin: MaterialOrigin): MaterialOwner {
  if (origin.kind === 'legacy') return origin.ownerRunRef;
  if (origin.kind === 'run') {
    return origin.owner.aggregateType === 'Run' || origin.owner.aggregateType === 'QueryRun' ? origin.owner : null;
  }
  return null;
}

/** Only the recorded owner run or a Control principal may authorize sharing. */
export function grantIssuerOwnsMaterial(grant: MaterialAccessGrantV1, ownerRunRef: MaterialOwner): boolean {
  if (grant.history) {
    return grant.history.usage === 'historical_explanation' &&
      sameArtifactOwnerRunRef(grant.history.owner, ownerRunRef) && ownerRunRef?.projectId === grant.scope.projectId &&
      grant.issuedBy.aggregateType === 'Control' && grant.issuedBy.projectId === grant.scope.projectId && grant.issuedBy.goalId === grant.scope.goalId;
  }
  if (ownerRunRef === null || !materialPrincipalInScope(ownerRunRef, grant.scope)) return false;
  if (grant.issuedBy.aggregateType === 'Control') {
    return grant.issuedBy.projectId === grant.scope.projectId && grant.issuedBy.goalId === grant.scope.goalId;
  }
  return sameArtifactOwnerRunRef(ownerRunRef, grant.issuedBy);
}

function rejected(code: 'forbidden' | 'source_stale' | 'unsupported', reason: string): MaterialAdmission {
  return { status: 'rejected', code, reason };
}

/** Legacy resolver will re-export the moved implementation after migration. */
export type MaterialOwner = ArtifactOwnerRunRef | null;
export function createMaterialAccessResolver(
  authority: MaterialAuthorityReads,
  index: MaterialCandidateReads,
  sourceApplicability?: SourceApplicabilityPort,
): MaterialAccessResolver {
  return {
    grantsFor: async (material, reader) => {
      const principal = await authority.load(reader);
      if (principal.status !== 'found') return [];
      const workspaceId = reader.aggregateType === 'Run'
        ? (principal.snapshot as RunSnapshot).workspaceSnapshot.workspaceId
        : reader.workspaceId;
      const candidates = await index.materialAccessCandidates({ reader, material });
      if (candidates.status !== 'ready') return [];
      const goals = new Map<string, boolean>();
      const grants: MaterialAccessGrantV1[] = [];
      for (const candidate of candidates.grants) {
        // The projection is a candidate finder only. Revocation must take effect
        // as soon as its ledger transaction commits, even with a lagging index.
        const canonical = await authority.load(candidate.ref);
        if (canonical.status !== 'found' || canonical.snapshot.revision !== 1 ||
          (canonical.snapshot as MaterialAccessGrantSnapshot).revocation) continue;
        const grant = (canonical.snapshot as MaterialAccessGrantSnapshot).grant;
        if (grant.history) {
          const owner = grant.history.owner;
          if (owner.projectId !== reader.projectId) continue;
          const source = await authority.load(owner);
          if (source.status !== 'found') continue;
          const sourceWorkspace = owner.aggregateType === 'Run'
            ? (source.snapshot as RunSnapshot).workspaceSnapshot.workspaceId : owner.workspaceId;
          const cross = grant.history.crossWorkspace;
          if (sourceWorkspace !== workspaceId
            ? cross?.sourceWorkspaceId !== sourceWorkspace || cross?.authorizedBy?.kind !== 'human' || !cross.authorizedBy.id
            : cross !== undefined) continue;
          if ((await authority.load({ aggregateType: 'Workspace', projectId: reader.projectId, workspaceId: sourceWorkspace })).status !== 'found') continue;
          if (owner.aggregateType === 'Run') {
            const sourceGoal = await authority.load({ aggregateType: 'Goal', projectId: owner.projectId, goalId: owner.goalId });
            if (sourceGoal.status !== 'found' || (sourceGoal.snapshot as GoalSnapshot).workspaceRef.workspaceId !== sourceWorkspace) continue;
          }
        }
        if (grant.scope.projectId !== reader.projectId || grant.scope.workspaceId !== workspaceId ||
          (reader.aggregateType === 'Run' && grant.scope.goalId !== reader.goalId)) continue;
        if (!goals.has(grant.scope.goalId)) {
          const goal = await authority.load({ aggregateType: 'Goal', projectId: reader.projectId, goalId: grant.scope.goalId });
          const bound = goal.status === 'found' ? (goal.snapshot as GoalSnapshot).workspaceRef : null;
          goals.set(grant.scope.goalId, bound?.projectId === reader.projectId && bound.workspaceId === workspaceId);
        }
        if (goals.get(grant.scope.goalId)) grants.push(grant);
      }
      return grants;
    },
    currentBasisValid: async grant => {
      // Source I/O can take time. Do it before the final canonical authority
      // checks so a revocation committed during capture cannot authorize a read.
      if (!grant.history && (grant.basis.sourceDigest !== null || grant.basis.sourcePin !== undefined) &&
        !await materialSourcePinIsCurrent(sourceApplicability, grant.basis.sourcePin, grant.scope)) return false;
      const workspace = await authority.load({ aggregateType: 'Workspace', projectId: grant.scope.projectId, workspaceId: grant.scope.workspaceId });
      if (workspace.status !== 'found' || (grant.basis.workspaceRevision !== null && workspace.snapshot.revision !== grant.basis.workspaceRevision)) return false;
      const goal = await authority.load({ aggregateType: 'Goal', projectId: grant.scope.projectId, goalId: grant.scope.goalId });
      if (goal.status !== 'found') return false;
      const activePlan = (goal.snapshot as GoalSnapshot).activePlanRevision;
      if (grant.basis.planRef !== null && activePlan !== null && canonicalJson(activePlan) !== canonicalJson(grant.basis.planRef)) return false;
      if (grant.reader.aggregateType === 'Run' && grant.basis.planRef !== null) {
        const run = await authority.load(grant.reader);
        if (run.status !== 'found' || canonicalJson((run.snapshot as RunSnapshot).planRef) !== canonicalJson(grant.basis.planRef)) return false;
      }
      const canonical = await authority.load({ aggregateType: 'MaterialAccessGrant', ...grant.scope, grantId: grant.grantId });
      return canonical.status === 'found' && canonical.snapshot.revision === 1 &&
        !(canonical.snapshot as MaterialAccessGrantSnapshot).revocation &&
        canonicalJson((canonical.snapshot as MaterialAccessGrantSnapshot).grant) === canonicalJson(grant);
    },
  };
}
