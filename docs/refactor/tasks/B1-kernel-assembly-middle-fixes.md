# B1 骨架中审返修（仍不实现）

原任务与全部设计约束继续有效。主审已核对真实 Kernel 测试路线、4 文件范围及旧路径兼容；以下点修好之后再次停下交主审，不进入实现。仍仅原 scope 4 文件。

1. `runObservedModel` 骨架对显式传入尚未实现的 skills、controlHooks 或 frozen.first_use，在首次 await 前抛 `code: 'unsupported'`；未传新能力的旧路径保持不变。不能静默忽略暂停 Hook 后执行模型。工具 resolver 的明确 unsupported 保留。
2. 保持约 5–6 个用例，强化现有用例即可。first_use 测试用受控 Promise 挂起 open，证明同时的工具调用共享它；至少一条取消/排空路径证明运行结束等待挂起工具、随后 resolve 的 access 仍恰关闭一次。不要用虚构 Kernel 或新的生产控制 API 暴露内部状态。查已有 source-tool-lifecycle 测试的真实入口复用方式。
3. lazy-open 失败测试除同轮两个调用，还在下一模型轮再次调用，factory 总计一次，错误作为真正 tool result 可观察。Kernel 可以把工具失败转为 error 后继续，不要求整次 Run 抛异常。
4. before_model 测试同时覆盖 hooks 数组以及 metadata/execute 函数引用在首次 await 前快照。Hook 是可信对象，捕获函数引用时保留 this 语义；不用 JSON 克隆函数，不承诺冻结回调内部闭包。测试不要依靠真实计时竞速。
5. barrier 测试必须在 finally release 并 await/drain pending，即使断言失败也关闭真实 Kernel/SQLite；所有新增 deferred 同样遵守。失败时不能留下挂起执行。
6. first_use 成功测试给真实 WorkspaceTools 接口方法加可观察 spy/局部结果；断言 captureSourceChanges 真被调用、返回结果或失败 payload 真进入模型的 tool history，不能只验证 open/close 次数。source 方法可使用受信 fixture，但模型循环与 Kernel 必须真实。
7. 修正注释：eager factory 失败会结束调用；lazy factory 失败可由工具返回 error 后让 Kernel 继续。不要声称两种模式全部失败都结束 Run。

跑类型检查及单文件测试一次；红因应是明确 unsupported（不是导入/语法错误）。交付修改摘要、具体断言映射与实际输出，然后停止。
