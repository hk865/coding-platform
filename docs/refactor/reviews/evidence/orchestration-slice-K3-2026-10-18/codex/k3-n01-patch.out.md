Reason: `unavailable: the saved answer is not readable` — passed through `src/business/workflow/decision-actions.ts:591`, formatted at `src/business/workflow/workflow.ts:2286`, called at `:2762`, returned at `:2789`.  
Test: `N-01 (%s): an unreadable saved CRR answer waits without writing`  
M1: both soft assertions—`{ state: 'waiting', next: null }` and the exact reason—should fail.

```diff
diff --git a/tests/work-graph/B2-UR7-crr-answer.test.ts b/tests/work-graph/B2-UR7-crr-answer.test.ts
--- a/tests/work-graph/B2-UR7-crr-answer.test.ts
+++ b/tests/work-graph/B2-UR7-crr-answer.test.ts
@@ -48,7 +48,8 @@ function unsupported(reason: string) {
 }
 
 /** The REAL Workflow over this world's owners; only the answer path is wired. */
-function workflowOf(world: K3ReviewCardWorld, flowId: string, message: SessionMessage) {
+function workflowOf(world: K3ReviewCardWorld, flowId: string, message: SessionMessage,
+  decisionMessages: K3ReviewCardWorld['decisions'] = world.decisions) {
   const f = world.fixture;
   const records = world.records;
   const reads = createRunStateReader({ records });
@@ -84,7 +85,7 @@ function workflowOf(world: K3ReviewCardWorld, flowId: string, message: SessionMessage
     }] },
     goalSettings: createGoalSettingsService({ records, now: () => f.now(),
       newId: () => f.newId(), operatorActor: f.operatorActor }),
-    decisionMessages: world.decisions as never,
+    decisionMessages: decisionMessages as never,
     decisionApplications: {
       command_rerun_request: createCommandRerunRequestApplicationAdapter(world.commandRerun),
     } as never,
@@ -173,4 +174,58 @@ describe('UR7/F-035: the one real Workflow advance applies a saved CRR answer', () =>
     expect(replayed.message.revision).toBe(applied.message.revision);
     expect(replayed.message.application).toEqual(applied.message.application);
   }, 120_000);
+
+  it.each(['memory', 'sqlite'] as const)('N-01 (%s): an unreadable saved CRR answer waits without writing', async kind => {
+    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
+    worlds.push(world);
+    const label = `n01-${kind}`;
+    const record = await blockedRecord(world, 'k3-20-a', label,
+      [{ callId: `${label}-call`, command: CRR_COMMAND }]);
+    const request = await requestRerunOf(world, record, `${label}-request`);
+    const card = await crrCardOf(world);
+
+    // Save only ①; Workflow must read this answer before applying ② or ③.
+    const answered = await world.decisions.answerDecision(world.fixture.ctx, {
+      input: { source: card.source, selection: { kind: 'option', optionId: 'allow_rerun' },
+        text: '', annotations: [] },
+      meta: { requestId: `${label}-answer`, expected: card.source.pins },
+    });
+    expect(answered.status).toBe('committed');
+    if (answered.status !== 'committed') throw new Error(JSON.stringify(answered));
+    const message = answered.value;
+    const before = await publicState(world, request.ref, card.source);
+    expect(before.request).toMatchObject({ state: 'pending', revision: request.revision });
+    expect(before.message.ref).toEqual(message.ref);
+    expect(before.message.revision).toBe(message.revision);
+    expect(before.message.application).toBeNull();
+
+    let failedReads = 0;
+    const workflow = workflowOf(world, label, message, {
+      ...world.decisions,
+      readDecisionAnswer: async (ctx, input) => {
+        if (failedReads === 0 && input.source.kind === card.source.kind
+          && input.source.key === card.source.key) {
+          failedReads += 1;
+          return { status: 'rejected', code: 'unavailable',
+            reason: 'the saved answer is not readable' };
+        }
+        return world.decisions.readDecisionAnswer(ctx, input);
+      },
+    });
+    const advanced = await workflow.advanceWork(world.fixture.ctx, { schemaVersion: 1,
+      goalRef: GOAL_B, flowId: label, taskId: 'k3-20-a', sessionHint: null, kind: 'select_work',
+      answers: [{ kind: 'command_rerun_request', requestRef: request.ref,
+        answerMessageRef: message.ref }] });
+    expect(failedReads).toBe(1);
+    expect(advanced.status).toBe('ready');
+    if (advanced.status !== 'ready') throw new Error(JSON.stringify(advanced));
+    // Keep both M1-sensitive assertions observable in the same run.
+    expect.soft(advanced.value).toMatchObject({ state: 'waiting', next: null });
+    expect.soft(advanced.value.reason).toBe('unavailable: the saved answer is not readable');
+
+    const after = await publicState(world, request.ref, card.source);
+    expect(after.request.revision).toBe(before.request.revision);
+    expect(after.message.revision).toBe(before.message.revision);
+    expect(after.message.application).toEqual(before.message.application);
+  });
 });
```