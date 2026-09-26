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
