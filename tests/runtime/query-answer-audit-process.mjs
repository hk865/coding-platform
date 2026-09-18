import '../coordination/process-loader.mjs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const { QueryAnswerAudits } = await import('../../src/execution/worker-runtime/query-answer-audit.ts');
const { DEFAULT_RUNTIME_BUDGET } = await import('../../src/contracts/runtime-budget.ts');
const [mode, dir] = process.argv.slice(2);
const request = { requestId: 'explicit-1', runRef: { aggregateType: 'QueryRun', projectId: 'p', workspaceId: 'w', queryJobId: 'q', runId: 'r' }, goalId: 'g', answerId: 'answer', blocks: [0] };
const prepared = { input: { blocks: [{ index: 0, block: { kind: 'explanation', text: 'Running.', basis: ['F1'] } }], facts: [{ marker: 'F1' }] }, budget: DEFAULT_RUNTIME_BUDGET, answerDigest: 'original-digest' };
let calls = 0;
const audits = new QueryAnswerAudits(dir, { prepare: async () => prepared, bind: async () => {
  if (mode !== 'start') throw Error('Unexpected model rebind');
  return { configuration: { revision: 'fixture', provider: 'deepseek', model: 'test', baseUrl: 'http://127.0.0.1' }, client: { async *stream() {
    calls++; process.stdout.write('REVIEW_ENTERED\n'); await new Promise(() => { setInterval(() => {}, 1000); });
  } } };
} });
await audits.init();
if (mode === 'start') await audits.start(request);
else {
  const result = await audits.start(request), repeated = await audits.start(request);
  const rows = await Promise.all((await readdir(dir)).filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(join(dir, name), 'utf8'))));
  process.stdout.write(JSON.stringify({ pid: process.pid, result, repeated, calls, usage: rows[0].usage, answerDigest: rows[0].prepared.answerDigest }) + '\n');
  await audits.close();
}
