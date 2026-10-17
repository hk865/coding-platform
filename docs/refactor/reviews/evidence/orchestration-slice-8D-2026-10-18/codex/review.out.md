只读审查完成，未修改文件，未运行测试、构建或分析脚本。发现 **6 处必须改、1 项建议**。以下省略目录的源码文件均在 `src/core/workspace/`。

1. **必须改：配置读取失败后会悄悄回退。**  
   冻结访问器只列成功读取的文本，被跳过的配置从提供者视野中消失（`capture.ts:289`）；两提供者随后仅凭该列表选配置（`architecture-language-provider.ts:251、287`）。

   最小反例：根 `pyrightconfig.json` 含 NUL，另有合法 Python 文件；配置被记入 `other` 的问题，Python 却使用默认根并报成功。根编译数据库被跳过、另有嵌套数据库时同样会回退。后果是观察结果使用了另一套配置，违反“失败不换配置”。

   **修改思路：** 冻结材料保留配置的存在性及读取失败原因；先按优先级选配置，再判断能否使用。选中配置失败就让该语言失败，仍使用原冻结材料，无须重新读取工作树。

2. **必须改：C/C++ 逐文件容错改变了旧探索操作，解析失败可能变成空成功。**  
   TU 解析失败现在无条件 `continue`（`scripts/cpp-source-query.py:255`），但失败记录只随 `imports` 输出（同文件 `:367、390`）；普通输出仍为 `sourced`，`hasErrors` 仅查看诊断列表（`:379、383`）。

   最小反例：唯一编译单元使用 `--target=bogus`，调用 `symbols`。失败单元被跳过，返回空结果且 `hasErrors:false`；多个单元则可能返回未说明缺口的部分结果。这超出了任务书允许的改动。

   **修改思路：** 将本次逐文件容错限定于 `imports`；其他操作恢复原来的明确失败出口。复用现有真实错误配置即可核对，无须构造内部状态。

3. **必须改：Python 的自定义分析器目录没有传到实际进程。**  
   索引从 `analyzersDirectory` 校验包及计算摘要（`python-source-index.ts:35、44`），启动脚本时却只发送 `files/query`（`:94`）；脚本仍从仓库默认目录加载包（`scripts/python-source-query.py:115、119`）。

   最小反例：自定义目录有完整包，默认目录没有包，调用仍失败；两处包不同时，记录的摘要与实际运行的分析器也不一致。

   **修改思路：** 将同一个受信目录传入脚本，校验、加载和摘要统一指向它。现有“注入缺目录”测试只触发父进程检查，无法发现这个错接（`tests/data/S8D-language-providers.test.ts:132`）。

4. **必须改：C/C++ 缓存无界，且没有核对工具链变化。**  
   缓存键包含材料摘要、配置、路径及前缀，每次未命中都保存整份材料和结果，没有淘汰或释放（`cpp-source-index.ts:23、66、83`）。探索工具复用该实例（`src/core/agent-runtime/exploration-tools.ts:125、183`）。

   最小反例：同一工具组内反复修改一个字符再查 imports，或依次查询不同文件，历史整份源码不断累积；单份材料允许到 64 MiB（`cpp-source-index.ts:44`）。另外，命中缓存后仍用旧 `engineDigest/adapterDigest` 生成快照（`:69、86`）；运行中替换分析器，后页仍报告旧身份。

   路径／前缀加入键能避免不同查询串结果，但脚本在过滤前已经解析全部单元（`scripts/cpp-source-query.py:246、361`），因而换路径又解析一次。

   **修改思路：** 按材料、配置和工具链身份缓存未过滤的 imports，查询时再筛选分页；共享材料，限制保留版本和容量，增加 `dispose` 并接工具组关闭。这样同时解决重复解析、内存增长和失效遗漏。

5. **必须改：提供者认领的文件可能被索引静默丢掉。**  
   语言判定先将扩展名转小写（`architecture-language-provider.ts:71`），而 C/C++、Python 索引及 C++ 逐文件统计使用大小写敏感规则（`cpp-source-index.ts:8`、`python-source-index.ts:9`、`scripts/cpp-source-query.py:126`）。

   最小反例：`main.cpp` 引用合法、可读的 `API.H`。它被计为 cpp 文件，却不进入分析材料，合法引用丢失，头文件自身也没有逐文件结果。`e.PY` 同样会计入文件数但没有解析结果或原因。

   **修改思路：** 统一扩展名判定，保持原路径大小写；保证每个被认领的文件都有 parsed／failed／skipped 结果，不能只留下无法解释的计数差。

6. **必须改：C/C++ 超时、崩溃和输出超限的实际原因被覆盖。**  
   所有进程错误都加上 `analyzer unavailable` 前缀（`cpp-source-index.ts:72、73`），提供者匹配该前缀后统一替换为“分析器不可用”（`architecture-language-provider.ts:233、260`）。

   最小反例：分析超过 60 秒，或输出超过缓冲区限制。语言确实会失败，但超时／容量原因丢失，无法区分安装问题和运行失败，违反绑定答复要求保留分析器运行错误信息。

   **修改思路：** 明确区分缺解释器／缺库与运行失败；仅前者映射固定中文，后者保留原消息，避免靠混合含义的字符串前缀分类。

7. **建议：合并实际重复的解析和转换逻辑。**  
   Python imports 对每个文件先解析一次统计覆盖，随后再次解析遍历引用（`scripts/python-source-query.py:209、248`）。最小例子是一个正常文件也执行两次同样的 AST 解析；保存首次得到的树或语法错误即可供两处共用。

   两个新提供者的“盘点、认领、收页、失败转换、组装覆盖”也基本重复（`architecture-language-provider.ts:246、282`）；边与 unresolved 的去重又重复了 TS 提供者已有逻辑（同文件 `:110、194`）。可以共享结果转换和薄的执行流程，保留各语言配置选择及错误映射。这样减少以后修规则时漏改一处的风险，不改变 TS/JS 行为。实际生产差异为 **+355/−42，净增 313 行**，低于约 800 行预算；行数合格不抵消这些重复。

其余指定判断如下：

- 冻结材料与注册接缝成立：提供者收到的是内存读取器，注册经 `createWorkspaceTools → CaptureRegistry`（`capture.ts:289`、`workspace-tools.ts:56、66`）。普通 provider 异常会记为该语言失败（`capture.ts:343`）；全局边数在去重后检查，超限返回 capacity；覆盖公式使用完整问题数，最后才截存储列表（同文件 `:330、356`）。
- agent-runtime 和 composition 的差异限于可选参数接线，未另改执行流程（`.lead-ref/s8d-prod.diff:168、204、221、242、280`）。两个脚本实际摘要与 `runtime-assets.json:56、60` 一致，符合 `scripts/check-boundaries.mjs:244` 的检查方式；改动清单没有 vendor 生成物（`.lead-ref/s8d-stat.txt:1`）。
- A-06 四情形通过公开平台建立事实并在 memory／SQLite 上使用字面期望，未见数据库读取或事实注入（`tests/composition/S8D-A06-multilingual.test.ts:80、89、108、127、200`）。新增验收调用 listFiles／compare；三种文件读口及覆盖信息已有 8A 测试（`tests/work-graph/S8A-file-layer.test.ts:202、232、282`），不建议因此补重复矩阵。
- `unresolved` 经 compare 验证合理，页面 DTO 确实没有该字段（`src/contracts/architecture-inspection.ts:62`；A-06 测试 `:227`）。后页 stale 保留首个 `analyzerSnapshot` 未单独断言，不构成阻断：捕获组装不消费该字段（`architecture-language-provider.ts:182`、`capture.ts:324`）。缓存键问题已列第 4 项。
- “语法错误／二进制”按种类理解符合绑定答复，测试断言了实际文本（A-06 测试 `:187、215`）。`--target=bogus` 是经真实编译配置触发 libclang 失败的合法故障注入（`tests/data/cpp-source-index.test.ts:42、52、69`）。
- S8A 只翻转了三处必要断言：Python 覆盖、Python 实际边、C++ 无配置失败，原因均符合新增支持（`tests/data/S8A-file-graph.test.ts:160、162、188`）。

先改完列出的几处