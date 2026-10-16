# K3 片规格（第八稿，已冻结）：结果未知的工具调用，按种类核对；重启后自动收尾

> **状态：已冻结（K3 第八稿，含 K8-6、K8-7；2026-10-16）。** 按决定 68 加静态解析和改写申请（lead 的 K8-1–K8-4），lead 审稿补了 K8-6，Codex 做了一次只看改动的核对（决定 64-6 的例外），lead 按它的 11 条裁定 K8-7 改完后冻结。第二版到第六版的审查对照见 §9.1–§9.4；第七稿的改动对照和代码事实重核见 §9.5；第八稿的改动对照见 §9.6。测试入口见 §5.1（含 D11 的拆分）。
> - 依据：
>   - HANDOFF 决定 45、51、52、53，10-03 的 D-4（U-4）；
>   - STATE-MACHINES-SPEC 的 RUN-08、RUN-16..RUN-24、SES-06、SES-07、SES-13、§12.1、§12.8 HL-01..HL-07、§4 TD-9（AV 表）；
>   - K 片规格（已冻结，含 §9 M1–M12）、第 5 片规格（决定卡、落实）、2A 片规格（队列来源、不设上限）、DESIGN §1.3、§1.4、§4.3、§7.1；
>   - 代码事实：本版（第七版）按 753bf5ab 逐处重核（K 片 A、2A、2B、2C、资源上限片、4A 都已合入）；§9.5 列了旧位置 → 新位置，事实变了的列在“要 lead 定”。
> - 施工前置已经满足：K 片 A 部分、2A、2B、2C、资源上限片和 4A 都已合入（753bf5ab）。K 片 A 关闭悬空 Turn，K 片 B 提供只读命令，2A 提供决定队列的完整分页。
> - 资源上限移出本片（L31），审查第 16–19 条原文转到 `D:/cc-lead-notes/specs/k3/resource-limits-notes.md`。
> - 用户 2026-10-13 对第一版的意见（原话）：“所以你应该让模型再去检查，判断，一般来说对于文件仅仅类似gitdiff就差不多，但是对于环境相关，运行程序相关的就需要谨慎---对于不同的工具结果需要有不同的审查。”

## 0. 给用户看的要点

**问题。** 一次执行被中断时，可能有一个工具调用“开始了、没结果”。今天平台把它记成“结果未知”，等你点“认定”。认定以后，接续说明按调用 ID、工具名和目标逐个列出这些调用（标“结果未知（可能已产生副作用）”），后面再加一句笼统的提醒：

> “结果未知”的工具调用可能已经产生副作用，重做之前先核实当前状态。

这还不够：列出来了，却没有按工具分别核对；不同的工具，核对的办法和风险都不一样。

（第三版更正：原稿写成“接续说明里只有一句笼统的提醒”。今天的接续说明已经逐个列出这些调用，见 `src/contracts/continuation-brief.ts` 的“工具调用”一节。）

**K3 之后，按工具种类分别核对：**

| 种类 | 例子 | 怎么核对 | 谁来判断 |
| --- | --- | --- | --- |
| 只读 | 读文件、搜索、列目录、只读命令；平台的读消息、看任务图、找相关的线 | 没有副作用，不用核对 | — |
| 平台工具 | 发消息、回复或确认消息、给你发“请你决定”、记下决定的落实、提议或采用未来的计划 | 平台按这次调用的请求号查记录：提交了就是“已做”，没提交就是“没做” | 平台 |
| 改文件 | 编辑（改一处或新建文件；授权里叫“写入”） | 接续说明附上这几个文件的 git diff；模型对照原本要改成什么 | 下一轮的模型 |
| 跑程序、动环境 | `shell` 命令：构建、装依赖、迁移、生成文件、起进程 | 先跑一轮只读的“核对轮”，查清这条命令的效果；判断不了就交给你 | 核对轮的模型，判断不了交给你 |

（第三版更正：原稿的“写注记”今天没有这个工具；“编辑、写入”在 Kernel 里是同一个工具 `edit`，授权里的 `write` 映射到它。）

**核对轮。** 只要有“跑程序”类的结果未知，接着做的第一轮就是一次只读执行：
- 能读文件、能跑只读命令（例如 `git status --ignored`、看生成的文件、看本地数据库），不能写，也不能再跑那条命令。
- 它对每一条结果未知的命令写一条核对结论：已做 / 没做 / 做了一半 / 判断不了，附上依据；另外写一条崩溃自查：这条命令会不会就是 Host 崩溃的原因（不太可能 / 可能 / 判断不了）。
- 每一条都是“已做”或“没做”、自查都是“不太可能”，并且不是下面要你确认的情况：自动接着做，结论放进下一轮的接续说明。
- 要你确认的：有一条“做了一半”或“判断不了”；有一条自查是“可能”或“判断不了”（做完了的也算，因为下一轮可能再跑同样的命令）；同一任务连续第二次这样中断；目标是“每步确认”。这时发一张“请你决定”，附上依据。你选（决定 52）：
  - 照原样重跑；
  - 换个稳妥的跑法再跑（例如降低并行度、分批；agent 先提方案，你同意后再跑）；
  - 跳过，当作已做；
  - 我来处理（任务暂停，等你）。

**这套核对用在两处：**
1. **你认定以后**（决定 51 的那种线）：认定以后不再直接接着做，先走上面的核对。你不用自己去翻工作区。
2. **重启后的自动收尾：** Host 崩溃或被关掉，重启时新 Host 凭实例租约证明旧进程已经不在（`src/app/host-instance-lease.ts`），也就证明了那个工具不在跑了。平台不再等你认定，直接收尾，再走上面的核对。（第三版补充：这一点只对跟着 Host 一起停下的工具成立。内置工具和平台自己的工具跑在 Host 进程里，或在 Host 退出时一起被杀掉的沙箱里；以后另装的、自己起进程的扩展工具不算。）

**自动收尾的两道限制（因为平台只知道 Host 停了，不知道为什么停）：**
- **同一个任务，连续只自动收尾一次。** 如果正是那条命令把 Host 弄崩了，接着做又会在同样情况下中断。第二次就照今天的做法等你认定，不会无限循环。
- **只在看得清改动时才自动收尾：** 工作区是 git 仓库，改动清单采集得到。采集不到就照今天等你。

**仍然等你认定的：**
- Host 一直活着，执行中途出了“结果未知”（旧进程还在，证明不了已停）；
- Kernel 记录读不了；
- 让出等回复的那一轮，等待重建不了；
- 那次执行身上挂着还没生效的暂停或取消；
- 上面两道限制挡下来的；
- 查询（秘书回合、问一问）：本片和 K 片一样只做 Work。

**用户 2026-10-13 定的（决定 52）：**
1. 自动收尾和它的两道限制（连续只一次；只在 git 看得清改动时）同意。
2. **可能导致崩溃的命令，重跑前两层把关：**
   - **agent 先自查：** 核对轮对每条结果未知的“跑程序”命令，除了查“做没做完”，还要单独回答“这条命令会不会就是 Host 崩溃的原因”。结论三选一：不太可能 / 可能 / 判断不了，附依据（命令本身、留下的痕迹）。
   - **这四种情况必须由你确认才能重跑：** 自查是“可能”；自查是“判断不了”；同一任务连续第二次在这种情况下中断；目标的自治级别是“每步确认”。
   - 其余（自查“不太可能”，且是“方案确认后自动”）直接接着做。
3. **确认卡四个选项：** 照原样重跑 / 换个稳妥的跑法再跑 / 跳过，当作已做 / 我来处理。
4. **保留你自己去翻工作区的能力：** 工作台的文件、Diff、命令三页照旧；卡上和线的详情里，每一条结果未知的调用都附证据，并有直接打开相关文件、diff 和那条命令的入口；你随时可以选“我来处理”。
5. **给沙箱命令加内存、进程数上限：已经做完（资源上限片，b6087b7a；见它的规格 §9 和证据）。** 命令超限时被杀掉的只是它自己，不拖垮 Host。核对轮里跑的只读命令照样在上限里跑；被 L19a 拦下的命令不起沙箱、不建 scope。

**平台在执行时拦命令（决定 57、68，2026-10-16）。** 你选了“跳过，当作已做”，或同意了一个稳妥跑法以后，平台拦下原命令。怎么认：平台自己读命令文字，用固定的规则认出常见的改写。例如原命令是 `cd app && npm run db:migrate`，而 `app/package.json` 里 `"db:migrate": "prisma migrate deploy"`，那么 `npm run db:migrate`、`bash -c "cd app && npm run db:migrate"`、`npx prisma migrate deploy`、直接跑 `prisma migrate deploy` 都算同一个动作，都会被拦。改了参数的写法（例如 `npm run db:migrate -- --force`）静态规则认不出来；agent 要用 `rewriteOf` 注明这是改写，平台照样出卡。要再调，agent 必须先给你一个原因，你知道并允许以后才能重跑。四种结果：agent 一直请求并解释；agent 放弃；你不允许；你允许。卡上三个选项：“允许重跑” / “不允许” / “不允许，也别再问”。允许只放行卡上那一种写法。机制见 §1 的 L19a。

## 1. lead 的技术选择

下面每一条都是【lead 定，待审】。新名字以 §2 为准。

**lead 提请同步 §0（给用户看第六版时逐条说明）。** 下面是 §1–§3 里用户看得到、§0 没写到或写得不一样的行为。A 组都是往“更保守”的方向收，不改决定 52，告诉用户就行；B 组的一条（B2）已由用户定（决定 57），见下。第五版按 lead 的决定把第四版 B 组第 1 条（核对轮被重启打断时平台直接收尾）去掉，改成 A 组的保守做法（D1）。

*A 组：也照今天等你认定的（L1、L15、L25）：*
- Kernel 里那一轮已经写了终态，但有调用没结果（K 不关已经终结的 Turn）；
- Kernel 里那一轮已经被关成 `interrupted`，平台这边却还没结束（K L1 说的不该出现的情况，只报告）；
- 悬空 Turn 关不了（Kernel 不支持关闭、只有旧读取器、头上是别的执行）；
- 没结果的工具不是跟着 Host 一起停的（表外的扩展工具），或者接手证明只是内存存储（同一个进程里重建的平台，旧的工具没停）；
- 这次执行开始时没有记下工作区基准（K3 之前开始的执行，或开始时就采集不到）；
- 已接受的输入还没核对过来源；
- 指针上有任何控制：排队的插话，已生效的暂停或取消，都算（§0 只写了“还没生效的暂停或取消”）；
- 线有归档请求，或者已经有接续的线；
- 没结果的调用多于 32 条，或者有一条解不出名字或参数、调用 ID 超过 512 字节（L8）；
- 核对轮自己被重启打断、有没结果的调用时，也等你认定（核对轮少见被打断；认定以后这一轮算没做完）。核对轮在两次调用之间被打断（没有没结果的调用）照今天直接收尾，算没做完，再开一轮（D1）。

*A 组：也要你确认、发“请你决定”的（L4、L8、L13、L15、L17、L20）：*
- 平台工具查不清：存储读失败、同一个请求号下内容对不上、这个工具的 owner 没有查找。§0 的“平台工具”一行只写了“提交了就是已做，没提交就是没做”，没写第三种；
- 清单不完整：认定时 Kernel 读不了；停下时 Kernel 读不了（之后哪怕读得到，也不能证明是同一份记录）；Kernel 里找不到这一轮；调用多于 32 条或解不出（含调用 ID 超过 512 字节）。这时列出来的照样显示，但一定出卡，从不当作“没什么要核对的”；
- 只读命令用不了（Host 开关关、沙箱不可用）：不跑核对轮，每条命令记“判断不了”，出卡；提方案时遇上也一样，直接回到四个选项（也可能是三个）的卡（D2）；
- 核对轮两次没做完：出卡，哪怕每一条都已经写了结论（原因“核对没做完”，D2）；
- 核对轮的命令太长、核对说明里放不下全文（每条超过 4 KiB，或整份准备清单放不下而没展开）：这一条做没做完、崩溃自查都一律记“判断不了”，模型写的结论和自查照样显示在卡上（D6）；
- 你暂停或取消了核对轮：平台不自动再开一轮，出卡（原因“核对被你停下”）；
- “换个稳妥的跑法”时 agent 没给出方案，或者你没同意方案：又回到四个选项的卡。

*A 组：卡上少一项的（L18，D2、D7）：*
- 只有平台条目查不清的卡没有“换个稳妥的跑法”这一项（方案只给命令写，平台条目没有可换的跑法）；混合的卡里，平台条目在同意方案以后照“结果查不清，重做前先核实”写进接续说明，卡上写明这一句；
- 一份核对记录最多 8 轮（核对轮和提方案的一轮合计）。剩下不到 2 轮时卡上没有“换个稳妥的跑法”（一次提方案最多要两轮），这时选它算无效。

*A 组：你停下的仍由你接着（L19、L21，D9）：*
- 原来那次执行是你暂停或取消的（认定之前指针上就有你的暂停或取消）：核对卡答完以后，任务不自动接着做，照今天等你点“继续”；你点的“我来处理”的“继续”同时就是这一下。

*A 组：其它你看得到的：*
- 核对轮期间你发给这条线的消息和回复，核对轮不收，等核对完、接续的那一轮才收到（L13）；你对核对轮本身的插话照收；
- K3 之前已经认定、还没接续的执行没有核对记录，照今天接着做，不补核对（L30）；
- 核对轮已经领取、还没开始时你点了“我来处理”：平台不再开始它，直接结束这一轮；核对轮在跑时你点“继续”，回“核对轮还没收尾”，等这一轮结束再点（L21，D3）；
- 同意的方案合计有大小上限（接续说明里按原样排出来最多 5,120 字节，L20）；超了 agent 会被要求缩短，不截断。

*B 组：已由用户定（决定 57，2026-10-14；决定 68 补静态解析和改写申请）：*
- **B2 平台在执行时拦不拦命令。** 用户原话：“agent需要填原因给人类，人类必须知道这个并允许，才能重新调用这个命令。这里基本上要么进入循环（不断调用+解释），要么agent自己放弃或者人类禁止或者人类允许。”
  - 不是 (a) 也不是 (b)：平台拦下原命令（处置是跳过时不许重跑，或按同意的方案换成别的做法）。要再调这条命令，agent 必须给人类一个原因，人类必须知道并允许。四种结果：agent 一直请求并解释；agent 放弃；人类禁止；人类允许。
  - lead 补的（用户可改）：卡上三个选项“允许重跑” / “不允许” / “不允许，也别再问”；平台按命令文字和静态解析认出常见的改写，认不出的改写 agent 要用 `rewriteOf` 注明以后再请求；允许只放行卡上那一种写法。接续说明里写明这一句。
  - 机制（请求工具、等待时这一轮怎么停、是一次允许还是这一轮允许）见 L19a（决定 57）。

### A. 范围和接手证明

- **L1 范围。【lead 定，待审】**
  - 只做 Work 的 Run。Query 的结果未知照今天（K 片 L10）。
  - 自动收尾是新行 RUN-25，只在启动核对里发生，只对 `Entering` 或 `Running` 的 Run，而且它的 Kernel Turn 还开着（没有终态）、K 片能关它（K L4 的条件）。全部守卫见 L25。
  - 下面这些照今天走 RUN-20，等人认定；认定以后走同一套核对（L8）：
    - Kernel Turn 已经写了终态，但有工具调用没结果（今天 `run-reconcile.ts:classifyRun` 的终态分支）：K 拒绝关闭一个已经终结的 Turn，也保留它的历史检查；
    - Kernel 读不了（RUN-20(ii)）；让出等回复、等待重建不了（RUN-20(iii)）；
    - K 的确定失败：只有 legacy 读取器、适配器不同、Kernel 没有 `closeOpenTurn`、Runtime 没装关闭（K M1）、Kernel 头上是别的 Run；
    - 核对用途的 Run（核对轮、提方案的一轮）带着没结果的调用（L15，`blockedBy: 'review_round'`）；
    - L25 其它守卫不成立的。
  - 平台 Run 没结束、它的 Kernel Turn 却已经是 `interrupted`（K L1）：照 K 的规则什么都不写，报告 `left`、原因 `kernel_closed_without_platform_end`，从不 RUN-25，也不 RUN-20（L25 先后表第 5b 行）。
  - 已经是 `outcome_unknown` 的 Run（K3 之前留下的，或上面这些）永远不会变成 RUN-25：它只走 RUN-21（新的 Kernel 证据）或 RUN-22（认定）。
  - Host 一直活着时的结果未知（RUN-08）照今天：不自动收尾，不建记录，等人认定（认定以后建记录，L8）。
- **L2 接手证明是一个带标签的值。【lead 定，待审】**
  - 三种（§2 `HostTakeoverProofV1`）：
    - HL-01（锁文件不在，新建成功）→ `hl01_no_lock`；
    - HL-03（陈旧锁被接管）→ `hl03_stale_lock`，带旧锁里的 `hostInstanceId` 和 `pid`；
    - 内存存储 → `memory_store`。
    - HL-02、HL-04、HL-05 没拿到租约，没有证明（`null`）。
  - **`memory_store` 不放行 RUN-25。** 内存存储里看得到上一个实例留下的 Run，只能是同一个进程里复用了存储（测试，或嵌入式重建平台）。这时旧实例在进程里的工具、它起的沙箱子进程都没有随进程退出，证明不成立。所以 RUN-25 只认 `hl01_no_lock`、`hl03_stale_lock`；`memory_store` 报 `no_takeover_proof`，走 RUN-20(i)（G1）。服务层在内存后端的例子直接注入一个 `hl03_stale_lock` 证明（`HostInstanceFacts.takeover`）。
  - **改 `src/app/host-instance-lease.ts`：** `HostInstanceLease` 加 `takeover: HostTakeoverProofV1 | null`。
    - 今天 HL-03 的 `inspect` 已经读到旧锁的 `{pid, hostInstanceId, startedAt}`，接管成功时只写进 `reason` 的文字，返回值的 `heldBy` 是 `null`，旧实例 ID 就丢了。K3 在接管成功的那一处把它放进 `takeover`。
    - `heldBy` 的含义不变（仍是“没拿到租约时谁持有”，HL-03 仍为 `null`），`reason` 原文不变，所以旧的租约测试不翻转。
    - 接管循环里第一轮接管了 A、后面几轮又遇到别人的锁的，照今天的结果（HL-02 或 HL-04，没有证明）；最后成功拿到的，证明是最后一次接管的那个旧锁。
  - **经组合传下去：** `create-platform.ts` 把它放进 `HostInstanceFacts`（加可选字段 `takeover`）。`reconcileRun` 服务只从这里取，不信调用方自报。启动核对把同一个值交给分类器：`startup-reconcile.ts` 的选项加 `takeover`，第 2 步调 `platform.reconcile.reconcileRun(ctx, { record, hostInstanceId, takeover, probe })`，分类器 `reconcileRunAtStartup` 的入参加可选的 `takeover`。测试只给 `{hostInstanceId, lease}`、没给 `takeover` 的，等于没有证明，RUN-25 不成立。
  - **证明的前提（写进 RUN-25 的说明和能力上报）：** 旧 Host 进程死了，它手上的工具也就停了。这只对跟着 Host 一起停的工具成立：
    - 内置 `read`、`edit`、`check` 在 Host 进程里跑；
    - `shell` 和 `run_readonly_command` 在 bwrap 沙箱里跑，带 `--die-with-parent`（`vendor/coding-agent/patches/sandbox/process/process-sandbox.ts`），Host 一死，沙箱里的进程被一起杀掉；
    - 平台自己的扩展工具（协作、探查、核对工具）在 Host 进程里跑；
    - 别的扩展工具只有在同一个进程里跑才算。L3 的表写明哪些算；表外的不算，RUN-25 不成立。
  - HL-01 的证明和今天 D-5、D-6 用的是同一个：按锁协议，没有别的活 Host。有人手动删锁、旧进程其实还活着，是锁协议以外的人为操作（§12.8 单机），本片不防。

### B. 分类，以及平台能定的先定

- **L3 分类按工具名查一张固定的表，从上往下第一条命中。【lead 定，待审】** 表是 `state/unknown-call-kinds.ts` 里的纯函数。

  | 顺序 | 工具名 | 种类 | 跟着 Host 停 |
  | --- | --- | --- | --- |
  | 1 | `read`、`check`；探查工具 `list_files`、`search`、`symbols`、`code_index`、`project_source`、`project_index`、`python_index`、`cpp_index`、`source_excerpt`、`read_source`、`read_material` | `read_only` | 是 |
  | 2 | 平台只读工具 `read_session_inbox`、`read_session_message`、`read_session_message_body`、`read_user_decision`、`query_task_graph`、`query_ready_tasks`、`find_related_sessions`、`read_session_card`、`look_graph`、`find_graph` | `read_only` | 是 |
  | 3 | `run_readonly_command` | `read_only` | 是 |
  | 4 | 平台改记录的工具 `send_session_message`、`ack_session_message`、`respond_session_message`、`send_user_message`、`record_decision_application`、`propose_future_plan`、`request_command_rerun`（本片 L19a） | `platform` | 是 |
  | 5 | 核对工具 `record_unknown_call_review`、`propose_safer_method`（只出现在核对轮，L15） | `platform` | 是 |
  | 6 | `edit`（模式 `replace`、`create`） | `file_edit` | 是 |
  | 7 | `shell` | `process` | 是 |
  | 8 | 其它名字，包括以后新加、还没进表的工具 | `process` | 否 |

  - 只读的平台工具在第 2 行，先于第 4 行：它们从不查提交回执。
  - 决定 64 删掉了 `apply_future_plan`，第 4 行不再列它（这份检出里还在，4C 合入时删）；第 4 片 4C 的平台工具 `record_note` 在 4C 合入时加进第 4 行（本稿不列，4C 没合入）。
  - 以后新加工具要进这张表；没进表的按第 8 行处理：当最危险的种类，并且挡住 RUN-25。
  - 表里的名字和今天的代码对得上：各协作工具文件已导出的名字常量（`communication-tools.ts` 的 `SESSION_MAILBOX_TOOL_NAMES`、`USER_DECISION_TOOL_NAMES`，`whiteboard-tools.ts` 的 `WHITEBOARD_TOOL_NAMES`，`session-discovery-tools.ts` 的 `SESSION_DISCOVERY_TOOL_NAMES`，`graph-tools.ts` 的 `GRAPH_TOOL_NAMES`）、`observed-model-run.ts` 的探查工具名和 `write → edit` 映射、Kernel 内置工具的 `effectClass`（`read`、`check` 是 `read_only`，`edit` 是 `workspace_write`，`shell` 是 `process`）。
  - 今天 `execution-driver.ts` 的 `BUILTIN_TOOL_NAMES`、`RESERVED_TOOL_NAMES` 和 `observed-model-run.ts` 里探查工具名的数组字面量都是模块私有的，测试引用不到。K3 把它们导出：探查工具的全部可能名字抽成导出常量 `EXPLORATION_TOOL_NAMES`（含 `project_source`、`project_index` 两种，以及审阅模式的 `read_source`、`read_material`），`observed-model-run.ts` 仍按今天的条件从中挑，行为不变。施工时加一条测试，从这些导出的常量逐个核对这张表（K3-34）。
  - **授权名和 Kernel 工具名不是一一对应的：** `BUILTIN_TOOL_NAMES` 是授权里的名字 `read`、`write`、`shell`（`execution-driver.ts:97`），其中 `write` 在交给 Kernel 时换成工具 `edit`（`observed-model-run.ts:258`：`allowed.map(tool => tool === 'write' ? 'edit' : tool)`）。表按 Kernel 记下的工具名查，所以表里是 `edit`，没有 `write`。K3-34 先按这个固定映射（`write → edit`，其余不变）把授权名换成 Kernel 工具名，再和表比；不按字面一一比。
- **L4 平台工具由各自的 owner 查回执。【lead 定，待审】**
  - 今天的请求号是 `execution-driver.ts:requestIdForCall`：hash(Run、claim Session、工具名、Kernel 的 callId)。owner 的身份键在这之上再加自己的东西（例如消息加工作区和发信方，发信方含 Run 和 claim 代际，`mailbox-service.ts:identityKeyOf`），指纹含内容和版本钉。所以没有“只凭请求号查”的通用办法。
  - **做法：** L3 第 4 行的每个 owner 加一个只读的 `lookupToolCommit`（§2）：
    - 输入：工具名、Kernel 记下的调用参数、Kernel 的 callId、原 Run 的可信来历（从 Run 记录重建：Run、claim Session、claim 代际、工作区）。
    - 它用工具处理器同一个纯函数把参数变成 owner 请求（K3 把 `communication-tools.ts`、`whiteboard-tools.ts` 里“参数 → owner 请求”的那段抽成纯函数，处理器和查找共用），再用 owner 自己的身份和指纹算法调 `RecordStore.lookupCommit`。
    - 结果：
      - 命中 → `committed`（带 cursor 和 eventIds）→ 结论 `done`，依据是这张回执；
      - `not_found` → `not_committed` → 结论 `not_done`。只有这一种“权威的没查到”算没做；
      - `idempotency_conflict`（同身份、不同指纹）、存储读失败、owner 没发布这个查找、不认识的工具名 → `undetermined`，带原因。
    - `record_decision_application` 的查找：身份和指纹都不含消息的版本钉（`decision-service.ts:applicationIdentity`，LB-2：钉只做第一次提交的 CAS）。所以 owner 的 `lookupToolCommit` 用同一个 `applicationIdentity`：工作区来自原 Run 的来历，发信方是原 Run（`{ kind: 'agent', runRef }`，同 `callerSenderIdentity` 对 `work_run` 的取法），requestId 是这次调用的请求号，载荷是 Kernel 记下的 `{ messageRef, receipt }`；再调 `RecordStore.lookupCommit`。它和只读的 `replayDecisionApplication` 是同一条路，只是发信方从来历取，不从调用上下文取。命中 → `done`；`not_found` → `not_done`；其余 → `undetermined`。
  - 第 5 行的核对工具只在核对轮里，核对轮的结果未知不建记录（L15），不查。
  - 查找在建记录之前做：自动收尾时由启动核对的分类器做，人认定时由 Host 的认定入口做。结果作为输入交给 WorkGraph，和记录在同一次提交里写下。
- **L5 git 改动采集。【lead 定，待审】**
  - **前提不分种类：** 自动收尾要求采集成功（决定 52 第 1 条）。哪怕没结果的只是一条发消息，采集不到也不自动收尾。
  - **开始基准（K3 新增）。** 每次写范围不为空的 Work Run，在 `prepare` 时记一份开始基准。
    - **基准自己是一个不可变的 Artifact**（`WorkspaceBaselineV1`，§2，内容类型 `application/vnd.platform.workspace-baseline+json`），准备清单 `PreparedTaskManifestV1.workspaceBaseline` 里只放它的引用和摘要。清单本身限 256 KiB（`execution-preparation.ts:MAX_PREPARED_MANIFEST_BYTES`，超了 `prepare` 回 `capacity`），而且已经装着模型输入，所以基准不能放进清单里。清单是不可变的 Artifact，Run 经 `envelope.bundleRef` 钉住它，也就钉住了基准的引用。
    - 只在工作区根就是 git 工作树的顶层时记。判断同 `VerificationWorkspaceReader.capture`：被外层仓库包着的不算。
    - 内容：开始时的 HEAD 提交；开始时已经和 HEAD 不同的路径，每条带标签（D5）：
      - `{ state: 'present', mode, blobId }`：改过的已跟踪文件、没被忽略的未跟踪文件、类型或模式变了的已跟踪路径，记开始时的模式和 blob ID（平台自己算，不跑仓库的过滤器、钩子、外部 diff）；
      - `{ state: 'deleted' }`：HEAD 里有、开始时工作区里已经没有的已跟踪文件（今天的比较也分“不在”：`verification-workspace-reader.ts:68–70` 的 `!previous || !actual`）；
      - 整个工作区的摘要。
    - 和 HEAD 不同的文件超过 2,000 个，或者基准序列化后超过 256 KiB（`ARTIFACT_MAX_SIZE_BYTES`），记 `{ status: 'unavailable', reason: 'too_many_changes' }`；存基准的 Artifact 失败，记 `read_failed`。这次 Run 以后不能自动收尾。
    - **`prepare` 从不因为基准失败。** 基准不是 git、太大、读失败、存失败，都只记成 `unavailable`，Run 照常准备、照常跑。
    - 写范围为空的 Run（含核对轮）不记。K3 之前准备的 Run 没有基准。
  - **收尾时的采集：**
    - 再读一遍当前状态，和基准比。开始时的状态 = 开始时 HEAD 的树，再叠加基准里的条目：`present` 的用它的模式和 blob ID 替换（没有就加上），`deleted` 的从树里去掉；当前状态 = 现在的文件。Run 期间 HEAD 动过（例如 Run 自己提交了）也这样比，用的是开始时的 HEAD。
    - 每个路径按下面的顺序分类，第一条命中：开始时没有、现在有 → `added`；开始时有、现在没有 → `deleted`；两边都有、模式不同（含普通文件和符号链接互换、可执行位变了） → `mode_changed`；模式相同、blob ID 不同 → `modified`；都相同 → 没变，不列。所以开始时已删的已跟踪文件：一直不在 → 没变；被重新建出来 → `added`；开始时就和 HEAD 不同的路径，换了类型 → `mode_changed`，只改了内容 → `modified`。
    - 没被忽略的未跟踪文件算在内（开始时没有、现在有，就是 `added`）。二进制文件按 blob ID 比，只报变没变。
    - 看不见的三类，都不比较：
      - git 忽略的文件：按仓库自己的忽略规则（`.gitignore`、`.git/info/exclude`、`core.excludesFile`），用 `git ls-files --others --ignored --exclude-standard --directory -z` 列出；这条命令只看名字，不读文件内容、不跑过滤器。每次采集按当时的规则；规则本身变了，按变了的路径报；
      - 固定忽略的目录：`.git`、`.platform-runtime`、`node_modules`、`dist`、`coverage`、`test-results`、`.cache`（同 `candidate-workspace-reader.ts`）；
      - 受保护路径（Host 的 `deniedPrefixes`）：不打开、不读内容、不列出名字。
    - `notVisible` 列出看不见的部分：git 忽略的按上面命令给出的目录或路径，固定忽略的目录名，受保护路径只写前缀；最多 32 项，其余计数；受保护前缀下面的任何名字都不列。
    - 不稳定：采集前后各算一次摘要，HEAD 也前后各读一次（同今天的 `capture`）；不一致记 `unstable`。
    - 变了的路径超过 2,000 个，或者结果全文序列化后超过 256 KiB，记 `too_many_changes`。子模块（gitlink）、读失败、特殊文件（FIFO、socket、设备文件：不打开、不读）记 `read_failed`。
    - 结果全文写成一个不可变的 Artifact（`WorkspaceChangeCaptureV1`）。核对记录里只放它的引用、摘要、条数和前 50 条。
  - RUN-25 要的是 `captured` 而且 `runBaselineKnown: true`。没有基准时仍可以照今天和当前 HEAD 比（`runBaselineKnown: false`），只用于人认定以后的核对和展示，不能用来自动收尾。
  - **规则：不在变动清单里，不证明“没做”。** 命令可能写到看不见的地方、写了又改回、或写在工作区外。核对说明和接续说明都写明这一句。
  - 采集是 AgentRuntime 经 WorkspaceTools 的只读操作（DESIGN §7.1 的边），新文件 `src/core/workspace/workspace-change-capture.ts`，不调用模型。
  - **这是一个新的遍历，不是今天的读法。** 今天的 `CandidateWorkspaceReader`（`candidate-workspace-reader.ts`）除了固定忽略的目录，每个文件的内容都读，受保护的、git 忽略的也读，遇到特殊文件就抛错。新的遍历：受保护前缀（`deniedPrefixes`）下面的不进、不列名字；git 忽略的未跟踪路径只按 `git ls-files ... --ignored` 给出的名字记进 `notVisible`，不进、不读；特殊文件不打开，整个采集记 `read_failed`。基准和收尾时的采集用同一个遍历。
  - 代价：整个工作区（去掉上面不进的部分）算一遍 blob ID。K3 以后每次有写范围的 Run 开始时多一次。验收时 lead 记下耗时，不设断言。
- **L6 改文件的调用，接续说明附 diff。【lead 定，待审】**
  - 每个改文件的调用列出：模式（`replace` 或 `create`）、目标路径、`oldText` 和 `newText` 的有界摘录（各最多 1,000 个 UTF-16 单位，从 Kernel 记下的参数读）；这个路径从 Run 开始以后变没变（L5 的分类）。
  - 开始时这个路径是干净的（内容就是开始时 HEAD 里的那个 blob），现在是文本文件，两边都不超过 1 MiB 时，附一段统一格式的 diff：旧内容用 `git cat-file blob` 读（不跑过滤器），新内容读当前文件。
  - **diff 的大小要放得进接续说明。** 整份接续说明渲染后最多 16,384 字节，每个 `BoundedTextV1` 最多 4,000 个 UTF-16 单位（`continuation-brief.ts:CONTINUATION_BRIEF_LIMITS`），放不下时按 `RENDER_TEXT_CAPS` 逐级缩短，再从后往前略去正文行。所以：
    - 每个路径的 diff 最多 2,000 个 UTF-16 单位，`oldText`、`newText` 的摘录各最多 1,000；
    - 这一节所有 diff 合计最多 8 KiB（UTF-8），超出的路径只写状态，`diffOmittedReason: 'section_limit'`；
    - diff 和摘录都是普通正文，照接续说明今天的规则缩短、略去，标出略去了几行；它们不是必需部分（必需部分见 L20）。
  - 开始时就改过或已删的路径（基准只存 blob ID 或“已删”，没存内容）、二进制、太大、受保护：只写状态，不写 diff，写明原因。
  - diff 在拼接续说明时算，注明生成时间。
  - 平台不替模型判断改没改（决定 52）。

### C. 核对记录

- **L7 核对记录是 WorkGraph 的一个新聚合 `UnknownCallReview`。【lead 定，待审】**
  - 放 `tasks` 子模块（先例是第 1 片的 `SessionAnomalyAnchor`）。键是原 Run：`{ aggregateType: 'UnknownCallReview', projectId, goalId, runId }`，一个 Run 最多一份。
  - 只经 `state/unknown-call-review.ts` 的构造函数写（AGENTS.md 第 9 条）；状态写入检查加它的保护字段（同第 5 片 §2.7 的做法）。
  - 形状见 §2。要点：
    - 每个结果未知的调用一条，按 Kernel 里的顺序；
    - 观察到的结论（平台查记录、核对轮写的、定稿时补的）和你的处置分开存。结论在定稿以后不再改；处置从不改写结论；
    - 完整参数和依据不复制：指向 Kernel 里不可变的记录（适配器、会话、Kernel runId、turnId、callId、位置），记录里只放有界的显示摘要和参数摘要（sha256）；
    - 工作区采集指向 L5 的 Artifact。
  - **版本和事件：** 每次改动 revision+1，写一条事件 `UnknownCallReviewChanged`。`change` 写明是哪一种（§3 表 UCR 的“事件”列），事件带身份键、指纹、操作者、请求号和改后的整份记录，供重放。新事件 schema 1。
  - **codec：** `tasks/unknown-call-review-codecs.ts`，严格解码；未知字段、超界、状态和字段不配，都是 `unavailable`（坏记录），不猜。
  - **读：** `UnknownCallReviewReadPort.readReview`（按记录或按原 Run）、`listReviews`（按目标和状态，或按工作区和 `open`，分页，每页 1–200 条，没有总数上限，每页带 `readThrough`）、`listUnappliedAnswers`（L28、§3.4 UR7b：一份记录的卡答复里，② 已提交、③ 没补记的那些）。
  - **派生字段 `open`（D4）：** 记录顶层加 `open: 'yes' | 'no'`，只由构造函数写：状态不是 `resolved`，或 `activeRound` 不为空 → `yes`；否则 `no`。它只给启动时找“还要推进的记录”用，不是新状态。
  - **索引两个：** `k3-ucr-by-goal-status`（`ref.projectId`、`workspaceId`、`ref.goalId`、`status`，给卡来源，L24）；`k3-ucr-by-workspace-open`（`ref.projectId`、`workspaceId`、`open`，给启动第 2b、6b 步，L28；替换第四版的 `k3-ucr-by-workspace-status`）。
  - **条目的别名（D8）：** 每个条目按 Kernel 里的顺序有一个序号 `alias`（1..32），显示成 `#1`..`#32`。核对说明、接续说明的必需部分、两个核对工具都用别名，不用 Kernel 的 callId（Kernel 的 callId 没有长度上限：`nonEmptyIdSchema` 只要求非空，`vendor/coding-agent/dist/core/context/types/context-types.js:18`；所以 K3 自己限 512 字节，更长的算 `undecodable_call`，见下面的上限和 L8）。
  - **上限：**
    - 条目 32 条，超出的计入 `itemsOmitted`，清单算不完整（L8）；
    - `callId` 最多 512 字节（UTF-8；条目的 `callId`、`kernel.callId`、方案里的 `callId` 都一样）。Kernel 给的 callId 更长的，那一条算 `undecodable_call`（L8），不存进记录，所以记录里不会有没有上限的 ID；
    - 命令摘要 512 字符；每条最多 8 个路径，每个 512 字符；
    - 结论依据 2,000 字符；崩溃自查依据 1,000 字符；你的附言 2,000 字符；
    - 稳妥跑法的命令每条 1–4,000 字节（UTF-8），cwd 最多 512 字节；一份记录当前所有方案按接续说明的写法排出来（`approvedMethodLinesZh`，L20）合计最多 5,120 字节（UTF-8）。要原样，超了拒（`capacity`），不截（L20 的字节预算表）；
    - 轮次记录 8 条（核对轮和提方案的一轮合计，D2；这个上限用不满，见 L9）；工作区摘要的路径 50 条；`notVisible` 32 项；
    - `blockedCommands`：每条至多 16 个动作、8 个展开，`scriptText` ≤2,048 字节；一条记录里这些新字段合计 ≤16 KiB（L19a），超了按 L19a 退化并置 `truncated`；
    - 整份记录序列化后不超过 512 KiB；这个上限由下面的准入逐次量着拦（M3），不是靠每个字段各自的上限推出来的。
  - **按序列化大小准入（M3）。** 每个构造函数和每次更新都把写后的记录 `JSON.stringify` 量 UTF-8 字节；结果超过 512 KiB（524,288 字节）就回 `capacity`、什么都不写（工具结果告诉模型缩短）。空间先留给必须写的：
    - **必须写的一律收：** 定稿（settlement）、批准、放开/“我来处理”（hold/release）和处置（disposition）永远放行，不受下面的门槛限制；
    - **可选模型文字**（结论依据、崩溃自查依据、方案理由）只在写后记录仍不超过（512 KiB − 预留 R）时收；
    - **预留 R 和创建预算 B**（算式就是下面的短表）：

      | 必须写的部分 | 最坏字节 | 怎么算的 |
      | --- | --- | --- |
      | 定稿时每条补的 `reviewerConclusion`（结论依据 2,000 + 自查依据 1,000 字） | 288,000 | 32 条 × 3 字节/字 × 3,000 字；留的是最坏上界，不扣掉被固定句替换掉的旧依据 |
      | 处置/批准里的作用对象和方案 `callId`、`cwd`（三种各 32 条，各 512 字节） | 49,152 | 3 × 32 × 512 |
      | 处置附言和认定/处置文本（两处各 2,000 字） | 12,000 | 2 × 2,000 × 3 |
      | 处置落实时写的 `blockedCommands` 新字段（动作、展开、依据；见 L19a 的 16 KiB 上限） | 16,384 | 每条记录一组，按上限留 |
      | **预留 R** | **365,536** | 上面的和（≈357 KiB） |
      | **创建预算 B = 512 KiB − R** | **158,720** | 524,288 − 365,536（≈155 KiB） |

    - **创建放不下**（RUN-25 或认定）：按 Kernel 顺序保留条目，直到再加一条就超过 B 为止，其余计入 `itemsOmitted`，清单记 `incomplete`、问题 `too_large`（L8），记录照建，卡照出（G11 不挡这一种，见 L25）。
  - **任务读模型：** `TaskRow` 加 `unknownCallReview`：选定 Run 的那份记录的 ref、revision、状态、原因、进行中的一轮、`hold`、剩下的轮次空位。界面（E3）据此在线的详情里逐条列出证据和入口，并给“我来处理”的按钮（决定 52 第 4 条，L21）。
  - **读不出就当没定（fail-closed）。** 选定 Run 的记录键存在、但读不出（坏记录 `unavailable`，或存储读失败）时，所有门（L11）一律按“没定”拦：领取回 `unavailable`，Workflow 的选择对这个任务回 `waiting`（原因写明记录读不出），读模型的 `unknownCallReview` 报 `{ status: 'unreadable' }`。只有权威地读到“键不存在”（`not_found`）才算没有记录。
- **L8 什么时候建，清单完不完整。【lead 定，待审】**
  - **两处，都在同一次提交里建：**
    - RUN-25 的提交（L25）；
    - 人认定（RUN-22）的提交。每次认定都建一份，哪怕一条结果未知的调用也没有：这时清单完整、条目为空，直接 `resolved`。核对轮的 Run 被认定时不建（L15）。
  - **清单 `inventory`：**
    - `complete`：只有同时满足下面四条才算：现在 Kernel 读得到；这个 Run 停下时 Kernel 也读得到（没走过 RUN-20(ii)）；找到了这个 Run 的 Turn，没结果的调用都列进来了（不多于 32 条，名字和参数都解得出）；而且按创建预算 B（L7）能放下全部条目。
    - `incomplete`，`inventoryProblem` 写明是哪一种（§2）：
      - `kernel_unreadable`：认定入口现在读到 `missing`、`damaged`（`inputsConfirmed` 为 `null`）；
      - `kernel_unreadable_at_stop`：这个 Run 走过 RUN-20(ii)（认定前它的核对观察是 `unresolved`、原因 `kernel_unreadable`）。停下时没读到证据，之后读到的存储（例如从备份恢复的）不能证明是同一份，所以哪怕现在读得到、也找到了 Turn，一律不完整。这次 Run 记下的 `unresolvedToolCallIds` 是空的，owner 的“记下的调用都在条目里”挡不住这种情况，所以单列；
      - `turn_not_found`：现在读得到、没走过 RUN-20(ii)，但找不到这个 Run 的 Turn。lead 核过：能被认定的 Run 都是 RUN-08 或 RUN-20 留下的，(i)、(iii) 都要求找到 Turn，(ii) 归上一条，所以这一条只在 Kernel 存储之后被换成了更早的副本这类情况出现（K3-26（六）），不再为“从没进入过”的 Run 留 `complete` 的例外；
      - `too_many_calls`：多于 32 条；
      - `too_large`：按创建预算 B（L7）放不下全部条目，只按 Kernel 顺序留了放得下的那几条，其余计入 `itemsOmitted`。创建时（RUN-25 或认定）截断得到，不是拒绝，卡照出；
      - `undecodable_call`：某条调用解不出名字或参数；或者它的 Kernel callId 超过 512 字节（UTF-8）。Kernel 只要求 callId 非空、不限长度，K3 不把没有上限的 ID 存进记录（L7 的上限），所以这一条不列进条目，清单算不完整，照常出卡。
    - 读窗口超出页数上限（`readTurnWindow` 的 64 页）不在这里：今天 `readAttestationFacts` 对任何窗口读失败都回 `unavailable`、拒绝认定、不写（SD-2），K3 不改。
    - `incomplete` 的记录直接 `needs_decision`，原因含 `inventory_incomplete`，永远不会因为“没列出东西”变成 `resolved`。列出来的那几条照常显示。
  - **人认定入口的变化**（`create-platform.ts` 的 `resolveUnknownRun`）：
    - 今天它先查重放、做准入、读 Kernel 事实（`readAttestationFacts`）。K3 之后，它再读这个 Turn 里没结果的调用（名字、参数位置）、按 L4 查平台工具的回执、按 L5 采集工作区（没有基准就和当前 HEAD 比，`runBaselineKnown: false`；采集不到照实写），拼成 `review` 草稿交给 `resolveUnknownRun`。草稿按创建预算 B（L7）截条目：放不下全部时按 Kernel 顺序留前几条，其余计入 `itemsOmitted`，清单记 `incomplete`、问题 `too_large`（M3）。
    - 指纹照旧只含请求本身（Run、理由、版本钉）。草稿是入口读到的事实，和今天的 `kernelTurnOpen` 一样不进指纹；重放照旧在读 Kernel 之前查回执（LA-8）。
    - **owner 先查回执，再校验草稿。** 同身份同指纹 → 原回执，不看草稿；同身份不同指纹 → `idempotency_conflict`，也不看草稿。查回执没命中，才校验草稿：
      - `inputsConfirmed` 为 `null` ⇒ 清单 `incomplete`、`kernel_unreadable`；
      - 认定前的核对观察原因是 `kernel_unreadable` ⇒ 清单 `incomplete`（`kernel_unreadable_at_stop` 或 `kernel_unreadable`）；
      - 清单完整时，Run 记下的 `unresolvedToolCallIds` 都在条目里；只是 `too_large` 时，留下列出的条目都在 `unresolvedToolCallIds` 里、剩下的都在 `itemsOmitted` 里（M3）；
      - 每条的种类等于 L3 的表按名字算出的。
      - 不符回 `invalid`，不写。
  - 建好时：只读的条目是 `no_review_needed`，平台工具按 L4 定了，改文件的是 `compare_in_continuation`，跑程序的是 `pending`。
- **L9 记录的状态。【lead 定，待审】**
  - `pending_review`：有跑程序的条目，清单完整，等核对轮；
  - `needs_decision`：要你决定（L17 的原因）；
  - `awaiting_proposal`：你选了“换个稳妥的跑法”，等 agent 提方案；
  - `awaiting_approval`：方案提好了，等你同意；
  - `resolved`：可以接着做（自动定下的，或按你的处置）。
  - 建时：清单不完整 → `needs_decision`；否则有跑程序的条目 → `pending_review`；否则有 `undetermined` 的平台条目 → `needs_decision`；否则 `resolved`。
  - **“进入一次”按 `stateEntry` 数（D2）。** 记录有一个计数 `stateEntry`，建时是 1，每次 UCR-10（你选了换稳妥跑法）进入 `awaiting_proposal` 时加 1。每一轮记下领取时的 `stateEntry`。L15 的“第 2 次没做完”只数 `stateEntry` 等于当前值的那几轮：每次提方案都从零数起。
  - **轮次空位（D2）。** `rounds` 最多 8 条，空位 = 8 − `rounds` 的条数。`safer_method` 只在至少还有 2 个空位时出现在卡上（一次提方案最多要两轮）；`pending_review` 只在建记录时进入，最多用 2 轮；`awaiting_proposal` 进来时总有至少 2 个空位，最多用 2 轮。按“至少两个空位才给换稳妥跑法”和“每次进入一个状态最多两轮”，8 条轮次记录不会用满；构造函数照常校验上限，超了是坏记录（`invalid`），不另设状态行。
  - “我来处理”在任何状态都可以直接点（L21 的 UCR-15；`resolved` 的要接续还没领取），点了以后记录变成 `resolved`、`hold: 'held'`。
  - 每一步的守卫、写什么、事件，见 §3 的 UCR 表。

### D. 核对轮

- **L10 核对轮是一次用途为“核对”的 Work Run。【lead 定，待审】**
  - Run 记录加 `purpose`（缺省是普通工作）。核对轮是 `{ kind: 'unknown_call_review', reviewRef, phase: 'review', round }`；提方案的一轮 `phase: 'proposal'`（L20）。记录的 `activeRound` 指向它。
  - 下面这些都当它不存在：
    - 任务的选定 Run（§4.1 的选定规则）：失败类别、自动化判断、检查轮次、完成、接续说明的 afterRun 都看原来的 Run；
    - 返工链（`requeueRef`、`consumedWait`）：核对轮没有这两个字段，也不能被重排（`requeueTask` 的 afterRun 不能是它）；
    - 返工计数、无进展的键、目标的已结束 Run 计数（`countEndedGoalRuns`，拒绝变旧用的钟）；
    - 执行过的文件、足迹。
  - 不建 TaskRequeue。之后真正的接续仍从原 Run 重排（`afterRunRef` 是原 Run）。
  - **领取要第四种领取依据。** 今天的行接不住核对领取（lead 核过代码）：RUN-25、RUN-22 以后选定 Run R 是 `crashed`、没有 TaskRequeue 覆盖它，任务投影是 P6 `failed`，`taskClaimProblem` 回“task phase is not dispatchable”；领取既没有 `requeueRef` 也没有 `consumedWait`，依据算成 `first`，`claimBasisProblem` 回“this Task already has a Run”，`leaseOnClaimed` 对已释放的租约和 `first` 也拒绝；`onTaskClaimed` 还会把任务投影写成 P2 `running`。所以：
    - `AttemptClaimBasis`（`attempt-machine.ts`）和领取的入参加一种 `{ kind: 'review'; reviewRef; expectedRevision; phase; afterRunRef }`。`afterRunRef` 是“最近持有者”（L12）：记录还没有轮次时是 R，有轮次时是最近一轮的 Run。
    - 新行 TASK-03r、RUN-01r、ATT-16r（§3.1）。守卫：记录@`expectedRevision`，状态是 `pending_review`（phase `review`）或 `awaiting_proposal`（phase `proposal`），`hold` 不是 `held`，`activeRound` 为空，`rounds` 还有空位（L9）；任务的选定 Run 就是 `record.runRef`；任务投影是 P6（R 的 `crashed`），或 P4 而覆盖它的 TaskRequeue 的 afterRun 是 R（人的重排先到了，L11）；这两种投影只对 `review` 依据放行；租约已释放，释放它的就是 `afterRunRef`，而 `afterRunRef` 是 R 或记录 `rounds` 里的某一轮。
    - 效果：建 Attempt（依据 `review`）、Run（带 `purpose`）、Outbox；重新持有租约；占用 Session；同一提交写记录的 `activeRound`（UCR-03）。**任务投影不变**（不写 P2）：选定 Run 仍是 R。
    - RUN-02..RUN-07、ATT、SES 的其余各行对核对轮照常适用（进入、结束、释放）。RUN-02 多一条（L11）。
  - **接续的租约检查认“最近持有者”。** 核对轮持有、再释放 TaskLease 以后，`lease.release.runRef` 是核对轮的 Run，不再是 R。今天有三处要求“租约由 afterRun 释放”，接续（afterRun 是 R）会在三处都被拒：`requeue-service.ts` 的 `requeueTask`（`busy`，“the Task lease is not released by the afterRun”）、`claim-service.ts:requeueClaimFacts` 的 `leaseReleasedByAfterRun`（TASK-03 回 `revision_conflict`）、`attempt-machine.ts:leaseOnClaimed` 的 ATT-16（`revision_conflict`）。K3 加一个共用的纯函数 `leaseReleasedForContinuation({ release, releasingRunPurpose }, afterRunRef)`（新文件 `state/review-lease.ts`）：释放者是 afterRun，或者释放者的 `purpose` 是核对、`purpose.reviewRef.runId === afterRun.runId`（R 的记录的某一轮）。释放者的 `purpose` 由调用方在同一个读窗口里读出来交给它（ATT-16 经领取事件的事实带进状态机）。三处都改用它；R5 各有一行（K3-36）。
  - **核对轮正常结束也不开检查轮次。** 今天 `workflow.ts` 的 `performStep` 里，`start`、`observe` 拿到一个正常结束的 Run 就直接走 `openChecksAfterRun`（`open_checks`），不正常结束的走 `afterNotNormalEnd`。核对轮如果这样走，就会给自己开检查轮次，UR4 要到下一次选择才轮到，挡不住。所以：
    - `start`、`observe` 拿到 `purpose.kind === 'unknown_call_review'` 的 Run，不论怎么结束，都不走 `openChecksAfterRun`、`afterNotNormalEnd`，下一步是 `settle_review{ reviewRef, cause: 'round_ended' }`（Run 还没结束、或是 `outcome_unknown` 的，照 `normalEnd` 的原因 `waiting`）；
    - 检查的 owner（`evidence-service.ts:openVerification`）对核对用途的 Run 回 `illegal`，不开轮次；
    - K3-05 断言没有开检查轮次。
  - 所以核对轮做完，不会开检查轮次，不会完成任务，不会顶替原 Run 的失败和接续来历。
- **L11 先核对，再做别的：所有领取入口都拦。【lead 定，待审】**
  - 原 Run 的记录不是 `resolved`，或是“我来处理”还没放开（L21），这个任务别的领取都不行。记录读不出时同样拦（L7 的 fail-closed）。拦在这些地方：
    - Workflow 选择（`selectNext`）：每个任务先看记录，再看自动化判断（§3 UR 表）；
    - Workflow `perform`（`gatePerform`）：`requeue_task` 遇到没定的记录，`waiting`，不写；
    - 领取的 owner（`claimTask`，RUN-01）：普通领取（不论带不带 `requeueRef`）回 `busy`，原因 `unknown_call_review_pending`（`hold: 'held'` 时 `unknown_call_review_held`）；只有核对领取（TASK-03r）能过；
    - 重排的 owner（`requeueTask`）：
      - 系统和 agent 的重排回 `busy`，原因同上；
      - 人的重排：记录没定时照收，例如归档时放下任务（第 1 片），但它的领取仍要等记录定了；
      - `hold: 'held'` 时，不带归档来历（`archiveOrigin`）的人的重排回 `busy`，原因 `unknown_call_review_held`，写明“点‘继续’（release-hold）接着做”。今天 `task_paused` 的“继续”就是人的 `tasks/requeue`；要是照收，你点了“继续”只多一条 TaskRequeue，什么都不跑。所以“继续”只有一个入口：`releaseUnknownCallReviewHold`（L21）。带归档来历的照收（归档放下任务不能被挡住），领取照样等放开；
    - 进入（RUN-02，`execution-entry-service.ts`）：核对轮进入之前，再核对记录还在等这一轮（状态对，`activeRound` 就是它，`hold` 不是 `held`），核对说明的摘要和 `inputBinding` 钉的一致，否则 `stale`。`hold` 那一条防的是：Workflow 在 UR3a 读到记录以后、`start` 之前，你点了“我来处理”（D3）；
    - 启动重驱（§12.1 第 6b 步）：加条件 (c)，见 L28。
  - **领取和“我来处理”互相加守卫（D3），两种先后都测（K3-43）：**
    - 这个任务的每一次领取（普通、接续、核对）在提交里加一个对核对记录的读守卫：读到的 revision；权威读到键不存在时，守卫是“仍不存在”（`expectedRevision: null` 就是“必须不存在”，`record-codec.ts:754`）。今天的领取守卫在 `claim-service.ts:1135–1157` 一处拼好，加在这里。“我来处理”先提交 → 领取因记录 revision 变了回 `revision_conflict`；
    - “我来处理”（UCR-15）的提交守卫它读到的 TaskLease revision，和它读到的“原 Run 仍是选定 Run”的那些事实（任务的 Run 列表、覆盖 R 的 TaskRequeue）。接续领取先提交（它重新持有租约，租约 revision 变了）→ “我来处理”回 `revision_conflict`。
  - **K3 之前认定的 Run。** 它们的记录键不存在（RUN-22 从 K3 起总在同一提交里建记录，所以“键不存在”只可能是 K3 之前认定的）。权威读到 `not_found` → 照今天接续，不补核对（L30；§1 提请同步）。
  - 自动化判断（TD-9）加两行 AV-2b、AV-4c（§3），让 6b 和界面看得到“为什么停”。目标原因不收新原因：`goal-machine.ts:isGoalStopCause` 排除 `unknown_call_review`（今天排除 `unknown_outcome` 的做法），免得目标原因卡和本片的卡重复。
- **L12 核对轮在哪个 Session。【lead 定，待审】**
  - **最近持有者。** 记录的“最近持有者” `lastHolderOf(record)` = `record.rounds` 里最后一轮的 Run；没有轮次时是原 Run R。它是这个任务最后一次占用 Session 的 Run：一轮核对没有 Kernel 终态地结束（RUN-19、RUN-22、RUN-23、RUN-24）时，Kernel 头上悬着的是这一轮的 Turn，不是 R 的。
    - 为什么不能总用 R：R 的 Turn 早已被关成 `interrupted`，用 R 去关，K 回 `already_closed`；再探测时头上仍是这一轮的活动 Run，SES-13 不放行，回执是“可以重试”，Workflow 永远等下去。在退路建的新 Session 里，R 的领取 Session 也不是这个 Session，K L4 第 1 条直接拒绝。
  - 和接续一样选（`claimRequeued` 的同一套规则，抽成共用的选择），但起点是最近持有者的领取 Session，不是 R 的：
    - 转去的 Session 优先（E16）；
    - 那个 Session 是 `unavailable/kernel_turn_open` → 先 `close_open_turn`，请求是 `{ sessionRef, afterRunRef: lastHolderOf(record), requeueRef: null }`（K L4、L7；可关的结束方式见 L27）；
    - 回执照 K 的表：成功 → 领取；可以重试 → `waiting`；确定失败 → 退路。
  - **之后的接续也这样。** 记录 `resolved` 以后的真正接续（`claimRequeued`，TaskRequeue 的 afterRun 是 R）：R 有记录、记录有轮次时，选 Session 的起点和 `close_open_turn` 的 `afterRunRef` 都换成 `lastHolderOf(record)`；TaskRequeue 仍是 R 的，`requeueRef` 照传（K L4 第 2 条对核对用途的 Run 不看它，L27）。
  - **退路：** 建接续 Session（`create_session` 带 `review`，不带 `requeue`），交接照接线包 1（E15），然后在新 Session 领取核对轮。
  - **新 Session 的历史：** `prepare` 对核对轮按原 Run 推出历史来源（同 `task-failure.ts:requeueHistorySourceOf(afterRun)`；普通接续从 TaskRequeue 取，这里没有 TaskRequeue），填 `sessionBasis`。必须在核对轮这里种：之后的接续在同一个新 Session 里，游标已经不是空的，按 LA-1 不会再种。
  - 核对轮正常结束，它的 Turn 有 Kernel 终态，Session 的游标前移；之后的接续在同一个 Session 里看得到这一轮的对话。
- **L13 核对轮的输入、工具、模型和预算。【lead 定，待审】**
  - **输入：** 照第 3 片的装配器，角色、目标、任务三段照旧（给上下文）。任务段之后加一段核对说明（`UnknownCallReviewInputV1`，钉进 `inputBinding` 的摘要）：
    - 开头写明：这一轮只核对，不做任务，不改工作区，不许重跑下面的命令；
    - 每条跑程序的调用，按别名 `#n`：命令和 cwd（从 Kernel 读）、开始时间、同一批里的其它调用（也按别名）；
    - 工作区采集：状态、看不见的部分、变了的前 200 条；“不在清单里不证明没做”；
    - 已经写过的结论（上一轮没做完时）；
    - 每条要回答两件事：做没做完（已做 / 没做 / 做了一半 / 判断不了，附依据）；会不会就是 Host 崩溃的原因（不太可能 / 可能 / 判断不了，附依据：命令本身、留下的痕迹）。
  - **看不全的命令一律“判断不了”（D6）。** 核对轮没有读 Kernel 历史的工具（工具清单见下，不加新工具；`look_graph` 这类看图工具不在里面），看不到核对说明里没给全的命令。所以每条在核对说明里的显示方式 `display` 是三种之一：`full`（全文）、`truncated`（命令和 cwd 合计超过 4 KiB，截断显示）、`unexpanded`（为了放进准备清单没展开，见下）。`truncated`、`unexpanded` 的条目旁边写明：“这条命令没有全文，两个结论（做没做完、会不会是崩溃的原因）一律按判断不了处理；你看到的痕迹照样写进依据。”`record_unknown_call_review` 对这些条目照样收结论，定稿时把做没做完改成 `undetermined`，依据换成固定的一句；崩溃自查也改成 `undetermined`（“命令没给全，自查同样没有依据。”）。模型写的结论和自查原样留在 `reviewerConclusion` 里、显示在卡上（L16）。
  - **这一段的大小（D8）。** 准备清单整个限 256 KiB（`MAX_PREPARED_MANIFEST_BYTES`）；`prepare` 把整份清单 `JSON.stringify` 以后量 UTF-8 字节，超了回 `capacity`（`execution-preparation.ts:292–295`）。核对说明在清单里出现两次：结构化的 `unknownCallReview` 字段，和渲染进 `input` 的那段文字；两次都按 JSON 编码计（控制字符、引号、反斜杠在 JSON 里会变长）。所以：
    - 每条命令和 cwd 合计最多显示 4 KiB（UTF-8），长的截断，`display: 'truncated'`；
    - 整段渲染后先限 64 KiB（UTF-8），放不下就按下面的顺序收；
    - 然后量真的清单：`prepare` 拼好整份清单，`JSON.stringify` 量字节；超过 256 KiB 就从后往前收“展开的部分”，每收一项重新渲染、重新量，直到放得下：先收变了的路径样本（从最后一条起，计入 `changedOmitted`），再收 `notVisible`（计入 `notVisibleOmitted`），再从最后一个条目起把条目改成 `unexpanded`（结构化的那一份不带命令、cwd、已写的结论，渲染的那一行只剩别名和工具名）；
    - 底线：每个条目至少列出别名和工具名（`- #n <工具名>：没展开，按判断不了处理。`）。32 条的底线一共不到 4 KiB（工具名来自 Kernel 登记过的工具）。底线也放不下，说明第 3 片的其它部分已经把清单占满，照今天回 `capacity`，这不是核对说明造成的；
    - 结构化的条目不带 Kernel 的 callId（Kernel 不限长，K3 限 512 字节，L7、L8），只带别名；所以清单的大小不随 callId 变。
    - K3-35 用满 32 条、每条超过 4 KiB、带控制字符的命令和 512 字节（上限）的 callId 验证（L20 的字节预算表、§5.2）。
  - **不收 Session 的输入。** 今天 `execution-driver.ts` 给每个 Work Run 都建 `createMailboxInputSupply`：Session 里在等的信件、回复（包括你发给这条线的话）会在安全点被这一轮接受。核对轮和提方案的一轮只读、没有协作工具，处理不了也回复不了，被接受的输入之后的接续又不会再收到。所以这两种轮次只建一个只有 `controlInputs` 的输入通道：你对这一轮本身的插话照收；信件和回复都不送，留给之后的接续在它的安全点收（K KA-08 的规则）。
  - **工具**按用途固定：`read`、探查工具、`run_readonly_command`、`record_unknown_call_review`。没有 `shell`、`edit`、协作工具。写范围为空。
    - 不受职责的工具上限（K L18 第 2 层）限制。理由：有跑程序的条目，说明这个职责本来就有 `shell`，能写整个工作区；只读命令比它弱。
    - Host 的两层照旧要成立：开关开、整个工作区可读（K L18 第 1 层），调用时还是当前的（第 3 层）。
  - **`run_readonly_command` 用不了**（Host 开关关、只有部分前缀可读、沙箱探测不到）：不跑核对轮，也不跑提方案的一轮。Workflow 直接定稿，原因含 `review_unavailable`（L16 第 3 种）：
    - `pending_review`：每条跑程序的都记“判断不了”，自查也记“判断不了”（UCR-07）；
    - `awaiting_proposal`：不开提方案的一轮，直接 `needs_decision`，原因 `review_unavailable`、`proposal_missing`（UCR-08c，D2）。
    - Runtime 加一个只读查询 `reviewCapability` 回答能不能用。
  - **模型和预算：** 用这个任务的职责在 Workflow 绑定里的模型（`bindingForRole`）。token 预算取绑定预算和 200,000 的较小者，期限同绑定。
- **L14 工具 `record_unknown_call_review`。【lead 定，待审】**
  - 只在核对轮注册，绑定这一轮：记录 ref，加上 `activeRound` 的 runRef（由工具上下文的 `work_run` 主体给，模型给不了）。
  - 入参见 §2。条目按别名 `item`（`#n` 的 n）给，owner 按记录的 `items` 换成 callId。只收这份记录里种类是 `process` 的条目；别的别名 → `invalid_arguments`，不写。核对说明里 `display` 是 `truncated`、`unexpanded` 的条目照收（D6，定稿时改判，L16）。
  - **请求身份** = (核对轮 Run, 被核对的条目的 callId, 这次工具调用的请求号)。请求号照 `requestIdForCall`，从 Kernel 的 callId 推出。**指纹** = 规范化的入参。
  - **先查回执：** 同身份、同指纹 → 原回执原样返回，在读记录和 Run 的当前状态之前（同 `decision-service.ts:replayDecisionApplication` 的做法）；同身份、不同指纹 → `idempotency_conflict`。
  - **可以改：** 新的一次调用（新的 callId，就是新的身份）可以改同一条的结论，直到这一轮结束；以最后提交的为准。每次提交 revision+1，事件 `conclusion_recorded`。
  - **守卫：** 记录@当前 revision；核对轮 Run@读到的 revision，而且是 `running`；`activeRound` 就是这一轮；记录状态是 `pending_review`，或者这一轮进行中你点了“我来处理”（UCR-15，记录已是 `resolved`、`hold: 'held'`、`disposition.source: 'direct'`），这时结论照收。这一轮一结束（RUN-07 改了 Run 的 revision），之后的提交都因版本不对被拒，工具结果是 `stale`。所以定稿和迟到的写不会交错。
  - **大小准入（M3）：** 结论依据和自查依据是可选模型文字，写后记录超过（512 KiB − 预留 R，L7）就回 `capacity`、什么都不写，工具结果告诉模型缩短。定稿时补 `reviewerConclusion` 属于必须写的一类（L7），永远放行。
  - `crashSuspicion` 必填：没有自查写不进结论。
- **L15 核对轮自己的结束，不再递归核对。【lead 定，待审】**
  - 核对轮是只读的：工具只有只读工具和核对工具。所以它自己的结果未知不再交给核对，不建记录：
    - **重启时它带着没结果的调用：一律走 RUN-20(i)，等你认定（D1）。** 分类器在查 G1..G11 之前先看 Run 记录里可信的 `purpose`：用途是核对的，不附自动收尾候选，附 `{ blockedBy: 'review_round' }`，走 RUN-20(i)（L25）；不论有没有证明、有没有基准、没结果的调用多不多。核对轮少见被打断，这样做最保守，列在 §1 A 组；
    - 人认定它（RUN-22）时照常写 Run，但不建记录；认定以后这一轮已经以已知结果结束（`crashed`），按下面算“没做完”；
    - 重启时它没有没结果的调用（两次调用之间被打断）：照今天走 RUN-19、RUN-23、RUN-24（干净），不改；
    - 它提交过的结论都在记录里，没提交的就没有。
  - 正常结束（Kernel 终态 `completed`）→ 定稿（L16 第 1 种）。
  - **你停下的不算“没做完”。** 这一轮结束时，按这一轮自己的 Run 和指针算 `reworkFenceOf`（不是按 R）：
    - `human_only`（你暂停或取消了这一轮：进程内的取消、暂停中遇上重启的 RUN-24、排队取消的 RUN-23）→ 不再开一轮，直接定稿，原因加 `review_stopped`（L16 第 4 种，UCR-06b）。理由：人停下的工作只由人重新开始（硬限制 3，I-17），自动再开一轮就是绕过了你的停；
    - `human_or_goal_resume`（目标暂停时遇上重启）→ 照下一条算“没做完”；目标恢复以后 Workflow 才会再开，恢复本身就是人的操作；
    - `none` → 照下一条。
  - 没正常结束（失败、崩溃、被中断、超预算、结果未知又被认定），也不是你停下的 → 这一轮“没做完”：记录状态不变，清掉 `activeRound`，`rounds` 记一条 `unfinished`（带这一轮的 `stateEntry`）；Workflow 再开一轮（要有空位，L9），输入带已写的结论。
  - 这次进入这个状态以来（同一个 `stateEntry`，L9）第 2 轮还没做完 → 不开第 3 轮，直接定稿，原因**一定**含 `review_incomplete`（D2），哪怕每一条都已经写了结论（A 组说的“核对轮两次没做完就出卡”）。另外：核对时，剩下没结论的都记“判断不了”，依据写“核对轮两次没做完”，原因因此还有 `undetermined`、`crash_undetermined`；提方案时还缺方案的，原因还有 `proposal_missing`。理由：核对轮自己反复失败时，不能无限重试，也不能凭两次都没跑完的轮次自动放行。
  - 核对轮的 Run 是 `outcome_unknown`（RUN-08 或 RUN-20，含上面的 `review_round`）时，它占着 Session 和 Lease，Workflow 跳过这个任务（UR5），等人认定这一轮。
  - 你在核对轮进行中暂停它（进程内，Run 仍在跑、Kernel 停在安全点）：Workflow 跳过（UR3），你点继续它接着跑；你取消它，按上面的“你停下的”处理。
- **L16 定稿。【lead 定，待审】**
  - 由 Workflow 的一步 `settle_review` 做（owner `settleReview`），四种触发：
    1. 这一轮正常结束；
    2. 这一轮没做完，而且是这次进入以来第 2 次（L15，原因 `review_incomplete`）；
    3. 只读命令用不了（L13，原因 `review_unavailable`；`pending_review` 走 UCR-07，`awaiting_proposal` 走 UCR-08c）；
    4. 这一轮是你停下的（L15，原因 `review_stopped`）。
  - 这一轮没做完、还不到第 2 次时，同一步只清掉 `activeRound`、记 `unfinished`，不定稿。
  - **看不全的命令改判（D6）。** 定稿（第 1、2、4 种）对每条有结论的跑程序条目，读写下这条结论的那一轮（结论的 `roundRunRef`）的准备清单（那个 Run 经 `envelope.bundleRef` 钉住的那份，用 RUN-02 已经在用的 `readManifestFromEnvelope`，`execution-entry-service.ts:392`），取这一条的 `display`。是 `truncated` 或 `unexpanded` 的：做没做完一律记 `undetermined`，`by: 'settlement'`，依据换成固定的一句“核对说明里没有这条命令的全文，按判断不了处理”；崩溃自查也一律记 `undetermined`，依据换成固定的一句“命令没给全，自查同样没有依据。”（模型写过自查的也改，不照它写的）；模型写过结论的，它的结论和自查原样放进 `reviewerConclusion`（显示在卡上）。清单读不到 → `unavailable`，不写，Workflow 下次再试。
  - 定稿写的：还是 `pending` 的条目记成 `undetermined`，依据写固定的一句（“核对轮没有给出结论”“核对轮两次没做完”“只读命令用不了”或“核对轮被你停下了”）；没写自查的，自查记 `undetermined`；清掉 `activeRound`，`rounds` 记一条（`finished`、`unfinished` 或 `stopped`；第 3 种没有这一轮，不记）；按 L17 算原因；为空 → `resolved`，否则 `needs_decision`。
  - **记录已经因为“我来处理”定下时**（这一轮进行中点的，UCR-15）：这一轮结束以后的 `settle_review` 只把还是 `pending` 的条目记成 `undetermined`（依据“核对轮没有给出结论”）、照上面改判看不全的条目、清掉 `activeRound`、记一条轮次；状态、处置、`hold` 都不变，不算原因，不出卡（UCR-08b）。
  - 守卫：记录@revision；这一轮的 Run@revision 而且已经以已知结果结束（第 1、2、4 种），或者没有进行中的一轮（第 3 种）；目标@revision（读自治级别）。
  - 定稿以后，各条的观察结论不再改。
- **L17 要你决定的原因。【lead 定，待审】** 固定顺序（下面从上到下就是写进记录的顺序，§2 的 `UnknownCallDecisionReasonV1` 同序），可以同时出现，全部写进记录：
  - `inventory_incomplete`：L8；
  - `review_stopped`：你暂停或取消了核对轮（L15）；
  - `review_incomplete`：这次进入以来第 2 轮还没做完（L15、L16 第 2 种），不论条目有没有结论（D2）；
  - `review_unavailable`：只读命令用不了，没跑核对轮或提方案的一轮（L13、L16 第 3 种）；
  - `partial`、`undetermined`：有跑程序的条目做了一半或判断不了（含 D6 改判的）；平台条目查不清（L4）也算 `undetermined`；
  - `crash_possible`、`crash_undetermined`：有跑程序的条目自查是“可能”或“判断不了”，不论这条命令做没做完（决定 53，选 a）。D6 改判的看不全的命令，自查一律是“判断不了”，所以这样的条目一定带 `crash_undetermined`（同时带 `undetermined`）；
  - `second_consecutive`：建记录时 L23 的 `priorUnknownProcess` 为真，而且这份记录有跑程序的条目；
  - `confirm_each_step`：定稿时读到目标的 `settings.autonomy` 是 `every_step`（没存设置按默认 `after_plan_confirmation`），而且有跑程序的条目；
  - `proposal_missing`、`proposal_declined`：L20。

### E. 请你决定

- **L18 卡的来源 `unknown_call_review`。【lead 定，待审】**
  - 派生来源，不另存卡（第 5 片 §4.1）：从状态是 `needs_decision` 或 `awaiting_approval` 的记录读出，经 `DecisionCardSourcePort` 注入决定队列。
  - **来源身份**（`decisionSourceKey` 加一种）：`{ kind: 'unknown_call_review', reviewRef, revision }`。同一份记录换了 revision 就是另一张卡（先例：`message_release` 的身份也带 revision）。
  - **pins：** 记录@revision、原 Run@revision、目标@revision；带 `goalBases`（第 5 片 §2.8 对新来源的要求）。
  - **卡上的对象：** 记录本身（aggregate pin）；每个目标路径一个文件对象（路径、当前摘要），界面据此打开文件和 Diff；命令全文在 Kernel 里，界面从记录的 Kernel 引用经已有的历史读取打开（决定 52 第 4 条）。
  - **两组作用对象（D7）：** 卡出现时定下，写进记录和卡：
    - `dispositionTargets`：所有要你决定的跑程序条目，加上查不清的平台条目。一个答复管这整组；要按条目分别处理的，选“我来处理”（决定 52）；
    - `proposalTargets`：`dispositionTargets` 里跑程序的那些。只有它们能提方案。
  - **选项：** `needs_decision` 时最多四个：`rerun_as_is`、`safer_method`、`skip_as_done`、`handle_myself`。`safer_method` 只在两条都成立时出现：`proposalTargets` 不为空（D7），并且记录至少还有 2 个轮次空位（L9，D2）；否则卡上三个选项，答 `safer_method` → `invalid`，不写。`awaiting_approval` 时两个：`approve`、`decline`。`effect` 都是 `apply`。
  - **混合的卡（D7）：** 卡上写明：选了换稳妥跑法、同意了方案以后，查不清的平台条目在接续说明里照 `rerun_as_is` 的写法写“结果查不清，重做前先核实”。
  - **答复：**
    - 必须选一个卡上有的选项，可以附一段话和批注（第 5 片的 `text`、`annotations`），都带进后面的说明或方案。只写话、不选项 → `invalid`：这种卡只能靠选项往下走，不然任务会一直卡着。选了卡上没有的选项（例如三个选项的卡答 `safer_method`）→ `invalid`。
    - 答的是旧 revision 的卡（记录已经变了）→ 版本钉不符，`revision_conflict`，不写。
    - 目标暂停时可以答，落实等继续（第 5 片 T02）。目标取消，或任务不再是 active → 卡只读，进历史（`closed`）。
    - 你在卡外直接点了“我来处理”（UCR-15）：记录变成 `resolved`，这张卡跟着进历史（`closed`）；之后再答它 → `revision_conflict`。
  - **可用性：** 核对记录的 owner 接上时报 `available`，否则 `not_available`（同第 5 片各来源）。
- **L19 落实（处置）是 owner 的一步，有自己的回执。【lead 定，待审】**
  - `resolveDecision` 对这种来源多一步，做法同冲突卡（`decision-actions.ts`）：① `answerDecision`；② `applyUnknownCallReviewDisposition`；③ `recordDecisionApplication`。
  - ② 写记录（revision+1，事件 `disposition_applied` 或 `approval_applied`），事件带 `DecisionChangeProofV1`：答复消息、捕获的 pins、记录的 before/after。第 5 片的落实白名单（`decision-application.ts:decodeProofEvent`）加 `UnknownCallReviewChanged` 的这两种 `change`，③ 才能补记。
  - **② 的请求身份由答复消息推出，和谁来落实无关。** 身份 = hash(记录 ref、`answerMessageRef`、阶段 `disposition` 或 `approval`)，不含调用方的 requestId 和操作者；指纹 = 规范化的 (来源键、选项、`answerMessageRef`)。这样你重试、Workflow 恢复（UR7）用的是同一个身份。
  - **同一个答复落实两次**：第二次同身份同指纹，按 RecordStore 的重放返回第一次的提交回执（`replayed: true`，带 identityKey、fingerprint、cursor、eventIds），不写。③ 读的正是这几项（`decision-application.ts:readApplicationReceiptFacts` 按 identityKey、fingerprint 查提交，再按 cursor 读事件），所以第二次也拿得到能补记 ③ 的正式回执。`resolveDecision` 和 UR7 拿到 ② 的回执（新提交或重放）以后，都接着做 ③；③ 本身按第 5 片的身份重放，只成功一次。② 落实以后记录的状态已经变了（`resolved`、`awaiting_proposal` 等），UR7 不再命中；这时 ③ 还没补记的，由 UR7b 在任何状态下补做（§3.4）；UR7b 从答复那边找（`listUnappliedAnswers`，L28），所以处置后来被直接点的“我来处理”盖掉也找得到（D4）。
  - **处置和观察分开：** 观察的结论一个字不改；处置写在 `disposition` 里：选项、作用对象、答复消息（卡外直接点的“我来处理”为 `null`）、来源（`card` 或 `direct`）、谁在什么时候落实、附言。
    - `rerun_as_is` → `resolved`。接续说明写：你选了照原样重跑；核对看到的是什么（例如“已做”）照写。不把“已做”改成“没做”。
    - `skip_as_done` → `resolved`。接续说明写：不重跑，当作已做。结果未知的历史保留：Kernel 里那条调用仍是 `outcome_unknown`，记录里的结论不改。
    - `safer_method` → `awaiting_proposal`（L20），`stateEntry` 加 1（L9）。
    - `handle_myself` → `resolved`，`hold: 'held'`（L21）。
  - **你停下的仍由你接着（D9）。** 原 Run R 的返工围栏是人的（`reworkFenceOf(R, 指针)` 是 `human_only`：认定之前指针上就有你的暂停或取消，`task-failure.ts:136–142`）时，答完卡、记录 `resolved` 以后，自动化判断落到今天的 AV-4（`task-failure.ts:779–791`），回 `task_paused` 或 `task_cancelled`；系统的重排被 `reworkPermission` 挡住（`human_only` 只收人，`task-failure.ts:384–399`）。所以任何答复都不让任务自动接着做，任务停着等你点今天的“继续”（人的 `tasks/requeue`）；这时 `hold` 不是 `held`，L11 照收这个重排。返工计数照今天。“我来处理”放开的那一下见 L21。
  - **平台在执行时拦不拦命令：B2，用户已定（决定 57，§1 B 组）。**
    - 用户原话：“agent需要填原因给人类，人类必须知道这个并允许，才能重新调用这个命令。这里基本上要么进入循环（不断调用+解释），要么agent自己放弃或者人类禁止或者人类允许。”
    - 平台拦下原命令：处置是 `skip_as_done` 的不许重跑，同意了方案的照方案跑、不跑原命令。要再调这条命令，agent 必须给人类一个原因，人类必须知道并允许。四种结果：agent 一直请求并解释；agent 放弃；人类禁止；人类允许。
    - lead 补的（用户可改）：卡上三个选项“允许重跑” / “不允许” / “不允许，也别再问”；平台按命令文字和静态解析认出常见的改写，认不出的改写 agent 要用 `rewriteOf` 注明以后再请求；允许只放行卡上那一种写法；卡和接续说明都写明这一点。卡和接续说明的固定句因此是“平台拦下原命令；要再跑先请求并得到允许。”（L20 的必需部分）。
    - **机制见下面的 L19a（决定 57）。**
  - **② 的守卫：** 答复消息存在，答的就是这张卡（来源键相同，所以 revision 相同），选的是这张卡上有的选项（L18，D2、D7）；记录@revision 仍是那个状态；目标 active（暂停 → `busy`，等继续）；目标的内容基础相同（第 5 片 T02）。操作者是你（operator），或 Workflow 的自动化身份（只在崩溃恢复时，L29 第 5 行）。守卫在查回执之后判断：重放不看当前状态。
- **L19a 拦原命令，和“请求重跑”。【lead 定，待审】**
  - **拦哪些命令。** 记录的处置在 ② 落实时，平台同时写下这份记录的“拦下的命令” `blockedCommands`（§2）：
    - `skip_as_done`：`dispositionTargets` 里每条跑程序的条目（种类 `process`）；
    - 同意了的 `safer_method`：`proposalTargets` 里每条的原命令（方案命令不拦）；
    - `rerun_as_is`、`handle_myself`、查不清的平台条目：不拦（用户的规则只说“跳过”和“换了跑法”）。
    - 命令全文从原 Run 的 Kernel 记录读（条目的 `KernelCallRefV1`，和接续说明读原 Turn 是同一个读窗口，K L9），不从记录的 512 字符摘要取；读不到 → ② 回 `unavailable`、不写（下次落实重试，UR7 照旧）。
    - **静态解析。** 纯函数 `parseShellActions(command)` 返回 `{ status: 'parsed'; actions: Array<{ words: string[]; text: string }> }` 或 `{ status: 'unparsed'; reason }`，放在 `state/command-normalization.ts`（和规范化在一起）。`words` 是词数组（比较键用它算），`text` 只作显示。规则：
      1. 认引号（`'…'`、`"…"`、反斜杠转义）；按 `&&`、`||`、`;`、`|`、`|&`、单独的 `&`、换行切成段；`( … )`、`{ …; }` 里面递归切。
      2. 段的开头是 `bash`、`sh`、`zsh`、`dash` 带 `-c`、`-lc`、`-ic` 和一个不含 `$`、反引号的静态字符串时，把这个字符串递归解析；最多 3 层。
      3. 去掉段开头的环境变量赋值（`NAME=值`，值是静态的）和这些前缀：`env`（连同它的赋值）、`command`、`exec`、`time`、`nohup`、`nice`；还有包管理器运行本地程序的前缀：`npx`（连同 `-y`、`--yes`、`--no-install`）、`npm exec --`、`pnpm exec`、`yarn exec`，以及程序名前面的 `./node_modules/.bin/`、`node_modules/.bin/`。这些只用来比对、只会多拦：`npx` 可能下载另一个同名的包，那样多拦一次也只是多一张卡，平台从不靠这条规则放行。
      4. 每段先按引号切成词数组 `words`：去掉纯字面量词两边的引号。动作的比较键是 `sha256(JSON.stringify(words))`；动作的 `text` 是把 `words` 用一个空格连起来，只作显示。所以 `tool 'a b'`（一个词）和 `tool a b`（两个词）是两个不同的动作。重定向（`>`、`>>`、`2>&1`、`<`）连同目标去掉，不进 `words`。
      5. 下面这些段算**无关的段**，不当动作：
        - 导航、空操作：`cd`、`pushd`、`popd`、`export`（静态赋值）、`set`、`unset`、`true`、`false`、`:`；
        - 输出：`echo`、`printf`；
        - 已知只读的查看命令：`ls`、`cat`、`head`、`tail`、`wc`、`pwd`、`which`、`test`、`[`、`grep`、`rg`、`git status`、`git diff`、`git log`、`git show`；带 `-exec`、`-delete` 的 `find` 不算。
        - 名单写死在规格里。改它算规则变化，要 lead 定；以后加模型判断时再考虑放宽。
      6. 认不了的写法一律 `unparsed`：
        - 引号不配对、here-doc（`<<`）；
        - 可执行位置上的 `$(…)` 或反引号，`eval`、`source`、`.`；
        - 进程替换、函数定义、`alias`；
        - 超过 3 层的嵌套。
        `unparsed` 的命令只按第七稿的整段文字比，不多拦（决定 68：拿不准时不多出卡）。
    - **脚本展开。** 动作是 `npm run X`、`npm run-script X`、`npm test`、`npm start`、`npm stop`、`npm restart`（后四个是 `test`、`start`、`stop`、`restart` 这几个脚本），`pnpm run X`，`yarn run X` 时，按 `package.json` 里 `scripts.X` 的正文展开；正文用同一个函数解析，得到的动作也算这个动作的展开，最多展开 2 层。`pre`、`post` 脚本不展开，免得把无关的准备步骤也拦了。`pnpm X`、`yarn X` 这类不带 `run` 的写法不展开，因为会和它们的内置命令混。
      - **目录按动作算。** 一个动作展开用的目录 = 这次调用的 `cwd`（请求工具没有 `cwd`，按 `"."`），加上同一条命令里排在它前面的每一个静态 `cd <路径>`，从左到右依次换。`cd -`、`cd` 不带参数、参数不是静态字符串 → 这个动作的目录算不出，不展开它。
      - **每个展开自己记依据。** 每个展开项写自己的 `basis: { path; digest } | { status: 'unavailable'; reason }`（不再用第七稿那种整条命令共用一个依据字段的写法）。文件读不到、解析不了、路径越出工作区 → 这一项 `unavailable`、不展开，不影响拦截本身。
      - **读文件的次数有上限。** ② 落实时每条拦下的命令至多读 4 个不同的 `package.json`；钩子里每次 `shell` 调用至多读 2 个。超过上限的文件不读，靠它们的动作不展开。用平台已有的工作区读口 `WorkspaceToolsPort.readWorkspace` 读（见 §1 的代码事实），`maxBytes = 262144`；文件更大 → `unavailable`。
    - **拦下的命令记什么**（改 §2 的 `blockedCommands`）：每条在第七稿的 `{ alias; commandSha256; kernelCallRef }` 之外加：
      - `reviewRunId`：这份记录的原 Run（`reviewRef.runId`；显示和跨记录对应都用它，K8-7）。
      - `actions: { text; sha256 }[]`：原命令解析出的、不算无关的动作；`sha256` 是 `words` 的比较键（上面第 4 条）。`unparsed`，或者全是无关的段时，这里只放整段规范化文字一项（`text` 是规范化文字，`sha256` = `sha256(JSON.stringify(规范化文字按空格切成的词数组))`）。
      - `expansions: { action; scriptName; scriptText; actions: { text; sha256 }[]; basis }[]`：脚本展开，每项带自己的依据（目录规则见上）。
      - **上限和退化。** 每条拦下的命令至多 16 个动作、8 个展开；`scriptText` 截到 2,048 字节（比较键都用截断前的全文算）；一条记录里所有 `blockedCommands` 的这些新字段合起来序列化后至多 16 KiB。超了先从最后一个展开起丢，再丢掉第 16 个以后的动作，并在这一条上写 `truncated: true`；处置照常写下去，静态展开从不拦处置。
    - **规范化** = 去掉首尾空白、把每段连续空白（空格、制表、回车、换行）换成一个空格，再算 UTF-8 的 sha256；只比命令文字，不比 cwd。纯函数放在 `state/command-normalization.ts`（新文件，见 §6）。
  - **拦的范围是这个任务。** 同一个 Task 以后的每一个 Work Run（接续、返工、以后的轮次）都拦；别的任务不拦。核对轮、提方案轮本来只读，不涉及。
  - **在哪拦。** `shell` 的每一次调用在交给沙箱以前，按下面的顺序走（执行准备时随绑定带上一份，只有 `reviewRunId`、`alias`、`commandSha256` 三个字段；调用时再读记录现在的状态，动作、展开、注明过的写法和已批准方案都从记录里取，这样运行中途来的“允许”也能用上）：
    - **(i) 先看一次性允许。** 这个任务里有没有 `allowed` 的请求、它的 `commandSha256` 等于 `commandSha256(这次调用)`：有 → 照 CRR-03 用掉（记下这次调用的 callId），提交成功才放行，这一次直接跑；
    - **(ii) 再看已批准方案。** `commandSha256(这次调用)` 等不等于这个任务里某个已批准方案命令的摘要（这些命令在拦下命令所属记录的 `disposition.approvedMethods` 里，钩子读记录时一起取）：等于 → 直接跑，不用请求，哪怕它含有被拦的动作；
    - **(iii) 否则**按 (A)/(B) 和注明过的写法比：
      - (A) `commandSha256(这次调用)` 等于某条拦下命令存的 `commandSha256` → 拦；
      - (B) 否则解析这次的命令。它的任何一个动作的比较键，或者它的 `npm run Y` 这类动作按**现在的** `package.json` 展开出的动作的比较键，等于某条拦下命令的 `actions` 或 `expansions[*].actions` 里存的键 → 拦；
      - 解析不了 → 只用 (A)；
      - `commandSha256(这次调用)` 只要出现在这个任务任何一条请求记录的 `declaredForms` 里（agent 注明过的写法）→ 也拦（(i)、(ii) 放行时除外）。
    - 现在的 `package.json` 用同一个读口在钩子里读，一次调用最多读 2 个；读不到就不展开。
    - 命中：这次调用**不执行**、不起沙箱、不建 scope，工具结果是固定的话：
      > 平台拦下了这条命令：其中的 `<命中的动作>` 是 #<别名>@<runId 前 8 位> 的一部分（核对以后处置是“<跳过/换了跑法>”）。要再跑，先用 `request_command_rerun` 写明原因，等人允许。平台没认出来的改写，也要用 `rewriteOf` 注明以后再请求。
      整段命中时不写“其中的……”。
    - 这是一个正常结束的工具调用（不是 `outcome_unknown`），不算失败、不计返工：Kernel 把它记成 `hook_blocked` 的工具结果，和今天 `read` 被路径钩子挡下一样，Run 不因它失败，模型接着做（lead 2026-10-16 核过 `execution-driver.ts:766`、`:919`）。拦的位置在 Runtime 交给 Kernel 的 `shell` 之前；本稿已查明接缝（`before_tool` 控制钩子把 `block` 透传成 `hook_blocked` 工具结果，不自行改 Kernel 补丁；见 §9.5）。
    - 钩子的结果照第七稿记成 `hook_blocked`，重放照 K 的规则读原结果，不重新解析，也不重读 `package.json`。
  - **例子**（也当测试，见 K8-4）：原命令 `cd app && npm run db:migrate`，`app/package.json` 里 `"db:migrate": "prisma migrate deploy"`。动作是 `npm run db:migrate`，展开是 `prisma migrate deploy`。

    | 之后的调用 | 结果 |
    | --- | --- |
    | `npm run db:migrate` | 拦 |
    | `bash -c "cd app && npm run db:migrate"` | 拦 |
    | `FOO=1 npm run db:migrate 2>&1 \| tee log` | 拦 |
    | `npx prisma migrate deploy` | 拦（剥掉 `npx` 以后等于展开出的动作） |
    | `prisma migrate deploy`、`./node_modules/.bin/prisma migrate deploy` | 拦 |
    | `npm run migrate:prod`，而它的正文也是 `prisma migrate deploy` | 拦 |
    | `cd app`、`git status`、`echo 'npm run db:migrate'` | 不拦 |
    | `npm run db:migrate -- --force` | 不拦：静态解析认不出改了参数的写法，agent 要用 `rewriteOf` 注明再请求 |

  - **请求工具 `request_command_rerun`。** 只注册在“这个任务有拦下的命令”的 Work Run 里。入参严格是 `{ command: string; reason: string; rewriteOf?: { review: string; alias: number } }`：`command` 是 agent 想跑的原文（1–4,000 字节），`reason` 是给人看的原因（1–2,000 个码点），`rewriteOf` 是拦下命令的出处：核对记录（`review` = 它的 `reviewRef.runId`）和别名（`#` 后面那个数）。一个任务可以有好几份核对记录，别名只在一份记录里唯一，所以两样都要给；`review` 也接受 `runId` 的前 8 个字符，只要在这个任务的记录里这个前缀唯一，不唯一 → `invalid`，工具结果里列出完整的 runId 当候选。拦下的固定话、卡和接续说明都写成“#<别名>@<runId 前 8 位>”。平台按 K8-1 的 (A)(B) 认出这条命令被拦：
    - 认出了 → 记下命中的是哪条拦下命令（哪个核对记录的哪个别名，`match.kind` 是 `exact` 还是 `action`），走第七稿的那几种回答；
    - 没认出、但 `rewriteOf` 给了这个任务里一个有效的出处（核对记录 + 别名）→ 当作这个别名被拦，`match.kind = 'declared'`，走同样的回答；
    - 没认出、也没给 `rewriteOf` → 成功结果 `{ status: 'not_blocked' }`，工具文字改成“平台没认出它和被拦的命令相同。如果它其实是被拦命令的改写，用 `rewriteOf` 注明再请求；否则可以直接跑。”；不建任何东西。
    - `rewriteOf` 的核对记录不是这个任务里的记录，或前缀不唯一，或别名不是那份记录里拦下的命令 → `invalid`。
    - **注明过的写法一定要存下来。** 这次是 `rewriteOf` 注明、(A)/(B) 没认出的写法时：这个别名在这个核对记录里已有 `pending` 的请求 → 把这条写法 append 到它的 `declaredForms`，再回那一个（`{ status: 'pending', requestId }`），不出第二张卡，工具文字写明它等的是哪种写法；已有 `denied`（同一个 Run）或 `denied_final` 的记录 → append 到那条记录的 `declaredForms`（新 CRR 行 `forms_added`：状态不变、revision + 1），再回对应的 `refused`，不出卡；没有这些记录 → 走 CRR-01，新记录的 `declaredForms` 就从这条写法开始。`declaredForms` 每条记录至多 8 条（`text` 截到 512 字节，只作显示），第 9 条 → `capacity`，什么都不写。
    - **被拦、这个别名已有一个等答复的请求（不是注明的新写法）** → 回那一个（`{ status: 'pending', requestId }`），不出第二张卡；工具文字写明它等的是哪种写法。允许用掉、被拒或作废以后才能再请求别的写法（一个别名在一份核对记录里同时只有一个请求）。
    - **被拦、这个别名已有一条 `allowed`（未用）的请求** → 回 `{ status: 'allowed', requestId }`，工具文字：“人已允许 <那种写法> 一次，还没用；先用它，用掉或作废以后才能再请求别的写法”；不写记录、不出卡。
    - 被拦、这个别名已被“不允许，也别再问”（`denied_final`）→ `{ status: 'refused', reason: 'denied_final' }`，不出卡；工具文字说“人已经不允许再问这个别名”。
    - 被拦、同一个 Run 已经请求过这个别名并被“不允许”（`denied`）→ `{ status: 'refused', reason: 'denied_in_this_run' }`，不出卡：同一轮里被否以后不能马上再问，要等下一轮（防止一轮里反复刷卡）。下一轮可以带新的原因再请求（用户说的“不断调用+解释”的循环，由人用“不允许，也别再问”结束）。
    - 否则 → 写一条请求记录（新聚合 `CommandRerunRequest`，§2），出一张卡，回 `{ status: 'requested', requestId }`。工具文字：“已请求，等人答复。这一轮不能跑这条命令；可以先做别的，或者结束这一轮并写明在等允许。”
    - 身份和重放照 L14：同一个工具调用重放回原结果，不出第二张卡。
    - **注明以后，这种写法也被拦。** 一条请求记录的 `declaredForms` 里的 digest 都算这个别名（这份核对记录里）的拦截对象；允许了，就照下面放行一次；不允许，就一直拦着。钩子比对时一起看。
  - **等的时候怎么停：不停。** 工具立刻返回，这一轮照常进行；平台不为等答复挂起 Run、不开持久等待（那是第 7 片的机制）。agent 可以做别的，也可以结束这一轮。答复以后：
    - “允许重跑”（`allow_rerun`）→ 记一次**一次性允许**：只放行卡上那一种写法，也就是这次请求里那条命令的 `commandSha256`。这个任务里下一次 `commandSha256(调用)` 相同的 `shell` 调用放行一次（运行中的这一轮或以后的轮次都算）；别的写法照拦。放行前先提交“已用”（CRR-03，记下这次调用的 callId），提交成功才放行；提交失败（版本冲突、存储读写不了）这次调用照拦下处理，工具结果写“暂时确认不了允许，稍后再试”，允许还在；提交以后、命令真正开始以前崩溃 → 允许已经用掉，这次调用照 K 的规则成了结果未知，进 K3 的核对（不还回允许：平台分不清命令有没有开始）。再下一次又被拦。允许不过期，任务结束时作废。放行以后的这次调用如果又结果未知，照 K3 的规则再核对。
    - “不允许”（`deny`）→ 请求关闭；同一个 Run 不能再问这个别名（上面），以后的 Run 可以带新原因再问。
    - “不允许，也别再问”（`deny_final`）→ 请求关闭；这份核对记录里这个别名以后的任何写法一律 `denied_final`，不出卡。
    - 接续说明（L20 的必需部分之后、固定结尾之前）对每条拦下的命令写一行固定的话：“#<别名>@<runId 前 8 位>：被拦；请求等答复 / 允许一次（未用）/ 不允许 / 不允许，也别再问”；这一行后面列出 agent 注明过的写法（最多 3 种，多了写“等 N 种写法”）。没有拦下的命令时这一段不出现，说明逐字节不变。
  - **卡的来源 `command_rerun_request`。** 派生来源，同 L18：从 `pending` 的请求读出，经 `DecisionCardSourcePort` 注入决定队列；来源身份 `{ kind: 'command_rerun_request', requestRef, revision }`；pins：请求@revision、它的核对记录@revision、目标@revision，带 `goalBases`；卡上：`#<别名>@<runId 前 8 位>`、原来拦下的命令全文（从 Kernel 读，同上）、这次请求的写法、请求记录里存的 `match`（`kind` 是 `exact`/`action` 时显示命中的动作，是 `declared` 时写“agent 注明是改写”；卡片直接读 `match`，不重新展开、不重读 `package.json`）、请求记录的 `declaredForms`（这个别名注明过的全部写法）、agent 写的原因、这个别名以前的请求和答复（最多 5 条，按时间倒序）。选项三个，`effect` 都是 `apply`：`allow_rerun` “允许重跑”、`deny` “不允许”、`deny_final` “不允许，也别再问”。卡上写明“平台按文字和静态解析认出改写；没认出的，agent 要注明以后才请求。允许只放行这一种写法”。**自治级别不影响它：** 永远要人答（用户的规则：人必须知道并允许）。
  - **落实**照 L19 的三步（① 答复、② owner 写请求记录、③ 补记），身份由答复消息推出；守卫：答的是这张卡、请求@revision 仍是 `pending`、任务仍 active（不是 → 卡只读进历史，请求 `closed`）、目标暂停时可以答、落实等继续。
  - **请求记录的状态**（写进 §3 的新一节 CRR）：`pending` → `allowed`（允许一次，未用）→ `used`；`pending` → `denied`；`pending` → `denied_final`；任何未完的状态在任务结束（满足、取消、被替代）时 → `closed`。`denied_in_this_run` 按（这个 Run、核对记录、别名）算，同一轮里换个写法也不能再问；`deny_final` 按（任务、核对记录、别名）算，这份核对记录里这个别名的任何写法以后一律 `denied_final`，不出卡。所以要一个按别名的等值索引（项目、目标、任务、核对记录、别名，§2）。放行前先提交“已用”（CRR-03，记下这次调用的 callId），提交成功才放行；提交失败（版本冲突、存储读写不了）这次调用照拦下处理，工具结果写“暂时确认不了允许，稍后再试”，允许还在；提交以后、命令真正开始以前崩溃 → 允许已经用掉，这次调用照 K 的规则成了结果未知，进 K3 的核对（不还回允许：平台分不清命令有没有开始）。
  - **lead 审稿补充（K8-6，2026-10-16）：**
    - **一条命令同时命中几条拦下的命令：** 按（核对记录的创建时间、别名）的顺序取第一条命中的，固定话和请求都记在它名下。给了 `rewriteOf`、而它在命中的那几条里 → 用它；给了 `rewriteOf`、但这条命令命中的是别的 → `invalid`（`rewrite_of_mismatch`）。
    - **允许按那一种写法认，不看别名。** 钩子先查这个任务里有没有 `allowed` 的请求、它的 `commandSha256` 等于 `commandSha256(这次调用)`：有 → 照 CRR-03 用掉、放行这一次（哪怕这条命令还命中别的拦下命令）；没有 → 再按 (A)(B) 和 `declaredForms` 里注明过的写法比。已批准方案命令先放行，见“在哪拦”的 (ii)。
    - **钩子每次读什么**（决定 69 的成本行）：只在这个任务有拦下的命令时，每次 `shell` 调用：按记录现在的状态核一次（第七稿已有）+ 按新索引 `k3-crr-by-task` 查这个任务的请求记录，⌈R/200⌉ 页（R = 这个任务的请求记录数；查询每页最多 200 条，查询自带记录，不另做 `readMany` 或批量读）+ 至多 2 次读现在的 `package.json`。没有拦下的命令时：0 次额外读。② 落实时：读原命令的 Kernel 记录（第七稿已有）+ 每条拦下的命令至多 4 个不同的 `package.json`（每个不同的目录算一个）+ 该写的记录。请求工具每次调用：⌈R/200⌉ 次按任务查 + 写 CRR 一次。这些数字落成 §5.2 的 B2-16…B2-18（在公开的存储读口上套计数包装）。
    - **复合命令里的每个动作都单独拦。** 原命令 `npm run build && npm run db:migrate` 被跳过以后，单跑 `npm run build` 也被拦：平台分不清是哪一段有副作用，静态规则只能这样；以后的模型判断可以替人少看这类卡。
    - **工作区读口的接线：** `WorkspaceToolsPort.readWorkspace` 由组合根注入 Runtime 的钩子和 ② 的 owner（端口类型放在 model 的契约里），复用已有的授权和拒绝前缀，不新增读权限。lead 同意。
  - **以后加模型判断。** 以后按实际使用再加模型判断（决定 68），它的用处是替人少看卡：先筛掉明显不是重跑的请求，或者在卡上附一句判断；它只能让平台多拦或少出卡，不能放行静态规则拦下的命令。
  - **测试**见 §5.2 的 B2-01…B2-18（入口用 R4 的 Work 场景和公开 owner；纯函数用例在 R5）；纯函数的用例另放一个单元测试文件（§6）。

- **L20 换个稳妥的跑法：agent 先提方案，你同意以后才跑。【lead 定，待审】**
  - `awaiting_proposal` 时，Workflow 开一轮“提方案”：用途同 L10（`phase: 'proposal'`），同样只读、同样的 Session 规则；工具把 `record_unknown_call_review` 换成 `propose_safer_method`。
  - `propose_safer_method`：给 `proposalTargets` 里每一条（跑程序的作用对象，D7）提一个原样的命令（入参见 §2，条目按别名给）。别的条目 → `invalid_arguments`。身份、重放、修改、守卫同 L14。
    - **大小在写的时候就挡住。** 每条命令 1–4,000 字节（UTF-8，这也保证不超过接续说明单段文字的 4,000 个 UTF-16 单位），cwd 最多 512 字节；这份记录当前所有方案（含这一条，同一条目的旧方案被替换）按接续说明的写法排出来（`approvedMethodLinesZh`，下面），整段最多 **5,120 字节**（UTF-8，下面的预算表推出来的）。超了，owner 回 `capacity`，工具结果告诉模型缩短，不写，不截。
    - 写的时候量的和渲染时排的是同一个纯函数（`continuation-brief.ts` 导出，WorkGraph 的 owner 也用它），别名由条目在记录里的位置定，所以量出来的就是到时候占的字节。到了同意那一步（UCR-12），只要锚点的任务 ID 都 ≤ T = 512 字节，方案一定放得进接续说明，同意不因为大小失败；任务 ID 超过 T 时，必需部分可能放不下，照今天第 1 片的规则抛 `ContinuationBriefCapacityError`、`prepare` 回 `capacity`（下一节“超出 T 的情况”）。
  - 这一轮正常结束 → 定稿：
    - `proposalTargets` 每条都有方案 → `awaiting_approval`，出第二张卡（L18），卡上逐条列出原命令和方案命令的全文；`dispositionTargets` 里查不清的平台条目不要方案（D7），卡上写明它们在接续说明里照“结果查不清，重做前先核实”处理；
    - 有一条没有 → `needs_decision`，原因 `proposal_missing`（又是四个选项的卡；空位不够时三个，L18）。
  - **同意（`approve`）** → `resolved`，`disposition.approvedMethods` 记下方案的 id、别名和命令全文。同意绑的是这一版记录（revision 在来源键里），方案变了就是另一张卡。接续说明写：不要跑原命令，照这里的命令原样跑；查不清的平台条目照 `rerun_as_is` 的写法写“结果查不清，重做前先核实”（D7）。平台在执行时拦不拦，见 L19a。
  - **接续说明里的“必需部分”。** 接续说明整份最多 16,384 字节（`continuation-brief.ts:179`），放不下时今天的渲染按 `RENDER_TEXT_CAPS`（4,000、1,000、250、60，`continuation-brief.ts:255`）把每段文字逐级缩，再从后往前略去正文行（`renderContinuationBriefZh`，`continuation-brief.ts:274–328`）；只有异常锚点一节是必需的，连它都放不下才抛 `ContinuationBriefCapacityError`，准备回 `capacity`（`context-assembler.ts:949`）。K3 照这个做法加第二个必需部分，放在异常锚点一节之后、固定结尾之前；有它、没有异常锚点一节时，也走“必需部分”那条路（今天没有异常锚点一节时整段正文都可略去，`continuation-brief.ts:287–300`；K3 改成：两种必需部分都没有的说明照旧逐字节不变）。
    - **必需部分按别名写，不写 callId（D8）。** 完整的 callId 只出现在不是必需的正文行里（每条的结论那几行：`#n = <callId>（<工具名>）：…`），会被缩短、略去。
    - **必需部分的写法**（固定的话，预算表按它算）：
      ```
      （空行）
      ### 结果未知的调用：核对和处置
      - 共 <条目数> 条（#1–#<条目数>），另有 <itemsOmitted> 条没有列出；各条的结论和依据见上文“核对结论”，可能被略去。
      - 处置：<选项的话>（<来源>）[；附言：<附言，缩到 60 个 UTF-16 单位>]。
      - 作用对象：<dispositionTargets 的别名，用“、”隔开>。
      <同意的方案：approvedMethodLinesZh 排出来的整段，没有方案时没有这一段>
      - 平台条目 <别名>：结果查不清，重做前先核实。        （有查不清的平台作用对象时才有）
      - 不在变动清单里，不证明没做。
      - 平台拦下原命令；要再跑先请求并得到允许。            （B2 由用户定，决定 57，机制见 L19a）
      ```
      选项的话：`rerun_as_is` “照原样重跑”；`skip_as_done` “跳过，当作已做：不要重跑这些命令”；同意的 `safer_method` “换个稳妥的跑法：不要跑原命令，照下面的方案原样跑”；放开了的 `handle_myself` “由人处理：操作者自己处理过这几条，先看当前状态”；没有处置（自动定下）“核对自动定下，不用决定”。来源：“卡上选的”“直接点的”“自动”。
    - **方案的写法 `approvedMethodLinesZh`：** 每条方案先一行 `- 方案 #<别名>，目录 <cwd，没有时写 .>：`，下一行起是命令原样，每行前面加两个空格（命令和 cwd 里的 `\r\n`、`\n` 都换成 `\n` 加两个空格，同 `clip` 的做法，`continuation-brief.ts:337–344`）；方案之间用 `\n` 连。不缩短、不略去。
    - **不是必需：** 每条的结论、依据、自查、`reviewerConclusion`、改文件的摘录和 diff（L6）。照今天的规则缩短、略去，标出略去了几行。
    - **字节预算表（D8，最坏情况，UTF-8；lead 按 bb924854 的代码逐项算过）：**

      | 部分 | 段数 | 最坏字节 | 怎么算的 | 依据 |
      | --- | --- | --- | --- | --- |
      | 开头 | 2 | 110 | “## 接续说明” 15；标记行 `[continuation-brief v1 sha256:<64 位十六进制>]` 95 | `continuation-brief.ts:195–197`、`275` |
      | 异常锚点一节的必需部分 | 28 | 5,008 + 8T | 空行 0；“### 异常锚点” 16；8 条锚点各 605 + T；“- 另有 N 条异常锚点没有装入本说明。” 65（N 按 16 位整数）；固定末句 87 | `continuation-brief.ts:514–542`；最多 8 条 `1036` |
      | 其中每条锚点 | 3 | 605 + T | 第一行 249 + T：固定的字 90、runId 36、sessionId 72、原因 27、记录时间 24、任务 ID T；“  - 改动的文件无法确定（原因）。” 238：固定的字 40、原因缩到 60 个 UTF-16 单位最多 180、“…（已截断）” 18；工作树警示行 118。“无法确定”行比“路径被略去”的情况长，按它算 | runId 是 `randomUUID`（`claim-service.ts:1092`，`create-platform.ts:752`）；sessionId 是 `session-` 加 64 位十六进制（`session-directory.ts:224–226`）；原因最长“归档中断了这次执行”（`continuation-brief.ts:496–499`）；记录时间是平台写的 ISO 时间；缩短见 `clip`（`337–344`），每个 UTF-16 单位最多 3 字节（换行变成换行加两个空格，也是 3 字节） |
      | K3 必需部分（不含方案） | 8 | 1,043 | 空行 0；标题 43；计数行 143（条目数 2 位、略去数 16 位）；处置行 314（选项的话最长 72、来源 12、附言最多 198）；作用对象行 200（32 个别名 180）；平台条目行 237（别名 180）；两句固定的话 44、62 | 上面的写法 |
      | 同意的方案 | 1 | ≤ C | `approvedMethodLinesZh` 排出来的整段，段内的换行和缩进都算 | 上面的写法 |
      | 固定结尾 | 6 | 357 | 空行 0；“### 继续之前” 16；四句 56、101、80、104 | `continuation-brief.ts:235–241`、`276` |
      | 段之间的换行 | — | 44 | 2 + 28 + 8 + 1 + 6 = 45 段，`\n` 连接，44 个 | `continuation-brief.ts:284` |
      | **合计** | | **6,562 + 8T + C** | 必须 ≤ 16,384，即 C + 8T ≤ 9,822 | `continuation-brief.ts:179` |

    - **T 是什么、C 怎么定。** 别的标识都有固定长度（Run 是 UUID，Session 是 `session-` 加摘要，时间是 ISO），只有锚点的任务 ID 契约不限长度：计划的 `taskId` 只要求非空（`plan-record-codecs.ts:352`），接续说明的校验也只要求非空（`continuation-brief.ts:643`、`689–695`）。K3 给每条锚点的任务 ID 留 T = 512 字节：8T = 4,096，C ≤ 9,822 − 4,096 = 5,726，取整到 **C = 5,120 字节**，还剩 606 字节余量。**这个“一定放得下”只在任务 ID 和 callId 都留在预留 T = 512 字节以内时成立；T 是预留，不是被强制的标识上限，超过 T 时必需部分可能放不下，照下一节回 `capacity`（第 1 片的规则）。** callId 同样有 512 字节的上限（L7、L8：Kernel 给的更长，那一条算 `undecodable_call`），但它不进这张预算表：必需部分只用别名，callId 只在记录里和可略去的正文行里。**整份记录 512 KiB 的上限不靠“每个字段都有上限”推出来，而是由 L7 的按序列化大小准入逐次量着拦（M3）：写后的记录超过 512 KiB 就不写、回 `capacity`。** 一条最长的方案（命令 4,000 字节、没有换行，cwd 512 字节，别名两位）排出来是 10 + 2 + 10 + 512 + 3 + 1 + 2 + 4,000 = 4,540 字节，放得下。
    - **超出 T 的情况。** 锚点的任务 ID 超过 512 字节、方案又用满 5,120 时，必需部分可能放不下，这时照今天第 1 片的规则抛 `ContinuationBriefCapacityError`、`prepare` 回 `capacity`（第 1 片 §2.7：“保不住必需段就 capacity，不默默删段”），不删 K3 的必需部分，也不调大 `renderedBytes`。K3-35 用正好 T = 512 的数据证明放得下，再用 T = 600 证明这时回 `capacity`、不默默删段（表是上界：平台条目行和方案不会同时用满，实际能凑出的最坏比表少 5 字节，所以边界例子取 600，超出 93 字节，不取 588）。
    - 渲染不调大 `renderedBytes`，模型输入的预算不变。
  - **不同意（`decline`）** → `needs_decision`，原因 `proposal_declined`，又是四个选项的卡（空位不够时三个）。被否的方案留在事件历史里。
- **L21 我来处理。【lead 定，待审】**
  - 落实以后记录 `resolved`，`hold: 'held'`。任务按“人暂停”挡住：自动化判断 AV-4c 回 `stopped('task_paused', { fence: 'human_pause', pausedBy: 'human', reviewHold: true })`，Workflow 不重排、不领取。AV-4c 在 AV-3 之前，所以已有的人发起的重排也不能绕过它。
  - **随时可以点，不只在卡上（决定 52、§0 第 4 条“随时”）。** 新的 owner 操作 `holdUnknownCallReview`（端口方法 `UnknownCallReviewPort.holdReview`），只收人（操作者类别 `human`），路由 `unknown-call-reviews/hold`，`GraphWrite` 钉记录@revision（UCR-15）：
    - 适用：记录是 `pending_review`、`awaiting_proposal`、`needs_decision`、`awaiting_approval`；或者已经 `resolved`、`hold` 不是 `held`，而且原 Run 仍是任务的选定 Run（接续还没领取；已有 TaskRequeue 没领取的也算）。接续已经领取的，记录成了历史，要停就用普通的暂停。
    - 效果：写一条不经卡的处置：`choice: 'handle_myself'`，`source: 'direct'`，`answerMessageRef: null`，作用对象是 `dispositionTargets`（所有跑程序的条目加查不清的平台条目），`appliedBy` 是你；状态 `resolved`，`hold: 'held'`；原来的处置（如果有）留在事件历史里。事件 `hold_applied`。AV-4c 和 L11 照常拦。
    - 提交的守卫（D3）：记录@revision；它读到的 TaskLease@revision；“原 Run 仍是选定 Run”读到的那些事实（L11 的“领取和我来处理互相加守卫”）。
    - **这时有进行中的一轮（核对或提方案，D3）：** 状态照样写成 `resolved`、`held`，然后按这一轮走到哪一步收尾：
      - **领取了、还没进入**（**取消专用判断** `isUnenteredReviewRoundForCancellation`，§2：`starting` 里 Claimed、Authorized、Revoked 三种，证明从没进入，**包括被暂停的**；已经 `cancelled` 的不算）：UR3a 不开始它；Workflow 走今天“没进入就结束”的那条路结束它：以 Workflow 的自动化身份对这个 Run 提交 `cancel` 控制（`RunControlPort.submitControl`，`control-contracts.ts:22–31`；Workflow 依赖里已有 `controls?`，`business/workflow/ports.ts:108`），提交时钉住读到的那一版 Run（revision 守卫），控制 owner 按 RUN-09（U）（D-7）把它结束成 `cancelled`：同一提交结束 Attempt（ATT-05）、Outbox 记没进入（ATT-30）、释放 Lease（ATT-23）和 Session 占用（SES-05，游标不动，`kernelTurnOpen: false`）（`run-machine.ts:1712–1780` 的 `onNotEnteredControl`、`notEnteredCancelEffects`；`control-service.ts:347` 的 `stop_not_entered`）。先例：归档流程就这样以系统身份取消一个可能还没进入的 Run（`business/workflow/session-archive.ts:373`）。之后 UR4 的 `settle_review` 只收尾这一轮（UCR-08b）。今天 RUN-02 拒绝以后 Workflow 只回 `waiting`（`workflow.ts:1865`），不会自己结束这个 Run，所以要这一步（UR3h）。万一 UR3a 已经读过记录、`start` 在你点了以后才到：RUN-02 对 `hold: 'held'` 的核对轮回 `stale`（L11），下一次选择走 UR3h；
      - **已经进入、在跑：** 照常跑完（你要立刻停它，另用普通的暂停或取消），已写和之后写的结论照收（L14）；
      - **已经结束、还没定稿：** `settle_review` 只收尾这一轮（UCR-08b）。
      - 三种都是：结束以后的 `settle_review` 不改状态、不出卡（L16）；Workflow 不再开新一轮。
    - 有卡的（`needs_decision`、`awaiting_approval`）：卡跟着进历史（L18）。
    - 重复点：同一请求重放原回执；记录已经 `held` 的，新请求回 `busy`（“已经在等你处理”）。
  - **你处理完，点“继续”：** 新的 owner 操作 `releaseUnknownCallReviewHold`（端口方法 `releaseHold`），只收人，路由 `unknown-call-reviews/release-hold`。守卫：`activeRound` 为空，否则回 `busy`（“核对轮还没收尾”，D3）；所以 `resolved`、`released` 的记录从不带着没定稿的一轮，UCR-04、UCR-08b 不用再收这种来源状态。`hold` 变成 `released`，revision+1。之后照常接续（这一次自动重排不出确认卡，L22）；接续说明写：操作者自己处理过这几条，先看当前状态。
  - **原 Run 是你停下的（D9）。** 原 Run R 的返工围栏是人的（L19）时，release-hold 就是那一下“继续”：Host 的 `unknown-call-reviews/release-hold` 路由先调 `releaseHold`，再以同一个操作者调人的重排（`requeueTask`，afterRun 是 R，和今天 `tasks/requeue` 一样）。两次 owner 调用，各自有自己的身份，各自幂等；两次之间崩溃，记录已经 `released`、任务停在 AV-4，界面照今天显示“继续”，你再点 `tasks/requeue` 或再点 release-hold（`releaseHold` 重放原回执，再做重排）都接得上。别的任务（围栏不是人的）照上一条，只调 `releaseHold`，之后由自动重排接续。
  - **“继续”只有这一个入口。** 今天 `task_paused`（`human_pause`）的“继续”是人的 `tasks/requeue`。`hold: 'held'` 时，重排的 owner 对不带归档来历的人的重排回 `busy`，原因 `unknown_call_review_held`，写明要点 release-hold（L11）。界面按 AV-4c 细节里的 `reviewHold: true` 把“继续”接到 release-hold。
- **L22 自治级别、不出两张卡、计数。【lead 定，待审】**
  - **读：** 定稿时读 `Goal.settings.autonomy`（L17）；落实时再核对目标 active 和内容基础（L19）。
  - **不出两张卡。** 普通的“自动返工要确认”卡今天有三处推导：Workflow 的 `workflow.ts:automationConfirmation`；读模型的 `goal-decision-reader.ts:automationCauses`（看自动化判断）；目标暂停时判断变成 `none`（AV-0），读模型改用 `decision-policy.ts:pausedAutomationAction` 从保存的失败事实推导。只改第一处会在别处多出一张卡。所以规则写进共用的 `decision-policy.ts`，三处都用：
    - 失败事实（`TaskFailureFactsV1`）加 `unknownCallReview: { status, hold, requeueConfirmed }`（选定 Run 有记录时才有）；
    - `pausedAutomationAction` 加和 AV-2b、AV-4c 相同的判断：记录没定、读不出，或 `hold` 是 `held` → `null`，不推导卡；
    - `automationConfirmationCause` 的入参加 `requeueConfirmedByReview`：为真而且动作是 `system_requeue` → `null`。`requeueConfirmed` 在下面这些情况为真：记录 `resolved`，并且有你的处置——核对卡上选了 `rerun_as_is`、`skip_as_done`，同意了方案，或“我来处理”已放开（`hold: 'released'`，卡上选的和直接点的都算）。你的答复或你的“继续”就是那一次重排的确认；
    - 只管对同一个原 Run 的那一次自动重排（`coveringRequeue` 还没有时）；之后的 Run 照常；
    - 记录自动定下（没有你的处置）时，普通确认卡照旧。例如“每步确认”下只有平台、改文件条目：没有核对卡，只有普通确认卡一张；
    - 记录没定时根本不重排（AV-2b），所以不会同时出普通确认卡；
    - 原 Run 的围栏是人的（D9，L19）时没有系统的那一次重排（AV-4 停住），`requeueConfirmed` 用不上；接续是你的“继续”（人的重排），本来就不出确认卡。
  - **计数：**
    - RUN-25 结束的 Run 按“被中断”算（L26）：不占普通返工上限，不比无进展的键（决定 52）；
    - 人认定的照今天：`crashed` + `human_attested` 是 `run_failed`，自动重排算一次（FC-9）。K3 不改，也不把 RUN-25 的豁免扩到它；
    - 核对轮、提方案的一轮：不建重排，不算次数，不改 `autoCount`，不进目标的已结束 Run 计数，不让已有的拒绝变旧（L10）。核对轮什么也不重置。
  - **暂停和取消：** 目标暂停时 Workflow 不开核对轮，卡照样能答；任务或目标取消，记录留着不动，卡进历史。
- **L23 “连续”的算法（决定 52 的“连续只一次”和“连续第二次”）。【lead 定，待审】**
  - 两个判断都沿任务原来的工作来历走：从这个 Run 往回，经 `requeueRef.afterRunId` 和 `consumedWait.runRef`（今天 `task-failure.ts:chainRunIds` 的走法）。核对轮不在这条链上。
  - 往回走到“重置点”为止，不含重置点。重置点只有一种：一个以 Kernel 终态结束的 Run，终态是 Kernel 自己写的（RUN-07、RUN-17/18、RUN-21），含让出 `yielded`；平台合成的终态（RUN-19/23/24、RUN-25）、认定（RUN-22）都不算。
  - **你的处置不是重置点。** 第三版曾把“记录上有你的处置的 Run”也当重置点，那会违反决定 52 的“同一任务连续只自动收尾一次”和“连续第二次这样中断必须由你确认才能重跑”：A 跑命令 X 把 Host 弄崩 → RUN-25 → 核对自查“可能” → 出卡 → 你选照原样重跑 → B 重跑 X，Host 又崩。要是你的处置算重置点，B 会第二次自动收尾（连续两次 RUN-25），B 的记录也没有 `second_consecutive`；B 的核对轮写“已做 / 不太可能”就自动定下，C 第三次跑 X，中间没有任何确认。你在 A 之后的确认是给 B 的，不是给 C 的；B 正是“连续第二次这样中断”。所以去掉这一条。（lead 给第三版定的 L-STREAK 写了“或自上次人的处置以来”，这里按决定 52 改掉；要保留它，就是在改决定 52 的“连续”，得列进 §1“提请同步 §0”交用户定，不能标【lead 定】。）
  - `priorAutoCleanup(R)`：重置点之后、R 之前，有 Run 是 RUN-25 结束的。RUN-25 要求它为假。
  - `priorUnknownProcess(R)`：重置点之后、R 之前，有 Run 的记录里有跑程序的条目（RUN-25 或认定都算）。它为真、而且 R 的记录也有跑程序的条目 → `second_consecutive`。
  - 两个值在建 R 的记录时算好，写进记录的 `streak`。读到的 Run 和记录都在同一次提交里加版本守卫。
  - **例子：**

    | 例 | 链（旧 → 新） | R | priorAutoCleanup | priorUnknownProcess | 结果 |
    | --- | --- | --- | --- | --- | --- |
    | 1 | A：RUN-25，有命令，核对自动定下 | B 又在命令中断 | 真 | 真 | B 不自动收尾（RUN-20）；你认定 B 以后，B 的记录有 `second_consecutive`，出卡 |
    | 2 | A：RUN-25；B：正常做完（Kernel 终态），检查没过，重排 | C 在命令中断 | 假（B 是重置点） | 假 | C 可以自动收尾，不算连续 |
    | 3 | A：RUN-25，出卡，你选照原样重跑 | B 在命令中断 | 真（处置不是重置点） | 真 | B 不自动收尾，走 RUN-20(i)，`blockedBy: 'second_auto_cleanup'`；你认定 B 以后，B 的记录有 `second_consecutive`，出卡 |
    | 3b | A：RUN-25，出卡，你选换稳妥跑法并同意了方案 | B 跑方案命令时中断 | 真 | 真 | 同例 3：B 不自动收尾；认定以后出卡 |
    | 3c | A：RUN-25，出卡，你选照原样重跑；B 正常做完（Kernel 终态） | C 在命令中断 | 假（B 是重置点） | 假 | C 可以自动收尾 |
    | 4 | A：RUN-25；B：干净中断（RUN-19），没有结果未知 | C 在命令中断 | 真（B 不是重置点） | 真 | C 不自动收尾 |
    | 5 | A：RUN-25；A 的核对轮被重启打断一次（带没结果的调用，RUN-20(i)，你认定了它） | B 在命令中断 | 真 | 真 | 核对轮不在链上，不改结果，同例 1 |
    | 6 | A：让出等回复（Kernel 终态 `yielded`）；B 接着 A | B 在命令中断 | 假 | 假 | B 可以自动收尾 |
    | 7 | A：Turn 已有终态但命令没结果（RUN-20(i) 的终态变体），你认定，A 的记录有命令，核对后自动定下 | B 在命令中断 | 假（认定不是 RUN-25） | 真 | B 可以自动收尾；B 的记录有 `second_consecutive`，出卡 |
    | 8 | A：RUN-25 在原 Session；K 关闭失败，接续换到新 Session | B 在新 Session 里中断 | 真 | 真 | 链按 Run 走，不按 Session，同例 1 |
    | 9 | A：RUN-25，只有一条发消息没结果（没有命令） | B 在命令中断 | 真 | 假 | B 不自动收尾（“连续只一次”不分种类）；你认定以后不带 `second_consecutive` |

- **L24 接上 2A。【lead 定，待审】**
  - 来源按 2A 的完整分页读：按 `k3-ucr-by-goal-status` 对每个目标分页读到底，没有条数上限，不报 `capacity`；参与 2A 的稳定窗口（2A L7：读取中途有新提交就整窗重读，一共 4 次）；一次稳定尝试里只拼一次（2A L11）。
  - 来源适配器每页读多少条是构造参数 `pageLimit`（默认 200，1–200），组合里不改；K3-20 用小的 `pageLimit` 证明翻页读到底，5,001 的规模留给 2A 的夹具（QA-05、QA-09）。
  - 单张卡（`readDecisionCard`）：来源键里有 reviewRef，直接按键读这份记录，不翻页。
  - 不另加“请知悉”：RUN-25 以后的接续是一次系统发起、不计次的重排，已有的自动返工通知（`automatic-rework-notices.ts`）就以“自动恢复 · <任务>（不计次）”出现，身份（`automatic_rework:<重排 ref>`）和位置（重排的 `since`）照旧。

### F. 重启后的自动收尾

- **L25 新行 RUN-25。【lead 定，待审】** 全行见 §3。要点：
  - **来源状态：** `Entering`（授权在 `entering`）或 `Running`，启动核对（R 来源），基础 `host_instance_takeover`。`EndedUnknown` 不走它（L1）。
  - **在分类器里的先后**（`run-reconcile.ts:classifyRun`，从上往下第一条命中；第 5b 行是 K L1 的，第 8 行是 K3 新的）：

    | 顺序 | 情况 | 行 |
    | --- | --- | --- |
    | 1 | 旧授权、没开始过 | 照今天，left |
    | 2 | 探测 `host_config`、`transient`、`cancelled` | W-07，left |
    | 3 | 探测 `missing`、`damaged` | RUN-20(ii) |
    | 4 | 读 Kernel 历史失败 | failed |
    | 5 | 找不到这个 Turn 的 `turn.started` | RUN-16（Entering）或 failed |
    | 5b | Turn 已经是 `interrupted`（平台 Run 没结束，Kernel 却已关） | left，原因 `kernel_closed_without_platform_end`（K L1）；什么都不写，**从不 RUN-25、RUN-20**。K 把 `interrupted` 加进 `TERMINAL_STATUSES` 以后，这一行必须在第 6、7 行之前，不然它会落进第 6 行（被关的 Turn 里开始了没结束的调用记为 `outcome_unknown`） |
    | 6 | Turn 有终态，有调用没结果 | RUN-20(i)（列不出 ID 时 left），**从不 RUN-25** |
    | 7 | Turn 有终态，都有结果 | RUN-17/18，或 RUN-20(iii) |
    | 8 | Turn 没终态，`inFlightToolCallIds`（`running`、`outcome_unknown` 的调用）不为空 | 核对用途的 Run → RUN-20(i)，`blockedBy: 'review_round'`（D1，不查别的守卫）；普通工作 → **RUN-25**，守卫不全成立时 RUN-20(i)。今天这一支在 `run-reconcile.ts:373–375`，用途的判断加在它前面 |
    | 9 | Turn 没终态，没有没结果的调用 | RUN-23、RUN-19、RUN-24（照今天） |

  - **守卫**（第 8 行要全部成立；哪一边查写在表里）：

    | G | 守卫 | 谁查 | 不成立时报告的 `blockedBy` |
    | --- | --- | --- | --- |
    | G1 | 本 Host 持有租约，证明是 `hl01_no_lock` 或 `hl03_stale_lock`（`memory_store` 不算，L2）；分类器入参的 `takeover` 和 `HostInstanceFacts.takeover` 相同 | 两边（分类器看自己的入参，WorkGraph 看 `HostInstanceFacts`） | `no_takeover_proof` |
    | G2 | 没结果的调用都列得出 ID | 第 8 行的条件本身（`inFlightToolCallIds` 不为空）；不单独报 | — |
    | G3 | 每个没结果的调用都在 L3 的表里、跟着 Host 停（WorkGraph 按名字重算，不信分类器） | 两边 | `uncontained_tool` |
    | G4 | 指针不是 `paused`、`cancelled`、`steered`（排队的、已生效的都算；`running` 即恢复以后的不挡） | WorkGraph | `stop_pending` |
    | G5 | 已接受的输入都核对过来源（`inputsConfirmed === true`） | 两边 | `inputs_unconfirmed` |
    | G6 | K 能关：Runtime 装了关闭；这个 Session 的存储支持（不是只有 legacy 读取器、适配器相同、Kernel 有 `closeOpenTurn`）；探测读到的头 `activeRunId` 就是这个 Run 绑定的 Kernel runId | Runtime（新的只读查询 `turnClosureSupport`，做 K L4 第 5 条的检查，不写） | `closure_unsupported`、`head_mismatch` |
    | G7 | Session 是 active，没有归档请求，没有来历指向它的接续 Session；占用是这个 Run（claim 代际相同） | WorkGraph | `session_not_closable` |
    | G8 | 工作区采集 `captured`，`runBaselineKnown: true`（L5） | Runtime | `no_baseline`、`workspace_<原因>` |
    | G9 | `priorAutoCleanup(R)` 为假（L23） | WorkGraph | `second_auto_cleanup` |
    | G10 | 用途是普通工作（Run 记录的 `purpose` 缺省）。分类器在 G1 之前先看用途，核对用途的 Run 从不附候选（L15，D1）；WorkGraph 这一条是防御：候选落到核对用途的 Run 上也走 RUN-20(i) | 两边（分类器最先查，WorkGraph 也最先查） | `review_round` |
    | G11 | 清单按 L8 的 `complete`：没结果的调用不多于 32 条，每条的名字和参数都解得出、callId 不超过 512 字节，而且全部条目按创建预算 B（L7）放得下。前几种不成立时 UCR-01 会拒绝建记录，Run 留在 `Running`、每次启动都失败一次，所以在这里先挡下，走 RUN-20(i)；**只有 `too_large` 不挡**：平台按创建预算截条目、清单记 `incomplete/too_large`，候选照附、记录照建（L7、L8） | 两边（Runtime 算，WorkGraph 校验草稿） | `inventory_incomplete`（`too_large` 除外，它不是 `blockedBy`） |

    - G6 的 `head_mismatch`：一个 Turn 还开着的 Run，在合法的存储里总在 Kernel 头上（K L2 第 5 行），造不出这种情况；造它要篡改数据库，AGENTS.md 第 4 条不许。所以这条守卫留着防坏数据，不写测试，由代码审查核对（同 K）。
  - **先后固定，报告第一条不成立的。**
    - 分类器按 G10、G1、G3、G5、G6、G11、G8 的顺序查（用途最先，只看 Run 记录，不读别的；采集最贵，放最后）；有一条不成立就停，不再做后面的读、采集和平台工具的查找，附 `{ blockedBy }`。所以核对用途的 Run 没有基准、没结果的调用多于 32 条，报的也是 `review_round`（K3-21）。分类器新加的依赖（`turnClosureSupport`、工作区采集、查找）都是可选的：没接上就算那条守卫不成立。
    - 都成立才附候选；WorkGraph 再按 G10、G1、G3、G4、G5、G7、G9、G11 的顺序查。
    - RUN-20(i) 的核对观察都记下为什么没自动收尾（`unresolved` 加可选字段 `autoCleanupBlockedBy`，§2）：分类器挡下的，记分类器在 `unknown` 结果里交来的 `blockedBy`；分类器放行、WorkGraph 挡下的，记 WorkGraph 的第一条。这样报告和以后的界面都读得到。
    - 报告的 `blockedBy` 从提交的 Run 的这个字段读，两种情况一样。
    - `reconcile_unknown` 事件（`run-machine.ts`）加可选的 `autoCleanup`（候选或 `{ blockedBy }`）。没带的（RUN-20(ii)、(iii)、RUN-08，和今天直接构造事件的状态机测试）不写这个字段，观察和今天逐字相同；`tests/state/run-machine.test.ts` 里对 RUN-08 观察的 `toEqual`（第 955 行）因此不翻转。
  - **谁来选：** 分类器在 Runtime 那一边的守卫都成立时，在 `unknown` 结果上附一个自动收尾候选（§2 `AutoCleanupCandidateV1`：证明、K 关闭的检查结果、工作区采集、记录草稿）；有一条不成立时附 `{ blockedBy }`。WorkGraph 的状态机再查自己那一边的守卫：都成立走 RUN-25；否则在同一次调用里照今天写 RUN-20(i)（做法同 C4：状态机按指针在 RUN-19、RUN-24 之间选）。
  - **报告：** 走 RUN-20(i) 的报告行照旧（`row: 'W-13'`、`reason: 'unknown'`），另加 `autoCleanup: { applied: false, blockedBy }`；走 RUN-25 的报告行 `row: 'W-26'`、`reason: 'takeover_unresolved'`、`autoCleanup: { applied: true }`。（`W-25` 已经是 §12.2 里 prepare 遇上 `transient`/`cancelled`/`host_config` 探测的行，所以新行用 W-26。）
    - `startup-reconcile.ts` 的 `ReconcileLine` 今天只有 `{ ref, row, status, reason }`，第 2 步只抄这四项。K3 给 `ReconcileLine` 加可选的 `autoCleanup`，第 2 步把 `RunReconcileReport.autoCleanup` 一并抄过去；R1、R3 的断言读的是 Host 报告里的这一项。
  - **写什么**（一次提交，同 RUN-19 的配对，再加记录）：
    - Run：`Ended(crashed)`，授权 settled；合成 `run_crashed`（sequence = lastEventSeq+1，error 是 `host_takeover: <N> tool call(s) with unknown results`，只作显示和审计）；`terminalPayload` = 这个合成事件的载荷；核对观察 `takeover_unresolved`（§2，含证明、没结果的调用 ID、读到的位置、记录 ref），status `done`；
    - 从 `Entering` 来：补记进入事实（startedAt = Turn 开始时间，`bind_history`）；从 `Running` 来：不前移 Run 的位置记录（同 RUN-19）；
    - Attempt：`attempt_ended(crashed)`（Running 来是 ATT-09；Entering 来是 ATT-31，补记 startedAt）；Outbox `settled(entered)`（Entering 来是 ATT-33）；
    - 释放 Lease；释放 Session，`kernelTurnOpen = true`，同一提交 Session 记为 `unavailable/kernel_turn_open`，`historyCursor` 不动（SES-06 加 RUN-25 这一种来源）；
    - 控制意图：排队的 resume 记 `terminal_without_cancel`；排队的 steer，Kernel 接受过的记 Applied（CTL-08(b)），其余 Superseded（CTL-08(c)），正文进接续说明。全同 RUN-19；
    - 同一提交按草稿建核对记录（L8，UCR-01），平台工具的结论已经定好；读到的链上 Run 和记录都加版本守卫（L23）。RUN-25 只有普通工作的 Run 才走（G10），所以总有记录。
  - **守卫 CAS：** 执行窗口（Run、Attempt、Outbox、Plan、Session、Lease）、各控制意图、记录键必须不存在、链上读到的 Run 和记录。
  - **重放：** 核对身份照 RUN-17..24，是 hash(runRef, hostInstanceId)：同一实例再做时原回执回放；之后的实例遇到的已经是 `Ended`，不在候选里。
- **L26 失败类别。【lead 定，待审】** `deriveReworkClass` 加一行 FC-7b：`crashed` + `takeover_unresolved` → `interrupted` / `executing`。
  - 不比较“无进展”的键，不占普通返工上限（`counted` 为假）。
  - 自动化照常重排（在 L11 的门之后），“请知悉”里是“自动恢复”（L24）。
  - `runUnresolvedBlocker` 不挡它（status 是 `done`）；`runErrorOf`、`interruptionFacts` 认这种观察（接续说明的“中断时正在执行”）。
- **L27 接上 K。【lead 定，待审】**
  - K L4 第 2 条的结束方式表加两行：
    - `crashed` + `takeover_unresolved`（RUN-25）不要 TaskRequeue（和 RUN-22 一样）；
    - **核对用途的 Run**（`purpose.kind === 'unknown_call_review'`）：只要结束方式已知（RUN-19、RUN-22、RUN-23、RUN-24；核对用途的 Run 从不走 RUN-25，D1），并且它已经不是记录的 `activeRound`（`settle_review` 收尾过），就不要 TaskRequeue。理由：核对轮只读；你的暂停或取消已经由记录接住（L15 的 `review_stopped`，出卡），关它的悬空 Turn 只是让 Session 回到可用，从不恢复它，也不推进任务。RUN-24 的核对轮今天要 TaskRequeue 覆盖它才能关，而核对轮从不被重排，不加这一行就只能走退路。
  - K L4 第 1 条（领取 Session 就是 `sessionRef`）不改：L12 传进来的 `afterRunRef` 是最近持有者，它的领取 Session 就是要关的那个。
  - K L7 维护插入点的第 3 条加上它们：没有接续的退役线，最近那次 Run 是 RUN-25 的，或是上面那种核对用途的 Run，维护也关（`business/workflow/session-maintenance.ts`）。
  - 关闭悬空 Turn、留在原 Session、确定失败退到新 Session，都照 K 片；核对轮和接续都走这套（L12）。
  - K L9 的事实窗口照旧：接续说明按 Kernel 身份读原 Run 的那个 Turn（关闭后是 `interrupted`）。
  - 能力上报（K M6 的 `recoverRun.reason`）末尾加一句，原文：

    ```
    After a Host restart, a Work Run whose open Kernel Turn has tool calls without a result is ended by the platform (host_takeover) when the instance lease proves the previous Host is gone, every such tool stops with the Host, the workspace is a Git work tree with the Run's start baseline, the dangling Turn can be closed, and the Task's previous Run was not ended this way; the calls are then reviewed by kind before the Task continues, and a person decides when the review cannot tell. Otherwise the outcome stays unknown until a person attests it, and the same review follows the attestation.
    ```

- **L28 启动时找出没定的记录。【lead 定，待审】**
  - 启动核对加第 2b 步，在第 2 步（Run 核对，含这次刚建的记录）之后：按 `k3-ucr-by-workspace-open` 分页读 `open = 'yes'` 的记录（D4：不按状态列，所以“我来处理”定下、还有一轮没定稿的记录也在里面），每页 100 条，最多 100 页（同第 1 步的界）；读不完写进 `problems`。只读，不写。
  - 报告加 `reviews: ReconcileLine[]`，每份一行（`row: 'UCR'`、`status: 'left'`、`reason` 是状态、原因、有没有没收尾的一轮）。
  - 第 6b 步加条件 (c)，active 的目标里有下面任一种，就交给启动重驱（受 `resumeOnStartup` 控制）：
    1. `open = 'yes'`、状态是 `pending_review` 或 `awaiting_proposal`、`hold` 不是 `held` 的记录（包括 `activeRound` 的 Run 领取了还没进入的）；
    2. `open = 'yes'`、`activeRound` 不为空的记录，不论状态和 `hold`：那一轮要收尾（结束了的走 `settle_review`；`held` 而且领取了没进入的走 UR3h 结束它）。`held` 的记录只收尾这一轮，不开新一轮（L21）；
    3. `needs_decision`、`awaiting_approval` 的记录，而且它当前那张卡已经有答复（用第 5 片的答复索引 `s5-decision-answer-by-source` 按来源键查）；
    4. 这个目标里有 `unknown_call_review` 来源的答复，② 已经提交、③ 还没补记（下面的“没补记的答复”）。每条按它自己的 `reviewRef` 交出去，不看任务的选定 Run、任务资格和记录的 `open`（M2）。
    - 今天的条件 (b) 只看任务的选定 Run，选定 Run 从来不是核对轮，所以核对轮的“领取了没进入”要靠 (c) 把目标交出去，再由 UR3a 准备、开始那个 Run。
  - `hold: 'held'`、没有进行中的一轮的记录（`open = 'no'`）不进 (c) 的第 1、2 种：它等你点“继续”，重启不改（L29 第 10 行）；但它的卡答复要补 ③ 的，照第 4 种交出去（只补记账，不放开、不接续）。
  - **没补记的答复从决定模块那边找，不从记录当前的处置找（D4）。**
    - 为什么：记录当前的处置可能已经被你直接点的“我来处理”盖掉（`answerMessageRef: null`），早先那张卡的答复要是 ② 已落实、③ 还没补记，从处置上就看不到了。
    - 第 5 片今天有什么（lead 核过 bb924854）：只有按完整来源键找答复的索引 `s5-decision-answer-by-source`（`ref.projectId`、`ref.workspaceId`、`decision.source.kind`、`decision.source.key`，`sessions/message-record-codecs.ts:67`、`137–141`；读法见 `views/decision-read-model.ts:1043` 的 `findAnswerMessage`）。查找只认完整的一组值（`record-store/lookup-ports.ts` 的 `RecordLookupRequest.values`），不能按前缀查。本片的来源键带 revision（L18），一份记录有过几张卡就有几把键；revision 的个数没有上限（只读命令用不了时，换稳妥跑法 → 马上回到卡，可以不占轮次地一直来回）。第 5 片没有“某种来源、已答、没落实”的列法。
    - **最小的补法：** 在 SessionMessage 同一个 codec 上加一个查找索引，不改第 5 片的契约和它的索引常量：新常量 `K3_SESSION_MESSAGE_LOOKUP_INDEXES`，接在 `message-record-codecs.ts:1147` 的 `lookups` 后面。
      - `k3-decision-answer-by-source-goal`：`ref.projectId`、`ref.workspaceId`、`decision.source.kind`、`decision.source.goalRef.goalId`。这几个路径今天的答复记录上都有（`DecisionMessageMetadataV1.source` 是 `DecisionSourceV1`，带 `goalRef`：`contracts/core/session-message.ts:67–71`，`contracts/goal-decisions.ts:78–83`）。
      - `UnknownCallReviewReadPort.listUnappliedAnswers(ctx, { reviewRef })`：按（项目、工作区、`unknown_call_review`、目标）分页读到底（2A 的完整分页），留下 `decision.syntheticAnswer === true`、`status === 'responded'`、来源键解出来的 `reviewRef` 就是这份记录、`application` 为空的答复；对每一个，按 L19 由答复消息推出 ② 的身份，用 `RecordStore.lookupCommit` 查：查到了 → 它就是“② 已落实、③ 没补记”，列出来；没查到 → ② 从没落实（答的是旧版的卡，被后来的变化挡下了），第 5 片照今天把它当作“已答、没落实”显示，不列。读失败 → `unavailable`。
      - 启动第 6b 步的第 4 种对每个 active 目标用同一个索引按目标读一遍，不按记录；每条只带自己的 `reviewRef`（M2）。
    - 补的只是 ③ 的记账：`apply_review_disposition` 按答复的 `reviewRef` 重放 ② 的原回执，再做 ③；**这一步和任务的选定 Run、任务资格、记录的 `open` 都无关**（M2：选定 Run 可能是后来的接续，记录可能已是历史）。从不因此放开 `hold`，从不因此接续。
- **L29 崩溃恢复表。【lead 定，待审】** 每一个落盘的边界，崩溃以后怎么接上：

  | # | 落盘到哪里 | 崩溃后看到的 | 怎么接上 |
  | --- | --- | --- | --- |
  | 1 | 原 Run 收尾、记录已建（RUN-25 或认定的提交） | Session 是 `kernel_turn_open`；记录是 `pending_review`、`needs_decision` 或 `resolved` | 下一次推进（或 6b 重驱）按 §3 UR 表：`pending_review` → 选 Session（K 关闭或退路）→ 领取核对轮；`needs_decision` → 卡在队列里；`resolved` → 接续。第 2b 步把没定的列进报告 |
  | 2 | 核对轮已领取，还没进入（领取之后、`start` 之前崩溃） | 核对轮 Run 是 `starting`、没进入（W-01..W-03 那种）；`activeRound` 指向它 | 6b (c) 交出目标；下一次推进 UR3a：`activeRound.runRef` 满足 `isUnadmittedStarting` → 对这个 Run 做 `prepare`，再 `start`，和 W-01..W-03 一样用同一个领取；进入前 RUN-02 再核对记录（L11）。今天按选定 Run 的重驱碰不到它（选定 Run 是 R）。**如果这一轮在领取之后、进入之前被暂停，又点了“我来处理”：重驱的判断 `isUnadmittedStarting` 不成立（排除 `paused`），由 UR3h 用取消专用判断 `isUnenteredReviewRoundForCancellation` 取消它（L21、§2）** |
  | 3 | 核对轮在跑，写了一部分结论 | 结论在记录里；核对轮 Run 是 Entering 或 Running | 启动核对收尾这一轮：没有没结果的调用 → 照今天 RUN-19、RUN-23、RUN-24；有没结果的调用 → RUN-20(i)（`review_round`，D1），等你认定这一轮（UR5），认定以后才往下。下一次推进 UR4 `settle_review`：没做完 → 再开一轮，输入带已写的结论（这次进入以来第 2 次没做完 → 定稿，`review_incomplete`）。再开的一轮先关这一轮悬空的 Turn：`close_open_turn` 的 `afterRunRef` 是这一轮的 Run（最近持有者，L12），不是 R |
  | 4 | 结论写完，核对轮正常结束，还没定稿 | 核对轮 Run `Ended(completed)`；`activeRound` 还在 | 下一次推进 `settle_review` → 定稿 |
  | 4b | 你暂停着核对轮时 Host 重启，或你取消了它 | 核对轮 Run 是 RUN-24 或 RUN-23、进程内取消结束的；它的指针是你发起的 | 下一次推进 UR4 `settle_review`：按这一轮的围栏是 `human_only`，不再开一轮，定稿，原因 `review_stopped`，出卡（L15） |
  | 5 | 卡已答复，处置没落实 | 答复消息在；记录还是 `needs_decision` 或 `awaiting_approval` | 下一次推进（UR7）：Workflow 用自动化身份做 ②；② 的身份由答复消息推出，你重试 `resolveDecision` 也是同一个身份，第二次拿到第一次的提交回执（L19）。拿到回执的一方接着做 ③；③ 按第 5 片的身份只成功一次 |
  | 5b | ② 已落实，③ 没补记 | 记录已变（状态可能已是 `resolved`、`awaiting_proposal`，或者之后又被直接点的“我来处理”盖掉了处置）；卡“已答待落实” | 6b (c) 第 4 种交出目标；下一次推进 UR7b：按 `listUnappliedAnswers` 从答复那边找（L28，D4，不看记录当前的处置），② 重放出原回执，再做 ③。只补记账，不放开 `hold`、不接续；接续本来也不等 ③ |
  | 6 | 处置已落实，接续还没领取 | 记录 `resolved`；还没有重排 | 下一次推进：自动重排（有你的处置时不出确认卡，L22）→ 领取，Session 和 `close_open_turn` 用最近持有者（L12），照 K |
  | 7 | 接续已领取 | 普通的 Run | 照今天 |
  | 8 | 核对领取时 K 关闭确定失败，新 Session 已建，交接没提交 | 原 Session 已有接续 | 照接线包 1 的 E15 从来历恢复交接，再在新 Session 领取核对轮；不复活原 Session（K L6） |
  | 9 | 换了 Session 以后的任何一步 | — | 记录跟着原 Run，不跟着 Session：核对说明、接续说明都按记录写，和在哪个 Session 无关；最近持有者的领取 Session 就是新 Session |
  | 10 | `handle_myself` 已落实（卡上选的或直接点的），你还没点“继续” | 记录 `resolved`、`hold: 'held'` | 任务一直停着（AV-4c），重启不改。有进行中的一轮的（`open = 'yes'`，6b (c) 第 2 种交出目标）：那一轮照第 3、4 行收尾（`settle_review` 走 UCR-08b），之后不开新一轮 |
  | 11 | 直接点“我来处理”的提交 | 记录 `resolved`、`held`，`disposition.source: 'direct'` | 同第 10 行；同一请求再发重放原回执 |
  | 12 | 直接点“我来处理”时核对轮已领取、还没进入 | 记录 `resolved`、`held`；`activeRound` 的 Run 是 `starting` | UR3h：Workflow 以自动化身份取消这个 Run（RUN-09（U），没进入就结束，L21）；下一次推进 UR4 `settle_review` 只收尾这一轮（UCR-08b）。取消提交以后、定稿以前崩溃：6b (c) 第 2 种交出目标，接着定稿 |
  | 13 | release-hold 两步之间崩溃（原 Run 是你停下的，D9） | 记录 `released`；任务停在 AV-4，没有 TaskRequeue | 界面照今天显示“继续”；你再点 release-hold（`releaseHold` 重放原回执，再做人的重排）或 `tasks/requeue`，都接得上，最后只有一次接续 |

- **L30 不变的。【lead 定，待审】**
  - RUN-08；RUN-20 的 (i) 终态变体、(ii)、(iii)，以及被 L25 守卫挡下的 (i)；RUN-21；
  - RUN-22 的人工认定入口和它的指纹、重放（认定之后多了核对记录，L8）；
  - Query 的恢复行（QRR）；
  - RUN-21 的迟到证据在 RUN-25 之后照规则被拒：已知终态从不改写（§6.4）；
  - GoalPhase 的归约：不加 NEEDS_DECISION 的新来源（卡只来自本片的来源，避免和目标原因卡重复）；
  - **K3 之前认定的 Run**：没有核对记录（权威读到 `not_found`），照今天接续，不补建记录、不补核对。理由：不做数据迁移；那时你认定时用的是当时的规则，接续说明照今天逐个列出结果未知的调用。这是决定 52“认定以后也走核对”的过渡例外，列在 §1 A 组，给用户看。记录键存在但读不出的不算这一种，一律按没定拦（L7）。

- **L30a 维护在 `refused('handed_over')` 之后不再永远跳过。【lead 定，待审】** 退役、`kernel_turn_open`、后继是换手（不是接续）的线，Host 的关闭每轮都回 `refused('handed_over')`，维护当成“跳过”，这条线永远不归档、Turn 也不关。改法：这个拒绝之后，同一轮维护重读这条线的事实，按普通维护规则再走一遍（换手的线：关 Turn、按 K 的 L7 今天的逻辑归档）；不加新状态。测试 K3-HO1。证据：`docs/refactor/reviews/evidence/orchestration-slice-2C-2026-10-15/lead-acceptance.md` 第 7 条。

### G. 资源上限

- **L31 资源上限由资源上限片做完。【lead 定，待审】** 资源上限片（b6087b7a）已经合入，见它的规格 §9 和证据 `docs/refactor/reviews/evidence/orchestration-slice-RL-2026-10-16/`；K3 不改它。核对轮里跑的只读命令照样在上限里跑；被 L19a 拦下的命令不起沙箱、不建 scope。第二版 §5 的可行性一问已经不存在（原文在资源上限片的证据里）。

- **L31b 命令刚起就被取消时不留空的 systemd scope。【lead 定，待审】** 资源上限片的已知限制：命令刚起、scope 还没挂上进程时就被取消（`kill_group`），systemd 收不到“已空”的通知，这个 scope 一直留着（不占内存，只是一个单元）。改法：命令在放行以前被取消（资源上限片里算“没开始”的那种）时，Host 停掉自己建的那个单元（`systemctl --user stop <unit>`，单元名 Host 自己知道），停不掉只记一行日志、不影响结果；放行以后的取消照资源上限片今天的做法。这一条改的是资源上限片的文件（`slice-RL-SPEC.md` §9 的已知限制，见 §6）。测试：资源上限片 RL-10c 的场景加一条断言“取消以后这个单元不在了”（RE1，lead 在有 systemd 用户会话的环境跑，K3-49）。

### H. 代码事实（K8-5，lead 2026-10-16 核过）

K8-1 要读 `package.json`，K8-1/K8-5 要查三个代码事实；这里是查到的原文位置。

- **读 `package.json` 用哪个工作区读口。** 平台已有的工作区读口是 `WorkspaceToolsPort.readWorkspace`（接口 `src/core/workspace/ports.ts:185`，实现在注册表 `src/core/workspace/workspace-tools.ts:53`），它读当前工作树，经 `readWorkingTreeFile`（`src/core/workspace/workspace-read.ts:58`，在 `src/core/workspace/capture.ts:125` 调用）；组合里接在 `src/composition/create-platform.ts:1260`，`files/read`（`src/app/core-routes.ts:325`）和关注观察者（`src/app/attention-observer.ts:635`）已经在用。它先过 `authorization.allowsRead` 和同一份拒绝前缀，接上去不新增读权限。**② 的处置落实和钩子用同一个读口。** 运行时依赖今天只有 `workspaceHost`（`resolveRoot`/`authorize`，`src/core/agent-runtime/execution-contracts.ts:220`），把这个读口接给钩子是一处接线，不是新权限；底层同一份能力是 `WorkspaceReadAccess.read`（`createWorkspaceAccessFactory`，`src/core/workspace/access.ts:34`、`:59`）。
- **`before_tool` 钩子能不能异步读文件。** 能。钩子端口的 `execute` 是 `async`、返回 Promise；现有 `toolPathHook` 就是同类钩子（`src/core/agent-runtime/execution-driver.ts:766`），它在 `:774` `await deps.workspaceHost.authorize(...)`。Kernel 侧的适配层也 `await` 内层决策（`vendor/coding-agent/patches/app/composition/control-hooks.ts:45–49`、`:67–71`）。所以钩子里可以在拦以前 `await` 一次工作区读取。
- **原调用的工作目录能不能从 Kernel 记录读到。** 能，读的是模型原样给的调用参数。归约后的 Turn 在 `toolBatch.calls[*].requestedCall.arguments`（`JsonObject`，`vendor/coding-agent/dist/core/runtime/state/run-state.d.ts:290–294`）里保有它；它由 Kernel 的 `agent.event` 记录经 `reduceTurnFromStart` 归约而来（`src/core/agent-runtime/kernel-turn-facts.ts:54`）。`shell` 从 `arguments.cwd` 取目录、没有时用 `"."`（`vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js:162`）；那个缺省是执行时补的，不是记录里单独存的一个字段。所以模型给了 `cwd` 就能读到，没给就是工作区根目录；命令文字在同一条记录的 `arguments.command`（同一工具 `:163` 的 `commandPreview`）。K8-1 的“原命令前面有静态 `cd <路径>`”按解析出的 `cd` 参数算。

## 2. 接口（新名字以此为准）

```ts
// src/contracts/unknown-call-review.ts（新文件）
export type UnknownCallReviewRef = { aggregateType: 'UnknownCallReview'; projectId: string; goalId: string; runId: string };

export type HostTakeoverProofV1 =
  | { kind: 'hl01_no_lock' }
  | { kind: 'hl03_stale_lock'; previousInstanceId: string; previousPid: number }
  | { kind: 'memory_store' };

export type UnknownCallKindV1 = 'read_only' | 'platform' | 'file_edit' | 'process';

/** 完整参数按引用：Kernel 里不可变的记录。 */
export type KernelCallRefV1 = {
  adapterId: string; kernelSessionId: string; kernelRunId: string; turnId: string;
  callId: string;                      // ≤512 字节（UTF-8）；更长的 callId 那一条算 undecodable_call，不存（L7、L8）
  declaredPosition: number;            // 声明这个调用的 assistant 消息的位置
  startedPosition: number | null;      // tool.started 的位置
};

export type CapturedPathV1 = { path: string; change: 'added' | 'modified' | 'deleted' | 'mode_changed' };
export type WorkspaceCaptureV1 =
  | { status: 'captured'; runBaselineKnown: boolean; baseCommit: string; headNow: string;
      captureRef: ArtifactRef;          // WorkspaceChangeCaptureV1 的全文
      changedCount: number; sample: CapturedPathV1[] /* ≤50 */;
      notVisible: string[] /* ≤32：git 忽略的、固定忽略的、受保护前缀 */; notVisibleOmitted: number }
  | { status: 'unavailable'; runBaselineKnown: boolean;
      reason: 'not_git' | 'no_baseline' | 'unstable' | 'too_many_changes' | 'read_failed' | 'not_configured';
      detail: string /* ≤500 */ };

export type PlatformLookupEvidenceV1 =
  | { kind: 'receipt'; cursor: CommitCursor; eventIds: string[] /* ≤8 */ }
  | { kind: 'not_committed' }
  | { kind: 'lookup_failed'; reason: string /* ≤500 */ };

export type CrashSuspicionV1 = { verdict: 'unlikely' | 'possible' | 'undetermined'; evidence: string /* 1..1000 */ };

export type UnknownCallObservationV1 =
  | { verdict: 'no_review_needed'; by: 'platform' }                                     // read_only
  | { verdict: 'done' | 'not_done' | 'undetermined'; by: 'platform'; evidence: PlatformLookupEvidenceV1 }  // platform
  | { verdict: 'compare_in_continuation'; by: 'platform' }                             // file_edit
  | { verdict: 'pending'; by: null }                                                   // process，未有结论
  | { verdict: 'done' | 'not_done' | 'partial' | 'undetermined'; by: 'review_round' | 'settlement';
      evidence: string /* 1..2000 */; roundRunRef: RunRef | null; crashSuspicion: CrashSuspicionV1;
      // D6：看不全的命令定稿改判成 undetermined 时，做没做完和崩溃自查都改成 undetermined（上面的 verdict、crashSuspicion 是改后的）；
      //     模型原来写的结论和自查放这里，显示在卡上；其余为 null
      reviewerConclusion: null | { verdict: 'done' | 'not_done' | 'partial' | 'undetermined'; evidence: string /* 1..2000 */;
                                   crashSuspicion: CrashSuspicionV1 } };
// by 'review_round' 是“核对轮写的结论”，和 RUN-20 的 blockedBy 'review_round'（L25 G10）不是一个字段

export type UnknownCallReviewItemV1 = {
  alias: number;                                        // 1..32，按 Kernel 里的顺序；显示成 #n（D8）
  callId: string /* ≤512 字节（UTF-8），L7 */; toolName: string; kind: UnknownCallKindV1; contained: boolean;
  kernel: KernelCallRefV1; argumentsDigest: string;     // sha256(规范化参数)
  summary: { command: string | null /* ≤512 */; cwd: string | null; mode: 'replace' | 'create' | null;
             paths: string[] /* ≤8，各 ≤512 */; pathsOmitted: number; truncated: boolean };
  startedAt: string | null;
  observed: UnknownCallObservationV1;
};

export type UnknownCallReviewStatusV1 = 'pending_review' | 'needs_decision' | 'awaiting_proposal' | 'awaiting_approval' | 'resolved';
export type UnknownCallDecisionReasonV1 =                // 固定顺序，同 L17
  | 'inventory_incomplete' | 'review_stopped' | 'review_incomplete' | 'review_unavailable'
  | 'partial' | 'undetermined' | 'crash_possible' | 'crash_undetermined'
  | 'second_consecutive' | 'confirm_each_step' | 'proposal_missing' | 'proposal_declined';
export type UnknownCallInventoryProblemV1 =
  | 'kernel_unreadable' | 'kernel_unreadable_at_stop' | 'turn_not_found' | 'too_many_calls' | 'too_large' | 'undecodable_call';
// too_large（M3）：按创建预算 B（L7）放不下全部条目，只留了 Kernel 顺序里放得下的；清单算不完整，记录照建、卡照出

export type SaferMethodProposalV1 = { proposalId: string; callId: string /* ≤512 字节，同条目的 callId */; alias: number;
  command: string /* 1..4000 字节（UTF-8），原样 */; cwd: string | null /* ≤512 字节 */;
  rationale: string /* 1..2000 */; roundRunRef: RunRef };
// 一份记录当前 proposals 按 approvedMethodLinesZh 排出来 ≤ 5,120 字节（UTF-8），recordProposal 时量（L20 的预算表）
export const UNKNOWN_CALL_APPROVED_METHODS_MAX_BYTES = 5_120;

export type UnknownCallDispositionV1 = {
  choice: 'rerun_as_is' | 'safer_method' | 'skip_as_done' | 'handle_myself';
  source: 'card' | 'direct';                            // direct：卡外直接点的“我来处理”（UCR-15）
  targets: string[];                                    // 作用对象（callId）= 当时记录的 dispositionTargets（D7）
  answerMessageRef: SessionMessageRef | null;           // direct 时为 null
  answeredRevision: number;                             // card：答的那一版；direct：点的那一版
  appliedBy: ActorRef; appliedAt: string; text: string | null /* ≤2000 */;
  approval: null | { decision: 'approve' | 'decline'; answerMessageRef: SessionMessageRef; answeredRevision: number;
                     appliedBy: ActorRef; appliedAt: string };
  approvedMethods: Array<{ proposalId: string; callId: string; alias: number; command: string; cwd: string | null }> | null;
  hold: 'held' | 'released' | null;                     // 只有 handle_myself 有
};

export type UnknownCallReviewV1 = {
  ref: UnknownCallReviewRef; schemaVersion: 1; revision: number;
  workspaceId: string; task: TaskTriple; runRef: RunRef; sessionRef: SessionRef;
  origin: { kind: 'takeover_unresolved'; hostInstanceId: string; proof: HostTakeoverProofV1 }
        | { kind: 'human_attested'; attestedBy: ActorRef; reason: string /* ≤2000 */ };
  inventory: 'complete' | 'incomplete'; inventoryProblem: UnknownCallInventoryProblemV1 | null;
  items: UnknownCallReviewItemV1[] /* ≤32 */; itemsOmitted: number;
  workspace: WorkspaceCaptureV1;
  streak: { priorAutoCleanup: boolean; priorUnknownProcess: boolean; resetRunRef: RunRef | null };
  status: UnknownCallReviewStatusV1;
  open: 'yes' | 'no';                                   // 派生：status 不是 resolved，或 activeRound 不为空 → yes（D4，只由构造函数写）
  decisionReasons: UnknownCallDecisionReasonV1[];
  dispositionTargets: string[] | null;                  // 跑程序的 + 查不清的平台条目；needs_decision / awaiting_approval 时定下（D7）
  proposalTargets: string[] | null;                     // dispositionTargets 里跑程序的那些；只有它们能提方案（D7）
  stateEntry: number;                                   // 建时 1，每次 UCR-10 进入 awaiting_proposal 加 1（L9，D2）
  activeRound: null | { runRef: RunRef; phase: 'review' | 'proposal'; round: number; stateEntry: number; startedRevision: number };
  rounds: Array<{ runRef: RunRef; phase: 'review' | 'proposal'; round: number; stateEntry: number;
    result: 'finished' | 'unfinished' | 'stopped' }> /* ≤8，空位 = 8 − 条数（L9） */;   // 最后一条的 runRef 是“最近持有者”（L12）
  proposals: SaferMethodProposalV1[];
  blockedCommands: Array<{ reviewRunId: string; alias: number; commandSha256: string; kernelCallRef: KernelCallRefV1;   // L19a：处置落实时写下；reviewRunId = 这份记录的原 Run
    actions: Array<{ text: string; sha256: string }>;                                   // parseShellActions 的动作；sha256 = sha256(JSON.stringify(words))；unparsed 或全是无关段时是整段规范化文字一项
    expansions: Array<{ action: string; scriptName: string; scriptText: string;           // scripts.X 展开；同名动作一条；scriptText ≤2048 字节
      actions: Array<{ text: string; sha256: string }>;
      basis: { path: string; digest: string } | { status: 'unavailable'; reason: string } }>;   // 每个展开自己的 package.json 依据（K8-7）
    truncated: boolean }>;                                                              // 动作>16 或展开>8 时丢尾巴并置真；所有新字段合计 ≤16 KiB（L19a、L7）
  disposition: UnknownCallDispositionV1 | null;
  createdAt: string; updatedAt: string;
};
// M3（L7）：每个构造函数和每次更新都按写后 `JSON.stringify` 的 UTF-8 字节准入。
//   必须写的（定稿、批准、hold/release、处置）一律放行；可选模型文字只在 ≤ 512 KiB − 预留 R（L7 的短表）时收；
//   创建放不下就按 Kernel 顺序截条目、清单记 incomplete/too_large；超了回 capacity，不写。

/** 收尾和认定时交给 WorkGraph 的草稿：平台条目已经查好，跑程序的是 pending。 */
export type UnknownCallReviewDraftV1 = Pick<UnknownCallReviewV1,
  'inventory' | 'inventoryProblem' | 'items' | 'itemsOmitted' | 'workspace'>;

/** L12：最近持有者 = rounds 的最后一条，没有轮次时是 runRef。纯函数，放 state/unknown-call-review.ts。 */
// lastHolderOf(review: Pick<UnknownCallReviewV1, 'runRef' | 'rounds'>): RunRef;

// 事件：UnknownCallReviewChanged@1
//   change: 'created' | 'round_claimed' | 'conclusion_recorded' | 'proposal_recorded' | 'round_unfinished'
//         | 'settled' | 'disposition_applied' | 'approval_applied' | 'hold_applied' | 'hold_released'
//   带 identityKey、fingerprint、actor、requestId、occurredAt 和改后的整份记录。
//   disposition_applied / approval_applied 另带 DecisionChangeProofV1（第 5 片落实白名单认它们，L19）；
//   这两次写在同一提交里按 L19a 落下 blockedCommands。

// 开始基准（新的不可变 Artifact，内容类型 application/vnd.platform.workspace-baseline+json；序列化后 ≤ 256 KiB）
// 开始时的状态 = headCommit 的树，present 的替换（没有就加上），deleted 的去掉（L5，D5）
export type WorkspaceBaselineEntryV1 =
  | { path: string; state: 'present'; mode: string; blobId: string }
  | { path: string; state: 'deleted' };
export type WorkspaceBaselineV1 = { schemaVersion: 1; headCommit: string;
  dirty: WorkspaceBaselineEntryV1[] /* ≤2000 */; digest: string };
// 收尾时的采集全文（不可变的 Artifact；序列化后 ≤ 256 KiB，超了整个采集记 too_many_changes）
export type WorkspaceChangeCaptureV1 = { schemaVersion: 1; baseCommit: string; headNow: string; runBaselineKnown: boolean;
  changed: CapturedPathV1[] /* ≤2000 */; notVisible: string[]; notVisibleOmitted: number; digestBefore: string; digestAfter: string };
```

```ts
// src/contracts/command-rerun-request.ts（新文件）
export type CommandRerunRequestRef = {
  aggregateType: 'CommandRerunRequest'; projectId: string; goalId: string; taskId: string; requestId: string;
};
export type CommandRerunRequestStateV1 = 'pending' | 'allowed' | 'used' | 'denied' | 'denied_final' | 'closed';
export type CommandRerunRequestV1 = {
  ref: CommandRerunRequestRef; schemaVersion: 1; revision: number;
  workspaceId: string; task: TaskTriple; reviewRef: UnknownCallReviewRef; runRef: RunRef;   // runRef：提出请求的那个 Work Run
  alias: number;                                        // 对应拦下命令的别名（#n）；rewriteOf 给的就是它
  command: string /* 原文，1..4000 字节（UTF-8） */; commandSha256: string /* 这次请求的写法的规范化文字算出的 sha256；允许时按它放行一次 */;
  declared: boolean;                                    // 是 agent 用 rewriteOf 注明的写法（没认出但按别名处理）
  declaredForms: Array<{ sha256: string; text: string }> /* ≤8，text 截到 512 字节只作显示；第 9 条 → capacity */;
  match: { kind: 'exact' | 'action' | 'declared'; action?: { text: string; sha256: string };   // 创建时存下命中依据（text ≤512 字节）
    viaScript?: { scriptName: string; dir: string } };  // 卡片直接读，不重新展开（K8-7）
  reason: string /* 1..2000 码点 */;
  state: CommandRerunRequestStateV1;
  answerMessageRef: SessionMessageRef | null; allowedAt: string | null; usedAt: string | null;
  createdAt: string; updatedAt: string;
};
// 事件：CommandRerunRequestChanged@1
//   change: 'created' | 'allowed' | 'used' | 'denied' | 'denied_final' | 'closed' | 'forms_added'
//   带 identityKey、fingerprint、actor、requestId、occurredAt 和改后的整份记录。
// 索引：
//   k3-crr-by-task-alias（ref.projectId、ref.goalId、ref.taskId、reviewRef.runId、alias）——按别名查的等值索引（L19a 要的）：
//     同一个别名的 pending 请求、denied、denied_final 都从这里查，再按 state 过滤（state 不进索引键）；denied_in_this_run
//     再用记录自己的 runRef 认同一个 Run。
//   k3-crr-by-goal-state（ref.projectId、workspaceId、ref.goalId、state）——卡的来源按目标读 pending（L19a）。
//   k3-crr-by-task（ref.projectId、ref.goalId、ref.taskId）——钩子每次 shell 调用按这个任务分页查请求记录（注明过的写法、一次性允许；K8-6、K8-7）。
```

```ts
// src/contracts/dispatch.ts
// RunSnapshot 新增（缺省 = 普通工作）
purpose?: { kind: 'unknown_call_review'; reviewRef: UnknownCallReviewRef; phase: 'review' | 'proposal'; round: number };
// RunReconciliationV1.observation 新增一种（status 'done'，basis host_instance_takeover）
| { kind: 'takeover_unresolved'; event: RuntimeEventV1; lastPosition: number; observedThroughPosition: number;
    unresolvedToolCallIds: string[]; proof: HostTakeoverProofV1; reviewRef: UnknownCallReviewRef };   // RUN-25 总建记录（L25）
// 已有的 'unresolved'（RUN-08、RUN-20）加一个可选字段：先后表第 8 行来的 RUN-20(i) 为什么没自动收尾（L25；含 'review_round'）
| { kind: 'unresolved'; /* 原有 */ autoCleanupBlockedBy?: string };

// src/contracts/core/prepared-execution.ts，PreparedTaskManifestV1 新增（基准本身是单独的 Artifact，L5）
workspaceBaseline?: { status: 'captured'; ref: ArtifactRef; digest: string }
  | { status: 'unavailable'; reason: 'not_git' | 'too_many_changes' | 'read_failed'; detail: string /* ≤500 */ };
unknownCallReview?: UnknownCallReviewInputV1;    // 只在核对轮、提方案的一轮
// B2 用户已定（决定 57、68，L19a）：平台拦下原命令，要再跑先请求并得到允许。执行准备时把这个
// 任务所有已落实记录的“拦下的命令”随绑定带上一份（只带 reviewRunId、别名和整段摘要）；调用时再读记录现在的
// 状态，从记录里取动作、展开和注明过的写法（第八稿第九条：清单只留这三个字段，钩子按记录核）。
blockedCommands?: Array<{ reviewRunId: string; alias: number; commandSha256: string }>;   // ≤32
type UnknownCallReviewInputV1 = {
  reviewRef: UnknownCallReviewRef; revision: number; phase: 'review' | 'proposal'; round: number;
  items: Array<{ alias: number; toolName: string;                 // 不带 Kernel callId（D8）
    display: 'full' | 'truncated' | 'unexpanded';                 // D6：后两种定稿时改判 undetermined（L16）
    command: BoundedTextV1 | null /* 命令和 cwd 合计 ≤4 KiB（UTF-8），长的截断并标出；unexpanded 时为 null */;
    cwd: string | null;                                            // unexpanded 时为 null
    startedAt: string | null; sameBatch: number[] /* 别名 */;
    current: UnknownCallObservationV1 | null }>;                   // unexpanded 时为 null；只列 process 条目
  targets: number[] | null;                       // 提方案时是 proposalTargets 的别名（D7）
  personText: string | null;                      // 提方案时你的附言
  workspace: { status: WorkspaceCaptureV1['status']; runBaselineKnown: boolean; notVisible: string[]; notVisibleOmitted: number;
    changedSample: CapturedPathV1[] /* ≤200 */; changedOmitted: number };
};
// 整段渲染先限 64 KiB（UTF-8）；再量整份清单的 JSON（结构化的这份和渲染进 input 的那段都算），超 256 KiB 就从后往前收展开：
// 路径样本 → notVisible → 条目改成 unexpanded；底线是每条只剩别名和工具名（L13，D8）

// src/contracts/continuation-brief.ts，ContinuationBriefV1 新增（旧说明读作 null）
unknownCallReview?: ContinuationUnknownCallReviewV1 | null;
type ContinuationUnknownCallReviewV1 = {
  reviewRef: UnknownCallReviewRef; revision: number; origin: 'takeover_unresolved' | 'human_attested';
  inventory: 'complete' | 'incomplete';
  items: Array<{ alias: number; callId: string /* 只在不是必需的正文行里渲染（D8） */; toolName: string;
    kind: UnknownCallKindV1; summary: BoundedTextV1;
    verdict: UnknownCallObservationV1['verdict']; evidence: BoundedTextV1 | null; crashSuspicion: CrashSuspicionV1 | null;
    reviewerConclusion: BoundedTextV1 | null;                      // D6 改判前模型写的结论和自查（渲染成一段文字）
    files: Array<{ path: string; mode: 'replace' | 'create'; change: CapturedPathV1['change'] | 'unchanged' | 'not_visible';
      oldText: BoundedTextV1 | null /* ≤1000 */; newText: BoundedTextV1 | null /* ≤1000 */;
      diff: BoundedTextV1 | null /* ≤2000；整节 diff 合计 ≤8 KiB */;
      diffOmittedReason: 'baseline_dirty' | 'binary' | 'too_large' | 'protected' | 'section_limit' | 'not_text' | null }> }>;
  itemsOmitted: number;
  disposition: null | { choice: UnknownCallDispositionV1['choice']; source: 'card' | 'direct'; text: BoundedTextV1 | null;
    targets: number[];                                             // dispositionTargets 的别名
    platformTargets: number[];                                     // 其中查不清的平台条目：“结果查不清，重做前先核实”（D7）
    approvedMethods: Array<{ alias: number; command: string /* 全文，不缩短 */; cwd: string | null }> };
  workspace: { status: WorkspaceCaptureV1['status']; runBaselineKnown: boolean; notVisible: string[];
    changedSample: string[]; changedOmitted: number };
};
// 渲染（renderContinuationBriefZh）：这一节的必需部分（L20 的写法：标题、计数、处置、作用对象、approvedMethods 原样、
// 平台条目、两句固定的话；只用别名）和异常锚点一节一样不缩短、不略去；其余照今天的规则缩短、略去。
// 必需部分都放不下才抛 ContinuationBriefCapacityError → prepare 回 capacity（L20）。renderedBytes 不变。
// 导出给 WorkGraph 的 owner 量方案用（L20）：
export function approvedMethodLinesZh(methods: ReadonlyArray<{ alias: number; command: string; cwd: string | null }>): string[];

// src/contracts/goal-decisions.ts
DecisionSourceV1['kind'] 加 'unknown_call_review'、'command_rerun_request';
DecisionSourceIdentityV1 加 { kind: 'unknown_call_review'; reviewRef: UnknownCallReviewRef; revision: number };
DecisionSourceIdentityV1 加 { kind: 'command_rerun_request'; requestRef: CommandRerunRequestRef; revision: number };

// src/contracts/task-failure.ts
TaskAutomationStopReason 加 'unknown_call_review';
TaskAutomationStopDetailV1 加 reviewStatus?: UnknownCallReviewStatusV1 | 'unreadable'; reviewHold?: true;
TaskFailureFactsV1 加 unknownCallReview?: { status: UnknownCallReviewStatusV1 | 'unreadable';
  hold: 'held' | 'released' | null; requeueConfirmed: boolean };   // L22
```

```ts
// src/app/host-instance-lease.ts
export type HostInstanceLease = { /* 原有 */ takeover: HostTakeoverProofV1 | null };
// src/core/work-graph/model/execution-entry-contracts.ts
export type HostInstanceFacts = { hostInstanceId: string; lease: 'owned' | 'held_by_other'; takeover?: HostTakeoverProofV1 | null };

// src/core/work-graph/tasks/run-reconcile-contracts.ts
// ReconcileRunInput.result 的 unknown 加可选字段
autoCleanup?: AutoCleanupCandidateV1 | { blockedBy: string };
export type AutoCleanupCandidateV1 = {
  proof: HostTakeoverProofV1; closure: { status: 'supported'; headActiveRunId: string };
  workspace: WorkspaceCaptureV1;                 // 须 captured && runBaselineKnown（G8）
  draft: UnknownCallReviewDraftV1;               // 只有普通工作的 Run 有候选（G10）；按创建预算 B 截条目，可是 incomplete/too_large（M3）
};
// ResolveUnknownRunInput 加（必填；owner 先查回执，没命中才校验它，L8）
review: UnknownCallReviewDraftV1;

// src/core/agent-runtime/run-reconcile.ts
// reconcileRunAtStartup 的入参加 takeover?: HostTakeoverProofV1 | null（没有 = G1 不成立）；
// 分类器先看 record.run.purpose：核对用途 → unknown 结果附 { blockedBy: 'review_round' }，不查别的（G10，D1）
// 分类器依赖加可选的 turnClosureSupport、captureWorkspace、lookupToolCommit（没有 = 那条守卫不成立）
// RunReconcileReport 加
autoCleanup?: { applied: true } | { applied: false; blockedBy: string };

// src/app/startup-reconcile.ts
export type ReconcileLine = { ref: string; row: string; status: 'reconciled' | 'left' | 'failed'; reason: string;
  autoCleanup?: { applied: true } | { applied: false; blockedBy: string } };   // 第 2 步一并抄过去
// StartupReconcileDependencies（`src/app/startup-reconcile.ts:94`）加 takeover: HostTakeoverProofV1 | null；StartupReconcileReportV1 加 reviews: ReconcileLine[]（L28）

// 各平台 owner（只读，可选；没发布就是 undetermined）
lookupToolCommit?(ctx: CoreCallContext, input: {
  toolName: string; arguments: unknown; kernelCallId: string;
  origin: { runRef: RunRef; sessionRef: SessionRef; generation: number; workspaceId: string };
}): Promise<{ status: 'committed'; cursor: CommitCursor; eventIds: string[] } | { status: 'not_committed' }
          | { status: 'undetermined'; reason: string }>;

// src/core/work-graph/model/unknown-call-review-contracts.ts（新文件）
export interface UnknownCallReviewReadPort {
  readReview(ctx: CoreCallContext, input: { ref: UnknownCallReviewRef } | { runRef: RunRef }): Promise<ReadResult<UnknownCallReviewV1>>;
  /** 按目标和状态（卡来源，索引 k3-ucr-by-goal-status），或按工作区和 open（启动 2b、6b，索引 k3-ucr-by-workspace-open）。 */
  listReviews(ctx: CoreCallContext, input: { workspace: WorkspaceScope;
    filter: { goalRef: GoalRef; status: UnknownCallReviewStatusV1[] } | { open: 'yes' };
    page: { limit: number /* 1..200 */; cursor?: string } }):
    Promise<ReadResult<{ items: UnknownCallReviewV1[]; nextCursor: string | null; readThrough: CommitCursor | null }>>;
  /** D4：这份记录的卡答复里 ② 已提交、③ 没补记的（索引 k3-decision-answer-by-source-goal，分页读到底，L28）。
   *  M2：每条答复由它自己的 `reviewRef` 驱动，和任务的选定 Run、任务资格、记录的 `open` 都无关；
   *  UR7b 就用它找答复，不再要求“选定 Run 的记录”。 */
  listUnappliedAnswers(ctx: CoreCallContext, input: { reviewRef: UnknownCallReviewRef }):
    Promise<ReadResult<{ answers: Array<{ answerMessageRef: SessionMessageRef; phase: 'disposition' | 'approval';
      source: DecisionSourceV1 }>; readThrough: CommitCursor | null }>>;
}
export interface UnknownCallReviewPort {
  /** 工具调用；核对轮 Run 从 ctx.principal 取，不从入参取（L14）；条目按别名给，owner 换成 callId。
   *  M3：结论依据和自查依据是可选模型文字，写后记录超 512 KiB − 预留 R（L7）→ capacity，不写。 */
  recordConclusion(ctx: CoreCallContext, request: GraphWrite<{ reviewRef: UnknownCallReviewRef; item: number;
    verdict: 'done' | 'not_done' | 'partial' | 'undetermined'; evidence: string; crashSuspicion: CrashSuspicionV1 }>):
    Promise<WriteResult<UnknownCallReviewV1>>;
  /** 条目必须在 proposalTargets 里（D7）；按 approvedMethodLinesZh 量，合计超 5,120 字节回 capacity（L20）。
   *  M3：方案理由是可选模型文字，还受“写后记录 ≤ 512 KiB − 预留 R”的门槛（L7）。 */
  recordProposal(ctx: CoreCallContext, request: GraphWrite<{ reviewRef: UnknownCallReviewRef; item: number;
    command: string; cwd: string | null; rationale: string }>): Promise<WriteResult<UnknownCallReviewV1>>;
  /** round_ended 时由 owner 读这一轮的 Run 和指针，按 reworkFenceOf 分出“没做完”和“你停下的”（L15），
   *  并读写下结论的那一轮的准备清单取 display（D6，L16）。M3：定稿是必须写的一类，永远放行。 */
  settleReview(ctx: CoreCallContext, request: GraphWrite<{ reviewRef: UnknownCallReviewRef;
    cause: 'round_ended' | 'review_unavailable' }>): Promise<WriteResult<UnknownCallReviewV1>>;
  /** 身份由答复消息推出（L19）；第二次同身份同指纹返回第一次的提交回执。 */
  applyDisposition(ctx: CoreCallContext, request: GraphWrite<{ source: DecisionSourceV1;
    selection: DecisionSelectionV1; decisionMessageRef: SessionMessageRef }>): Promise<WriteResult<UnknownCallReviewV1>>;
  /** UCR-15：卡外直接点“我来处理”，只收人（L21）；提交守卫 TaskLease 和选定 Run 的事实（D3）。 */
  holdReview(ctx: CoreCallContext, request: GraphWrite<{ reviewRef: UnknownCallReviewRef; text: string | null }>):
    Promise<WriteResult<UnknownCallReviewV1>>;
  /** UCR-14：activeRound 不为空 → busy（“核对轮还没收尾”，D3）。 */
  releaseHold(ctx: CoreCallContext, request: GraphWrite<{ reviewRef: UnknownCallReviewRef }>): Promise<WriteResult<UnknownCallReviewV1>>;
}
// src/core/work-graph/model/command-rerun-request-contracts.ts（新文件，L19a）
export interface CommandRerunRequestReadPort {
  readRequest(ctx: CoreCallContext, input: { ref: CommandRerunRequestRef }): Promise<ReadResult<CommandRerunRequestV1>>;
  /** 卡的来源按目标读 pending（索引 k3-crr-by-goal-state）；工具按 (任务, 核对记录, 别名) 查（索引 k3-crr-by-task-alias）；
   *  钩子按任务分页查（索引 k3-crr-by-task，filter { goalId, taskId }）；查询自带记录，不另开 readMany。 */
  listRequests(ctx: CoreCallContext, input: { workspace: WorkspaceScope;
    filter: { goalRef: GoalRef; state: CommandRerunRequestStateV1 } | { goalId: string; taskId: string; reviewRunId: string; alias: number }
      | { goalId: string; taskId: string };
    page: { limit: number /* 1..200 */; cursor?: string } }):
    Promise<ReadResult<{ items: CommandRerunRequestV1[]; nextCursor: string | null; readThrough: CommitCursor | null }>>;
}
export interface CommandRerunRequestPort {
  /** request_command_rerun 的 owner：按 (任务, 核对记录, 别名) 查 pending / allowed / denied / denied_final，写新请求、追加注明的新写法或回原结果（L19a）。 */
  requestRerun(ctx: CoreCallContext, request: GraphWrite<{ reviewRef: UnknownCallReviewRef; runRef: RunRef;
    command: string; reason: string; rewriteOf?: { review: string; alias: number } }>): Promise<WriteResult<CommandRerunRequestV1>>;
  /** 卡上答复的落实：身份由答复消息推出；请求@revision 仍是 pending，否则 revision_conflict（L19a）。 */
  applyAnswer(ctx: CoreCallContext, request: GraphWrite<{ requestRef: CommandRerunRequestRef;
    selection: 'allow_rerun' | 'deny' | 'deny_final'; decisionMessageRef: SessionMessageRef }>):
    Promise<WriteResult<CommandRerunRequestV1>>;
  /** 放行一次：先把允许标成已用（记下这次调用的 callId），提交成功才放行（L19a）。 */
  consumeAllowance(ctx: CoreCallContext, request: GraphWrite<{ requestRef: CommandRerunRequestRef }>):
    Promise<WriteResult<CommandRerunRequestV1>>;
}
// L4：这个 owner 也发布只读的 lookupToolCommit（身份 = 这次调用写下的请求记录，指纹 = 规范化入参），
// 供结果未知的 request_command_rerun 调用查回执。
// 纯函数（L19a，`state/command-normalization.ts`）：
//   normalizeCommandText(command: string): string   // 去掉首尾空白、每段连续空白（空格、制表、回车、换行）换成一个空格
//   commandSha256(command: string): string          // 规范化后算 UTF-8 的 sha256；动作的比较键是 sha256(JSON.stringify(words))；只比命令文字，不比 cwd
//   parseShellActions(command: string): { status: 'parsed'; actions: Array<{ words: string[]; text: string }> } | { status: 'unparsed'; reason: string }
//   // 静态解析（认引号、分隔符、递归 bash -c、剥前缀、无关的段、unparsed 的写法，L19a）；写死名单，不调模型
// request_command_rerun 由工具调用；卡答复走决定队列的答复入口（同 L19 的 ①），不另开 Host 路由。

// 路由 unknown-call-reviews/release-hold（Host）：原 Run 的返工围栏是人的（D9）时，releaseHold 之后再以同一个操作者
// 调 requeueTask（afterRun 是 R），两次各自幂等；别的任务只调 releaseHold（L21）。

// src/core/work-graph/sessions/message-record-codecs.ts（D4，最小的补法；第 5 片的常量和契约不改）
export const K3_DECISION_ANSWER_BY_SOURCE_GOAL = 'k3-decision-answer-by-source-goal';
export const K3_SESSION_MESSAGE_LOOKUP_INDEXES: readonly RecordLookupIndex[] = [
  { name: K3_DECISION_ANSWER_BY_SOURCE_GOAL, aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'decision.source.kind', 'decision.source.goalRef.goalId'] },
];
// 同一个 codec 的 lookups：[...SESSION_MESSAGE_LOOKUP_INDEXES, ...S5_SESSION_MESSAGE_LOOKUP_INDEXES, ...K3_SESSION_MESSAGE_LOOKUP_INDEXES]

// 领取的第四种依据（src/core/work-graph/state/attempt-machine.ts 的 AttemptClaimBasis，和 ClaimTaskInput）
| { kind: 'review'; reviewRef: UnknownCallReviewRef; expectedRevision: number; phase: 'review' | 'proposal';
    afterRunRef: RunRef /* lastHolderOf(record)，L10、L12 */ }
// TASK-03r、RUN-01r、ATT-16r（§3.1）；同一提交写记录的 activeRound（UCR-03）；任务投影不变
// 每一次领取（first、requeue、review）的提交都加一个对选定 Run 的核对记录的读守卫：读到的 revision，键不存在时 null（D3，L11）

// src/core/work-graph/state/review-lease.ts（新文件，L10）
// leaseReleasedForContinuation(input: { release: { runRef: RunRef }; releasingRunPurpose: RunSnapshot['purpose'] | null },
//   afterRunRef: RunRef): boolean
//   = release.runRef 是 afterRun，或 releasingRunPurpose 是核对且 reviewRef.runId === afterRunRef.runId
//   requeue-service.ts（requeueTask 的租约检查）、claim-service.ts:requeueClaimFacts、attempt-machine.ts:leaseOnClaimed（ATT-16）共用

// src/core/work-graph/state/decision-policy.ts（L22）
// automationConfirmationCause 的入参加 requeueConfirmedByReview: boolean（真且动作是 system_requeue → null）
// pausedAutomationAction：failure.unknownCallReview 的 status 不是 resolved、是 unreadable，或 hold 是 held → null

// src/core/agent-runtime/ports.ts（RuntimeExecutionPort 新增，只读，可选）
turnClosureSupport?(ctx: CoreCallContext, input: { sessionRef: SessionRef }):
  Promise<{ status: 'supported' } | { status: 'unsupported'; reason: string }>;
reviewCapability?(ctx: CoreCallContext, input: { workspace: WorkspaceScope }):
  Promise<{ status: 'available' } | { status: 'unavailable'; reason: string }>;

// src/business/workflow/contracts.ts
// WorkflowCalls 新增三个成员（请求和回执照 WorkflowOperation 推导）
settle_review: UnknownCallReviewPort['settleReview'];
apply_review_disposition: UnknownCallReviewPort['applyDisposition'];
cancel_review_round: RunControlPort['submitControl'];   // UR3h：held 时结束领取了没进入的一轮，kind 'cancel'，Workflow 自动化身份（D3）
// UR3h 的取消专用判断（新纯函数，放 state/review-lease.ts，L21、§3.4）：
// isUnenteredReviewRoundForCancellation(run: RunSnapshot, runRef: RunRef): boolean
//   = run 是 starting、没有 executionHistory、startedAt 为 null、lastEventSeq/lastRuntimeEventId/lastFactEventId 都是空；
//     授权缺省（Claimed），或 schema 2 的 authorized/revoked；用途是核对；desiredState 不是 'cancelled'（**'paused' 照收**）。
//   和 isUnadmittedStarting（`business/workflow/workflow.ts:895`，第 905 行排除 paused/cancelled）形状相同，区别只在这里不排 paused；
//   提交 cancel 时按今天提交里钉住读到的那一版 Run（revision 守卫照留）。
// create_session 的步骤加 review?: { reviewRef: UnknownCallReviewRef; expectedRevision: number;
//   phase: 'review' | 'proposal'; afterRunRef: RunRef; budget: TaskBudgetV1 }（和 requeue 二选一）
// close_open_turn 的请求不变（K）；K3 传的 afterRunRef 是 lastHolderOf(record)（L12）
// performStep 的 start / observe：purpose 是核对的 Run → 下一步 settle_review{round_ended}，
//   从不 open_checks、从不 afterNotNormalEnd（L10）
```

```ts
// 核对轮的两个工具（src/core/agent-runtime/unknown-call-review-tools.ts，新文件）
record_unknown_call_review: {
  item: number;                                                   // 被核对的条目的别名 #n（D8；不收 Kernel callId）
  verdict: 'done' | 'not_done' | 'partial' | 'undetermined';
  evidence: string;                                               // 1..2000
  crashSuspicion: { verdict: 'unlikely' | 'possible' | 'undetermined'; evidence: string /* 1..1000 */ };
}
propose_safer_method: {
  item: number;                                                   // proposalTargets 里的别名（D7）
  command: string /* 1..4000 字节（UTF-8），原样 */; cwd?: string /* ≤512 字节 */; rationale: string /* 1..2000 */;
}
// 按 approvedMethodLinesZh 排出来合计超 5,120 字节 → owner 回 capacity，工具结果让模型缩短（L20）
// 核对轮不加读 Kernel 历史的工具（D6）：看不全的命令定稿时改判 undetermined（L16）
// effectClass 'workspace_write'（改的是 WorkGraph 记录，不是工作区），requiredCapabilities []，
// 只在用途是核对的 Run 注册，名字进 hostAuthorizedTools。
// 核对轮和提方案的一轮的输入通道只有 controlInputs，不建 createMailboxInputSupply 的信件和回复（L13）。

// 请求重跑的工具（src/core/agent-runtime/command-rerun-tools.ts，新文件，L19a）
request_command_rerun: {
  command: string;                                               // agent 想跑的原文，1..4000 字节（UTF-8）
  reason: string;                                                // 给人看的原因，1..2000 个码点
  rewriteOf?: { review: string; alias: number };                // 拦下命令的出处：核对记录的 runId（或其唯一前 8 位）和别名；没认出的改写用它注明（K8-6、K8-7）
}
// 结果（成功结果，不是错误）：{ status: 'not_blocked' } | { status: 'pending'; requestId } |
//   { status: 'allowed'; requestId } | { status: 'refused'; reason: 'denied_final' | 'denied_in_this_run' } |
//   { status: 'requested'; requestId }
// rewriteOf 的核对记录不属于这个任务、前缀不唯一、或别名不是那份记录里拦下的命令 → invalid。
// 工具文字照 L19a（not_blocked 时告诉 agent 可以用 rewriteOf 注明；allowed 时告诉 agent 先用掉那条允许）。
// 只在“这个任务有拦下的命令”的 Work Run 里注册（L19a）；L3 的表把它的种类记成 platform。
// 身份和重放照 L14：同一个工具调用重放回原结果。effectClass 'workspace_write'（改的是 WorkGraph
// 记录，不是工作区），requiredCapabilities []，名字进 hostAuthorizedTools。

// 新路由（graph_write，只收人）：unknown-call-reviews/hold、unknown-call-reviews/release-hold；
// （读）unknown-call-reviews/read、unknown-call-reviews/list
```

## 3. 状态和流程行

### 3.1 Run、Task、Attempt：RUN-25 和核对领取（新增或改）

| 行 | 来源节点 | 事件 | 守卫 | 去向 | 同一提交的副作用 | 重放 | 依据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RUN-25 | `Entering`/`Running`（R） | `reconcile_unknown` 带自动收尾候选，守卫全成立 | L25 G1–G11（按 L25 的先后）；`exitProof` 是 host_instance_takeover；证明是 `hl01_no_lock` 或 `hl03_stale_lock`；探测 `ready`；Turn 在、没终态、不是 `interrupted`；`unresolvedToolCallIds` 非空 | `Ended(crashed)`（auth settled） | L25“写什么”：合成 `run_crashed`、`terminalPayload`、`record_reconciliation(done/takeover_unresolved)`；Entering 来补记进入；ATT-09 或 ATT-31；Outbox settled(entered)；`release_lease`；`release_session`（`kernelTurnOpen`）；CTL-08(b)(c)、resume 记 `terminal_without_cancel`；建记录（UCR-01） | hash(runRef, hostInstanceId)，原回执回放 | 决定 51、52；本规格 L25 |
| RUN-20 | 同今天 | `reconcile_unknown`，没有候选或守卫不全成立 | 同今天 | 同今天 | 同今天；第 8 行（Turn 没终态）来的，`unresolved` 观察记 `autoCleanupBlockedBy`（分类器交来的，或 WorkGraph 第一条不成立的守卫；核对用途的 Run 一律是 `review_round`，D1） | 同今天 | L25、L15 |
| RUN-22 | 同今天 | `unknown_attested` | 同今天；查回执没命中才校验草稿（L8） | 同今天 | 同今天，加：用途不是核对时建记录（UCR-02） | 同今天（草稿不进指纹，先于校验） | 决定 52；L8 |
| SES-06 | 同今天 | 加来源 RUN-25 | 同今天；`holder.kernelTurnOpen = true` | `active / unavailable / null`（`kernel_turn_open`） | 同 RUN-19 | 同今天 | L25 |
| TASK-03r | P6（选定 Run R `crashed`），或 P4 而覆盖它的 TaskRequeue 的 afterRun 是 R | `task_claimed`，依据 `review` | `claimPinProblem`；Session 守卫照 TASK-01..03；任务是 active 的 work；记录@`expectedRevision`，状态和 `phase` 相配（`pending_review`↔`review`，`awaiting_proposal`↔`proposal`），`hold` 不是 `held`，`activeRound` 为空，`rounds` 还有空位；选定 Run 是 `record.runRef`；租约已释放、释放者是 `afterRunRef`，`afterRunRef` 是 R 或 `rounds` 里的一轮；准入（职责、期限）照今天 | **投影不变**（不写 P2） | `create_attempt`、`create_run`（带 `purpose`）、`create_outbox`、`hold_lease: reheld`、`occupy_session`；记录 UCR-03（同一提交，记录的守卫就是 `expectedRevision`） | 领取身份照今天 | L10 |
| RUN-01r | `Absent` | `claim_committed`，依据 `review` | 同 RUN-01，`claimBasisProblem` 的 `review` 分支：上面的记录事实 | `Claimed`（`starting`，`purpose` 写入） | 同 RUN-01 | 同今天 | L10 |
| ATT-16r | 租约已释放 | `attempt_claimed`，依据 `review` | `release.runRef` 是 `afterRunRef`（R 或记录的某一轮） | 重新持有（`reheld`） | — | — | L10 |
| TASK-03 / ATT-16（改） | 同今天 | 依据 `requeue` | “租约由 afterRun 释放”改成 `leaseReleasedForContinuation`：释放者是 afterRun，或是 afterRun 的记录的某一轮 | 同今天 | 同今天 | 同今天 | L10 |
| TASK-01..03（加守卫） | 同今天 | 普通领取（`first`、`requeue`） | L11 的门；提交里加对选定 Run 的核对记录的读守卫（读到的 revision；键不存在时 `null`），守卫在 `claim-service.ts:1135–1157` 一处拼 | 同今天 | 同今天 | 同今天 | L11，D3 |
| `requeueTask`（改） | 同今天 | 人、系统、agent 的重排 | 租约检查同上改用 `leaseReleasedForContinuation`；L11 的门：记录没定时系统和 agent 回 `busy`；`hold: 'held'` 时不带归档来历的人的重排回 `busy`（`unknown_call_review_held`）；记录 `resolved`、`hold` 不是 `held`、原 Run 的围栏是人的时，人的重排照收（这就是“继续”，D9） | 同今天 | 同今天 | 同今天 | L10、L11、L19 |
| RUN-02（加一条） | `Claimed`，用途是核对 | `entry_authorized` | 记录还在等这一轮（状态相配、`activeRound.runRef` 是它、`hold` 不是 `held`）；核对说明的摘要和 `inputBinding` 钉的一致；否则 `stale` | 同今天 | 同今天 | 同今天 | L11，D3 |
| RUN-09（U），核对轮用（不改行） | `Claimed`/`Authorized`/`Revoked`，用途是核对（**含 `paused`**：M1 的取消专用判断 `isUnenteredReviewRoundForCancellation`；已经 `cancelled` 的不算） | `stop_not_entered`（Workflow 自动化身份提交的 `cancel`，UR3h；提交钉读到的那一版 Run） | 同今天（`run-machine.ts:1712–1748`） | `Ended(cancelled)` | 同今天：ATT-05、ATT-30、ATT-23、SES-05（`run-machine.ts:1767–1780`） | 控制的身份照今天 | L21，D3，M1 |

### 3.2 核对记录 UCR（`state/unknown-call-review.ts`）

| 行 | 从 | 事件（`change`） | 守卫 | 到 | 谁写 |
| --- | --- | --- | --- | --- | --- |
| UCR-01 | 无 | `created`（RUN-25） | 记录键不存在；草稿合法（L8）；清单完整，或只是 `too_large`（G11 已挡下别的 `incomplete`；`too_large` 由平台按创建预算 B 截条目后照建，L7、L8） | L9 建时的规则 | `reconcileRun` |
| UCR-02 | 无 | `created`（RUN-22） | 同上；`inputsConfirmed` 为 null ⇒ 不完整（`kernel_unreadable`）；认定前走过 RUN-20(ii) ⇒ 不完整（`kernel_unreadable_at_stop`） | L9 建时的规则 | `resolveUnknownRun` |
| UCR-03 | `pending_review`/`awaiting_proposal`，`activeRound = null`，`hold` 不是 `held` | `round_claimed` | 领取提交里（TASK-03r）；记录@revision；`rounds` 还有空位 | 状态不变，`activeRound` = 新 Run（带当前 `stateEntry`）；`open: 'yes'` | `claimTask`，依据 `review` |
| UCR-04 | `pending_review`，有 `activeRound`；或 UCR-15 在这一轮进行中定下的 `resolved`+`held` | `conclusion_recorded` | L14：条目（按别名）是 `process`；核对轮 Run running；记录@revision。`display` 是 `truncated`、`unexpanded` 的照收（D6） | 不变，条目结论更新 | `recordConclusion` |
| UCR-05 | `awaiting_proposal`，有 `activeRound`（phase proposal）；或同上的 `resolved`+`held` | `proposal_recorded` | 同上，条目在 `proposalTargets` 里（D7）；按 `approvedMethodLinesZh` 量合计不超过 5,120 字节（L20），超了 `capacity` | 不变，`proposals` 更新 | `recordProposal` |
| UCR-06 | 有 `activeRound`，它的 Run 没正常结束，按这一轮算的围栏不是 `human_only`，这次进入以来（同一 `stateEntry`）第 1 次 | `round_unfinished` | 那个 Run 已以已知结果结束、不是 `completed` | 状态不变，`activeRound = null`，轮次 `unfinished` | `settleReview{round_ended}` |
| UCR-06b | 有 `activeRound`，它的 Run 结束时按这一轮算的围栏是 `human_only`（你暂停或取消了它） | `settled` | 那个 Run 已以已知结果结束 | `needs_decision`，原因含 `review_stopped`；轮次 `stopped` | `settleReview{round_ended}` |
| UCR-07 | `pending_review`：这一轮正常结束；或这次进入以来第 2 次没做完（原因一定含 `review_incomplete`，D2）；或 `review_unavailable` 且没有进行中的一轮（原因含 `review_unavailable`） | `settled` | L16（含 D6 的改判） | `resolved` 或 `needs_decision` | `settleReview` |
| UCR-08 | `awaiting_proposal`：这一轮正常结束；或这次进入以来第 2 次没做完（原因一定含 `review_incomplete`） | `settled` | L16；`proposalTargets` 每条都有方案才算齐（D7） | `awaiting_approval` 或 `needs_decision`（`proposal_missing`，第 2 次没做完时还有 `review_incomplete`） | `settleReview` |
| UCR-08b | `resolved`、`held`（UCR-15 在一轮进行中定下的），`activeRound` 的 Run 已以已知结果结束（含 UR3h 取消的） | `settled` | L16 | 状态、处置、`hold` 不变；还是 `pending` 的条目记 `undetermined`，看不全的照 D6 改判；`activeRound = null`；`open: 'no'` | `settleReview{round_ended}` |
| UCR-08c | `awaiting_proposal`，没有进行中的一轮，只读命令用不了 | `settled` | L16 第 3 种；记录@revision | `needs_decision`，原因 `review_unavailable`、`proposal_missing`（D2） | `settleReview{review_unavailable}` |
| UCR-09 | `needs_decision` | `disposition_applied`（`rerun_as_is`/`skip_as_done`） | L19 | `resolved`；`skip_as_done` 时同一次写落下 `blockedCommands`（每条跑程序的 `dispositionTargets`，L19a）；`rerun_as_is` 不落 | `applyDisposition` |
| UCR-10 | `needs_decision` | `disposition_applied`（`safer_method`） | L19；卡上有这一项：`proposalTargets` 不为空、至少 2 个空位（L18），否则 `invalid` | `awaiting_proposal`，`proposals = []`，`stateEntry` 加 1；原命令到 UCR-12 同意时才落下（L19a） | `applyDisposition` |
| UCR-11 | `needs_decision` | `disposition_applied`（`handle_myself`） | L19 | `resolved`，`hold: 'held'`；不落 `blockedCommands`（L19a） | `applyDisposition` |
| UCR-12 | `awaiting_approval` | `approval_applied`（`approve`） | L19 | `resolved`，`approvedMethods`；同一次写落下 `blockedCommands`（`proposalTargets` 每条的原命令，L19a） | `applyDisposition` |
| UCR-13 | `awaiting_approval` | `approval_applied`（`decline`） | L19 | `needs_decision`（`proposal_declined`），`disposition.choice` 留 `safer_method`、`approval` 记下 | `applyDisposition` |
| UCR-14 | `resolved`，`hold: 'held'`，`activeRound = null` | `hold_released` | 操作者类别 `human`；记录@revision；`activeRound` 不为空 → `busy`（“核对轮还没收尾”，D3） | `resolved`，`hold: 'released'` | `releaseHold` |
| UCR-15 | `pending_review`、`awaiting_proposal`、`needs_decision`、`awaiting_approval`；或 `resolved`、`hold` 不是 `held`、原 Run 仍是选定 Run | `hold_applied` | 操作者类别 `human`；记录@revision；读到的 TaskLease@revision 和选定 Run 的事实（D3） | `resolved`，处置 `handle_myself`（`source: 'direct'`、`answerMessageRef: null`），`hold: 'held'`；`activeRound` 不动（那一轮按走到哪一步收尾：没进入的 UR3h 取消，在跑的跑完，结束的定稿；UCR-04、UCR-08b） | `holdReview` |

- 方案被否以后（UCR-13）状态是 `needs_decision`、`disposition` 已有值；之后的 UCR-09..11 用新的处置替换它，旧的留在事件历史里。UCR-15 替换原有处置时同样。
- 每一行写完都由构造函数重算 `open`（L7，D4）。
- 表外的都是 `illegal`。同一请求身份同内容 → 原回执；同身份不同内容 → `idempotency_conflict`；版本不对 → `revision_conflict`；结论定稿以后再写 → `stale`。UCR-09..13 的身份由答复消息推出（L19）。
- 不变量（新 I-23；I-17 已是“人停下的工作只由人重新开始”，I-22 是最后一条）：一个任务的选定 Run 有没定的记录（或 `hold: 'held'`）时，这个任务没有开着的普通 Run；`activeRound` 不为空时，它指向的 Run 用途就是这份记录、同一 phase；记录的 `rounds` 里每一轮的 Run 都是核对用途、`reviewRef` 指向这份记录。

### 3.2b 请求重跑记录 CRR（`state/command-rerun-request.ts`，L19a）

| 行 | 从 | 事件（`change`） | 守卫 | 到 | 谁写 |
| --- | --- | --- | --- | --- | --- |
| CRR-01 | 无 | `created` | `request_command_rerun`：命令被拦（(A) `commandSha256(这次调用)` 命中某条已落实记录的 `commandSha256`，或 (B) 动作/展开的比较键命中它的 `actions`/`expansions`；没认出但 `rewriteOf` 是这个任务里一条有效记录的有效别名也算，`declared = true`，`match.kind = 'declared'`）；同一个别名（同一核对记录）没有 `pending` 或 `allowed` 请求、没有被 `denied_final`（索引 `k3-crr-by-task-alias`）；`rewriteOf` 的核对记录不属于这个任务、前缀不唯一、或别名不是那份记录里拦下的命令 → `invalid`；入参 1..4000 字节 / 1..2000 码点；新记录的 `declaredForms`：注明的未认出写法从它开始，否则为空（最多 8 条） | `pending` | `requestRerun` |
| CRR-02 | `pending` | `allowed` | 卡答复 `allow_rerun`；请求@revision；答的是这张卡；任务仍 active（暂停 → `busy`，等继续） | `allowed`（允许一次，未用） | `applyAnswer` |
| CRR-03 | `allowed` | `used` | `before_tool` 钩子放行这次 `shell` 调用以前：`commandSha256(这次调用)` 等于请求记录的 `commandSha256`（只放行卡上那一种写法）；记下这次调用的 callId；提交成功才放行，失败照拦下处理、允许还在（L19a） | `used` | `consumeAllowance` |
| CRR-04 | `pending` | `denied` | 卡答复 `deny`；守卫同 CRR-02 | `denied` | `applyAnswer` |
| CRR-05 | `pending` | `denied_final` | 卡答复 `deny_final`；守卫同 CRR-02 | `denied_final` | `applyAnswer` |
| CRR-06 | `pending`、`allowed`（未用） | `closed` | 任务结束（满足、取消、被替代）；`used`、`denied`、`denied_final` 已经终态，不再改 | `closed` | 任务结束的处理 |
| CRR-07 | `pending`、`denied`（同一个 Run）、`denied_final` | `forms_added` | `request_command_rerun`：`rewriteOf` 有效、命令没被 (A)(B) 认出、这个别名已有上面三种之一的记录；把这次写法的 `{ sha256; text }` append 到那条记录的 `declaredForms`；append 后不超过 8 条，否则 `capacity`、什么都不写（L19a） | 状态不变，revision + 1 | `requestRerun` |

- 状态只有这几个：`pending` → `allowed` → `used`；`pending` → `denied`；`pending` → `denied_final`；任何未完的状态在任务结束时 → `closed`；`forms_added` 不改状态，只 append 注明过的写法。按别名记：`denied` 和 `denied_final` 都按（任务、核对记录、别名）查；`denied_in_this_run` 用请求记录自己的 `runRef` 认同一个 Run，同一轮里换个写法也不能再问；`deny_final` 是这个别名（这份核对记录里）的任何写法都不行。
- 同一请求身份同内容 → 原回执；同身份不同内容 → `idempotency_conflict`；版本不对 → `revision_conflict`。工具的 `not_blocked`、`pending`、`allowed`、`refused` 分支不写记录；`requested` 分支走 CRR-01，注明的新写法走 CRR-07（或 CRR-01 的新记录）。
- 不变量：一个别名（同一份核对记录）同时最多一条打开着的请求（`pending` 或 `allowed`，最多对应一张卡）。

### 3.3 自动化判断（TD-9 加两行）

| 行 | 位置 | 条件 | 判断 |
| --- | --- | --- | --- |
| AV-2b | AV-2 之后、AV-3 之前 | 选定 Run 有记录，状态不是 `resolved`；或记录键在、读不出 | `stopped('unknown_call_review', { reviewStatus })`（读不出时 `reviewStatus: 'unreadable'`） |
| AV-4c | AV-2b 之后、AV-3 之前 | 选定 Run 的记录 `resolved`、`handle_myself`、`hold: 'held'` | `stopped('task_paused', { fence: 'human_pause', pausedBy: 'human', reviewHold: true })` |

`decision-policy.ts:pausedAutomationAction`（目标暂停时推导卡）加同样两条：失败事实里的记录没定、读不出，或 `hold: 'held'` → `null`（L22）。

记录 `resolved`、`hold` 不是 `held` 时 AV-2b、AV-4c 都不命中，往下照今天：原 Run 的围栏是人的，落到 AV-4（`task-failure.ts:779–791`），任务停着等你点“继续”（D9，L19）；AV-3（已有覆盖它的人的重排）在 AV-4 之前，所以你的“继续”照常领取。

FC 表加 FC-7b（L26）。

### 3.4 Workflow 每个任务先看记录（`selectNext`，在 `automaticRequeue` 之前）

从上往下第一条命中。

UR7b 是唯一不按选定 Run 找记录的一行：它由启动第 6b 步交来的没补记答复驱动，按每条答复自己的 `reviewRef` 走，和选定 Run、任务能否领取、记录的 `open` 都无关（M2）。

| 行 | 触发（选定 Run 的记录；UR7b 除外，按答复的 `reviewRef`） | 下一步 |
| --- | --- | --- |
| UR0 | 记录键在、读不出 | 跳过；指定了这个任务时 `waiting`，原因写明记录读不出（L7 的 fail-closed） |
| UR3h | `hold: 'held'`，有进行中的一轮，它的 Run 满足取消专用判断 `isUnenteredReviewRoundForCancellation(activeRound.runRef)`（§2：Claimed、Authorized、Revoked 三种，证明从没进入，**包括被暂停的**；不用 `isUnadmittedStarting`，它在 `workflow.ts:905` 把 `paused` 排除掉，UR3h 需要能取消暂停在进入前的核对轮） | `cancel_review_round`：以 Workflow 自动化身份对这个 Run 提交 `cancel`（提交钉住读到的那一版 Run，revision 守卫照留），控制 owner 按 RUN-09（U）结束它（L21，D3）；之后 UR4 收尾。领取之后、`start` 之前你暂停了它（指针是 `paused`）时，这个 Run 仍从没进入 Kernel，UR3h 照样取消它 |
| UR3a | 有进行中的一轮，`hold` 不是 `held`，它的 Run 是领取了没进入的 `starting` | 对这个 Run 做 `prepare`，再 `start`（同 W-01..W-03，用同一个领取；L29 第 2 行）。`start` 回 `stale` 而记录已经 `held` 的（你在两步之间点了“我来处理”），下一次选择走 UR3h |
| UR3 | 有进行中的一轮，它的 Run 已进入或在跑（含你暂停在安全点的） | 跳过这个任务 |
| UR4 | 进行中的一轮的 Run 已以已知结果结束（不论状态是不是已被 UCR-15 定下） | `settle_review{round_ended}`（owner 按这一轮的围栏和 `hold` 分 UCR-06、UCR-06b、UCR-07、UCR-08、UCR-08b） |
| UR5 | 进行中的一轮的 Run 是 `outcome_unknown`（含 `review_round` 挡下的，L15） | 跳过，等人认定这一轮 |
| UR7b | 启动第 6b 步按目标交来的每一条没补记的答复，按它自己的 `reviewRef` 找记录：**不看这份记录是不是任务选定 Run 的记录，不看任务能不能领取，不看记录的 `open`**（`open` 可能是 `no`：接续已经领取、这条记录成了历史）。`listUnappliedAnswers` 从答复那边找（L28，D4），不从“选定 Run 的记录”这一列找 | `apply_review_disposition` 按那个答复重放出 ② 的原回执，再做 ③（L19、L29 第 5b 行）。只补记账，不放开 `hold`、不接续；接续本来也不等它：这一步做完，下一次选择照常 |
| UR8 | `resolved`，`handle_myself`，`hold: 'held'` | 跳过（AV-4c） |
| UR1 | `pending_review` 或 `awaiting_proposal`，没有进行中的一轮，只读命令可用 | 选 Session（L12，起点和 `afterRunRef` 都是最近持有者）：`close_open_turn` / `create_session{review}` / `claim_task`（依据 `review`），之后 `prepare`、`start`、`observe` |
| UR2 | `pending_review` 或 `awaiting_proposal`，没有进行中的一轮，只读命令用不了（`reviewCapability`） | `settle_review{review_unavailable}`（UCR-07 或 UCR-08c） |
| UR6 | `needs_decision` 或 `awaiting_approval`，当前卡没有答复 | 跳过；指定了这个任务时 `waiting`，带这张卡的来源 |
| UR7 | 同上，当前卡已有选项答复，处置没落实 | `apply_review_disposition`（Workflow 自动化身份；身份由答复消息推出），再按回执做 ③（L19、L29 第 5 行） |
| UR9 | `resolved`，其它，或没有记录（权威 `not_found`） | 照今天：自动化判断按 TD-9 走（原 Run 的围栏是人的，落到 AV-4，等你点“继续”，D9）；有你的处置的（L22 的 `requeueConfirmed`），那一次自动重排不出确认卡；接续的 Session 和 `close_open_turn` 用最近持有者（L12） |

- `performStep` 的 `start`、`observe` 拿到核对用途的 Run：下一步就是 `settle_review{round_ended}`（Run 已结束时），从不 `open_checks`、从不 `afterNotNormalEnd`（L10）。

### 3.5 其它流程行

| 行 | 何时 | 做什么 | 结果 |
| --- | --- | --- | --- |
| KR1 | 启动核对第 2 步，Turn 没终态、有调用没结果 | 分类器按 L25 的先后查 Runtime 一边的守卫，都成立才查平台回执、采集工作区，提交 `unknown` 带候选或 `blockedBy` | RUN-25 或 RUN-20(i)，报告行（`ReconcileLine`）带 `autoCleanup` |
| KR2 | 启动核对第 2b 步 | 按 `open = 'yes'` 列出还要推进的记录；6b 按目标查没补记的答复 | 报告 `reviews`；6b(c) 的四种（L28） |
| KR3 | 人认定（Host 入口） | 读调用、查回执、采集，带草稿认定 | RUN-22 + UCR-02 |
| KR4 | 核对轮里模型调 `record_unknown_call_review` / `propose_safer_method` | owner 写结论或方案 | UCR-04、UCR-05 |
| KR5 | 你答了卡 | `resolveDecision`：答复、落实（身份由答复消息推出）、补记 | UCR-09..13 |
| KR6 | 你在“我来处理”的任务上点“继续” | `releaseHold`（路由 `unknown-call-reviews/release-hold`）；原 Run 的围栏是人的，路由接着以你的身份调 `requeueTask`（D9） | UCR-14，之后照常接续，那一次重排不出确认卡；`activeRound` 不为空时 `busy` |
| KR7 | 拼接续说明（原 Run 有记录） | 加核对记录一节（必需部分不缩短）、改文件的 diff（L6、L20） | 接续说明 |
| KR8 | 你在线的详情或卡上直接点“我来处理” | `holdReview`（路由 `unknown-call-reviews/hold`） | UCR-15；卡进历史；任务停住（AV-4c） |
| KR9 | 核对轮或提方案的一轮跑起来 | 输入通道只有 `controlInputs` | 信件和回复留给接续（L13） |
| KR10 | “我来处理”定下时，核对轮领取了还没进入 | UR3h：Workflow 以自动化身份 `cancel`，RUN-09（U） | 这一轮 `cancelled`，UR4 → UCR-08b（L21，D3） |
| KR11 | 你答完核对卡，原 Run 是你停下的 | 记录 `resolved`，自动化判断落到 AV-4 | 任务停着，等你点“继续”（人的 `tasks/requeue`，D9） |
| KR12 | 拦下的命令要再跑；或你答了请求卡 | `request_command_rerun` 的 owner（CRR-01）；`resolveDecision` 落实答复（CRR-02、CRR-04、CRR-05） | 新请求 / `allowed` / `denied` / `denied_final`；放行以前先提交 CRR-03，成功才放行（L19a） |

## 4. 规则

1. 收尾和核对从不重跑、不续跑原 Turn，从不给没结果的工具调用编结果；Kernel 里那条调用永远是原样。
2. 自动收尾只在 L25 的守卫全成立时发生；任何一条不成立，就是今天的 RUN-20，等人认定。
3. 不在变动清单里，不证明“没做”。只有平台 owner 的权威查找没查到，才能说平台工具“没做”。
4. 观察到的结论和你的处置分开存；处置从不改写结论；定稿以后结论不再改。
5. 记录没定（或“我来处理”没放开）时，这个任务只能领取核对轮；Workflow、领取、重排（系统和 agent；`held` 时还有不带归档来历的人）、进入、启动重驱都拦。记录读不出按没定拦；只有权威的“键不存在”才算没有记录。每一次领取都对这份记录加读守卫，“我来处理”对租约和选定 Run 的事实加守卫，两边谁先提交，另一边都回 `revision_conflict`（D3）。
6. 核对轮、提方案的一轮只读，不算返工，不进返工链、选定 Run、计数和完成，从不开检查轮次；它们自己的结果未知不再核对，带没结果的调用被重启打断时一律等人认定（`review_round`，D1）；它们不收 Session 的信件和回复。
7. 清单不完整从不当作“没有要核对的”。停下时 Kernel 读不了的，之后读得到也算不完整。
8. 同一个任务的接续，在核对卡和普通确认卡之间最多出一张：三处推导（Workflow、读模型、目标暂停时的推导）用 `decision-policy.ts` 的同一条规则。
9. 受保护路径从不被读，也不列出名字。
10. 记录、卡、处置都只经 `state/` 的构造函数写；卡是派生的，不另存。
11. 读取和启动核对不调用模型；核对轮、提方案的一轮是仅有的新的模型调用。
12. 人停下的只由人重新开始：你暂停或取消的核对轮不自动再开（`review_stopped`）；“我来处理”只由你的“继续”放开；原 Run 是你停下的，答完核对卡也不自动接着做，等你的“继续”（D9）。
13. 你的处置不重置“连续”：只有 Kernel 自己写的终态是重置点（L23）。
14. B2 用户已定（决定 57）：平台拦下原命令（跳过的不许重跑，方案的不跑原命令）；要再调这条命令，agent 必须给人类一个原因、人类必须知道并允许（四种结果见 L19a）；机制见 L19a。
15. 接续说明里核对记录一节的必需部分（只用别名，含同意的方案原样）不缩短；方案在写的时候按预算表的 5,120 字节挡住。方案一定放得下只在锚点任务 ID 和 callId 都留在预留 T = 512 字节以内时成立，超过 T 时按第 1 片的规则回 `capacity`（L20，S1）。
16. 核对说明里没给全文的命令（截断或没展开），定稿时做没做完、崩溃自查都一律“判断不了”（D6）；模型写的结论和自查留在 `reviewerConclusion`。
17. 一份记录最多 8 轮；同一次进入第 2 轮还没做完一定出卡（`review_incomplete`），哪怕条目都有结论（D2）。
18. 每次写都按写后的序列化 UTF-8 字节准入（M3，L7）：必须写的（定稿、批准、hold/release、处置）一律放行，可选模型文字只在写后记录 ≤ 512 KiB − 预留 R 时收；创建放不下就按 Kernel 顺序截条目、清单记 `incomplete`/`too_large`，记录照建；超了回 `capacity`，什么都不写。
19. B2 的拦命令和请求重跑（L19a）：处置落实时按 `skip_as_done` / 同意方案写下 `blockedCommands`；`shell` 调用在交给沙箱前按它拦下，回固定的话（正常结束，不是 `outcome_unknown`）；要再跑先 `request_command_rerun`，人允许一次才放行（CRR 表，§3.2b）；拦的范围是同一个任务，`commandSha256(调用)` 相同、或者静态解析认出是同一个动作（比较键相同）的改写也拦，认不出的改写 agent 要用 `rewriteOf` 注明以后再请求。

## 5. 测试（TDD，测试由 DSH 一条一条写）

做法同 K 片 §5：
- 用 `.dsh-ref/tdd/` 的 TDD skill，在确认过的入口上一条一条先写失败测试，再写实现；
- 不读数据库核对；期望值来自规格或手算例子，不从被测系统读回来；
- 测试名以行号开头；一行里列了几种情况的，每种情况都要有断言；
- 服务层的例子在内存和 SQLite 两个后端各跑一次；
- 需要 git 工作区的例子，在临时目录里建真实的 git 仓库（夹具由 Codex 写，lead 冻结）。

### 5.1 测试入口（用户 2026-10-13 同意，决定 53）

| 入口 | 是什么 | 能抓到 | 抓不到 |
| --- | --- | --- | --- |
| R1 | 业务流程：脚本模型的 Work 在工具调用中途，Host 被关掉（真实的 SQLite 和租约文件），新 Host 启动，再用 `workflow.advanceWork` 推进。每种工具各一个例子：平台工具（发消息）、改文件、跑程序 | RUN-25 的提交、核对记录、核对轮、接续，跨重启只做一次 | 真实沙箱里的进程被杀（K3-07 由 lead 跑） |
| R2 | 核对轮：脚本模型的只读核对 Run 写下各种结论和崩溃自查；L6 的六种原因各出现一次“请你决定”卡；四个选项各自的后续 | 定稿、原因、卡、处置、方案和同意 | 真实模型的判断质量 |
| R3 | 仍然等人的各种情况：Kernel 读不了、指针上有暂停、Host 没换、连续第二次、不是 git 的工作区 | L25 每条守卫不成立时走 RUN-20，零模型调用、零关闭、零核对 | — |
| R4 | 人认定之后走同一套核对 | 认定入口的草稿、清单完整与否、K 关闭和退路、各边界的崩溃恢复 | — |
| R5 | 纯状态转换：RUN-25 的守卫、核对记录的状态、失败类别推导 | 表的每一行、配对的副作用、CAS、重放、连续的算法 | 存储和组合 |

**说明：** 入口的文字是用户同意的原文，没有改。R2 里的“L6 的六种原因”是第二版的编号，现在是 L17：原来的六种之外，多了 `inventory_incomplete`、`review_stopped` 和方案那一步的两种，K3-11、K3-16、K3-37 一并覆盖；第五版又多了 `review_incomplete`、`review_unavailable`（K3-11、K3-19、K3-45）。真实 bwrap 沙箱里、Host 进程真被杀掉的那一个由 lead 在有 bwrap 的 WSL 里跑（K3-07）。“Host 被关掉”用场景框架的 `restart({ crash: true })`（崩溃的 Host 不 `close()`、锁文件改写成一个已退出的 pid），接手证明来自真实的租约文件（HL-03）。

**D11 的拆分（第五版，交用户确认测试入口时一并看）。** R5 是纯状态转换，只能断言状态机给出的转换、副作用和拒绝；正式回执的重放、RecordStore 读失败、真的取得租约、`requeueTask` 真的提交成功，纯状态里都看不到（重放要 RecordStore 按身份查回执，读失败要包一层存储，租约和重排要 owner 真的提交）。所以第五版把这些断言从 R5 的行里拿出来，放进新的 K3-47，挂在 R4 下面：R4 本来就在真的 owner 上、内存和 SQLite 两个后端各跑一次。入口的文字不改；K3-47 和 K3-39、K3-43、K3-44 这几行用的是 R4 的 owner 层（直接调 owner，经存储边界，不读数据库），用户确认测试入口时一起确认这样挂。分类器的边界（多于 32 条、解不出、核对用途的 Run）挂在 R3，用 `tests/runtime/A2-reconcile-runtime.test.ts` 那种手写的分类器依赖（第 95–98 行的 `restartedHost`）喂 Kernel 读到的 Turn，不碰数据库。

**夹具的接缝（Codex 写，lead 核对后冻结；第三版写的 `withTool` 做法造不出来）。** lead 核过：Kernel 的组合根总是先注册内置的 `shell`（`vendor/coding-agent/dist/app/composition/composition-root.js` 第 67 行，`resume-composition.js` 第 66 行同样），再注册 `additionalTools`；`ToolRegistry.register` 遇到重名就抛“工具 shell 重复注册”。`withTool` 只在 B2 的 Runtime 夹具里有，`HostScenario`、`openWorkRoot`（`tests/scenarios/support/common.ts`）没有 Kernel 工具的接缝。真的内置 `shell` 要 `isolated_process`，DSH 没有 bwrap，分派器在处理器之前就回 `sandbox_unavailable`，调用不会停在半路。所以：
- **替身 `shell`：** 用 `vi.hoisted` 加 `vi.mock` 换掉 `vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js` 的 `createShellToolDefinition`（两个组合根都从这里引），返回一个可开关的阻塞处理器：名字仍是 `shell`、`effectClass` 仍是 `process`，不要 `isolated_process`；开关关着时调真的。`HostScenario` 和 `openWorkRoot` 都能用（场景框架的 Host 跑在测试进程里，`vi.mock` 对这个测试文件起的每个 Host 都生效）。先例：K M2 和 `tests/composition/R4-control-runtime-platform.test.ts` 对 `public-api.js` 的 `vi.mock`。
- **只读命令可用：** 核对轮要 `run_readonly_command` 注册得上（`reviewCapability` 回 `available`）。DSH 里用 K 的 KE6 同一个能力探测替身（沙箱可用与否经 Kernel 的能力探测替身控制）；脚本模型的核对轮多数只调 `record_unknown_call_review`，K3-12 才真调一次只读命令，结果走 K KB-10 的映射。
- **存储读失败一次：** `HostScenario.start` 加一个包 RecordStore 的选项（同 `tests/helpers/task-claim-fixture.ts` 的 `wrapRecords` 做法），让下一次 `lookupCommit` 失败一次，给 K3-03 用。
- **git 工作区：** `HostScenario.open` 加一个选项，在场景工作区里 `git init`、写入并提交初始文件，作开始基准的前提；受保护路径按 Host 设置的 `deniedPrefixes` 放一个文件（K3-04）。
- **多个任务的记录：** K3-20 用一个 Plan 里 5 个 work 任务，各自领取、Kernel 读不了时被认定（每个得到一份 `needs_decision` 的记录），内存后端和 SQLite 各一次。
- **两种先后的竞争（K3-43）：** owner 层的例子，用 `task-claim-fixture.ts` 的 `wrapRecords` 那种包装在“领取读完、提交之前”或“我来处理读完、提交之前”插入另一边的提交，两种先后各一次。
- **工作区里先删的文件（K3-40）：** 在 git 工作区夹具上，Run 开始之前删掉一个已跟踪文件（不提交），再按例子重建、换成符号链接或改可执行位。
- **长命令和长标识（K3-35、K3-42、K3-48）：** 脚本模型发一条超过 4 KiB、带控制字符的 `shell` 命令；callId 的长度由脚本模型的 provider 替身给（Kernel 只要求非空）：512 字节（上限，K3-35）和 513 字节（K3-26（九））两种；异常锚点由第 1 片的归档夹具造，任务 ID 用 512 字节和 600 字节两种。记录大小的例子（K3-48，M3）用长命令、长路径和 32 条条目，把创建时的记录凑到创建预算 B = 158,720 字节附近（创建预算和可选文字的门槛是同一个数：B = 512 KiB − 预留 R = 158,720，R = 365,536）；再用长结论依据、长附言把可选文字推到门槛上，另用最坏的那一份验证定稿、处置和 hold/release 仍放得下。
- **人停下的原 Run（K3-41）：** 指针上有你的暂停时 Host 重启（RUN-20(i)，`stop_pending`），再经 `executions/resolve-unknown` 认定。

### 5.2 验收行为

**R1 业务流程**

| 行 | 入口 | 行为 | 期望值来源 |
| --- | --- | --- | --- |
| K3-01 | R1 | 发消息的调用，消息已提交、Kernel 没记下结果，Host 崩溃（同 A8-3j 的故障点），git 工作区、有开始基准。新 Host：Host 报告的那一行 `row: 'W-26'`、`autoCleanup: { applied: true }`；Run `crashed`、观察 `takeover_unresolved`、证明 `hl03_stale_lock` 带旧实例 ID 和 pid；记录 `resolved`，这一条 `done`、依据是回执的 cursor；推进：K 关闭（`afterRunRef` 是这个 Run）、原 Session 领取接续、消息没有再发；接续说明写“已做”；“请知悉”有一条“自动恢复”，不计次 | L2、L4、L24、L25；决定 52 |
| K3-02 | R1 | 同上，故障点在消息提交之前：这一条 `not_done`，接续说明写“没做” | L4 |
| K3-03 | R1 | 同 K3-01，新 Host 用 §5.1 的存储包装，让查找那一次 `lookupCommit` 失败：这一条 `undetermined`（`lookup_failed`），记录 `needs_decision`（`undetermined`），出卡，没有接续 | L4、L17 |
| K3-04 | R1 | 改文件：一个 `replace`（改已跟踪的文件）、一个 `create`（新的未跟踪文件）在途。RUN-25；记录两条 `compare_in_continuation`；接续说明：两个路径各自 `modified`、`added`，`replace` 那条带 diff，内容与手算的一致，不超过 2,000 个单位；受保护路径下的文件没出现在任何地方（名字也没有）；这个 Run 前面已经做完的一条命令往 git 忽略的目录写过文件：那个文件不在变动清单里，`notVisible` 列出那个目录，接续说明写着“不在清单里不证明没做”；准备清单里 `workspaceBaseline` 是一个 Artifact 引用，不是内容 | L5、L6 |
| K3-05 | R1 | 跑程序：替身 `shell` 在途。RUN-25；记录 `pending_review`；推进：K 关闭、原 Session 领取核对轮（依据 `review`，用途、工具清单、写范围为空，任务投影仍是 `failed`）；核对轮写“已做 / 不太可能”；`start` 或 `observe` 之后的下一步就是 `settle_review`，没有 `open_checks`，检查的 owner 没有为核对轮建任何轮次；定稿 `resolved`；接续在原 Session，接续的重排和领取都过了租约检查（租约最后是核对轮释放的）；任务没有被完成；原 Kernel 里那条调用仍是 `outcome_unknown` | L10–L16 |
| K3-06 | R1 | 一批里同时有发消息、改文件、跑程序：三条按各自种类处理；只开一轮核对；最后只有一次接续 | L3、L9 |
| K3-07 | R1（**要 bwrap，lead 跑**） | Host 跑在子进程里，真的 `shell` 跑一条长命令时 `SIGKILL` Host：沙箱里的命令也停了（主机上没有残留进程）；新 Host 走 RUN-25，证明 `hl03_stale_lock` 带被杀进程的 pid | L2 的前提 |
| K3-08 | R1 | （一）等回复的发送（`replyMode: 'wait'`）在途：`done`；等待关系没了（同 A8-3j）；之后对方回复送到原 Session，接续的安全点收到。（二）同一批里有一个等回复的发送和一条命令：回复在核对轮进行中送到原 Session；核对轮没有接受它（它的 Kernel 记录里没有这条输入的 `run.input_accepted`）；接续那一轮的安全点收到它 | L4、L13；K KA-08 |
| K3-09 | R1 | 重放和重启：K3-05 在每一步之间都重启一次（收尾后、领取后、写结论后、定稿后）。（一）写结论后的那次重启在两次调用之间打断了核对轮（没有没结果的调用）：照今天 RUN-19；第二轮在同一 Session 领取，`close_open_turn` 的 `afterRunRef` 是第一轮的 Run，关闭成功（不是一直“可以重试”）。最后只有一次原 Run 的收尾、一份记录、两轮核对（第一轮 `unfinished`）、一次接续；最后一次重启零写入。（二）重启时核对轮的 `record_unknown_call_review` 正在途（替身工具阻塞住）：核对轮走 RUN-20(i)，报告 `autoCleanup.blockedBy: 'review_round'`，没有新记录，没有 Kernel 关闭；Workflow 跳过（UR5）；经 `executions/resolve-unknown` 认定这一轮（不建记录）以后，这一轮记 `unfinished`，第二轮在同一 Session 领取，`afterRunRef` 是第一轮的 Run | L12、L15、L29；D1 |
| K3-40 | R1 | 开始时已删的已跟踪文件（D5），git 工作区、开始基准里这个路径是 `deleted`，每例一个替身 `shell` 在途、RUN-25：（一）一直不在 → 采集里没有这个路径；（二）Run 里重新建出来 → `added`；（三）开始时是普通文件、改过没提交，Run 里换成符号链接 → `mode_changed`；（四）只改可执行位 → `mode_changed`；（五）只改内容 → `modified` | L5 |
| K3-HO1 | R1 | K7-3a：造“退役 + `kernel_turn_open` + 换手后继”的线，连跑两轮维护：第一轮之后 Host 的关闭第一次回 `refused('handed_over')`，同一轮重读事实、按普通维护再走一遍 → Turn 关了、线归档；第二轮什么也不写 | L30a；2C 证据 `lead-acceptance.md` 第 7 条 |

**R2 核对轮和卡**

| 行 | 入口 | 行为 | 期望值来源 |
| --- | --- | --- | --- |
| K3-10 | R2 | 结论 × 自查，4×3 共 12 格，每格一个只有一条命令的记录（目标“方案确认后自动”，没有连续），期望的原因（按 L17 的顺序）：<br>`done+unlikely` → 无，`resolved`；`done+possible` → `crash_possible`；`done+undetermined` → `crash_undetermined`；<br>`not_done+unlikely` → 无，`resolved`；`not_done+possible` → `crash_possible`；`not_done+undetermined` → `crash_undetermined`；<br>`partial+unlikely` → `partial`；`partial+possible` → `partial, crash_possible`；`partial+undetermined` → `partial, crash_undetermined`；<br>`undetermined+unlikely` → `undetermined`；`undetermined+possible` → `undetermined, crash_possible`；`undetermined+undetermined` → `undetermined, crash_undetermined`。<br>有原因的都是 `needs_decision` 出卡 | L17；决定 53（“做完了、自查判断不了”也要你确认） |
| K3-11 | R2 | L17 的原因：`inventory_incomplete`、`second_consecutive`、`confirm_each_step`、`review_incomplete`、`review_unavailable` 各单独出现一次（`review_incomplete`、`review_unavailable` 的例子在 K3-45、K3-19）；再有一份同时有三种原因的，原因按固定顺序全列 | L17、L23 |
| K3-12 | R2 | 核对轮的工具清单恰好是 L13 的那几个，没有 `shell`、`edit`、协作工具；写范围为空；核对轮里试图改文件的只读命令失败（能力替身下的结果映射，同 K KB-10） | L13；K L18 |
| K3-13 | R2 | 两条命令只写了一条结论就正常结束：另一条定稿成 `undetermined`，依据是固定的那句 | L16 |
| K3-14 | R2 | 工具的身份：同一次调用重放 → 原回执，记录不变；同身份改了内容 → `idempotency_conflict`；新的一次调用改结论 → 以后提交的为准；别名指向不是 `process` 的条目、或没有这个别名 → `invalid_arguments`；这一轮结束后再写 → `stale` | L14 |
| K3-15 | R2 | 四个选项和“我来处理”的入口：<br>（一）照原样重跑 → `resolved`，接续说明写你的选择、核对结论“已做”照写；<br>（二）跳过当作已做 → `resolved`，Kernel 里那条仍 `outcome_unknown`，接续说明写“平台拦下原命令；要再跑先请求并得到允许”；<br>（三）卡上选我来处理 → 任务停住（AV-4c，细节 `reviewHold: true`），重启后还停着；这时人的 `tasks/requeue` 回 `busy`（`unknown_call_review_held`），没有 TaskRequeue；点“继续”（release-hold）以后接续；<br>（四）核对轮进行中直接点“我来处理”（`unknown-call-reviews/hold`）：记录马上 `resolved`、`held`、`source: 'direct'`；这一轮照常跑完，之后写的结论照收；这时点“继续” → `busy`（“核对轮还没收尾”）；结束后的 `settle_review` 不改状态、不出卡；Workflow 不再开新一轮；之后点“继续”才接续；<br>（五）记录自动定下、接续还没领取时直接点“我来处理”：任务停住，没有接续；点“继续”以后接续；<br>（六）核对轮领取了、还没进入时直接点“我来处理”（领取之后、`start` 之前停住 Workflow）：下一次推进走 UR3h，这一轮 `cancelled`（没进入 Kernel，Kernel 里没有它的 Turn），UR4 收尾（UCR-08b），没有模型调用；另一例 UR3a 已读过记录、`start` 在点了之后才到：RUN-02 回 `stale`，下一次推进走 UR3h，结果相同；<br>（七）**领取核对轮 → 进入前你暂停它（指针 `paused`，证明从没进入）→ 直接点“我来处理”**：UR3h 的取消专用判断 `isUnenteredReviewRoundForCancellation` 成立（`isUnadmittedStarting` 在这一格不成立，`workflow.ts:905` 排除 `paused`），以自动化身份提交 `cancel`（提交钉住读到的那一版 Run），RUN-09（U）结束成 `cancelled`；`settle_review` 只收尾这一轮（UCR-08b），状态、处置、`hold` 不变；之后 `release-hold` 照常放行（`activeRound` 已空）→ 接续；全过零模型调用。**再一例：取消提交之前 Run 被别处改动（revision 变了）→ 提交回 `revision_conflict`，不改任何状态**；<br>换稳妥跑法见 K3-16 | L19、L21、L29 第 2 行；D3、M1 |
| K3-16 | R2 | 换稳妥跑法：提方案的一轮写方案；第二张卡逐条列出原命令和方案全文；同意 → 接续说明里是方案命令全文、写明不跑原命令；不同意 → 回到四个选项的卡（`proposal_declined`）；答第一张或旧版的卡 → `revision_conflict`；有一条没方案 → `proposal_missing`；方案按 `approvedMethodLinesZh` 排出来合计超过 5,120 字节 → 工具结果 `capacity`，记录不变；正好 5,120 字节 → 收下 | L20 |
| K3-17 | R2 | 答复的形状和落实：只写话不选项 → `invalid`；选项加附言、批注 → 附言进接续说明；目标暂停时答 → 落实等继续，继续以后 Workflow 落实（UR7）。落实两次：Workflow 先落实（UR7），你再重试 `resolveDecision` → ② 返回第一次的提交回执（`replayed: true`），③ 用它补记成功，卡从“已答待落实”进历史；反过来你先、Workflow 后，结果相同 | L18、L19 |
| K3-18 | R2 | 自治级别和不出两张卡：<br>（一）“每步确认”下核对全是“已做 / 不太可能” → 仍出卡（`confirm_each_step`）；你选照原样重跑以后，那一次自动重排不再出确认卡，全程只有一张卡；<br>（二）“方案确认后自动”下不出卡；<br>（三）“每步确认”下只有改文件的条目 → 没有核对卡，只有普通确认卡一张；<br>（四）“每步确认”、记录 `needs_decision` 时目标暂停：队列里只有核对卡，没有 `system_requeue` 的确认卡（读模型走 `pausedAutomationAction`）；<br>（五）“每步确认”、“我来处理”放开以后：不出普通确认卡，直接接续 | L22 |
| K3-19 | R2 | 只读命令用不了（Host 开关关）：（一）`pending_review`：不开核对轮，零模型调用；定稿，原因含 `review_unavailable`，每条“判断不了”，出卡（UCR-07）；（二）你选了换稳妥跑法以后开关才关：不开提方案的一轮，零模型调用；马上 `needs_decision`，原因 `review_unavailable`、`proposal_missing`，又是卡（UCR-08c，D2） | L13、L16 |
| K3-20 | R2（2A 之上） | 5 份 `needs_decision` 的记录（§5.1 的“多个任务的记录”夹具），卡来源的 `pageLimit` 设成 2：来源读了 3 页，队列 `limit: 2` 翻到底是这 5 张卡，不重不漏、计数 5，不报 `capacity`；`readDecisionCard` 读第 5 张，内容和夹具写的一致；读取中途提交一份新记录（2A QA-16 的存储替身）→ 结果是下一次尝试的。内存和 SQLite 各一次。5,001 的规模由 2A 的 QA-05、QA-09 管 | L24；2A L6、L7、L8 |
| K3-35 | R2 | 大小（D8，用最长的标识和最大的锚点，不用普通的）：<br>（一）32 条命令、每条超过 4 KiB、带控制字符和引号（JSON 里会变长），callId 各 512 字节（上限），变了的路径样本 200 条各 512 字节：核对轮的 `prepare` 成功；量出来的整份清单不超过 256 KiB；放不下的按 L13 的顺序收（先路径样本、再 `notVisible`、再从最后一条起 `unexpanded`），收过的计数对；清单里没有任何一个 callId；每条至少有别名和工具名；<br>（二）接续说明的最坏情况按 L20 的预算表凑：8 条异常锚点（每条“无法确定”、原因超过 60 个单位的中文、工作树来源、任务 ID 正好 512 字节），略去数 16 位，32 个作用对象，附言 2,000 个中文字，callId 各 512 字节（上限），同意的方案排出来正好 5,120 字节：接续的 `prepare` 成功，渲染不超过 16,384 字节，必需部分逐字在（方案原样、别名、两句固定的话），callId 只出现在正文行或被略去；<br>（三）同（二），锚点的任务 ID 改成 600 字节（S1：T = 512 是预留，不是被强制的标识上限）：`prepare` 回 `capacity`（`ContinuationBriefCapacityError`），没有默默删掉任何必需部分；<br>（四）开始时和 HEAD 不同的文件超过 2,000 个的工作区：`prepare` 成功，基准是 `unavailable/too_many_changes`，之后这个 Run 不自动收尾 | L5、L13、L20 |
| K3-37 | R2 | 你停下的核对轮：<br>（一）进程内取消正在跑的核对轮 → `settle_review` 定稿，原因含 `review_stopped`，出卡，没有第二轮；<br>（二）你暂停着核对轮时 Host 重启（RUN-24）→ 同上；<br>（三）目标暂停时 Host 重启打断了核对轮 → 记 `unfinished`；目标恢复以后才开第二轮 | L15、L16 |
| K3-42 | R2 | 看不全的命令（D6）：一条 `shell` 命令超过 4 KiB：核对说明里这一条 `display: 'truncated'`，旁边写着“没有全文，按判断不了处理”；核对轮的工具清单里没有读 Kernel 历史的工具；核对轮对它写“已做 / 不太可能”→ 定稿把做没做完改成 `undetermined`（`by: 'settlement'`，固定的那句），崩溃自查也改成 `undetermined`（依据是固定的“命令没给全，自查同样没有依据。”，不照模型写的“不太可能”），`reviewerConclusion` 是模型写的“已做”“不太可能”和依据，卡上显示它；原因含 `undetermined`、`crash_undetermined`（没有 `crash_possible`），出卡。另一例清单放不下、这一条 `unexpanded`：同样改判；再一例模型对截断的命令写“可能”：自查照样改成 `undetermined`，原因含 `crash_undetermined`，不含 `crash_possible`，模型写的“可能”留在 `reviewerConclusion` | L13、L16 |
| K3-45 | R2 | 轮次（D2）：<br>（一）核对轮两次都没做完（每次都在写完全部结论以后被打断）：第二次以后定稿 `needs_decision`，原因含 `review_incomplete`，虽然每条都有结论；<br>（二）提方案时两次没做完：`needs_decision`，原因 `review_incomplete`、`proposal_missing`；<br>（三）“进入一次”从零数：第一次提方案没做完一次、写了方案、你不同意；第二次提方案又没做完一次 → 不定稿，再开一轮（两次进入各只算一次）；<br>（四）空位：攒到只剩 1 个空位时出的卡只有三个选项（没有换稳妥跑法），答 `safer_method` → `invalid`；还剩 2 个时有四个 | L9、L15、L18 |
| K3-46 | R2 | 两组作用对象（D7）：<br>（一）只有平台条目查不清的卡（一条发消息 `lookup_failed`）：三个选项，没有换稳妥跑法；答 `safer_method` → `invalid`；<br>（二）混合的卡（一条命令判断不了 + 一条平台条目查不清）：四个选项；选换稳妥跑法 → 提方案的一轮只给那条命令写方案，给平台条目写 → `invalid_arguments`；一条方案就够 `awaiting_approval`；同意 → 接续说明里命令照方案写，平台条目写“结果查不清，重做前先核实”，卡上也写着这一句 | L18、L20 |
| K3-48 | R2（创建那一条也在 R1、R4） | 按序列化大小准入（M3，L7、L8）：<br>（一）创建溢出：造一个 RUN-25（或认定）的 Turn，条目按 Kernel 顺序刚好放不进创建预算 B = 158,720 字节（用长命令、长路径凑）：记录照建，`inventory: 'incomplete'`、`inventoryProblem: 'too_large'`，保留的是 Kernel 顺序里放得下的前几条、`itemsOmitted` 对得上；`needs_decision`、原因含 `inventory_incomplete`，出卡；G11 没把它挡回 RUN-20(i)，没进记录的调用不在任何地方；<br>（二）可选模型文字溢出：一条已经接近（512 KiB − 预留 R）的记录，`record_unknown_call_review` 再写一段依据 → 工具结果 `capacity`，记录一个字节都不变；`propose_safer_method` 写方案理由时同理；把依据写短 → 收下；<br>（三）必须写的仍放得下：同一条接近门槛的记录，`settle_review` 定稿、卡上答复落实（处置）、`hold`/`release-hold` 都照常提交，结束后记录不超过 512 KiB（按 R = 365,536 的界造最坏例子） | L7、L8、L14、L16、L20；M3 |
| K3-49 | R2（真实 systemd 用户会话，lead 在 RE1 跑） | K7-3b：资源上限片 RL-10c 的场景（命令刚起、放行以前就被取消）加一条断言“取消以后这个单元不在了”；停不掉只记一行日志、不影响结果；放行以后的取消照资源上限片今天的做法 | L31b；资源上限片 §9 的已知限制 |

**R3 仍然等人**

| 行 | 入口 | 行为 | 期望值来源 |
| --- | --- | --- | --- |
| K3-21 | R3 | 每条守卫不成立各一个例子，都是 RUN-20(i)，Host 报告那一行 `W-13`、`autoCleanup.blockedBy` 对应：没有接手证明（`HostInstanceFacts` 没有 `takeover`）→ `no_takeover_proof`；表外的工具 → `uncontained_tool`；指针上排队的暂停、已生效的暂停、排队的取消、排队的插话 → `stop_pending`；已接受的输入没核对过来源 → `inputs_unconfirmed`；关闭不支持（Runtime 没装关闭）→ `closure_unsupported`；Session 有归档请求 → `session_not_closable`；连续第二次（上一次是 RUN-25）→ `second_auto_cleanup`；不是 git → `workspace_not_git`；git 但没有开始基准 → `no_baseline`；采集不稳定 → `workspace_unstable`；变动超过 2,000 → `workspace_too_many_changes`。几条同时不成立的一例，报的是 L25 先后里的第一条。`head_mismatch` 造不出来（L25），不写测试。<br>在 runtime 入口（§5.1 的 D11 拆分：`A2-reconcile-runtime` 那种手写分类器依赖，喂给分类器读到的 Turn）再加：没结果的调用 33 条 → `inventory_incomplete`；有一条解不出参数 → `inventory_incomplete`；核对用途的 Run，没有开始基准、没结果的调用 33 条、也没有接手证明 → `review_round`（用途最先查，D1），零采集、零查找 | L25；D1、D11 |
| K3-22 | R3 | 探测各种情况：`missing` → RUN-20(ii)；`host_config` → left；Turn 有终态、有调用没结果 → RUN-20(i)，从不 RUN-25；用 Kernel 公开的 `closeOpenTurn` 直接关掉一个平台还没结束的 Run 的 Turn → left，原因 `kernel_closed_without_platform_end`，什么都不写 | L25 先后表 |
| K3-23 | R3 | K3-21、K3-22 的每一例：零模型调用，零 Kernel 关闭，没有核对轮，没有记录；Session 和 Lease 照旧被占着（`kernel_closed_without_platform_end` 那一例 Run 留在原状） | 规则 2 |
| K3-24 | R3 | （一）已有的结果未知（K3 之前的 `EndedUnknown`）照旧只走 RUN-21 和 RUN-22；RUN-25 之后旧进程的迟到终态被拒，Run 不变。<br>（二）Host 一直活着，执行中途结果未知（进程内 RUN-08，基础 `live_clean`）：Run 停在 `outcome_unknown`，没有 RUN-25，没有记录，零模型调用；重启（同一实例，或证明不成立）也不变，一直等到认定。<br>（三）K3 之前认定、没有记录的 Run（Codex 夹具经存储边界提交 K3 之前的合法记录）：照今天接续，没有核对轮 | L1、L30 |

**R4 人认定**

| 行 | 入口 | 行为 | 期望值来源 |
| --- | --- | --- | --- |
| K3-25 | R4 | 经 `executions/resolve-unknown` 认定：同一提交建记录，`origin` 带你的理由和身份；同一请求再发 → 原回执，没有第二份记录（入口这次读到的草稿不同也一样）；同身份换理由 → `idempotency_conflict`；这两种都在校验草稿之前回答 | L8；LA-8 |
| K3-26 | R4 | 清单：<br>（一）Kernel 读得到、Turn 里有命令 → `pending_review`，之后核对轮；<br>（二）读得到、没有没结果的调用 → 空的、`resolved`；<br>（三）Kernel 读不了 → `incomplete`（`kernel_unreadable`）、`needs_decision`，从不 `resolved`；<br>（四）Turn 有终态、有调用没结果 → 按这些调用建，完整；<br>（五）停下时 Kernel 读不了（RUN-20(ii)），认定前 Kernel 放回来、读得到 → `incomplete`（`kernel_unreadable_at_stop`）、`needs_decision`；<br>（六）进程内 RUN-08 的 Run，Kernel 存储被换成 Turn 开始之前的副本（文件复制，同 `moveKernelAside`、`restoreKernel` 这类夹具，不改数据库内容），认定 → `incomplete`（`turn_not_found`）；<br>（七）owner 层（D11）：直接调 owner 的 `resolveUnknownRun`，草稿是 `too_many_calls`（32 个条目、`itemsOmitted: 1`）→ 记录 `incomplete`、`needs_decision`、`inventory_incomplete`，列出的 32 条照常在；草稿说 `complete` 却有 33 条没结果的调用 → `invalid`，不写；<br>（八）owner 层：草稿是 `undecodable_call` → 同上 `needs_decision`；草稿说 `complete`、某条种类和 L3 的表按名字算的不同 → `invalid`；<br>（九）调用 ID 的上限：Turn 里有一条没结果的调用，Kernel 的 callId 是 513 字节（UTF-8；由脚本模型的 provider 替身给）→ 认定得到的记录 `incomplete`（`undecodable_call`）、`needs_decision`、原因含 `inventory_incomplete`，出卡；记录里没有这个 ID（任何地方都没有）；同一个 Turn 里 callId 正好 512 字节的调用照常列入、清单完整。owner 层：草稿里某条的 `callId` 超过 512 字节 → `invalid`，不写 | L8、L9 |
| K3-27 | R4 | 核对领取时的 K 关闭：成功 → 原 Session；Kernel 版本冲突 → `waiting`，下次成功；不支持 → 新 Session、交接、在新 Session 核对，新 Session 第一轮的历史含原 Session 已完成的部分；之后的接续也在新 Session（最近持有者的领取 Session），接续说明含核对记录 | L12、L29 第 8、9 行；K L7 |
| K3-28 | R4 | 认定的理由和人保留在 Run 上；接续的 `requeueRef.afterRunId` 是被认定的 Run；返工照今天算一次（`run_failed`），核对轮不算 | L22 |
| K3-29 | R4 | 崩溃恢复，L29 每一行一个例子（第 1–13 行和 4b、5b），故障点逐条固定；另加：<br>（一）核对轮领取之后、`start` 之前崩溃：重启后 6b (c) 交出目标，UR3a 对同一个 Run `prepare`、`start`，没有第二个核对 Run；<br>（二）第一轮核对被打断，第二轮在同一 Session 领取，两种打断各一次：干净中断（RUN-19）；带没结果的调用（RUN-20(i)，`review_round`），你认定这一轮以后（RUN-22，不建记录）。两次的 `close_open_turn` 的 `afterRunRef` 都是第一轮的 Run，成功；<br>（三）在退路建的新 Session 里核对轮被打断：第二轮的关闭在新 Session，`afterRunRef` 是那一轮的 Run，K L4 第 1 条成立。<br>每例最后都只有一次接续（或停在卡、停在“我来处理”），最后一次重启零写入 | L12、L15、L29 |
| K3-39 | R4（owner 层） | 不是信箱的平台工具的查找（D11），每个 owner 三例：提交了 → `done`（依据是回执）；没提交 → `not_done`；同身份不同内容 → `undetermined`（`idempotency_conflict`）：`send_user_message`（第 5 片的 owner）；`record_decision_application`（`applicationIdentity`，发信方从原 Run 的来历取，L4）；`propose_future_plan`（白板的 owner，`apply_future_plan` 由决定 64 删掉）。另：owner 没发布 `lookupToolCommit` → `undetermined`（`lookup_failed`） | L4 |
| K3-41 | R4 | 人停下的原 Run（D9）：指针上有你的暂停时 Host 重启，替身 `shell` 在途 → RUN-20(i)（`stop_pending`）；你认定 → 记录 `pending_review` → 核对轮 → 出卡：<br>（一）你答“照原样重跑” → 记录 `resolved`，任务停着（AV-4，`task_paused`），没有系统的重排，没有确认卡；你点“继续”（`tasks/requeue`）→ 照收（没有 `held`）→ 接续，接续说明带核对记录一节；<br>（二）你直接点“我来处理”，再点 release-hold → 路由先 `releaseHold` 再以你的身份重排 → 接续；<br>（三）（二）的两步之间崩溃：记录 `released`、任务停在 AV-4、显示“继续”；再点 release-hold → `releaseHold` 重放、重排成功，最后只有一次接续；<br>返工计数照今天（认定的 `run_failed` 算一次） | L19、L21、L22 |
| K3-43 | R4（owner 层） | 领取和“我来处理”的竞争（D3），两种先后都测，内存和 SQLite 各一次：<br>（一）“我来处理”先提交、接续领取后提交（领取读记录在前）→ 领取 `revision_conflict`，没有 Run；<br>（二）接续领取先提交、“我来处理”后提交（它读到的租约和选定 Run 已经变了）→ `revision_conflict`，记录不变；<br>（三）核对领取（TASK-03r）和“我来处理”同样两种先后：先 hold → 领取 `revision_conflict`（`expectedRevision` 不对），没有核对 Run；先领取 → hold `revision_conflict`（领取的同一提交写了 UCR-03，记录 revision 变了），你重新读到再点 → 照写（这时有进行中的一轮，领取了没进入），之后走 UR3h；<br>（四）release-hold 在 `activeRound` 不为空时 → `busy`（“核对轮还没收尾”） | L11、L21 |
| K3-44 | R4 | 重启找回（D4，M2）：<br>（一）卡上选了照原样重跑，② 落实、③ 没补记时，你直接点“我来处理”盖掉处置（`answerMessageRef: null`），然后重启：6b (c) 第 4 种交出目标，UR7b 按 `listUnappliedAnswers` 找到那个答复，② 重放、③ 补记成功；记录仍 `held`，没有接续；<br>（二）你在核对轮进行中点了“我来处理”，然后 Host 重启（核对轮干净中断）：2b 报告里有这份记录（`open = 'yes'`），6b (c) 第 2 种交出目标，`settle_review` 收尾这一轮（UCR-08b），没有开新一轮，任务仍停着；再重启零写入；<br>（三）**② 已提交、③ 补记失败，然后接续已经领取**（选定 Run 换成接续的 Run，这份记录成了历史、`open = 'no'`），再重启：6b (c) 第 4 种仍按那条答复自己的 `reviewRef` 交出目标；UR7b 不看选定 Run、不看任务资格、不看 `open`，② 重放出原回执，③ 补记成功；没有放开 `hold`、没有第二次接续 | L7、L28、L29 第 5b 行；M2 |
| K3-47 | R4（owner 层） | 从 R5 拿出来的断言（D11）：<br>（一）RUN-25 的提交经 `reconcileRun` owner：同一实例同一请求再做 → 原回执（`replayed: true`）；记录版本不对 → `revision_conflict`；<br>（二）记录读不出（`wrapRecords` 让这份记录的读失败）→ 普通领取回 `unavailable`，任务行 `unknownCallReview: { status: 'unreadable' }`，AV-2b 报 `unreadable`；<br>（三）核对轮释放租约以后，`requeueTask`（afterRun 是 R）真的提交成功，带它的 `requeueRef` 的领取（TASK-03、ATT-16）真的重新持有租约；<br>（四）核对领取（TASK-03r、ATT-16r）真的重新持有租约，P6 和 P4 各一例 | L7、L10、L11、L25 |

**R5 纯状态**

| 行 | 入口 | 行为 | 期望值来源 |
| --- | --- | --- | --- |
| K3-30 | R5 | RUN-25：从 `Entering`、`Running` 各一例，状态机给出的副作用逐条配对（Attempt、Outbox、Lease、Session、意图、记录），观察的 `reviewRef` 就是新记录；每条 WorkGraph 守卫（G10、G1、G3、G4、G5、G7、G9、G11）不成立时回落 RUN-20(i)，观察里的 `autoCleanupBlockedBy` 是 L25 先后里的第一条；G10：候选落到核对用途的 Run 上（防御）→ RUN-20(i)，`review_round`，没有记录；清单不完整的草稿 → `inventory_incomplete`。回执重放和 `revision_conflict` 在 owner 层（K3-47） | §3.1；L25 |
| K3-31 | R5 | UCR 表每一行（含 UCR-06b、UCR-08b、UCR-08c、UCR-15）；第 9 条轮次记录 → 构造函数 `invalid`（轮次上限用不满，L9）；`open` 在每一行之后都和 L7 的定义一致；“这次进入以来”按 `stateEntry` 数（UCR-06 对 UCR-07/08）；UCR-10 在空位不到 2 个或 `proposalTargets` 为空时 `invalid`；UCR-14 在 `activeRound` 不为空时 `busy`；表外迁移 `illegal`；定稿后改结论 `stale`；处置不改结论；UCR-15 替换已有处置时旧的留在事件里 | §3.2 |
| K3-32 | R5 | L23 表的 11 个例子（1、2、3、3b、3c、4–9），`priorAutoCleanup`、`priorUnknownProcess` 与表一致；特别是例 3、3b：你的处置之后再中断，`priorAutoCleanup` 为真 | L23 |
| K3-33 | R5 | FC-7b → `interrupted/executing`，`counted` 假；AV-2b、AV-4c 的位置（AV-4c 先于 AV-3）；`isGoalStopCause` 不收 `unknown_call_review`；选定 Run、`countEndedGoalRuns`、返工链都跳过核对轮；`pausedAutomationAction` 在记录没定、读不出、`held` 时回 `null`；`automationConfirmationCause` 在 `requeueConfirmedByReview` 时对 `system_requeue` 回 `null`；读到的记录是 `unreadable` 时 AV-2b 报 `unreadable`、领取的状态机拒绝（RecordStore 真的读失败的那一例在 owner 层，K3-47）；记录 `resolved`、原 Run 的围栏是人的 → AV-4（D9） | L7、L10、L11、L22、L26 |
| K3-34 | R5 | L3 的表：每一行一个名字；只读的平台工具不查回执；表外的名字是 `process` 且不跟着 Host 停；表和导出的常量（`BUILTIN_TOOL_NAMES`、`RESERVED_TOOL_NAMES`、`EXPLORATION_TOOL_NAMES` 和各协作工具文件的名字常量）对得上：授权名先按固定映射换成 Kernel 工具名（`write → edit`，`observed-model-run.ts:258`；其余不变）再比，所以 `BUILTIN_TOOL_NAMES` 的 `write` 对的是表里的 `edit`，不按字面一一比（D11）；租约的三种证明（HL-01、HL-03 带旧实例 ID 和 pid、内存）和没拿到租约时的 `null`；`memory_store` 的证明不放行 RUN-25（`no_takeover_proof`） | L2、L3 |
| K3-36 | R5 | `leaseReleasedForContinuation`：释放者是 afterRun → 真；释放者是 afterRun 的记录的一轮 → 真；释放者是别的 Run（另一个任务的核对轮、另一个 Run 的记录的一轮）→ 假。三处的状态机各一例：ATT-16 对这样释放的租约给出“重新持有”；TASK-03 的领取事实判断放行。`requeueTask` 真的提交、领取真的拿到租约在 owner 层（K3-47） | L10 |
| K3-38 | R5 | 核对领取（TASK-03r、RUN-01r、ATT-16r）的状态机：P6 和 P4（覆盖的 TaskRequeue 的 afterRun 是 R）各一例放行，任务投影不变、给出写 `activeRound` 的副作用；每条守卫不成立各一例：记录版本不对、状态和 phase 不配、`hold` 是 `held`、`activeRound` 不空、`rounds` 没有空位、选定 Run 不是 `record.runRef`、释放者不是 `afterRunRef`、`afterRunRef` 不是 R 也不是记录的一轮；普通领取（`first`、`requeue`）在记录没定时回 `busy`（`unknown_call_review_pending`）。真的取得租约在 owner 层（K3-47） | L10、L11 |

**B2 拦命令和请求重跑（K7-1、K8-1–K8-4、K8-7，L19a；入口用 R4 的 Work 场景和公开 owner，纯函数 B2-10 留在 R5）**

| 行 | 入口 | 行为 | 期望值来源 |
| --- | --- | --- | --- |
| B2-01 | R4 | `skip_as_done` 以后，照着 L19a 的例子表逐行（原命令 `cd app && npm run db:migrate`，`app/package.json` 里 `"db:migrate": "prisma migrate deploy"`）：“拦”的每一行（`npm run db:migrate`、`bash -c "cd app && npm run db:migrate"`、`FOO=1 npm run db:migrate 2>&1 \| tee log`、`npx prisma migrate deploy`、`prisma migrate deploy`、`./node_modules/.bin/prisma migrate deploy`、`npm run migrate:prod`）调用被拦：工具结果是写明命中动作和 `#<别名>@<runId 前 8 位>` 的固定话、没起沙箱、不建 scope；“不拦”的行（`cd app`、`git status`、`echo 'npm run db:migrate'`）照常跑；`npm run db:migrate -- --force` 不拦，由 B2-12 走注明改写。只差空白的写法也被拦；换了 cwd、文字相同的写法也被拦。另一个断言（K8-7 第 11 条）：② 保存 `blockedCommands` 时，全是无关的段或 `unparsed` 的命令只存整段规范化文字一项（`parseShellActions` 本身返回它找到的动作，可能为空） | L19a |
| B2-02 | R4 | 同意方案以后：已批准的方案命令（例如 `backup && migrate`）照跑、不用请求，即使里面含有被拦的动作；原命令被拦；另一个含有被拦动作、但不是那条已批准方案命令的写法（例如 `migrate` 的别的写法）照拦。方案命令的展开/动作也按 K8-1 认 | L19a |
| B2-03 | R4 | 请求 → 出一张卡；同一个别名（同一份核对记录）等答复时再请求（换写法也一样）→ 回同一个请求，没有第二张卡，工具文字写明等的是哪种写法；不是被拦的命令 → `not_blocked`，没有卡 | L19a |
| B2-04 | R4 | 允许 → 卡片上那一种写法下一次放行一次，再下一次又被拦；另一种写法照拦；允许在运行中的这一轮里也能用上 | L19a |
| B2-05 | R4 | 不允许 → 同一轮再问同一个别名（同一份核对记录，换写法也一样）`denied_in_this_run`、没有卡；下一轮带新原因再问同一别名 → 新卡 | L19a |
| B2-06 | R4 | 不允许，也别再问 → 这份核对记录里这个别名以后任何写法的请求 `denied_final`、没有卡 | L19a |
| B2-07 | R4 | 自治级别设成最高也照样出卡、要人答 | L19a |
| B2-08 | R4 | 任务取消 → 等答复的请求 `closed`、卡进历史；允许未用的作废 | L19a |
| B2-09 | R4/R5 | 重放：请求工具同一调用重放回原结果；落实同一个答复两次只落实一次（L19 的重放）；“已用”先提交、成功才放行：提交失败 → 这次照拦下、允许还在；提交以后、命令开始以前崩溃 → 允许已用、这次调用结果未知、进核对（两例，用 L29 的崩溃夹具） | L19a、L19、L29 |
| B2-10 | R5 | `parseShellActions`（纯函数，放单元测试文件，§6；只测它自己找到的动作，可能一个都没有，退回整段文字的规则在 B2-01）：引号（单、双、反斜杠转义）、各种分隔符（`&&`、`\|\|`、`;`、`\|`、`\|&`、单独的 `&`、换行）、`( … )`/`{ …; }` 递归；`bash -c`/`-lc`/`-ic` 三层按规则展开、第四层 `unparsed`；环境变量赋值和 `env`/`command`/`exec`/`time`/`nohup`/`nice`、`npx`/`npm exec --`/`pnpm exec`/`yarn exec`、`./node_modules/.bin/` 前缀剥掉；重定向连同目标去掉；无关的段（导航、输出、只读查看；带 `-exec`、`-delete` 的 `find` 不算）不当动作；`tool 'a b'` 和 `tool a b` 是不同的动作（`words` 比较键不同）；每一种 `unparsed` 的写法（引号不配对、here-doc、可执行位置的 `$(…)`、反引号、`eval`、`source`、`.`、进程替换、函数定义、`alias`、超 3 层）都回 `unparsed` | L19a |
| B2-11 | R4 | 脚本展开：`npm run X`、`npm run-script X`、`npm test`、`npm start`、`npm stop`、`npm restart`、`pnpm run X`、`yarn run X` 都按 `package.json` 的 `scripts.X` 展开；展开正文再解析，两层展开；`pre`、`post` 不展开；`pnpm X`、`yarn X` 不带 `run` 不展开；每个展开自己记 `basis`；`package.json` 在 ② 读不到 → 这一项 `basis` 是 `unavailable`、照样按解析出的动作拦；目录按 L19a 的规则（调用的 cwd，请求工具用 `.`，加上前面的静态 `cd`；`cd -`、`cd` 无参或非静态 → 不展开）；② 每条拦下的命令至多读 4 个不同的 `package.json`，钩子每次调用至多 2 个，超过不展开；读口 `maxBytes = 262144`，更大 → `unavailable`；钩子里读不到现在的 `package.json` → 不展开这次的命令，只按 (A) 和拦下命令的 `actions`/`expansions` 比 | L19a |
| B2-12 | R4 | 注明的改写：`rewriteOf` 正确（核对记录的 runId 或其唯一前 8 位 + 别名）、命令没被 (A)(B) 认出 → 当作那个别名被拦、出卡，这种写法随即被拦（`declaredForms` 里的 digest）；`rewriteOf` 的核对记录不属于这个任务、前缀不唯一、或别名不是那份记录里拦下的命令 → `invalid`；没认出也没给 `rewriteOf` → `not_blocked`，工具文字照 L19a；允许用掉、被拒或作废以后可以再请求别的写法 | L19a |
| B2-13 | R4 | 允许只放行卡上的写法：允许以后，`commandSha256(调用)` 相同的那一次 `shell` 放行一次；另一种写法照拦（即使解析出的动作相同）；再下一次又被拦 | L19a |
| B2-14 | R4 | 按别名（同一份核对记录）：等答复时换写法再请求 → 回同一个请求（不是注明的新写法时）；注明的未认出写法 → append 到 `declaredForms`、不出第二张卡；同一轮被否以后换写法 → `denied_in_this_run`；“别再问”以后这个别名的任何写法 → `denied_final`；已有 `allowed`（未用）再请求 → 回 `{ status: 'allowed', requestId }`、不写记录、不出卡 | L19a |
| B2-15 | R4 | 重放：钩子拦下的调用重放回原结果；`package.json` 改了也不变（不重新解析、不重读现在的 `package.json`）；卡片读请求记录里存的 `match`，不重新展开 | L19a |
| B2-16 | R4 | 钩子读取上界（决定 69，K8-7；公开的存储读口上套计数包装）：<br>（一）任务有拦下的命令时，每次 `shell` 调用：记录的状态重读一次 + 按 `k3-crr-by-task` 查 ⌈R/200⌉ 页（R = 该任务的请求记录数，查询自带记录）+ 至多 2 次读 `package.json`，一次都不多做（没有单独的 `readMany` 或批量读）；<br>（二）任务没有拦下的命令时：0 次额外读；<br>（三）R = 401 时恰好 3 页，读到的记录不重不漏 | L19a |
| B2-17 | R4 | ② 落实的读取上界：读原命令的 Kernel 记录（第七稿已有）+ 每条拦下的命令至多 4 个不同的 `package.json`（同一目录只读一次）+ 该写的记录；超出上限的展开不读、不展开 | L19a |
| B2-18 | R4 | 请求工具的读取上界：每次 `request_command_rerun` 调用按任务查 ⌈R/200⌉ 页 + 写 CRR 一次（`requested` 走 CRR-01，注明的新写法走 CRR-07）；`not_blocked`、`pending`、`allowed`、`refused` 分支不写 | L19a |

### 5.3 要改断言的旧测试（lead 写出前后断言并冻结，DSH 不自行翻转）

| 测试 | 怎么改 |
| --- | --- |
| `tests/runtime/A2-reconcile-runtime.test.ts` “W-13 then W-15”（第 230 行；A8-3e 在这里，不在场景文件） | **不翻转。** 这一例直接调 `reconcileRunAtStartup(classifier, ctx, { record, hostInstanceId, probe })`：入参没有 `takeover`，手写的分类器依赖（`restartedHost`，第 95–98 行）也没有 K3 新加的依赖；在途的工具是 `a2-runtime-in-flight`（表外）；工作区不是 git。按 L25 的先后，分类器先看用途（G10：这个 Run 没有 `purpose`，是普通工作，过），再查 G1，入参没有证明，就停在这里。加一条断言：第一次重启的报告 `toMatchObject({ row: 'W-13', status: 'reconciled', reason: 'unknown', autoCleanup: { applied: false, blockedBy: 'no_takeover_proof' } })`。其余断言一字不改；它继续锁住“RUN-25 不适用时的迟到证据”（审查第 15 条） |
| 同文件 “RUN-21 in process”（第 292 行） | **不翻转**：进程内基础是 `live_clean`，分类器在 K3 的守卫之前就只认迟到证据 |
| `tests/scenarios/A8-host-restart.test.ts` A8-3j（第 220 行，W-18 按 W-13 处理） | **不翻转：** 场景框架的工作区不是 git 仓库，报告行仍是 `W-13`、`unknown`（`toMatchObject` 不受新字段影响）。它是 K3-01 的“不是 git”对照，K3-01 用 git 工作区重做同一个故障点 |
| 同文件 “W-14 and RUN-22”（A8-3f，第 621 行） | **不翻转：** Kernel 存储不在，照旧 RUN-20(ii)，认定照旧提交。加断言：认定的同一提交建了记录，`toMatchObject({ inventory: 'incomplete', inventoryProblem: 'kernel_unreadable', status: 'needs_decision', decisionReasons: ['inventory_incomplete'] })`（经 `unknown-call-reviews/read` 读，不读数据库）。最后的“再启动零写入”照旧成立（第 2b 步只读，`needs_decision` 没有答复时不进 6b） |
| 同文件 “W-14 then W-07, W-15 and RUN-22 on a readable Kernel”（A8-3g，第 677 行） | **不翻转，加的断言和第三版不同：** 第 2 个 Host 时 Kernel 不在，这个 Run 走过 RUN-20(ii)；第 4 个 Host 认定时 Kernel 读得到、Turn 暂停着、没有结果未知的调用，但按 L8 停下时没读到证据，所以 `toMatchObject({ inventory: 'incomplete', inventoryProblem: 'kernel_unreadable_at_stop', status: 'needs_decision', decisionReasons: ['inventory_incomplete'] })`。最后的 `expectQuietRestart` 照旧成立 |
| `tests/scenarios/A8-host-restart-attestation.test.ts` “RUN-22 (LA-8)”（第 51 行） | **改输入，断言不变。** 这一例在第 76 行直接调 owner 的 `resolveUnknownRun`，K3 以后要带 `review`。三次调用的草稿逐个写死：<br>- 第一次 `attest(reason, true, null)`：`{ inventory: 'incomplete', inventoryProblem: 'kernel_unreadable', items: [], itemsOmitted: 0, workspace: { status: 'unavailable', runBaselineKnown: false, reason: 'not_configured', detail: 'a8-attestation-owner' } }`，期望 `committed`；<br>- 第二次 `attest(reason, false, true)`：草稿换成 `{ inventory: 'complete', inventoryProblem: null, items: [], itemsOmitted: 0, workspace: 同上 }`。owner 先查回执（L8），同身份同指纹 → 原回执 `replayed: true`，不校验这份草稿（校验的话它会因为“走过 RUN-20(ii) 却完整”被拒）；<br>- 第三次 `attest('another reason', true, null)`：草稿同第一次 → `idempotency_conflict`，同样在校验之前。<br>`ledgerEvents` 不变、`readExecution` 相等的断言一字不改。同文件的 QRR-06（Query）不改：K3 只做 Work |
| `tests/scenarios/A8-host-restart-entry.test.ts` A8-2b 两例（第 182、273 行） | **不翻转，各加一条断言：** 第一例这个 Run 从 Entering 走过 RUN-20(ii)（W-06），认定时 Kernel 读得到、没有它的 Turn。第三版写“完整、空、`resolved`”，按 L8 改成 `toMatchObject({ inventory: 'incomplete', inventoryProblem: 'kernel_unreadable_at_stop', status: 'needs_decision' })`；任务行照旧 `failed/run_failed`；`expectQuietHarnessRestart` 照旧（没有答复的卡不进 6b）；同一请求重放、换理由 `idempotency_conflict` 照旧。第二例 Kernel 读不了 → `inventoryProblem: 'kernel_unreadable'`、`needs_decision` |
| `tests/business/S1-archive-flow.test.ts` IT26（第 586 行起） | **改输入：** 直接调 owner 的 `resolveUnknownRun` 要带 `review` 草稿（L8）。这一例的 Run 由 `markRunOutcomeUnknown` 走 RUN-20(ii)，认定时 `inputsConfirmed: null`：给 `{ inventory: 'incomplete', inventoryProblem: 'kernel_unreadable', items: [], itemsOmitted: 0, workspace: { status: 'unavailable', runBaselineKnown: false, reason: 'not_configured', detail: 'IT26' } }`。之后的归档、锚点、带归档来历的人的重排（L11 照收）断言一字不改 |
| `tests/helpers/WP1-handover-fixture.ts` `attestedStop`（第 368 行） | **改输入，第三版的改法不成立。** 这个 Run 由 `unknownWork`（`S1-workflow-archive-fixture.ts:896`）走 RUN-20(ii)，按 L8 认定的记录一定不完整，不能写成“完整、空、`resolved`”。改成：<br>- 认定带 `{ inventory: 'incomplete', inventoryProblem: 'kernel_unreadable', items: [], itemsOmitted: 0, workspace: { status: 'unavailable', runBaselineKnown: false, reason: 'not_configured', detail: 'WP1' } }`（`inputsConfirmed: null` 照今天）→ 记录 `needs_decision`；<br>- 然后夹具以人的身份调 `holdReview`（直接点“我来处理”）和 `releaseHold`（“继续”）→ 记录 `resolved`、`hold: 'released'`；<br>- 之后的人工重排（`f.requeue()`）、领取、交接和今天一样。<br>这个夹具锁的是交接，不是核对。用它的 HO 测试由 lead 逐个核对：断言接续说明全文或卡片计数的，会多出核对记录一节，lead 写出改后的断言；其余一字不改 |
| `tests/helpers/WP2-notices-fixture.ts` `workUnavailable(attest = true)`（第 230–240 行；第 236 行直接调 owner 的 `resolveUnknownRun`） | **改输入（D10）。** `attest = true` 时先以探测 `missing` 走 RUN-20(ii)（`cause: 'kernel_unreadable'`），再以 `inputsConfirmed: null` 认定。K3 以后 `review` 必填，草稿写死：`{ inventory: 'incomplete', inventoryProblem: 'kernel_unreadable', items: [], itemsOmitted: 0, workspace: { status: 'unavailable', runBaselineKnown: false, reason: 'not_configured', detail: 'WP2' } }`（同 IT26 的写法）→ 记录 `needs_decision`、原因 `inventory_incomplete`。**受影响的通知断言：没有。** lead 核过 bb924854：这个夹具只有 `tests/work-graph/WP2-undelivered-notices.test.ts` 在用，那里只在第 837 行调 `workUnavailable()`（`attest = false`，走 `interrupted_clean`），没有测试用 `attest = true`；而且 K3 不加新的“请知悉”（L24），核对卡在决定队列的卡那一栏，不在通知里。加草稿只为类型检查和以后的调用；`attest = false` 那一支一字不改 |
| `tests/composition/WP2-wiring.test.ts` F10（第 1979 行起；第 2046–2048 行经 Host 的 `f.platform.resolveUnknownRun` 认定） | **不改输入，不翻转（D10）。** 这一例走组合里的 Host 认定入口，K3 的入口自己读调用、查回执、采集工作区，拼好草稿交给 owner（L8），测试不用给草稿，新记录经组合进来。Run 由 `reconcileRun` 以探测 `missing` 走 W-14（RUN-20(ii)），认定时 Kernel 读得到，所以记录是 `incomplete`、`kernel_unreadable_at_stop`、`needs_decision`（工作区不是 git，采集 `not_git`）。现有断言逐条核过：认定的同一提交里有 Session 的变化只有一次（`healthCommits` 长度 1，记录和它同一提交）；`readNotices` 只读 `notices` 一栏的 `undelivered_reply`（第 2014–2019 行），核对卡不在里面，长度仍是 1、位置仍是认定那次提交、文字仍含“未送达回复”；重开以后同样。**预期没有断言要改。** 可以加一条（lead 冻结时定）：经 `unknown-call-reviews/read` 读到 `toMatchObject({ inventory: 'incomplete', inventoryProblem: 'kernel_unreadable_at_stop', status: 'needs_decision', decisionReasons: ['inventory_incomplete'] })` |
| `tests/composition/platform.test.ts` 第 56 行 | 平台对象的键清单加 `unknownCallReviews` |
| `tests/state/invariants.ts`、`tests/scenarios/support/` 的不变量检查、S1 夹具的 `world` | 认识新聚合 `UnknownCallReview`，加 `checkI23UnknownCallReview`（§3.2 的 I-23；I-17 不动）；lead 写出 |
| `tests/app/A2-host-instance-lease.test.ts` | **不翻转**（都是 `toMatchObject`，HL-03 的 `reason` 原文不变）；`takeover` 的断言在 K3-34 |
| `tests/app/A2-runtime-capabilities.test.ts` | **不翻转**：旧短语都还在；L27 新加的那句由 K3 的新断言锁 |
| `tests/scenarios/support/fuzz.ts` | **不翻转**：认定后任务可能停在“请你决定”，fuzz 只断言不变量；lead 跑一遍确认 |
| K 片合入后的新测试 KA-09 的第三种情况、KA-14 | K 合入后 lead 核对：凡是“人认定以后直接接续”的例子，认定的 Turn 里有跑程序的调用时，接续之前多一轮核对（按 K3-26 改写）；没有时只多接续说明里的一节核对记录；认定的 Run 走过 RUN-20(ii) 的，多一张 `inventory_incomplete` 的卡 |

### 5.4 bwrap 的限制

K3-07 要真实的 bubblewrap 和真的进程死亡，DSH 的沙箱里没有 bwrap。DSH 照样按 TDD 写；能在沙箱里先跑的部分用替身做通。K3-07 由 lead 在有 bwrap 的 WSL 里跑并验收。

## 6. 文件（影响面；施工时以实际为准，超出要报）

- **契约：**
  - 新 `src/contracts/unknown-call-review.ts`（含 `WorkspaceBaselineV1`、`WorkspaceChangeCaptureV1`）；
  - `src/contracts/dispatch.ts`（`purpose`、`takeover_unresolved`、`unresolved.autoCleanupBlockedBy`）；
  - `src/contracts/core/prepared-execution.ts`（`workspaceBaseline` 的引用、`unknownCallReview` 的别名和 `display`、B2 的拦截带的 `blockedCommands`（决定 57，L19a））；
  - `src/contracts/continuation-brief.ts`（新一节、渲染的第二个必需部分（只用别名）、导出 `approvedMethodLinesZh`、没有异常锚点一节时也走必需部分那条路、校验；L19a：必需部分之后、固定结尾之前按每条拦下的命令加一行固定的话，没有拦下的命令时整段不出现、说明逐字节不变）；
  - 新 `src/contracts/command-rerun-request.ts`（`CommandRerunRequestV1`、状态、三个索引，L19a）；`src/contracts/goal-decisions.ts`（来源种类、身份（含 `command_rerun_request`）、`decisionSourceKey`）；
  - `src/contracts/task-failure.ts`（停止原因、细节字段 `reviewStatus`、`reviewHold`，失败事实的 `unknownCallReview`）。
- **state：**
  - 新 `state/unknown-call-review.ts`（UCR 表、`lastHolderOf`、M3 的按序列化大小准入）、`state/unknown-call-kinds.ts`（L3 的表）、`state/review-lease.ts`（`leaseReleasedForContinuation`、M1 的 `isUnenteredReviewRoundForCancellation`）、新 `state/command-rerun-request.ts`（CRR 表，L19a）、新 `state/command-normalization.ts`（空白规范化、sha256 和静态解析 `parseShellActions` 的纯函数，L19a；解析器自己写，不新增 npm 依赖）；
  - `run-machine.ts`（RUN-25、RUN-22 的记录副作用、`claimBasisProblem` 的 `review` 分支、`purpose` 的进入守卫、RUN-20 的 `autoCleanupBlockedBy`）；
  - `task-machine.ts`（TASK-03r：`review` 依据放行 P6、P4，投影不变；`taskClaimProblem`、`onTaskClaimed`）；
  - `attempt-machine.ts`（`AttemptClaimBasis` 加 `review`；ATT-16 改用共用判断；ATT-16r）；
  - `task-failure.ts`（FC-7b、AV-2b、AV-4c、连续的算法、选定 Run 和计数跳过核对轮、`runErrorOf`、`interruptionFacts`）；
  - `goal-machine.ts`（`isGoalStopCause`）；`session-availability.ts`（SES-06 的来源）；
  - `decision-policy.ts`（`requeueConfirmedByReview`、`pausedAutomationAction` 的两条）。
- **WorkGraph：**
  - `tasks/`：新 `unknown-call-review-service.ts`（含 `holdReview` 的租约和选定 Run 守卫、`releaseHold` 的 `activeRound` 检查、`listUnappliedAnswers`、M3 的准入和创建预算截条目（`too_large`）、定稿时读准备清单取 `display`）、`unknown-call-review-codecs.ts`（`open`、`stateEntry`、两组作用对象、`too_large`）、新 `command-rerun-request-service.ts`（CRR 表，按 (任务, 核对记录, 别名) 查重、`denied` 和 `denied_final`、允许未用、`declaredForms`（CRR-07），任务结束时把未完的记 `closed`，L19a）、`command-rerun-request-codecs.ts`；`run-reconcile-service.ts`、`run-reconcile-contracts.ts`（先查回执再校验草稿；G10；G11 不挡 `too_large`）；`claim-service.ts`（核对领取、普通领取的门、每次领取对记录的读守卫、`requeueClaimFacts` 改用共用判断）；`requeue-service.ts`（门、`held` 时人的重排、租约检查改用共用判断）；`execution-entry-service.ts`（RUN-02 对核对轮再核对记录（含 `hold`）和核对说明的钉；`readManifestFromEnvelope` 给定稿用）；`plan-readers.ts`（选定 Run、`TaskRow.unknownCallReview`、失败事实）；`goal-decision-reader.ts`（`automationCauses` 用共用规则）；`reconcile-reads.ts`（第 2b 步按 `open` 的分页列出；M2：6b (c) 第 4 种按答复的 `reviewRef` 找出没补记的答复）；
  - `model/`：新 `unknown-call-review-contracts.ts`、新 `command-rerun-request-contracts.ts`（读口和 owner，L19a）；`execution-entry-contracts.ts`（`HostInstanceFacts.takeover`）；
  - `sessions/message-record-codecs.ts`：新常量 `K3_SESSION_MESSAGE_LOOKUP_INDEXES`（索引 `k3-decision-answer-by-source-goal`），接进 SessionMessage codec 的 `lookups`（D4）；第 5 片的常量不动；
  - `communication/`：`decision-application.ts`（白名单）、`decision-service.ts`（这种来源只收卡上有的选项；`record_decision_application` 的 `lookupToolCommit` 用 `applicationIdentity`）、`decision-source-facts.ts`（来源核对，选项按两组作用对象和空位定）、`mailbox-service.ts`（`lookupToolCommit`）；
  - `tasks/plan-service.ts`（或 whiteboard 的 owner）的 `lookupToolCommit`；
  - `evidence/evidence-service.ts`（`openVerification` 对核对用途的 Run 回 `illegal`）；
  - `views/`：`decision-read-model.ts`（注入来源、单张卡）、新的卡来源适配文件（`unknown_call_review` 的 `pageLimit`，和 `command_rerun_request` 的卡来源适配，L19a）。
- **AgentRuntime：** `run-reconcile.ts`（分类器、先看用途、先后、候选、第 5b 行、`readAttestationFacts` 读调用；G11 只挡前几种、`too_large` 走创建截断）；`execution-preparation.ts`（开始基准的 Artifact（带 `present`/`deleted` 标签）、核对轮的工具和写范围、`sessionBasis`、核对说明量整份清单再从后往前收；把 `blockedCommands` 随绑定带进准备清单（决定 57，L19a））；`context-assembler.ts`（核对说明一段）；`continuation-brief-assembly.ts`（核对记录一节、diff 的大小）；`execution-driver.ts`（核对工具的注册、核对轮只建 `controlInputs` 的输入通道、导出 `BUILTIN_TOOL_NAMES`、`RESERVED_TOOL_NAMES`；`shell` 的接缝：装 `before_tool` 钩子按 `blockedCommands` 拦下、回固定的工具结果（决定 57，L19a））；`execution-inputs.ts`（只有控制输入的通道）；`observed-model-run.ts`（核对工具的注册、导出 `EXPLORATION_TOOL_NAMES`）；新 `unknown-call-review-tools.ts`、新 `command-rerun-tools.ts`（`request_command_rerun`，L19a）；`communication-tools.ts`、`whiteboard-tools.ts`（参数 → owner 请求抽成纯函数）；`ports.ts`、`runtime.ts`（`turnClosureSupport`、`reviewCapability`）。
- **WorkspaceTools：** 新 `src/core/workspace/workspace-change-capture.ts`（新的遍历，基准的 `deleted` 标签和分类顺序，L5）。
- **Workflow：** `workflow.ts`（UR 表含 UR3h（用 `isUnenteredReviewRoundForCancellation`，M1）、新 UR7b（按答复的 `reviewRef`，M2）、`performStep` 的 `start`/`observe` 对核对轮、`gatePerform`、`automationConfirmation`、最近持有者的 Session 选择和 `close_open_turn`、`claimRequeued`）、`session-maintenance.ts`（L27：维护也关 RUN-25 和核对用途的线；L30a：`refused('handed_over')` 之后重读事实、按普通维护再走一遍）、`contracts.ts`（`cancel_review_round`）、`decision-actions.ts`（第二步、第三步拿回执）、`ports.ts`。
- **Host 和组合：** `src/app/host-instance-lease.ts`、`src/app/startup-reconcile.ts`（证明传给分类器、`ReconcileLine.autoCleanup`、第 2b 步按 `open`、6b(c) 的四种（M2：第 4 种按答复的 `reviewRef`，不看选定 Run）、报告）、`src/app/host.ts`、`src/app/core-routes.ts`、`src/app/core-http-types.ts`（`unknown-call-reviews/hold`、`release-hold`（原 Run 是人停下的，再调人的重排，D9）、`read`、`list`）、`src/composition/create-platform.ts`（证明、认定入口、能力上报、路由绑定、Workflow 的 `controls` 接给 `cancel_review_round`）。
- **测试：** 新测试由 DSH 写；纯函数的用例另放一个单元测试文件（新 `tests/state/command-normalization.test.ts`，覆盖 B2-10；解析器不调模型、不读工作区）；旧测试按 §5.3（含 `tests/helpers/WP2-notices-fixture.ts`，D10）；§5.1 的夹具接缝由 Codex 写。状态写入检查和生产可达检查（`tests/architecture/`）的配置由 lead 改。
- **文档（lead 验收后）：** STATE-MACHINES-SPEC（RUN-25、TASK-03r、RUN-01r、ATT-16r、ATT-16 和 TASK-03 的改动、SES-06、UCR、CRR、AV、FC、I-23、§12.2 的 W-26）、DESIGN §4.3（资源上限的指向改到资源上限片；原写“可行性见 K3 规格 §5”）、MODEL、DIAGRAMS、能力索引、STATUS。

- **资源上限片（K7-3b，改它的文件）：** `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts`（放行以前被取消时停掉自己建的单元，停不掉只记一行日志；经 `scripts/build-kernel-patch.mjs` 重新生成 `vendor/coding-agent/dist`，不手改生成物）；测试在资源上限片的 RE1（`slice-RL-SPEC.md` §5 的 RL-10c 场景加断言），由 lead 在有 systemd 用户会话的环境跑（K3-49）。

## 7. 施工

- 前置已经满足：K 片 A 部分、2A、2B、2C、资源上限片、4A 都已合入（753bf5ab）。B2 用户已定（决定 57，§1 B 组、L19a），机制见 L19a；本稿收尾后等用户定要不要做一次只看改动的 Codex 核对，然后冻结（决定 56）。
- 分四组，各开新的 DSH Session（决定 46），按上下文分，可以开子任务，说明书写“子任务没回报完之前不要结束回合”，只在 18:00 以后跑：
  1. 契约、state、R5（K3-30..K3-34、K3-36、K3-38；M3 的构造函数准入和 `too_large` 类型）；
  2. 租约证明、开始基准和采集、分类器、RUN-25、认定入口，R1 的收尾部分和 R3（K3-01..K3-04、K3-21..K3-24、K3-26 的（七）（八）（九）、K3-35 的（四）、K3-39、K3-40、K3-47 的（一）、K3-48 的（一）（创建按预算截条目））；
  3. 核对记录的 owner、工具、核对轮、定稿，R2 的前半（K3-05、K3-06、K3-10..K3-14、K3-19、K3-35 的（一）、K3-37、K3-42、K3-45、K3-48 的（二）（可选文字 `capacity`））；
  4. 卡、处置、方案、“我来处理”、Workflow 的门和恢复、启动第 2b 步，R2 后半和 R4（K3-08、K3-09、K3-15..K3-18、K3-20、K3-35 的（二）（三）、K3-25..K3-29、K3-41、K3-43、K3-44、K3-46、K3-47 的（二）..（四）、K3-48 的（三）（必须写的仍放得下）；M1 的 K3-15（七）、M2 的 K3-44（三）；L19a 的请求工具、`command_rerun_request` 卡来源、答复落实和 CRR 的 `closed`，以及 `shell` 的 `before_tool` 接缝（B2-01..B2-15）；其中 CRR 的契约、state 模块、`blockedCommands` 字段、`command-normalization.ts`（含 `parseShellActions`）和它的单元测试文件并入第 1 组）。
- §5.1 的夹具接缝（替身 `shell`、只读命令可用、存储读失败一次、git 工作区、多个任务的记录、两种先后的竞争、先删的文件、长命令和长标识、人停下的原 Run）和崩溃点的夹具由 Codex 写，lead 核对后冻结；§5.3 的旧测试改动由 lead 写出前后断言并冻结。
- 每组派一个只读复查子任务；之后 lead 核对、Codex 审；在有 bwrap 的环境跑全量，lead 跑 K3-07；最后合入，由 Codex 推成远端新分支。

## 8. 不做的事

- 不撤销、不回滚工作区的改动；
- 不替模型判断改文件的结果；
- 不改 Host 活着时的结果未知（RUN-08）；
- 不改 Query 的恢复；
- 不让 Kernel 已经终结、但有调用没结果的 Turn 自动收尾；
- 不把核对轮的结果未知再交给核对，也不自动收尾带没结果调用的核对轮（等人认定，D1）；
- **按 B2 用户已定的（决定 57、68，L19a）：** 平台拦下原命令（处置是跳过的不许重跑，同意方案的不跑原命令）；要再调这条命令，agent 必须给人类一个原因、人类必须知道并允许；机制见 L19a。平台按命令文字和静态解析认出常见的改写，认不出的改写 agent 要用 `rewriteOf` 注明以后再请求；
- **这一片不做模型判断（决定 68）。** 留给以后：先按真实使用看要不要加，等第 9 片有真实使用的数据再定。它的用处是替人少看卡（先筛掉明显不是重跑的请求，或者在卡上附一句判断），只能让平台多拦或少出卡，不能放行静态规则拦下的命令（L19a 末句）；
- 不把 512 KiB 当“每个字段各自有上限就自然成立”的保证：写入按序列化后的实际字节准入（L7，M3）；
- 不给核对轮加读 Kernel 历史的工具（D6）；
- 不给 K3 之前认定的 Run 补建记录；
- 不改 GoalPhase 的归约，不加新的“请知悉”类别；
- 不调大接续说明的 `renderedBytes`；
- 不做资源上限（单独一片，L31）；
- 界面不在本片（E3）：读口、卡的对象和“我来处理”“继续”的路由已经给全；
- 不调用真实模型。

## 9. 审查意见的对照

### 9.1 第二版审查 19 条

| # | 级别 | 处理 |
| --- | --- | --- |
| 1 | S | §0 三处更正今天代码的描述（接续说明已逐个列出、没有“写注记”、`edit` 一个工具、跟着 Host 停的前提）；L3 写死分类表和先后，只读平台工具不查回执 |
| 2 | M | L4：每个 owner 的 `lookupToolCommit`，身份和指纹用 owner 自己的算法；只有权威的没查到算“没做”，冲突、读失败、不支持都是“判断不了” |
| 3 | M | L2：带标签的证明，HL-03 保留旧实例 ID 和 pid，经组合传下去；写明跟着 Host 停的前提 |
| 4 | M | L1、L25、§3.1：来源状态、分类器先后（终态 Turn 从不 RUN-25）、守卫、控制意图、claim 代际、进入和位置、Attempt/Outbox、CAS、重放 |
| 5 | M | L5、L6：前提不分种类；开始基准、未跟踪、忽略、二进制、不稳定、截断、证据留存、`runBaselineKnown`、受保护路径 |
| 6 | M | L7–L9、§2、§3.2：聚合、键、codec、事件、读口、索引、上限、两种来历同一提交建、清单完整与否 |
| 7 | M | L10–L13：用途、拦截各入口、不顶替选定 Run 和来历、模型和预算、只读命令用不了时 |
| 8 | M | L12、L15、L28、L29：恢复表、启动第 2b 步、不递归、K 退路时记录跟着走 |
| 9 | M | L14：绑定这一轮、请求身份、先重放、同身份异内容拒绝、新调用可改、定稿后拒 |
| 10 | M | L18、L19：来源适配、键和 pins、可用性、旧版答复拒绝、只收选项、落实是 owner 的一步并进白名单 |
| 11 | M | L19–L21：观察和处置分开；方案要第二次同意并绑定原样命令；我来处理有持久的停 |
| 12 | M | L23：两个判断同一条来历、排除核对轮、重置点和 9 个例子 |
| 13 | M | L22：自治级别的读和复核、和普通确认卡不重复、计数和豁免 |
| 14 | M | L24：2A 的完整分页、稳定窗口、单张卡、沿用“自动恢复”通知 |
| 15 | S | §5.3：逐个测试写明；A8-3e 在 runtime 文件；A8-3f、A8-3g 不是 RUN-25 的情形 |
| 16–18 | M | 移出本片（L31），原文进 `resource-limits-notes.md` |
| 19 | S | 删去第二版 §5 里重新提问的三处；原文进 `resource-limits-notes.md` |

### 9.2 第三版复审 33 条（阻断 12 条、次要 21 条）

lead 逐条对照代码和来源核过（基线 c2c05597），33 条说的代码事实都成立，全部采纳；有几条在审查给的两种改法里选了一种，或换了做法，写在“处理”里。

| # | 级别 | 问题（简） | 处理 |
| --- | --- | --- | --- |
| 1 | 阻断 | 今天的行接不住核对领取（P6 不可领取、依据算成 `first`、租约拒绝、投影写成 P2） | 采纳。L10 加第四种领取依据 `review`；§3.1 TASK-03r、RUN-01r、ATT-16r；去掉“RUN-01..RUN-07、ATT、SES 各行不改”；投影不变。比审查多放行一种投影：P4（人的重排先到了，L11 照收），只对 `review` 依据。K3-38 |
| 2 | 阻断 | 核对轮释放租约以后，从 R 的接续在三处被拒 | 采纳。共用纯函数 `leaseReleasedForContinuation`（`state/review-lease.ts`），`requeueTask`、`requeueClaimFacts`、ATT-16 都用；K3-36 |
| 3 | 阻断 | 核对轮没有 Kernel 终态地结束后，用 R 去关会永远“可以重试”；退路 Session 里 K L4 第 1 条不成立 | 采纳。L12 “最近持有者” `lastHolderOf`：选 Session 的起点和 `close_open_turn` 的 `afterRunRef` 都用它，之后的接续也用；L27 扩 K L4 第 2 条：核对用途的 Run 只要结束方式已知、已不是 `activeRound`，不要 TaskRequeue（含 RUN-23、RUN-24，审查只点了 RUN-19、RUN-25 变体、RUN-22，前两种 K 本来就放行）；K3-09、K3-29（二）（三）（第五版按 D1 去掉了 RUN-25 的核对轮变体，见 §9.3） |
| 4 | 阻断 | 核对轮正常结束会走 `openChecksAfterRun` 给自己开检查轮次 | 采纳。L10、§3.4：`start`、`observe` 拿到核对用途的 Run 下一步就是 `settle_review`；检查的 owner 对它回 `illegal`；K3-05 |
| 5 | 阻断 | 核对轮领取了没进入时没人重驱 | 采纳。UR3a 对 `activeRound.runRef` 做 `prepare`、`start`；L28 6b(c) 写明；L29 第 2 行；K3-29（一） |
| 6 | 阻断 | 基准、核对说明、采集全文会超过 256 KiB，`prepare` 回 `capacity` | 采纳。基准改成单独的 Artifact，清单里只放引用；`prepare` 从不因基准失败；核对说明每条 ≤4 KiB、整段 ≤64 KiB；采集全文 ≤256 KiB、超了 `too_many_changes`；K3-35 |
| 7 | 阻断 | 接续说明只有 16,384 字节，diff 和“不截的方案”放不下，会每次都 `capacity` | 采纳，选“在界内”，不调大 `renderedBytes`：diff 每条 ≤2,000 单位、整节 ≤8 KiB，是普通正文；方案在写的时候挡住（每条 ≤4,000 字节，合计 ≤8,192），接续说明里作第二个必需部分原样放；拒绝码是 `capacity`；放得下的估算写在 L20，K3-35 验证（第五版按 D8 改成按接续说明的写法量、合计 5,120 字节，见 §9.3） |
| 8 | 阻断 | 替身 `shell` 造不出来（重名抛错、没有接缝、没有 bwrap） | 采纳。§5.1 的接缝：`vi.mock` 换 `tools/builtin/shell/shell-tool.js` 的 `createShellToolDefinition`（两个组合根都直接从这里引，不经 `public-api.js`）；只读命令用 K KE6 的能力探测替身；`HostScenario.start` 的存储包装；git 工作区；多个任务的记录 |
| 9 | 阻断 | 你暂停或取消核对轮，会被当成“没做完”自动再开 | 采纳。L15 按这一轮自己的围栏分：`human_only` → 定稿、原因 `review_stopped`、出卡（UCR-06b）；目标暂停时遇上重启的照“没做完”，目标恢复后才开；K3-37 |
| 10 | 次要 | I-17、W-25 已被占用 | 采纳。改成 I-23、W-26，§3.2、L25、§5.3、§6 一并改 |
| 11 | 次要 | `record_decision_application` 的“已知局限”说错了 | 采纳。L4 用 `applicationIdentity`（发信方从来历取），删去那一段 |
| 12 | 次要 | A2 的新断言没被规格定下；A8-attestation 漏列 | 采纳。L25 固定先后、报第一条不成立的，分类器先查 G1，新依赖都可选；§5.3 写明 A2 那一例为什么是 `no_takeover_proof`；A8-host-restart-attestation 加进 §5.3，三次的草稿逐个写死；L8 写明先查回执再校验草稿 |
| 13 | 次要 | `head_mismatch` 造不出来 | 采纳。K3-21 去掉，L25 注明由代码审查核对（同 K） |
| 14 | 次要 | `autoCleanup` 到不了 Host 报告 | 采纳。`ReconcileLine` 加 `autoCleanup`，第 2 步一并抄过去（L25、§2） |
| 15 | 次要 | 清单不完整没有守卫，Run 会卡在 `Running` | 采纳。G11（`inventory_incomplete`），走 RUN-20(i)，认定时得到不完整的记录 |
| 16 | 次要 | “读窗口超出页数上限”产不出不完整的记录 | 采纳。从不完整的列表里去掉，写明它仍是被拒的认定（SD-2） |
| 17 | 次要 | 先后表漏了 K L1 的 `interrupted` | 采纳。第 5b 行，`left`、`kernel_closed_without_platform_end`；L1；K3-22 |
| 18 | 次要 | 第二次落实没有回执，③ 补记不了 | 采纳，做法和审查略不同：② 的身份由答复消息推出（和谁来落实无关），第二次就是正常的重放，拿到第一次的提交回执（identityKey、fingerprint、cursor、eventIds），不用再从事件里找；`resolveDecision` 和 UR7 都接着做 ③；② 落实以后状态已变、③ 还没补记的，由新的 UR7b 在任何状态下补做；L29 第 5、5b 行；K3-17 |
| 19 | 次要 | 点“继续”只多一条 TaskRequeue，什么都不跑 | 采纳，选“拒绝”：`held` 时不带归档来历的人的重排回 `busy`（`unknown_call_review_held`），release-hold 是唯一的“继续”；AV-4c 细节加 `reviewHold: true` 给界面接线；K3-15（三） |
| 20 | 次要 | §6 漏了文件；K3-34 引用的常量是模块私有的 | 采纳。§6 补上 `execution-entry-service.ts`、`task-machine.ts`、`attempt-machine.ts`、`session-maintenance.ts`、`reconcile-reads.ts`、`evidence-service.ts` 等；三组名字导出成常量（L3），K3-34 对导出的常量 |
| 21 | 次要 | 5,001 份记录要 5,001 个任务，没有夹具 | 采纳，选“小页数”：卡来源的 `pageLimit` 是构造参数，K3-20 用 5 份记录、`pageLimit: 2`；5,001 的规模由 2A 的夹具管 |
| 22 | 次要 | 采集不是今天的读法 | 采纳。L5 写明是新的遍历：受保护前缀不进、git 忽略的不进、特殊文件 `read_failed`；去掉“同一个读法” |
| 23 | 阻断 | 把你的处置当重置点，违反决定 52 的“连续只一次 / 连续第二次” | 采纳。L23 删去这个重置点，例 3 改写，加例 3b、3c；L27 能力上报那句现在成立；K3-32。这偏离了 lead 给第三版定的 L-STREAK 文字（“或自上次人的处置以来”），L23 写明；lead 要保留它就得交用户定 |
| 24 | 阻断 | “我来处理”只在卡上，做不到 §0 的“随时” | 采纳。`holdReview`（`unknown-call-reviews/hold`，只收人），UCR-15；`answerMessageRef` 可空、加 `source`；进行中的一轮照常跑完、结论照收（UCR-04、UCR-08b）；卡进历史；K3-15（四）（五） |
| 25 | 阻断 | 清单“完整”的定义会把没读到证据的 Run 记成“完整、空、resolved” | 采纳。L8：三条都满足才算完整；`kernel_unreadable_at_stop`、`turn_not_found` 一律不完整；不给“从没进入过”留例外（L8 写了理由）。§5.3 的 A8-2b 第一例按此改；A8-3g（审查没点名，同一个原因：它也走过 RUN-20(ii)）也改成不完整；WP1 夹具第三版的改法因此不成立，改成认定后直接点“我来处理”再放开；K3-26（五）（六） |
| 26 | 次要 | 核对轮变体比 §0 宽 | 采纳 (a)：保留变体，列进 §1 B 组第 1 条交用户；不同意就改成一律等认定（第五版按 lead 的 D1 改成一律等认定，变体去掉，见 §9.3） |
| 27 | 次要 | §1 的同步列表漏了几处 | 采纳。§1 重写成 A 组（更保守的）和 B 组（要用户点头的），逐条补上 |
| 28 | 次要 | 平台不拦截命令，§0 读起来像在强制 | 采纳。L19、L20、§8、规则 14、§1 B 组第 2 条（第五版：这一条是 §1 B 组的 B2，并给了退路 (b)，见 §9.3） |
| 29 | 次要 | `memory_store` 证明不了旧工具已停 | 采纳。G1 只认 `hl01_no_lock`、`hl03_stale_lock`；服务层在内存后端注入 `hl03` 证明；K3-34 |
| 30 | 次要 | 核对轮会吞掉 Session 的信件和回复 | 采纳。L13：核对轮和提方案的一轮只有 `controlInputs`；KR9；K3-08（二） |
| 31 | 次要 | 三处推导会多出一张普通确认卡 | 采纳。规则写进 `decision-policy.ts` 共用（`requeueConfirmedByReview`、`pausedAutomationAction` 的两条）；release-hold 也算确认；K3-18（四）（五） |
| 32 | 次要 | 读不出的记录和 K3 之前认定的 Run 会跳过核对 | 采纳。L7、L11 写 fail-closed，只有权威的 `not_found` 算没有记录；K3 之前认定的选“照今天接续”，列进 §1 A 组（L30）；K3-24（三）、K3-33 |
| 33 | 次要 | K3-10 只有 6 格；Host 一直活着的情形没有验收行 | 采纳。K3-10 写成 12 格并给出每格的原因；K3-24（二） |

### 9.3 Codex 第四稿审查怎么处理的

审查：`D:/cc-lead-notes/codex2/k3specrev2.out.md`（结论“不能冻结”：M 10 条、S 1 条，B1、B2 要给退路）。改法按 lead 的决定 `D:/cc-lead-notes/specs/k3/k3-v5-lead-decisions.md`（D1–D11、B2、N；方向是“简化，拿不准就取更保守的”），不重开。代码事实按 bb924854 核过；K 片 A 部分没合入，按 K 片规格的接口写。

| # | 级别 | 问题（简） | 决定 | 怎么改的，改在哪里 |
| --- | --- | --- | --- | --- |
| 1 | M | 核对轮的 RUN-25 变体过不了分类器（分类器先查 G11、G8，核对轮没有基准） | D1 | 去掉变体。分类器在 G1..G11 之前先看 Run 记录的 `purpose`，核对用途 → 不附候选，`blockedBy: 'review_round'`，走 RUN-20(i) 等认定；WorkGraph 的 G10 改成“用途是普通工作，否则 `review_round`”（防御），两边都最先查。没有没结果的调用的打断照今天 RUN-19/23/24。改在：§1 A 组（“也照今天等你认定的”最后一条）、B 组去掉第 1 条；L1、L2、L12、L15、L23 例 5、L25（先后表第 8 行、G10、先后、写什么）、L27 两行、L29 第 3 行；§2（`takeover_unresolved.reviewRef` 不再可空，`AutoCleanupCandidateV1.draft` 不再可空，分类器注释）；§3.1 RUN-25、RUN-20 两行；§3.4 UR5；规则 6；§8；K3-09（一）（二）、K3-21（核对用途的 Run 没基准、33 条也报 `review_round`）、K3-29（二）、K3-30（G10 防御） |
| 2 | M | UCR 表三处缺口：提方案时只读命令用不了；8 轮用完；两轮没做完但结论都有 | D2 | (a) UCR-08c：`awaiting_proposal` + 用不了 → `needs_decision`，`review_unavailable`、`proposal_missing`；UR2 两种状态都管；K3-19（二）。(b) `rounds` 最多 8 条，空位 = 8 − 条数；`safer_method` 只在至少 2 个空位时出现，否则三个选项、答它 `invalid`（L18、UCR-10）；要开一轮却没空位 → UCR-16 `rounds_exhausted`（UR2b，防御，L9 写明正常流程走不到，只由 R5 的 K3-31 覆盖；**第五版 lead 复审（2026-10-14）去掉了：`rounds_exhausted` 走不到，UCR-16、UR2b、第 5 种定稿触发和 K3-31 里只为它写的例子一并删除，L9 改写成一句“8 条轮次记录不会用满，构造函数照常校验上限，超了是坏记录（`invalid`）”**）；“没做完”按 `stateEntry` 每次进入从零数（L9、L15、UCR-06）；K3-45（三）（四）。(c) 第 2 轮没做完一定定稿，原因 `review_incomplete`，哪怕结论都有（L15、L16、UCR-07/08）；K3-45（一）（二）。新原因进 L17 的固定顺序（`review_stopped` 之后依次是 `review_incomplete`、`review_unavailable`；`rounds_exhausted` 已去掉），§2 的 `UnknownCallDecisionReasonV1` 同序；§1 A 组；规则 17 |
| 3 | M | 直接点“我来处理”和进行中的一轮不配；放开时可能有没定稿的一轮；领取和“我来处理”没有完整的竞争守卫 | D3 | 领取了没进入的一轮：UR3a 不开始它，新 UR3h 以 Workflow 自动化身份 `cancel`，按今天没进入就结束的那条路 RUN-09（U）结束（lead 核过：`run-machine.ts:1712–1780`，`control-service.ts:347`，先例 `session-archive.ts:373`；今天 RUN-02 拒绝后 Workflow 只回 `waiting`，`workflow.ts:1743`）；RUN-02 对 `held` 的核对轮也回 `stale`；在跑的跑完；结束的只收尾（UCR-08b）。`releaseHold` 要 `activeRound` 为空，否则 `busy`。守卫：每次领取对记录加读守卫（`claim-service.ts:1104–1124` 一处拼，键不存在时 `null`），“我来处理”守卫租约和选定 Run 的事实。改在：§1 A 组；L11、L21；§2（端口注释、`cancel_review_round`、领取依据注释）；§3.1（TASK-03r、TASK-01..03、RUN-02、RUN-09（U）行）；UCR-03、UCR-14、UCR-15；UR3h、UR3a；KR10；L29 第 12 行；规则 5；K3-15（四）（六）、K3-43 两种先后 |
| 4 | M | 重启找回漏了 `held` 而还有一轮没收尾的记录；③ 的补记只看当前处置，会被直接点的“我来处理”盖掉 | D4 | 记录加派生字段 `open`（L7），新索引 `k3-ucr-by-workspace-open` 替换 `k3-ucr-by-workspace-status`；第 2b 步、6b (c) 按 `open` 列（L28 的四种）。没补记的答复从决定模块那边找：lead 核过第 5 片只有按完整来源键的 `s5-decision-answer-by-source`（`message-record-codecs.ts:67`、`136–138`），查找不能按前缀，没有“已答、没落实”的列法；最小的补法是在 SessionMessage 同一个 codec 上加索引 `k3-decision-answer-by-source-goal`（不改第 5 片的契约和常量）和读口 `listUnappliedAnswers`（② 的身份用 `lookupCommit` 确认）。只补 ③，不放开、不接续。改在：L7、L28、L29 第 5b、10 行；§2；§3.2 末尾；UR7b；KR2；§6；K3-44（一）（二） |
| 5 | M | 开始基准记不下开始时已删的已跟踪文件 | D5 | 基准条目带标签 `present`（模式、blob）/ `deleted`；开始状态 = HEAD 树叠加：`present` 替换、`deleted` 去掉；写出分类顺序（`added`、`deleted`、`mode_changed`、`modified`）。改在：L5、L6；§2 `WorkspaceBaselineEntryV1`；§6；K3-40（一）..（五） |
| 6 | M | 截断的命令模型拿不到全文 | D6 | 不加新工具。核对说明里每条有 `display`（`full`、`truncated`、`unexpanded`），后两种旁边写明按判断不了处理；工具照收结论，定稿时读那一轮的准备清单（`readManifestFromEnvelope`，`execution-entry-service.ts:391`）改判 `undetermined`，固定依据，模型的结论放 `reviewerConclusion` 显示在卡上。**第五版 lead 复审（2026-10-14）补：崩溃自查也一律改成 `undetermined`（“命令没给全，自查同样没有依据。”），模型的结论和自查一起放 `reviewerConclusion`；L17 因此对这样的条目一定有 `crash_undetermined`；改在 L13、L16、L17、§2、K3-42、规则 16。**改在：§1 A 组；L13、L14、L16；§2（观察、核对说明、接续说明、工具注释）；UCR-04；规则 16；§8；K3-42（超过 4 KiB 的命令，以及 `unexpanded`） |
| 7 | M | 卡、工具、定稿对“稳妥跑法”的作用对象说法不一 | D7 | 两组：`dispositionTargets`（跑程序的 + 查不清的平台条目）、`proposalTargets`（其中跑程序的）。`safer_method` 只在 `proposalTargets` 不为空时出现；方案只给 `proposalTargets`，定稿只要求它们齐；同意以后平台条目在接续说明里照“结果查不清，重做前先核实”，卡上写明。改在：§1 A 组；L18、L20、L21；§2（记录的两个字段、接续说明的 `platformTargets`）；UCR-05、UCR-08、UCR-10；B2 的拦截对象（第六版已定为平台拦原命令，机制待 lead 写，见 §9.4）；K3-46（一）只有平台、（二）混合 |
| 8 | M | “同意的方案一定放得下”没证明；callId 没上限；清单要算两份 | D8 | 必需部分只用别名 `#1..#32`，完整 callId 只在可略去的正文行（L7、L20）；按 bb924854 的代码算出整份 16,384 字节的预算表（L20）：合计 6,562 + 8T + C，T 是每条锚点的任务 ID（契约不限长，留 512 字节），推出 C ≤ 5,726，取 **C = 5,120 字节**（按 `approvedMethodLinesZh` 排出来量，写方案时就量，取代原来的 8,192）。准备清单按真的 `JSON.stringify` 量，结构化的和渲染的两份都算，从后往前收展开，底线是别名加工具名，结构化的条目不带 callId（L13）。改在：L7、L13、L14、L20；§2（别名、`display`、`approvedMethodLinesZh`、`UNKNOWN_CALL_APPROVED_METHODS_MAX_BYTES`、工具入参改成别名）；UCR-05；规则 15；K3-16、K3-35（一）..（三）用 4,096 字节的 callId、512 和 600 字节的任务 ID、最坏的锚点（**第五版 lead 复审（2026-10-14）补：callId 限 512 字节，更长的那一条算 `undecodable_call`，记录里不存没有上限的 ID；K3-35 的 callId 因此改成 512 字节，K3-26（九）验 513 字节；改在 L7、L8、L13、L20、G11、§2**） |
| 9 | M | 答完核对卡放开不了原 Run 上人的暂停或取消 | D9 | 原 Run 的围栏是人的（`task-failure.ts:136–142`、`384–399`、`779–791`）：任何答复都不自动接着做，等今天的“继续”（人的 `tasks/requeue`，没有 `held` 就照收）；这种任务的 release-hold 就是“继续”：路由先 `releaseHold` 再以同一操作者重排，各自幂等，中间崩溃界面照样显示“继续”。计数照今天。改在：§1 A 组；L19、L21、L22；§3.1 `requeueTask` 行；§3.3 末尾；UR9；KR6、KR11；L29 第 13 行；规则 12；§2 路由注释；K3-41（一）..（三） |
| 10 | M | §5.3 漏了一个直接调 owner 的地方 | D10 | 加 `tests/helpers/WP2-notices-fixture.ts:236`（`workUnavailable(attest = true)`）：写死草稿 `kernel_unreadable`；lead 核过没有测试用 `attest = true`（`WP2-undelivered-notices.test.ts:810` 只调 `attest = false`），没有通知断言要改。加 `tests/composition/WP2-wiring.test.ts` F10（第 1979 行起，2046 行 Host 认定）：新记录经组合进来（`kernel_unreadable_at_stop`），逐条核过现有断言，预期不改，可加一条读记录的断言 |
| 11 | S | 有些断言放在拿不到它的入口里；K3-34 按字面比 `write` | D11 | R5 只留纯状态的断言；回执重放、RecordStore 读失败、真的取得租约、`requeueTask` 真的提交挪进新的 K3-47（R4 的 owner 层）；K3-34 先按 `write → edit`（`observed-model-run.ts:255`）换名再比（L3 写明，`execution-driver.ts:97`）；加不是信箱的 owner 的查找 K3-39、清单溢出和解不出的 owner 例子 K3-26（七）（八）和分类器例子（K3-21）。拆分写在 §5.1，交用户确认测试入口时一起看。改在：L3；§5.1；K3-21、K3-26、K3-30、K3-33、K3-34、K3-36、K3-38、K3-39、K3-47；§7 |
| B1 | M | 核对轮变体是决定 52 两条限制的例外，要用户点头，否则要给退路 | D1 | 不再问用户：按 lead 的决定直接取保守的一边（同第 1 行），§1 B 组第 1 条去掉，改成 A 组“也照今天等你认定的”最后一条告诉用户 |
| B2 | M | 平台不拦命令是对“跳过”“照方案跑”的弱解读，要用户点头，而且没有退路 | B2 | 当时仍问用户。§1 B 组写推荐 (a)（只靠接续说明，加“我来处理”）和理由（最坏再崩一次，“连续只一次”就停下等你；资源上限那一片会让这种崩溃少很多）；写出退路 (b)：接续那一轮装 `before_tool` 钩子，只挡规范化以后完全相同的原命令。lead 核过钩子能按 Run 装：`execution-driver.ts:766–783`、`918`，`observed-model-run.ts:116–129`、`152`、`259`、`295`，`composition-root.ts:135`，`control-hooks.ts:72`、`83–101`，`runtime-runner.js:591`（`hook_blocked`）。(b) 写到能施工：L19 的“退路 (b)”、§2 `blockedShellCommands`、L20 的替换句、§6、§8、规则 14、§7。**第六版（决定 57）已由用户定：平台拦下原命令，要再跑先请求并得到允许；(a)、(b) 两个分支都已去掉，机制待 lead 写（§9.4 的 M4）** |
| N | N | 基线描述过时 | N | 状态行改成第五版；头部的代码事实一条改成 bb924854（K 片 B 部分、接线包 2 已合入，K 片 A 部分在施工，2A 没合入）；施工前置同步（§7）；§9.2 里被这一版改掉的四行加了注 |

### 9.4 Codex 第五稿快速核对怎么处理的

审查：`D:/cc-lead-notes/codex2/k3specrev3.out.md`（结论“freeze after listed fixes”：M1–M4、S1）。lead 的决定见 `k3-v6-lead-decisions.md`，M1–M3、S1 采纳，M4 按用户回答（决定 57）改。代码事实按工作检出的 `src/business/workflow/workflow.ts` 核过。

| 项 | lead 的决定 | 怎么处理的，改在哪里 |
| --- | --- | --- |
| M1 | 采纳。UR3h 用自己的判断：核对轮 Run 证明从没进入（Claimed、Authorized、Revoked，**含 paused**）时可在进入前取消（RUN-09（U）），保留 Run revision 守卫；加一条验收序列 | 新增纯函数 `isUnenteredReviewRoundForCancellation`（§2，放 `state/review-lease.ts`；和 `isUnadmittedStarting` 的区别只在 `workflow.ts:899` 排除 `paused`）。UR3h 改用它并写明 paused（§3.4）；L21“领取了、还没进入”改写并写明提交钉 Run revision；L29 第 2 行加注；验收加 K3-15（七）（含 `revision_conflict` 一例）；§6、§7 同步 |
| M2 | 采纳。UR7b 由每条被发现的没补记答复的 `reviewRef` 驱动，与选定 Run、任务资格和记录的 `open` 无关；只补记账 | §3.4 的序言和 UR7b 改写；L28 的 6b (c) 第 4 种和“补的只是 ③ 的记账”写明按答复的 `reviewRef`；§2 `listUnappliedAnswers` 注释；L29 第 5b 行；验收加 K3-44（三）（② 已提交、③ 失败、接续已领取、重启后 ③ 补上）；§6 的 `reconcile-reads.ts`、`startup-reconcile.ts`、`workflow.ts` |
| M3 | 采纳。每次构造/更新按写后的序列化 UTF-8 大小准入；超过 512 KiB 回 `capacity`、不写；先留必须写的（定稿、批准、hold/release、处置）；可选模型文字只在 ≤ 512 KiB − 预留 R 时收；创建放不下按 Kernel 顺序截条目、清单记 `incomplete/too_large`；去掉 L20 的“512 KiB 仍成立” | §1 L7 新增准入和短表（**R = 349,152 字节，B = 175,136 字节**）；L8 的 `complete` 加第四条、`incomplete` 加 `too_large`；L14 加“大小准入”；L20 删掉“仍然成立”、改成由准入逐次量着拦；§2 加 `'too_large'`、记录类型注释、端口注释；G11 只挡前几种、UCR-01 放行 `too_large`；规则 18；验收加 K3-48（创建溢出、可选文字 `capacity`、必须写的仍放得下）；§6 的 state/WorkGraph/AgentRuntime |
| M4（B2） | 用户定（决定 57，2026-10-14）：平台拦下原命令，要再跑这条命令 agent 必须给人类原因、人类要知道并允许；四种结果；lead 补卡上三个选项、空白规范化只挡原样命令；机制待 lead 在 K3 恢复时写 | §0 加给用户看的一段；§1 B 组改成“已由用户定（决定 57）”，引原话、lead 补的、机制那句；L19 的 (a)/(b) 两段换成用户规则 + lead 补的 + 机制待写（保留原命令读法和规范化的候选说明）；L20 的固定句改成“平台拦下原命令；要再跑先请求并得到允许。”（≤ 原预算）；规则 14、§8、§6、§7、K3-15（二）同步；§9.3 的 B2 行加注 |
| S1 | 采纳。L20 的“一定放得下”要带上 T = 512 的条件；超过 T 时 `prepare` 回 `capacity`（第 1 片的规则） | L20“同意（approve）”一句改成“只要锚点任务 ID ≤ T = 512 就放得下，超过 T 回 `capacity`”；“T 是什么、C 怎么定”一段写明 T 是预留、不是被强制的上限；规则 15；K3-35（三）标注 S1（原本已有该例） |

### 9.5 第七稿的改动和代码事实重核（K7-1–K7-4）

**这一稿改了什么（对照 lead 的 K7-1–K7-4）：**

| 决定 | 落在哪里 |
| --- | --- |
| K7-1 B2 机制 | §1 的 L19a（L19 的“机制待 lead 写”和两行候选换成指向它）；L3 第 4 行加 `request_command_rerun`；§2（记录上的 `blockedCommands`、新聚合 `CommandRerunRequest`、两个索引、`command_rerun_request` 来源、`request_command_rerun` 工具、读口/owner）；§3.2 的 UCR-09/10/11/12、新的 §3.2b CRR 表、§3.5 的 KR12；§5.2 的 B2-01…B2-09；§6 的新文件和 `blockedCommands`；§7 的第 4 组（契约/state 并入第 1 组）；规则 14、19；L20 的必需部分保留固定句、去掉机制注和预算注 |
| K7-2 资源上限 | L31、§0 第 5 条；核对轮的输入那一句（见下） |
| K7-3a 维护的 `handed_over` | L30a、§5.2 的 K3-HO1、§6 的 `session-maintenance.ts` |
| K7-3b 空 scope | L31b、§5.2 的 K3-49、§6 的资源上限片文件 |
| K7-4 重核 | 下面两张表 |
| K7-5 | 抬头状态、本节 |

**L19a 的接缝（K7-1 要求查）。** 今天有。Runtime 的 `before_tool` 控制钩子在 Kernel 侧由 `vendor/coding-agent/patches/app/composition/control-hooks.ts` 接进 `HookExecutor`，`block` 由 Kernel 的 runner 转成 `hook_blocked` 工具结果交回模型（不是 `outcome_unknown`）。`src/core/agent-runtime/execution-driver.ts:766` 的 `toolPathHook` 就是同类钩子（挡 `read`），在 `execution-driver.ts:919` 经 `controlHooks` 装上。所以要拦 `shell`：加一个 `before_tool` 钩子（或扩展现有的），在 `shell` 执行以前按 `blockedCommands` 返回 `block`，Kernel 回 `hook_blocked`；不需要改 Kernel 补丁。两点实现注记：现有钩子只在 `hasFileRead` 时装（`execution-driver.ts:919`），L19a 的钩子要在“有拦下的命令”时也装；`hook_blocked` 是错误形状的结果，规格要求它是“正常结束的工具调用、不算失败、不计返工”，这一句要在平台记账上落实。

**K7-2 的核对轮输入那一句。** 查过：资源上限的观察（`cap_hit`/`none_observed`/`uncertain`、`observationComplete`）在 `shell` 的**工具结果**里（`vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js` 的 `output` JSON 的 `resourceCaps`）；结果未知（`outcome_unknown`）的调用没有结果，所以不可能带这句。按 K7-2“没有就不带、不编”，没有加这一句，也不新增规则。

**§5 的“资源上限的可行性”整节。** 第六稿的 §5 已经是测试（TDD）；第二版的那个可行性 §5 早就删了（L31 原来就写着“第二版 §5 删去”）。所以只改了 L31 和 §0，§5 没有对应内容可换。

§9.3 的 B2 行和 §9.4 的 M4 行是第六版当时的存档，里面的“机制待 lead 写”以 L19a 为准；历史正文不改。

**旧位置 → 新位置（只改行号或文件名、事实不变的）：**

| 旧位置（第六稿写法） | 新位置（753bf5ab） |
| --- | --- |
| `observed-model-run.ts:255`（`write → edit`） | `observed-model-run.ts:258` |
| `claim-service.ts:1104–1124`（领取守卫一处拼） | `claim-service.ts:1135–1157` |
| `execution-entry-service.ts:391`（`readManifestFromEnvelope`） | `execution-entry-service.ts:392` |
| `business/workflow/ports.ts:106`（`controls?`） | `src/business/workflow/ports.ts:108` |
| `workflow.ts:1743`（RUN-02 拒绝→waiting） | `workflow.ts:1865` |
| `context-assembler.ts:907`（容量拒绝） | `context-assembler.ts:949` |
| `run-reconcile.ts:358–361`（Turn 没终态、在途调用） | `run-reconcile.ts:373–375` |
| `workflow.ts:889` / `:899`（`isUnadmittedStarting` 和排除 `paused`） | `workflow.ts:895` / `:905` |
| `message-record-codecs.ts:136–138`（S5 答复索引块） | `message-record-codecs.ts:137–141` |
| `message-record-codecs.ts:1133`（SessionMessage 的 `lookups`） | `message-record-codecs.ts:1147` |
| `views/decision-read-model.ts:1068–1094`（`findAnswerMessage` 读法） | `views/decision-read-model.ts:1043` |
| `claim-service.ts:1067` / `create-platform.ts:685`（runId 是 UUID，事实不变） | `claim-service.ts:1092` / `create-platform.ts:752` |
| `tests/scenarios/A8-host-restart.test.ts:217` / `:610` / `:666` | `:220` / `:621` / `:677` |
| `tests/scenarios/A8-host-restart-attestation.test.ts:53` | `:51`（`:76` 的 owner 调用不变） |
| `tests/scenarios/A8-host-restart-entry.test.ts:181` / `:272` | `:182` / `:273` |
| `tests/state/run-machine.test.ts:954`（RUN-08 的 `toEqual`） | `:955` |
| `tests/work-graph/WP2-undelivered-notices.test.ts:810`（`workUnavailable()`） | `:837` |

已核过、事实不变也不用改的（举要）：`run-reconcile.ts:classifyRun`（`:232`）、`record-codec.ts:754`、`execution-preparation.ts:292–295`、`run-machine.ts:1712–1780`、`control-service.ts:347`、`control-contracts.ts:22–31`、`session-archive.ts:373`、`message-record-codecs.ts:67`、`contracts/core/session-message.ts:67–71`、`contracts/goal-decisions.ts:78–83`、`composition-root.ts:135`、`control-hooks.ts:72`/`83–101`、`vendor/…/runtime-runner.js:591`、`continuation-brief.ts` 的 179/195/235/255/274/284/287/337/496/514/643/689–695、`task-failure.ts:136–142`/`384–399`/`779–791`、`ports.ts:99` 的 `closeOpenTurn`、`session-operations.ts:891` 的 `readTurnBounds`、`run-reconcile.ts:68` 的 `MAX_PAGES = 64`。§6 的既有文件全部存在，没有路径错误；标“新”的都是计划新建。

**要 lead 定（事实变了的，不改规则；旧事实、新事实（file:line）、影响哪一条）：**

1. **`StartupReconcileOptions` 不存在。** 旧事实：§2 写“`StartupReconcileOptions` 加 `takeover`”；§6 把它算进 `src/app/startup-reconcile.ts`。新事实：实际类型是 `StartupReconcileDependencies`（`src/app/startup-reconcile.ts:94`），`ReconcileLine` 在 `:105`、`StartupReconcileReportV1` 在 `:108`（当前都没有 K3 的新字段）。影响：§2 的启动核对契约、§6 的 Host 清单；规则（启动核对把证明交给分类器、第 2b 步和报告加 `reviews`）不变，只差把类型名交 lead 核。
2. **来源适配器的 `pageLimit` 不是构造参数。** 旧事实：L24 写“来源适配器每页读多少条是构造参数 `pageLimit`（默认 200，1–200）”，K3-20 用小的 `pageLimit` 证明翻页读到底。新事实：当前没有这个构造参数；页大小是模块常量 `SOURCE_PAGE_LIMIT = 200`（`src/core/work-graph/views/decision-read-model.ts:105`）、`LOOKUP_PAGE_LIMIT = 200`，稳定窗是 `WINDOW_MAX_ATTEMPTS = 4`（`:108`）。影响：L24、K3-20、§6 的卡来源适配文件；要么把页大小改成构造参数，要么改 K3-20 的夹具。规则（按 2A 的分页读到底、稳定窗）本身不变。
3. **SessionMessage 的 `lookups` 已经含 2A 的索引。** 旧事实：§2 写 `[...SESSION, ...S5, ...K3]`，K3 索引接在 `message-record-codecs.ts:1133` 的 `lookups` 后面。新事实：当前是 `[…SESSION_MESSAGE_LOOKUP_INDEXES, …S5_SESSION_MESSAGE_LOOKUP_INDEXES, …S2A_SESSION_MESSAGE_LOOKUP_INDEXES]`（`src/core/work-graph/sessions/message-record-codecs.ts:1147`），2A 已合入。影响：§2 的 D4 最小补法、§6；K3 的索引要接在 S2A 之后，规则的写法不用改。
4. **`apply_future_plan` 的去留。** 旧事实：L3 第 4 行列它。新事实：当前还在（`src/core/agent-runtime/whiteboard-tools.ts:58`、`:234`、`:329`、`:437`），但 HANDOFF 决定 64-3 已定删除，4C 未合入。本稿已按 lead 的 K7-4 从第 4 行删掉它、从 K3-39 删掉这个例子，并注明 `record_note` 在 4C 合入时加进第 4 行；K3 施工前要按合并后的 4C 再核一次（影响 L3、K3-39）。
5. **`RENDER_TEXT_CAPS` 没有导出。** 旧事实：§2、L20 引用它（`continuation-brief.ts:255`），并计划让 `approvedMethodLinesZh` 从 `continuation-brief.ts` 导出。新事实：`approvedMethodLinesZh` 是 K3 新导出（当前不存在，已标“新”），`RENDER_TEXT_CAPS` 当前是模块私有（`:255` 存在、未 export）。影响：L20、§2；若 WorkGraph 的 owner 要从外面引用它，需要先导出；规则不用改。
6. **`decision-read-model.ts` 的 `CARD_KINDS`。** 当前（`:94`）不含 `unknown_call_review`，但已有 `note_review`（4C 的注记）。这不是旧事实错，是 K3 要加卡来源时必须区分的点；记在这里免得和 `note_review` 混淆（影响 L18、§6）。

**lead 的裁定（2026-10-16，逐行审第七稿时定）：**

1. 类型名照代码改成 `StartupReconcileDependencies`（§2 已改）；`ReconcileLine`、`StartupReconcileReportV1` 照第六稿加字段，规则不变。
2. `pageLimit` 是 K3 **新的**卡来源适配器自己的构造参数（默认取 `SOURCE_PAGE_LIMIT = 200`，1–200），`decision-read-model.ts` 的模块常量不改；K3-20 照写。
3. K3 的索引接在 `S2A_SESSION_MESSAGE_LOOKUP_INDEXES` 之后：`[...SESSION, ...S5, ...S2A, ...K3]`；规则不变。
4. 照本稿：`apply_future_plan` 不在表里，`record_note` 等 4C 合入时加进第 4 行；K3 施工前按合入后的 4C 再核一次 L3 和 K3-39。
5. `RENDER_TEXT_CAPS` 从 `src/contracts/continuation-brief.ts` 导出（这个文件已在 §6），预算表照用。
6. `CARD_KINDS` 加 `unknown_call_review` 和 `command_rerun_request` 两种，和 `note_review` 分开（§6 的 `decision-read-model.ts`）。
7. lead 审稿时另改了三处：L19a 和 CRR-03 的“标成已用”改成先提交、成功才放行（没有“`shell` 准入的提交”这回事）；`k3-crr-by-task-command` 加上目标；被拦下的调用怎么记（`hook_blocked`，Run 不因它失败）写进 L19a。

### 9.6 第八稿的改动对照（K8-1–K8-7）

**这一稿改了什么（对照 lead 的 K8-1–K8-7）。**

| 决定 | 落在哪里 |
| --- | --- |
| K8-1 静态解析 | §1 的 L19a（“拦哪些命令”加 `parseShellActions` 六条规则、脚本展开、`blockedCommands` 的新字段、`package.json` 什么时候读；“在哪拦”改成 (A)(B) 比对、写明命中动作的固定话、重放不重新解析）；L19a 的例子表；§2（`UnknownCallReviewV1.blockedCommands` 的新字段、准备清单带动作和展开、`command-normalization.ts` 的 `parseShellActions`）；§5.2 的 B2-10、B2-11；§6（`state/command-normalization.ts`、单元测试文件） |
| K8-2 注明的改写，按别名 | §1 的 L19a（入参加 `rewriteOf`、四种回答、注明后被拦、一个别名一个等答复请求、`denied_in_this_run`/`deny_final` 按别名、允许只放行卡上的写法、卡面和新句子、接续说明一行加注明过的写法）；§2（`CommandRerunRequestV1` 的 `alias`/`declared`、`k3-crr-by-task-alias` 索引、读口和 owner 的入参）；§3.2b 的 CRR-01/CRR-03 和按别名的说明；§5.2 的 B2-12…B2-15、B2-02…B2-09 的按别名断言 |
| K8-3 模型判断留到以后 | §1 的 L19a 末句；§0 第 70 行那段；§8 的“这一片不做模型判断（决定 68）” |
| K8-4 测试 | §5.2 的 B2-01（照例子表逐行）、B2-10…B2-15 新增、B2-02…B2-09 按别名调整；§6 的新单元测试文件 |
| K8-5 改稿 | 抬头状态；本节；§1 的 H 组（三个代码事实） |
| K8-6 lead 审稿补充 | L19a 的“lead 审稿补充”：`rewriteOf` 带核对记录、命中几条时取第一条、允许按写法认、钩子和 ② 每次读什么、复合命令逐个动作拦、工作区读口的接线；§2 的 `rewriteOf` 类型和 `k3-crr-by-task` 索引 |
| K8-7 delta 裁定（11 条） | ① 已批准方案命令放行 + 钩子顺序：L19a“在哪拦”的 (i)(ii)(iii)、B2-02；② `declaredForms` 必存：L19a 请求工具、CRR-07、§2 的 `CommandRerunRequestV1.declaredForms`；③ 允许未用时返回 `allowed`：L19a、§2 结果联合、B2-14、§3.2b 不变量；④ 核对记录身份：L19a 的 `rewriteOf` 前缀规则和 `#<别名>@<runId 前 8 位>`、接续说明、§2 的 `requestRerun` 入参和准备清单 `blockedCommands.reviewRunId`；⑤ 词数组比较键：L19a 静态解析第 4 条、§2 注释、B2-10；⑥ 脚本目录：L19a 脚本展开、§2 的 `expansions[*].basis`、B2-11；⑦ 请求记录存 `match`：§2、L19a 卡片；⑧ 摘要对摘要：L19a (A)(B)/允许、CRR-01/CRR-03、§2 注释；⑨ 容量：L19a 上限和退化、§2 的 `truncated`、L7 的 R + 16 KiB（R = 365,536、B = 158,720）、K3-48；⑩ 读取上界：L19a“钩子每次读什么”、§2 的 `listRequests` 任务过滤器、§5.2 的 B2-16…B2-18；⑪ 测试入口：B2-10 纯函数、B2-01 的保存回退、B2-03…B2-07 和 B2-11…B2-15 移到 R4（需要存储或执行的行不再挂 R5） |
| 旧索引键改名 | 第七稿的 `k3-crr-by-task-command` 改成 `k3-crr-by-task-alias`（键里加核对记录，等值键从 `commandSha256` 改成别名）；`commandSha256` 仍是请求记录上那条写法的键；§9.5 的存档正文不改 |

**三个代码事实（K8-5 要求查）。** 都写在 §1 的 H 组，带文件:行：

- 读 `package.json` 用平台已有的 `WorkspaceToolsPort.readWorkspace`（接口 `src/core/workspace/ports.ts:185`；实现在 `src/core/workspace/workspace-tools.ts:53`；工作树读取在 `src/core/workspace/workspace-read.ts:58`；组合接线在 `src/composition/create-platform.ts:1260`）。② 和钩子用同一个读口；钩子今天没接这个依赖，要接（复用已有端口，不新增读权限）。
- `before_tool` 钩子能异步读文件：`execute` 是 `async`，现有 `toolPathHook` 在 `src/core/agent-runtime/execution-driver.ts:766`、`:774` 就 `await` 了授权调用。
- 原调用的工作目录能从 Kernel 记录读到：`requestedCall.arguments` 在 `vendor/coding-agent/dist/core/runtime/state/run-state.d.ts:290–294`，`shell` 从 `arguments.cwd` 取、没有时用 `"."`（`vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js:162`）；缺省是执行时补的，记录里没有单独字段。

**要 lead 定。** 三条代码事实都查到了，没有查不清的；上面“钩子要接工作区读口”是一处接线（复用已有端口，不新增读权限），留 lead 审。
