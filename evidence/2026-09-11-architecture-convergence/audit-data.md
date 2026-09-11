# Data Plane 独立审查（AC-DATA）

审查输入为 baseline.json 的产品/文档身份，恢复时再核对 resumed.json 与实际文件；未把旧测试 PASS 当作本次行为证明。读取两根 AGENTS、PRODUCT、ARCHITECTURE、五个 Data Module、state-ledger/runtime-collaboration/context-lifecycle/module-boundaries 相关契约与真实宿主消费者。后续决定的原始用户来源由主 Agent 汇总，本文不以 ADR 的 accepted 标签推导用户授权。

| Module | 当前责任与消费者核对 | 结论 |
| --- | --- | --- |
| StateLedger | Control 提交已构造快照/事件；两个 Adapter 共用提交校验，SQLite BEGIN IMMEDIATE 包含事件、快照、幂等与身份槽；persistent-harness 创建真实 SQLite 宿主 | 新库身份唯一性已有 RC-03 修复；旧库身份槽缺失与内存可变引用仍有 A 类缺口 |
| ArtifactVault | SqliteArtifactVault 复用 ArtifactVault 同一授权规则；material-access-policy 从 ReadModel 找候选，canonical grant/revocation/版本与 WorkspaceReader sourcePin 再核对；探索/Reviewer/工作历史是真实消费者 | 未确认新的跨模块责任偏移；Module 开头“无产品依赖”与 ARCHITECTURE 及自身当前边界矛盾，需要清理现行文档 |
| ReadModelIndex | 事件投影及有界查询；Reviewer 资格复用 ControlPolicyExplanation，工作身份归并复用 Control 的纯选择函数；宿主/Context 都消费实际视图 | 旧双后端投影重复仍是模块内维护债；当前任务不以代码相似强行重写。治理视图外泄由另一个独立审查范围处理 |
| ContextCompiler | WorkRunMaterialCompiler 消费角色规格、canonical工作绑定、WorkContext/CompletedWork 与 Vault；service 注入 WorkspaceSourceIndexReader 后进入正式 Dispatch 材料准备 | 源码适配已归 WorkspaceReader，RC-02 线索已修复；code 取材 I/O 后缺 canonical 复核。主流程已有七个领域步骤，不把约950行本身当偏差 |
| WorkspaceReader | 源码/路径/索引适配；ProjectArchitectureSourceReader 只捕获原生图，SourceGraphContextCompiler 绑定canonical版本与存Vault，避免反向依赖；Runtime实际工具和Context均消费 | role-source-reader 只做一次清单与逐正文读取，未检查读取期间变化；其它来源保留不同覆盖和digest语义，不强行合并 |

| 原要求与出处 | 当前实现位置 | 影响 | 类别 | 必要修复 | 验证证据/建议 |
| --- | --- | --- | --- | --- | --- |
| runtime-collaboration.md:62 要求工作树来源可检测变化，读取中变化不可 sourced；ARCHITECTURE“投影、校验与语义判断”要求Context核对来源版本 | workspace-reader/role-source-reader.ts 原78-136；context-compiler/role-source-index.ts 原90-119 | 读取期文件/清单或账本revision变化仍标记claim版本 | A | WorkspaceReader重读实际选中正文及有界清单；Context I/O后重核canonical；保留原权限、容量、覆盖 | 增受控稳定/变化/删除/清单变化测试；不声称多文件原子快照 |
| PRODUCT连续执行和已有唯一身份规则；StateLedger原子提交责任 | sqlite-ledger.ts initSchema仅建identity_claims空表，commitGeneric只查询槽 | 升级前已有Binding未占槽，直接合法提交可再建同任务身份；正常Control预检查不能替代事务保证 | A | 同一写事务内复核既有canonical Binding，拒绝新增重复；不删不选择旧冲突事实 | 新建旧schema数据库，保留旧事件/快照/幂等，重开后直接第二身份提交必须零写拒绝 |
| ARCHITECTURE不变量3、StateLedger Module append-only及共同Adapter契约 | in-memory-ledger.ts load返回内部对象；events浅切片；commit保留调用方对象 | 不经Control/commit即可篡改存储快照、事件或幂等结果；SQLite JSON隔离无此旁路 | A | 在公开提交输入及返回结果隔离可变对象；load/events/pending返回独立值；保留原校验/CAS/故障顺序 | 快照/事件/receipt/outbox深层修改均不得改变后续读，故障零写仍有效 |
| ARCHITECTURE当前DAG、Module末节当前边界 | artifact-vault.md Dependencies称无产品依赖、后文称Vault不依赖Ledger；state-ledger.md等仍有旧源码目录 | 人类/Agent读到互斥现行说明 | A（文档过时） | 上层既有DAG为准同步当前正文，历史增量标明已替代，保留原历史 | 文档链接/语义复核 |
| 历史准入后续决定（原话待主追溯） | human/module-status.md:13仍称写入型Run不能读历史；CompletedWork/WorkRunMaterial已移除只读限制，Vault精确history授权决定读取 | 当前状态与当前代码/后续module-boundaries:143不一致 | B需来源核验 | 由主核实用户来源后同步状态；未核实前不把实现自证成决定 | 当前selectHistory与CompletedWork审查已确认，以主来源记录为准 |

已修复线索：RC-02源码读取适配归位；RC-03新库身份事务槽；WorkRunMaterialCompiler已拆领域步骤。历史注释和旧兼容re-export仍遮蔽阅读，主可在确认无消费者后做必要整理。跨角色补料、全面语言/依赖图与长期记忆消费者是尚未实现能力，不全算架构偏移。

验证限制：尝试 pnpm exec vitest 的限定五套测试触发环境隐式安装，被非TTY防清空保护拒绝；未安装依赖，未清目录。原始失败保留 audit-data-tests.log，实际测试交主统一WSL执行。修复结果另记 data-changes.md。
