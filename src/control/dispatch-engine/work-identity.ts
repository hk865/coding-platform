/**
 * RW-12／RW-13 DispatchEngine — 真实 Run 的持久工作身份（ADR 0003 D4 后半）。
 *
 * 职责：在**派发准备阶段**为真实 Run 解析／建立／接续 durable work identity。写入只经既有
 * ControlEngine 命令面（WorkRecordPort.bindWorkContext / linkWorkRun），DispatchEngine
 * 自己不提交账本、不新增聚合、不新增事件种类。
 *
 * ── 先解析、后建立（一段工作只有一个持久身份）────────────────────────────
 *
 * 顺序（不可颠倒）：
 *   1. 把本次派发任务在**返工替换链**上回溯到起源承担者 originTaskId（既有 RW-12 规则，见下）；
 *   2. 向 ControlEngine 的权威解析面 resolveTaskWorkIdentity(project, workspace, goal, originTaskId)
 *      询问「这个任务在账本里已经有工作身份了吗」：
 *        resolved    → **复用**那条身份（它可能就是别的主体建立的，workId 与推导 id 不同也照样复用），
 *                      本次只做 linkWorkRun，绝不按推导规则另建；
 *        absent      → 账本里确实没有，此时才按推导规则建立；
 *        unavailable → 读不到／读不完整：**拒绝派发**（Run 不启动、零写入），
 *                      不得凭推导 id 硬写一个可能与既有身份冲突的新身份。
 *   3. 无论哪条路径，最终都会核对「写进去／复用到的身份确实描述同一段工作」，不一致即拒绝派发。
 *
 * ── 唯一性的权威在 Control／账本，派发面只是消费者 ─────────────────────────
 * 上面 1-3 是**调用方约定**，它挡不住别的调用方，也不构成并发保证。RC-03 把唯一性放到权威处：
 *   - ControlEngine.bindWorkContext 的守卫：同一 (项目, 工作区, 目标, 任务) 已有身份且 workId
 *     不同 → already_bound（零写，回执带既有身份）；
 *   - StateLedger 的提交语义：work-context-bind 在同一个事务里占用该任务的身份槽，跨连接、
 *     跨进程、跨重启都成立。
 * 派发面对这个新拒绝码的处置是**重新解析并复用**既有身份（绝不另建），见下 4。
 *
 * 为什么必须这样：身份是**不可变的持久事实**。RW-12 只在派发收口按推导规则建立身份，
 * 于是同一段工作可以有两个身份——人／场景显式 bindWorkContext 建立的那条，和派发面按规则
 * 新建的那条（同一 (goal, task) 两条 WorkContextBinding）。那会让「接续谁」「继承谁」没有唯一
 * 答案，也会让同一段工作的历史理由分裂在两处。RW-13 把「哪个 workId 代表这个任务」交给
 * ControlEngine 的权威解析面（唯一权威，见 src/control/control-engine/work-identity-resolution.ts），
 * 派发面只负责「解析不到时才建立」和「复用后只做 link」。
 *
 * ── workId 推导规则（确定性，写死在共享契约里，是全仓唯一权威）────────────────────
 *
 *   originTaskId = 本次派发任务在**返工替换链**上的起源承担者：
 *       从 intent.taskId 出发，在本次 Run 被认领时的那份 PlanRevision（intent.planRef）里
 *       反复寻找「replacedByTaskId === 当前任务」的任务向上回溯，直到没有前驱为止
 *       （ADR 0003 D1 规定：被取代的任务保留 disposition=superseded 并记录 replacedByTaskId，
 *        同一义务、同一验收语义，只换承担者）。
 *   workId = "work-" + sha256(canonicalJson([projectId, workspaceId, goalId, originTaskId]))[0..32]
 *
 * 这条规则是**兜底规则**，不是身份的唯一来源：它只在「该任务还没有既存身份」时被用来建立新身份。
 * 一旦账本里已经有身份（人／场景显式建立的，或此前按同一条规则建立的），那段工作的身份就是
 * 已存在的那条——不改名、不删除、不被推导 id 顶替。规则本体在 src/contracts/task-work-identity.ts
 * （ControlEngine 的解析面与 ReadModel 的视图也要用它区分「显式声明的身份」与「推导兜底身份」，
 * 而 ControlEngine 不能反过来依赖 DispatchEngine，所以规则放在共享契约里，本文件 re-export）。
 *
 * 为什么这样定义：
 *   1. **一段连贯工作只能有一个身份**。human/context-management.md 明确「调查、实现、测试及相关
 *      返工可以属于同一工作」；ADR D1 又把返工表达成「只换承担者的新任务」，所以替换链必须收敛到
 *      同一个 workId，否则每次返工都会丢掉前面已经花掉的推理解释。
 *   2. **纯函数于 canonical 计划事实**：不掺随机 id、不掺 runId、不掺时间。同一任务在任何时刻、
 *      任何进程、重启之后都算出同一个 workId。重复派发时先解析到既存身份，因此**不可能**产生
 *      第二个工作身份（解析面对同一任务永远给同一个答案）。
 *   3. **与运行标识分离**：一个工作可以有多个 Run（换手、接续、重新派发）。新 Run 只是被
 *      linkWorkRun 追加进 linkedRunRefs，而不是新建身份。WorkContextBinding 本身没有结束命令
 *      （P1-16 bind-once），所以「接续」就是 link，不需要新状态。
 *   4. 计划读不到时回退到「任务自身即起源」（chainResolved=false）。计划不可读时
 *      ContextCompiler 组装本来就返回 needs_material、Run 不会启动，所以这个回退不会把一个
 *      错误的身份写进账本；它只是让失败路径保持零写入（身份建立在组装成功之后，见下）。
 *      同一原因：链回溯失败时解析面仍按「任务自身」查一次——查到就复用，查不到才建立。
 *
 * ── 为什么建立在 drive() 而不是三个 claimTask 调用点 ────────────────────────────
 * 真实 Run 的 claim 分散在三处（PlannedTaskDispatch / OperatorTaskDispatch / 夹具路径），
 * 但它们**全部**要经过 DispatchEngineImpl.drive 的 outbox 收口才会真正启动运行。把身份建立
 * 放在唯一收口处，既覆盖全部真实 Run，又不产生第二条建立路径；顺序上放在
 * 「上下文组装成功之后、DispatchStartRun 提交之前」——组装失败时零写入，运行启动前身份必定已存在。
 */
import type { StateLedger } from '../../contracts/ledger.js';
import type { ControlEngine } from '../../contracts/modules.js';
import type { DispatchIntentV1 } from '../../contracts/dispatch.js';
import type { PlanRevisionSnapshot } from '../../contracts/plan.js';
import type { WorkContextBindingSnapshot } from '../../contracts/context-continuity.js';
import { workContextRefFor } from '../../contracts/context-continuity.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import { WORK_ID_PREFIX, workIdFor, type WorkIdentityScope } from '../../contracts/task-work-identity.js';
import { taskWorkOrigin } from '../../contracts/task-work-identity.js';
import { buildBindWorkContextCommand, buildLinkWorkRunCommand } from '../../contracts/commands/context.js';

// 推导规则与作用域类型的唯一正文在共享契约里（见文件头注释）；这里 re-export，
// 既有消费者（work-material-drive、测试）的 import 路径不变。
export { WORK_ID_PREFIX, workIdFor };
export type WorkScope = WorkIdentityScope;

/** 替换链回溯上限：超过即判定为计划事实异常，不再继续回溯（避免环或超长链）。 */
export { WORK_IDENTITY_MAX_CHAIN_HOPS } from '../../contracts/task-work-identity.js';

export type OriginResolution = {
  originTaskId: string;
  /** 从 dispatch 任务到起源任务的替换链（含两端）；链长 1 表示该任务本身即起源。 */
  chain: string[];
  /** false 表示计划快照不可读、只能按「任务自身即起源」回退。 */
  chainResolved: boolean;
  /** 计划快照的数值 revision（读不到时为 null）；写进工作身份用于版本新鲜度核对。 */
  planRevision: number | null;
};

/**
 * 在给定的 PlanRevision 里把任务回溯到替换链起源。只读 canonical 计划快照：
 * 不推断、不跨 plan revision 猜测，读不到就诚实回退并标记 chainResolved=false。
 */
export async function resolveOriginTaskId(
  ledger: Pick<StateLedger, 'load'>,
  planRef: DispatchIntentV1['planRef'],
  taskId: string,
): Promise<OriginResolution> {
  const loaded = await ledger.load(planRef);
  if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'PlanRevision') {
    return { originTaskId: taskId, chain: [taskId], chainResolved: false, planRevision: null };
  }
  const plan = loaded.snapshot as PlanRevisionSnapshot;
  return { ...taskWorkOrigin(plan, taskId), chainResolved: true, planRevision: plan.planRevision };
}

export type WorkIdentityOutcome =
  | { status: 'established'; workId: string; originTaskId: string; linked: boolean; revision: number }
  | { status: 'rejected'; code: 'work_identity_conflict' | 'work_identity_unavailable'; message: string };

export type WorkIdentityDeps = {
  ledger: Pick<StateLedger, 'load'>;
  /** 解析面来自 ControlEngine（唯一权威）；写入仍只走 bindWorkContext／linkWorkRun。 */
  control: Pick<ControlEngine, 'bindWorkContext' | 'linkWorkRun' | 'resolveTaskWorkIdentity'>;
  now: () => string;
};

/**
 * 解析／建立／接续本 Run 的工作身份。零写入拒绝路径：
 *  - 权威解析读不到（unavailable）→ 拒绝派发，**不按推导 id 硬写**：读不完整就不能说
 *    「这个任务还没有身份」，硬写很可能给同一段工作造出第二个身份；
 *  - 解析到／推导出的 workId 已经描述**另一段工作**（goal/task/kind 不同）→ 拒绝派发，
 *    而不是复用。这条守卫让 workId 规则的破坏变成可见的失败，而不是悄悄把两个工作混在一起；
 *  - 身份命令未被 Control 接纳 → 拒绝派发（Run 不启动；outbox 保持 pending，可重试）。
 */
export async function ensureWorkIdentity(
  deps: WorkIdentityDeps,
  intent: DispatchIntentV1,
): Promise<WorkIdentityOutcome> {
  const scope: WorkScope = { projectId: intent.projectId, workspaceId: intent.workspaceId, goalId: intent.goalId };
  const origin = await resolveOriginTaskId(deps.ledger, intent.planRef, intent.taskId);

  // 1. 先解析：按 (project, workspace, goal, 起源任务) 问权威读面「这个任务已经有身份了吗」。
  //    查询用 originTaskId：返工链上的任一承担者都收敛到同一个起源任务，因此链上的任何一次
  //    派发都会命中同一个身份（这正是「一段工作只有一个身份」的判据）。
  //    已知边界：解析面按 binding.taskId 精确匹配。若有人把身份显式声明在**返工后继任务**上
  //    （而不是链的起源任务），本次派发仍按起源任务解析／建立，两条身份都按各自 workId 保留可读；
  //    这不改写任何事实，但那段工作会暂时分裂在两个身份里——属于历史不一致，本票不猜、不合并。
  const resolution = await deps.control.resolveTaskWorkIdentity({
    projectId: scope.projectId,
    workspaceId: scope.workspaceId,
    goalId: scope.goalId,
    taskId: origin.originTaskId,
  });
  if (resolution.status === 'unavailable') {
    return {
      status: 'rejected',
      code: 'work_identity_unavailable',
      message: '按任务解析既有工作身份失败：' + resolution.reason + '；拒绝按推导 id 硬写新身份，运行不启动',
    };
  }

  let reuse = resolution.status === 'resolved';
  // 复用路径用解析返回的 workId（它可能不等于推导 id——那是别的主体显式声明的身份，正是要复用的）；
  // 只有 absent 路径才允许使用推导规则，且推导 id 只是兜底，不是身份的唯一来源。
  let workId = resolution.status === 'resolved' ? resolution.binding.workId : workIdFor(scope, origin.originTaskId);

  // 三次尝试（RC-03 起由两次放宽到三次）：这三条都是**并发**路径，不是重试循环——
  //   1) link 的 CAS 先被另一条路径推进 → revision_conflict，重读一次即可；
  //   2) bind 的 CAS 冲突 → 重读一次；
  //   3) bind 被权威唯一性守卫拒绝（already_bound）→ 重新解析并复用既有身份，再用剩下一次机会 link。
  // 每次尝试之间没有等待、没有锁；真正的唯一性由账本提交语义保证，这里只负责把并发收敛到
  // 「复用同一条身份」，收敛不了就零写入失败（Run 不启动），绝不新造第二条。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const workRef = workContextRefFor(scope.projectId, scope.workspaceId, workId);
    const existing = await deps.ledger.load(workRef);
    if (existing.status === 'not_found') {
      if (reuse) {
        // 刚解析到存在、此刻却读不到：可能是并发推进。重读一次；第二次仍读不到就失败（零写入），
        // 绝不在「该任务已有身份」的前提下改用推导 id 另建一个。
        continue;
      }
      const receipt = await deps.control.bindWorkContext(
        buildBindWorkContextCommand({
          commandId: 'bind-' + workId,
          projectId: scope.projectId,
          actor: { kind: 'system', id: 'dispatch-work-identity' },
          // 派发侧幂等键由 workId 派生：同一工作的重复派发是一次 replay，不是第二次创建。
          idempotencyKey: 'rw12-work-bind-' + workId,
          correlationId: intent.correlationId,
          submittedAt: deps.now(),
          workId,
          workspaceId: scope.workspaceId,
          workKind: 'task',
          goalId: scope.goalId,
          taskId: origin.originTaskId,
          planRef: { ...intent.planRef },
          // 计划 revision 一并写入：WorkContext 组装按它核对新鲜度，过期即报缺口，
          // 而不是把旧计划的身份当成当前绑定。
          planRevision: origin.planRevision,
          roleBindingRef: { ...intent.roleBinding },
          initialRunRef: { ...intent.runRef },
        }),
      );
      if (receipt.status === 'committed') {
        // bind 已把 initialRunRef 放进 linkedRunRefs —— 首次派发不需要再 link。
        return { status: 'established', workId, originTaskId: origin.originTaskId, linked: true, revision: 1 };
      }
      if (receipt.code === 'already_bound') {
        // 权威守卫判定这个任务已经有身份了（并发建立，或别的调用方先到；也可能账本唯一性槽
        // 先被占用而本次 CAS 冲突后暴露出来）。权威答案只能来自解析面 —— 重新解析一次，改成复用
        // 那条既有身份，绝不因为"推导 id 用不了"就另建一个。
        const reread = await deps.control.resolveTaskWorkIdentity({
          projectId: scope.projectId,
          workspaceId: scope.workspaceId,
          goalId: scope.goalId,
          taskId: origin.originTaskId,
        });
        if (reread.status !== 'resolved') {
          return {
            status: 'rejected',
            code: reread.status === 'unavailable' ? 'work_identity_unavailable' : 'work_identity_conflict',
            message: '工作身份创建被权威守卫拒绝（已有身份），但重新解析没有拿到可用答案：' + reread.status +
              '（既有身份见回执 existingWorkContextRef=' + (receipt.existingWorkContextRef?.workId ?? 'null') + '），拒绝启动运行',
          };
        }
        reuse = true;
        workId = reread.binding.workId;
        continue;
      }
      if (receipt.code === 'revision_conflict' || receipt.code === 'idempotency_conflict') continue;
      return { status: 'rejected', code: 'work_identity_unavailable', message: '工作身份创建被拒绝：' + receipt.code };
    }

    if (existing.snapshot.ref.aggregateType !== 'WorkContextBinding') {
      return { status: 'rejected', code: 'work_identity_conflict', message: 'workId 指向的不是工作身份聚合' };
    }
    const binding = (existing.snapshot as WorkContextBindingSnapshot).binding;
    // 同一身份必须描述同一段工作。解析路径下这是复核（解析面已按 (goal, task) 过滤）；
    // 建立路径下这是「workId 规则被破坏」的可见失败——拒绝派发，零写入。
    if (binding.workKind !== 'task' || binding.goalId !== scope.goalId || binding.taskId !== origin.originTaskId) {
      return {
        status: 'rejected',
        code: 'work_identity_conflict',
        message: 'workId 已属于另一段工作（goal/task/workKind 不一致），拒绝复用：' + canonicalJson(binding as never),
      };
    }
    const runKey = canonicalJson(intent.runRef as never);
    if (binding.linkedRunRefs.some((ref) => canonicalJson(ref as never) === runKey)) {
      return { status: 'established', workId, originTaskId: origin.originTaskId, linked: true, revision: existing.snapshot.revision };
    }
    const receipt = await deps.control.linkWorkRun(
      buildLinkWorkRunCommand({
        commandId: 'link-' + workId + '-' + intent.runRef.runId,
        projectId: scope.projectId,
        actor: { kind: 'system', id: 'dispatch-work-identity' },
        idempotencyKey: 'rw12-work-link-' + workId + '-' + intent.runRef.runId,
        correlationId: intent.correlationId,
        submittedAt: deps.now(),
        workId,
        workspaceId: scope.workspaceId,
        runRef: { ...intent.runRef },
        expectedRevision: existing.snapshot.revision,
      }),
    );
    if (receipt.status === 'committed') {
      return { status: 'established', workId, originTaskId: origin.originTaskId, linked: true, revision: receipt.revision };
    }
    if (receipt.code === 'already_linked') {
      return { status: 'established', workId, originTaskId: origin.originTaskId, linked: true, revision: existing.snapshot.revision };
    }
    // 并发推进：重读一次再判定；第二次仍冲突才算失败（零写入）。
    if (receipt.code === 'revision_conflict') continue;
    return { status: 'rejected', code: 'work_identity_unavailable', message: '工作身份接续被拒绝：' + receipt.code };
  }
  return { status: 'rejected', code: 'work_identity_unavailable', message: '工作身份并发推进未收敛，未启动运行' };
}
