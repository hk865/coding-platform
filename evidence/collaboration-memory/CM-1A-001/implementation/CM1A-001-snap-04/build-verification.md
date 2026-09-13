# CM1A-001-snap-04 构建来源

当前冻结源码通过 pnpm build（内核 build、平台 tsc、旧 UI 复制、React/Vite 构建），日志为 logs/build-delivery.log，退出码 0。完整产物逐文件 SHA256 与树指纹见 build-origin.json。

此前 pnpm verify:ui-build 与 pnpm ui:typecheck 实测成功（logs/ui-build.log、logs/ui-typecheck.log、logs/ui.exit-code），验证了构建后 HTTP 返回的资源字节与磁盘一致。该脚本会临时写 UI 探针并在 finally 恢复源码及构建，故运行于正式冻结回归之前；没有把探针期间的测试作为本快照最终证据。当前代码再次完整构建。

本轮未运行完整 Playwright UI 业务套件；构建/服务资源一致性不替代整批 I 票的浏览器验收。UPSTREAM.json 未变，vendor 本地适配记录在 INTEGRATION.md。
