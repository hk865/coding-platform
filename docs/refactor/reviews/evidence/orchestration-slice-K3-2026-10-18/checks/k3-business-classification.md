# K3 findings by business consequence (lead workflow, 2026-10-18; Chinese)

Each finding of the frozen K3 table (`k3-merge.out.md`) classified as behavior_bug (production does something wrong a person or agent can meet), protection_gap (no test guards a real business behavior), form_only (test form only; another real-path test guards the behavior) or hygiene (no visible consequence). A first analyst classified, a second checked against the code (copy at tag k3-g4b3-r8); `changes` are the second pass. The lead's decision from it is in book `k3-g4b3-rework-9b.md` §1 and §3.


## k3-prod — counts {"behavior_bug": 5, "protection_gap": 0, "form_only": 0, "hygiene": 20}

| id | category | area | consequence | confidence |
| --- | --- | --- | --- | --- |
| F-069 | behavior_bug | 重跑申请（命令识别） | 并发写入让 review 索引连续 3 次读不齐（not_ready）时，agent 调 request_command_rerun 会被答复“这条命令没被拦”（带 rewriteOf 时则被误报 invalid“不是这个任务的核对记录”），申请没发到人那里；agent 真去跑时仍会被 hook 拦下，所以不会无授权执行，只是误导 agent、浪费一轮。 | medium |
| F-070 | behavior_bug | shell 拦截 hook（识别失败放行） | 识别器一旦抛错或返回非 ready，hook 就放行，被拦命令（连原样重跑也算）会在人没允许的情况下执行；但今天真实识别器把 package.json 读失败都吞成 ready，只有意外异常才走到这条路，属于还没触发过的潜在失败放行。 | low |
| F-071 | hygiene | 执行准备接线 | 无业务后果 | high |
| F-072 | behavior_bug | 重跑申请卡答复落实（②读 Goal 抛异常） | 人答了重跑申请卡、答复已保存后，如果第②步读 Goal 时存储直接抛异常（只在磁盘读写出错这类情况下），人收到的是一个通用错误，而不是“已答、未落实”的结构化结果；加上 F-073，这条答复之后也不会被补上落实。 | low |
| F-073 | behavior_bug | 答复后的恢复与重驱 | 人在目标暂停时答复重跑申请卡（规格明确允许，第②步返回 busy），或答复后第②步失败、Host 崩溃，之后启动恢复和普通推进都只接手第②步已提交的答复，这条答复永远不会落实；请求一直停在“等答复”，agent 再申请只会被告知还在等，既不能重跑，人也以为自己已经答过。 | high |
| F-074 | hygiene | 接续说明里的拦截列表顺序 | 无业务后果 | high |
| F-075 | hygiene | review 分页读取 | 无业务后果 | high |
| F-076 | hygiene | 取消原因传递 | 无业务后果 | medium |
| F-077 | hygiene | Workflow 旧字段 failedReviewRefs | 无业务后果 | high |
| F-078 | hygiene | 重跑申请卡的读取 | 无业务后果 | high |
| F-079 | hygiene | 命令展开返回值 | 无业务后果 | high |
| F-080 | hygiene | 重跑申请状态规则副本 | 无业务后果 | high |
| F-081 | hygiene | 注明写法数量上限 | 无业务后果 | high |
| F-082 | hygiene | blockedCommands 缺省值 | 无业务后果 | high |
| F-083 | hygiene | UTF-8 截断实现重复 | 无业务后果 | high |
| F-084 | hygiene | 答复身份重复计算 | 无业务后果 | high |
| F-085 | hygiene | 未用参数 | 无业务后果 | high |
| F-086 | hygiene | 过时注释和多余类型转换 | 无业务后果 | high |
| F-087 | hygiene | 过时注释 | 无业务后果 | high |
| F-088 | hygiene | 动作比较键重复实现 | 无业务后果 | high |
| F-089 | hygiene | 字段谓词重复定义 | 无业务后果 | high |
| F-098 | hygiene | 同一时刻请求的排序 | 无业务后果 | high |
| F-099 | hygiene | review 记录解码校验 | 无业务后果 | high |
| F-100 | behavior_bug | Goal 变更后的答复落实 | 人在旧的 Goal 内容下点了“允许重跑”，如果落实被推迟、期间 Goal 内容被改了，平台仍照旧放行，而 UCR 卡同样情况会要求人重新决定；今天第①步会核对 Goal，②紧跟着①执行，只有同一请求重试这类窄路径能遇到，F-073 修好、答复改为在恢复时落实后才会成为常见情况。 | low |
| F-101 | hygiene | Kernel 命令读取窗口 | 无业务后果 | high |

### Second-pass changes

- **F-072**: behavior_bug / medium → behavior_bug / low. 类别不变。要走到这里，readGoal 必须真的抛异常，而不是返回拒绝结果。SQLite 的 readMany 只在磁盘读写出错、或连接已关闭时抛；关闭前 create-platform.ts:1107 的 trackedCall 会先等进行中的调用做完，所以关闭时撞上的情况也排除了。F-072 自己的后果只是回复从结构化结果变成通用错误（不一定是 500，我没查到路由怎么映射异常）；“落实丢了”是 F-073 的后果，不该重复算。
- **F-100**: behavior_bug / medium → behavior_bug / low. 类别不变。decision-source-facts.ts:787-880 在第①步就按当前 Goal 核对卡的 pins 和 goalBases；②在 decision-actions.ts:284 紧跟着①执行。所以今天只有两种情况能碰到：带同一个 requestId 重试，或者在①和②之间的极短窗口里并发改 Goal。暂停时②返回 busy 之后，没有任何路径再去落实（F-073），F-100 也就没机会触发。它实际上是修 F-073 时必须一起做的守卫。
- **F-069**: consequence 未提 rewriteOf 情况 → consequence 补充：带 rewriteOf 时被误报 invalid. 类别和置信度不变。command-rerun-request-service.ts:758 把非 ready 降成 []；带 rewriteOf 时，resolveRewriteOf（:583-604）在空集合上返回 invalid“不是这个任务的核对记录”，同样是误导。我核实了 not_ready 确实可达：listReviews 对每个状态各查一次（7 次，unknown-call-review-service.ts:1484），任何两次之间有写入提交，水位就对不上，连续 3 次对不上就返回 not_ready（:1512-1538）。
- **F-098**: hygiene / medium → hygiene / high. 类别不变。要结果不同，同一别名必须有两条请求的 createdAt 相同到毫秒。可是同一别名有未完的请求时不能再建新的：command-rerun-request-service.ts:834-848 会直接返回已有的 pending/allowed。第二条请求一定在人答复或允许被用掉之后才建，真实时钟下到不了。
- **F-101**: hygiene / medium → hygiene / high. 类别不变。读到一半就返回的部分结果，只会让某个 callId 查不到，不会给出错的命令。三个消费者查不到时都拒绝：unknown-call-review-service.ts:222、decision-source-facts.ts:855-858、decision-read-model.ts:647-651。review prepare 本来就退回摘要。修了以后，人和 agent 看到的结果一样。
- **F-074**: hygiene / medium → hygiene / high. 类别不变。context-assembler.ts:1409/1443 是先按记录排、再按别名排，另外两处是全局按 (createdAt, 别名) 排。两种排法只有在同一任务的两份核对记录 createdAt 相同到毫秒时才不同。同一任务前一份核对没结束，就不能领取新的 Run（L11），所以真实使用到不了；而且 hook 和 owner 用的是同一个识别器，谁先命中不受这里影响。

### Notes

复核结论：没有改类别，25 行全部保留。前一位分析员的判断大体站得住；我改了几行的置信度，把 F-069 的后果写完整，另外把“5 条业务问题”里分量不同的几条拆开说。

总数：25 行生产项。5 行 behavior_bug（F-069、F-070、F-072、F-073、F-100），20 行 hygiene（修与不修，人和 agent 看到的行为一样）。都是生产行，所以没有 protection_gap 或 form_only。

这 5 条按今天能不能真实碰到排：
- F-073 是唯一在正常使用里就会碰到的。规格 slice-K3-SPEC.md:536 写明“目标暂停时可以答、落实等继续”。可是答复后第②步返回 busy（decision-actions.ts:467 记成 awaiting_resume），之后没有任何代码再去落实：
  - CRR 的恢复读口 unknown-call-review-answers.ts:201-207 只留第②步已提交的答复；
  - 启动恢复 startup-reconcile.ts:543-556 只做“第 4 类”交接，没有 UCR 那样的“第 3 类”（:497-519，按记录状态找出“已答、未落实”的卡）；
  - 全仓只有 startup 会把 CRR 答复交给 Workflow。
  结果是请求永远停在 pending：agent 再申请只得到“还在等”，人以为自己答过了。
- F-069：只在负载高、有并发写入时才会碰到，后果是误导 agent，不会让命令无授权执行。hook 按记录逐份读（execution-driver.ts:449-458），不走 listReviews，照样能拦。
- F-072：要存储真的抛异常（磁盘读写出错）才会碰到。它自己的后果只是回复不规范；答复丢失是 F-073 的后果，不该算两次。
- F-100：今天①会先核对 Goal，②紧跟着执行，只有同一请求重试才碰得到。它实际上是修 F-073 时必须一起加的守卫，应该和 F-073 一起看。
- F-070：今天的真实识别器不会抛错，也不会返回非 ready（command-recognition.ts:63-80 把读失败都吞了，expandShellScripts 写明不抛），所以是没触发过的失败放行。不过它守的是“命令没经人允许就执行”这条安全线，而且 B2-02 测试（:189-195）把放行写成了预期，所以我仍归 behavior_bug，置信度 low。如果 lead 要严格按“真实使用能碰到”算，它最接近“潜在安全缺口”，可以单列。

对用户问题的直白回答：不是都和业务相关。25 条里 20 条是代码卫生。5 条和业务有关，其中真正在正常使用里会碰到的只有 F-073；F-069、F-072 要罕见条件；F-100 要等 F-073 修完才常见；F-070 今天碰不到，是安全上的潜在风险。

20 条 hygiene 我逐条按“有没有被低估”查过，没有发现会改变人或 agent 看到结果的：
- F-071：正式组装 create-platform.ts:1185 总会接上 reader。
- F-075：create-platform 那份分页没有防停滞，但 owner 的游标是严格递增的。
- F-076：取消被报成 unavailable，但各处都是不写入、直接拒绝；Workflow 只是等待理由的文字不同。
- F-077：driver 读的是 failedCardRefs（collaboration-driver.ts:818-832），旧字段只是输出。
- F-080、F-081：owner 和状态层的规则、上限都一致（都是 8）。
- F-099：owner 在 unknown-call-review-service.ts:689 已经拒绝 cwd=''。

k3-arch.out.md 第 6 节点名的两条生产问题，就是 F-070（execution-driver.ts:533/536/537）和 F-073（unknown-call-review-answers.ts:201/206/207），代码行相同，不另算。

另外一条不在本批 id 里、但我核实了代码的（前一位分析员也提过，P 审计的 M06）：
- command-recognition.ts:142-153 只返回第一条命中；
- owner 在 command-rerun-request-service.ts:786-788 拿 rewriteOf 跟这一条比，不一致就回 invalid rewrite_of_mismatch；
- 规格 :539 写的是“rewriteOf 在命中的那几条里就用它”。
这是真实的行为偏差：一条命令同时命中两条被拦命令时，agent 注明的是后一条，会被误拒；改成不注明，卡就挂在第一条名下。它没进冻结表，建议 lead 决定要不要补成一行。

## k3-tests-1 — counts {"behavior_bug": 0, "protection_gap": 7, "form_only": 27, "hygiene": 0}

| id | category | area | consequence | confidence |
| --- | --- | --- | --- | --- |
| F-001 | form_only | 核对卡测试世界 | 无业务后果 | medium |
| F-002 | form_only | shell 替身 | 无业务后果 | medium |
| F-003 | form_only | 接续 Run 共享夹具 | 无业务后果 | medium |
| F-004 | form_only | 接续说明读取 | 无业务后果 | high |
| F-005 | form_only | 核对/方案流程造态 | 无业务后果 | medium |
| F-006 | form_only | 拦命令钩子 | 无业务后果 | medium |
| F-007 | form_only | 401 条请求读取上界 | 无业务后果 | medium |
| F-008 | protection_gap | 重跑请求卡上的记录前缀 | 测试里提出重跑请求的 Run 就是被核对的 Run，而真实使用中请求来自后来的接续 Run；若卡上的 #别名@前8位 误取了请求方 Run 的 ID，人看到的卡会指向错的 Run，测试照样通过（agent 看到的拦截提示和“同一轮不允许”判断不受影响）。 | medium |
| F-009 | form_only | 跳过后记录拦下的命令 | 无业务后果 | medium |
| F-010 | form_only | 重跑请求写法 | 无业务后果 | high |
| F-011 | form_only | rewriteOf 前缀 | 无业务后果 | medium |
| F-012 | form_only | 归档异常锚点 | 无业务后果 | medium |
| F-013 | form_only | 认定后的事实来源 | 无业务后果 | medium |
| F-014 | form_only | 纯函数夹具归类 | 无业务后果 | high |
| F-015 | form_only | Workflow 核对行 | 无业务后果 | medium |
| F-016 | form_only | 核对路由 | 无业务后果 | high |
| F-017 | form_only | 放开后重排 | 无业务后果 | high |
| F-018 | form_only | 任务事实读不出时的“我来处理” | 无业务后果 | medium |
| F-019 | form_only | 沙箱能力探测 | 无业务后果 | high |
| F-020 | protection_gap | 重启后补落实重跑答复 | Host 崩溃前人已答复重跑请求卡、但落实没补记时，重启后把这条答复交回 Workflow 只在手拼的启动平台上测过；正式组装里这个读口是可选项，漏接也不报错，这张卡会一直停在“已答待落实”，测试发现不了。 | medium |
| F-021 | protection_gap | package.json 脚本展开 | 所有拦命令测试都用内存里的假文件读取器，没有一条用真实工作区文件走正式读取器；若正式接线下读 package.json 被拒，脚本展开会静默丢失，`npx prisma migrate deploy`、`npm run migrate:prod` 这类经脚本才认得出的写法不被拦而直接跑（原命令和直接动作照样拦），测试发现不了。 | medium |
| F-022 | form_only | 允许一次的消耗 | 无业务后果 | high |
| F-023 | form_only | 重跑卡摘要 | 无业务后果 | high |
| F-024 | form_only | 重跑事件形状 | 无业务后果 | high |
| F-025 | form_only | 断言读取途径 | 无业务后果 | medium |
| F-026 | protection_gap | 重跑请求卡和拦截兜底文案 | 重跑请求卡的三个选项文字、卡上的固定说明句，以及给 agent 的两句兜底提示（确认不了拦没拦、确认不了允许），期望值都直接引用代码常量，全库没有一处按规格原文核对，文字改错测试照样通过；只影响文字。 | medium |
| F-027 | form_only | 纯规则测试 | 无业务后果 | high |
| F-028 | form_only | 请求重跑的读取上界 | 无业务后果 | medium |
| F-029 | form_only | 每次调用只识别一次 | 无业务后果 | medium |
| F-030 | form_only | 解析不了的命令整条拦 | 无业务后果 | medium |
| F-031 | protection_gap | 多份记录时更早的生效 | 同一任务有两份核对记录都拦同一条命令（例如两次崩溃都选了跳过）时，规格要求更早那份生效；测试里两份创建时间相同、Run ID 顺序恰好也对，删掉按创建时间排序照过；实际 Run ID 是随机的，拦截提示和重跑请求会有约一半机会挂到较新那份，提示里的 #别名@前缀 和处置说明指错记录。 | medium |
| F-032 | protection_gap | 重跑请求分页 | 一个任务的重跑请求超过 200 条、需要翻页时，若后几页里的“允许”或“别再问”被忽略，人的答复不生效（该放行的照拦，说了别再问的又出卡）；现有 401 条的测试只数了页数，而且 401 条全是“不允许”，结果不依赖后几页。这种规模实际极少见；核对卡分页（K3-20）的内容已经逐张核对，不在这个缺口里。 | low |
| F-033 | protection_gap | 核对轮启动准入 | 核对轮已领取、还没开始时 Host 重启，并且这个工作区的只读命令开关被关掉：Workflow 的 UR3a 不会再查能力，直接重新 prepare 并 start，只有 prepare/start 里的准入能挡住（开关不改配置版本号，版本号检查挡不住）；这道准入没有任何拒绝用例，删掉也照过，核对轮可能仍用上人已关掉的只读命令。 | medium |
| F-034 | form_only | 重启重驱第 2 种 | 无业务后果 | high |

### Second-pass changes

- **F-018**: protection_gap (low) → form_only (medium). unknown-call-review-service.ts:983-985：读失败分支要是删掉，下一行取 projection.value 会抛错，照样什么都不写，人看到的只是报错而不是干净的拒绝，没有数据或安全后果。同组其余实例（readReviewDisplays 固定 full、空卡来源）有真实 Host 场景兜着：K3-42 截断、K3-20 分页。
- **F-028**: protection_gap (medium) → form_only (medium). 请求工具只能经 owner 的端口读存储，B2-03 已在 listTaskReviews 上计数；B2-16 在钩子的端口上计数，B2-15 用真实 Kernel 重放。漏网的多余读取，最坏是每次调用多读一页，人和 agent 都感觉不到。规格里写了读取上界，但违反它没有业务后果，属于计数位置的规则问题。
- **F-034**: protection_gap (medium) → form_only (high). S/K3-44-hold-restart.test.ts（二）在真实 SQLite Host 上崩溃重启，记录是 resolved+held+activeRound，并断言 redriveGoals 交出这个任务。startup-reconcile.ts:239-243 里，第 1 种排除 held 和 resolved，所以只有第 2 种能产生这个结果；删掉第 2 种，这个测试会失败。K3-29 第 12 行（领取未进入、被取消后崩溃）同样只靠第 2 种。原分析说“删掉照过、任务会卡住”不成立。
- **F-008**: protection_gap，后果写成 agent 按卡上前缀注明改写会对不上 → protection_gap，后果改为人看到的卡指向错 Run. 卡上的 #别名@前8位 给人看（command-rerun-request-card.ts:161）。agent 看到的拦截提示取自 binding（execution-driver.ts:485），不受影响。按请求方 Run 判断的“同一轮不允许”（command-rerun-request-service.ts:864-865）在 B2-05 里用了不同的 Run，已经守住。全库只有 B2-07 断言卡文字，而它的请求方就是被核对的 Run，缺口确实存在。
- **F-020**: protection_gap，后果泛指重跑答复 → protection_gap，后果补充：正式读口是可选项，漏接不报错. create-platform.ts:1963 接了 readCommandRerunRequestAnswers，但 startup-reconcile.ts:122 的类型里它是可选项。B2-09b 重启时 problems 为空，只证明接上了不报错，没证明交回了答复。核对卡（UCR）的第 3、4 种在真实 Host 重启里有测：K3-29 第 5 行、variant (b)。没测到的只有重跑请求卡（CRR）这一种。
- **F-026**: protection_gap，只写了卡上三个选项和固定句 → protection_gap，补上给 agent 的两句兜底提示. grep 确认：允许重跑、允许只放行这一种写法、暂时确认不了允许、平台暂时确认不了这条命令，在 tests 里都没有字面出现。同一条里的 commandSha256 期望值不算缺口，ST/command-normalization.test.ts:39-42 用 node:crypto 独立钉住了；decisionSourceKey 也只是同一函数在两边保持一致，这两部分都只是形式问题。
- **F-031**: protection_gap，后果写得笼统 → protection_gap，后果写具体. command-recognition.ts:46-52 先按 createdAt 排，再按别名和 refKey 排。测试里两份记录都用 T 时刻，runId 是 aaaaaaaa-0000… 和 aaaaaaaa-1111…，删掉 createdAt 比较顺序仍然对。生产中 runId 是随机 UUID，会排错。拦截提示带有处置说明（execution-driver.ts:485 一带），所以挂到错的记录时提示内容也会跟着错。
- **F-032**: protection_gap (medium) → protection_gap (low)，后果改写. K3-20 逐张比较了 5 张卡的 key，后页内容是验过的，原分析说“没验后面页的内容”对它不成立。缺口只剩 B2-401：401 条全是 denied，钩子的结果不依赖后几页；另有 K3-15 按任务列表时每个任务只有一份记录。要触发需要一个任务有 200 条以上请求，实际极少见。
- **F-033**: protection_gap，场景写成排队期间人关掉授权 → protection_gap，场景改为领取未进入时重启并关掉开关. workflow.ts:1406-1413 的 UR3a 对领取未进入的核对轮直接 prepare，不查 reviewCapability。只读命令开关在 runtime-configuration.ts:448-452 收窄配置，不改 configurationRevision，所以 execution-driver.ts:821 的版本号检查挡不住，真正挡的只有 create-platform.ts:498 和 execution-driver.ts:831 的准入。K3-19 的场景只覆盖 Workflow 开轮前那道检查，这两处准入的拒绝没有任何测试。

### Notes

结论：F-001 到 F-034 全部是测试侧的问题，没有一条是生产代码已经做错（behavior_bug 0、hygiene 0）。复核后 protection_gap 剩 7 条：F-008、020、021、026、031、032、033；form_only 27 条。和第一位分析相比，改了 3 条分类：F-018、F-028、F-034 从 protection_gap 改为 form_only；另有 5 条分类不变，只改了后果写法或置信度（F-008、020、026、031、032 降为 low、033）。没有发现被低估的条目：凡是被判 form_only、看起来可能漏掉业务的，都在仓库里找到了真实 Host 或真实 Kernel 的测试兜着。

按业务轻重排这 7 条：
1. 和“命令未经许可就跑”沾边的有两条。F-021：脚本展开从来没有用真实文件和正式读取器测过；它只丢展开这一层，原命令和直接动作照样拦。F-033：重启后 UR3a 重新 prepare 核对轮时不查能力，只有准入挡着，而准入没有拒绝用例；涉及的是只读命令。
2. 人看到的卡或提示可能错，有 3 条：F-008（卡上前缀指向请求方 Run）、F-031（多份记录时挂到较新那份）、F-026（文案没按原文核对，只影响文字）。
3. 重启后漏补落实，1 条：F-020，只缺重跑请求卡这一种；核对卡的第 3、4 种已在真实 Host 重启里测过。
4. 只在极端规模出现，1 条：F-032，一个任务要有 200 条以上重跑请求才会触发。

判 form_only 的主要依据，以下都已读过代码核实：
- 拦截和放行的真实链路：B2-09b（真实 SQLite Host，真钩子拦截、请求工具、公开答复、消耗、崩溃重启）；B2-09a（钩子层消耗提交失败时照拦）；B2-15（真实 Kernel 重放）。
- 只读命令用不了：K3-19 两个场景都走真实 Workflow，零模型调用。
- 方案、截断、留卡：K3-16、K3-42、K3-15、K3-18 的场景都用真实 Host。
- 重启重驱：K3-44（二）和 K3-29 第 5、12 行、variant (b) 都在真实 Host 上崩溃重启。
- 失败卡集合：K3-UR7 用真实 collaboration driver 跨步传递。
- 规则问题：F-013 注入的 Kernel 事实经 agentEventSchema 校验并走 store.append，不是手写记录；F-027 的 commandSha256 在 ST/command-normalization.test.ts:39-42 有独立字面期望。

仍要说明的：F-001 到 F-013 这类 helper 有 92 个调用方，我没有逐一核对，只核对了它们要证明的业务行为是否另有真实链路兜着。全程只读：没有修改任何文件，没有运行测试。代码在 D:\cxt\k3-audit（tag k3-g4b3-r8）。

## k3-tests-2 — counts {"behavior_bug": 0, "protection_gap": 13, "form_only": 29, "hygiene": 0}

| id | category | area | consequence | confidence |
| --- | --- | --- | --- | --- |
| F-035 | protection_gap | 崩溃后补落实重跑答复 | 人对命令重跑卡作答后，如果在落实（③）之前崩溃，重启后应由 Workflow 拿交来的答复自动补上；两个测试都直接调 advanceReviewDisposition，而 Workflow 的这条路径（按答复算请求号、用 Host 身份记③，见 workflow.ts:2720-2790）只在 K3-UR7-crr-failed-set 里测了②失败，成功补落实没测，坏了时人的答复可能一直停在“已答未落实”。 | high |
| F-036 | form_only | 拒绝输入的测试分组 | 无业务后果 | medium |
| F-037 | form_only | 被拦命令记录大小计量 | 无业务后果 | low |
| F-038 | form_only | 删除自证或冗余测试 | 无业务后果 | high |
| F-039 | form_only | 接续说明格式回归 | 无业务后果 | medium |
| F-040 | protection_gap | 暂停目标的决定队列 | 测试里的 control() 只生成请求体、从没发出（tests/scenarios/support/control.ts:106），目标根本没暂停；暂停期间人能否在队列里回答核对卡、且不出现“确认自动重排”卡，在队列这一层没被测到，坏了时人可能暂停时答不了核对卡，或在核对没定之前就确认一张自动重排卡（纯规则 pausedAutomationAction 本身在 state 测试里有守护）。 | high |
| F-041 | protection_gap | 崩溃认定与核对记录同一次提交 | 判定 Run 崩溃时，Run 结束和核对记录必须同一次提交；测试只读最后结果，如果以后拆成两次提交而中途又崩溃，会留下一个没有核对记录的崩溃 Run，按“没有记录就不拦”的规则任务会被接着领取，结果不明的命令可能在人决定前被重跑（生产目前在 run-machine 里是同一次提交）。 | high |
| F-042 | protection_gap | 核对未定时的领取门 | 人把核对还没定的任务重新排队后，新 Run 仍要等核对结论，测试却没有接着去领取，这道门坏了时新 Run 可能在人做决定前就开跑；K3 之前崩溃、没有核对记录的任务能否正常接续，测试接受任何拒绝，也没被证明。 | high |
| F-043 | form_only | 核对记录读不出时的自动化判定 | 无业务后果 | high |
| F-044 | protection_gap | 解除保留后崩溃重启 | 人点“解除保留”后、重新排队前，如果 Host 真的崩溃重启（启动时会跑恢复和重驱），是否仍然只接续一次没被测到，测试用暂停目标冒充了崩溃；重启流程如果多排一次或丢掉接续，测试发现不了。 | medium |
| F-045 | protection_gap | 核对轮收尾与重复记账 | 人先落实卡片、Workflow 随后再补落实时，会不会多记一笔“已落实”没被测到（提交计数的基线在 Workflow 落实之后才取）；迟到启动被拒后的取消收尾只测到计划出取消这一步。影响主要是重复记账，不会重复执行命令。 | medium |
| F-046 | form_only | 纯函数测试归位 | 无业务后果 | high |
| F-047 | form_only | 损坏核对记录的失败即关 | 无业务后果 | medium |
| F-048 | form_only | 回执重放 | 无业务后果 | medium |
| F-049 | form_only | 前置状态的建立方式 | 无业务后果 | high |
| F-050 | form_only | 已关闭重跑请求卡的读取 | 无业务后果 | medium |
| F-051 | form_only | 文件变化后旧批注失效 | 无业务后果 | medium |
| F-052 | form_only | 任务关闭对重跑请求的影响 | 无业务后果 | medium |
| F-053 | form_only | 测试命名与覆盖登记 | 无业务后果 | high |
| F-054 | protection_gap | 两种存储后端 | 不少命令拦截、放行、重放的测试只在内存后端跑，部分 K3 测试只在 SQLite 跑；K3 新加的按来源、按任务的查询如果在另一种存储上表现不同，这些行发现不了。按任务列表已有两后端测试，SQLite 上也有拦截和放行的场景（B2-09-allowance-crash、B2-16-hook-reads、B2-09b），所以概率低。 | low |
| F-055 | form_only | 测试超时 | 无业务后果 | high |
| F-056 | form_only | 多条目核对记录的字段 | 无业务后果 | medium |
| F-057 | form_only | 多条目接续说明的行和顺序 | 无业务后果 | medium |
| F-058 | form_only | 文件改动后重新批注 | 无业务后果 | medium |
| F-059 | form_only | 多条目处置目标推导 | 无业务后果 | medium |
| F-060 | form_only | 混合条目审批摘要 | 无业务后果 | medium |
| F-061 | form_only | 多方案保存与顺序 | 无业务后果 | medium |
| F-062 | form_only | 极端核对输入裁剪 | 无业务后果 | medium |
| F-063 | form_only | 核对输入拼接与摘要格式 | 无业务后果 | medium |
| F-064 | form_only | 命令摘要长度边界 | 无业务后果 | medium |
| F-065 | form_only | 接续说明极端输出 | 无业务后果 | medium |
| F-066 | protection_gap | 接续说明超容量拒绝 | 接续说明的必需内容超过 16 KiB 时，准备步骤应返回 capacity、不删必需内容；纯渲染抛错仍有测试，但准备步骤把它转成拒绝（context-assembler.ts:1702）只测了一个装得下的小例子，这一处坏了时准备会直接抛错，测试发现不了。要 8 条锚点、任务 ID 600 字节才达到，真实使用能否达到等 Q-06。 | low |
| F-067 | protection_gap | 方案理由的预算准入 | 核对记录的可选文字预算是 158,720 字节（不是 512 KiB），只有变动路径样本极长这类极端情况才接近；到那时方案 agent 写长理由应被 capacity 拒绝、记录不变。现在 recordProposal 这一处的准入只在纯函数里测了边界，owner 没接上时测试发现不了，记录会占用给后面必需写入预留的空间。能否真实达到等 Q-06。 | low |
| F-068 | form_only | 期望值来源 | 无业务后果 | high |
| F-090 | form_only | 核对轮只读工具 | 无业务后果 | medium |
| F-091 | form_only | 大量改动时的工作区基线 | 无业务后果 | medium |
| F-092 | form_only | 核对准备 | 无业务后果 | medium |
| F-093 | protection_gap | 工作上下文装配（旧片） | （旧片 S3，已移出本轮）CA15 把扩展读取异常转成 unavailable 的是测试自己的替身，生产这一层如果被删或改成当作空列表，工作 agent 会在缺了注记、异常锚点和待决定事项的上下文里开工，测试发现不了；CA13 检查“目标和问题不进 system prompt”查的是测试自己的配置对象，也是空检查。 | low |
| F-094 | protection_gap | 注记进入 agent 上下文（旧片） | （旧片 S4C2，已移出本轮）agent 上下文里有三条没被真正测到：注记去重、零预算时项目规范不被可选预算挤掉、过期理解只出一行警示且不漏正文；坏了时 agent 可能读到重复注记、丢掉项目规范，或看到不该当结论的过期正文。 | medium |
| F-095 | protection_gap | 上下文固定文字（旧片） | （旧片，已移出本轮）工作 agent 上下文开头的固定说明和各段标题，期望值直接取自生产常量，常量被误改（比如删掉一句给 agent 的规则）时期望跟着变，测试发现不了。 | low |
| F-096 | form_only | 计划中未来任务的上下文 | 无业务后果 | medium |
| F-097 | protection_gap | 重跑请求卡不重新展开 | 卡片应该展示请求时记下的命中和展开，不能按当前 package.json 重新算；测试既没改文件也没数读取次数，卡片如果改成重新展开，人在卡上看到的命中说明或脚本可能和请求时记录的不一致，测试发现不了。生产代码目前是对的。 | medium |

### Second-pass changes

- **F-037**: protection_gap / low → form_only / low. blockedCommandsBytes 只决定被拦命令清单 16 KiB 的自限。串行 Kernel 下一份记录最多一条被拦命令，真实 package.json 脚本远小于 16 KiB；清单在接续说明和清单里只带 alias、reviewRunId、commandSha256，必需写入另有 365,536 字节预留。计量漏一个字段，没有人或 agent 能看到的后果。测试写法确实弱（一次改多个字段只比大小），属于测试形式问题。
- **F-058**: protection_gap / medium → form_only / medium. 丢掉的三项别处都有守护：文件批注被接受的路径由 K3-15-disposition-effects 的批注行（:375-419，真实卡片、真实对象 key、applied）覆盖；改文件后重读卡片得到新摘要仍在 K3-18-review-card-queue:484 断言；workspace.status='captured' 在 K3-26-unknown-call-review-storage:607 和 K3-R1 场景里有断言；不带附言的“照原样重跑（卡上选的）。”只是格式变体。找不到一种只坏“改文件后重新批注”、而这几处都不报的真实故障。
- **F-065**: protection_gap / low → form_only / medium. 丢掉的断言全是公共步骤到不了的极值（32 条、8 个锚点、16 位略去数、T512/T600），文件注释自己写了“Public steps cannot create”。必需核对段仍逐字比较（renderer-boundary:155），T600 渲染抛错仍有测试。“整份输出不含 callId”不是规格要求：规格 557 行写明完整 callId 可以出现在非必需的正文行里，只有必需部分要按别名写。
- **F-067**: protection_gap / medium → protection_gap / low. 类别不变，降低把握。可选文字预算 B 是 158,720 字节（unknown-call-review.ts:39）；一条条目的真实记录只有在变动路径样本极长时才可能接近 B−2000，测试文件自己写了 near-boundary 记录“没有公共路径能到”。同一 owner 的 recordConclusion 已用接近预算的记录测到 capacity，recordProposal 的边界算术也有纯函数测试（:405）；没测到的只是 recordProposal 这一处有没有接上准入。和 F-066 一样，是否算业务问题取决于 Q-06。
- **F-093**: form_only / low → protection_gap / low. 20 处里大多是替身输入（F1/F4），但有两处是空检查，不只是形式问题：CA15（S3-context-assembler:568-581、:826）把扩展读取异常转成 unavailable 的是测试自己写的 graph-context 替身，删掉生产这层处理，测试照样通过；CA13（:808-810）检查的是测试自己的配置对象和常量，生产把目标或问题写进 system prompt 也不会失败。G3 审查（k3-audit-G3.out.md:146-147）也把这两处记为 F11。按主效果归保护缺口，属于旧片，把握低。

### Notes

复核结论：42 条里没有一条是生产代码已经做错的事，behavior_bug 和 hygiene 都是 0。改动后保护缺口 13 条，纯形式 29 条（原来分别是 15 和 27）。改了 5 条：3 条从保护缺口降为纯形式（F-037、F-058、F-065），1 条从纯形式升为保护缺口（F-093），1 条保持保护缺口、只降低把握（F-067）。

和业务直接相关、把握大的仍是这四条，第一位分析员没有夸大：
- F-035：Workflow 用交来的重跑答复补落实。这条路径只测了②失败，成功的情况没有测。另外，生产问题 F-073 说启动恢复会漏掉“②还没做完”的答复，两者叠在一起，这条链现在保护最弱。
- F-040：测试里的 control() 只拼了请求体，没有发出去（tests/scenarios/support/control.ts:106），所以目标从来没被暂停。纯规则 pausedAutomationAction 在 tests/state/k3-failure-classification.test.ts:104 有守护，没守护的是队列这一层的接线。
- F-041：生产目前在 run-machine 里是同一次提交（run-machine.ts:823），出问题的可能不大，但一旦拆开，后果是结果不明的命令可能被重跑。
- F-042：人重新排队之后到领取之间这道门没测；“没有记录就不拦”那一例接受任何拒绝，也没证明。

降级的理由：
- F-065：丢掉的断言全是公共步骤到不了的极值。“整份输出不含 callId”也不是规格要求，规格 557 行允许 callId 出现在非必需的正文行里。
- F-058：丢掉的三项在别处都有守护，找不到一种只坏这一项、别处都不报的真实故障。
- F-037：只影响被拦命令清单自己定的 16 KiB 上限，没有人或 agent 能看到的后果。
- F-067：可选文字预算其实是 158,720 字节，不是 512 KiB。一条条目的真实记录只在路径样本极长时才可能接近，F-066 和 F-067 是不是业务问题都要等 Q-06 裁定。

升级的理由：
- F-093：虽是旧片，但 CA15 的异常转换写在测试替身里，CA13 查的是测试自己的配置对象，这两处是真正的空检查。与 F-094 合起来看，旧片 S3/S4C2 的上下文装配有实打实的保护缺口，只是已移到后面的清理轮。

同意第一位分析员的几点：
- F-056 到 F-062 针对多条目或混合种类的记录。串行 Kernel 产生不了这种记录（K3-06、K3-13 场景文件的注释和裁定 2 都写明），所以归纯形式。
- F-036 里被第二个错误盖住的四项是兜底检查，各自后面还有别的检查：33 条、L3 种类、513 字节 callId 校验的是平台自己生成的草稿（create-platform.ts:2042-2076，公共路由只收 runRef 和原因）。关闭卡上的答复，owner 还会读一次任务是否关闭并回 busy，状态机也拒绝从 closed 作答，三层兜底。
- F-090 到 F-092 的工具列表、空写入范围、sessionBasis 在真实场景里都有断言（K3-05、K3-12-14、K3-16、K3-42、K3-27）。F-091 本来就用了真实的 2001 个工作树改动。

在范围内（不算 F-093 到 F-096）真正和业务相关的保护缺口共 10 条：F-035、F-040、F-041、F-042、F-044、F-045、F-054、F-066、F-067、F-097。其中 F-054 把握低；F-066、F-067 能不能真实达到等 Q-06；F-045 的后果只是可能重复记一笔已落实。
