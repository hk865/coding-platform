import type { StateLedger } from '../../contracts/ledger.js';
import type { ControlEngine } from '../../contracts/modules.js';
import type { WaitConditionSnapshot } from '../../contracts/coordination.js';
import type { RunSnapshot } from '../../contracts/dispatch.js';
import type { AlternativeReportMaterialCompiler } from '../../data/context-compiler/alternative-report-materials.js';
import { buildGrantMaterialAccessCommand, buildMaterialAccessGrantV1 } from '../../contracts/commands/material-access.js';
import { materialAccessGrantIdFor, materialAccessGrantRefFor } from '../../contracts/material-access.js';

/** Grants are prepared before Control admission; no invented successor identity. */
export class AlternativeReportPreparation {
  constructor(private readonly deps: { ledger: Pick<StateLedger, 'load' | 'alternativeReport'>;
    control: Pick<ControlEngine, 'grantMaterialAccess'>; materials: Pick<AlternativeReportMaterialCompiler, 'captureBasis' | 'observe'>;
    synchronizeGrants: () => Promise<unknown>;
    observations: { record(wait: WaitConditionSnapshot, predecessor: RunSnapshot,
      candidates: import('../../contracts/alternative-report.js').AlternativeReportCandidate[],
      observation: Awaited<ReturnType<AlternativeReportMaterialCompiler['observe']>>): import('../../contracts/alternative-report.js').AlternativeReportInspection } }) {}
  async prepare(wait: WaitConditionSnapshot): Promise<import('../../contracts/alternative-report.js').AlternativeReportInspection | null> {
    const read = await this.deps.ledger.alternativeReport(wait.ref);
    if (read.status === 'unavailable') throw Error(read.reason);
    if (read.status === 'pending') return null;
    const loaded = await this.deps.ledger.load(wait.wait.predecessorRunRef);
    if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'Run') throw Error('Report predecessor is unavailable');
    const predecessor = loaded.snapshot as RunSnapshot;
    const basis = await this.deps.materials.captureBasis(predecessor);
    for (const candidate of read.candidates) {
      const materials = [candidate.delivery.delivery.bodyRef!];
      const id = materialAccessGrantIdFor(predecessor.ref, materials, basis);
      const ref = materialAccessGrantRefFor(wait.ref.projectId, wait.ref.workspaceId, predecessor.ref.goalId, id);
      const existing = await this.deps.ledger.load(ref);
      // Revoked exact grants remain revoked. A retry never invents another ID.
      if (existing.status === 'found') continue;
      if (existing.status !== 'not_found') throw Error('Report grant state unavailable');
      const at = candidate.delivery.delivery.createdAt;
      const grant = buildMaterialAccessGrantV1({ grantId: id, scope: { projectId: wait.ref.projectId, workspaceId: wait.ref.workspaceId, goalId: predecessor.ref.goalId },
        materials, reader: predecessor.ref, issuedBy: { aggregateType: 'Control', projectId: wait.ref.projectId, goalId: predecessor.ref.goalId },
        purpose: 'Inspect an optional report before admission using the existing predecessor principal', basis, grantedAt: at });
      const receipt = await this.deps.control.grantMaterialAccess(buildGrantMaterialAccessCommand(grant, { commandId: id, projectId: wait.ref.projectId,
        actorKind: 'system', actorId: 'alternative-report-inspection', idempotencyKey: id, correlationId: id, submittedAt: at }));
      if (receipt.status !== 'committed') throw Error('Report inspection grant rejected: ' + receipt.status);
    }
    await this.deps.synchronizeGrants();
    const observed = await this.deps.materials.observe(wait, predecessor, read.candidates);
    return this.deps.observations.record(wait, predecessor, read.candidates, observed);
  }
}
