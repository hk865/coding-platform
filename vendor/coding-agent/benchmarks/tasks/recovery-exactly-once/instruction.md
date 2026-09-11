# 恢复时避免重复副作用

`src/recover.mjs` 在恢复 pending effects 时会重新执行已经出现在 `completedEffectIds`
中的 effect。修复 `effectsToReplay`，保持输入顺序，只返回尚未完成的 effect，且不要修改输入数组。

运行 `node test.mjs` 可执行公开测试。不要读取或修改 `.env`。
