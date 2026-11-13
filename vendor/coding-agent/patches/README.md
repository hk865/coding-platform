# next 内的 Kernel 源码补丁

本目录只保存已明确纳入维护范围的 Kernel 源文件，不复制第二套 Kernel 工程。运行时仍只加载 `../dist/public-api.js` 及其冻结依赖。

`storage/adapters/sqlite/sqlite-stores.ts` 的初始内容精确提取自 `../dist/storage/adapters/sqlite/sqlite-stores.js.map` 的 `sourcesContent[0]`，并只读核对原工程对应源码一致。初始 SHA-256 为 `90e98ad1bc76b03a85383dfa42867dca7de3b02f0ab54f32605d63216cb97ddd`。该文件是后续区间读取修正的施工源；提取本身没有修改 SQL 或发布新行为。

在 `coding-platform/next` 使用既有 Node24：

```sh
node scripts/build-kernel-patch.mjs --check
node scripts/build-kernel-patch.mjs --write
```

默认及 `--check` 只在临时目录编译，再逐字比较明确受管源的当前产物（现六源24项；下文四项为初始SQLite批次）；不一致返回非零。只有主审确认补丁后才用 `--write` 发布 `sqlite-stores.js`、`sqlite-stores.d.ts` 及两份 map。构建脚本将冻结 `dist` 复制到临时源码布局，依靠邻近 `.d.ts` 编译这个源文件；复用已安装的 TypeScript、Node 类型和 Zod，不读取或修改原 Kernel 源码，不安装依赖。两份 map 都重新嵌入本次源码，避免产物与调试来源失配。

2026-09-25 的初始施工基线已用上述 `--check` 运行通过：TypeScript 6.0.3 生成的 JS、声明及两份 map 均与原冻结产物逐字相同。map 保留最初迁移采用的紧凑 ASCII 转义 JSON 序列化；这项一致性不是只比较解析后的 JSON。

原 2026-09-24 的 `kernel-packaged-hashes.json` 是历史快照，不覆盖它。发布补丁后由主审在本批证据目录记录原/新源码与四份产物哈希、构建命令及验收日志，更新上一层 README 的当前补丁入口和相关能力边界。单次编译与哈希一致仅证明可再生；真实 Kernel 行为、平台历史分页和物理隔离验收仍须独立完成。

## 2026-09-26 B2 公共配对校验入口

新增受管 `public-api.ts`，初始源由冻结 `dist/public-api.js.map` 精确提取，SHA-256 `6fa6a3a57a9716054a97e3616d1d05a5876977d963acddffdc9ee0a196c470a6`。主审扩展同一构建脚本同时编译两个显式源，按各自目录深度核map，初始8项产物均逐字相同。

经DSH骨架/测试→主审中审→DSH实现后，源仅增加既有 `assertTranscriptExchangeIntegrity` 的纯re-export，主审生成四份public-api产物。SQLite源和原四份产物不变。构建命令不变，现在检查8项。公开入口与既有Kernel/历史范围专项49项通过；该B2子能力已纳入后续99文件975项完整隔离基线。证据见工作区 `docs/refactor/reviews/evidence/next-b2-2026-09-26/`。

此函数只检查transcript工具交换配对，不证明副作用已知；平台不能凭合法outcome_unknown配对释放占用。没有复制校验算法或扩大私有扫描接口。

## 2026-09-26 B2 工具拒绝接缝

受管源追加 `app/composition/control-hooks.ts`，直接提取冻结对应 map 的 `sourcesContent[0]`，初始 SHA-256 `d3151d0e313d59cf5ae88c75a0c9b173c72428cd5a7e5c7b093fb370eb02846a`。初始三个源、12 份生成物已逐字再生；构建脚本只写实际变化的产物。Runtime 独审返修后，源及4份生成物已合入主工程，其余8份生成物不变。

真实 builtin read 拒绝测试发现：runner 能将 `before_tool.block` 记为工具错误并继续模型，但宿主 adapter 只接受 continue/pause。仅开放已有 before_tool block，复用同一 HookExecutor/runner；before_model、after_tool、modify/fail 的原边界不随此扩展。Runtime 独立26项及邻接集合96项通过，12份产物逐字再生通过；该接线已纳入后续99文件975项完整隔离基线。

## 2026-09-26 R4.2 工具组安全点

受管源现为六份，原构建脚本确定性重建24项产物。R4.2已完成骨架中审、冻结测试、实现和独立返修，真实工具组前/后await callback；pause等待原required sink提交，保留并发排空、cancel/unknown和原identity恢复。callback失败在最新工具状态上提交，保留已完成结果。专项/邻接5文件68项、types与24项逐字再生通过，已按hash合入。

最终runner源SHA-256为`39f5ce8937ec6e205aa8313e1d77d97162fbc7813498e4d81aec9b43dab46ddb`。实际新行为由原Runner及run/identity-resume/public-resume三处透传提供，没有第二执行循环。平台持久投递、停止确认与恢复接线仍属R4.1/3–5，不能凭Kernel子能力开启平台完整控制capability。

来源/生成物与独立证据见工作区`docs/refactor/reviews/next-r5a-r4-tool-group-2026-09-26.md`及`reviews/evidence/next-b2-2026-09-26/r4-tool-group-final-implementation-import.json`、`r4-tool-group-final-repro.json`。历史基线清单与原Kernel继续只读。

## 2026-10-29 KP 工具参数错误指出字段

新增受管 `tools/dispatcher/tool-dispatcher.ts`：初始内容精确提取自冻结 `dist/tools/dispatcher/tool-dispatcher.js.map` 的 `sourcesContent[0]`（251 行），SHA-256 `f269be617d865b0b19abede111edd8b54ac6dda06e65621a0836e512815baa08`；纳入后 `--check` 为 0，十七个源、68 份产物逐字再生，提取本身不改变行为。

`!parsedArguments.success` 分支把 Zod 的各 issue 按 `字段: 原因` 列出、以 `; ` 连接后附在原文案后；错误码仍为 `invalid_arguments`，其余分支、Zod 的消息文案、平台侧消息均未改，无新增类型、错误码或上限。改后源 SHA-256 为 `c030c3e0d4d36bcfa6e35f47606c20ded79fe0d684dd463a56bab8115ee8bb4f`；四份产物为 `eeb1d3b9d0fd1122de4a42912ef231854503f6b005aac3f25b3e7f7287b56226`（js）、`c5344f3b4afd9596618369e18999097adcb4a05571008cc76cd8a2caa5d2c3ea`（js.map）、`96d4252def7a23e6a4baee5f24589354ea10b7254d5b95a8ffa70e46215ee69b`（d.ts，未变）、`e42edbee9f8a33f1d2717b7fa475f9adeaceab67c49e1f29e54f662304556023`（d.ts.map）。

命令不变：`node scripts/build-kernel-patch.mjs --check`（0）与 `--write`；`--write` 只改 `dist/tools/dispatcher/tool-dispatcher.*`，无其他产物变化。

## 2026-11-03 K2-K 压缩记录（slice-K2-SPEC L1–L7）

新增受管 `core/ports/session_store/session-projection.ts`：内容就是冻结 `dist/core/ports/session_store/session-projection.js.map` 的 `sourcesContent[0]`，SHA-256 `879966958692f4cc93b937e83a3a077a00f22bab5b331464e1600136a0a02c3e`；纳入后 `--check` 为 0，十九个源、76 份产物逐字再生，纳入本身不改变行为。

之后改了九个受管源：Session 记录和草稿多一种 `context.compacted`（`session-store-port.ts`，`contextBasis` 多可选的 `viewPosition`）；投影只在最后一个 Turn 已终止时收压缩草稿（`session-projection.ts`）；公开的 `appendCompactionRecord` 按追加表返回第一条命中的结果，Turn 的记录范围去掉压缩记录（`sqlite-stores.ts`）；恢复历史时按 `viewPosition` 及以前最新一条 `compacted` 拼视图：摘要消息 `context-summary:<sessionId>:<position>`、旧工具结果的桩（`session-history.ts`）；`selectContext` 保护摘要消息（`context-selection-policy.ts`）；`public-api.ts` 导出 `appendCompactionRecord` 和 `AppendCompactionRecordInput`、`AppendCompactionRecordResult`；`kernelSessionApiVersion` 是 4，`SessionContextMode` 的 `session_history` 多可选的 `viewPosition`（`composition-contracts.ts`）；`composition-root.ts`、`resume-composition.ts` 透传 `viewPosition`，同一执行身份的比对多比它。原记录不改不删，没有新的 mode 值，`contextBasis.version` 不变。改后 SHA-256：

- `core/ports/session_store/session-store-port.ts` `4133a04e8a97e0b6ebbcaa6f9f3259d802debffe9a39bc7f98ba696bbaa6cbe9`
- `core/ports/session_store/session-projection.ts` `96c4d4d171bfd6b6f7e94ea62bcf251946e42e7e98e7b97b2fc992d599ac9dd5`
- `core/ports/session_store/session-history.ts` `1d08df0716b9e341bde4eb30d8dd59249b4b88858491702a9cbca1545988f3fb`
- `storage/adapters/sqlite/sqlite-stores.ts` `6e990cd5f1ce63d806f9b9970f526aa6b215ff77b454b99c9ae14266fa681afc`
- `core/context/selection_policy/context-selection-policy.ts` `203d319e92cb197a795cfd81206f7dc65c41712d880bd89b5bcdc8a11201088d`
- `public-api.ts` `c3d3d5fde940c7ad22aa7af02233519d3934dacae5a692660f215a382da0c14b`
- `app/composition/composition-contracts.ts` `811c47066ba896aa95d442db7e3cfb151703a9578dcb95425a3acbf89503e6b5`
- `app/composition/composition-root.ts` `ee79bd0a80ee6820296652fe2c39b57424c1e05313a42f9417053e19ad7ac341`
- `app/composition/resume-composition.ts` `fb86ff15438275c534387560d952a7e657adc8d862f9904f78a8b730bd6c0538`

`--write` 改了这九个源的 32 份产物：每个源的 `.js`、`.js.map`、`.d.ts.map`，以及 `session-store-port.d.ts`、`session-history.d.ts`、`sqlite-stores.d.ts`、`public-api.d.ts`、`composition-contracts.d.ts`；`session-projection.d.ts`、`context-selection-policy.d.ts`、`composition-root.d.ts`、`resume-composition.d.ts` 不变，其余源的产物不变。

命令不变：`node scripts/build-kernel-patch.mjs --check`（0）与 `--write`。

## 2026-11-04 8E-2 一次读多个文件（slice-8E2-SPEC W12）

受管源 `sandbox/workspace/workspace-sandbox.ts` 的 `WorkspaceSandbox` 加 `readMany(relativePaths, maxBytes?, { signal?, via? })`：结果和输入同序，每项是 `{ ok: true; file }` 或 `{ ok: false; error }`，和逐个 `read(path, maxBytes)` 的结果或它抛的 `WorkspaceSandboxError`（码、消息）相同，一项失败不影响别的，读到的照样记进会话一致性检查；只开一次根。第一次调用时对工作区根 `statfs` 一次、实例记下：ext2/3/4、xfs、btrfs、tmpfs 用同步系统调用（路径排序后按目录栈走，每个目录只开一次，连续做满约 1.5 毫秒让出一次事件循环），其余文件系统和 `statfs` 失败用异步读（目录句柄按前缀缓存，同时读 4 个）；`via` 只给测试强制选一种。批末从根按名字把这批开过的目录再开一遍比 dev:ino，对不上的目录下的路径都回 `io_error`。取消时整个调用失败。`#readAt` 打开文件之后的检查（普通文件、大小上限、读后再 fstat、解码、摘要）抽成模块内的 `readOpenedFile`，`read` 和两种读法共用这一份，`read` 的行为不变。没有新错误码，没有新导出的类型。

改前源 SHA-256 `6ef2637d1b8e69a46c116596f84262f0bd82447c6d2efce62a97d663f814dd42`，改后 `0125e688752e530d68cfa4421ff881db954d31d89b8bd1ec8166ffb79390445a`；四份产物为 `fcebefc3c3637199a65794e8617a0b587d657f1631638e7c091b0ebe6fb02887`（js）、`cd7aacd3d6856a343388df26e6e0dee5505aa32a90cf08e505b2a91f30f39573`（js.map）、`4b78ab8ee570bd2ba03d5fa20f89cb4cab605cbff1b5de16100a165996ac824f`（d.ts）、`f36e00a626769b30cdf76546b7fd676299fcf835e8dae3188d3fe6dc62345d44`（d.ts.map）。

命令不变：`node scripts/build-kernel-patch.mjs --check`（0，十九个源、76 份产物）与 `--write`；`--write` 只改 `dist/sandbox/workspace/workspace-sandbox.*` 这四份，其余产物不变。

## 2026-11-11 KLS-2a-2 只拒写的前缀

受管源 `sandbox/workspace/workspace-sandbox.ts` 的 `WorkspaceSandboxOptions` 加可选的 `writeDeniedPrefixes`：`create` 把它规范化、排序后存进实例，缺省是空表、行为不变。`replace` 和 `createFile` 先照旧规范化（读写都拒的 `deniedPrefixes` 照旧先查），再拒绝落在这些前缀内（等于前缀或以“前缀/”开头）的路径；这次比较不分大小写（路径和前缀只在比较时转小写，路径本身不变），不区分大小写的文件系统上 `.WORKBENCH/x` 也绕不过去，区分大小写的文件系统上它同样被拒。抛 `WorkspaceSandboxError("permission_denied", "路径只读，不允许写入")`，edit 工具照现有映射回工具错误码 `permission_denied`；`read`、`readMany`、`listFiles`、快照和一致性检查都不看这份清单。没有新错误码，没有新导出的类型。平台由 `observed-model-run.ts` 的工作区选项传 `['.workbench', '.git']`（`.git` 补 Kernel 权限策略只按原样大小写拒写的那一处），工作台保存传 `['.workbench']`（它的 `.git` 在读写都拒的一组里）。

代码审查之后，读写都拒的 `deniedPrefixes` 在 `#normalize` 里的那次比较也不分大小写（和只拒写共用 `isWithinIgnoringCase`，只在比较时转小写，路径本身不变）：不区分大小写的文件系统上 `.WORKBENCH/local/x`、`.GIT/...` 这类换了大小写的路径照旧回 `permission_denied`（“路径不允许访问”）。`listFiles` 和快照遍历跳过拒绝前缀时照旧区分大小写：比的是磁盘上读回的名字，但 `listFiles` 带 `prefix` 时开头几段是调用方给的大小写，所以不区分大小写的根上带 `prefix: ".WORKBENCH"` 列举会列出 `.WORKBENCH/local` 下的文件名（内容仍读不到，读在 `#normalize` 被拒）。

改前源 SHA-256 `44f2825a2375244bdc82f7af3e239cae4228d7371129ddc5cc675cda10ea156f`，改后（含代码审查之后的两处不分大小写）`ba2cdb5de2902cbbd795dc71812e7e79a0afece1418c24357be6352f8e5a149d`；四份产物为 `b3c795c00ad9965637e5c3a86d94062c37d9ca0fcefb97539d24639d6c1342ef`（js）、`3241f40acfefe556338fc02d104b3554507a0a1589e35beeb0974587624409a1`（js.map）、`fda42ff92ca6140a09a0fe99c99a9a792a34f7b95348185aa23e5f155e52f7e2`（d.ts）、`bfdcb5c67be22852e90ec7ced3b25639ba27629ff70617262b77e2e64071ec94`（d.ts.map）。

命令不变：`node scripts/build-kernel-patch.mjs --check`（0，十九个源、76 份产物）与 `--write`；`--write` 只改 `dist/sandbox/workspace/workspace-sandbox.*` 这四份，其余产物不变。

## 2026-11-13 SHT-1 命令不按时间停、输出收缩

受管源 `tools/builtin/shell/shell-tool.ts`：shell 的工具定义和沙箱请求不再按时间停，`defaultTimeoutMs` 和 `sandbox.execute` 的 `timeoutMs` 都写 `SHELL_NO_STOP_MS = 2_147_483_647`；处理器不再用模型填的 `timeoutMs`，`ShellToolConfig` 删掉 `defaultTimeoutMs`/`maxTimeoutMs`。新增 `fitOutput`：整个序列化结果超过既有的 128 KiB 定义上限时，先按最长前缀截 JSON 的 `stderr.text`，仍超再截文本部分的 stdout，被截的一路置 `truncated`，别的字段不动。走不到的 `result.timedOut` 分支和错误码联合类型里的 `"timeout"` 一起删掉。说明文字写明命令不按时间停、可用 `timeout <seconds>` 自己限时。

改前源 SHA-256 `c36a26c08ff640f252fe6fdc15ee7cbd59e09648855044821ec96c417a0f40ba`，改后 `1739ff88aca82e8a2bfee8a4ee2394e21b3993e4670b30d0fef3e9deda8cf654`；四份产物为 `aa1b78d8f0f6206e5f07620c5527a0e2ee64272522957516da709efd76af0ede`（js）、`2a8b2921f215f8769d48c6c14d262905e464819ae06d67e106c299f12b610b8d`（js.map）、`e48d5e0d36dd2cf449ab8acb711c35277cbb4fcaaa596b3aab120f9f7e28c2ab`（d.ts）、`bac073584611d449bcdbe41f484261dda9f8d998d8c32eb7aee9f2726bdfcfd8`（d.ts.map）。

命令不变：`node scripts/build-kernel-patch.mjs --check`（0，十九个源、76 份产物）与 `--write`；`--write` 只改 `dist/tools/builtin/shell/shell-tool.*` 这四份，其余产物不变。
## 2026-11-13 SBX 宿主挂载和联网选项

三个受管源改了，没有新源。`sandbox/process/process-sandbox.ts` 的 `ProcessSandboxOptions` 加两项可选的选项，`ProcessSandbox` 加 getter `networkConfigured`（构造时给了 `network` 就是 true）；两项都不进 `effectiveOptions`，所以不进恢复约束，探测（`probe`）的签名和行为不变。

- `hostMounts?: readonly HostMount[]`（`{ source, target, writable }`）：构造时拷一份，每次生成参数时挂在运行时目录之后、`/workspace` 之前，按给的顺序挂，`writable` 用 `--bind`，否则 `--ro-bind`。源和工作区根各 realpath 一次，两者相等或一方在另一方之下就抛 `ProcessSandboxError("launch_failed", "宿主挂载和工作区重叠：<source>")`，命令不跑。理由是安全：挂出去的工作区副本不受 `.git` 只读和受保护遮蔽约束，只读命令也会经它写到真实工作区。源不存在等其余错误照 realpath 或 bwrap 的原文变成 `launch_failed`。只读金丝雀的缓存键多带这份挂载。
- `network?: NetworkProxySource`（`current(): { socketPath } | null`）：每次 `execute` 只读一次，探测、只读金丝雀和资源上限金丝雀都不联网。null 或没给时参数、环境变量和命令和以前逐字相同。给了 socket 时保留 `--unshare-net`，把 socket 绑到 `/run/agent-net/proxy.sock`、Host 自己的 node（`process.execPath`）只读绑到 `/run/agent-net/node`、宿主上有 `/etc/ssl/certs` 就只读挂上；`HTTP_PROXY`、`HTTPS_PROXY`、`http_proxy`、`https_proxy` 设成 `http://127.0.0.1:3128`，`NO_PROXY`、`no_proxy` 设成 `localhost,127.0.0.1,::1`，`NODE_USE_ENV_PROXY=1`；命令前（只读模式在 cwd 守卫之后）加起跑段：转发器在沙箱的 127.0.0.1:3128 监听、每个连接接到代理 socket，最多等 5 秒它说 `r`，没等到就在 stderr 写“[平台] 这条命令没有网络：联网转发没起来 <转发器输出的第一行>”，命令照跑。转发器放在进程替换里的后台，命令里不带参数的 `wait` 不等它；命令结束时 bwrap 的 pid 空间整个结束。有上限和没上限两条路都只在 `#arguments` 一处生成这些参数。

`tools/builtin/shell/shell-tool.ts` 的 `createShellToolDefinition` 按 `sandbox.networkConfigured` 选说明：联网版写明经平台代理上公网、本机和内网不通、ssh 和非 HTTP 连接不行；不联网时是原来的说明（SHT-1 改过的那份）。`public-api.ts` 多导出类型 `HostMount`、`NetworkProxySource`。代理本身、拒回环和内网、记主机和接线在平台侧（NET-B），见取舍 010。

- `sandbox/process/process-sandbox.ts` 改前 `f6d58fcfcd31286c1c8ca47639d43d08e1e161d8a5bf00d6ffd5125f8d9a3bff`，改后 `6229dc47ef08bc49862eecd287f739cde9a9da64969c4d8be32b2fb10068f383`
  - 产物：`3601e8773e4c2426c8f3d8821b927286be4ae836708aaf66f36b5e9dcec10119`（js）、`f15a6e547cd70b5ed3d3c83f997e300436ad8c932626c4bdcd99085690c58ad2`（js.map）、`e84b33c1c2ce0c7c5e9da038741c07e2f14587d4bea352beeecb3ce8b2cbe367`（d.ts）、`0c12de4759d12da12e02315269b42a1ce1029a6d2bceadfafe72f7da94ce4f47`（d.ts.map）
- `tools/builtin/shell/shell-tool.ts` 改前 `1739ff88aca82e8a2bfee8a4ee2394e21b3993e4670b30d0fef3e9deda8cf654`（SHT-1 之后），改后 `9ea3b132c955e73223f69b11531ebbb7ea681a31f7939037ebebfa0d25342830`（叠树 stk23 和 SHT-1 合并：两种说明都带 SHT-1 的“Commands are not stopped by time; memory and process limits still apply.”，放在“Use for search”那句之前）
  - 产物：`ee7908675ee1bcc96f28621246202fccbcc6943c0235cf6cf8d0242a2d5d4bb1`（js）、`2427ad2dff891ecb53bae8d9f662a42a6d8f446bbca863bf04e0f21b21d0385c`（js.map）、`e48d5e0d36dd2cf449ab8acb711c35277cbb4fcaaa596b3aab120f9f7e28c2ab`（d.ts，和 SHT-1 之后相同）、`a619b13a905eb340e27be330250526091036645ff02f6118ae90a0724aca7dc4`（d.ts.map）
- `public-api.ts` 改前 `c3d3d5fde940c7ad22aa7af02233519d3934dacae5a692660f215a382da0c14b`，改后 `3cf5b15d882a9fa589f6e5ba9b3023ef521d3eab5822c0c165e9b0f4172636c3`
  - 产物：`ae94690d7a9fc21ee80644c43b6360c2a57249109e0e3da87335a8e3920c007c`（js，未变）、`e5d6ad3d9928d0f318fb0e4357092dd7d7cb0430c3386ca4ddae39608eb9cc83`（js.map）、`41a93aa047182eaaf3ab904d746a6370650ea243f46e20f285a029e046d26b17`（d.ts）、`084227743cb874ba5f0103f8438d4d8642e8ea3f6f180f2de8b9aed96b9b41dd`（d.ts.map）

命令不变：`node scripts/build-kernel-patch.mjs --check`（0，十九个源、76 份产物）与 `--write`；`--write` 只改上面没标“未变”的 10 份产物，其余产物不变。

## 2026-11-13 CTXFIT 最新一段工具交换改为截断结果

受管源 `core/context/selection_policy/context-selection-policy.ts` 的第 7 步不再把“尾段”算作删除单位：尾段是不在历史里、已闭合、结果一直排到 transcript 末尾的那一段当前工具交换。本轮较早的几段都删光后仍装不下时，在“全部单位都删掉”的前缀上对尾段每个结果二分一个共同的字节上限 c，把每个结果的 `output` 换成一个 text 部分：先取原输出（单个 text 时取原文，否则取 `JSON.stringify(output)`），再取不超过二分上限、且落在完整 UTF-8 字符边界上的最长前缀；说明行里的 c 是实际保留的字节数（不超过二分上限），再加“结果过长，本次上下文只放得下前 c 字节（原 M 字节）；需要其余部分请缩小范围或分页再读”；`status` 和 `error` 不动。截断计入现有的 `removed.toolResultBody`，没有新种类、新错误码或新导出类型。c=0 仍装不下时照旧回 `required_content_over_budget`，Run 明确失败；留下的这处拒绝是产品规则：连空结果都放不进合法请求时，让模型在看不到调用和结果的情况下继续，比明确失败更糟。

改前源 SHA-256 `203d319e92cb197a795cfd81206f7dc65c41712d880bd89b5bcdc8a11201088d`，改后 `8a6b2a0582f51b8ad8c7e0bf0c3fa0b79adf6be1dc8901113a0eb9508ad6847b`；产物为 `10d6ef27bc0278a9a9883244d9b824020e010f588b491acd2f97d93da9d87c76`（js）、`0778434eecd88cb58fb6e4ee8844156eb8bdc6b09f0fa11596a3cc3df57b37be`（js.map）、`900f98c0c4c89d28235f18a13790db1d6a07d4ab736c1d91e97280e5e05bdfe9`（d.ts，未变）、`8e01fadc0d558578a4d7d843d76436497c4ab389b3b662b01159e381901ad268`（d.ts.map）。

命令不变：`node scripts/build-kernel-patch.mjs --check`（0，十九个源、76 份产物）与 `--write`；`--write` 只改 `dist/core/context/selection_policy/context-selection-policy.*` 的 js、js.map、d.ts.map 三份，d.ts 不变，其余产物不变。
