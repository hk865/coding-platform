# ADR-0004：真流式交付与分层工作区一致性

状态：Accepted  
日期：2026-08-27

## 背景

真实 Session 显示，小文件 read 曾耗时 4.9–7.6 秒，shell 曾耗时 21–53 秒。命令本身通常只有毫秒级，主要时间来自每个工具边界反复递归读取并哈希整个 336MB 工作区。SQLite 事件追加还会在每次 append 时重放该 Session 的全部历史，长会话形成 O(n²)。

旧 Web 路径虽然使用 Provider stream
callback，但 SSE 重连缓存会合并相邻 chunk，也没有 chunk 序号与真实分块到达测试，无法证明浏览器在模型完成前收到了正文。

## 决策

### 模型流

- Provider 的每个 text/reasoning
  chunk 作为独立 Web 事件保留，携带 requestId、chunkIndex 和相对到达时间。
- SSE 立即发送响应头，关闭反向代理缓冲并启用 TCP no-delay。
- 页面只在 animation
  frame 合并渲染工作，不合并传输事实；Markdown 尾部可以重复解析，网络 chunk 不可伪造。
- 模型 chunk 不逐块同步写 checkpoint。Session 只在现有语义事件边界持久化完整 assistant 消息。

### 工作区 revision

- Git 工作区优先使用受限的 porcelain
  v2 状态作为主线。禁用 fsmonitor、hooks、全局/系统配置和可选锁，只对脏/未跟踪候选读取 inode、ctime、mtime、mode、size 元数据。
- 非 Git 工作区回退到 sparse_metadata_v1，忽略 .git、.tooling、node_modules、dist、coverage、test-results 和 .cache 等可再生目录。
- 单文件 read/edit 的并发保护继续使用内容 SHA-256；Git 或元数据 revision 不是路径安全边界。
- read、硬拒绝和 capability 缺失不再生成 workspace
  revision。只有需要审批的 edit/shell 绑定 revision；shell 前后对账并返回分阶段耗时。
- Sandbox 内只保留一个已接受 workspace 基线、一个 Session 路径覆盖树，以及当前 shell 的 before/after 临时投影。新基线替换旧基线；没有无界快照历史。

### 一致性模式

- session：默认快速模式。覆盖树只记录本 Session 已读、已改或命令影响过的路径。显式 check 只复核这些路径。
- workspace：Session 继承当前 Git/fallback 工作区基线；check 对账整个主线，Session 的 Agent 变更更新覆盖层与已接受基线。
- strict：在 effectful 操作进入审批前自动执行 workspace 对账；发现非 Agent 漂移就拒绝当前操作，要求 check 和重新读取。

该设计明确承认 session 模式的假设：未被当前 Session 观察的文件可以由用户并发修改而不触发 Session 路径检查。需要消除此假设时选择 workspace 或 strict。

### Session 与 checkpoint

- SQLite adapter 按 Session
  revision 缓存 RunState 投影；同进程连续 append 只应用新草稿。若其他进程改变 revision，缓存失效并从事实日志完整重放。
- recovery checkpoint 仍是可丢弃加速层，Store 每个 Run 只保留最近 3 个。
- 当前不把 CheckpointingEventSink 接入生产热路径，因为 best-effort
  sink 仍被同步 await。后续启用必须先实现有界 write-behind 和语义 flush
  barrier；不能让每个 chunk 或普通事件等待 checkpoint。

## 后果

在当前真实工作区，Git
revision 为 28–48ms；fallback 稀疏元数据为 54–121ms；空 shell 端到端约 102ms（命令 8.6ms，前后对账约 93ms）。此前内容快照为 6.4–10.5 秒，真实 shell 为 21–53 秒。

Git
ignored 与显式忽略目录不进入恢复 revision；其中的依赖/构建缓存变化属于可再生状态。若业务要求这些目录可恢复，必须从 ignoredPrefixes 中移除，接受更高对账成本。

## 验证

- HTTP/SSE 集成测试用两个受控 gate 分别释放 chunk 1 和 chunk 2，证明第一块在模型完成前到达。
- 工具测试证明 read、硬拒绝和 capability 缺失路径产生 0 次 workspace revision。
- Git 测试证明 tracked 文件变化被识别，而 node_modules 生成文件保持稀疏。
- check 测试分别覆盖 Session 访问树、workspace 基线、漂移后基线推进。
- SQLite contract 与恢复测试覆盖缓存存在时的功能语义；跨进程 revision 不匹配仍回退完整重放。
