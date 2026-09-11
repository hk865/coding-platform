# SA-01…03 补证独立复核

审查者：原 `independent-state-audit.md` 的只读审查 Agent，未参与补测或 DEF-17 实现。本次读取新测试、补证脚本和日志，不自行重跑套件。

**结论：三个原发现已有对应的有效补证，可以关闭其限定验证缺口。** 旧日志和原测试均保留；旧 11b6 完整差异集合与 E-1 时间来源边界不因此消失。

| 发现 | 独立复核 | 结论与范围 |
| --- | --- | --- |
| SA-01 runtime.start catch 未覆盖 | 新 `tests/control/reviewer-runtime-start-rejection.test.ts` 保持真实 readonly envelope、成功的 Reviewer 材料和 grants；wrapper 分别对真实 Runtime 调用 close/markUnknown 后调用真实 start。断言 materials/start/rejection 各恰一次，且已知失败恰一条 canonical crash、公开观察一致，未知状态不制造 runtime terminal event，重复 drive 不再 start。`prestart-coverage.log` 确为 3 文件 / 5 项通过，其中新增文件 2 项。 | 成立。断言对新增 catch 有判别性：删除该 catch 后 rejection 计数不会为 1，known case 的首次 drive 亦不可能给出其要求的 known crash。未看到实际“删除 catch”变异运行日志，故只声称经代码核对确认判别性，不声称独立执行过变异。close/markUnknown 是受控触发前置状态，用例没有覆盖任意进程强杀恢复。 |
| SA-02 默认 CLI 无烟测 | `default-cli-smoke.mjs` 实际 spawn `dist/app/server.js`，新建独立临时 cwd/data，未向 createGuiServer 传 fixture 开关；HTTP meta 断言 fixtureEnabled，再通过 sample plan 与 task run 断言 started=1、completed=1、failures=[]。`default-cli-smoke-isolated.log` 有 PASS、实际 drive 结果及子服务监听输出。 | 成立。覆盖默认捆绑宿主 fixture 入口和结果，未冒充真实模型 Reviewer 执行。先前 `default-cli-smoke.log` 的 ready=false AssertionError 保留；它只证明该次就绪等待失败，不能单凭日志认定是环境故障或扫描性能根因。后续空 cwd 测试证明独立小项目能正常就绪。 |
| SA-03 同次运行旧分支 SKIP 声明无日志 | 独立 `r4-prefix-injection.test.ts` 不导入会顶层抛错的 post-fix 模块；一条实际断言验证 catch-all 对真实 regression 返回 false，另一条被旧 gate 跳过的测试若运行会抛同一错误。独立 config 仅选择 evidence 内该文件。日志确 1 passed / 1 skipped。 | 成立。与原 post-fix FAIL 和 sentinel SKIP 共同形成分开的三向证据；这是专门演示历史坏行为的故障注入 skip，不是跳过产品验收。仍不能改写原日志成“同次运行已证明旧 SKIP”。 |

新增测试第一轮的 authoring failure 在 `prestart-coverage-test-authoring-failure.log` 保留，结果说明明确将其归为测试断言错误（比较遗漏合法 policyRevision）；改为部分匹配仍保留 tools/writeScope 守卫及完整执行路径、理由和计数断言。未见放宽产品断言以掩盖失败。

此处只关闭 SA-01…03 的缺口。DEF-17 的服务端可信判定、授权身份、并发/重启、历史未知记录和恢复后 Reviewer 完整结果链，仍由其单独验收及独立终审决定；最终源码的全仓、浏览器、类型、构建和边界检查仍需最终批次证据。
