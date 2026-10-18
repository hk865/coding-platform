# 清理审查清单（lead，2026-10-16 ~15:30）

范围：`src/core/work-graph` 除注记相关文件以外（约 7.8 万行，占 9.9 万的八成）。注记那部分 4C 合入后补审。
来源：Codex 6 路只读审查（`codex2/audit/*.clean.md`）→ 6 个 Claude 子 agent 逐条反驳式核实（`codex2/audit/verify.json`）。

## 数字

- 65 条：46 条核实成立，19 条部分成立，0 条被推翻。
- 去掉各路互相重复计的部分，能删约 2,200–3,400 行；核实的人又找出约 400–600 行漏掉的（拒绝结果的小函数 148 个、Session 三个服务各抄一份的可信上下文、`graph-repository.ts` 一层只转发的接口、状态和 model 之间又两处重复的类型）。合计约 2,600–4,000 行，占这一块的 3–5%。
- 其中注释约 400–800 行；状态机规则对应的长注释按决定 35（HANDOFF :125，用户要留）不动。
- 结论：重复确实有，但量不大；这一块的体量主要是真实功能加上手写的字段校验。手写校验那部分要靠“按格式描述生成编解码”才能明显变少（Codex 估再省 1,100–1,800 行，把握中）。

## 分轮（都排在 K3 和 4C 合入以后：K3 规格 §6 要改 tasks/ 里八个文件，4C 要改节点详情、决定来源、装配）

**C1 机械合并和删注释（行为不变，风险低）**，约 1,800–2,600 行：
- 共用的小工具：字段校验原语 153 个（XX-1）、事件外壳编码 46 个（XX-2、SE-1）、规范 JSON 包装 26 个（XX-5）、JSON 对象解析 16 个（XX-6）、存储失败映射（XX-7、TA-7）、拒绝结果小函数 148 个（核实时补的）。不放进 `src/core/record-store`。
- 同一区里抄了几份的：Host/Session 的可信上下文和写请求隔离（TA-1 和 SE 补的一条）、2B 的读取辅助三份（VW-1、XX-8）、邮箱四种读取的分页（SE-2）、两个工作区设置服务（SE-3）、决定来源读取两套（SE-5）、置顶设置和决定事件的公共校验（PE-2、PE-3）、依赖边编号四份（TA-4、VW-4）、TaskPhaseFacts 拼法（TA-5）、等待环检查（TA-10）、state 和 model 的重复类型（ST-1 和补的两处）、其余小项（TA-8、ST-2–9、VW-3、VW-5–9、VW-11、SE-7、SE-9、SE-11–13、PE-4、PE-8、PE-9、`graph-repository.ts`）。
- 注释：施工经过、复述代码、过时说明（TA-2、VW-2、SE-4、PE-1、ST-5）。
- 每处保留原来的错误码、错误文字、检查顺序和存下的字节。

**C2 少读（行为不变是目标，风险中，合入前实测读次数）**：
- 一次请求里同一个目标的任务事实读两三遍：悬停、节点摘要、工作线、决定队列的原因（XX-4、TA-3）；悬停时还把整个工作区的决定队列读一遍（核实时补的）。做法是一个“本次目标读取窗口”，按目标和计划身份隔离，翻页和写之后重取。
- 其余：TA-9、TA-11、PE-5、PE-7、PE-10、XX-9、VW-10、VW-12、SE-6。

## 不做的（会改行为）

- SE-10：改目标冲突的判断来源，会让一些今天算重叠的目标不再算。不做。
- SE-8：改成更严的解析。不做。
- PE-6：删平台上旧的轮次查询别名，测试和状态机规格还提到它。先留着，E3 接界面时再看。

## 顺带发现的一个缺陷（lead 定，单独修）

- `tasks/goal-decision-reader.ts:422` 收了 `atLeastCursor` 却从不用，这个来源永远不会回“还没读到”（第 5 片规格 :817-818 要求）。lead 核实后作为一条小修，和 C1 一起或单独做。

## 要用户定的

1. 照上面分两轮，排在 K3 和 4C 合入以后。
2. 注释：删施工经过和复述代码的；状态机规则的长注释照决定 35 保留。
3. 按格式描述生成编解码：C1 做完后，先拿决定事件和置顶设置事件试一组（保留现有测试，返回形状、错误、历史重放都要一样），看效果再定要不要推开。
4. 统一成一个 RecordStore 后端（决定 49 Q9 的老问题）这次没审（RecordStore 不在范围），4C 合入后补审注记部分时一起拿出来。

## 用户 2026-10-17 晚定的排期

- C1 等 K3 和 8D（连同 §10 段）都合入后开始。
- C1 合入后做 T 轮，和 6A 并行（两边改的文件基本不重叠）。T 有两部分：
  1. 测试审查：过时的（测的行为已被后来的切片改掉，或只为兼容保留的旧接口）、重复的（同一业务场景在几个切片各测一遍）、太琐碎的（业务流程测试已覆盖）、手写事实的（改成走公开步骤，不删）。每删一条写明理由：被哪条业务测试覆盖，或测的行为已不存在。
  2. 生产代码里没有依赖的旧代码：整个 `src`（不含冻结的 vendor）。先用仓库里已有的 TypeScript 编译器从真实入口建引用图，机械找出没人引用的文件和导出、只被测试引用的生产代码；再由 Codex 只读判断每条为什么在（规格要求、给后面切片留的、读旧版本记录要用的、故意保留的如 PE-6），lead 核实后列清单交用户定。
- 流程照本清单：Codex 只读审查并给改法 → lead 核实 → 用户定 → DSH 施工。

### T round: hand-written facts already found (lead, 2026-10-18, from the B3 reviews)
Codex's B3 rework-3 check: these predate K3 group 4's last rounds and were left for T ("待审，不叫合法"):
- `tests/**/K3-11-review-reasons.test.ts` ~162, `K3-14-unknown-call-review-tool.test.ts` ~125,
  `K3-45-review-incomplete.test.ts` ~142, `K3-48-2-unknown-call-review-model-text-budget.test.ts` ~132 (old owner states built by hand);
- `K-R-close-open-turn.test.ts` ~68 (old close fixture), `B2-execution-entry.test.ts` ~237 (old scope seed);
- `tests/helpers/K-boundary-facts-support.ts` `injectAcceptedMessage` / `injectRunningToolCall` (append Kernel events; used by `K-R-attested-facts-source.test.ts`);
- `S5-decision-fixture` encodes records directly (B3 rework-1 close-out).
Line numbers are at `k3-g4b3-r3`; re-find them on the merged tree.
- Added from Codex's B3 rework-6 check (2026-10-18; on the lead branch since K slice B, unchanged by K3): `tests/helpers/B2-execution-fixture.ts` ~211, ~225, ~232, ~301 (prepared value, positions and entry facts built by hand); `B2-model-request.test.ts` ~14, ~39 (Session / lease rewritten); `B2-execution-result.test.ts` ~98, ~105 (new holder state built; its own terminal inputs under test stay); `tests/helpers/B2-runtime-fixture.ts` ~194–197 (policy and role writes). Line numbers at `k3-g4b3-r6`.
- T round: `tests/helpers/S2B-r2-backfill-kernel-support.ts` writes `.dsh-scratch/s2b-r2-kernel-host-public/index.html` into the repository root (seen after the lead bwrap check of s8l8-1, 2026-10-18); it should use a temp directory.
