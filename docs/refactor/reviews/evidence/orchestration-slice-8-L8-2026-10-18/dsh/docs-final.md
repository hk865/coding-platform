Edited 7 files:

- `docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md`: header post-note + new §13（触发和驱动、请求记录/失败/重试、Host 关闭、映射、观测状态读、块范围、提醒、取消六点、读取次数、测试、已知限制、T 清单）。
- `docs/refactor/reviews/evidence/orchestration-slice-8-L8-2026-10-18/README.md`
- `.../lead-acceptance.md`
- `docs/refactor/STATUS.md`
- `docs/refactor/IMPLEMENTED-CAPABILITIES.md`（WG59）
- `docs/refactor/design/orchestration-2026-10/slices/README.md`
- `AGENTS.md`

Left for the lead: the commit and full-suite placeholders. `checks/merge-full-suite-summary.txt` is not in the material, so the suite numbers are `【lead 填】`.

Material contradictions:

1. `checks/merge-stat.txt` says production `−118`; the task says about `−119`.
2. `merge-stat.txt` says all insertions `8,580`, but production `2,111` + tests `6,468` = `8,579` (1-line gap).
3. `dsh/rework4-final.md` says P3 “done（RED → GREEN）”; `codex/verify4.out.md` says P3 partly and names the last await. `checks/lead-fix.diff` confirms the missing check; the drafts follow verify4 + the lead fix.
4. The read-through estimate is 850–1,100 lines; the construction book raises it to 1,000–1,300. The evidence README states both and compares the final +1,993 net against each.

No code, tests, builds, git writes or network calls.