# 本次实际验证与身份

所有命令在明确产品根运行；文档命令在权威根运行。主Agent运行WSL命令获自动审批，仅使用既有Node24、Linux测试依赖、Chromium与bwrap。首次失败原样保留，表中只以实际退出码与日志作结论。

| 检查 | 实际命令（WSL bash） | 结果/日志 |
| --- | --- | --- |
| 后端及测试类型 | node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit | exit0，[typecheck-accepted.log](typecheck-accepted.log)；之前typecheck-final.log错误已修，旧日志保留 |
| 前端严格类型 | node src/ui/node_modules/typescript/bin/tsc --noEmit -p src/ui/tsconfig.json | exit0，[ui-typecheck-final.log](ui-typecheck-final.log)；[ui-typecheck.log](ui-typecheck.log)原7个未使用类型导入已删除，导出不变 |
| 全仓行为回归 | bash scripts/test-wsl.sh | exit0，296文件/1939项PASS，[full-tests-final.log](full-tests-final.log) |
| 首轮全仓 | 同上 | 293文件/1934项PASS，2失败；[full-tests.log](full-tests.log)保留。仅同步新文件登记及旧猜ID断言，修正后16项PASS，[regression-fixes.log](regression-fixes.log) |
| 独立反例 | bash scripts/test-wsl.sh tests/control/rework-disposition-authority.test.ts tests/control/rework-unknown-disposition-review.test.ts | 2文件4项PASS，[independent-counterexamples.log](independent-counterexamples.log)，也纳入最终全仓 |
| 数据/规划专项 | bash scripts/test-wsl.sh 加各报告所列路径 | 数据3文件11项PASS [data-tests.log](data-tests.log)；规划3文件39项PASS [ac-plan-tests-final.log](ac-plan-tests-final.log)，原失败保留 |
| Module结构 | node scripts/check-module-boundaries.mjs | 409解析源文件+1仅归属文件，issues=[]，[boundaries-final.json](boundaries-final.json)；不代替责任/DI审查 |
| 实际构建 | PATH以现有.local/def17-bin开头，pnpm build | exit0，[build.log](build.log)，内核/后端/UI均构建。pnpm freshness报告already up to date；源码清单未见package/lock改变 |
| 构建路径 | node evidence/2026-09-11-architecture-convergence/check-artifacts.mjs | 340个非UI编译JS均对应当前TS路径，0旧路径孤儿，[build-artifacts.json](build-artifacts.json)；copy-ui现有流程清理旧工作台，Vite写真实服务目录 |
| 文档 | node dev_docs/verification/validate-docs.mjs（权威根） | 13/13 PASS，[docs-accepted.log](docs-accepted.log)；Windows路径/历史副本/中间缺链失败另存，不改validator |
| 浏览器 | CHROME_PATH=/home/han001/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome，CODING_AGENT_BWRAP_PATH=产品根/.local/toolchains/bwrap/usr/bin/bwrap，PATH添加既有.local/def17-bin，然后node src/ui/node_modules/@playwright/test/cli.js test --config src/ui/tests/playwright.config.ts | 25项全部PASS，[browser-accepted-2.log](browser-accepted-2.log)，最终浏览器构建使用清除多余类型导入后的源码 |

浏览器环境失败：[browser.log](browser.log)默认headless_shell-1243不存在，25项未能启动浏览器；指定已有Chromium后[ browser-final.log ](browser-final.log)中两项真实运行因遗漏bwrap变量在模型前拒绝，中止该轮；[browser-accepted.log](browser-accepted.log)记录中止服务占端口。已核对PID/启动时间，仅清理本次4399遗留服务；9月10日既有服务保留。错误上下文原样保留browser-first-results、browser-second-results，不下载浏览器或依赖，不修改产品沙箱守卫。

## 独立复核

- 数据实现由audit_interaction复核：[final-review-data.md](final-review-data.md)。
- 治理视图由audit_data复核：[final-review-view.md](final-review-view.md)，发现矩阵混版由原实现者修复。
- 规划身份由audit_data复核：[final-review-plan.md](final-review-plan.md)。
- 主Agent验证/处置/材料传递由audit_interaction复核：[final-review-verification.md](final-review-verification.md)，追加独立反例并修unknown主提示。
- 规范/状态/义务承接由未参与文档实现的audit_interaction复核：[final-review-docs.md](final-review-docs.md)。5个小文案/路径错误已修正，独立审阅者已追加结案确认。

## 身份与限制

[baseline.json](baseline.json)固定审查初始dirty源码/文档；[resumed.json](resumed.json)固定暂停后外部修改状态；[candidate.json](candidate.json)记录通过最终全仓的候选。候选之后的唯一产品源码改变是app/governance.ts移除7个多余type导入，由前端严格类型检查验证，不改变导出和运行JS；交接/文档/测试生成状态另行变更。最终[final.json](final.json)保存实际交付身份，逐文件变化与归属在[convergence-changes.json](convergence-changes.json)。测试生成src/ui/test-results不是产品实现证据；dist、依赖与本次evidence不计入源码摘要。

两个HEAD保持初始值，不能代表已有未提交修改。旧历史文件按原位置解释相对链接，原文复制为.md.txt，不拿历史中的授权当当前执行命令。没有丢弃未完成义务或把旧失败改成PASS。

范围限制：真实UI/HTTP/内核流程有替身模型，不能证明模型质量或完整自治效果；本次没有付费真实模型/公开benchmark实验。源码复读不是多文件原子快照，SQLite两连接测试不是多进程竞争实测；全部新版本重验/决定回流/长期记忆等仍见唯一当前能力清单。

最终身份：product e36ef463ceaa002089c1dfb53688a4b49638396e61c7b69574e68943f39259bf（1392纳入范围文件）；docs 1ff1fb27b8aabf980c550d3378bb4c31bc670750c3a1ff077cb76e0055b72053（485文件）。完整逐文件范围见final.json；整体摘要含交接与测试生成记录，不把它当纯运行代码身份。

交付前closure.json复扫与final.json的产品/文档摘要完全一致；没有发现最终封存期间并发源码或规范修改。
