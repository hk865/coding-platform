# 1B 消费者验证计划

当前为准备材料，不是测试结果。产品源码仍冻结在 M06。

## 持久维护闭环

真实 HumanCollaboration → Control → 内存/SQLite：remember、correct、remove，重复同键回执重放；不同key精确重复正文同适用范围不新增；同key异载荷拒绝；unique旧文匹配歧义拒绝；批量在工作副本验证容量，任何项失败零写。写前故障后重开不能有半条目/成功回执。

独立SQLite两个连接对同collection revision各改不同条目：一方冲突、先提交者不丢；明确重新读取后可提交另一修改。profile初始化双进程争用取得同一持久identity。删除后对旧entry的更新/重复历史导入不能复活；审计和幂等回执不保存已删除全文。

两个真实项目共用profile，独立项目条目互不可见；明确选择源revision复制到另一项目时保留来源且不继承工具权限。未授权复制/源不可读/项目不存在拒绝。项目初始化或重新打开不重置profile。

## 真实输入闭环

采用实际HTTP、SQLite、ContextCompiler、QueryRuntime和捕获ModelClient；首次“全部简洁”保存后新回应包含精确entry revision；纠正为“架构详细，进度简洁”，分别跑接话、架构解释、进度/阻塞反馈，核对用途过滤及最终user input。删除原消息、重开宿主，仍从持久记忆采用当前版本；一次性“这次详细”进入当前指令而不改memory revision。

同Task的后续Run必须检查实际taskId/WorkRef，而非仅另建Query；新输入含新偏好，旧已发送输入/manifest不被改写。进行中的另一个真实Run不因偏好更新被取消或unknown。真正来源变化/ExecutionNote后继或retired则停止经验选入。

公开ExecutionNote导入只接受真实Work及linked Run、当前note版本/source，正式required验收仍不满足。下一规划/进度/交接输入实际含适用经验；失效条件、来源撤销或正式规范冲突后明确排除。

## 浏览器与效果

实际记忆panel在无Task时保存/查看scope、来源和revision；纠正/删除后刷新/重启仍一致，失败不能显示“已保存”。对话入口区分“已保存”和“此回应已采用”，三用途输入证据与UI可见回应对应。真实商业模型样例与确定性stub结果分别记录，不将stub文本当模型质量证明。

上游适配测试针对真实失败：Hermes唯一匹配歧义/容量/读失败不能当空；OpenClaw同正文而来源身份改变必须刷新，次回应不复用旧版本。通知保留固定SHA和MIT正文。

中间只跑相关测试/类型/边界；计划修改收敛后冻结集中全量，再由另一Agent按B01–B05独立验收。
