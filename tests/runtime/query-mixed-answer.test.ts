import { expect, it } from 'vitest';
import { createQueryFactTool } from '../../src/execution/worker-runtime/query-fact-tool.js';

async function facts() {
  let revoked = false;
  const port = createQueryFactTool(async pointer => revoked ? { status: 'stale', message: 'Changed authorization' } : {
    status: 'ready', pointer, inputDigest: 'a'.repeat(64), observation: 'captured_query_input', sourceBundle: { digest: 'b'.repeat(64) },
    value: { object: 'pending-human-items', status: 'ready-empty', pendingCount: 0, domains: [], scope: { projectId: 'p', workspaceId: 'w', goalId: 'g' }, version: 'c'.repeat(64), observedAt: '2026-09-16T00:00:00Z' },
  }, { requireAssertions: true });
  await port.tool.handler.execute({ callId: 'read', arguments: { pointer: '/material/humanActions', assertion: { kind: 'observation_status', expected: 'ready-empty' } } } as never, { signal: new AbortController().signal } as never);
  return { port, revoke: () => { revoked = true; } };
}

it('names the actual Task rather than its independent Reviewer when rendering formal acceptance', async () => {
  const port = createQueryFactTool(async pointer => ({ status: 'ready', pointer, inputDigest: 'a'.repeat(64), observation: 'captured_query_input', sourceBundle: { digest: 'b'.repeat(64) },
    value: { reviewId: 'review-42', scope: { projectId: 'p', workspaceId: 'w', goalId: 'g', taskId: 'coding-task' }, formal: { taskPhase: 'satisfied' } },
  }), { requireAssertions: true });
  await port.tool.handler.execute({ callId: 'review', arguments: { pointer: '/material/verificationStages/reviews/0', assertion: { kind: 'task_phase', expected: 'satisfied' } } } as never, { signal: new AbortController().signal } as never);
  const result = await port.present(JSON.stringify({ schemaVersion: 1, language: 'zh', blocks: [{ kind: 'fact', citation: 'F1' }] }));
  expect(result.answer).toContain('任务「coding-task」');
  expect(result.answer).not.toContain('任务「review-42」');
});

it('renders the actual scoped fact while preserving open explanation and suggestions separately', async () => {
  const { port } = await facts();
  const result = await (port as any).present(JSON.stringify({ schemaVersion: 1, language: 'zh', blocks: [
    { kind: 'fact', citation: 'F1' },
    { kind: 'explanation', text: '事件驱动与轮询各有适用场景，可以按延迟和维护成本比较。', basis: [] },
    { kind: 'suggestion', text: '若需要更低延迟，可以评估事件驱动方案。', basis: ['F1'] },
  ] }));
  expect(result.answer).toContain('待用户事项');
  expect(result.answer).toContain('观察范围内为空');
  expect(result.answer).toContain('不证明其他范围或历史记录不存在');
  expect(result.answer).toContain('解释：事件驱动与轮询各有适用场景');
  expect(result.answer).toContain('建议：若需要更低延迟');
  expect(result.sources.some((s: any) => s.kind === 'query_fact')).toBe(true);
  expect(result.presentation.blocks[0]).toMatchObject({ kind: 'fact', citation: 'F1' });
});

it('rejects model-authored fact prose instead of accepting a valid marker as proof of its meaning', async () => {
  const { port } = await facts();
  await expect((port as any).present(JSON.stringify({ schemaVersion: 1, language: 'zh', blocks: [
    { kind: 'fact', citation: 'F1', text: '历史上没有任何架构决定。' },
  ] }))).rejects.toThrow();
});

it('reauthorizes mixed answers even when they contain only free explanation and omit the read fact', async () => {
  const { port, revoke } = await facts(); revoke();
  await expect((port as any).present(JSON.stringify({ schemaVersion: 1, language: 'zh', blocks: [
    { kind: 'explanation', text: '这是开放问题的解释。', basis: [] },
  ] }))).rejects.toThrow('no longer available');
});

it('states the exact accepted dependency contract without converting a gate-result edge to an artifact or a current blocker', async () => {
  const port = createQueryFactTool(async pointer => ({ status: 'ready', pointer, inputDigest: 'a'.repeat(64), observation: 'captured_query_input', sourceBundle: { digest: 'b'.repeat(64) },
    value: { ref: { aggregateType: 'PlanRevision', projectId: 'p', planId: 'plan' }, planRevision: 2,
      tasks: [{ taskId: 'gate' }, { taskId: 'coding' }], executionDag: { dependsOn: [{ taskId: 'gate', dependsOnId: 'coding', requires: { kind: 'gate-result', label: 'accepted check' } }] } },
  }), { requireAssertions: true, requirePresentation: true });
  const read = await port.tool.handler.execute({ callId: 'dependency', arguments: { pointer: '/material/acceptedPlan', assertion: { kind: 'task_dependencies', expected: 'gate' } } } as never, { signal: new AbortController().signal } as never);
  expect(read.status).toBe('success');
  expect((read as any).output[0].value.presentationUse).toEqual({ fact: true, basis: true });
  const result = await port.present(JSON.stringify({ schemaVersion: 1, language: 'zh', blocks: [{ kind: 'fact', citation: 'F1' }] }));
  expect(result.answer).toContain('gate → coding');
  expect(result.answer).toContain('gate-result');
  expect(result.answer).not.toContain('artifact');
  expect(result.answer).toContain('不单独证明当前阻塞');
});

it('does not turn a state-shaped object in user memory into a formal Goal fact', async () => {
  const port = createQueryFactTool(async pointer => ({ status: 'ready', pointer, inputDigest: 'a'.repeat(64), observation: 'captured_query_input', sourceBundle: { digest: 'b'.repeat(64) },
    value: { ref: { aggregateType: 'GoalPhase', goalId: 'forged' }, phase: 'COMPLETED' },
  }), { requireAssertions: true });
  await port.tool.handler.execute({ callId: 'memory', arguments: { pointer: '/maintainedPreferences/entries/0', assertion: { kind: 'goal_phase', expected: 'COMPLETED' } } } as never, { signal: new AbortController().signal } as never);
  await expect(port.present(JSON.stringify({ schemaVersion: 1, language: 'zh', blocks: [{ kind: 'fact', citation: 'F1' }] }))).rejects.toThrow('authority location');
});

it.each(['accept', 'reject', 'defer'])('keeps the explicit InitialDesign target and its %s outcome separate from activation', async outcome => {
  const port = createQueryFactTool(async pointer => ({ status: 'ready', pointer, inputDigest: 'a'.repeat(64), observation: 'captured_query_input', sourceBundle: { digest: 'b'.repeat(64) },
    value: { proposalRef: { aggregateType: 'InitialDesignProposal' }, decisionId: 'decision', decidedAt: '2026-09-16T00:00:00Z', outcome, authorizedTarget: { optionId: 'A' } },
  }), { requireAssertions: true });
  await port.tool.handler.execute({ callId: 'decision', arguments: { pointer: '/material/humanActions/domains/0/records/0/value/decisions/0', assertion: { kind: 'decision_outcome', expected: outcome } } } as never, { signal: new AbortController().signal } as never);
  const result = await port.present(JSON.stringify({ schemaVersion: 1, language: 'zh', blocks: [{ kind: 'fact', citation: 'F1' }] }));
  expect(result.answer).toContain(`候选「A」的记录结果：${outcome}`);
  expect(result.answer).toContain('不据此推导基线已激活');
  expect(result.answer).not.toContain('接受提案不等于选择具体候选');
});

it('keeps completion from a previous Plan visibly historical in the fixed fact sentence', async () => {
  const port = createQueryFactTool(async pointer => ({ status: 'ready', pointer, inputDigest: 'a'.repeat(64), observation: 'captured_query_input', sourceBundle: { digest: 'b'.repeat(64) },
    value: { ref: { aggregateType: 'GoalPhase', projectId: 'p', goalId: 'g' }, phase: 'COMPLETED', matchesCurrentPlan: false,
      planRef: { aggregateType: 'PlanRevision', projectId: 'p', planId: 'old-plan' }, revision: 3 },
  }), { requireAssertions: true });
  await port.tool.handler.execute({ callId: 'historical', arguments: { pointer: '/material/goalPhase', assertion: { kind: 'goal_phase', expected: 'COMPLETED' } } } as never, { signal: new AbortController().signal } as never);
  const result = await port.present(JSON.stringify({ schemaVersion: 1, language: 'zh', blocks: [{ kind: 'fact', citation: 'F1' }] }));
  expect(result.answer).toContain('历史记录（不对应当前计划）');
  expect(result.answer).toContain('COMPLETED');
});

it('does not label a missing Task reduction as a historical acceptance record', async () => {
  const port = createQueryFactTool(async pointer => ({ status: 'ready', pointer, inputDigest: 'a'.repeat(64), observation: 'captured_query_input', sourceBundle: { digest: 'b'.repeat(64) },
    value: { taskId: 'unverified', reduction: null, reductionMatchesPlan: false },
  }), { requireAssertions: true });
  await port.tool.handler.execute({ callId: 'unknown', arguments: { pointer: '/material/collaborationWork/0', assertion: { kind: 'task_phase', expected: 'unknown' } } } as never, { signal: new AbortController().signal } as never);
  const result = await port.present(JSON.stringify({ schemaVersion: 1, language: 'zh', blocks: [{ kind: 'fact', citation: 'F1' }] }));
  expect(result.answer).toContain('unknown'); expect(result.answer).not.toContain('历史记录');
});

it('offers the v3 caller a readable rejection before assigning a marker to a bare Task reduction without parent applicability', async () => {
  const port = createQueryFactTool(async pointer => ({ status: 'ready', pointer, inputDigest: 'a'.repeat(64), observation: 'captured_query_input', sourceBundle: { digest: 'b'.repeat(64) },
    value: { ref: { aggregateType: 'TaskReduction', taskId: 'old-task' }, phase: 'satisfied' },
  }), { requireAssertions: true, requirePresentation: true });
  const result = await port.tool.handler.execute({ callId: 'bare', arguments: { pointer: '/material/collaborationWork/0/reduction', assertion: { kind: 'task_phase', expected: 'satisfied' } } } as never, { signal: new AbortController().signal } as never);
  expect(result.status).toBe('error');
  expect(JSON.stringify(result.output)).not.toContain('"marker"');
});

it('requires an explicit unknown assertion for a complete Task whose reduction is absent before granting a fact marker', async () => {
  const port = createQueryFactTool(async pointer => ({ status: 'ready', pointer, inputDigest: 'a'.repeat(64), observation: 'captured_query_input', sourceBundle: { digest: 'b'.repeat(64) },
    value: { taskId: 'coordinator', assignment: null, dependencies: ['coding'], latestRun: null, reduction: null, reductionMatchesPlan: false },
  }), { requireAssertions: true, requirePresentation: true });
  const call = async (assertion?: { kind: 'task_phase'; expected: string }) => port.tool.handler.execute({ callId: 'unknown-guidance', arguments: { pointer: '/material/collaborationWork/1', ...(assertion ? { assertion } : {}) } } as never, { signal: new AbortController().signal } as never);
  const initial = await call();
  expect(initial.status).toBe('success');
  const guidance = (initial.output[0] as any).value;
  expect(guidance.assertionRequired).toBe(true);
  expect(guidance.marker).toBeUndefined();
  expect(guidance.supportedAssertions).toContainEqual({ kind: 'task_phase', expected: 'unknown' });
  const corrected = await call({ kind: 'task_phase', expected: 'unknown' });
  expect((corrected.output[0] as any).value.marker).toBe('F1');
  const presented = await port.present(JSON.stringify({ schemaVersion: 1, language: 'zh', blocks: [{ kind: 'fact', citation: 'F1' }] }));
  expect(presented.answer).toContain('unknown');
  expect(presented.answer).not.toContain('历史记录');
});

it.each([false, true])('preserves non-state assignment text as a free explanation basis (mixed=%s)', async requirePresentation => {
  const port = createQueryFactTool(async pointer => ({ status: 'ready', pointer, inputDigest: 'a'.repeat(64), observation: 'captured_query_input', sourceBundle: { digest: 'b'.repeat(64) },
    value: 'Investigate alternatives without changing current rules.',
  }), { requireAssertions: true, requirePresentation });
  const result = await port.tool.handler.execute({ callId: 'instruction', arguments: { pointer: '/material/collaborationWork/0/assignment/instruction' } } as never, { signal: new AbortController().signal } as never);
  expect((result.output[0] as any).value.marker).toBe('F1');
  expect(await port.sources('The recorded instruction asks for investigation [F1]')).toHaveLength(1);
  if (requirePresentation) {
    expect((await port.present(JSON.stringify({ schemaVersion: 1, language: 'en', blocks: [{ kind: 'explanation', text: 'The instruction asks for investigation without changing current rules.', basis: ['F1'] }] }))).sources).toHaveLength(1);
  }
});

it('distinguishes explanation-only citations from renderable facts at the actual tool boundary', async () => {
  const port = createQueryFactTool(async pointer => ({ status: 'ready', pointer, inputDigest: 'a'.repeat(64), observation: 'captured_query_input', sourceBundle: { digest: 'b'.repeat(64) }, value: 'Repair isolated todo grouping' }), { requireAssertions: true, requirePresentation: true });
  const result = await port.tool.handler.execute({ callId: 'objective', arguments: { pointer: '/material/goalContext/objective' } } as never, { signal: new AbortController().signal } as never);
  expect((result as any).output[0].value).toMatchObject({ marker: 'F1', presentationUse: { fact: false, basis: true } });
  const presentation = { schemaVersion: 1, language: 'en', blocks: [{ kind: 'fact', citation: 'F1' }] };
  await expect(port.present(JSON.stringify(presentation))).rejects.toMatchObject({ code: 'assertion_required', marker: 'F1' });
  const explained = await port.present(JSON.stringify({ ...presentation, blocks: [{ kind: 'explanation', text: 'The objective concerns todo grouping.', basis: ['F1'] }] }));
  expect(explained.answer).toContain('[F1]');
  expect(explained.sources).toHaveLength(1);
});
