# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ui-05-09-detail.spec.ts >> UI-09 重复提交与未知结果 >> 后端已提交但响应丢失：刷新后查询回执即可确认，不重复创建
- Location: src/ui/tests/ui-05-09-detail.spec.ts:112:3

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