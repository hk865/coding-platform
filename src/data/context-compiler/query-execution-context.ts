import type { StateLedger, GoalSnapshot, GoalRef } from '../../contracts/ledger.js';
import type { ArtifactPort } from '../../contracts/artifact.js';
import type { QueryJobSnapshot, QueryRunSnapshot } from '../../contracts/query-job.js';
import type { QueryExecutionMaterialPort, QueryExecutionMaterial, QueryExecutionRequest, QuerySourceObservationPort, QuerySourceRevisionPort } from '../../contracts/query-execution-context.js';

import { INITIAL_PLANNING_RESPONSE_GUIDE } from '../../contracts/initial-planning.js';
import { FEEDBACK_RESPONSE_GUIDE } from '../../contracts/execution-feedback.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import { validateRuntimeBudget } from '../../contracts/runtime-budget.js';

/** A source-applicability query, not a model or worker-control dependency. */
export interface CoordinationSourcePort {
  currentness(projectId: string, workspaceId: string): Promise<Map<string, boolean>>;
}

/** Compile the role-specific model input from a claimed query and its authorized
 * bundle. Runtime executes this input without interpreting planning semantics. */
export class QueryExecutionContextCompiler implements QueryExecutionMaterialPort {
  constructor(private readonly deps: { ledger: () => Pick<StateLedger, 'load'>; vault: () => ArtifactPort }) {}
  async assemble(request: QueryExecutionRequest): Promise<QueryExecutionMaterial> {
    const ledger = this.deps.ledger();
    const run = await ledger.load(request.runRef);
    const job = await ledger.load({ aggregateType: 'QueryJob', projectId: request.runRef.projectId, workspaceId: request.runRef.workspaceId, queryJobId: request.runRef.queryJobId });
    if (run.status !== 'found' || job.status !== 'found' || run.snapshot.ref.aggregateType !== 'QueryRun' || job.snapshot.ref.aggregateType !== 'QueryJob' ||
      (run.snapshot as QueryRunSnapshot).run.status !== 'running' || (job.snapshot as QueryJobSnapshot).job.status !== 'running')
      return { status: 'rejected', code: 'invalid_claim', message: 'query runtime requires a durable running claim' };
    const snapshot = (job.snapshot as QueryJobSnapshot), intent = snapshot.job.intent, execution = intent.execution;
    if (!execution || intent.question !== request.question || canonicalJson(snapshot.job.runRef) !== canonicalJson(request.runRef))
      return { status: 'rejected', code: 'invalid_claim', message: 'query runtime requires exact real role intent' };
    const material = await this.deps.vault().open(request.bundleRef, { requesterRunRef: request.runRef });
    if (material.status !== 'ready') return { status: 'rejected', code: 'unavailable', message: 'Canonical query material is unavailable.' };
    try {
      const budget = validateRuntimeBudget(execution.runtimeBudget);
      const input = canonicalJson({ kind: execution.kind, responsibilities: execution.kind === 'initial_coordination' ? ['clarify_user_intent', 'propose_acceptance_and_dependency_plan', 'explain_tradeoffs'] : ['answer_question_from_public_facts_and_source', 'cite_versions_and_unknowns'],
        roleBinding: execution.roleBinding, permissions: { tools: ['read'], writeScope: [] },
        ...(execution.kind === 'initial_coordination' ? { responseContract: INITIAL_PLANNING_RESPONSE_GUIDE } : execution.kind === 'execution_coordination' ? { responseContract: FEEDBACK_RESPONSE_GUIDE } : {}),
        rules: ['Read-only analysis. Use source tools when needed; do not run commands or edit files.', 'Return public evidence, source versions and unknowns. Do not claim Task or Goal completion.', 'Stored history is explanatory unless current applicability is separately verified.'],
        material: JSON.parse(material.record.body), sourceBundle: material.record.ref, question: request.question });
      return { status: 'ready', input, kind: execution.kind, goalId: intent.goalId, roleBinding: execution.roleBinding, budget, deadline: intent.budget.deadline };
    } catch (error) { return { status: 'rejected', code: 'invalid_material', message: 'Invalid query execution material: ' + String(error) }; }
  }
}

/** Compare public source observations and original goal/workspace versions.
 * Legacy persisted input remains readable; malformed/missing facts fail closed. */
export class QuerySourceContextCompiler implements CoordinationSourcePort {
  constructor(private readonly deps: { ledger: () => Pick<StateLedger, 'load'>; observations: QuerySourceObservationPort; source: QuerySourceRevisionPort }) {}
  async currentness(projectId: string, workspaceId: string): Promise<Map<string, boolean>> {
    const records = this.deps.observations.all().filter(record => record.runRef.projectId === projectId && record.runRef.workspaceId === workspaceId && record.status === 'completed');
    const current = new Map<string, boolean>();
    if (!records.length) return current;
    let source: string | null = null;
    try { source = await this.deps.source.sourceRevision(projectId, workspaceId); } catch { /* Unavailable is not current. */ }
    for (const record of records) {
      let valid = false;
      try {
        const context = (JSON.parse(record.input) as { material?: { goalContext?: { ref: GoalRef; revision: number; workspaceRevision: number } } }).material?.goalContext;
        if (context && context.ref.aggregateType === 'Goal' && context.ref.projectId === projectId && Number.isSafeInteger(context.revision) && Number.isSafeInteger(context.workspaceRevision)) {
          const goal = await this.deps.ledger().load(context.ref), workspace = await this.deps.ledger().load({ aggregateType: 'Workspace', projectId, workspaceId });
          valid = source !== null && record.sourceAfter === source && goal.status === 'found' && goal.snapshot.ref.aggregateType === 'Goal' &&
            (goal.snapshot as GoalSnapshot).workspaceRef.workspaceId === workspaceId && goal.snapshot.revision === context.revision && workspace.status === 'found' && workspace.snapshot.revision === context.workspaceRevision;
        }
      } catch { /* Corrupt legacy records are explicit stale/unavailable material. */ }
      current.set(record.runRef.queryJobId, valid);
    }
    return current;
  }
}
