import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { StateLedger } from '../../src/contracts/ledger.js';
import { queryHumanActions } from '../../src/data/read-model-index/query-human-actions.js';
import { QueryExecutionContextCompiler } from '../../src/data/context-compiler/query-execution-context.js';
import { createQueryFactTool } from '../../src/execution/worker-runtime/query-fact-tool.js';
import { planningScenario, planningScope } from '../control/planning-fixture.js';
import { buildP115Proposal, buildP115Decision, buildP115ProposalCommand, buildP115DecisionCommand } from '../contract-support/fixtures/human-role-collaboration-fixtures.js';

it.each(['accept', 'reject', 'defer'] as const)('renders the actual persisted InitialDesign %s through ReadModel, Context and fact publication', async outcome => {
  let ledger!: StateLedger;
  const s = await planningScenario(undefined, { humanActions: scope => queryHumanActions({ ledger }, scope) }); ledger = s.h.ledger;
  const proposal = buildP115Proposal({ ...planningScope, goalRef: { aggregateType: 'Goal', projectId: planningScope.projectId, goalId: planningScope.goalId }, planRef: null });
  expect(await s.h.recordInitialDesignProposal(buildP115ProposalCommand(proposal, { commandId: 'present-proposal' }))).toMatchObject({ status: 'committed' });
  const decision = buildP115Decision(proposal, { outcome, proposalRef: { aggregateType: 'InitialDesignProposal', projectId: planningScope.projectId, workspaceId: planningScope.workspaceId, designId: proposal.designId } });
  expect(await s.h.recordInitialDesignDecision(buildP115DecisionCommand(decision, { commandId: 'present-decision' }))).toMatchObject({ status: 'committed' });
  const context = new QueryExecutionContextCompiler({ ledger: () => s.h.ledger, vault: () => s.h.vault });
  s.onRequest(async request => {
    const material = await context.assemble(request); if (material.status !== 'ready') throw Error(material.message);
    const input = JSON.parse(material.input), domains = input.material.humanActions.domains;
    const index = domains.findIndex((d: any) => d.domain === 'initial-design');
    expect(domains[index].records[0].value.decisions[0]).toMatchObject({ outcome });
    const pointer = `/material/humanActions/domains/${index}/records/0/value/decisions/0`;
    const inputDigest = createHash('sha256').update(material.input).digest('hex');
    const port = createQueryFactTool(p => context.readFact(request, { inputDigest, pointer: p }), { requireAssertions: true });
    const result = await port.tool.handler.execute({ callId: 'outcome', arguments: { pointer, assertion: { kind: 'decision_outcome', expected: outcome } } } as never, { signal: new AbortController().signal } as never);
    expect(result.status).toBe('success');
    const answer = await port.present(JSON.stringify({ schemaVersion: 1, language: 'zh', blocks: [{ kind: 'fact', citation: 'F1' }] }));
    expect(answer.answer).toContain(`候选「opt-a」的记录结果：${outcome}`);
    const selection = await port.tool.handler.execute({ callId: 'selection', arguments: { pointer, assertion: { kind: 'selected_option', expected: 'opt-a' } } } as never, { signal: new AbortController().signal } as never);
    expect(selection.status).toBe(outcome === 'accept' ? 'success' : 'error');
    if (outcome === 'accept') expect((await port.present(JSON.stringify({ schemaVersion: 1, language: 'zh', blocks: [{ kind: 'fact', citation: 'F2' }] }))).answer).toContain('明确选择的候选：opt-a');
  });
  expect(await s.compiler.requestInitial(s.request)).toMatchObject({ status: 'accepted' });
  expect(await s.h.driveQuery({ reason: 'initial-design-presentation' })).toMatchObject({ started: 1, answered: 1, failures: [] });
});
