1. 机制成立，但本次只核代码，未独立核实 journald 或复现报告。重排用墙钟（`S2C-K-legacy-provenance.test.ts:229`），写入 requestedAt（`requeue-service.ts:1045`）；随后创建 C，再以当前时间加一分钟领取（`S2C-K-legacy-provenance.test.ts:392、399、400`）。创建入口直接读 Date（`session-directory.ts:1043`）。若期间回拨导致 childMs＜requeueMs，证据被丢弃（`session-provenance-facts.ts:341`）；C 仅领取、未启动执行（测试文件:401），无 manifest 时另一证据路径也为空（`session-provenance-facts.ts:382`），最终返回 new（同文件:600）。维护补写该结果（`session-maintenance.ts:377、379、545`）；new 截断工作线，执行分节只遍历该线，故剩 C（`work-line-reader.ts:2333、2592`）。

2. 兄弟用例确实同样暴露：它也调用 openCase，随后要求 `[C,P]`（`S2C-K-legacy-provenance.test.ts:447、455`）。修改共享 helper 的第229行同时覆盖两例。维护前用例本来就要求 `[C]`，不受这次漏推导影响（同文件:422、429）；其余裸 Session 使用固定时间（同文件:165）。另一个时间边界是创建后到领取前回拨，但已有 +60秒余量（同文件:400）。未发现同文件另一个需要同步补余量的边界。

3. −60秒是针对所报约2秒回拨的最小缓解，不能消除对墙钟的依赖。更干净的是每例开始只替换 Date、固定到 HOST_NOW，清理时恢复；仓库已有这种做法（`S1-session-routes.test.ts:43、44、62`），也符合规格要求（`slice-1-SPEC.md:600`）。无需冻结定时器；仅给 requeue/claim 注入固定钟仍覆盖不了直接读 Date 的创建入口（`session-directory.ts:1043`）。建议采用固定 Date，不为此改生产接口。

4. 本次“时间倒序→证据不足→new”符合规格的保守回退，不能据此判生产违约（`slice-1-SPEC.md:194`）。但不能宣称生产检查在回拨下可靠：反向情形中，实际先创建 C、再回拨并重排，时间戳仍可能通过第341行，错误满足“child 不在 requeue 之前存在”。这是旧记录推导的时序证明局限；已有 provenance 会直接返回，不走该推导（`session-provenance-facts.ts:572`）。

结论：机制核对成立；一行补丁覆盖两个失败用例但只是缓解，优先固定测试 Date，生产时序局限另交 lead 裁定。