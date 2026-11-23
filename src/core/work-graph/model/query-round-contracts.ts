/**
 * 问答轮的可信身份：一处读链，各口各判自己的准入（通信与权限、校验拆开的设计 3.1）。
 *
 * 读链从调用方 principal 指名的 QueryRun 起：它必须已进入 → 它的 QueryJob 意图 → 按 `bundleRef`/`inputDigest`
 * 绑定的 manifest → 本轮 Session 和它的职责。这里只读、不准入：发件、读箱、回复、各动作口各自判谁能做什么。
 * 调用方不是 `query_run`、QueryRun 不在、没进入是 `forbidden`；读失败、绑定坏是 `unavailable`（读不到的事实不能当真）。
 *
 * `guards` 是同一读窗读到的版本：QueryRun（模型请求的用量写只落在工具执行之外，所以一次工具调用里读和提交之间
 * 它不动）和本轮 Session。各口把它们并进自己的提交守卫，读和提交之间这一轮结束或 Session 换代就是冲突。
 */
import type { CoreCallContext, CorePrincipal } from '../../../contracts/core/call-context.js';
import type { SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import type { QueryAnswerShapeV1, QueryJobRef, QueryRunRef } from '../../../contracts/query-job.js';
import type { RecordGuard } from '../../record-store/ports.js';

export type QueryRoundV1 = {
  principal: Extract<CorePrincipal, { kind: 'query_run' }>;
  /** 执行状态里的 `sessionRef`：这一轮跑在哪条线上。 */
  session: SessionRef;
  sessionGeneration: number;
  /** 本轮 Session 的角色读出的职责；读成 `unknown` 照实交出，由各口拒。 */
  duty: PlatformDutyV1 | 'unknown';
  /** QueryRun 自己的项目和工作区（取自存下的引用，不取输入）。 */
  scope: WorkspaceScope;
  round: QueryJobRef;
  run: QueryRunRef;
  /** 准备时冻结进 manifest 的目标（`manifest.goal`），没有就是 `null`。 */
  effectiveGoalId: string | null;
  /** 准备时冻结进 manifest 的计划（`manifest.focusPlan`）。 */
  planRef: PlanRevisionRef | null;
  /** manifest 冻结的回答形状；`null` 是文字轮。 */
  shape: QueryAnswerShapeV1 | null;
  /** 规划形状的轮（`intervention_planning`）开轮的来源消息；别的轮没有。 */
  sourceMessageRef: SessionMessageRef | null;
  /** 本轮 Session 是问一问的只读副本：所有口都不让它冒充原线。 */
  readOnlyCopy: boolean;
  /** QueryJob 意图上的请求根（`job.requestRoot`，身份读链本来就读到的那一份）；不是请求轮是 `null`。 */
  requestRoot: QueryJobRef | null;
  /** 秘书请求轮（执行状态带 `requestProfile`）：它的邮箱和动作照旧走秘书路径。 */
  requestRound: boolean;
  /** 线（本轮 Session）的工作区：问答轮的信写在这里，和做事轮的规则 W 一样。 */
  lineWorkspaceId: string;
  /**
   * 这一轮冻结的最终工具名（`manifest.promptSet.toolNames`，准备与启动比对过的同一份）。动作 owner 只按它核
   * 授予（Q1a）：没授予就是 `forbidden`，不另读 manifest、不另问 Host。
   */
  grantedToolNames: readonly string[];
  /** 同一读窗的 QueryRun 版本和 Session 版本，各口提交时守。 */
  guards: readonly RecordGuard[];
};

export interface QueryRoundPort {
  resolveQueryRound(ctx: CoreCallContext): Promise<{ status: 'ready'; value: QueryRoundV1 } | CoreRejection>;
}
