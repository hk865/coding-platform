改了 7 个文件：新建 `reviews/evidence/orchestration-cleanup-C1-2026-10-19/README.md` 和 `lead-acceptance.md`；改 `STATUS.md`、`IMPLEMENTED-CAPABILITIES.md`、`slices/README.md`、`AGENTS.md`、`DSH-WORKFLOW.md`（§7.1 停止、§6.10 内存条）。没动 HANDOFF、规格、`src`/`tests`，也没往证据目录复制材料。

没定的：

- **Codex 次数**按 11 写（刷新 1、delta 1、书检查 2、五组审查 5、返工后核对 2）；只算施工后的审查和核对是 7 次。要改成 7 次只需改 README 合计一句。
- **G5 的 `sameRef` 调用点**：DSH 回复写 4 个，代码实际 2 个（`session-anomaly.ts:64`、`:65`）；裁定 4 没列这条。我按“回复文字错、代码对、不返工”写进 G5 一节，也可补进裁定 4 或 T。
- **体量**按 `group-stat.txt` 的最终数写；G1 的 +678/−896 加 lead 修 +10/−4 不等于最终 +686/−898（差 2 行，短统计在改注释时不按加法累计），没有另作解释。

材料里的矛盾（已按裁定写）：G3 的 1,007 行 vs Codex 的 661 行；G4 回复说 signal“接受任意非 null 对象”，代码要求 `aborted` 和 `addEventListener` 两个属性。两处都记在裁定 4。上面 G5 那条没记。

WG 表没有点名 C1 删除的文件（C1 没删文件）或搬走的函数，所以一行没改。