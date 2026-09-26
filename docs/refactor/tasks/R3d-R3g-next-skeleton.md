# next：角色规格与持久源码观测（R3g / R3d 子集）

状态：2026-09-24，本页子集已独立验收并导入 next，见[372项最终隔离验收](../reviews/next-r3d-r3g-2026-09-24.md)。前序基线为 [R3c/R4b](../reviews/next-r3c-r4b-2026-09-24.md) 的 321 项隔离测试。本批不代表整个 R3d/R3g 完成。

沿用 [DSH-WORKFLOW](../DSH-WORKFLOW.md)：Sol 骨架和独立测试 → 主审核对语义、冻结 → 两个 DSH Session 隔离并行实现 → 主审看差异、复现、导入和装配。实现根 coding-platform/next，原 src/tests/Kernel 只读。长期规则引用现有产品、架构、模块页，本任务只记本批差异。

## 1. R3g：正式角色规格

入口 next/src/core/work-graph/configuration/，只交付 install、activate、exact read 和 binding resolution。沿用必要的版本化正文、摘要、命令与回执；不迁旧 Control/StateLedger 服务，不添加透传 Repository。RecordStore 保存不可变 RoleSpecRevision、ProjectRoleSpecActive 及事件。安装不自动激活；激活 expectedRevision 是 Project 版本，规格内容版本与外层记录版本分别校验。

resolve 外层 ReadResult<RoleSpecResolutionV1>：先保证读取可用、完整且同一水位，再给 resolved/absent/inadmissible。真正没有矩阵才 absent；矩阵中没有角色为 inadmissible；损坏、未注册 schema、无法读取不能变 absent。读取当前 CoordinationPolicyActive、其精确 revision/content digest、matrix pin、RoleSpecRevision 和 RoleActive，不能拼接各时点事实。历史 pin 精确读不要求仍 active。

policyRevision 保持既有来源标记语义，不能凭字符串证明授权，也不在本批禁止所有旧格式绑定。当前正式矩阵、规格和 active pin 决定规格相容性。declaredPermissions 是可信调用者提交的待核集合；resolved 只证明它不超过规格上界，不是 Task/Query 执行或路径写入许可。后续 claim 从真实 accepted envelope 与 Host 授予取交集。未登记角色不走 legacy fallback；真正无矩阵的 legacy_template 由后续真实配置适配处理。

普通 Host 入口绑定 project/actor/material reader；不开放模型自报身份或权限。协调策略生产安装、memory、UI 和执行准入不属于本切片。测试通过正式 RecordStore 建立必要已接受策略事实，不冒充生产初始化完成。

## 2. R3d：持久源码观测与机械图操作

入口 next/src/core/work-graph/architecture/。临时 SourceCaptureRef 仍归 WorkspaceTools；PersistedSourceCaptureRef 包含其身份与已落盘正文，可在捕获释放、过期、进程重启后读。它不是当前文件系统的活见证，也不是已采用架构基线。

调用链：可信 Workspace 绑定和正式 revision → WorkspaceTools capture/verify/export/显式 mapping → RawArtifactStore 正文 → 再次 source verify → RecordStore 原子提交观测记录、当前观测指针和事件。正文存储先于记录，失败可留下不可达正文，但不得发布半成品。重复请求先重放原回执，不重新捕获。provider/configPath 由可信 Host 配置。

历史读取先重核当前 Host workspace 访问，再核正式记录、完整引用、正文摘要/来源及当前逐路径权限；历史内容不要求与当前文件相同。复用 WorkspaceAccessFactory，不另造权限系统。源码变化不抹去历史，撤权不因曾经捕获而失效。

当前逐路径权限针对真实 frozen files，mapping 目录或不存在的首个代表路径不是额外文件权限；节点必须与明确 mapping 和至少一个实际 source member 对应。捕获退出统一释放临时引用，取消请求不取消释放清理。提交使用精确作用域 CAS，不以无关 ledger 追加迫使重复捕获。具体长期语义见 WorkGraph 模块页架构接口小节。

主审补齐的成员证据是 WorkspaceTools 在同次分析中已有的 indexedSources 清单；不按扩展名推断，不为它增加捕获/分析。新持久正文必须携带清单，与 frozen files 逐项核对，并核节点成员摘要；同时覆盖 TS 实际索引 JSON 的合法映射与撤权反例。

只开放 observed 查询、邻域、比较与影响。真实循环保留，visited 集保证终止。仅显式 mapping 建模块/接口观测节点，不把目录宣布为正式 ModuleDefinition。输出 unresolved/noVerdict；没有正式来源的 work_link/current/revision/draft 明确 unsupported。页游标绑定源引用和查询参数；机械影响不等于调度决定或写权限证明。

正式 catalog/baseline propose/apply、decision/gate、工作关联，以及非 TS provider 的观测图接入仍待后续子批。

## 3. 责任与验收

Sol 只写本模块骨架及 next/tests/work-graph/R3g-*、R3d-* 独立测试。主审负责共享 contracts、固定检查、composition、文档与最终集成测试。DSH 不改 tests/contracts/接口形状/其他模块/冻结 Kernel；新增私有文件须由主审确认预建。

验收用真实 Memory/SQLite 与 WorkspaceTools：回放、重启、CAS 竞争、错误/缺失区分、跨 scope/actor、撤权、过期来源、真实环与有界查询。先审测试语义，再记录红测与实现结果。最后在无旧源码的物理副本运行类型、构建、边界、全套测试和组合根，并核对旧工程 1313 文件清单。

本批完成不意味着 Task/Query claim 可执行。Session 原子占用、资源范围冲突、实际写授予和执行驱动仍按 R4c/R4p 验收。
