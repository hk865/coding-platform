# R-4 有界故障注入证据（独立审查 REV-07 要求）

外审 R-4 的机制问题是：restart 就绪探针用 `catch { return false; }`，配合
`describe.skipIf(!READY)`，会把**真实回归**变成 SKIP。修复后
`tests/restart/readiness-probe.ts` 只把显式"未实现"哨兵转为 not-ready，其余一律抛出。

## 证据一：真实回归必须 FAIL（`r4-injection-regression-FAIL.log`）

`r4-injection.test.ts` 导入**产品自身的**探针，注入一个真实回归
（`ProjectionRepository returned a stale event page`，不是未实现哨兵）。

结果：`Test Files 1 failed (1)`，exit 1，失败原因是 `Failed Suites 1`——
探针把真实回归抛了出来，整套因此**失败**而不是跳过。

同一文件内的 `pre-fix idiom` 组（`catch { return false; }`）在**同一次运行**中被跳过，
即：同一注入，修复前 SKIP、修复后 FAIL。

复现：把 `r4-injection.test.ts` 放回副本的 `tests/restart/`，用
`r4-injection.vitest.config.mjs` 运行。

## 证据二：真正的未实现哨兵仍应 SKIP（`r4-sentinel-SKIP-ok.log`）

注入 `P1-09 lane: query-context assembly not implemented yet`（能力未实现），
探针返回 `false`，该组按设计被 SKIP；同一文件另有一项断言
`classifyRestartProbeError(sentinel) === false`，证明"只有哨兵才转为 SKIP"。

结论：修复既恢复了 FAIL 的传播，又保留了"未实现能力不误报为失败"的原有语义。
