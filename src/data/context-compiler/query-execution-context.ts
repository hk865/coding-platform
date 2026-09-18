import type { StateLedger, GoalSnapshot, GoalRef } from '../../contracts/ledger.js';
import type { ArtifactPort } from '../../contracts/artifact.js';
import type { QueryJobSnapshot, QueryRunSnapshot } from '../../contracts/query-job.js';
import type { QueryExecutionMaterialPort, QueryExecutionMaterial, QueryExecutionRequest, QuerySourceObservationPort, QuerySourceRevisionPort, QueryFactLocation, QueryFactRead } from '../../contracts/query-execution-context.js';
import { createHash } from 'node:crypto';
import { artifactPointerExists } from '../../contracts/validation/artifact-pointer.js';
import { semanticQueryGuideFor, COORDINATION_JSON_RESPONSE_GUIDE } from '../../contracts/query-execution-context.js';
import { QUERY_CONTEXT_LABELS, type QueryFactMeaning } from '../../contracts/query-fact-vocabulary.js';

import { INITIAL_PLANNING_RESPONSE_GUIDE } from '../../contracts/initial-planning.js';
import { FEEDBACK_RESPONSE_GUIDE } from '../../contracts/execution-feedback.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import { validateRuntimeBudget } from '../../contracts/runtime-budget.js';
import { memoryInput } from './memory-context.js';
import { selectQueryCollaborationFacts, type QueryArchitectureFacts } from './query-collaboration-facts.js';

/** A source-applicability query, not a model or worker-control dependency. */
export interface CoordinationSourcePort {
  currentness(projectId: string, workspaceId: string): Promise<Map<string, boolean>>;
}

/** Compile the role-specific model input from a claimed query and its authorized
 * bundle. Runtime executes this input without interpreting planning semantics. */
export class QueryExecutionContextCompiler implements QueryExecutionMaterialPort {
  constructor(private readonly deps: { ledger: () => Pick<StateLedger, 'load'>; vault: () => ArtifactPort; memory?: import('../../contracts/memory.js').MemorySelectionPort; now?:()=>string }) {}
  async readFact(request: QueryExecutionRequest, location: QueryFactLocation): Promise<QueryFactRead> {
    const { pointer, inputDigest } = location;
    if (!/^[a-f0-9]{64}$/.test(inputDigest) || pointer.length > 2048 ||
        !/^\/(material|maintainedPreferences)(\/|$)/.test(pointer) || /~(?![01])/.test(pointer))
      return { status: 'forbidden', message: 'Select a location within the authorized material or applicable preference snapshot.' };
    return this.factFromMaterial(request, location, await this.assemble(request));
  }
  async readPublishedFacts(request: QueryExecutionRequest, locations: QueryFactLocation[], inputDigest: string): Promise<QueryFactRead[]> {
    if (locations.length > 24) throw Error('Too many answer citations');
    const current = await this.compile(request, true);
    if (current.status !== 'ready') throw Error('Published answer material rejected: ' + current.code + ': ' + current.message);
    if (createHash('sha256').update(current.input).digest('hex') !== inputDigest || locations.some(location => location.inputDigest !== inputDigest)) throw Error('Published answer input version changed');
    return locations.map(location => this.factFromMaterial(request, location, current));
  }
  private factFromMaterial(request: QueryExecutionRequest, location: QueryFactLocation, current: QueryExecutionMaterial): QueryFactRead {
    const { pointer, inputDigest } = location;
    if (!/^[a-f0-9]{64}$/.test(inputDigest) || pointer.length > 2048 || !/^\/(material|maintainedPreferences)(\/|$)/.test(pointer) || /~(?![01])/.test(pointer))
      return { status: 'forbidden', message: 'Invalid cited location' };
    if (current.status !== 'ready') return { status: 'unavailable', message: 'The query material is no longer authorized or available.' };
    if (createHash('sha256').update(current.input).digest('hex') !== inputDigest)
      return { status: 'stale', message: 'The selected query input or preferences changed; request a new observation.' };
    if (!artifactPointerExists(current.input, pointer)) return { status: 'not_found', inputDigest, pointer,
      observation: 'captured_query_input', message: 'This JSON location is absent from this captured input only; no domain-wide absence is established.' };
    const input = JSON.parse(current.input);
    let value: import('../../contracts/fingerprint.js').JsonValue = input;
    for (const key of pointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~')))
      value = (value as Record<string, import('../../contracts/fingerprint.js').JsonValue>)[key]!;
    const applicabilityAuthority = verificationApplicabilityAuthority(input, pointer, current.goalId, request.runRef);
    const meaning = queryFactMeaning(input, pointer, inputDigest, current.goalId, request.runRef);
    const result = { status: 'ready' as const, inputDigest, pointer, observation: 'captured_query_input' as const, sourceBundle: input.sourceBundle, value,
      ...(applicabilityAuthority ? { applicabilityAuthority } : {}), ...(meaning ? { meaning } : {}) };
    if (Buffer.byteLength(JSON.stringify(result)) > 16 * 1024) return { status: 'too_large', message: 'Select a more specific subrecord; this fact is not truncated or treated as empty.' };
    return result;
  }
  async assemble(request: QueryExecutionRequest): Promise<QueryExecutionMaterial> { return this.compile(request, false); }
  private async compile(request: QueryExecutionRequest, published: boolean): Promise<QueryExecutionMaterial> {
    const ledger = this.deps.ledger();
    const run = await ledger.load(request.runRef);
    const job = await ledger.load({ aggregateType: 'QueryJob', projectId: request.runRef.projectId, workspaceId: request.runRef.workspaceId, queryJobId: request.runRef.queryJobId });
    if (run.status !== 'found' || job.status !== 'found' || run.snapshot.ref.aggregateType !== 'QueryRun' || job.snapshot.ref.aggregateType !== 'QueryJob' ||
      (published ? (run.snapshot as QueryRunSnapshot).run.status !== 'answered' || (run.snapshot as QueryRunSnapshot).run.outcome !== 'answered' || (job.snapshot as QueryJobSnapshot).job.status !== 'answered' : (run.snapshot as QueryRunSnapshot).run.status !== 'running' || (job.snapshot as QueryJobSnapshot).job.status !== 'running'))
      return { status: 'rejected', code: 'invalid_claim', message: published ? 'published facts require a durable answered run and job' : 'query runtime requires a durable running claim' };
    const snapshot = (job.snapshot as QueryJobSnapshot), intent = snapshot.job.intent, execution = intent.execution;
    if (!execution || intent.question !== request.question || canonicalJson(snapshot.job.runRef) !== canonicalJson(request.runRef))
      return { status: 'rejected', code: 'invalid_claim', message: 'query runtime requires exact real role intent' };
    if (published && canonicalJson((run.snapshot as QueryRunSnapshot).run.execution?.request ?? null) !== canonicalJson(request))
      return { status: 'rejected', code: 'invalid_claim', message: 'published facts require the exact recorded execution binding' };
    const material = await this.deps.vault().open(request.bundleRef, { requesterRunRef: request.runRef });
    if (material.status !== 'ready') return { status: 'rejected', code: 'unavailable', message: 'Canonical query material is unavailable.' };
    try {
      const budget = validateRuntimeBudget(execution.runtimeBudget);
      const purpose = execution.responsePurpose ?? (execution.kind === 'initial_coordination' ? 'planning' : execution.kind === 'execution_coordination' ? 'progress' : 'reply');
      const memory = this.deps.memory ? await this.deps.memory.select({projectId:intent.projectId,workspaceId:intent.workspaceId,purpose,now:this.deps.now?.()??new Date().toISOString()}) : null;
      if(memory && memory.status!=='ready')return {status:'rejected',code:'unavailable',message:memory.reason};
      const capturedMaterial = JSON.parse(material.record.body);
      if (capturedMaterial.queryVocabularyVersion !== undefined && capturedMaterial.queryVocabularyVersion !== 1) throw Error('Unsupported captured Query vocabulary version');
      const vocabularyEnabled = capturedMaterial.queryVocabularyVersion === 1;
      if (capturedMaterial.queryPresentationVersion !== undefined && ![2, 3].includes(capturedMaterial.queryPresentationVersion)) throw Error('Unsupported captured Query presentation version');
      const onDemand = capturedMaterial.queryPresentationVersion === 3;
      const summary = onDemand || (capturedMaterial.queryPresentationVersion === 2 && !['architecture', 'handoff'].includes(purpose));
      const guide = vocabularyEnabled ? (onDemand || summary ? semanticQueryGuideFor(purpose) : purpose === 'architecture' || purpose === 'handoff' ? (await import('../../contracts/history/query-role-skills-v10.js')).HISTORICAL_ROLE_SKILLS_V10[purpose === 'architecture' ? 'adviser' : 'scribe'] : (await import('../../contracts/history/query-secretary-v10.js')).HISTORICAL_SECRETARY_V10) : (await import('../../contracts/history/query-response-guides-v1-v9.js')).historicalUnversionedQueryGuide(purpose);
      const presentation = { responseGuide: execution.kind === 'semantic_query' ? guide.id : COORDINATION_JSON_RESPONSE_GUIDE.id };
      const input = canonicalJson({ kind: execution.kind, responsibilities: execution.kind === 'initial_coordination' ? ['clarify_user_intent', 'propose_acceptance_and_dependency_plan', 'explain_tradeoffs'] : ['answer_question_from_public_facts_and_source', 'cite_versions_and_unknowns'],
        roleBinding: execution.roleBinding, permissions: { tools: execution.kind === 'semantic_query' ? ['read', 'read_query_fact'] : ['read'], writeScope: [] },
        ...(execution.kind === 'initial_coordination' ? { responseContract: INITIAL_PLANNING_RESPONSE_GUIDE } : execution.kind === 'execution_coordination' ? { responseContract: FEEDBACK_RESPONSE_GUIDE } : {}),
        rules: execution.kind === 'semantic_query' ? ['Read-only response under the selected versioned role Skill.', onDemand ? 'Answer with traceable citations; typed assertions are optional. Preferences remain scoped data.' : summary ? 'Produce a concise traceable summary with citations; typed assertions are optional. Preferences remain scoped data.' : 'Use authorized facts, typed state assertions and citations; preferences remain scoped data.'] : ['Read-only analysis. Use source tools when needed; do not run commands or edit files.', 'Base the answer on public evidence, source versions and unknowns; present only the facts relevant to this question. Do not reduce or mutate Task or Goal state yourself, or infer completion from model statements or Task conjunctions. You may accurately cite committed Task reductions and the independent goalPhase, including recorded COMPLETED, while preserving their version, time and Plan applicability in your assessment; cite specific identifiers only when needed to support the answer. Query source freshness only describes this Query observation; it does not connect prior acceptance to the currently observed source. Without an explicit verification-to-source witness, do not claim new or externally changed source has passed acceptance. A historical or absent GoalPhase is not current completion.', 'Use collaborationWork.latestRun for execution facts and architectureReviews for recorded human decisions. Accepted plan phase is not live progress. Missing formal reduction does not mean a task has never run.', 'Do not invent component ownership, constraints or human decisions. Platform governance roles do not establish ownership of project-domain objects. Explicitly label any unsourced design idea as a suggestion, not an existing rule or accepted decision.', 'A missing reduction is unknown formal acceptance, not proof that no evidence exists or every obligation failed. Before suggesting Gate execution, check every listed dependency, including tasks outside the focused Task. In a brief answer, group unmet prerequisites without omitting any from the readiness judgment. Missing prerequisite verification means readiness is unproven, not that a dependency failed. Do not present an unqualified Gate as ready. Do not infer a violation or unchanged implementation from a role assignment.', 'Stored history is explanatory unless current applicability is separately verified.', 'Apply maintainedPreferences to this response purpose. If the selected preference requests a brief response, use up to three short sentences answering the question; no blocker, next action or decision slot is required, unless the current user explicitly requests more detail. Detailed architecture preferences apply only when selected for architecture. Keep source identifiers concise unless needed to substantiate a disputed fact; do not repeat full protocol inventories in ordinary replies.'],
        ...presentation, ...(vocabularyEnabled ? { contextLabels: QUERY_CONTEXT_LABELS } : {}), responsePurpose: purpose, ...(memory?.status==='ready'?{maintainedPreferences:JSON.parse(memoryInput(memory))}:{}),
        material: JSON.parse(material.record.body), sourceBundle: material.record.ref, question: request.question });
      return { status: 'ready', input, kind: execution.kind, goalId: intent.goalId, roleBinding: execution.roleBinding, budget, deadline: intent.budget.deadline, ...presentation,
        ...(execution.kind === 'semantic_query' ? { factReadVersion: summary ? 4 as const : 3 as const } : {}) };
    } catch (error) { return { status: 'rejected', code: 'invalid_material', message: 'Invalid query execution material: ' + String(error) }; }
  }
}

/** Label only complete recognized observations; arbitrary child values and
 * memory cannot acquire a domain meaning merely by resembling a record. */
function queryFactMeaning(input: any, pointer: string, inputDigest: string, goalId: string | null, runRef: QueryExecutionRequest['runRef']): QueryFactMeaning | undefined {
  const key = pointer.match(/^\/material\/([A-Za-z]+)$/)?.[1];
  if (!key || !Object.hasOwn(QUERY_CONTEXT_LABELS.records, key)) return;
  const scope = input.material?.observationScope;
  if (!goalId || scope?.projectId !== runRef.projectId || scope?.workspaceId !== runRef.workspaceId || scope?.goalId !== goalId || typeof input.material.capturedAt !== 'string') return;
  const label = QUERY_CONTEXT_LABELS.records[key as keyof typeof QUERY_CONTEXT_LABELS.records];
  const value = input.material[key];
  const observationStatus = key === 'architectureReviews'
    ? value?.status === 'ready' && Array.isArray(value.rows) && value.rows.length === 0 ? 'ready-empty' : value?.status ?? 'unknown'
    : key === 'humanActions' || key === 'verificationStages' || key === 'architectureActivation' ? value?.status ?? 'unknown'
    : value === null ? 'unknown' : 'ready';
  return { ...label, scope: key === 'architectureActivation' ? { projectId: scope.projectId } : scope, inputDigest, observedAt: value?.observedAt ?? input.material.capturedAt, recordPointer: pointer, observationStatus };
}

/** A bare applicability object has no record identity of its own. Recover that
 * identity only from its captured, scope-matching Verification parent. */
function verificationApplicabilityAuthority(input: any, pointer: string, goalId: string | null, runRef: QueryExecutionRequest['runRef']): import('../../contracts/query-quality-facts.js').QueryApplicabilityAuthority | undefined {
  const match = /^\/material\/verificationStages\/(rounds|reviews)\/(0|[1-9][0-9]*)(?:\/applicability)?$/.exec(pointer);
  if (!match) return;
  const observation = input?.material?.verificationStages, kind = match[1]!, index = Number(match[2]);
  const record = observation?.[kind]?.[index], scope = observation?.scope;
  if (observation?.schemaVersion !== 1 || observation.object !== 'verification-stages' || observation.status !== 'ready' ||
      !Array.isArray(observation[kind]) || !scope || !record?.applicability ||
      scope.projectId !== runRef?.projectId || scope.workspaceId !== runRef?.workspaceId || !goalId || scope.goalId !== goalId ||
      !['projectId', 'workspaceId', 'goalId'].every(key => record.scope?.[key] === scope[key]) ||
      !/^[a-f0-9]{64}$/.test(observation.version) || typeof observation.observedAt !== 'string' ||
      typeof record.version !== 'string' || !record.version || typeof record.recordedAt !== 'string') return;
  const recordId = kind === 'rounds' ? record.roundId : record.reviewId;
  if (typeof recordId !== 'string' || !recordId) return;
  return { family: 'verification-applicability', scope, observationVersion: observation.version, observedAt: observation.observedAt,
    recordPointer: `/material/verificationStages/${kind}/${index}`, recordKind: kind === 'rounds' ? 'tool-round' : 'independent-review',
    recordId, recordVersion: record.version, recordedAt: record.recordedAt };
}

/** Compare public source observations and original goal/workspace versions.
 * Legacy persisted input remains readable; malformed/missing facts fail closed. */
export class QuerySourceContextCompiler implements CoordinationSourcePort {
  constructor(private readonly deps: { ledger: () => Pick<StateLedger, 'load'>; architectureActivation?: import('../../contracts/governance-view.js').ArchitectureActivationReader; observations: QuerySourceObservationPort; source: QuerySourceRevisionPort; humanActions?: import('../../contracts/query-quality-facts.js').QueryHumanActionsPort['queryHumanActions']; verificationFacts?: import('../../contracts/query-quality-facts.js').QueryVerificationFactsPort['queryFacts']; architectureReviews?: QueryArchitectureFacts }) {}
  async currentness(projectId: string, workspaceId: string, options: { queryJobId?: string; runId?: string; signal?: AbortSignal } = {}): Promise<Map<string, boolean>> {
    options.signal?.throwIfAborted();
    const records = this.deps.observations.all().filter(record => record.runRef.projectId === projectId && record.runRef.workspaceId === workspaceId && record.status === 'completed' && (!options.queryJobId || record.runRef.queryJobId === options.queryJobId) && (!options.runId || record.runRef.runId === options.runId));
    const current = new Map<string, boolean>();
    if (!records.length) return current;
    let source: string | null = null;
    try { source = await this.deps.source.sourceRevision(projectId, workspaceId, options.signal); } catch { /* Unavailable is not current. */ }
    const verificationCache = new Map<string, Promise<import('../../contracts/query-quality-facts.js').QueryVerificationFacts>>();
    const verificationFacts = this.deps.verificationFacts ? (scope: import('../../contracts/query-quality-facts.js').QueryFactScope) => { const key=canonicalJson(scope); let value=verificationCache.get(key); if(!value){value=this.deps.verificationFacts!(scope, options.signal);verificationCache.set(key,value);} return value; } : undefined;
    const humanActionsCache = new Map<string, Promise<import('../../contracts/query-quality-facts.js').QueryHumanActionsFacts>>();
    const humanActions = this.deps.humanActions ? (scope: import('../../contracts/query-quality-facts.js').QueryFactScope) => { const key=canonicalJson(scope); let value=humanActionsCache.get(key); if(!value){value=this.deps.humanActions!(scope, options.signal);humanActionsCache.set(key,value);} return value; } : undefined;
    for (const record of records) {
      options.signal?.throwIfAborted();
      let valid = false;
      try {
        const material = (JSON.parse(record.input) as { material?: { architectureActivation?: unknown; humanActions?: unknown; verificationStages?: unknown; goalContext?: { ref: GoalRef; revision: number; workspaceRevision: number }; dynamicFactVersions?: import('../../contracts/ledger.js').VersionedRef[]; dynamicFactSet?: { schemaVersion: number; digest: string } } }).material;
        const context = material?.goalContext;
        if (context && context.ref.aggregateType === 'Goal' && context.ref.projectId === projectId && Number.isSafeInteger(context.revision) && Number.isSafeInteger(context.workspaceRevision)) {
          const goal = await this.deps.ledger().load(context.ref), workspace = await this.deps.ledger().load({ aggregateType: 'Workspace', projectId, workspaceId });
          valid = source !== null && record.sourceAfter === source && goal.status === 'found' && goal.snapshot.ref.aggregateType === 'Goal' &&
            (goal.snapshot as GoalSnapshot).workspaceRef.workspaceId === workspaceId && goal.snapshot.revision === context.revision && workspace.status === 'found' && workspace.snapshot.revision === context.workspaceRevision;
          const versionsCurrent = async (): Promise<boolean> => {
            if (material?.dynamicFactVersions === undefined) return true;
            if (!Array.isArray(material.dynamicFactVersions) || material.dynamicFactVersions.length > 256) return false;
            for (const fact of material.dynamicFactVersions) {
              if (!fact?.ref || !('projectId' in fact.ref) || fact.ref.projectId !== projectId || !Number.isSafeInteger(fact.revision) || fact.revision < 0 ||
                !(['Run', 'TaskLease', 'ArchitectureReview', 'GoalPhase'].includes(fact.ref.aggregateType)) ||
                ('goalId' in fact.ref && fact.ref.goalId !== context.ref.goalId) ||
                ('workspaceId' in fact.ref && fact.ref.workspaceId !== workspaceId)) return false;
              const loaded = await this.deps.ledger().load(fact.ref);
              if (loaded.status !== 'found' || loaded.snapshot.revision !== fact.revision) return false;
            }
            return true;
          };
          // Already superseded observations cannot become current through an
          // expensive source/verification rebuild. Keep the final check too:
          // a version may change while those asynchronous readers are running.
          if (valid) valid = await versionsCurrent();
          if (valid && material?.dynamicFactSet !== undefined) {
            const witness = material.dynamicFactSet;
            if (!witness || witness.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(witness.digest)) valid = false;
            else if (goal.status === 'found') {
              const active = (goal.snapshot as GoalSnapshot).activePlanRevision;
              const plan = active ? await this.deps.ledger().load(active) : null;
              if (active && (plan?.status !== 'found' || plan.snapshot.ref.aggregateType !== 'PlanRevision')) valid = false;
              else {
                const facts = await selectQueryCollaborationFacts({ ledger: this.deps.ledger(), ...(material?.architectureActivation !== undefined && this.deps.architectureActivation ? { architectureActivation: this.deps.architectureActivation } : {}), ...(material?.humanActions !== undefined && humanActions ? { humanActions } : {}), ...(material?.verificationStages !== undefined && verificationFacts ? { verificationFacts } : {}), ...(this.deps.architectureReviews ? { architectureReviews: this.deps.architectureReviews } : {}) },
                  { projectId, workspaceId, goalId: context.ref.goalId }, plan?.status === 'found' ? plan.snapshot as import('../../contracts/plan.js').PlanRevisionSnapshot : null);
                valid = facts.dynamicFactSet.digest === witness.digest;
              }
            }
          }
          if (valid) valid = await versionsCurrent();
        }
      } catch { /* Corrupt legacy records are explicit stale/unavailable material. */ }
      options.signal?.throwIfAborted();
      current.set(record.runRef.queryJobId, valid);
    }
    return current;
  }
}
