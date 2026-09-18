import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { QueryExecutionContextCompiler, QuerySourceContextCompiler } from '../../src/data/context-compiler/query-execution-context.js';
import { architectureReviewView } from '../../src/data/read-model-index/architecture-review-view.js';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import type { QuerySourceObservationPort } from '../../src/contracts/query-execution-context.js';
import { planningScenario, planningScope } from '../control/planning-fixture.js';
import { GovernanceReadModel } from '../../src/data/read-model-index/governance-view.js';
import { queryFactAssertionMatches } from '../../src/contracts/query-quality-facts.js';
import { renderQueryFact } from '../../src/contracts/query-answer-presentation.js';

it('delivers a vocabulary of distinct collections and actor relations in the actual captured Context and fact reads', async () => {
  const s = await planningScenario();
  const compiler = new QueryExecutionContextCompiler({ ledger: () => s.h.ledger, vault: () => s.h.vault });
  s.onRequest(async request => {
    const captured = await compiler.assemble(request);
    if (captured.status !== 'ready') throw Error(captured.message);
    const input = JSON.parse(captured.input);
    expect(input.contextLabels.records.architectureReviews.object).toBe('ArchitectureReview');
    expect(input.contextLabels.records.humanActions.object).toBe('PendingHumanAction');
    expect(input.contextLabels.relations.activatedBy).not.toEqual(input.contextLabels.relations.createdBy);
    const fact = await compiler.readFact(request, { inputDigest: createHash('sha256').update(captured.input).digest('hex'), pointer: '/material/architectureReviews' });
    expect(fact).toMatchObject({ status: 'ready', meaning: { object: 'ArchitectureReview', relation: 'recorded-review', scope: planningScope, coverage: 'recorded-architecture-reviews-in-this-goal', observationStatus: 'ready-empty' } });
    expect((fact as any).meaning.observedAt).toBe(input.material.capturedAt);
    expect((fact as any).meaning.inputDigest).toBe(createHash('sha256').update(captured.input).digest('hex'));
    expect(await compiler.readFact(request, { inputDigest: '0'.repeat(64), pointer: '/material/architectureReviews' })).toMatchObject({ status: 'stale' });
  });
  expect(await s.compiler.requestInitial(s.request)).toMatchObject({ status: 'accepted' });
  expect(await s.h.driveQuery({ reason: 'vocabulary-consumer' })).toMatchObject({ answered: 1, failures: [] });
});

it('delivers committed baseline activation separately from empty Goal reviews without inventing authorship', async () => {
  let views: GovernanceReadModel;
  const s = await planningScenario(undefined, { architectureActivation: scope => views.architectureActivation(scope) });
  views = new GovernanceReadModel({ ledger: () => s.h.ledger, defaults: {}, entryRoles: [], policyExplanation: { roleSpecPinReadiness: () => { throw Error('Unrelated role query'); } } });
  const compiler = new QueryExecutionContextCompiler({ ledger: () => s.h.ledger, vault: () => s.h.vault });
  let recorded!: ReturnType<QuerySourceObservationPort['all']>[number];
  s.onRequest(async request => {
    const captured = await compiler.assemble(request);
    if (captured.status !== 'ready') throw Error(captured.message);
    const input = JSON.parse(captured.input), activation = input.material.architectureActivation;
    recorded = { runRef: request.runRef, status: 'completed', input: captured.input, sourceAfter: 'fixed-source' };
    expect(activation.status).toBe('ready');
    expect(activation.scope).toEqual({ projectId: planningScope.projectId });
    expect(activation.active.activatedBy).toBeTruthy();
    expect(activation.active.createdBy).toBeUndefined();
    expect(input.material.architectureReviews.rows).toEqual([]);
    const fact = await compiler.readFact(request, { inputDigest: createHash('sha256').update(captured.input).digest('hex'), pointer: '/material/architectureActivation' });
    if (fact.status !== 'ready') throw Error(fact.status);
    expect(fact.meaning).toMatchObject({ scope: { projectId: planningScope.projectId }, relation: 'activatedBy', observationStatus: 'ready' });
    const assertion = { kind: 'current_baseline_activation' as const, expected: activation.active.digest };
    expect(queryFactAssertionMatches(fact.value, assertion)).toBe(true);
    expect(renderQueryFact({ ...fact, marker: 'F1', assertion }, 'zh')).toContain('不说明内容作者');
    expect(queryFactAssertionMatches(input.material.architectureReviews, assertion)).toBe(false);
    expect(() => renderQueryFact({ ...fact, pointer: '/material/humanActions', marker: 'F1', assertion }, 'zh')).toThrow();
  });
  expect(await s.compiler.requestInitial(s.request)).toMatchObject({ status: 'accepted' });
  expect(await s.h.driveQuery({ reason: 'activation-consumer' })).toMatchObject({ answered: 1, failures: [] });
  let unavailable = false;
  const source = new QuerySourceContextCompiler({ ledger: () => s.h.ledger, observations: { all: () => [recorded] }, source: { sourceRevision: async () => 'fixed-source' },
    architectureReviews: scope => architectureReviewView(s.h.ledger, scope),
    architectureActivation: async scope => {
      const observation = await views.architectureActivation(scope);
      if (!unavailable) return observation;
      const { version: _version, observedAt, ...old } = observation;
      const stable = { ...old, status: 'unavailable' as const, active: null };
      return { ...stable, observedAt, version: sha256Hex(canonicalJson(stable)) };
    } });
  expect((await source.currentness(planningScope.projectId, planningScope.workspaceId)).get(recorded.runRef.queryJobId)).toBe(true);
  unavailable = true;
  expect((await source.currentness(planningScope.projectId, planningScope.workspaceId)).get(recorded.runRef.queryJobId)).toBe(false);
});

