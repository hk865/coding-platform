/** Inspect optional report material before a Wait can claim its only successor. */
import type { ArtifactPort } from '../../contracts/artifact.js';
import { artifactBodyDigest, artifactBodySize } from '../../contracts/artifact.js';
import type { StateLedger } from '../../contracts/ledger.js';
import type { RunSnapshot } from '../../contracts/dispatch.js';
import type { WaitConditionSnapshot } from '../../contracts/coordination.js';
import type { AlternativeReportCandidate, AlternativeReportObservationPort, AlternativeReportQualification } from '../../contracts/alternative-report.js';
import { reportSelectionOf } from '../../contracts/alternative-report.js';
import type { MaterialAccessGrantSnapshot, MaterialBasisV1, SourceApplicabilityPort, MaterialAccessGrantLookup, MaterialAccessGrantViewResult } from '../../contracts/material-access.js';
import { materialAccessGrantIdFor, materialAccessGrantRefFor } from '../../contracts/material-access.js';
import { canonicalJson } from '../../contracts/fingerprint.js';

export class AlternativeReportMaterialCompiler implements AlternativeReportObservationPort {
  constructor(private readonly deps: { ledger: Pick<StateLedger, 'load'>; vault: ArtifactPort; source?: SourceApplicabilityPort;
    grantCandidates: { materialAccessCandidates(query: MaterialAccessGrantLookup): Promise<MaterialAccessGrantViewResult> } }) {}

  async captureBasis(predecessor: RunSnapshot): Promise<MaterialBasisV1> {
    if (!predecessor.envelope || !this.deps.source) throw Error('Report inspection source capability or predecessor envelope unavailable');
    const captured = await this.deps.source.capture({ projectId: predecessor.ref.projectId, workspaceId: predecessor.envelope.workspaceId,
      sourceSet: { kind: 'workspace_paths', paths: ['.'] } });
    if (captured.status !== 'sourced') throw Error('Report source unavailable: ' + captured.issues.join('; '));
    return { planRef: predecessor.envelope.planRef, workspaceRevision: predecessor.envelope.workspaceSnapshot.revision,
      sourceDigest: captured.pin.manifestDigest, sourcePin: captured.pin };
  }

  async observe(wait: WaitConditionSnapshot, predecessor: RunSnapshot, candidates: AlternativeReportCandidate[]): ReturnType<AlternativeReportObservationPort['observe']> {
    try {
      const basis = await this.captureBasis(predecessor);
      const qualification: AlternativeReportQualification = { basis, observations: [] };
      for (const candidate of candidates) {
        const body = candidate.delivery.delivery.bodyRef!;
        const id = materialAccessGrantIdFor(wait.wait.predecessorRunRef, [body], basis);
        const grantRef = materialAccessGrantRefFor(wait.ref.projectId, wait.ref.workspaceId, predecessor.ref.goalId, id);
        const loaded = await this.deps.ledger.load(grantRef);
        if (loaded.status !== 'found') return { status: 'unavailable', reason: 'Report inspection grant is not prepared for this exact source basis' };
        const grant = loaded.snapshot as MaterialAccessGrantSnapshot;
        // An unrelated broader grant must not resurrect this exact inspection
        // authorization or stop the scan before a later valid candidate.
        if (grant.revocation) {
          qualification.observations.push({ selection: reportSelectionOf(candidate), grantRef, grantRevision: grant.revision,
            outcome: 'refused', reason: 'Exact report inspection grant was revoked' });
          continue;
        }
        if (!grant.revocation) {
          const index = await this.deps.grantCandidates.materialAccessCandidates({ reader: wait.wait.predecessorRunRef, material: body });
          if (index.status !== 'ready' || !index.grants.some(row => row.revision === grant.revision && canonicalJson(row.ref) === canonicalJson(grantRef))) {
            return { status: 'unavailable', reason: 'Report authorization projection has not reached the canonical inspection grant' };
          }
        }
        const opened = await this.deps.vault.open(body, { requesterRunRef: wait.wait.predecessorRunRef, currentBasis: basis, usage: 'current' });
        if (canonicalJson(basis) !== canonicalJson(await this.captureBasis(predecessor))) return { status: 'unavailable', reason: 'Report source changed during inspection' };
        // The general Vault stale result includes unavailable source I/O.
        // It cannot prove that an earlier report is ineligible.
        if (opened.status === 'rejected' && opened.code === 'stale') return { status: 'unavailable', reason: 'Report source/current authority could not be verified: ' + opened.issues.join('; ') };
        const outcome = opened.status === 'unavailable' ? 'missing_body' : opened.status === 'rejected'
          ? opened.code === 'stale' ? 'stale' : opened.code === 'invalid' ? 'invalid_body' : 'refused'
          : artifactBodyDigest(opened.record.body) !== body.digest || artifactBodySize(opened.record.body) !== body.sizeBytes ? 'invalid_body' : 'readable';
        qualification.observations.push({ selection: reportSelectionOf(candidate), grantRef, grantRevision: grant.revision,
          outcome, reason: opened.status === 'rejected' ? opened.issues.join('; ') || opened.code : outcome });
        if (outcome === 'readable') break;
      }
      return { status: 'observed', qualification };
    } catch (error) { return { status: 'unavailable', reason: String(error) }; }
  }
}
