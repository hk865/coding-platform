未发现必须改项。仅静态核对，未修改文件、运行测试或构建。

1. 公开输入边界成立。`core-routes.ts:1083` 只传两参；输入含该键会回 `invalid` 并点名（`workflow.ts:687`）。组合层确实转发 `...args`（`create-platform.ts:1773`），但这是可信 Host 端口（`docs/refactor/modules/business/workflow.md:414`），由 Host 接给驱动（`host.ts:534`）；驱动第三参取自句柄集合，不取调用方对象（`collaboration-driver.ts:818`）。未发现其他公开请求把对象转入第三参的通路。

2. 寿命保持返工3规则：仅 `select_work` 或继续落实答复的后继携带；集合从 `next` 剥离、放在旁边（`workflow.ts:420、428、481`）。等待、完成不带集合（`:498、502`）；失败后的重新包装正确保留续传（`:1909`）；驱动按结果更新，退出及停止清空（`collaboration-driver.ts:829、918`）。

3. 测试满足任务书：真实同项目已答卡经路由被拒，随后无键推进确实落实；失败返回的 `next` 无键（`K3-46-review-advance-failures.test.ts:648、660、694`）。Host 测试只改第三参转发，断言未变（`.lead-ref/rework4.diff:468、478`）。建卡走正式认定，答复走公开入口，故障包装只拒绝提交，未注入成功事实（`K3-review-card-fixture.ts:272`；`K3-46-review-advance-failures.test.ts:92、253`）。

4. A2 补桩合理。静态回推返工3就会因缺接线多出 `problems`，破坏原断言（`startup-reconcile.ts:545`；`A2-startup-redrive-select.test.ts:112、124`）。未接时记录问题、返回空列表并继续；生产组合无条件接真实读取（`create-platform.ts:1884`）。这是夹具遗漏，未见生产回归。不能说扫描由 B1 才新增：组合注释明确 B1 沿用 `listReviews`（`:1882`）。

5. UNSPECIFIED 均可接受：结果字段名、空集合省略、内部额外键容忍、`undefined` 视为空、外项目回 `forbidden`（`contracts.ts:234`；`workflow.ts:489、658、662、672`）。建议校正 `workflow.ts:1344、1893` 仍称集合在输入／`next` 内的旧注释，避免误导维护；修改思路是改写为内部参数及结果旁字段，不影响合入。

可以合入