/**
 * RC-02 WorkspaceReader — 工作区**路径边界**的唯一权威：拒绝前缀清单。
 *
 * ── 为什么这一份放在本 Module ────────────────────────────────────────────────
 * module-boundaries 把「路径边界、完整来源 pin、索引/工具适配、语言能力差异、来源更新判断」
 * 明确划为 WorkspaceReader 应隐藏的实现。因此「哪些路径连列目录都不能出现」这条策略只在
 * 本 Module 定义一次，其他调用方**引用**它，而不是各写一份字面量。
 *
 * ── 这组值的来历（不是本票新增的策略）──────────────────────────────────────
 * 1. 内核默认值：`vendor/coding-agent` 的 `WorkspaceSandbox.create` 在调用方不传
 *    `deniedPrefixes` 时使用 ['.evaluator', '.oracle', 'hidden-tests']（评测与隐藏测试目录）；
 * 2. 平台追加：`.git`（版本库内部）、`.env`／`.env.local`（密钥）、`.platform-runtime`
 *    （本平台自己的运行锁与运行目录）——这三类在内核默认值之外。
 * 本清单 = 内核默认值 + 平台追加，两侧取值逐字保留。`WorkspaceSandbox` 会把它规范化并排序，
 * 判定用的是前缀包含关系，因此数组顺序不参与语义。
 *
 * ── 一致性的意义 ────────────────────────────────────────────────────────────
 * 同一组值必须同时用于「运行时读源码」「派发前取材」「命令检查」等入口，否则会出现
 * 「运行时看得见、取材时看不见」或反过来的分叉：同一个路径在一处可读、在另一处被拒，
 * 材料与它声称的来源就不再可信。本文件是这条一致性在源码里的落点。
 *
 * ── 已知的收敛缺口（RC-02 如实记录，不在本次写入范围内）──────────────────────
 * 仍逐字复制这组值的调用方还有三处：
 *   - `execution/worker-runtime/coding-agent-runtime.ts`
 *   - `execution/worker-runtime/read-only-query-runtime.ts`
 *   - `control/verification-engine/command-check-provider.ts`
 * 把它们改成 import 本文件属于各自 Module 的写入范围。其中 WorkerRuntime → WorkspaceReader
 * 已是声明的依赖边，VerificationEngine → WorkspaceReader **不是**（ModuleDependencyDAG 里没有
 * 这条边），所以后者的收敛需要先有架构决定，而不是顺手加一条未声明依赖。
 */
export const WORKSPACE_DENIED_PREFIXES: readonly string[] = [
  '.evaluator', '.oracle', 'hidden-tests', '.git', '.env', '.env.local', '.platform-runtime',
];
