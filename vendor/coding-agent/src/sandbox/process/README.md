# Process Sandbox

`ProcessSandbox`
通过 bubblewrap 创建受限命令环境：workspace 是受控工作目录，受保护路径不可见，网络隔离由 profile 明确声明，子进程只得到最小环境。

`execute()`
管理启动、stdin/stdout/stderr 上限、超时、AbortSignal、进程组终止和孤儿清理，返回退出状态、截断信息与执行前后 workspace 快照耗时。bubblewrap 不存在、不可执行或能力探测失败时抛出
`ProcessSandboxError`，不会直接调用普通 shell。

本模块强制 OS 能力，不决定命令是否需要审批；该决策属于 Permission/Approval。
