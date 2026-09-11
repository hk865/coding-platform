# DEF-17 与原修复最终状态核对验收

状态：**原修复状态核对与 DEF-17 均按限定范围验收接受，当前委托已完成并停止。**范围为用户 2026-09-10 委托的状态核对和 DEF-17；不表示整个 Agent Platform 完成。

## 身份与第一阶段结论

第一阶段按限定范围接受，完整依据见[状态核对验收](../2026-09-10-external-review-repair/state-audit/acceptance.md)。原 739 文件清单的摘要 `5a9e9eb1f7030860f54d16a2dff87a90f8a17c77f710ca70f212b788ac210364` 与接手时源码逐文件相符；既有 253 文件 / 1641 项和浏览器 23 项日志已核实。旧独立审查最初针对 11b6…00e6，完整旧清单未找到；后续按 REV 修改列表及可取得的清单做有界补审，不能宣称证明了全部旧差异或原测试运行时的开始/结束身份。

必要补证只有 SA-01 真实 runtime.start catch 与未知对照、SA-02 默认 CLI 样例入口、SA-03 就绪探针旧前缀跳过机制。原错误覆盖声明、未注册的旧注入分支和原失败日志保留，补证由未参与实现的审查者核对。E-1 恢复文件为 19161 字节，SHA-256 `00dfc41f9fe04e8156b2279dd1d213b416894d1ea7ea693dcc663fef655cd8fa`，与历史清单及 git blob `e1eda07e1a8f6dbe22915d24e78ace91be8b993a` 相符；blob 没有时间戳、历史清单未跟踪，历史产生时间仍不可独立证明。缺失的 reviewer-work 修复前字节不重建。

本次候选为 **747 文件**，摘要 **`c399856b781f56862ae18af72bed80c2220aa26d9d3b144be87a6167cd6bac61`**。范围和算法见 [source-identity.mjs](source-identity.mjs)，清单见 [candidate-source-sha256.json](candidate-source-sha256.json)。相对原 739 身份新增 8、修改 17、删除 0；[独立清单核对](independent-candidate-check.json)确认 0 缺失、0 哈希不符、0 重复、独立枚举无遗漏。源码模式 workbench 保留 10 文件，其中当前构建的 7 文件字节与 dist 一致，另 3 个旧 hash 资源未删除且不被当前入口引用。

开始候选、全仓结束、浏览器结束和最终源码四份清单摘要相同，均为747文件/c399…ac61，当前源码逐文件无漂移。结束清单为 [full-end](full-end-source-sha256.json)、[browser-end](browser-end-source-sha256.json)、[final](final-source-sha256.json)。日志命令、退出码和字节摘要见 [verification-results.json](verification-results.json)。最终计数从原1641增加23项：SA-01两项、DEF-17核心11项、HTTP八项、持久观察两项；浏览器从23增加两项。

## DEF-17 实现与场景

实施前已写[Ticket 与验收场景](../../../agent_learn/agent_dev/agent_platform/dev_docs/planning/active/external-review-repair/DEF-17-reviewer-product-recovery.md)，契约唯一来源为[独立 Reviewer Interface](../../../agent_learn/agent_dev/agent_platform/dev_docs/interfaces/independent-review.md#已知启动前失败的产品恢复def-17)。UI 审阅详情显示失败原因、恢复资格与拒绝原因，用户填写原因并显式授权；HTTP `/api/real/verifications/reviews/recover` 沿用现有会话认证，只接收 scope、requestId、previousRequestId、allowExecute 和 reason。proof、actor、verdict 等客户端字段被拒。

Context 从可信持久观察与 canonical Work/Run/Protocol 判定资格；Verification 先持久化授权身份，再保存冻结命令与回执；受限 Control 端口复核并原子创建替代 Work/Run/Attempt/Outbox。重复提交重放同一命令，不为失败自动生成授权。新 Work 继续原 Dispatch、只读 Runtime、报告资格、Result/Evidence 接纳及 Task/Goal 归约链。

| 验收场景 | 实际覆盖与边界 |
| --- | --- |
| 真实租约冲突后的 HTTP/UI 授权 | 真实 Control 写租约阻止 Reviewer 读租约，产生持久 failed 和 canonical ended/crashed、模型零调用；释放冲突，显式授权后实际读取源码/材料并接纳 PASS。新 Reviewer 运行在 liveRuns/ActiveAgents 可见。 |
| 合法 FAIL 不洗掉 | HTTP 恢复后实际 Reviewer 返回 FAIL，正式 Result/Evidence 阻断 Task；再次恢复拒绝，旧 Work/Run/Result/Evidence 保留。 |
| 已知未启动与未知对照 | canonical outcome_unknown、观察 unknown、缺字段/缺失/重复/身份不符、已开始事件、非空 trace/usage、旧协议尾项、来源/配置过期、已有报告/Result 均拒绝。真实磁盘矛盾观察重开后也拒绝，不只验证合成数组。 |
| 重复与并发 | 同 requestId 同载荷重放，改载荷冲突；不同身份并发由协议 CAS 只接纳一个替代 Work。UI 双击只提交一次。 |
| 丢响应与重启 | 覆盖 Control 提交后响应丢失、HTTP 实际提交后丢响应、UI reload 查原回执、授权意图/冻结命令保存及保存失败、提交前重开、Work 已受理尚未派发时完整宿主重开、完成后再重开。无重复 Work、Reviewer 执行或接纳。 |
| 实际结果链 | HTTP/UI 使用真实 SQLite、Vault、Control、Runtime、沙箱及 Reviewer 材料工具。模型端为本地协议替身，发起实际 read_source/read_material 再返回 PASS/FAIL；证明执行和结果链，不证明真实外部模型的审阅语义质量。 |

核心专项见 [core-recovery.log](core-recovery.log)（11 项），真实持久与 HTTP 合并回归见 [observation-integrity-regression.log](observation-integrity-regression.log)（2 文件 / 14 项，含 Runtime 6、HTTP 8），浏览器专项见 [browser-targeted.log](browser-targeted.log)（2 项）。这些专项不能替代下列最终全量验证。

## 实际发现与独立审查

- **D17-01 已修**：首轮 HTTP 恢复已完成结果链，但新运行未投影到 liveRuns。[原失败](http-recovery-first.log)为 2 failed / 4 passed。两套 ReadModel 都补上 FailedReviewWorkReplaced 的既有 Agent 行初始化，保留两种后端和实际 HTTP 断言。
- **D17-IR01 已修**：独立审查实盘复现同 Run 的 unknown/failed 被 Journal 覆盖成一条 failed。Journal 现在保留歧义、报告 identity 问题、不交回可恢复记录并拒绝覆盖原文件，Context 失效关闭；[修复前](observation-ambiguity-result.json)和[独立修复后复核](observation-ambiguity-fixed-check.json)均保留。
- **D17-IR02 已补**：真实宿主在替代 Work 已提交、模型尚未开始时关闭重开，正常派发同一 Work 并完成 PASS/Evidence，重复重开不重复执行。[宿主重开日志](http-recovery-host-restart.log)及最终 8 项 HTTP 套件均覆盖。

[独立审查](independent-review.md)由未参与上述实现的审查者完成，包含首轮发现、补审、候选全部字节身份及变更范围核对。候选代码、最终全量日志与结束身份均经独立关联核对接受，无未处置代码发现。

## 最终验证

WSL Node v24.18.0、仓库 scripts/test-wsl.sh、真实 bwrap 执行沙箱；命令与环境入口为 [run-checks.sh](run-checks.sh)。WSL 没有 npm，局部 shim 仅把仓库 build 中 npm run/--prefix 转发为同一 pnpm script。执行沙箱未关闭，失败测试未跳过。浏览器沿用仓库既有 Chromium 启动参数（包括原有 `--no-sandbox`），该配置不在本次变更中；此浏览器运行不证明 Chromium 自身的沙箱隔离。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| 全仓 `bash scripts/test-wsl.sh --maxWorkers=2` | exit 0；256 文件 / 1664 项全部通过 | [full-tests-final.log](full-tests-final.log) |
| 完整浏览器 `pnpm run ui:test`（含配置的构建） | exit 0；25 项全部通过 | [browser-final.log](browser-final.log) |
| 后端 TypeScript `tsc --noEmit` | exit 0 | [backend-types.log](backend-types.log) |
| UI TypeScript `tsc -p tsconfig.json --noEmit` | exit 0 | [ui-types.log](ui-types.log) |
| 仓库 `pnpm run build` | exit 0 | [build.log](build.log) |
| `node scripts/check-module-boundaries.mjs` | exit 0；366 source / 367 inventory，issues=[] | [module-boundaries.log](module-boundaries.log) |
| 文档根 `node dev_docs/verification/validate-docs.mjs` | exit 0；最终状态下13/13 | [validate-docs-final.log](validate-docs-final.log) |

环境前置问题单列：工具沙箱内 WSL 服务访问 E_ACCESSDENIED，审批后的正常 WSL 可用；第一次浏览器配置指向不存在的 Chromium 可执行文件，日志 [browser-environment-missing-executable.log](browser-environment-missing-executable.log)保留，改用现有实际路径后专项通过；Windows 下文档校验不能解析既有 POSIX 路径，正确 WSL 入口 13/13。测试编写期间的类型/fixture 导入错误修复后重新校验，未当作环境问题。D17-01、D17-IR01 是产品问题，已实际修复，未用状态文字或放松断言替代。

## 历史记录与延期

已有完整可信未启动观察、canonical ended/crashed 且协议/来源/配置仍当前的 failed 可以从原审阅详情显式授权。旧 outcome_unknown 即便旧日志称模型调用为零仍不能恢复；缺失、矛盾、身份不符或不完整持久事实继续拒绝，真实 FAIL 仍保留。没有迁移、修正或自动重新执行历史记录；本批验收不声称替用户恢复了任何实际旧实例。

[历史恢复资格核对](historical-recovery-audit.md)只读检查 22 个现存 `.local` 数据目录、42 个运行/验证目录及 21 个 SQLite Ledger，未找到 Reviewer 持久实例，0 读取错误。报告列出旧 F-01 unknown 与修复后 known 测试样本的具体身份和证据边界：前者必须继续未知，后者的旧日志不能代替当前可查询的持久证明；相同 fixture Work ID 也不表示旧实例被原地转换。没有扩大到未知数据目录或声称搜遍所有历史记录。

DEF-17 完成后停止。返工重验、已接纳 Evidence 的一般来源失效与正式来源推进、记忆、接续、全面性能重构和[其余延期项](../../../agent_learn/agent_dev/agent_platform/dev_docs/planning/active/external-review-repair/deferred-register.md)保持原状。任意 OS 强杀恢复、Windows 原生全套运行、真实外部模型语义质量及整体自治产品不由本批证明。全部既有未提交改动、有效要求和历史证据保留；未 reset/clean/stash/commit/push，未修改 vendor 源码、未重跑一次性迁移脚本、未新增累计预算。
