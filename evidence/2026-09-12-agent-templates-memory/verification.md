# 2026-09-12 通用角色模板与工作记忆增量

基线：产品 main 0eb0271；文档 e99484f。用户授权开始实现通用角色、跨工作协作和长期记忆。本次复用原 12 Module。

## 实现范围

- RoleSpec 同角色多个不可改写版本，旧默认版本和幂等键兼容；安装与激活分开，视图保留历史版本。
- 设置中创建命名模板，展示简介/职责/工具上界并激活版本；协调计划可选已登记模板。
- Dispatch 取模板与任务工具授权交集，Runtime 实际只暴露信封授权工具；独立 Reviewer 身份与资格不变。
- 协调 Context 携带当前计划内跨工作指派、依赖和有版本的正式归约依据。
- ExecutionNote 有来源记忆链：创建、更新、废止、重放、竞争写入拒绝；Context 按主题选择并拒绝已替代/废止版本，原授权依旧必要。

## 验证

- 最终全量：302 文件 / 1997 测试全部通过，见 [full-final.log](full-final.log)。
- 浏览器：28 项全部通过，含命名模板创建、第二版安装、激活与刷新持久化，见 [browser.log](browser.log)。浏览器启动前执行完整构建。
- 后端及 UI 类型检查通过，12 Module 依赖边界零问题，见 [types-final.log](types-final.log)、[ui-types.log](ui-types.log)、[boundaries.log](boundaries.log)。
- HTTP 返回的构建资源与磁盘字节一致，见 [served-artifacts.json](served-artifacts.json)。
- 文档检查 13/13 通过，见 [docs-final.log](docs-final.log)。
- 首轮全量出现 1 项旧命令形状兼容失败（默认版本多输出 revision:1），保留 [full-tests.log](full-tests.log)；修正为兼容旧命令形状后，相关 9 项与最终全量通过，见 [compatibility.log](compatibility.log)。
- [源码指纹](source-fingerprint.json)记录本批源码、配置、测试与依赖锁文件的字节摘要。最终检查未出现未记录的源码变化。

真实 HTTP/SQLite/执行内核测试使用明确标记的模型替身。自定义文档角色的职责正文进入模型输入，实际工具列表不含编辑或 Shell；这些测试证明所覆盖流程与工具边界，不证明真实模型质量。记忆生命周期在 Control 和 Context 层验证，未声称已由自动记忆工具完成跨任务产品闭环。

本批代码、文档与证据尚未提交或推送。

## 尚未完成

持续多工作包联合协商与冲突解决的完整闭环；自动记忆提炼工具与产品写入/维护界面；广泛跨任务记忆消费；通用外部工具宿主与真实模型质量评估。当前新增记忆链是基础能力，不能称完整长期记忆产品已完成。
