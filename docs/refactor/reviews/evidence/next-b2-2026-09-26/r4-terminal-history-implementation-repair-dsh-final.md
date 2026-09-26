## R4.3b 同 session 精修完成并 STOP：空 assistant 壳省略

### 修复内容（仅 `patches/core/ports/session_store/session-history.ts`）

实现主体不变，只在返回投影副本的过滤处，对**因本次移除 abandoned 声明而变成正文/推理/工具声明全空**的 assistant entry 连空壳一并省略；有任一原正文、保存 reasoning 或剩余 toolCall 的 entry 完整保留。判据严格沿用原 schema：

```
content.length > 0 || toolCalls.length > 0 || (reasoningContent?.length ?? 0) > 0
```

无 trim/语义猜测；输入 `state`、原 SessionRecords、无变化 entry 引用、terminal/unknown 判据与 restore 边界均不动。

### 修复差异（base `ff23182b…` → fix `9026ec17…`）

```diff
   if (abandonedCallIds.size === 0) return [...state.transcript];
-  return state.transcript.map((entry) => {
-    if (entry.kind !== "assistant_message") return entry;
+  const projected: TranscriptEntry[] = [];
+  for (const entry of state.transcript) {
+    if (entry.kind !== "assistant_message") {
+      projected.push(entry);
+      continue;
+    }
     const toolCalls = entry.toolCalls.filter((call) => !abandonedCallIds.has(call.callId));
-    return toolCalls.length === entry.toolCalls.length ? entry : { ...entry, toolCalls };
-  });
+    if (toolCalls.length === entry.toolCalls.length) {
+      projected.push(entry);
+      continue;
+    }
+    const hasContent = entry.message.content.length > 0;
+    const hasReasoning = (entry.message.reasoningContent?.length ?? 0) > 0;
+    if (toolCalls.length === 0 && !hasContent && !hasReasoning) continue;
+    projected.push({ ...entry, toolCalls });
+  }
+  return projected;
```
（同一提交另更新了函数 doc 注释说明该省略规则。）

### 修复后六文件哈希（baseline → fix）

| 路径 | current SHA256 |
|---|---|
| `.../patches/core/ports/session_store/session-history.ts` | `9026ec17dabc8348782aa910804b4dbd7f4cbebf0fa2828ad003ff18d71bd508` |
| `.../dist/core/ports/session_store/session-history.js` | `425f329ae66bedc4ea6e54ca435b5591d64ffebc49351f57febc1d437fd8675b` |
| `.../dist/core/ports/session_store/session-history.js.map` | `c9e3bedf67ab45119a8bb1c59581009552edbeb308a8b891879a454c90a707d3` |
| `.../dist/core/ports/session_store/session-history.d.ts` | `112cdc57a69fedd7296cf1c88c5868a96422d4ac14f1d6c3c6da07a61775d692` |
| `.../dist/core/ports/session_store/session-history.d.ts.map` | `613b6af24a92b028fead9f14733b403c05191281f8508dbb228bafd14b189760` |
| `.../src/core/agent-runtime/execution-observation.ts` | `779044403c37bb53777529cbcf36ae89bfad533f20f91d50a1b940de7b4abfdb`（**未变，冻结**） |

4 个 dist 产物仍仅由 `scripts/build-kernel-patch.mjs --write` 同源再生。

### 固定检查结果（复跑）
- `next-terminal-history`：**2 files / 5 tests 全 pass**
- `next-kernel-history-public`：**1 file / 10 tests pass**
- `next-types`：**exit 0**
- `next-kernel-patch`：**7 sources / 28 artifacts 全部逐字匹配，exit 0**

### Scope audit
- lane 相比 prepare 快照 changed = **恰好 6 个 writableFiles**，`outsideScope = []`；
- observer `779044403c…` 与三冻结测试 SHA（`cdd75d64…`、`cbd89f51…`、`42a8a77d…`）均未变；
- 未新增/修改测试或工具脚本，未安装依赖、未提交 Git；未运行权限/Role/恢复大集合。

按任务书立即 STOP，不自行导入，交主审独立验证后导入并继续后续接线。