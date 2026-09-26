# B1 实现：只填经主审冻结的 Kernel 适配接缝

本文件仅在主 Agent 完成骨架/测试中审并创建 implementation lane 后派发。阅读 `B1-kernel-assembly-skeleton.md`、`B1-kernel-assembly-middle-fixes.md`、当前 `IMPLEMENTED-CAPABILITIES.md` 与 Runtime §7.1；冻结测试为 `coding-platform/next/tests/runtime/B1-kernel-assembly.test.ts`，只读。

实现范围只有现有 Runtime 的三个文件：observed-model-run.ts、exploration-tools.ts、project-source-tool.ts。不新增文件、模块、Kernel 修改、数据库、模型循环或旁路授权。复用已有 Kernel hooks/skills、原 project_source 协议、工具组 drain/close 和 RuntimeSourceCaptureAccess。B1 是后续正式 prepare/entry 的现有能力接缝，不代表整个 B 已完成。

实现冻结的 skills/controlHooks 快照与透传、first_use lazy factory、共享 pending/rejected Promise、原工具 dispatch 和 exactly-once cleanup。先验证工具参数、路径及 current 再解析 access。显式 frozen 无论尚未打开还是打开失败都不回落 live project_index。无读取能力或未使用时不打开；默认 before_run 保持旧行为。关闭时先排空工具组再关闭 access；取消与挂起打开的竞争不得泄漏，也不得在关闭后重新打开。Hook 元数据和函数引用捕获于首次 await 前；函数不做 JSON 克隆，保留 this 语义，闭包内部可变性不在本接缝保证范围。

移除本批 unsupported 骨架与尚未实现注释；不得吞 Hook/原业务错误、让模型伪装 Host、改只读测试或硬编码测试标记。factory lazy 失败是工具 error，不强迫整次 Run 抛异常；缓存同一个失败以避免重复准备。

使用已有工具链运行 typecheck 和 B1 专项，再运行相关现有 source-tool-lifecycle、R4c-session-continuity、source-text-loop-migration、tests/app/project-source-tool 回归一次。禁止安装依赖、提交、额外模型/Agent、改变配置。用原地写入，scope 外只读。遇到契约真实不可实现，报告具体源码/冲突，不擅自放宽。

交付：修改与复用符号、实际检查结果、明确剩余；停止交主 Agent 独立审阅。主 Agent 之后执行物理隔离验收，DSH 不自行宣称已验收。
