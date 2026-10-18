仅静态核对，未改文件、未运行测试或构建。以下用唯一文件名定位。**目前不能合入。**

任务书逐项：

- **1：指定链已修，共享迁移未完成。** K3-35 已走真实 Host 和公开认定入口（`K3-35-continuation-fixture.ts:548、555`），但另一份识别装配仍在，见下。
- **2：部分完成。** 原 owner 行已通过 Runtime 结束（`K3-35-owner-manifest-trim.test.ts:64、70`）；32项构造状态却转进另一落库场景。
- **3：已修。** 公开 start 被拒绝，并检查 Run、授权、版本及 Kernel Turn 未改变（`K3-review-preparation.test.ts:608、616、620`）。
- **4：部分完成。** 普通记录改走真实创建、定稿链（`K3-review-card-fixture.ts:384、389`），容量边界保留真实 owner 断言（`K3-16-proposal-write.test.ts:217、225、232`）；但双后端、B2-02及下列遗留未完成。
- **5：已修。** 崩溃结束说明已指向本轮裁定（`B2-401-world.ts:16`）。
- **6：已修。** 循环和第402次启动均登记在途 Run，失败时释放、等待后关库（`B2-401-world.ts:300、337、358、369、390`）。
- **7：已修。** 两个真实 Run、两卡及每次操作一次 closure 读取均有断言（`B2-07-crr-card-closed.test.ts:111、126、162、169、173`）。

剩余必须改：

1. **第二份识别流程仍在。** `K3-blocked-command-fixture.ts:361、378、383`自行装配、缺 lookup/capture，再直接调用 RUN-22；缺依赖会得到 `lookup_not_wired`、`not_configured`（`unknown-call-draft.ts:108、159`）。因此不能宣称所有场景共用完整 Host 路径。**修改思路：**复用已修的识别链，删除这份装配。

2. **UNSPECIFIED 4 不接受；非 T-list 造态也未清完。** `K3-48-3-required-writes.test.ts:101、109`把构造的32项经 RUN-20/22落库，`:161、248`另有构造草稿。“pure/owner”不改变其性质。极值应直接测纯 codec，owner 场景用可达状态。

   同类非 T 遗留还包括手写终态前置：`K3-review-workflow-rows.test.ts:299`、`K3-06-mixed-kinds-owner.test.ts:228`、`K3-13-two-items-owner.test.ts:232`、`K3-26-unknown-call-review-storage.test.ts:775`、`K3-47-claim-gate.test.ts:71`、`K3-47-reader-facts.test.ts:138`；构造草稿前置：`K3-15-review-routes.test.ts:129`、`K3-15-ur3h.test.ts:169`、`K3-15-hold-release.test.ts:120`、`K3-18-autonomy-facts.test.ts:125`、`K3-29-startup-reconcile-2b.test.ts:123`、`K3-41-release-hold.test.ts:409`、`K3-43-continuation-vs-hold.test.ts:111`、`K3-43-review-claim-vs-hold.test.ts:96`。这些会绕过真实前置失败；**修改思路：**逐个迁共享公开步骤，不能以“未改动／owner测试”豁免。

3. **UNSPECIFIED 1 不接受。** 规格明确服务层双后端，K3-20再次单列要求（`slice-K3-SPEC.md:1374、1389、1434`）；本轮却收成 SQLite，例如 `K3-16-proposal-write.test.ts:57`、`K3-20-review-card-paging.test.ts:52`。**修改思路：**让 Host 装配共享或注入内存后端，恢复对应 memory 行；夹具限制不能自行删验收要求。

4. **UNSPECIFIED 2 的“不可达”判断错误。** 停下时 Kernel 不可读、认定前恢复，仍须记 incomplete（`slice-K3-SPEC.md:274`）；草稿会保留恢复出的 file_edit（`unknown-call-draft.ts:140、187、207`），状态机因 incomplete 给 needs_decision（`unknown-call-review.ts:793`）。所以删答复拒绝断言（`K3-18-review-card-queue.test.ts:358、364`）削弱了真实覆盖；通用 `S5-message-decision.test.ts:379`只测纯状态拒绝，不等价。**修改思路：**注入暂时读取失败、恢复后认定，恢复旧文件批注拒绝、重读和传递断言；一并恢复 `K3-15-disposition-effects.test.ts:323、344`删掉的文件批注部分。

5. **UNSPECIFIED 6：不是手造 Run，但确实绕过夹具缺陷。** `B2-02-approved-method.test.ts:76`改用原 Run；`B2-blocked-runtime.ts:140`新建 harness，而默认 ID 计数重新开始（`K3-35-continuation-fixture.ts:389`）。后续领取失败未得到解决。**修改思路：**共用已有按 world 分配的唯一 ID 源（`B2-crr-world.ts:44、110`），恢复后续 requeue＋claim；无需改生产逻辑。

6. **UNSPECIFIED 8 不接受当前计量。** `K3-35-manifest-trim-pure.test.ts:120`仅量两个字段，漏清单骨架和正文前缀；生产量整份清单（`execution-preparation.ts:555`）。这不能证明规格的整份256KiB上限（`slice-K3-SPEC.md:1435`）。**修改思路：**纯测仍可保留，但用完整合法清单计量，保留最终不过限、前一步超限断言。

**UNSPECIFIED 3、5、7可接受：**双目标／平台行仍有纯渲染覆盖（`K3-continuation-review-note.test.ts:375、381、382`）；revision 2来自真实创建后定稿（`K3-review-card-fixture.ts:385、389`）；空闲 Session 由公开步骤创建（`K3-46-review-advance-failures.test.ts:538`）。

先改完列出的几处