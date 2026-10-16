仅做静态核对；未改文件、运行测试、构建、联网或调用模型。

- F1：已修。复合前缀写 NULL 标记，追赶时移除缓存；同连接、跨连接用例已补。`sqlite-text-scan.ts:273、318`，`SP-text-scan.test.ts:273、293`。
- F2：已修。逐词完成两遍校验，匹配词与评分词分离；四种组合有独立评分预期。`note-read-model.ts:750`，`SP-memory-scoped-find.test.ts:240`。
- F3：已修。scoped all 在读取候选前调用共享续读键校验。`note-read-model.ts:1627`。
- F4：已修，但新增必须改的测试问题。复用接线已补，SP-19 部分分支没有真正验证到。`note-read-model.ts:1463`，`SP-note-reuse.test.ts:92`。
- F5：已修。恢复旧前缀前先清除当前桶，纯模块测试覆盖残留条目。`text-scan.ts:249`，`SP-text-scan-undo.test.ts:18`。
- F6：已修，但新增必须改的测试问题。distinct、独立预期和 LIMIT 回切已补，普通计数的隔离断言被改弱。`SP-literal-type.test.ts:204、210`。
- F7：未修完。固定的 meta 更新 SQL 仍在函数内拼接，漏做常量化。`sqlite-text-scan.ts:287`。

必须补齐：

1. **SP-19 存在空跑。** 三条注记的关系均为空，`neighbors` 得到空集合，`withCheck` 直接返回；撤掉邻居复用接线仍能通过。应通过公开写入口造真实关系并断言返回目标。历史也仅有 v1，`readNote` 未指定版本，尚未覆盖非头版本快照复用。`SP-note-reuse.test.ts:24、92、103、107、109`；`note-read-model.ts:387`。
2. **SP-33 的新增断言缺少区分能力。** W/open、V/closed 各自独占，普通计数即使漏类型过滤仍各为 1；V 的升序 bound=1、降序 bound=2 均保留全集，忽略边界也通过。补跨类型重叠值的普通计数，以及确实排除行的双向边界。`SP-literal-type.test.ts:185、187、204、210`。
3. **F7 漏项。** 将 `next_text_meta` 的固定 UPDATE 提为模块常量，继续经缓存准备；它不随索引表名变化。`sqlite-text-scan.ts:284`。

四条 UNSPECIFIED：

- 包装器扩大到重复 `readMany`：可接受，只统计调用、不读取内容验收。
- 动态表名 SQL 保留模板：可接受，但不能解释上述固定 UPDATE 遗漏。
- `matchedTerms` 使用第一遍规范化词：可接受，符合 F2 裁定。
- 不同文件重复 SP-13 编号：可接受，用文件名区分即可。

改完列出的几处再合入