已只读核对，未写文件、未跑测试。沿用原报告简称：S＝slice-8-SPEC.md，A＝lead-acceptance.md，E＝证据 README。

| 项目 | 逐项结论 |
|---|---|
| 必改 1–6 | 1 正确；2 正确；3 正确；**4 落实有误**；5 正确；6 正确 |
| 必改 7–12 | 7 正确；8 正确；9 正确；10 正确；11 正确；**12 落实有误** |
| 必改 13–17 | 13 正确；14 正确；15 正确；16 原列错引已改；17 正确 |
| 建议 1–7 | 1、2、3、4、5、6、7 均正确落实 |
| lead 裁定 | 第 1 项的取消路径裁定及更正声明已正确落实 |
| lead 新增 1–5 | 1 施工顺序、2“施工回报”、3 删除伪限制、4 保留占位、5 两处完整 T 清单及 STATUS 摘要，均正确落实 |

**仍有误的原项：**

- **必改 4：[S:989](D:/cxt/s8l8-docs2/docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md:989)。** DTO 层级和 capture 路由已经改对，但“observation-state 不接受这个字段”仍不符合运行时行为。应写：“`architecture/capture` 明确拒绝 `requestSeq`；`observation-state` 的输入契约未声明该字段，运行时读取并校验 workspace，不检查额外的 `requestSeq`。”依据是 `core-routes.ts:542、556` 和 `architecture-service.ts:1468` 起的读取。
- **必改 12：[S:1017](D:/cxt/s8l8-docs2/docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md:1017)、[A:47](D:/cxt/s8l8-docs2/docs/refactor/reviews/evidence/orchestration-slice-8-L8-2026-10-18/lead-acceptance.md:47)。** 仍混用任务书旧行号，且把 `:191` 误称为“接续依据读取”。应写：“当前 `session-anomaly-facts.ts` 的 workspace、execution、Turn await 分别在 136、173、185，后查在 144、182、186；执行读取 catch 在 174–178；123 的直接返回由 186 兜底；lead 补丁在 204 的 fallback await 后、206 检查取消。”

**第 14 项：实现者版本是对的。** `auto-capture-driver.ts:192` 起，非取消的 rejected 保留原 code/reason；非 ready 且非 rejected 的状态，以及未伴随取消的抛错，才写 `unavailable`。取消直接退出。我的原改句把 rejected 也概括成 `unavailable`，不够准确；修订稿没有照抄是正确处理。

**新增错误 1 项：** [S:1051](D:/cxt/s8l8-docs2/docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md:1051)、[A:100](D:/cxt/s8l8-docs2/docs/refactor/reviews/evidence/orchestration-slice-8-L8-2026-10-18/lead-acceptance.md:100) 新增的“`verify3.out.md` §3 的 A 表”节号错误。应写：“完整缺项见 `codex/verify3.out.md` 第 1 节 A 部分的逐 await 表（第 54 行起）。”报告第 3 节是新增规则复扫；第 1 节标题里的“§3”指任务书章节。

仍有误：2 项；新增错误：1 项。