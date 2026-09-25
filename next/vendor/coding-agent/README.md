# 冻结 Kernel 公共依赖

本目录的 `dist/` 从 2026-09-24 已通过 R4a 验收的本地 Kernel 构建中复制；是实体文件，不在目标运行时读取原 Kernel 源码。原 `package.json` 仅保留版本/依赖等来源信息，不宣称附带其开发源码或可重跑其中全部脚本。

目标只导入 `dist/public-api.js`。第三方包在本机复用已安装依赖目录；它们不是旧平台模块。源码映射嵌入了对应 Kernel 来源文本，供调试定位，不增加运行导入。

本批哈希清单：`docs/refactor/reviews/evidence/next-clean-migration-2026-09-24/kernel-packaged-hashes.json`（相对工作区）。编译产物、声明文件和映射一起冻结；`next/.gitignore` 明确允许该产物进入版本管理。更新依赖时需要重新跑 Kernel 与目标接入验收，不能自行链接回旧源码。

## 2026-09-25 受管历史范围读取补丁

R4c.2b 在本目录保存 `SqliteStores.read` 的[补丁源码](patches/storage/adapters/sqlite/sqlite-stores.ts)及[维护说明](patches/README.md)，其余来源产物保持冻结。`next/scripts/build-kernel-patch.mjs --check` 重建并比较该文件的 JS、声明与映射四项产物，已经纳入 `verify:isolated`。修改先落补丁源，再由脚本生成，不直接手改 dist；原 Kernel 工程源码仍只读。

补丁复用原 `session_id, position` 主键做有界读取，并在一个只读快照中获取 header/tail/page；无新增历史表。来源哈希、补丁哈希、SQL 实测和验收边界见工作区 `docs/refactor/reviews/next-r4c-history-and-source-2026-09-25.md`。原 9 月 24 日哈希清单描述冻结基线，本次四个产物的覆盖哈希见 `docs/refactor/reviews/evidence/next-r4c-history-locators-2026-09-25/kernel-import.json`。
