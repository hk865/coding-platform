import { canonicalJson, sha256Hex } from '../contracts/fingerprint.js';
import type { QueryJobViewResult } from '../contracts/query-job.js';
import type { QueryAnswerAuditRequest } from '../contracts/query-answer-audit.js';
import type { QueryExecutionContextCompiler } from '../data/context-compiler/query-execution-context.js';
import type { QueryRuntimeRecord } from '../execution/worker-runtime/read-only-query-runtime.js';
import { QueryAnswerAudits } from '../execution/worker-runtime/query-answer-audit.js';
import { withQueryReviewDefinitions, type QueryReviewInput } from '../execution/worker-runtime/query-answer-review.js';
import type { BoundModel } from '../execution/worker-runtime/coding-agent-runtime.js';
import { renderQueryFact, type PresentedQueryFact } from '../contracts/query-answer-presentation.js';

export function createQueryAnswerAuditEntry(directory: string, deps: {
  job: (scope: { projectId: string; workspaceId: string; queryJobId: string }) => Promise<QueryJobViewResult>;
  runs: () => QueryRuntimeRecord[];
  currentness: (projectId: string, workspaceId: string) => Promise<Map<string, boolean>>;
  materials: QueryExecutionContextCompiler; bind: (id: string) => Promise<BoundModel>;
}) {
  const load = async (scope: { projectId: string; workspaceId: string; goalId: string; queryJobId: string; answerId: string }) => {
    const view = await deps.job(scope);
    if (view.status !== 'ready' || view.job.goalId !== scope.goalId || view.job.status !== 'answered'
      || view.job.intent.execution?.kind !== 'semantic_query' || !['architecture', 'handoff'].includes(view.job.intent.execution.responsePurpose ?? '')
      || view.currentAnswer?.answerId !== scope.answerId || !view.run?.execution) throw Error('该作用域没有可复核的参谋或书记正式回答');
    const answer = view.currentAnswer;
    const runtime = deps.runs().find(row => canonicalJson(row.runRef) === canonicalJson(answer.runRef));
    if (!runtime || runtime.result?.outcome !== 'answered' || runtime.result.answer !== answer.answer || !runtime.result.presentation
      || sha256Hex(runtime.input) !== runtime.inputDigest) throw Error('原回答的持久输入或段落不可用');
    return { view, answer, runtime, execution: view.run.execution.request, presentation: runtime.result.presentation };
  };
  const prepare = async (request: QueryAnswerAuditRequest) => {
    const loaded = await load({ ...request.runRef, goalId: request.goalId, answerId: request.answerId });
    if (canonicalJson(loaded.answer.runRef) !== canonicalJson(request.runRef)) throw Error('原回答运行身份不符');
    if (loaded.view.stale || loaded.answer.stale || (await deps.currentness(request.runRef.projectId, request.runRef.workspaceId)).get(request.runRef.queryJobId) !== true) throw Error('回答来源已变化或不可用；请先取得当前回答');
    const { presentation, runtime } = loaded;
    if (request.blocks !== null && (!request.blocks.length || new Set(request.blocks).size !== request.blocks.length
      || request.blocks.some(index => !Number.isSafeInteger(index) || index < 0 || index >= presentation.blocks.length))) throw Error('所选段落不属于原回答');
    const selected = presentation.blocks.flatMap((block, index) => request.blocks === null || request.blocks.includes(index) ? [{ block, index }] : []);
    const markers = new Set(selected.flatMap(({ block }) => block.kind === 'fact' ? [block.citation] : block.basis));
    const citations = loaded.answer.sources.filter(source => source.kind === 'query_fact').map(source => {
      const citation = JSON.parse(source.refKey);
      if (citation.inputDigest !== source.version || citation.inputDigest !== runtime.inputDigest) throw Error('引用版本不符');
      return citation;
    }).filter(citation => markers.has(citation.marker));
    if ([...markers].some(marker => !citations.some(citation => citation.marker === marker))) throw Error('引用不存在');
    const reads = await deps.materials.readPublishedFacts(loaded.execution, citations.map(citation => ({ inputDigest: runtime.inputDigest, pointer: citation.pointer })), runtime.inputDigest);
    const facts: PresentedQueryFact[] = reads.map((read, index) => {
      if (read.status !== 'ready') throw Error('引用材料不可用');
      const citation = citations[index]!;
      if (canonicalJson(read.sourceBundle) !== canonicalJson(citation.sourceBundle)) throw Error('引用来源不符');
      return { ...read, marker: citation.marker, ...(citation.assertion ? { assertion: citation.assertion } : {}) };
    });
    const input: QueryReviewInput = { facts, blocks: selected.map(({ block, index }) => ({ index, block: block.kind === 'fact'
      ? { kind: 'explanation', text: renderQueryFact(facts.find(fact => fact.marker === block.citation)!, presentation.language), basis: [block.citation] }
      : block })) };
    return { input: withQueryReviewDefinitions(input, runtime.input), budget: runtime.budget, answerDigest: sha256Hex(canonicalJson(loaded.answer)) };
  };
  const audits = new QueryAnswerAudits(directory, { prepare, bind: deps.bind });
  return { init: () => audits.init(), close: () => audits.close(), async action(path: string, input: Record<string, unknown>) {
    const required = (key: string) => { const value = input[key]; if (typeof value !== 'string' || !value.trim() || value.length > 256) throw Error('缺少有效的' + key); return value; };
    const scope = { projectId: required('projectId'), workspaceId: required('workspaceId'), goalId: required('goalId'), queryJobId: required('queryJobId'), answerId: required('answerId') };
    const loaded = await load(scope);
    if (path.endsWith('/view')) {
      let available = true; let message: string | null = null;
      try { await prepare({ requestId: 'view', runRef: loaded.answer.runRef, goalId: scope.goalId, answerId: scope.answerId, blocks: null }); }
      catch (error) { available = false; message = error instanceof Error ? error.message : '来源不可用'; }
      return { available, message, blocks: loaded.presentation.blocks.map((block, index) => ({ index, text: block.kind === 'fact' ? '结构化事实 [' + block.citation + ']' : block.text })),
        reviews: audits.views(loaded.answer.runRef, scope.answerId).map(review => available ? review : { ...review, status: 'stale' as const, assessment: null, message }) };
    }
    const request: QueryAnswerAuditRequest = { requestId: required('requestId'), runRef: loaded.answer.runRef, goalId: scope.goalId, answerId: scope.answerId,
      blocks: input['blocks'] === null ? null : Array.isArray(input['blocks']) ? input['blocks'] as number[] : (() => { throw Error('请选择段落或整答'); })() };
    if (path.endsWith('/start')) return audits.start(request);
    if (path.endsWith('/cancel')) return audits.cancel(request);
    throw Error('未知复核操作');
  } };
}
