import { expect, it, vi } from 'vitest';
import { ExecutionFeedbackCompiler } from '../../src/control/plan-compiler/execution-feedback-compiler.js';
import { FeedbackMaterialCompiler } from '../../src/data/context-compiler/feedback-materials.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import type { FeedbackSource } from '../../src/contracts/execution-feedback.js';
import type { QueryJobSnapshot, SubmitQueryJobCommand } from '../../src/contracts/query-job.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import { reworkPlanIdFor } from '../../src/contracts/rework/proposal.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';

/** Compiler/Context integration seam: commands persist as immutable copies in
 * a local catalog; this is not a real Control/SQLite/runtime integration test. */
function fixture() {
  const scope = { projectId: 'p', workspaceId: 'w', goalId: 'g' };
  const run = { aggregateType: 'Run' as const, projectId: 'p', goalId: 'g', runId: 'original' };
  const bodyRef = { kind: 'artifact', digest: 'a'.repeat(64) } as FeedbackSource['reportRef'];
  const material = { scope, budget: DEFAULT_RUNTIME_BUDGET,
    feedback: { kind: 'execution_feedback' as const, category: 'verification_failure' as const, summary: 'Failed requirement', question: 'Investigate failure' },
    source: { runRef: run, taskId: 'task', planRef: { aggregateType: 'PlanRevision', projectId: 'p', planId: 'plan-1' },
      workspaceRevision: 1, reportRef: bodyRef, failureIssueIds: ['rework-issue-' + 'b'.repeat(40)],
      sourcePin: { schemaVersion: 1, projectId: 'p', workspaceId: 'w', sourceSet: { kind: 'workspace_paths', paths: ['.'] },
        identity: { workspace: '/fixture', commit: null }, manifestDigest: 'c'.repeat(64) } } as FeedbackSource };
  const jobs: QueryJobSnapshot[] = [];
  const answers = new Map<string, any>();
  const submit = vi.fn(async (command: SubmitQueryJobCommand) => {
    const id = command.aggregateId;
    const ref = { aggregateType: 'QueryJob' as const, projectId: 'p', workspaceId: 'w', queryJobId: id };
    jobs.push({ ref, schemaVersion: 1, revision: 1, job: { schemaVersion: 1, ...scope, queryJobId: id,
      status: 'pending', runRef: { ...ref, aggregateType: 'QueryRun', runId: id }, answerRefs: [], closeReason: null,
      intent: structuredClone(command.payload.intent), submittedAt: command.submittedAt, updatedAt: command.submittedAt } });
    return { status: 'committed' as const, queryJobRef: ref };
  });
  const compiler = new ExecutionFeedbackCompiler({ control: { submitQueryJob: submit }, now: () => '2026-09-11T00:00:00Z',
    materials: { jobs: async () => structuredClone(jobs), prepare: async () => null,
      prepareFailure: async () => structuredClone(material) } } as never);
  function answer(job: QueryJobSnapshot, action: string, version = 'current') {
    job.job.status = 'answered';
    const ref = { ...job.ref, aggregateType: 'QueryJobAnswer' as const, answerId: job.job.queryJobId + '-answer' };
    job.job.answerRefs = [ref];
    answers.set(ref.queryJobId, { ref, schemaVersion: 1, revision: 1, answer: { runRef: job.job.runRef, stale: false, bodyRef,
      answer: JSON.stringify({ kind: 'feedback_resolution', action, availability: 'available', summary: 'Read rules', material: 'Current repair instruction', sourcePaths: ['RULES.md'] }),
      sources: [{ kind: 'workspace_source', version }, { kind: 'workspace_read', refKey: 'RULES.md', version: 'rule-digest' }] } });
  }
  function changeBasis() {
    material.source.planRef = { ...material.source.planRef, planId: 'plan-2' };
    material.source.sourcePin.manifestDigest = 'd'.repeat(64);
  }
  const ledger = { load: async (ref: any) => {
    const snapshot = ref.aggregateType === 'WorkContextBinding' ? { binding: { linkedRunRefs: [run] } }
      : ref.aggregateType === 'QueryJob' ? jobs.find(j => j.ref.queryJobId === ref.queryJobId)
      : ref.aggregateType === 'QueryJobAnswer' ? answers.get(ref.queryJobId) : undefined;
    return snapshot ? { status: 'found', snapshot: structuredClone(snapshot) } : { status: 'not_found' };
  } };
  const selector = new FeedbackMaterialCompiler({ ledger, catalog: { jobs: async () => structuredClone(jobs) },
    source: { sourceRevision: async () => 'current' }, applicability: { capture: async () => ({ status: 'sourced', pin: material.source.sourcePin }) }, vault: {} } as never);
  const envelope = { ...scope, taskId: 'successor-task', runRef: { ...run, runId: 'successor' },
    planRef: material.source.planRef, workspaceSnapshot: { revision: 1 } } as TaskEnvelopeV1;
  return { compiler, selector, submit, material, jobs, answer, answers, changeBasis, envelope, ledger };
}

it.each(['plan', 'source', 'both'] as const)('same failure group on changed %s creates an exact replacement and preserves the old job', async basis => {
  const f = fixture();
  const first = await f.compiler.requestFailure([]);
  f.answer(f.jobs[0]!, 'adjust_plan', 'old');
  const old = structuredClone(f.jobs[0]);
  f.changeBasis();
  if (basis === 'plan') f.material.source.sourcePin.manifestDigest = 'c'.repeat(64);
  if (basis === 'source') f.material.source.planRef.planId = 'plan-1';
  const next = await f.compiler.requestFailure([]);
  expect(next).not.toEqual(first);
  expect(f.jobs[1]!.job.intent.execution!.feedback).toMatchObject({ supersedesQueryJobId: first!.queryJobId,
    planRef: { planId: basis === 'source' ? 'plan-1' : 'plan-2' },
    sourcePin: { manifestDigest: (basis === 'plan' ? 'c' : 'd').repeat(64) } });
  expect(f.jobs[0]).toEqual(old);
  expect(await f.compiler.requestFailure([])).toEqual(next);
  expect(f.submit).toHaveBeenCalledTimes(2);
});

it.each(['needs_decision', 'adjust_plan'])('current %s investigation remains idempotent', async action => {
  const f = fixture(); const first = await f.compiler.requestFailure([]);
  f.answer(f.jobs[0]!, action);
  expect(await f.compiler.requestFailure([])).toEqual(first);
  expect(f.submit).toHaveBeenCalledTimes(1);
});

it('a running old-basis investigation is not rerun or replaced', async () => {
  const f = fixture(); const first = await f.compiler.requestFailure([]);
  f.jobs[0]!.job.status = 'running'; f.changeBasis();
  expect(await f.compiler.requestFailure([])).toEqual(first);
  expect(f.submit).toHaveBeenCalledTimes(1);
});

it('renewal retains the directed human decision identity', async () => {
  const f = fixture(); await f.compiler.requestFailure([]);
  const decisionRef = { aggregateType: 'UserDecision' as const, projectId: 'p', workspaceId: 'w', decisionId: 'human-choice' };
  f.jobs[0]!.job.intent.execution!.feedback!.decisionRef = decisionRef;
  f.answer(f.jobs[0]!, 'adjust_plan'); f.changeBasis();
  await f.compiler.requestFailure([]);
  expect(f.jobs[1]!.job.intent.execution!.feedback!.decisionRef).toEqual(decisionRef);
});

it('the generated replacement blocks while pending, then excludes the unaccepted old adjustment from material selection', async () => {
  const f = fixture(); await f.compiler.requestFailure([]);
  f.answer(f.jobs[0]!, 'adjust_plan', 'old'); const oldAnswer = structuredClone(f.answers.get(f.jobs[0]!.job.queryJobId));
  f.changeBasis(); await f.compiler.requestFailure([]);
  await expect(f.selector.select(f.envelope, 'same-work')).rejects.toThrow('incomplete');
  // A current supplement avoids asserting a fake accepted plan in this seam.
  // If the old adjustment were still visited, its missing accepted plan must fail.
  f.answer(f.jobs[1]!, 'supplement');
  const result = await f.selector.select(f.envelope, 'same-work');
  expect(result.selected.map(row => row.ref.queryJobId)).toEqual([f.jobs[1]!.job.queryJobId]);
  expect(f.answers.get(f.jobs[0]!.job.queryJobId)).toEqual(oldAnswer);
});

it.each(['malformed', 'stale', 'missing'] as const)('an unrelated non-work %s answer cannot block this successor', async fault => {
  const f = fixture(); await f.compiler.requestFailure([]); f.answer(f.jobs[0]!, 'supplement');
  f.material.source.runRef = { ...f.material.source.runRef, runId: 'independent-reviewer' };
  await f.compiler.requestFailure([]); f.answer(f.jobs[1]!, 'adjust_plan');
  const id = f.jobs[1]!.job.queryJobId;
  if (fault === 'malformed') f.answers.get(id).answer.answer = 'not json';
  if (fault === 'stale') f.answers.get(id).answer.stale = true;
  if (fault === 'missing') f.answers.delete(id);
  const result = await f.selector.select(f.envelope, 'same-work');
  expect(result.selected.map(row => row.ref.queryJobId)).toEqual([f.jobs[0]!.job.queryJobId]);
});

it('an accepted plan directed to this successor keeps its independent reviewer material mandatory', async () => {
  const f = fixture(); f.material.source.runRef = { ...f.material.source.runRef, runId: 'independent-reviewer' };
  await f.compiler.requestFailure([]); f.answer(f.jobs[0]!, 'adjust_plan');
  const job = f.jobs[0]!, answer = f.answers.get(job.job.queryJobId);
  const proposalId = 'directed-reviewer-proposal';
  const instruction = 'Current repair instruction';
  const tasks = [{ taskId: f.envelope.taskId, disposition: 'active' }];
  const assignments = [{ taskId: f.envelope.taskId, role: 'executor', instruction }];
  // Canonical plan/proposal read seam, not a synthetic success receipt. The
  // production selector checks exact task, assignment, answer ref and digest.
  const proposal = { proposalId, sourceGoalRef: { goalId: 'g' },
    coordination: { answerRef: job.job.answerRefs[0], answerDigest: sha256Hex(answer.answer.answer), instruction },
    rework: { tasks }, planDraft: { tasks, assignments } };
  const load = f.ledger.load;
  Object.assign(f.ledger, { events: async () => ({ events: [{ event: { eventType: 'PlanProposalRecorded', projectId: 'p', workspaceId: 'w', payload: { proposal } } }], hasMore: false }) });
  f.ledger.load = async (ref: any) => {
    if (ref.aggregateType === 'PlanProposal' && ref.proposalId === proposalId) return { status: 'found', snapshot: { ref, proposal } } as any;
    if (ref.aggregateType === 'PlanRevision' && [reworkPlanIdFor(proposalId), f.envelope.planRef.planId].includes(ref.planId))
      return { status: 'found', snapshot: { ref, goalRef: { goalId: 'g' }, tasks, assignments } } as any;
    return load(ref);
  };
  const ready = await f.selector.select(f.envelope, 'same-work');
  expect(ready.selected.map(row => row.ref.queryJobId)).toEqual([job.job.queryJobId]);
  f.answers.delete(job.job.queryJobId);
  await expect(f.selector.select(f.envelope, 'same-work')).rejects.toThrow('Feedback answer unavailable');
});
