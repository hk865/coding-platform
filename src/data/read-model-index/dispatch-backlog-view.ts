import type { StateLedger } from '../../contracts/ledger.js';
import { dispatchBacklog, type DispatchBacklogView } from '../../contracts/dispatch-backlog.js';

/** Query canonical pending records without executing work or claiming freshness
 * from an unrelated projection cursor. An incomplete window is explicit. */
export async function readDispatchBacklog(ledger: Pick<StateLedger, 'pendingDispatchIntents'>,
  scope: { projectId: string; goalId: string }, observedAt: string): Promise<DispatchBacklogView> {
  const entries = await ledger.pendingDispatchIntents(2001, { includeQuarantined: true, scope });
  if (entries.length > 2000) return { status: 'unavailable', observedAt, reason: '待办数量超过本次可完整展示的范围' };
  return { status: 'ready', observedAt, backlog: dispatchBacklog(entries, observedAt) };
}
