执行已授权的这一个返修范围，完成实现、自检并交付。GPT-6 Sol 已经完成骨架和独立契约测试，主Agent已审阅并验证失败基线。你无需重新做架构或Prompt5调查。

你看到的 /home/hyh001/projects/coding-platform 是当前未提交工作树的独立快照，产品代码在其 coding-platform 子目录。整个文件系统默认只读；只有下述实现文件，以及你的隔离运行状态、/tmp 可写。原主工作区没有赋予你写权限，完成后由主Agent审阅合入。不要尝试修改权限、绕过沙箱、更改范围或安装依赖。

重要编辑方式：允许写的文件是单文件挂载。内置edit/write的atomic rename、sed -i会失败，这是已知工具行为。请用bash工具调用Python Path.write_text或Node fs.writeFileSync直接原地写允许文件；不要rename/删除这些文件。不允许新建生产文件，已有骨架足够；确需扩大范围，报告准确路径和理由给主Agent。可在/tmp写自己的临时检查和最终报告。

验收能力：python3 /home/hyh001/projects/coding-platform/tools/dsh-refactor/check.py <检查名>。脚本、测试、配置只读，可以查看和运行，不得放宽、skip、改timeout。所有检查使用现有Node24、单worker、无共享cache；不要source env.sh后覆盖这些私有缓存参数。不要build（共享产物只读），主Agent在集成后构建。不要运行真实付费模型；测试是本地模型。不要读凭据或无关历史会话，不reset/restore/clean/stash/stage/commit/push。

读本范围Sol交接任务、原返修任务及必要实际源码即可；测试失败是待实现语义，不是让你改测试。所有通过仅报告自检，独立验收由主Agent负责。对明确unsupported能力保持unsupported。报告真实修改、复用、删除、检查结果和仍未完成项。

范围：R4a Kernel。先读 docs/refactor/tasks/R4a-sol-skeleton.md、R3a-R4a-acceptance-fixes.md 的K部分，以及 vendor/coding-agent/AGENTS.md 与 INTEGRATION.md（相对代码根）。
可写精确文件（相对工作区 coding-platform/vendor/coding-agent/）：
- src/app/composition/recovery-contract.ts
- src/app/composition/composition-root.ts
- src/app/composition/resume-composition.ts
- src/core/runtime/recovery/recovery-coordinator.ts
- src/core/ports/session_store/session-store-port.ts
- src/core/ports/checkpoint_store/checkpoint-store-port.ts
- src/core/runtime/checkpointing/checkpointing-event-sink.ts
- INTEGRATION.md

recovery-contract-types.ts 是冻结只读的内部接口。按该接口填两个函数，并将实际恢复路径接到它们；不要留未使用骨架然后旁边再写一套。精确run/turn选择须贯穿组合根和Coordinator；旧completed Run重放只恢复它自己的结果，零模型/事件。暂停恢复必须受原有效限额/沙箱约束，不得通过省略参数扩大；原有效限制写进现有turn/checkpoint，更新strict schema与checksum兼容。只读/terminal旧日志继续兼容；缺少原额外限制证据时不能拿一个boolean声称已证明默认安全。任何与原已有回归契约的真实冲突先给具体测试和所需变更，不能改测试绕过。
请运行 r4a、r4a-regression、kernel-types、kernel-architecture 四个检查。r4a当前10项4过6失败；两套独立测试均不可改。完整回归也不可改；若少数旧fixture与新增持久字段确有设计冲突，先精准报告，不无限试错、拒绝所有恢复以混绿或绕过冻结接口。此范围不实现after_tool暂停、block/modify/fail或compact。
完成时将报告写 /tmp/dsh-output/implementation.md 并最终回复。无需组子agent，这是外部并行团队中的独立lane。
