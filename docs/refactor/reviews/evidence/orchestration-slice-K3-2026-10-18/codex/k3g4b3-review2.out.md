本轮仅静态核对，未修改文件、运行测试或构建。以下用文件名和行号定位。

1. **已修。** 绑定取消截断并共用任务审查记录；分页先定窗口再过滤任务（`execution-preparation.ts:448`、`unknown-call-review-service.ts:1570`）。

2. **部分，必须改。** 共用识别器仍先按记录时间排序，再在各记录内排别名；同时间的记录之间没有按别名排序（`command-recognition.ts:36`）。因此可能先选 alias 2、后选 alias 1，违反指定顺序。修改思路：展开时保留记录时间，统一按“时间、别名”排序后选命中。

3. **已修。** 管道退出恢复目录、展开按目录和脚本名区分、逐层保留 basis、截断标志及字节计数均有对应修改（`command-normalization.ts:455`、`command-expansion.ts:124`、`:195`、`:205`、`unknown-call-review-service.ts:105`）。

4. **部分，必须改。** 关闭事实已有统一读取，但缺依赖仍默认为未关闭（`command-rerun-request-service.ts:374`、`execution-preparation.ts:455`），会静默改变授权判断。且每页重新读关闭事实（`command-rerun-request-service.ts:442`），hook 又循环分页（`execution-driver.ts:466`），没有做到每任务每操作一次。修改思路：依赖必填或缺失返回 unavailable；在一次上层操作内共用关闭结果。

5. **已修。** 公共卡使用完整摘要；历史严格早于当前请求，取最近五条（`command-rerun-request-card.ts:176`、`:210`）。

6. **行为已修。** 两类失败卡累计保存，普通推进跳过，指定任务仍等待（`workflow.ts:2758`、`:2780`、`:2811`）。

7. **部分，必须改。** 单次分页和任务级 lookupAll 已落实（`command-rerun-request-service.ts:459`、`:551`）；但工具另有点读（`command-rerun-tools.ts:196`），不能宣称完整满足 B2-18 上界。更严重的是点读非 ready 后仍返回成功，并以本次输入替代既有等待命令（`:197`、`:199`、`:114`），会误报等待／获准的写法。修改思路：保留第8项裁定类型，补读失败明确失败；额外读取须由 lead 明确纳入上界并覆盖测试。

8. **已修，接受裁定。** `CommandRerunRequestReplyV1` 已分开无写入答复和真实 WriteResult（`command-rerun-request-contracts.ts:22`）；无需退回旧签名。

9. **已修。** 数量行独立、优先删除，候选连同省略注记计量，并累计删除的命令行（`continuation-brief.ts:411`、`:529`）。

10. **未完成，必须改。** “69处全部允许”不成立：
    - K3-35 手造 manifest/prepared，故意省去锚点节，再填写 Kernel 位置进入运行（`K3-35-continuation-fixture.ts:382`、`:401`、`:440`）。
    - B2-18 编造 Run ID、未保存的答复引用，直接 applyAnswer（`B2-18-request-reads.test.ts:108`、`:112`、`:121`）。
    
    这些并非纯函数输入或故障注入，不能证明公开路径可达。修改思路：真实 prepare／Kernel 执行、保存答复后落实；不可达极值只留纯函数测试，随后重算容量。

11. **部分，必须改。** SQLite 崩溃恢复及整段字面断言已补（`B2-09b-allowance-crash.test.ts:160`、`K3-35-T-by-hand.test.ts:91`）。但：
    - B2-15 使用 `npm run db:migrate`（`B2-15-replay.test.ts:123`），它已是原命令的直接 action（`B2-blocked-runtime.ts:271`），不能证明“依赖展开才命中”。改用只能通过脚本展开匹配的命令，再改 package.json 重放。
    - 前缀用例虽注入 claim ID，仍手造 Kernel 调用事实（`K3-prefix-claim.ts:471`、`:482`）。应保留 ID 注入，改走真实调用。
    - platform-only 空列表断言被删除（`.lead-ref/rework1.diff:8038`）。缺测试替身不等于产品不可达；增加阻塞的非进程工具依赖，恢复公开路径验证。

12. **部分，必须改。** 总净增确为 +531，即 +4,016→+4,547；答复所称该项 +238 不能证明去重完成。
    - 收据回放已接入两 owner 和 note（`unknown-call-review-service.ts:471`、`command-rerun-request-service.ts:251`、`note-service.ts:535`）；来源键解析、索引常量也已共用（`command-rerun-request-card.ts:248`、`command-rerun-request-codecs.ts:411`、`:41`）。
    - **旧副本仍在：** UCR 自有 `pinRevision`（`unknown-call-review-service.ts:347`）；两套 RunRef、TaskTriple、SessionMessageRef 校验（`unknown-call-review-codecs.ts:92`、`command-rerun-request-codecs.ts:84`）。删除这些副本，统一调用共享实现，否则规则仍会漂移。
    - **建议再删：** 只有单页调用却保留的多页水位合并分支（`command-rerun-request-service.ts:475`、`:482`）；driver 已传新失败集合后仍保留的旧集合兼容转换（`collaboration-driver.ts:818`、`workflow.ts:720`）。这些是具体减量点。

对 **UNSPECIFIED 1–8** 的意见：

- **1 有条件接受：** 真实读取下失败捕获成为 unknown（`session-anomaly-facts.ts:138`），不可达极值可留纯函数；但第10项重做前，不能认可当前 K3-35 总数及验收结论。
- **2 不接受：** 刻意省节保留八个锚点改变了被验路径，按第10项修。
- **3 不接受删除：** 采用其提出的阻塞非进程工具接缝，恢复断言。
- **4 接受：** G9 后经公开人工落实再进入审查合理（`B2-09b-allowance-crash.test.ts:192`）。
- **5 按第7项最小修改；6 必须取消缺依赖视为开放。**
- **7 接受：** 同时间历史请求用 ref-key 确定次序合理（`command-rerun-request-card.ts:150`）。
- **8 接受既有结案：** 以 lead 的 bwrap 验证为准；本轮未复跑。

先改完列出的几处