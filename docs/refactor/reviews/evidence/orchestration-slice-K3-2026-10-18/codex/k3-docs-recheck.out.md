未写文件、未运行测试。**原 40 项报告缺失**：指定路径及证据目录均未找到，因此不能可靠地逐号标注，也不能冒报完整剩余数。

第 2 节 A／B／C：未发现需列出的错误。

当前稿确认有以下 6 项问题（证据路径均相对 `.dsh-ref/evidence/`）：

1. [lead-acceptance.md:40](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/lead-acceptance.md:40)：F-014 应为 **“部分完成；剩余迁移进 T”**，不是整行未做。依据 `codex/k3-verify9.out.md:72`。
2. [lead-acceptance.md:72](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/lead-acceptance.md:72)：F-054 应为 **“范围内七行在第 10 轮关闭；旧片余项仍 T”**。依据 `books/k3-g4b3-rework-9.md:40`、`codex/k3-verify9.out.md:369`。连同上一项，:33、:124 应改为 **整行 T 37、部分 T 10、关闭或接受 59**，不是 38／8／60。
3. [slice-K3-SPEC.md:1867](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1867)：**“9b 已改回 120,000”不实**。应写“9b 要求恢复，但三条仍为默认，后按书 10 裁定 2 留 T”。依据 `codex/k3-verify9.out.md:85`。
4. [slice-K3-SPEC.md:1881](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1881)、[lead-acceptance.md:140](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/lead-acceptance.md:140)、同文件 :153：**S3“无存储夹具”理由已被驳回**。应写“原点名旧项按范围裁定留 T”，不能沿用 DSH 自述；依据 `codex/k3-verify9.out.md:369`。
5. [slice-K3-SPEC.md:1883](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1883)：Q-17 的 **“这是允许的极限”超出来源**。应写“现实现可能省略提示，尚无受支持极限的可达证明；记已知限制，本轮不改”。依据 `codex/k3-merge.out.md:741`、`books/k3-g4b3-rework-9.md:145`。
6. [lead-acceptance.md:109](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/lead-acceptance.md:109)、:110：F-093–F-096 来源 **“书 9 §1 裁定 1”应为“书 9 §2 裁定 1”**，正文在该书 :36–41。

剩余问题数：至少 6 项；原 40 项清单缺失，完整总数未定。