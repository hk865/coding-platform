# Trace

`InMemoryTraceSink`
以 best-effort 方式保存一次进程内事件时间线，包括事件身份、sequence、类型与接收时间。读取时返回防修改副本。

Trace 用于测试和诊断，不改变事件顺序、不参与恢复，也不保证跨进程持久化。需要持久证据时，应由 Session 或 Benchmark
artifact 明确保存。
