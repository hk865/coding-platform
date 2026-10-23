# PC-2 R1 回复（2026-10-23 凌晨，headless）

## 1. 疑问与不吻合的行（规则 6）

1. **Q-01 的必然副作用（最终测试里唯一非环境红）**：Query preparation 读真实 `allowsRead('.')` 后，`tests/runtime/K-readonly-command.test.ts` 的两条旧用例读 `workspaceHost.authorize` 的次数从 1 变 2，`revisionFor: read => read===1 ? 'k-read-1' : 'k-read-2'` 失效：
   - `KB-08 a Query whose Host read permission changed during execution gets forbidden and starts nothing`（:723）
   - `KB-10 an early permission refusal with an oversized input is bounded and names the public code`（:1060）

   该文件不在白名单，未改。最小修法是两处 `revisionFor` 改成 `read <= 2`（:734、:1069 附近）；请 lead 裁定后由 rework 2 落地。这样改不会削弱断言。
2. **J-01/H-09 的 Host 链只走通一半**：`openPC2HostFixture` 的 Host 自身没有 Work 入口（`PC2HostStart` 无 `workflow`，Host 无 Goal/Plan/Run，`host.ts:370`），所以只贯通“设置路由 → Host binding resolve”；准备/启动用该 selection 的冻结 Work 夹具，读 Host 自己的 prompts 目录。不是完整的 Host 内部执行链，但没有伪造事实。
3. **J-13**：`toolSpecsRef` 没有写成整块 body 字面，而是逐工具比较完整 spec 对象（含 inputSchema）+ 固定工具名单 + 其他工具污染检查 + 字面 JSON 的 SHA-256；这是对“手写完整规范 JSON”的可执行近似。
4. **A1**：本机无 `/usr/bin/bwrap`，`tests/scenarios/A1-rework-same-session.test.ts` 在 :65 就 waiting，未到简报断言；57 字节按字面静态删除。scenario 由 lead 重跑。
5. **A-10/T-10 rejected；T-08、J-04、J-06、J-08、J-09 deferred；Q-02 rejected**；same-as 行按被指向的行完成。F3 的提交信息误写成“T-08 table”，实际内容是 57/70 字节表，T-08 仍未做。
6. `tests/state/invariants.test.ts` 的 beforeAll 报 `finalize_first: round … open`，在干净 af84802 上同样出现（r-g 复现）；`invariants-fuzz` 的 coverage 红是 29 个 bwrap 跳过导致，二者都按环境失败列。

## 2. F1、F2、F3

- **F1**（commit `5a7d313`，11 files +116/−94）：`takesSessionHistoryOf` 落地；`sessionHistoryDecision` 的 mode 调它（签名与 start 用法不变）；recipes 的 history 输入改为 `hasCompletedCursor: boolean`；`AssembledContextV1` 改为布尔 `takesSessionHistory`；删除 `readCompletedHistoryBoundary` 与 `af84802` 的 invalid→零边界转换；start 仍读真实 boundary，frozen false 仍强制 current_turn。`PC2-history-decision-pure` 8/8，`PC2-joint-history` 4/4。
- **F2**（`ea216c4`）：`tool-group-assembly.ts` 导出唯一的 `RUNTIME_TOOL_NAMES`（builtin+exploration+coordination+4 extensions），`finalToolNamesOf` 的 unknown 检查用它；两个 preparation 的 `selected` 只留该集合（owners 仍按 capability，Q-02 rejected）；start 用真实 selection/owners，拒绝先发生。旧 C2 GAP-46、invariants-fuzz 的 seeds、A2、R3e、S5 均恢复。
- **F3**（`5bb6f6c`）：57 = 删句 56 + 换行 1；70 = `2+12+1+24+1+30`。手算：
  - K3-15：`16384=1447+123+(4000+4000+3474)+3340`；`16304=1447+123+(4000+4000+3534)+3132+68`；`5752=1447+4×(41+1018)+69`；`16273=1447+164+(3×4000+2593)+69`；注释基数 `1504−57=1447`。
  - K3-35-T：`12676−57=12619`，`12764−57=12707`；读到 EOF 会多 70，即 12689/12777。
  - K3-35-approved：`12171−57=12114`；读到 EOF 为 12184。
  - Skill 字面：work `4919−296=4623`，secretary `4223−721=3502`，scribe `4063−270=3793`，adviser `5338−685=4653`，reviewer 1342；A1 删 57。

## 3. 逐行

约定：A 组文件 `PC2-resolve-pack.test.ts`（除注明），R→G 为该文件最终 passed 数；W 为 `PC2-W-*`；H 为 `PC2-H-*`；T 为 `PC2-T-render.test.ts`（除注明）；G/Q/J 见表内文件。`—` 表示无 test row（清理行）或 same-as/deferred。

| 行 | 测试/用例 | 变异 | RED→GREEN |
|---|---|---|---|
| A-01 | 3 例：两必填槽、固定串双错、参数值+键集 | 必填循环 break、串错 continue、参数错 continue | 3 红 → 74 绿 |
| A-02 | 纯空白 description 接受并保留 | 恢复 trim | 1 红 → 74 绿 |
| A-03 | 删 render-template 不可达后置分支 | — | — |
| A-04 | 8 例：模板 file/条目、顶层 role 块、tools 非对象、tool file、JSON 数组、空链、平台居中 | 逐项删对应检查 | 8 红 → 74 绿 |
| A-05 | 3 例：请求 manifest、strings 覆盖、list_files 整条非空参数 | 取平台 manifest/只填缺键/参数取平台 | 3 红 → 74 绿 |
| A-06 | 父供 initial-planning-answer v7，mentions read/edit | mentions=[] | 1 红 → 74 绿 |
| A-07 | Zebra/apple，插入序反，locale≠码点，完整 JSON+SHA | 删参数排序 | 1 红 → 17 绿 |
| A-08 | 三类 PromptRenderError（类/code/templateId/slot） | 抛末条/普通 Error/slot=null | 3 红 → 74 绿 |
| A-11 | 输入与返回各对独立 `['read','edit','shell']` | 原地 sort | 1 红 → 17 绿 |
| A-12 | 7 处注释改当前职责 | — | — |
| A-13 | 删 `_index`/`_length` | — | — |
| W-01 | 10 个默认例对 pc1-final 完整 JSON 字面 | 交换 command/reason 键序 | 1 红 → 2 绿（每文件） |
| W-02 | 6 个缺项例完整规格字面 | 缺项描述返空串 | 1 红 → 3 绿 |
| H-01 | start 配置根检查 | 删 ENOENT 放行 | 1 红 → 13 绿 |
| H-02 | 恢复根先全查 | 检查移回循环内 | 1 红 → 13 绿 |
| H-03 | 请求 problems、坏 JSON | 去掉 problems | 2 红/1 红 → 25/20 绿 |
| H-04 | 旧坏正文 7→8、stale 先于 text | 恢复旧包整体校验 | 各 1 红 → 20 绿 |
| H-05 | 撞名 unavailable+全字节、同字节复用 | 覆盖不同文件 | 2 红/1 红 → 25/20 绿 |
| H-06 | 包内目录链接保存 | lstat 拒绝 | 2 红 → 19 绿 |
| H-07 | 版本 0+缺文件、strings 读失败 | 提前返回 | 2 红/1 红 → 19/20 绿 |
| H-08 | 只一份 platform | ids 加 platform | 1 红 → 20 绿 |
| H-10 | query-copy-input footprint+全字节 | 删调用类 section 拒绝 | 3 红 → 18 绿 |
| H-11 | 同前缀兄弟、重开链接根 | startsWith/检查后移 | 各 1 红 → 13 绿 |
| H-12 | 删不可达分支 | — | — |
| H-13 | 3 处注释 | — | — |
| T-01 | reminder 经 renderTemplate | 返回原文 | 1 红 → 18 绿 |
| T-02 | brief/review 缺省收集模板工具块 | 回退 platform tools | 各 1 红 → 绿 |
| T-03 | pack 收窄为 PromptTextsV1、删 cast | —（类型/typecheck） | — |
| T-04 | capacity：最小候选仍超限即拒绝 | 返回超限文本 | 1 红 → 绿 |
| T-05 | 含块小 Skill/brief 存在/不存在整文 | 传 `[]` | 各 1 红 → 绿 |
| T-06 | 整数组、非零 omitted、全省略、另一顺序 | 去 +2/清零/删 wholeOmitted/强平台序 | 4×1 红 → 绿 |
| T-07 | S4C2 notes 截止 `## Reminders` | 改回 `''` | 2 红 → 2 绿 |
| T-11 | 注释 | — | — |
| G-01 | frozenSectionOrderProblem（Work/Query） | return null | 4 红 → 16 绿 |
| G-02 | 段前双 LF | 删检查 | 1 红 → 2 绿 |
| G-03 | 原始 UTF-8 Buffer 相等 | utf8Slice | 1 红 → 2 绿 |
| G-04 | sections=[null] invalid | 删结构检查 | 1 红 → 1 绿 |
| G-05 | I-19 用 manifest 冻结模板/字符串/工具表 | 2 参 renderer | 1 红 → 2 绿 |
| G-06 | I-19 范围边界 | 删边界 | 1 红 → 2 绿 |
| G-07 | `[start−2,end)==\n\n+review` | 隔离 worktree：`\n`/+1 | 2 红 → 2 绿 |
| G-08 | 120000→60000 | — | — |
| Q-01 | 真 allowsRead 准备/启动 | prep 固定 true；start 用冻结名单 | 各 1 红 → 绿 |
| Q-03 | 仅 initial 渲染 guide；semantic 未用 check ready | 无条件读；拼原文 | 各 1 红 → 4 绿 |
| Q-04 | contentType 先于缓存 | 检查后移 | 1 红 → 1 绿 |
| Q-10 | empty review 准备全文 invalid | 空必填接受 | 1 红 → 4 绿 |
| Q-11 | 5 文件施工注释 | — | — |
| F2 | GAP-46 按真实 selection 拒绝 | 去 Work prep 过滤 | 1 红 → 绿 |
| J-01 | 设置→准备/启动 A/B、省略/重启 | saveModelRoute 不存 promptPack | 1 红 → 1 绿 |
| J-02 | 同 modelId A→B | settingsModelBinding 不回填 | 1 红 → 1 绿 |
| J-03 | 旧/新任务输入整文+字面 SHA | 标签固定 | 1 红 → 1 绿 |
| J-05 | LA-1 新 Session 公开链+提醒 1 | Work 忽略 basis | 1 红 → 1 绿 |
| J-07 | 5 个 PC-18 例：manifest 布尔+启动输入 reminder 0/1 | 反转 recipe | 1 红 → 1 绿 |
| J-10 | Skill/brief read 块两轮整文 | 传 `[]` | 1 红 → 1 绿 |
| J-11 | shrink 全链：777/41、1375-2152/2154-2195、2195、43/4096、start ready | 旧 sections | 1 红 → 1 绿 |
| J-12 | Query prep 后改包仍旧；Work resume 加 record_note | start 重读当前 pack | 各 1 红 → 绿 |
| J-13 | Work/Query readPromptRecord 手写 spec+SHA | 只留两短条 | 1 红 → 1 绿 |

same-as：A-09=Q-10；H-09=J-01/J-02；T-09、G-09、Q-06=J-11；Q-07 的 same-Session/LA-1=J-05（J-04/J-06 deferred）；Q-08=J-12；Q-09=J-13；Q-05=F1。rejected：A-10、T-10、Q-02。deferred：T-08、J-04、J-06、J-08、J-09。

## 4. 检查与测试

检查（生产 HEAD `ea216c4`，逐条一次）：`build-kernel-patch --check` 0；`build-platform-prompts --check` 0（`platform prompt pack: OK`）；typecheck 0（`2dae25f` 后再跑一次仍 0）；`check:architecture` 0（`next source boundaries: OK`）；`build` 0（`platform prompt pack: OK`）。

测试：261 文件，27 批，`npx vitest run --maxWorkers=2`，全局 test 锁；**241 文件过、20 文件败；1977 tests 过、37 败、29 跳过**。

- 非环境失败只有 2 条：`K-readonly-command` 的 KB-08、KB-10（Q-01 读次数，见 §1.1）。
- 35 条环境失败：`ENOENT: no such file or directory, access '/usr/bin/bwrap'`（A2-*、composition A2/R3e/R5c/S8A、orchestration、A1 等）；`the Kernel ProcessSandbox profile is not available; no host shell fallback`（change-emitters、MVP-workbench-tools）；`invariants.test` beforeAll `finalize_first: round … open`；`invariants-fuzz` coverage（29 个 bwrap 跳过）；AG2b/R6/R5b/A1 的 `waiting`/30s 超时均为同一 bwrap 缺失导致。
- 指定项全绿：S2A、S2B-30、S2C-lines-*（含 page 24 例）、A2-requeue-service、R3e-reverify、S5-notices、C2、K3-15、K3-35-T、K3-35-approved、AG6、S1 两个、十个 PC2-W、joint 三文件 17 例。
- 未跑的 `tests/scenarios` importer（14 个；A1 已尝试并因 bwrap 失败）：A8-host-restart-attestation、A8-host-restart-entry、A8-host-restart-paused、C3-brief-idempotency、C3-not-entered-chain、C3-reply-other-session、C3-workspace-changed、K-W-workflow-close、K3-07-real-host-kill、K3-16-approval-round、K3-17-review-answer-shape、K3-R1-continuation-protection、K3-R1-file-change、K3-R1-restart-flows。

## 5. 提交

`5a7d313` F1,Q-05；`eca4f8a` A；`cc2d1ff` W；`9687d70` H；`fa21c72` G；`5bb6f6c` F3（提交信息误写 T-08 table）；`6e9d4d4` T；`ea216c4` Q,F2；`2dae25f` J,H-09,T-09,G-09,Q-06..Q-09。`git diff --shortstat af84802 HEAD` = **70 files changed, 10065 insertions(+), 512 deletions(-)**。`git status --porcelain` 空；白名单外 diff 空；四个冻结夹具 diff 空。

## 6. HANDOFF

本次没有中途停止；除 §1.1 的 2 条旧测试（不在白名单）需 lead 裁定两行 `read<=2` 外，所有行已落盘并提交。scenario 全套与 bwrap 环境由 lead 复跑。
