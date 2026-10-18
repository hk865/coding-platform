只读核对，未改文件、未运行测试或构建。以下用唯一文件名定位。**尚不能合入。**

任务书逐项：

1. **已修。** blocked 夹具共用一个 harness，认定走共享 Host 链（`K3-blocked-command-fixture.ts:357、435`；`K3-35-continuation-fixture.ts:548、572、579`）。401 耗时仅据回报，未独立复测。
2. **迁移已修，但新增断言削弱。** owner 已走真实创建、定稿、hold/release（`K3-48-3-required-writes.test.ts:58、71、80、92`）；容量问题见下。
3. **未完成。** 指定终态迁移有进展，但仍有手写前置，见下。
4. **未完成。** 恢复部分双后端不等于覆盖全部服务层场景。
5. **已修。** 恢复瞬时不可读后的文件条目、旧批注拒绝及重读（`K3-18-review-card-queue.test.ts:448、476、483`），文件批注传递也恢复（`K3-15-disposition-effects.test.ts:382、418`）。
6. **已修。** 共用 ID 源并真实重排、领取后续 Run（`B2-blocked-runtime.ts:143、151、157`），断言身份不同（`B2-02-approved-method.test.ts:81`）。
7. **已修。** 测量完整 manifest，并保留最终合限、前一步超限断言（`K3-35-manifest-trim-pure.test.ts:244、367、373`）。
8. **已修。** 三组 hook 均设 60 秒且清理防未初始化（`K3-35-T-by-hand.test.ts:102、103、155、156`；`K3-35-approved-methods-brief.test.ts:83、84`）。

剩余必须改：

- **手写前置仍被台账豁免。** `K3-06-mixed-kinds-owner.test.ts:110、115、206`先成功提交手写分类，再测非法草稿。因此 **UNSPECIFIED 3 只能接受非法草稿本身，不能接受前置**。`K3-26-unknown-call-review-storage.test.ts:200、212`同类；`:302、307、318`把32项草稿落库后读记录、卡，`:544、558`造记录供领取使用。台账`:101、105、107、123`误列(a)。此外 `K3-review-workflow-rows.test.ts:243、304、434`把手组 review 喂给使用真实存储的 Workflow，也不是无存储纯测。**后果：**真实产生事实的路径坏了仍可通过。**修改思路：**前置统一走共享公开步骤，不可达组合移纯测；保留真正被测的拒绝输入，重写台账。

- **台账漏掉 B2 前置造态。** `B2-execution-fixture.ts:211、225、232、301`手组 prepared、位置和进入事实；台账`:170`却把进入位置说成终态被测输入。另漏 `B2-model-request.test.ts:14、39`的 Session/租约改写、`B2-execution-result.test.ts:98、105`的新持有者造态，以及 `B2-runtime-fixture.ts:194、195、197`的策略和角色写入。**后果：**绕过真实准备、进入及状态变更。**修改思路：**改用公开生产步骤；不可达组合移纯测，缺入口则明确报告。B2-execution-result 自身的被测终态输入仍按书豁免。

- **UNSPECIFIED 2 不接受整体豁免。** 规格`:1374`及任务书`:51–55`要求服务层双后端，不以旧版是否单后端为条件。仍有 `K3-15-list-by-task.test.ts:54`、`K3-18-requeue-confirmed.test.ts:119`等缺口；本轮还把原 memory 行改为 SQLite（`rework6.diff:1324、1337、2696`），新增文件故障行又只有 memory（`K3-18-review-card-queue.test.ts:424`）。**后果：**后端覆盖不完整。**修改思路：**逐场景补齐，不能只恢复返工5删除的行。未见 A/B1/B2 旧快照或审查，无法证实当时状态；可见的返工5审查已拒绝单后端豁免（`k3g4b3-review6.out.md:21`）。

- **新增容量断言削弱。** `K3-48-3-extremes-pure.test.ts:47、48、95、98`按生产常量构造数据并判断预算。**后果：**生产上限错误增大，测试随之放宽。**修改思路：**恢复规格固定值 `158_720`、`524_288`，或独立断言导出常量等于这两个数。

**UNSPECIFIED 1 可接受：**spy 分享真实 records，随后恢复；后端确在首次 await 前创建（`K3-35-continuation-fixture.ts:535、539、543`；`create-platform.ts:653、660`）。无需为此增加生产选项。

本轮改动文件的(a)/(c)已核对；计数、故障和并发包装未见额外造态阻塞，例如 `K3-43-continuation-vs-hold.test.ts:160、165`。但上述误分类、漏项使台账“缺陷0”（`:3`）不成立。新增削弱见容量断言及后端替换；未发现其他明确的新回归或静默默认。

先改完列出的几处