# Sol / dsh 返修验收证据（2026-09-24）

结论见[独立验收报告](../../R3a-R4a-sol-dsh-acceptance.md)。[final-manifest.json](final-manifest.json) 记录最终源码、原冻结测试、真实旧库 SHA-256 与检查结果；`final-source/` 保存本批最终源码，lane 的 `before/` 保存派发基线。时间字段是 Unix 秒。

- `r3a-sol-01/root-red.log`：最初23项中7 RED；`root-raw-red.log`：补 raw batch 后24项中1 RED；`root-final-contract.log` / `root-final-regression.log`：24 / 108全通过；另有 Control/Ledger 676及P1-01 6项日志。
- `r4a-sol-01/root-red.log`：最初10项中6 RED；`root-environment-red.log`：14项中3 RED；`root-revision-red.log`：17项中2 RED；`root-final-contract.log`：17项全过。`root-pre-revision-fix-*` 与 `root-after-environment-fix-regression.log` 属中途通过记录，不能代替最终验收。
- `kernel-post-build-regression.log`：最终新构建完整 Kernel 207通过 / 1跳过；`platform-kernel-integration.log`：平台新产物接线19项全过。
- `integrated-build.log`、两份types与两份architecture日志：全部exit0。`kernel-changed-files-lint.log` 有5项既有错误；`lint-baseline-comparison.json` 核对派发前相同正文，未新增。
- lane `scope-before-import.json` 验证无越界、合入前主工作树与基线一致；`lane-final-manifest.json` 保留主 Agent 批准的测试 / 骨架变更。`final-write-probe.json` 只尝试打开写句柄、不写字节，验证实现可写、冻结文件EROFS。R4a仍保留R3a更新前的三个测试副本且从未运行它们；主工作树采用R3a测试owner的新版本，差异在final-manifest明列，不误报为dsh改测试。
- `attempt-*/final.md` / `result.json` 是dsh自述及退出状态，不代替独立验收。不保存thinking正文，不包含凭据。为补骨架主动暂停的exit130有保留，不计完成。

集合存在重叠，不相加冒充全仓总数。9月23日失败证据保留在相邻目录。本轮未提交 / 推送，用户已有改动保留。
