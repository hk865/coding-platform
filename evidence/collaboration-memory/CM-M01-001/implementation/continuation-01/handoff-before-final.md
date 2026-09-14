# M01 实施进展（尚未独立验收）

输入 C snap02 保留在 adopted-source-snapshot.json。当前 M01 工作检查点 m01-working-checkpoint.json：1296 文件，05e0935ddda2b5d1c8e1e6d09c2d040f78d27e795fd6b1daa53b521e66fa1b33。后续 M02 已在此基础继续写源码；本文件不宣称当前工作树等于该检查点。

已实现：旧 scope 入口复用同一 DispatchEngine；scope 在 limit 前过滤；两种账本共享 outbox 选择规则；SQLite 在解析前过滤派发记录与作用域；RuntimeDispatch 只串行 exact Run 对账；计划入口一次领取所有独立合格工作；同工作区只读重叠、写任务排队，后续 reader 不越过等待 writer；工作台显示 canonical backlog；Host deadline timer 负责再扫描。

组织改善：WorkspaceDrive 删除独立启动与事件消费循环；Host wake 生命周期移入 app/scheduling；积压规则由驱动和工作台共享；清理计划派发中的历史 lane/冻结叙述，并保留确定性 Run 身份和持久协议。

验证：check-08 的类型/UI类型 0，8 文件29用例通过。包括实际 HTTP/operator 与计划只读重叠、第三任务 pending、重复请求和重启不重跑；实际 Runtime/SQLite 两个 writer 先 pending 后顺序完成；返工、旧 scope 与恢复回归。boundary-results-08：模块边界和归属清单通过。build/browser-results-10：构建与真实浏览器通过（browser/pending-reader.png）。09 浏览器失败因为测试加载旧源码页面，10 改为加载构建产物并选择 exact 项目后验证通过。

边界：模型端使用明确测试替身，不是模型质量评估；跨进程租约终审保留，但本次新增 writer 排队证明是同一生产 owner。旧并行跨连接竞争的既有断言需在最后集成快照复核。完整扫描/wake、Reviewer/Handoff 与查询取消由其余 M 票继续收敛。未集中全量、未冻结验收、不得宣称 M01 PASS。
