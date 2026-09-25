# next 内的 Kernel 源码补丁

本目录只保存已明确纳入维护范围的 Kernel 源文件，不复制第二套 Kernel 工程。运行时仍只加载 `../dist/public-api.js` 及其冻结依赖。

`storage/adapters/sqlite/sqlite-stores.ts` 的初始内容精确提取自 `../dist/storage/adapters/sqlite/sqlite-stores.js.map` 的 `sourcesContent[0]`，并只读核对原工程对应源码一致。初始 SHA-256 为 `90e98ad1bc76b03a85383dfa42867dca7de3b02f0ab54f32605d63216cb97ddd`。该文件是后续区间读取修正的施工源；提取本身没有修改 SQL 或发布新行为。

在 `coding-platform/next` 使用既有 Node24：

```sh
node scripts/build-kernel-patch.mjs --check
node scripts/build-kernel-patch.mjs --write
```

默认及 `--check` 只在临时目录编译，再逐字比较当前四份产物；不一致返回非零。只有主审确认补丁后才用 `--write` 发布 `sqlite-stores.js`、`sqlite-stores.d.ts` 及两份 map。构建脚本将冻结 `dist` 复制到临时源码布局，依靠邻近 `.d.ts` 编译这个源文件；复用已安装的 TypeScript、Node 类型和 Zod，不读取或修改原 Kernel 源码，不安装依赖。两份 map 都重新嵌入本次源码，避免产物与调试来源失配。

2026-09-25 的初始施工基线已用上述 `--check` 运行通过：TypeScript 6.0.3 生成的 JS、声明及两份 map 均与原冻结产物逐字相同。map 保留最初迁移采用的紧凑 ASCII 转义 JSON 序列化；这项一致性不是只比较解析后的 JSON。

原 2026-09-24 的 `kernel-packaged-hashes.json` 是历史快照，不覆盖它。发布补丁后由主审在本批证据目录记录原/新源码与四份产物哈希、构建命令及验收日志，更新上一层 README 的当前补丁入口和相关能力边界。单次编译与哈希一致仅证明可再生；真实 Kernel 行为、平台历史分页和物理隔离验收仍须独立完成。
