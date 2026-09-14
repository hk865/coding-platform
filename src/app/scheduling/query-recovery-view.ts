import type { QueryJobViewResult, ReadOnlyQueryPort } from '../../contracts/query-job.js';

/** Runtime observation is labelled separately from canonical QueryJob status.
 * Missing results never imply failure or permission to execute again. */
export async function queryRecoveryView(view: QueryJobViewResult, runtime: Pick<ReadOnlyQueryPort, 'inspectQuery'>): Promise<QueryJobViewResult> {
  if (view.status !== 'ready' || view.job.status !== 'running') return view;
  const binding = view.run?.execution;
  const inspection = binding && runtime.inspectQuery ? await runtime.inspectQuery(binding.request) : undefined;
  if (inspection?.status === 'active') return { ...view, recovery: { status: 'active', message: '查询正在执行。' } };
  if (inspection?.status === 'result') return { ...view, recovery: { status: 'result_available', message: '运行结果已保存，等待正式答案对账。' } };
  return { ...view, recovery: { status: 'requires_reconciliation', message: '查询结果尚未确认，需对账；系统不会自动重跑模型。' } };
}
