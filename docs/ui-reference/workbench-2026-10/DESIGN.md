# DESIGN v2 — coding-platform 工作台 · "black / grey, calm" · revision 4

Catalog for every board agent. **Code:** `proto/project/kit.css`. **Reference board:** `proto/project/Main.dc.html` (when this file and Main disagree, Main wins — copy its markup and its logic methods).

Precedence: **BRIEF-V2B.md** (newest: hover info card, 当前工作 / 全部, ArchOverview) > **BRIEF-V2.md** (look, map shape, 信息隐藏在交互之中) > **BRIEF.md** (format rules, Q1–Q8, shared fake data, A.2 phrases, glossary) > this file > research notes (`v2/research/LOOK.md`, `TREE.md`, `SKILL-NOTES.md`).

v1 is content only. Its look (graphite + blue accent, glyph squares, chips, cards, flat square rows) was rejected and must not come back. The user approved the v2 look ("风格可以"). Revision 3 answered the critics of revision 2 (§14). **Revision 4** (BRIEF-V2B) replaces the small hover peek with the **hover info card** (§6.8) on every node of both maps, makes the right-panel 架构图 open in the **当前工作** focused view with a 当前工作 / 全部 switch (§7.7), adds the link 完整架构图 to the new board ArchOverview and documents that board's **layout pattern** (§7.8). §16 lists what changed. The previous files are kept in `proto/v2/prev/` (`Main.rev3.dc.html`, `DESIGN.rev3.md`).

---

## 0. The direction in five lines

1. **Black and grey.** Neutral greys (R=G=B), two grounds plus one surface, like VS Code Dark Modern, Codex, Claude Code and the user's DSH. No blue tint, no gradient, no texture.
2. **Colour only where a state exists.** Muted red, green, blue and yellow appear on squares, 6px dots, a state word and diff counts. Everything else on the screenshot reads greyscale.
3. **One bold element: a tree of squares joined by lines.** Each group is one branch; its children hang from the branch as squares on ticks. The lit path is the only "signature". The conversation, rail and buttons are as quiet as an editor.
4. **Few lines.** Lines go only between panes, around pop-overs and menus, and in the tree. Rows are list rows, not cards. Surfaces (`--surface`) only for things you act on: user bubble, plan card, conflict card, decision card, composer.
5. **Information lives in the interaction.** Default shows squares, names and one count. Hover (or keyboard focus) gives the **info card** — name, state and reason, 归属, 负责, 语义, counts or tasks; click gives the four-row detail; expand gives the steps. Density levels control how much of the chain of thought is shown. The architecture map shows only the current work by default (当前工作); the whole tree is one switch away (全部), the layered overview one link away (完整架构图).

---

## 1. Board skeleton (copy exactly)

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>成员页 · 直接干预</title>
<script src="./support.js"></script>
<link rel="stylesheet" href="./kit.css">
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&family=Noto+Sans+SC:wght@400;500&display=swap">
<style>
body { margin: 0; background: #1F1F1F; }
</style>
</helmet>
<div class="kit app {{rootMod}}">
  … nav.rail / main.main / aside.panel …
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"theme":{"editor":"enum","options":["dark","light"],"default":"dark"},"$preview":{"width":1440,"height":900}}'>
class Component extends DCLogic {
  constructor(...args) { super(...args); this.state = { theme: null }; }
  componentDidUpdate(prev) {
    if (prev && prev.theme !== this.props.theme && (this.state || {}).theme) this.setState({ theme: null });
  }
  renderVals() {
    const s = this.state || {};
    const theme = s.theme || this.props.theme || 'dark';
    return {
      rootMod: theme === 'light' ? 't-light' : '',
      themeLabel: theme === 'light' ? '切换到深色' : '切换到浅色',
      toggleTheme: () => this.setState({ theme: theme === 'light' ? 'dark' : 'light' })
    };
  }
}
</script>
</body>
</html>
```

Rules that bite (full list: BRIEF.md §Format and `format.md`):

- The root class is **interpolated**: `class="kit app {{rootMod}}"`, so `kit app` (tokens, grid) paints while values stream in. Never `class="{{rootCls}}"`.
- `class="kit app"` = full-screen shell (`height:100vh`, three columns, inner panes scroll). `class="kit"` + your own layout for anything else; `class="kit phone"` for the 390×844 phone board. Light theme = `t-light` on that same element. Never hard-code a colour; use the tokens.
- `{{hole}}` is a dotted lookup only. Compute every class string, label and list in `renderVals()`. `<sc-if value hint-placeholder-val>` and `<sc-for list as hint-placeholder-count>` always carry their hint attributes; both are `display: contents` in the kit.
- **Style holes:** only interpolated, never a whole-value `style="{{x}}"`. Only the hover card's position uses one: `style="left: clamp(0px, {{card.x}}px, calc(100% - 272px)); top: {{card.top}}; bottom: {{card.bottom}};"` (`top` / `bottom` are `'123px'`, `'auto'` or `'calc(100% - 123px)'`). ArchOverview may also place its nodes and edges with interpolated `left` / `top` / `width` (§7.8). The relation connector is an SVG `d="{{rel.d}}"` attribute (a whole-value string attribute, not a style).
- Fixed copy (names, conversation text) is literal markup unless it is genuinely state-driven data (Main's plan versions, queue items, conflict choice and log lines are data because the user's clicks change them).
- Clickable things are `<button type="button">` or `<a href>`. Icon-only buttons get `aria-label` and `title`. `<input>` / `<textarea>` are paired with a `<label>` (a `.sr-only` one is fine). A button that does nothing yet is not drawn (Main dropped 切换项目, 新建目标, 设置 and 附加文件 rather than show dead controls).
- Links to other boards only when that board exists in `canvas.json` (all ten do since the consistency pass, §17). Main's links: 完整架构图 → ArchOverview (架构图 scope line), 整页查看 → TaskMap (任务图 tools row), 调整顺序 → Goals (rail 目标 label), 看工作记录 → Chain (执行者 · 状态机's row), 打开成员页 → Member (执行者 · 服务重构's row), 全部 → Decide (decision card head), 接着写目标卡和方案 → Plan (goal 2's thread after the conflict is decided). Every other desktop board links back with "‹ 返回工作台" (or its rail rows) to `Main.dc.html`; Done is a later moment of Main and the phone is its own device, so neither links back.
- Events: any JSX camelCase event as a whole-value hole — Main uses `onClick`, `onDoubleClick` (固定), `onContextMenu` (新标签打开), `onMouseEnter`/`onMouseLeave` (info card, relation connector), `onFocus`/`onBlur` (the same two for keyboard — **every button with `onMouseEnter` also has `onFocus`**), `onChange`, `onKeyDown` (search field only). No global key handlers, no timers.
- Close every element; SVG children as `<path …></path>`; void inputs as `<input … />`. No innerHTML, no emoji, no iframes.
- Tweaks: `theme` on every board plus at most one meaningful lever (Main: `scale` = `40 个任务` / `600 个任务`; 600 also switches the architecture map to about 20 000 files).

---

## 2. Tokens (kit.css §1)

All values are on `.kit`; `.kit.t-light` redefines the same names.

### 2.1 Neutrals

| Token | Dark | Light | Use |
|---|---|---|---|
| `--side` | `#181818` | `#F7F7F7` | rail, right panel (VS Code side bar / Codex ground) |
| `--ground` | `#1F1F1F` | `#FFFFFF` | conversation, centre header |
| `--surface` | `#262626` | `#F4F4F4` | in-flow surfaces you act on: bubble, plan / conflict card, decision card, composer, inline code, step detail |
| `--raised` | `#262626` | `#FFFFFF` | floating: hover info card, menus (always with `--shadow-pop` and a 1px `--line` ring) |
| `--hover` / `--active` | `#2A2A2A` / `#2E2E2E` | `#EFEFEF` / `#E8E8E8` | row hover / selected row or option |
| `--line` | `#2B2B2B` | `#E5E5E5` | pane dividers, pop-over ring, ledger rules |
| `--line-2` | `#3A3A3A` | `#D4D4D4` | secondary button edge (`.btn-line`), the composer quote's left hairline |
| `--tree` | `#4A4A4A` (2.0:1 on side) | `#C0C0C0` | tree connector lines |
| `--lit` | `#CCCCCC` | `#3B3B3B` | lit path, selection ring |
| `--rel` | `#8F8F8F` | `#707070` | relation connector (drawn on demand) |
| `--text-strong` | `#E6E6E6` | `#1A1A1A` | titles, selected, names on the lit path |
| `--text` | `#CCCCCC` | `#3B3B3B` | body, conversation prose |
| `--text-2` | `#A3A3A3` | `#5E5E5E` | secondary, tree labels, step verbs |
| `--text-3` | `#8F8F8F` | `#6B6B6B` | meta, counts, labels (≥ 4.5:1 on side, ground and surface; on a selected row use `--text-2`) |
| `--text-4` | `#5C5C5C` | `#B5B5B5` | decoration only (separators); never carries text |
| `--ink` / `--ink-text` | `#E6E6E6` / `#181818` | `#1F1F1F` / `#FFFFFF` | the one accent: primary button, send button. Ink, not a hue — blue is reserved for 执行中 |

### 2.2 State colours (muted red, green, blue, yellow + grey)

Each colour has a full `--X`, half `--X-half` (45 % over `--side`; dark red 40 %, light red 36 %, light yellow 32 %), faded `--X-faded` (18 %) and a text colour `--X-text` (≥ 4.5:1) for state words. Numbers come from `v2/sketch/v3-palette.mjs` (OKLab L, contrast, Machado 2009 deutan / protan simulation, ΔE×100).

| | full | half | faded | text |
|---|---|---|---|---|
| green (dark) | `#4A6F62` L51 | `#2F3F39` | `#212825` | `#85C2AC` |
| blue | `#6A9DD1` L68 | `#3D546B` | `#273039` | `#88B6E6` |
| yellow | `#E8C275` L83 | `#766542` | `#3D3729` | `#EDC980` |
| red | `#E27A6F` L69 | `#693F3B` | `#3C2A28` | `#EC8C82` |
| grey | `#5B5B5B` | `#3A3A3A` | `#2C2C2C` | = `--text-3` |
| green (light) | `#77AB95` L70 | `#BDD5CB` | `#E0E9E5` | `#2B7351` |
| blue | `#437AB6` | `#A6BFDA` | `#D7E1EB` | `#2E65A0` |
| yellow | `#B9842B` | `#E3D2B6` | `#ECE2D2` | `#8A5F18` |
| red | `#B0423B` L53 | `#DDB6B3` | `#EAD6D5` | `#A43B35` |
| grey | `#B7B7B7` | `#D6D6D6` | `#E6E6E6` | = `--text-3` |

- **Done and failed differ in lightness**, not only hue. Dark: done green is the darkest full colour (L51), failed red the lightest of the pair (L69): ΔL 18, deutan ΔE 20.5, protan 11.2. Light: done L70, failed L53: ΔL 17, deutan 17.0, protan 26.1. In greyscale, failed reads lighter than done in dark and darker in light. Done also recedes, so 600 tasks are no longer a green wall.
- Other pairs (dark / light, deutan ΔE): blocked vs done 9.2 / 11.6; done vs verifying 9.2 / 10.9; blocked vs waiting 10.1 / about 6 (light half fills are close; the word in hover and detail carries it).
- **Group squares** use two extra green steps for the share of 已满足 (§4): `--done-2` (72 %: `#3C574D` / `#9BC0B0`) and `--done-1` (48 %: `#30423C` / `#BAD3C8`).
- **Untouched and shelved are told apart by shape, not only fill.** `s-none` (architecture: untouched by this goal) = `--empty` (`#1F1F1F` / `#F2F2F2`) with an inset 1px `--empty-line` hairline, like GitHub's empty cell. `s-deferred` / `s-cancelled` = flat `--grey-faded` (`#2C2C2C` / `#E6E6E6`), no hairline. `s-pending` = `--grey-half`, a step brighter.

### 2.3 Type, size, space, radius, motion

- **Fonts:** IBM Plex Sans + Noto Sans SC for all UI; IBM Plex Mono only for literal code (paths, commands, ids, raw JSON in 轨迹). Weights 400 and 500 only. Counts and times stay in the sans with `.num` (tabular-nums).
- **Sizes:** 12 (meta, labels, tree labels, steps' meta) · 13 (UI base: rows, buttons, steps, root label) · 14 (conversation prose, bubble, card titles, detail title) · 16 (rare page title). Nothing larger. Hierarchy comes from grey level, not size or bold.
- **Line height:** 13px UI → 20px; 14px prose → 24px (CJK needs it); `text-wrap: pretty` on prose and bubbles.
- **Spacing:** 4-px grid (4 / 8 / 12 / 16 / 24 / 32). Conversation blocks 22px apart; conversation column max 640px with 32px side padding (content 576px); dock column 576px.
- **Shell:** rail 232px, right panel 480px, centre fluid (728px at 1440); header 48px; panel tools 40px. Below 1240px: 208 / 420. Below 960px: single column (centre, panel, rail).
- **Radius by hierarchy:** 2px squares · 4–6px rows, buttons, inputs · 8px menus and pop-overs · 10px surfaces. No pills.
- **Shadow:** only `--shadow-pop`, only on floating things (pop-over, menu).
- **Motion (all responsive, none on load):** chevron rotate 120ms; decision card fades in 160ms; the hover info card waits 280ms, then fades in 160ms (a CSS animation delay, no timer; moving the pointer away before then shows nothing); a new plan version's changed lines get a background tint that fades over 1.6s; the expanded working member's live dot breathes (the one ambient motion). Squares never animate. `prefers-reduced-motion` zeroes the durations (the card still waits, then appears at once).

---

## 3. Layout (Main) — ASCII wireframe

```
┌ rail 232 (side) ─────┬ centre (ground) ──────────────────────────────────┬ panel 480 (side) ─────────────────────────┐
│ coding-platform      │ 状态机可靠性改造  秘书（主对话）  方案确认后自动    │ 任务图  架构图                              │
│                      │                          对话  轨迹   标准⌄   ▯   │ 树  大纲   ⌕ 查找任务                  图例 │
│ ■ 需要你决定      2  │                                                    │ ■ 状态机可靠性改造 15/40 已满足             │
│ ■ 请知悉          2  │  ↻ 系统自动重新入队（1/3）：启动核对…        14:02  │ ├─■─┬──┬──┬──┐  规格与验收 4/4             │
│                      │                       ┌──────────────────────────┐ │ │   ■  ■  ■  ■                            │
│ 目标                 │                       │ 检查链第 2 轮怎么卡住了？… │ │ ├─■─┬──┬──┬──┬──┬──┬──┐  写入收口 7/7      │
│ 1 状态机可靠性改造 1■ │                       └──────────────────────────┘ │ │   ■  ■  ■  ■  ■  ■  ■                  │
│ 2 工作台界面改版   1■ │  › 用时 4 分，已读取 6 个文件、编辑 2 个文件…       │ …                                          │
│   与目标 1 冲突      │  第 2 轮停在类型检查：… [■检查链与重新检查] …      │ └─□─┬──┬──┬──┬──┬──┬──┐  以后再做 0/7      │
│ 3 WorkGraph 拆分   □ │  ┌ 方案 · 第 1 版  检查与返工，涉及 2 个任务  未采用 ┐ │     □  □  ▪  □  ▪  □  □                  │
│   等目标 1 完成      │  │ ◉ A 只重跑没通过的检查项  推荐       约 40 分钟 │ │ ──────────── (after a click) ────────────── │
│ 成员                 │  │ ○ B 整轮重跑，但并行执行            约 20 分钟  │ │ ■ 检查链与重新检查                       ×  │
│ ○ 秘书（主对话） 待命│  │ 采用后自动执行…   在对话里修改  [采用方案 A]    │ │ 受阻：检查不完整，…                         │
│ ● 执行者 · 状态机 工作中│└────────────────────────────────────────────────┘ │ 路径/归属 · 负责的 Agent · 语义 · 关系        │
│ ● 架构参谋     等回复│  ■ 运行中 2 位成员工作中 ■ 需要你决定 1 15/40 ‖ □   │ 在对话里问  进入这一层  新标签打开  固定     │
│ ◐                    │  ┌ 问秘书，或说出你要做的事… ─────────── (↑) ┐      │                                            │
└──────────────────────┴────────────────────────────────────────────────────┴────────────────────────────────────────────┘
```

Three panes like the user's own tools. The goal bar sits directly above the composer; a decision card replaces the composer (never stacks on top of it). Clicking a goal in the rail switches the whole board to that goal: header, thread, goal bar, task map and the architecture map's states (Q2: one thread per goal).

---

## 4. State vocabulary (squares, dots, words)

Every task (or file) has exactly one main state. **State = colour + fill level; nothing is drawn inside a square** — no `!`, `×`, bars, rings, corner dots or diamonds. Attempts, gates and reasons go to the hover info card and the detail.

| class | 词 (hover / detail) | colour · fill | family meaning |
|---|---|---|---|
| `s-decide` | 需要你决定 | yellow · full | your turn (brightest) |
| `s-waiting` | 已暂停，可继续 (task) · 请知悉 / 等回复 / 已暂停 (rail) | yellow · half | waiting, FYI |
| `s-failed` | 失败 | red · full | went wrong (lighter than done) |
| `s-blocked` | 受阻（含检查不完整） | red · half | went wrong, can continue |
| `s-running` | 执行中 | blue · full | in motion |
| `s-verifying` | 验证中 | blue · half | in motion, being checked |
| `s-claimable` | 可领取 | blue · outline (1.5px inset ring) | ready to start |
| `s-satisfied` | 已满足 | green · full | done and passed (recedes) |
| `s-pending` | 待执行 | grey · half | planned, not ready — **superseded by §21.2**: a task that has not started is hollow (`s-notyet` dashes); `s-pending` stays for a group with nothing done and a goal 规划中 |
| `s-future` | 未来意图 | grey · outline | intent only |
| `s-deferred` / `s-cancelled` | 已延后 / 已取消（目标已取消） | grey · faded, flat | shelved (almost nothing) |
| `s-none` | 本目标未改动 | empty cell + hairline | architecture only |
| `s-done-2` / `s-done-1` | (group squares only) | green · 72 % / 48 % | share of 已满足 in a group |
| `s-idle` | 待命 | grey · outline | member dot only |
| — | 已取消 / 已替代 tasks of a running goal | not drawn | counted in the detail only |

**Group squares — one rule, three cases** (Main: `taskSq`, `archSq`):

- **A goal's root square = the goal's own state** — the same square the rail and the goal bar show: 运行中 `s-running`, 已暂停，可继续 `s-waiting`, 已取消 `s-cancelled`, 规划中 `s-pending`, 等待中 `s-future`.
- **A group whose children are drawn** (a branch row with its comb, an opened row, an outline row that is open) is **neutral**: the task map shows its **share of 已满足** (all → `s-satisfied`, ≥ half → `s-done-2`, some → `s-done-1`, none → `s-pending`, or `s-future` when everything is intent); the architecture map shows `s-pending` if this goal touches anything inside, otherwise `s-none`. Its children already show the state, so the group doesn't repeat it.
- **A folded group** (a square inside its parent's comb, a collapsed outline row, a quiet sibling row, the detail head) shows its **most urgent active descendant** (需要你决定 › 失败 › 受阻 › 执行中 › 验证中 › 已暂停 › 可领取); with none active, the share of 已满足 as above (architecture: the most urgent of everything, so a folder of done files is green and an untouched folder is empty).

This puts 需要你决定 yellow only on the inbox row, the goal bar's count, the task itself and any folded group that really hides one. The rail shows each goal's own state square plus a quiet count of its open decisions.

- **State words** use `.tx-<key>` (the `--X-text` colours); grey states use `--text-3`; group count lines use `.tx-plain`. Prose never colours or bolds a state word.
- **Member dots** (6px): `dot s-running` 工作中, `dot s-waiting` 等回复 / 已暂停, `dot s-idle` 待命. After 取消目标 the two executors show 待命.
- **Legend** lives behind the 图例 toggle (never permanently on screen) and also explains the group-square rule.
- Sizes: tree squares 14px (root 16px) in 树, 12px (root 14px) in 大纲; `.z10` (rail, goal bar, legend), `.z8` (inside text: refs, detail relations, search results, outline strips, fold rows).

---

## 5. 信息隐藏在交互之中 — what is visible when

| Element | Default (标准) | Hover | Click | Expand / density |
|---|---|---|---|---|
| Leaf square or row (task, file) | square on its tick, or a named row | **info card** (§6.8): name, state word + reason, 归属, 负责, 语义, for a file the tasks that change it, a hint line | select: path lights, rest fades, detail opens below; click again clears | double-click = 固定; right-click = 新标签打开 |
| Group branch or row (stage, batch, module, folder) | square, its children's squares on the branch, then name + n/m | **info card** with the group's count line (share + what needs you / moves); chevron appears next to the label if it can open | folded (children are groups): **opens and selects in one click**; open + selected: closes; leaf children: select / clear | 进入这一层 = drill (crumbs go back) |
| Folded group square inside a comb | square in its most urgent colour | info card with its count line | opens its parent and selects it | — |
| 架构图 scope | **当前工作**: only the paths to the files being worked on; the rest of each level as compact squares + one summary | info card on every square and row, also the compact ones | a compact square: its path is drawn and it is selected; again: back onto the branch | 全部 = the whole tree (revision 3); 完整架构图 = the overview board |
| Detail panel | absent | — | 路径/归属 · 负责的 Agent · 语义 · 关系 (exactly four rows) | actions: 在对话里问 · 进入这一层 · 新标签打开 · 固定 / 取消固定 |
| Relation connector | absent | hover or focus a 依赖 / 后续 item in the detail: one curved line with an arrow end into the dependent square | — | — |
| Search | field only | — | hits keep full colour, everything else fades; up to 6 results listed under the field; Enter = first; × or Escape clears | groups open only when there are ≤ 12 hits |
| One execution (run) | one line: 用时 + what was done | time appears | opens steps (one line each) | 详细 opens by default; 完全展开 also shows each step's detail and both plan options' bodies |
| Thinking rows | inside an opened run | — | — | hidden at 简洁 |
| Plan option | title + 推荐 (quiet) + estimate; the selected option shows 做法 + 影响/预计/风险 | — | select option | 简洁 shows 做法 only |
| Old plan version | one line "已由第 2 版取代" | — | 展开 shows it read-only | — |
| Decision card | level, path, title, one sentence, actions | — | 详情 shows the facts (incl. one line per rework) | 1 / n + next |
| Member row | dot + name + status word | — | expands: live line, 负责 / 正在做 / 最近一步, 临时分支问一问（只读） | — |
| Goal row | number + name + quiet decision count + own state square; a second line only when off-normal | title | switches the board to that goal | — |
| Stage owner in the tree | hidden | in the info card / detail | — | shown at 详细 / 完全展开 |
| Times | hidden on messages and runs | shown | — | system lines show their time |
| Ids, enums, raw records | never in the main UI | — | — | 轨迹 tab only (the density button is hidden there) |

---

## 6. Component catalog (kit.css sections in brackets)

Icons are inline stroke SVG, 16-unit viewBox, `class="ico sm"` (14px) or `ico xs` (12px); paths in §9.

### 6.1 Shell [§5]
`div.kit.app` > `nav.rail` + `main.main` + `aside.panel`. `.app.no-panel` hides the panel (header toggle). Rail and panel are `--side`; centre is `--ground`; one `--line` between panes.

### 6.2 Rail [§6]
```html
<nav class="rail" aria-label="项目、目标与成员">
  <div class="proj"><span class="ellipsis">coding-platform</span></div>
  <div class="rail-sec"> 需要你决定 2 / 请知悉 2 rows (row-lead square z10) </div>
  <div class="rail-sec">
    <div class="rail-label"><span>目标</span></div>
    <button class="row is-on" type="button" aria-current="true"><span class="row-ord">1</span><span class="row-main"><span class="row-name">状态机可靠性改造</span></span><span class="row-meta">1</span><span class="sq z10 s-running"></span></button>
    <button class="row" type="button"><span class="row-ord">2</span><span class="row-main"><span class="row-name">工作台界面改版</span><span class="row-sub">与目标 1 冲突</span></span><span class="row-meta">1</span><span class="sq z10 s-pending"></span></button>
  </div>
  <div class="rail-sec">
    <div class="rail-label"><span>成员</span></div>
    <button class="row is-current" type="button"><span class="row-lead"><span class="dot s-idle"></span></span><span class="row-name">秘书（主对话）</span><span class="row-meta">待命</span></button>
    <button class="row" type="button" aria-expanded="true">… 执行者 · 状态机 … 工作中</button>
    <div class="row-more">
      <span class="live"><span class="dot s-running"></span>正在运行命令：状态机单元测试</span>
      <dl class="kv stack"><dt>负责</dt><dd>…</dd><dt>正在做</dt><dd>…</dd><dt>最近一步</dt><dd>…</dd></dl>
      <div class="acts"><button class="btn btn-sm" type="button">[branch] 临时分支问一问（只读）</button></div>
    </div>
  </div>
  <div class="rail-foot">[theme]</div>
</nav>
```
- `.row.is-on` = the open goal (one per rail). `.row.is-current` = the conversation you are in (text only, no background).
- The goal row's count (`.row-meta`) is the number of open 需要你决定 items of that goal; the square is the goal's own state (§4).
- 临时分支问一问（只读） stays on Main as an in-board action: the composer gets a `.composer-to` line "发给：执行者 · 状态机 · 临时分支（只读） ×", and the answer comes back in the thread with a `.msg-from` line. The full member page (Q6: 临时分支 | 直接干预 chooser, delivery states) is `Member.dc.html` (执行者 · 服务重构), reached from that member's row (打开成员页); 执行者 · 状态机's row opens its work record `Chain.dc.html` (看工作记录); the goal-order page is `Goals.dc.html` (调整顺序 on the 目标 label). Links are `<a class="btn btn-sm">` in `.row-more .acts`, or `.btn-text.plink` in a label.

### 6.3 Centre header, tabs, menu [§4, §7]
```html
<header class="head">
  <span class="head-title">{{headTitle}}</span><span class="head-sub">秘书（主对话）</span><span class="head-sub" title="…">方案确认后自动</span>
  <span class="sp"></span>
  <div class="tabs" role="tablist"><button class="tab is-on" role="tab">对话</button><button class="tab" role="tab">轨迹</button></div>
  <sc-if value="{{isChat}}" …><div class="menu-wrap">标准 ⌄ + .menu</div></sc-if>
  <button class="btn btn-icon btn-sm" aria-label="显示或隐藏右栏">[panel]</button>
</header>
```
`.tab` quiet text tab; `.seg` / `.seg-btn` quiet text switch (树 / 大纲, 图例; never wraps); `.mode` / `.mode-btn` the one boxed switch, for the member page's chooser.

### 6.4 Conversation [§8]
As revision 2: `.sys-line`, `.msg-user` + `.bubble`, `.run` → `.steps` → `.step` → `.step-detail`, `.msg-agent` (+ optional `.msg-from` for a member's answer), `.ref` (inline link to a node), `.deliv`, `.attempt-sep`.

**轨迹 ledger = `.lg`, never a `<table>`.** The browser's HTML parser moves any `<sc-for>` / `<sc-if>` that sits inside `<table>` / `<tbody>` out in front of the table (foster parenting), so the runtime would get a broken template (found on Main, Member and Plan; `v2/sketch/consistency/parse-all.mjs` checks every board). Markup:
```html
<div class="lg" aria-label="原始记录列表">
  <div class="lg-row lg-th" aria-hidden="true"><span class="lg-c">时间</span><span class="lg-c">类型</span><span class="lg-c">编号</span><span class="lg-c">摘要</span></div>
  <sc-for list="{{rows}}" as="r" hint-placeholder-count="6">
    <div class="lg-row {{r.cls}}"><span class="lg-c num">{{r.t}}</span><span class="lg-c">{{r.type}}</span><span class="lg-c mono">{{r.id}}</span><span class="lg-c lg-w {{r.sumCls}}">{{r.sum}}</span></div>
  </sc-for>
</div>
```
Columns 76 · 68 · 100 · 1fr; only the 摘要 cell (`.lg-w`) wraps; `.is-on` marks the newest or selected row; a row that opens its raw record is a `<button class="lg-row">`; a section title between rows is `p.lg-head` (Chain). Chain also splits the 摘要 into path segments (`.lg-sum`) so a path breaks only after "/".

### 6.5 Plan card and conflict card [§9]
```html
<section class="plan">
  <div class="plan-head"><span class="ttl">方案 · 第 2 版</span><span class="scope">检查与返工，涉及 2 个任务</span><span class="st">未采用</span></div>
  <ul class="plan-delta">…</ul>
  <div class="opts" role="radiogroup">
    <div class="opt is-on"><button class="opt-top" role="radio"><span class="radio"></span><span class="opt-key">A</span><span class="opt-title">只重跑没通过的检查项</span><span class="opt-rec">推荐</span><span class="opt-est">约 35 分钟</span></button><div class="opt-body">…</div></div>
  </div>
  <div class="plan-foot"><span class="note">采用后自动执行；…</span><button class="btn">[chat] 在对话里修改</button><button class="btn btn-primary">采用方案 A</button></div>
</section>
```
- Every option shows its time in `.opt-est`; 推荐 is a quiet `.opt-rec` word after the title.
- **Flow (Main):** 在对话里修改 records *which* option you are changing (`iterating`, `iterKey`) and prefills the composer. Only that send makes 方案 · 第 2 版 (the change list names that option even if you click the other one meanwhile). Any other message gets an answer and leaves the plan alone ("方案先不动；要按这条改方案，点…在对话里修改"). Clearing the draft by hand drops the intent. 采用 → `.plan-line` "已采用方案 A（第 2 版）", a `.sys-line`, new tasks in the map.
- **Conflict card** (goal 2's thread, Q2): the same `.plan` with `.opts.no-key` (no letter column): 等目标 1 完成再开始 / 调到目标 1 前面 / 并行执行，接受冲突风险, each with one sentence. A conflict is a suggestion, never a gate (BRIEF-V2B 6e): the three choices are **equal** — no 推荐, nothing preselected, and 确定 stays `aria-disabled` (`.is-off`) until you pick one (its body opens on the pick). The secretary may still say which one it would take when you 问秘书 — that is an answer, not a default. Foot = 问秘书 · 在架构图里看 · 确定. After 确定 it folds to `.plan-line` "已选择：…". The overlapping files are computed (goal 2's files ∩ files of goal 1's unfinished tasks), so the card, the rail, the queue item and the architecture highlight always name the same files.

### 6.6 Dock: goal bar, composer, decision card [§10]
```html
<div class="goalbar">
  <span class="gb-state"><span class="sq z10 s-running"></span>运行中<span class="gb-why">2 位成员工作中</span></span>
  <button class="gb-decide"><span class="sq z8 s-decide"></span>需要你决定 1</button>
  <span class="gb-item">15/40 已满足</span>
  <span class="gb-acts">暂停 · 取消 (or 继续 · 取消, or 重新入队)</span>
</div>
<div class="composer">
  <div class="composer-to">[branch xs] 发给：执行者 · 状态机 · 临时分支（只读） [x]</div>   (only for a branch ask)
  <div class="composer-ref"><span class="sq z8 s-blocked"></span><span class="ellipsis">引用：检查链与重新检查，受阻</span>[x]</div>   (plain text-3, 1px left hairline, no fill)
  <label class="sr-only">…</label><textarea …></textarea>
  <div class="composer-foot"><button class="send" aria-label="发送">[send]</button></div>
</div>
```
- Goal bar = 状态 + 原因 + actions (A.2): 运行中 · 2 位成员工作中 / 已暂停，可继续 · 你在 14:15 暂停 / 已取消 · 记录保留，可重新入队 / 规划中 · 与目标 1 冲突，等你决定 / 等待中 · 等目标 1 完成. Cancelling asks first.
- 暂停 reaches the map (running and verifying squares → `s-waiting`, word 已暂停，可继续), the members (已暂停) and the root square. 取消 turns every unfinished task into `s-cancelled` (已取消), members to 待命, and removes goal 1's items from the queue until 重新入队.
- Decision card: one per queue item (两级: 要决定 / 请知悉), replaces the composer, 问秘书 on the left, one primary on the right — for the goal conflict the card carries the thread card's radio list (`.opts.no-key`, `dc.isChoice`, the same pick as the thread) and its primary 确定 stays `aria-disabled` until a pick (Main, Plan, Decide, Phone alike). The position "1 / 2" counts within the card's level and is hidden when the card is the only one of its level; on Main the head also carries a quiet 全部 link to `Decide.dc.html`. The path button goes to the task (switching goal if needed) or, for the goal conflict, to the architecture map with the overlapping files lit. 检查不完整判定's 详情 lists one line per rework ("第 2 次返工 · 系统自动 · lint 2 项，类型检查 1 项").

### 6.7 Right panel [§11]
```html
<aside class="panel">
  <div class="ptabs">任务图 · 架构图 · (extra closable tabs)</div>
  <div class="ptools"><div class="seg">树 · 大纲</div><label class="search">⌕ <input …/><span class="note">6 个文件，在 WorkGraph / state</span></label>[×]<button class="seg-btn">图例</button></div>
  <div class="qlist"><button class="qrow"><span class="sq z8 …"></span><span class="qname">verification-machine.ts</span><span class="qpath">WorkGraph / state</span></button> … <span class="qmore">其余 n 个在图里保持高亮</span></div>
  <div class="pscope">（架构图 only）<div class="seg">当前工作 · 全部</div><span class="note">正在处理 7 个文件，在 3 个模块</span><a class="btn-text plink" href="ArchOverview.dc.html">完整架构图 [open xs]</a></div>
  <div class="pbody"><nav class="crumbs">…</nav><div class="tree g-tree focus">… + .hcard</div><p class="pnote">(当前工作 with nothing to show)</p><div class="legend">…</div></div>
  <section class="detail">…</section>
</aside>
```
- 树 / 大纲 works on **both** maps (`view` for the task map, `aview` for the architecture map); on the architecture map 当前工作 / 全部 (`ascope`: `'work'` default, `'all'`) is a second, independent switch, so there are four combinations. `ascope` is a view preference: it survives goal switches and the scale tweak (it is not in `mapReset`).
- **Scope line** (`.pscope`, 28px, only on 架构图, between the search results and the body): the quiet `.seg` switch, a `.note` saying what 当前工作 shows ("正在处理 7 个文件，在 3 个模块"; no note in 全部), and the link 完整架构图 pushed right — an `<a href>` styled as a quiet text button (`.btn-text.plink` + the `open` icon), never a `<button>` inside an `<a>`. Titles explain both switch positions.
- The search note counts real matches and says where ("74 个，在 6 个阶段", "6 个文件，在 WorkGraph / state", "本层没有匹配" while drilled). Search covers only the current layer.
- `.detail.is-page` = the same detail as a whole tab (新标签打开 / right-click).
- **固定:** double-click a square or label, or 固定 in the detail. The detail head shows 已固定; when you select something else, a `.d-pins` line ("已固定 ■ 检查不完整判定 ■ 服务拆分") lets you jump back; with nothing selected the last pin's detail stays. × on a pinned detail unpins it. At most 3 pins per goal.

### 6.8 Hover info card [§11 `.hcard`] — every node, both maps, 树 and 大纲, also ArchOverview

Replaces revision 3's one-line peek (`.pop` is gone from kit.css). It answers "what is this, how is it, where does it live, who owns it, what is it for" without a click; the click detail (§7.6) still adds 关系 and the actions.

```
┌──────────────────────────────────────────┐   272px wide (max 100%), --raised, ring --line, --shadow-pop, radius 8
│ ■ 检查不完整判定                           │   z10 square in the node's colour + name 13px/500 --text-strong, one line
│ 需要你决定：自动返工已达上限（3/3），需要… │   state word in .tx-<state> + "：" + reason (--text-3); a group: its count line
│ 归属  检查与返工                           │   dl, 28px key column, keys --text-3, values --text-2, 12/18
│ 负责  执行者 · 状态机 · 工作中，第 4 次尝试 │
│ 语义  检查进程被打断或报告缺项时判为…      │   two lines at most (line clamp)
│ 任务  ▪ 检查轮次写入收口                    │   files only: up to 3 tasks with z8 squares + "另有 n 个任务"
│       ▪ 检查不完整判定                      │
│ 点一下看详情 · 双击固定 · 右键新标签打开     │   hint, --text-3: what a click does HERE
└──────────────────────────────────────────┘
```

**Content per node** (Main: `taskCard`, `archCard`, `cardCount`, `shortPath`, `cardHint`):

| node | head square | state line | 归属 | 负责 | extra |
|---|---|---|---|---|---|
| task | `s-<state>` | word (+（验收）) + "：" + reason | stage (600: stage / batch) | agent + member status + "第 n 次尝试"; 未分配(，等成员领取) | — |
| stage / batch | folded colour (§4) | **card count**: "1/7 已满足 · 需要你决定 1 · 受阻 1" | goal (or stage) | stage owner + status | — |
| goal (root) | the goal's own state | goal word + " · " + card count | — (row hidden) | 秘书 · 待命，另有 2 位成员工作中 | — |
| file | `s-<state>` or empty cell | 需要你决定 / … / 本目标未改动 | module / sub (/ folder …) | module owner + status | 任务: ≤ 3 tasks that change it |
| module / sub / folder | folded colour | "改动 16 / 40 个文件 · 需要你决定 1 · 受阻 1 · 执行中 2" | parent path | module owner + status | — |
| system | its folded colour | count line | — | 架构参谋 · 等回复 | — |

- **Card count** = the share (task map) or files changed (architecture) plus only the states that need you or move: 需要你决定, 失败, 受阻, 执行中, 验证中, 已暂停. Without any of those it falls back to the full count line ("全部已满足", "未来意图 5 · 已延后 2", "17,763 个文件，本目标未改动"). The detail keeps the full line.
- **归属** is the short crumb without the map root and without the node itself ("WorkGraph / state"); a first-level node shows the root's name.
- **Hint**: 点一下看详情 / 点一下展开 (a folded group) / 再点一次收起 (open and selected) / 再点一次取消选中 (selected leaf) / 点一下画出它的路径 (a compact square in 当前工作), then "· 双击固定 · 右键新标签打开".
- **Where** (`posMap` → `at`, `cardPos`): the card never covers the hovered square or its row. A row (branch square, label, named row): the card opens 6px **below the row**, its left edge 4px left of the row's square. A square on a comb: 6px below that square, 8px left of it. When the anchor is in the last ~190px of a tree taller than 520px (and there is room above), it opens **above** instead (`bottom: calc(100% - top)`). Horizontally it is clamped inside the tree with `clamp(0px, x, calc(100% - 272px))`.
- **When**: `onMouseEnter` and `onFocus` set `state.hover` on every square button, comb square, label button and named-row button (fold rows "已满足 5 项" and rest rows have none); `onMouseLeave` / `onBlur` clear it. The card appears after the 280ms animation delay, never takes the pointer (`pointer-events: none`), and a click clears `hover` — so it disappears when the detail opens. Labels and named rows carry **no `title`** (the card would be doubled by a native tooltip); comb squares keep `aria-label` (the screen-reader version of the card's first lines), the card itself is `role="tooltip"`.
- Markup (Main, verbatim):
```html
<sc-if value="{{card.show}}" hint-placeholder-val="{{ false }}">
  <div class="hcard" style="left: clamp(0px, {{card.x}}px, calc(100% - 272px)); top: {{card.top}}; bottom: {{card.bottom}};" role="tooltip">
    <div class="hc-head"><span class="{{card.sq}}" aria-hidden="true"></span><span class="hc-name">{{card.name}}</span></div>
    <p class="hc-state"><span class="{{card.tx}}">{{card.word}}</span>{{card.why}}</p>
    <dl class="hc-dl">
      <sc-if value="{{card.hasPath}}" hint-placeholder-val="{{ true }}"><dt>归属</dt><dd>{{card.path}}</dd></sc-if>
      <dt>负责</dt><dd>{{card.agent}}</dd>
      <sc-if value="{{card.hasSem}}" hint-placeholder-val="{{ true }}"><dt>语义</dt><dd class="hc-sem">{{card.sem}}</dd></sc-if>
      <sc-if value="{{card.hasTasks}}" hint-placeholder-val="{{ false }}"><dt>任务</dt><dd><span class="hc-items">
        <sc-for list="{{card.tasks}}" as="ct" hint-placeholder-count="2"><span class="hc-item"><span class="{{ct.sq}}" aria-hidden="true"></span>{{ct.name}}</span></sc-for>
        <sc-if value="{{card.hasMore}}" hint-placeholder-val="{{ false }}"><span class="hc-more">{{card.more}}</span></sc-if>
      </span></dd></sc-if>
    </dl>
    <p class="hc-hint">{{card.hint}}</p>
  </div>
</sc-if>
```
- Data: `card = { show, x, top, bottom, sq: 'sq z10 s-decide', name, word, tx, why /* with its "：" or " · " */, path, hasPath, agent, sem, hasSem, tasks: [{ name, sq }], hasTasks, more, hasMore, hint }`; when nothing is hovered every field still exists (`noCard`).
- **Other boards**: TaskMap reuses it as is. ArchOverview opens it **beside** its node (8px right of the node box, flipped to the left near the right edge, top aligned with the node), same content; an edge's count label gets a small card too (§7.8). The phone board has no hover: it shows the same fields in its tap sheet.

---

## 7. Tree of squares — both maps (kit.css §12, Main's engine)

### 7.1 Shape
**树 = branches.** Root top-left; every group is one row: its square sits on the trunk (gutter + elbow), a short stub leaves the square, and the group's children hang from that horizontal branch **as squares on ticks** (a comb); the name and n/m trail the branch in 12px. An **opened** group's children become rows below it (each again a branch). Squares and lines are the primary marks; names are quiet.

- **≤ 12 children per comb, always.** Larger groups get a middle level so no row wraps:
  - task map at 600: goal → 10 stages → **batches** of ≤ 12 tasks (named after their subject, e.g. 消息, 证据; 3–7 per stage) → tasks. Default: every stage's batches on its comb (≈ 10 rows × ≤ 7 squares).
  - architecture at about 20 000 files: system → modules → submodules → folders → files, every synthetic level bucketed to ≤ 12 (vendor: 140 packages in 12 named buckets "packages/agent-*", each package → ≤ 12 folders → ≤ 12 files). 进入这一层 reaches files at any scale.
- **Leaf rows with names** when the current root's children are leaves (drilled into a stage at 40, a batch, or a folder): each leaf is a named row (≤ 12 by construction).
- **Quiet siblings** (DOM budget): below depth 2, when one sibling is open, the other closed groups drop their combs and keep only their square (in its folded colour) and label.
- **大纲** = every node a named row (vertical explorer). Collapsed groups show a strip of ≤ 8 `.z8` child squares before the count (in flow, never over the name). In an opened group of leaves, runs of 已满足, of 未来意图 / 已延后, and of 未改动 fold into one row ("已满足 5 项", "未改动 9 个文件"); a click unfolds it. Active, pending, selected, related and hit leaves always stay as their own rows.

Measured DOM inside `.tree` (`build-static.mjs`): 40 tasks 183 (outline 320); 600 tasks 278, selected 575, drilled 321, outline 194 / selected 476; architecture 40: 147–336; about 20 000 files: root 261, vendor package selected 908, a file 4 levels down 1 013, folder 129, outline 338. All under the 1 500 budget.

### 7.2 Default open / closed
- The root is always open. The selection's ancestors open. Search hits' ancestors open only when there are ≤ 12 hits.
- The user's own open / close persists (`state.open` / `state.aopen`, shared by 树 and 大纲); the fold rows remember their unfolding (`state.ofold`).
- 树: everything below the root starts folded onto combs. 大纲 at 40 tasks: groups that hold active work start open; at 600 and in the architecture map they start closed.

### 7.3 Interaction
- **Click** a leaf → select (path gutter → elbow → stub → rail → tick turns `--lit`, a 1px `--lit` ring offset 2px on the square, the subtree, ancestors and related squares stay bright, everything else fades: rows .3, squares .22). Click again clears.
- **Click** a folded group (label or square) → it opens and is selected, one click. Click it again while open and selected → it closes. A folded group square inside a comb → its parent opens and it is selected. A chevron next to the label appears on row hover (rotated when open); the label button carries `aria-expanded`; the info card's hint says "点一下展开 / 再点一次收起" (no native `title`).
- **Double-click** → 固定 (§6.7). **Right-click** → 新标签打开 (the default context menu is suppressed only on squares and labels). The info card's hint line says so.
- **Hover or focus** any square, label or named row (树 and 大纲, both maps, the compact squares of 当前工作 too) → the info card (§6.8) below it, or above it near the end of the tree; a click hides it.
- **Relations:** no dependency lines by default. Related squares stay bright; the detail lists them. Hovering or focusing a 依赖 / 后续 item draws **one** curved connector with an arrow end into the dependent square (`dep → selected`, `selected → 后续`), computed in `renderVals()` as an SVG path (`relPath`). In 大纲 the curve runs on the left of the squares.
- **Search** marks by fill, never rings (§5).
- **Drill** = 进入这一层 in the detail (not offered for the current root). Crumbs above the tree go back. Selecting anything outside the drilled layer (a dependency in another stage, a search result, the conversation's link) leaves the drill; clicking a crumb above the architecture's drill root moves the root back so the detail stays.

### 7.4 Template (Main, verbatim)
```html
<div class="{{treeCls}}">
  <sc-for list="{{rows}}" as="r" hint-placeholder-count="10">
    <div class="{{r.cls}}">
      <sc-for list="{{r.gut}}" as="g" hint-placeholder-count="1"><span class="{{g.cls}}"></span></sc-for>
      <span class="{{r.elb}}"><i></i></span>
      <sc-if value="{{r.isBranch}}" hint-placeholder-val="{{ true }}">
        <button class="{{r.sqb}}" type="button" onClick="{{r.pick}}" onDoubleClick="{{r.pin}}" onContextMenu="{{r.tab}}" onMouseEnter="{{r.hover}}" onMouseLeave="{{unhover}}" onFocus="{{r.hover}}" onBlur="{{unhover}}" aria-label="{{r.tip}}"><span class="{{r.sq}}"></span></button>
        <sc-if value="{{r.hasComb}}" hint-placeholder-val="{{ true }}">
          <span class="{{r.combCls}}"><sc-for list="{{r.leaves}}" as="k" hint-placeholder-count="7">
            <button class="{{k.cls}}" type="button" onClick="{{k.pick}}" onDoubleClick="{{k.pin}}" onContextMenu="{{k.tab}}" onMouseEnter="{{k.hover}}" onMouseLeave="{{unhover}}" onFocus="{{k.hover}}" onBlur="{{unhover}}" aria-label="{{k.tip}}"><i></i><span class="{{k.sq}}"></span></button>
          </sc-for></span>
        </sc-if>
        <button class="{{r.lb}}" type="button" onClick="{{r.pick}}" onDoubleClick="{{r.pin}}" onContextMenu="{{r.tab}}" onMouseEnter="{{r.hover}}" onMouseLeave="{{unhover}}" onFocus="{{r.hover}}" onBlur="{{unhover}}" aria-expanded="{{r.ex}}">
          <span class="tr-name">{{r.name}}</span><span class="tr-n">{{r.a}}</span>
          <sc-if value="{{r.hasB}}" hint-placeholder-val="{{ false }}"><span class="tr-n">{{r.b}}</span></sc-if>
          <sc-if value="{{r.canOpen}}" hint-placeholder-val="{{ false }}"><svg class="ico xs tr-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4"></path></svg></sc-if>
        </button>
      </sc-if>
      <sc-if value="{{r.isLine}}" hint-placeholder-val="{{ false }}">
        <button class="{{r.nb}}" type="button" onClick="{{r.pick}}" onDoubleClick="{{r.pin}}" onContextMenu="{{r.tab}}" onMouseEnter="{{r.hover}}" onMouseLeave="{{unhover}}" onFocus="{{r.hover}}" onBlur="{{unhover}}" aria-expanded="{{r.ex}}" title="{{r.title}}">   <!-- title is null on node rows, set only on fold / rest rows -->
          <span class="{{r.nc}}"><span class="{{r.sq}}"></span></span><span class="tr-name">{{r.name}}</span>
          <sc-if value="{{r.hasWhy}}" hint-placeholder-val="{{ false }}"><span class="tr-why">{{r.why}}</span></sc-if>
          <sc-if value="{{r.canOpen}}" hint-placeholder-val="{{ false }}"><svg class="ico xs tr-chev" …></svg></sc-if>
        </button>
        <span class="tr-sum"><sc-if value="{{r.hasStrip}}" …><span class="strip">…</span></sc-if><span>{{r.b}}</span><span class="tr-a">{{r.a}}</span></span>
      </sc-if>
    </div>
  </sc-for>
  <sc-if value="{{rel.show}}" hint-placeholder-val="{{ false }}"><svg class="deps" aria-hidden="true"><path class="dl" d="{{rel.d}}"></path><path class="dl" d="{{rel.head}}"></path></svg></sc-if>
  <sc-if value="{{card.show}}" hint-placeholder-val="{{ false }}"><div class="hcard" style="left: clamp(0px, {{card.x}}px, calc(100% - 272px)); top: {{card.top}}; bottom: {{card.bottom}};" role="tooltip">… (§6.8)</div></sc-if>
</div>
<sc-if value="{{scope.empty}}" hint-placeholder-val="{{ false }}"><p class="pnote">现在没有执行中、需要你决定或失败的任务在改文件。切到“全部”看整棵树。</p></sc-if>
```
Comb leaves carry `aria-label` (no `title`), labels and node rows carry no `title`, so the info card is never doubled by a native tooltip. The connector is one transient path over the tree, not a diagram drawn as an `<svg>`; the tree itself stays separate elements.

### 7.5 `renderVals()` data shape
```js
treeCls: 'tree g-tree focus',             // 'tree g-outline outline' in 大纲; 'focus' while something is selected or searched
rows: [
  { isBranch: true, isLine: false, id: 'S4', type: 'comb',            // 'root' | 'comb' | 'plain' (opened group or quiet sibling)
    cls: 'tr br comb on',                 // + ' dim' | ' is-sel'
    gut: [{ cls: 'g v lit' }], elb: 'e mid in',                       // 'e none' for the root; ' thru' when a later sibling is lit
    sqb: 'nc branch blit is-sel',         // ' stem' (+ ' lit') when opened
    sq: 'sq s-done-1', hasComb: true, combCls: 'comb', mini: false,   // 当前工作: 'comb mini', mini: true (12px pitch, 8px squares)
    leaves: [{ id: 'T20', isGroup: false, cls: 'cc on is-sel', sq: 'sq s-blocked', tip: '…', pick, pin, tab, hover }],
    lb: 'tr-lb', name: '检查与返工', a: '1/7', b: '', hasB: false, canOpen: false, ex: null, tip, title, pick, pin, tab, hover },
  { isBranch: false, isLine: true, id: 'T15', cls: 'tr ln leaf is-sel', nb: 'nb is-sel', nc: 'nc', sq: 'sq s-failed', name: '启动核对',
    hasWhy: true, why: '执行失败，…', a: '', b: '', hasStrip: false, strip: [], canOpen: false, ex: null },
  { isLine: true, isFold: true, id: 'S4:idle', cls: 'tr ln fold', sq: 'sq s-future', name: '未来意图 2 项', canOpen: true, ex: false, pick }
  // 当前工作 大纲 adds rest rows: { isFold: true, id: 'WG:rest', name: '另 9 个子模块，30 个文件 · 受阻 1', hasStrip: true, strip: [≤ 8 z8 squares], b: '…' when more }
],
rel: { show: true, d: 'M58 175 C58 191.4 78 191.4 78 176', head: 'M74.5 181 L78 176 L81.5 181' },
card: { show: true, x: 74, top: '179px', bottom: 'auto', sq: 'sq z10 s-decide', name, word, tx: 'tx-decide', why: '：…', path, hasPath, agent, sem, hasSem, tasks, hasTasks, more, hasMore, hint },
scope: { show, isWork, isAll, workCls, allCls, toWork, toAll, note, hasNote, empty, isWorkShown },   // 架构图 only
unhover: fn
```
**Copy the engine from Main's class:** `finishTree` (aggregates `leaves`, `sat`, `touched`, `idle`, `cnt`, `worstAll`, `worstAct`), `focusSets`, `flatTree`, `flatOutline`, `focusTree` / `focusOutline` / `restLine` (当前工作), `posMap` / `posOf` / `relPath` / `cardPos`, `geo` / `rowGeo`, `crumbsOf`, `under`, `findUnder`, `doneShare` / `taskSq` / `archSq`, `countLine` / `cardCount`, the card builders `taskCard` / `archCard` / `shortPath` / `goalAgent` / `cardHint` / `fileSem`, plus the data methods `std40`, `big600`, `g2data`, `g3data`, `archData`, `synthDir` / `synthModule`, `taskModel`, `archModel` (now also `.work`, the working files), `overlap`, and the view builders `taskView`, `archView`, `taskDetail`, `archDetail`. They are plain classic JS without DOM; `cardOf` (in `renderVals`) joins a model, the row positions and a card builder.

| preset | column | square (leaf / root) | pitch | row heights (root / comb / plain / leaf row) | square centre |
|---|---|---|---|---|---|
| `.g-tree` (树) | 22px | 14 / 16 | 18px, tick 4, gap 2 | 34 / 36 / 30 / 28 | 17 / 11 / 15 / 14 |
| `.g-outline` (大纲) | 22px | 12 / 14 | — | 34 / – / – / 28 | 17 / 14 |
| `.comb.mini` (当前工作, inside `.g-tree`) | — | 8 | 12px, tick 4, gap 2 | (the row's) | (the row's mid) + 10 |

`geo()` (`miniPitch: 12, miniSq: 8`) and `rowGeo()` in Main must equal these numbers (they place the info card and the connector).

### 7.6 Detail (exactly four rows)
```html
<section class="detail" aria-label="节点详情">
  <div class="d-pins">已固定 <button class="d-item">■ 检查不完整判定</button></div>      (only when other pins exist)
  <div class="d-head"><span class="sq s-blocked"></span><span class="d-title ellipsis">检查链与重新检查</span><span class="d-pinned">已固定</span><button aria-label="关闭详情">[x]</button></div>
  <p class="d-state"><span class="tx-blocked">受阻</span>：检查不完整，第 2 轮的类型检查被 Host 重启打断</p>
  <dl class="d-dl">
    <dt>路径/归属</dt><dd>crumbs (buttons)</dd>
    <dt>负责的 Agent</dt><dd>执行者 · 状态机 · 工作中，第 2 次尝试</dd>
    <dt>语义</dt><dd>one sentence</dd>
    <dt>关系</dt><dd><div class="d-rel">依赖 / 后续 items · 文件 (path segments) · 返工 lines</div></dd>
  </dl>
  <div class="d-acts">在对话里问 · 进入这一层 · 新标签打开 · 固定</div>
</section>
```
- **Tasks:** state word + reason; 依赖 / 后续 (hover draws the connector); 文件; 返工 (one line per rework: 第 n 次 · 谁 · 哪类 · 原因).
- **Groups:** the state line is the compact count line ("1/7 已满足 · 需要你决定 1 · 受阻 1", "全部已满足", "未来意图 5 · 已延后 2"); the goal's line starts with its own state ("运行中 · 15/40 已满足 · …"). 语义 is one sentence per goal, stage and batch. 关系 = 阶段 (goal), 批次 (a stage at 600), or the active 任务 (≤ 8, "另有 n 个").
- **Architecture:** count line "改动 7 / 10 个文件 · 需要你决定 1 · …"; 任务 that touch it (≤ 8 + "另有 n 个任务", each a link into the task map of the same goal and scale); 依赖 of the module; 路径.
- **Paths** wrap only after a "/": each segment is a flex item in `.d-file` (full path in `title`).

### 7.7 架构图 · 当前工作 (focused view, the default) and 全部

The user: an architecture DAG has no size limit, so drawing all of it is a dead end; show **the paths to the nodes being worked on now plus their siblings**, hide the rest in the interaction, and keep the whole picture for 全部 and the overview (BRIEF-V2B 2a).

```
■ ┬─┬─┐ coding-platform  另 3 个模块，15 个文件，本目标未改动        ← root: the rest of its children as compact squares
│ ▫ ▫ ▫
├─■ ┬┬┬┬┬┬┬┬┐ WorkGraph  另 9 个子模块，30 个文件 · 受阻 1           ← a module on a path, its other subs on its branch
│ │ ▪▪▪▪▪▪▪▪▪
│ └─■ ┬┬┬┬┬┬┐ state  另 7 个文件
│   │ ▪▪▪▪▪▪▪
│   ├── ■ task-machine.ts                                            ← working files: the only full-size named leaves
│   ├── ■ attempt-machine.ts
│   └── ■ verification-machine.ts
├─■ ┬┬┬┐ AgentRuntime  另 4 个子模块，12 个文件 · 受阻 1
│ └─■ ┬┐ recovery  另 1 个文件，本目标未改动
│     └── ■ observation-recovery.ts
└─■ ┬┬┐ App（Host 与工作台）  另 2 个子模块，6 个文件
  └─■ host  3 个文件
      ├── ■ host.ts  ├── ■ server.ts  └── ■ attention-observer.ts
```

**What is drawn** (Main: `archView` → `focusTree` / `focusOutline`, `restLine`; `archModel().work`)
- **Targets**, all under the current drill root: the files changed by tasks of the current goal that are 执行中 (also 已暂停 after a pause), 需要你决定 or 失败; the selected node; search hits or the goal-conflict files when there are ≤ 12 of them. Everything on the way from the root to a target is **on a path**.
- **树**: every node on a path is a row (§7.1 geometry). A group row keeps its square on the trunk; its children on a path are rows below it (stem down); **the rest of its children hang from its own branch as compact squares** (`.comb.mini`: 8px squares, 12px pitch, same ticks, each in its folded colour §4, no names). Its label = name + **one summary of the rest**. A group with no rest shows its file count. Working files are named leaf rows with 14px squares — the eye lands on them.
- **Summary wording** (`restLine`): "另 n 个模块 / 子模块 / 文件夹 / 文件" + for groups "，m 个文件" + "，本目标未改动" when nothing in it changes for this goal + " · 需要你决定 k · 失败 k · 受阻 k" for what needs attention inside the rest. Without a path at that level the "另" is dropped.
- **大纲**: every node on a path is a named row; an opened path group ends with **one quiet rest row** (8px square in the rest's most urgent colour, the summary, a strip of ≤ 8 compact squares + "…"). A click lists the rest by name in their own order (`state.ofold['<id>:rest']`); a rest of one is listed directly. Listed groups are collapsed rows with strips; clicking one selects it, so it joins the paths.
- **Space**: one row per node on a path (about one row per level per path); the rest of a level costs no row of its own in 树. Measured: 40 tasks 14 rows / 228 elements; 600 tasks (≈ 20 000 files) 21 rows / 318 elements; 大纲 20 rows.
- **Empty** (goal 2 or 3 before work starts, a cancelled goal): the root row with every module on its comb, its summary without "另", and `.pnote` "现在没有执行中、需要你决定或失败的任务在改文件。切到“全部”看整棵树。"

**Interaction**
- Info card on every square, compact square, label and row; a compact square's hint is "点一下画出它的路径".
- Click a compact square → it is selected (detail opens), becomes a target, and its path is drawn as rows (its own children go onto its comb). Click its row again → deselected, back onto its parent's comb. Path rows do not fold (no chevron): click = select / clear.
- 进入这一层 recomputes the view under the new root; crumbs go back. Search with > 12 hits keeps the paths; the hits keep their colour and the compact squares that hide them stay bright, the rest fades. 在架构图里看 (goal 2) draws exactly the overlapping files. Pause keeps the paths; cancel empties them.
- `.pscope` note: "正在处理 n 个文件，在 m 个模块" (working files only, not the selection or hits).

**全部** = revision 3's tree (§7.1–7.3) unchanged: every module a branch with its subs on the comb, default folding, quiet siblings, fold rows.

### 7.8 ArchOverview (完整架构图) — layout pattern for the board agent

New page board `project/ArchOverview.dc.html` (`<title>完整架构图</title>`, 1440×900, `"expand": "fill"`, `"is_interactive": true`), reached from Main's 完整架构图 link. The **true top-down hierarchy with data-flow / dependency edges** the user wants for "一眼看出程序结构", with generous space (BRIEF-V2B 2b). Tweaks: `theme` + `scale` (same options as Main). Copy Main's data and model methods (`archData`, `synthDir` / `synthModule`, `taskModel`, `archModel`, `finishTree`, `archSq`, `countLine`, `cardCount`, `archCard`, `archDetail`, `fileSem`, `agentText`, `memberWords`, `words`) so squares, colours, counts and words match Main exactly; goal 1 is the goal shown (one quiet line in the header says so).

```
┌ header 48 (--side, line below) ──────────────────────────────────────────────────────────────────────────────┐
│ ‹ 返回工作台   完整架构图 · 状态机可靠性改造   coding-platform / WorkGraph            ⌕ 查找模块或文件   图例  ◐ │
├ canvas (--ground; scrolls inside) ──────────────────────────────────────────────────┬ detail 360 (--side) ──────┤
│ 入口   ┌ ■ App（Host 与工作台） 9 个文件 · 改动 6 ┐                                   │ nothing selected: three  │
│        │   ├┬┬┐ (its subs on a comb)              │                                   │ quiet lines on how to    │
│        └───────┬───────────────┬─────────────┬───┘                                   │ read the diagram         │
│                6               5             3 (side lane)                           │                          │
│ 编排   ┌ ■ Workflow 4 个文件 ┐   │             │                                       │ ■ WorkGraph           ×  │
│        └───┬──────────┬──────┘   │             │                                       │ 改动 16 / 40 个文件 · …  │
│            4          5          │             │                                       │ 路径/归属 · 负责的 Agent │
│ 执行   ┌ ■ AgentRuntime 14 个文件 ┐            │                                       │ 语义                     │
│        └───┬─────────────┬───────┘             │                                       │ 关系  依赖 → RecordStore 9│
│            7             3                     │                                       │       被依赖 ← AgentRuntime 7 │
│ 事实   ┌ ■ WorkGraph 40 个文件 · 改动 16 ┐ ◄─────┘                                       │       任务 ▪ …（≤ 8）     │
│        └───┬──────────────┬─────────────┘                                             │ 在对话里问 · 进入这一层   │
│            9              2                                                           │                          │
│ 基础   ┌ ■ RecordStore ┐  ┌ ■ WorkspaceTools ┐                                         │                          │
│ ─ 600 only ─ 支撑与冻结依赖：▫ tests  ▫ docs  ▫ vendor (nodes without edges) ─         │                          │
└───────────────────────────────────────────────────────────────────────────────────┴──────────────────────────┘
```

**Levels = zoom by drill-down** (breadcrumb `.crumbs` in the header goes back up; "‹ 返回工作台" is `<a href="Main.dc.html">`):
1. **System** (default): modules as nodes in **layers top → down by dependency**: layer(m) = 0 if nothing depends on m, else 1 + the deepest layer of a module that depends on it. Main's data gives App 0 · Workflow 1 · AgentRuntime 2 · WorkGraph 3 · RecordStore, WorkspaceTools 4. Each layer has a quiet name in a 72px left gutter (入口 / 编排 / 执行 / 事实 / 基础; data, 12px `--text-3`).
2. **Module** (click → 进入这一层, or click one of its comb squares): its submodules as nodes, layered the same way by the module's **internal** edges (the board adds a small table, e.g. WorkGraph: tasks → state 12, evidence → state 6, sessions → state 4, queries → tasks 3, communication → state 2, all → persistence). Edges that leave the module end at **ghost stubs** on the canvas border ("→ RecordStore 9", "AgentRuntime 7 →", `--text-3`, no box).
3. **Submodule**: only here do files appear, as Main's tree (`.tree.g-outline` rows, the same squares, ≤ 12 per level, Main's drill rules for synthetic folders), under the submodule's node head.

**Node** (`div.ov-node`, 208px wide, `--surface`, radius 10, no ring; content height ≈ 64–80px):
- `button.ov-head` (type button): z14 square in the folded colour (§4) + name (13px, `--text`; `--text-strong` when selected or lit) + count (12px `--text-3`: "40 个文件 · 改动 16"). Click = select / clear; hover / focus = info card.
- Below it the node's children **on a comb** (Main's `.comb` + `.cc`, 10px squares, 14px pitch, ≤ 12; set `--pitch:14px; --pcx:7px; --sqn:10px; --tick:4px; --gap:2px; --mid:0px` on the node's comb, the tree variables are not inherited here). Each comb square is its own button: hover = card of that child, click = drill into this node and select the child. A module "is" its branch, as in Main.
- Selected: 1px `--lit` outline offset 2px on the node. While something is selected or searched, nodes off the lit neighbourhood fade to .3 (as rows do in Main).

**Edge** (dependent → dependency; calls and data move along it; count = places it is used):
- One placed element per edge (`format.md`: a diagram is separate elements, never one `<svg>`): an absolutely placed `<svg class="ov-edge" aria-hidden="true">` per edge, sized to its own box, `d` computed in `renderVals()`. Orthogonal route: leave the source's bottom (several out-edges spread 16px apart along the bottom), drop 16px, turn with a 6px radius, run in the gap between layers, turn and enter the target's top (spread likewise), arrow head 3.5px into the target. An edge that skips a layer runs in a **side lane** beside the node column, never through a node.
- Stroke `--tree` 1px; lit `--lit`; faded .25. No colours per edge, no bundling, no animated flow.
- **Count label** on the longest straight segment: `button.ov-count` ("9", 12px tabular `--text-3`, `--ground` background with 2×4px padding so the line passes behind). Hover / focus = a small info card "WorkGraph → RecordStore · 9 处 · 读写记录正文与索引" (each edge carries one short "what flows" phrase in the data); click = select the edge: both ends and the edge light, the detail shows from / to / count / what flows.
- 图例 adds: "箭头指向被依赖的模块，调用和数据沿箭头走；数字是引用处数".

**Layout numbers** (canvas 1080 × 852 at 1440×900, padding 32): layer gutter 72; layer pitch = tallest node in the layer + 64 (room for turns and count labels); nodes of a layer centred, 40px apart; more than four nodes in a layer wrap to a second line of the same layer (nodes never shrink). Order within a layer by a single barycentre pass (average x of the nodes they connect to above), ties by name. Positions are data-driven, so nodes, edges and labels may use interpolated `left` / `top` / `width` style holes (§1).

**600 / ≈ 20 000 files**: tests, docs and vendor are outside the dependency graph; they sit in a quiet band under the last layer ("支撑与冻结依赖", a 1px `--line` rule above it) as nodes without edges. Drilling into vendor shows its 12 buckets, then packages, then files — Main's ≤ 12 rule at every level.

**Same vocabulary as Main**: squares and colours (§4), the info card (§6.8) opened **beside** the hovered element (8px right of it, flipped left in the right third of the canvas, top aligned, never covering it), the four-row detail (§7.6) in the right column with 关系 = 依赖 → (with counts), 被依赖 ← (with counts), 任务 that change it (≤ 8), path highlight (the selected node, its crumbs, its edges and neighbours lit; the rest fades), search (hits keep their fill, ≤ 6 results under the field, Enter / Escape). Actions in the detail: 在对话里问 is not on this board (no conversation here) — use 进入这一层 · 在工作台里看 (`<a href="Main.dc.html">`) instead. No dead buttons.

Classes: put them in the board's helmet first (`.ov` root, `.ov-bar` page header, `.ov-canvas`, `.ov-layer` gutter label, `.ov-node`, `.ov-head` node head button, `.ov-edge`, `.ov-count`, `.ov-band`), tokens only; the lead moves them into kit.css §13 after review.

---

## 8. Copy rules and glossary

- Plain Chinese in the main UI. Ids (T20, msg_8f21), enums and raw JSON only in 轨迹.
- Glossary: Goal = 目标 · Task = 任务 · Run = 一次执行 · Session = 工作记录 · Attempt = 第 n 次尝试 · gate = 验收 · Plan = 方案（第 n 版）· Check = 检查（正式检查，第 n 轮）. Task names and 语义 use the Chinese words too (目标展示名, not "Goal 展示名").
- Fixed A.2 phrases, verbatim: 系统自动重新入队（1/3） · 第 2 次尝试 · 接续 · 自动返工已达上限（3/3），需要你决定 · 已暂停，可继续 · 执行结果待核对 · 没有新依据，自动返工已停止 · 验收未通过，需要添加修复任务 · 等待推进. **Never write 恢复原执行**; a new execution after a stop is 接续.
- Failure classes, exactly five: 平台中断 / 已取消 / 检查未通过 / 执行失败 / 检查不完整. Operators: 人工 / 系统自动 / Agent.
- Queue levels: 要决定 / 请知悉. Member status words: 工作中 / 等回复 / 待命 / 已暂停 / 待核对. Message states: 已排队 → 已送达 → 已生效 / 被拒绝.
- Buttons start with the verb and the resulting status reuses it: 采用方案 A → 已采用方案 A（第 2 版）; 暂停 → 已暂停，可继续; 重新入队 → 已重新入队; 添加修复任务 → 已添加修复任务; 延后任务 → 已延后; 确定 (conflict) → 已选择：等目标 1 完成再开始.
- Separators: " · " only inside the fixed phrases, member names and count lines; elsewhere Chinese punctuation or layout gaps. " / " in paths and crumbs. Real minus in diffs (+46 −0).
- Results in words: 通过 / 未通过. Times 24-hour (14:06); durations 用时 4 分, 41 秒; dates 10-03.

## 9. Icons (inline stroke SVG; `<svg class="ico sm" viewBox="0 0 16 16" aria-hidden="true">…</svg>`)

chev `<path d="m6 4 4 4-4 4"></path>` · chev-down `<path d="m4 6 4 4 4-4"></path>` · think `<path d="M5.6 10.4A4 4 0 1 1 10.4 10.4c-.5.4-.65.9-.65 1.35v.5h-3.5v-.5c0-.45-.15-.95-.65-1.35Z"></path><path d="M6.6 14.25h2.8"></path>` · file `<path d="M4 1.75h5.25l3 3v9.5H4Z"></path><path d="M9 1.75V5h3.25"></path>` · edit `<path d="M10.75 2.75 13.25 5.25 6 12.5H3.5V10Z"></path><path d="M9.25 4.25l2.5 2.5"></path>` · cmd `<path d="M3 4.5 6.25 8 3 11.5"></path><path d="M8.25 11.75h4.75"></path>` · search `<circle cx="7" cy="7" r="4.25"></circle><path d="m10.25 10.25 3.25 3.25"></path>` · plan `<path d="M6.75 4.25h6.5M6.75 8h6.5M6.75 11.75h6.5"></path><path d="m2.5 4.25.9.9 1.6-1.65M2.5 8l.9.9L5 7.25M2.75 11.75h1.5"></path>` · check `<path d="m3.25 8.5 3 3 6.5-7"></path>` · requeue `<path d="M12.75 3.25v3h-3"></path><path d="M12.5 6.25A5 5 0 1 0 13 9.25"></path>` · chat `<path d="M2.75 3.25h10.5v7.25H8l-3 2.5v-2.5H2.75Z"></path>` · intervene `<path d="M2.75 3v4.5a2 2 0 0 0 2 2h8.5"></path><path d="m10.25 6.5 3 3-3 3"></path>` · branch `<circle cx="4.5" cy="3.75" r="1.5"></circle><circle cx="4.5" cy="12.25" r="1.5"></circle><circle cx="11.5" cy="4.75" r="1.5"></circle><path d="M4.5 5.25v5.5M11.5 6.25c0 3-7 2-7 4.5"></path>` · pause `<path d="M5.75 3.75v8.5M10.25 3.75v8.5"></path>` · play `<path d="M5.25 3.5v9l7-4.5Z"></path>` · stop `<rect x="4" y="4" width="8" height="8" rx="1.25"></rect>` · x `<path d="m4.5 4.5 7 7M11.5 4.5l-7 7"></path>` · plus `<path d="M8 3.25v9.5M3.25 8h9.5"></path>` · send `<path d="M8 12.75V3.5M4.25 7.25 8 3.5l3.75 3.75"></path>` · panel `<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.75"></rect><path d="M10 2.75v10.5"></path>` · theme `<circle cx="8" cy="8" r="5.25"></circle><path class="fill" d="M8 2.75a5.25 5.25 0 0 1 0 10.5Z"></path>` · settings `<path d="M2.5 4.75h6.5M12.25 4.75h1.25M2.5 11.25h1.25M7 11.25h6.5"></path><circle cx="10.6" cy="4.75" r="1.6"></circle><circle cx="5.4" cy="11.25" r="1.6"></circle>` · open `<path d="M9.25 2.75h4v4M13.25 2.75 7.75 8.25"></path><path d="M11.75 9.5v3.75h-9V4.25h3.75"></path>` · pin `<path d="M6 2.25h4l-.6 4.25 2.35 2.25H4.25L6.6 6.5Z"></path><path d="M8 8.75v5"></path>` · history `<path d="M2.75 8a5.25 5.25 0 1 0 1.6-3.8"></path><path d="M2.5 2.75v2.5H5"></path><path d="M8 5.25V8l2 1.25"></path>`.

No brand mark, no logo, no Claude spark, no clay accent.

## 10. Shared fake data

Canonical in Main's class:
- `std40()` — goal 1, 6 stages (each with a one-sentence 语义), 40 tasks; totals 已满足 15 · 执行中 2 · 验证中 1 · 失败 1 · 受阻 1 · 需要你决定 1 · 可领取 2 · 待执行 6 · 未来意图 9 · 已延后 2. 检查不完整判定, 执行事实读取迁移, 前端拆分 and 重新入队与失败类别 carry rework history (重新入队与失败类别: attempt 1 failed its check — lint 2 项，回放测试 1 项 — and the system requeued it; attempt 2 is 接续, as `Chain.dc.html` records). A reason never repeats the state word that leads it: 可领取's reason is 等成员领取 (never "依赖已满足，…", BRIEF-V2B 6a), 需要你决定's is 自动返工已达上限（3/3）, 已延后's is the cause or nothing. Copies of these methods on other boards stay identical (§17).
- `big600()` — goal 1 at the 600 scale: 10 stages → 53 batches of ≤ 12 → 600 tasks; the named tasks T13 T14 T15 T20 T21 T28 also exist in it; every fourth task names a real file, so the architecture map at 600 is built from the same tasks.
- `g2data()` — goal 2 工作台界面改版, 4 stages, 14 tasks, all 未来意图 (planning). `g3data()` — goal 3 WorkGraph 拆分, 4 stages, 13 tasks, all 未来意图 (waits for goal 1).
- `archData(big)` — 6 modules / 78 files; at 600 plus tests (412), docs (1 960) and vendor (140 packages, 17 763 files) = 20 213 files, generated by `synthDir` / `synthModule` with ≤ 12 children per node.
- `queue()` — q1 检查不完整判定 要决定 · q2 目标 2 冲突 要决定 (title and facts computed from `overlap()`) · q3 启动核对 请知悉 · q4 接续说明 请知悉. `planData()` — 方案 A/B, 第 1 / 第 2 版, deltas.
- Members, goals and the conversation text are in Main's markup and `renderVals()`. For the member page and the goal-order page, v1 `DESIGN.md §6` remains the content source.

## 11. Do / Don't (BRIEF-V2)

Do
- Black/grey neutral grounds, quiet grey text, ink primary button.
- Tree = squares joined by lines: one branch per group, children on ticks, ≤ 12 per comb, a middle level instead of wrapping.
- State = colour + fill level only; lightness separates done from failed; the word in hover / detail.
- Group squares: the goal's own state at the root, the share of 已满足 when the children are drawn, the most urgent child only when folded.
- Make every tab, view switch, goal row and toggle work and show real content.
- Give every node (square, compact square, label, named row, overview node and edge count) the info card on hover **and** keyboard focus.
- Draw the architecture's current work first (当前工作), keep the whole tree one switch away and the layered overview one link away.
- Show little by default; give details on hover, click, expand, density.
- Check every board by looking at a PNG (§12).

Don't
- No glyphs, attempt dots, gate diamonds, rings or bars inside squares; no rings on related squares (adjacent rings merge into a chain).
- No chips, pills, badges, filled quote tags, coloured status labels, cards for list items, left-border accents, gradients, glows, textures.
- No calendar blocks or rows of squares without lines (reads as "files", rejected twice); no row that wraps squares.
- No permanent dependency lines, no bus routing; one connector on demand.
- No blue accent for selection (blue = 执行中); no second accent.
- No permanent info panel, no permanent legend, no ids in the main UI, no dead buttons, no links to boards that do not exist.
- No native `title` on nodes (it doubles the info card), no card that covers the hovered square, no timers for the card's delay.
- No whole-architecture drawing in the right panel by default; no single `<svg>` for a diagram (ArchOverview edges are one element each).
- No entrance animations, no pulsing squares, no hover transitions on rows.

## 12. How to look at a board (no runtime available locally)

`v2/sketch/build-static.mjs` runs the board's own `renderVals()` under a stub `DCLogic`, fills the `{{holes}}`, `<sc-if>` and `<sc-for>` with those literal values and writes plain static HTML (no script). It also: writes `main-logic.check.js` for `node --check`; lints the format rules that can be read off the text (dotted holes, hint attributes, whole-value events, no whole-value style or root class, no forbidden APIs or dangling board links, typed buttons, no emoji); reports unknown holes, non-function handlers and handler errors (every reachable handler is called from every scenario); counts elements inside `.tree` per scenario; and runs scripted flows (plan iteration, one-click folding, drill + outside selection, crumbs above the drill root, 600-scale links, pause / cancel, goal switch + conflict, pin + right-click tab, relation connector, cancel-confirm, branch ask).

```
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu-24.04 --exec bash -lc 'cd /mnt/c/…/scratchpad/proto/v2/sketch && bash main-shoot.sh [name …] && node --check main-logic.check.js'
```
`main-shoot.sh` rebuilds and screenshots every scenario (Playwright 1.63, file://, 1440×900, DPR 1, nothing left running); `zoom-shoot.sh "<file> <name> x y w h"` takes 2× crops for checking line joins; `v3-palette.mjs` re-measures the palette. To check another board, copy `build-static.mjs`, change the board path and the `scenarios` list (each = props + state).

**Revision 4 harness** (current): `proto/v2/sketch/main/` — `build-static.mjs` (Main rev 4: 20 new `r4-*` scenarios before the revision-3 ones, which now pin `ascope: 'all'` where they show the architecture; extra lint: support.js + kit.css lines, `<a>` only to ArchOverview, every `onMouseEnter` button also has `onFocus`, no `setTimeout`; flows for the card, 当前工作, its 大纲 rest rows, pause / cancel and the 20 000-file scale), `shoot.sh` (build → `node --check main-logic.check.js` → screenshots into `proto/v2/shots/main/`), `zoom-shoot.sh`. The static sketches switch the card's appear delay off so a still picture shows it.
```
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu-24.04 --exec bash -lc 'cd /mnt/c/…/scratchpad/proto/v2/sketch/main && bash shoot.sh [name …]'
```
A board agent copies this folder to `sketch/<board>/`, points `build-static.mjs` at its board, and writes PNGs to `shots/<board>/`.

## 13. Board checklist

- [ ] Skeleton from §1, `lang="zh-CN"`, own 2–4 word `<title>`, support.js line exact, kit.css right after it, root class interpolated.
- [ ] `theme` tweak works (root `t-light`); at most one more lever.
- [ ] Only kit classes and tokens; any extra style lives in `<helmet><style>` and uses tokens; no whole-value style holes.
- [ ] Outside squares, dots, state words and diff counts the screenshot is greyscale.
- [ ] At most 4 font sizes, weights 400/500, mono only for code.
- [ ] Lines only between panes, around floating things and in the tree; surfaces only for bubble, plan / conflict card, decision, composer.
- [ ] Every square uses one `s-*` class; nothing inside it; group squares follow §4; anything 需要你决定 / 失败 / 受阻 is also reachable as words (queue, hover, detail).
- [ ] Goal bar (state + reason + actions) above the composer; a decision card replaces the composer and has 问秘书.
- [ ] Every tab / view / goal row / toggle works through `renderVals()` handlers; no dead buttons, no links to missing boards; `build-static.mjs` reports a clean lint, no unknown holes, no handler errors; `node --check` passes; tree DOM ≤ 1 500 in every scenario.
- [ ] Every node has the info card on hover and focus (§6.8); no `title` on node buttons; the card never covers the hovered square.
- [ ] Architecture views: 当前工作 by default, 全部 one switch away, 完整架构图 links to `ArchOverview.dc.html` (only once that board is in `canvas.json`).
- [ ] Looked at the PNGs in dark and light, at both scales; removed one accessory in the last pass.

---

## 14. Revision 3 — what each finding became

**User critic**

| # | Finding | Result |
|---|---|---|
| B1 | 600-task map was calendar blocks without lines; drill cut stages into meaningless rows of 12 | **Done.** Batch level (≤ 12, named); default = 10 stage branches with batch squares; open / drill = named batch branches with task combs; `.blk` and the wrap path are gone. |
| B2 | Large architecture map showed no structure; vendor a ghost grid; synthetic subs unreachable; no file names | **Done.** Every module's sub comb at the root (untouched ones as empty cells); vendor bucketed into 12 named buckets; every synthetic level ≤ 12 down to files; drilled folders list file names; 树 / 大纲 on the architecture map too. |
| B3 | Done green and failed red had the same lightness | **Done** with the critic's dark values (green `#4A6F62`, red `#E27A6F`, red text `#EC8C82`). Light: green `#77AB95` instead of the suggested `#8FBDA9`, because `#8FBDA9` sat at the same lightness as light 受阻 (deutan ΔE 2.3); red-half lightened to 36 % for the same reason. Half / faded re-derived. |
| M4 | 40-task 树 read as a file explorer; faint lines; same as 大纲 | **Done.** One branch per stage, children on ticks, quiet 12px trailing labels; `--tree` `#4A4A4A` / `#C0C0C0`; owner only at 详细 or in hover / detail. 14px squares, column 22px, pitch 18px (narrowed from the suggested 24 / 20 so labels still fit at depth 4 in the 480px panel). |
| M5 | Group squares took the most urgent child, contradicting the rail and goal bar | **Done** (§4). |
| M6 | Folding needed an unexplained second click | **Done.** One click opens + selects; again closes; hover chevron; `aria-expanded`; title hint. |
| M7 | Bus-routed dependency lines drew a box | **Done** for the lines: no default lines, one curved connector with an arrow on hover / focus of a 依赖 / 后续 item. **Rejected:** the 1px `--rel` ring on related squares — in a comb with an 18px pitch the rings of neighbours merge into a chain (seen in the first revision-3 PNG); brightness plus the connector carry the relation. |
| M8 | Goal rows 1 and 3 did nothing; links to missing boards | **Done.** Goal rows switch the board (goal 2: own thread + conflict card; goal 3: short thread + future-intent tree). Links to Member.dc.html / Goals.dc.html removed; 临时分支问一问（只读） works in place. |
| M9 | Pause did not reach the map | **Done** (§6.6). |
| M10 | 600 大纲 overlapped names and listed ~400 rows | **Done.** `.tr-sum` in flow, strip ≤ 8 before the count, folded runs, 600 closed by default (194 elements). |
| M11 | Search rings, wrong architecture count, no way to reach hidden hits | **Done.** Fill not rings, real counts with location, result list ≤ 6, Enter / Escape / ×. |
| M12 | Group 语义 was a list of counts | **Done.** One sentence per goal / stage / batch; counts moved to the compact state line. |
| m | Faded level invisible; untouched = deferred | **Done** (§2.2: hairline empty cell vs flat faded vs half). |
| m | Sub root read "10 个文件 10 个文件" | **Done** (labels now one count). |
| m | Ledger 类型 wrapped mid-word | **Done.** |
| m | Paths broke mid-name | **Done** (segments, break after "/"). |
| m | Conflict files disagreed (2 vs 3); conflict not on the architecture map | **Done** (computed overlap; 在架构图里看 lights the files). |
| m | Goal bar had no 原因 | **Done.** |
| m | No rework history | **Done** (detail 返工 rows, decision 详情). |
| m | Option A showed 推荐 instead of a time | **Done.** |
| m | Glossary leaks (Goal 展示名 …) | **Done.** |
| m | Double-click 固定 / right-click 新标签打开 missing | **Done** (§6.7, §7.3). |
| m | Filled quote pill; density button useless in 轨迹 | **Done.** |

**Format critic**

| Finding | Result |
|---|---|
| 600 大纲 broke the DOM budget (4 793 / 6 711) | **Done** — 194 default, 476 with a selection; largest scenario anywhere 1 013. |
| Selecting outside the drilled stage; search ignored the drill | **Done** — selection leaves the drill; search covers the current layer, "本层没有匹配". |
| Crumb above the architecture drill root closed the detail | **Done.** |
| 600-scale architecture linked to tasks that do not exist | **Done** — the architecture map is built from the same task model; links always resolve. |
| Plan iteration misfired (any message became v2; A/B mix-up; wrong reply) | **Done** — `iterating` + `iterKey`; replies chosen by state. |
| Whole-value root class | **Done** — `class="kit app {{rootMod}}"`. |
| Groups had no `aria-expanded` / hint | **Done.** |
| 进入这一层 offered for the current drill root | **Done.** |
| 隐藏依赖线 offered where no lines exist | **Done** — the toggle is gone with the default lines. |
| Pause / cancel didn't reach the board | **Done.** |
| "已满足：其中最紧急的一项" | **Done** — replaced by count lines. |
| Hidden composer while the cancel confirm is open | **Done** — every action that writes to the composer clears the confirm. |
| Four dead buttons; goal rows; aria-expanded on all goals; dangling links | **Done** — dead buttons removed, goal rows switch goals (`aria-current`), links removed. |
| q2 facts hard-coded at 600; `showBody` no-op | **Done** — computed; 完全展开 shows both options' bodies. |

**Last pass:** removed the four controls that did nothing (the 切换项目 chevron, the hover-only 新建目标, 设置, 附加文件) instead of adding notes to them; and dropped the related-square rings after seeing them in the PNG (§14, M7).

PNGs (`proto/v2/shots/`, from `proto/v2/sketch/main-static.html` and its per-state files): `main-default`, `main-task-sel`, `main-task-hover`, `main-outline`, `main-search`, `main-arch-root`, `main-arch-open`, `main-arch-wg`, `main-arch-search`, `main-light`, `main-light-outline`, `main-600`, `main-600-sel`, `main-600-drill`, `main-600-outline`, `main-600-outline-sel`, `main-600-search`, `main-600-light`, `main-600-arch`, `main-600-arch-ven`, `main-600-arch-deep`, `main-600-arch-folder`, `main-600-arch-outline`, `main-decision`, `main-round2`, `main-adopted`, `main-full`, `main-paused`, `main-goal2`, `main-goal2-arch`, `main-goal3`, `main-pinned`, `main-branch`, `main-trace`, `main-legend`; 2× crops `zoom-default`, `zoom-task-sel`, `zoom-600-arch-deep`, `zoom-legend`. Revision-2 PNGs without a revision-3 scenario moved to `v2/prev/shots-v2a/`; `critic-*` and `tree-*` in `shots/` are the critics' and the research pictures of revision 2, not the current board.

## 15. Runtime assumptions not verifiable locally

- `onMouseEnter` / `onMouseLeave` / `onFocus` / `onBlur` on buttons (info card, relation connector), `onDoubleClick` (固定) and `onContextMenu` with `e.preventDefault()` (新标签打开). If any is unsupported, the detail's 固定 / 新标签打开 actions and the click detail still carry everything. Interactions only run in the canvas **Play** mode — say so to reviewers.
- The SVG path `d="{{rel.d}}"` and the interpolated card style with CSS `clamp()` / `calc()` inside it (`left: clamp(0px, {{card.x}}px, calc(100% - 272px))`; the string has no `;` or `:` inside the values, so a declaration-splitting style parser keeps it whole).
- The card's appear delay is a CSS `animation-delay` with `both` fill; a card that stays mounted while the pointer moves to a neighbour does not wait again, one that remounts does (both are fine).
- `title={null}` on node rows (no attribute rendered).
- `<a href="ArchOverview.dc.html">` resolves only after the lead adds that board to `canvas.json`.
- Controlled `<textarea value="{{draft}}" onChange="{{onDraft}}">` and `<input type="search" value onChange onKeyDown>`; `placeholder="{{composerPh}}"`.
- `<sc-for>` with `hint-placeholder-count="0"` for initially empty lists (extra tabs, files, rework lines).
- The architecture model at the 600 scale holds about 22 000 plain objects; it is built once per goal and scale and cached on the instance (`_am`, now also with `.work`), the task models per goal (`_tm`).
All are standard React/JSX patterns allowed by `format.md`; the static harness checked that every hole and handler resolves.

## 16. Revision 4 (BRIEF-V2B) — what changed

| User point | Result |
|---|---|
| 1 鼠标停留要可以显示节点信息卡片 | **Done.** `.hcard` (§6.8) on every square, comb square, compact square, label and named row of both maps in 树 and 大纲 (revision 3 had a one-line peek on 树 squares only, none in 大纲). Content: name · state word + reason (groups: share + what needs you / moves) · 归属 · 负责 + status · 语义 (2 lines) · for files the tasks that change them · a hint saying what a click does there. Opens below the row (or above near the end of the tree), never over the hovered square; 280ms delay; keyboard focus shows it; a click hides it; node buttons lost their native `title`. |
| 2a 只展示当下的工作节点相关的路径+同级节点 | **Done.** 架构图 opens in 当前工作 (§7.7): paths from the root to the files changed by running / paused, needs-decision and failed tasks (+ selection, + ≤ 12 hits or the conflict files); each level's other nodes as compact squares on the branch with one summary ("另 3 个模块，15 个文件，本目标未改动", "· 受阻 1" when something there needs attention). 40 tasks: 14 rows; ≈ 20 000 files: 21 rows. Switch 当前工作 / 全部 (全部 = revision 3's tree), link 完整架构图. Works in 大纲 too (rest rows that list names on a click). |
| 2b 从上到下分级、数据流图、完整图留到 overview | **Specified** for the board agent (§7.8): layered top-down module diagram, dependency / data-flow edges with counts, drill-down (system → module → submodule → files), breadcrumb, same squares, card, detail and path highlight. Main links to it. |
| 3 给 agent 看 | Answered in chat (no board this round): the same model data — path, owner, state, semantics, relations, folded summaries — as a compact text tool with drill-down. |

Self-review changes after looking at the PNGs: the per-level summaries first said "改动 n 个" on every level — too many words; now only "本目标未改动" or the attention counts. The card's count line first repeated the detail's full line (eleven parts on the goal) — now share + moving / attention states only. The hint line wrapped — shortened to "右键新标签打开".

PNGs (`proto/v2/shots/main/`, from `proto/v2/sketch/main/*.html`): `r4-hover-task` (task square on a comb), `r4-hover-stage` (a stage label), `r4-hover-task-outline` (大纲 row), `r4-hover-task-low` (flips above), `r4-arch-work` (当前工作 default), `r4-arch-work-hover-mod` (module), `r4-arch-work-hover-mini` (compact square), `r4-arch-work-hover-file` (file with its tasks), `r4-arch-work-sel` (a compact square clicked: its path drawn), `r4-arch-work-outline` (大纲 + card), `r4-arch-all` (全部), `r4-arch-all-hover-mod`, `r4-arch-all-hover-file`, `r4-arch-work-light`, `r4-arch-work-600`, `r4-arch-work-600-hover`, `r4-arch-work-g2` (conflict files), `r4-arch-work-g3` (empty), `r4-arch-work-legend`, `r4-arch-work-search`, `main-default` (regression); 2× crops `zoom-arch-work`, `zoom-hover-task`.

## 17. Consistency pass over the ten boards (2026-10-05)

`canvas.json` lists all ten boards, every one `is_interactive`, the desktop ones `expand: fill`:

| row (title note, 300 px above) | y | boards (x 0 / 1520 / 3040, w 1440) |
|---|---|---|
| 对话与指挥 | 0 | Main 主画面 (900) · Plan 方案选择与迭代 (900) · Goals 目标顺序与冲突 (900) |
| 思维链、成员与决定 | 1320 | Chain 思维链 · 执行者 (1100) · Member 成员页 · 分支与干预 (900) · Decide 需要你决定 (900) |
| 看进度与架构 | 2840 | TaskMap 任务图 · 整页 (1000) · ArchOverview 完整架构图 (1000) |
| 完成与小屏 | 4260 | Done 完成与交付 (900) · Phone 手机 · 对话、待决与进度 (390 × 844, no `expand`) |

Each board's `$preview` equals its frame. Rows are 420 px apart below the tallest board of the row.

What the pass changed (checks in `v2/sketch/consistency/`: `parse-all.sh` = the raw boards parse as written, `links.mjs` = links and frames against `canvas.json`, `build-all.sh` = every board's own harness; backups in `v2/prev/pre-consistency/`: Main, Done, ArchOverview, Decide, Goals, Phone, TaskMap and canvas.json as they were before the pass; Chain, Member, Plan and kit.css were not copied first, their earlier states are the `prev/*.rev1` files and the harness `.bak` files):

- **Ledger:** `<table class="ledger">` replaced by the kit's `.lg` grid on Main, Member, Plan and Done (Chain already had it; its local copy moved into kit.css §8). `.row.is-static` moved from Chain / Member into kit.css §6.
- **Links:** Main now reaches every desktop board (§1); Decide's back link reads "‹ 返回工作台" like Goals, TaskMap and ArchOverview.
- **Goal conflict (BRIEF-V2B 6e) on Main, Plan, Goals, Decide, Phone:** no 推荐, nothing preselected, 确定 disabled until a pick; the docked decision card carries the same radio list and a disabled 确定 on every board. Goals' option bodies lost their "推荐它：" sentences.
- **Shared data:** the copies of `std40()` / `big600()` on ArchOverview, Decide, Goals, Phone and TaskMap carry the same T13 story, reasons and wording as Main (§10). Reviewer's 最近一步 is "回复 执行者 · 状态机：检查不完整的计数，13:47" everywhere the 14:15 moment is shown. q1 / q3 card lines on Main and Phone match Decide's.
- **Timeline:** Main, Decide, Member and Phone show 14:15 on 10-04; Chain runs 13:31–14:32; Plan's goal-2 events start at 14:36 (after both), so its rail shows 执行者 · 状态机 待命 (passed at 14:22); goal 1's 检查不完整判定 is requeued at 15:05 (Done's history), so it is still open on every 10-04 board. Goal 2 was created 10-04 13:18 on every board (Done said 10-03).
- **Done:** 重新入队与失败类别 is a 返工 row (not 接续); the 接续 row is 前端拆分's (Host restart 10-03 15:12, as Member's records say); 返工 4 个任务，共 6 次 · 接续 1 次. Goal 2's thread and ledger name the overlap as core-routes.ts, views.ts and use Plan's wording.
- **Goal 2's data:** Decide, Phone, Goals and Done had the old `g2data()`; they now carry Main's (Plan's 方案 A, 第 1 版), so the overlap reads core-routes.ts, views.ts and goal 2's map is the same on every board.
- **Copy:** a goal named in running text is in “…” on every board (Phone used 「…」; 「…」 stays only for a quoted reference, "关于「…」："). The decision card's "1 / 2" counts within its level and is hidden for a single card (Main, Plan and Done counted the whole queue).
- **ArchOverview:** the light-theme box and node colours are kit tokens (`--surface`, `--ground`) instead of hex.

Left open for the lead (bigger than a drift): BRIEF-V2B 7's 轨道 + 活动日历 view is on no board yet (TaskMap only lists 运行轨道视图 as a future-intent task); BRIEF-V2B 6b's 文件 / 命令 / Diff tabs and 引用到草稿 are not on Main's right panel; Main's `archData()` (and its copies on Decide, Goals, Done, Plan) still groups by folder with "App（Host 与工作台）", while ArchOverview draws the real repository's semantic groups (UI, Host and Composition apart).

## 18. Gap pass after approval (2026-10-05)

The user approved the canvas prototype on 2026-10-05 ("canvas的原型可以"); the approved files are frozen in `v2/prev/approved-v9/`. This pass closes only the three gaps §17 left open, which were decided before the approval (BRIEF-V2B 7, 6b, 4 and 5; repo `docs/UI-WORKBENCH.md` §0 rows "§1 第 7 条与 §11 的纵向连续时间放大镜" and "保留的条目"). Everything approved keeps its look, copy, layout, flows and data; additions only. Where a gap forces a change to an approved element, §18.5 says what and why.

Shared parts (the lead): `project/kit.css` §15 (new components, appended; the first 43,663 bytes are unchanged), and `proto/v2/data/`:

| file | what | for |
|---|---|---|
| `timeline.js` | G1 data (`tlData`: every Run of goal 1, 2, 3 with result, reason, chain link and counts) + view functions (`tlModel`, `timeView`, `tlTasks`, time helpers) | Main, TaskMap (and, optional, Plan / Goals / Decide / Done) |
| `timeview.snippet.html` | the 轨道 + 活动日历 markup bound to `tl = this.timeView({...})` | Main, TaskMap |
| `auxtabs.snippet.js` | G2 state keys (`axState`), fake workspace (`axRepo`), `axTree`, `axLineDiff`, `axView`, `axQuoteText` | Main (full), Plan, Goals, Decide, Done |
| `auxtabs.snippet.html` | G2 markup in five pieces: root, two dividers, tab strip, pages (文件 / 文件页 / 命令 / Diff), composer quotes | same |
| `arch-semantic.js` | G3 canonical semantic architecture: ArchOverview's data methods copied verbatim (renamed `sem*`), `semDeps`, `archSemantic()`, `archAttach()` | Main, Plan, Goals, Decide, Done (and G2's file tree) |
| `README.md` | sources of every number, the archModel() body, old-id → new-id table, board notes, cross-board conflicts found | every board agent |

Generators and checks: `v2/sketch/gaps/` (`gen-arch.mjs`, `gen-timeline.mjs`, `verify-arch.mjs <Board>`, `paths.mjs`, `try-tl.mjs`, `make-demo.mjs` → `GapsDemo.dc.html` + `MainSem.dc.html`, `build-demo.mjs`, `shoot.sh`); PNGs in `v2/shots/gaps/`. `GapsDemo.dc.html` is a harness board (not on the canvas): it is Main's real logic + the four data files + the snippets pasted exactly as a board agent will paste them. `MainSem.dc.html` is the approved Main with only the G3 data swapped in.

### 18.1 Components (kit.css §15)

| class | what | states |
|---|---|---|
| `.app.is-split` | the shell becomes five tracks: rail · divider · centre · divider · panel. Widths are state on the root: `style="--rail-w: {{ax.railW}}px; --panel-w: {{ax.panelW}}px;"`. The panel has **no 480px cap**: it takes up to everything but 360px of centre. | `.no-panel` (hidden, as before), `.panel-max` (放大: centre and its divider hidden, rail kept), `.is-dragging` (col-resize cursor, no text selection). ≤ 960px: one column, dividers hidden. |
| `.split-handle.for-rail` / `.for-panel` | `<div role="separator" aria-orientation="vertical" tabindex="0" aria-valuemin/max/now>`; 8px invisible grab area over the pane edge, a 2px line only when needed | hover `--line-2`, focus-visible `--text-3`, `.is-drag` `--text-2`. Pointer: `onPointerDown` captures the pointer on the handle (`setPointerCapture`), `onPointerMove` / `onPointerUp` / `onPointerCancel`. Keyboard: ← / → 16px (Shift 64px), Home = default (232 / 480), End = widest; double-click = default. Rail 180–360px; panel 360px – (window − rail − 360px). |
| `.ptabs.aux` > `.pt-list` + `.pt-acts` | the right panel's tab strip: 任务图 · 架构图 (fixed) · 文件 × · 命令 × · Diff × · file pages × (mono name) · node pages × (新标签打开). Many tabs scroll sideways (no scrollbar). Right: + (menu: 文件 / 命令 / Diff, "已打开" when open), 放大 / 还原, 隐藏右栏. | `.tab.is-on`; `.tab .dirty` 6px dot = unsaved file page; closing the active tab returns to 任务图; + reopens a closed tool tab and switches to it. |
| `.ftree` > `.frow.d0…d9` | 文件: the directory tree of the real repository (from `semTreeData`), folders first, 14px per level; a chevron on folders (`.is-open` rotates it); changed files show `+n −m` (`.add` / `.del`) | `.is-on` = the open file page; a folder shows 100 entries, then `.is-more` "再显示 100 个（共 n 个）" (the 9-29 explorer rule). Read-only browsing; a file opens as its own tab. |
| `.fpage` (`.fp-head`, `.fp-note`, `.fcode` > `.fl`, `.fedit`, `.fp-bar`) | a file page: path (mono, wraps after "/"), state, 编辑 / 查看, 保存; the text in a window of the real file (`第 1–79 行，原型没有收录` fold rows above and below, so line numbers match the real file); a gutter of line-number buttons that select; a bottom bar with the selection and 引用到草稿 | state words: 载入于 14:12 · 未保存的修改 (`.tx-waiting`) · 已保存 14:15 · 已重新载入. Selection: click a number = that line (again = clear), Shift-click = range; in 编辑 the textarea's own selection counts (`onSelect`). **Conflict** (`.fp-note`, a surface you act on): saving a file that changed on disk after you loaded it shows "文件在磁盘上改过了：磁盘上的 server.ts 在 14:11 被 执行者 · 服务重构 改过（+38 −4），晚于你载入的版本（14:09）。保存会覆盖它的改动。" with 重新载入 · 比较 · 仍然保存 · 先不保存. 比较 opens Diff in "disk ↔ your draft". |
| `.composer-quote` (`.cq-main`, `.cq-path`, `.cq-lines`, `.cq-snap`, `.cq-snip`) | a quote in the composer: file icon, path (mono), 第 a–b 行 / 第 n 行 / 整个文件, 草稿快照 (yellow word) when the quoted text is unsaved, ×; the first non-empty line of the quote under it (mono). Plain text on one hairline like `.composer-ref` — **not** a filled chip (§11 Don't). The composer foot says "已引用到草稿，还没有发送". | quoting never sends; × removes; the board's send() puts `axQuoteText(q)` lines into the message and clears `quotes`. |
| `.cmds` > `.cmd` (`.cmd-name`, `.cmd-line`, `.cmd-st`, `.cmd-acts`, `.cmd-out`, `.cmd-kept`) | 命令: the project's real scripts (类型检查, 状态机单元测试, 全部测试, 边界检查, 构建) with 运行 / 再运行 · 取消 · 显示输出 / 隐藏输出; a quiet note "命令在 Host 的工作区里运行；这里不是终端，没有输入。" (the real page has no PTY / stdin) | 未运行 (`dot s-idle`) · 运行中 (`s-running`) · 已结束 · 退出码 0 · 用时 41 秒 (`s-satisfied`) · 已取消，输出保留 (`s-cancelled`). Hidden output is **kept**: "输出已隐藏，仍然保留（4 行）". No timers: short commands finish on 运行, 全部测试 stays 运行中 until 取消. |
| `.dfiles`, `.diff-head`, `.diff` > `.dl-hunk` / `.dl-row.is-add / .is-del` | Diff: the changed files (Git HEAD ↔ working tree, the six uncommitted files of 14:15) with `+n −m`; the selected file line by line: old no · new no · sign · text; added rows on `--green-faded`, removed on `--red-faded`, signs in `--add` / `--del` | mode "Git（HEAD）↔ 工作区" or, from a conflict, "执行者 · 服务重构 14:11 写到磁盘的版本 ↔ 你的草稿" (computed live by `axLineDiff`) with 回到 Git ↔ 工作区. A file whose lines are not in the prototype says so ("逐行内容在原型里没有收录"). |
| `.tl-tools` | 成员 / 阶段 (`.seg`) · 今天 / 本周 / 全部 (`.seg`) · `.tl-cell` "只看 10-04 13:00–14:00 ×" while an hour is picked | — |
| `.tl` (`.tl.full`) > `.tl-axis` + `.lane.r1/r2/r3` (`.lane-name`, `.lane-track`) + `.tl-over` | 轨道: one lane per member (秘书 last) or per stage (+ "目标与对话" for turns, consultations and the goal's own gate); time left → right; lane name column 112px (168px on the full page) | lanes grow to 2–3 rows only where runs overlap (a check beside the next run, a read-only consultation beside the member's run). A lane with nothing in the window says "这段时间没有执行" / "这一小时没有执行" / "未排期 n". |
| `.tl-b.k-run / .k-check / .k-query / .k-talk` + `.w0/.w1/.w2` | each Run one bar, positioned with interpolated `left: {{b.x}}%; width: {{b.w}}%;` (min 3px). Shape: a run 10px; a check round 4px; a read-only consultation or a conversation turn a 1px outline (`.r-q`). Colour = **result**, the same tokens as the trees: | run: 已结束 / 已交给正式检查 = `.r-ok` (full grey — the check bar carries the verdict), 执行中 `s-running`, 已暂停，可继续 `s-waiting`, 执行失败 / 执行失败（预算耗尽） `s-failed`, 平台中断 `s-blocked`, 已取消 `s-cancelled`, 执行结果待核对 `s-decide`. check: 通过 `s-satisfied`, 检查未通过 `s-failed`, 检查不完整 `s-blocked`, 检查中 `s-verifying`. Hover / focus: 1px `--lit` ring and the info card; the bars of the same task stay, the rest fade to .3 (`.tl.focus`). Click: selects the task in the task map (Main: back to 树 with the task selected). |
| `.tl-link` (`.wait`) | attempts, re-checks and the runs of one attempt joined by a 1px `--tree` line from the end of one bar to the start of the next | `.wait`: a dotted `--text-3` line from a 需要你决定 mark to now, while the decision is open |
| `.tl-mark` | a 2px × 14px mark where something stopped: 平台中断 `s-blocked`, 已暂停 `s-waiting`, 执行结果待核对 / 需要你决定 `s-decide`, 延后 `s-deferred` (title = the reason) | — |
| `.tl-now` (`.at-end`), `.tl-ev` | the now line (1px `--lit`, label "现在 14:15" on the axis); Host restarts as dashed `--text-4` lines across all lanes, labelled "Host 重启 14:02" under the lanes (no label in the narrow 本周 / 全部 view, where they would collide) | — |
| `.cal` > `.cal-h`, `.cal-d`, `.cal-c.cal-l0…l4` | 活动日历: GitHub-like day × hour squares (12px, 2px gap), one row per day of the window (今天 1, 本周 7 from Monday, 全部 since the goal began); intensity = steps + edits + check items in that hour on the **neutral** ramp: l0 empty cell (`--empty` + hairline), l1 `--grey-faded`, l2 `--grey-half`, l3 `--grey`, l4 `--rel` (thresholds 1–19 / 20–44 / 45–69 / ≥ 70) — green is 已满足 on this canvas, so the calendar does not use it | `.is-future` (hours after now: nothing drawn), `.is-on` (the picked hour: 1px `--lit` ring). Click a cell = the lanes show only that hour (ticks every 10 min); again (or × in `.tl-cell`) = back. |
| `.tl-sum` | one quiet line: "今天：步骤 213 · 编辑 34 · 检查 106 项 · 未排期 19" | counts follow the window (the hour, or the calendar's days) |

### 18.2 G1 · 轨道 + 活动日历 — where and how

- **Main**: the 任务图 tab's view switch becomes **树 / 大纲 / 轨道** (`timeview.snippet.html` [1]); in 轨道 the search field and 图例 of `.ptools` are hidden and `.pbody` holds `.tl-tools`, the lanes (`.tl`), the compact calendar and the sum line ([2]). `timeView({ goal: s.goal, moment: '10-04 14:15', stop: paused / cancelled at 14:15, by, win, cell, hover, tasks/stages: tlTasks(taskModel(goal)), memberWords: this.memberWords(), on })`. Pause and cancel reach the bars (running runs and checks end at 14:15 as 已暂停，可继续 / 已取消 with a mark; read-only consultations are not the goal's work and go on). Goal 2 and 3 show their conversation turns and "未排期 14 / 13". The scale tweak does not change the time view (the 600 tasks are synthetic; their runs are not invented). *Main after its review (§18.9): the calendar comes first, 图例 stays in 轨道, the moment follows the conversation clock, and at 600 the stage lanes are the 600 map's.*
- **TaskMap**: the same view on the full page, `full: true` (`.tl.full`, `.cal.full`: wider lane names, ticks every hour up to 12 hours, day labels with weekday) — the 整页 counterpart of Main's panel, with the same switches.
- **Optional elsewhere** (data is ready, nothing requires it): Decide `variant: 'decide'` (its extra stop reasons: T16, T29, T30, T31, T44, T45 at 14:15); Done `moment: '10-06 16:33'` (the whole goal; every member's run time and model requests equal Done's usage table); Plan goal 2 with `extraRuns` for its clock-driven turns and the run that starts on 采用; Chain's later moment `'10-04 14:32'`.
- **Future tasks** never get bars or invented times: they are only counted ("未排期 n" in the sum line; per stage in the lane name's title, and in the track when the lane has no bar).
- Template holes: interpolated `left` / `width` on ticks, bars, links, marks, events and the now line (live, state-driven positions — `format.md`'s allowed case; §1's style-hole list gains these and the root's two widths).

**Hover cards** (the `.hcard` of §6.8, `role="tooltip"`, `onMouseEnter` + `onFocus`, read only loaded data):

| hovered | head | state line | rows (`hc-dl`, 2-character keys) | hint |
|---|---|---|---|---|
| a bar | square in the bar's result class + task name (or 对话回合 / 咨询（只读副本） / 目标验收) | result word in its `.tx-*` + "：" + reason ("检查未通过：lint 2 项，回放测试 1 项") | **成员** member + status word · **尝试** "第 2 次尝试 · 接续 · 系统自动重新入队（1/3）：检查未通过" or "第 4 轮正式检查" · **时间** "10-04 13:31–13:55 · 24 分" or "10-04 14:04 起，已 11 分" · **归属** stage · **活动** "步骤 18 · 编辑 2" / "检查 14 项" | 点一下在任务图里选中它 |
| a calendar cell | square in the cell's level + "10-04 周日 13:00–14:00" | "步骤 30 · 编辑 4 · 检查 37 项" / 这一小时没有活动 / 还没到这个时间 | **任务** up to 3 tasks touched, with their current squares, "另有 n 个任务" · **成员** names | 点一下只看这一小时 / 再点一次取消，回到整段时间 |

The bar card opens 2px under the bar's row, left-clamped inside the track area; the cell card opens under the cell row, inside the calendar.

### 18.3 G2 · 辅助区 — where

- **Main** gets the full set: the root `is-split` + widths ([1]), the two dividers ([2]), the strip ([3]) replacing `.ptabs` (Main's node pages from 新标签打开 are passed as `extra` and live in the same strip), the pages ([4]) after the map block (`isMap` = 任务图 or 架构图 only), the composer quotes ([5]); the header's panel toggle keeps working (`panel` state).
- **Plan, Goals, Decide, Done** get the same strip and pages on their right panel (+ the dividers on boards with the three-pane shell). Content is the same 14:15 workspace; a board at another moment passes its clock in `axView(s, { at })` (Done: its files are committed later — it may keep 文件 and 命令 and show its own changed files in Diff; see README).
- Rules kept from the 09-28 acceptance (UI-WORKBENCH §0 保留的条目): file tree and file pages are separate tabs; saving checks for a change on disk (CAS) and offers 重新载入 / 比较 / 仍然保存; a selection or the whole file goes into the draft with path, start–end lines and a snippet, unsaved = 草稿快照, never sent by itself; commands run / cancel, output hidden but kept; Git ↔ working tree line diff; the panel hides, maximises, opens and closes tabs; both dividers drag.

### 18.4 G3 · one semantic architecture on every board

`archSemantic()` is ArchOverview's repository model in Main's node shape: system → 10 areas (UI, Host, Composition, Workflow, AgentRuntime, WorkGraph, WorkspaceTools, RecordStore, Contracts, Kernel) + **支撑** (tests, docs, scripts, resources, tools, .github, .local, 项目根目录文件 — ArchOverview's 支撑 band) → semantic groups (`kind: 'sub'`: WorkGraph's 13 proposed submodules; the module documents' groups for AgentRuntime, Workflow, WorkspaceTools, RecordStore, Host) or real folders (`kind: 'dir'`) → files (real paths; a file whose folder differs from its group shows "evidence/coverage.ts"). 2,709 files at data head 0543261, the same at both scales. Module `deps` are the real import counts (WorkGraph → Contracts 704, RecordStore 114, WorkspaceTools 6). Boards replace `archData` / `synthDir` / `synthModule` and archModel's module loop (README gives the archModel body); the focused view (当前工作), 全部, 大纲, search, drill, card and detail work unchanged on it (checked on Main's real engine: `MainSem.dc.html`, shots `g3-*`).

Goal 1's working files now sit at: Host / host / host.ts; Host / server / server.ts, attention-observer.ts; AgentRuntime / recovery / observation-recovery.ts; WorkGraph / state / task-machine.ts, attempt-machine.ts, verification-machine.ts. Goal 2's overlap: Host / core-routes / core-routes.ts and UI / UI 根目录文件 / views.ts.

### 18.5 Approved elements this pass had to touch (and why)

| element | change | why |
|---|---|---|
| Main's `.ptabs` (任务图 · 架构图 + node pages) | becomes the `.ptabs.aux` strip with the same two tabs first and the same quiet `.tab` look, plus 文件 / 命令 / Diff / file pages and +, 放大, 隐藏 | G2 (6b): the accepted multi-tab area; node pages keep their × |
| the shell grid (`.app` 232 · 1fr · 480) | `.app.is-split` adds two 0-width divider tracks and takes the widths from state; default widths unchanged (232 / 480) | G2: draggable dividers, no 480px cap |
| the 任务图 view switch 树 / 大纲 | gains 轨道 | G1 (7) |
| the architecture data on Main, Plan, Goals, Decide, Done | "App（Host 与工作台）" and the folder modules are replaced by the semantic structure; the 600 tweak no longer swaps in a synthetic ≈ 20 000-file architecture — the real repository (2,709 files) is the architecture at both scales, as on ArchOverview | G3 (4, 5): one canonical dataset |
| the tree engine's "≤ 12 per comb" rule | declared semantic children are never cut (WorkGraph's 13 submodules, state's 13 files stay one comb, 13 × 18 = 234px); only lists of **more than 16** are shown in slices of ≤ 12 by name (`slice: true`, sem says it is not a semantic group). Root = 11 because the eight support areas hang under 支撑 | the real data has 13 semantic submodules; cutting them into slices would hide the structure G3 asks for |
| `archCard` / `archDetail` module lookup | `const mod = n.area ? tree.byId[n.area] : null;` instead of walking to the child of SYS | so docs under 支撑 keep 审阅者 · 规格 as owner (MainSem uses exactly this one-line change) |
| `restLine()` wording | with mixed kinds in a rest (groups + a non-code folder) Main says "另 9 个项"; suggestion: count `sub` and `dir` as "组" when they are a module's children ("另 9 个组") | real modules mix semantic groups and one folder of non-code files |
| style holes (§1) | adds the root's `--rail-w / --panel-w` and the time view's `left` / `width` | live, state-driven positions |
| events (§1) | adds `onPointerDown/Move/Up/Cancel` and `onKeyDown` on the two separators, `onSelect` on the file editor | dividers and selection in the editor |

Checks (`v2/sketch/gaps/build.log`): format lint clean on both harness boards, no unknown holes, every handler a function and callable from every scenario, 21 scripted flows (tabs close / reopen, maximise, hide, divider keys and drag, folder paging, line selection + quote, quote from an unsaved edit = 草稿快照, save → conflict → 比较 → 仍然保存, 重新载入, commands run / cancel / hide, diff modes, lanes by stage / week / hour / clear, bar hover + click). Whole-board elements: 223–431 (time view), 142–348 (aux pages), 326–882 (G3 on Main). PNGs: `v2/shots/gaps/g1-*` (10), `g2-*` (13), `g3-*` (8).

### 18.6 TaskMap gap review — shared timeline changes (2026-10-05)

Findings of `sketch/taskmap-gapreview/`. `data/timeline.js` was regenerated from `sketch/gaps/tl-view.src.js` (the run data is unchanged) and TaskMap carries it verbatim. **Main still carries the previous paste and has to re-paste `data/timeline.js` verbatim**; the kit rules below are additive, so nothing changes on a board until it re-pastes.

- **Calendar days follow the window** (今天 1 · 本周 7 from Monday · 全部 since the first run) whether or not an hour is picked; the picked hour only narrows the lanes, its cell stays ringed and a second click on it clears it. Before, 本周 / 全部 collapsed to one empty "01-01 周四" row after a pick.
- **`.tl.now-row`** (kit §15.8): in 本周 / 全部 the now label sits on its own row above the day ticks (axis 40px; timeView's lane top 40 instead of 22), so today's date is never covered.
- **Stop marks for checks**: a check that ended 检查不完整 (or that a Host restart cut short) with no later check or run of its task by the moment gets an `s-blocked` mark ("检查不完整，等重新检查：…") and a dotted wait line. Every wait line, the 需要你决定 ones too, ends where the next bar of its row begins, so it never runs through another task's bar (a lane has three rows at most); an end mark is drawn only when the bar ends inside the window.
- **Lit task**: marks and links carry `task`; the hovered bar's task keeps its links, marks and wait line at full strength (`.on`; kit `.tl.focus .tl-link.on, .tl.focus .tl-mark.on { opacity: 1 }`).
- **Bar cards**: the second row is 尝试 for runs and checks, 类型 for consultations ("只读副本回答，不写回工作记录") and conversation turns ("主对话里的一轮" / "工作记录里的一轮，不属于任务"); the member's status word is looked up by name with "（主对话）" stripped (秘书（主对话） · 待命).

TaskMap only: 轨道 counts 需要关注 over the whole goal (a drill made in 树 stays in state for the way back); the selection's bars, links and marks stay lit, and so do a hovered 依赖 / 后续's bars; at 600 a quiet stage lane says "没有执行记录 n" for its synthetic 已满足 or moving tasks, the sum column adds "合成任务没有执行记录，轨道只画目标 1 的真实执行" and the 需要关注 list "n 个没有执行记录，轨道上没有它们"; copy "每一行是一位成员（或一个阶段）…" and "点一下选中它，看详情"; at ≤ 960px lane names keep 104px with 8px right padding, so "执行者 · 服务重构" is not cut. Left for the lead: T40 运行轨道视图 is still a future intent on seven boards (data/README.md cross-board note 7); renaming it with the same id, stage and state (e.g. "跨目标时间对比") keeps every count.

### 18.7 Plan gap review (2026-10-05)

Seven findings on Plan after the gap pass, all applied on Plan only (the pasted `arch-semantic.js` / `auxtabs.snippet.js` are untouched). Backup before the fixes: `sketch/plan/review-fix/Plan.before.dc.html`; flows "Review 1–7" in `sketch/plan/build.log`; `cmp/compare-parts.mjs`: rail and centre identical to the approved board in all 48 approved scenarios.

| finding | what Plan does now |
|---|---|
| default strip overflowed (goal 1's two file pages open) | `preset()` = `Object.assign(this.axState(), { axPages: [] }, {…})`, as Main: every 起点 opens with 任务图 · 架构图 · 文件 · 命令 · Diff. With one long-named file page (task-machine.ts) the strip is still ~40px over at 480 and scrolls sideways — the snippet's rule, the same on Main (see the note below) |
| planned files counted as repository files | **Decision: keep the planned leaves (方案新加, lit as on the approved board), count them apart.** `finishTree` adds `added` / `addTouched`; counts read 2,709 / UI 79 as on ArchOverview, Main, Decide: 全部 "coding-platform 2,709 个文件 · 方案新加 10 个", "UI 79 个文件 · 方案新加 10 个", a new folder "方案新加 5 个文件", the detail "要改 1 / 79 个文件 · 方案新加 10 个 · 未来意图 11", rest lines "73 个文件，方案新加 2 个". This deviates from `data/README.md` ("goal 2's planned new files are not drawn") — for the lead to accept; reverting is removing the `planAdd()` call in `archModel()` |
| a quote got the generic plan summary | `quoteAnswer()`: with quotes, in 方案 / 已采用, the reply starts from the quoted files — which tasks of the shown option change them (this round or 以后再做), else "方案 A 不改 X"; goal 1's side from the Diff tab's uncommitted changes ("它是目标 1 正在改的文件（工作区里 +15 −6，还没提交），两个目标在这里不重叠") or its unfinished tasks on views.ts / core-routes.ts. It never names lines a task changes ("具体动到哪几行，做到那一步才定"). A question about the lines gets only that; a statement or another question is answered after it as before; 目标卡 / 冲突 phases unchanged |
| plan label read as a third toggle | `{{mapMeta}}` after the spacer of `.ptools`: right-aligned before 这一版的改动 / 图例, as in the approved strip (lint added) |
| root rest line cut at 480 | `restLine(rest, hasPath, room)`: focusTree passes the px left on the row (panel width − 40, depth cells, compact squares, name); a line that would not fit drops its file counts ("另 8 个模块，本方案不改", WorkGraph "13 个子模块，本方案不改"); at 680 or 放大 the counts come back |
| slices called 文件夹 | Main's `uw` line: a slice is a 段 ("tasks 另 2 个段，17 个文件") |
| 依赖 row long and unordered | most first, three by name, the rest as one count: "Host 依赖 Contracts 68 处，WorkGraph 44 处，WorkspaceTools 9 处，另 4 个模块共 21 处" |

For the lead: (1) Main, Decide and Done show the same unordered 依赖 row — sorting `semDeps` in `gen-arch.mjs` fixes all boards (Plan's local sort stays correct); the "three + 另 n 个模块" cap is Plan's and would need the same call elsewhere. (2) The tab strip does not bring a newly opened file page into view (no DOM call in the format); a long name or a second page pushes the active tab under +. A shared fix belongs in `auxtabs.snippet` (e.g. a narrower `.nm` cap for file pages). (3) Plan's `cfAnswer()` (approved copy) still ends "我推荐等目标 1。", against BRIEF-V2B 6e; not changed here.

### 18.8 Goals gap review (2026-10-05)

Eleven findings on Goals after the gap pass: nine applied on Goals only, one accepted as on Main, one left for the lead (shared data). The pasted `arch-semantic.js` / `auxtabs.snippet.js` are untouched (`sketch/goals/verbatim.mjs`: 19 methods verbatim). Backup before the fixes: `prev/pre-gaps/Goals.before-review-fix.dc.html` (the approved board stays `prev/pre-gaps/Goals.dc.html`); flows "fix: …" in `sketch/goals/build.log`; PNGs `shots/goals/r-*`; `sketch/goals/measure.mjs` checks label and strip overflow in the static sketches.

| finding | what Goals does now |
|---|---|
| the secretary on a group named both overlap files | only the overlap files under the asked node (Host → core-routes.ts, UI / UI 根目录文件 → views.ts, the root → both); a flow checks six nodes |
| no 任务图 tab | 任务图 is the first tab, as on Main, Plan, Decide, Done; the board still opens on 架构图 (approved); closing the active tab returns to 任务图. Content: project → goal → stage → task in the 当前工作 pattern — the paths to the 4 + 3 tasks that change core-routes.ts / views.ts lit, siblings as compact squares, goal 3 one square on the root; Main's squares (a goal = its square in the order list, an open group = its share of 已满足, a folded one = its most urgent moving state); hover card (冲突 = the overlapping files a task changes), detail (冲突 · 依赖 · 文件; groups: 任务 / 阶段 and 冲突), 大纲, legend lines of its own, the secretary's answers; after 等… / 调到前面 the later goal's 可领取 task on the overlap is 待执行 "等目标 n 先改完". No file page is open at first (as Main), so the 480px strip shows its five tabs |
| no page opened from a node | 右键 on any square or label of either map (`onContextMenu`, Shift+F10 too) and 新标签打开 in the detail open a node page (its detail as `.detail.is-page`; × goes back to the map it came from; crumbs go to the map); a file's detail has 打开文件 (its file page, read / edit / quote). The card hint reads "… · 右键新标签打开" |
| counts mixed source and 支撑 files | `pairModel` counts source files (nA / nB / nAB) and files under 支撑 (xA / xB / xAB) apart; the root reads "目标 2 改 2 · 目标 2 另改支撑里 1 个文件" — the same 2 as the goal rows and the scope note; inside 支撑 the files count as before. The root's rest line in 两个目标的文件 stays "另 7 个模块，2,486 个文件" (no "两个目标都不改": 支撑 does hold goal 2's doc — its outlined square on that comb, and its card says so) |
| slices called 文件夹 | Main's `uw`: "tasks 另 2 个段，18 个文件" |
| 引用到草稿 while 放大 | the panel steps back (`axMax: false`), as 在对话里问 does |
| board-local sticky active tab | removed; kit §15.2 as on the other boards (lead note 3) |
| divider stopped at 848 | an adapter in renderVals (the pasted methods stay verbatim): the handle reports a box 232px wider to the snippet's `down` / `key`, so the range is §18.1's 360 – (window − 360) = 1080 at 1440 (aria-valuemax 1080). To be replaced by a rail-less option in the snippet (lead note 2) |
| WorkGraph's rest line cut at 480 | a comb row whose estimated width does not fit the panel drops "，两个目标都不改" (CJK = the size, a space .28, other .52 — within ±7px of the rendered rows); today only WorkGraph in 两个目标的文件 at 480; at 720 or 放大 the words come back. 任务图 drops its task count the same way |
| 依赖 row long, unordered, "没有声明的依赖" | observed wording, most first, three named, the rest as one count (Plan's shape): "Host 引用 Contracts 68 处，WorkGraph 44 处，WorkspaceTools 9 处，另 4 个模块共 21 处"; none: "没有引用其他模块" |
| ≤ 1240px: panel 480 instead of the approved 420 | **accepted as on Main** — touched approved element: the panel width is state (divider, keys, aria-valuenow); a media rule over it would start a drag from a width the user does not see. At 1100 the centre is 620 (`shots/goals/r-narrow-1100`) |

For the lead: (1) Diff vs the trees (shared data, not a Goals edit): the snippet's Diff shows main.ts +17 −9 and record-codecs.ts +14 −2 uncommitted while no task of goal 1 lists them (T28 says 已改 3 个文件 and lists 2) — add them to T28 / T13 `files` on every board, or drop the two rows from `axRepo().changed`. (2) A rail-less option in `auxtabs.snippet.js` (`(c.railW ?? 232)` / `(s.railW ?? 232)` with Goals' `railW: 0`, or `o.noRail`) replaces Goals' divider adapter. (3) The strip: with one file page open Goals' strip is 22px over at 480 (core-routes.ts's × under +); with two (`g2-quote`) 174px and the active page is out of view — the same on Main, Decide, Done; a kit-wide answer is needed (e.g. a "+n" in `.pt-acts` that lists the hidden tabs). (4) 依赖's verb: Goals "引用" (observed, as its finding asked), Plan "依赖" — one word for all boards; sorting `semDeps` in `gen-arch.mjs` would order every board. (5) Goals' `replyFor()` (approved copy), goal 2 moved first with the conflict open, still ends "所以我推荐让状态机可靠性改造先改。" (BRIEF-V2B 6e); not changed here.

### 18.9 Main gap review (2026-10-05)

Fourteen findings on Main after the gap pass: eleven applied on Main only, three left for the lead or the user. `data/timeline.js` re-pasted (`sketch/main/integrate-data.mjs`; `cmp-data.mjs`: all three data files verbatim); everything else is Main's own code, around the pasted block. Backup before the fixes: `sketch/main/Main.pre-findings.bak.html` (the approved board stays `prev/approved-v9/`); flows "R5 F1–F12" in `sketch/main/build.log`; PNGs `shots/main/r5-*` (14) and every other Main scenario re-shot. **This section supersedes §18.2's Main bullet** where they differ (图例, moment, scale) and §18.5's `restLine` row.

| finding | what Main does now |
|---|---|
| files could not be opened from the maps or the conversation | every path in a detail (task 文件, architecture 路径) and on node pages is a button: a file opens its page tab, a folder opens 文件 at it, a file in the uncommitted Diff also gets a right-aligned 看 Diff; a planned file not in the repository (goal 2) stays text. Architecture files get 打开文件 before 新标签打开; Diff's head has 打开文件 for the shown file; the conversation's paths that exist (9) open too (hover underline, same quiet look) |
| same-name file tabs | the shortest differing parent goes in front — "app/main.ts" / "ui/main.ts", "materials/contracts.ts" — so under the 88px name cap the part that differs is the part that stays (the finding's "main.ts · app" would be cut there); every file tab's `title` is its full path |
| a task reference did nothing in 轨道 | `go.selTask` switches 轨道 back to 树 (both branches, also across goals): conversation links, decision cards, relations |
| the time view's clock was frozen | moment = the conversation clock (14:15, then a minute per line); stop at `pausedAt` / the new `cancelledAt`; your turns are `extraRuns` (秘书 lane; a read-only branch question is a 咨询（只读副本） on that member's lane). Known limit: past 14:16 the lanes follow `tlData` (T13's run ends 14:17, its check starts) while the tree keeps the 14:15 states |
| tick labels under the now label | `.now-row` (re-paste) gives 本周 / 全部 their own now row, so Main's filter runs only in 今天 / one hour, on the panel width the shell draws (`panelPx`: dragged width, else 480 / 420 by window size, capped at window − rail − 360) |
| 轨道 · 阶段 at 600 | TaskMap's rule (`tlInput`): the 600 map's ten stages, goal 1's real runs only, synthetic moving tasks neither bars nor 未排期; an empty stage lane says "没有执行记录 n · 未排期 u", one line "合成任务没有执行记录，轨道只画目标 1 的真实执行" |
| rest lines changed rhythm | approved wording back (count, files, 本目标未改动, attention); a module's children are always 组 (支撑's areas 文件夹, slices 段); the file count goes only when the row's room (panel width in state, depth, compact squares, name) is too small — today WorkGraph in 树 at 480 ("另 12 个组 · 受阻 1"); at 760 and in 大纲 it stays |
| a quote kept only one line | a selection quote keeps its lines (`text`, numbered; an unsaved one = 草稿快照); sending puts each reference in your bubble with its lines folded under it (click to open, `bqOpen`); a whole-file quote's snippet is "共 n 行" |
| no feedback while 放大 | "草稿里 n 条引用" beside the strip's buttons (a click restores) and the file page's bar says "已引用到草稿（n 条），还没有发送". Goals instead steps back on quote — one rule for all boards is the lead's call |
| ≤ 1240px fell to 232 / 480 | the widths stay unset (`--rail-w: initial`, so var() falls back) until you drag or use the keys; Main's helmet restores 208 / 420 for 961–1240px. The dividers read the real container width on pointer, key and focus (`axBox`): a drag starts from the width you see, Home and double-click return to the CSS width, aria-valuemax = window − rail − 360. This answers Goals' "accepted as on Main" note (§18.8) |
| 轨道 had no legend | 图例 stays in 轨道: bar shapes, result colours, now / Host 重启, the calendar's 少→多 ramp, "还没开始的任务不画". The crowding of 今天 in the 480px panel (13:30–14:15 in the last ~40px) is left: the window rule is the lead's (`tl-view.src.js`) |
| strip spacing differs from Plan / Goals / Done (12px / 88px vs kit 14px / 168px) | **left for the lead**: Main keeps its helmet rule until kit §15.2 has one value for all boards |
| the 600 tweak no longer shows ≈ 20 000 files | **for the user** (approved board showed the stress case): if wanted back, a marked synthetic expansion under Kernel at 600, outside the semantic groups |

Main's helmet rules added this pass (candidates for kit §15): the 961–1240px `is-split` fallback, `.d-fline` / `.d-file.is-link` / `.step-obj.is-link`, `.bq*` (sent quotes), `.pt-q`, the lanes legend's `.lg-*`. At a 432px centre (panel dragged to 560 in a 1200 window) the approved goal bar's words overlap (`r5-narrow-dragged`) — kit §10, not changed here. *(§18.10: the 961–1240px fallback, `.d-fline` / `.d-file.is-link` / `.step-obj.is-link`, `.pt-q` and the strip's 12px / 88px are now kit §15.10.)*

### 18.10 Consistency pass after the gap reviews (2026-10-05)

The six boards the gap pass changed (Main, Plan, Goals, Decide, Done, TaskMap) were brought to one tab strip, one set of G2 components, one copy and one dataset, with the four unchanged boards (Chain, Member, ArchOverview, Phone) as the reference. What one board's review had added for itself now lives in the shared parts (kit.css §15.10, `data/auxtabs.snippet.*`, `data/timeline.js`), so every board with the auxiliary area behaves the same. **This section supersedes §18.7–§18.9 where they differ** (strip, quotes while 放大, dividers, 依赖 row, file rows). Backup of everything before the pass: `v2/prev/pre-final-consistency/` (the ten boards, kit.css, canvas.json, DESIGN.md, `data/`). Scripts in `v2/sketch/consistency/`: `w.sh` (runs a command inside WSL with node on the PATH); one-off editors `repaste-aux.mjs`, `repaste-methods.mjs`, `insert-methods.mjs`, `deps-row.mjs`, `detail-files.mjs`, `fix-lint.cjs`, `regen-tl.sh`; checks `verbatim-all.mjs`, `markup-check.mjs`, `cross-probe.mjs`, `strip-check.mjs`, `method-diff.mjs`; `shoot-changed.sh`.

| area | before (per board) | now (every board that shows it) |
|---|---|---|
| tab strip (kit §15.10) | Main / Decide 12px · file name 88px in their helmets; Plan / Goals kit's 14px · 168px; Done its own shrink-and-stick rule | one rule in kit: 12px, file name 88px, inactive tabs shrink to an ellipsis first, the active tab never shrinks and sticks to the strip's edge (side shadows in the gaps); the boards' copies removed |
| same-name file tabs | Main only ("app/main.ts" / "ui/main.ts", title = path) | the snippet's `tab()`; markup [3] binds `title="{{t.tip}}"`; Main's own code removed |
| quotes while 放大 | Main: "草稿里 n 条引用" + bar text; Goals: the panel steps back; Done: bar text always; Plan / Decide: nothing | the snippet: `ax.qMax` beside the strip's buttons (markup [3], kit `.pt-q`) and, with nothing selected, the file bar "已引用到草稿（n 条），还没有发送" for that file's quotes; the panel stays maximised (Goals' step-back removed). Decide's dock line uses the same words: "已引用到草稿（n 条），还没有发送；问秘书时会一起带上。" |
| dividers | Main: widths unset until dragged, the real container width (`axBox`), aria-valuemax from it, 208 / 420 at 961–1240px; Plan / Decide / Done: 232 / 480 at every size, aria-valuemax for 1440; Goals: a box adapter for its missing rail | Main's rule in the snippet (`railW` / `panelW` null, `axBox`, `seen` on focus, Home / double-click = the CSS width, root `--rail-w: {{ax.railCss}}; --panel-w: {{ax.panelCss}};`), the 961–1240px fallback in kit §15.10 (Goals: the same 420 in its helmet), `axView(s, { rail: false })` for Goals (adapter removed). Plan's and Goals' row-room estimates read `ax.panelW` / `axBox` |
| 比较 (disk ↔ draft) | `+` before `−` on a tie; Done reordered locally | `axLineDiff` emits the removed lines first (snippet); Done's reorder removed |
| Diff note | flush with the panel edge (Done fixed it locally) | kit `.diff-body > .pnote { padding: 0 16px; }`; Done's copy removed |
| Diff head | Main: 打开文件 for the file shown in Git ↔ 工作区; others: none | the snippet returns `dOpenShow` / `dOpen` / `dOpenTip`, markup [4] has the button; Main's own lines removed |
| file rows in the map detail | Main: 文件 / 路径 open the file page, a folder opens 文件, 看 Diff on changed files, 打开文件 on architecture files; Goals: 打开文件 only; Plan / Decide / Done: plain text | the snippet's `axPaths` / `axFileItem` / `axOpenFile` / `axOpenDiff` / `axRevealDir` and markup piece [6] (`.d-fline`, kit §15.10) on all five; 打开文件 on architecture files in the detail's actions of all five (Plan: beside its single 在对话里问). Main's and Goals' own helpers removed |
| 依赖 row (G3) | Plan: sorted, three + rest, "依赖"; Goals: the same shape with "引用"; Main / Decide / Done: unsorted, every module; empty "没有声明的依赖" | one row: most first, three by name, "另 n 个模块共 m 处", verb 依赖 (the row's key, as on ArchOverview), empty "没有引用其他模块" (the counts are observed imports, not declarations): "Host 依赖 Contracts 68 处，WorkGraph 44 处，WorkspaceTools 9 处，另 4 个模块共 21 处" |
| goal 1's start (G1 vs Done / Member) | the timeline had 秘书 adopt the goal at 10-02 10:20 (Done: "从 10-02 10:20 开始，历时 4 天 6 小时") while Member's core-routes 拆分 is claimed at 09:30 | `gen-timeline.mjs`: c01 is 10-02 09:05–09:30 ("你在 09:30 采用"; the same 25 minutes, so Done's usage table is unchanged); `timeline.js` regenerated and re-pasted verbatim on Main and TaskMap; Done: "从 10-02 09:30 开始，历时 4 天 7 小时", usage span "4 天 7 小时" |
| Plan's planned files (G3) | Plan draws goal 2's planned new files (方案新加) against data/README's "not drawn" | accepted (G3: each board's story "lit as before"); README's Plan note says so |

Approved elements touched in this pass, and why: Done's note and usage span (the start time, so the time view, Member and Done agree); the 依赖 row's order, cap and empty wording on Main, Decide, Done (one row on every board; the approved row with folder data was three names, ordered); the paths in the detail of Plan, Decide, Done, Goals become links in the same quiet look (G2: files open from nodes, as on Main); the shell at 961–1240px on Plan, Decide, Done, Goals goes back to the approved 208 / 420 (the gap pass had made it 232 / 480).

Checked, not changed: the data files come from their sources exactly — `gen-arch.mjs` reproduces `arch-semantic.js` from ArchOverview byte for byte (so ArchOverview agrees with the canonical dataset and was not touched) and `gen-timeline.mjs` reproduced `timeline.js` before the c01 change; every architecture map (Main, Plan, Goals, Decide, Done) carries `arch-semantic.js` method for method and `verify-arch.mjs` passes its stories; the time view's runs match Chain (T13 13:31–13:55, check 13:55–14:00, 14:04–14:17, check 14:17–14:22), Member (T26 from 09:30, T27 / T28's runs, 临时分支 14:05, 咨询 from 14:07), Decide (q1 14:11, q3 14:02:11, q4 9 / 14 at 14:15, q7–q9 13:40–14:02) and Done's usage table (by construction in the generator); canvas.json is exactly as approved (no board height changed).

Results (`sketch/consistency/final-checks.log`, WSL, Playwright 1.63): build-all on all ten boards — every board "build ok; node --check ok", format lint clean, unknown holes none, non-function handlers none, handler errors none; parse-all "all boards parse as written" (ArchOverview 254, Chain 256, Decide 605, Done 966, Goals 477, Main 1190, Member 638, Phone 681, Plan 785, TaskMap 323 elements); links.mjs "no problems"; canvas.json identical to approved-v9; `verbatim-all.mjs`: arch-semantic.js 13/13 methods on Main, Plan, Goals, Decide, Done, timeline.js 11/11 on Main and TaskMap, auxtabs.snippet.js 11/11 on the five (Done's `axRepo` its documented hook); `cross-probe.mjs`: on all five a file in the detail is a link, opens its page, 看 Diff opens Diff, a folder opens 文件, 打开文件 is offered, the 依赖 row reads the same, twin tabs read app/main.ts / ui/main.ts, 放大 shows "草稿里 1 条引用", 比较 lists − before +; `strip-check.mjs`: the active tab is in view in every sketch with a strip (Main 106, Plan 73, Goals 62, Decide 63, Done 60; up to 9 tabs), 12px and the 88px file cap everywhere. Scenario PNGs re-shot for all changed boards: Main 108, Plan 74, Goals 63, Decide 64, Done 61 (its STRIP / SEL checks pass), TaskMap 67 — every shot "ok", no console problems; no browser left running.

Still open (not small drifts; for the lead or the user):
1. *Shared data story*: the Diff lists main.ts +17 −9 and record-codecs.ts +14 −2 while no task of goal 1 names them (T28 says 已改 3 个文件 and lists 2), and q1's verification-machine.ts (lint lines 88 and 3) is not in the Diff. Adding them to T28 / T13 or the Diff changes 当前工作 on six boards.
2. *T40 运行轨道视图* is still a future intent of goal 1 although the view exists; renaming it touches ArchOverview and Phone, which this pass must not change.
3. *BRIEF-V2B 6e in approved copy*: Plan's `cfAnswer()` ends "我推荐等目标 1。" and Goals' `replyFor()` (goal 2 moved first, conflict open) ends "所以我推荐让状态机可靠性改造先改。".
4. *The 600 tweak* draws the real 2,709-file repository on every board (the approved Main showed a ≈ 20 000-file stress case).
5. *Timeline conflicts 2–5* of data/README: the 14:02 restart crosses T28's run_c41a; Decide's 13:52–13:58 overlap in its variant; 架构参谋's consultation "已送达" 14:09 (Main, Decide, Member, Plan) while Member's answer starts 14:07; T25 passes before T41 / T42.
6. *Slice names* such as "entry-plan-re… – persistence/m…" (generated by `gen-arch.mjs`) are cut in narrow rows.
7. *Done*: seven delivery test files are in 文件 and Diff but not in the architecture map (the repository at 0543261); two "modified" tests do not exist in the repository (`tests/app/routes.test.ts`, `tests/agent-runtime/check-execution.test.ts`).
8. *Sent quotes*: only Main folds the quoted lines under your bubble (`.bq`); Plan answers from the quoted file, Decide puts the quote line before the question, the others send the reference lines — each board's own conversation.
9. *Known limits kept*: a board learns the window width only from a divider event (`axBox`), so in a 961–1240px window, before any such event, the row-room estimates assume 480px while the panel is 420px and a long rest line ends in "…" (Goals at 1100: "另 9 个模块，2,617 …"); the strip does not scroll a newly opened page into view (the active tab sticks instead); Main's lanes follow `tlData` past 14:16 while the tree keeps 14:15; 今天 in the 480px panel crowds 13:30–14:15; the goal bar's words overlap at a 432px centre (kit §10).

### 18.11 Verify findings after the consistency pass (2026-10-05)

A verifier checked the gap pass against the approved boards (`v2/prev/approved-v9/`) and the binding text (17 findings). This section records what each became. **It supersedes §18.9 and §18.10 where they differ** (Main's rest-line nouns, the time view's stop and window rules, the calendar's count, the 600 tweak's architecture). Backups: `v2/prev/pre-verify-fix/` (everything before this pass) and `v2/prev/pre-complete-fix/` (the state when the pass was resumed: the boards, kit.css, canvas.json, DESIGN.md, `data/`, the two generators and `tl-view.src.js`). Edit scripts: `sketch/consistency/verify-fix-aux.cjs`, `verify-repaste-aux.mjs`, `verify-readme.cjs`; the shared timeline: `sketch/gaps/gen-timeline.mjs` + `tl-view.src.js` → `data/timeline.js`, re-pasted verbatim on Main and TaskMap with `sketch/taskmap-fix/repaste.cjs`; probes in `sketch/complete-fix/` (`past-pause.mjs`, `plan-nodepage.mjs`, and `probes.sh`, which re-runs the verifier's `critic/complete-g123/*.mjs`).

| # | finding | what was done |
|---|---|---|
| 1 | G1 · a pause never showed as a gap with a mark (继续 dropped it) | **Applied.** Main keeps `stops: [{ kind, t, until }]` in state: 暂停 / 取消 add one, 继续 / 重新入队 close the open one (`until`). `tlModel` takes `stops` (a single `stop` still works): a run or check that spans a stop ends there as 已暂停 / 已取消 with a mark; after `until` it goes on as a linked bar ("接续：你在 14:18 继续，从暂停处接着做"; after a cancel, 重新入队 starts the next attempt); rows that would start while stopped are not drawn; read-only consultations and conversation turns go on. A paused bar that has since gone on reads 已暂停 (not 已暂停，可继续) in its tip, card and mark. **The data has one past pause too**, so TaskMap shows one without Main's buttons: you paused goal 1 on 10-03 at 13:40 and continued at 13:52, so T19 证据链接 (a run no board describes) runs 13:30–13:40 已暂停 + mark, gap, 接续 13:52–14:25, check 14:25–14:31. 状态机's flex run absorbs the 12 minutes, so Done's usage table still matches (SC 130 / 38 · SM 1145 / 214 · SV 520 / 96 · RV 200 / 51 · AA 50 / 13). Scenarios: Main `v-lanes-pause-continued`, `v-lanes-pause-continued-hover`, `v-lanes-paused-open`; TaskMap `tm-lanes-week-pause`, `tm-lanes-pause-gap` |
| 2 | G2 · Plan had no pages opened from nodes | **Applied** as on Goals / Decide / Done: `extra` in state, `openTab(kind, id, name)`, 新标签打开 in the detail's actions (beside 在对话里问 · 打开文件), `onContextMenu` on every square, comb square, label and named row of both maps (Shift+F10 raises the same event). A node page renders the detail as `.detail.is-page` without its own ×; the tab's × returns to the map it came from; a second 右键 on the same node switches to its page. Plan's rail and centre are unchanged (text identical to the approved board in all 48 approved scenarios). Scenarios `v-node-detail`, `v-node-page-task`, `v-node-page-arch` |
| 3 | G1 · past 14:15 the lanes contradicted a stop and the tree | **Applied.** A stop cuts a run whatever the moment (finding 1). Main passes `dataMoment: '10-04 14:15'`: tlData's rows are known up to the moment the tree and the details are taken at. Nothing tlData has later is drawn; a row still going then goes on up to the conversation clock. So with the clock at 14:21, T13 is 执行中 from 14:04 (as in the tree), not handed to its check at 14:17. Scenarios `v-lanes-cancel-moved`, `v-lanes-clock-nostop` |
| 4 | G3 · the 600 tweak lost the approved ≈ 20 000-file stress case | **Applied** (this also answers finding 16 and §18.10 open item 4). At 600, Main's own `archStress()` hangs one clearly marked synthetic folder under Kernel, outside every semantic group: "合成压力数据（不是仓库内容）", 12 `<prefix>-*` folders, 140 packages, 17,504 files in folders of at most 12 (the approved `synthDir` generator). Every node is `synth: true`, and its sem says it is not repository content. The root reads 20,213 files, as on the approved board; the semantic dataset (`arch-semantic.js`) is untouched and pasted verbatim. Only Main has the scale tweak. Scenarios `v-600-arch-stress`, `v-600-arch-stress-pkg`, `v-600-legend` (743 / 1,477 elements) |
| 5, 13 | G3 · rest-line nouns differed; Main called every child of a module 组 | **Applied.** One rule on all five map boards: semantic groups 子模块, real folders 文件夹, slices 段, semantic groups mixed with a folder 组, otherwise 项 — the approved units. Main reads "Host 另 4 个子模块，6 个文件", "WorkGraph 另 12 个子模块 · 受阻 1", "UI 另 4 个文件夹，73 个文件", and AgentRuntime (groups plus a folder) "另 9 个组，31 个文件 · 受阻 1" |
| 6 | G2 · a file page and a node page of one file read the same; tool tabs had no title | **Applied** in `auxtabs.snippet.js`: a node page whose name a file page also has reads "task-machine.ts · 节点". Every tab has a title: 任务图, 架构图, "文件：工作区的目录树", "命令：项目的命令，输出隐藏后仍保留", "Diff：Git（HEAD）↔ 工作区，逐行", a file's full path, "节点详情：name" |
| 7 | G2 · + never opened a new page | **Applied.** With 命令 open, + offers "再开一个命令页（命令 2）". `cmd:2` (3, …) is its own 命令 page with its own runs and output (keys `cmd:2/<id>`), closable like the others; 命令 1 keeps its keys. Scenarios `v-newmenu-cmd`, `v-cmd2` |
| 8 | G1 · 今天 in the 480px panel crowded 13:30–14:15 into 40px | **Applied** (panel only, `full` off): the lanes draw the last three hours up to the next hour (12:00–15:00 at 14:15), with ticks every 30 minutes, and the sum line says "· 轨道从 12:00 画起". The calendar and the sum keep the whole day; an earlier hour is one click on its cell. TaskMap keeps 今天 from 08:00 |
| 9 | G1 · the calendar counted check items | **Applied.** A check run counts once, in the hour it starts (UI-WORKBENCH: 检查的次数). Thresholds are 1–14 / 15–29 / 30–44 / ≥ 45, the words read "检查 8 次", and Main's legend reads "步骤、编辑和检查次数越多越深". A check bar's card still says its items ("检查 14 项") |
| 10 | G2 · the Diff named files no goal-1 task names; verification-machine.ts was missing | **Partly applied; the rest is left for the user.** The Diff lists verification-machine.ts +7 −1 (T21's 4th attempt; Decide q1's lint lines 3 and 88, shown line by line), and its head names the task behind every change ("· 重新入队与失败类别" / "· SSE 推送" / "· 检查不完整判定", as Chain, Member and Decide tell it). The task maps' `files` stay as approved (T13 lists two files, T28 two of its three): adding main.ts and record-codecs.ts would change 当前工作 on six approved boards, so that is the user's call |
| 11 | Decide · the 执行结果待核对 fact's copy had been changed | **Reverted** to the approved `['工作区', '1 个文件有改动，还没提交']`. decide-unknown, decide-attest-step and decide-done-tab now match the approved build |
| 12 | Done · selecting a node drew only its path | **Reverted** to the approved targets (every changed submodule of the delivery, or every working file, plus the selection), the approved note ("本目标改了 n 个源码文件，在 m 个模块") and the approved legend ("点一下画出它的路径"). A selected row that lands under the detail is scrolled into view instead: `revealSel()` runs from `componentDidUpdate`, through a `ref` on `.pbody` and on the row that holds the selection (TaskMap's mechanism). Done's `shoot.mjs` runs the same arithmetic on the static sketch, and its SEL check passes in every shot (done-arch-file scrolls 333px, done-arch-work-slice 177px, done-arch-test 423px) |
| 14 | Decide · rest lines always dropped the file count when something needed attention | **Applied** Main's room rule: the count goes only when the line would not fit its row (panel width in state, depth, compact squares, name). "AgentRuntime 另 8 个组，23 个文件 · 受阻 1" fits at 480 |
| 15 | Done · "4 天 7 小时" / "从 10-02 09:30 开始" differ from the approved copy | **Kept; the user should know.** This is the documented consistency fix of §18.10 (the time view, Member's 09:30 claim and Done agree). No code change |
| 16 | the 600 tweak shows the real repository only | resolved by 4 |
| 17 | informational (no check failures) | nothing to do |

Approved elements touched in this pass, and why: Main's 600 architecture gains the marked synthetic folder (this restores the approved stress case); Plan's detail gains 新标签打开, and its close button hides on a node page (G2, as on the other boards); the Diff's head gains the task name and the Diff gains a seventh file (G2 content against the decision story); Main's lanes legend says 检查次数. Reverted to the approved text: Decide's fact; Done's delivery targets, note and legend; Main's rest-line nouns. One code line on Done had its spacing normalised to the approved source.

Results (WSL, Playwright 1.63):
- `build-all.sh main plan goals decide done taskmap`: every board "build ok; node --check ok", format lint clean, no unknown holes, no non-function handlers, no handler errors.
- `parse-all.sh`: "all boards parse as written" (ArchOverview 254, Chain 256, Decide 605, Done 966, Goals 477, Main 1190, Member 638, Phone 681, Plan 788, TaskMap 323 elements).
- `links.mjs`: "no problems".
- `verbatim-all.mjs`: arch-semantic.js 13/13 methods on Main, Plan, Goals, Decide and Done; timeline.js whole on Main and TaskMap; auxtabs.snippet.js 11/11 on the five (Done's `axRepo` is its hook).
- Against approved-v9: canvas.json, every `data-props`, every `<title>` and the first 43,663 bytes of kit.css are identical; Chain, Member, ArchOverview and Phone are byte-identical.
- Text against the approved builds (`sketch/regress-critic`, approved harnesses on approved-v9): rail and centre identical on Main (57 scenarios), Plan (48) and Goals (27); Decide's centre identical (36). Done's centre differs only by finding 15's span and G3's Host / UI split. The task-map trees are identical; the architecture trees differ by G3 only. TaskMap: tree and side text identical (35 scenarios); its bar differs only by the 轨道 button (G1).
- Scenario PNGs re-shot: Main 122, Plan 77, Goals 63, Decide 64, Done 61, TaskMap 69. Every shot is "ok" with no console problems, and Done's STRIP / SEL checks pass. No browser is left running.

Still open for the user (unchanged by this pass): §18.10 items 1 (task `files` against the Diff; see finding 10), 2 (T40 运行轨道视图 is still a future intent), 3 (BRIEF-V2B 6e in approved copy), and 5–8. Item 4 is closed by finding 4. In item 9, the 今天 crowding is closed by finding 8, and "the lanes follow tlData past 14:16" is closed by finding 3.

## 20. Draft board TaskDAG — 任务图 · DAG 与时间竖条（草案）(2026-10-05 night; review pass 2026-10-06)

A new direction for the user to judge **before anything approved changes**: `project/TaskDAG.dc.html` (`<title>任务图 · DAG 草案</title>`, page 1440 × 1000, `expand: fill`, `is_interactive`, canvas row 看进度与架构 at x 3040). Every approved board, `data/*` and the first 62,164 bytes of kit.css are untouched (published-v11 is the reference); new components are kit.css **§17** (appended). The board links back with `‹ 返回工作台` → `Main.dc.html`, like TaskMap; nothing links to it yet. Tweaks: `theme` (dark / light) and `scale` (40 / 600 个任务). `project/canvas.json` gains this board's entry and its place in the order (needed for the board to appear; the lead accepts it when publishing, or reverts it from `sketch/taskdag/canvas.pre-taskdag.json`).

The user's direction (binding for this draft): U1 the main view is a DAG of goal 1's tasks; U2 semantic grouping stays in 大纲; U3 a task's detail names the architecture nodes it involves (计划要改 / 实际改过) and the work lines that took part; U4 轨道 = work lines (a Session plus the Sessions that continued it after an interruption — never a role, never a person) grouped by 角色 / 模块 / 任务; U5 a draggable time cursor that replays the DAG.

### 20.1 Layout

```
┌ bar 48: ‹ 返回工作台  任务图  DAG 与时间竖条（草案）· 目标 1 …  ■ 运行中 3 条工作线在做 · 1 条在等  DAG 大纲 轨道  图例  ◐ ┐
├ canvas ─────────────────────────────────────────────────────────────┬ right column 380 (--side) ──┤
│ 关键路径  (what it is / the chain when on)        连线：下面的任务需要上面任务的产出 │ 现在 · 10-04 14:15  进行中 4 个 │
│ DAG (scrolls): top = start tasks … the final pieces in one row … 目标验收 │ (with a selection: this one   │
│   ■ 名字   lines from the square's foot to the next square's head      │  line + 展开; else the list:  │
│ ── 未排定 7 · future intents without dependencies or acceptance ──      │  name, state at t, one line;  │
│ 另有已取消 1 个、已替代 1 个任务，不画在图里 · 展开                       │  停着的: 失败 / 受阻)          │
├ dock (DAG view only, fixed 236px of lanes): 角色 模块 任务 · 今天 本周 全部 ┤ detail: the approved four    │
│ 工作线 · 按角色 | 08:00 … [10-04 13:58] 14:00 | ← the cursor            │ rows + 架构 + 参与, actions   │
│ ⌄ 执行者  本段 6 条工作线，最多同时在做 4 条（占 6 行）                     │                             │
│ 检查不完整判定  ▬ ▬ ▬ ……… ▏┆                                            │                             │
│ 回放用示例数据；真实回放需要按时间读取任务状态的接口（编排后端）。草案：…       │                             │
└─────────────────────────────────────────────────────────────────────┴─────────────────────────────┘
```

- **DAG** (default view): the DAG above, the work-line dock below (a fixed 236px of lanes under a sticky axis, so collapsing a group never shifts the DAG), so the cursor and the DAG are seen together. **大纲**: the approved outline (TaskMap's engine verbatim, goal → stage → task rows, its card and relation connector); its states are today's, with a quiet line saying replay lives in DAG and 轨道. **轨道**: the full work-line view — tools, the approved activity calendar and sum line (timeView verbatim), the lanes (scroll under a sticky axis), the cursor and the notes. There is no 树 on this board.
- **Right column** (all three views): the tasks active at the cursor's time — name, state word at t, one line (the attempt or check and how long so far, the stop reason, the decision) — up to 8 + "另 n 个在图里有圈", then 停着的 (失败 / 受阻 at t, up to 4), then the detail of the selection. **While a node is selected the list folds to its head line** ("现在 · 10-04 14:15 进行中 4 个 · 停着 2 个 · 展开", `aria-expanded`), so the detail's 关系 / 架构 / 参与 are in view at 1440 × 1000 without scrolling (40 and 600); 展开 shows the list again above the detail and the column scrolls.

### 20.2 Data

- Tasks, deps, files, agents, sem: TaskMap's `std40()` / `big600()` and the rest of its logic from "vocabulary" to `detailOf()` **verbatim**; `data/timeline.js` and `data/arch-semantic.js` **verbatim**; TaskMap's `tlInput()` verbatim. `sketch/taskdag/assemble.mjs` pastes them and checks each piece occurs exactly once. The pasted agent texts (TaskMap's `taskAgent()` / `goalAgent()`: the two old executors) are **not bound** on this board: every 负责 value the template shows comes from this board's work lines (§20.7).
- Board-local demo data (`draft()`): when a task entered the plan (the rest came with the plan you adopted 10-02 09:30): T16 T17 T39 10-03 18:30, T22–T25 10-04 10:20, T40 10-04 14:13; which consultation or conversation turn was about which task — r11 → 重新入队与失败类别 (Chain: "问过 审阅者 · 规格"); a01, v12, v13 → SSE 推送; **c03, c04 → 检查链与重新检查** (the secretary's plan "检查链重新检查的两个做法" and its revision); c05 → 检查不完整判定 (after 14:15); c01, c02 are about the whole goal; two dropped tasks (旧版失败类别（四类） 已替代, 轮询间隔调优 已取消 — not drawn, only counted, as approved; std40's counts are unchanged); the acceptance node 目标验收; at 600 the stage → stage dependencies (`big600()` chains tasks only inside a stage): S2←S1, S3←S2, S4←S2, S5←S1, S6←S5, S7←S2, S8←S3, S9←S2+S8, S10←S6+S9, carried by every 2nd / 3rd / 4th task of the stage's first batch needing the upstream stage's last task.
- `diffAt1415()` copies `axRepo().changed` of `data/auxtabs.snippet.js` (path, +, −, task); the harness fails the lint if they differ.

### 20.3 The DAG (U1) and the caveats

- **Graph**: a line = a dependency (the lower task needs an output of the upper one). 目标验收 needs every task nothing else needs (its sinks: 取消传播, 失败类别展示, 重新入队验收, 检查链验收, 服务拆分验收). **未排定** = 未来意图 / 已延后 with no dependency, no follower and no acceptance (T34–T40); they sit in a band under the DAG, never at the top as starts. 未来意图 tasks with dependencies (重新验收, 检查链验收, 增量刷新, 服务拆分验收) stay in the DAG.
- **Transitive lines** (40): a → b where b also needs another task that itself (through any chain) needs a — 12 of the 60 (消息写入收口→重新入队与失败类别, 执行事实读取迁移→接续说明, 平台中断识别→启动核对, 重新入队与失败类别→重新入队验收, 检查轮次写入收口→检查链与重新检查, 检查链与重新检查→检查链验收, 检查不完整判定→检查链验收, core-routes 拆分→SSE 推送, 目标展示名→目标展示读取路由, SSE 推送→增量刷新, SSE 推送→服务拆分验收, 任务格子摘要→服务拆分验收). They add no dependency the picture does not already show, so they are **left out of the layout and drawn only when one of their ends is selected or hovered, or when they are on the critical path**; the detail's 依赖 / 后续 always list them, and a hovered item there lights its line. When drawn, a transitive line is routed through each layer it crosses at the free x nearest the straight way between its ends (never through a node; harness: 0 sampled points inside a node box). The legend says so.
- **Layout** (`layered()`, plain JS): longest-path layers (11 at 40), then the tasks whose only follower is 目标验收 move down to the layer right above it, so **the final pieces line up in one row over the acceptance** (取消传播、失败类别展示、重新入队验收、检查链验收、服务拆分验收); a dummy point per skipped layer so a long line runs in its own slot and never through a node (0 sampled points of 60 lines inside a node box), 8 barycentre sweeps, x = the mean of a forward and a backward packing towards the neighbours (both keep the order, so their mean does). 869 × 520 at 40 (was 1,002 wide); 48 lines drawn by default, 1 crossing pair among them (sampled). Node = 14px square at its left, the name beside it (12px, ≤ 112px); lines leave a square's foot and enter the next square's head as S-curves (`pathOf()`); each line is its own `<svg>` sized to its box (format.md: a diagram is placed elements). Nodes, lines and boxes use interpolated `left` / `top` / `width` / `height` (as ArchOverview).
- **Look**: the approved squares (§4) — except 待执行 on this draft (§20.4 rule 3) — quiet `--tree` lines, names `--text-2`. Hover / focus a node → the approved card beside it (name, state word + reason, 归属, 负责, 语义; while replaying the state is the one at t and a 现在 row keeps today's). Click → detail (again → clear); the selection's lines turn `--rel`, its neighbours stay, the rest fades to .3.
- **A line means "needs an output of", not "waits for the whole task"**: hovering a line (a 10px invisible hit stroke) lights it and opens a card "任务格子摘要 ← SSE 推送 · 需要它的产出：<the upper task's 语义>" with the hint "连线表示需要上面任务的产出，不表示要等它整个结束"; hovering a 依赖 / 后续 item in the detail lights its line; the detail adds the sentence once. Lines have no keyboard stop of their own: the same facts are in the detail.
- **No line ≠ safe to run side by side**: the detail's 关系 gains **重叠** — every other task that changes one of its files, "· core-routes.ts（没有连线）" when no line joins them (目标列表接口 ↔ core-routes 拆分 / 目标展示读取路由).
- **关键路径** (a toggle in the tool line): from 目标验收 back along the longest chain of unfinished dependencies (not 已满足, already in the plan at t; ties → the first dependency). Its nodes and lines turn `--lit` (1.5px), the rest fades; the tool line spells it out: "还有 4 个没完成的任务连成一串：SSE 推送 → 任务格子摘要 → 增量刷新 → 服务拆分验收 → 目标验收" (at 10-03 15:12: 前端拆分 → … 5).
- **Cancelled / superseded**: not drawn; one quiet line under the band, "另有已取消 1 个、已替代 1 个任务，不画在图里 · 展开", lists them with the reason.
- **600 tasks**: one box per stage (`.dg-clu`, a surface: square in its folded colour, name, n/m, the card's count line, its batches as a strip of squares), laid out by the same `layered()` (all 14 stage lines drawn: each carries a count); the lines between boxes stand for the task lines they merge, with the count on the line ("6"; hover: "前端拆分 ← 服务拆分 · 合并了 3 条连线"). Click a box's name → it opens (one at a time) into its batches, each a row of ≤ 12 task squares joined in dependency order, and selects the stage; a task square → card / detail. Never 600 loose nodes. Critical path at 600: "还有 145 个没完成的任务连成一串，经过 失败与重新入队 → 会话恢复 → 迁移 → 性能 → 目标验收", lit on the boxes and the box lines. **The cursor does not replay at 600** (§20.6).

### 20.4 States at a time t (U5a) — demo rule

`statesAt(t)` (one comment in the board says the same). **The real system needs a "task states at time t" read from the orchestration backend; this board derives them from the shared runs only to show the interaction** — the note under the cursor says so: "回放用示例数据；真实回放需要按时间读取任务状态的接口（编排后端）".

1. t at or after now (10-04 14:15): the approved state (the board equals TaskMap at now).
2. Before the task entered the plan: drawn faint (`.is-faint`, .38), its plan state, reason "这时还不在计划里（10-03 18:30 加入）".
3. No run of it started by t: 未来意图 / 已延后 / 待执行 stay; 可领取 only if all its dependencies were 已满足 at t, else 待执行. **Not started = hollow** (U5a): on this draft 待执行 is a hollow square with a **dashed** `--grey-text` outline (`.s-notyet`, kit §17.7) — an empty slot in the plan — wherever a task's own state is drawn (DAG nodes and band, their cards, the right column, the detail, the outline's task rows and task strips; group squares keep the approved fills). 可领取 (blue ring) and 未来意图 (solid 1.5px grey ring) were hollow already and stay as approved. It holds at every t, now included, so dragging the cursor off now never flips squares. A 1px solid outline was tried first: at 14px it could not be told from 未来意图 (`shots/taskdag/z-squares.png` shows the dashed result). Approved boards keep the half-filled 待执行 — **a question for the user** (§20.10).
4. A run spans t → 执行中 "第 n 次尝试 · <how it went on>，已 m 分"; a check spans t → 验证中 "正式检查第 n 轮，已 m 分".
5. Otherwise the last bar that ended before t decides: a passing check → 已满足; a failed check → 失败 "检查未通过：…"; a failed run → 失败 "执行失败：…"; an incomplete check → 受阻; 平台中断 → 受阻; paused → 已暂停 (the 10-03 13:40–13:52 pause of 证据链接); handed to its check → 验证中 "已交给正式检查，等检查开始，已 n 分"; ended inside an attempt → 执行中 "第 n 次尝试 · 两段执行之间"; result unknown → 需要你决定 "执行结果待核对"; a 需要你决定 mark after it → 需要你决定.
6. **Active — one rule at t and at now**: 执行中, 验证中 (a check running, or handed over and waiting for it), 已暂停, 需要你决定. Its square gets the 1px `--lit` ring offset 2 and its name turns strong; exactly these tasks are the right column's list (the harness checks rings = list at five moments). Checked moments: 14:15 → 检查不完整判定, SSE 推送, 重新入队与失败类别, 接续说明; 14:03 (right after the Host restart) → SSE 推送 (两段执行之间), 接续说明 and 检查不完整判定 (已交给正式检查，等检查开始); 13:58 → SSE 推送, 检查不完整判定 (执行中), 检查链与重新检查, 重新入队与失败类别 (验证中), 接续说明 (等检查开始，已 2 小时 23 分); 10-03 15:12 (Host restart) → none active, 停着的 前端拆分 受阻 "平台中断：Host 在 15:12 重启"; 10-03 13:45 → 证据链接 已暂停.

### 20.5 Work lines (U4)

- **Model** (`workLines()`): 秘书（主对话）, 架构参谋, 审阅者 · 规格 = one line each (its runs, checks, talks and consultations). **执行者 = one line per task** ("执行者 · <task>"; a Session per task): the two approved executors' runs are split by task; a read-only consultation an executor answered (临时分支 v12, 咨询 v13) sits on the line of the task it was running then. A line's **Sessions** split where a Host restart falls between two of its bars (10-03 15:12, 10-04 14:02): 前端拆分, 重新入队与失败类别, SSE 推送, 接续说明, 检查不完整判定 have 2, 秘书 3 — the same line continues. **On this draft only**; the quiet note says "草案：执行者按任务开工作线；其他画板仍是旧的两位执行者".
- **Grouping** (`wlUnits(by)`): **角色** (default) — 秘书, 参谋, 书记 (none in the data, not drawn), 审阅者, 执行者; a role with one long-lived line is just that row, no header. **模块** — executor lines by the area of their task's first file (WorkGraph, Host, AgentRuntime, UI …, from `semAreas()`), role lines in 对话、咨询与验收. **任务** — one row per task with all its bars in order, whatever Session ran them, plus the consultations and conversation turns about it; groups = stages, talks without a task in 对话（不属于任务）.
- **Packing** (executor groups in 角色 / 模块): a line is **alive** from its first bar to its last (to now while it waits on 需要你决定 or a re-check); interval partitioning by start time puts lines that never overlap into one row, so **rows = the peak number of lines alive at once** (全部 with the archived shown: 16 lines in 6 rows); rows are then ordered by their best-ranked line. **A shared row is named by the line that matters at the cursor's time** — the one active then (it lights), else the one alive then, else its best-ranked line — then "+ n 条已结束" / "n 条在后" (not started yet at t): "检查不完整判定 + 10 条已结束" at now, "前端拆分 + 1 条已结束、1 条在后" at 10-03 15:12; all names, in time order, are in its title; a hairline marks where each line begins; hovering a bar names its Session and task.
- **A group header** reads "本段 6 条工作线，最多同时在做 4 条（占 6 行）": **在做 counts the lines DOING something at once** — a run, a check, a consultation or a turn of theirs spans the moment (a line counts once however many of its bars overlap) — and, for a packed group, how many rows its lifespans need. 任务: "本段 3 个任务，最多同时在做 2 个". Its chevron collapses the group to **one row that draws how many of its lines were doing something at each moment** on the neutral ramp (`.wl-c1…4` = the calendar's greys): idle stretches (waiting for you, waiting for a re-check, between attempts) stay empty, so the row shows when work stopped. Closed, the sentence under the name is the short form "本段 6 条，最多同时在做 4 条" (it fits the 200px column; the whole sentence is the button's title).
- **Order** (inside and between groups): pinned → 需要你决定 > 失败 > 受阻 > 待核对 (a line whose last run's result is unknown, or whose task's reason is 执行结果待核对 — after 受阻) → most recent activity. **The visible set, the packing and the order depend only on the grouping, the window, the pins and the archive switch — never on the cursor** — so nothing moves under the pointer while you drag (harness: scrubbing 全部 and 今天 in 5-minute steps in every grouping gives 1 row layout and 1 set of header texts; only packed rows' names follow the lit line). Pinning a line keeps the order and shows "顺序已变 · 重新排序" in the tools; a click re-sorts. Pins live on role lines (a pin button on hover) and on any selected line (the selection bar).
- **Archived** = an executor line whose task was 已满足 more than a day before now (8 lines; 任务: 13 tasks): hidden behind one bottom row "已归档 8 条（任务已满足超过一天）", a click shows them in their groups (names `--text-3`). **An archived line active at the cursor's time is never inserted**: the 已归档 row lights and names it ("· 竖条处有 1 条在做：执行事实读取迁移" at 10-03 09:40). **Lines with nothing in the window** fold into one quiet row per group ("另 2 条工作线这段时间没有活动", names in its title).
- **Windows** 今天 / 本周 / 全部, the picked calendar hour, the ticks, Host restarts, the bars' shapes and result colours, links, stop marks and wait lines are the approved time view's (§15.8, §18.2; timeView / tlModel verbatim, window rules repeated in `wlWindow()` so the cursor can invert them). Bar card (`.hcard` + `.hc-dl.k3`): 工作线, 记录 ("工作记录第 2 段（Host 10-04 14:02 重启后接续），共 2 段"), 尝试 or 类型, 时间, 活动, hint. In the dock it opens above the dock; on the full page under the bar's row, outside the lanes' scroll. Click a bar → the line is selected (selection bar: name, sessions, since, 固定, ×) and its task becomes the detail.

### 20.6 The time cursor (U5)

- A 2px `--lit` stem through the lanes and a value label on its own row above the ticks (`.wl-cur`, `role="slider"`, `tabindex="0"`, `aria-valuemin/max/now` in minutes, `aria-valuetext` "回放到 10-04 13:58" / "现在 10-04 14:15"). It starts at now. **Pointer**: down anywhere on the axis — or on the stem through the lanes (a 9px grab strip, `.wl-grab`, measured against the same track width) — jumps there and captures the pointer; move drags; up / cancel releases. **Keys**: ← / → 5 minutes (Shift 60), PageUp / PageDown 60, Home = the window's start (or the first run), End = now. It stays inside the window and never passes now; switching the window or picking an hour clamps it. A tick label the stem runs through steps back (.25).
- While t ≠ now: the DAG shows the states at t (§20.4), the active tasks are ringed, tasks not yet planned are faint; the lanes fade every line not active at t (`.tl.focus`); a line is active at t when a bar of it runs then or its task is active then (the same lines the DAG rings); a quiet "现在" marks now; the right column's title reads "回放 · 10-04 13:58"; 「回到现在」 is in the lanes' tools and the right column. **The goal bar** says what the work lines do at the cursor's time: "3 条工作线在做 · 1 条在等" at now (在做 = a bar runs; 在等 = lit without running: waiting for you, paused, handed to its check, between runs), "4 条工作线在做 · 1 条在等（10-04 13:58）", "没有工作线在做 · 3 条在等（10-04 14:03）".
- **600 tasks**: the example has no runs for its synthetic tasks, so the cursor stays at now (`aria-disabled`, greyed label and stem, keys and pointer do nothing, a stale t is ignored and reset when the scale changes) and the tools say "600 个任务的示例没有执行记录，竖条只在 40 个任务时回放". No count mixes replayed and current states.

### 20.7 The detail (U3)

The approved four rows (路径/归属, 负责的 Agent, 语义, 关系 with 依赖 / 后续 / 返工 + **重叠**) and, for a task:
- a second state line while replaying: "在 10-04 13:58：执行中：第 1 次尝试，已 6 分"; the head stays today's state.
- **负责的 Agent** (and the card's 负责, the outline card's 负责) = **the task's own work line at the cursor's time** (`agentAt()`): the line whose run or check of this task started last by t, what it does then, the attempt and the Session — "执行者 · SSE 推送 · 工作中（工作记录第 2 段）", "执行者 · 检查不完整判定 · 等你决定，第 4 次尝试（工作记录第 2 段）", "执行者 · 接续说明 · 正式检查中（工作记录第 2 段）", "审阅者 · 规格 · 已做完", or "未分配，等成员领取；开工时开一条工作线". A stage / batch / goal: "3 条工作线做过这里的任务，1 条在做". At 600 a synthetic task's line is the one the model would open ("执行者 · 执行事实读取迁移 · 工作中，第 2 次尝试"). 目标验收: 审阅者 · 规格 · 待命. So 负责, 参与, 轨道 and the bar card name the same line.
- **关系 while replaying**: 依赖 / 后续 / 重叠 squares are the states at t; a final task's 后续 is 目标验收; a stage's lists are its batches / its tasks active at t; 返工 says "（到现在）".
- **架构** (in the CURRENT semantic architecture, `archSemantic()` + `archAttach()`): "计划要改 2 个文件 · 实际改过 3 个（工作区里还没提交的，带 +/−）", then per semantic crumb (WorkGraph / state, WorkGraph / persistence, Host / server, UI / UI 根目录文件, 支撑 / docs / refactor …) its files (mono) with one tag: 计划要改 · 实际改过 +15 −6（未提交） / 实际改过 +14 −2（未提交）· 不在计划里 / 计划要改 · 任务已满足（没有逐文件记录） / 计划要改. **Rule (prototype)**: 计划要改 = the task's `files`; 实际改过 = only the 14:15 Diff rows whose task is this one (+/−) — the one per-file record the prototype has; a 已满足 task's planned files say "任务已满足（没有逐文件记录）" and claim nothing per file; a task with neither says "还没开始改" or "工作区里没有它未提交的改动；已提交的没有逐文件记录". While replaying the row starts "当前架构、现在的改动（不是 10-03 15:12 那时的）". The file square is the file's state in the architecture (a file only the Diff names takes the task's state). This replaces the approved 关系 · 文件 group on this board (same paths, now placed). A compact list with group crumbs rather than a drawn focused path: the 380px column has room for crumb + file + tag, not for a tree with gutters.
- **参与**: the work lines that ran it, checked it, answered or sent a consultation about it, or talked about it in the main conversation, each a button that selects that line in 轨道 (按角色, its group opened, archived shown, the window widened to 全部 when the line is older than today) with "执行 2 次 · 检查 1 轮 · 工作记录 2 段" / "回答咨询 1 次" / "发出咨询 1 次" / "在主对话里谈过 2 次"; "还没有工作线做过它"; while replaying "到现在为止的参与，不只到 10-03 15:12".
- Actions: 在工作台里处理 (link to Main, for 需要你决定 / 失败 / 受阻), 在轨道里看它的工作线, 在大纲里看 / 在 DAG 里看. The × works for every selection, 目标验收 included.

### 20.8 What the real backend must provide

1. **Task states at time t** — per task (or per goal): state, reason, active flag, attempt / check round at t; also "in the plan since" per task (plan revisions with their adoption times), so tasks not yet planned can be faint. Paged by time window for scrubbing; for large goals too (the 600 example cannot replay).
2. **Work lines** — the Session lineage (which Session continued which after a restart, pause or cancel), each Session's role and task, its runs / checks / consultations with times; archive state.
3. **Files actually changed by a task** — per run or per attempt (committed and uncommitted), not only the plan's `files`; the architecture node each file belongs to now.
4. **Consultation / conversation turn ↔ task** links (which task a question, a read-only branch or a plan discussion was about).
5. **Stage-level dependency counts** for large goals (or the task edges, so the client can aggregate).

### 20.9 Checks and pictures

`sketch/taskdag/`: `build.sh` (guarded: it writes kit.css / DESIGN.md only while each still is "saved prefix + the block it wrote last" — `kit-s17.last.css`, `design-s20.last.md` — and stops otherwise, so nobody's edits are dropped; kit.css = the approved 62,164 bytes + `kit-s17.css`, compared with published-v11; `assemble.mjs`; `build-static.mjs` → `build.log`; `node --check taskdag-logic.check.js`), `shoot.sh` / `shoot.mjs` (Playwright 1.63, file://, nothing left running; checks: no sideways page scroll, no card over its hovered element or past the viewport, no overlapping DAG nodes), `zoom.sh` / `zoom.mjs` (one zoomed crop). `build.log`: format lint clean, no unknown holes, every handler a function, no handler errors (every reachable handler is called in every scenario, 目标验收 selected included); flows for the layout (0 lines through nodes, transitive routes through no node, 1 crossing pair of 48 drawn lines), rings = right list at five moments, scrubbing stability in five grouping × window pairs, packed row names, the collapsed group's numbers, every agent text, the detail while replaying, the critical path, the cursor (pointer, keys, window clamp, 回到现在, off at 600), grouping / packing / fold / archive, the frozen order, the detail of T13 / T28 / T05 / T30 / 目标验收 and its ×, the right column's fold, the 参与 link, 600 boxes. `consistency/parse-all.sh`: TaskDAG parses as written. Backups: `sketch/taskdag/kit.pre-taskdag.css`, `canvas.pre-taskdag.json`, `DESIGN.pre-taskdag.md`. PNGs `shots/taskdag/`: dag-default, dag-crit, dag-hover, dag-hover-trans, dag-edge, dag-sel, dag-sel-detail, dag-sel-open, dag-sel-sse, dag-sel-done, dag-sel-overlap, dag-gate, dag-band, dag-t1512, dag-t1512-sel, dag-t1358, dag-t1403, dag-t1358-crit, dag-t0930, dag-dock-collapsed, outline, outline-sel, outline-hover, lanes-role, lanes-role-all, lanes-module, lanes-task, lanes-collapsed, lanes-collapsed-all, lanes-t1512-all, lanes-t0940-all, lanes-hover, lanes-pinned, lanes-t1358, lanes-sel-line, dag-600, dag-600-open, dag-600-crit, dag-light, lanes-light, dag-narrow, dag-600-light, z-squares.

### 20.10 Review pass (2026-10-06): what changed, what was not taken

Applied: (1) every 负责 on the board and the goal bar come from the work lines (§20.6, §20.7) — the TaskMap paste stays verbatim, only the bound values changed; (2) one active rule at t and now — 已交给正式检查 counts, is ringed and listed with how long it has waited, and 14:03 is a checked moment; (3) the lanes' visible set, packing and order never depend on the cursor, archived lines light the 已归档 row; (4) a packed row is named by the line that matters at the cursor's time; (5) the collapsed group draws lines doing something, the header gives 在做 and 行 separately; (6) the right column folds while a node is selected; (7) 目标验收's detail has its ×, and the harness selects it; (8) 600 does not replay; (10) no per-file claim for 已满足 tasks; (11) transitive lines on demand and the final pieces lined up over 目标验收; (12) the detail's squares are at t while replaying and 架构 / 参与 say they are today's; (13) c03 / c04 / c05 mapped, 参与 names the secretary's turns; (14) 待核对 ranks after 受阻; (16) build.sh is guarded; (17) the dock has a fixed height and the stem can be grabbed.

Taken differently: (9) **not started = hollow** — applied on this draft at every t, but with a **dashed** outline rather than the suggested 1px solid one, which at 14px could not be told from 未来意图; applying it at now too keeps squares from flipping when the cursor leaves now. **Open for the user**: should approved boards also draw 待执行 hollow (it changes the shared square vocabulary §4), or should this draft go back to the half-filled square?

Not changed: (15) `project/canvas.json` keeps the board entry — without it the board does not appear on the canvas and links.mjs fails; the lead accepts it explicitly when publishing, or reverts it from `sketch/taskdag/canvas.pre-taskdag.json`. Also kept: the DAG left-aligned in its column (it lines up with the tool row, the band and the dock's lanes).

Still open for the user: whether the work-line model (one 执行者 line per task) should replace the two executors on Main, Member, Chain, Decide, Phone and Done; whether the DAG replaces 树 on Main's panel (480px is too narrow for this layout: the DAG needs ≈ 870px at 40 tasks, so the panel would need the 600-style boxes or 放大).

---

## 21. Rework 2026-10-06 (user decisions 25-30)

The user approved the prototype on 2026-10-05 (canvas version 9); version 12 added three gap fills and the TaskDAG draft
(§20). On 2026-10-05/06 the user decided 25–30 (HANDOFF top section; 29 is backend only). This section records how the
boards carry them; it **supersedes** the earlier sections where they disagree (§21.12 lists the sentences) and does not
rewrite them. Sources merged here: `sketch/rework/notes-*.md` (shared steps 1–2, every board step, every review fix) and
the integration step (`sketch/integration/`). Backups: `v2/prev/published-v12/` (the frozen v12, which the lead has read),
`v2/prev/pre-rework-1006/` (before the rework), `v2/prev/pre-integration-1006/` (before this last step). The draft is
retired: `v2/prev/retired-taskdag/TaskDAG.dc.html` (byte-identical to v12's), and `project/canvas.json` no longer lists it.

The final critic's findings were applied afterwards (final fix, §21.14); where §21.1–§21.13 below say otherwise, §21.14 wins
(the sentences it changed are corrected in place and marked "final fix").

| decision | in one line | where |
|---|---|---|
| 25 | 轨道 = one row per **work line** (a Session plus the Sessions that continued it), grouped 角色 / 模块 / 任务, executors packed, order taken once, archived lines behind one row, year-style calendar past 14 days, the filter "只看需要关注的" (final fix) | the DAG page's 轨道 (§21.6), Main's panel 轨道 (§21.5); the rails of every board (§21.3) |
| 26 | the task graph's FULL PAGE = DAG (default) + 大纲 + 轨道, a time cursor, a 未排定 band, 600 tasks as stage boxes | `TaskMap.dc.html` (built from the draft, §21.6) |
| 27 | a task that has not started is **hollow** on every board; every state stays apart at every size, lit and dimmed, dark and light | kit §18, `data/squares.js` `sqAt()`, every board (§21.2) |
| 28 | the right panel's 任务图 is a **thumbnail**: 3 levels, open in place, pan, the focus view when it does not fit, 整页查看 → the DAG page | `data/taskpanel.snippet.*` on Main, Plan, Goals, Decide, Done (§21.4) |
| 30 | counts are written apart: 工作中 / 待命 / 已归档, never one "n 位成员" | every rail, goal bar and 负责 text (§21.3) |

### 21.1 What changed per board

| board | 25 / 30 work lines and counts | 27 squares | 28 thumbnail | own changes |
|---|---|---|---|---|
| Main | rail = 11 work lines + "已归档 8 条", head "工作中 3 · 待命 8 · 已归档 8"; goal bar "3 条工作线工作中"; every 负责 from the read API; the read-only branch on any line but the secretary's; 轨道 in the panel (part B). Final fix: at 600 the DAG page's lines (`worklines-long.js`: "工作中 21 · 待命 25 · 已归档 280", bar "21 条工作线工作中"); the rail's order kept and stale like Decide's | every task square, the architecture's file leaves, the conversation and composer refs | part A + B | the detail-height estimate, tick thinning at a narrow panel, the narrow-panel calendar (now kit §18.4), 原因 for a stop reason, the 600 rail note ("执行记录是合成的（08-10 起）" since the final fix), rail names never cut |
| Plan | rail at 14:36 "工作中 1 · 待命 9 · 已归档 9" (after 采用 3 · 7 · 9 — the secretary splitting the plan and 审阅者 · 规格 on the first task, final fix; waiting for goal 1 2 · 8 · 9), goal 2's bar "2 条工作线工作中", the plan card's label 工作线 | tasks, files, the plan card's task lists, refs | part A, `keep` (its own goal → stage → task rows) | 负责 of nodes in a role-kept module names that role's line; rail rows in Main's `.wl-nm` form (final fix) |
| Goals | goal 1 "运行中 · 3 条工作线工作中", its opened row the rail head; "同一时间只让一条工作线改"; the hint "排在前面的先改共享的文件、先开工" | tasks, files, conflict refs | part A, `keep`: one tree per goal, 3 levels, the paths to the shared files as its focus (final fix; was project → goal → stage → task) | `open` → `rowOpen` |
| Decide | rail of its moment (14 rows, "工作中 3 · 待命 11 · 已归档 8"); a decision here moves its line at once and the order goes stale ("顺序已变 · 重新排序"); 与主画面相同 reads Main's moment | queue rows, card heads, refs, tasks, files | part A (+ `TP_FIX`) | 继续 "接在原工作线上"; the q8 answer "…接着用它的工作记录"; rail rows `.wl-nm` (final fix) |
| Done | rail "工作中 0 · 待命 5 · 已归档 25"; usage by role "执行者（27 条工作线）"; an executor line answers for its own task | the delivery's rows, refs, tasks, files; the returned acceptance row dashed after 部分接受, and the goal's own acceptance row too (final fix) | part A (+ `TP_FIX`) | views.ts was written by 执行者 · 增量刷新; rail rows `.wl-nm` (final fix) |
| Chain | the page is the record of 执行者 · 重新入队与失败类别; rail of 14:15 / 14:32; ledger names per line; 等待回复 | the dock's task square | — | two-line rail rows |
| Member | the page of ONE line, 执行者 · SSE 推送; 任务 (was 当前任务); "它依赖的任务的工作线 · 只读" records (final fix; was "其他工作线 · 只读"); 961–1240px rail padding | header, task heads, cards | — | refusal note never breaks a task name |
| Phone | goal bar / list "3 条工作线工作中"; the 13:50 answer says what was true then (1 line) | combs, detail, refs; legend ramp names the filled grey | — | — |
| ArchOverview | 负责 = a file's most urgent task's line; modules count the lines that changed their files; source of `arch-semantic.js` (four owners 未分配) | file leaves; its own dims split (text .3, squares .6) | — | — |
| TaskMap | the DAG page (§21.6) | every task square incl. the DAG, band, 600 chains, right column; a selected chain square has its own mark (final fix) | — (it is the full page) | everything in §21.6 |

### 21.2 Squares (decision 27) — final values

Only a **task's own square** changes: `sqAt(st)` = `'s-' + (st === 'pending' ? 'notyet' : st)` (data/squares.js) — tree and
outline task rows, comb squares of tasks, DAG nodes, card and detail heads, relation and reference squares, strips of
tasks, queue / search / conversation refs, the right column, and an architecture **file** leaf (it takes the most urgent
state of the tasks that touch it). **Group squares** keep the approved rule (§4): goal root, stage, batch, folded group,
folder, module, the share of 已满足 — `s-pending` (filled grey) for a group with nothing done and a goal 规划中.

| token / rule | dark | light | was |
|---|---|---|---|
| 待执行 `.s-notyet` | 1px dashes in `--hollow` `#8F8F8F` (5.5:1 on --side), drawn by four edge gradients on whole pixels: 16 → 4 2 4 2 4 · 14 → 3 2 4 2 3 · 12 → 2 2 4 2 2 · 10 → 2 2 2 2 2 · 8 → 2 1 2 1 2 | `#6B6B6B` (5.0:1) | `s-pending` grey half fill (the draft: `1px dashed`) |
| 可领取 `.s-claimable` | 1.5px `--blue` ring (approved) | approved | — |
| 未来意图 `.s-future` | 2px solid ring `--ring-future` `#6B6B6B` (3.3:1); 1.5px at 8px | `#A3A3A3` (2.4:1) | `--grey` 1.5px (2.6:1 / 1.9:1) |
| dimmed square (focus mode) `--dim-sq` | .6 for every state | .6 | .22 (combs) / .3 (rows, DAG nodes, 600 boxes) |
| dimmed GROUP square in a task map, group-only fill (`s-pending`, `s-done-1`, `s-done-2`) `--dim-grp` (final fix, kit §18.5 a) | .35 | .35 | .6 (the rework) |
| the selection in a 600 box's chain / on a batch square (final fix, kit §18.5 b) | 2px `--text-strong` ring on an `--active` chip | same | the in-progress ring (1px `--lit`) |
| dimmed name / count / reason `--dim-text` | .3 (approved) | .3 | whole rows faded |
| a hollow square on a 600 chain | filled with `--surface` (the line never shows inside) | same | the line ran through it |
| a task not yet planned at the DAG cursor (`.is-faint`) | name .38 (.2 when dimmed), square never below .6 (kit §18.4) | same | node .38, × .6 dimmed = .36 |
| fills, `s-idle` dot | as approved | as approved | — |

**Why**: at the approved .22, dimmed half fills, greys and greens sat at 1.04–1.15:1 on the ground — 38 (dark) and 51 (light)
pairs of same-shaped dimmed squares under ΔE 4; at .6, 4 and 9, all pairs the approved palette already keeps close. Between
~.3 and ~.5 a dimmed full colour looks like a lit half fill (需要你决定 vs 已暂停); at .6 they stay apart (ΔE 7–11.6). Measured in
`sketch/rework/swatch/` (`palette.log`, `fullhalf.log`, `cvd.log`); pictures `shots/rework/sw-*`, `zoom-*`. The group fills
keep their tokens: lifting 都还没做 to `#424242` raised normal-vision ΔE 2.8 → 4.0 but dropped deutan 1.3 → 0.6.

**Still weak** (all approved pairs; the word is in the card and the detail; none involves a hollow kind): dark 部分已满足 /
都还没做 (groups) ΔE 2.8; light 已延后 / 本目标未改动 3.6; dimmed: dark 验证中 / 过半已满足 3.5, 部分已满足 / 都还没做 1.8,
都还没做 / 已延后 3.3; light 已暂停 / 都还没做 2.5, 已延后 / 本目标未改动 2.1, a dimmed 已延后 1.09:1. In the 600 fallback (8px,
dark) a dimmed 已延后 vs ground ΔE 5.5 and vs a dimmed 都还没做 4.3, a dimmed 已满足 task vs a lit 部分已满足 group 4.6 (Main F9).
A lit group with nothing done vs a dimmed one is close too (`s-pending` 1.22:1 dark, 1.13:1 light), and so are the lit green
share squares (s-done-1 1.26:1 / 1.18:1); in focus mode the lit row's strong name and --lit lines carry the path (open
question 6). *Final fix*: in task maps those group-only fills dim to `--dim-grp` .35 — lit vs dimmed 都还没做 1.36:1 dark /
1.22:1 light, 部分已满足 1.43:1 / 1.30:1, 过半已满足 1.77:1 dark; the 架构图 keeps .6 (a touched folder must stay apart from
an untouched one). Light 1.22:1 is still weak; only a fill step (C2) would do more.

**Legends**: 待执行 is the dashed square everywhere; each task-map legend's group line names the filled grey ("…一个都没满足是
灰色"); Main adds "空心的格子是还没开始的任务：待执行是虚线框，可领取是蓝框，未来意图是灰框"; Plan and Goals' 架构图 legend explain the
filled grey folder square; ArchOverview "文件的格子是改它的任务的状态，任务还没开始时是空心的…".

### 21.3 Work lines and counts (decisions 25, 30)

**The model** (`data/WORKLINES.md` §1, `data/worklines.js`, `data/worklines-snap.js`):
1. A **work line** = one Session plus the Sessions that continued it after an interruption. A Host restart opens a new
   Session only where it left a RUN of the line without an end (中断, 没有结束记录); a line that ran nothing at the restart,
   or whose run went on past it, keeps its Session (integration step, option (a) of notes-others-fix.md: Member's single
   record ses_9a31 and Chain's "同一份工作记录 ses_8d10" are right; 前端拆分 keeps its 第 1 / 第 2 段). "成员" is only a projection.
2. Long-lived roles (秘书, 参谋, 书记, 模块维护; in the sample 秘书（主对话）, 架构参谋, 审阅者 · 规格) have one line; **执行者 open
   one line per task**, named "执行者 · <task>". A role's line owns the goal's story tasks whose agent is that role (never
   the 600 example's synthetic ones): it counts the files of those that had started, and its most urgent one that needs you
   ranks the line and (unless the line is at work) gives its word and reason.
3. A read-only consultation sits on the line that was asked; the asking line shows **等回复**.
4. **工作中** (a run, check, consultation or turn spans now) · **待命** (every other live line: 等你决定, 等回复, 已暂停,
   停下（失败）, 停下（受阻）, 已做完, 待命) · **已归档** (an executor line whose task was 已满足 more than a day before).
5. One read API (`wlRail`, `wlOwner`, `wlGroupOwner`, `wlGoalOwner`, `wlAreaOwner`, `wlGoalBar`, `wlLineOf`, `wlHeadOf`)
   live on Main and TaskMap, from a generated snapshot elsewhere (one data method per moment: main, decide, chain, plan,
   done).

**At 10-04 14:15**: 19 lines — 工作中 3 (执行者 · SSE 推送, 重新入队与失败类别, 接续说明) · 待命 8 · 已归档 8; the rail order 秘书（主对话）,
检查不完整判定 (等你决定), 启动核对 (停下（失败）), 检查链与重新检查 (停下（受阻）), SSE 推送, 重新入队与失败类别, 接续说明 (正式检查中),
架构参谋 (等回复), 审阅者 · 规格, 前端拆分, 证据链接 (已做完). 暂停: 工作中 0 · 待命 11 · 已归档 8 (three lines 已暂停); 取消目标: every
unfinished task's line 待命, 架构参谋 still 等回复. 负责 examples: T28 "执行者 · SSE 推送 · 工作中", T21 "执行者 · 检查不完整判定 · 等你决定，
第 4 次尝试", T27 "执行者 · 前端拆分 · 已做完，第 2 次尝试（工作记录第 2 段）", T16 "未分配，等成员领取；开工时开一条工作线", T17 "未分配；
开工时开一条工作线", S3 "4 条工作线做过这里的任务，2 条在做", the goal "秘书 · 待命，另有 3 条工作线工作中", WorkGraph "11 条工作线改过这里的
文件，1 条在做" (审阅者 · 规格's line counts: STATE-MACHINES-SPEC.md, goal-machine.ts), a role-kept module "<role> · <its word>"
(Workflow 秘书, docs 审阅者 · 规格), the system "架构参谋 · <its word>".

**Wording** (WORKLINES.md §4, applied on every board): goal bar "运行中 · 3 条工作线工作中"; 继续 "已继续：3 条工作线从停下的地方接续";
the rail label **工作线** with the counts on its line (title says what each count means); a rail row = dot · name · word, title
"name · word"; expanded 负责 (an executor "任务：<task>", a role its approved duty) / 正在做 (Main: **原因** for a stop reason) /
最近一步; the archived row "已归档 n 条（任务已满足超过一天）" opens the list of names; old executor names → the task's line
(执行者 · 状态机 → 执行者 · 重新入队与失败类别, 执行者 · 服务重构 → 执行者 · SSE 推送 at 14:15; others per WORKLINES "Old name → line");
"等成员领取" kept (it names the role that claims, not a count); 成员页 / 成员卡片 kept (the user's own list). No "n 位成员" remains
anywhere on screen. At 600 a synthetic task names the line it would open; Main's rail says "合成任务的工作线不计入" under the
counts (title: the rail and goal bar count goal 1's real lines only). *Final fix*: at 600 Main and TaskMap read ONE model
(`data/worklines-long.js`: the 8-week synthetic record and its proxy, `wlSrc()`): rail "工作中 21 · 待命 25 · 已归档 280" (46
rows), goal bar "21 条工作线工作中", goal 负责 "秘书 · 待命，另有 21 条工作线工作中", stages "76 / 63 / 45 条工作线做过这里的任务，5 / 4 / 4
条在做" on both boards; Main's note "执行记录是合成的（08-10 起）". Checked by `sketch/final-fix/probe-600-both.cjs` (32 comparisons
at 40 and 600, all the same).

### 21.4 The right-panel thumbnail (decision 28)

`data/taskpanel.snippet.js` part A (`tpThumb`, `tpCard`, `tpDetail`, `tpOwner`, …) + `taskpanel.snippet.html` [0]–[2], on
Main, Plan, Goals, Decide, Done, on each board's own tree engine:
- **3 levels** from the goal (goal → stages → their children on the combs); a click on a folded node opens up to 3 more
  levels under it in place and selects it (a second click folds it); a node that can open keeps a quiet chevron, a comb
  square that holds more has a 4px stub under it (outside the square).
- **Pan**: drag (captured after 5px, so a click still selects; never on a right-click; dropped when the release was lost),
  wheel (Shift sideways); a selection made elsewhere is brought into view; **回到起点** returns and folds what you opened. A
  tree that fits is never measured and never pans; a tree wider than the panel keeps its labels whole.
- **Too big** (opened tree > 1.5 panels): the architecture's 当前工作 pattern — paths to the selection and the most urgent
  tasks, compact siblings, one summary line per level; "树放不下：只画到选中的和最紧要的 n 个任务，其余在小格子里".
- The quiet line "树只按阶段分组，不画依赖；依赖在整页查看" ("…依赖在整页查看；拖动看其余部分" when it pans); **整页查看** →
  `TaskMap.dc.html` (title "整页的任务图：依赖图（DAG）、大纲和轨道"; Plan and Goals: "…目标 1 的依赖图…", since the canvas has one
  DAG page). 大纲 unchanged; 架构图 passes through.
- Plan and Goals keep their own task trees (`keep`): Plan's goal → stage → task rows, Goals' paths to the tasks on the two
  goals' shared files (already the focus pattern; it can draw 4 levels — open question). *Final fix*: Goals' 树 is one tree
  per goal (goal → stage → task, at most 3 levels), the paths to the shared files its focus view; the project row is gone
  from the 树 (the 大纲 keeps it). 整页查看's title names the moment the page opens on Plan, Goals, Decide and Done ("…目标 1 在
  10-04 14:15 的依赖图…" with what differs from the board). The 任务图's viewport carries `is-task` (for kit §18.5 a).

### 21.5 轨道 in Main's panel (decisions 25, 28)

Part B (`tpLanes`, `tpUnits`, `tpConc`, `tpWin`): work lines grouped 角色 (default) / 模块 / 任务; executor lines that never
overlap share a row ("+ n 条已结束"); a group's header "本段 6 条工作线，最多同时 6 条，在做的最多 4 条" (rows = lines alive at once,
k = lines at work at once; integration step, Main F6; the DAG page says it the same way); a closed group is one
concurrency row ("6 条，最多同时 4 条"; final fix: "本段 6 条，最多同时在做 4 条"); a read-only question sits on the line that was asked, running or not (F3: a run may name its line); archived lines behind
"已归档 n 条"; order pinned → 需要你决定 > 失败 > 受阻 > 待核对 → most recent activity (任务: plan order, no pins), taken once when
轨道 opens or the grouping, window, hour, archive switch or pins change, "顺序已变 · 重新排序" when the data moved under it; at
most 8 rows of lines, then "另 n 条 · 整页查看" → TaskMap; sticky axis; calendar, window, ticks, restarts, now and sum lines
are `timeView()`'s; ticks that would touch are thinned at a narrow panel. The year-style calendar is on the DAG page only
(the panel's 全部 never spans more than 3 days in the sample). *Final fix*: the panel reads the board's work-line model
(`src: wlSrc()`), so at 600 its 全部 spans 8 weeks and it draws the year-style calendar (`wlLongView`, the DAG page's: a day →
that day, an hour → that hour, the crumb back); "只看需要关注的" after the window buttons (the lines that need you; in the order
key; the archived row leaves while it is on); a closed group's line is the DAG page's "本段 6 条，最多同时在做 4 条", on two lines
under the name; a bar of a one-Session line has no 记录 row.

### 21.6 The DAG page (decision 26): `TaskMap.dc.html`

Built by `sketch/taskmap-dag/build.sh` (never hand-edited): the frozen v12 TaskMap's vocabulary, std40 / big600, model,
tree engine, cards and detail with 18 documented edits, `timeline.js`, `arch-semantic.js`, `squares.js`, `worklines.js`
verbatim, plus the draft's own code (`src/head.html`, `src/own.js`). `<title>任务图`, canvas title "任务图（整页）· DAG / 大纲 /
轨道", 1440 × 1000, tweaks theme and scale. Main, Plan, Goals, Decide and Done link to it; it links back to Main.
- **DAG** (default): start tasks on top, 目标验收 at the bottom; a line = the lower task needs an output of the upper one —
  never "wait for the whole task", never a claim condition; no line ≠ safe in parallel (same-file overlap listed as 重叠 in
  the detail); 关键路径 toggle; the **未排定** band for future intents with no dependency and no acceptance; cancelled /
  superseded only counted ("另有已取消 1 个、已替代 1 个任务，不画在图里 · 展开"); 600 tasks: one box per stage.
- **Detail**: the architecture nodes a task involves (计划要改 / 实际改过, by semantic crumb; acceptance tasks "没有计划要改的文件
  （验收任务只读报告）", others "还没有计划要改的文件"), the work lines that took part (参与), 负责 from the read API.
- **Time cursor**: drag the DAG to a moment; it shows each task's state then and the right column lists what was in progress;
  a quiet note says real replay needs a backend "task states at time t" read; a task with no run by t keeps its plan state,
  one that ran later is 待执行 "这时还没开始，<time> 第一次执行"; 需要关注 while replaying is labelled 现在 and goes quiet. 600 does
  not replay.
- **大纲** keeps goal → stage → task. **轨道** = §21.5's rules full width, plus decision 25's **year-style calendar** when 全部
  spans more than 14 days (columns = weeks, cells = days on the calendar ramp; a day → that day's 24 hours beside it, an hour
  → its 10-minute ticks; crumb "全部 › 09-09 周三 › 14:00–15:00"). The 600 example carries a synthetic 8-week record
  (`hist600()`, 779 rows; "600 个任务的执行记录是合成的（08-10 起）") so the year view can be seen; at both scales the same shared
  model runs (`wl6()` proxy), so bar, 负责, 参与 and counts agree ("21 条工作线工作中" at 600). *Final fix*: `hist600`, `wlSrc`,
  `wl6`, `wlActs` and `wlLongView` live in `data/worklines-long.js` (Main pastes it too, so Main counts the same lines);
  轨道 has "只看需要关注的"; a long-lived role's line that is quiet in the window keeps its row and name ("这段时间没有活动"),
  never an anonymous "另 1 条…" row; a bar of a one-Session line has no 记录 row; a selected chain square has its own mark.
- **Carried over from the approved TaskMap**: 查找任务, 需要关注, 固定 (double-click, ≤ 3), 图例, the 600 tweak, the back link,
  the selection scrolled into view.

### 21.7 Kit and shared files

kit.css: §18.1 tokens, §18.2 hollow squares, §18.3 focus-mode dims (shared step 1); **§18.4** (integration): the rail's
shared rules (`.rail > *` never squeezed, the wrapping label, the stale hint, the archived row), the narrow-panel calendar,
the DAG's faint squares. The first 83,532 bytes (through §18.3) are unchanged; §17's header ("nothing approved uses these classes") is superseded by §18.4's note: TaskMap uses §17 now. Data files and
generators: `data/README.md` sections "Rework 2026-10-06", "taskpanel" and "Integration step 2026-10-06". *Final fix*: kit
**§18.5** (group squares' `--dim-grp`, the chain selection, the `.wl-nm` rail row, the year grid; §21.14) and
`data/worklines-long.js` (README "Final fix 2026-10-06").

### 21.8 Deliberate drops

- The full-page **树** (square tree) — the DAG page replaces it (26); the tree stays as the right-panel thumbnail (28).
- On the DAG page: 进入这一层 / drill and its crumbs, "在树里展开 / 在树里看"; 轨道 by 成员 / 阶段 (now 角色 / 模块 / 任务) and the
  600 stage-lane fold with "没有执行记录 n"; 需要关注 marks inside 轨道 (its order already puts them first); legend lines about
  the tree.
- Main's old `tl` binding, its 600 stage-lane patch and the state keys `tlBy` / `tlWin` / `tlCell`; `memberWords()`,
  `agentText()`, `goalAgent()`'s fixed text on every board; a stage's owner in the 树 at 详细; the two executors' "我完成了 19 / 8
  个任务" branch replies on Done.
- The TaskDAG draft board (retired, not deleted), its draft notes and "草案" labels.
- Not built (no data, no new features): BRIEF-V2B 6c's 必需/可选 marks, 缺项 and the detail's 「更多」 on the DAG page; 轨道
  filters beyond grouping, window, day / hour and archive. *Final fix*: one filter is built, "只看需要关注的" (decision 25 lists
  filters); no other.

### 21.9 Lead choices the user may overrule

Squares: dimmed squares .6 for every state; 未来意图 a 2px ring; 待执行 dashes as a fixed whole-pixel pattern; group fills
untouched; file leaves use the task vocabulary; the faint DAG square at .6.
Work lines: 待命 counts every live line not at work (the row's word says which); goal bar "n 条工作线工作中"; rail label 工作线;
after 暂停 the working lines read 已暂停, after 取消目标 every unfinished task's line 待命; a stage's owner not shown in the 树;
modules with no long-lived owner count the lines that changed their files; Done's usage by role; "等成员领取" kept; after 采用
the secretary works (Main "工作中 4 · 待命 7 · 已归档 8"; Plan since the final fix "工作中 3 · 待命 7 · 已归档 9", the secretary and
审阅者 · 规格 on goal 2's first task, bar "2 条工作线工作中" — before the fix Plan's secretary stayed 待命 and its 2 · 8 · 9 was another
line); the **Session rule** (option (a));
a role line's word follows its most urgent task (架构参谋 等你决定 on Decide, its own wait kept after the reason); 执行结果待核对
ranks as 待核对; Main's **原因** for a stop reason (the other rails still say 正在做); Main's 600 note; the paused reply
"你暂停了目标；暂停时…"; Decide's 继续 "接在原工作线上" and q8 "…接着用它的工作记录"; Phone's 13:50 answer; Member's 1px row padding
at 961–1240px and `keep-all` on the refusal note; ArchOverview: a file's 负责 = its most urgent task's line, a dimmed node keeps
a faint ground; Plan's two scopes of counting (goal bar = goal 2, rail = project); Goals' hint "…先开工".
Thumbnail: the 1.5-panel fallback threshold; fallback targets = selection + most urgent; 回到起点 also folds; can-open marks;
the card inside the viewport; labels whole and pannable on a narrow panel; Plan's / Goals' 整页查看 title names goal 1.
轨道: 8 rows count rows of lines; pins only on single-line rows; the closed group's short line; a 132px name column; the
packed header "最多同时 r 条，在做的最多 k 条".
DAG page: 查找 / 需要关注 / 固定 back; a found stage keeps its tasks bright; the replay rule for unstarted tasks; "· n 条在等" only
while replaying; 目标验收's 负责 = 审阅者 · 规格's line; cards near the bottom open upwards; the 8-week synthetic 600 record; the
year grid stays at day / hour level; archived lines that worked on a picked day are drawn; a day's level = ten hours.
Final fix (notes-final-fix.md, "Lead choices"): Main's 600 rail lists all 46 live lines and reads "执行记录是合成的"; the panel
draws the year calendar at 600; `--dim-grp` .35 for group-only fills in task maps, the 架构图 at .6; the chain selection (2px
`--text-strong` ring on an `--active` chip, it wins over the in-progress ring on one square); Goals' 树 one tree per goal;
"只看需要关注的" after the window buttons, the archived row hidden while it is on; the closed group's two-line line; quiet
long-lived role rows keep their names; Main re-ranks an executor line only when its task's rank changed; Plan's secretary
工作中 after 采用 in every variant but 取消; the literal 整页查看 titles. **已延后 / 已取消** share one flat faded grey on purpose
(both shelved; the word is in the card and the detail; 取消目标 turns deferred tasks into 已取消 too, so the two do not meet on
Main; a hairline step would collide with `s-none`'s). The light **未来意图** ring `#A3A3A3` is 2.4:1 on `--side`, under 3:1 on
purpose (intent recedes behind the dashed 待执行, 5.0:1); `#8A8A8A` would give 3.2:1.

### 21.10 Open questions (for the user or the lead)

*Final fix*: 1 answered (Main's `.wl-nm` on the list rails: Main, Plan, Decide, Done; Chain / Member keep two-line rows);
2 answered (the 3-level thumbnail, one tree per goal, the shared-file paths as its focus); 3 kept and extended to Decide and
Done (literal titles that name the moment); 4 answered ("只看需要关注的"); 6 partly (group-only fills dim to .35; C2 not
applied — still the user's call); 8 answered (`data/worklines-long.js`). New: a 46-line rail at 600 — keep it whole or fold
the 待命 lines past a count (a new rule)?

1. **One rail row form.** Three remain: the word drops under the name when it does not fit (Main, Decide, Done; Main's
   `.wl-nm` variant also never cuts a name at the 208px rail, Decide / Done's flex-wrap cuts two by a few px there); one line,
   the name cut with an ellipsis (Plan); name then word on two lines (Chain, Member). Recommendation: Main's `.wl-nm` for
   the list rails; Chain / Member's two-line form is a page-of-one-line layout and can stay.
2. **Goals' 任务图**: keep its story view (paths to the shared files, up to 4 levels) or the 3-level thumbnail with the
   overlap paths as its focus view.
3. **整页查看 from goal 2** (Plan, Goals): the canvas has one DAG page (goal 1 at 14:15); a real app opens the goal and the
   moment shown. Make the link title a per-board hole in the snippet, or keep the two literal copies.
4. **轨道 filters** (decision 25 lists "filters"): lead suggestion, if one is wanted, a "只看需要关注的" toggle beside the window
   buttons.
5. **A dimmed 已延后 / 已取消** in the 600 fallback (Main F9): accept (recommended), or a 1px `--grey-half` inset hairline only
   while dimmed (then check it against `s-none` on the 架构图).
6. **Lit vs dimmed group squares** (Plan / Goals review finding 10): a lit `s-pending` group is 1.22:1 / 1.13:1 from a dimmed
   one, a lit s-done-1 1.26:1 / 1.18:1. Candidate C2 — a lit 都还没做 group one grey up (`--grey`) — was previewed
   (`sketch/rework/plan-goals-fix/trial/shots/dim-dim-*-c2.png`) but **not applied**: as a kit rule on `.tr.on … .sq.s-pending` it
   would also turn a goal's own 规划中 square grey on the lit path (Plan's root before 采用, goal 2's row in Goals' tree), which
   must keep the goal's state square (§4). It needs the engine to mark goal rows first. Is the lit row's name and line enough?
7. **"等成员领取"** (kept) or "等工作线领取"; the Member board's title 成员页 (kept).
8. **Main's 600 panel** still says the 600 example has no records while the DAG page carries the synthetic record: move
   `hist600()` (or a parametrised model) into `data/` so the panel reads it too?
9. **A role page** (秘书, 架构参谋, 审阅者 · 规格) would use Member's layout; only the executor line is drawn.
10. **原因 vs 正在做** for a stop reason: carry Main's 原因 to Decide, Plan, Chain and Member, or revert Main.

### 21.11 Backend needs (adds to §20.8)

Per-day and per-hour activity for the whole life of a goal (steps, edits, check items, active tasks and lines), paged by
time; the runs of one day or hour on demand; the Session lineage with each restart's effect on each run (ended or cut);
which tasks a long-lived role owns; task states at time t (already §20.8 item 1).

### 21.12 Earlier statements this section supersedes (pointers, not rewrites)

- §1 "Main's links … 看工作记录 → Chain (执行者 · 状态机's row), 打开成员页 → Member (执行者 · 服务重构's row)" → on 执行者 · 重新入队与失败类别's
  and 执行者 · SSE 推送's rows; 整页查看 → TaskMap is the DAG page.
- §3 / §6.2 the rail sketch: the label is 工作线 with the counts; rows per §21.3; the archived row; `aria-label="项目、目标与工作线"`.
- §4 the `s-pending` row (待执行) → `s-notyet` for a task, `s-pending` for a group with nothing done or a goal 规划中; `s-future`
  "grey · outline" → a 2px ring; "After 取消目标 the two executors show 待命" → every unfinished task's work line shows 待命.
- §5 / §7 "Stage owner in the tree: shown at 详细 / 完全展开" → not shown; §7.3 "everything else fades: rows .3, squares .22" →
  names .3, squares .6.
- §6.6 "运行中 · 2 位成员工作中" → "运行中 · 3 条工作线工作中"; "发给：执行者 · 状态机 · 临时分支（只读）" → "发给：<line> · 临时分支（只读）".
- §6.8 the 负责 rows (agentText, memberWords) → the read API (§21.3).
- §15.8 / §18.2 轨道 "one lane per member or stage" → one row per work line (§21.5, §21.6).
- §20: the draft is retired; TaskMap is the DAG page (§21.6); §20.10's open questions are answered by decisions 25–28.
- Final fix (§21.14): §21.3 "Main's rail says 合成任务的工作线不计入" → both boards count the 600 record's lines; §21.4 "Goals … can
  draw 4 levels" → 3 levels, one tree per goal; §21.5 "The year-style calendar is on the DAG page only" → also in the panel
  at 600, and the closed group's "6 条，最多同时 4 条" → "本段 6 条，最多同时在做 4 条"; §21.8 "轨道 filters … not built" → one
  filter built; §21.9 "Plan 工作中 2 · 待命 8 · 已归档 9" after 采用 → 3 · 7 · 9; §21.1 Member's "其他工作线 · 只读" → "它依赖的任务的工作线 ·
  只读".

### 21.13 Integration step — what it did, checks, what was not checked

**Did** (`sketch/integration/`, backups `v2/prev/pre-integration-1006/`): the shared requests of the notes (S1 timeline labels and
member names, S2 module owners, S3 the old name in the auxiliary files, the Session rule, role lines' files / rank / word
(S-1), F3 a question on the line that was asked, F6 the packed header, Plan / Goals' thumbnail fixes and narrow-panel CSS),
re-pasted on every board (data/README.md "Integration step 2026-10-06"); kit §18.4; TaskDAG retired from `canvas.json` and
moved to `v2/prev/retired-taskdag/`; TaskMap's canvas title; `consistency/build-all.sh` builds `sketch/taskmap-dag`
(`sketch/taskmap` is the approved TaskMap's harness and no longer builds against the page); the board edits that came with
the shared changes: Main's talkRuns (F3), Main's COMMON `wlRoleRow` (starts from `base`, as Decide's and Done's), Decide's
q8 answer (one Session), Done's own `axRepo` (S3), TaskMap's packed header (F6). One Main harness scenario was added
(`ix-branch-t21-lanes`). Candidate C2 (a lit 都还没做 group one grey up) was tried in kit and taken out again (§21.10, 6).

**Checks** (WSL, node 24, Playwright 1.63 headless, file://; nothing left running; logs in `sketch/integration/`):
- `rework/gen/check-worklines.mjs` 32,749 comparisons, 0 differ (the retired draft with the new Session rule in memory);
  `gen-snapshot.mjs` 843, 0 differ; Main's rail at 40 and 600 tasks before / after the step: the same rows, words and order
  (`probe-rail600.cjs`).
- `consistency/build-all.sh`: all ten harnesses build, `node --check` ok, format lint clean, no unknown holes, no
  non-function handlers, no handler errors. Flows against the logs taken before the step (`flowdiff/`): only the intended
  differences — "（工作记录第 2 段）" gone where a line has one Session; WorkGraph 10 → 11, state 5 → 6, goal-machine.ts and 支撑
  count 审阅者 · 规格's line; S3 texts; Plan / Goals: no flip, no sticky drag, the fitting tree does not pan; Main's question to
  检查不完整判定 lands on its line; the packed header. Decide vs Main (`decide-done-fix/vs-main.mjs`): all the same.
- `consistency/parse-all.sh`: all ten boards parse as written. `links.mjs`: one PROBLEM, "order differs from boards" — it
  compares `order` with the key order of `boards`, which the canvas writes alphabetically; v11 fails it too; `order` and
  `boards` hold the same ten boards. No board links to TaskDAG.dc.html.
- `consistency/verbatim-all.mjs`: every board as before the step (Goals' "NOT whole" and Done's `axRepo` are their own
  documented copies). `xcheck/final-xcheck.sh`: every board rebuilt independently (its pre-step copy + the literal re-paste of
  each changed data file + the board edits above) equals `project/` byte for byte, ten of ten.
- Shots: Main 207 (+1 new), Plan 91, Goals 79, Chain 40, Member 42, Decide 82, Done 73, Phone 49, ArchOverview 51 (through
  `rework/boards4/shoot-board.sh`; its own shoot.sh would re-extract the repository's data), TaskMap 77 + 34 crops, and 10
  integration crops `shots/rework/integration/zoom-*` — all "ok", no console or page errors. Looked at: Main tp-40-dim,
  main-legend (600), ix-branch-t21-lanes, the crops of the dimmed tree, the 600 rail and the panel's 轨道; Plan rw-rail-open
  and the dimmed tree in light; Goals rw-legend-task and the narrow pan; Done's tree after 部分接受; TaskMap dag-default.

**Not checked**: the canvas runtime (static sketches and handlers in node only); real pointer capture, wheel and drag;
colour-blind simulation; window sizes other than the harnesses'; `rework/swatch/append-kit.sh` now stops by design (kit.css
has §18.4 after its §18 source); the board steps' own crop sets of Decide, Done, Chain, Member, Phone and ArchOverview were not
retaken (no square changed in this step; the integration crops cover Decide's and Done's trees).

### 21.14 Final fix — the final critic's findings (2026-10-06)

Source: `sketch/rework/notes-final-fix.md` (each finding, its evidence, the numbers, the checks). Backups:
`v2/prev/pre-final-fix-1006/`. Scripts and logs: `sketch/final-fix/`. Crops: `v2/shots/final-fix/z-*.png`. Sixteen findings,
all applied (none rejected); the last one arrived cut off and is applied as read.

| # | finding | became |
|---|---|---|
| 1 | 600: Main and TaskMap counted different lines (3 vs 21 at work) | `data/worklines-long.js` (hist600, wlSrc, wl6, wlActs, wlLongView) on both; Main's rail, goal bar, 负责 and panel 轨道 read `wlSrc()`; the panel draws the year calendar when 全部 spans 8 weeks; Main's note "执行记录是合成的（08-10 起）"; `probe-600-both.cjs` 32 / 32 the same |
| 2 | lit vs dimmed group squares ~1.2:1 | kit §18.5 (a): group-only fills dim to `--dim-grp` .35 in task maps (panel `.tp-view.is-task`, DAG page 大纲 and 600 boxes, phone 进度); fills unchanged; 架构图 unchanged |
| 3 | 600 chains: selection = in-progress ring | kit §18.5 (b): 2px `--text-strong` ring on an `--active` chip |
| 4 | Goals' 任务图 drew 4 levels | one tree per goal, 3 levels, the shared-file paths as its focus; the 大纲 keeps the project row |
| 5 | 轨道 filters not built | "只看需要关注的" on both 轨道 (state `wlAttn`, in the order key) |
| 6 | the closed group's short line ("最多同时" twice, cut) | "本段 n 条，最多同时在做 k 条", two lines in the panel |
| 7 | "工作记录第 1 段" on a one-Session line | no 记录 row then |
| 8 | anonymous "另 1 条…" rows on a picked day | a quiet long-lived role keeps its named row |
| 9 | Main's rail never went stale | Decide's `wlArrange`, `railOrder`, "顺序已变 · 重新排序" on Main |
| 10 | Done's waiting goal acceptance filled grey, the DAG dashed | `sqAt` there too: dashed |
| 11 | Plan cut line names; three rail forms | `.wl-nm` (kit §18.5 c) on Plan, Decide, Done; Chain / Member keep two-line rows |
| 12 | §21.9 said Plan's secretary works after 采用; it did not | Plan's secretary 工作中 "把方案 A 拆成任务" after 采用 (as Main); §21.9 corrected |
| 13 | Member's "其他工作线 · 只读" unexplained | "它依赖的任务的工作线 · 只读" |
| 14 | Done / Decide's 整页查看 opens another moment silently | the titles on Plan, Goals, Decide, Done name the moment and what differs |
| 15 | 已延后 / 已取消 one token; light 未来意图 2.4:1 | recorded: a deliberate pair, a lead choice (§21.9) |
| 16 | (cut off) static sketches' captions name a stale line | Goals `g2-conflict`, Decide `gap-file-conflict`: 执行者 · SSE 推送 |

Kit: §18.5 appended (the first 86,425 bytes unchanged): (a) `--dim-grp`, (b) the chain selection, (c) the work-line rail row,
(d) the year grid (also used in the panel). Data: `worklines-long.js` (new), `taskpanel.snippet.{js,html}` (part A `tpThumb`
is-task, `tpOwner` src; part B src, year view, filter, closed line, 记录 row; [0] PART B, [3]), README "Final fix 2026-10-06".

**Checks**: `build-all.sh` ten of ten clean (lint, holes, handlers, `node --check`); `parse-all.sh` all boards parse;
`links.mjs` only the known "order differs from boards"; `verbatim-all.mjs` taskpanel A 7/7 everywhere, B 4/4 + whole on Main,
worklines-long.js whole 5/5 on Main and TaskMap; `final-fix/pieces-check.mjs` every snippet piece pasted once; TaskMap's
static sketches byte-identical after the move alone. Shots: Main, Plan, Goals, Decide, Done, Member, Phone, TaskMap in full
(no console or page errors) + TaskMap's zooms + 27 crops.

**Not checked**: the canvas runtime (static sketches and handlers in node only); real pointer, wheel and drag; colour-blind
simulation of `--dim-grp`; window sizes other than the harnesses'; Chain and ArchOverview were not re-shot (their markup did
not change and §18.5's selectors do not reach them).

## 22. 点工作线，中间切到它的对话（决定 33，2026-10-06）

The user, on canvas version 14: "为什么我点击左边的那些角色的卡片，我不能够直接跳转到他那边的对话？然后我也发现不了他那边的对话可以被我
进行交互。" (repo HANDOFF decision 33, UI-WORKBENCH §0 item 13). In version 14 a click on a work line only expanded a summary in
place; only two lines had a page. That missed an older confirmed direction (UI-WORKBENCH §1 item 2: the centre is a classic
Session view that switches between the main conversation and a named line's conversation). This section records how the six
boards with a work-line rail carry the decision. It **supersedes** the earlier sections where they disagree (§22.8 lists the
sentences) and does not rewrite them.

Sources merged here: `sketch/lineview/notes-shared.md` (the shared step), `notes-main.md`, `notes-plan.md`, `notes-chain.md`,
`notes-member.md`, `notes-decide.md`, `notes-done.md` (the board steps and their fixes after the independent verification),
and the integration step (§22.4, `sketch/lineview/integ/`). Backups: `v2/prev/published-v14/` (the published version 14, with
SHA256SUMS), `v2/prev/pre-lineview-1006/` (before the shared step), `pre-lvfix-main-1007/`, `pre-lvfix-cm-1007/`,
`pre-lvfix-dd-1007/` (before the verifier fixes), `pre-integ-lv-1007/` (before the integration: project, data, DESIGN.md, the
harnesses; SHA256SUMS).

### 22.1 What the user sees now

- **The rail.** A click on ANY work line switches the centre to that line's conversation. 秘书（主对话）'s row is the main
  conversation itself: its row brings you back. The row whose conversation is in the centre is marked current (`--active`,
  `aria-current`); so is 秘书's while the main conversation shows. The archived names are buttons too and open their line
  read-only. The summary the click used to expand is now the row's **hover / focus card**: dot and name (wrapped, never cut),
  the word and, while it works, its live line ("工作中，正在运行命令：状态机单元测试"), then 负责 · 正在做 or 原因 · 最近一步, and the
  hint "点一下在中间打开它的对话" / "它的对话在中间" / "点一下回到主对话". The card opens under the row inside the rail, or above it
  when the rail has no room under the row (measured when you hover or focus it).
- **The head.** "‹ 回到主对话 / <line name>  <goal>  整页查看 ▯" — on Decide, Chain and Member the back row returns to what
  the centre showed: "‹ 回到需要你决定", "‹ 回到 重新入队与失败类别", "‹ 回到 SSE 推送" (final fix, §22.9). 整页查看 exists only for
  执行者 · SSE 推送 (Member.dc.html) and 执行者 · 重新入队与失败类别 (Chain.dc.html), and only on the boards of their moment (Main,
  Decide, Chain at 14:15, Member: not Plan, Done or Chain at 14:32, §22.9); no other page is faked. Where the centre is 640px or narrower (the narrow layout,
  961–1240px, or a divider dragged) the head takes two rows: the back row with 整页查看 and the panel button, then the name and
  its goal. Nothing is cut or hidden.
- **The facts and the controls.** 状态 · 任务 (or 负责 for a long-lived role) · 尝试 · 工作记录, then 正在做 / 原因 (最近一步 for an
  ended line). 暂停 / 继续 / 取消 / 重新入队 only where they apply: while a run of the line goes on (暂停 → 已请求暂停，等安全点 →
  已暂停，可继续 → 继续; 取消 asks first → 已请求取消 → 已取消 → 重新入队 with 接续说明); none during a formal check, none while
  the goal is paused or cancelled (the goal bar holds every line: a line it holds reads 原因 你暂停了目标 / 目标已取消，记录保留, and
  its record ends with a line saying where to go on, §22.9); a role's line 暂停 / 继续 only. Each has its approved hover
  card. Where the centre is 440px or narrower the controls go under the facts. A paused line's 正在做 is the run you started
  (live or stopped by your pause), else the step it was on, on every board (§22.9).
- **The record.** The line's Session and the Sessions that continued it, as the conversation's rows: day lines, the run rows
  (open to their steps where the board has them, else "步骤 n · 编辑 m；每一步在整页查看 / 每一步的记录在原型里没有收录"), one quiet
  row per check, read-only consultation and turn, attempt and Session separators, the marks ("自动返工已达上限（3/3），需要你决
  定" — while the line waits for you, a .ref to 需要你决定, §22.9), and the direct interventions you sent it before the moment, as
  your bubbles with their track, reason and reply (§22.9). The newest rows are at the bottom and in view.
- **The composer.** It talks to the line. **问一问（只读）**: a read-only copy branched from its context answers ("正在建立咨询…"
  while it is made, then the answer under "<line>（只读副本）"); it never disturbs the line. **直接干预**: a message to the line
  itself, 已排队 → 已送达 (at its next safe point; each click on the track is the next safe point) → 已生效 / 被拒绝. It also sets an
  idle line to work ("处理你的直接干预"). A line that **waits for your decision** keeps the message 已排队 ("等你决定：你在「需要你
  决定」里处理后，在第一个安全点送达"). A **refused** message ends the run that handled it ("处理你的直接干预，不改，接着做原来的任务") and
  the line goes back to its task ("正在执行：接着做 SSE 推送"). Every conversation you open starts on 问一问（只读）. Each keeps its own
  draft per mode and its own quotes (引用到草稿 from a file page goes into the draft in the centre and with what you send).
- **Read-only lines.** An archived line, and a line whose task is 已满足: 问一问 only, from its saved record ("这份副本从它保存的工作
  记录回答，不会重新打开它"), 直接干预 off with its card saying why, and a banner ("已归档：…" / "工作已结束：…").

### 22.2 Per board

| board | moment (read API) | back row | 任务 fact | what the board still does on its own |
|---|---|---|---|---|
| Main | 10-04 14:15 (`worklines.js`; `wlSrc()` at 600) | button | button to its map; plain (name + square, "600 个任务的任务图里没有这个任务") for a story task the 600 map does not draw | CARRY's approved texts as the line objects (负责, 正在做 / 原因, 最近一步, live line, the 问一问 answer while nothing changed); a question's copy answers in the next minute on Main's clock so 轨道 draws the consultation (`lvAttach`); a line's own 暂停 / 取消 / 重新入队 reach its task in the map, the counts and the detail's 负责 (`lvTaskOv`, `lvOwnerOf`); a decision on the card writes into the line's record; a scale change closes a line the new rail does not have |
| Plan | 10-04 14:36 (`wlSnapPlan`) on its own clock | button (its centre is the secretary's goal-2 conversation) | the name only (its maps hold goal 2) | 审阅者 · 规格's goal-2 work as rows of its view's log (`g2Start`, `g2Hold`: the goal bar holds the line); the card keeps that run's live line; a line's own pause reaches 布局规格 in the map; goal 2's row is a button back while a line is open; the rail counts and the main head's subs never cut (its v14 fixes) |
| Decide | 10-04 14:15 (`wlSnapDecide`) | button: 回到需要你决定, its queue (§22.9; was a link to Main) | button to its map | a decision in the queue moves its line and is the line's newest row (`lvRecNow`); a line its queue asks about is held under any word, and a paused task's line gets the item's own 继续 / 取消 (`lvHold`, the shared words); 秘书's row is a link to Main; a map click with a line open only selects |
| Done | 10-06 16:33 (`wlSnapDone`) | button | button to its map | the role lines take 直接干预 (they are 待命); every executor line is read-only; the approved executor answer for every line, archived ones too; no 整页查看 (the two pages show 10-04) |
| Chain | 14:15 / 14:32 (`wlSnapMain`, `wlSnapChain`) on its own clock | button: 回到 重新入队与失败类别, the record (§22.9; was a link to Main) | link to Main's task map | the page is 执行者 · 重新入队与失败类别's record: its own row brings the record back (轨迹 and the selected record kept); two-line rail rows; 秘书 a link to Main; 轨迹 hidden while another line is open |
| Member | 14:15 (`wlSnapMain`) on its own clock | button: 回到 SSE 推送, the page (§22.9; was a link to Main) | link to Main's task map | the page of 执行者 · SSE 推送 (its own 临时分支问一问（只读） / 直接干预 as approved); its own row is a button and brings the page back; the right column (its 工作记录 / 改动) hidden while another line is open; a click in a line view settles this page's derived records too |

Unchanged: Goals, TaskMap, ArchOverview and Phone (they re-paste the read-API files only, §22.4).

### 22.3 Approved elements this decision changed (and why)

- The rail's click expansion (`.row-more`) is gone; its rows are the card. Main's and Done's 临时分支问一问（只读） in the rail and the
  composer's "发给：<line> · 临时分支（只读） ×" line are gone: 问一问（只读） is in the line's own composer. Main's row links 看工作记录 /
  打开成员页 are 整页查看 in the line's head.
- 秘书（主对话）'s row is lit while the main conversation shows (a row is now the switch between conversations); two rows are lit
  then (the open goal, the open conversation).
- Member's own row is a button (it was a static current row); Chain's and Member's 秘书 rows stay links to Main.
- **执行者 · SSE 推送 at 14:15 runs 运行命令 · SSE 推送相关测试** on every board of that moment (Main, Decide, Chain, Member), as its
  own page shows (the edit of server.ts was a minute ago, 最近一步). Main's and Decide's approved live line said 正在编辑
  src/app/server.ts; Chain's fix step and the integration aligned them with the page 整页查看 opens. Plan (14:36) and Chain at
  14:32 keep 编辑 src/app/server.ts.
- Main with the goal cancelled: SSE 推送 and 重新入队与失败类别 say 原因 目标已取消，记录保留, as the other executors (version 14 said
  正在做 第 n 次尝试 under 待命).
- Plan: the rail counts drop under the label instead of being cut, and the main head drops its subs one by one under 540 /
  460px of centre (version 14 cut both in the narrow layout).
- Done: 审阅者 · 规格's card says "完成 · 8 个任务，其中 5 项验收" (the expansion printed 完成 twice).
- Member's own "正在建立咨询…" (`.cw-wait`) ends with a 0s animation (a 1ms one never hid in Chromium); its look and words are
  unchanged.
- Decide: a map click with a line open only selects (the decision card would open hidden behind the line view).

### 22.4 The integration step (2026-10-07)

After the verification each board had its own copy of the same fixes. The integration moved them into the shared files and
every board re-pasted those whole; `sketch/lineview/integ/integ-boards.mjs` rebuilds each board from the one its own step
left (`v2/prev/pre-integ-lv-1007/project/`), every edit a literal replacement that must match once (58 edits, `integ-boards.log`).

| shared need (notes) | now | board copies dropped |
|---|---|---|
| the spinner never hid and printed over the answer (all six) | kit §19.5: keyframes hidden at both ends, 1ms, `forwards`, its grid place on itself (Main's and Plan's rule) | Main (a), Plan (a), Chain / Member `0s both`, Decide / Done `100ms steps(1, end)` |
| `>` rules across an `<sc-if>` of [3] (Main, Plan) | kit §19.4 / §19.5 as descendant rules | Main (b), Plan (e) |
| the name cut / the goal a sliver in the narrow head (all) | kit §19.2: the centre `.kit.app > .main` is a query container, two rows under 640px | Main (c), Plan (b), Decide / Done's media rules (icon-only 整页查看, the goal dropped at 961–1100px) |
| the facts one per row at ≤1000px (Main) | kit §19.3: under 440px of centre the controls go under the facts | Main (d) |
| the card cut a long name (all) | kit §19.1: the name wraps | Main (e), Chain, Member, Decide, Done |
| a long step cut under its verb (Chain, Member, Decide, Done) | kit §19.4: a step's words wrap, a path keeps one line (Chain's and Member's values; a one-line step sits where it sat) | Chain, Member, Decide, Done |
| the "·" of a result word alone at a line end (Decide, Done) | kit §19.4: word joiners | Decide, Done |
| the plain 任务 fact (Main 600, Plan) | [3]: `lv.task.isBtn / isLink / isPlain`; `o.hasTask`, `o.noTaskTip`; kit `.lv-task.is-plain` | Main (f) and its `canGo / noGo`, Plan's facts patch |
| the 任务 fact as a link to Main (Chain, Member) | [3]'s `isLink` (`o.taskHref`) | their [3] variants (both now paste [3] whole) |
| 直接干预 to a line that waits for your decision (Main, Chain, Member, Decide) | `lvView` st `'decide'` | `lvHoldDecide` (Main, Chain, Member); Decide's `lvHold` keeps its extension in the same words |
| the line never went back to its task after 被拒绝 (Main, Plan, Chain) | `lvView`'s advance | `lvAfterRefusal` (Main, Plan, Chain); Decide gains it |
| the mode carried over to the next line (Main, Plan, Chain, Member) | `lvLeave()` and the rail's pick | Plan / Chain / Member's `set` wrappers, Main's `lvSwap`; Decide and Done gain it |
| the card ran past the window (Main) | `lvCardUp` (measured), `lvHoverUp` | Main's `upRow` |
| an archived card lost its 正在做 row (Chain, Member) | `lvRail` keeps `L.doing` for an archived line | their patches |
| a question being made replayed its spinner after a decision (Main's `lvSwap`) | `lvLeave()` settles it (`lvCur`) when a line was open | Main's `lvSwap` |
| the quotes and reference of the composer (Main's [3] diff) | quotes per conversation and with what you send on every board with the auxiliary area (`lvSwapTo`, `lvKeep`, [3]'s quote rows and bubble quotes, kit §19.5) | Main's `lvSwap` / `lvAttach` quote half, its [3] rows |

Found while reading the diffs and fixed: Main's `lvOwnerOf` had lost the backslash of `\d` when Main's step wrote it, so after
重新入队 in a line's view the task's 负责 repeated the attempt ("执行者 · 重新入队与失败类别 · 待命，第 2 次尝试，第 2 次尝试" in its own
`lv-fix-cancelled-map` sketch; `integ/probe-owner.cjs`). One character; the other boards' added code has no such regex.

Not moved (each stays a board's, with the reason): Plan's live line for its own goal-2 run (only Plan writes runs of its
own); Decide's hold of a line its queue asks about under another word and of a paused task (its centre is the queue); Main's
`lvTaskOv` / `lvOwnerOf` and Plan's `liveTasks` (the boards' task models differ; Decide's map does not follow, §22.6); the
secretary's row as a link (Decide, Chain, Member: a board option was not needed); Chain's and Member's current-row rules;
Member's own `.cw-wait`. Goals, ArchOverview and Phone re-paste `worklines-snap.js` (the read API with `wlRecord`,
`wlSnapMain` with its `recs`) and TaskMap `worklines.js`, so every board's copies are whole again; nothing on them draws
differently (their harness logs are identical before and after).

The harnesses: `integ/patch-harnesses.cjs` (Done and Decide pick 直接干预 after opening a line; Chain's and Member's link lints
allow [3]'s never-drawn 整页查看 of the page itself, Main's its never-drawn 任务 link; Main's flows for 在对话里问 and the quotes;
Plan's flow labels for the plain fact). Run everything: `bash sketch/lineview/integ/run-all.sh <label>` then
`bash sketch/lineview/integ/live/live.sh` (WSL).

### 22.5 Lead choices the user may overrule

Shared step: an ended line (archived, or its task 已满足) is read-only — 问一问 from its saved record, 直接干预 off; the current
row is lit (秘书's too); the card under its row inside the rail, above it where there is no room; the line view replaces the
whole centre (no 对话 / 轨迹 tabs, no density menu, no goal bar, no decision card); 问一问 answers in the line's conversation
under "<line>（只读副本）" (Member's own page keeps its 临时分支 in its right column); controls only while a run goes on, none
during a formal check or while the goal is stopped, a role 暂停 / 继续 only; 直接干预 to an idle line starts a run at once; a
record without step data shows counts and where the steps are; the record opens at its newest rows; "第 n 次尝试 · 接续" only
where an attempt went on from a stop; 正在做 under the facts is the live line without 正在.

Boards: Main — a question's copy answers in the next minute (轨道); a decision on the card shows in the line's record; a run you
started is what the line is doing; a line's own 暂停 / 取消 / 重新入队 reach its task (also Plan); a scale change closes a line
the new rail does not have. Plan — the back row a button; 原因 vs 正在做 by Main's F5 rule (all boards' cards now); 审阅者 · 规格's
goal-2 work in its view's log; **the goal bar's 继续 also continues a line paused in its view**; the refusal reason cut to
"超出本任务范围" at 14:36; the goal row's square stays the goal's state; the container thresholds 640 / 540 / 460 / 205px.
Chain / Member — the back row links to Main (final fix: brings the page back, §22.9), the page's own row brings the page back; the page's right column hidden while
another line is open; "没有进行中的工作" is not a 原因; one clock for the page and its line views; the archived cards keep 正在做.
Decide — 秘书's row and the back row link to Main (final fix: the back row returns to the queue, §22.9); the card opens above from the seventh line on a static page; a map click with
a line open only selects; a decision's row in its line's record. Done — 直接干预 on the role lines only; no 整页查看; the
approved executor answer for every executor line; the goal's 暂停 / 取消 after 部分接受 hold every line.

Integration (§22.4): **在对话里问 always goes back to the main conversation** (it asks the secretary; Main put it into the open
line's composer — Plan, Decide and Done did not); **the quotes of 引用到草稿 are per conversation on every board with the
auxiliary area** (Main's rule; a quote alone can be sent; Done's quote no longer closes the decision card while a line is
open); **执行者 · SSE 推送 at 14:15 runs its page's command** on Main and Decide too; the spinner rule, the two-row head (over
Decide / Done's icon-only 整页查看 and dropped goal), the step and card-name rules as in §22.4; Decide's hold in the shared
words ("…里处理后…", not "…里处理这一条后…"); Chain and Member paste [3] whole (its 整页查看 of the page itself is in the markup,
never drawn).

### 22.6 Open questions (for the user or the lead)

1. **The task map after a line's own 暂停 / 取消 / 重新入队**: it follows on Main and Plan, not on Decide (its map follows the queue's
   decisions only). Also on Decide? And 轨道's bars (Main's panel) still end only at the goal's stops: per-line stops need
   `timeline.js`.
2. **直接干预 that wakes an idle executor** (停下（失败） / 停下（受阻）, 待命 after a decision or a cancelled task): it starts a run
   while its task keeps its state. Hold it like 等你决定, or let the task run too?
3. **The goal bar in a line view** (to continue a paused goal without going back)? **轨迹** (the raw ledger) for a line without a
   page? **已做完 lines**: read-only (built) or 直接干预 allowed (it would reopen accepted work)?
4. **Other lines in Chain's and Member's centre** (built) or links to Main with the line open (a canvas-level hand-over)?
   **Decide's back row**: to Main or to its queue — final fix: to its queue, and Chain's / Member's to their page (§22.9).
5. **A "去决定" link** on a line's 需要你决定 mark (Decide, Main) — final fix: built as the kit's .ref on the mark and in the held
   message's words, on every board whose line can wait for you (§22.9).
6. **One archived card**: Chain and Member keep their version-14 row 正在做 没有进行中的工作; the list rails show 负责 · 最近一步.
7. **Plan's goal bar** continuing a line you paused in its view (lead choice above); Plan's edge case: an idle 审阅者 · 规格 set
   to work by 直接干预, paused in its view, then 采用 — its goal-2 run starts while the line reads 已暂停 (`g2Start` would need to
   respect a paused line; not fixed).
8. **Done**: hold 直接干预 to the role lines while the delivery waits for your verdict? 整页查看 for archived lines (an earlier
   moment)? Goal 1's 负责 while a role line works on your message?
9. **Words**: a line paused in its view answers "你暂停了它；暂停时第 1 次尝试。" (prefer the live line? — final fix: yes, §22.9); a run row without a label
   repeats its counts under it; with the goal paused 执行者 · 接续说明 reads "已暂停 · 正在做 正式检查第 1 轮进行中…" (version 14's
   rule that a paused line keeps what it was doing).
10. Seen, version 14, not changed: Member's page head overflows by 13px at 961px; Main's main head clips its subs at ≤1240px
    (Plan fixed its own); the archived names are cut in the 208px rail itself (their card names them whole).

### 22.7 Checks (WSL, node 24, Playwright 1.63 headless, file://; nothing left running, no other process signalled)

- **Shared files**: `apply-kit.sh` — the first 90,193 bytes of kit.css are version 14's, §19 is 13,883 bytes; `gen-snapshot.mjs`
  1,144 comparisons, 0 differ, and `check-worklines.mjs` 32,749, 0 differ, with `worklines-snap.js` / `worklines.js` byte for byte
  as before (`integ/gen-snapshot.log`, `check-worklines.log`).
- **Harnesses** (`integ/run-all.sh after5`, `consistency/build-all.sh` for the other four): all ten build, `node --check` ok,
  format lint clean, no unknown holes, no non-function handlers, no handler errors.
- **Before / after** (`integ/cmp-harness.mjs`, rail, centre and right panel of every static sketch against the boards as their
  own steps left them, `cmp-after5.log`): Chain 82 / 82, Member 84 / 84, Done 101 / 101 the same; Main 279 / 307 (the 28 are
  SSE 推送's running step, 在对话里问 and the 负责 fix), Plan 122 / 150 (the 28 are the plain 任务 fact's markup, same text), Decide
  99 / 108 (SSE 推送's step, the hold's words, the refusal). The four other boards' harness logs are identical. Flows: only
  those differences.
- **No line open vs version 14** (each board's own comparison, re-run; `integ/v14-compare.log`): Main 20 / 20 states, Plan 91 / 91,
  Decide 82 / 82, Done 72 / 73 (rw-branch-exec asks in the line's own view on purpose), Chain 40 / 40, Member 42 / 42.
- **Consistency**: `parse-all.sh` all ten boards parse; `links.mjs` only the known "order differs from boards" (Chain → Chain and
  Member → Member are [3]'s never-drawn 整页查看 of the page itself, as Main → Main is its back link); `verbatim-all.mjs`
  `lineview.snippet.js` whole, 17 / 17, on all six; `worklines-snap.js` API 11 / 11 on every snapshot board; `worklines.js` whole
  24 / 24 on Main and TaskMap (Goals' arch-semantic / auxtabs and Done's `axRepo` are their documented version-14 copies).
- **Live, real clicks and time** (`integ/live/live-check.mjs`, the verifier's runtime with `<sc-if>` kept as the canvas does;
  `integ/live/live-check.log`): ALL OK on the six boards — the head at 1440 / 1240 / 1100 / 1000 / 961, dark and light (name whole,
  goal shown and whole, no overlap, no sideways overflow, composer in view); "正在建立咨询…" shown before 1.4 s and gone after it,
  never over the answer (sc kept and dropped, both themes, 1440 / 1000; judged by the spinner's own animation clock); every rail
  card (18–30 per board, archived included) at dark 1440 and light 961 — shown, inside the window and the rail, clear of its row,
  the name whole; the held 直接干预 (five boards); the refusal back to the task, its step wrapping (four boards); every line
  opening on 问一问; the quotes per conversation (Main, Plan, Decide, Done); Main's 在对话里问 going back. Plan's own narrow head
  checks re-run (`plan/lineview/fix/shots/head-integ.log`, `mainhead-integ.log`): as in its fix run.
- **Shots**: `v2/shots/lineview/integ/<board>/` — A (the line view at the five widths, both themes), B (the spinner at 300 ms and
  2.5 s), C (hover cards), D (the held message), E (the refusal), G (quotes), H (Main's 在对话里问). Looked at: Main A-dark-1000,
  H-light-1100; Plan A-light-1240; Decide A-light-961, C-light-961-row20, G-light-1100-again; Done A-dark-961; Chain E-light-1000,
  B-dark-300ms; Member A-light-961. The board steps' shots (before the integration): `v2/shots/lineview/main/`,
  `shots/lineview/main-fix/`, `sketch/plan/lineview/shots/` and `fix/shots/`, `sketch/lineview/shots/{chain,member}/`,
  `sketch/lineview/cm/fixcheck/shots/`, `v2/shots/decide/`, `v2/shots/done/`, `sketch/lineview/decide-done/fix/shots/`, the shared
  demo's `sketch/lineview/shots/`. Static sketches before / after: `integ/before/<board>/`, `integ/after5/<board>/`.
- **Read check**: `v2/readcheck-lineview/` (INDEX.md): each changed board against version 14 with the verbatim runs of `v2/data/`
  collapsed, and the shared files.

**Not checked**: the canvas runtime itself (the live page emulates it; container queries and `:has` assumed to work there as in
Chromium 153); Safari and Firefox; screen readers; windows narrower than 961px; a divider dragged by hand (the container rules
were checked at the window widths only); the board steps' own shoot scripts were not re-run (their folders show the boards
before the integration); Decide's paused-task hold (q8's 继续 / 取消 from the line) and Plan's goal-2 clock were checked through
their harness flows only, not live.

### 22.8 Earlier statements this section supersedes (pointers, not rewrites)

- §1 / §21.12 "Main's links … 看工作记录 → Chain, 打开成员页 → Member" → 整页查看 in the line's head (§22.1).
- §6.6 "发给：<line> · 临时分支（只读）" → gone; 问一问（只读） in the line's own composer.
- §21.1 Main "the read-only branch on any line but the secretary's" and Done's executor answer "for its own task" → in the line's
  own view; Member "the page of ONE line" — its own row is a button now and other lines open in its centre.
- §21.9 "Main's **原因** for a stop reason (the other rails still say 正在做)" and §21.10 question 10 → every board's card and line
  view say 原因 for a stop reason ("没有进行中的工作" is not one); §21.10 question 9 (a role page) → a role's line opens as a line
  view.
- §21.3 "a rail row = dot · name · word, title "name · word"; expanded 负责 … / 正在做 (Main: 原因 …) / 最近一步" → no title on a
  rail row (the card is its tooltip); the expansion is the row's hover / focus card, 原因 for a stop reason on every board.

### 22.9 Final fix (2026-10-07): the final critic's findings

The final critic read the six boards live after the integration (twelve findings, two major; its probes, flows and shots are in
`sketch/lineview/final-critic/`). **All twelve are valid and applied; none is rejected.** Two are applied differently from the
critic's suggestion (2: where the goal's note sits; 9: no title), said in the rows below. Backup before this step:
`v2/prev/pre-finalfix-lv-1007/` (project, data, DESIGN.md, `kit-19.css`, the generators in `gen/`, the six harnesses and the
integration's scripts; SHA256SUMS over project, data and DESIGN.md). Scripts: `sketch/lineview/final-fix/` — `fix-boards.mjs`
rebuilds every board from that copy with the shared files re-pasted whole and each board's own edits (65 literal edits,
`fix-boards.log`); `edit-snippet-html.cjs`, `edit-snippet-js-2.cjs` (the snippet's [3] and the goal's note; the other snippet
edits were made by hand — `v2/readcheck-lineview/final-fix/shared.diff` has them all); `edit-gen.cjs` (`gen-snapshot.mjs`);
`patch-harnesses.cjs`; `edit-design.cjs` (the pointers in §22.1, 22.2, 22.5, 22.6 to this section).

| # | finding (critic) | what changed | where |
|---|---|---|---|
| 1 | major: a line paused in its own view showed the wrong 正在做 on five boards (Plan / Chain / Member "没有进行中的工作", Done its 完成 text, Decide / Chain "第 1 次尝试"), and its copy said the same after "暂停时" | Main's rule is the snippet's on every board (`lvDoing`): 正在做 is the run you started, live or stopped by your pause; else, for a line you paused in its view, the step it was on — its live line without 正在 ("运行命令：SSE 推送相关测试"), or the board's 正在做 text, never a text under another key (Done's 完成); a line the goal's pause holds keeps version 14's row. The copy's "暂停时…" says the same (`lvAnswer`'s `before`). Main's own copy of the rule (`vr`) is gone | `lineview.snippet.js` (`lvDoing`, `lvAnswer`, `lvView`); Main's line objects |
| 2 | major: with the goal paused or cancelled a line's view gave no reason and no way on (the goal bar is not in the view) | a line the goal's stop holds reads **原因 你暂停了目标** / **原因 目标已取消，记录保留** under the facts, and the record ends with a line (the kit's sys-line with the pause / stop icon): "目标已暂停：这条工作线跟着目标停下。要它接着做，回到主对话在目标栏点继续。" / "目标已取消：这条工作线跟着目标停下，记录保留。要它接着做，回到主对话在目标栏点重新入队。"; a line the stop does not hold (Done's 待命 roles after 部分接受): "目标已暂停：发给它的直接干预会排队，你回到主对话在目标栏点继续后送达。" (取消: "…点重新入队后送达。"). The rail card keeps version 14's row. **Lead deviation**: the critic suggested the top banner (`lv.banner`); a view opens at its newest rows, so in a long record (SSE 推送 at 1100px) the top banner was scrolled away — the note is the record's newest row instead. No new control | `lineview.snippet.js` (`lvView`) |
| 3 | minor: the goal's 继续 said "3 条工作线" after one of them was paused on its own; 2 went on | Main's 继续 counts the lines the goal's pause holds, not one you paused or cancelled in its own view, and names those still paused: "已继续：2 条工作线从停下的地方接续；执行者 · SSE 推送 仍暂停（你单独暂停的）" | Main `gb.resume` |
| 4 | minor: the copy's 最近一步 contradicted the card (Chain, Member) | the copy's 最近一步, and an ended line's 最近一步 fact, are the card's (`L.last` before the read API's `recent`) on every board | `lineview.snippet.js` (`lvAnswer`, `lvView`) |
| 5 | minor: on Decide, Chain and Member "‹ 回到主对话" left the board instead of returning to what the centre showed (§22.6 q4) | **lead choice (the user may overrule)**: the back row returns to what the centre showed — Decide "‹ 回到需要你决定" (the queue as you left it, its open item kept), Chain "‹ 回到 重新入队与失败类别" (this record), Member "‹ 回到 SSE 推送" (this page) — each a button whose title says where (回到“需要你决定”的队列 / 回到 执行者 · 重新入队与失败类别 的工作记录 / 回到 执行者 · SSE 推送 的页面). 秘书（主对话）'s row stays the link to Main on all three. Decision 33's "回到主对话" stays on Main, Plan and Done, whose centre is the main conversation | `lvView` inputs `o.backLabel`, `o.backTip`; [3]'s back row title; Decide, Chain, Member |
| 6 | minor: a line that waits for your decision had no route from its view to the decision (§22.6 q5) | while the line waits (等你决定), the record's newest 需要你决定 mark and the held message's 「需要你决定」 are the kit's `.ref`: on Main a button that opens the decision card of the line's task (`openDec`), on Decide a button that opens its item in the queue, on Plan, Chain and Member a link to Main (their rail's 需要你决定 row is one). A mark of a decision already made stays text. kit §19.8: the `.ref` inside the note has no padding, so it reads as a word of the sentence | `lvView` inputs `o.decide(line)`, `o.decideHref`; [3]'s mark and note; kit §19.8; Decide's `lvHold` sets the same link on the messages it holds |
| 7 | minor: on Decide, 继续 from a paused task's line left it 待命 with no plain reason and 尝试 without 接续 | the critic's second option: the line stays 待命 (the queue's approved resolution makes the task 可领取, "接在原工作线上"), with **原因 等系统开始第 2 次尝试** (or "等依赖完成后开始第 n 次尝试" when its dependencies are open), and 尝试 reads "第 2 次尝试 · 接续". The card says the same 原因 | Decide `wlNow`, `lvRecNow` (`cont`), the 尝试 fact |
| 8 | minor: Plan's 整页查看 opened a page of another moment (14:15 vs its 14:36) | no 整页查看 on Plan, Done's rule (§22.2); the same rule on Chain at 14:32 (after the round-2 pass), where 执行者 · SSE 推送's page would show 14:15 | Plan's and Chain's `lvRich` |
| 9 | minor: with a line open, the detail's "在对话里问" jumped to the main conversation (§22.5) without saying so | the button reads **在主对话里问** while a line's conversation is in the centre, 在对话里问 otherwise (Main, Plan, Done; Decide's detail has no such button). **Deviation**: no title added — the detail's buttons carry none on these boards, and the label says where it goes | Main and Done `det.acts`; Plan `det.askLabel` and its markup |
| 10 | minor: your earlier messages to a line read only as words inside a run label | `wlRecord` returns `acts` — the direct interventions you sent the line, each at the end of the run that handled it (`{ id, start, day, time, text, res, why, reply }`); the snippet draws them in time order with the markup of a message you send now (the bubble, 直接干预 · 已排队 → 已送达 → 被拒绝, the reason, the line's reply). The sample has one: 执行者 · SSE 推送's run v10 refused "顺便把状态机的失败类别也改了。" at 14:03 (Member's approved page: its words, reason and reply, the reply without its `<code>`). It shows in that line's view on Main (40 and 600), Decide, Chain, Plan and Done (archived) | `sketch/rework/gen/worklines-api.js` → `worklines.js`; `gen-snapshot.mjs` → `worklines-snap.js` (recs.<line>.acts); re-pasted on all ten boards; `lvView` |
| 11 | minor: Decide answered SSE 推送 at 14:15 from its facts, Main / Chain / Member with the approved reply; Done printed "只做了SSE 推送：" | Decide passes Main's approved replies for its 14:15 lines (not for a role line whose task needs you on this board — it is not the line those replies describe); Done's executor answer quotes the task: "这条工作线只做了“SSE 推送”：…" (version 14's template, quoted as `lvAnswer` quotes) | Decide `CARRY` and line objects; Done `lineOf` |
| 12 | minor: Plan's rail counts sat right-aligned on their own row | Plan's helmet (c): the counts at the label's left at every width, as on the five other boards | Plan helmet |

**Approved elements this changed** (on top of §22.3): Decide's, Chain's and Member's back row (5); Plan's 整页查看 (8); Done's
version-14 executor answer template, now quoted (11); with the goal stopped, a line's view says 原因 你暂停了目标 instead of
正在做 <its step> (2 — version 14's rule that a paused line keeps what it was doing stays on the rail card); the record of
执行者 · SSE 推送 has your 14:03 message (10).

**Checks** (WSL, node 24, Playwright 1.63 headless, file://; nothing left running, no other process signalled):
- **Shared files**: `apply-kit.sh` — kit.css is version 14's first 90,193 bytes + §19 (14,239 bytes; 19.8 is new);
  `build-worklines.mjs` — `worklines.js` differs from the copy before only by `acts`; `check-worklines.mjs` 32,749 comparisons,
  0 differ; `gen-snapshot.mjs` 1,144, 0 differ (`final-fix/check-worklines.log`, `gen-snapshot.log`).
- **Boards**: `fix-boards.mjs` 65 literal edits, each matched once (`fix-boards.log`); every board's logic class passes
  `node --check`.
- **Harnesses** (`final-fix/snapshot-harness.sh final`): all six build, `node --check` ok, format lint clean, no unknown holes,
  no non-function handlers, no handler errors. `patch-harnesses.cjs` (8 edits): Main finds 在对话里问 / 在主对话里问 by a
  pattern (5 lookups) and its link lint allows [3]'s 「需要你决定」 link (never drawn on Main); the scenario notes of Chain,
  Member and Decide name the new back row. The four other boards (`consistency/build-all.sh`, data re-pasted only): their
  build logs are identical to before.
- **Before / after** (`cmp-harness.mjs before final`, `cmp-final.log`; rail, centre and right panel of every static sketch):
  Main 270 / 307 the same, Plan 123 / 150, Chain 49 / 82, Member 53 / 84, Decide 92 / 129, Done 93 / 101. Every difference read:
  the back row's words (every line view on Decide, Chain, Member), the 14:03 bubble in 执行者 · SSE 推送's record, a paused
  line's 正在做, the goal's 原因 and note, the `.ref` mark and note, 在主对话里问, Plan without 整页查看, Decide after 继续,
  Done's quoted answers.
- **No line open vs version 14** (`final-fix/v14-compare.log`): Main 20 / 20, Plan 91 / 91, Decide 82 / 82, Done 72 / 73
  (rw-branch-exec, as after the integration), Chain 40 / 40, Member 42 / 42.
- **Consistency**: `parse-all.sh` all ten boards parse; `links.mjs` and `verbatim-all.mjs` logs identical to the integration's
  (`lineview.snippet.js` whole, 17 / 17, on the six; `worklines-snap.js` API 11 / 11 on the eight snapshot boards, Decide with
  both its moments; `worklines.js` whole 24 / 24 on Main and TaskMap).
- **Live** (`final-fix/live/live-check.mjs`, the integration's checks A–H on the fixed boards): ALL OK; its log equals the
  integration's apart from the spinner's timings (B: shown before 1.4 s, gone after it, in every look). Chain was changed once
  more after that run (no 整页查看 at 14:32): its harness, the comparisons above and its live check were run again
  (`live-check-Chain.log`: ALL OK).
- **The final critic's probes, re-run** (`final-fix/probe/`, `runmany.log`): `probe-paused.mjs` — all nine cases read 正在做
  按你的直接干预调整 in the facts, the card and the copy's answer, and the answer's 最近一步 is the card's; flows Main goal /
  linethengoal (原因 and the note; "已继续：2 条工作线从停下的地方接续；执行者 · SSE 推送 仍暂停（你单独暂停的）"), Decide hold (待命 ·
  第 2 次尝试 · 接续 · 原因 等系统开始第 2 次尝试), Chain / Member page (the back row brings the page back), Plan g2 (no 整页查看),
  Done exec (quoted answers), Main askin (在主对话里问). Decide's flow `nav` still stops at its own step that looks for 秘书 as a
  button (a link on Decide), as it did in the critic's run.
- **probe-final.mjs**: 34 scenarios × 4 looks (136 runs): no failure, no page error; the back rows in view at every width; the
  「需要你决定」 button opens the decision card (Main) and the queue's item (Decide); the link goes to Main (Plan, Chain, Member);
  the rail counts sit 8px from the label on Plan as on Main and Decide.

**Shots** (`v2/shots/lineview/final-fix/`): `states/<board>-<state>/<look>.png` — every state this fix changed in four looks
(dark 1440, light 1440, dark 1100, light 961; `probe-final.mjs`, its log `probe-final.log`); `live/<board>/` — the
integration's live check A–H re-run (A the head at five widths and both themes, B the spinner, C the rail cards, D the held
message, E the refusal, G the quotes, H 在主对话里问); `flows/` — the final critic's flows re-run on the fixed boards. Looked at:
`states/main-decide` dark 1440 and light 961, `decide-decide` light 1440, `main-goalpaused` dark 1440,
  `main-goalcancelled` light 961, `chain-back` light 961, `member-back` light 961, `decide-backclick` dark 1100, `decide-cont`
  light 961, `plan-record` dark 1100, `plan-railhead` dark 1440, `done-paused` dark 1100, `main-askin` light 1440;
  `live/chain/A-light-961`.

**Not checked**: the canvas runtime itself (the live page emulates it); Safari and Firefox; screen readers; windows narrower
than 961px; a divider dragged by hand; the act bubble at 600 tasks on Main (seen in the harness's sketches only, not in a
shot); Phone's goal 继续 (the same count rule, but Phone has no line views, so nothing can be paused on its own there; not
changed); the board steps' own shoot scripts (their folders show the boards before this step).

**New open questions** (for the user or the lead):
1. 执行者 · SSE 推送's run row still reads "用时 11 分：编辑 2 个文件；你的直接干预被拒绝（不在负责范围）" above your bubble, so the
   refusal is said twice; the label is 轨道's bar text (`timeline.js`). Drop the clause from the bar's label?
2. The back row on Chain and Member names the page by its task ("回到 重新入队与失败类别", "回到 SSE 推送"); "回到这一页" instead?
3. Decide's 继续 keeps the line 待命 until the system starts the attempt (the queue's 可领取); or start the run at once, as 重新入队
   does in a line's own view?
