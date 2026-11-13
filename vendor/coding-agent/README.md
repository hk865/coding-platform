# 冻结 Kernel 公共依赖

本目录的 `dist/` 从 2026-09-24 已通过 R4a 验收的本地 Kernel 构建中复制；是实体文件，不在目标运行时读取原 Kernel 源码。原 `package.json` 仅保留版本/依赖等来源信息，不宣称附带其开发源码或可重跑其中全部脚本。

目标只导入 `dist/public-api.js`。第三方包在本机复用已安装依赖目录；它们不是旧平台模块。源码映射嵌入了对应 Kernel 来源文本，供调试定位，不增加运行导入。

本批哈希清单：`docs/refactor/reviews/evidence/next-clean-migration-2026-09-24/kernel-packaged-hashes.json`（相对工作区）。编译产物、声明文件和映射一起冻结；`next/.gitignore` 明确允许该产物进入版本管理。更新依赖时需要重新跑 Kernel 与目标接入验收，不能自行链接回旧源码。

## 2026-09-25 受管历史范围读取补丁

R4c.2b 在本目录保存 `SqliteStores.read` 的[补丁源码](patches/storage/adapters/sqlite/sqlite-stores.ts)及[维护说明](patches/README.md)，其余来源产物保持冻结。`next/scripts/build-kernel-patch.mjs --check` 重建并比较该文件的 JS、声明与映射四项产物，已经纳入 `verify:isolated`。修改先落补丁源，再由脚本生成，不直接手改 dist；原 Kernel 工程源码仍只读。

补丁复用原 `session_id, position` 主键做有界读取，并在一个只读快照中获取 header/tail/page；无新增历史表。来源哈希、补丁哈希、SQL 实测和验收边界见工作区 `docs/refactor/reviews/next-r4c-history-and-source-2026-09-25.md`。原 9 月 24 日哈希清单描述冻结基线，本次四个产物的覆盖哈希见 `docs/refactor/reviews/evidence/next-r4c-history-locators-2026-09-25/kernel-import.json`。

## 2026-09-26 B2 既有纯validator公开导出

新增[public-api受管源](patches/public-api.ts)，仅重导出已有 `assertTranscriptExchangeIntegrity`，不修改其算法。仍只从 `dist/public-api.js` 运行导入。原SQLite补丁与新增public-api由同一 `build-kernel-patch.mjs` 复现8份产物；专项49项通过，该子能力及B2/C2 Runtime消费者已纳入后续99文件975项完整隔离基线。见[补丁维护说明](patches/README.md)。

## 2026-09-26 R4.2 工具组安全点

受管源现为六份，原构建脚本确定性重建24项产物。R4.2已完成骨架中审、冻结测试、实现和独立返修，真实工具组前/后await callback；pause等待原required sink提交，保留并发排空、cancel/unknown和原identity恢复。callback失败在最新工具状态上提交，保留已完成结果。专项/邻接5文件68项、types与24项逐字再生通过，已按hash合入。

最终runner源SHA-256为`39f5ce8937ec6e205aa8313e1d77d97162fbc7813498e4d81aec9b43dab46ddb`。实际新行为由原Runner及run/identity-resume/public-resume三处透传提供，没有第二执行循环。平台持久投递、停止确认与恢复接线仍属R4.1/3–5，不能凭Kernel子能力开启平台完整控制capability。

来源/生成物与独立证据见工作区`docs/refactor/reviews/next-r5a-r4-tool-group-2026-09-26.md`及`reviews/evidence/next-b2-2026-09-26/r4-tool-group-final-implementation-import.json`、`r4-tool-group-final-repro.json`。历史基线清单与原Kernel继续只读。

## 2026-10-29 KP 工具参数错误指出字段

受管源新增[派发器补丁源码](patches/tools/dispatcher/tool-dispatcher.ts)：参数 schema 未命中时消息按 `字段: 原因` 指出各字段，错误码仍为 `invalid_arguments`；来源与四份产物哈希、命令见[补丁维护说明](patches/README.md)。

## 2026-11-03 K2-K 压缩记录

受管源新增[会话投影补丁源码](patches/core/ports/session_store/session-projection.ts)，现十九个源、76 份产物。Kernel 会话记录多一种 `context.compacted` 压缩记录，由公开的 `appendCompactionRecord` 追加；恢复历史时按最新一条 `compacted` 拼视图（摘要消息、旧工具结果的桩、可选的 `viewPosition`），原记录不动；`selectContext` 保护摘要消息；`kernelSessionApiVersion` 是 4。平台还不调压缩（slice-K2-SPEC K2-P1）。九个改了的源的哈希、产物清单和命令见[补丁维护说明](patches/README.md)。

## 2026-11-04 8E-2 一次读多个文件

受管的[工作区沙箱补丁源码](patches/sandbox/workspace/workspace-sandbox.ts)给 `WorkspaceSandbox` 加 `readMany`：一次读多个文件，每项同逐个 `read` 的结果或错（码、消息），只开一次根；按工作区根的 `statfs`，本地盘用同步系统调用，其余用异步读，批末复核开过的目录。源仍十九个、76 份产物。来源与四份产物哈希、命令见[补丁维护说明](patches/README.md)。

## 2026-11-10 跨轮重复的工具调用号

[会话历史补丁源码](patches/core/ports/session_store/session-history.ts)从已落盘记录和恢复前缀收集调用号，并把 `assertTranscriptExchangeIntegrity` 的完整性拒绝翻成 `category: 'context'`、`code: 'history_rejected'`、`retryable: false` 的 `RunFailure`；`message` 带字面量 `history_rejected` 和 Kernel 的原始拒绝原因。[运行循环补丁源码](patches/core/runtime/loop/runtime-runner.ts)让同一 Session 里再次出现的调用号在记录时改成 `<id>@<turnId>`（第一次出现的原样），并在进入模型循环前把这个确定性失败写成真实的 `run.failed`。[组合根](patches/app/composition/composition-root.ts)和[恢复组合根](patches/app/composition/resume-composition.ts)读目标 Session 的已落盘调用号，把确定性历史拒绝转成 `historyFailure`。四个源的 16 份产物由构建脚本生成，不手改 `dist`。撞号只改后一个，整条历史的唯一性检查不变；旧数据不迁移，由 `history_rejected` 路径结束。

## 2026-11-13 SBX 宿主挂载和联网选项

[进程沙箱补丁源码](patches/sandbox/process/process-sandbox.ts)的 `ProcessSandboxOptions` 多两项可选的选项：`hostMounts`（宿主目录只读或可写挂进沙箱，和工作区重叠就以 `launch_failed` 拒绝，理由是安全）和 `network`（每次 `execute` 现读一次；给了 Host 代理的 unix socket，就绑进沙箱、起转发器、设代理变量，直连照旧只有沙箱自己的 lo）。两项都不进 `effectiveOptions` 和恢复约束；不给时行为逐字不变。`ProcessSandbox.networkConfigured` 决定 [shell 工具](patches/tools/builtin/shell/shell-tool.ts)用联网版还是原来的说明；[公开入口](patches/public-api.ts)导出 `HostMount`、`NetworkProxySource` 两个类型。源仍十九个、76 份产物；哈希和产物清单见[补丁维护说明](patches/README.md)。

## 2026-11-13 CTXFIT 最新一段工具交换改为截断结果

受管的[上下文选择补丁源码](patches/core/context/selection_policy/context-selection-policy.ts)把当前执行的最新一段工具交换从删除单位里拿掉；较早几段都删光后仍装不下时，按共同字节上限截断这一段的结果并写明截断，计入 `toolResultBody`；连空结果都装不下才报 `required_content_over_budget`。源仍十九个、76 份产物。来源与产物哈希、命令见[补丁维护说明](patches/README.md)。
