尚不宜原样派发：B 项有 3 项部分解决，修订新增 3 个问题。全程只读，未修改文件，未运行测试、构建、git 或网络操作。

下表“书”指 `.lead-ref/s85-book.md`。Q-01～Q-20 逐项复核 B，类别沿用原审查；Q-21 起是新增问题。

| 编号 | 类别（会出错/冲突/事实错/不清楚/建议） | 书的位置 | 问题 | 依据 | 改法 |
|---|---|---|---|---|---|
| Q-01 | 会出错 | §5.1，S4 文件表 | **B-01 已解决。** 已允许修改资源清单、生成物和三张主模板槽位表。 | 书:230、书:232 | 保留。 |
| Q-02 | 会出错 | §5.1 裁定 2 | **B-02 已解决。** 引用闭包留在通用检查中，生成物一致性放到 CLI 和构建前置检查。符合测试副本不复制生产源码的条件。 | 书:130；`tests/architecture/boundaries.test.ts:21`、`tests/architecture/boundaries.test.ts:34`、`tests/architecture/boundaries.test.ts:58` | 保留。 |
| Q-03 | 冲突 | §4；§5.1 第 46 族、S3 文件表 | **B-03 已解决。** 补齐三类提醒及与 SC 顺序修改的例外，并限定不动分页接缝。 | 书:73、书:118、书:215；`src/core/work-graph/views/context-extensions.ts:122`、`src/core/work-graph/views/context-extensions.ts:132`、`src/core/work-graph/views/context-extensions.ts:176` | 保留。 |
| Q-04 | 不清楚 | §5.1 裁定 3、4 | **B-04 部分解决。** 类型、空槽行为、区间和槽位表所有权已补；但新增的 manifest 类型抄错冻结字段，见 Q-21。 | 书:142、书:159、书:165；`docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md:343` | 按 Q-21 修正。 |
| Q-05 | 不清楚 | §5.1 裁定 6 | **B-05 已解决。** 路径语法、共享 schema 文案来源和仅替换 `.describe` 参数均已明确，交付还要求逐位置映射。 | 书:174；`src/core/agent-runtime/whiteboard-tools.ts:195`、`src/core/agent-runtime/whiteboard-tools.ts:230`、`src/core/agent-runtime/whiteboard-tools.ts:240` | 保留。 |
| Q-06 | 不清楚 | §5.1 裁定 1、7 | **B-06 已解决。** 已要求生成数据保留字面量类型，并保留尾数组的冻结语义、预算用途和单一正文来源。 | 书:126、书:181；`src/contracts/continuation-brief.ts:343`、`src/contracts/continuation-brief.ts:384`、`src/contracts/continuation-brief.ts:442` | 保留；验收时核对实际接线。 |
| Q-07 | 不清楚 | §5.1 裁定 11、S3 内部顺序 | **B-07 已解决。** 每轮唯一资源负责人、先冻结全部键、消费者交文案、最后生成，均已写明。 | 书:200、书:221 | 保留。 |
| Q-08 | 事实错 | §5.1 S3 证明 3；§5.2 字节证明 | **B-08 部分解决。** S3 已区分注册顺序与模型端顺序；但处理表说 D2 也捕获这两处，正文实际只要求 enabled、authorized 和回调返回的名称列表，没有模型客户端的完整工具定义捕获。 | `.lead-ref/book1-handling.md:12`；书:257、书:339；`vendor/coding-agent/dist/tools/registry/tool-registry.js:92` | 给 D2 补上模型客户端完整 `tools` 对照，使正文兑现处理表。 |
| Q-09 | 事实错 | §5.1 盘点更正、S3 证明 1 | **B-09 已解决。** 已明确覆盖盘点笔误，使用实际私有函数名，并限定桥接只在副本中。 | 书:115、书:249、书:92；`src/contracts/continuation-brief.ts:517` | 保留。 |
| Q-10 | 不清楚 | §5.0 规则 4；S3、S4 渲染证明 | **B-10 已解决。** 已区分字符串、数组、对象比较，并明确内联表达式只在副本包装。 | 书:99、书:248、书:251、书:264 | 保留。 |
| Q-11 | 不清楚 | §5.1 S3 证明开头及第 2 项 | **B-11 已解决。** guide 常量字节及追加后的问题输入都要求在 S3 对原基线证明。 | 书:245、书:254；`src/core/agent-runtime/query-preparation.ts:309`、`src/core/agent-runtime/query-preparation.ts:322` | 保留。 |
| Q-12 | 不清楚 | §5.1 S4 证明 2、3 | **B-12 已解决。** 已分开完整返回联合和实际存储边界，后者要求比较原始 manifest 字符串及摘要。 | 书:267、书:273；`src/core/agent-runtime/context-assembler.ts:1944`、`src/core/agent-runtime/query-preparation.ts:360`、`src/core/agent-runtime/query-preparation.ts:366` | 保留；另修 Q-23 的入口误列。 |
| Q-13 | 不清楚 | §5.1 S4 证明 4 | **B-13 已解决。** 已补调用名称、参数、顺序、时钟、既有失败／取消路径及未覆盖读取点的静态对照。 | 书:275 | 保留，不能用输出相等替代这些证据。 |
| Q-14 | 不清楚 | §5.0 规则 3 | **B-14 已解决。** 改为固定不确定输入来源，要求基线重复运行相等，禁止擦除标识和摘要；无法稳定的路径单列。 | 书:95 | 保留。 |
| Q-15 | 不清楚 | §5.2 字节证明 | **B-15 已解决。** 明确包装自然执行的回调、不额外调用工厂；八类场景允许用仓库外驱动补足，回调未执行必须报告。 | 书:342；`src/core/agent-runtime/observed-model-run.ts:317`、`src/core/agent-runtime/observed-model-run.ts:328`、`src/core/agent-runtime/observed-model-run.ts:333` | 保留；交付时填齐每类场景的实际入口和捕获数。 |
| Q-16 | 冲突 | §2 规则 8；§5.0 规则 1 | **B-16 已解决。** 明确使用运行单指定的仓库副本外目录，不再把未提交目录当作仓库外目录。 | 书:55、书:89 | 保留。 |
| Q-17 | 建议 | §5.6 工厂类型 | **B-17 部分解决。** 返回类型、正文检查器签名及具名解码器位置已明确，但新写死的泛型约束不足以调用原编码器，见 Q-22。 | 书:465、书:481；`src/core/work-graph/persistence/event-envelope.ts:4` | 按 Q-22 修正。 |
| Q-18 | 建议 | §5.3～§5.5 字节证明 | **B-18 已解决。** C1 加绑定对照，A6 分开参数适配和判定表达式，C2 明确四个循环逐项举证，不再夸大现有计数覆盖。 | 书:380、书:417、书:442 | 保留。 |
| Q-19 | 建议 | §4 导入方向；§5.2、§5.4 | **B-19 已解决。** 已补导入方向，并保留 Query 准备期权限投影、把 warning 文案安排到 S4。 | 书:77、书:336、书:415 | 保留。 |
| Q-20 | 建议 | §6 | **B-20 已解决。** 已补每轮规模、时限、首夜合并后的日常套件与审查，以及 S4 后全量和规模批。 | 书:506、书:513、书:516 | 保留；这些是安排和估量，不是两晚必定完成的保证。 |
| Q-21 | 冲突 | §5.1 裁定 3，manifest 类型 | **新增：`id` 与冻结规格的 `packId` 冲突。** 按字面实施会冻结出另一种包格式；“按冻结规格 §2”的注释也不成立。 | 书:142；`docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md:343` | 将字段改为 `packId`，资源清单、生成器和消费代码统一使用它；不要兼容两套字段。 |
| Q-22 | 会出错 | §5.6 工厂类型 | **新增：泛型只要求 `eventType`，无法直接转交原编码器。** `encodeEventEnvelope` 还要求 `eventId`、`schemaVersion`、`occurredAt`。照写工厂会类型检查失败；用强制断言绕过则掩盖了错误接口。 | 书:470；`src/core/work-graph/persistence/event-envelope.ts:4`、`src/core/work-graph/persistence/event-envelope.ts:7` | 将约束补为 `{ eventId: string; eventType: string; schemaVersion: number; occurredAt: string }`。同时把书:456 残留的 `EventFormat<T>` 与实际非泛型声明统一。 |
| Q-23 | 事实错 | §5.1 S4 证明 2 的最低测试清单 | **新增：`K3-unknown-call-review-section.test.ts` 不是组装器捕获入口。** 它手工拼布局和 binding，再调用状态校验函数。不能把运行该文件算作捕获了组装器；若逐文件要求非零捕获，会无故卡住证明。 | 书:269、书:271、书:103；`tests/runtime/K3-unknown-call-review-section.test.ts:13`、`tests/runtime/K3-unknown-call-review-section.test.ts:25`、`tests/runtime/K3-unknown-call-review-section.test.ts:63` | 从组装器捕获的最低清单移除，仍可保留为回归检查；用实际到达组装器的用例提供捕获证据，不改该测试。 |

B 已解决 17，部分 3，没解决 0；新：会出错 1，冲突 1，事实错 1，不清楚 0，建议 0