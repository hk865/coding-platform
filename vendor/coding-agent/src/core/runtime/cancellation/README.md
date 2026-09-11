# Cancellation

`CancellationController` 把调用方请求、用户中断和进程信号归一为一个幂等
`AbortSignal`，并保存首次取消原因。Runtime、Provider、Hook 和 Tool 都继承该信号。

`isAbortError()`
只识别明确的取消错误；普通异常不会被误报为取消。工具已经开始产生副作用时，取消结果还要结合 effects 与恢复协调器判断，而不是简单回滚 State。
