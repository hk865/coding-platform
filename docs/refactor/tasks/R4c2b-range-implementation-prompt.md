W=/home/hyh001/projects/coding-platform；T=W/coding-platform/next。Astra已独立审核并冻结本批Kernel range测试，现在只允许生产实现。先读 docs/refactor/tasks/R4c2b-range-skeleton-prompt.md 的原设计意图、参考路径及全部冻结语义，再读当前 tests/runtime/R4c-kernel-history-range.test.ts。骨架/测试阶段已完成并独立复现真实全扫描，禁止改测试、Port、配置、原Kernel/src与其他生产代码，不提交、不安装、不读凭据；写入已被OS限制且单文件原地写不能rename。

实现唯一补丁 vendor/coding-agent/patches/storage/adapters/sqlite/sqlite-stores.ts 中 read 的按范围读取及必要私有helper。复用现有session_records主键，不造表/索引/缓存/第二日志，不改append/replay/get的既有语义。一次只读SQLite快照包含header、末位置、range；只读事务不得复用BEGIN IMMEDIATE的写事务helper。read全同步SQL体后再返回Promise，错误须清理只读事务。原始position从主键取tail(ORDER BY position DESC LIMIT 1)，非COUNT、非header revision，page按session_id和position>afterPosition使用LIMIT；不要LIMIT+1溢出。页内位置必须连续，SQL行键与payload位置/Session一致，schema/checksum仍验证；只局部读取不要求发现页外损坏。空Session记录损坏/缺tail合理fail closed，不要为伪造字段默认成功。unknown Session/cancel保持原行为，lastPosition和revision都来自同一snapshot。读参数MAX_SAFE_INTEGER边界必须合法。

源码完成后使用固定Node：.toolchain/node-v24.21.0-linux-x64/bin/node coding-platform/next/scripts/build-kernel-patch.mjs --write，仅会更新scope内四个dist产物。禁止手改dist和sourceMap绕过源代码；再用--check证明可重现。宽读现有schema/session记录校验helper直接复用，不重复实现校验算法。

运行 python3 tools/dsh-refactor/check.py next-history-range、next-types；再运行现有相关Kernel/R4b/R4c范围(查看check.py可调用名称或固定Node+vitest)。如果其他并行骨架测试仍红如实报告，不改stub/测试冒充绿。回报真实SQL读取规模、测试、改动与未完成。实现后停止，由Astra独立差异审阅再验收。
