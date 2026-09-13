import { expect, it } from 'vitest';
import { createInMemoryHarness } from '../../src/harness/in-memory-harness.js';
import { buildBootstrapCommand } from '../../src/contracts/bootstrap.js';
import { buildInstallCommand, buildActivateCommand, COMPLETION_POLICY_FIXTURE_V1, ARCHITECTURE_BASELINE_FIXTURE_V1 } from '../../src/fixtures/governance-fixtures.js';
import { completionPolicyPinFor, architectureBaselinePinFor } from '../../src/contracts/governance.js';
import { buildApplyPlanCommand } from '../../src/fixtures/plan-fixtures.js';
import { normalizeInitialPlanProposal } from '../../src/control/control-engine/policies/initial-plan-admission.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import type { QueryJobIntentV1, ReadOnlyQueryPort } from '../../src/contracts/query-job.js';

it('accepts only the exact sourced initial model proposal, preserves its origin, and rejects tampering and old sources', async () => {
  const at = '2026-09-09T00:00:00.000Z', scope = { projectId: 'planning-project', workspaceId: 'workspace', goalId: 'goal' };
  const response = { kind: 'plan', summary: 'Implement the requested parser and verify malformed inputs independently.',
    assignments: [{ taskId: 'parser', role: 'executor', instruction: 'Implement the requested parser; test malformed input without changing acceptance.' }],
    plan: { stages: [{ stageId: 'parse', title: 'Parser work' }], tasks: [
      { taskId: 'parser', stageId: 'parse', title: 'Implement parser', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: 'parse' } },
      { taskId: 'verify-parser', title: 'Verify parser contract', requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
      obligations: [{ obligationId: 'parse-input', title: 'Correctly parse and reject malformed input', requirementLevel: 'required', taskIds: ['parser', 'verify-parser'], verificationRequirements: [{ requirementId: 'invalid-input', requirementLevel: 'required', kind: 'dynamic', description: 'Validate malformed inputs independently' }] }],
      taskHierarchy: { parentOf: [{ parentTaskId: 'verify-parser', childTaskId: 'parser' }] }, executionDag: { dependsOn: [{ taskId: 'verify-parser', dependsOnId: 'parser', requires: { kind: 'artifact', label: 'Parser implementation and tests' } }] } } };
  let calls = 0;
  const runtime: ReadOnlyQueryPort = { capabilities: () => ({ supported: true, readOnly: true, maxQuestionBytes: 4096, maxAnswerBytes: 16384 }), startQuery: async request => { calls++; return { schemaVersion: 1, runRef: request.runRef, outcome: 'answered', answer: JSON.stringify(response), sources: [], message: null, endedAt: at }; } };
  const h = createInMemoryHarness({ readOnlyQuery: runtime });
  expect(await h.bootstrap(buildBootstrapCommand({ schemaVersion: 1, entries: [scope] }, { commandId: 'boot', correlationId: 'boot', submittedAt: at }))).toMatchObject({ status: 'committed' });
  expect(await h.collaboration.createGoal({ ...scope, objective: 'Build the input parser', actor: { kind: 'human', id: 'operator' }, idempotencyKey: 'goal' })).toMatchObject({ status: 'persisted' });
  for (const [i, fixture] of [COMPLETION_POLICY_FIXTURE_V1, ARCHITECTURE_BASELINE_FIXTURE_V1].entries()) {
    const deps = { projectId: scope.projectId, commandId: 'install-' + i, correlationId: 'governance', idempotencyKey: 'install-' + i, submittedAt: at };
    const install = buildInstallCommand(fixture, deps); expect(await h.install(install)).toMatchObject({ status: 'committed' });
    const pin = install.commandType === 'InstallCompletionPolicyRevision' ? completionPolicyPinFor(install) : architectureBaselinePinFor(install);
    expect(await h.activate(buildActivateCommand(pin, { ...deps, commandId: 'activate-' + i, idempotencyKey: 'activate-' + i, expectedRevision: 1 }))).toMatchObject({ status: 'committed' });
  }
  const intent: QueryJobIntentV1 = { schemaVersion: 1, intentId: 'coordination', ...scope, question: 'Plan the input parser work', focusTaskRefs: [], budget: { maxTokens: 128000, deadline: null }, multiTurn: { maxRounds: 1 }, correlationId: 'coordination', execution: { kind: 'initial_coordination', roleBinding: { schemaVersion: 1, bindingId: 'coordinator', bindingVersion: 1, templateId: 'planner', templateRevision: '1', policyRevision: 'initial-read-only-v1' }, runtimeBudget: DEFAULT_RUNTIME_BUDGET } };
  expect(await h.submitQueryJob({ schemaVersion: 1, commandType: 'SubmitQueryJob', commandId: 'coordination', identity: { projectId: scope.projectId, actor: { kind: 'human', id: 'operator' }, idempotencyKey: 'coordination' }, aggregateId: intent.intentId, expectedRevision: 0, correlationId: intent.correlationId, submittedAt: at, payload: { intent, runId: 'coordination-run' } })).toMatchObject({ status: 'committed' });
  expect(await h.driveQuery({ reason: 'initial-plan-source-test' })).toMatchObject({ started: 1, answered: 1, failures: [] });
  await h.advanceProjection();
  const view = await h.queryJobView({ ...scope, queryJobId: intent.intentId });
  if (view.status !== 'ready' || !view.currentAnswer) throw Error('source answer absent');
  const compiled = normalizeInitialPlanProposal(intent, view.currentAnswer); if (compiled.status !== 'plan') throw Error('plan absent');
  const command = buildApplyPlanCommand(compiled.plan, { projectId: scope.projectId, expectedRevision: 1, commandId: 'accept', correlationId: 'accept', idempotencyKey: 'accept', submittedAt: at });
  expect(await h.applyPlan({ ...command, payload: { plan: { ...compiled.plan, tasks: compiled.plan.tasks.map(task => ({ ...task, title: 'Caller rewrote model proposal' })) } } })).toMatchObject({ status: 'rejected', code: 'invalid' });
  expect(await h.applyPlan(command)).toMatchObject({ status: 'committed', replayed: false });
  const accepted = await h.ledger.load({ aggregateType: 'PlanRevision', projectId: scope.projectId, planId: compiled.plan.planId });
  expect(accepted).toMatchObject({ status: 'found', snapshot: { origin: compiled.plan.origin } });
  expect(await h.applyPlan(command)).toMatchObject({ status: 'committed', replayed: true });
  expect(await h.applyPlan({ ...command, commandId: 'old-proposal', identity: { ...command.identity, idempotencyKey: 'old-proposal' }, payload: { plan: { ...compiled.plan, planId: 'different-plan' } } })).toMatchObject({ status: 'rejected', code: 'invalid' });
  expect(calls).toBe(1);
});
