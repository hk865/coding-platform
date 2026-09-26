执行已授权的这一个返修范围，完成实现、自检并交付。GPT-6 Sol 已经完成骨架和独立契约测试，主Agent已审阅并验证失败基线。你无需重新做架构或Prompt5调查。

你看到的 /home/hyh001/projects/coding-platform 是当前未提交工作树的独立快照，产品代码在其 coding-platform 子目录。整个文件系统默认只读；只有下述实现文件，以及你的隔离运行状态、/tmp 可写。原主工作区没有赋予你写权限，完成后由主Agent审阅合入。不要尝试修改权限、绕过沙箱、更改范围或安装依赖。

重要编辑方式：允许写的文件是单文件挂载。内置edit/write的atomic rename、sed -i会失败，这是已知工具行为。请用bash工具调用Python Path.write_text或Node fs.writeFileSync直接原地写允许文件；不要rename/删除这些文件。不允许新建生产文件，已有骨架足够；确需扩大范围，报告准确路径和理由给主Agent。可在/tmp写自己的临时检查和最终报告。

验收能力：python3 /home/hyh001/projects/coding-platform/tools/dsh-refactor/check.py <检查名>。脚本、测试、配置只读，可以查看和运行，不得放宽、skip、改timeout。所有检查使用现有Node24、单worker、无共享cache；不要source env.sh后覆盖这些私有缓存参数。不要build（共享产物只读），主Agent在集成后构建。不要运行真实付费模型；测试是本地模型。不要读凭据或无关历史会话，不reset/restore/clean/stash/stage/commit/push。

读本范围Sol交接任务、原返修任务及必要实际源码即可；测试失败是待实现语义，不是让你改测试。所有通过仅报告自检，独立验收由主Agent负责。对明确unsupported能力保持unsupported。报告真实修改、复用、删除、检查结果和仍未完成项。

范围：R3a。先读 docs/refactor/tasks/R3a-sol-skeleton.md、R3a-R4a-acceptance-fixes.md 的A部分和R3a原任务§5–8。
仅可写3个文件（相对工作区）：
- coding-platform/src/core/record-store/in-memory-record-store.ts
- coding-platform/src/core/record-store/sqlite-record-store.ts
- coding-platform/src/core/work-graph/tasks/task-service.ts

Sol已实现并冻结 guarded-revision.ts 的机械codec helper：将两backend最终事务guard接入该helper，不复制领域算法，不改变幂等重放优先级。克隆失败不能退回原对象，必须按合法字段独立拥有或在副作用前明确invalid拒绝。不能用JSON序列化静默丢字段伪装解决。
请运行 r3a、r3a-regression、platform-types、platform-architecture 四个检查。r3a当前23项16过7失败，失败是坏ref/schema及输入隔离；真实RAT-03旧库重放已通过，保留它。完成时将简明报告写 /tmp/dsh-output/implementation.md，并最终回复。无需组子agent，这已经是外部并行团队中的独立lane。
