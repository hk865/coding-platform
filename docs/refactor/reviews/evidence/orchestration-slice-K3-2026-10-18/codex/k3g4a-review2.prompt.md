只读快速核对（不要改文件、不要跑测试或构建）。用中文回答，800 字以内。

当前目录是 K3 第 4 组 A 段返工 1 之后的代码。`.lead-ref/` 里有：你上次的审查 `k3g4a-review.out.md`（8 条必须改）、Claude 子 agent 的核实 `verify-k3g4a.md`（含你漏的 3 处）、返工书 `k3-g4a-rework.md`（lead 的裁定：第 1 项选 A；2b 的 100×100 假页删掉；L27 第 2、3 条交给这一轮）、DSH 的回复 `k3-g4a-rework1-final.md`、源码改动 `rework1-src.diff` 和统计 `rework1-stat.txt`。规格是 `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`（L7、L11、L12、L21、L27、L29、§3.4）和 `slice-K-SPEC.md` 的 L7。

lead 对 DSH 回复里几件事的初步裁定（请一并核对，不成立就说）：
- `K3-08-wait-reply` (一) ~166 行和 `K3-R1-restart-flows` K3-01 ~177 行原来预期推进里有一步 `close_open_turn`；按 L27 第 3 条现在启动维护先关了这条 RUN-25 线，所以这两处改成“维护关闭、之后仍在原 Session 接续”。
- UNSPECIFIED 1：维护对 `takeover_unresolved` 的线，在记录还等着核对轮领取（`activeRound`/`pending_review`/`awaiting_proposal`）且目标 active 时先不关，交给 Workflow 按 L12 关（关闭确定失败时的退路照 K3-27 第 8 行走交接）；目标暂停时维护照关。lead 倾向接受（a）。
- UNSPECIFIED 2–6 倾向接受（第 5 条丢掉的两种 6b 变体移到 B 段施工）。

请核对：
1. 8 条和核实里的 3 处是否都改到位（特别是：所有读取失败统一成 `unreadable` 的那一个映射；续接领取的门；release-hold 的读失败和重放；L27 第 2、3 条在运行时和维护里；恢复各行的夹具不再提前放开命令、各行走到终点并以零写入的重启结束；K3-48 (三) 合法构造和 512 字符路径；2b 走真实 owner；K3-47 双后端）。
2. 有没有改出行为退化或新的读取失败当缺失的路径；新加的 `readTaskRequeueByIdentity` 是否只认同一请求身份。
3. 上面 lead 的初步裁定是否成立。

每条“必须改”的按决定 75 给修改思路。最后一句写“可以进入 B 段”或列出必须改的。
