# 正常 UI 冷启动接线与双图纠偏 · 2026-09-29

状态：真实新目标正常链已正式完成；双图与多工作区显示恢复已通过本批浏览器复验。此结论不等于整个 MVP 或取消/失败重试验收完成。

## 本批范围

用户从设置打开真实本机目录、选择既有模型，在主对话提交目标。调查沿正式 Query/Kernel 读取源码；显式“形成方案”保存 initial-planning v2 Answer/PlanProposal，主对话显示可读架构、任务、完成策略和检查命令；显式采用才依次提交既有 owner，启动正式 Workflow。普通历史读取与刷新不调用模型。未来无验收节点仍保留 plan_only/deferred。

没有预置 Goal/Session/Plan/policy/baseline，没有固定创建四个成员，也没有按验收任务 ID 写生产分支。测试工程只有五个小文件，实际源码变更必须由 Work Kernel 执行。用户三个候选工程未修改。

## 主要实现与边界

- 复用 Architecture/Policy/InitialPlan owner；Host 保存经用户采用且同 scope、同正式 Answer 精确绑定的 check definitions。每个工作区独立配置，旧检查轮保持其固定配置。
- Query question携带正式当前架构、策略、角色标识，不让 Runtime 新增 records 依赖。Task scope.moduleRef 是字符串，不是 Architecture ModuleRef 对象。
- UI 主对话直接显示形成方案、审阅采用、持续推进反馈。刷新只恢复正式 pendingPlan origin 的 Answer，不从任意历史自动采用。
- 修复主 Session mailbox 引用形状；移除 local Work grant 中不被 Work driver 支持的 project_source 名称（Query read自行装配源工具）。
- local 工作台单响应上限 16384；明确 DeepSeek flash/v4-pro 型号 contextWindow 1M，其他默认128K。这是已知模型配置，不是动态模型能力发现。
- Workflow 对明确未准入、未暂停/取消、无 Kernel 运行事实的 starting Run 可继续原 prepare，不新建 Attempt/Session/Lease。真实 composition 三项通过；取消后不可借此重跑。

## 真实失败必须保留

初轮有 provider_request_failed，诊断没有证明具体网络根因；一次4096输出长度截断；一次模型生成 moduleRef 对象被正式契约拒绝；一次旧128K预算在模型前拒绝；一次不支持的 grant 在 Kernel 前拒绝。均保留原记录，不将最终成功（若取得）写成全批零错误。

此前重启 Host 关闭协作 driver 时，原未准入 Run 收到 queued cancel；当前没有正式未进入取消收口/同 Task 新 Attempt 的完整路径，见 [known-gaps](known-gaps.md)。新目标正常链验收不能冒充该取消恢复通过，不改库解锁。

## 工程检查

Node24；本批主接线五文件44项通过，类型、构建和五模块边界通过；原 Run 续 prepare增量R5c三项通过。原始候选导入与窄修复哈希见本目录 JSON。更早的全量测试快照不作为本批证据。

## 真实验收记录

原隔离工程：`/tmp/coding-platform-coldstart-20260929-k48eshhz`。登记、目标、调查、规划、采用、双图和成员已通过正常浏览器入口；原Run未进入Kernel后被Host关闭取消，源码未修改。

第二隔离工程：`/tmp/coding-platform-coldstart-final-20260929-4qdhz4g5`。原始五文件哈希见 `final-baseline.json`；Work 被旧 100K 累计预算在 provider 前拒绝，未修改文件，失败保留。后续新 local Work 采用有限 1M 累计预算，不重写该旧 Run。

最终隔离工程：`/tmp/coding-platform-coldstart-accepted-20260929-cdh7tmdl`（正常入口验收 · Label report）。从设置登记、主对话目标、调查、形成方案、明确采用进入正式 Work。两个 Work 复用同一 Session，唯一源码变更为 `src/labels.js`；现有测试、report、package、README 哈希不变，无新增/删除文件。两个 Work 与 Goal gate 三轮正式检查均 PASS，三 TaskReduction satisfied，GoalPhase 正式 COMPLETED。未来国际化节点保持 deferred/plan_only。见 `accepted-baseline.json` 与 `live-result.json`。

本工程 10 次模型请求（2 次 Query Run + 2 次 Work Run），无 provider/request failure；曾有 2 次 shell 工具 sandbox_unavailable，不能称零工具错误。用户级服务环境 bwrap 失败后，在正常终端沿同数据库启动原 Host，保留原沙箱，正式检查通过。刷新后原检查轮恢复没有新增模型请求，不新建 Work/Session。

检查恢复按同 Run/Task/Plan 查原轮；待执行接回原检查，executing/interrupted 等待，finalized PASS 续完成判定，非 PASS 不自动重验。相关 R5c 4 项、类型、构建、边界通过；见 `check-resume-import-hashes.json`。双图 4 项检查与实际浏览器节点/固定/详情/滚动核对见 `ui-verification.json`，只验证小图，不宣称大项目性能。


## 显示恢复与收口

显示偏好按工作区独立 key 保存 Goal/active Session/main Session ID，global 仅最后工作区与主题；不存业务事实、凭据或消息正文。恢复通过正式读取，旧单项只迁移其明确 scope。两个浏览器标签页实际验证：A 选原 Goal/成员，B 切另一隔离项目并选成员；A 刷新再切回，原 Session 历史和原 Task 图可直接打开，无需重新输入 Goal ID。该验证没有修改项目文件或新增模型调用。旧版已经被覆盖的选择不会凭猜测重建。

最终显示修复主树 6 项通过、构建通过；候选 Node/UI 类型通过且独审通过。与先前 4 项 UI 集合重合，不相加为 10。整体本批主接线 44 项、工作恢复最终 4 项及 UI 最终 6 项分别记录，不冒充全仓回归。导入见 `scope-preference-import-hashes.json`。

工作台 http://127.0.0.1:44797/workbench/ 当前由正常终端 Host PID 112347 保留运行；用户级 systemd 服务停止，未关闭沙箱，不保证开机自启。产品调用仍 10 次。DSH 各 lane 已 STOP；未提交、未推送。取消/失败重试及其他 MVP 剩余项见 `known-gaps.md`，本批成功不抹掉这些缺口。
