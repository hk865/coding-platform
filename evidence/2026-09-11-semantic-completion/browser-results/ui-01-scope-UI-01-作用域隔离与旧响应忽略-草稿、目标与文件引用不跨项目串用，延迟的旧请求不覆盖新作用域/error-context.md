# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ui-01-scope.spec.ts >> UI-01 作用域隔离与旧响应忽略 >> 草稿、目标与文件引用不跨项目串用，延迟的旧请求不覆盖新作用域
- Location: src/ui/tests/ui-01-scope.spec.ts:5:3

# Error details

```
Error: page.waitForTimeout: Target page, context or browser has been closed
```

```
Error: write EPIPE
```