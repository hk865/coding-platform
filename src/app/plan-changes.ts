/**
 * RW-09 计划变更只读入口（应用层）。
 *
 * 职责边界（为什么这样拆）：
 *   - **唯一数据来源是既有投影** `ReadModelIndex.planChangeView`（返回提案／人的决定／
 *     Goal revision／任务处置行）。本文件不重算处置、不推导提案身份、不读账本、不提交命令，
 *     也不在应用层复刻一份投影——受理链的守卫与身份判定仍各自只有一处实现。
 *   - 它多做的只有一件事：把投影的 `not_found` 翻译成**人能读懂的两种情况**。投影的
 *     `not_found` 既可能是"确实还没有计划变更事实"，也可能是"投影尚未推进、此刻无法断言"，
 *     界面不能把后者说成前者（否则等于凭空宣布"没有变更"）。
 *
 * Authority:
 *   - dev_docs/decisions/0003-rework-role-spec-architecture-reconciliation.md D1-5
 *     （受理后的提案与决定要在界面与时间线可见）；
 *   - ARCHITECTURE.md「投影、校验与语义判断」与全局不变量 #4（UI 只是 ReadModel 的消费者，
 *     不接受直接状态写入）。
 */
import type { CommitCursor } from '../contracts/command-event.js';
import type { PlanChangeViewQuery, PlanChangeViewResult } from '../contracts/goal-change.js';

/** 与 `PlanChangeViewQuery` 同一作用域键：项目 + 工作区 + 目标，三者缺一不可。 */
export type PlanChangesScopeV1 = { projectId: string; workspaceId: string; goalId: string };

export type PlanChangesViewV1 =
  /** 投影原样返回：字段含义由 ReadModelIndex 的冻结契约定义，本层不增删。 */
  | ({ status: 'ready' } & Extract<PlanChangeViewResult, { status: 'ready' }>)
  /** 投影已推进，但这个目标没有任何计划变更事实（初始计划受理不算变更）。 */
  | { status: 'empty'; reason: string; observedCursor: CommitCursor | null }
  /** 读不到：投影不可用或读取失败。原因必须如实说明，不能退化成"没有变更"。 */
  | { status: 'unavailable'; reason: string; observedCursor: CommitCursor | null };

export type PlanChangesEntryDeps = {
  /** 既有投影查询本身（产品里就是持久宿主的 `h.planChangeView`）。 */
  view: (query: PlanChangeViewQuery) => Promise<PlanChangeViewResult>;
  /** 投影进度；只用来区分"没有变更事实"与"投影还没追上"，不参与任何判定。 */
  observedCursor: () => CommitCursor | null;
  /** 把投影推进到已提交事件（组合根已有的 project()）。读取前先推进，避免把"还没投影"说成"确实没有"。 */
  advance: () => Promise<void>;
};

export class PlanChangesEntry {
  constructor(private readonly deps: PlanChangesEntryDeps) {}

  async view(scope: PlanChangesScopeV1): Promise<PlanChangesViewV1> {
    const query: PlanChangeViewQuery = { projectId: scope.projectId, workspaceId: scope.workspaceId, goalId: scope.goalId };
    // 读之前先把投影推进到已提交事件（与 /api/state 同一做法）：否则「投影落后于账本」会被
    // 误报成确定的 empty，把「还没来得及投影」说成「确实没有变更」。
    await this.deps.advance();
    let result: PlanChangeViewResult;
    try {
      result = await this.deps.view(query);
    } catch (error) {
      // 读取失败不等于"没有变更"：把真实原因交回界面，状态是 unavailable 而不是 empty。
      return { status: 'unavailable', reason: '计划变更投影读取失败：' + (error instanceof Error ? error.message : String(error)), observedCursor: this.deps.observedCursor() };
    }
    if (result.status === 'ready') return { ...result };
    const observedCursor = this.deps.observedCursor();
    if (observedCursor === null)
      return { status: 'unavailable', reason: '读模型投影尚未推进到任何事件：此刻不能断言"没有计划变更"。', observedCursor };
    return {
      status: 'empty',
      reason: '该目标没有已落账的计划变更事实（提案／人的决定／Goal revision 都为空）。计划的**初始**受理不算变更，因此不会出现在这里。',
      observedCursor,
    };
  }
}
