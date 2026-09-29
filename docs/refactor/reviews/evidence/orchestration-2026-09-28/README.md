# 共同编排机制：实现与验收

本次按已认可的状态/事件/副作用整体实现。AG1–AG5作为观察场景，不形成角色或项目专用状态机。原Session、Run/Attempt、Task、邮箱、控制和图owner继续保存正式事实；Kernel保留唯一模型/工具循环。

当前：共同机制已精确导入，工程检查及隔离工程的真实DeepSeek/浏览器验收通过。实现按状态、事件和已有owner运转；没有AG场景专用生产分支。结论限定于下列已实现路径，**不是整个MVP完成**。详见[最终核验](verification.json)。

## 共同机制与生产入口

| 行为 | 正式入口及事实 | 验证依据 |
| --- | --- | --- |
| 问询与原执行分离 | `consumeConsultation`保存派生来源；Kernel以固定已完成历史边界构造独立A′，原Session可继续 | 真实HTTP/Kernel来源隔离及忙碌源咨询；原始记录保留 |
| 等待真正让出 | `send_session_message`保存独立意图、needsReply、waitAfterSend；Kernel工具组排空后记录`run.yielded`；Runtime记录结果并释放该次占用 | 原Session多个Run/Attempt，正式回复输入事件与最终checks/Goal回执 |
| 不等待及迟到回复 | `readOutbox(senderSession)`沿原消息快照检索；显式Host inputConsumers处理inquiry；旧Work结束后`part=response` Query交付原发送Session | 实际Work结束、Host重开、独立答复、原Session接受response与正式Answer；不重跑Work |
| 通知与真实消费 | 普通消息与回复共用`inputSupply`；Kernel保存`run.input_accepted`；原邮箱观察确认；业务Answer/结果单独证明处理 | 保存、进入上下文、业务结果不合并成一个状态；读失败不宣称确认 |
| 原执行控制 | `controls/submit`、`deliverControl`、`executions/start`；pause/resume保持原Run/Turn，steer在before_model进入原上下文 | 普通start不能解暂停，暂停时steer不唤醒；明确resume后实际模型收到输入 |
| 独立工作并行 | 显式taskId、Session选择；同Goal按Task分别推进，正式owner维持同Session互斥 | 两个真实Kernel provider时间重叠、分别真实写入、checks及Task完成 |
| 机械注意力 | 显式attention配置，文件新增+删除行量、正式双图版本/差量、成员消息；同一输入consumer | 真实Host变化通知→原Session Query/Answer；无变化无新增调用；自身通知不反复触发 |
| 生命周期与UI | 已有archive/reactivate/link入口；工作台按Task选择句柄、查看兄弟任务、原执行控制及原历史 | 相关工程验证与本轮实际浏览器证据分列，不把API通过等同完整视觉交付 |

## 工程证据

- [导入清单](import.json)：100个精确变化文件，先逐项核对主工作树原哈希，保留此前全部未提交改动；[范围检查](scope-final.json)没有越界或主线漂移。
- [统一相关检查](final-checks.log)：15文件134项中131项通过；三个旧AG2用例仍把无意图通知当inquiry，显式迁移fixture后独立3项通过，不修改生产去迎合旧测试。旧失败日志保留；导入后的必要局部复验见下方最终版本。
- [类型](local-types.log)、[构建](local-build.log)、[边界](boundaries.log)、[Kernel逐字再生](kernel-check.json)。Node24及本仓锁文件；不借旧124文件/1102项快照证明本次更改。
- [候选记录](candidate.json)和两份较早审阅保留历史判断。DSH多次未接齐共同接口后被停止，主审与独立子代理在同一候选完成修正；没有把DSH自报PASS当最终验收。

## 真实模型与工作台

最终轮由浏览器选择已有Goal与原builder Session后启动，14次DeepSeek请求、两次只读咨询和实际让出，回复作为持久输入进入原Session的新Run；随后真实修改实现，Work与Goal gate两次正式检查PASS，Goal COMPLETED。不可改的测试与contract保持不变，隔离工程测试从失败变为2项通过。网络、provider和工具错误均为0。[完整证据](live/live.json)、[验收脚本](live/live-harness.ts)、[运行日志](live/live.log)。

[浏览器记录](browser.json)核对正式完成回执、两条回复、原Session原历史及单条完整记录展开；刷新和历史读取后仍为14次请求，没有新增模型调用。测试Host已正常关闭。

此前失败全部保留：[首轮](live/attempt-1/live.json)暴露等待投影与咨询被过早取消，[第二轮](live/attempt-2/review.json)区分两处模型参数错误及目录参数错误提示，[第三轮](live/attempt-3/review.json)暴露根目录`.`与省略prefix的不一致。分别修共用driver和工具契约；没有放宽越界权限或用历史摘要替换原记录。验收脚本去掉同一工具错误在后续历史中的重复计数，保留明确模型参数拒绝与实际执行错误的区分；最终轮本身没有任何工具错误。

## 增量与最终版本

[最终源码哈希](current-source-hashes.json)记录102个改动文件；原100文件导入清单保留当时版本。导入后只修driver与其原用例、目录工具与必要回归四条路径。最终[driver复核](driver-final-review.md)、[目录工具复核](source-tools-final-review.md)及类型/构建已通过。早期失败日志不覆盖。

[行数统计](change-summary.md)：生产src净增2,290行，Kernel手工补丁净增296行；测试、生成物、恢复的既有Kernel源码和文档分列，不混称为新增平台能力。

## 当前边界

- Query仍是只读执行；Work已接原执行pause/resume/steer/cancel，QueryRef没有对应四种公开控制入口。
- Host推进句柄是内存投影。重开可以读取原事实、恢复配置的消息消费者，并由显式Workflow请求定位原yielded Session；不宣称任意进程中断自动恢复运行，未知副作用不会重新执行来猜测。
- 文件关注范围为显式配置的固定文件；没有语义重要性扫描、默认四Agent、自动按代码规模分工或原生压缩。
- 角色使用同一装配与通信机制；正式决定、图/计划采用与实际落实仍沿各自owner。通用治理/Reviewer及完整MVP余项没有被这一轮自动宣告完成。
- 没有提交/推送；旧工程及三个用户候选真实工作区未修改。真实模型只使用隔离临时工程，凭据不进入配置/证据。
