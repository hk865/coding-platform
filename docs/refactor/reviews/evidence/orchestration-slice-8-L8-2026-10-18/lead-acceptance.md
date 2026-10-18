# L8：lead 的验收（2026-10-18）

**结论：** 合入（2026-10-18，de70ff41）。Codex 的最后一轮核对（`codex/verify4.out.md`）判 4/5 修好、P3 部分；按决定 80-4，P3 的最后一个 await 由 lead 直接补（`checks/lead-fix.diff`），不再开一轮。PASS 三行在有 bwrap 的环境跑过（分轮检查 `s8l8-r1`–`s8l8-r4` 全过）。合并树（2b7f5be）的全量 591 个文件全过，8,741 项过、5 项跳过，2,612 秒，峰值 4.91 GB。合并树的第一次全量查出 46 项失败：重启时多写一条自动抓请求，其中一项是没有租约的 Host 也写；lead 补了生产修补 2，测试由 Claude 子 agent 改成先等抓取做完（决定 81-4、81-6），见“合并全量查出的问题”。

## L8 的范围

| 项 | 结论 | 怎么验收的 |
| --- | --- | --- |
| 自动抓的四个触发 | 接受 | 工作区登记的两条路（设置页、路由）都只在非重放登记、根绑定以后触发；初次采用、每次修订、每轮 `PASS` 发送一次触发；等待中的触发会合并，不保证每次提交对应一次抓取。PASS 包同一个 `rawEvidence.finalizeChecks`，Workflow 和公开入口都走它；重放的登记、采用和定案不触发。A-04 经公开 `architecture/observation-state` 看每次触发。 |
| 没有目录时只抓文件层 | 接受 | 第一次采用前的抓取 `mappings: []`，文件层有文件、模块层空；用之后的目录做正式比较，得到没被覆盖的文件；A-04。 |
| 每个 Host 一个串行、合并的驱动 | 接受 | 同一时刻最多一个抓取；等待中的工作区合并，正在跑时只多排一次；两个工作区一前一后；`maxActive = 1` 只在 B 真的进入抓取以后断言；A-04 和 T24。 |
| 请求记录和 pending 水位 | 接受 | 接受触发时先写 `requested`、`requestSeq + 1`；开始快照的 `requestSeq` 既是身份也是水位，`revision` 守失败写；`pending` 由记录序号和指针水位算；手动抓取早开始、晚提交不把水位写小；A-04、`S8A-L8-observation-state`。 |
| 失败记录和原因 | 接受 | 抓取失败写 `failed` 和真实原因；开始读观测状态被拒／抛错、目录读被拒／抛错都走同一出口（目录 `not_found` 合法；观测状态的 `not_found`／`not_ready` 按失败处理，不当作没有目录）；失败原因截前 2,000 个字符，编解码拒绝更长的；`failed` 事件的 `occurredAt` 是写失败的时刻，`requestedAt` 保留；提交前取消不发布失败记录，旧 revision 不覆盖新请求。 |
| 重试 | 接受 | 下一个真实触发重试；Host 启动对本 Host 绑定的 pending 写 `startup_retry`、`requestSeq + 1` 后排队；没绑定的保持 pending；关闭时排队的请求留到下次启动；真实 Host 关闭后同一 SQLite 上新 Host 补抓 A 和 B（SQLite）；内存后端的 T18／T19 另测“第二个 Host 只绑定 A，B 不变、不进入”。 |
| 关闭顺序 | 接受 | 关闭先停队列、再用驱动自己的 controller 取消正在跑的抓取，然后才排空；被取消的那一轮不写失败，保持 pending。 |
| 观测状态的读 | 接受 | 普通路由 `architecture/observation-state` 按工作区返回最新、上一次、上一次的持久引用和自动抓记录；`current` 带 `persistedRef`，`previous` 仍是 capture ref，`previousPersistedRef` 在顶层；`autoCapture` 带算出的 `pending`；拒绝 `requestSeq` 的是 `architecture/capture` 的 HTTP 入口和运行时解析，不是 `observation-state`。 |
| 映射、最新和上一次 | 接受 | 有目录时驱动和手动路由共用 `moduleMappingsOf`；`mappings` 可选，界面不再自己算；指针在同一次提交里写 `previousObservedRef`；自动抓取把开始快照的当前观测作为 `previous`，改动数不再全算新增。 |
| 四类提醒、顺序和上限 | 接受 | A-03 的四行字面量（3 小时）；先按种类、再按路径和行内容排；公开 `prepare` 用 `src/a` 和 `src/a-inner` 证明同一种 `/`<`:` 风险，精确的 `src/a`／`src/a/inner` 对只在纯测试里；12 条时列出 10 条，另加 `另有 2 条架构提醒没列出`，总计 11 行；`unknown` 行在内容末尾、时间括号之前加 `，不确定`；没有观测时 `还没有观测`；没有可说的就不出段；时间阈值在纯测试里用 59 秒、59 分钟、23 小时、3 天，公开 `prepare` 不测这些边界。 |
| 提醒读的失败和取消 | 接受 | 非取消的读失败给一行 `架构提醒不可用`，准备继续；取消让准备取消；put 之前取消 0 次 put，put 中取消不 ready、不回滚正文。 |
| 块的工作区范围 | 接受 | 节点块、边块、没解析引用块和空块都带 `projectId`／`workspaceId`；外壳由转义后的范围值和固定结构拼；同范围复用、保留存储返回的 ref；正文范围和记录一致；旧无范围块拒绝；A-12 的 297／294 字节和 64 块上限不变，L8 的 500 字节例子是 6／7 块。 |
| 读取次数 | 接受 | 指定夹具下的提醒依赖读取：12 个文件、6 块、无上一次观测时 12（5 记录 + 7 正文）；加第 13 个文件、当前 7 块和 previous 6 块时 21（6 记录 + 15 正文）；按调用计，不按 key；窗口只在真实 reminder reader 执行期间开启，reader 返回就关闭，不延续到 put；七条事实检查在窗口外恢复。 |
| 旧测试和回归 | 接受 | 旧测试只改了 `WP2-wiring.test.ts` 的 F06（省略提醒 2→3，手算，`还没有观测` 新增 1）和 Z01 的等待（计数前等公开状态的 `pending: false`，断言不变）；R3d、R3d-R3g、R5a、R6-host 是回归运行，不是改动。 |
| 生产可达 | 接受 | `architectureReminderRows` 删除；`production-reach` 不再有 L8 的新允许项。 |

## 提醒（A-03）

- 四行：`声明的依赖没有 import：A→B，src/a/core（3 小时前的观测）`、`import 没有声明的依赖：src/b/extra.ts → src/a/core/util.ts（3 小时前的观测）`、`新文件没归组：src/a/loose.ts（3 小时前的观测）`、`可能移动：src/old.ts → src/new.ts（3 小时前的观测）`。
- 12 条 → 列出 10 条，另加 `另有 2 条架构提醒没列出`（总计 11 行）；`，不确定`；`还没有观测`；有观测但没有可说的。时间阈值（59 秒、59 分钟、23 小时、3 天）只在纯测试；精确的 `src/a`／`src/a/inner` 对也只在纯测试，公开 `prepare` 用 `src/a` 和 `src/a-inner`；公开 `prepare` 的 A-03 主例和排序例跑内存和 SQLite。
- 移动要求删除和新增各自恰好一个路径带同一 digest；没归组的最长公共目录前缀必须严格最长，并列不算；没有目录或任务没有模块时只有移动行。
- 只读已加载的观测，不重新抓；每份观测最多加载一次，比较和移动共用最新那份。

## 请求记录、失败和重试

- 记录形状、状态层构造器、两个事件和解码器都在；状态写入检查的受保护表和 decode 白名单登记了；`architecture` 子模块依赖 `state` 已写进 `module-target.json`。
- 开始时读观测状态失败和抛错都记 `failed`；提交前取消和旧 revision 不写。失败原因的 2,000 字符截断有纯状态测试和编解码断言；`failed` 事件的 `occurredAt` 没有公开 reader，只做实现核对，公开记录断言只查原 `requestedAt` 保留。
- 关闭顺序和重启分开测：关闭只证明“停队列、abort、排空”，重启只证明“新 Host 补抓 A 和 B”；内存后端的第二个 Host 只绑定 A，B 的请求和进入次数都不变。

## 块格式和工作区范围

- K1 是这一轮最重的业务缺陷：同一项目里两个内容相同的工作区（clone、worktree、空项目），后登记的那个读不出自己的观测，提醒和文件图都坏，之后每次抓取读前图也失败。返工 2 给每块加范围后修好；`S8A-L8-chunk-scope` 用真实采用／修订触发，两个工作区各自抓取、各自 prepare。
- 旧的无范围块、记录范围和正文范围不一致、非 ASCII 和转义过的 id 都有纯编解码行，一例一个错误。
- 上限：每块 256 KiB、64 块，空块也计入；A-12 的 297／294 字节两例和 `needs 65 chunks; the limit is 64`；L8 的 500 字节例子 6／7 块。

## 准备和取消

- 从提醒读到最后 put，原 signal 已置位或依赖明确返回 cancelled 都以取消结束；覆盖上游缺输入事实、输入页、接续依据和 Turn 窗口、工作区 `resolveRoot`、会话依据窗口、装配器和 put 边界；没有取消结果的 port 只按 signal 判断。
- 准备好的抓取在返回处被取消仍然释放（P1）；清理不改写先前的错误（P2）；归档改过文件的读保留归档调用自己的取消（P3）：工作区、执行、Turn 三处 await 在 `:136`、`:173`、`:185`，之后在 `:144`、`:182`、`:186` 检查，`:123` 的 `readPreviousTurn` 直接返回、由 `:186` 兜底；lead 又在工作区退路 `:204` 的 await 之后、`:206` 补了一次检查。
- 归档组合层仍把取消的 facts 读成 unavailable（`session-archive.ts:244–248`），留 T。

## Codex 的审查和返工

| 次 | 结论 | 处理 |
| --- | --- | --- |
| 施工书检查（`codex/book1.out.md`） | 7 条必须改 | 触发入口要覆盖路由和 Workflow；幂等键加工作区；排队和水位、开始快照；状态层、事件和依赖；`unknown` 不能说成确定；失败接缝和时钟；WP2 的旧测试。都在施工前改。 |
| 施工书复查（`codex/book2.out.md`） | 3 条必须改 | 手动抓取不能把水位写小；驱动和观测入口共用同一份开始快照；状态层要求写成必然。都在施工前改。 |
| 实现审查（`codex/review1.out.md`） | 7 条必须改、建议若干 | 1、2、4、7 在返工 1 改完；3 的目录读失败已接上，开始读观测状态的漏口到返工 2 才补；5 仍有伪触发和直接读库断言，返工 2 继续；6 的公开变体和门控已有，读取计数到返工 3 才闭合。 |
| lead 的 bwrap 检查（`s8l8-1`） | 414 个文件、2 项失败 | 8 生产可达的 `architectureReminderRows`；9 Z01 的提交计数。成为返工 1 的第 8、9 项，改完。 |
| 复审（`codex/review2.out.md`） | 必须改 + UNSPECIFIED 6 是生产缺陷 | 6 块正文没有工作区范围，返工 2 修；开始读观测状态失败仍静默退出、抛出的取消被吞，返工 2 修；测试仍手写事实、12／21 只测 reader，返工 2 修一部分，读取计数到返工 3 才用调用计数闭合；真实组合回调仍进 T；建议的真实 Host 关闭和重启，返工 2 做 SQLite 行、返工 3 补内存行。接受 UNSPECIFIED 2、3、4、5、7。 |
| 全审（`codex/audit.out.md`、`codex/book3.out.md`） | 33/33 个文件；`KNOWN` 1–5、`T01`–`T71`、`P01`–`P16`、`S01`–`S12`、`Q1`–`Q6` | 冻结成返工 2 的表；决定 80 的账本和规则表从这一轮起每轮跑。 |
| 返工 2 核对（`codex/verify2.out.md`） | 90 个 id：61 修好、27 部分、2 没修；四个生产缺陷 B-1／B-2／B-3／C-1；11 条账本削弱；13 个新规则实例 | 返工 3 做剩下的行 A–K，四个缺陷按一种提交和取消的先后改。 |
| 返工 3 书检查（`codex/book5.out.md`） | 改条款 | 六点先后；准备取消的范围；重放行先记为 BLOCKED、等冻结入口（删除依据是返工 3 第 5 条和返工 4 第 2 条的最终裁定）；B／H 的完整位点；D 的场景分离；J 的因果。 |
| 返工 3 核对（`codex/verify3.out.md`） | 20 修好、13 部分；1 条账本削弱；17 个新规则实例；3 个生产缺陷 | 产品决定后只做与业务有关的三处（P1、P2、P3）和删行、恢复检查，其余进 T。 |
| 返工 4 书检查（`codex/book6.out.md`） | 三处行号和行为可闭合，OPEN 1 | P1／P2 的门控层级、P3 断言在 reader、D 的 15 个 case、R 的即时读都可做；P3 的断言层写清楚。 |
| 返工 4 核对（`codex/verify4.out.md`） | 4/5 修好、P3 部分；0 条账本削弱；2 个新规则实例；0 个新生产缺陷 | P3 的最后一个 await 由 lead 直接修（`checks/lead-fix.diff`）；两个新规则实例（手造健康探测）进 T。 |

## 测试

- A-03：四行主例、12→10＋省略行、`，不确定`、`还没有观测`、空段；纯函数和公开 `prepare` 都有，内存和 SQLite。
- A-04：登记两条路、初次采用、修订、PASS（Workflow 和公开定案）、重放不触发、没有目录的第一次抓取、失败后下一次触发和下一次 Host 启动、运行中的触发、关闭时排队、手动路由、手动／自动交错的水位、两个工作区串行、等待中合并、没绑定的请求不重试。
- PASS 三行：真实 Run 和检查；第一次 `PASS` 的原回执非重放、`requestSeq` 恰加 1、`check_passed`、`pending: false`、`current` 换新、`previous` 是旧 `current`；重放 `replayed: true`，序号、`current`、`previous` 不变。沙箱里只失败在缺 `/usr/bin/bwrap`；lead 的 bwrap 分轮检查 r1–r4 全过（r4：425 个文件、4,007 项过、5 项跳过）。
- 读取次数：指定夹具下的提醒依赖 12（5 + 7，12 个文件、6 块）和 21（6 + 15，第 13 个文件、7 + 6 块）；每轮 D1 都跑，D3 都是 0。返工 2 本轮 86 条，但 verify2 判 11 条是削弱；返工 3 本轮 21 条，verify3 判 1 条是削弱；返工 4 的 51 条全部归 D、0 条削弱。累计 15 条都是 `K1` 的范围改写。
- 没有调用真实模型。

## 已知限制

### 记不下来的后台失败

- `P01`–`P04`、`P10`、`S09`–`S11`：写请求、读请求记录、写失败、启动扫描读状态和登记后绑定出错时，这一轮可能没有记录；已有 pending 由之后成功的启动扫描或真实触发重试，没有 pending 时启动不保证恢复，工作区等下一个真实触发。这一轮不加新的诊断接口（`books/l8-rework-2.md` 第 3 条；`checks/l8-business-classification.md`）。
- `K2` 和 `P02` 是同一种“读失败不出声”的模式；开始读观测状态的失败已在返工 2 接上失败出口。

### 归档和读取

- 平台入口和读口的取消已经修好，但 `session-archive.ts:244–248` 仍把 runtime reader 的任何 rejected（含 `cancelled`）转成 unavailable facts；这是更下游的旧退路，留 T。
- P3 的两行只跑 SQLite：`tests/helpers/S1-runtime-scenario-fixture.ts:159` 固定在 `createTaskClaimFixture('sqlite', …)`；进 T。
- 8D 和 §10 段的已知限制不变（§12 和 8D 验收）；L8 不改扫描和清单，模块正文格式不变，文件图块的 v2 正文增加工作区范围。

### 没有测的、以及为什么

- **PASS 三行在沙箱里没跑成**：沙箱没有 `/usr/bin/bwrap`，只失败在缺它（三行、两后端，6 个用例）。lead 在有 bwrap 的环境跑了分轮检查，r1–r4 全过（r4：425 个文件、4,007 项过、5 项跳过）。
- **P3 的 lead 修没有再过 Codex**：按决定 80-4 的小修；`checks/lead-fix.diff` 只有三行加一行删。2/2 和 6/6 是返工 4、lead 补丁之前的运行结果；所给材料没有补丁后的运行结论。
- **P3 的两个新规则实例**（手造 `probe: { verdict: 'missing', activeRunId: null }` 交内部健康 owner、自己的归档组合）没有改成公开路径；按产品决定进 T，不是行为缺陷。
- **返工 3 的 UNSPECIFIED 2、3、4、5**：2 是 requeue 的逐 await 覆盖；3 是 lookup-miss 之后 late replay 的手造内部命令测试；4 是 fail 晚恢复的静态核对；5 是复制组合回调。2–5 进 T；J 的 `input = null` 是独立的一行，不属于这四项，也进 T；它现由 `context-assembler.ts:1056` 处理，恢复时可以直接绿。
- **没有公开步骤到得了的 replay 分支**：驱动的重试每次写新请求，从不重发旧命令；生产代码保留，测试进 T（见下）。`requestAutoCapture` 的 acceptance cancellation 也不可达；`failAutoCapture` 的 cancellation 可达，P06 覆盖一部分，其余在 T。
- **直接驱动检查的夹具**（`driveChecked`）检查通过后不等抓取；这次的 9 项用不着，有需要时照场景框架加。
- **没有真实模型**：所有模型都是脚本化或回放的；整个 MVP 仍未完成。

## 移到清理轮 T

- `requestAutoCapture`、`failAutoCapture` 和自动抓取的 replay 分支；没有公开步骤重发命令。
- `requestAutoCapture` 的 acceptance cancellation：驱动为每次接受新建 controller，从不 abort 它（`auto-capture-driver.ts:109`）。`failAutoCapture` 的 cancellation 可达：它用正在跑那一轮的 signal，Host 关闭会 abort；P06 已覆盖失败快照读取期间关闭（`tests/work-graph/S8A-L8-observation-state.test.ts:849`），其余行在 T。lead 的更正：返工 4 第 2 条把两者都写成不可达，对 `failAutoCapture` 不成立。
- 返工 3 的部分行 A：普通公开 prepare 缺的逐 await 取消证明（catalog／observed facts、服务 basis／latest／previous、独立 assembler 边界），以及 requeue 前置的逐 await 行；完整缺项见 `codex/verify3.out.md` 第 1 节 A 部分的逐 await 表（第 54 行起）。
- 返工 3 的部分行 B：触发要经真实的组合回调，测试复制了 wrapper；J：reminder reader 明确返回 `cancelled`、signal 未置位时的 `input = null`。
- 返工 3 的 UNSPECIFIED 4：fail 的晚恢复覆盖移除没有测试，快照守卫先回 `revision_conflict`。
- P3 行的手造健康探测、自己的归档组合和只支持 SQLite 的后端（`tests/helpers/S1-runtime-scenario-fixture.ts:159`）。
- 旧 WP2 的欠账 `K4-25`–`K4-53`、`T33`–`T69`、`Q6`。
- `host.ts:183` 的旧 NUL scope 键。
- `Pub:332` 写下的正文没有读回：只证明了真实 put 的调用次数，没有生产回滚。

## 合并全量查出的问题

- **第一次全量**（合并树 56f3bdc，5 个并行）：591 个文件里 11 个、46 项失败（`checks/merge-full-suite-1.txt`），全是重启场景（A4、A7、A8 六个文件、A10、C3、S1、场景框架自测）多了一条账本事件。原因在 lead 的任务书第 5 条：Host 每次启动都给还在等的工作区写一条 `startup_retry` 请求，没看租约；测试里抓取常在 Host 关闭时被取消，于是每次重启都多写。分轮检查只跑相关文件，没碰到这些场景。
- **lead 的修补 2**（`checks/lead-fix2.diff`，`src/app/host.ts` 三处，决定 81-6 的 lead 小改）：没有租约不接任何自动抓；启动重试再要 `automation.resumeOnStartup`（这一半是产品行为，Codex 复核要产品负责人确认；用户听完解释后选了这个方案，决定 82）。之后剩 9 项（`checks/after-fix2.txt`），都是“启动时自动续做”开着、抓取还没做完就重启。
- **测试改成先等抓取做完**（`checks/tests-settle.diff`，4 个测试文件 +46/−5，Claude 子 agent，决定 81-4 的真实重启测试）：见规格 §13.3。子 agent 跑了 97 个相关文件、644 项全过，类型检查通过；两项变异检查都失败在写明的断言上。
- **Codex 只读复核**（`codex/merge-fix.out.md`）：没有租约的写入路径都已封住（驱动只有一个，三个入口都受租约保护）；开关在设置恢复之后读，时机对；测试里的等待没有削弱断言，重启后多出的写入仍会超过之前的基线；P3 那一行对。1 条必须改：开关管不管启动补抓是产品决定，用户听完解释后选了“一起管”（决定 82）。另做的对照实验（保留租约检查、去掉开关条件）有 14 项重启测试失败，见 `checks/nogate-experiment.txt`。

## 合并和全量

- L8 单独合入；`checks/merge-stat.txt`（对 lead 分支 d6c6bd3e）是生产 21 个文件 +2,111/−118、测试 26 个文件 +6,468/−60、全部 48 个文件 +8,580/−178。
- 合并树（2b7f5be）的全量（`checks/merge-full-suite-summary.txt`）：591 个文件全过，8,741 项过、5 项跳过，2,612 秒，测试 scope 峰值 4.91 GB；类型检查、模块边界检查、构建都通过。第一次全量（56f3bdc）11 个文件、46 项失败；lead 修补 2 之后受影响的 34 个文件里 9 项失败；测试改成先等抓取做完以后全过。
- 有 bwrap 的分轮检查：`s8l8-1` 414 个文件、2 项失败（生产可达、Z01）；`s8l8-r1` 419／3,904 过、5 跳过；`s8l8-r2` 424／3,983 过、5 跳过；`s8l8-r3` 424／4,031 过、5 跳过；`s8l8-r4` 425／4,007 过、5 跳过。

## 模型

没有调用真实模型。
