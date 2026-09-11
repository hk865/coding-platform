import fs from 'node:fs';
const docs = 'D:/1.project/Software/agent_learn/agent_dev/agent_platform';
const append = (file, text) => fs.appendFileSync(file, '\n' + text + '\n');
append(docs + '/dev_docs/interfaces/runtime-collaboration.md', `## 全模块补齐增量：材料撤销与历史精确读取

新增 RevokeMaterialAccess：可信宿主携完整 grantRef、reason、CommandIdentity 和 expectedRevision=1 提交。MaterialAccessGrant 聚合从 1 到 2，原 grant 不变，另存 revocation；MaterialAccessRevoked 事件与快照同事务提交。两套 Ledger 检查原 grant 未被改写，幂等重放不复活授权。两套投影保留撤销原因/来源；权限解析在读取时重核 canonical grant，因此投影落后也不能沿用已撤销授权。原 owner 的历史读取保留，撤销不删除正文。

MaterialAccessGrantV1 可选 history={owner: 精确 Run/QueryRun, usage: historical_explanation} 是兼容扩展。仅可信 Control 可签发，当前实现要求来源/目标同 Project、同 Workspace；来源 Run 的 Goal 与真实 Workspace 在提交和读取时均复核。Vault 核对首次 owner 与 history.owner 完全相同，不重新 put 搬运正文。该授权只授予新 Run 对精确材料的历史读取，不继承旧权限、规则或完成状态；新的授权也可以撤销。跨 Workspace 边界待用户决定，尚未放行。

宿主 currentBasisValid 从账本核对 Workspace 当前 revision、Goal 当前非空 activePlanRevision 和读者 Run.planRef；仅声明旧版本相等不能绕过账本已推进的版本。sourceDigest 的当前性仍由具体源码材料消费者核对，尚无通用源码 pin 注册协议。旧无条件授权是历史读取权限，不证明材料适用于当前任务。
`);
append(docs + '/dev_docs/modules/data/artifact-vault.md', `## 全模块补齐实施增量

已接可持久撤销与精确同工作区跨 Goal 历史读取，原 owner/provenance 不变。新增宿主 canonical 计划/工作区版本复核。契约见 runtime-collaboration 的“全模块补齐增量”；阶段证据见 [实施记录](../../verification/2026-09-09-module-completion.md)。通用源码适用性、完整历史消费者与跨 Workspace 共享尚未完成。
`);
append(docs + '/dev_docs/modules/data/workspace-reader.md', `## 全模块补齐：项目源码服务

新增 ProjectSourceIndex 与实际运行工具 project_index。可读文件发现不再要求操作者指定最多 64 个文件；解析 tsconfig/jsconfig 的 include/exclude、extends、paths 与可读工作区内依赖，配置只作数据，不执行插件。一个 Run 内复用 TypeScript Language Service，按内容摘要更新脚本版本，配置与根文件变化重建服务。新增/修改/删除/重命名及分支变化进入来源身份；重命名明确记录为删除+新增。

查询符号、定义、引用、导入与静态调用候选，携文件/位置/内容摘要、符号标识、来源 manifest 摘要及宿主读取的 HEAD commit（非 Git 仓库为 null）。全量相关输入进入摘要，输出来源清单有独立截断标记，分页不能冒充全量。读取前后重新核对清单和内容，检测变更返回 stale；不是多文件原子快照。单文件 2 MiB、快照 128 MiB、内核发现最多 60000 文件；发现不完整会拒绝。TS solution project references 当前要求分别查询引用配置，未声称完整 solution 分析。

新增 PythonSourceIndex / python_index，通过固定 Jedi 程序分析权限过滤后的临时源码副本。来源副本不含项目环境、二进制扩展、答案目录或隐藏文件，Python 项目代码不执行。每次查询新进程重建，跨文件推断可不完整，动态关系保留 unknown/static_candidate，未声称 Python 增量服务或外部依赖已完成。工具依赖通过 scripts/setup-source-analyzers.py 安装到产品 .local（Jedi 0.19.2 / Parso 0.8.4，wheel 摘要有记录）。[Jedi API](https://jedi.readthedocs.io/en/latest/docs/api.html) 是 API 来源。

C++ 分析器、正式 CodeGraph 与 baseline pin、全语言项目配置和跨角色补料仍待完成。验证结果和失败追踪见 [实施记录](../../verification/2026-09-09-module-completion.md)。
`);
append('src/data/README.md', `\n新增 [project-source-index.ts](project-source-index.ts) 和 [python-source-index.ts](python-source-index.ts)，实际工具为 project_index/python_index；完整边界以 WorkspaceReader Module 为准。TS 项目服务复用 Language Service，Python 经隔离源码副本运行 Jedi；C++/正式架构图仍待接通。`);
append('src/vault/README.md', `\n本次增量支持撤销、同工作区精确历史读取和宿主 canonical 版本复核；历史正文/首次 owner 不变。通用源码适用性仍需补齐，详见 ArtifactVault Module 与 runtime-collaboration。`);
append('src/control/README.md', `\n[material-access-revocation.ts](material-access-revocation.ts) 受理精确授权撤销（CAS@1），保存原 grant 和撤销来源；宿主直接复核账本，投影延迟不会延长权限。`);
append('src/harness/README.md', `\n两个宿主均暴露 revokeMaterialAccess；读取候选后从账本复核撤销、来源身份和当前计划/工作区版本。history grant 只在显式范围内读取旧正文，不复制 owner。`);
append(docs + '/dev_docs/verification/2026-09-09-module-completion.md', `## 阶段 A 的已验证切片（阶段仍未完成）

- 撤销命令/两套 Ledger/Vault/投影：revocation-tests-1.log，4 文件 25 项通过，Vitest 11.77 秒；revocation-tests-2.log，5 文件 12 项通过，21.88 秒，包含 257 条候选与重开。真实内存/SQLite Adapter，无真实模型。这两次尚未包含随后加入的 history 与 canonical currentBasis 增量，后续日志单列。
- 项目 TS/JS 索引：project-index-tests-1.log，3 文件 18 项通过，18.35 秒，实际临时目录/沙箱/TypeScript；72 个 TS 源文件的配置/跨文件查询通过。此轮未通过生产模型调用。
- 生产 Runtime 复验首轮 source-runtime-tests-1.log：4 文件 33 通过 / 2 失败。发现运行工具枚举请求 100000 超内核公开上限 60000，已改为 60000；Python 关闭两种缓存触发 Jedi/Parso KeyError，改为每查询独立进程、保留进程内解析缓存且禁用持久缓存。修复后的结果正在独立复验，不使用首轮部分通过冒称完成。
- Python 依赖：系统缺 ensurepip，未改动系统 Python；改用固定 wheel 白名单/摘要验证解包到产品 .local/source-analyzers/packages。analyzers-install-2.log 记录 Jedi 0.19.2 sha256 a8ef22bde8490f57fe5c7681a3c83cb58874daf72b4784de3cce5b6ef6edb5b9；Parso 0.8.4 sha256 a418670a20291dacd2dddc80c377c5c3791378ee1e8d12bffc35420643d43f18。
- Windows pnpm 触发自动依赖重装提示，未授权其清理现有 node_modules；采用已配置 WSL 独立 runner。当前 WSL Node v24.18.0，真实内核/沙箱可运行。

所有日志位于产品 evidence/2026-09-09-module-completion/。A1–A8 总验收、外部真实模型和 FeatureBench 尚未执行；阶段 A 还缺 C++、正式源码 pin、完整历史消费者及协调/查询工作结束协议。

## 待决事项 P-AUTH-WS

已向用户询问：是否允许同一 Project 下，用户显式选择来源材料和目标 Run 后跨 Workspace 授权。建议允许精确且显式的授权，禁止自动共享；保持原 owner/provenance、同一 Ledger、独立 source/target Workspace、撤销及读取复核，旧授权/完成不继承。当前实现仅同 Workspace，待答复；其他独立工作继续。兼容：旧 grant 缺扩展字段继续默认拒绝；测试需覆盖来源/目标两侧版本、旧决定拒绝、撤销、重开与禁止跨 Project。
`);
const statusFile = docs + '/human/module-status.md';
let status = fs.readFileSync(statusFile, 'utf8');
const anchor = '## 按原图逐层展开：功能方框内部由哪些模块工作';
status = status.replace(anchor, `2026-09-09 全模块核心义务补齐正在实施：已新增材料撤销（原授权不可变、撤销事件、canonical 读取复核）及项目级 TS/JS 索引，局部证据见 [施工与覆盖记录](../dev_docs/verification/2026-09-09-module-completion.md)。同工作区跨 Goal 精确历史读取、Python 语义服务与实际 Run 消费正在复验。阶段 A 未结束，B–G 及真实项目总验收未完成；前述日期条目保留历史验证边界。\n\n` + anchor);
status = status.replace('通用版本自动作废／撤销／长期继承未接', '已接撤销与账本版本复核<br/>通用源码适用性／完整长期继承未接');
status = status.replace('已有限定 TS/JS 语义查询与摘要校验<br/>缺正式架构图／多语言／全仓索引', '已接项目 TS/JS 配置与增量查询<br/>缺正式架构图／完整多语言／源码 pin');
fs.writeFileSync(statusFile, status);
const humanFile = docs + '/human/context-management.md';
let human = fs.readFileSync(humanFile, 'utf8');
human = human.replace('通用 ArtifactVault 仍为内存实现；已保存的探索报告由应用单独落盘并重建，本页的“保存”描述不能解读为所有产物均已持久化。', '持久宿主已使用 SQLite ArtifactVault，正文、来源与首次 owner 可重开恢复；下文早期探索记录保持其历史边界，完整长期 Context 与跨角色接续仍未完成。');
fs.writeFileSync(humanFile, human);
