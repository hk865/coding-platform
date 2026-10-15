# RL 片规格：沙箱命令的内存和进程数上限

> **状态：lead 起草（子任务代笔），2026-10-14。做法用户已定（决定 53），本稿不再问。2026-10-14 按 Codex 第一轮审查（`D:/cc-lead-notes/codex2/rlspec.review1.md`）和 lead 的决定改了一轮（§0.6）。2026-10-14 按 Codex 第二轮审查（`D:/cc-lead-notes/codex2/rlspec.review2.md`）改：最后证据改由沙箱外的看门进程保留 scope（不进沙箱）。2026-10-14 按 Codex 第三次核对（`D:/cc-lead-notes/codex2/rlspec.review3.md`）改完，并按 lead 的决定在起跑时记下看门进程的 pid、收尾只认它（L2、L7）。内容定稿。2026-10-14 用户答了 Q1（决定 55：选 a，加“调高上限”入口；默认内存上限改 6 GiB），测试入口 RE0–RE3 同意。冻结前：lead 核定请知悉读 `cap_hit` 的位置（L16）。**
> **已冻结（lead，2026-10-15 夜）。** L16 的读法 lead 按代码定了（见 L16“读法”）；Codex 三次审查已用完（决定 56），这一处放进 RL 的 Codex 实现审查一起看，不另开规格审查。代码基线已从 bb924854 变成 e8b3edae（2A、2B 已合入）并将合入 2C：施工前的 DSH 通读逐条重核 §0.2，不成立的报出来，lead 按符号改行号、不改规则。
> - 代码基线：工作树 bb924854（K 片 B 9881a2ae、接线包 2 bb924854 都已合入；K 片 B 含第四轮的“受保护路径只分类一次”D-ONECHECK）。Codex 三次审查都按 bb924854 核对。§0.2 的行号已按它重核：接线包 2 只让 `create-platform.ts` 的行号变了。施工前基线再变，重核 §0.2。
> - 依据：
>   - HANDOFF 决定 52 第 5 条、决定 53（`HANDOFF.md:319-327`）；
>   - K3 第二版 §5 的实测（`D:/cc-lead-notes/specs/k3/slice-K3-SPEC.v2.md:206-228`），探测脚本 `D:/cc-lead-notes/impl/rlimit-probe*.sh`；
>   - Codex 对 K3 第二版的审查第 16–19 条和末句（`D:/cc-lead-notes/specs/k3/resource-limits-notes.md:6-26`），逐条答在哪里见 §0.5；
>   - K 片规格 B 部分：§1.2、§2（L357–370）、L12–L18（L208–280）、§4 第 7 条（L391）、§5.1 KE5/KE6（L410–411）、§5.2 KB 行（L443–453）、§8（L522–531）、§9 M10–M12（L582–595）。这些结果和安全规则本片全部保留（L14）。
> - 代码事实：§0.2，逐条对过文件和行号；起草的子任务没跑测试、没调用模型。§0.2 末尾的 WSL 实测是 lead 2026-10-14 跑的。

## 0. 冻结说明（lead）

### 0.1 要你定的

**为什么现在能写。** 决定 53 已经定了：
- 做：给沙箱里的每条命令加内存和进程数上限；超限只影响这条命令，Host 照常。
- 默认：内存取本机内存的一半和 4 GB 中较小的，进程数 512；放进 Host 设置，可以改。（决定 55 把 4 GB 改为 6 GB，见下。）
- 机器不支持时（没有 systemd 的用户会话、cgroup 没下放、不是 Linux／WSL）照常跑、不设上限，界面和工具结果写明“没有资源上限”。
- K 片 B 合入以后单独一小片；做法是 `systemd-run --user --scope`，`prlimit --as` 不能用（node 一启动就崩）。

本稿不再问这些。“没有资源上限”只指不设上限，从不绕过沙箱：沙箱本身不可用时，命令照今天拒绝（规则 1）。

**已答（决定 55，2026-10-14）：**
- **默认内存上限调高到 6 GB：** 内存取本机内存的一半和 6 GiB 中较小的（原来是 4 GiB；进程数 512 不变）。用户原话：“调高一些吧，比如说6G”。本机 WSL 有 15,841 MiB，一半是 7,920 MiB，所以默认是 6,144 MiB。
- **Q1 选 (a)，另加“调高上限”的入口。** 用户原话：“可以选a，不过这时候可以单独跳出一个改设置的选项，不然人的交互体验不好”。
  - 检查撞上内存上限失败，照普通检查失败算，照今天交给自动返工；检查报告写明“超出内存上限”。返工那一轮从报告看得到这一句，可以自己降低并行度。
  - **不新发卡，用已有的“请知悉”带出入口。** 今天自动返工已经有一条请知悉“自动返工 · <任务> · 第 n 次”（`src/core/work-graph/views/automatic-rework-notices.ts`，读的就是这一轮检查）。这一轮里有检查是 `memory: 'cap_hit'` 的，这条请知悉在摘要后加“检查超出内存上限（当时上限 N MiB）”，并带一个操作 `raise_memory_cap`。界面（E3）据此显示“调高上限”按钮，点开 Host 设置里的内存一项（RE3 的设置路由）；改了以后，之后启动的检查就用新值（告知 7）。
  - 请知悉从哪里读到 `cap_hit`（轮次里每项检查的快照加一个小字段，或读检查报告），lead 施工前核代码定，Codex 复核（L16）。
  - 当时的问法和 (b) 留作依据：(b) 单独发一张“请你决定”（调高上限 / 照常返工 / 我来处理）。决定卡不只是弹一个提示，它要让任务停下来等你：要加一个新的卡来源、一条自动化的停止规则、“不出两张卡”的三处推导，每个选项还要有能重放、能在崩溃后补做的落实（“调高上限”写的是 Host 设置，不在 WorkGraph 里，落实凭证要新认一种）。决定卡的队列、答复、显示可以复用，这几样复用不了，规模和 K3 里卡的那一部分相当。

**需要你知道的（lead 按决定读的，或 lead 定的；你可以改）：**
1. **进程数上限也算线程。** 一个 node 进程本身就有十来个线程。512 对一般的构建和测试够用；开很多线程的程序（例如 Java、并行度很高的构建）可能碰到。沙箱自己也占 2–3 个；有上限时，看门进程（L1，在沙箱外、scope 里）再占 1 个。
2. **进程数超限时，内核只是拒绝新建进程或线程，不杀命令。** 命令可能自己处理掉，甚至成功退出（退出码 0）。结果照实写：成败按退出码，另写“有新进程或线程被任务数上限拒绝”。在较老的内核上，这一句也可能是上一层（例如用户整体）的上限拒绝的（L9）。
3. **内存超限时，结束整条命令**，不只是被内核挑中的那个进程（L8）。这符合决定 53 的“超限只杀这条命令”。
4. **上限是每条命令各自的。** 几条命令同时跑，加起来可以用到几倍上限；Host 自己不设上限。整台机器内存不够时，系统仍可能杀掉别的进程，包括 Host。本片不防这种总量（以后再问 1）。
5. **WSL 里的“本机内存”是 WSL 虚拟机的内存**（`.wslconfig` 或默认值），不是 Windows 的全部内存，默认值按它算。“6 GB”按 6 GiB（6144 MiB）读。
6. **登记的检查、工作台“命令”页里你自己跑的命令，也在沙箱里，也有上限**（决定 53“沙箱里的命令”的字面）。
7. **改了设置，之后启动的命令就用新值**，包括正在跑的执行里的下一条命令；已经在跑的命令不变（L13）。
8. **不支持的机器，每条命令的结果里都写“没有资源上限：<原因>”。** 设置页显示这台机器支不支持；Host 刚启动、还没探测完时显示“还没检查”（L5、L13）。
9. **内存上限也算这条命令读写文件用的缓存。** 缓存可以回收，一般不会因此被杀，读大量文件的命令会慢一点。命令不能用交换区（`MemorySwapMax=0`），否则上限不实。
10. **每条命令多花大约 10 毫秒。** lead 在本机 WSL 量过建一个 scope 约 7 毫秒（K3 第二版 §5）。命令结束后，Host 还要等沙箱里的进程收完再读最后的计数，通常几毫秒，最多 1 秒（L7）。这只是一台机器的数，不是承诺。
11. **设置只能改两个数，不能关掉上限**（决定 53 没有“关”）；要放宽就调大。
12. **命令正常结束时，上限的事件都记得到；被强行结束时是尽量记。** 有上限时，scope 里另有一个沙箱外的看门进程，命令结束后它还留着 scope；Host 最多等 1 秒，等沙箱里的进程都收完，再读最后的计数（L1、L7）。1 秒内没收完、看门进程被杀这类情形，结果写“内存：说不准”“进程数：不知道”，不写“没有”（L9）。已经看到的“超出上限”从不丢。只有内核说“这条命令自己碰到了内存上限”时，才写“超出内存上限”；别的 OOM（例如整机内存不够）写“说不准”。

**以后再问（不挡本片）：**
1. 要不要给同时跑的所有命令加一个总上限（放在一个共同的 slice 下），顺带护住 Host。
2. 要不要按工作区分别设上限。

**测试入口待你确认**（§5.1）。

### 0.2 代码事实

缩写：**主** = 工作树 bb924854（K 片 B、接线包 2 已合入）；**PS** = `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts`；**dist** = `vendor/coding-agent/dist`。

**进程沙箱今天怎么起命令（L1–L4、L12 的依据）：**

| # | 事实 | 出处 |
| --- | --- | --- |
| F1 | 跑命令的 spawn 只有一处：`spawn(bwrapPath, args, { detached: true, stdio: ['ignore','pipe','pipe', rootCapability.fd], env: { PATH: '/usr/bin:/bin' } })`。环境只给 PATH；fd 3 是工作区根的只读句柄。生成的 dist 一样。另有一处 spawn 只跑 `bwrap --version`（探测用，不是命令） | 主 PS`:570-575,117`；`dist/sandbox/process/process-sandbox.js:414-419` |
| F2 | 终止：超时和取消都给进程组（`-pid`）发 SIGTERM，250 ms 后 SIGKILL。超时从 spawn 算。spawn 之前已取消的不起进程，返回“没开始”的结果（`cancelled: true`、退出码 null） | 主 PS`:576-601,405-407,564-567,911-923` |
| F3 | bwrap 参数：`--die-with-parent`、`--new-session`、`--unshare-user/pid/net/ipc/uts`；`--clearenv` 后只设 PATH、LANG、LC_ALL、HOME、PYTHONDONTWRITEBYTECODE。根是 tmpfs，只读绑 `/usr /bin /lib /lib64`，另有 `/proc`、`/dev`；**没有 `/sys`、`/run`、`/etc`**。工作区用 `--bind-fd`／`--ro-bind-fd 3 /workspace` 挂载，挂载后、exec 前关掉 fd 3 | 主 PS`:767-820` |
| F4 | 最后几项：`--chdir … -- /bin/bash --noprofile --norc -lc <命令>`。只读模式在命令前加 cwd 守卫（同一行），守卫失败退出 126 加标记，父进程据此报 `invalid_arguments` | 主 PS`:110-113,884-895,626-633` |
| F5 | 失败的分法：spawn 报错是 `launch_failed`；沙箱不可用在 `execute` 一开始就抛 `sandbox_unavailable`；错误码只有这两种加 `invalid_arguments` | 主 PS`:618-622,402-404,80-88` |
| F6 | 结果 `ProcessExecutionResult`：exitCode、signal、timedOut、cancelled、stdout、stderr、effects、sandboxProfileVersion、timings。没有资源上限的字段 | 主 PS`:50-64,671-680` |
| F7 | 探测 `ProcessSandbox.probe` 只看 bwrap（路径取参数、`CODING_AGENT_BWRAP_PATH` 或 `/usr/bin/bwrap`），跑一个金丝雀（含 `test ! -e /proc/self/fd/3`）。只读金丝雀的结果按配置在进程里静态缓存 | 主 PS`:319-399,333,268-271,477-538` |
| F8 | 恢复约束只取 `effectiveOptions` 的三项（受保护路径、只读运行时路径、可执行路径）；K-B 已把 `workspaceMode`、`ipcWalkMaxEntries` 排除在外 | 主 PS`:310-317`；`dist/app/composition/composition-root.js:135-148` |
| F8a | K 片 B 第四轮：只读模式在 `#run` 顶部把受保护路径分类一次（D-ONECHECK），挂载计划和 IPC 遮蔽都来自这一次；在起子进程之前，和起子进程的那一处分开 | 主 PS`:542-545,562-563,687-712,826-854` |

**沙箱的所有构造处（L13 的依据）：**

| # | 事实 | 出处 |
| --- | --- | --- |
| F9 | Kernel 组合根、恢复组合：各自 `ProcessSandbox.probe(root, workspace)`（不带选项），再 `new ProcessSandbox(profile, root, workspace, input.processSandboxOptions)`，登记 `shell`。Kernel 的 `isolated_process`／`network_isolated` 能力只看 `profile.available` | 主 `dist/app/composition/composition-root.js:60-62,67,73-80`；`resume-composition.js:59-61,66,232-236`；受管源 `patches/app/composition/composition-root.ts:86,168`、`resume-composition.ts:84,158` |
| F10 | 只读命令工具：每次调用 `probe` 一次、`new ProcessSandbox` 一次，两处用同一份选项 | 主 `src/core/agent-runtime/readonly-command-tool.ts:238-251` |
| F11 | 登记的检查：`probe(root, workspace)`、`new ProcessSandbox(profile, root, workspace)`，都不带选项 | 主 `src/core/agent-runtime/check-execution.ts:161,229` |
| F12 | 工作台命令页：每个工作区建一次、缓存，不带选项；命令不拍快照 | 主 `src/app/workbench-tools.ts:347-353,500-507` |
| F13 | Runtime 把 Host 授权里的 `processSandboxOptions` 原样交给 Kernel（Work 和 Query 各一处），只读命令工具也从它取两项 | 主 `execution-driver.ts:845-849,921`；`query-execution.ts:366-370,550`；`observed-model-run.ts:104,299` |
| F14 | `processSandboxOptions` 是 Host 授权里的数据 `{ readOnlyPaths?, executablePath? }`；执行准备时只把这两项复制进快照；Host 的本地授权给 `{}` | 主 `execution-contracts.ts:138`；`execution-preparation.ts:331-334`；`src/app/host.ts:264` |
| F15 | 运行时配置按执行钉住：一次执行第一次解析成功就钉住当时的版本，之后改设置只影响新的执行 | 主 `src/app/host-settings.ts:197-205` |

**Host 设置（L13 的依据）：**

| # | 事实 | 出处 |
| --- | --- | --- |
| F16 | 私有文件 `host-settings.json`，`schemaVersion: 1`。可选的 `automation` 是先例：缺了读默认，保存别的设置时不补写；`automation/save` 先校验，再写文件（写失败退回、不推），再推给 Host（推失败答 `unavailable`，要重试） | 主 `host-settings.ts:50-52,120-132,265-274,392-444,742-770`；`host-settings-types.ts:23-42,74-82` |
| F17 | Host 收到推来的私有快照（`installFromSettings`）后调 `registerAutomationPolicy`；平台用一个持有者，别处每次现读 | 主 `src/app/host.ts:651-654,927`；`src/composition/create-platform.ts:442-445,1402-1408` |
| F18 | 设置的 assembly 有可选成员的先例（`readCheckProposal?`，缺了就是不支持）；测试直接用假 assembly 测 `createHostSettings` | 主 `host-settings.ts:154-167,696`；`tests/app/A2-settings-automation.test.ts:47` |
| F19 | 私有快照只有一处字面量，在 Host 建初始绑定时 | 主 `src/app/host.ts:389-390` |
| F20 | Host 先建平台、再建工作台命令页、最后建设置；平台的检查执行器和 Runtime 在组合里建 | 主 `src/app/host.ts:452,473,919-927`；`create-platform.ts:744-745,845` |
| F21 | 正式入口 `main.ts` 建 Host 后 `listen` | 主 `src/app/main.ts:209-223` |

**结果怎么成形、怎么限长（L10、L14 的依据）：**

| # | 事实 | 出处 |
| --- | --- | --- |
| F22 | `shell` 是冻结的 dist，不在受管源清单里：每路输出 64 KiB；JSON 只抄 exitCode、signal、stdout、stderr、sandboxProfileVersion、timings；退出码不为 0 报 `shell 退出码 N`，超时报 `shell 执行超时`；沙箱错误除 `sandbox_unavailable` 外都报 `execution_failed`。源码在它 map 的 `sourcesContent` 里，受管源有“从 map 逐字提取”的先例 | 主 `dist/tools/builtin/shell/shell-tool.js:39,56-76,87-92,101-104,148`；`scripts/build-kernel-patch.mjs:13-25`；`patches/README.md`（sqlite-stores 的提取记录） |
| F23 | 分派器只量 `output` 的字节数，超了报 `invalid_result` | 主 `dist/tools/dispatcher/tool-dispatcher.js:137-138` |
| F23a | 分派器怎么盖结果：它**等**处理器返回，自己的计时器到了只是中止处理器的信号，不会自己先返回。处理器返回以后：上层信号已中止 → `cancelled`，`output: []`；分派器的计时器到过、处理器的结果又不是 `timeout` 错误 → 换成 `timeout` 错误，`output` 是一段文字“工具执行超时”；处理器自己报的 `timeout` 错误原样保留（连同它的输出）。`shell` 收到沙箱的 `cancelled` 结果时返回 `cancelled` 并带着 JSON 输出，最后怎么交给模型由上面的规则定 | 主 `dist/tools/dispatcher/tool-dispatcher.js:119-157,173-190`；`dist/tools/builtin/shell/shell-tool.js:77-92` |
| F24 | 只读命令（K-B）：JSON 是 `{ exitCode, signal, stdout, stderr, timedOut, externalChangedPaths, externalChangedPathsOmitted, timings }`；整条结果（不算 callId）限 128 KiB，先截错误输出、再截标准输出、再减路径、最后截非固定的错误消息，固定消息不截；沙箱的 `launch_failed` 报 `execution_failed` | 主 `readonly-command-tool.ts:44-46,105-202,253-260,266-311` |
| F25 | 检查：只有 `sandbox_unavailable`、`launch_failed` 算“确实没开始”，记 `not_started`；别的异常让执行窗口留在“未知”。观察记录的校验不拒多出的字段 | 主 `check-execution.ts:243-249`；`src/contracts/verification.ts:75-94`；`src/core/work-graph/persistence/evidence-record-codecs.ts:571-598` |
| F26 | 工作台命令快照的字段 | 主 `workbench-tools.ts:109-121` |
| F27 | Kernel 公开接口的值导出有一张冻结清单的测试 | 主 `tests/kernel/B2-history-public-export.test.ts:94-110` |
| F28 | K-B 的 KE6 测试用 `vi.mock` 换掉 `process-sandbox.js` 里的 `ProcessSandbox` 类（其余导出照真的），替身记下 `probe` 和构造选项、给出 `ProcessExecutionResult` | 主 `tests/runtime/K-readonly-command.test.ts:50-113` |
| F29 | K-B 已有先例：沙箱模块直接导出一个纯函数（`planReadonlyMounts`，不进 public-api），测试从 dist 的模块路径引它 | 主 PS`:200`；`tests/kernel/K-readonly-sandbox.test.ts:43-45,674` |

**lead 的 WSL 实测：**

| # | 实测 | 来源 |
| --- | --- | --- |
| F30 | 2026-10-13：WSL2、cgroup v2、bubblewrap 0.9.0；`systemd-run --user --scope -p MemoryMax=… -p TasksMax=…` 里跑 bwrap 可行；400 MB 的命令被 OOM 杀掉（退出码 137 或 143）；60 个子进程在 `TasksMax=20` 下多出的 `fork` 失败、命令自己处理；普通命令正常；每次约 7 毫秒；`prlimit --as` 让 node 起不来 | K3 第二版 §5（`slice-K3-SPEC.v2.md:210-218`） |
| F31 | 2026-10-14：systemd 255（255.4-1ubuntu8.17），内核 6.18.33.1-microsoft-standard-WSL2 | lead 实测 |
| F32 | `exec systemd-run --user --scope …` 原地替换进程：外层的 `$$` 和 scope 里的 `$$` 相同（1448508）。scope 在 `app.slice/<unit>.scope` 下 | lead 实测 |
| F33 | 继承的 fd 4 进了 scope 还在（`/proc/self/fd` 有 0 1 2 3 4） | lead 实测 |
| F34 | 环境只给 `PATH` 和 `XDG_RUNTIME_DIR=/run/user/<uid>`（没有 `DBUS_SESSION_BUS_ADDRESS`）也能起 scope | lead 实测 |
| F35 | 上限一进 scope 就生效：`-p MemoryMax=256M -p TasksMax=64` 下 `memory.max=268435456`、`pids.max=64`，连读三次不变，`systemctl --user show` 一致。`user@1000.service` 下放了 `cpu memory pids`，`app.slice` 下放了 `memory pids` | lead 实测 |
| F36 | `--expand-environment=no`、`--unit=agent-next-cmd-….scope`、`-p OOMPolicy=continue`、`-p MemorySwapMax=0` 在 scope 上都接受；`memory.swap.max` 读出 0 | lead 实测 |
| F37 | 带 `OOMPolicy=continue`、64 MiB 上限下 python 分配 200 MiB：只有它被杀（退出 137），scope 里的 bash 接着跑；`memory.events` 是 `max 29`、`oom 1`、`oom_kill 1`、`oom_group_kill 0` | lead 实测 |
| F38 | 命令一结束，scope 很快就被删：node 起 `systemd-run --user --scope --quiet --collect … -- bash -c '<把 cgroup 路径写出来>; sleep 0.05'`，跑 30 次。在子进程的 `exit` 事件里读这个 scope 的 `memory.events`，成功 26 次（87%）；在 `close` 事件里读，成功 18 次（60%）。所以只靠命令结束后再读，大约每八条普通命令就有一条要写“说不准”。这是要有看门进程的原因（L1、L7） | lead 实测（systemd 255） |
| F39 | 看门进程：node 起 `systemd-run --user --scope --quiet --collect --unit=… -p MemoryMax=256M -p TasksMax=64 -- /bin/sh -c 'read -r _ <&5 & exec "$@" 5>&-' agent-keeper /bin/bash -c '<把 cgroup 路径写出来>; ls /proc/self/fd; sleep 0.05'`，fd 5 是 Node 的管道，跑 30 次。在子进程的 `exit` 事件里读 `memory.events`，30 次都成功；Host 关掉 fd 5 以后，scope 目录 300 ms 内消失，30 次都是；命令看到的 fd 只有 `0 1 2 3`，没有 fd 5 | lead 实测（systemd 255） |

- 实测还没覆盖的：fd 3 用 `--bind-fd 3` 穿过 systemd-run 挂进 bwrap（同 F33 的继承，由 L5 的金丝雀在每台机器上证明）；`$`、`%` 穿过 systemd-run 和 bwrap 以后原样不变（金丝雀证明）；计数文件的变化通知能不能到 `fs.watch`（不证明，有轮询补充，L7）；看门进程和真的 bwrap 一起用（F39 用的是普通 bash，L5 的金丝雀、RL-01、RL-08b 证明）。
- systemd 的版本：只有 lead 的 systemd 255 核实过（F31、F36）。253、254 两个界线只用来选带不带 `OOMPolicy=continue`、`--expand-environment=no`；某台机器的 systemd 不认带上的选项，systemd-run 就失败，金丝雀过不了，上限报不可用，命令照今天跑并写明（安全）。
- 探测证明不了的，就报不可用，命令照今天跑并写明，不会因此不安全。
- 这些是一台机器的数，不是别的机器上的保证。

### 0.3 lead 定的技术选择

**总的做法：** 只在 `ProcessSandbox.execute` 起子进程的那一处套上限。外面一层 systemd-run 建一个临时 scope，原地 exec 一个小 `sh`：它在后台留一个看门进程，再原地 exec bwrap；bwrap 的参数一个不改。Host 进程在 scope 外，既是 bwrap 的父进程，也是观察者。命令要等 Host 核实了 scope 身份和上限真的生效、记下计数基线，才开始。命令结束后，看门进程替 Host 留着 scope，等 Host 读完最后的计数。不支持的机器照今天跑，并在结果里写明。

- **L1 套在哪里，整条命令行，看门进程。**【lead 定，待审】
  - 有上限时，起的是 systemd-run，不是 bwrap。命令行以此为准（引号的写法可以改，协议不改）：

    ```
    <systemd-run> --user --scope --quiet --collect --unit=agent-next-cmd-<uuid>.scope
      [--expand-environment=no]
      -p MemoryMax=<memoryMaxBytes> -p MemorySwapMax=0 -p TasksMax=<tasksMax>
      [-p OOMPolicy=continue]
      -- /bin/sh -c 'read -r _ <&5 >/dev/null 2>&1 3<&- 4<&- & exec "$@" 5>&-' agent-keeper
         <bwrap> <今天 #arguments 算出的参数，直到 --chdir … -- 为止>
         /bin/bash --noprofile --norc -c <闸门> agent-gate <今天 -lc 的那个字符串>
    ```

  - **看门进程**（lead 2026-10-14 定，依据 F38、F39）：
    - `sh` 先在后台起一个 `read`，从 fd 5 读，停在那里。它留在 scope 里，在沙箱外。然后 `sh` 原地 exec 成 bwrap，exec 时关掉 fd 5（`5>&-`），沙箱里永远没有 fd 5（F39）。
    - fd 5 是 Node 的管道，Host 一直开着自己这一端。Host 读完最后的计数（L7）就关掉它；`read` 读到文件结束，看门进程退出，scope 空了，systemd 把它卸掉（F39：300 ms 内）。
    - 看门进程只留 fd 5：标准输出、错误输出指向 `/dev/null`，fd 3（工作区根）、fd 4（闸门）关掉。它碰不到命令的输入输出，也不进沙箱。
    - 它占 scope 里的 1 个任务（§0.1 告知 1）。
    - 它是 `sh` 在 exec 之前 fork 出来的，所以是外层 bwrap 进程的子进程、和 bwrap 同一个进程组。bwrap 的监视进程不理无关的子进程（bubblewrap 0.9.0 `bubblewrap.c` 535–543 行，Codex 第三次核对）；看门进程不是它的沙箱子进程，不拖延它，也不改它报的退出状态。bwrap 退出后看门进程被收养，照样等 fd 5。
    - **所以有上限时，Host 结束命令的信号只发给 bwrap 这一个进程（`process.kill(pid)`），不发给进程组。** 沙箱里的进程本来就在 bwrap `--new-session` 开的新会话里，不靠进程组信号；bwrap 一死，`--die-with-parent` 和 PID 命名空间让沙箱整个结束，和今天的效果一样。看门进程因此留到 Host 读完。没上限的路径照今天发给进程组。
  - 每一项为什么：
    - `--scope`：systemd-run 建好 scope 后在原进程里 exec（F32），先成 `sh`、再成 bwrap，进程号不变，所以 Host 仍是 bwrap 的直接父进程，`--die-with-parent` 照旧（L12）；
    - `--quiet`：不往命令的错误输出里写 “Running scope as unit”（L5 的金丝雀查输出为空）；
    - `--collect`：结束后连失败的 scope 一起卸掉，不留残余；Host 不用调 `systemctl`；
    - `--expand-environment=no`：systemd 254 起才有；按版本号选，有就带，不让 systemd-run 改写命令里的 `$`（L5 第 3 步、第 6 步）。版本号判错、选项不被认时 systemd-run 失败，金丝雀过不了，上限报不可用（安全）；
    - `MemorySwapMax=0`：不许用交换区，否则内存上限不实；
    - `OOMPolicy=continue`：systemd 253 起 scope 才认；按版本号选，有就带；不被认时同上，金丝雀过不了、上限报不可用。核实过的只有 lead 的 255（F36）。实测带了以后只杀超用的那个进程，scope 里别的进程照常（F37）：systemd 不自己停掉 scope，scope 留到 Host 读完计数、由 Host 结束整条命令（L7、L8）。2026-10-13 没带它时的退出码 143，和“systemd 默认 OOM 后停掉 scope”对得上（推断）。
  - 不用 `OOMPolicy=kill`（内核整组杀）：整组一起没了，计数也跟着没了；整条结束由 Host 做（L8）。
  - systemd-run 的路径取 `CODING_AGENT_SYSTEMD_RUN_PATH`，没有就是 `/usr/bin/systemd-run`，必须是绝对路径。和 bwrap 的 `CODING_AGENT_BWRAP_PATH` 同一个做法（F7）。
  - 没上限时（L5 不可用，或调用方没接上 L15）：一个字节都不变，照今天直接起 bwrap。
- **L2 每次一个 scope，核对身份。**【lead 定，待审】
  - 名字 `agent-next-cmd-<随机 UUID>.scope`，每次 `execute` 新取，不复用。
  - Host 收到闸门的 `r`（L4）以后，读 `/proc/<子进程 pid>/cgroup` 的 `0::<路径>`：最后一段必须正好是这个名字。cgroup 目录是 `/sys/fs/cgroup<路径>`。
  - 对不上就当作没开始（L4），不读、不动那个目录。
  - **同时记下看门进程的 pid：** 读这个 scope 的 `cgroup.procs`，找出 `/proc/<pid>/cmdline` 是看门进程的那一个（`/bin/sh`、`-c`、看门脚本、`agent-keeper`，后面是 bwrap 的路径和参数，和 Host 起 systemd-run 时给的一样），把它的 pid 记下来，收尾时用（L7）。找不到（或不止一个）→ `startup_failed`，原因 `keeper_not_identified`：放行前，给进程组发 SIGKILL，抛 `launch_failed`（L4）。
  - Host 只读自己核对过的那个目录，不调 `systemctl`，不按名字去找或停别的 scope。
  - 命令自己能从 `/proc/self/cgroup` 看到这个名字（沙箱有 `/proc`、没有 cgroup 命名空间），但碰不到用户管理器（L3），没有用处。测试正好用它找到单元（§5.2）。
- **L3 给 systemd-run 的环境和 fd，不漏进命令。**【lead 定，待审】
  - 起 systemd-run 的环境只有两项：`PATH=/usr/bin:/bin`（同今天）和 `XDG_RUNTIME_DIR=/run/user/<uid>`。
    - `XDG_RUNTIME_DIR` 不取 Host 自己的环境变量，按 uid 算；用前确认这个目录存在、属于这个 uid。
    - 不传 `DBUS_SESSION_BUS_ADDRESS`：只给这两项就能起 scope（lead 实测，F34）；别的机器由探测证明（L5）。
    - 进了 bwrap，`--clearenv` 把它清掉，命令看不到（F3）；金丝雀查这一点。
  - fd：0 不给；1、2 是输出管道；3 是工作区根（同今天）；4 是闸门用的双向管道（Node 的 `'pipe'`）；5 是看门进程的管道（L1）。继承的 fd 进了 scope 还在（F33）。
    - fd 3 照今天由 bwrap 挂载后关掉。fd 4 由闸门在 exec 命令之前关掉，命令自己的代码从来看不到它。fd 5 在 `sh` exec 成 bwrap 时就关掉，沙箱里没有（F39）。bwrap 自己的监视进程也关掉继承的 fd，只有沙箱里那一侧拿到它们（Codex 第一轮审查核对过 bubblewrap 0.9.0 的源码）。命令里看不到 3、4、5，金丝雀查。
    - Host 的别的 fd 都带 close-on-exec，不会传下去。
  - 沙箱里没有 `/sys`、`/run`（F3）：命令读不到 cgroup 文件，连不上用户管理器，改不了自己的上限。金丝雀查。
- **L4 起跑闸门、“可能已开始”的界线、一次执行一个结算状态。**【lead 定，待审】
  - 闸门是 bwrap 里先跑的一小段 shell，只管起跑前等 Host 放行。以此为准（写法可以改，协议不改）：

    ```
    printf r >&4 || exit 125; IFS= read -r -n 1 go <&4 || exit 125; [ "$go" = g ] || exit 125
    exec 4>&- 4<&- /bin/bash --noprofile --norc -lc "$1"
    ```

    - 先往 fd 4 写一个 `r`，再等 Host 回一个 `g`；收到才关掉 fd 4、原地 exec 今天那条 `bash -lc`。
    - 命令字符串作为参数 `$1` 传进去，不拼进闸门。所以命令的语法错误、报错里的行号、`$0` 都和今天一样。
    - 闸门原地 exec，命令的进程树里不多出 shell：`SHLVL`、错误输出、退出码和信号都和今天一样（RL-02、RL-02b 比对有上限、没上限两条路）。最后的证据由沙箱外的看门进程保住（L1、L7），不靠闸门。
  - Host 这一侧按顺序：
    1. 起 systemd-run。命令的超时照今天从这一刻算（K 片 L16：子进程超时从启动后算），不因闸门往后推；
    2. 等 fd 4 的 `r`。最多等 5 秒，也不超过超时剩下的时间；
    3. 核身份、记下看门进程的 pid（L2）、核上限生效（L6）、读计数基线、开始观察（L7）；
    4. 把状态改成“已放行”，再试着写 `g`。
  - **一次执行一个结算状态：起跑中 → 已放行 → 已结算**（没开始的直接从起跑中到已结算）。只往前走，不回头。
    - **放行：** 第 4 步在试着写 `g` **之前**、同步地改成“已放行”。从这一刻起算“可能已开始”，不管 `g` 写没写成。
    - **停止的原因只记一次：** 超时、取消、Host 因 OOM 结束（L8），哪个先被接受就记哪个，之后来的不改原因。取消和放行抢的时候，取消的处理同步地看状态：还是“起跑中”，就直接结算成没开始；已经是“已放行”，记下原因，按下面停止。Node 是单线程，查和改在同一次同步执行里，不会两边都成立。
    - **停止怎么做：** 接受停止时 bwrap 还没退出，就发信号，只发给 bwrap 这一个进程（L1）：超时、取消发 SIGTERM，并起一个 250 ms 的升级计时器，到时发 SIGKILL；Host 因 OOM 结束直接发 SIGKILL。正在 SIGTERM 的升级里又接受了 OOM 结束：马上 SIGKILL，原因不变。接受停止时 bwrap 已经退出（还没结算）：不发信号，只记原因。
    - **计时器和监听归结算管：** 超时计时器、取消监听、升级计时器一直留到结算（同今天：留到 `close`）。bwrap 一退出就清掉升级计时器；计时器到时 bwrap 已经退出，什么也不做。
    - **收尾只做一次，从 bwrap 退出开始**（Node 的 `exit` 事件），不论它为什么退出：先等静止（最多 1 秒），再读，再核一次，然后关 fd 5（L7）。关 fd 5 也只做一次，不论前面成没成。
    - **起跑失败也是结算里的事件，不在别处另走一条路：**

      | 事件 | 什么时候 | 动作 | 结局 |
      | --- | --- | --- | --- |
      | `spawn_failed` | spawn 报错，没有 pid，可能也不会有 `exit` | 不杀（没有可杀的）；关 fd 5 | 马上结算，抛 `launch_failed` |
      | `startup_failed`，原因 `launcher_exited` | 收到 `r` 之前子进程就退出了（systemd-run 失败） | 关 fd 5 | 收到 `exit`、`close` 以后结算，抛 `launch_failed`，带 systemd-run 错误输出的前 256 字节 |
      | `startup_failed`，原因 `ready_timeout` | 等 `r` 的 5 秒到了 | 给进程组发 SIGKILL（含看门进程）；关 fd 5 | 同上，抛 `launch_failed` |
      | `startup_failed`，原因 `deadline_before_start` | 命令的超时在放行之前到了 | 同上 | 同上，抛 `launch_failed`，原因 `deadline_before_start` |
      | `startup_failed`，原因 `identity_mismatch`、`keeper_not_identified`、`limits_not_effective`、`baseline_unreadable` | 第 3 步的核对没过：scope 身份不对、找不到看门进程的 pid（L2）、上限没生效（L6）、读不了基线（L7） | 同上 | 同上，抛 `launch_failed` |
      | `stop`（取消），还在起跑中 | 放行之前取消 | 同上 | 同上，返回今天“没开始”的取消结果 |

      - 起跑失败或起跑前取消以后，再来的 `release` 不做任何事（不写 `g`）；有 pid 的，等 `exit`、`close` 收走进程以后才结算。
      - 哪些失败作废能力缓存，见下面“已放行之前”。
    - **结算：** bwrap 已退出、收尾做完、fd 5 已关、输出流都关了（今天的 `close`），才算已结算。结果的 `timedOut`、`cancelled` 只看记下的原因：超时就是 `timedOut`，取消就是 `cancelled`，同今天（在 bwrap 退出以后、结算以前接受的取消也算，今天也是这样）。已结算以后来的事一概不理。清理（清计时器、移监听、关 fd 5）都可以重复做，做第二次不出错。
    - 这套规则写成一个纯函数 `settleExecution`（输入当前状态和一件事，给出新状态和要做的动作），`#run` 只照它给的动作去做；RE0 按各种先后测它（RL-22），因为真机上卡不准这些时刻。
  - **“已放行”之前，命令一定没跑。** 这时出任何问题都当作没开始，按上表给进程组发 SIGKILL（看门进程也一起结束，没开始的不用留证据；放行之前照旧发给整个进程组，只给 bwrap 发信号只在放行以后）：
    - systemd-run 失败退出、等 `r` 的 5 秒到了、身份或上限对不上、读不了计数：抛 `launch_failed`，消息带原因和 systemd-run 错误输出的前 256 字节；这个键的能力缓存作废（L5）；
    - 超时在“已放行”之前就到了：抛 `launch_failed`，原因 `deadline_before_start`（确定没开始），不报 `timedOut`；缓存不作废（不是机器的问题）；
    - 起跑前已取消：返回今天“没开始”的取消结果（F2），缓存不作废。
  - **“已放行”以后**，不论出什么事（命令失败、被杀、读不到计数），结果照实报，不重跑（L11）。
  - Host 死了：见 L12。闸门读到文件结束（或写 `r` 时出错）就退出，命令不跑。
  - 只有有上限的路径用闸门、看门进程和这套结算；没上限的路径和今天一样。
- **L5 能力探测。**【lead 定，待审】
  - 函数 `probeResourceCaps()`，按顺序查，第一步不过就是那个原因：

    | 步 | 查什么 | 不过的原因 |
    | --- | --- | --- |
    | 1 | `process.platform` 是 linux | `not_linux` |
    | 2 | `/sys/fs/cgroup/cgroup.controllers` 读得到（cgroup v2） | `no_cgroup_v2` |
    | 3 | systemd-run 路径是绝对路径、能执行；跑 `systemd-run --version`，取第一行的版本号：253 及以上带 `-p OOMPolicy=continue`，254 及以上再带 `--expand-environment=no`；读不出版本就两样都不带 | `no_systemd_run` |
    | 4 | `/run/user/<uid>` 是这个 uid 的目录，里面有 `systemd/private` | `no_user_session` |
    | 5 | `ProcessSandbox.probe` 说 bwrap 可用（同一个 bwrap 路径） | `sandbox_unavailable` |
    | 6 | 用 Kernel 的 `WorkspaceSandbox` 在 Host 私有的空临时目录上建一个工作区，走和 `execute` **同一段**起跑代码（L1–L4、L6）跑一条金丝雀，上限取固定的 256 MiB、64 个；用完删掉临时目录 | 见下 |

  - 第 6 步怎么判：
    - 收到 `r` 之前 systemd-run 就退出了：错误输出里有 `Failed to connect to bus` 或 `Failed to create bus connection` → `no_user_session`；否则 `probe_failed`。
    - scope 的 cgroup 里没有 `memory.max` 或 `pids.max`，或值不是 268435456 和 64，或有 `memory.swap.max` 而不是 0 → `controllers_not_delegated`。
    - 金丝雀命令在沙箱里查（以此为准）：
      - 字面量 `'${XDG_RUNTIME_DIR}:$$:%h'` 原样到了（长度 24）；不对就退出 3 → `literal_arguments_not_preserved`；
      - 环境里没有 `XDG_RUNTIME_DIR`；`/proc/self/fd/3`、`/proc/self/fd/4`、`/proc/self/fd/5` 不在；`/run/user`、`/sys/fs/cgroup` 不在；任何一条不对就退出 4 → `probe_failed`，明细写“套上限的路径漏了 Host 的东西”。
    - 必须退出码 0，而且标准输出、错误输出都是空的（证明 `--quiet` 管用，命令的输出里不会混进 systemd-run 的话）；否则 `probe_failed`。
    - **还要证明看门进程（L1、L7）：** 这条金丝雀的 bwrap 退出以后，收尾要读全：在同样最多 1 秒的等待里静止下来（`cgroup.procs` 只剩认得出的看门进程），两个计数文件读成功，再核时没变；Host 关掉 fd 5 以后，scope 目录 2 秒内消失（F39 量的是 300 ms 内）。任何一条不对 → `probe_failed`，明细写“看门进程没通过”。
    - 一次探测只跑这一条金丝雀（一个探测批次，RL-15）。全程最多 10 秒，超了 `probe_failed`。
  - **什么时候跑：**
    - 第一次要套上限的 `execute`（懒）；
    - 正式入口 `main.ts` 在 `listen` 之后后台跑一次，结果只进缓存，失败不影响启动（给设置页看，§0.1 告知 8）。测试里建的 Host 不跑它。
  - **缓存：** 按（systemd-run 路径、bwrap 路径、uid）在 Host 进程里缓存结果；同时只跑一个（共用同一个 Promise）。
  - **作废：** L4 “已放行”之前失败（取消和 `deadline_before_start` 除外）就作废这个键的缓存，下一条命令重新探测；那时探测不过，下一条命令就照今天跑，写明没有资源上限。
  - **上限不可用 ≠ 沙箱不可用。** 步骤 1–6 不改 `ProcessSandbox.probe` 的结果，也不改 Kernel 的 `isolated_process` 能力（F9）。
  - 只读函数 `resourceCapStatus()` 读缓存，不探测；没探测过是 `unknown`。
- **L6 每条命令起跑前，核实上限真的生效。**【lead 定，待审】
  - L4 第 3 步、“已放行”之前，读这个 scope 的 `memory.max`、`pids.max`、`memory.swap.max`（有才读），和这次要的值比：`memory.max` 等于 `memoryMaxBytes`，`pids.max` 等于 `tasksMax`，`memory.swap.max` 是 0。
  - 值用 1 MiB 的整数倍（L13），内核按页取整后不变，可以逐字比。
  - 不对就是 L4 的“没开始”。
  - 所以结果里写的 `applied` 和两个数，是这条命令实际生效的值，不是“以为”（实测一进 scope 就生效，F35）。
- **L7 观察和留证：在 scope 外读；计数取见过的最大值；bwrap 退出后等静止，再读、再核；记下读全了没有。**【lead 定，待审】
  - 观察者就是 Host 进程，在 scope 外（L1）。scope 里被杀的进程不会带走证据。
  - “已放行”之前读一次基线：`memory.events` 的 `max`、`oom`、`oom_kill`、`oom_group_kill`（没有这一项按 0），`pids.events` 的 `max`。读不了是“没开始”。基线可以不是 0。
  - 之后两种方式都读：
    - 监听这两个文件的变化通知（`fs.watch`）；
    - 每 100 ms 读一次，补通知的不足。
  - **计数只增不减，证据取见过的最大值。** 每次读成功，每个计数都和已存的值比，取大的（纯函数 `mergeResourceCapCounters`）。读失败不改任何值；晚回来的旧读也只能把值往上推，盖不掉更新的值。Δ = 见过的最大值 − 基线。
  - **上面两种读都不保证读到最后的变化。** 内核的变化通知是异步送达的；scope 删掉以后，即使文件已经打开，再读也会失败（Codex 第一轮审查第 1 条，引 v6.18 的 `fs/kernfs/file.c`）。所以要有下面的收尾。
  - 监听建不起来（例如监听数到了上限）只用轮询，不算失败。
  - **bwrap 退出时，命令的子孙不一定已经没了。** bubblewrap 的监视进程在命令本身退出时，就带着它的退出状态返回，不等沙箱里 1 号进程下面的子孙（bubblewrap 0.9.0 `bubblewrap.c` 506–625 行：`do_init` 经 eventfd 报出命令的退出，监视进程马上返回；Codex 第三次核对）。监视进程一退出，1 号进程随 `--die-with-parent` 被杀，PID 命名空间被拆除，里面剩下的进程才被杀掉，这是异步的。强行结束时也一样。所以不能在 bwrap 一退出就读。
  - **收尾：bwrap 一退出（Node 的 `exit` 事件，不等输出流关闭），不论为什么退出，按顺序做一次（L4 的结算）：**
    1. **等静止：** 最多 1 秒，每 10 ms 读一次 scope 的 `cgroup.procs`，直到里面正好一个 pid，而且它就是放行前记下的看门进程的 pid（L2），`/proc/<pid>/cmdline` 也还是看门进程的。
    2. **读：** 静止了，读 `memory.events`、`pids.events`，各一次，并入最大值。
    3. **再核：** 再读一次 `cgroup.procs`，还是只有这个 pid，cmdline 也没变。
    4. **关 fd 5：** 不论 1–3 成没成，都关，只关一次。看门进程读到文件结束退出，scope 被卸掉（F39：300 ms 内）。
    - 1–3 都成：`observationComplete` 为真。1 秒内没静止：为假（`quiescence_failed timeout`）。剩下的那个 pid 不是记下的、记下的 pid 不见了、cmdline 不对：为假（`quiescence_failed keeper_not_identified`）。读失败、再核时变了：为假。fd 5 照样关。
    - 用记下的 pid 而不只看 cmdline：一个长得一样的进程、或 pid 被重用，都骗不过。
    - 为什么这样就够：静止以后 scope 里只剩看门进程，它只在 `read`，不分配内存、不建进程，所以 2 和 3 之间不会有新的事件；3 证明这段时间里没有别的进程出现。
  - **读不全只影响否定的结论。** `observationComplete` 为假时，不能说“没有”（L9 写 `uncertain`、`unknown`）；但任何一次读成功看到的 Δoom、Δpids.max 都留着，照样是 `cap_hit`。
  - `observationComplete` 写进结果（L10）。
  - lead 在 WSL 量普通命令读全的比例（§5.2 末尾），正常结束的应当接近 100%。F39（30/30）用的是普通 bash，没有 bwrap，证明不了 bwrap 的生命周期；带 bwrap 的比例由这项验收和 RL-01、RL-02c 证明。
  - 不用 systemd 的单元结果（`Result=oom-kill`）：它本身也是看 `oom_kill`，加了 `--collect` 以后也读不到。
- **L8 内存超限结束整条命令；进程数超限只报告。**【lead 定，待审】
  - bwrap 还没退出时读到 `oom_kill` 或 `oom_group_kill` 比基线多：Host 接受一次“因 OOM 结束”（L4 的结算），马上给 bwrap 发 SIGKILL（只发给 bwrap，L1）。bwrap 一死，PID 命名空间里的进程全部结束，整条命令结束。
    - 不先发 SIGTERM：内存紧的时候，处理信号也要内存。
    - 不论这次 OOM 是不是本上限引起的：命令里已经有进程被杀，剩下的往往只是半截。结束整条命令和怎么归因是两回事。
    - **归因：只有 Δoom > 0 才是 `cap_hit`；否则照 L9。** 例如被杀的是子进程、命令自己处理掉并马上退出 0：轮询、通知或收尾里任何一次读成功看到 Δoom（L7 的最大值），就是 `cap_hit`，收尾读没读全都一样；如果是整机或上一层的 OOM 杀的，这个 scope 的 `oom` 不一定加，就照 L9 写 `uncertain`。
    - systemd 253 以前不认 scope 的 `OOMPolicy`。那时 systemd 会不会在 OOM 后自己停掉 scope，本稿没有核实；就算停了，也是整条结束，只是计数可能读不全，归因落到 `uncertain`。
  - 进程数：内核拒绝 `fork`／`clone`（`Resource temporarily unavailable`），不杀；线程也算。Host 不因此结束命令。命令可能自己处理掉、甚至退出码 0；成败照退出码，另写 `processes`（L9）。
  - 超时和取消照今天（F2、L12）。
- **L9 归因：只认本地的证据；读不全就说不准。**【lead 定，待审】
  - 纯函数 `attributeResourceCapEvents`。输入：基线、每个计数见过的最大值（L7）、`observationComplete`。Δ 是“最大值”减“基线”。
  - **读不全只挡否定的结论。** 下表先看有没有看到事件；看到了就照实写，不管读没读全。只有没看到事件时，才看读没读全：读全了写“没有”，没读全写“说不准”“不知道”。
  - **不看退出码和信号。** 它们照原样放在结果里，从不当上限的证据（137、143 也一样，第 18 条）。
  - 内核文档 cgroup-v2 “Memory Interface Files” 一节对 `memory.events` 各项的说法（意译）：
    - `max`：用量要越过 `memory.max` 的次数；直接回收压不下来，才进入 OOM 状态。
    - `oom`：这个 cgroup 的用量到了上限、分配就要失败的次数。
    - `oom_kill`：属于这个 cgroup、被杀掉的进程数，原文是 “by any kind of OOM killer”，整机的 OOM 也算。
    - 所以只有 Δoom 是“这条命令自己碰到了上限、为它调用了 OOM killer”的本地证据；Δmax 只是压力；Δoom_kill 分不出是谁杀的。
  - memory，从上往下第一条命中：

    | 条件 | memory |
    | --- | --- |
    | Δoom > 0 | `cap_hit` |
    | Δoom_kill > 0 或 Δoom_group_kill > 0（Δoom = 0：有进程被 OOM 杀了，但不是本上限的证据，多半是整机内存不够） | `uncertain` |
    | `observationComplete` 为假，也没看到上面两行的事件 | `uncertain`（不论退出码：事件可能来不及读到。有看门进程以后，只有 1 秒内没静止、看门进程被杀、读或再核失败才会这样，L7） |
    | 其余（读全了，没有 OOM 事件；只有 Δmax 的也在这里） | `none_observed` |

  - processes，从上往下第一条命中：

    | 条件 | processes |
    | --- | --- |
    | Δpids.max > 0 | `cap_hit` |
    | `observationComplete` 为假 | `unknown` |
    | 其余 | `none_observed` |

    - 正常结束时靠看门进程和静止等待读全；没读全、又没看到事件时写 `unknown`，不写“没有”。
    - **`cap_hit` 的意思**（结果和界面都照这句，L10）：有新进程或线程的创建被任务数上限拒绝了。通常是这条命令的上限；在 6.11 以前的内核上，或挂载时带 `pids_localevents` 的，也可能是上一层（例如用户 slice）的上限。
    - 依据：6.11 起内核把 `pids.events` 的 `max` 记在上限被碰到的那一层（scope 是叶子，只在它自己的上限被碰到时加）；之前的内核、或带 `pids_localevents` 的，记在发起 fork 的那一层（Codex 第一轮审查第 8 条，引 v6.11 的 `kernel/cgroup/pids.c`）。用户 slice 的上限通常远大于 512，lead 接受这点误差，写进已知限制。
  - `none_observed` 只在读全了的时候出现，意思是“读全了，没有这种事件”。
- **L10 结果里写什么。**【lead 定，待审】
  - **原始报告：** Kernel 的 `ProcessExecutionResult.resourceCaps` 总有。三种：
    - 有上限、命令已放行：`{ status: 'applied', memoryMaxBytes, tasksMax, memory, processes, observationComplete }`；
    - 没上限：`{ status: 'none', reason, text }`；
    - 命令没开始（启动前已取消，或“已放行”之前取消）：`{ status: 'not_started' }`。“已放行”之前的其它失败抛 `launch_failed`，没有结果对象（L4）。
  - 几个值的意思（结果和界面都照这几句）：

    | 值 | 意思 |
    | --- | --- |
    | `memory: 'cap_hit'` | 超出了这条命令的内存上限 |
    | `memory: 'uncertain'` | 有进程被 OOM 杀了、或者证据没读全，归不到这条命令的内存上限 |
    | `memory: 'none_observed'` | 读全了，没有内存上限的事件 |
    | `processes: 'cap_hit'` | 有新进程或线程的创建被任务数上限拒绝了：通常是这条命令的上限；6.11 以前的内核或带 `pids_localevents` 时，也可能是上一层的上限（L9） |
    | `processes: 'unknown'` | 没读全，不知道有没有被拒 |
    | `processes: 'none_observed'` | 读全了，没有被拒 |

  - `none` 的 `text` 取下面固定的表（以此为准）：

      | reason | text |
      | --- | --- |
      | `not_linux` | 没有资源上限：本机不是 Linux 或 WSL |
      | `no_cgroup_v2` | 没有资源上限：本机没有 cgroup v2 |
      | `no_systemd_run` | 没有资源上限：找不到 systemd-run |
      | `no_user_session` | 没有资源上限：没有 systemd 的用户会话 |
      | `controllers_not_delegated` | 没有资源上限：内存和进程数的控制没有下放给当前用户 |
      | `literal_arguments_not_preserved` | 没有资源上限：本机的 systemd-run 会改写命令参数 |
      | `sandbox_unavailable` | 没有资源上限：进程沙箱不可用 |
      | `probe_failed` | 没有资源上限：探测失败 |
      | `not_configured` | 没有资源上限：这个调用方没有接上资源上限设置 |

    - `sandbox_unavailable` 只会出现在设置页的本机状态里：沙箱不可用时命令照今天被拒，没有执行结果（规则 1）。
    - 报告序列化后最多 512 字节（实际约 120–240 字节）。
  - **原始报告和最后的工具结果分开说：**
    - 原始报告（`ProcessExecutionResult`、检查的观察记录、命令页的快照）总带 `resourceCaps`；
    - 最后交给模型的工具结果也带它，**只有**冻结分派器已有的盖层规则例外（F23a），照旧不改：
      - 上层信号被中止（执行被取消）：分派器换成 `cancelled`、`output: []`；
      - 分派器自己的计时器到过、处理器的结果又不是 `timeout` 错误：换成 `timeout` 错误，`output` 只有一段文字“工具执行超时”；
      - 处理器自己报的 `timeout` 错误（子进程超时）原样保留，连同 JSON 里的 `resourceCaps`；
      - 分派器在调用处理器之前就拒的 `sandbox_unavailable`：根本没跑。
    - RL-30、RL-31 按这几条的实际结果断言。
  - 各处怎么带：

    | 哪里 | 带法 |
    | --- | --- |
    | `shell` | JSON 输出项在 `timings` 后面加 `resourceCaps`（沙箱结果里有才加，旧替身的结果没有）。退出码不为 0、超时这两种错误消息：`memory` 是 `cap_hit` 时末尾加“（超出内存上限）”，`processes` 是 `cap_hit` 时加“（有新进程或线程被任务数上限拒绝）”；两种都有就都加。成功和取消不加 |
    | `run_readonly_command` | 同上：JSON 加 `resourceCaps`；`命令退出码 N`、`run_readonly_command 执行超时` 两种消息照同样规则加尾注。M10 的固定消息不加（L14） |
    | 登记的检查 | `CheckProcessObservation` 的 `executed` 加可选的 `resourceCaps`，原样抄；有这一项时，校验查它的形状 |
    | 工作台命令页 | 快照加 `resourceCaps`：结束了、有结果时是报告（含 `not_started`），抛错时是 `null` |

  - `shell` 要改结果，所以 `tools/builtin/shell/shell-tool.ts` 按惯例从 `shell-tool.js.map` 的 `sourcesContent[0]` 逐字提取进受管源，加进 `relativeSources`（F22）。提取本身逐字核对、不改行为；之后只加上面两处。`shell` 的授权、说明文字、每路 64 KiB 都不改。
  - 不加新的错误码（M10）。碰到上限不是一种新状态：成败照退出码，照今天。
- **L11 从不“去掉上限再跑一次”。**【lead 定，待审】
  - 一次 `execute` 只起一次跑命令的子进程。能力探测、`bwrap --version` 和各种金丝雀是另外的子进程，不算在“一次”里；看门进程是这一次起跑的一部分，不跑命令。
  - L4 “已放行”之前失败：报 `launch_failed`，不再起任何东西。“已放行”以后：不论命令失败、被杀、读不到计数，都照实报，再也不起第二次。
  - 没有“套上限失败就去掉上限再跑”的分支，也不在同一次调用里重新探测。
  - 下一条命令（模型再调、检查下一轮）按作废后的新探测走；那是另一次调用。
  - 平台各处也不重试：`shell`、只读命令、检查、命令页拿到 `launch_failed` 都直接报（F22、F24、F25），不再调 `execute`。
- **L12 取消、超时、Host 死：命令不会在 Host 死后开始。**【lead 定，待审】
  - 取消和超时：照今天的 SIGTERM、250 ms 后 SIGKILL（F2），但有上限时只发给 bwrap 这一个进程，不发给进程组（L1），由 L4 的结算管。bwrap 一死，PID 命名空间里的进程全部结束。Host 在 bwrap 退出时读最后一次（L7），然后关 fd 5，看门进程退出，scope 变空，systemd 把它卸掉（`--collect`）。不另调 `systemctl`。
  - Host 死在“已放行”以后：bwrap 的 `--die-with-parent` 已经对 Host 生效（闸门在 bwrap 起好以后才写 `r`，Host 收到 `r` 时一定还活着），bwrap 被杀，整条命令结束。内核关掉 Host 那一端的 fd 5，看门进程读到文件结束退出，scope 被卸掉。
  - 看门进程在 bwrap 退出之前被别的东西杀了：命令照常跑完，只是 scope 可能在最后一次读之前就没了，走“没读全”（L7、L9）。
  - Host 死在“已放行”以前：**命令一定不会开始。保证只到这里，不保证马上清理。**
    - 启动器可能卡在 systemd 里：systemd-run 在 exec bwrap 之前要和用户管理器同步通话、等它答复（Codex 第一轮审查第 3 条，引 systemd v255 的 `src/run/run.c`）。这时 bwrap 还没起来，`--die-with-parent` 还没生效，Host 死了它也不会马上走，要等 systemd-run 返回。
    - systemd-run 返回以后 exec bwrap，闸门写 `r` 出错或读到文件结束，就退出，不跑命令；scope 随之变空，被 systemd 卸掉。systemd-run 失败返回的，不会起 bwrap。
    - 不另扫残留的 scope。
    - 所以本片**不**承诺“Host 死后什么都不留”：放行前卡在 systemd 里的启动器是写明的例外，它可能比 Host 活得久，直到 systemd-run 返回。承诺的是：命令不会在 Host 死后开始；已放行的命令随 Host 结束；看门进程在 Host 那一端的 fd 5 被内核关掉后退出。
  - 实测：RL-08（放行以后 Host 死）、RL-08b（bwrap 已退出、Host 还没读完时 Host 死：看门进程退出）、RL-09（启动器卡住时 Host 死）、RL-09b（闸门等 `g` 时 Host 死）。
- **L13 设置：名字、校验、默认、存哪、怎么到每个构造处。**【lead 定，待审】
  - 名字：Host 设置 `resourceCaps`，两个数 `memoryMaxMiB`、`tasksMax`；`null` 表示用默认。
  - 默认（决定 53，决定 55 改上限）：`memoryMaxMiB = min(floor(本机内存字节 / 2097152), 6144)`，`tasksMax = 512`。本机内存取 `os.totalmem()`。纯函数 `defaultResourceCapSettings`。
  - 保存：新路由 `resource-caps/save`，整份保存，做法同 `automation/save`（F16）。校验：

    | 项 | 合法 |
    | --- | --- |
    | `memoryMaxMiB` | `null`，或整数，256 ≤ 值 ≤ floor(本机内存字节 / 1048576) |
    | `tasksMax` | `null`，或整数，64 ≤ 值 ≤ 65536 |

    - 不合法：`invalid`，什么都不存、不推。
    - 默认值本身不受 256 的下限约束（很小的机器）。
  - 存在哪：私有文件 `host-settings.json` 的可选项 `resourceCaps: { schemaVersion: 1, memoryMaxMiB, tasksMax }`。缺了按默认读；保存别的设置时不补写（同 `automation`）。
  - 启动时读到的值比这台机器的内存还大（换了机器）：照存的值用，不报错。上限比内存大只是不起作用。
  - 推给 Host 的私有快照带生效值（字节和个数），Host 换掉持有者里的值。
  - 怎么到每个构造处：Host 在建平台之前建一个持有者，给出同一个 `ResourceCapSource`（`current()` 每次读持有者）：

    | 构造处 | 怎么拿到 |
    | --- | --- |
    | Kernel 的 `shell`（组合根、恢复组合） | Runtime 在最后一跳（`runObservedModel` 调 Kernel 时）把它并进 `processSandboxOptions.resourceCaps`；Kernel 原样交给 `new ProcessSandbox`（F9） |
    | 只读命令工具 | 工具输入 `resourceCaps`，传给它每次建的 `ProcessSandbox` |
    | 登记的检查 | 检查执行器的依赖 `resourceCaps`，传给 `new ProcessSandbox` |
    | 工作台命令页 | `createWorkbenchTools` 的选项，传给它缓存的 `ProcessSandbox` |
    | Kernel 的探测金丝雀、只读金丝雀 | 不传（L15） |

    - 平台（`createTargetPlatform`）收一个可选的 `resourceCaps`，交给 Runtime 和检查执行器；没给时用按本机内存算的默认值（测试直接建平台时）。
    - 不加平台对象的新成员（平台的可枚举键是一张固定的表）。
    - 每次 `execute` 现读 `current()`，所以设置改了，下一条命令就用新值；已在跑的不变。
  - **上限的值不进任何“配置”：** 不进 Host 授权、配置版本、准备好的执行、摘要和恢复约束（F14、F15、F8）。`effectiveOptions` 把 `resourceCaps` 排除在外。改设置不改任何执行的配置版本。
  - Kernel 再核一次请求：`memoryMaxBytes` 是 1 MiB 的整数倍且不小于 16 MiB，`tasksMax` 是 8 到 4194304 的整数。不对就 `launch_failed`（没开始），不起任何东西。
  - 设置页的本机状态：`HostSettingsAssembly` 加可选的 `resourceCapStatus()`（先例 F18），Host 实现成读 Kernel 的 `resourceCapStatus()`，不触发探测；没有这个成员时是 `unknown`。
- **L14 K 片 B 的规则照旧。**【lead 定，待审】
  - **M10：** 不加错误码。碰到上限的命令按退出码报 `execution_failed` 或成功；起跑失败（含 `deadline_before_start`）是沙箱的 `launch_failed`：只读命令和 `shell` 照 F22、F24 报 `execution_failed`，检查记 `not_started`（F25）。`permission_denied`／`forbidden:` 和固定的 `workspace_changed_during_readonly_command` 消息不变，固定消息不加尾注。同时有外部变化和上限事件时，状态照 K L16 的先后取外部变化，`resourceCaps` 照样在 JSON 里。
  - **M11：** 128 KiB 量的是整条结果（不算 callId）。`resourceCaps` 最多 512 字节，算在里面，从不截。截的先后不变：错误输出、标准输出、路径、非固定的错误消息。加了尾注的消息属于“非固定的错误消息”，最后才可能被截。启动前的拒绝（入参不对、授权已变）没有 `resourceCaps`。
  - **M12：** socket/FIFO 遮蔽、受保护路径的分类、开关收窄、探测和金丝雀用实际选项、cwd 校验，都在 `#arguments` 和起跑之前，本片不碰。有上限时 bwrap 参数逐项相同，只是最后的命令外面多了闸门。K 片 B 第四轮的一次分类（F8a）在起子进程之前，也不受影响。
  - **K §4 第 7 条：** 只读命令不能改工作区、不能联网、不退回主机命令行。有上限的路径仍是同一个 bwrap；没上限的路径和今天一字不差。
  - `shell` 每路 64 KiB 可能让输出超过分派器的上限，是已有的问题（K L16 记过），本片不修；加的字段最多 512 字节。
- **L15 内部金丝雀不套上限；没接上的调用方如实写明。**【lead 定，待审】
  - `ProcessSandbox.probe` 的金丝雀、只读金丝雀是 Kernel 自己的固定命令，照今天跑，不套上限。
  - 套上限的只有 `execute` 跑的命令，加上 L5 自己的金丝雀。
  - 构造时没给 `resourceCaps` 的：照今天跑，结果写 `none`／`not_configured`。生产的每个构造处都接上（L13 的表，RL-34 断言）。
- **L16 自动返工的请知悉带出“超出内存上限”和“调高上限”（决定 55）。**【lead 定，待审】
  - 自动返工的请知悉（`automatic-rework-notices.ts`）：触发这次返工的检查轮次里，有一项检查的观察是 `memory: 'cap_hit'`，摘要后加“检查超出内存上限（当时上限 N MiB）”，`N` 是那次观察记下的上限；条目加操作 `{ kind: 'raise_memory_cap' }`。没有 `cap_hit` 的，请知悉逐字照旧。
  - **读法（lead 2026-10-15 夜按代码定）：** 检查的观察记录（`CheckProcessObservation`）只在 `recordCheckResult` 那一步交给 WorkGraph，变成轮次里这项检查的结果和报告，本身不另存；所以在轮次的检查快照上记一个小字段，不去读检查报告：
    - `RoundCheckSnapshot` 加可选的 `resourceCapHit?: { memory: 'cap_hit'; memoryCapMiB: number }`。`recordCheckResult` 收到 `kind: 'executed'`、`resourceCaps.memory === 'cap_hit'` 的观察时，在写这项检查结果的同一次提交里写上（`memoryCapMiB` 抄观察里记下的上限）；别的情况不写这个字段。旧轮次没有它，读作没有。字段的形状由 `evidence-record-codecs.ts` 校验，写入照旧经 `state/verification-machine.ts` 的检查结果那一步。
    - 请知悉找“触发这次返工的那一轮”：重新入队的那条按 `TaskRequeue.afterRoundRef` 按键读一次轮次（为 null 就没有这一句）；重新检查的那条用轮次链里它的前一轮（它接着的那一轮）。这一轮里有一项检查带 `resourceCapHit`，摘要后加“检查超出内存上限（当时上限 N MiB）”，N 取第一项（按 `checkId` 排）的 `memoryCapMiB`，并加操作 `{ kind: 'raise_memory_cap' }`。读失败照请知悉现有的读失败处理，不当成“没有”。
    - 只读，不另建记录；每条请知悉最多多读一次轮次。
  - 界面（E3）：带这个操作的请知悉显示“调高上限”，点开 Host 设置的内存一项（RE3 的路由）。平台不自动调高。

### 0.4 和别的工作的接缝

- **K 片 B（已合入，9881a2ae）。** 改的是同一个 `process-sandbox.ts`。本片只动起子进程的那一处和最后一项命令；第四轮的一次分类（F8a）和挂载计划在那之前，互不相干。`readonly-command-tool.ts` 本片加一个输入和 JSON 字段，不动它的限长和先后。K 片 B 验收记下的已知限制（受保护路径按路径遮盖、IPC 扫描有界等，`docs/refactor/reviews/evidence/orchestration-slice-K-2026-10-13/partB/lead-acceptance.md`）本片不改，也不让它变坏。
- **K 片 A。** 没有共同的文件：本片不改 `composition-root.ts`、`resume-composition.ts`（`processSandboxOptions` 原样传下去，F9）。
- **K3。** 上限让“一条命令拖垮 Host”变少，崩溃自查照旧。K3 的核对轮跑只读命令，结果里同样有 `resourceCaps`。
- **2B。** 计数只看 `effects`，本片不改 `effects`；`shell` 的 JSON 多一项不影响它。
- **接线包 2（已合入，bb924854）、2A、2C。** 不相干。`host.ts`、`host-settings.ts` 可能和 2B 的路由有文字冲突，合并时顺手处理。
- **E3（界面）。** 设置页“资源上限”一节（两个数、默认、本机状态和原因）；执行详情和命令页显示“已设上限：内存 N MiB、进程 N”或“没有资源上限：……”，`cap_hit` 和 `uncertain` 的说法；检查报告里的上限。
- **合入顺序：** K 片 B 已经合入；和 K 片 A、2A、2B 没有先后要求。

### 0.5 Codex 第 16–19 条答在哪里

| 条 | 要求 | 本稿 |
| --- | --- | --- |
| 16 | 进程数也算线程；拒绝不杀，程序可能处理并成功 | L8、L9；§0.1 告知 1、2；RL-04、RL-05 |
| 16 | MemoryMax 不保证整条结束，也不防总量和整机压力 | L8（整条由 Host 结束）；§0.1 告知 4；以后再问 1 |
| 16 | 探测实际生效的控制 | L5 第 6 步、L6；RL-01、RL-13 |
| 16 | 定整组 OOM 的策略；事件分开报 | L8、L9、L10 |
| 16 | 本机数字只代表一台机器 | §0.1 告知 10；§0.2 末段 |
| 17 | 不只是加个前缀：用户管理器要的可信环境 | L3 |
| 17 | 保住 fd 关闭、取消、父进程死、进程组终止 | L3、L4、L12；RL-02、RL-02b、RL-02c、RL-06、RL-07、RL-08、RL-08b、RL-09、RL-09b、RL-10b、RL-10c、RL-22。进程组终止：有上限时信号只发给 bwrap（看门进程和它同组，要留到最后一次读），沙箱照样整个结束，效果同今天（L1） |
| 17 | 设置传到每个构造处 | L13 的表；RL-34 |
| 17 | 能力探测；唯一的 scope 身份 | L5、L2 |
| 17 | 输出和退出码 | L1（`--quiet`、原地 exec）、L5（金丝雀查输出为空）；RL-02 |
| 17 | 字面参数，能用就带 `--expand-environment=no` | L1；L5 第 3、6 步；RL-02、RL-13 |
| 17 | 保留 K 的 M10–M12 | L14；RL-14、RL-31 |
| 17 | 可能已开始以后，从不去掉上限重跑 | L4、L11；RL-10、RL-36 |
| 18 | 从 scope 外观察，删除前留证，计数增量对上单元和退出事实，允许说不准，137/143 不够 | L2、L7（`observationComplete`）、L9（只认 Δoom；退出事实不当证据）；RL-03b、RL-03c、RL-11、RL-20 |
| 19 | 已定的不再当问题；“没有资源上限”不是绕过不可用的沙箱 | §0.1；规则 1；RL-12 |
| 末句 | 验收用真实的 ProcessSandbox：fd 隔离、取消、Host 死、处理掉的 fork 拒绝、说不准的归因、不支持时的退路 | RE1 各行（§5.2） |

### 0.6 Codex 三次审查怎么处理的

**第一轮**

审查：`D:/cc-lead-notes/codex2/rlspec.review1.md`（按 bb924854，结论“改完下列各条后冻结”）。下表的做法都是 lead 2026-10-14 定的。

| 条 | 审查说的 | 怎么改的 |
| --- | --- | --- |
| 1 | 证据会在没有 `uncertain` 的情况下丢掉：子进程被 OOM 杀、命令处理掉马上退出 0、scope 先被删，最后读到的还是 0；轮询保证不了 | L7 记 `observationComplete`（子进程一退出就读最后一次）；L9：没读全又没看到事件，memory 一律 `uncertain`，不看退出码；processes 加 `unknown`，写明是尽量记；删掉“轮询不会漏”的说法；加 RL-03c（处理掉 OOM 后马上退出 0）。另记一条 lead 量读全比例的验收项 |
| 2 | `{max:1, oom:0, oom_kill:1}` 会被 L9 判成 `cap_hit` | L9 只认 Δoom 是本上限的证据，引内核文档的说法；只有 Δoom_kill/Δoom_group_kill 是 `uncertain`；只有 Δmax 是压力，不算碰到。RL-20 加这个例子 |
| 3 | Host 在放行前死，启动器卡在 systemd 里时不会马上清理 | L12 收窄：只保证命令不会开始；卡住的启动器要等 systemd-run 返回，然后闸门读到文件结束就退出；不扫残留。RL-09 改成“卡到外部放行”，加 RL-09b（闸门等 `g` 时 Host 死） |
| 4 | 超时从 `g` 算和 K 的约定矛盾 | L4：超时照今天从 spawn 算；等 `r` 的 5 秒不超过剩下的时间；放行前到时报 `launch_failed`、原因 `deadline_before_start`。加 RL-07b |
| 5 | RL-01 在命令跑的时候拿不到它打出来的 scope 名 | RL-01 改成：命令把自己的 cgroup 写进工作区的标记文件，等测试放的“放行”标记；测试只用它找 scope，比对写死的上限 |
| 6 | 压力夹具不可靠：分配不碰页、bash 的 fork 会重试、node 线程先碰到内存上限 | §7 的夹具改成 python3：分配后逐页写；fork／线程一直开到 `EAGAIN`、接住、收掉子进程、退出 0；线程用很小的栈停着，内存远低于上限。RL-03、RL-04、RL-05 照改 |
| 7 | 缺几种状态转换和非零基线 | L4 定“可能已开始”= 试着写 `g` 之前那一刻；取消和放行共用一次不可逆的状态变化。加 RL-10b（等 `r` 时取消）、RL-10c（取消和放行抢）、RL-10(d)（放行后失败，绝不再起第二次）；RL-20 加非零基线 |
| 8 | 进程数的 `cap_hit` 可能是祖先的上限；版本界线记错 | L9、L10 写明 `cap_hit` 的意思（结果和界面都照这句）；界线改成核过的 6.11 |
| 9 | “每个结果都写明上限”和 K 的换输出规则冲突 | L10 分开原始报告（总有）和最后的工具结果（K 的取消、分派器到时盖层、调用前拒绝照旧）；RL-30、RL-31 测这几种 |
| 10 | F1 说只有一处 spawn 不对 | F1 改成“跑命令的 spawn 只有一处”，另记 `bwrap --version` 那一处；L11 的“一次”不含探测和金丝雀 |
| 另 | 审查确认：经可信路径设置换进来的假 systemd-run 是依赖替换，不是只给测试的口子，前提是生产代码里没有为它写的分支 | §5 写进做法；§5.4 按审查列出哪些行要真的用户会话 |
| 1 的后续 | lead 量了只靠结束后再读的成功率：`exit` 事件 87%、`close` 事件 60%（F38），约每八条普通命令就有一条写“说不准”，太吵 | 先试了在沙箱里的闸门做交接，第二轮审查指出问题（见下表第 1–4 条），改成沙箱外的看门进程留着 scope（L1、L7；F39：30/30） |

**第二轮**

审查：`D:/cc-lead-notes/codex2/rlspec.review2.md`（按 bb924854，结论“改完下列各条后冻结”；第一轮的 10 条里 8 条已解决、第 9 条部分解决，见下表第 6 条）。下表的做法都是 lead 2026-10-14 定的。第 1–4 条都出在把交接放进沙箱，lead 定改用沙箱外、scope 里的看门进程。

| 条 | 审查说的 | 怎么改的 |
| --- | --- | --- |
| 1 | 交接可能永远等下去（Host 活着但不回 `k`）；收到 `d` 就拿掉超时和取消，改了取消的含义 | 去掉交接。闸门回到第一稿：放行后原地 exec 命令（L4）。看门进程在沙箱外，Host 在 bwrap 退出时读一次就关 fd 5（L1、L7）；超时、取消的计时器和监听照今天留到结算（L4） |
| 2 | 完成和停止要有一条结算规则：缓存的 `d` 晚到、250 ms 的升级、退出后的读 | L4 加一个结算状态：起跑中 → 已放行 → 已结算；停止的原因只记一次；升级计时器归结算管；最后一次读只在 bwrap 退出时做一次；清理可重复。写成纯函数 `settleExecution`，RE0 加 RL-22（超时、取消各在 bwrap 退出前后） |
| 3 | `d` 不能证明命令的子孙都停了（`worker & exit 0`），之后还会有事件 | 闸门原地 exec，最后一次读另查 `pids.current` 是 1，不是 1 就记没读全；加 RL-02c（后台子孙的夹具）。当时写的“bwrap 等 1 号进程退出才退出”不对，第三次核对第 1 条改成先等静止再读（见下表） |
| 4 | 多出来的 bash 不透明：`SHLVL`、错误输出、信号重建 | 闸门不再多一层 shell，删掉退出状态重建；RL-02、RL-02b 照旧比对有上限、没上限两条路的输出、错误输出、退出码和信号 |
| 5 | L8 还有一句无条件判 `cap_hit` | 改成“只有 Δoom > 0 才是 `cap_hit`；否则照 L9” |
| 6 | 分派器测试得不出写的结果：分派器等处理器；盖层是一段文字不是空输出；假的 `cancelled` 不会让分派器丢输出 | 新事实 F23a 写清冻结分派器的盖层规则；L10 照它改；RL-30、RL-31 改用会响应中止（或由测试放行）的替身，真的走上层取消，断言实际的盖层结果 |
| 7 | 测试还要收紧：探测批次、`oomGroupKill`、取消和放行的边界、慢启动器的探测预热 | RL-15 断言一个探测批次；RL-20(14) 保留 `oomGroupKill`，另测原始文本缺这一项时按 0 归一；RL-22 加取消正好在放行前后的边界；慢、卡住的启动器测试先在同一个子 Host 里预热探测，再切换夹具的模式 |

**第三次核对**

核对：`D:/cc-lead-notes/codex2/rlspec.review3.md`（按 bb924854，结论“改完下列各条后冻结”；第二轮的 1、4、5、6、7 已解决，2 部分解决，3 没解决）。核对确认：看门进程不拖延 bwrap 的监视进程、不改它报的状态（`monitor_child()` 不理无关的子进程）；放行后只给 bwrap 发信号，沙箱照样拆除；放行前照旧杀整个进程组。下表的做法都是 lead 2026-10-14 定的。

| 条 | 核对说的 | 怎么改的 |
| --- | --- | --- |
| 1 | 收尾读得全的说法不成立：bubblewrap 的监视进程在命令本身退出时就返回，不等 1 号进程的子孙；先读计数、后看 `pids.current`，中间的事件会漏；只剩 1 个进程也不能说明它就是看门进程 | L7 去掉“bwrap 退出时子孙都没了”，引 bubblewrap 0.9.0 `bubblewrap.c` 506–625 行。收尾改成：最多 1 秒、每 10 ms 看 `cgroup.procs`，等到只剩一个 pid 且 `/proc/<pid>/cmdline` 是看门进程的；再读两个计数文件；再核一次 `cgroup.procs`；最后关 fd 5。不成就记没读全，fd 5 照样关。L4、L5 金丝雀、§2、RL-22、RL-01/02/02b/02c/11 照改；RL-02c 写明期望读全和理由 |
| 2 | 收尾读不全时把读到的正证据也丢了 | L7：计数取见过的最大值，读失败、旧读晚到都不改小（`mergeResourceCapCounters`）；读不全只挡“没有”，看到过的 Δoom、Δpids.max 照样是 `cap_hit`。L8、L9 照改；RL-20 加 (15)（轮询看到 Δoom、收尾没读全 → `cap_hit`）和 (16)（单调并入） |
| 3 | 结算没写起跑失败 | L4 加起跑失败的事件表（`spawn_failed`、`launcher_exited`、`ready_timeout`、`deadline_before_start`、核对没过），放行前杀进程组、关 fd 5、之后的放行不做；§2 的结算类型照加；RL-22 加 (l)–(t) |
| 另 | “Host 死后什么都不留”不是本片的承诺 | L12、规则 10 写明：放行前卡在 systemd 里的启动器是例外 |
| 补 | 只凭 cmdline 认看门进程，挡不住长得一样的进程或 pid 重用（子任务提出，lead 定） | L2：起跑核对时从 `cgroup.procs` 记下看门进程的 pid，找不到就 `startup_failed keeper_not_identified`；L7：静止和再核都要求是这个 pid、cmdline 也对，否则 `quiescence_failed keeper_not_identified`；§2、RL-22 (m)(s) 照改 |

## 1. 范围

### 1.1 交付

1. Kernel 补丁：
   - `process-sandbox.ts`：有上限的起跑（L1–L4）、能力探测和缓存（L5）、生效核实（L6）、观察和归因（L7–L9）、结果字段（L10）；
   - `shell-tool.ts`：从 map 提取进受管源，加 `resourceCaps` 和尾注（L10）；
   - `public-api.ts`：导出 `probeResourceCaps`、`resourceCapStatus` 和新类型；
   - 都用 `scripts/build-kernel-patch.mjs --write` 重新生成，`dist` 不手改。
2. 契约：`src/contracts/resource-caps.ts`（设置、默认、报告的平台形状）；检查观察记录加可选字段。
3. Runtime：依赖 `resourceCaps`；最后一跳并进 Kernel 输入；只读命令工具的输入和结果；检查执行器的依赖和观察记录。
4. Host：持有者；设置的读、存、校验、路由和快照；推来时换值；工作台命令页的选项和快照；`main.ts` 启动后后台探测。
5. WorkGraph 读模型：自动返工的请知悉带“超出内存上限”和 `raise_memory_cap` 操作（L16，决定 55）。
5. 组合：`createTargetPlatform` 的 `resourceCaps` 选项和默认值。

### 1.2 不在本片

- 界面（E3）。
- 所有命令的总上限、Host 自己的上限、按工作区的上限（以后再问）。
- CPU、磁盘、时长的上限（时长照今天的超时）。
- 关掉上限的开关。
- 检查碰到上限的单独分类和单独的决定卡（决定 55 选了 a，不做）。
- `shell` 的已有限长问题。

## 2. 接口（新名字以此为准）

```ts
// vendor/coding-agent/patches/sandbox/process/process-sandbox.ts（新增；标 * 的经 public-api.ts 导出）
export interface ResourceCapRequest { readonly memoryMaxBytes: number; readonly tasksMax: number }   // *
/** 每次 execute 读一次；Host 持有，设置改了就变（L13）。 */
export interface ResourceCapSource { current(): ResourceCapRequest }                                    // *
export type ResourceCapUnavailableReason =                                                              // *
  | 'not_linux' | 'no_cgroup_v2' | 'no_systemd_run' | 'no_user_session'
  | 'controllers_not_delegated' | 'literal_arguments_not_preserved'
  | 'sandbox_unavailable' | 'probe_failed' | 'not_configured';
export type ResourceCapCapability =                                                                     // *
  | { readonly status: 'available' }
  | { readonly status: 'unavailable'; readonly reason: ResourceCapUnavailableReason; readonly detail: string };
export type ResourceCapsReport =                                                                        // *
  | { readonly status: 'applied'; readonly memoryMaxBytes: number; readonly tasksMax: number;
      readonly memory: 'cap_hit' | 'none_observed' | 'uncertain';
      readonly processes: 'cap_hit' | 'none_observed' | 'unknown';
      readonly observationComplete: boolean }                       // L7：静止（只剩看门进程）以后读成功、再核没变
  | { readonly status: 'none'; readonly reason: ResourceCapUnavailableReason; readonly text: string }
  | { readonly status: 'not_started' };                             // L10：命令没开始
export const RESOURCE_CAP_NONE_TEXT: Readonly<Record<ResourceCapUnavailableReason, string>>;           // * L10 的表
export interface ResourceCapCounters {
  readonly memory: { readonly max: number; readonly oom: number; readonly oomKill: number; readonly oomGroupKill: number };
  readonly pids: { readonly max: number };
}
/** L9 的纯函数。只从本模块导出（RE0 直接引这个模块），不进 public-api。 */
export function attributeResourceCapEvents(input: {
  readonly baseline: ResourceCapCounters; readonly maxSeen: ResourceCapCounters;   // 见过的最大值（L7）
  readonly observationComplete: boolean;                            // 不收退出码和信号（L9）
}): { memory: 'cap_hit' | 'none_observed' | 'uncertain'; processes: 'cap_hit' | 'none_observed' | 'unknown' };
/** 读到的原始文本 → 计数。缺的项（例如老内核没有 oom_group_kill）按 0。只从本模块导出（RL-20(14)）。 */
export function parseResourceCapCounters(memoryEvents: string, pidsEvents: string): ResourceCapCounters;
/** 逐项取大（L7）：读成功才并入；顺序无关，旧读晚到也只会往上推。只从本模块导出（RL-20(15)(16)）。 */
export function mergeResourceCapCounters(seen: ResourceCapCounters, read: ResourceCapCounters): ResourceCapCounters;
/** L4 的结算：一次执行一个状态，输入一件事，给出新状态和要做的动作。只从本模块导出（RL-22）。 */
export type SettlementPhase = 'starting' | 'released' | 'settled';
export type StopReason = 'timeout' | 'cancel' | 'host_oom_kill';
export type StartupFailure = 'launcher_exited' | 'ready_timeout' | 'deadline_before_start'
  | 'identity_mismatch' | 'keeper_not_identified' | 'limits_not_effective' | 'baseline_unreadable';
export type FinalizeStep = 'none' | 'waiting_quiescence' | 'reading' | 'rechecking' | 'done';
export interface SettlementState {
  readonly phase: SettlementPhase;
  readonly hasPid: boolean;                           // spawn 成功才有
  readonly keeperPid: number | null;                  // 放行前记下的看门进程 pid（L2），收尾时只认它
  readonly stopReason: StopReason | null;             // 只记第一次接受的，之后不改
  readonly startupFailure: StartupFailure | 'spawn_failed' | null;
  readonly bwrapExited: boolean; readonly finalize: FinalizeStep; readonly observationComplete: boolean;
  readonly keeperClosed: boolean; readonly streamsClosed: boolean; readonly escalationPending: boolean;
}
export type SettlementEvent =
  | { readonly kind: 'spawned' }
  | { readonly kind: 'keeper_recorded'; readonly pid: number }   // L2：起跑核对时找到的看门进程
  | { readonly kind: 'spawn_failed' }                 // 没有 pid，可能也不会有 exit
  | { readonly kind: 'startup_failed'; readonly reason: StartupFailure }
  | { readonly kind: 'release' }                      // 试着写 g 之前
  | { readonly kind: 'stop'; readonly reason: StopReason }
  | { readonly kind: 'escalation_due' }
  | { readonly kind: 'bwrap_exited' }                 // Node 的 exit
  | { readonly kind: 'quiescent' }                    // cgroup.procs 只剩认得出的看门进程
  | { readonly kind: 'quiescence_failed'; readonly reason: 'timeout' | 'keeper_not_identified' }   // 后者：剩下的不是放行前记下的 pid，或它不见了、cmdline 不对
  | { readonly kind: 'final_read_done'; readonly ok: boolean }
  | { readonly kind: 'recheck_done'; readonly unchanged: boolean }
  | { readonly kind: 'streams_closed' };
export type SettlementAction =
  | { readonly kind: 'kill_group' }                   // 放行前：SIGKILL 整个进程组（含看门进程）
  | { readonly kind: 'signal_bwrap'; readonly signal: 'SIGTERM' | 'SIGKILL' }   // 放行后：只给 bwrap
  | { readonly kind: 'start_escalation' } | { readonly kind: 'clear_escalation' }
  | { readonly kind: 'wait_quiescence' }              // 最多 1 秒，每 10 ms 看 cgroup.procs
  | { readonly kind: 'read_final' } | { readonly kind: 'recheck_procs' }
  | { readonly kind: 'close_keeper' }                 // 关 fd 5，只一次
  | { readonly kind: 'finish'; readonly outcome:
      | { readonly kind: 'result' }                   // 照实报结果，带 observationComplete
      | { readonly kind: 'not_started_cancelled' }
      | { readonly kind: 'launch_failed'; readonly reason: StartupFailure | 'spawn_failed' } };
export function settleExecution(state: SettlementState, event: SettlementEvent):
  { readonly state: SettlementState; readonly actions: readonly SettlementAction[] };
/** L5：按（systemd-run 路径、bwrap 路径、uid）在进程里缓存；同时只跑一个。 */
export function probeResourceCaps(): Promise<ResourceCapCapability>;                                   // *
/** 只读缓存，不探测。 */
export function resourceCapStatus(): ResourceCapCapability | { readonly status: 'unknown' };           // *

// 原有类型新增
interface ProcessSandboxOptions { /* 原有 */ readonly resourceCaps?: ResourceCapSource }   // 不进 effectiveOptions（L13）
interface ProcessExecutionResult { /* 原有 */ readonly resourceCaps: ResourceCapsReport }   // 原始报告总有（L10）
// ProcessSandboxError 的 launch_failed 消息以原因开头，放行前到时是 `deadline_before_start: …`（L4）；错误码不加
// fd 4 上的闸门协议（L4，只在有上限的路径）：闸门 → Host `r`（沙箱起好了）；Host → 闸门 `g`（放行）。
//   闸门随后关掉 fd 4、原地 exec 命令；命令的进程里没有 fd 4。
// fd 5 是看门进程的管道（L1）：Host 一直开着自己这一端，收尾（等静止、读、再核）做完就关掉，失败也关；
//   看门进程在沙箱外、scope 里，占 1 个任务，只留 fd 5；沙箱里没有 fd 5。
// effectiveOptions 的类型：Required<Omit<ProcessSandboxOptions, 'workspaceMode' | 'ipcWalkMaxEntries' | 'resourceCaps'>>
```

```ts
// vendor/coding-agent/patches/tools/builtin/shell/shell-tool.ts（新的受管源，逐字提取后只改这两处）
// JSON 输出项：{ exitCode, signal, stdout, stderr, sandboxProfileVersion, timings, resourceCaps? }
// 消息：`shell 退出码 N`、`shell 执行超时` 按 L10 加尾注
```

```ts
// src/contracts/resource-caps.ts（新；平台契约不引 vendor 类型，报告和原因是 Kernel 的同形副本）
export const MIB = 1_048_576;
export const RESOURCE_CAP_DEFAULT_TASKS_MAX = 512;
export const RESOURCE_CAP_DEFAULT_MEMORY_CEILING_MIB = 6144;
export const RESOURCE_CAP_MIN_MEMORY_MIB = 256;
export const RESOURCE_CAP_MIN_TASKS = 64;
export const RESOURCE_CAP_MAX_TASKS = 65_536;
export type ResourceCapSettingsV1 = { schemaVersion: 1; memoryMaxMiB: number | null; tasksMax: number | null };
export function defaultResourceCapSettings(totalMemoryBytes: number): { memoryMaxMiB: number; tasksMax: number };
export type ResourceCapUnavailableReasonV1 = /* 同 Kernel 的 ResourceCapUnavailableReason */;
export type ResourceCapsReportV1 = /* 同 Kernel 的 ResourceCapsReport */;
```

```ts
// src/app/host-settings-types.ts
export type SettingsResourceCaps = {
  memoryMaxMiB: number | null; tasksMax: number | null;          // 存的值；null 是默认
  defaults: { memoryMaxMiB: number; tasksMax: number };
  effective: { memoryMaxMiB: number; tasksMax: number };
  machine: { status: 'unknown' } | { status: 'available' }
    | { status: 'unavailable'; reason: ResourceCapUnavailableReasonV1; text: string };
};
HostSettingsSnapshot.resourceCaps?: SettingsResourceCaps;          // 可选，同 automation
export type SaveResourceCapSettings = { memoryMaxMiB: number | null; tasksMax: number | null };
SettingsRoutes['resource-caps/save']: { input: SaveResourceCapSettings; value: HostSettingsSnapshot };

// src/app/host-settings.ts
HostSettingsPrivateSnapshot.resourceCaps: { memoryMaxBytes: number; tasksMax: number };   // 生效值；F19 那处字面量一起改
HostSettingsAssembly.resourceCapStatus?(): ResourceCapCapability | { status: 'unknown' };
PersistedSettingsV1.resourceCaps?: ResourceCapSettingsV1;
SETTINGS_ROUTE_SUFFIXES 加 'resource-caps/save'
```

```ts
// 接线（都是可选，生产的每处都接上）
TargetPlatformOptions.resourceCaps?: ResourceCapSource;            // 缺了用按本机内存算的默认值
RuntimeExecutionDependencies.resourceCaps?: ResourceCapSource;
RegisteredCheckRunnerDependencies.resourceCaps?: ResourceCapSource;
WorkbenchToolsOptions.resourceCaps?: ResourceCapSource;
ReadonlyCommandToolInput.resourceCaps?: ResourceCapSource;
ObservedModelRunOptions.resourceCaps?: ResourceCapSource;          // 只在调 Kernel 时并进 processSandboxOptions

// 结果
// run_readonly_command 的 JSON：{ exitCode, signal, stdout, stderr, timedOut, externalChangedPaths,
//   externalChangedPathsOmitted, timings, resourceCaps? }
CheckProcessObservation（executed）.resourceCaps?: ResourceCapsReportV1;
WorkbenchCommandSnapshot.resourceCaps: ResourceCapsReportV1 | null;
```

## 3. 流程行（不新增平台状态行）

| 行 | 何时 | 做什么 | 结果 |
| --- | --- | --- | --- |
| RL1 | 沙箱命令 `execute`，沙箱可用 | 读 `current()`；查能力（有缓存用缓存，没有就探测） | 能用 → RL2；不能用 → 照今天跑，结果 `none` 和原因 |
| RL2 | 套上限起跑（超时从 spawn 算） | systemd-run → `sh` 留下看门进程 → bwrap → 闸门写 `r`；Host 核身份、核上限、读基线、开始观察；状态改成“已放行”，再试着写 `g` | 放行之前出事：杀掉，`launch_failed`（到时是 `deadline_before_start`），机器的问题作废缓存，不重跑；放行之前取消：没开始的取消结果 |
| RL3 | 命令在跑 | 读计数；有进程被 OOM 杀 → 结束整条命令 | — |
| RL4 | bwrap 退出（不论为什么） | 看门进程还留着 scope：最多等 1 秒到只剩看门进程，读两个计数文件、并入最大值，再核一次，关 fd 5；看门进程退出，scope 被卸掉；输出流关了就结算，归因 | 结果带 `applied`、两个数、两项事件和 `observationComplete`（正常结束时为真） |
| RL5 | 取消、超时、Host 因 OOM 结束 | 结算记下第一个原因；只给 bwrap 发信号（SIGTERM 加 250 ms 升级，OOM 直接 SIGKILL） | 整个沙箱结束，然后走 RL4 |
| RL6 | Host 死 | — | 已放行的随 bwrap 结束，看门进程读到文件结束退出；没放行的命令不会开始，卡在 systemd 里的启动器等 systemd-run 返回后由闸门退出 |
| RL7 | 沙箱不可用 | 照今天拒绝 | 不起 systemd-run，不论上限能不能用 |
| RL8 | 保存设置 | 校验、写文件、推给 Host、换持有者的值 | 之后启动的命令用新值 |
| RL9 | 正式入口启动 | `listen` 后后台探测一次 | 设置页显示本机状态 |

## 4. 规则

1. 沙箱不可用，命令照今天拒绝。“没有资源上限”只指在同一个沙箱里不设上限，从不绕过沙箱，也从不退回主机命令行。
2. 能力可用时，每条沙箱命令都套上限。一次调用只起一次跑命令的子进程（探测和金丝雀不算）；套上限起跑失败就报失败，从不去掉上限再跑。
3. 命令只在 Host 核实了 scope 身份、上限真的生效、记下计数基线、把状态改成“已放行”以后才开始。一次执行一个结算状态（起跑中 → 已放行 → 已结算）：取消和放行抢时只有一边成立；起跑失败也是结算里的事件（放行前杀进程组、关 fd 5、之后的放行不做）；停止的原因只记第一个；计时器、监听留到结算；收尾（等静止、读、再核、关 fd 5）只在 bwrap 退出后做一次；清理可重复。超时照今天从 spawn 算。
4. 有进程被 OOM 杀，就结束整条命令。进程数上限只拒绝新建，命令可能自己处理、甚至成功；结果照实写。
5. 归因只用在 scope 外读到的计数，每个计数取见过的最大值，读失败、旧读晚到都不会改小：只有 Δoom 算碰到本上限；退出码和信号从不当证据；看到过的事件从不丢；没读全又没看到事件，memory 写 `uncertain`、processes 写 `unknown`。
6. 原始报告总带 `resourceCaps`。最后的工具结果也带，只有 K 片已有的换输出规则（取消、分派器到时、调用前拒绝）例外。
7. K 片 B 的结果和安全规则不变（M10–M12、K §4 第 7 条）。
8. 上限的值不进配置、授权、准备好的执行、摘要和恢复约束；改设置只影响之后启动的命令。
9. 沙箱里的命令看不到、也改不了自己的上限：没有 `/sys`、没有用户会话的 socket，命令的进程里没有 fd 4、fd 5，环境变量清空。闸门原地 exec 命令，命令的进程树、`SHLVL`、错误输出、退出码和信号都和今天一样。看门进程在沙箱外，只留 fd 5，碰不到命令的输入输出。
10. 命令不会在 Host 死后开始；已放行的命令随 Host 一起结束，看门进程读到文件结束退出。不承诺“Host 死后什么都不留”：放行前卡在 systemd 里的启动器是写明的例外，可能留到 systemd-run 返回，然后由闸门退出（L12）；不扫残留。Host 不去碰别人的 scope。
11. 读取和探测不调用模型。

## 5. 测试（TDD，测试由 DSH 一条一条写）

做法同 K 片 §5、2B §5：
- 用 `.dsh-ref/tdd/` 的 TDD skill，在确认过的入口上一条一条先写失败的测试，再写刚好通过的实现；
- 不读数据库核对；期望值来自规格或手算的例子，不从被测系统读回来；
- 测试名以行号开头；一行里列了几种情况的，每种都要有断言；
- 生产代码里不加只给测试用的口子。机器条件用真机、环境变量（`CODING_AGENT_SYSTEMD_RUN_PATH`、`CODING_AGENT_BWRAP_PATH`）和 Kernel 模块边界的替身来造。经可信的可执行路径设置换进来的假 systemd-run 是依赖替换，不是测试口子（Codex 第一轮审查确认）；前提是生产代码里没有为假程序写的分支，也不读夹具的文件。

### 5.1 测试入口（用户 2026-10-14 同意）

| 入口 | 是什么 | 能抓到 | 抓不到 |
| --- | --- | --- | --- |
| RE0 | **纯规则。** Kernel 模块的 `attributeResourceCapEvents`（手写的基线、最后计数和 `observationComplete`）、`parseResourceCapCounters`（手写的原始文本）、`settleExecution`（手写的事件先后），契约的 `defaultResourceCapSettings`（手算）。只有这一个入口是纯函数：整机 OOM 杀了 scope 里的进程、事件来不及读到、取消正好落在放行或 bwrap 退出的前后，这些真机上造不出来、卡不准 | L9 每一行；L4 结算的每种先后；L13 的默认公式 | 真机会不会给出这些计数和先后 |
| RE1 | **真实上限。** `probeResourceCaps`、`ProcessSandbox.execute`，真实的 `WorkspaceSandbox`、bwrap 和 systemd 用户会话。**要 WSL**，lead 在外面跑（同 K 片的 KE5）。几种机器条件用测试目录里的假 systemd-run 造（经 `CODING_AGENT_SYSTEMD_RUN_PATH`）；Host 死用一个子 Node 进程 | 上限生效、内存超限、fork 被拒、取消、超时、Host 死、fd、环境、字面参数、不支持时的退路、沙箱不可用照拒、不重跑、说不准的归因 | 整机 OOM |
| RE2 | **结果接到各处。** 脚本模型的 Work（`shell`），Query 和写范围为空的 Work（`run_readonly_command`），登记的检查（`runRegisteredCheck`），工作台命令页（Host 路由）。Kernel 沙箱模块用替身（同 K 片的 KE6，F28）：替身给出带 `resourceCaps` 的结果、记下构造选项、在 `execute` 时读 `current()` | 结果映射和尾注；128 KiB；各处都接上、设置现读；沙箱不可用照拒；平台不重试 | 系统层的强制（替身） |
| RE3 | **设置。** `createHostSettings` 配假 assembly（同 `A2-settings-automation.test.ts` 的入口，F18），和真实 Host 的设置路由加重启 | 默认、校验、存取、推给 Host、旧文件、写失败、本机状态 | 界面 |

### 5.2 验收行为

RE1 的约定：
- `execute` 要等命令结束才给出输出，所以测试不从输出里拿 scope 名。要在命令运行中查 scope 的行，命令先把自己的 `/proc/self/cgroup` 写进工作区的“身份”标记文件，再等测试放下“放行”标记文件才往下走（读写模式，工作区可写）。测试读身份只为找到 scope，然后从外面用 `systemctl --user show <单元>` 和 `/sys/fs/cgroup` 核对；期望值是写死的数。不靠列单元，并行的测试互不干扰。
- 上限默认取 256 MiB、64 个（Kernel 层不受设置的下限约束）。
- 压力用 §7 的 python3 夹具，不用 bash 的后台进程，也不用 node 的工作线程。
- 用会睡、会卡住的假 systemd-run 的行（RL-07b、RL-09、RL-09b、RL-10b），都先在**同一个** Host 进程里（子 Node 进程的行就在那个子进程里）以“照常转发”模式跑一次 `probeResourceCaps()`，把探测缓存热好，再切换夹具的模式。否则睡、卡的会是探测，不是要测的那条命令。
- 看门进程用它的参数 `agent-keeper` 认（`/proc/<pid>/cmdline`），只在测试里查。

| 行 | 入口 | 行为 | 期望值来源 |
| --- | --- | --- | --- |
| RL-01 | RE1 | 上限生效：命令把 `/proc/self/cgroup` 写进身份标记，等放行标记。测试读身份找到 scope，在命令等着的时候从外面查：`systemctl --user show` 的 `MemoryMax`、`TasksMax` 是 268435456、64，cgroup 的 `memory.max`、`pids.max`、`memory.swap.max` 是 268435456、64、0（写死的数）。然后放下放行标记。结果 `resourceCaps` 是 `applied`、268435456、64，`observationComplete: true`（正常结束；看门进程留着 scope，Host 在最多 1 秒的等待里等到只剩看门进程，再读、再核），两项都是 `none_observed`。结果返回后 2 秒内这个单元 `not-found`（Host 关了 fd 5，看门进程退出） | L1、L2、L4、L6、L7、L9、L10 |
| RL-02 | RE1 | 套上限和不套上限跑同一组命令，标准输出、错误输出、退出码逐项相同：`printf '%s\n' '${HOME}' '$$' '%h' "$HOME"`（输出 `${HOME}`、`$$`、`%h`、`/home/agent`）；`exit 7`；语法错误 `echo a; )`（退出码 2，bash 自己的报错，行号一样）；`env` 排序后（含 `SHLVL`，没有 `XDG_RUNTIME_DIR`）；`test ! -e /proc/self/fd/3 && test ! -e /proc/self/fd/4 && test ! -e /proc/self/fd/5 && echo ok`；`ls /run/user /sys/fs/cgroup`（都不在）。套上限的错误输出里没有 systemd-run 的话；套上限的每个结果 `observationComplete: true`（在最多 1 秒的静止等待以后） | L1、L3、L4、L7 |
| RL-02b | RE1 | 被信号结束、自己选的大退出码，照原样：命令分别是 `kill -s USR1 $$`、`kill -s TERM $$`、`kill -s INT $$`、`kill -s PIPE $$`、`kill -9 $$`（命令自己的 shell 被信号结束），以及 `exit 137`、`exit 138`、`exit 139`。每条套上限、不套上限各跑一次，标准输出、错误输出（含字节数）、退出码、信号逐项相同；套上限的都是 `observationComplete: true`（在最多 1 秒的静止等待以后）、两项 `none_observed` | L4、L7 |
| RL-02c | RE1 | 命令走了、后台子孙也跟着走（同今天）：命令是“起一个后台的 worker，它等测试放下“继续”标记以后往文件追加 `late`；命令自己往文件追加 `started`，`exit 0`”。结果返回以后测试才放下“继续”标记，3 秒后文件里只有 `started`；套上限、不套上限都一样。**这一行期望读全**：worker 自己不会在 1 秒内退出（它等的“继续”标记在结果返回以后才放），但 bwrap 退出以后，1 号进程随 `--die-with-parent` 被杀，PID 命名空间拆除时 worker 被杀，这在 1 秒的等待以内；所以套上限的结果 `observationComplete: true`，静止时 `cgroup.procs` 只剩看门进程。1 秒内静止不了的情形（读不全）由 RL-22 (l) 覆盖，真机上造不出来 | L7 |
| RL-03 | RE1 | 内存超限：命令先跑内存夹具（分配 1 GiB 并逐页写），它被杀以后接着 `sleep 600`（带标记）。结果：`memory: 'cap_hit'`（命令还活着时就读到了 Δoom）；10 秒内返回（Host 结束了整条命令）；带标记的进程一个不剩；单元 `not-found`；测试进程（就是 Host）还在，紧接着的一条普通命令成功 | L7、L8、L9 |
| RL-03b | RE1 | 被 OOM 杀的正好是主进程：命令只有内存夹具一步。`memory: 'cap_hit'`：轮询、通知或收尾里任何一次读成功看到 Δoom 就够（L7 的最大值，收尾读没读全都一样）；Host 还在 | L4、L7、L8、L9 |
| RL-03c | RE1 | 处理掉 OOM、马上退出 0：命令是“内存夹具作为子进程跑，不管它成败，紧接着 `exit 0`”。`memory: 'cap_hit'`（任何一次读成功看到 Δoom 都算）；结果是退出码 0（命令先退出，收尾或轮询读到），或者被 Host 结束（Host 在命令退出前就读到了）。两种都允许，断言写明 | L4、L8、L9 |
| RL-04 | RE1 | fork 被拒、命令自己处理：fork 夹具一直 fork 到 `EAGAIN`，接住，子进程停 1 秒后全部收掉，打印成功的个数，`exit 0`。结果成功，退出码 0，`processes: 'cap_hit'`，`memory: 'none_observed'`，`observationComplete: true`；打印的个数小于 64（看门进程和沙箱自己也占任务数） | L4、L8、L9 |
| RL-05 | RE1 | 线程也算：线程夹具开停着不动的小线程，直到建不出来，接住，打印成功的个数和峰值 RSS，停 1 秒，`exit 0`。`processes: 'cap_hit'`、`observationComplete: true`；峰值 RSS 小于 64 MiB（上限 256 MiB 的四分之一，证明先碰到的是任务数上限）；成功退出 | L8、L9、§0.1 告知 1 |
| RL-06 | RE1 | 放行以后、bwrap 退出以前取消：命令写标记文件后 `sleep 600`（带标记）。看到标记文件后 abort。结果 `cancelled`；Host 只给 bwrap 发了信号，看门进程活到最后一次读之后；2 秒内带标记的进程一个不剩，单元 `not-found` | L4、L12 |
| RL-07 | RE1 | 放行以后、bwrap 退出以前超时：`timeoutMs` 2000，同样的命令。`timedOut`，其余同 RL-06。bwrap 退出以后、结算以前的超时和取消在 RL-22 测（真机卡不准） | L4、L12 |
| RL-07b | RE1 | 起得慢、超时短：假 systemd-run 睡 2 秒再转给真的，`timeoutMs` 1000。约 1 秒后 `execute` 抛 `launch_failed`，消息以 `deadline_before_start` 开头；不报 `timedOut`；命令的第一步（写标记文件）没有发生；下一次 `execute`（假 systemd-run 不再睡）不重新探测（它的调用记录里没有新的金丝雀） | L4 |
| RL-08 | RE1 | Host 死在放行以后：子 Node 进程用 `ProcessSandbox` 跑 RL-06 的命令（身份标记里写上单元名）；看到标记后给子进程 SIGKILL。5 秒内带标记的进程一个不剩，那个单元 `not-found` | L12 |
| RL-08b | RE1 | bwrap 已退出、Host 还没读完时 Host 死：子 Node 进程跑“往工作区文件追加一行，`sleep 0.5`，`exit 0`”（身份标记里写上单元名）。测试看到那一行就给子进程发 SIGSTOP；1 秒后命令早已结束，单元仍是 `active`，单元里还有看门进程（`agent-keeper`）。然后给子进程 SIGKILL：内核关掉 fd 5，看门进程退出，5 秒内单元 `not-found`；文件里正好一行（命令没有再跑） | L1、L12 |
| RL-09 | RE1 | 启动器卡住时 Host 死：假 systemd-run 把参数记进旁边的文件，然后一直等，直到测试放下“外部放行”文件才 exec 真的。子 Node 进程在它等的时候被 SIGKILL；测试随后放下外部放行文件。10 秒内：命令的第一步（写标记文件）没有发生；闸门已退出（记下的那个单元 `not-found`）。等待期间假 systemd-run 还在，这是 L12 收窄后允许的 | L4、L12 |
| RL-09b | RE1 | 闸门等 `g` 时 Host 死：假 systemd-run 写一个“已启动”文件、睡 1 秒再 exec 真的。测试看到“已启动”就给子 Node 进程发 SIGSTOP（它收不到 `r`、发不了 `g`）；等到记下的单元是 `active`（闸门已在等），再给子进程 SIGKILL。5 秒内：命令的第一步没有发生；单元 `not-found` | L4、L12 |
| RL-10 | RE1 | 不重跑。假 systemd-run 的模式写在它旁边的文件里，探测时都是“照常转给真的”；命令是“往工作区文件追加一行，再按情形退出 3 或 `sleep 600`（带标记）”：(a) 探测以后改成“打印 `Failed to start transient scope unit` 并退出 1”：`execute` 抛 `launch_failed`，文件里没有行，假 systemd-run 这次只被调了一次；下一次 `execute` 先重新探测（它的调用记录里看得到）。(b) 改成“不建 scope、直接 exec bwrap”：身份对不上，`launch_failed`，文件里没有行。(c) 照常，退出 3：退出码 3，`applied`，文件里正好一行。(d) 放行以后失败：命令追加一行后 `sleep 600`，测试从外面对它 `kill -9`：结果照实报回，文件里正好一行，这次 `execute` 只调了一次假 systemd-run（再也没有第二次） | L4、L11 |
| RL-10b | RE1 | 等 `r` 时取消：假 systemd-run 睡 2 秒再转给真的；0.5 秒时 abort。结果是“没开始”的取消（`cancelled: true`、退出码 null、`resourceCaps: { status: 'not_started' }`）；命令的第一步没有发生；记下的单元 5 秒内 `not-found`；下一次 `execute` 不重新探测 | L4、L10 |
| RL-10c | RE1 | 取消和放行抢：跑 50 次，每次在 `execute` 开始后 0–30 ms 里随机的一刻 abort；命令的第一步是往文件追加一行。每一次都满足：`resourceCaps` 是 `not_started` 时文件里没有这次的行；是 `applied` 时结果是取消或正常结束；每次最多一行；每次只调一次假 systemd-run。随机的时刻多半落在放行之前；正好在放行前后的受控边界在 RL-22 (a)(b) | L4 |
| RL-11 | RE1 | 别人杀的：命令带标记 `sleep 600`；测试从外面对这个命令进程 `kill -9`。bwrap 照常退出，在最多 1 秒的静止等待以后读全：`observationComplete: true`，`memory: 'none_observed'`、`processes: 'none_observed'`（从不是 `cap_hit`）；（退出码、信号）和不套上限时同样被 `kill -9` 的结果相同 | L7、L9 |
| RL-12 | RE1 | 沙箱不可用照拒：`CODING_AGENT_BWRAP_PATH` 设成不存在的路径。上限能用、不能用（systemd-run 路径设成不存在）两种都抛 `sandbox_unavailable`；命令没跑（标记文件不在）；假 systemd-run（记参数的那种）一次都没被调 | 规则 1 |
| RL-13 | RE1 | 不支持时照常跑并写明，每种一个例子：systemd-run 路径不存在 → `no_systemd_run`；假 systemd-run 打印 `Failed to connect to bus` 退出 1 → `no_user_session`；假 systemd-run 去掉所有 `-p` 再转给真的 → `controllers_not_delegated`；假 systemd-run 把参数里的 `$$` 换成 `$` → `literal_arguments_not_preserved`。四种都：`probeResourceCaps` 返回这个原因，`resourceCapStatus` 也是；命令照今天跑，输出和 RL-02 不套时一样；结果 `{ status: 'none', reason, text }`，`text` 等于 L10 表里那一行 | L5、L10 |
| RL-14 | RE1 | K 片 B 的真实沙箱行在套上限时照样成立：KB-01（写不了）、KB-03（连不上本地端口；git 读得了、写不了）、KB-04（cwd、环境、继承的 fd）、KB-05（超时、取消、截断）的同样断言，在只读模式加上限下各跑一遍；另外每个结果都是 `applied` | L14 |
| RL-15 | RE1 | 探测和缓存：用照常转发、记参数的假 systemd-run。`probeResourceCaps()` 连调两次都是 `available`，之后 `resourceCapStatus()` 也是；转发记录里只有一个探测批次（一个批次只起一条金丝雀，L5）。版本 253 及以上时参数里有 `OOMPolicy=continue`，254 及以上时有 `--expand-environment=no` | L1、L5 |
| RL-20 | RE0 | 归因，每条一个手写例子。没写基线的，基线全 0，写的是最后的计数；“读全”指 `observationComplete` 为真。(1) max 3、oom 1、oom_kill 1，读全 → memory `cap_hit`；(2) oom 1、oom_kill 0（调用了 OOM killer、没杀进程），读全 → `cap_hit`；(3) **max 1、oom 0、oom_kill 1**，读全 → `uncertain`；(4) oom_group_kill 1、oom 0，读全 → `uncertain`；(5) 只有 max 5，读全 → `none_observed`（只是压力）；(6) 全 0，读全 → 两项都是 `none_observed`；(7) 全 0，没读全 → memory `uncertain`、processes `unknown`；(8) oom 1，没读全 → memory `cap_hit`、processes `unknown`；(9) pids max 2，没读全 → processes `cap_hit`、memory `uncertain`；(10) pids max 2，读全 → processes `cap_hit`、memory `none_observed`；(11) **基线不是 0、没变**：基线 max 7、oom 2、oom_kill 2、pids max 3，最后一样，读全 → 两项都是 `none_observed`（拿绝对值会错判成 `cap_hit`）；(12) **基线不是 0、增加了**：同样的基线，最后 max 9、oom 3、oom_kill 3、pids max 3，读全 → memory `cap_hit`、processes `none_observed`；(13) 同样的基线，最后 oom 2、oom_kill 3（Δoom 0、Δoom_kill 1），读全 → `uncertain`；(14) `oomGroupKill` 留在计数里：`parseResourceCapCounters` 读到没有 `oom_group_kill` 那一行的 `memory.events` 文本时，`oomGroupKill` 是 0；和带这一行、值为 0 的文本得到的计数相同；归因的输入总有 `oomGroupKill`；(15) **轮询看到过 Δoom、收尾没读全**：轮询并入的最大值里 oom 1，收尾失败（`observationComplete` 为假）→ memory `cap_hit`（看到的正证据不丢）；(16) **单调并入**（`mergeResourceCapCounters`）：先并入 {oom 2, pids max 3}、再并入晚到的旧读 {oom 1, pids max 1} → 仍是 {oom 2, pids max 3}；读失败不并入，值不变；两次读按哪个顺序并入，结果一样 | L7、L9 |
| RL-22 | RE0 | 结算（`settleExecution`），每种先后一个例子，断言新状态和动作逐项相同：(a) 起跑中取消 → `kill_group`、`close_keeper`；`exit`、`close` 到了 → `finish` 没开始的取消；之后来的放行没有动作；(b) 同一时刻先取消再放行 → 同 (a)；先放行再取消 → 记 `cancel`，`signal_bwrap SIGTERM` 和 `start_escalation`；(c) bwrap 退出前超时 → SIGTERM、起升级；升级到时 bwrap 还在 → `signal_bwrap SIGKILL`；bwrap 退出 → `clear_escalation`、`wait_quiescence`；`quiescent` → `read_final`；读成功 → `recheck_procs`；没变 → `close_keeper`；输出流关 → `finish`，`timedOut`、`observationComplete` 为真；(d) bwrap 退出后、结算前超时 → 没有信号，只记原因，结算后 `timedOut`；(e) bwrap 退出前取消、退出后取消，各同 (c)(d)，结果 `cancelled`；(f) 先超时再取消 → 原因仍是 `timeout`，只有一次 SIGTERM；(g) SIGTERM 升级中接受 `host_oom_kill` → 马上 SIGKILL，原因不变；(h) 升级到时 bwrap 已退出 → 没有动作；(i) `bwrap_exited`、`quiescent`、`final_read_done` 来两次 → `wait_quiescence`、`read_final`、`close_keeper` 各只有一次；(j) 输出流先关、bwrap 后退出 → 收尾、关 fd 5 以后才 `finish`；(k) 已结算以后来的任何事 → 没有动作；**收尾的失败：**(l) `quiescence_failed`，原因 `timeout`（1 秒内没静止）→ 不读，`close_keeper`，`observationComplete` 为假；(m) `quiescence_failed`，原因 `keeper_not_identified`，三种各一个例子：静止时剩下的唯一 pid 不是放行前记下的 `keeperPid`；记下的 pid 不见了；pid 对、cmdline 不是看门进程的 → 都同 (l)，`observationComplete` 为假，fd 5 照样关；(n) 读失败 → `close_keeper`，为假；再核时变了（`unchanged` 为假）→ `close_keeper`，为假；**起跑失败：**(o) `spawn_failed`（没有 pid）→ 不杀、`close_keeper`、马上 `finish` `launch_failed spawn_failed`；之后不会等 `exit`；(p) `startup_failed launcher_exited` → `close_keeper`，`exit`、`close` 到了 → `finish` `launch_failed`；(q) `startup_failed ready_timeout` → `kill_group`、`close_keeper`，收走后 `finish` `launch_failed ready_timeout`；(r) `startup_failed deadline_before_start` → 同 (q)，`finish` `launch_failed deadline_before_start`，不是 `timedOut`；(s) `startup_failed` 的 `identity_mismatch`、`keeper_not_identified`（放行前找不到看门进程）、`limits_not_effective`、`baseline_unreadable` 各一 → 同 (q)；(t) 起跑失败以后再来 `release` → 没有动作（不写 `g`）；起跑失败以后再来 `stop` → 不改结局 | L4、L7 |
| RL-21 | RE0 | 默认：本机内存 1,000,000,000 字节 → 476；2 GiB → 1024；6 GiB → 3072；7,999,999,999 字节 → 3814；8 GiB → 4096；12 GiB → 6144；15,841 MiB（本机 WSL）→ 6144；64 GiB → 6144。`tasksMax` 都是 512 | L13、决定 53、55 |
| RL-30 | RE2 | `shell`（脚本模型的 Work），替身给：(a) `applied`、两项 `none_observed`、退出码 0 → 成功，JSON 的 `resourceCaps` 和替身给的逐项相同；(b) `applied`、`memory: 'cap_hit'`、SIGKILL、退出码 null → `execution_failed`，消息 `shell 退出码 null（超出内存上限）`；(c) `processes: 'cap_hit'`、退出码 0 → 成功，没有消息；(d) `none`、`no_user_session` → JSON 的 `text` 是“没有资源上限：没有 systemd 的用户会话”；(e) 替身的结果没有 `resourceCaps` → JSON 里没有这一项。冻结分派器的盖层照实断言（F23a），替身的 `execute` 会响应中止：等到它收到的信号被中止（或测试放行）才返回带 `applied` 的结果：(f) 经公开的控制入口真的取消这次执行（上层信号被中止，同 K-B 的 KB-10 做法），替身收到中止后返回 `cancelled: true` → 最后是分派器的 `cancelled`、`output: []`；(g) 用假计时器把时间拨过 `shell` 的 `defaultTimeoutMs`（30 秒），分派器中止处理器的信号，替身返回 `cancelled: true` → 最后是分派器换成的 `timeout` 错误，`output` 只有一段文字“工具执行超时”，没有 `resourceCaps`；(h) 处理器自己的超时：替身给 `timedOut: true` → `shell 执行超时` 错误原样保留，JSON 里有 `resourceCaps`。工具结果按保存的执行历史公开读出 | L10 |
| RL-31 | RE2 | `run_readonly_command`（Query、写范围为空的 Work 各一）：RL-30 的 (a)–(d) 同样映射，尾注加在 `命令退出码 N` 和超时消息上。同时有外部变化和 `memory: 'cap_hit'`：消息是 M10 的固定消息、没有尾注，JSON 里 `reason`、路径、`resourceCaps` 都在。两路输出各 32 KiB、100 条长路径、`none` 带最长的 `text`：整条结果（不算 callId）不超过 128 KiB，`resourceCaps` 逐字完整。入参不对、授权已变这类启动前的拒绝没有 `resourceCaps`。盖层照实断言，做法同 RL-30 (f)–(h)：真的取消 → `cancelled`、`output: []`；假计时器拨过 130 秒 → 分派器的 `timeout` 错误，`output` 只有“工具执行超时”；处理器自己的超时 → `run_readonly_command 执行超时` 原样保留，JSON 里有 `resourceCaps` | L10、L14 |
| RL-32 | RE2 | 登记的检查：替身给 `applied`、`memory: 'cap_hit'`、退出码 137 → 检查报告的观察记录里 `resourceCaps` 原样在，检查照今天算失败。替身抛 `launch_failed` → 观察是 `not_started`、`launch_failed`，`execute` 只被调一次 | L10、L11、决定 55（Q1 选 a） |
| RL-32b | RE2 | 自动返工的请知悉：登记的检查经替身得 `memory: 'cap_hit'`、上限 6144 MiB，检查失败、系统自动返工 → 读请知悉：摘要是今天那一句加“检查超出内存上限（当时上限 6144 MiB）”，带操作 `raise_memory_cap`；同样失败但没有 `cap_hit` 的，请知悉和今天逐字相同、没有这个操作 | L16、决定 55 |
| RL-33 | RE2 | 工作台命令页：结束后快照的 `resourceCaps` 等于替身给的；替身抛 `launch_failed` → 快照有 `error`，`resourceCaps` 是 `null` | L10 |
| RL-34 | RE2 | 每个构造处都接上、设置现读：真实 Host 保存 `memoryMaxMiB: 300`、`tasksMax: 100` 以后，下面每一处的下一条命令，替身的 `execute` 读到 `current()` = `{ memoryMaxBytes: 314572800, tasksMax: 100 }`：Work 的 `shell`、Query 的只读命令、写范围为空的 Work 的只读命令、登记的检查、工作台命令页。一个 Work 在两次工具调用之间保存新值：第一次读到旧值，第二次读到新值；这次 Work 的配置版本在保存前后相同 | L13 |
| RL-35 | RE2 | 沙箱不可用（替身 `available: false`），不论上限状态：`shell`、只读命令被分派器拒为 `sandbox_unavailable`；检查照今天在开始前拒（`unsupported`）；命令页 `unsupported`；替身的 `execute` 一次都没被调 | 规则 1 |
| RL-36 | RE2 | 平台不重试：替身的 `execute` 抛 `launch_failed`：`shell`、只读命令是 `execution_failed`，检查是 `not_started`，命令页有 `error`；四处的 `execute` 各只被调一次 | L11 |
| RL-40 | RE3 | 没有设置文件、或文件里没有 `resourceCaps`：快照的 `memoryMaxMiB`、`tasksMax` 是 `null`，`defaults`、`effective` 都等于按 L13 公式和 `os.totalmem()` 手算的值；推给 Host 的私有快照是这两个值换成字节。assembly 没有 `resourceCapStatus` 时 `machine` 是 `unknown`；有时原样（`available`；`unavailable` 带原因和 L10 的 text） | L13 |
| RL-41 | RE3 | 保存 `{ memoryMaxMiB: 1024, tasksMax: 200 }`：答 ready，快照和私有快照（1073741824、200）对；重开读回。再存 `{ null, 200 }`：内存回到默认。旧文件（没有 `resourceCaps`）保存别的设置以后仍没有这一项 | L13 |
| RL-42 | RE3 | 每种不合法各一个例子，答 `invalid`，不存、不推：`memoryMaxMiB` 为 255、本机上限加 1、1.5、`"512"`；`tasksMax` 为 63、65537、`true`；缺字段；body 不是对象。边界合法：256、本机上限、64、65536 | L13 |
| RL-43 | RE3 | 写文件失败：答 `unavailable`，之前的值不变，不推。推给 Host 失败：答 `unavailable`，已存（同 `automation/save`） | L13、F16 |
| RL-44 | RE3 | 真实 Host 重启：上次存的值启动时就装进持有者（下一条命令读到，用 RL-34 的替身）；设置页的 `machine` 是 Kernel 缓存里的状态（替身给定） | L13 |

另由 lead 在验收时核对，不进测试：
- 有上限时 bwrap 参数和不套时逐项相同（看代码和 RL-02 的记录）；
- 没上限的路径和今天一字不差（看代码 diff）；
- 每条命令多花的时间：WSL 里 `true` 套上限、不套各跑 20 次，记中位数进证据，不设断言（§0.1 告知 10）；
- 读全的比例：WSL 里普通命令（`true`、`git --version`、`node -e` 打印）各跑 50 次，记 `observationComplete` 为真的比例进证据。有了看门进程和最多 1 秒的静止等待，正常结束的应当接近 100%（F39 的 30/30 用的是普通 bash，不含 bwrap；没有看门进程时是 87%，F38）；同时记静止等待用了多久（中位数和最大值）；明显低于这个数，停下查原因再合入。

### 5.3 要改断言的旧测试（lead 写出前后断言，DSH 不自行翻转）

| 测试 | 怎么改 |
| --- | --- |
| `tests/kernel/B2-history-public-export.test.ts:94-110` 的冻结导出清单 | 加 `probeResourceCaps`、`resourceCapStatus`、`RESOURCE_CAP_NONE_TEXT` 三个值导出（同 K 片 A 的 M9 做法） |
| K 片 B 的 `tests/kernel/K-readonly-sandbox.test.ts`、`tests/runtime/K-readonly-command.test.ts` | **不翻转**：前者构造时不给 `resourceCaps`，结果多一项 `none`／`not_configured`；后者的替身结果没有这一项，JSON 不变。lead 在 WSL 跑前者确认 |
| 用真实沙箱的旧测试，例如 `tests/composition/R3e-command-check-platform.test.ts`、`tests/scenarios/C5-gate-fix*.test.ts`、`tests/app/MVP-workbench-tools.test.ts` | **不翻转**：都用 `toMatchObject`，多出的字段不影响；在 WSL 里它们会走有上限的路径（平台用默认值）。全量时有出入停下报 lead |
| `tests/app/host-settings.test.ts`、`tests/app/A2-settings-automation.test.ts` | **不翻转**：假 assembly 没有 `resourceCapStatus`（可选），快照用 `toMatchObject` |
| `tests/composition/platform.test.ts:56` 的可枚举键 | **不翻转**：本片不加平台成员（L13） |

### 5.4 真实上限的限制

RE1 要真实的 bubblewrap，大部分行还要 systemd 用户会话（memory、pids 已下放）。DSH 的沙箱里都没有，这些测试在那里会失败。DSH 照样按 TDD 写；能在沙箱里先跑的部分，用 RE0、RE2、RE3 先做通。RE1 由 lead 在 WSL 里跑并验收（同 K 片 §5.3）。

按 Codex 第一轮审查，要真的用户会话的：RL-01…RL-11（含 RL-02b、RL-02c、RL-03b、RL-03c、RL-07b、RL-08b、RL-09b、RL-10b、RL-10c）、RL-14、RL-15，以及 RL-13 里转给真 systemd-run 的两种（`controllers_not_delegated`、`literal_arguments_not_preserved`）。RL-12 和 RL-13 里不用真 systemd-run 的两种（`no_systemd_run`、`no_user_session`）不要用户会话，只要 bwrap。RE0、RE2、RE3 都不要。

## 6. 文件（影响面；施工时以实际为准，超出要报）

- **Kernel 补丁源**（`vendor/coding-agent/patches/`，用 `scripts/build-kernel-patch.mjs --write` 生成，`dist` 不手改）：
  - `sandbox/process/process-sandbox.ts`（L1–L10、L15）；
  - 新的受管源 `tools/builtin/shell/shell-tool.ts`：先从 `dist/tools/builtin/shell/shell-tool.js.map` 的 `sourcesContent[0]` 逐字提取，`--check` 证明产物逐字相同，再改（L10）；
  - `public-api.ts`（新导出）；
  - `scripts/build-kernel-patch.mjs` 的 `relativeSources` 加 `tools/builtin/shell/shell-tool.ts`；
  - `patches/README.md` 加一节，记提取的 SHA-256（lead 写）。
- **契约：** 新建 `src/contracts/resource-caps.ts`；`src/contracts/verification.ts`（`executed` 加可选字段；`RoundCheckSnapshot` 加可选的 `resourceCapHit`，L16）；`src/core/work-graph/persistence/evidence-record-codecs.ts`（有时校验形状）。
- **Runtime：** `execution-contracts.ts`（依赖）、`observed-model-run.ts`（最后一跳）、`execution-driver.ts`、`query-execution.ts`（传给只读命令工具和 `runObservedModel`）、`readonly-command-tool.ts`（输入、JSON、尾注）、`check-execution.ts`（依赖、观察记录）。`execution-preparation.ts` 不改（F14）。
- **Host：** `src/app/host.ts`（持有者、`installFromSettings`、assembly 的 `resourceCapStatus`、传给平台和命令页、F19 的字面量）、`host-settings.ts`、`host-settings-types.ts`、`workbench-tools.ts`、`main.ts`（后台探测）。
- **组合：** `src/composition/create-platform.ts`（选项、默认值、传给 Runtime 和检查执行器）。
- **WorkGraph（L16）：** `evidence/evidence-service.ts`（`recordCheckResult` 写 `resourceCapHit`）、`state/verification-machine.ts`（检查结果那一步带上这个字段）、`views/automatic-rework-notices.ts`（读触发返工的那一轮、摘要和操作）。
- **测试：** 新测试由 DSH 写；夹具见 §7；旧测试按 §5.3。

## 7. 施工

- **前提：** K 片 B（9881a2ae）、接线包 2（bb924854）已合入；开工时的基线再变，重核 §0.2。
- **夹具由 Codex 先写，lead 核对后冻结：**
  - RE2 的 Kernel 沙箱模块替身：在 K-B 的替身上加 `resourceCaps`（结果里给、构造选项里记、`execute` 时读 `current()`），`resourceCapStatus` 可以设定；`execute` 会响应中止：等到它收到的信号被中止、或测试放行，才返回给定的结果（RL-30、RL-31 的 (f)–(h)），不做永远不返回的替身（冻结分派器会一直等处理器，F23a）；
  - RE1 的假 systemd-run：一个 bash 脚本，按旁边文件里的模式行事：照常转给真的、打印失败退出、不建 scope 直接 exec bwrap、去掉 `-p`、改写 `$$`、先睡 N 秒、等外部放行文件、写“已启动”文件。每次的参数（含 `--unit=` 的名字）记进旁边的文件。每个测试用自己的一份（探测缓存按路径分）。生产代码不知道它的存在；
  - RE1 的压力夹具，都用 python3（WSL 里有）：
    - **内存夹具：** 分配 1 GiB 的 `bytearray`，再每 4096 字节写一次，保证每一页都真的占了内存（只分配不写，页可能一直没占）；
    - **fork 夹具：** 循环 `os.fork()`，子进程停住（例如 `time.sleep(30)`）；碰到 `OSError` 且 `errno` 是 `EAGAIN` 时接住，停 1 秒，再杀掉并 `waitpid` 收掉所有子进程，打印成功的个数，`exit 0`。不用 bash 的后台进程：bash 碰到 `EAGAIN` 会重试，可能在说好的清理和 `exit 0` 之前放弃（Codex 第一轮审查第 6 条）；
    - **线程夹具：** `threading.stack_size` 设成很小（例如 64 KiB），开停在 `Event.wait()` 上的线程，直到建线程报错；接住，打印成功的个数和 `/proc/self/status` 的峰值 RSS，停 1 秒，叫醒并 `join` 所有线程，`exit 0`。内存预算：64 个线程加解释器，lead 先在 WSL 量一次，写进证据，必须远低于 256 MiB（RL-05 断言小于 64 MiB），这样先碰到的一定是任务数上限；
  - RE1 的命令片段：身份标记加等放行标记（RL-01）；带标记的 `sleep`；往工作区文件追加一行；等“继续”标记的后台 worker（RL-02c）；从外面查单元（`systemctl --user show`）、cgroup 文件、带标记的进程（`pgrep -f`）、看门进程（`agent-keeper`）的帮助函数；
  - Host 死用的子 Node 脚本（RL-08、RL-08b、RL-09、RL-09b），以及对它发 SIGSTOP、SIGKILL 的帮助函数；
  - RE3 的假 assembly（有、没有 `resourceCapStatus` 两种）和临时设置目录；写文件失败沿用 A2-settings-automation 的做法。
- **DSH 分三组，各一个新 Session（决定 46），说明书带“子任务没回报完之前不要结束回合”：**
  - G1 Kernel：`process-sandbox.ts`、`shell-tool.ts`、`public-api.ts`；RE0 的 RL-20、RL-22，RE1 的全部行（写，跑不了，§5.4）；
  - G2 平台的结果：RE2 的 RL-30…RL-33、RL-35、RL-36；
  - G3 设置和接线：RE0 的 RL-21，RE3 的 RL-40…RL-44，RE2 的 RL-34。
  - 顺序 G1 → G2、G3（G2、G3 可以并行）。每组派一个只读复查子任务。
  - G2 先核一件事再写 RL-30 (g) 和 RL-31 的分派器到时：用假计时器能不能推动冻结分派器的超时（`tool-dispatcher.js:123-127` 的计时）。推不动就停下，报 lead，不自己换做法。
  - 按 AGENTS.md 第 5 条，DSH 只在 18:00 以后跑；某天另有可用时段时按当天的说法。
- **lead 在 WSL 里：** 跑 RE1 全部；`node scripts/build-kernel-patch.mjs --check`；`tests/kernel` 全部；量 §5.2 末尾的开销。
- **冻结时 lead 同步改文档：** DESIGN 讲进程沙箱和工具的段落；UI-WORKBENCH §0 和 E3-UI-ITEMS（设置页的资源上限、结果里的上限）；MVP-BEHAVIOR（若有对应的行为行）；IMPLEMENTED-CAPABILITIES；STATUS；K3 第三版里指向本文件的那一行。
- 其余同 K 片 §7：lead 核对、Codex 审；在有 bwrap 的环境跑全量；合入。记 DSH 和 lead 的用量。

## 8. 不做的事

- 不改沙箱不可用时的拒绝；不退回主机命令行；不在任何情况下去掉上限重跑；
- 不改没上限时的路径，不改 bwrap 的参数；
- 不加错误码，不改 K 片 B 的限长、先后和安全规则；
- 不改 `shell` 的授权、说明文字和每路 64 KiB；
- 不用 `prlimit`；`OOMPolicy` 只用 `continue`；不调 `systemctl`，不扫残留的 scope；
- 不做总上限、Host 自己的上限、按工作区的上限，不做 CPU 和磁盘上限，不加关掉上限的开关；
- 不给检查碰到上限另做分类、不另发卡（决定 55）；
- 不做界面（E3）；
- 不手改 `dist`；
- 不调用真实模型。
