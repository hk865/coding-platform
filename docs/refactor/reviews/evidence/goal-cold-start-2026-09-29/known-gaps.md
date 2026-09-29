# 已知缺口：从未进入 Kernel 的 Work 被取消后无法正式收口

状态：已复现、仅记录机制建议，尚未施工或验收。本轮正常冷启动执行验收改用正常新目标；这不代表原取消执行已经恢复，也不能将本项写成完成。

## 本次事实

原 Run `f7234222-f091-41c1-956d-7891d55280f4` 已由正式 claim 创建。首次准备被当时错误的工具 grant 拒绝；Run 仍为 `starting`，`envelope === null`，无 `executionAuthorization`、`inputBinding` 和 Kernel entered 事实。修复 grant 后，新的未准入 prepare 恢复分支本可继续此类原 Run。

但主线程核对发现，该 Run 已有 `controlState.desiredState === 'cancelled'`：取消是在本轮重启时由 Host.close → collaboration driver stop 提交，不是之后用户重新点击取消。原 queued cancellation 是已经发生的正式事实，不能删除或改成 running。新恢复分支拒绝它是正确行为。

## 现有入口为什么不能解除

| 现有接缝 | 当前行为与限制 |
|---|---|
| `src/app/collaboration-driver.ts` 的取消提交/递送路径（约 645–685） | 先提交正式 cancel，再尝试交给 Runtime；递送 ready 不等于产生终态。 |
| `src/core/agent-runtime/execution-control.ts:184` | 找不到原 live handle 时返回原 queued intent；没有 Kernel 可中断，不伪造消费或历史。 |
| `src/core/agent-runtime/execution-observation.ts:462` | 无原历史 locator / V2 entry authorization 时返回原 Run，不能用观察补造 Kernel terminal。 |
| `src/core/work-graph/tasks/control-service.ts:128、541` | cancel 是最终隔离，resume/steer 不解除；现有控制观察要求真实 V2 entry 和历史定位。 |
| `src/core/work-graph/tasks/execution-entry-service.ts:1293、1341` | `recordRunResult` 是已有正式终态/Attempt/占用/Lease 提交 owner，但当前路径要求 V2 authorization，不能给未进入 Run 塞一个虚构 Kernel 结果。 |
| `src/core/work-graph/tasks/claim-service.ts:586` 与 `eligibility.ts:68–75` | 原活跃 Lease/Task 阶段阻止重领；当前已有 Run 的后继 claim 特例仅为真实 yielded continuation，不是 cancelled 重试入口。 |

因此当前没有“安全解锁”的现成端口。再次 observe、deliverControl、resume 或普通继续都不构成合法收口；不能通过另造 Session、抹取消、改数据库绕过。

## 最小机制建议（待审定，不是已交付接口）

1. **取消收口归现有 WorkGraph 执行/控制 owner。** 在原 `execution-entry-service` 与 `control-service` 事务接缝增加仅针对未准入取消的分支，复用原 RecordStore、Run/Attempt/Session/Lease 和控制回执，不新增管理器、表或通用恢复服务。
2. **精确判定“确定未开始”。** 读取同一正式 Run 与关联 claim、当前 cancel intent；仅 `starting` 且无授权、envelope、inputBinding、entered/history/运行事实才可收口。原版本 guard 与准入写入竞争，二者不能同时成功；未知、已授权或已进入仍走已有 Runtime/Kernel 观察路径，不根据内存 handle 不存在来判断。
3. **原子记录真实取消事实并释放自己的占用。** 同一 owner 事务记录“准入前取消”这一实际原因，结束原 Run/Attempt、结算原 cancel intent，并按完整原 claim 身份释放仍由自己持有的 Session occupancy/Lease。保留原 intent、claim、失败准备记录与请求回执；重放返回原结果。不得伪造 Kernel run/turn、历史位置、工具结果或 Answer。所需最小结果/控制观察表示须在实施前冻结，不能直接冒用当前要求 Kernel 证据的观察输入。
4. **收口不等于自动重试。** 原取消一旦收口仍为取消。若允许用户重新执行同一 Task，需显式动作复用 claim owner 创建新的 Attempt/Run，关联旧取消事实并重新执行当前授权/资格检查；不能把原 Run 改回 running。此项尚无现成入口，需明确最小重试语义后再施工，本记录不把它扩为任意失败/crash 自动恢复。
5. **UI 先如实解释。** 原 Task/Run 应显示“已请求取消；执行尚未进入 Kernel，取消收口待处理”，保留原记录入口。不要仅显示 running 或提供必然无效的普通继续，更不要暗示重新打开项目会解除。Host 正常退出为何对未进入工作提交 cancel 的策略另需明确，不能靠改退出策略追溯抹掉本次事实。

本项不要求扩展到任意崩溃、已进入的未知副作用、通用自动重试或角色调度。后续若施工，只验真实公开 claim → 准备拒绝 → 原 cancel → 准入前收口的窄路径及其与准入竞争/原回执重放边界；本轮不启动该施工。

## 本批另外保留的限制

- 第二个隔离目标的 Work 在首次 provider 调用前被原本机 100K 累计额度拒绝，记录为 crashed；正常新 claim 默认已提高到有限 1M，但不篡改原 Run 固定预算，也未凭新目标成功宣称旧失败的同 Task 新 Attempt 重试完成。
- 当前 UI 主对话按项目恢复一个当前 Goal；已有 Goal 下的新目标切换/显式重试仍需明确产品入口，本次不通过隐藏 API 或改库构造。
- 本机用户级 systemd 启动环境的 bubblewrap 网络命名空间 canary 失败；同一程序在普通终端启动时 canary 和正式检查可运行。没有关闭网络隔离、切宿主 shell 或放宽沙箱；当前 44797 由终端进程提供，不承诺开机自启。部署环境沙箱可用性需单独解决。
