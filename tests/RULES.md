# 测试规则表

这份表约束一片施工范围内的所有测试和测试夹具，规则见下面各段。这份表与 `coordinator-mode.md` 的分歧处，以本表为准。

例子一律写作 `文件:行`，相对仓库根；行号按本树当前文件核对。

**适用范围。** 一片施工新建的文件，整份都在范围内。
只被这片施工碰到的旧文件，只有这片施工改动的行在范围内；
该文件其他地方的旧账进 T 清单，只列一次，不算这片施工的发现表。

**默认禁止。** 测试只能通过「允许」下的形状到达状态、核对结果。
其他形状一律禁止，不管它叫什么：「接缝」「冻结边界」「测试声明的结果」「替身」。
「禁止」下的清单只给例子，并不完整。

**实现者不给自己的测试判「允许」。** 实现者从不把命中的测试标成「允许」，从不改白名单，
也从不为了让测试过墙而削弱测试。它修掉命中，或报 **BLOCKED**，附上确切的拒绝
（文件:行和消息）和最小选项；由 lead 裁定。

**规则表在一片施工中不改。** 改动就是新版本（带理由）。
lead 让 Codex 在同一步按新读法列出每一处实例，新版本从下一次冻结起生效。

## 允许

- **A1 公共步骤。** 平台自己的代码通过真实使用会走的步骤产生先前状态：
  路由和公共 owner、Workflow 的推进、Host 启动和重启、脚本化模型调用真实工具、
  真实分析器脚本跑真实源文件、磁盘上的真实文件（写入、编辑、移走再移回）。
  把这些步骤留在共享 helper 里。
  helper 只接收公共输入：id、名字、文件内容、
  脚本化模型回复，以及任何公共路由或公共 owner 方法的 body——真实调用者会发送的 body
  （人通过 UI 或 HTTP，agent 通过工具），例如 `plans/propose` 的 Plan 草稿、
  Goal 的 objective 或回答。
  测试可以用真实调用者可能发送的值自由构造这样的 body。
  helper 绝不接收真实使用中由平台自己产生的值（见 F1），也不接收 event、cursor、
  position 或 prepared value。
  - 已接受：`tests/helpers/K3-35-continuation-fixture.ts:352`（共享的 continuation 路径）；
    `tests/app/S8A-L8-auto-capture-host.test.ts:108`（把根目录移走后产生的失败）。
  - **整个契约。** 公共输入必须满足真实路由或工具分支的完整参数契约。
    类型转换不会让一个值变成合法的公共输入；忽略请求的替身也不会。
    A1 不豁免 F4。
  - **平台签发的值。** 公共输入可以携带平台自己签发或派生的字段：credential、
    display token、position、cursor、receipt、fingerprint 或 prepared value。
    这样的字段只能是真实公共步骤返回的值，
    并按返回时的样子使用。
    从内部记录或捕获的 commit 重建它，或者在测试里签发它，都是 F1。
  - **record-store 自己的测试。** 对 `src/core/record-store` 本身的测试
    （`tests/record-store/*` 以及只有它们使用的 helper），store 的 port 就是公共步骤：
    在那里构造记录并通过 port 提交是允许的，其他地方都不行。
    由这一行验证什么决定，而不是由所在文件夹决定：这一行必须检查 store 自己的契约。
    在 store 之上任何模块的测试里手工构造并提交记录，都是 F3。
- **A2 故障注入。** 依赖在一个具名点失败、挂起、被取消或崩溃，平台作出反应。
  形状：包住真实依赖、失败一次或一直失败的 wrapper；crash fixture；取消信号；
  包住真实解释器、打印垃圾/挂起/退出的 wrapper；
  收窄的 Host 授权；通过平台选项设置的小上限。
  - 已接受：`tests/work-graph/K3-17-disposition-replay.test.ts:88`（`failNextApplicationCommit`）；
    `tests/business/K3-46-review-advance-failures.test.ts:198`
    （disposition commit 持续失败的 records port）。
  - **crash fixture：** 一个真实步骤（commit、tool handler、model reply）被 wrapper 或 gate
    按在具名边界上，该 wrapper 或 gate 只对旧 Host 生效；旧 Host 被丢在那里
    （`tests/scenarios/harness.ts` 的 `restart({ crash: true })` 形状：旧 Host 被放在一边，
    因为步骤被按住而停止推进，它的锁被改写为死 pid，只有新 Host 的断言完成后才清理），
    然后同一个 SQLite 数据库上起新 Host。
    写入之后才被告知的 commit observer 不是 gate。
    Host 崩溃不能替代 Runtime 自己以 `crashed` 结束的 Run
    （真实的模型失败才会产生那个），
    也不能替代正常关闭再重启。只有要证明某个进程确实不在了（旧工具不再运行）的行
    才需要真正杀掉子 Host 进程；这一轮没有 K3 行需要。
- **A3 委托 wrapper。** 包住真实依赖的 wrapper，统计调用，或把调用按在测试控制的 gate 上，
  然后原样返回真实结果。
  - 已接受：`tests/app/S8A-L8-auto-capture-gate.test.ts:200`
    （`resolveRoot` 上每个 workspace 的 gate）。
- **A4 后端接缝。** 包住 backend 或 body-store 工厂，让平台与测试世界共用同一个真实 backend
  （于是 memory Host 可以重新打开），除此之外不做别的。
  - 已接受：`tests/helpers/K3-35-continuation-fixture.ts:570`（memory records backend）；
    同一处在 `:579` 包住 body store 的 `RawArtifactBodyStore`。
- **A5 纯函数。** 直接拿构造好的输入调用 parser、normalizer、codec、renderer、sorter 或
  predicate。
  纯测试不导入 store、platform、Host、Workflow、Runtime 或 stub port。
  从场景里挪出来的一行放进 `*-pure.test.ts` 文件。
  公共步骤到达不了的组合，以及极端值（16 位计数），属于这里，绝不属于场景状态。
- **A6 被拒绝的输入。** 在 `describe('rejects: …')` 块里，owner **拒绝**一个构造出来的值。
  每一个先前状态都来自 A1。
  这一行断言拒绝，并通过公共读取断言什么都没变。
  每一行只放一个错误，所以移除被测的检查会让这一行失败。
- **A7 具名 helper。** 由 lead 维护的清单（最多 10 条，每条带 file:line 和理由），
  列出可以做 A1–A6 与 A8 未覆盖之事的 helper。共三条。
  1. **进程沙箱替身**，`tests/scenarios/support/process-sandbox-standin.ts:22`
     （`createProcessSandboxStandin`，对
     `vendor/coding-agent/dist/sandbox/process/process-sandbox.js` 的模块 mock）。
     它只代替 Host 的 bubblewrap 沙箱。这里有两种读法：
     - 读法一：`execute` 真的在 workspace 根目录的子进程里运行命令（遵守 abort signal），
       运行前后取真实的 workspace 快照，
       并把真实 shell handler 期望的完整执行结果
       （exit status、signal、timed-out 和 cancelled 标志、output、effects、timings）
       从这次真实运行返回；不构造任何值。
     - 读法二：它只用 `probe`，并以 `executeChecks: false` 调用；需要真实检查的恢复场景
       （`tests/scenarios/K3-29-disposition-recovery.test.ts:41`、
       `tests/scenarios/K3-44-recovery-answers.test.ts:41`）改用
       `createProcessSandboxSwitch`，不属于这个替身。
     - `probe` 对默认探测和只读探测都回答 `available`
       （有 bubblewrap 的 Host 就是这样回答的），
       只有在关于该拒绝的行里才回答 `unavailable`；
       constructor 和 probe 选项保持可观察（A3）。
     - 它**不**提供隔离，也不提供资源上限：关于只读隔离、受保护路径或资源上限的行，
       要在有 bubblewrap 的真实沙箱上跑。
     - **理由：** 实现者的沙箱没有 bubblewrap，但真实 shell 仍必须运行，好让这些行看到
       真实结果；
       隔离本身属于 Kernel，由带 bubblewrap 运行的行覆盖。
       范围内每一个需要进程沙箱的测试都用这一个 helper（测试文件里不放副本），
       也没有测试构造执行结果。
     - **未定：** 这个替身能不能真的执行命令——是像读法一那样真的运行，还是像读法二那样
       只做 probe，由 lead 在第一个需要它的片之前决定；在那之前两种读法都保留。
  2. **note tools adapter。** `tests/runtime/S4C-note-tools.test.ts:67`：`buildNoteTools`
     配一个记录式的 note write/check port。
     只在这个文件里，只用来测 adapter（它的参数映射、默认值、以及把结果透传出去）；
     绝不用来到达 owner 的状态。
  3. **Kernel 损坏注入。** `damageKernel`，在 `tests/scenarios/S2C-K-unknown-outcome.test.ts`
     （定义 `:36`，调用 `:72`）及其搬移后的形式 `tests/scenarios/S2C-K-retired.test.ts`
     （定义 `:193`，调用 `:225`）。它破坏测试自己的临时 Kernel store 里的 record JSON
     （该 store 的整张 records 表都允许），好让测试检查平台如何应对损坏的 Kernel 历史
     （A2 的具名点失败）。
     绝不用来写入或改动 WorkGraph facts 或任何其他 store。
- **A8 Host 输入。** Host 自己从其配置提供给平台的输入：
  workspace 根（测试创建的真实目录）及其 revision、该根内路径的授权决定、
  带脚本化模型 provider 的 runtime 配置（步骤从不调用的 model client 可以是占位符）、
  时钟和 id 生成器。
  普通值没问题：这些是输入，不是平台记录或派生的事实。
  真实 Host 绝不会给的 Host 输入（workspace 之外的根、外部路径的授权）
  只属于关于该拒绝的行。
  - 已接受：`tests/app/S8A-L8-auto-capture-gate.test.ts:201,203`
    （测试自己的临时目录的根和授权）。

## 禁止（举例）

- **F1 owner 接受一个在真实使用中由平台自己产生的构造值**（平台根据 Kernel facts 构建的
  draft、classification、review outcome、Run 或其状态、record、entered fact、prepared value），
  把它交给平台自己的步骤会调用的 owner write，即使那个 write 被导出；
  然后测试从这里往下走。
  判断方法：
  真实调用者会不会通过 A1 的公共入口（UI 或 HTTP 的路由，或 agent 的工具）
  发送这个值？只有平台内部产生、没有真实调用者会发送的值，才是这里禁止的。
  仅仅被导出的 owner 方法不是公共入口。
  - Not F1：`tests/composition/S8A-L8-pass-capture.test.ts:247`（Plan 草稿经
    `plans.proposePlan`，公共路由 `plans/propose` 把它暴露给调用者）。
- **F2 覆盖** 读结果、记录或 Session 字段，包括先展开再覆盖。
- **F3 以 Runtime 或 Host 的方式写。** 调用 Runtime 或 Host 通常会调用的 owner write
  （用构造的 event 调 `recordRunResult`），向 store 追加或提交，
  打开 store 去写。
  - 反例：`tests/helpers/B2-execution-fixture.ts:318` `enter()`
    （手工写入 entry facts；该文件在 T 清单上，它的 K3 调用者不在）。
- **F4 返回构造值的 stub port 或替身**，交给 Workflow 或 owner。
- **F5 在没有真实原因时再次发送 trigger 或 notification。**
- **F6 编造的失败**，
  或通过 owner write 写入的记录。
- **F7 通过读 store 来断言。** 通过公共读取来断言。
- **F8 期望值来自 `src` 常量或从程序输出抄来。** 它来自规格或手算例子。
- **F9 计时。** sleep、`setImmediate` 链，或拿许多文件拖慢步骤；
  用 sleep 证明某事**没有**发生。
  用 A3 gate、完成屏障（被 await 的 close、drain 或 callback）或计数调用。
  对公共状态做有界轮询直到条件成立（`pending: false`）是允许的。
- **F10 在规格约束的是公共操作时，去内层计数。**
- **F11 没有它声称的检查也能通过的行**：一行里两个错误，或一个例子同时命中另一条规则。
- **F12 削弱。** 删除或放松断言；
  删除一行、一个 `.each` 条目或一个 backend；
  `skip`、`todo`、`only`；调高 timeout；改动被拒行的输入。
  只有在冻结的发现表点名时才允许。
  否则报告改动前后。

## 每一行还要

- 从规格里指出一个行为。它的期望字面量来自规格或手算例子。
- 服务层行在 memory 和 SQLite 上都跑。行表可以写「仅 SQLite」并给出理由（Host 重启）。
- 如果它守护的生产检查被删掉，这一行必须失败。

## 检测器（每次收尾都跑，lead 每轮也跑）

- **D1 断言台账：** 删除或放松的断言、删除的测试和 `.each` 行、`skip`/`todo`/`only`、
  更少的 backend、调高的 timeout、期望值里的 `src` 常量、
  改动过的被拒输入；
  从这片施工的 base 起累计。每一行都引用一个发现表 id。
- **D3 纯文件守卫：** `*-pure.test.ts` 文件不导入 store、platform、Host、Workflow、
  Runtime 或 stub port。
- **D4 事实扫描**（存在时）：F1、F3，以及 A1 的 helper 参数；在 A6 块和 A7 之外。

D1 和 D3 以 `python3 -I .dsh-ref/d1-ledger.py . <base tag> WORKTREE` 运行
（任务书给出 base tag；lead 对已提交的轮次运行同一个脚本）。
D1 的每一行都必须匹配一个要求它的发现表 id；
在回复里逐行列出并带上 id。

红色检测器阻塞收尾：修掉命中，或报 BLOCKED。
不要给命中分类。
