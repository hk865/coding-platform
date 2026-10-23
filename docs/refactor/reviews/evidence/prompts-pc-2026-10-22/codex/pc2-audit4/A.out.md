只读审查完成；未修改文件，未运行测试、构建或变异。发现 **1 项违规、1 项不整洁**。下述变异结论是源码推演，不代表复现了 DSH 的 RED/GREEN。

**1. 发现表**

| 编号 | 类别 | 位置（file:line） | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| A4-01 | 违规 | `tests/runtime/PC2-joint-k3-history.test.ts:13`、`:101` | `.lead-ref/books/pc2-r3-findings.md:17`；`docs/refactor/HANDOFF.md:249` | 新用例调用内部 `loadPreparedManifest`，把 `fixture.world.fixture.bodies` 直接交给它读取事实；该函数实际调用原始 body store 的 `read`，没有经过公开材料接口（`src/core/agent-runtime/execution-preparation.ts:802`、`:818`）。 | 捕获冻结夹具已经建立的复核 Runtime，取得其已有 MaterialPort，通过 `openArtifact` 读取 manifest。保留全部断言，不新建 owner，不修改夹具。 |
| A4-02 | 不整洁 | `tests/runtime/PC2-joint-budget.test.ts:12`、`:138` | `tests/runtime/PC2-joint-budget.test.ts:421` | 两处注释写“两个”动态标识／占位符，实际依次替换 brief digest、previous run id、round id，共三个（`:422`、`:423`、`:424`）。 | 两处 `two` 改为 `three`。 |

**2. 逐行结论**

| 冻结行 | 结论及证据 |
|---|---|
| A3-01 | **A4-01**。指定夹具、完整两条历史、`takesSessionHistory=true`、提醒一次均已加入；原空基线仍在。冻结要求：`.lead-ref/books/pc2-r3-findings.md:22`；新增断言：`tests/runtime/PC2-joint-k3-history.test.ts:87`、`:111`、`:119`、`:130`；空基线：`tests/runtime/PC2-joint-history.test.ts:269`。 |
| A3-02 | **OK**。符合真实平台公开步骤、没有第二个 owner 的要求。冻结要求：`.lead-ref/books/pc2-r3-findings.md:23`；实例捕获、公开材料读写、同实例 bind：`tests/state/PC2-G-query-bind-order.test.ts:35`、`:49`、`:61`、`:87`、`:96`。 |
| A3-03 | **OK**。与审查 3 指定修改一致：start 后公开读 digest，独立拼出全文，分别比较准备正文和请求段。冻结要求：`.lead-ref/books/pc2-r3-findings.md:24`；原修法：`.lead-ref/audit3/A.out.md:105`；落点：`tests/runtime/PC2-joint-tools.test.ts:196`、`:206`、`:212`、`:220`。 |
| A3-04 | **OK**。三个独立全文期望及两种 Query 的整文比较均已补齐，原历史顺序、助手回复和 basis 断言保留。冻结要求：`.lead-ref/books/pc2-r3-findings.md:25`；原修法：`.lead-ref/audit3/A.out.md:10`；落点：`tests/runtime/PC2-joint-query-history.test.ts:43`、`:49`、`:53`、`:123`、`:132`、`:164`、`:170`。 |
| A3-05 | **A4-02**，仅注释问题；要求的行为覆盖已落实。冻结要求：`.lead-ref/books/pc2-r3-findings.md:26`；公开变更、接续、inputs 整省及独立全文比较：`tests/runtime/PC2-joint-budget.test.ts:288`、`:343`、`:353`、`:373`、`:381`、`:425`。 |
| J-09 | **OK**。已补生产变异位置及操作，正文和工具清单断言仍在。要求：`.lead-ref/books/pc2-r3-findings.md:28`；记录：`.lead-ref/replies/pc2-r3-reply.md:20`；生产位置：`src/core/agent-runtime/execution-preparation.ts:419`；断言：`tests/runtime/PC2-joint-tools.test.ts:127`。 |
| T2-03 | **OK**。已补生产 marker 变异记录；仍使用固定 digest 与完整字面期望。要求：`.lead-ref/books/pc2-r3-findings.md:28`；记录：`.lead-ref/replies/pc2-r3-reply.md:21`；生产位置：`src/contracts/continuation-brief.ts:307`；断言：`tests/runtime/PC2-T-render.test.ts:349`、`:358`。 |

A3-02 的 spy 是本次裁定允许的装配接缝：审查 3 已明确要求捕获实际装配的 QueryExecutionPort；组合层创建该实例并把它交给 Runtime，测试没有重新调用工厂建立 owner。事实读取和反例保存仍走公开方法。`query_run` 上下文使用真实准备结果的 ref，符合材料写入的主体匹配规则。它与 A4-01 直接调用内部事实加载器不同。（`.lead-ref/audit3/A.out.md:8`；`src/composition/create-platform.ts:835`、`:1210`；`tests/state/PC2-G-query-bind-order.test.ts:79`；`src/core/work-graph/materials/material-service.ts:289`。）底层项目、工作区、Session、Query 的建立也确实经过公开步骤。（`tests/helpers/RL-query-fixture.ts:130`、`:155`、`:159`、`:163`、`:167`。）

A3-05 的新 Plan id 合法：生产规则要求目标 planId 是未使用的新引用；测试以原 Plan 为 `basedOn`，保留原任务后追加新任务，再公开采用。输入材料采用同作用域的 `platform_operation` 来源，输入服务支持该来源；不是另造执行事实。之后同 Session 领取、完成、验证结算、requeue、再次领取和准备均存在，生产 recipe 会把选中材料读成 inputs 行。（`src/core/work-graph/state/plan-machine.ts:215`、`:410`、`:581`；`tests/runtime/PC2-joint-budget.test.ts:250`、`:266`、`:289`、`:306`、`:336`、`:343`、`:353`；`src/core/work-graph/tasks/context-input-service.ts:500`；`src/core/agent-runtime/context-work-recipe.ts:205`、`:232`。）

变异逐项核对如下。“漏过”只说明指定用例的覆盖边界，不据此新增测试要求。

| 行 | 生产位置及静态结果 | 同规则仍可能漏过的变异 |
|---|---|---|
| A3-01 | `context-history-facts.ts:33` 改成 `false` 会取消历史模式，完整历史及提醒断言会失败；恢复后该路径按非空 basis 取历史。（`src/core/agent-runtime/context-history-facts.ts:33`、`:55`；`tests/runtime/PC2-joint-k3-history.test.ts:111`、`:117`。） | 仅删掉 Work 的 `hasCompletedCursor` 分支，本例仍可凭 basis 通过；它测的是播种分支。（`src/core/agent-runtime/context-history-facts.ts:33`；`tests/runtime/PC2-joint-k3-history.test.ts:120`。） |
| A3-02 | 跳过 `query-execution.ts:1072` 的检查后，两份不同 bundle 会落到 `idempotency_conflict`，与期望 `invalid` 不同；恢复检查则先拒绝顺序问题。（`src/core/work-graph/queries/query-execution.ts:1072`、`:1088`；`tests/state/PC2-G-query-bind-order.test.ts:178`、`:188`。） | 只删段序长度检查、保留逐项比较，这两个“等长换序／缺少整份顺序”的反例仍会通过。（`src/core/work-graph/state/context-input.ts:98`、`:101`、`:104`；`tests/state/PC2-G-query-bind-order.test.ts:166`、`:186`。） |
| A3-03 | `continuation-brief.ts:307` 的冒号改为连字符，会与独立 marker 全文期望不符；原 marker 与期望一致。（`src/contracts/continuation-brief.ts:307`；`tests/runtime/PC2-joint-tools.test.ts:213`、`:214`、`:220`。） | 强行把 `edit` 加入 brief 的工具清单，本例模板只有 `read` 块，仍可能通过。（`src/contracts/continuation-brief.ts:540`；`tests/runtime/PC2-joint-tools.test.ts:168`、`:171`。） |
| A3-04 | 回信所述“标题追加 X”会破坏源历史全文。**位置需勘误：标题拼接在 `:260`，回信的 `:258` 实际是 phase 计算。**只能确认文字描述对应的变异会失败，不能确认曾实际修改哪一行。（`.lead-ref/replies/pc2-r3-reply.md:15`；`src/core/agent-runtime/context-fact-text.ts:258`、`:260`；`tests/runtime/PC2-joint-query-history.test.ts:123`。） | 把有 stage 的任务也渲染成“未声明”，本例原本没有 stage，无法发现。（`src/core/agent-runtime/context-fact-text.ts:265`；`tests/runtime/PC2-joint-query-history.test.ts:43`。） |
| A3-05 | fallback 中跳过 inputs 计数，会同时丢掉对应省略元数据和正文行，与当前断言不符；恢复后计数为一。（`src/core/agent-runtime/context-rendering.ts:268`、`:270`、`:273`；`tests/runtime/PC2-joint-budget.test.ts:368`、`:375`、`:396`。） | 只破坏非 fallback 分支的 inputs 省略行，此零预算用例仍走 fallback，不能发现。（`src/core/agent-runtime/context-rendering.ts:250`、`:258`、`:264`；`tests/runtime/PC2-joint-budget.test.ts:224`。） |
| J-09 | 过滤掉 `write` 后，`edit` 块不再渲染，`ARESZ` 变成 `ARSZ`，正文及工具列表都会失败。（`src/core/agent-runtime/execution-preparation.ts:419`；`tests/runtime/PC2-joint-tools.test.ts:106`、`:115`、`:127`、`:128`。） | 错误地要求同时授权 shell 才保留 write，本例同时授权三者，不能发现。（`tests/runtime/PC2-joint-tools.test.ts:115`。） |
| T2-03 | marker 中增加空格会破坏三条完整字面比较；恢复后格式与固定期望一致。（`src/contracts/continuation-brief.ts:307`；`tests/runtime/PC2-T-render.test.ts:358`、`:360`、`:362`。） | 对这三组输入，未发现改变输出 marker／正文仍能逃过全文比较的变异。上述三处均为整文 `toBe`。 |

长字面抽查未见与所固定规则不一致的地方：

- A3-01 的 absent role、未加载 Goal、`phase: pending` 和两条未接入提醒，对应无 graph-context reader 的夹具及渲染回退；不是应当改成 `running` 的错误。（`tests/runtime/PC2-joint-k3-history.test.ts:46`、`:57`、`:69`、`:76`；`tests/helpers/K3-35-runtime.ts:218`；`src/core/agent-runtime/context-fact-text.ts:100`、`:258`；`resources/prompts/platform/strings.json:131`。）
- A3-04 源 Work 与两种当前 Query 使用不同 prelude；Query 的 Question 位于 goal 槽，提醒位于 role 尾部，三个字面与该规则相符。（`tests/runtime/PC2-joint-query-history.test.ts:43`、`:49`、`:53`；`resources/prompts/platform/strings.json:55`、`:56`；`src/core/agent-runtime/context-query-recipe.ts:87`；`src/core/agent-runtime/context-rendering.ts:225`。）
- A3-05 的 legacy 输入声明、空 obligations／acceptance、省略行顺序、brief marker 和固定尾部均有对应规则；三个动态值只填入手写文本。（`tests/runtime/PC2-joint-budget.test.ts:90`、`:92`、`:97`、`:102`、`:133`、`:421`；`src/core/agent-runtime/context-fact-text.ts:218`、`:270`；`src/core/agent-runtime/context-rendering.ts:138`、`:268`；`src/contracts/continuation-brief.ts:307`；`resources/prompts/platform/templates/continuation-brief.txt:4`。）

范围方面，提供的差异只含五个白名单测试文件；按 base 与补丁在内存中逐行重建，均与当前文件一致。该差异没有 `src`、`scripts`、`resources`、`runtime-assets.json` 或 `tests/helpers` 修改。（`.lead-ref/parts/A-files.txt:1`；`.lead-ref/parts/A.diff:1`、`:466`、`:613`、`:685`、`:727`；`.lead-ref/books/pc2-r3-whitelist.txt:1`。）五文件未见 skip／only 用例，显式超时均不超过 `60_000`。（`tests/runtime/PC2-joint-budget.test.ts:433`；`tests/runtime/PC2-joint-k3-history.test.ts:140`；`tests/runtime/PC2-joint-query-history.test.ts:140`、`:174`；`tests/runtime/PC2-joint-tools.test.ts:383`、`:416`；`tests/state/PC2-G-query-bind-order.test.ts:173`。）

未证明本轮引入额外的“会出错”回退。r2 全量已有通过汇总；r3 文件目前只有构建和静态检查结果，没有测试汇总，不能据此宣告 r3 全量通过。（`.lead-ref/checks/full-pc2-r2.txt:8`；`.lead-ref/checks/full-pc2-r3.txt:1`、`:7`。）

**3. 补丁**

以下均为对当前树的零上下文 unified diff；未应用、未执行检查。

A4-01：捕获已有 Runtime 的材料接口。冻结 helper 本来就返回该 Runtime 及其依赖，材料接口也是实际接入该 Runtime 的实例。（`tests/helpers/K3-35-runtime.ts:176`、`:225`、`:245`。）

```diff
--- a/tests/runtime/PC2-joint-k3-history.test.ts
+++ b/tests/runtime/PC2-joint-k3-history.test.ts
@@ -13 +13,2 @@
-import { loadPreparedManifest } from '../../src/core/agent-runtime/execution-preparation.js';
+import type { PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
+import * as k3RuntimeFixture from '../helpers/K3-35-runtime.js';
@@ -87,5 +88,15 @@
-    const fixture = await openPCK3ReviewFixture({
-      sourceHistory: 'completed_turn',
-      model: scriptedModel([{ text: 'PC review answer' }]),
-    });
-    try {
+    const capture = vi.spyOn(k3RuntimeFixture, 'createK3_35Runtime');
+    let opened: Awaited<ReturnType<typeof openPCK3ReviewFixture>> | undefined;
+    try {
+      const fixture = await openPCK3ReviewFixture({
+        sourceHistory: 'completed_turn',
+        model: scriptedModel([{ text: 'PC review answer' }]),
+      });
+      opened = fixture;
+      const wired = capture.mock.results.find(result =>
+        result.type === 'return' && result.value.runtime.port === fixture.runtime);
+      if (wired === undefined || wired.type !== 'return') {
+        throw new Error('J-06 the review Runtime wiring was not captured');
+      }
+      const materials = wired.value.deps.materials;
+      capture.mockRestore();
@@ -101,3 +112,6 @@
-      const loaded = await loadPreparedManifest(fixture.world.fixture.bodies, prepared);
-      if (loaded.status !== 'ready') throw new Error(JSON.stringify(loaded));
-      const manifest = loaded.value.manifest;
+      const loaded = await materials.openArtifact(fixture.world.fixture.ctx, {
+        ref: prepared.envelope.bundleRef,
+        usage: 'historical_explanation',
+      });
+      if (loaded.status !== 'ready') throw new Error(JSON.stringify(loaded));
+      const manifest = JSON.parse(loaded.value.body) as PreparedTaskManifestV1;
@@ -138 +152,2 @@
-      await fixture.close();
+      capture.mockRestore();
+      await opened?.close();
```

A4-02：

```diff
--- a/tests/runtime/PC2-joint-budget.test.ts
+++ b/tests/runtime/PC2-joint-budget.test.ts
@@ -12 +12 @@
- * production, the generated pack, the manifest or a captured request. The two
+ * production, the generated pack, the manifest or a captured request. The three
@@ -138 +138 @@
-/** The whole current input, hand-written. The two tokens come from public reads. */
+/** The whole current input, hand-written. The three tokens come from public reads. */
```

**4. 同一发现的 JSON**

```json
[
  {
    "id": "A4-01",
    "class": "违规",
    "locations": [
      "tests/runtime/PC2-joint-k3-history.test.ts:13",
      "tests/runtime/PC2-joint-k3-history.test.ts:101"
    ],
    "basis": [
      ".lead-ref/books/pc2-r3-findings.md:17",
      "docs/refactor/HANDOFF.md:249",
      "src/core/agent-runtime/execution-preparation.ts:818"
    ],
    "problem": "新增 J-06 用例经内部 loadPreparedManifest 直接读取原始 body store，未通过公开材料接口读取事实。",
    "fix": "捕获冻结 helper 已创建的复核 Runtime，使用其现有 MaterialPort.openArtifact 读取 manifest；保留全部断言，不修改夹具或新建 owner。"
  },
  {
    "id": "A4-02",
    "class": "不整洁",
    "locations": [
      "tests/runtime/PC2-joint-budget.test.ts:12",
      "tests/runtime/PC2-joint-budget.test.ts:138"
    ],
    "basis": [
      "tests/runtime/PC2-joint-budget.test.ts:422",
      "tests/runtime/PC2-joint-budget.test.ts:423",
      "tests/runtime/PC2-joint-budget.test.ts:424"
    ],
    "problem": "两处注释声称有两个动态标识或占位符，实际有 brief digest、previous run id、round id 三个。",
    "fix": "两处 two 改为 three。"
  }
]
```

会出错 0，违规 1，不整洁 1，建议 0