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
