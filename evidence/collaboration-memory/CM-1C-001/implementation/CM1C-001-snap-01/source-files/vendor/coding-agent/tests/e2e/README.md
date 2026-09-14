# End-to-end Tests

E2E 从进程边界验证完整装配：

- `m3-bwrap-runtime.test.ts`：真实 namespace/network、隐藏资源、超时、取消、孤儿和截断。
- `m4-cross-process.test.ts` / `m4-stable-cross-process.test.ts`：SQLite、Checkpoint 与跨进程恢复。
- `m5-cli-child.test.ts`：CLI 子进程、PTY 审批、SIGINT 和工具闭环。

普通套件在隔离能力缺失时可明确 skip；`npm run test:e2e:bwrap`
把 bubblewrap 设为强制门禁。测试只使用临时 workspace 和离线 Provider
fixture，不接触用户目录或真实账号。
