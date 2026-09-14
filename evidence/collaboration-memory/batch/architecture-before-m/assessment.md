# M01–M05 前的架构检查与实施次序

依据用户本次委托、PLAN §7 的 M01–M05/I01–I04 和已接纳 C snap02。只读源码检查，没有把文件数或行数当作缺陷证明；inventory.json 保存 TypeScript 文件分布和热点。当前源基线 1289 文件/cf2c775c1cebdc296a4deefc42d495f2102c2eaea14a2464c7e605d39febcc95。

## 结论

值得整理，且大模块内部抽象跟不上新增切片的问题确实存在。12 Module 是责任地图，不是只能有一层目录。11/12 目录没有内部 TypeScript 子目录；Control 的 policies/records 已分层，但按技术阶段横切，不代表已经按领域聚合。也不是全库缺乏复用：普通 claim/start、Work 身份、角色矩阵签发、材料许可和内存/SQLite 的共享校验均有真实消费者。

建议顺序：最小整理＋M01 → M02/M03 → M04 → M05 收口 → I01–I04 集成。不要先做全库文件搬家/重命名/总调度框架，也不要等 I04 后再改本来属于 M 的调度和恢复。完成 I04 后可以继续不影响近期交付的深层投影重构；这不豁免本批修改必须保持可读和无重复状态责任。

## 实际热点及处置

| 证据 | 问题判断 | 处置 |
| --- | --- | --- |
| src/control/dispatch-engine：23 个直接 TS 文件；runtime-dispatch.ts:10 的 queue 串行化完整 drive，service.ts:123 又直接 h.drive | 调度入口的职责表达不统一，串行包装与底层有界并发共存；不能仅删除 queue 就认定生产并行已正确 | M01 明确唯一 ordinary outbox owner、公平/积压与跨触发启动；M05 逐个证明队列只剩局部互斥 |
| src/app/service.ts：947 行/86 import；persistent-harness.ts：851 行/90 import，生产 service 直接创建它 | 组合根掌握规划、反馈、Review、架构推进及收尾的顺序，生产装配与测试名称混杂 | M01–M05 触碰时提取有明确职责的内部装配/推进模块；旧测试 facade 作为适配器保留，不让业务继续依赖测试语义 |
| query-drive.ts、reviewer-dispatch.ts、handoff-drive.ts 与 ordinary drive | 机械启动/事实提交/恢复编排分叉，但 QueryJob、Reviewer 输出资格、ReplacementAttempt 是真实不同语义 | M02/M03 共享有证据的机械部分，保留每入口适用资格和结果协议；拒绝万能 executor 类型与授权合并 |
| ledger-validation.ts：3515 行；coordination.ts：3099 行；coordination-drive.ts：1241 行 | 大量规则/通信/等待/分页/接续集中，变更局部性差 | 修改涉及区域时按 participation、routing、wait/resumption 等行为拆内聚实现；当前不整体改账本事务/持久事件名称 |
| read-model-index.ts 3671 行、sqlite-read-model-index.ts 4713 行；applyP108ConsoleLaneA、applyP116ContextLaneB 等 | 两个适配器都包含领域投影和查询逻辑，旧票号命名不表达业务；有分叉风险。未做全库语义克隆检测，不能给“复用率”百分比 | 本批新增 backlog/recovery 投影共享纯规则；无关历史投影在后续单独票中对双适配器等价性验证后收敛 |
| contracts/modules.ts 的宽 ControlEngine，ports.ts/runtime-dispatch.ts 等分散执行接口；依赖有 full ControlEngine 也有 Pick | 全局权威 facade 不等于每个消费者都应看见全部命令；接口按历史票追加 | M 内消费者使用真实需要的能力集合，整理入口命名和恢复结果；不新造几十个单实现转发接口 |

补充核对：workspace-drive.ts 仍有独立的并发 assemble/start/consume 实现，内存与 SQLite 组合根分别构造它和 ordinary DispatchEngine。M01 必须把旧并行入口的去向纳入实际迁移，不只删除 RuntimeDispatch.queue。read-model 旧 Lane 名称以及部分 Module 正文的“未冻结/待 Gate”描述也已滞后于模块状态；按触碰范围同步当前契约，历史验收记录仍保留。

## 应保留的复用与不可错误合并的规则

- role-spec-read.issueMatrixRoleBinding 被 operator/planned 消费，角色绑定规则不是每入口各写一遍。
- ledger-validation 被内存和 SQLite 共用。Control 的业务准入与 Ledger 同事务最终守卫是不同信任位置；不能为减少代码删掉第二道验证。
- Query 只读、Reviewer 资格、普通 Work、handoff replacement 不能因“统一”而强制同一领域对象；共享的是能够保证一致性的机械领取、许可、事实提交/恢复方式。
- canonicalJson/sha256、Work 身份、材料编译和逐请求授权已有复用；需要核对的是消费者使用是否一致，不是新增通用 utils。

## 拆分落点与验收方式

Dispatch 可逐步形成 ordinary、query、review、handoff、coordination、recovery 的内部模块；每个目录对应稳定职责、入口和内部细节，不为目录数量搬文件。Control 的 policies/records 可在后续按业务行为同目录组织，保持唯一 Control 写权威。ReadModel 用纯投影/查询规则配两种存储 adapter；测试应从同一业务接口验证两种实现，不依赖内部方法名。

每次整理须同时做到：旧入口有明确去向；消费者不再重复同一恢复规则；无新状态权威；已有权限/来源/CAS/重放反例保持；文档和文件清单同期更新。中间只跑受影响测试及必要类型/模块边界，计划修改完冻结后集中回归。整批 I03/I04 不拼接历史 PASS 代替实际集成快照。

本检查是架构评估与迁移前准备，不是 M01–M05 已完成或新的 Gate。
