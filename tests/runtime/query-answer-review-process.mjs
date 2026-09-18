import '../coordination/process-loader.mjs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const { ReadOnlyQueryRuntime } = await import('../../src/execution/worker-runtime/read-only-query-runtime.ts');
const { DEFAULT_RUNTIME_BUDGET } = await import('../../src/contracts/runtime-budget.ts');
const [mode, dir] = process.argv.slice(2), root = join(dir, 'source'); await mkdir(root, { recursive: true });
const request = { runRef: { aggregateType: 'QueryRun', projectId: 'p', workspaceId: 'w', queryJobId: 'q', runId: 'r' }, bundleRef: { digest: 'b'.repeat(64) }, question: 'Current progress?', budget: { maxTokens: 128000 } };
let calls = 0;
const client = { async *stream(r) {
  calls++; const common = { schemaVersion: 1, requestId: r.requestId };
  if (r.runId.endsWith('-answer-review')) {
    process.stdout.write('REVIEW_ENTERED\n');
    await new Promise(() => { setInterval(() => {}, 1000); }); return;
  }
  if (calls === 1) {
    yield { ...common, sequence: 1, type: 'tool_call_started', callId: 'phase', name: 'read_query_fact', ordinal: 0 };
    yield { ...common, sequence: 2, type: 'tool_arguments_delta', callId: 'phase', delta: JSON.stringify({ pointer: '/material/goalPhase', assertion: { kind: 'goal_phase', expected: 'RUNNING' } }) };
    yield { ...common, sequence: 3, type: 'completed', reason: 'tool_calls' };
  } else {
    yield { ...common, sequence: 1, type: 'text_delta', delta: JSON.stringify({ schemaVersion: 1, language: 'en', blocks: [{ kind: 'fact', citation: 'F1' }, { kind: 'explanation', text: 'The goal remains running.', basis: ['F1'] }] }) };
    yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' };
  }
} };
const runtime = new ReadOnlyQueryRuntime(join(dir, 'runtime'), { rootFor: () => root, answerReviewPolicy: 'high-risk-v1',
  bind: async () => { if (mode !== 'start') throw Error('Unexpected model rebind'); return { configuration: { revision: 'fixture', provider: 'deepseek', model: 'deterministic-test', baseUrl: 'http://127.0.0.1' }, client }; },
  materials: { assemble: async () => { if (mode !== 'start') throw Error('Unexpected reassembly'); return { status: 'ready', input: '{}', kind: 'semantic_query', goalId: 'g', roleBinding: {}, budget: DEFAULT_RUNTIME_BUDGET, deadline: null, factReadVersion: 3 }; },
    readFact: async () => ({ status: 'ready', pointer: '/material/goalPhase', inputDigest: 'a'.repeat(64), observation: 'captured_query_input', sourceBundle: { digest: 'bundle' }, value: { ref: { aggregateType: 'GoalPhase', goalId: 'g' }, phase: 'RUNNING' } }) } });
await runtime.init();
if (mode === 'start') await runtime.startQuery(request);
else {
  const before = runtime.all()[0];
  const result = await runtime.startQuery(request), repeated = await runtime.startQuery(request);
  process.stdout.write(JSON.stringify({ pid: process.pid, status: before.status, reviewStatus: before.answerReview.status, reservedReview: before.usage.at(-1).status, inspect: await runtime.inspectQuery(request), result, repeated, calls }) + '\n');
  await runtime.close();
}
