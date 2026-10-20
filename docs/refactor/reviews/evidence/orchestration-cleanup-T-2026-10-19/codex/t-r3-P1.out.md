发现 2 项，均归 W3-01。IN05 是测试夹具漏注册索引；正式平台已有注册，无需修改生产代码。`tests/work-graph/S3-context-inputs.test.ts:265`、`src/composition/create-platform.ts:656`

本次未修改文件，未运行测试、构建或网络操作；运行结果引用所给检查记录。`.lead-ref/checks/r3-in05.txt:1`

| 编号 | 类别 | 位置 | 行 | 问题 | 改法 |
|---|---|---|---|---|---|
| P1-01 | 会出错 | `tests/work-graph/S3-context-inputs.test.ts:265` | W3-01 | 夹具缺少异常锚点索引。runA2 重新入队后的真实准备读取接续依据，必经 `readTaskPendingAnchors`，缺索引时返回所记录的 `incomplete`，因此尚未到达 IN05 的 `forbidden` 断言。`src/core/work-graph/tasks/run-state-service.ts:894`、`src/core/work-graph/tasks/run-state-service.ts:384`、`.lead-ref/checks/r3-in05.txt:6` | 在本文件的额外 schema 集合中完整加入 `SESSION_ANOMALY_RECORD_SCHEMAS` 的 records、events、lookups；保持原流程和断言。 |
| P1-02 | 违规 | `tests/work-graph/S3-context-inputs.test.ts:637` | W3-01 | 新增 `messages.readMessage` 桩固定返回手写的 `unsupported`，不符合默认禁止及 F4；已有真实 mailbox 可用。当前请求未带 `newInputRefs`，该桩不会执行，因此此项不是 IN05 报错原因。`.lead-ref/books/test-rule-sheet-v1.md:6`、`.lead-ref/books/test-rule-sheet-v1.md:68`、`tests/work-graph/S3-context-inputs.test.ts:582`、`src/core/work-graph/tasks/requeue-service.ts:965` | 将整个消息桩替换为 `messages: mailbox`。 |

P1-01 的完整因果链是：第二次 claim 携带真实 `requeueRef` → 准备接续说明 → 读取任务异常索引 → 夹具未注册而拒绝。索引属于现有生产 schema，其他夹具也完整注册了它。`tests/work-graph/S3-context-inputs.test.ts:655`、`src/core/agent-runtime/context-assembler.ts:1861`、`src/core/work-graph/tasks/run-state-service.ts:379`、`src/core/work-graph/tasks/session-anomaly-codecs.ts:358`、`tests/helpers/S1-archive-service-fixture.ts:76`

因此，回复中 W3-01 的 `done` 尚不成立；有 bubblewrap 的记录仍显示两个后端的 IN05 失败。`.lead-ref/replies/t-reply-W1R3.md:9`、`.lead-ref/checks/r3-in05.txt:4`

逐行结论：

| 行 | 结论 | 核对位置 |
|---|---|---|
| W3-01 | P1-01、P1-02 | `tests/work-graph/S3-context-inputs.test.ts:265`、`tests/work-graph/S3-context-inputs.test.ts:637` |
| W3-02 | OK | `tests/work-graph/S3-context-inputs.test.ts:294`、`tests/work-graph/S3-context-inputs.test.ts:365` |
| W3-03 | OK | `tests/work-graph/S3-context-inputs.test.ts:674`、`tests/work-graph/S3-context-inputs.test.ts:683` |
| W3-04 | OK | `tests/work-graph/S3-context-inputs.test.ts:593`、`tests/work-graph/S3-context-inputs.test.ts:600`、`tests/work-graph/S3-context-inputs.test.ts:818` |
| W3-05 | OK | `tests/work-graph/S3-context-inputs.test.ts:527`、`tests/work-graph/S3-context-inputs.test.ts:775` |
| W3-06 | OK | `tests/work-graph/S3-context-inputs.test.ts:1006`、`tests/work-graph/S3-context-inputs.test.ts:1010` |
| W3-07 | OK | `tests/work-graph/S3-graph-context.test.ts:375`、`tests/work-graph/S3-graph-context.test.ts:519` |
| W3-08 | OK | `tests/work-graph/R4c-execution-read.test.ts:261`、`tests/work-graph/R4c-execution-read.test.ts:269` |
| W3-09 | OK | `tests/work-graph/S3-prepared-context-admission.test.ts:667`、`tests/work-graph/S3-prepared-context-admission.test.ts:675` |
| W3-10 | OK | `tests/scenarios/S2C-K-legacy-provenance.test.ts:80` |
| W3-11 | OK | `tests/work-graph/S3-prepared-context-admission.test.ts:169` |
| W3-12 | OK | `.lead-ref/replies/t-reply-W1R3.md:83` |

台账三行均有授权，没有发现其他断言削弱：

| 台账位置 | 映射 | 核对结果 |
|---|---|---|
| `.lead-ref/replies/ledger-W1R3.txt:4` | W3-04 | 新增消息 ID 字面量断言，冻结表明确要求。`.lead-ref/t-w1r2-findings.md:30` |
| `.lead-ref/replies/ledger-W1R3.txt:7` | W3-09 | 删除测试直接读取 Kernel store 的断言，有明确授权。`.lead-ref/t-w1r2-findings.md:35` |
| `.lead-ref/replies/ledger-W1R3.txt:8` | W3-09 | 删除手写判决的 committed 断言，替换为真实 W-05 报告及 revoked 状态检查。`tests/work-graph/S3-prepared-context-admission.test.ts:679`、`tests/work-graph/S3-prepared-context-admission.test.ts:681` |

两处 A2 均符合指定用途：W3-08 临时移走真实数据库，经真实 probe 后在 `finally` 恢复；W3-09 在指定入口使 Kernel 文件不可读，恢复后由真实启动核对完成判定。故障注入本身没有写业务事实，原拒绝和不变性断言保留。`tests/work-graph/R4c-execution-read.test.ts:261`、`tests/work-graph/R4c-execution-read.test.ts:265`、`tests/work-graph/S3-prepared-context-admission.test.ts:642`、`tests/work-graph/S3-prepared-context-admission.test.ts:651`、`tests/work-graph/S3-prepared-context-admission.test.ts:688`

字面量已按源码规则独立重算：

- **W3-04：** sender Session 摘要为 `20b96b90c57b8de3f90f3c702330b4a1eca98d75a201f195e66b99a6b74f2a97`；首次占用 generation 为 `1 + 1 = 2`。代入项目 `p`、工作区 `w`、请求 `s3-send-decision` 和 runA 后，消息 ID 为 `session-message-66ca4e44a5c1869536b0cbbee954fd534c8e82e6650e79b1628f69464acca4a4`，与字面量一致。`src/core/work-graph/sessions/session-directory.ts:140`、`src/core/work-graph/state/session-availability.ts:234`、`src/core/work-graph/communication/mailbox-service.ts:712`、`src/core/work-graph/communication/mailbox-service.ts:750`、`tests/work-graph/S3-context-inputs.test.ts:157`
- **W3-06：** open@1，begin、result、finalize 各加一，得到 revision 4；报告类型确为 `application/vnd.coding-platform.verification-check-report+json;version=1`。测试使用独立字面量，报告引用继续使用真实返回值。`src/core/work-graph/state/verification-machine.ts:908`、`src/core/work-graph/state/verification-machine.ts:971`、`src/core/work-graph/state/verification-machine.ts:1019`、`src/contracts/no-progress.ts:25`、`tests/work-graph/S3-context-inputs.test.ts:1006`
- **W3-07：** 对注释列出的三个规范 JSON 分别计算 SHA-256，得到 `2756a7606765207ade5e4a1939f9f49472a6af969cf7910d74a4719cd799ce73`、`51c986a1fca760447cad3a47f0786809fd73d20318d8c6c6c439e282d170d79a`、`dcf115308e5f3d0062a8d7e00ce65a374476573c8356d8414c43f4d70a3cd3a9`；均与 A/B/Q 字面量相同且不含 `b`。`src/contracts/fingerprint.ts:45`、`src/core/work-graph/sessions/session-directory.ts:140`、`tests/work-graph/S3-graph-context.test.ts:366`、`tests/work-graph/S3-graph-context.test.ts:375`

P1-01 补丁：

```diff
diff --git a/tests/work-graph/S3-context-inputs.test.ts b/tests/work-graph/S3-context-inputs.test.ts
--- a/tests/work-graph/S3-context-inputs.test.ts
+++ b/tests/work-graph/S3-context-inputs.test.ts
@@ -71,6 +71,7 @@
 import { MODEL_REQUEST_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/model-request-codecs.js';
 import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
 import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
+import { SESSION_ANOMALY_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
 import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
 import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
 import { VerificationWorkspaceReader } from '../../src/core/workspace/verification-workspace-reader.js';
@@ -257,15 +258,15 @@
   records: [...EVIDENCE_RECORD_SCHEMAS.records, ...EXECUTION_ENTRY_RECORD_SCHEMAS.records,
     ...MODEL_REQUEST_RECORD_SCHEMAS.records, ...CONTROL_RECORD_SCHEMAS.records,
     ...SESSION_MESSAGE_RECORD_SCHEMAS.records, ...QUERY_JOB_RECORD_SCHEMAS.records,
-    ...LINE_SETTINGS_RECORD_SCHEMAS.records],
+    ...LINE_SETTINGS_RECORD_SCHEMAS.records, ...SESSION_ANOMALY_RECORD_SCHEMAS.records],
   events: [...EVIDENCE_RECORD_SCHEMAS.events, ...EXECUTION_ENTRY_RECORD_SCHEMAS.events,
     ...MODEL_REQUEST_RECORD_SCHEMAS.events, ...CONTROL_RECORD_SCHEMAS.events,
     ...SESSION_MESSAGE_RECORD_SCHEMAS.events, ...QUERY_JOB_RECORD_SCHEMAS.events,
-    ...LINE_SETTINGS_RECORD_SCHEMAS.events],
+    ...LINE_SETTINGS_RECORD_SCHEMAS.events, ...SESSION_ANOMALY_RECORD_SCHEMAS.events],
   lookups: [...(EVIDENCE_RECORD_SCHEMAS.lookups ?? []), ...(EXECUTION_ENTRY_RECORD_SCHEMAS.lookups ?? []),
     ...(MODEL_REQUEST_RECORD_SCHEMAS.lookups ?? []), ...(CONTROL_RECORD_SCHEMAS.lookups ?? []),
     ...(SESSION_MESSAGE_RECORD_SCHEMAS.lookups ?? []), ...(QUERY_JOB_RECORD_SCHEMAS.lookups ?? []),
-    ...(LINE_SETTINGS_RECORD_SCHEMAS.lookups ?? [])],
+    ...(LINE_SETTINGS_RECORD_SCHEMAS.lookups ?? []), ...(SESSION_ANOMALY_RECORD_SCHEMAS.lookups ?? [])],
 };
 
 async function createInputFixture(
```

P1-02 补丁：

```diff
diff --git a/tests/work-graph/S3-context-inputs.test.ts b/tests/work-graph/S3-context-inputs.test.ts
--- a/tests/work-graph/S3-context-inputs.test.ts
+++ b/tests/work-graph/S3-context-inputs.test.ts
@@ -634,9 +634,6 @@
     const requeueService = createTaskRequeueService({ records: backend.records,
       reads: createRunStateReader({ records: backend.records }), workspaceHost: world.workspaceHost,
       source: new VerificationWorkspaceReader(), materials: writeMaterials,
-      messages: { async readMessage() {
-        return { status: 'rejected' as const, code: 'unsupported' as const,
-          reason: 'S3 fixture requeue reads no message' };
-      } },
+      messages: mailbox,
       now: () => AT, eventId });
     const requeued = await requeueService.requeueTask(ctx, { input: { taskRef: tA, afterRunRef: runA,
```

两个补丁均已核对当前文本的上下文和 hunk 行数，没有落盘应用。每个补丁的验证文件都是 `tests/work-graph/S3-context-inputs.test.ts`，需覆盖两个后端并使用 bubblewrap，因为 IN05、IN11 调用真实检查 runner。`tests/work-graph/S3-context-inputs.test.ts:621`、`tests/work-graph/S3-context-inputs.test.ts:777`、`.lead-ref/checks/r3-in05.txt:4`

lead 应用两份补丁后可合并运行一次：

```bash
CODING_AGENT_BWRAP_PATH="$HOME/.local/opt/bubblewrap/usr/bin/bwrap" \
npx vitest run --maxWorkers=2 tests/work-graph/S3-context-inputs.test.ts
```

```json
[
  {
    "id": "P1-01",
    "class": "会出错",
    "file": "tests/work-graph/S3-context-inputs.test.ts",
    "line": 265,
    "row": "W3-01",
    "problem": "夹具没有注册 session-anomaly-by-task。runA2 重新入队后的真实准备经 src/core/work-graph/tasks/run-state-service.ts:894 读取异常锚点，在同文件:384 返回 incomplete；已有失败记录见 .lead-ref/checks/r3-in05.txt:6。正式平台在 src/composition/create-platform.ts:656 已注册，属于夹具装配缺陷。",
    "fix": "导入 SESSION_ANOMALY_RECORD_SCHEMAS，并将其 records、events、lookups 完整加入 INPUT_EXTRA_SCHEMAS；保持真实 requeue、第二次 claim、finish 和 forbidden 断言。"
  },
  {
    "id": "P1-02",
    "class": "违规",
    "file": "tests/work-graph/S3-context-inputs.test.ts",
    "line": 637,
    "row": "W3-01",
    "problem": "新增 messages.readMessage 桩固定返回手写 unsupported，违反 .lead-ref/books/test-rule-sheet-v1.md:6 的默认禁止及同文件:68 的 F4。当前请求没有 newInputRefs，按 src/core/work-graph/tasks/requeue-service.ts:965 不会调用该桩，因此它不是 IN05 报错原因。",
    "fix": "删除固定结果的 messages 桩，改为 messages: mailbox，使用本测试在 tests/work-graph/S3-context-inputs.test.ts:582 已取得的真实消息 owner。"
  }
]
```

会出错 1，违规 1，不整洁 0，建议 0