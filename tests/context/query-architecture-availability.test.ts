import { expect, it } from 'vitest';
import { QueryContextCompilerImpl } from '../../src/data/context-compiler/query-context-compiler.js';
import { QuerySourceContextCompiler } from '../../src/data/context-compiler/query-execution-context.js';
import type { QueryContextRequestV1, QueryJobSnapshot } from '../../src/contracts/query-job.js';
import type { ArchitectureReviewView } from '../../src/contracts/architecture-review.js';
import { buildP112Brief, buildP112Proposal, P112_PROJECT, P112_WORKSPACE } from '../../src/fixtures/architecture-fixtures.js';
import { planningScenario, planningScope, planningAt } from '../control/planning-fixture.js';
import type { QueryVerificationFacts } from '../../src/contracts/query-quality-facts.js';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import { queryHumanActions } from '../../src/data/read-model-index/query-human-actions.js';
import { buildP115Proposal, buildP115ProposalCommand } from '../contract-support/fixtures/human-role-collaboration-fixtures.js';

async function contextFixture() {
  const s = await planningScenario();
  expect(await s.compiler.requestInitial(s.request)).toMatchObject({ status: 'accepted' });
  const ref = { aggregateType: 'QueryJob' as const, projectId: planningScope.projectId, workspaceId: planningScope.workspaceId, queryJobId: 'real-query-initial-work' };
  const found = await s.h.ledger.load(ref);
  if (found.status !== 'found') throw Error('Missing admitted query');
  const job = (found.snapshot as QueryJobSnapshot).job;
  if (!job.runRef || !job.intent.execution) throw Error('Missing real query identity');
  const request: QueryContextRequestV1 = { schemaVersion: 1, requestId: 'no-plan-facts', queryJobRef: ref, runRef: job.runRef,
    goalId: planningScope.goalId, question: job.intent.question, focusTaskRefs: [], requestedByRunRef: null,
    roleBindingRef: job.intent.execution.roleBinding, declaredPermissions: { tools: ['read'], writeScope: [] }, budget: { maxBundleBytes: 131072 } };
  const compile = (reader?: (scope: { projectId: string; workspaceId: string }) => Promise<ArchitectureReviewView>) => new QueryContextCompilerImpl({ ledger: s.h.ledger, vault: s.h.vault, now: () => planningAt, ...(reader ? { architectureReviews: reader } : {}) });
  const open = async (compiler: QueryContextCompilerImpl) => {
    const result = await compiler.assembleQueryContext(request);
    if (result.status !== 'ready') throw Error(JSON.stringify(result));
    const material = await s.h.vault.open(result.bundleRef, { requesterRunRef: request.runRef });
    if (material.status !== 'ready') throw Error('Material not readable');
    return JSON.parse(material.record.body);
  };
  return { s, request, compile, open };
}

// Declared read-model fixture, not a claim that this test committed an old decision.
function historicalRow(): ArchitectureReviewView['rows'][number] {
  const remap = <T,>(value: T): T => JSON.parse(JSON.stringify(value).replaceAll(P112_PROJECT, planningScope.projectId).replaceAll(P112_WORKSPACE, planningScope.workspaceId));
  const brief = remap(buildP112Brief()), proposal = remap(buildP112Proposal());
  const { projectId, workspaceId, goalId } = planningScope;
  return { review: { schemaVersion: 1, ref: { aggregateType: 'ArchitectureReview', projectId, workspaceId, reviewId: 'historical-review' }, revision: 2,
    reporterRunRef: { aggregateType: 'Run', projectId, goalId, runId: 'historical-reporter' },
    briefRef: { aggregateType: 'ArchitectureDecisionBrief', projectId, workspaceId, briefId: brief.briefId },
    proposalRef: { aggregateType: 'ArchitectureCandidateProposal', projectId, workspaceId, proposalId: proposal.proposalId },
    candidateRef: { aggregateType: 'CandidateArchitectureBaseline', projectId, workspaceId, candidateId: 'historical-candidate' },
    proposalDigest: proposal.proposalDigest, proposalContent: proposal.normalizedContent, workspaceRevision: 1, targets: [], workSetDigest: '0'.repeat(64), bodyRef: brief.bodyRef,
    status: 'accepted', decisionRef: { aggregateType: 'ArchitectureChangeDecision', projectId, workspaceId, decisionId: 'historical-decision' }, summary: 'A recorded historical decision; no current Plan is asserted.', recordedAt: planningAt },
    reportSummary: 'Declared historical conflict', brief, proposal, targets: [], allNotified: true, allRequiredAttempted: true };
}

function withDecisionFacts(): ArchitectureReviewView['rows'][number] {
  const row = historicalRow(), { review, proposal } = row;
  const record = { schemaVersion: 1 as const, decisionId: review.decisionRef!.decisionId,
    projectId: planningScope.projectId, workspaceId: planningScope.workspaceId,
    subject: { fromPin: proposal.sourceBaselinePin, candidateRef: review.candidateRef }, outcome: 'accept' as const,
    actor: { kind: 'human' as const, id: 'fixture-user' }, authority: { strategy: 'user' as const, delegator: null, policyVersion: 'fixture' },
    authorizedTarget: { fromPin: proposal.sourceBaselinePin, candidateDigest: proposal.expectedCandidateDigest }, summary: review.summary, decidedAt: planningAt };
  const facts = { schemaVersion: 1 as const, object: 'architecture-review-decision' as const, scope: planningScope,
    ref: review.ref, revision: review.revision, recordedAt: review.recordedAt,
    acceptedProposal: { status: 'ready' as const, accepted: true, outcome: 'accept' as const, decisionRef: review.decisionRef, record },
    selectedCandidate: { status: 'not_found' as const, coverage: 'explicit-human-option-choice-in-this-decision' as const, reason: 'Fixture: no human option field',
      proposalSelection: { authority: 'proposal-author' as const, optionId: proposal.selectedOptionId, proposalRef: review.proposalRef, proposalDigest: review.proposalDigest, candidateRef: review.candidateRef } },
    activatedBaseline: { status: 'not_found' as const, coverage: 'recorded-activations-for-this-proposal-and-decision' as const,
      records: [], authority: 'historical-activation-records-not-current-source-acceptance' as const } };
  return { ...row, decisionFacts: { ...facts, version: sha256Hex(canonicalJson(facts)) } };
}

it('passes exact decision facts into Query but rejects mismatched child scope, identity and version', async () => {
  const f = await contextFixture(), row = withDecisionFacts();
  const good = await f.open(f.compile(async () => ({ rows: [row], observedCursor: null })));
  expect(good.architectureReviews.rows[0].decisionFacts).toEqual(row.decisionFacts);
  for (const change of [
    (r: typeof row) => { r.decisionFacts!.scope = { ...planningScope, goalId: 'foreign-goal' }; },
    (r: typeof row) => { r.decisionFacts!.revision++; },
    (r: typeof row) => { r.decisionFacts!.version = '0'.repeat(64); },
  ]) {
    const bad = structuredClone(row); change(bad);
    expect(await f.compile(async () => ({ rows: [bad], observedCursor: null })).assembleQueryContext(f.request)).toMatchObject({ status: 'needs_material' });
  }
});

it('consumes persistent human-action facts and invalidates the old Query when a real proposal is recorded', async () => {
  const f = await contextFixture();
  const humanActions = (scope: typeof planningScope) => queryHumanActions({ ledger: f.s.h.ledger }, scope);
  const architectureReviews = async () => ({ rows: [], observedCursor: null });
  const compiler = new QueryContextCompilerImpl({ ledger: f.s.h.ledger, vault: f.s.h.vault, now: () => planningAt, humanActions, architectureReviews });
  const material = await f.open(compiler);
  expect(material.humanActions).toMatchObject({ scope: planningScope, pendingCount: null });
  const sources = new QuerySourceContextCompiler({ ledger: () => f.s.h.ledger,
    observations: { all: () => [{ runRef: f.request.runRef, status: 'completed', input: JSON.stringify({ material }), sourceAfter: 'source-1' }] },
    source: { sourceRevision: async () => 'source-1' }, architectureReviews, humanActions });
  expect((await sources.currentness(planningScope.projectId, planningScope.workspaceId)).get(f.request.queryJobRef.queryJobId)).toBe(true);
  const proposal = buildP115Proposal({ projectId: planningScope.projectId, workspaceId: planningScope.workspaceId,
    goalRef: { aggregateType: 'Goal', projectId: planningScope.projectId, goalId: planningScope.goalId }, planRef: null });
  expect(await f.s.h.control.recordInitialDesignProposal(buildP115ProposalCommand(proposal, { commandId: 'pending-design' }))).toMatchObject({ status: 'committed' });
  expect((await sources.currentness(planningScope.projectId, planningScope.workspaceId)).get(f.request.queryJobRef.queryJobId)).toBe(false);
  const updated = await f.open(compiler);
  expect(updated.humanActions.domains.find((d: any) => d.domain === 'initial-design').records[0]).toMatchObject({ pendingHumanAction: true, status: 'ready' });
});

it('queries a configured architecture reader without a Plan and distinguishes ready-empty from unconfigured', async () => {
  const f = await contextFixture(); let calls = 0;
  const reader = async (scope: { projectId: string; workspaceId: string }) => { expect(scope).toEqual({ projectId: planningScope.projectId, workspaceId: planningScope.workspaceId }); calls++; return { rows: [], observedCursor: null }; };
  const material = await f.open(f.compile(reader));
  expect(material.acceptedPlan).toBeNull();
  expect(material.architectureReviews).toEqual({ status: 'ready', observedCursor: null, rows: [] });
  expect(calls).toBe(1);
  expect((await f.open(f.compile())).architectureReviews).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('not configured') });
});

it('keeps visible decisions historical and excludes other Goals when there is no active Plan', async () => {
  const f = await contextFixture(), row = historicalRow(), other = structuredClone(row);
  other.review.reporterRunRef.goalId = 'another-goal'; other.review.ref.reviewId = 'another-review';
  const material = await f.open(f.compile(async () => ({ rows: [row, other], observedCursor: null })));
  expect(material.architectureReviews.rows).toHaveLength(1);
  expect(material.architectureReviews.rows[0]).toMatchObject({ status: 'accepted', summary: row.review.summary, conflict: { matchesCurrentPlan: false, planRef: row.brief.planRef } });
  expect(material.dynamicFactVersions).toContainEqual({ ref: row.review.ref, revision: 2 });
  expect(material.acceptedPlan).toBeNull();
});

it('refuses failed readers and foreign workspace facts without turning them into empty success', async () => {
  const f = await contextFixture();
  const failed = f.compile(async () => { throw Error('Reader unavailable'); });
  expect(await failed.assembleQueryContext(f.request)).toMatchObject({ status: 'needs_material' });
  const row = historicalRow(); row.review.ref.workspaceId = 'another-workspace';
  expect(await f.compile(async () => ({ rows: [row], observedCursor: null })).assembleQueryContext(f.request)).toMatchObject({ status: 'needs_material' });
  let calls = 0;
  const denied = f.compile(async () => { calls++; return { rows: [], observedCursor: null }; });
  expect(await denied.assembleQueryContext({ ...f.request, declaredPermissions: { tools: ['write'], writeScope: ['*'] } })).toMatchObject({ status: 'rejected' });
  expect(calls).toBe(0);
});

it('invalidates a no-Plan query when the previously empty architecture record set changes', async () => {
  const f = await contextFixture(); let rows: ArchitectureReviewView['rows'] = [];
  const reader = async () => ({ rows, observedCursor: null });
  const material = await f.open(f.compile(reader));
  const sources = new QuerySourceContextCompiler({ ledger: () => f.s.h.ledger,
    observations: { all: () => [{ runRef: f.request.runRef, status: 'completed', input: JSON.stringify({ material }), sourceAfter: 'source-1' }] },
    source: { sourceRevision: async () => 'source-1' }, architectureReviews: reader });
  expect((await sources.currentness(planningScope.projectId, planningScope.workspaceId)).get(f.request.queryJobRef.queryJobId)).toBe(true);
  rows = [historicalRow()];
  expect((await sources.currentness(planningScope.projectId, planningScope.workspaceId)).get(f.request.queryJobRef.queryJobId)).toBe(false);
});

it('binds verification observation versions to actual Query material and later freshness', async () => {
  const f=await contextFixture();
  let facts: QueryVerificationFacts={schemaVersion:1,object:'verification-stages',scope:planningScope,status:'ready-empty',observedAt:planningAt,
    version:'1'.repeat(64),coverage:'recorded-tool-rounds-and-independent-reviews',rounds:[],reviews:[],issues:[]};
  const verificationFacts=async()=>structuredClone(facts);
  const compiler=new QueryContextCompilerImpl({ledger:f.s.h.ledger,vault:f.s.h.vault,now:()=>planningAt,verificationFacts});
  const material=await f.open(compiler);
  expect(material.verificationStages).toEqual(facts);
  const sources=new QuerySourceContextCompiler({ledger:()=>f.s.h.ledger,verificationFacts,
    observations:{all:()=>[{runRef:f.request.runRef,status:'completed',input:JSON.stringify({material}),sourceAfter:'source-1'}]},
    source:{sourceRevision:async()=>'source-1'}});
  expect((await sources.currentness(planningScope.projectId,planningScope.workspaceId)).get(f.request.queryJobRef.queryJobId)).toBe(true);
  facts={...facts,status:'failed',issues:['Reader failed; absence cannot be inferred'],version:'2'.repeat(64)};
  expect((await sources.currentness(planningScope.projectId,planningScope.workspaceId)).get(f.request.queryJobRef.queryJobId)).toBe(false);
  expect((await f.open(compiler)).verificationStages).toMatchObject({status:'failed',issues:facts.issues});
});

it('rejects foreign verification scope and refuses reading facts for a write-capable Query', async () => {
  const f=await contextFixture();let calls=0;
  const compiler=new QueryContextCompilerImpl({ledger:f.s.h.ledger,vault:f.s.h.vault,now:()=>planningAt,verificationFacts:async()=>{
    calls++;return {schemaVersion:1,object:'verification-stages',scope:{...planningScope,workspaceId:'foreign'},status:'ready-empty',observedAt:planningAt,
      version:'1'.repeat(64),coverage:'recorded-tool-rounds-and-independent-reviews',rounds:[],reviews:[],issues:[]};}});
  expect(await compiler.assembleQueryContext({...f.request,declaredPermissions:{tools:['write'],writeScope:['*']}})).toMatchObject({status:'rejected'});
  expect(calls).toBe(0);
  expect(await compiler.assembleQueryContext(f.request)).toMatchObject({status:'needs_material'});
});

it('rejects a foreign Verification child before supplying it to a Query', async () => {
  const f = await contextFixture();
  const compiler = new QueryContextCompilerImpl({ ledger: f.s.h.ledger, vault: f.s.h.vault, now: () => planningAt,
    verificationFacts: async () => ({ schemaVersion: 1, object: 'verification-stages', scope: planningScope,
      status: 'ready', observedAt: planningAt, version: '1'.repeat(64), coverage: 'recorded-tool-rounds-and-independent-reviews', issues: [], reviews: [],
      rounds: [{ scope: { ...planningScope, goalId: 'foreign-goal', runId: 'foreign-run', taskId: 'foreign-task' },
        requestId: 'foreign-verification', roundId: 'foreign-round', version: '2'.repeat(64), recordedAt: planningAt, finishedAt: planningAt,
        status: 'completed', outcome: 'INCONCLUSIVE', coverage: [], evidence: [], applicability: { status: 'stale', identity: null, issues: ['Foreign source'] } }],
    }) });
  expect(await compiler.assembleQueryContext(f.request)).toMatchObject({ status: 'needs_material' });
});

it.each(['already-stale', 'changes-during-facts'] as const)('qualifies persisted versions before expensive facts and again afterwards: %s', async mode => {
  const f = await contextFixture(), row = historicalRow();
  let revision = row.review.revision, calls = 0, armed = false;
  const facts: QueryVerificationFacts = { schemaVersion: 1, object: 'verification-stages', scope: planningScope,
    status: 'ready-empty', observedAt: planningAt, version: '1'.repeat(64), coverage: 'recorded-tool-rounds-and-independent-reviews', rounds: [], reviews: [], issues: [] };
  const verificationFacts = async () => { calls++; if (armed && mode === 'changes-during-facts') revision++; return structuredClone(facts); };
  const architectureReviews = async () => ({ rows: [row], observedCursor: null });
  const material = await f.open(new QueryContextCompilerImpl({ ledger: f.s.h.ledger, vault: f.s.h.vault,
    now: () => planningAt, verificationFacts, architectureReviews }));
  // Explicit read-port revision fixture; this is not a new committed human decision.
  const ledger = { load: async (ref: Parameters<typeof f.s.h.ledger.load>[0]) => canonicalJson(ref) === canonicalJson(row.review.ref)
    ? { status: 'found' as const, snapshot: { ...row.review, revision } } : f.s.h.ledger.load(ref) };
  const sources = new QuerySourceContextCompiler({ ledger: () => ledger, verificationFacts, architectureReviews,
    observations: { all: () => [{ runRef: f.request.runRef, status: 'completed', input: JSON.stringify({ material }), sourceAfter: 'source-1' }] },
    source: { sourceRevision: async () => 'source-1' } });
  expect((await sources.currentness(planningScope.projectId, planningScope.workspaceId)).get(f.request.queryJobRef.queryJobId)).toBe(true);
  calls = 0; armed = true;
  if (mode === 'already-stale') revision++;
  expect((await sources.currentness(planningScope.projectId, planningScope.workspaceId)).get(f.request.queryJobRef.queryJobId)).toBe(false);
  expect(calls).toBe(mode === 'already-stale' ? 0 : 1);
});
