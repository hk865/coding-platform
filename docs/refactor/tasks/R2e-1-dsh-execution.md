# R2e.1 定点返修

主 Agent 已审阅 Sol 的补充测试和原任务书；请在受限副本实现以下两项，不扩张到其他 R 批次。W=/home/hyh001/projects/coding-platform，C=W/coding-platform。先读 C/AGENTS.md、W/docs/refactor/tasks/R2e-1-text-read-compare.md 与 R2e-1-sol-followup.md。旧 R3a/R4a 已验收，不需要改动。

1. text 清单中的已授权、prefix 已选中、但平台不能安全表示的普通文件路径，必须整体明确拒绝 unsupported，不能静默丢弃后宣称 complete。prefix 外和未授权项不属于该捕获域。符号链接原本不在 text 域，不要跟随链接或修改 Kernel。拒绝后不得泄漏捕获槽。保持现有跨平台路径规范。
2. 比较前若仅凭清单大小即可证明超过 maxQueryResults，应直接 capacity。例如 before 空，after 100 项且上限 2；不先分配 100 项完整差异。一般情况下仍允许全局扫描判定 rename 的 digest 唯一性；不要为优化破坏 rename、scope、provider、previous summary 或完整结果语义。可使用通用且可证明安全的 cardinality lower bound。不要随意加缓存、抽象层、接口、依赖或全局状态。

只有 scope JSON 中的两个生产文件可写；测试、接口、配置、其他文件由操作系统只读保护。单文件挂载不能用原子 rename 替换；请用 Python Path.write_text 或 Node fs.writeFileSync 原地写入。不要安装依赖，不要 git reset/restore/clean/stash/add/commit/push。若确需改冻结契约，报告具体原因，不绕过只读范围。

可直接调用冻结的测试能力：

```sh
python3 /home/hyh001/projects/coding-platform/tools/dsh-refactor/check.py r2e1
python3 /home/hyh001/projects/coding-platform/tools/dsh-refactor/check.py platform-types
python3 /home/hyh001/projects/coding-platform/tools/dsh-refactor/check.py platform-architecture
```

测试输出如实报告；不要增加 timeout 或修改标准。完成后报告具体改动、删除/新增行、实际检查和限制，等待主 Agent 独立验收。
