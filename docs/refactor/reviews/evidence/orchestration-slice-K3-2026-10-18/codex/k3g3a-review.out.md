只读审查完成，未修改文件，未运行测试或构建。以下不计第二次会话和第4组尚未施工的内容；文件名均指当前副本。

§3 十项返工：

| 项 | 结论 | 证据 |
|---|---|---|
| 1 名称分派 | 是 | `tool-commit-lookup.ts:34` 固定分派到对应 owner。 |
| 2 请求身份 | 是 | `tool-commit-arguments.ts:64` 显式取字段；`execution-driver.ts:476` 共用；`plan-service.ts:2290` 共用 actor 算法。 |
| 3 草稿检查 | 是 | `run-reconcile-service.ts:272` 检查三项 Run 事实，`:935` 传入事实。 |
| 4 streak 重置点 | 是 | `task-failure.ts:595` 停止回溯，`:605` 保留已收集 Run 的判断。 |
| 5 路径保护 | 部分 | `continuation-diff-reads.ts:122` 检查词法路径，`:128` 未检查真实目标是否受保护。 |
| 6 完整采集、脏基准 | 是 | `context-assembler.ts:882` 读完整采集；`:921` 排除脏基准；`continuation-brief-assembly.ts:241` 支持未知。 |
| 7 捕获时忽略 | 部分 | `workspace-change-capture.ts:125` 的枚举漏掉已经删除的路径。 |
| 8 G11 短路 | 是 | `run-reconcile.ts:471` 先判清单，`:473` 才采集。 |
| 9 测试返工 | 部分 | 字面 ID、关闭目标、真实 edit 类别已补：`K3-39-request-id.test.ts:29`、`K3-R1-restart-flows.test.ts:180`、`K3-R1-file-change.test.ts:81`；决定工具的命中仍未贯穿生产分派链，见下。 |
| 10 基准读取去重 | 部分 | `workspace-baseline-artifact.ts:43` 共用读取，但异常降级丢掉有效 manifest。 |

以下均为**必须改**。

1. **Workflow 的定稿请求不能提交，且身份没有区分轮次。**  
   `workflow.ts:209` 发送空版本钉；`unknown-call-review-service.ts:426` 要求钉住记录。任何 UR2/UR4 真正执行都会被拒。请求又只含记录、cause，同一 flow 的第二轮会重用第一轮身份（`workflow.ts:138`），owner 将返回旧回执（`unknown-call-review-service.ts:405`）。修改思路：构造步骤时读取并钉住记录 revision，将该版本纳入请求身份；同一请求重试保持身份，下一轮产生新身份，避免“返回 committed、当前轮却没收尾”。

2. **Workflow 三处判断仍不符合 UR 表。**  
   `workflow.ts:2039`、`:2053` 用只接受 completed 的 `normalEnd`（`:450`）；核对轮 failed/cancelled 后直接等待，不能立即定稿。`:1218` 又仅凭 starting 重准备，未用已有 `isUnadmittedStarting`（`:941`），把进入中、进入前暂停混入 UR3a。`:1266` 的 Session 忙最终在 `:1508` 阻塞整个目标，另一个可运行任务也被拖住。修改思路：已知终态统一转定稿；UR3a 复用正式未进入判定；忙任务返回 skip，指定任务才等待。

3. **owner 会收尾结果仍未知的轮次。**  
   `unknown-call-review-service.ts:443` 仅检查 ended。首轮 outcome_unknown、未写结论时，`:466` 选择 unfinished，`state/unknown-call-review.ts:358` 清掉 activeRound，但未知 Run 仍占租约。修改思路：owner 必须同时排除 null/outcome_unknown，返回 busy、零写。另本轮已承诺的 UCR-08b 也有分支错误：resolved+held 的首轮失败仍走 unfinished（服务 `:466`），被状态机 `:346` 拒绝而卡住；应优先走已有 settled→settleHeld（状态机 `:378`）。

4. **阻塞(a)成立，但只补 suffix 不够。**  
   `context-assembler.ts:1385`、`:1422` 把核对说明标成 continuation；`context-input.ts:269` 因没有 brief 拒绝；即使补 suffix，`execution-entry-service.ts:1141` 仍要求 work。修改思路：保持 Work 调用，增加专用核对 section，由可信 purpose 要求它存在，并校验结构化说明的渲染与区间一致；不要伪造 continuationBrief。现有 inputDigest/manifestDigest 已绑定整份内容（`execution-entry-service.ts:2104`），不必另存重复全文；但 `:1564` 将核对字段缺失视为匹配，必须改为拒绝。

5. **阻塞(b)成立，而且有两层转发遗漏；随后还有权限阻塞。**  
   `runtime.ts:426` 依赖的新方法，`runtime-configuration.ts:453` 没提供，`host.ts:336`、`host-settings.ts:233` 的包装也不转发，正常配置因此被判 unavailable。U5 要求探测参数与实际工具一致：应让 Workflow 传实际选中的 Role/绑定，复用 `runtime-configuration.ts:361` 的选择函数，贯通三个环节并保留开关收窄；不能任取同工作区第一个绑定，也不能新增“工作区只能一个绑定”的限制。  
   此外，prepare 固定工具（`execution-preparation.ts:318`），启动却仍按普通 Role/Host tools 拦截（`execution-driver.ts:553`、`:577`；`create-platform.ts:442`）。原职责只有 read/shell/edit 就启动失败。应在共同准入链按可信 review purpose 接受恰好 L13 集合和空写范围，保留 Role 有效性及 Host 开关、全工作区读取、当前授权检查。

6. **L13 输入有三个实际偏差。**  
   `execution-preparation.ts:414` 把 UTF-8 startByte 当 JS 字符下标；前缀含“中”即可多截入核对正文，再追加一次，破坏区间和预算。应按字节切分或直接传 prefix。`context-assembler.ts:375` 从最多50条的 sample 取“前200条”（上限见 `workspace-change-capture.ts:335`），51条短路径也漏证据；应复用完整 capture 读取。`:357` 只裁 command，`:368` 保留完整 cwd，cwd 自身超过4 KiB即可突破单项上限；应共享 command+cwd 字节预算。

7. **工具适配器挡住了 owner 的先重放保证。**  
   `unknown-call-review-tools.ts:153` 先读当前记录，`:166` 才调用 owner。一次提交成功但回包丢失，随后当前记录读取失败，同身份重试拿不到已存在的回执，违反 L14。修改思路：让 owner 先查回执、未命中后自己读取并钉住当前版本，移除适配器这道前置读取；保留 owner 的 Run/记录 CAS。

8. **listReviews 是全量扫描后的切片，既有总量上限，又混合水位。**  
   `unknown-call-review-service.ts:596` 最多读100×200条，`:613` 报 capacity；20,001条记录时 limit=1 的第一页也失败。`:608` 只保留首个水位，状态迁移发生在两次查询之间时，`:618` 可能保留旧版并混入新记录。修改思路：采用真正的底层续读游标、多状态有界合并；同次读取水位变化则重试，取消总数上限。

9. **返工5、7、10还各有一个反例。**  
   - `continuation-diff-reads.ts:125` 只 lstat 最终组件，`:134` 直接读取真实路径。把公开目录换成指向 hidden-tests 的目录链接，普通文件便泄露进 diff。应对真实相对路径再次检查保护规则，或复用 WorkspaceSandbox。
   - `workspace-change-capture.ts:125` 不枚举不存在的 ignored 文件；基准收下 x.txt，随后删除并加入忽略规则，`:313` 仍将其报删除。应按捕获时规则检查起止路径全集，包括不存在的路径。
   - `workspace-baseline-artifact.ts:43` 的基准读取/解析异常被 `:48` 变成整包 null；`create-platform.ts:1577` 随后误报没有 owning Run。应局部捕获基准错误，保留 manifest，只令 baseline=null。

10. **已宣称完成的测试不足以证明真实链路。**  
    K3-10 的12格原因是字面量，但 `UCR-settle-review.test.ts:65` 注入记录、`:240` 直接调用 owner；K3-12 停在 prepare（`K3-12-review-round-tools.test.ts:244`），写失败由替身返回（`:331`）；K3-14 注入 purpose、stub owner（`K3-14-record-unknown-call-review-tool.test.ts:192`、`:218`）；K3-48（二）直接造大记录（`K3-48-2-unknown-call-review-model-text-budget.test.ts:95`）。这些用例在真实启动、定稿坏掉时仍可全绿。应补足已认领行的 RUN-25/认定→Workflow→脚本模型→真实 owner→定稿路径。  
    K3-47（三）用取消未进入的轮次代替正常核对结束，并读内部存储事实断言（`K3-26-unknown-call-review-storage.test.ts:598`、`:612`、`:619`）；应换公开读口并覆盖实际结束链。返工9的决定工具命中测试仍直接 lookup（`S5R2-agent-application.test.ts:374`），分派测试只测 miss（`K3-39-tool-commit-lookup.test.ts:338`）；须补生产来源、Host 上下文的命中/冲突。

其余裁定：9(b) 改用 materials/open 可以接受，prepare 后尚无绑定，executions/brief 确实不能读（`runtime.ts:521`；`support/brief.ts:115`）。alias 在记录内不可变，可作为 callId 的等价身份编码（`unknown-call-review-service.ts:274`）。旧 `K3-R1-second-cleanup.test.ts:155` 跳过核对直接准备 B，按 L11 应被挡；应先真实完成 A 的核对并定稿，再保留 `:175`、`:190` 的原断言。核对 Run 不进入 B→A 的返工链（`task-failure.ts:568`），不会因此抹掉原测试意义。

**建议（成本）：** 约2,173行比软预算多373行，不能仅凭超额判错。可合并 `context-assembler.ts:958` 与 `:1009` 的同一历史边界扫描，约省20–35行；定稿逐条读 display（`unknown-call-review-service.ts:373`）会重复读取、解析同轮 manifest（`create-platform.ts:640`、`:646`），应一次按 round 读取全部 alias→display，32条同轮结论可从32次降到1次。这些合并不删规格规则，但不足以声称已收回全部超额。

先改完列出的几处