# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: verification-rounds.spec.ts >> VR-01 工具验证轮次 >> 提交后丢响应保留请求，reload 查询原回执不重跑；源文件改变只把旧轮次标为过期
- Location: src/ui/tests/verification-rounds.spec.ts:94:3

# Error details

```
Error: browserType.launch: Executable doesn't exist at /home/han001/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell
╔════════════════════════════════════════════════════════════╗
║ Looks like Playwright was just installed or updated.       ║
║ Please run the following command to download new browsers: ║
║                                                            ║
║     npx playwright install                                 ║
║                                                            ║
║ <3 Playwright Team                                         ║
╚════════════════════════════════════════════════════════════╝
```