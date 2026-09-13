# 实施准备检查记录

检查对象：本目录实施准备包；日期：2026-09-12。§1–4 保留首版准备检查（源码核对 15:00:46.376Z → 15:19:24.152Z）；§5 是用户要求覆盖整批后的本次复核，时间均为 UTC。本页仅为文档准备证据，不是 1A/1B/1C 或整批的实现／验收 PASS；全部仍未开工。

## 1. 已执行的静态检查

| 检查 | 实际结果 | 证明边界 |
| --- | --- | --- |
| 文档治理命令 | `node dev_docs/verification/validate-docs.mjs`，WSL 文档根，退出 0，13/13 | 本仓脚本所覆盖的链接、状态与静态 DAG/治理规则；不验证产品运行 |
| 四份基线补丁 | 在各自当前仓运行 `git -c core.longpaths=true -c core.quotepath=false apply --reverse --check -- <补丁绝对路径>`；四次退出 0 | 补丁与当前已有内容相符；没有应用补丁或重建运行 |
| 补丁摘要 | 四个原始文件 SHA-256 与 preparation-baseline.json 一致 | 基线附件未被截断/漂移 |
| 上游版本 | upstream-documents.json 的 51 个条目逐项重算 raw SHA-256，0 不一致 | 文档与直接输入版本可识别，不表示候选接口已成立 |
| Ticket 信封与编号 | 6 个必需信封字段均存在；A01–A12 共 12 项唯一，D01–D05 共 5 项唯一 | 静态字段/编号检查；不替代票内语义与运行验证 |
| 工具无关性抽查 | 三个 Prompt 无专有工具 API 调用；独立准备审阅确认串行/文件交接路径 | 不意味着所有第三方工具环境已部署 |
| 空白检查 | 本轮主要准备正文无行尾空格/Tab 命中 | 文本清洁，不代表架构验证 |

文档治理输出：

```text
PASS  current Markdown local links resolve
PASS  route stubs are superseded and route-only
PASS  P0 and P1 document status guards hold
PASS  Architecture ModuleDependencyDAG is parseable and acyclic
PASS  P1 ticket metadata matches an acyclic Mermaid DAG
PASS  P1 artifact provenance is closed and outputs are unique
PASS  release_gates and mvp_waits_for are aligned
PASS  P0-01 archive payload SHA-256 digests match
PASS  completed P0-01..05 tickets have resolvable evidence_refs
PASS  no patch backup artifacts remain
PASS  module registry routes cover dependency graph
PASS  G3 requires the complete role collaboration slice
PASS  Context continuity and completed-work inheritance gate coverage
Documentation validation: 13/13 checks passed.
```

## 2. 用户现存工作保留核对

产品 HEAD、status 与准备前相同；26 个已跟踪改动、5 个未跟踪文件的逐文件 SHA-256 均未变化。1200 个输入文件的源码指纹仍为：

```text
sha256:1055474c3cabe50d6c5a2630eba4dc2983c306b6f67ca713ef16c62a03afb7a6
```

文档 HEAD 未变；既存五个已跟踪规范/状态文件、原始对话等本目录外来源、CURRENT-CALLCHAIN-EVIDENCE 与 MEMORY-REUSE-EVIDENCE 的摘要均未变化。实际准备修改只在本 collaboration-memory 目录。

本轮没有修改产品源码、运行功能测试/模型调用、安装依赖、构建产品、提交或推送 Git。BASELINE 中的版本命令仅做工具存在与版本核对；真实隔离能力未运行验证。

## 3. 独立准备审阅与修正

另一只读 Agent 核对了三个 Prompt、首票、交接入口和基线说明，审阅工具无关性、范围、真实消费者/恢复要求、单 owner、源码快照与独立验收。

发现并修正 **1 项**：平台 Runtime 与若干测试引用 vendor/coding-agent/dist/public-api.js，旧命令顺序先平台 typecheck、后 kernel:build，隔离副本可能缺少 dist 或使用旧声明。[BASELINE §4](BASELINE.md) 已改为先构建内核，再做平台类型/测试，并明确内核公共 API 变化后重新构建。

其余指定维度未发现实质准备问题。这个审阅没有运行产品，不是 Gate A 通过，更不是整批验收。源码恢复、并发及实际模型行为仍由未来实现/独立验收提供证据。

writing-for-agents 的组织方式用于本轮 Prompt：流程职责与产品正文分开，Prompt 引用 PLAN 的范围和 Ticket 的适用 Acceptance，并把文件交接/停止条件写明；没有修改 AGENTS 或新增并行入口。

## 4. 交付与停点

交付入口为 [HANDOFF](HANDOFF.md)，正式首票为 [CM-1A-001](CM-1A-001.md)。当前没有已知必须先由用户裁决的产品/架构阻断；用户选择并明确指派实施 Agent 后，实施者先做 D01–D05 与环境 preflight。

准备回合在实施包交付停止，不自动开始产品实现。候选字段不因文档检查变成冻结 wire schema。执行阶段的最新整批推进边界见下一节；1B/1C 是近期必交，与延期项分开。

## 5. 整批路线补全：本次复核

用户最新要求：本包覆盖 1A/1B/1C、入口迁移与集成回归；1A 只建立第一张正式票，执行统筹者自主细化后续票并持续推进整批，正常拆票不再请求范围批准。当前回合仍仅准备，不实施。

本次修改 PLAN §7 的完整路线／依赖／B/C 消费者与候选接口、§10.1 全部验收映射；同步 READINESS、三个 Prompt、首票交接、HANDOFF 和 BASELINE 使用说明，并重算 upstream-documents.json。仅在本目录修改 10 个现有文件，没有另建平行入口或提前生成全部后续 Ticket。

### 实际检查

| 检查 | 本次结果与边界 |
| --- | --- |
| 文档治理 | WSL 文档根执行 `node dev_docs/verification/validate-docs.mjs`，退出 0，13/13；仅静态治理 |
| 覆盖编号／信封 | 只读脚本核对 B01–B05、C01–C04、M01–M06、I01–I04 共 19 个唯一阶段结果；§10.1 的 V01–V22 全部有映射；首票 A01–A12、D01–D05 与六个派发字段齐全。编号齐全不等于语义或运行成立 |
| 旧停点与工具约束 | MAIN/HANDOFF 已移除默认“只授权首票、1A 完成就停止”；三个 Prompt 无专有工具调用。单票交验、统筹推进、外部验收等待与整批关闭分别表述 |
| 版本摘要 | 刷新并逐项校验 51 个上游文件 raw SHA-256，0 不一致；原始 preparation-baseline.json 与四份补丁不重写 |
| 补丁与原始基线 | 四份补丁摘要与原始准备元数据一致；在对应仓再次运行反向 `git apply --reverse --check`，四次退出 0；仅校验，没有应用 |
| 空白与改动范围 | 八份实施正文无尾随空格／Tab；限定目录 `git diff --check` 无错误。该目录多为未跟踪文件，另按实际文件内容／摘要核对，不以空 diff 代表已检查正文 |
| 独立只读审阅 | 另一 Agent 核对全批范围、依赖／单 owner、工具无关、验收与快照交接，未发现实质问题；未改文件、未跑产品测试或构建 |

源码保留核对区间：2026-09-12T15:39:49.245Z → 2026-09-12T15:52:54.448Z。产品两端 HEAD、status、26 个已跟踪改动／5 个未跟踪文件摘要完全相同；1200 个源码输入的指纹仍与原始准备基线一致：

```text
sha256:1055474c3cabe50d6c5a2630eba4dc2983c306b6f67ca713ef16c62a03afb7a6
```

文档 HEAD、五个既有规范／状态改动、本目录外原始来源、两份调查证据均未变化。原始基线附件保留，最新实施正文由更新后的 manifest 标识；本页与 manifest 自身不纳入其输入，避免自引用。

writing-for-agents 用于统一范围正文与角色完成条件：PLAN 保存全批路线／标准，Prompt 负责执行流程；单票实施者回交，统筹者继续，整批由独立验收确认。没有将准备审阅冒充产品架构、模型效果或 Gate 通过。

当前没有已知必须先由用户裁决的开工阻断。由用户选择并指派实施统筹者后，从 CM-1A-001 开始，按证据推进 B/C/M/I；真实环境与必要技术裁决在相应阶段完成。本次交付后停止，没有产品代码修改、功能测试／模型调用、安装、构建、提交或推送。
