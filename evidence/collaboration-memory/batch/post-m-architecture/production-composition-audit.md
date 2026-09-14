# S04 生产装配默认能力审查

原始问题不是文件是否还叫 harness，而是正式 Host 会不会在缺少真实能力时悄悄采用测试替身并报告成功。

## 公开入口

`createPersistentPlatform(PersistentPlatformOptions)` 保留为测试／演示对象图。为了让已有契约、重启和 SQLite 测试能只覆盖所需端口，它允许 Fake 默认能力。

`createProductPlatform(ProductPlatformOptions)` 是正式产品入口。类型要求调用方显式给出：

- `runtime`
- `verification`
- `handoffControl`
- `contextContinuation`
- `lifecycleControl`
- `readOnlyQuery`
- `workspaceReader`
- `workspaceCapability`

产品入口没有自己的默认填充分支；它只在编译期证明这些键齐全，再复用同一持久对象图。这样避免复制 Ledger、ReadModel 和关闭／重开流程，同时阻止正式调用者因漏一个选项而选中 Fake 默认值。

## 当前 Host

`src/app/service.ts` 的真实分支调用 `createProductPlatform`。CodingAgent、只读查询、WorkspaceReader 和验证使用真实对象；内核当前没有提供的换手快照、safe-point 接续等能力由 `unconfiguredRuntimeCapabilities` 明确返回 `unsupported`／`rejected` 或抛出“未配置且未执行”的错误。显式 fixture 分支仍调用 `createPersistentPlatform`，并在 `executionCapability` 中标出 fixture。

正式启动入口默认关闭 fixture execution。只有测试或演示代码显式传入 `fixtureExecution: true` 时，fixture-only role 才能使用 Fake runtime；运行分流本身也复核该开关，不能只靠 role 标识进入替身。该状态通过 `fixtureEnabled` 可见。

## 验证

- TypeScript 全项目检查通过，证明真实调用点满足 `ProductPlatformOptions` 的必需能力集合。
- `product-fixture-default-retest.json` 的 5 个 GUI Host 用例全部通过：默认启动报告 `fixtureEnabled: false` 并拒绝 fixture 任务入口；显式开启的既有 GUI 流程仍执行成功。
- `structure-and-composition-retest.json` 中除依赖 bubblewrap 的 semantic-query 场景外，其余用例通过；semantic-query 在模型调用前以 sandbox unavailable 失败，没有产生假成功。
- `coordination-and-composition-clean-retest.json` 单独重跑不需要外部进程沙箱的协调、GUI 和关闭场景，作为干净的结构回归记录。

未增加只有一个实现的 adapter 层。产品与测试共享同一持久装配，差别由公开 options 类型和真实 Host 调用点表达。
