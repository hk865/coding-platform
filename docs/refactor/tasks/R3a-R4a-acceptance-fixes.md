# dsh 返修任务：R3a / R4a 独立验收缺陷

日期：2026-09-23；2026-09-24 执行更新：**Sol 骨架 / 契约测试与 dsh 并行返修已完成，主 Agent 独立验收通过。** [最终报告](../reviews/R3a-R4a-sol-dsh-acceptance.md)。 本文保留修复要求，实际更窄的文件权限和运行方式见 [执行环境](../DSH-EXECUTION-HARNESS.md)及两份 Sol 交接。主 Agent 负责契约和独立验收，dsh 完成生产修复及自己的必要回归；不要改写独立测试以取得通过。

## 1. 目的与依据

在现有 R3a / R4a 实现上修复四类已证实缺陷，并补真实旧库的指定兼容证据。保持已定五模块 / 八边目标，复用原数据结构、原子提交、Session 事件归约和恢复机制。不要重做 Prompt 5、增加 DataEngine、替换 SQLite、扩建一般事务框架或提前启动 R4b/c/p。

工作区 `W=/home/hyh001/projects/coding-platform`；代码 `C=W/coding-platform`；文档 `N=W/docs/refactor`；Kernel `K=C/vendor/coding-agent`。先核对实际工作树并保留全部已有未提交改动。不得 reset / restore / clean / stash / stage / commit / push，不安装依赖，不访问真实模型凭据、不启动付费模型测试。

按需共同阅读：N/HANDOFF.md、W/docs/PRODUCT.md、N/ARCHITECTURE.md、N/intent/ORIGINAL-DIALOGUE.md 的相关原话及并行补充；本批直接施工依据是：

- [独立验收报告](../reviews/R3a-R4a-independent-acceptance.md)：四项缺陷、真实所有权图、运行证据与限制。
- [R3a 原契约](R3a-goal-record-store.md) §5–8；[RecordStore](../modules/core/record-store.md)、[WorkGraph](../modules/core/work-graph.md) 相关章节。
- [AgentRuntime](../modules/core/agent-runtime.md) §6；K/AGENTS.md 与 K/INTEGRATION.md。
- [冻结测试与证据](../reviews/evidence/r3a-r4a-2026-09-23/README.md)。

## 2. 并行范围与文件所有者

| 执行者 | 实现范围 | 不得修改 |
| --- | --- | --- |
| A：R3a 数据与受理 | C/src/core/record-store、C/src/core/work-graph；必要的自身回归；临时旧库兼容验证 | Kernel、Workspace、其他 Agent 文件和冻结独立测试 |
| K：R4a 身份与恢复 | K/src 内公共组合根、恢复、必要持久快照 / codec；K/INTEGRATION.md；自身回归 | 平台 Store / WG / Workspace 和冻结独立测试 |
| Lead | 核对共享契约变化、任务进度、最终集成检查和报告；有必要时同步受影响的精确接口文档 | 不重复实现两条生产路径；不把自检通过标为主 Agent 验收 |

A 与 K 可同时开始。只运行各自相关测试；构建产物 / shared dist / 全量检查由 Lead 协调，避免并发覆盖。若 session 没有 Agent Teams 工具，照实说明并使用实际具备的独立 session / subagent 并行能力；不得声称使用不存在的团队工具。文件范围发生交叉先交接具体文件，不能互相覆盖。

## 3. A 的精确修复要求

### A1：事务内记录守卫

SQLite 与 Memory 的 `currentRevisionOf` 不能只读取数字 revision。每个参与 guard 的已存对象必须在原子提交段核对合法 schema、正文 ref 与 canonical key，以及所需机械字段，再做 CAS；未知 / 损坏 / 不一致值返回 corrupt，写入保持零变化。复用已存在的 Store codec / registry，不让 Store import WG，不在 Store 重写 Goal 业务规则。

保持原顺序和兼容：合法幂等重放优先恢复原 receipt，scope 后续变化不使旧提交重放失败；null 与真实 revision0 的含义不能混同；不能为每个提交复制全历史。禁止在事务外读一次合法记录后省略事务内最后校验。

冻结两后端反例已证明问题，修复后必须同时通过。另由实现方补必要回归，核对 schema 不合法、合法 Goal revision2+、完整身份不一致；不添加与实现逐行对应的冗余测试。

### A2：输入隔离

`cloneInput` 失败后不能返回原引用继续异步处理。可通过提取已定义字段形成独立合法值，或在副作用前明确拒绝无法接受的输入；保留现有正常 JSON 命令兼容。不要用 JSON stringify 静默丢弃值、吞异常或改变幂等规范作为通用替代。

首次 await 之后所有身份、fingerprint、scope、目标和 payload 都应来自同一份调用时值。测试中的额外函数字段只用于触发克隆失败，报告不要夸大为普通 HTTP 权限漏洞。

### A3：真实旧 writer 兼容证据

复用已有 RAT-03 历史库证据入口，在临时复制库上验证 R3a §8.7：旧 refs / events / receipt 可读；通过新 WG 以原命令身份与原内容重放，返回原 Goal@1 / 原 cursor / eventIds，零新事件；再提交一个合法新 Goal，关闭重开后序列与幂等结果连续。保留旧库 hash，不在原 evidence 文件上建 trigger 或写入。

已有 historical-ledger / historical-host 用例证明了一部分兼容。新 backend 自己写入再 reopen 的 selfcheck 不能替代旧 writer 证据。新增测试另起 selfcheck 文件，不覆盖主 Agent 文件；报告给出 fixture 的真实来源和验证边界，等待独立复核。

## 4. K 的精确修复要求

### K1：执行身份决定恢复目标

当 runCodingAgent 命中已存在的 executionIdentity，之后的状态投影 / 恢复必须保持该 runId 与 turnId。不能丢弃目标再调用只会选择最新 Turn 的 resume。完成 A、再完成 B、最后重放 A：结果必须仍为 A，不调用模型，不新增 Turn，不更改 B。

复用 Kernel 原记录与归约逻辑。优先给内部共享恢复函数传明确目标，避免仅为内部调用扩大公开 API；确需公共 / 持久协议变化时在报告与对应接口文档明示原因和兼容性，不让平台导入私有路径。保持未显式指定旧身份的原 CLI resume 语义。

### K2：恢复执行前保留并核对原约束

paused 现在会实际进入 runner.resume，必须纳入真正继续执行前的环境兼容检查。有效预算上限、已用计数、沙箱 / 授权约束、原配置与历史 basis 在恢复前能被核对，不能由本次省略参数或提高限制悄悄放宽。

冻结用例：maxModelRequests1 暂停后传4必须在新增模型调用前明确拒绝；原 forbidden private 路径在省略 workspaceOptions 后，必须明确拒绝恢复或沿用原限制使 read 失败。相同约束的正常暂停恢复要继续通过。

需要持久保存的原有效约束应在现有 turn / checkpoint 机制内表达，并同步 strict schema / codec / checksum 与旧记录兼容。不在平台另造恢复权限表，不保存密钥，不仅保存不可重建的摘要并声称已恢复。对旧记录缺少额外约束字段的情形，明确哪些旧语义可恢复、哪些因无法证明约束而拒绝；不得改写历史正文来“补齐”证据。

ProcessSandbox / 工具授权等共用恢复入口同样审查，但只报告实际覆盖的范围。保留原 unsupported 能力：after_tool 暂停、block / modify / fail 控制 Hook、native compact 不属于此次补实现范围。原 schemaVersion=1 记录和 checkpoint、默认 current_turn 与随机身份语义继续兼容。

## 5. 测试与交付

主 Agent 冻结文件（hash 见证据 manifest）：

1. C/tests/data/R3a-goal-record-store.test.ts。
2. C/tests/data/R3a-goal-input-isolation.test.ts。
3. K/tests/review/independent-r4a-session-recovery.test.ts。

如果认为断言与明确契约相冲突，先提交最小反例和出处；不要改文件、跳过用例、增加 timeout 或弱化预期。新增自己的测试与这些文件分开。

使用 W/.toolchain/env.sh 的现有 Node 24。A 运行冻结 R3a、自己的回归、tests/core、相关 control / ledger / sqlite-ledger 与历史兼容测试。K 运行冻结 R4a 和完整 Kernel suite、类型与架构检查。Lead 在生产修复结束后运行平台 typecheck / check:architecture / 完整 build，以及实际受影响的 Host / 集成路径；不同写者不要同时 build。

原 scoped 回归曾受并发负载影响；低并发结果和默认并发结果分别报告，不混成一次通过。若失败属于环境，提供每项 suite + test 名、错误栈、初始化 / 正文阶段、原有基线证据和去重计数。不能沿用“14项全部环境”的未经验证结论。

交付报告逐项回答 A1/A2/A3/K1/K2：修改了什么、复用了什么、删掉了什么重复逻辑、实际执行结果、未覆盖情况、公共 / 持久协议差异。附冻结测试 hash 核对、旧库来源、原始日志。注明“待主 Agent 独立验收”，不能自行推进依赖这两批的生产接线或宣布平台已支持连续 Session / 同工作区范围并行。
