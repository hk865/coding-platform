# 整批开工材料：协作通信、小记忆与人的决定回流

当前状态（2026-09-13）：CM-1A-001 的 snap-04 已由另一Agent独立判定 A01–A12 PASS，Gate A在1A工程范围成立；见产品 evidence/collaboration-memory/CM-1A-001/acceptance/CM1A-001-snap-04/gate-a-01/acceptance.md。CM-M06-001 snap-01 已独立 PASS（release-log R-16，318 文件/2145 用例全量通过）；1B 的 CM1B-001-snap-01 已独立通过 Gate B（R-17，322 文件/2156 用例全量通过）；冻结结束，1C 已由 /root 开始实施，M01–M05/I01–I04继续按依赖推进。后续新源码不自动继承旧PASS。

以下保留准备阶段的开工说明：**整批近期实施包已准备。** 覆盖 1A、1B、1C、入口迁移、集成与回归验收。只有 1A 现在生成正式 Ticket；后续票在执行阶段由统筹者按实际证据自主细化并持续推进，首票完成不是整批完成。本轮只改准备文档，不修改产品代码、不启动实施、不提交或推送 Git；交付后由用户选择实施统筹 Agent，另一 Agent 独立验收。

## 1. 从哪里开始

| 使用者 | 入口与任务 |
| --- | --- |
| 用户选择实施统筹 Agent（默认入口） | 将本页、[MAIN-AGENT-PROMPT](MAIN-AGENT-PROMPT.md)、[PLAN](PLAN.md) §7/§10.1 与 [CM-1A-001](CM-1A-001.md) 交给它；统筹者可兼任实施并按票串行推进整批 |
| 统筹者派发单张票 | 用 [IMPLEMENTATION-PROMPT](IMPLEMENTATION-PROMPT.md) 加正式 Ticket；首条纵向只有一名实施 owner，交验后回到统筹者推进下一段 |
| 独立验收 Agent | 用 [ACCEPTANCE-PROMPT](ACCEPTANCE-PROMPT.md)，并接收正式 Ticket 与下述实施交付包 |
| 核对输入/换工具或机器 | 读 [BASELINE](BASELINE.md) 与其基线附件；保持必要未提交代码，不能从干净 HEAD 忽略既存增量 |
| 核对产品范围与放票 | 读 [PLAN](PLAN.md) 0.1、当前阶段与 §10–11，以及 [READINESS](READINESS.md) |

这些文件不要求特定产品的任务、子代理 API 或原会话。无子代理能力时，同一 Agent 兼任统筹／实施按票串行工作，通过文件交给另一 Agent 独立验收。工具不能主动派发验收时可以输出检查点请用户转交；等待的是独立证据，不是重新申请 1B/1C 的产品范围批准。

用户选定实施统筹者后，可直接发送：

> 请读取 D:/1.project/Software/agent_learn/agent_dev/agent_platform/dev_docs/planning/active/collaboration-memory/HANDOFF.md 和 MAIN-AGENT-PROMPT.md，承担本批近期范围的实施统筹。按 PLAN §7 路线和 §10.1 验收映射，从正式 CM-1A-001 开始；前置证据成立后自主细化后续 Ticket，持续推进 1B、1C、入口迁移、集成和回归验收。第一条纵向路径保持一名实施负责人，尚未验证的共享接口不横向拆派；无子代理时按票串行完成。每票按 IMPLEMENTATION-PROMPT 交付可识别快照和证据，交另一 Agent 按 ACCEPTANCE-PROMPT 独立验收；有缺陷则修复后交新快照重验。1A 完成不代表整批完成；正常拆票和技术细化无需再次请求我批准，新的产品取舍或权限需求才上报。保留已有未提交改动，不提交或推送 Git。整批全部近期结果在最终集成快照上独立验收通过后交付；若需我转交外部验收，给出明确检查点和剩余项，不冒充整批完成。

这段是给用户以后发送的指派材料，不是本轮已经发生的授权或派发。

## 2. 完整路线与首票边界

CM-1A-001 贯通 Work 定向请求/订阅/all-wait、持久领取与路由、唯一后继 Attempt/Run/outbox、Context/实际模型输入，以及并发、取消、unknown 和中断恢复。D01–D05 是开写前的技术收敛，A01–A12 是本票验收；共享契约保持一个实现 owner，不按 CM 分组横向派发。

完整依赖、消费者和阶段验收的唯一正文在 [PLAN §7](PLAN.md#7-整批近期实施路线依赖与交付)，覆盖关系在 [PLAN §10.1](PLAN.md#101-整批路线与验收映射)：

| 路段 | 后续必交结果 |
| --- | --- |
| 1A / A01–A12 | 首张正式票与 Gate A 技术证据；只做 all-wait，不是通信全量或整批 PASS |
| 1B / B01–B05 | 小记忆／开源适配、单用户两项目、主界面接话／解释／反馈、运行中局部经验和最小维护 UI |
| 1C / C01–C04 | 四种人的架构决定、精确影响集、全部 Work 的回流／采用／失败、真实前端 |
| 入口迁移 / M01–M06 | ordinary/parallel、Query、Reviewer/Handoff、规划/Rework、Host queues/取消/恢复，以及 any-wait 和首票剩余通信 |
| 整批集成 / I01–I04 | 同一用户场景、跨入口/旧数据回归、当前构建/浏览器/真实模型分层证据、最终快照独立验收 |

当前沿用的产品范围唯一正文为 PLAN 0.1：

- 记忆保存后的下一相关回话可用，包括同 Task 后续 Run；不要求新 Task。明确记住/纠正直接保存或更新。
- 单用户、多项目：用户记忆随行，项目记忆默认隔离，经允许继承选定内容；无需账户系统。
- 近期只做少量偏好、项目习惯和有来源局部经验，优先复用已有开源调查单位。
- 结构化知识库、自动画像、复杂后台提炼、自动 Skill 演化与第二领域完整验证延期。
- 人的架构决定保留接受/修改/拒绝/延后，前端展示全部受影响工作的回流与采用。

记忆与完整人的决定消费者属于 1B/1C，不塞进首票。已验证独立部分先释放，未稳定的跨模块路径仍由纵向 owner 收口；B/C 不作为全局总锁，但属于整批必须完成范围。只建立一张正式票是为让后续拆票依赖真实证据，不是将后续范围留待重新授权。

## 3. 实施者完成后交什么

按正式票 ID 分目录，统筹者另保留整批索引／最终集成包，交接时给出绝对路径。推荐结构如下；这是未来格式，本轮没有创建或预填实现 PASS：

```text
产品 evidence/collaboration-memory/
  <ticket-id>/                         # 首票 CM-1A-001；以后用正式票 ID
    implementation/<snapshot-id>/
      handoff.md
      source-snapshot.json
      baseline-to-delivery.patch
      added-files/ 或等价内容附件
      decision-log.md
      verification.md
      logs/ 与重跑样例/数据说明
    acceptance/<snapshot-id>/<run-id>/
      acceptance.md
      defects.md
      source-snapshot.json
      logs/ 与独立测试说明
  batch/
    coverage.md                       # PLAN 近期项、实际票、当前证据/缺陷/剩余项
    release-log.md                    # 放票/owner/依赖快照/Gate 与技术裁决
    implementation/<integrated-snapshot-id>/
      handoff.md + source-snapshot.json + batch-diff/新增内容
      coverage.md + migration-inventory.md + verification.md
      recovery-and-handoff.md + logs/重跑入口
    acceptance/<integrated-snapshot-id>/<run-id>/
      acceptance.md + coverage.md + defects.md + source-snapshot.json + logs/
```

实施 handoff 至少回答：

1. 做了什么：本票行为、生产者→消费者调用路径、Control/Ledger 权威、旧入口复用/替代及仍未实现范围。
2. 改了什么：本票采用基线→交付差异、新增/删除文件内容和清单、用户原有改动的保留/重叠说明；后续票还要引用前票集成输入，整批交准备基线→最终集成差异。不把混合的 git diff HEAD 全部算作本批新成果。
3. 依赖什么：两仓 HEAD、源码/测试/配置快照及文件清单、上游文档摘要、实际 Gate、技术裁决（首票 D01–D05）与正式 Interface 同步位置。
4. 怎样重跑：实际 cwd、Node/包管理器/OS、构建命令与产物来源、测试命令、夹具/数据库准备、退出码、原始失败与修复日志；不能只给测试数量。
5. 证明到哪里：本票适用 Acceptance／PLAN 映射逐项结果（首票 A01–A12，后续票引用 B/C/M/I 与 V）；确定性流程、真实内核、真实模型分别说明，未运行/未验证保留。整批还须覆盖 PLAN §10.1 全部近期项及最终集成回归。
6. 怎样接手：数据兼容/迁移/恢复注意点、未解决问题、阻断范围、重现步骤、可释放与不可释放的部分。

实施者交付状态为“待独立验收”。然后停止该源码快照的写入，把三项入口（本票、ACCEPTANCE-PROMPT、handoff/证据绝对路径）交给独立验收者。仅发送“做完了”或整个聊天记录不构成移交。

单票验收结论回到统筹者：据证据放下一张就绪票或修复缺陷，持续维护 coverage；未依赖该结论的工作可安全继续。整批收口时对一个最终集成快照验 I01–I04，快照内冻结一份 coverage／迁移清单。早期各票的 PASS 不能替代后续源码变化后的集成验收。

验收者独立记录源码快照、适用性矩阵、复现日志与缺陷。每个缺陷绑定 ID、Ticket/Acceptance/PLAN 编号、快照、源码位置、预期/实际和复现条件；交回实施 owner。修复后交新 snapshot 与影响说明，独立重验并保留旧记录。源码变化不能沿用旧 PASS。

## 4. 上游、基线与交接责任

- 设计来源：[PLAN](PLAN.md)、[调用链证据](CURRENT-CALLCHAIN-EVIDENCE.md)、[记忆复用证据](MEMORY-REUSE-EVIDENCE.md)。仅发现实际冲突时重新读取相关源码/原始讨论，不重新全量调查。
- 内容版本：[upstream-documents.json](baseline/upstream-documents.json) 记录本实施包与直接规范/工具配置的摘要；准备前差异与重建方法见 BASELINE。
- 唯一写 owner：当前待用户选择。并行工作只能是有界只读调查、失败场景设计和独立审阅，直到对应接口的 Gate 证据允许分票。
- 技术裁决：正常细化由 owner/统筹者完成并留痕；新的产品选择或授权需求才给用户具体问题。工具不支持子代理不是技术 blocker。
- 放票与状态：统筹者依据当前证据自主细化下一票并推进整批，独立验收者提供结论；产品运行 Task/Goal 的完成仍归 Control，不混同开发流程。缺少子代理只改变执行方式，不取消后续范围。

## 5. 当前阻断与本轮变更

没有已知必须先由用户裁决的产品/架构阻断；用户尚未选择实施 Agent，本轮在此停止。环境只做存在/版本核对，D01–D05 与运行 preflight 由未来实施者完成；失败时再如实登记相关验证阻断。未定字段、未完成 1B/1C 和延期能力不作为当前开工前置。

首版准备已建立三个 Prompt、CM-1A-001、HANDOFF、BASELINE 和基线附件。本次按最新纠正补全 PLAN 整批路线／依赖／验收映射，同步三个 Prompt、首票交接、READINESS 和基线使用说明，更新上游摘要；原始准备基线附件不改写。原始对话、两份调查证据、正式规范、产品源码与原有未提交改动保持。

本轮检查结果另见 [PREPARATION-CHECKS](PREPARATION-CHECKS.md)。文档结构、补丁校验和独立准备审阅不等于产品代码、并发恢复或模型行为已经通过。

