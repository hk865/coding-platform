# R2e 剩余工作区能力与源码证据

2026-09-23，只读调查；未改仓库、未运行测试、未实现或委派任务。C=`/home/hyh001/projects/coding-platform/coding-platform`，N=`/home/hyh001/projects/coding-platform/docs/refactor`。源码路径相对C；R2d.2仍在独立推进，本文不能作为抢先修改其文件的任务书。

## 1. 结论

R2e不需要重新实现Python或C++语义算法。两者已有真实provider和模型消费者；剩余的是统一冻结接口、结果形状/覆盖声明、普通文件/历史读取及Git版本比较。建议按文本与capture读取→Git对象读取/比较→Python冻结适配→C++冻结适配四个小批顺序收口，每批带真实入口；不一次扩充整个WorkspaceToolsPort后填空实现。

N/refactor-plan.md:22把R2e定为固定argv的Git版本读取/差分，以及按现有provider支持接Python/C++/文本路径。N/modules/core/workspace.md:117–177给出readWorkspace/compareWorkspace和capture方法，:219–234说明文本、增量和语言边界。共同契约:167–187规定绑定范围/权限/版本的游标、临时capture与持久Artifact的区别，:114要求普通文件/图/历史查询不创建假Run。

调查时发现模块页开头和§10部分“新Port/capture仍待实现”描述落后于R2c已验收状态，主Agent已同步该状态。以refactor-plan和implementation-batches的精确批次证据为准，不重做R2c。

## 2. 当前能力矩阵（现状，不是建议）

| 能力 | 已实现及真实消费者 | 明确缺口/边界 |
| --- | --- | --- |
| TS/JS项目语义 | `ProjectSourceIndex`+`TypeScriptSourceAnalyzer`；新CaptureRegistry；`ProjectArchitectureSourceReader`真实图链；R2d.1已出现project_source模型适配 | R2d.2/3真实各类运行接线以该批验收为准；R2e不抢改 |
| 单文件/显式TS集合、精确摘录 | `source-index.ts::SourceIndex`，exploration-tools的code_index/source_excerpt | 不是完整项目调用图；保留旧digest/stale行为 |
| Python项目语义 | `python-source-index.ts:16–96`；`scripts/python-source-query.py`中的Jedi；exploration-tools:105/152的python_index；observed-model-run:103注册 | 每次旧query仍前后live capture；已有最多32个完整响应缓存，不等于跨capture分页；不是TS持久LanguageService |
| C/C++语义 | `cpp-source-index.ts:16–84`；固定libclang helper；exploration-tools:109/151的cpp_index | 必须有compile_commands；每query新隔离进程/重建TU；没有响应缓存或dispose资源API |
| 当前路径/文本/预览 | exploration-tools:157起list_files/search、symbols；app/workspace-tools.ts:73–95的/api/files/preview；server.ts:22给文件引用解析实际预览能力 | 是旧live/局部有界接口；不是querySource(paths/text)，不是Core readWorkspace |
| Git HEAD身份 | `source-identity.ts:4–11`，access.ts:80、observed-model-run:127、旧source readers | 非Git返回commit=null；没有历史blob/tree读取、Git log查询或任意commit比较 |
| 验证用HEAD↔工作树对比 | `verification-workspace-reader.ts:23–77`，service.ts:272注入VerificationContextCompiler，verification-source-applicability复用 | 是明确标签current-head-to-worktree、runBaselineKnown=false；不是Run-before-state，不是通用两个Git版本比较 |
| 新Port的非TS provider | `ports.ts:16`有text/python/cpp枚举，但capture.ts:208只允许typescript | 其余返回unsupported，不能因为type union出现就报已支持 |
| 新Port的paths/text | `ports.ts:52–57`有类型，source-query.ts:55直接unsupported | 没有冻结路径/文字查询实现 |
| 新readWorkspace/compareWorkspace | 目标模块页已定义；实际ports.ts:6–9明确未实现 | workspace-tools.ts:44只组装六个capture方法；没有git-read.ts |

Python/C++已支持symbols/definitions/references/imports/calls五类，配置/范围/未知依赖和失败分支不得在统一过程中减少。当前返回的更多元数据也不能随手删掉。

## 3. 可直接复用的源码事实

### 3.1 Python

- `python-source-index.ts:23–47`捕获许可内.py/.pyi、pyrightconfig.json/pyproject.toml/setup.cfg和依赖清单；单文件2MiB、总64MiB；保留helper、依赖zip/manifest digest及完整来源identity。
- :49–64校验查询/坐标；一基UTF-16，明确拒绝坐标切开代理对。:66–85以snapshot+语义查询缓存完整响应，来源变化清缓存，分页仅切响应；但:58和:82每次请求仍重读源材料，缓存命中也如此。
- :75–79只运行固定`/usr/bin/python3 -I scripts/python-source-query.py`，输入是已读取材料；helper:162关闭smart sys.path、unsafe extensions，工程代码不执行。
- helper:18–112解析配置为数据，虚拟环境/外部环境、部分命名包映射等显式unsupported；helper:177–195的Jedi位置已有真实end范围，模块锚点特设locationKind=module_file，不能与(1,1)声明混成一个符号。
- helper:238–252的AST imports/calls来源仅line/column，没有end字段；模块targets可以是文件锚点。不能强转SourceLocation假称具有同等范围。
- helper缺Jedi会返回unsupported（:133–137）；但外层先读zip/manifest失败会被:92–93归为rejected。新Port应分清缺引擎unsupported、内容/容量错误；旧wire兼容不得无说明批量改码。
- `tests/data/python-source-index.test.ts`已有跨文件别名、不执行源代码、src布局/配置、增删/依赖/HEAD失效、UTF-16、缺口、返回值隔离与字节上限测试。

### 3.2 C/C++

- `cpp-source-index.ts:20–41`捕获可读源/头文件和compile_commands，单2MiB/总64MiB；extensionless二进制/大文件保留excludedFiles及原因。
- :50–59要求唯一可选编译数据库及可用路径；:60–67只执行固定Python helper，不执行compile_commands中的编译器。
- :69来源hash还含配置、engineVersion/engineDigest/adapterDigest及prefix；:71再次捕获核验；:73是内容变化检测，不能宣传为持久增量语义分析。
- helper:166起将编译命令解析为数据，拒绝wrapper/shell/plugin/未知flag；:220起redirect-only VFS只映射许可文件。helper:295对语义收集总量有200000上限；外层stdout8MiB，不可改成无限收集后才分页。
- helper:286–291 include targets仅有path/digest，无坐标；call含targets/targetId，coverage列TU、未配置源、忽略的配置参数、外部头文件缺口和hasErrors（:340起），complete明确false。
- 真实缺libclang在helper返回unsupported；进程启动/输出错误外层rejected。不能为了“所有语言支持”安装软件、读取系统include或运行仓库编译命令。
- `tests/data/cpp-source-index.test.ts`已有真实libclang解析、配置/HEAD失效、危险flags和越界拒绝、缺引擎、真实ToolDefinition/Kernel后续请求、UTF-16、配置变体和捕获中变化。

### 3.3 Git已有实现应保留

`VerificationWorkspaceReader`已用固定rev-parse/ls-tree，并自行比较原Git blob IDs，避免工作树diff触发clean filter（:49–57）。它检查realpath(toplevel)==realpath(registeredRoot)，不会将父仓库当作注册子目录的历史（:28–46）。它保留可执行mode、符号链接身份的比较；CandidateWorkspaceReader不是语义capture的文件筛选器。

`CandidateWorkspaceReader:13–18`能计算带Git blob头的SHA-1/SHA-256 object IDs；这些与普通文件内容SHA-256 **不同**。R2e不能把Git objectId直接放入SourceFileEntry.digest，与capture内容摘要比较。

`tests/context/verification-workspace-reader.test.ts`现成覆盖非Git、HEAD/dirty内容、父仓库隔离、读取中变化、clean filter不执行、容量。复用其受限Git执行方式，保持其sourceProof/changedFiles语义；不要用新content-only diff替换mode/link-aware验证导致退化。

## 4. 在派发前必须固定的三个接口缺口

1. **受信Git I/O没有落点。** WorkspaceReadAccess（access.ts:22–33）只提供list/read/sourceIdentity，没有root或Git对象读取。不能从workspaceIdentity猜本机路径，不能让模型传root。应由access.open在真实resolveRoot+authorize后提供窄的bound Git能力；git-read.ts只从该受信绑定取得规范root并执行固定动作。不要添加任意runGit(args)公开Port。
2. **统一来源位置不能丢信息。** 新SourceRelation.targets是SourceLocation[]，每项强制start/end。C++文件目标、Pythonmodule_file锚点/AST点位不满足同一外形。推荐最小显式来源union区分file anchor、point、range（或给旧位置加明确locationKind并保留point语义），只在新的Port版本化；原TS字段及旧语言wire保持。也可由helper补真实AST范围，但不能给文件目标捏造行1并声称是声明范围。
3. **可比较范围与覆盖未充分编码。** TS capture只捕获TS/JS/JSON；Git tree含整个许可仓库。直接做集合差会把README/Python等误报删除。比较必须在相同声明范围下进行，范围不相容明确拒绝/标不可比较；不能把“没捕获”当“文件不存在”。此外目标WorkspaceChange[]没有coverage/mode变化字段；Git完整文件语义、content-only比较和mode-only变更如何表述需在子批固定，不能默默漏掉。多个同内容文件的重命名有歧义，仅唯一匹配可给identical_content证据，其余保留add/delete。

还有真实Host绑定前置：`app/source-capture-access.ts:53–57`当前生产桥明确拒绝host/query_run，R2d各子批另补运行身份。普通HTTP历史文件读取要绑定现有workspace-token/mount读取权限及真实human/system来源，不能创建假Run或仅凭kind放行。`server.ts:22–25`和workspace-tools已有真实入口/权限来源可复用；不另建账户/授权系统。

## 5. 建议串行子批（每批都是原组件的扩展）

### R2e.1 — 普通文件/冻结文本与capture间比较

**新增最少实现：** `readWorkspace(working_tree/capture)`，`captureSourceChanges(provider=text)`，`querySource(paths/text)`，`compareWorkspace(capture,capture)`。Git分支暂明确unsupported。保留TS六Port工作量，不为读取一个已知当前文件强制先捕获全仓。

- 主要文件：`ports.ts`补本批请求响应；`workspace-tools.ts`组合；`capture.ts`保留有界text材料和同ref按路径读取；`source-query.ts`在冻结材料中路径排序/文字匹配及缓存；`access.ts`继续实际读/授权。可新增内聚的`workspace-read.ts`负责read/compare，而非每方法一个文件。
- text provider只是文本/路径能力，绝不AST；二进制、解码/权限/容量缺口应显式，不能“成功完整”地漏文件。位置一基UTF-16；查询是字面文本，不支持脚本。空/超长查询及所有容量限制在收集前确定。
- 当前读取按maxBytes/真实权限直接读；capture读取必须完整ref、fresh授权、过期/释放拒绝，无新磁盘扫描。比较复用两个冻结清单，先确认可比较范围，再按path/digest做线性归并，不调用模型或Gitdiff。
- 最小真实消费者：现有`/api/files/preview`可用薄适配走新working_tree读取并保留text/binary/too_large/directory wire；或文件引用读取bridge先迁。其Host授权与链接政策要明确保持，不能直接把R2c拒绝Host的桥强行用于GUI。capture查询可在后续同一project_source wire增加已支持分支；不同时更改所有read/search工具。
- 验收：普通读取不创建Run/模型；精确文件只读一次；捕获后修改/删除文件仍可读旧正文；paths/text三页无磁盘读取；UTF-16/大小写/前缀边界；跨scope/权限撤销/关闭/释放；有界完整性；相同范围比较增改删/歧义重命名；旧preview/文件引用回归。

### R2e.2 — 固定Git版本读取与比较

**新增能力：** `readWorkspace(version=git)`；`compareWorkspace(git,git)`；mixed git/capture仅在上述范围规则能准确实现后发布，不能用全tree对TS子集假装支持。

- 主要文件：新增`git-read.ts`；`access.ts`提供授权后的窄对象读取；`workspace-read.ts`和ports连接。`source-identity.ts`保留旧HEAD返回语义。`VerificationWorkspaceReader`可复用固定Git执行/对象清单helper，但不改其业务sourceProof。
- 最小内部API可为`readGitVersion(boundAccess,{commit,path,maxBytes})`和`compareGitVersions(boundAccess,{before,after,limits})`，boundAccess来自当次授权，包含本次signal而不被registry保存。API冻结时明确commit只接受解析后的完整OID；不要执行模型提交的revision表达式/argv。如支持branch/tag，先一次解析成commit后所有I/O都绑定该OID，不在页间重解析。
- 使用固定rev-parse/ls-tree -z/cat-file读取原对象，不使用checkout、git show的可配置textconv路径、工作树diff或外部driver。禁可选锁、hooks/工程执行；超时/输出/对象数/累计字节有界，不能先读全库再截断。
- 校验注册root与仓库范围，第一版可延续“不是仓库顶层则unsupported”，不能泄露父仓库；支持worktree时以真实Git管理目录解析，不能把用户传路径当可信git-dir。
- 历史已删除路径不要求当前文件仍存在；按tree路径权限校验。Git symlink/gitlink不跟随读取工作区目标，明确不支持/缺口；保持真正对象身份。内容digest用实际bytes SHA-256，Git objectId另记内部来源，不能混用。
- Git原对象虽不随HEAD移动变化，使用时仍重核当前授权/root；缺失或被清理对象明确not_found/unavailable。普通历史展示不核验当前HEAD相等；verify当前材料是不同用途。
- 最小真实入口：原受保护文件preview增加显式version选择，旧省略version语义不变；或一个窄Host读取端点复用同一token/scope。先交可直接读取历史文件，不先做UI时间线/全Git log索引。
- 验收：两个本地提交、当前dirty文件、历史删除文件、HEAD切换不改已选commit结果；新增/删改/rename歧义/mode规则；SHA-1及可用时SHA-256对象格式；父仓库隔离、恶意ref/path、NUL路径分隔、symlink/gitlink、binary/超大对象、撤权/取消；clean filter/external diff/textconv不执行；原VerificationWorkspaceReader全响应保持。

### R2e.3 — Python冻结适配，保留原算法

- 从PythonSourceIndex提取“许可材料捕获”和“已冻结材料→Jedi完整结果”的窄内部组件，沿旧helper/toolchain digest/配置/坐标/结果规则。旧PythonSourceIndex仍组合live capture→query→verify，旧expectedSnapshot/offset和index.generation/reusedResult不暗改。
- CaptureRegistry按provider分支调用真实Python组件；同capture多页不重复workspace捕获或helper；不同查询最多各一次helper，复用现有结果思想且纳入R2c全局字节/查询/游标预算。无需创建驻留Python进程/通用语言服务器/新知识索引。
- 主要文件：`python-source-index.ts`、一个`python-source-query.ts`（内聚材料和helper适配也可先留同文件）、`capture.ts/source-query.ts/ports.ts`；helper仅为真实缺失的范围/容量字段改动，不重写Jedi算法。`project-source-tool.ts`本批明确新增provider字段并沿R2d真实Host绑定，不从模型接root/角色。
- 保留configuration/toolchain/import roots、外部环境不支持、module_file身份、unknown/static_candidate、diagnosticsTruncated。统一coverage若需provider-specific明细，定义最小明确DTO，不能全塞Record<string,unknown>后声称约束完成。
- 验收：已有Python源/工具tests继续；真实helper捕获+多页只一次分析，同capture多种查询的真实来源；配置/依赖zip/manifest/HEAD变化的verify及新capture；缺引擎与解析失败分类；权限/容量/取消/cleanup；模块锚点不冒充声明范围；旧wire完整对照。

### R2e.4 — C/C++冻结适配与最终能力矩阵

- 从CppSourceIndex提取已捕获files/config→固定libclang helper调用；不引入持久TU引擎，不发明增量parse承诺。每种新的语义查询可以重建TU，但同capture同query翻页不得重建。
- 文件/API同Python模式复用前批已证明的registry接点，不再造第二个capture池。CppSourceIndex没有dispose，保持无虚构释放API；取消/close负责等待真实子进程结束、临时目录由helper清理。
- 保留compile DB变体/未知flags/excludedFiles/translationUnits/engineDigest/adapterDigest/hasErrors/unconfiguredSources；include的file target和静态call不改成假精确位置。正式architecture mapping若本批不能准确接非TS必须明确unsupported，不借语义查询成功宣称架构图已覆盖。
- 验收：真实libclang与缺失安装两个分支；多页helper计数；编译选项/头文件/引擎变更；readonly VFS不读宿主系统头、不执行工程命令；Unicode位置、include文件锚点、unknown关系、配置歧义、超限无部分成功；旧cpp_index及Kernel模型stub回归。

最后更新能力声明/README/模块页状态：清楚列working_tree/git/capture读取、各种比较pair、各provider×query及正式图映射是否支持。未支持保留原因，不将旧工具仍存在误称新Port已覆盖。

## 6. 哪些不属于本批“必须重写”

- 不改既有TS LanguageService/R2b失效算法；R2c count/bytes/tombstone/权限/TTL机制应作为共同底座保持，不因多语言另写一份。
- 不把Python的32项响应复用变成TS同等持久增量；不把Cpp每查询重建TU当作必须在本批优化掉的缺陷。需消除的是同一个冻结query分页的重复捕获/分析。
- 不自动安装分析器，不解析执行仓库构建命令，不扩充到未支持语言AST。现有文本/路径工具是真实能力，但不能标语义图完整。
- 不替换CandidateWorkspaceReader的mode/link范围，不将HEAD差异提升成Run前后证明。普通文件history没有模型必要，不新增QueryRun。
- 不把临时capture当历史数据库：导出的完整关系/清单不含全部源码正文，释放后要读历史未提交代码仍依赖后续WorkGraph明确保存的blob/patch。

## 7. 派发前的完成口径

最小可立即细化的是R2e.1，R2e.2的Git bound access及历史Host授权同时冻结；R2e.3/4在结果位置/覆盖DTO确定后逐个实施。当前Python/C++真实旧工具支持应当保留并记作已有能力，不计为新实现。

如果根节点决定R2e仅维持旧Python/C++工具而暂不开放其capture分支，则语言部分只需现有回归与准确能力声明；但必须明确完整WorkspaceTools多语言capture目标仍待后批，不能把“旧工具可用”记作新的冻结Port已完成。本文推荐按上述小批闭合已定目标，避免一次大改。
