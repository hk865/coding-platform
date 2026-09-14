# S05 集中验证与快照演进

## 快照和修复链

| 快照 | 指纹 | 状态与差分 |
| --- | --- | --- |
| `final-source-snapshot.json` | `d979f8cb110524cabdef76c05d962bcdc5b81bd3a334ac4764954fa0bf0530bc` | 首次集中全量输入；发现投影白盒测试仍读改名前私有字段，废弃 |
| `final-source-snapshot-02.json` | `11dcbdb3d9ffa3b8a8b6d7c8bc57ab7b0b65cf810ec18ec615590f9dcee1013d` | 只改 `tests/read-model/p1-16-continuation-projection.test.ts`，修复并清理 lane 名；随后发现 UI lockfile integrity 损坏，废弃 |
| `final-source-snapshot-03.json` | `f62404c2ca4fb77d05874b503eb9a8dbe64b20e60781b9ca15ebabbba8d16a9e` | 独立验收 FAIL；集中验证适用，但全范围审查漏掉 ArchitectureReview 链、Verification 状态和一处损坏注释 |
| `final-source-snapshot-04.json` | `d8b466e5662a6ffd054ea3aedacc7820e3048e4132bee5e8f4f07fa089e8d20f` | 独立验收 FAIL；四类机械替换反例证明第三轮扫描仍不足 |
| `final-source-snapshot-05.json` | `91da6320532dccca4d8c6f15d363dd5a1f8c1eee57d1df96ed0d82ae943d88e2` | 独立验收 FAIL；AC-S04-01 关闭，但 AC-S05-01 找到同类注释残留 |
| `final-source-snapshot-06.json` | `0e327e6ea6e26015c1dea2928a7a79617e1199af99f65de0f23e38ded9e7b582` | 独立验收 FAIL；AC-S05-01 关闭，但 AC-S06-01 找到重复规则名、缺失主体、空标题和机械空格 |
| `final-source-snapshot-07.json` | `094eb49537e667c46921074f3b15c4077dcef1c60a4bd13371857723b0b09954` | 独立验收 PASS；相对 snap-06 无增删，59 个文件变化，主要为注释与术语补全，另含一个私有常量业务改名和一处格式换行 |

六份 delta 分别在 `snapshot-01-to-02-diff.json`、`snapshot-02-to-03-diff.json`、`snapshot-03-to-04-diff.json`、`snapshot-04-to-05-diff.json`、`snapshot-05-to-06-diff.json`、`snapshot-06-to-07-diff.json`。七个快照均为 1368 条目，HEAD 均为 `ce043a650ecfabd72c55f02695204d58dd9c8b64`。

## 构建与静态检查

- `pnpm typecheck`：通过，0 诊断。
- `pnpm ui:typecheck`：通过，0 诊断。
- `node scripts/check-module-boundaries.mjs`：523 source、524 inventory、issues 为空，见 `boundaries-final.json`。
- `node --check src/app/public/app.js`：通过。
- `git diff --check`：除 Git 的 CRLF 提示外无错误。
- lockfile integrity 语法扫描：0 异常；`pnpm --dir src/ui install --frozen-lockfile` 通过。
- 根构建成功。初次原样 `pnpm build` 在 WSL 因 `npm` 不在 PATH 而未进入编译；随后用证据目录临时 shim 保持脚本参数与执行顺序，完整构建通过。
- `verify:ui-build` 最终六步通过。此前一次在删除 `dist/app/public` 后因 `npm` 缺失中止，令下次首次 `/legacy` 为 400；恢复完整构建后从干净状态验证通过，证明不是路由回归。

snap-03 的 `dist` 为 475 文件，指纹 `38975499504541c34070d17cebe700c1d9a065b126c3fb884e7c30d4c4ca020b`。snap-04 重新构建后仍为 475 文件，指纹 `9520ebc9791956847a1fc1472f2dff14469690ae80282d7412e0fc5113d07659`；逐文件差分只有 `control/plan-compiler/rework-plan-compiler.js`，原因是该文件保留 JSDoc，其他 type-only contracts 注释不产生 JavaScript。

snap-05 重新构建仍为 475 文件，指纹 `0ab997acc254eccb8fad016a8e4fda9de35b7e73bd9dfc5bce606421ca0cb0ba`。相对 snap-04 无新增/删除产物，38 个保留注释的 JavaScript 文件哈希变化；构建后复算源码与 snap-05 完全一致，见 `source-after-build-05-diff.json`。

snap-06 重新构建仍为 475 文件，指纹 `0d79b3d982cab78747efe0f0043de326262e032acaccd6e42edeaf2fa6614128`。相对 snap-05 无新增/删除产物，17 个 JavaScript 文件哈希变化；其中 3 个 fixture 产物包含去票号后的业务展示文案，其余变化来自保留的源码注释。构建后复算源码与 snap-06 完全一致，见 `source-after-build-06-diff.json`。

snap-07 重新构建仍为 475 文件，指纹 `60b47ef8ec30a4d6dc83d4a34a9870b9daccf978815dc064e36a456fc1db5a1e`。相对 snap-06 无新增/删除产物，38 个 JavaScript 文件哈希变化；变化来自保留的说明性注释和 SQLite ReadModel 私有常量改名。构建后复算源码与 snap-07 完全一致，见 `source-after-build-07-diff.json`。

## 全量与精确 delta

`full-regression.json` 是 snap-01 的一次完整 Vitest：

- 2227 tests：2041 passed、181 failed、5 skipped；
- 失败分布在 39 个文件；
- 直接根因包括 bubblewrap 不可用，以及 `p1-16-continuation-projection` 读取改名前私有字段；Reviewer/VerificationRound 的 null、INCONCLUSIVE 和 cache 缺失为 sandbox 前置失败的连锁结果。

源码修复只涉及该白盒测试。`continuation-name-fix-retest.json` 为 4/4 通过。随后从 Ubuntu noble 包只解压 bubblewrap 0.9 到 `/tmp`，设置绝对 `CODING_AGENT_BWRAP_PATH` 后重跑全部 39 个失败文件；`full-failures-bwrap-retest.json` 为 47 suites、229 tests 全通过。这 229 项包含全部原 181 个失败断言，也包含相同文件中原本已通过的用例。

snap-02 到 snap-03 只修复 lockfile integrity，不改变运行代码或测试语义；冻结锁安装是对应验证。因此没有再次机械运行全量，也不宣称 snap-03 有一次单体全量 0 失败。

## UI

Playwright 首次未执行页面断言，因为 Chromium 1243 未安装；32 项均在 1–2 ms 启动失败，保留在 `ui-regression.log`。浏览器安装到 WSL 用户缓存后，当前源码和重新构建产物运行全集：30 passed、1 failed、1 skipped，见 `ui-regression-after-browser.log`。

唯一失败为 UI-07 终端在 30 秒轮询边界未从 API 读到 `TERM_OK`；失败 DOM 和截图已经显示相同真实会话中的 `TERM_OK`。未改源码、断言或超时，单项重跑 1.7 秒通过，见 `ui-terminal-retest.log`。条件跳过是既有 memory 三用途条件场景。

## 适用结论

实施侧确认所有已观察失败都有保留记录和复验，未通过关闭 sandbox、降低权限、延长断言或恢复产品默认 fixture 来取得绿灯。snap-03 独立验收报告位于 `acceptance/snap-03/acceptance.md`，结论为 S01／S04／S05 FAIL。

snap-04 独立报告位于 `acceptance/snap-04/acceptance.md`，S01–S03 PASS、S04/S05 FAIL，新增 AC-S04-01。snap-05 对全部相关生产目录做人工语义复读并修复 95 个注释/README 文件，没有修改执行表达式、接口形状、测试或依赖；独立报告位于 `acceptance/snap-05/acceptance.md`，S01–S03 PASS、S04/S05 FAIL，AC-S04-01 关闭并新增 AC-S05-01。

snap-06 修复报告反例并扩展到同类生产注释、StateLedger 构造标签、重复业务标题和 fixture 展示文案。根/UI TypeScript 0 诊断，模块边界 523／524 且 issues 为空，受影响 8 文件 93 测试通过，完整构建成功且构建后源码零漂移。按用户的集中回归节奏，没有为该限定差分重复全量或 UI；snap-01 的集中回归、真实 bubblewrap 失败集闭环和 UI 证据依精确差分继续适用，最终接纳由独立方裁决。

snap-06 独立报告关闭 AC-S05-01，但以 AC-S06-01 判定 S04/S05 仍失败。snap-07 采用两路分域语义复读和一路跨目录只读复核，修复报告反例及同类职责说明；根/UI TypeScript 0 诊断，模块边界 523／524 且 issues 为空，ReadModel 受影响 4 文件 7 测试通过，完整构建成功且构建后源码零漂移。按用户的集中回归节奏，没有为该以注释/术语为主的限定差分重复全量或 UI。独立方重新复算源码、构建、边界和精确 delta，关闭 AC-S06-01，并判定 S01–S05 全 PASS；报告位于 `acceptance/snap-07/acceptance.md`。
