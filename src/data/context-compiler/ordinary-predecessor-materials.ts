/** Ordinary hard-DAG dependency material. Selection consumes Control's recorded
 * reduction; it never computes acceptance or relabels a model review as operator. */
import type { AggregateRef, AggregateSnapshot, GoalSnapshot, StateLedger } from '../../contracts/ledger.js';
import type { TaskEnvelopeV1 } from '../../contracts/task-envelope.js';
import type { ArtifactPort, ArtifactRef } from '../../contracts/artifact.js';
import { artifactBodyDigest, artifactBodySize } from '../../contracts/artifact.js';
import type { MaterialBasisV1, SourceApplicabilityPort } from '../../contracts/material-access.js';
import type { PlanRevisionSnapshot } from '../../contracts/plan.js';
import type { TaskReductionSnapshot } from '../../contracts/reduction.js';
import type { EvidenceSnapshot } from '../../contracts/evidence.js';
import type { ReviewResultSnapshot, ReviewWorkSnapshot } from '../../contracts/reviewer-work.js';
import type { RuntimeContextMaterials } from '../../contracts/runtime-context-materials.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';

type Predecessor = Extract<RuntimeContextMaterials['predecessors'][number], { kind: 'canonical-verification' }>;
type Document = { kind: Predecessor['documents'][number]['kind']; id: string; ref: ArtifactRef };
export type OrdinaryPredecessorSelection = {
  envelope: TaskEnvelopeV1; basis: MaterialBasisV1 | null; grantedAt: string;
  pins: AggregateSnapshot[];
  entries: Array<{ reduction: TaskReductionSnapshot; evidence: EvidenceSnapshot[]; documents: Document[] }>;
};
const same = (a: unknown, b: unknown) => canonicalJson(a as never) === canonicalJson(b as never);
function ensure(value: unknown, message: string): asserts value { if (!value) throw Error('Ordinary predecessor: ' + message); }

export class OrdinaryPredecessorMaterialCompiler {
  constructor(private readonly deps: { ledger: Pick<StateLedger, 'load'>; vault: ArtifactPort; source: SourceApplicabilityPort }) {}

  private async load(ref: AggregateRef): Promise<AggregateSnapshot> {
    const result = await this.deps.ledger.load(ref);
    ensure(result.status === 'found' && same(result.snapshot.ref, ref), 'canonical fact missing: ' + canonicalJson(ref));
    return result.snapshot;
  }
  private async basis(e: TaskEnvelopeV1): Promise<MaterialBasisV1> {
    const source = await this.deps.source.capture({ projectId: e.projectId, workspaceId: e.workspaceId, sourceSet: { kind: 'verification_workspace', paths: ['.'] } });
    ensure(source.status === 'sourced', 'current verification source unavailable');
    return { planRef: e.planRef, workspaceRevision: e.workspaceSnapshot.revision, sourceDigest: source.pin.manifestDigest, sourcePin: source.pin };
  }
  async select(e: TaskEnvelopeV1): Promise<OrdinaryPredecessorSelection> {
    const plan = await this.load(e.planRef) as PlanRevisionSnapshot;
    // executionDag.dependsOn contains only hard versioned input/output edges.
    const dependencies = plan.executionDag.dependsOn.filter(edge => edge.taskId === e.taskId).map(edge => edge.dependsOnId);
    ensure(new Set(dependencies).size === dependencies.length && dependencies.length <= 64, 'invalid or oversized hard dependency set');
    const selection: OrdinaryPredecessorSelection = { envelope: e, basis: null, grantedAt: '', pins: [], entries: [] };
    if (!dependencies.length) return selection;
    const goal = await this.load({ aggregateType: 'Goal', projectId: e.projectId, goalId: e.goalId }) as GoalSnapshot;
    const workspace = await this.load({ aggregateType: 'Workspace', projectId: e.projectId, workspaceId: e.workspaceId });
    ensure(same(goal.activePlanRevision, e.planRef) && goal.workspaceRef.workspaceId === e.workspaceId && workspace.revision === e.workspaceSnapshot.revision, 'plan/workspace changed');
    selection.pins.push(plan);
    selection.basis = await this.basis(e);
    for (const taskId of dependencies) {
      const reduction = await this.load({ aggregateType: 'TaskReduction', projectId: e.projectId, goalId: e.goalId, taskId }) as TaskReductionSnapshot;
      ensure(reduction.phase === 'satisfied' && reduction.disposition === 'active' && same(reduction.planRef, e.planRef) && reduction.planRevision === plan.planRevision && reduction.currentAnchor.workspaceRevision === e.workspaceSnapshot.revision && same(reduction.currentAnchor.pinnedCompletionPolicy, plan.effectiveCompletionPolicy) && same(reduction.currentAnchor.pinnedArchitectureBaseline, plan.effectiveArchitectureBaseline), 'dependency is not currently satisfied: ' + taskId);
      ensure(reduction.effectiveEvidenceIds.length > 0 && reduction.effectiveEvidenceIds.length <= 64, 'missing/oversized effective Evidence set');
      selection.pins.push(reduction);
      const entry: OrdinaryPredecessorSelection['entries'][number] = { reduction, evidence: [], documents: [] };
      const add = (kind: Document['kind'], id: string, ref: ArtifactRef) => {
        const existing = entry.documents.find(d => same(d.ref, ref));
        if (!existing) entry.documents.push({ kind, id, ref });
        else if (kind === 'independent-review') { existing.kind = kind; existing.id = id; }
      };
      for (const evidenceId of reduction.effectiveEvidenceIds) {
        const snapshot = await this.load({ aggregateType: 'Evidence', projectId: e.projectId, evidenceId }) as EvidenceSnapshot;
        const fact = snapshot.evidence;
        ensure(fact.outcome === 'PASS' && fact.kind !== 'claim' && fact.subject.projectId === e.projectId && fact.subject.goalId === e.goalId && fact.subject.taskId === taskId && same(fact.anchor, reduction.currentAnchor), 'effective Evidence scope/version mismatch');
        ensure(fact.summary.artifactRef, 'Evidence full body unavailable');
        entry.evidence.push(snapshot); selection.pins.push(snapshot);
        add('evidence-body', evidenceId, fact.summary.artifactRef);
        if (!selection.grantedAt || snapshot.admittedAt < selection.grantedAt) selection.grantedAt = snapshot.admittedAt;
        if (fact.reviewAdmission) {
          const admission = fact.reviewAdmission;
          const work = await this.load(admission.workRef) as ReviewWorkSnapshot;
          const result = await this.load(admission.resultRef) as ReviewResultSnapshot;
          ensure(admission.protocol === 'independent-review-v1' && work.protocol === admission.protocol && result.protocol === admission.protocol && same(work.subject, fact.subject) && same(work.planRef, e.planRef) && same(result.workRef, work.ref) && same(work.resultRef, result.ref) && work.output && same(work.output, result.output) && result.decision.status === 'accepted' && result.decision.evidenceRefs.some(ref => same(ref, snapshot.ref)), 'independent review not formally bound to Evidence');
          ensure(work.descriptor.materialIdentity.workspaceRevision === e.workspaceSnapshot.revision && same(work.descriptor.materialIdentity.planRef, e.planRef) && sha256Hex(canonicalJson({ sourceDigest: work.descriptor.materialIdentity.sourceDigest, sourceProof: work.descriptor.sourceProof })) === selection.basis.sourcePin!.manifestDigest, 'independent review source changed');
          selection.pins.push(work, result);
          add('independent-review', work.ref.reviewId, result.output.reportRef);
          for (const tool of work.descriptor.tools) add('tool-report', tool.checkId, tool.reportRef);
        }
      }
      selection.entries.push(entry);
    }
    ensure(this.materialsOf(selection).length <= 64, 'full predecessor material set exceeds grant capacity');
    await this.assertFacts(selection);
    return selection;
  }
  materialsOf(selection: OrdinaryPredecessorSelection): ArtifactRef[] {
    const refs = new Map<string, ArtifactRef>();
    for (const row of selection.entries) for (const doc of row.documents) refs.set(canonicalJson(doc.ref), doc.ref);
    return [...refs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, ref]) => ref);
  }
  private async assertFacts(selection: OrdinaryPredecessorSelection) {
    if (!selection.entries.length) return;
    const e = selection.envelope;
    const goal = await this.load({ aggregateType: 'Goal', projectId: e.projectId, goalId: e.goalId }) as GoalSnapshot;
    const workspace = await this.load({ aggregateType: 'Workspace', projectId: e.projectId, workspaceId: e.workspaceId });
    ensure(same(goal.activePlanRevision, e.planRef) && goal.workspaceRef.workspaceId === e.workspaceId && workspace.revision === e.workspaceSnapshot.revision, 'current plan/workspace changed');
    for (const pin of selection.pins) ensure(same(await this.load(pin.ref), pin), 'selected canonical version changed');
    ensure(same(await this.basis(e), selection.basis), 'selected source changed');
  }
  async assemble(selection: OrdinaryPredecessorSelection): Promise<Predecessor[]> {
    await this.assertFacts(selection);
    const result: Predecessor[] = [];
    for (const row of selection.entries) {
      const documents: Predecessor['documents'] = [];
      for (const doc of row.documents) {
        const opened = await this.deps.vault.open(doc.ref, { requesterRunRef: selection.envelope.runRef, currentBasis: selection.basis!, usage: 'current' });
        ensure(opened.status === 'ready', 'exact authorized predecessor body unavailable or revoked: ' + doc.id + ' ' + opened.status + (opened.status === 'rejected' ? ' ' + opened.code + ' ' + opened.issues.join('; ') : ''));
        const body = opened.record.body;
        ensure(artifactBodyDigest(body) === doc.ref.digest && artifactBodySize(body) === doc.ref.sizeBytes, 'predecessor body identity mismatch');
        if (doc.kind === 'evidence-body') {
          const parsed = JSON.parse(body);
          if (parsed.category === 'verification_round') ensure(sha256Hex(canonicalJson({ sourceDigest: parsed.identity?.sourceDigest, sourceProof: parsed.sourceProof })) === selection.basis!.sourcePin!.manifestDigest, 'tool aggregate source changed');
          else ensure(row.evidence.some(e => e.evidence.reviewAdmission && same(e.evidence.summary.artifactRef, doc.ref)), 'ordinary Evidence source has no supported verification witness');
        }
        documents.push({ kind: doc.kind, id: doc.id, text: { content: body, digest: doc.ref.digest, sourceRefs: [{ kind: 'artifact', refId: doc.ref.digest, revision: '1', digest: doc.ref.digest }], selectedBecause: 'Full authorized ' + doc.kind + ' from the current direct predecessor; aggregate report references are an index, not a claim of reading unselected nested reports.' } });
      }
      result.push({ kind: 'canonical-verification', taskId: row.reduction.ref.taskId, reductionRef: row.reduction.ref, reductionRevision: row.reduction.revision, documents,
        evidenceRefs: row.evidence.map(e => ({ kind: 'artifact', refId: 'evidence:' + e.ref.evidenceId, revision: String(e.revision), digest: e.evidence.summary.artifactRef!.digest })) });
    }
    await this.assertFacts(selection);
    return result;
  }
  /** Reopen the exact grants and recheck fixed facts; never select replacements. */
  async assertCurrent(selection: OrdinaryPredecessorSelection): Promise<void> { await this.assemble(selection); }
}
