# S03 双 ReadModel 投影收敛与性能审查

审查对象为内存和 SQLite 两种 ReadModelIndex。原则是共享“事件意味着什么”，保留“怎样在该存储中原子写入和高效查询”。没有引入 Redis，也没有让 SQLite 把全部投影加载进内存。

| 投影职责 | 处理决定 | 共同维护位置／保留差异 |
| --- | --- | --- |
| 已支持事件集合 | 已共享 | `handled-event-types.ts` 的 `Set`；两适配器不再各维护长列表 |
| Work binding、Run link、Execution note、Continuation | 已共享 | `work-context-projection.ts` 计算变更；只有 Run link 读取精确旧 binding，Map／SQL 写入各自保留 |
| Console 运行显示状态、计划矩阵、Evidence 行、Portfolio | 已共享 | `console-projection.ts` 只做纯计算，不读存储 |
| Architecture Inspection 缺少关联时的展示占位 | 已共享 | `architecture-inspection-projection.ts`；只生成展示对象，不生成 canonical 事实 |
| Task verification view | 已共享 | `verification-projection.ts` 统一 Evidence 顺序、PolicyExplanation、Reduction 与 Plan fallback；adapter 只读取自己的行和 Plan snapshot |
| Collaboration | 已共享业务解释 | `collaboration-projection.ts` 返回 proposal／decision／policy／activation 具名变化；Map set 和 SQLite table upsert 各自保留 |
| Material access | 已共享业务解释 | `material-access-projection.ts` 返回授权／撤权的不可变 grant 行；候选筛选与存储查询各自保留 |
| Query | 已共享业务解释 | `query-projection.ts` 返回 job／run／answer-appended 变化；answer 列表追加和事务写入留在 adapter |
| ControlIntent | 已共享业务解释 | `control-intent-projection.ts` 对 intent／ack 做不可变时间线 fold；adapter 只读写自己的时间线容器 |
| Plan-change dispositions | 已共享业务解释 | `plan-change-projection.ts` 统一最新修订、源／目标计划选择和政策解释调用；adapter 注入精确 Map／SQL plan 读取 |
| Reviewer、baseline change、completed-work identity、governance view | 保留已有共享规则 | 分别由既有 projection／merge／view 文件维护，本轮未复制第二套 |
| Goal／Plan／Task／Run／Evidence／Reduction 的写入 | 比较后保留 adapter 写入 | 事件语义一致，但一边更新关联 Map，一边执行带索引的 SQL upsert；验证展示计算已从其中抽出 |
| Workspace lease／integration／patch | 比较后保留 adapter 写入 | SQLite 依赖事务内多表一致性，内存版依赖对象图；Control/Ledger 才是业务权威 |
| Baseline evolution 及其余专用投影写入 | 比较后保留 adapter 写入 | 重复部分与多表事务、对象图更新紧密相连；继续提取需要通用 mutation DSL，反而增加调用方知识和分支 |
| Architecture evolution 无展示行事件 | 两边明确处理且不产行 | handled-event 集说明支持，注释已改为当前行为，避免旧 no-op／lane 说法 |

定向等价报告如下：

- `targeted-structure-retest.json` 覆盖 Console、Work Context、重建／重开与模块归属，共 14 suites、33 tests 全部通过。
- `read-model-detail-retest.json` 覆盖两种 adapter 的材料授权、计划变更和协作详情，共 13 suites、26 tests 全部通过。
- `query-control-restart-retest.json` 覆盖 Query／ControlIntent 集成、SQLite 重启与丢失回执恢复，共 11 suites、13 tests 全部通过。
- `shared-detail-adapter-equivalence.test.ts` 用同一 4 事件协作序列直接比较内存与 SQLite 的最终视图，再关闭／重开 SQLite 复核；还用 SQLite trigger 强制第二次投影写入失败，证明同页第一次写入和 checkpoint 一并回滚。对应定向测试 2 例通过。
- `read-model-final-targeted-retest.json` 汇总共享规则、两 adapter 详情行为、性能证据和模块归属，共 19 suites、38 tests 全部通过；Query／ControlIntent 的 11 suites、13 tests 单列在前述重启报告中。
- 全仓 `tsc --noEmit --pretty false` 为 0 诊断；`read-model-boundaries.json` 的模块边界 `issues` 为空，新增 5 个职责文件已登记到 ReadModelIndex ownership。

收敛测量暴露并修复了一处已有差异：SQLite `materialAccessGrants` 和 `materialAccessCandidates` 原先没有稳定排序，同一事件序列在数据增长后可能与内存 adapter 返回不同顺序。现在 SQL 明确按 `source_cursor` 排序，固定规模测试逐字段比较两边结果。

性能证据分两层：

- `handled-event-benchmark.json` 在 89 个事件种类、100 万次查询下记录原数组线性查找 55.68 ms，共享 `Set.has` 13.11 ms；这是同一进程固定输入的算法对照。
- `shared-projection-benchmark.json` 使用 512 个任务、2000 次计划矩阵计算，记录提取前同算法和提取后共享算法的耗时、吞吐与进程 heap delta。heap delta 会受 GC 影响，只作观察；判定重点是输出相等、共享规则内部存储读取数为 0。
- `read-model-adapter-benchmark.json` 使用 64／256／1024 个 MaterialAccess 事件和临时文件 SQLite，测两 adapter 的整页推进、列表查询和精确候选查询。最新一次结果中，内存推进为 3.05／2.00／11.74 ms，SQLite 推进为 19.33／26.22／58.95 ms；SQLite 列表查询为 0.78／1.61／6.87 ms，精确候选为 0.37／0.82／2.84 ms。相邻小样本受调度噪声影响，1024 规模仍在本次固定输入下正常完成。
- 同一报告用 100,000 次等价材料行算法比较提取前内联计算与共享函数：144.68 ms 对 153.63 ms，输出相同。两者约 6% 的单次进程差值不作为退化判定；adapter 规模曲线和等价性是本轮依据。`read-model-adapter-benchmark-retest.json` 记录该性能测试通过。

SQLite 的筛选、索引和事务仍在 `sqlite-read-model-index.ts`。共享 Work Context 只在 Run link 时读取一个精确 binding；其余本轮新增 helper 不读数据库，Plan-change 只通过 adapter 回调读取最多两个精确计划快照。

性能测试对 `DatabaseSync.prepare` 做 adapter 构造后的调用计数：64／256／1024 事件推进分别为 65／257／1025 次，两个查询各 1 次。构造期 schema／index 和已经准备好的 checkpoint statement 不在此数内；`node:sqlite` 不暴露物理页读取计数，因此没有声称数据库实际读了多少页。该增长提示后续若优化，应先定位每事件 prepare 来源和查询索引，而不是先增加缓存。现有结果没有给出引入 Redis 的理由，因此没有新增缓存失效、撤权传播和缓存不可用语义。
