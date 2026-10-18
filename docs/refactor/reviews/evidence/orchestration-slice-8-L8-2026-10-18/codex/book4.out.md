需改三处文字；其余改动未见冲突。本次只读，未运行测试或构建。

`plans/propose` 确实是公开路由，并非仅导出方法：注册于 `src/app/core-routes.ts:361`，派发到 `proposePlan` 于 `:926`；UI 在 `src/ui/views/setup/requests.ts:161` 构造含 draft 的请求，由 `src/ui/views/setup/actions.ts:38` 实际提交。T01/T02 的新裁定成立。

§3 各行引用的 ID、B§、R2 段均存在；原审查的必改 ID 没有遗漏，均已进入 §3 或由 §2 裁定。Scope、A8、F9，以及范围块格式和读取次数的裁定，未发现额外矛盾；只读新格式符合决定79（`docs/refactor/HANDOFF.md:564`）。

1. **§2.3：不能把“没有请求”也写成启动可恢复。**  
   `.lead-ref/l8-rework-2-final.md:41` 的恢复承诺过宽。启动只重试已有 `pending`，没有请求不会入队（`src/app/auto-capture-driver.ts:262、:266`）。P10 还是绑定失败，不只是存储无法记录：绑定途中抛错会跳过通知，同根重试又提前返回（`src/app/host.ts:838、:882、:933`）。  
   **建议改为：**“这些后台记录或绑定失败本轮作为已知限制保留。已有 pending 可由后续成功的启动扫描或真实触发重试；没有 pending 时不保证启动恢复，只能等待后续有效触发。lead 将此例外同步写入 L8 的失败记录与重试条款。”

2. **§2.5 与 §3 B：须区分本次提交与历史重放。**  
   `.lead-ref/l8-rework-2-final.md:45` 说已完成提交永不返回 cancelled，`:64` 又要求早期重放检查取消。当前早期重放只恢复历史提交，本次尚未调用 commit（`src/core/work-graph/architecture/architecture-service.ts:992、:994、:996`），两条会给出相反读法。  
   **建议改为：**“本次调用已经开始并成功完成的 commit，保留 committed 结果，不因随后取消改写。仅查询、恢复历史提交的早期重放，仍在每次等待后检查本次 signal；取消时返回 cancelled，历史提交不受影响。”

3. **F1 的判定句须与 A1 的工具入口一致。**  
   `.lead-ref/test-rule-sheet-v2.md:35` 允许 agent 经工具提交公开 owner 输入，`:81` 却写成“没有公开路由就是 F1”。  
   **建议改为：**“判断该值是否由真实调用方通过 A1 所列公开入口提交，包括 UI/HTTP 和 agent 工具；平台内部产生、真实调用方不提交的事实值，才按本条禁止。仅导出 owner 方法不构成公开入口。”