# R3b Sol 材料正文骨架与独立测试

日期：2026-09-24。状态：**本文保留最初骨架与补测记录；最终功能已通过主审，当前结果见[验收](../reviews/R3b-sol-dsh-acceptance.md)。初始 RED 不代表当前仍未实现。**根路径 C=`/home/hyh001/projects/coding-platform/coding-platform`，本文 `src/`、`tests/` 均相对 C。主 Agent 已批准这份窄 API 方向；DSH 的生产实现仍由主 Agent单独派发并验收。

## 本批已冻结接口与文件范围

| 文件 | 已写骨架 / 实施边界 |
|---|---|
| `src/core/record-store/body-ports.ts` | 仅 RawArtifactPut/RawArtifactRecord/RawArtifactStorePort；MaterialOrigin 为 run、platform_operation、仅解码的 legacy。StoreResult 复用现有 `ports.ts`。不得把 raw read 注册成模型或 UI 工具。 |
| `src/core/record-store/body-codec.ts` | 旧行解码、新行编码边界；新写拒绝 legacy，旧 StoredRecord 从 ownerRunRef 转 legacy，校验完整 ArtifactRef/正文摘要大小。当前显式 throw。 |
| `src/core/record-store/body-store.ts` | RawArtifactBodyStore + 默认 Map/可注入 ArtifactBodyRows seam；正文 digest、尺寸、首 owner/来源、putIfAbsent 获胜者及返回隔离只实现一份。当前 put/read 显式 throw。 |
| `src/core/record-store/sqlite-body-store.ts` | createSqliteRawArtifactStore(path) 使用旧 artifacts(key,record) 表；SQLite atomic INSERT ON CONFLICT DO NOTHING，返回已提交获胜行；close/reopen 读取。当前工厂显式 throw。 |
| `src/core/work-graph/materials/contracts.ts` | 只发布 storeArtifact/openArtifact；不预建 resolveMaterials/searchHistory、整图或 DataEngine。 |
| `src/core/work-graph/materials/applicability.ts` | 材料来源、Host canonical owner scope、原 exact grant/currentBasis/source pin 的单一准入位置；依赖 contracts 层 `load` 类型，不 import StateLedger 实现模块。legacy 内部的 usage 可缺省，准入结果可携带 `applicability`；导出 `createMaterialAccessResolver(authority,index,sourceApplicability?)`，供旧文件迁移后纯重导出。当前工厂显式 throw。 |
| `src/core/work-graph/materials/material-service.ts` | 按 CoreCallContext 绑定可信 writer/reader，先准入再读 raw 正文；正文存储与正式引用是两步，成功存储仅回 stored，不造 Ledger cursor。另导出 `createLegacyArtifactPort(deps): ArtifactPort` 保旧 wire；它必须与新端口共享私有读取/授权原语，不用伪造 `work_run` 或 roleBinding。当前方法显式 throw。 |
| `src/contracts/core/results.ts` | 仅新增精确材料读取实际需要的 `ReadResult=ready/not_found/CoreRejection`；投影水位 `not_ready` 待有真实消费者才发布。 |
| `src/data/context-compiler/history-materials-context.ts` | `HistoryMaterialsContextDeps` 仅增可选 `materials`/`readHostContext` 类型，为后续真实 Host 接线留窄入口；尚未改变历史页面行为。 |
| `tests/data/R3b-materials-contract.test.ts` | 10 项独立场景，按 `R3b raw body contract`（3）与 `R3b WorkGraph material contract`（7）分组，两个 DSH 范围可用 test name pattern 定点运行；冻结，不由实施者改弱。WG 测试全部用 fake raw port，能独立于 raw 实现运行。 |

本骨架未修改旧 Vault、旧测试断言、module-map、Host装配、runtime-context；只按主 Agent 批准调整一处旧 SQLite 竞态夹具等待点，见下文。旧 `material-access-policy.ts` 在规则迁移后只重导出新WG resolver；旧 ArtifactVault/SqliteArtifactVault 保持薄参数/结果适配，不能留两套授权或正文验证。必要的旧协议转换由实施 lane 在主 Agent 确定文件清单后写。

旧 `ArtifactVault` 构造函数接受调用者共享的 `Map<string,StoredRecord>`；薄适配必须**逐次读写即时转换 JSON/旧记录**，不可在构造时一次性复制 Map，否则旧共享 store 的外部修改、损坏注入和同一 Map 上多个实例会失去可观察性。此兼容 seam 与新默认内存正文存储共用同一 codec/完整性校验，不加第二套正文规则。

## 已冻结行为

- 原 ArtifactRef 和 `artifacts(key,record)` 可读；同 contentType+UTF-8 digest+size 争用保留**第一次** ref、owner、sourceRefs。SQLite 重开与旧行读取必须成功；损坏返回 Store `corrupt`，不可伪装不存在。新写 `legacy` 返回 `invalid`；TaskAttempt/Run/QueryRun 原 owner 仍可解码。读取返回对象须与内部存储隔离。
- Host 读取只用可信 Host 注入的 CoreCallContext；context.projectId、materialReader.projectId、actor、workspace 需一致。historical 使用真实 origin 或 legacy owner 加载 canonical Run/QueryRun，核对 project/workspace；不由 ArtifactRef 文本或数据库文件名猜授权。legacy owner=null 无可信关联时 Host forbidden。Host `current` 无可验证 source pin/basis 返回 source_stale，不能伪称 current。原 Run/QueryRun owner-only、exact grant、basis、撤权与 source applicability 保持。
- 现有 GUI history 页面仍核对 grant 存在、历史用途、未撤销及作用域，才借 Host 身份读正文；Host 正文权不代替页面 grant。`src/app/service.ts` 在已验证 project/workspace 路由构造固定 human actor；模型 JSON 不得填 principal/materialReader。
- 真实 Run bundle 由 `src/data/context-compiler/runtime-context.ts` 经旧薄适配转新 MaterialService 时，保留 TaskEnvelope/摘要/来源断言；真实 QueryRun 的读取范围不扩。正式关联提交失败可留下未引用正文，但不得出现成功引用指向缺失正文；本批不自动清理无法证明无引用的正文。
- 旧 `ArtifactPort.open` 的 `usage` 可缺省；owner-only 成功且未要求 `includeOwner` 时，返回记录不新增 `ownerRunRef` 或 `applicability` 字段。`includeOwner=true` 才返回 owner；明确历史请求或历史 grant 命中时，沿旧语义标记 `historical_explanation`。TaskAttempt 允许作为旧写入 owner，但不会因此给任何 Run 读取资格。旧适配不得靠构造一个缺失真实 roleBinding 的 `CoreCallContext.work_run` 实现。

## RED 与后续验收

使用 Node 24、单 worker、已装依赖：`pnpm typecheck` 通过；`pnpm test --maxWorkers=1 tests/data/R3b-materials-contract.test.ts` 为 **10/10 RED**，均停在明确 `not implemented` 的骨架处。测试覆盖内存首 owner/来源与返回隔离、SQLite 旧行/reopen、legacy 新写拒绝/正文损坏、Host 写入/输入隔离与伪造 origin 拒绝、Host 无 Run 读取与跨域拒绝、Host current 不虚称、legacy 无 owner 拒绝、QueryRun exact grant/basis/撤权、旧 open optional 字段及 TaskAttempt 权限边界。可用 `-t 'R3b raw body contract'` 或 `-t 'R3b WorkGraph material contract'` 分开运行。

SQLite 竞态夹具 `tests/vault/sqlite-artifact-race-process.mjs` 经主 Agent批准作机械调整：旧 SHA-256 为 `c1be824773a03e6fba8b7fd98e532e36534678777d21ca9cd2775fc56ca6bb3a`；原等待点是精确 `SELECT record FROM artifacts WHERE key = ?` 的未命中。现等待点是首次 `INSERT INTO artifacts (...)` statement.run **调用前**，不再要求实现保留额外预读。两进程仍都抵达真实写入前；A先执行提交，B后执行，原 `tests/vault/sqlite-artifact-concurrency.test.ts` 未改断言，并已在旧 SqliteArtifactVault 上 **1/1 PASS**。夹具现冻结，不由DSH再改。

实施验收还需由主 Agent/实施 lane 在真实 Host 接线时补一项端到端边界：`service.ts` 的已验证路由→HistoryMaterialsContext Host身份→MaterialService，证明普通展示无需伪 Run，grantId 页面规则仍生效；以及 `runtime-context.ts` 的真实 Run 束读取经新规则成功。旧 `tests/vault/*` 保持冻结并定点回归，不能以本骨架测试替代真实接线验收。不跑全量、不安装依赖、不自动提交。

## 独立 Host 接线验收补充（接口已冻结后追加）

仅新增 `tests/app/R3b-host-materials.test.ts`，复用 `tests/app/history-materials.test.ts` 的真实 in-memory Ledger、跨工作区 source/target Run 与 HistoryMaterials 入口。测试给已冻结的 `HistoryMaterialsContextDeps.materials` 注入**公开 MaterialPort spy**、给 `readHostContext` 注入固定受信 human actor，旧 `vault.open` 则设为失败探针。跨工作区来源的 Host reader 采用项目范围（省略 workspaceId），但 factory 先验证输入的目标 workspace scope，不能把来源误限为目标工作区。该测试要求普通 `available`/`read` 走 Host port，不调用旧 Vault 冒充 item.owner/grant.reader；仍需 canonical grant 存在、显式跨工作区人类历史授权、未撤销与 scope 匹配。JSON中的伪 actor 不得影响 Host context。该测试不造第二套材料选择业务 fake；spy只观测边界调用并返回 fixture 的已知正文。

`HistoryMaterialsContextDeps` 另增可选 `grantAuthority: MaterialAccessResolver`，用于Host新路径读取正文前复用原 canonical grant/currentBasis/crossWorkspace 判据；未注入者保持旧兼容。测试使用生产 `createMaterialAccessResolver`，对真实 Ledger/ReadModel 投影的 grant 做精确 candidate 检查，并模拟 canonical workspace revision 前进。currentBasisValid 失败时按旧 HistoryMaterialRead wire **返回** `result.rejected/stale` 与 historical applicability，且不得触发材料 Port；grant 不存在或已撤销仍抛错。此注入不创建新产品权限接口，不复制准入规则。已派 raw/WG 实施文件和原10项测试保持冻结。

## Raw 正文边界补测（独立于原10项）

`tests/data/R3b-body-boundaries.test.ts` 新增4项，固定数据操作的实质约束，不要求内部必须使用特定缓存或预读次序：真实 `RawArtifactBodyStore` 对一次合法新 put 仅计算正文摘要至多两次且返回正确内容地址；可注入 `ArtifactBodyRows` 若把合法JSON记录放在错误 content key，read/put 必须返回 `corrupt` 而非给出错误正文；新 `origin.kind=run` 与兼容 `ownerRunRef` 冲突必须返回 `corrupt`，避免两个权限权威并存；SQLite已有 `artifacts` 表形状错误使初始化 prepare 失败时须关闭本次新连接，保留原库和表。最后一项在种子连接关闭后才 spy `DatabaseSync.close`，并复读 schema 证明未删库重建。此文件和原10项均不由DSH改弱；新测试在Sol骨架上预计RED，root主审后用于raw返修。

`tests/data/R3b-material-admission-boundaries.test.ts` 另新增6项WG边界，全部只依赖 fake raw port，与上述raw测试物理分离。它让新 MaterialService 实际写入 platform_operation origin，再以同 project/workspace Host 历史读取成功、跨 project/workspace 拒绝；在 raw read 挂起时外部修改原 `CoreCallContext.materialReader`，要求按调用受理时的可信身份判定，既不能把原无权读取放行，也不能让合法读取串到后来被改的身份；read 期间 abort 后不得返回正文，须返回 cancelled；raw corrupt 映射 Core `unavailable` 与 legacy `invalid`，都保留原 reason。新增的第6项用完整 `work_run` RunRef 与 reader、真实形状 RoleBinding及 canonical Run workspace，验证 Core ctx.workspaceId 不匹配时仍 forbidden，匹配时 owner 历史读取 ready；只验证 CoreCallContext 的范围一致性，不增加旧 legacy owner-only 查询门槛。这些断言约束公开行为和时机，不钉死内部函数拆分。Node24单worker下类型检查通过；新增6/6在Sol stub按预期RED，root主审后用于WG返修；原10项与生产未改。

本测试与旧 `tests/app/history-materials.test.ts` 同跑：旧 **3/3 PASS**，新增 **1/1 RED**，当前在 `HistoryMaterialsContext.available` 调旧 vault.open 时触发探针；`pnpm typecheck` PASS。新增测试是最终集成验收，**不阻止 raw/WG 两个 DSH lane 各自定点验证**。`createScopedGuiService` 为私有函数，公开 `createGuiService` 当前内部直接构造 HistoryMaterialsContext，且没有WG Port注入观察点；不扩大现有生产公开接口时，真实GUI路由 scope→Port 的观测需由主 Agent在组合根接线时安排。现有 `tests/app/runtime-context.test.ts` 可核对真实工作 Run bundle 路径，不复制整套场景。

`tests/app/R3b-gui-materials.test.ts` 已补公开服务真实接线验收：`createPersistentPlatform({dir})` 写入 acceptance-alpha/beta、两条 canonical Run、SQLite 正文及正式人类历史 grant，关闭后同目录以 `createGuiService(dir)` 走 `/api/real/history/read`。测试包装公开 `createMaterialService` 工厂的**真实**返回 port，仅记录 `openArtifact` 的 Core context，不替换返回值；要求可信 Host human actor 不取 JSON 伪 principal、未知 scope 在 WG 调用前拒绝、读页面不新增 Run。Node24单worker类型检查通过；该测试目前 **1/1 RED**，既有 GUI 路径能从旧 Vault 读到正文，但 `createMaterialService` 工厂调用为0，失败点准确指向未做的真实WG接线。此测试不要求扩展 `createScopedGuiService` 的公开接口。

最终主审另增加真实 Dispatch body-first 故障2项、Host边界5项；Host复用既有 grantIssuerOwnsMaterial（仅导出函数，原算法未变），保证普通页面不把候选grant当完整授权。新增边界由Sol实现并由主审复现后冻结；共31项独立验收，具体范围及临时DI债见最终报告。
