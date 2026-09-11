import type { ArchitectureContextPort, ArchitectureContextResult } from '../../contracts/architecture-context.js';
import type { ArchitectureInspectionIntentV1, ArchitectureInspectionSnapshot } from '../../contracts/architecture-inspection.js';
import { architectureInspectionRefFor, INSPECTION_MAX_NODES, INSPECTION_MAX_EDGES } from '../../contracts/architecture-inspection.js';
import type { StateLedger } from '../../contracts/ledger.js';
import type { WorkspaceReadPort } from '../../contracts/workspace-read.js';
import type { PlanRevisionSnapshot } from '../../contracts/plan.js';
import type { RunSnapshot } from '../../contracts/dispatch.js';
import { governanceContentDigest, type ArchitectureBaselineRevisionSnapshot } from '../../contracts/governance.js';
import { architectureSourceIssues } from '../../contracts/architecture-source.js';
import { validateArchitectureInspectionIntent } from '../../contracts/validation/architecture.js';
import { canonicalJson } from '../../contracts/fingerprint.js';

type RejectionCode = Extract<ArchitectureContextResult, { status: 'fail_closed' }>['code'];
const rejected = (code: RejectionCode, message: string): ArchitectureContextResult => ({ status: 'fail_closed', code, diagnostics: [message] });

/** Context owns inspection material applicability; reconciliation only classifies
 * the returned source differences and requests durable records from Control. */
export class ArchitectureContextCompiler implements ArchitectureContextPort {
  constructor(private readonly deps: { ledger: Pick<StateLedger, 'load'>; workspaceReader: WorkspaceReadPort }) {}

  async assemble(intent: ArchitectureInspectionIntentV1): Promise<ArchitectureContextResult> {
    const issues = validateArchitectureInspectionIntent(intent);
    if (issues.length) return rejected('plan_pin_missing', JSON.stringify(issues));

    const pinned = await this.deps.ledger.load(intent.baselinePin.ref);
    if (pinned.status !== 'found' || pinned.snapshot.ref.aggregateType !== 'ArchitectureBaselineRevision') {
      return rejected('baseline_unresolved', 'pinned baseline unavailable');
    }
    const baseline = pinned.snapshot as ArchitectureBaselineRevisionSnapshot;
    const digest = governanceContentDigest({ schemaVersion: 1, identity: { baselineId: baseline.baselineId }, revision: baseline.contentRevision, content: baseline.content });
    if (baseline.contentDigest !== intent.baselinePin.digest || digest !== intent.baselinePin.digest) {
      return rejected('baseline_digest_mismatch', 'baseline content/pin mismatch');
    }

    const loadedPlan = await this.deps.ledger.load(intent.planRef);
    if (loadedPlan.status !== 'found' || loadedPlan.snapshot.ref.aggregateType !== 'PlanRevision') {
      return rejected('plan_pin_missing', 'inspection baseline must equal the actual PlanRevision pin');
    }
    const plan = loadedPlan.snapshot as PlanRevisionSnapshot;
    if (canonicalJson(plan.effectiveArchitectureBaseline) !== canonicalJson(intent.baselinePin)) {
      return rejected('plan_pin_missing', 'inspection baseline must equal the actual PlanRevision pin');
    }
    if (!intent.requestedByRunRef || intent.requestedByRunRef.projectId !== intent.projectId || intent.requestedByRunRef.goalId !== plan.goalRef.goalId) {
      return rejected('workspace_unavailable', 'a scoped reader Run is required to own and consume inspection bodies');
    }
    const owner = await this.deps.ledger.load(intent.requestedByRunRef);
    if (owner.status !== 'found' || owner.snapshot.ref.aggregateType !== 'Run') return rejected('workspace_unavailable', 'reader Run unavailable');
    const reader = owner.snapshot as RunSnapshot;
    if (reader.envelope?.workspaceId !== intent.workspaceId || canonicalJson(reader.planRef) !== canonicalJson(intent.planRef)) {
      return rejected('workspace_unavailable', 'reader Run workspace or plan differs');
    }
    const prior = await this.deps.ledger.load(architectureInspectionRefFor(intent.projectId, intent.workspaceId, intent.inspectionId));
    if (prior.status === 'found' && canonicalJson((prior.snapshot as ArchitectureInspectionSnapshot).intent) !== canonicalJson(intent)) {
      return rejected('recording_rejected', 'inspection id already binds a different intent');
    }
    const materials = { baseline, readerRevision: reader.revision, priorRecordedAt: prior.status === 'found' ? (prior.snapshot as ArchitectureInspectionSnapshot).recordedAt : null };
    if (intent.source === 'report') return { status: 'ready', materials: { ...materials, sources: null } };

    const source = baseline.content.sourceBinding;
    if (!source || architectureSourceIssues(source).length || source.projectId !== intent.projectId || source.workspaceId !== intent.workspaceId) {
      return rejected('baseline_unresolved', 'baseline has no valid, exact source binding; no revision-zero fallback');
    }
    const read = await this.deps.workspaceReader.read({
      schemaVersion: 1, projectId: intent.projectId, workspaceId: intent.workspaceId, workspaceRevision: intent.workspaceRevision,
      planRef: intent.planRef, baselinePin: intent.baselinePin, requestedKinds: ['module', 'interface'],
      maxNodes: INSPECTION_MAX_NODES, maxEdges: INSPECTION_MAX_EDGES, requesterRunRef: intent.requestedByRunRef,
    });
    if (read.status !== 'sourced') return rejected('workspace_unavailable', JSON.stringify(read));
    const current = read.snapshot.sourceSnapshot;
    if (!current || architectureSourceIssues(current).length || current.projectId !== intent.projectId || current.workspaceId !== intent.workspaceId || current.workspaceRevision !== intent.workspaceRevision || read.snapshot.workspaceRevision !== intent.workspaceRevision || !read.snapshot.indexCapabilities.hasCodeGraph) {
      return rejected('workspace_unavailable', 'current graph lacks valid current source binding');
    }
    if (current.indexVersion !== source.indexVersion || canonicalJson(current.mappings) !== canonicalJson(source.mappings) || current.configPath !== source.configPath) {
      return rejected('workspace_unavailable', 'index version/configuration or source mapping changed; explicit baseline revision required');
    }
    return { status: 'ready', materials: { ...materials, sources: { baseline: source, current } } };
  }
}
