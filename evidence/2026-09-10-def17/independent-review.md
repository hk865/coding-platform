# DEF-17 独立审查

审查者未参与 DEF-17 或本次被审补测的实现。按用户委托、DEF-17 Ticket 与 independent-review Interface 审查；首轮范围哈希为 `independent-review-initial-scope.json`。这是按明确修改范围与依赖的有界审查，并非重审整个产品。原 739 文件 `5a9e…0364` 的第一阶段结论和 11b6 历史来源边界另见 state-audit，本报告不覆盖它们。

## 首轮结论（历史；补审处置见文末）

**暂不无条件收口：有一项持久观察歧义风险 D17-IR01，和一项待补的真实宿主重开覆盖 D17-IR02。** 其余已审修改符合本票职责分离与安全恢复原则；最终源码身份与最终全仓/浏览器/类型/构建/边界日志尚待主 Agent 交付。本报告将按补证与最终差异追加结论，保留本轮发现。

## 发现

### D17-IR01：生产持久观察加载吞掉同 Run 的歧义记录

`src/context/reviewer-context.ts` 的新 recovery 守卫要求公开持久观察对同一 project/goal/run 恰一条；同 Run 的 unknown、缺字段、重复、非空 trace/usage 或不一致事件应拒绝。但其真实依赖 `src/vault/runtime-observation-journal.ts` 的 `init()` 逐文件读取哈希 JSON 后执行 `committed.set(keyFor(record), record)`，不校验文件名与内容身份，亦不保留重复身份。两份同 Run 的 unknown/failed 文件会在 Context 看见前变成一条，后读 failed 可隐藏前读 unknown。现有 core 的重复数组注入测试不能证明真实存储加载拒绝此情形。

隔离复现：`observation-ambiguity-reproduction.mjs` 使用当前构建的生产 RuntimeObservationJournal，在独立 evidence fixture 中放置两份哈希命名、同 Run 身份的矛盾记录。实际输出见 `observation-ambiguity-result.json`：`persistedFiles=2`、`publicRows=1`、`publicStatus=failed`。未改用户运行记录或生产源码。该复现证明存储层隐藏歧义；并未伪称已经执行完整 HTTP 授权越过测试。

需要让实际持久来源对身份错配/重复失效关闭或保留歧义，且补实际文件加载测试；保持合法历史命名兼容，不迁移或改写旧用户记录。这属于本票“缺失/矛盾/重复持久证据必须拒绝”的限定边界，不是通用存储重构。

### D17-IR02：尚缺替代 Work 已提交而尚未开始时的真实宿主重开

首轮 HTTP/UI 用例在恢复已 settled 后才重开；core 的 `f.reopen()` 仅重新实例化 VerificationService 与 journal，保留原 in-memory Ledger/模拟观察。它们分别证明完成后重放和模块层中断恢复，但不能单独证明宿主在 Work 已提交、Reviewer 尚未启动时重开后沿正常派发/结果链接续。

主 Agent 已收到此覆盖建议，需补真实宿主/SQLite/Runtime 重开用例，断言没有额外 Work/Run、仅一次实际 Reviewer 工具执行链并正式接纳。无需做任意强杀或中途模型副作用重执行。

## 已独立核对的成立部分

- HTTP recover 只接受 scope/requestId/previousRequestId/allowExecute/reason；额外 proof、actor、verdict 被拒，沿既有 Host/Origin/token 认证。服务端只在受限 Verification → Control DI 内设置 human actor，字符串本身不冒充外部认证。
- Context 的新资格检查直接读取 canonical Work/Run/协议与已持久公开观察；精确身份、profile、独立 session、唯一 seq=1 run_crashed、canonical ended/crashed/exitCode=null 和事件绑定、readonly envelope、零 trace/usage、无 output/result、协议尾项及材料/配置当前性均有守卫。对无法证明未启动的记录保持拒绝。
- 授权有新的持久 requestId 与前驱/原因回执；Verification 先保存授权意图，再冻结 proof/CAS/idempotencyKey，并在每次提交前确保冻结字节已保存。保存失败重试不把仅在内存的命令直接提交；未知提交响应不重新生成 proof。
- Control 在首次资格/CAS检查前对已有替代 Work 做完整指纹重放；不同载荷冲突，不同身份竞争协议尾项只有一次原子追加机会。原 Work/Run 未加入 replacement 写快照；原 Result/Evidence 保留。
- 新 Work 指纹由 Verification 明确按 review-work-replace 验证；之后沿原 adoption reduction、Dispatch、readonly Runtime、原报告绑定、资格评估、Result/Evidence 和 Task/Goal reduction 链完成。真实 FAIL/INCONCLUSIVE/坏报告不允许借此重抽；旧 FAIL 不因新授权清除。
- D17-01 的两套 ReadModel 修改都把 FailedReviewWorkReplaced 送入现有 Reviewer Agent 行初始化；无额外状态权威或依赖边。
- UI 显示失败原因、资格与拒绝原因；操作锁抑制双击，本地 pending request 保存身份，丢响应查询同一回执，未知失败按钮禁用。恢复请求不发送内部 proof。

## 测试可信度与已阅证据

`tests/verification/reviewer-recovery.test.ts` 适用于模块层恢复/CAS/冻结命令/保存失败/观察反例；其中 canonical Run 与观察由 fixture 构造，不能冒称真实租约冲突或模型运行。

`tests/app/reviewer-product-recovery.test.ts` 和共享 fixture 使用真实 HTTP、SQLite、Control 租约、Runtime/沙箱与 Reviewer 材料工具。模型端是本地协议替身，按实际送给模型的材料做 read_source/read_material 工具请求，再返回预设 PASS/FAIL。由此可证明实际运行与结果链、不能证明真实模型语义判断质量。HTTP 首轮的投影失败在 `http-recovery-first.log` 保留，修复后日志为 1 文件 / 6 passed；这是已识别的产品缺陷修复，未归因环境或放松断言。

浏览器测试也使用实际构建服务与同一真实租约夹具；丢响应通过 route.fetch 先真正提交再 abort，并检查双击仅一次提交、reload 查询原回执、正式 PASS/Evidence、重开无额外执行。未知记录通过隔离持久观察注入验证禁用。最终实际浏览器日志尚待交付。

本审查者独立运行了上述小范围持久观察歧义复现，其余执行结论来自逐读测试源码及现有日志，不冒称重跑了全仓或浏览器。最终身份、所有新回归和各项验证必须在更新后另行核对。

## 发现处置的独立补审

**D17-IR01 已修并有真实持久文件 → HTTP 的回归证据。** Journal 现在校验文件名/内容 identity，重复或错位身份的所有原观察保留为 ambiguous，并暴露 integrityIssues；不将其返回为 Runtime 可恢复记录，亦拒绝后续 save 覆盖原文件。Context recovery 对 integrityIssues 明确失效关闭。这是读取/资格判定修复，没有迁移或清洗旧记录。正常单一身份保留原字节和旧 Runtime/Query 恢复协议。

`tests/runtime/runtime-observation-journal.test.ts` 的新增实盘用例覆盖 duplicate/wrong_filename、原文件不改、无法 save 覆盖及多次 init 不制造新副本。`tests/app/reviewer-product-recovery.test.ts` 的 duplicate 场景在真实宿主关闭后追加同 Run 的 unknown 哈希文件，完整重开后 HTTP view 返回 `recovery_observation_integrity`，recover 拒绝创建 Work，旧 Work/Run 不变、模型调用仍零。`observation-integrity-regression.log` 明确 2 文件 / 14 项通过（Runtime 6、HTTP 8），exit 0。本审查已逐读新生产代码、这两处测试及日志；没有只靠合成 Context 数组说明修复成立。

**D17-IR02 已补并通过。** 新宿主用例只在实际 HTTP/Control 已提交替代 Work 后暂时截停 Dispatch，断言 canonical Run 为 starting/envelope=null、没有新 Runtime 记录、模型请求零和 Result 零；恢复正常 Dispatch 后完整重开 HTTP host、SQLite/Vault、CodingAgentRuntime 与 Verification，启动扫描自动接续同一个 Work，实际 readonly 工具执行、PASS Result/Evidence 与 task satisfied 均成立。再次重开/重放不增加 Work/Result/Evidence/模型请求。`http-recovery-host-restart.log` 为 7/7，后续 `observation-integrity-regression.log` 的 8/8 HTTP 亦包含该用例。此证明边界是派发前重开，不是任意中途 OS 强杀或未知副作用重执行。

补审后没有尚未处置的代码发现。**限定设计与上述实现可接受；最终源码清单和完整验证结果仍待最后核对，不能仅凭专项通过就宣告 DEF-17 最终验收。**

## 冻结候选的独立身份核对

本次独立读取 `candidate-source-sha256.json` 并复算所有字节：**747 文件，0 缺失、0 SHA-256 不符、0 重复路径**；独立枚举相同根配置和 src/tests/scripts 范围得到同样的 747 路径，无遗漏或范围外条目。摘要为 `c399856b781f56862ae18af72bed80c2220aa26d9d3b144be87a6167cd6bac61`，与声明相同。结果和脚本为 `independent-candidate-check.json` / `.mjs`。

相对原 739 身份为新增 8、修改 17、删除 0，具体路径已经独立列出。其中新增的 SA-01 runtime.start 两个回归属于第一阶段补证，其余为 DEF-17 与 IR01。首次审查所记录的 18 个重点文件中，后续变化仅 reviewer-context 契约/实现、HTTP 恢复测试和 Vault journal，均已按 IR01/IR02 补审；另外读过新增 RuntimeObservationSource integrityIssues 声明、真实 journal 回归和内存 ActiveAgents 断言。未发现扩大其他核心功能范围的改动。

源码模式 workbench 清单覆盖 **10 个文件**，其中本次构建的 **7 个文件与 dist 逐字节相同**；另外 3 个上批 hash 名资源保留在源码目录，当前 index.html 引用新的 index-DG2ORAex.js，新构建图不引用这些旧资源。不能声称两个目录的文件集合完全相等，但页面所用构建资源一致；保留旧资源不会使当前入口回到旧 bundle。

审查者还用当前构建的 Journal 再读原隔离歧义 fixture：init 交回可执行记录 0，公开观察保留 failed/unknown 两条，integrityIssues 非空，save 覆盖被拒。独立结果为 `observation-ambiguity-fixed-check.json`；修复前复现结果未覆盖。

**本候选的代码审查接受，范围仅为状态核对补证与 DEF-17 授权恢复。** 最终全仓和浏览器仍在执行，代码接受不替代这些最终验收结果；没有证明真实模型语义质量、任意 OS 强杀恢复、一般来源失效或其余延期核心能力。

## 最终验证关联核对

上述“仍在执行”是候选核对时点记录。最终全仓与完整浏览器已完成，本审查独立复算 candidate/full-end/browser-end/final 四份清单：均为 **747 文件**，`files` 数组逐项完全相同，摘要均为 `c399856b781f56862ae18af72bed80c2220aa26d9d3b144be87a6167cd6bac61`；本次再次读取当前实际源码，**0 缺失、0 哈希不符**。最终清单的 root 元数据使用 Windows 路径，另外三份为 WSL 路径；相对路径/字节身份完全一致。

独立机器核对及日志 SHA-256 保存在 `independent-final-check.json`，可复算脚本为 `independent-final-check.mjs`。

| 验证 | 实际日志与独立核对 |
| --- | --- |
| 全仓 | `full-tests-final.log`：exit 0；逐条解析 **256 个通过文件**、测试数求和 **1664**，与末尾 256/1664 汇总一致，0 skipped 汇总。SA-01 新分支测试2、原租约2、unknown1、DEF-17 core11、HTTP8和真实 Journal6均包含在该全仓日志内 |
| 完整浏览器 | `browser-final.log`：exit 0，**25 passed (3.2m)**；逐条通过行25，0 skipped。包含真实租约/UI授权/双击/丢响应reload/结果链以及持久unknown拒绝两项新回归 |
| 后端/UI 类型 | `backend-types.log`、`ui-types.log` 均记录实际命令及 exit 0 |
| 完整构建 | `build.log` 为原 kernel/app/UI 构建链，exit 0；完整浏览器命令也重建后启动夹具服务 |
| 模块边界 | `module-boundaries.log`：exit 0，**366源文件 / 367 inventory / issues=[]**；仍明确 Python只核owner且 notASandboxVerification=true，不能冒称沙箱语义完整验收 |
| 阶段文档 | `validate-docs-progress.log` 为WSL校验13/13、exit 0；主Agent随后统一最终状态入口并再执行最终文档校验，最终状态一致性单独确认 |

失败证据保留：最初HTTP投影缺陷、IR01独立反例，以及明确没有启动浏览器的 executable-not-found 环境日志，均未被最终通过日志覆盖；前两项经相应代码/回归修复，后者使用实际存在的浏览器重验。没有用这些环境说明解释产品断言失败，也没有跳过本票产品回归。

**最终限定判断：状态核对补证与 DEF-17 的实现和运行验收可以接受。** 两项独立发现已处置；相同冻结源码下全仓、浏览器、两套类型、构建与边界均通过。服务端从可信持久事实判定、显式授权持久身份、重复/并发/丢响应/保存失败/重开、恢复后实际只读 Reviewer 与 Result/Evidence/归约链均有对应证据。用户数据的历史存在性核对另见 `historical-recovery-audit.md`：未找到范围内实际旧卡住实例，不能声称已替用户恢复旧实例；旧unknown仍拒绝，E-1历史时间来源边界继续保留。

本结论不扩大为整个产品完成：真实模型语义审查质量、任意中途OS强杀恢复、返工重验、一般来源失效、记忆/接续与全面性能工作均未被本批证明或启动。剩余工作仅为主Agent已安排的最终状态同步和其文档验证。

## 最终状态一致性已确认

上述状态同步现已完成。独立读取确认 DEF-17 Ticket 为 accepted（限定范围）；工作包、模块状态、原批状态核对验收、DEF-17验收、产品交接和延期登记一致表达“本次委托已验收并停止”，其余核心功能继续延期。原739与新747身份及对应测试数字分开，旧独立审查11b6覆盖边界、E-1字节一致但时间来源不可独立证明、旧unknown不可恢复和未找到实际历史Reviewer实例的限制均保留。

最终措辞核对又修正两处残留：旧集成交接的未修范围明确为 DEF-01…16，并注明DEF-17另票验收；REV-03将原批时点与当前源码workbench的10文件/所用7文件一致/3旧资源不引用区分。没有因此修改源码或重新实施旧修复。最终 WSL 文档校验在这两处修正后再次 **13/13、exit 0**；日志带 `CHECKPOINT: rerun after final deferred-range and workbench-identity wording corrections`，前一版本另存保留。

审查已核对最终状态文件清单逐文件字节及验证结果日志哈希；本节追加后由主Agent重新生成文档清单并绑定本报告最新哈希。**没有剩余产品代码或验收发现；本次状态统一与 DEF-17 可按用户限定范围结束。** 不需要再运行全仓或启动其他核心功能。
