# 真实 DeepSeek 接入验收（2026-09-27）

本轮限定路径通过，验收后按用户要求停止。它不等于整个 MVP 完成，也不代表完整示例 UI 已落地。

真实内置 DeepSeek provider（deepseek-flash，thinking disabled）经生产 Host/Runtime/Kernel 跑 Query→规划采用→两个 Work 同 Session 实际编辑→三次实际行为检查→正式 Goal COMPLETED。最终 12 次模型调用、12 次工具完成、0 模型/工具错误、2 次确认文件写入。检查执行真实保存文件，total=10、doubled=[2,4,6]，三次退出码均 0。真实浏览器读取回执和历史后调用数仍为 12。结果见 [result.json](result.json)，正式快照及原检查报告见 [successful-run](successful-run/)。

生产只改初始规划的模型输出说明，补齐接收端原本要求的嵌套字段和示例；保留严格 JSON parser、原权限 guard、无验收未来意图。先 DSH 测试首红，独立中审，再 DSH 实现及一处 plan_only 原语义补回；精确导入见 [contract-import.json](contract-import.json)。独立相关 4 文件/4 项、Node 类型与构建通过，未扩大完整回归矩阵。旧 124/1,102 快照不自动覆盖本次改动。

三次运行均保留：

- [first-attempt](first-attempt/result.json)：3 次模型调用，源码工具成功，原始回答含导语且猜测嵌套格式，未采用规划。
- [restricted-read-run](restricted-read-run/result.json)：补丁后正式完成，但测试配置只准读 src，模型 read('.') 被正确拒绝一次；没有生产权限缺陷或绕过。
- [successful-run](successful-run/)：将新建玩具工作区的读取范围正确配置为整个临时根，并说明注册检查由 Host 在工作结束后运行，不是工作区文件；再次从原始错误文件真实执行，无模型或工具错误。

可复现 fixture 在 [fixture.mjs](fixture.mjs)：本仓库 Node 24 先构建，再以 `--start --next-root <本仓库绝对路径> --key-file <本机密钥文件绝对路径>` 启动，按其输出 URL 输入目标 r6x-goal 和相同任务。它只初始化临时文件和正式公共 HTTP owner；不伪造 Plan、Run、模型答案、终态或检查结果。fixture 会产生付费模型调用，普通启动和历史读取不会。密钥只在内存使用，不在配置、证据、数据库导出或 Git 中。

Project/Workspace/Goal/Policy/Baseline 初始化通过正式 HTTP owner 完成，本证据不声称全流程都在 UI 初始化。所有写入只在新的 /tmp 玩具项目，未修改三个候选真实工作区。临时 Host 与数据不是已发布产品部署。
