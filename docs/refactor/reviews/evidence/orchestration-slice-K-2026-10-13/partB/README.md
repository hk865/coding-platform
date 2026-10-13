# K 片 B 部分的执行证据（2026-10-13 至 10-14）：只读命令 `run_readonly_command`

**是什么。** [K 片规格](../../../../design/orchestration-2026-10/slices/slice-K-SPEC.md) B 部分（§1.2、L12–L18、§4 第 7 条、§5 的 KE5/KE6 和 KB 行；§9 的 M10–M12）：Query 和写范围为空的只读 Work 可以在只读沙箱里跑命令。进程沙箱加 `workspaceMode: 'read_only'`（工作区根 `--ro-bind-fd`，受保护目录 tmpfs 后 `--remount-ro`），工作区里的 FIFO 和 Unix socket 遮住，Host 设置 `allowReadonlyCommands` 可以关掉这个工具，工具结果整体不超过 128 KiB。

**结果。** 验收通过，按决定 44 合入本分支（提交见本目录所在的提交）。在 WSL 里用真 bwrap 跑：K-B 两个文件 53 项全过；全量 281 个文件、6,027 项全过（`checks/full-suite-4.tail.txt`）。合入补丁 sha256 见 `checks/merge-patch.sha256`；dist 是 `scripts/build-kernel-patch.mjs` 生成的，没有手改。没有调用真实模型。

## 经过

DSH 四个新 Session，每次之后 Codex 只读审查一次：

| 轮 | 说明书 | DSH 报告 | Codex | 要点 |
| --- | --- | --- | --- | --- |
| 1 | `books/kB-impl.md` | `dsh/final-1.md` | `codex/kBimplrev.out.md`（不能合入，7 条） | 第一版实现；全量通过 |
| 2 | `books/kB-impl-2.md` | `dsh/final-2.md` | `codex/kBimplrev2.out.md`（改完再合入） | lead 决定 D-IPC、D-GIT、D-SWITCH、D-BOUND、D-CODES、D-PROBE、D-CWD、D-DESC（规格 §9 M10–M12） |
| 3 | `books/kB-impl-3.md` | `dsh/final-3.md` | `codex/kBimplrev3.out.md`（改完再合入，2 条） | D-GITFILE（文件形式的 `.git` 整个盖住，下面的受保护路径省略）；D-ID（提供方的调用 id 不算进 128 KiB，规格 M11 的限定）；四处测试 |
| 4 | `books/kB-impl-4.md` | `dsh/final-4.md` | `codex/kBimplrev4.out.md`（改完再合入，1 条，lead 判定不改） | D-ONECHECK（一次执行只判断一次 `.git` 和受保护路径，挂载和 IPC 扫描都用这一个快照）；D-DOUBLE（测试替身按自己的构造选项拒绝） |

lead 在轮次之间改的（说明书里写明，DSH 保留）：
- 撤回 DSH 第 1 轮自己加的“准备时拒绝写范围为空却授了写工具的 Work”的守卫；只保留已有的启动时守卫。
- KE5 的 bwrap 包装脚本空循环体加 `:`；FIFO 的写入结果接受 `wrote` 或 `blocked`。
- KB-09“只授了写”的测试不再断言执行停在“启动中”（那是已知缺陷，不是规格），只断言写工具从没交给模型。
- lead 在 WSL 里核过：bwrap 对类型对不上的绑定都失败（`/dev/null` 绑到目录上、目录下的覆盖遇到文件、目录绑到文件上，都退出 1），所以 D-ONECHECK 是失败即关闭。

## lead 的验收判断和已知限制

见 `lead-acceptance.md`：Codex 第四次审查第 1 条（快照后、挂载前 `.git` 由目录换成文件）不返工，理由是露出的只是那个写者自己写的内容，没有 Host 禁读的东西；文件形式的 `.git` 被盖住是为了 git 用不了（规格第 264 行），不是保密。已知限制（进 STATUS“缺口”）：快照后才建出的受保护路径没有遮盖；按路径的遮盖假定运行期间没人改名受保护路径；IPC 扫描有界；写范围为空、只授了写的 Work 卡在“启动中”；只读 Work 的“隐藏会改动的工具”没有实现。
