import { expect, it } from 'vitest';
import { QueryExecutionContextCompiler } from '../../src/data/context-compiler/query-execution-context.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
const planningScope = { projectId: 'planning-project', workspaceId: 'workspace', goalId: 'goal' };

it.each([9, 10] as const)('keeps the captured V%i input byte identity without upgrading its publication protocol', async version => {
  const runRef = { aggregateType: 'QueryRun' as const, ...planningScope, queryJobId: 'legacy', runId: 'legacy-run' };
  const request = { runRef, bundleRef: { digest: 'a'.repeat(64) }, question: 'What decisions were recorded?' };
  const legacyMaterial = { ...(version === 10 ? { queryVocabularyVersion: 1 } : {}), architectureReviews: { status: 'ready', observedCursor: null, rows: [] } };
  const ledger = { load: async (ref: { aggregateType: string }) => ({ status: 'found', snapshot: ref.aggregateType === 'QueryRun'
    ? { ref: runRef, run: { status: 'running' } }
    : { ref: { aggregateType: 'QueryJob' }, job: { status: 'running', runRef, intent: { ...planningScope, question: request.question, budget: { deadline: null },
      execution: { kind: 'semantic_query', roleBinding: { role: 'reader' }, runtimeBudget: DEFAULT_RUNTIME_BUDGET, responsePurpose: 'progress' } } } } }) };
  const vault = { open: async () => ({ status: 'ready', record: { ref: request.bundleRef, body: canonicalJson(legacyMaterial) } }) };
  const compiler = new QueryExecutionContextCompiler({ ledger: () => ledger as never, vault: () => vault as never });
  const captured = await compiler.assemble(request as never);
  if (captured.status !== 'ready') throw Error(captured.message);
  const input = JSON.parse(captured.input);
  expect(input.responseGuide).toBe('semantic-query-secretary-v' + version);
  expect(captured.factReadVersion).toBe(3);
  if (version === 9) expect(input.contextLabels).toBeUndefined();
  else expect(input.contextLabels).toBeDefined();
  expect(input.material).toEqual(legacyMaterial);
  // Computed by the archived snap-18 compiler on this exact contract fixture;
  // provenance: semantic-reliability-19/legacy-input-28.{mjs,json}.
  // V10 uses the archived snap-21 compiler: legacy-input-32.{mjs,json}.
  expect(sha256Hex(captured.input)).toBe(version === 9 ? '8c679c7846c6e8b544eac82008402d7e0f56459b305c358867237ea730744148' : '5259aa8528c8d937a5cc08a03971add3f8e9c018f6f360fcbf193256f48d12e9');
  expect(await compiler.readFact(request as never, { inputDigest: sha256Hex(captured.input), pointer: '/material/architectureReviews' })).toMatchObject({ status: 'ready', value: legacyMaterial.architectureReviews });
});


it('reauthorizes the exact published binding and rejects active, closed, changed and unavailable input', async () => {
  const runRef = { aggregateType: 'QueryRun' as const, ...planningScope, queryJobId: 'published', runId: 'run' };
  const request = { runRef, bundleRef: { digest: 'a'.repeat(64) }, question: 'Records?' };
  let runStatus = 'running', jobStatus = 'running', outcome: string | null = null, available = true;
  let material = { queryVocabularyVersion: 1, queryPresentationVersion: 3, architectureReviews: { status: 'ready', rows: [] as { changed: boolean }[] } };
  const ledger = { load: async (ref: { aggregateType: string }) => ({ status: 'found', snapshot: ref.aggregateType === 'QueryRun'
    ? { ref: runRef, run: { status: runStatus, outcome, execution: { request } } }
    : { ref: { aggregateType: 'QueryJob' }, job: { status: jobStatus, runRef, intent: { ...planningScope, question: request.question, budget: { deadline: null },
      execution: { kind: 'semantic_query', roleBinding: {}, runtimeBudget: DEFAULT_RUNTIME_BUDGET, responsePurpose: 'architecture' } } } } }) };
  const compiler = new QueryExecutionContextCompiler({ ledger: () => ledger as never, vault: () => ({ open: async () => available
    ? { status: 'ready', record: { ref: request.bundleRef, body: canonicalJson(material) } } : { status: 'unavailable' } }) as never });
  const captured = await compiler.assemble(request as never); if (captured.status !== 'ready') throw Error(captured.message);
  const inputDigest = sha256Hex(captured.input), locations = [{ inputDigest, pointer: '/material/architectureReviews' }];
  await expect(compiler.readPublishedFacts(request as never, locations, inputDigest)).rejects.toThrow('answered');
  runStatus = 'answered'; jobStatus = 'answered'; outcome = 'answered';
  expect(await compiler.readPublishedFacts(request as never, locations, inputDigest)).toMatchObject([{ status: 'ready', value: material.architectureReviews }]);
  expect(await compiler.assemble(request as never)).toMatchObject({ status: 'rejected' });
  await expect(compiler.readPublishedFacts({ ...request, bundleRef: { digest: 'b'.repeat(64) } } as never, locations, inputDigest)).rejects.toThrow('exact recorded');
  expect(await compiler.readPublishedFacts(request as never, [{ inputDigest, pointer: '/permissions' }], inputDigest)).toMatchObject([{ status: 'forbidden' }]);
  material = { ...material, architectureReviews: { status: 'ready', rows: [{ changed: true }] } };
  await expect(compiler.readPublishedFacts(request as never, locations, inputDigest)).rejects.toThrow('version changed');
  available = false;
  await expect(compiler.readPublishedFacts(request as never, locations, inputDigest)).rejects.toThrow('unavailable');
  available = true; runStatus = 'closed';
  await expect(compiler.readPublishedFacts(request as never, locations, inputDigest)).rejects.toThrow('answered');
});
