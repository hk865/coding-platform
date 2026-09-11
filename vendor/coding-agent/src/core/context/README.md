# Context

Context 子系统把系统提示、对话、工具定义、Skill、Memory 和补充片段转换为预算内的
`ModelRequest`。它只处理已经取得的值，不读取文件、不访问存储，也不调用 Provider。

## 流程

```text
ContextFragment / SkillContext / MemoryItem / transcript
                  │
          ContextSelectionPolicy
                  │
       DeterministicContextBuilder
                  │
             ModelRequest
```

- `types/` 定义可 JSON round-trip 的共享值与 strict schema。
- `selection_policy/` 估算 token，并以稳定顺序保留或裁剪上下文。
- `builder/` 校验 transcript 关联，排序工具与片段，组装最终请求。
- `compactor/` 是摘要式压缩的预留边界，当前主链路不调用。
