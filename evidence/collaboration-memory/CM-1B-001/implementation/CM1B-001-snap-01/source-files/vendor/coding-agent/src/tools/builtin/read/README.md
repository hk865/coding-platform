# Read Tool

`ReadToolHandler` 通过 `WorkspaceSandbox` 读取受控文件或目录，并把结果转换为有界的文本/JSON
`ToolOutputPart`。路径在 schema、Permission 和 Sandbox 三层校验。

该工具声明为 read-only，可在定义允许且批次中所有调用都独立只读时参与并行组。它不修改文件、不执行命令，也不能访问 workspace 根之外或受保护的资源。
