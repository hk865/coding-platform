/* =====================================================================
   taskpanel.snippet.js — the right panel's 任务图 tab (user decisions 25, 27, 28 and 30 of 2026-10-05/06), shared by Main,
   Plan, Goals, Decide and Done. Paste the methods into the board's logic class VERBATIM (sketch/consistency/verbatim-all.mjs
   checks it); the markup is data/taskpanel.snippet.html, the paste rules data/README.md ("taskpanel").
   PART A — every board with the 任务图 tab: tpState, tpThumb, tpRestLine, tpOwner, tpCard, tpDetail, tpTextW.
     树 is a THUMBNAIL (decision 28): from the goal root at most 3 levels (goal → stage → its children on the comb); a node
     whose deeper levels are hidden says it can open; a click opens up to 3 more levels under it in place and a second click
     folds it (the board's own pick handler, as approved); the tree area pans (drag with pointer capture, wheel), 回到起点
     goes back. When the opened tree is more than one and a half panels tall it falls back to the architecture's
     当前工作 pattern: the paths to the selection and to the most urgent work, the rest as compact squares with one-line
     summaries; the full tree is on the full page (整页查看 → TaskMap.dc.html, the DAG page). The tree shows grouping, not
     dependencies (a quiet line says so). 大纲 stays as approved. A TASK's own square is hollow when it has not started
     (decision 27, sqAt); group squares keep the approved rule. 负责 of a task, a stage or batch and the goal root come from
     the work lines (decisions 25, 30: wlOwner / wlGroupOwner / wlGoalOwner).
     Needs: data/squares.js (sqAt); data/worklines.js or data/worklines-snap.js (wlOwner, wlGroupOwner, wlGoalOwner); the
     board's tree engine as in Main (flatTree(o), focusTree(o) calling o.restLine(rest, hasPath, n, depth), posMap(flat,
     outline), cardHint) and the board's task view returning its engine options as v.o (one line: `o: o` in taskView's
     return).
   PART B — 轨道 as work lines (decision 25) on boards that paste data/timeline.js AND data/worklines.js (Main): tpLanes,
     tpWin, tpUnits, tpConc. One row per work line (a Session plus the Sessions that continued it), grouped by 角色 (default)
     / 模块 / 任务; executor lines that never overlap share a row (rows = peak concurrency); a closed group is one row of
     concurrency; read-only consultations sit on the line that was asked; archived lines behind one bottom row; the order
     (pinned → 需要你决定 > 失败 > 受阻 > 待核对 → most recent activity; 任务 keeps the plan's order) is taken once when the view
     opens or the grouping / filter / pins change and never moves while you look ("顺序已变 · 重新排序" when it went stale);
     at most 8 rows, then "另 n 条 · 整页查看". The calendar, the window, the ticks, the Host restarts and the sum line are
     the approved time view's (timeView, verbatim).
   ===================================================================== */
  /* ------------------------------------------------------------ PART A · the 任务图 tab (all five boards) */
  /* state keys: the thumbnail's pan ({ x, y, at: the selection the pan was made with }) and the panel's measured box; the
     轨道 view's grouping, window, picked hour, closed groups, archived shown, pins and its re-sort counter */
  tpState() {
    return { tpPan: null, tpBox: null, wlBy: 'role', wlWin: 'today', wlCell: null, wlShut: {}, wlArch: false, wlPins: [], wlSort: 0 };
  }
  /* the width of a line of text in the panel (CJK and full-width punctuation 1 em, the rest about .55 em) */
  tpTextW(t, px) { const e = px || 12; return [...String(t || '')].reduce((a, ch) => a + (/[　-鿿＀-￯]/.test(ch) ? e : e * 0.55), 0); }
  /* the one-line summary of the compact squares of one level (the thumbnail's fallback): "另 7 个阶段，412 个任务 · 需要你决定 3";
     the task count goes first when the line would not fit its row (room in px), the attention words stay */
  tpRestLine(rest, hasPath, room) {
    const U = { goal: '个目标', stage: '个阶段', batch: '个批次', task: '个任务' };
    const leaf = (k) => !(k.kids && k.kids.length);
    const unit = rest.every(leaf) ? '个任务' : rest.every((k) => k.kind === rest[0].kind) && U[rest[0].kind] ? U[rest[0].kind] : '组';
    const W = { decide: '需要你决定', failed: '失败', blocked: '受阻' };
    const alert = ['decide', 'failed', 'blocked'].map((x) => [x, rest.reduce((a, k) => a + ((k.cnt || {})[x] || 0), 0)]).filter((x) => x[1]).map((x) => W[x[0]] + ' ' + x[1]);
    const head = (hasPath ? '另 ' : '') + rest.length + ' ' + unit;
    const tasks = rest.reduce((a, k) => a + (leaf(k) ? 1 : k.leaves || 0), 0);
    const taskTxt = rest.every(leaf) ? '' : '，' + String(tasks).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' 个任务';
    const tail = alert.length ? ' · ' + alert.join(' · ') : '';
    return room && taskTxt && this.tpTextW(head + taskTxt + tail) > room ? head + tail : head + taskTxt + tail;
  }
  /* 负责 of a node of the task map, from the work lines (decisions 25, 30); null keeps the board's own text (a goal without
     work lines: goal 2 and 3 on Main, goal 2's plan on Plan). opt: { lines, at, ctl }; lines is true / false for the map's
     goal, or a function of the node for a map that holds two goals (Goals: true only under goal 1) */
  tpOwner(n, opt) {
    if (!n || !opt || !(typeof opt.lines === 'function' ? opt.lines(n) : opt.lines)) return null;
    /* opt.src: the work-line model (data/worklines-long.js wlSrc — at 600 the 600 record; final fix 2026-10-06), else the board */
    const W = opt.src || this;
    if (n.kind === 'goal') return W.wlGoalOwner(opt.at, opt.ctl);
    if (n.kids && n.kids.length) return W.wlGroupOwner(n.id, opt.at, opt.ctl);
    return W.wlOwner(n.id, opt.at, opt.ctl);
  }
  /* the hover card the board built (taskCard): a task's head square hollow when it has not started, 负责 from the work lines */
  tpCard(card, n, opt) {
    if (!card || !card.show || !n) return card;
    const out = Object.assign({}, card);
    if (!(n.kids && n.kids.length)) out.sq = 'sq z10 ' + this.sqAt(n.st);
    const own = this.tpOwner(n, opt); if (own) out.agent = own;
    return out;
  }
  /* the detail the board built (taskDetail, four rows): the head square of a task, 负责, and the task squares in its
     relations (依赖 / 后续 / 任务 / 重叠 hold tasks; 阶段 / 批次 hold groups and keep their squares) */
  tpDetail(det, n, opt) {
    if (!det || !n) return det;
    const out = Object.assign({}, det);
    if (!(n.kids && n.kids.length)) out.sq = String(det.sq).replace(/\bs-[a-z0-9-]+$/, this.sqAt(n.st));
    const own = this.tpOwner(n, opt); if (own) out.agent = own;
    const TASKS = ['依赖', '后续', '任务', '重叠'];
    out.rel = (det.rel || []).map((g) => (TASKS.indexOf(g.k) < 0 ? g : Object.assign({}, g, {
      items: (g.items || []).map((it) => Object.assign({}, it, { sq: String(it.sq || '').replace(/\bs-pending\b/, 's-notyet') })) })));
    return out;
  }
  /* the 任务图's tree for the panel. v = the board's task view ({ o, flat, outline, byId, root, sel, hits }); s = state;
     opt = { set, map ('task' | 'arch'), viewW (the tree's width in px), viewH (the panel body's height in px without the
     detail), hasDetail, detailH, lines, at, ctl, keep }.
     Returns { flat (rows: hollow task squares, can-open marks), mode ('tree' | 'focus' | 'kept' | 'outline' | 'off'), view
     (the viewport's class, offset and pointer / wheel handlers), bar (the quiet line above the tree), place(card) (the hover
     card in the viewport's coordinates), qrows(list) (search hits, hollow task squares) }.
     keep: true — a board that draws its own task tree on purpose (Goals: the tasks on the two goals' shared files, already
     the 当前工作 pattern; Plan: the plan's goal → stage → task, never deeper) keeps v.flat as it is and gets the rest: hollow
     squares, the pan, the line, the card's place. The 架构图 (map 'arch') passes through unchanged: no pan, no squares
     changed here. Rows without .node (Plan's hand-built rows) are looked up by id in v.byId. */
  tpThumb(v, s, opt) {
    opt = opt || {};
    const set = opt.set || ((p) => this.setState(p)); const noop = () => {};
    const o = v.o || {}; const byId = v.byId || {}; const root = v.root;
    const isTask = opt.map !== 'arch';
    const mode0 = !isTask ? 'off' : v.outline ? 'outline' : opt.keep ? 'kept' : 'tree';
    const viewW = Math.max(200, opt.viewW || 448);
    const viewH = Math.max(240, opt.viewH || 760);
    const leaf = (n) => !(n && n.kids && n.kids.length);
    const ACT = ['decide', 'failed', 'blocked', 'running', 'verifying', 'waiting'];
    let flat = v.flat; let mode = mode0; let shown = 0; let total = 0;
    if (mode0 === 'tree' && o.isOpen) {
      /* 3 levels from the root (the root open, everything below folded onto combs: the approved default); a group you opened
         also opens its children that hold groups, so a click shows up to 3 more levels under it */
      const up = s.open || {};
      const isOpen = (n) => o.isOpen(n) || (!!n.parent && n.parent !== root.id && up[n.parent] === true && up[n.id] !== false && n.kids.some((k) => k.kids.length > 0));
      flat = this.flatTree(Object.assign({}, o, { isOpen: isOpen }));
      /* it still does not fit (more than one and a half panels tall): the paths to the selection (and its children, so what
         you opened stays open) and to the most urgent work, as many as one panel holds; the rest as compact squares */
      if (flat.height > viewH * 1.5) {
        const work = []; const walk = (n) => { if (leaf(n)) { if (ACT.indexOf(n.st) >= 0) work.push(n); } else n.kids.forEach(walk); }; walk(root);
        work.sort((a, b) => ACT.indexOf(a.st) - ACT.indexOf(b.st));
        const onPath = new Set([root.id]); let est = 34;
        const add = (id, force) => {
          const chain = []; let n = byId[id]; while (n && !onPath.has(n.id)) { chain.push(n); n = n.parent ? byId[n.parent] : null; }
          const cost = chain.reduce((a, x) => a + (leaf(x) ? 28 : 36), 0);
          if (!force && est + cost > viewH) return false;
          chain.forEach((x) => onPath.add(x.id)); est += cost; return true;
        };
        const sel = v.sel && byId[v.sel] ? byId[v.sel] : null;
        if (sel && sel !== root) { add(sel.id, true); sel.kids.forEach((k) => add(k.id, true)); }
        work.forEach((t) => { if (onPath.has(t.id) || add(t.id, false)) shown += 1; });
        total = work.length;
        const room = (n, depth, rest) => viewW - depth * 22 - 22 - rest.length * 12 - 12 - this.tpTextW(n.name) - 14;
        flat = this.focusTree(Object.assign({}, o, { onPath: onPath, restLine: (rest, hasPath, n, depth) => this.tpRestLine(rest, hasPath, room(n, depth || 0, rest)) }));
        mode = 'focus';
      }
    }
    /* squares: a task's own square follows sqAt (待执行 hollow); a comb square that holds more levels and a folded row that
       can open say so (kit: a stub under the square, the chevron stays) */
    const rows = flat.rows.map((r) => {
      if (mode === 'off') return r;
      const x = Object.assign({}, r); const rn = r.node || (r.isFold ? null : byId[r.id]);
      if (rn && leaf(rn) && !r.isFold) x.sq = 'sq ' + this.sqAt(rn.st);
      if (r.leaves) x.leaves = r.leaves.map((k) => {
        const y = Object.assign({}, k); const kn = k.node || byId[k.id];
        if (kn && leaf(kn)) y.sq = 'sq ' + this.sqAt(kn.st);
        else if (mode === 'tree' && kn) y.cls = k.cls + ' tp-more';
        return y;
      });
      if (r.hasStrip && rn && !r.isFold) { const kids = rn.kids.slice(0, 8); x.strip = r.strip.map((q, i) => (kids[i] && leaf(kids[i]) ? { sq: 'sq z8 ' + this.sqAt(kids[i].st) } : q)); }
      if (mode === 'tree' && r.canOpen && !r.open) x.lb = (r.lb || 'tr-lb') + ' tp-more';
      return x;
    });
    const out = Object.assign({}, flat, { rows: rows });
    const pmap = this.posMap(out, mode === 'outline');
    /* the viewport: 树 pans; 大纲 and the 架构图 do not (the card's position is the board's) */
    const pans = mode === 'tree' || mode === 'focus' || mode === 'kept';
    /* the width of a row with its labels uncut, calibrated on the rendered rows of Main, Plan and Goals (estimate − measured
       −4 … +7 px; sketch/rework/plan-goals-fix/trial/fit-rows.cjs): CJK 1 em, a space .28 em, the rest .52 em. A branch row =
       gutters and elbow + its comb (pitch 18, 12 when mini; the label 6px after a comb, 4px otherwise) + the label (padding
       12, the name, 8 + each count, 20 for the chevron; 13px on the root row); a named row (leaf, fold, rest) = gutters + 96
       (elbow, square, gaps, paddings, the count's 34px) + the name at 13px + its reason, strip and second count */
    const tw = (t, px) => [...String(t || '')].reduce((a, ch) => a + (/[　-鿿＀-￯]/.test(ch) ? px : ch === ' ' ? px * 0.28 : px * 0.52), 0);
    const rowW = (r) => {
      if (r.isLine) return r.depth * 22 + 96 + tw(r.name, 13) + (r.hasWhy && r.why ? 8 + tw(r.why, 12) : 0) + (r.hasStrip ? (r.strip || []).length * 10 + 10 : 0)
        + (r.hasB && r.b ? tw(r.b, 12) + 10 : 0) + Math.max(0, tw(r.a, 12) - 34);
      const fs = r.type === 'root' ? 13 : 12; const n = (r.leaves || []).length;
      return r.depth * 22 + 22 + (n ? n * (r.mini ? 12 : 18) + (r.type === 'root' ? 4 : 6) : 4) + 12 + tw(r.name, fs)
        + (r.a ? 8 + tw(r.a, fs) : 0) + (r.hasB && r.b ? 8 + tw(r.b, fs) : 0) + (r.canOpen ? 20 : 0);
    };
    const W = Math.ceil(rows.reduce((a, r) => Math.max(a, rowW(r)), 0)); const H = Math.ceil(out.height || 0);
    const box = s.tpBox && !!s.tpBox.det === !!opt.hasDetail ? s.tpBox : null;
    const vw = box ? box.w : viewW; const vh = box ? box.h : Math.max(160, viewH - (opt.hasDetail ? opt.detailH || 330 : 0));
    const lim = (w, h) => ({ x: Math.min(0, Math.round(w - W - 12)), y: Math.min(0, Math.round(h - H - 16)) });
    const L = lim(vw, vh);
    const cl = (val, lo) => Math.max(lo, Math.min(0, Math.round(val || 0)));
    const p0 = s.tpPan || { x: 0, y: 0, at: null };
    let x = pans ? cl(p0.x, L.x) : 0; let y = pans ? cl(p0.y, L.y) : 0;
    /* a selection made elsewhere (the conversation, a search hit, a relation, a card) comes into view */
    if (pans && v.sel && p0.at !== v.sel) {
      const r = rows.filter((q) => q.id === v.sel)[0] || rows.filter((q) => (q.leaves || []).some((k) => k.id === v.sel))[0];
      if (r && (r.top + y < 0 || r.top + r.h + y > vh)) y = cl(-(r.top - 24), L.y);
    }
    const canPan = pans && (L.x < 0 || L.y < 0);
    const measure = (e) => {
      try {
        const b = e.currentTarget.getBoundingClientRect();
        const nb = { w: Math.round(b.width), h: Math.round(b.height), det: !!opt.hasDetail };
        const cur = s.tpBox || {};
        if (cur.w !== nb.w || cur.h !== nb.h || !!cur.det !== nb.det) set({ tpBox: nb });
        return nb;
      } catch (err) { return { w: vw, h: vh }; }
    };
    /* a drag starts only with the main button on a tree that can move: a tree that fits is never measured (its viewport is
       as tall as the tree, so its height would read as an overflow), a right-click (新标签打开) never arms a drag; a drag
       whose release never reached the viewport (a press near its edge let go outside it) is dropped at the next move made
       without the button */
    const drag = {
      down: (e) => {
        if (!pans || !canPan || !e || e.button > 0) return;
        const b = measure(e);
        this._tpDrag = { id: e.pointerId, cx: e.clientX, cy: e.clientY, x: x, y: y, moved: false, el: e.currentTarget, lim: lim(b.w, b.h) };
      },
      move: (e) => {
        const d = this._tpDrag;
        if (!d || !e || d.id !== e.pointerId) return;
        if (typeof e.buttons === 'number' && !(e.buttons & 1)) { this._tpDrag = null; return; }
        const dx = e.clientX - d.cx; const dy = e.clientY - d.cy;
        if (!d.moved) {
          if (Math.abs(dx) + Math.abs(dy) < 5) return;
          /* the pointer is captured only once it moved: a plain click still reaches the square or label under it */
          d.moved = true; try { d.el.setPointerCapture(e.pointerId); } catch (err) { /* not capturable here */ }
        }
        set({ tpPan: { x: cl(d.x + dx, d.lim.x), y: cl(d.y + dy, d.lim.y), at: v.sel || null }, hover: null });
      },
      up: (e) => {
        const d = this._tpDrag; this._tpDrag = null;
        if (d && d.moved && e) { try { d.el.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ } }
      },
      wheel: (e) => {
        if (!pans || !canPan || !e) return;
        const b = measure(e); const l = lim(b.w, b.h);
        const dx = e.shiftKey ? e.deltaY : e.deltaX || 0; const dy = e.shiftKey ? 0 : e.deltaY || 0;
        const nx = cl(x - dx, l.x); const ny = cl(y - dy, l.y);
        if (nx !== x || ny !== y) set({ tpPan: { x: nx, y: ny, at: v.sel || null }, hover: null });
      }
    };
    const opened = Object.keys(s.open || {}).some((k) => (s.open || {})[k] === true && byId[k]);
    const moved = x !== 0 || y !== 0;
    /* 回到起点: the tree back at its origin (it stays there, a selection does not pull it away again) and what you opened folded */
    const back = () => set({ tpPan: { x: 0, y: 0, at: v.sel || null }, open: {}, hover: null });
    const bar = !pans ? { show: false, cls: 'tp-hint', text: '', tip: '', isNote: false, canBack: false, back: noop }
      : mode === 'focus'
        ? { show: true, cls: 'tp-note', isNote: true, canBack: true, back: back,
          text: '树放不下：只画到' + (v.sel ? '选中的和' : '') + '最紧要的 ' + shown + ' 个任务，其余在小格子里',
          tip: (total > shown ? '共 ' + total + ' 个任务在进行或要处理；' : '') + '分支上的小格子是其余的节点，悬停看名字和状态；整棵树在整页查看' }
        : { show: true, cls: 'tp-hint', isNote: false, canBack: moved || opened, back: back,
          text: canPan ? '树只按阶段分组，依赖在整页查看；拖动看其余部分' : '树只按阶段分组，不画依赖；依赖在整页查看',
          tip: '树表示分组：目标、阶段、批次、任务；任务之间的依赖和关键路径在整页的 DAG 里' };
    /* is-task: the 任务图 (树 and 大纲), where kit §18.5 dims a dimmed GROUP square further than a task's (final fix 2026-10-06);
       the 架构图's groups keep --dim-sq, so a touched folder stays apart from an untouched one when dimmed */
    const view = { cls: 'tp-view' + (isTask ? ' is-task' : '') + (pans ? ' is-pan' : '') + (canPan ? ' can-pan' : ''), x: x, y: y,
      down: pans ? drag.down : noop, move: pans ? drag.move : noop, up: pans ? drag.up : noop, wheel: pans ? drag.wheel : noop };
    /* the hover card lives in the viewport (it is never cut by the pan): below the hovered row or square, above it when it
       would leave the visible part; clamped in the viewport's width by the approved style */
    const place = (cd) => {
      if (!cd || !cd.show || !pans) return cd;
      const p = pmap[s.hover]; if (!p) return cd;
      const top = p.at.top + y; const bot = p.at.bottom + y;
      const upw = bot + 6 + 190 > vh && top - 6 > 150;
      const row = rows.filter((r) => r.id === s.hover)[0];
      const host = row ? null : rows.filter((r) => (r.leaves || []).some((k) => k.id === s.hover))[0];
      const k = host ? host.leaves.filter((q) => q.id === s.hover)[0] : null;
      const more = !!k && /\btp-more\b/.test(k.cls);
      return Object.assign({}, cd, { x: Math.max(0, Math.round(p.at.x + x)), top: upw ? 'auto' : Math.round(bot + 6) + 'px', bottom: upw ? 'calc(100% - ' + Math.round(top - 6) + 'px)' : 'auto',
        hint: more ? '点一下展开 · 双击固定 · 右键新标签打开' : cd.hint });
    };
    const hits = v.hits || [];
    const qrows = (list) => (list || []).map((q, i) => { const n = byId[hits[i]]; return n && leaf(n) && isTask ? Object.assign({}, q, { sq: 'sq z8 ' + this.sqAt(n.st) }) : q; });
    return { flat: out, mode: mode, view: view, bar: bar, place: place, qrows: qrows, pmap: pmap, width: W, height: H };
  }

  /* ------------------------------------------------------------ PART B · 轨道 as work lines (boards with timeline.js + worklines.js) */
  /* the window of the panel's 轨道: the approved rules of timeView() (今天: the last three hours up to the next hour in a panel;
     本周 from Monday; 全部 since the first run; days drawn 08:00–20:00; a picked hour), repeated here so the bars of the
     work lines sit on timeView's own ticks; day = a day picked in the year-style calendar (全部 longer than 14 days, final fix
     2026-10-06): that day from 08:00 (or its first run) to 20:00 (or its last run), as the DAG page's wlWindow() */
  tpWin(M, win, cell, full, day) {
    const now = M.now; const today = this.tlDayOf(now);
    let mode = 'span'; let w0; let w1; let d0 = 0; let nd = 1;
    if (cell) { const c = /^(\d\d-\d\d) (\d\d)$/.exec(cell); w0 = this.tlMin(c[1] + ' ' + c[2] + ':00'); w1 = w0 + 60; }
    else if (day) {
      const d = this.tlDayOf(this.tlMin(day + ' 00:00')); const mine = M.runs.filter((r) => this.tlDayOf(r.s0) === d || this.tlDayOf(r.e0 - 0.01) === d);
      const a = mine.reduce((x, r) => Math.min(x, Math.max(r.s0, d * 1440)), d * 1440 + 480); const b = mine.reduce((x, r) => Math.max(x, Math.min(r.e0, d * 1440 + 1440)), d * 1440 + 1200);
      w0 = Math.floor(a / 60) * 60;
      w1 = d === today ? Math.max(w0 + 360, Math.ceil((now + 45) / 60) * 60) : Math.min(d * 1440 + 1440, Math.ceil(b / 60) * 60);
    }
    else if (win === 'week' || win === 'all') {
      mode = 'days';
      if (win === 'week') { const wd = (new Date(today * 1440 * 60000).getUTCDay() + 6) % 7; d0 = today - wd; nd = 7; } else { d0 = this.tlDayOf(M.first); nd = today - d0 + 1; }
      w0 = d0 * 1440 + 480; w1 = (d0 + nd - 1) * 1440 + 1200;
    } else {
      const firstToday = M.runs.filter((r) => this.tlDayOf(r.s0) === today).reduce((a, r) => Math.min(a, r.s0), now);
      w0 = Math.min(today * 1440 + 480, Math.floor(firstToday / 60) * 60);
      w1 = Math.max(w0 + 360, Math.ceil((now + 45) / 60) * 60);
      if (!full) { w1 = Math.ceil((now + 15) / 60) * 60; w0 = Math.max(w0, w1 - 180); }
    }
    const X = (min) => {
      if (mode === 'days') { const d = this.tlDayOf(min); const m = Math.min(1200, Math.max(480, min - d * 1440)); return Math.max(0, Math.min(100, ((d - d0) + (m - 480) / 720) / nd * 100)); }
      return Math.max(0, Math.min(100, (min - w0) / (w1 - w0) * 100));
    };
    const inWin = (a, b) => (mode === 'days' ? b > d0 * 1440 && a < (d0 + nd) * 1440 : b > w0 && a < w1);
    return { mode: mode, w0: w0, w1: w1, d0: d0, nd: nd, X: X, inWin: inWin };
  }
  /* how many units of a closed group were DOING something at each moment (a run, a check, a consultation or a turn of theirs
     spans it; a unit counts once however many of its bars overlap), as segments on the neutral ramp, and the peak
     (the DAG page's wlConc) */
  tpConc(units, Wn) {
    const ev = [];
    units.forEach((u) => {
      const iv = u.bars.map((b) => [b.s0, Math.max(b.e0, b.s0 + 0.5)]).filter((p) => Wn.inWin(p[0], p[1])).sort((p, q) => p[0] - q[0]);
      const merged = []; iv.forEach((p) => { const m = merged[merged.length - 1]; if (m && p[0] <= m[1]) m[1] = Math.max(m[1], p[1]); else merged.push(p.slice()); });
      merged.forEach((p) => { ev.push([p[0], 1]); ev.push([p[1], -1]); });
    });
    ev.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    let c = 0; let k = 0; let last = null; const segs = [];
    ev.forEach((e) => { if (last !== null && c > 0 && e[0] > last && Wn.inWin(last, e[0])) { segs.push([last, e[0], c]); k = Math.max(k, c); } c += e[1]; last = e[0]; });
    const r1 = (v) => Math.round(v * 100) / 100;
    return { k: k, segs: segs.map((g) => { const x = Wn.X(Wn.mode === 'span' ? Math.max(g[0], Wn.w0) : g[0]); const x2 = Wn.X(Wn.mode === 'span' ? Math.min(g[1], Wn.w1) : g[1]);
      return { cls: 'wl-c wl-c' + Math.min(4, g[2]), x: r1(x), w: r1(Math.max(0.2, x2 - x)) }; }).filter((g) => g.w > 0) };
  }
  /* the units of 轨道 from the runs the board draws (M = tlModel at the board's clock, with its stops and its own turns):
     角色 / 模块 — one unit per work line (workLines(): the same lines, names, Sessions and archive as every other place);
     任务 — one unit per task with all its bars, whatever Session ran them, plus the consultations about it (wlAbout), and
     the turns about no task in 对话（不属于任务）. std = the board's task states now ({ id: { st, why } }) for the attention
     rank; order = the plan's task order (任务). Every run lands on the line it belongs to: a role's runs on its line, an
     executor's on its task's line (a consultation it answered on the task it was running then); a run that names its own
     line (r.line: a board's read-only question to a line that is not running, integration step 2026-10-06) lands on that line. */
  tpUnits(M, by, std, plan) {
    const WL = this.workLines(); const about = this.wlAbout().task; const now = M.now;
    const ROLE = { SC: 1, AA: 1, RV: 1 };
    const execAt = (m, at) => { let best = null; M.runs.forEach((r) => { if (r.m === m && r.task && r.task !== 'GOAL' && r.kind === 'run' && r.s0 <= at && (!best || r.s0 > best.s0)) best = r; }); return best ? best.task : null; };
    const lineOf = (r) => { if (r.line) return r.line; if (ROLE[r.m]) return 'L:' + r.m; const t = r.task && r.task !== 'GOAL' ? r.task : execAt(r.m, r.s0); return t ? 'L:' + t : null; };
    const nameOf = (t) => (std[t] && std[t].name) || (WL.std[t] ? WL.std[t].name : t);
    const units = []; const map = {}; const unitOfRun = {};
    const ord = {}; (plan || []).forEach((id, i) => { ord[id] = i; });
    M.runs.slice().sort((a, b) => a.s0 - b.s0).forEach((r) => {
      let id; let mk;
      if (by === 'task') {
        const base = String(r.id).replace(/\+\d+$/, '');
        const task = r.task && r.task !== 'GOAL' ? r.task : about[base] || (r.line && WL.byId[r.line] ? WL.byId[r.line].task : null) || null;
        id = task ? 'K:' + task : 'K:' + (lineOf(r) || r.m);
        mk = () => {
          const L = task ? null : WL.byId[lineOf(r)];
          return { id: id, kind: task ? 'task' : 'line', task: task, role: task ? 'task' : 'talk', name: task ? nameOf(task) : L ? L.name : r.m, short: task ? nameOf(task) : L ? L.name : r.m,
            group: task ? (std[task] && std[task].stage) || (WL.std[task] ? WL.std[task].stage : 'talk') : 'talk', line: L || null, ord: task && ord[task] !== undefined ? ord[task] : 999 };
        };
      } else {
        const lid = lineOf(r); if (!lid) return;
        id = lid;
        mk = () => {
          const L = WL.byId[lid] || { id: lid, role: 'executor', name: '执行者 · ' + nameOf(lid.slice(2)), task: lid.slice(2), sessions: 1, archived: false, area: null, segWhy: { 1: '' } };
          return { id: lid, kind: 'line', task: L.task, role: L.role, name: L.name, short: L.task ? nameOf(L.task) : L.name, line: L,
            group: by === 'module' ? (L.role === 'executor' ? L.area || '其它' : 'conv') : L.role, ord: 999 };
        };
      }
      if (!map[id]) { map[id] = Object.assign(mk(), { bars: [] }); units.push(map[id]); }
      map[id].bars.push(r); unitOfRun[r.id] = id;
    });
    units.forEach((u) => {
      Object.assign(u, this.unitStats(u.bars, u.task, std, M, now));
      u.archived = u.line && u.kind === 'line' ? !!u.line.archived : (u.role === 'task' && u.st === 'satisfied' && u.last < now - 1440);
    });
    return { units: units, unitOfRun: unitOfRun };
  }
  /* 轨道 for the panel. o = { show (轨道 is the view now: the order is taken when it opens), goal, model (what tlModel /
     timeView take: moment, dataMoment, variant, extraRuns, stops, tasks, stages), states (goal 1's task states now:
     { id: { st, why, name, stage } }), plan (goal 1's task ids in plan order), sel (the selected task), hover (the board's
     hover key), trackPx (the track's width), max (rows, 8), synth (a quiet line or ''), legend, src (the work-line model:
     this.wlSrc() of data/worklines-long.js — the board itself at 40 tasks, the 600 record at 600; final fix 2026-10-06),
     on: { hover(id), unhover(), pick(taskId) } }. Bars and cells hover through the board's hover key ('b:<run>', timeView's
     'cell:<day hour>', the year calendar's 'day:<MM-DD>').
     Final fix 2026-10-06 (the final critic): 全部 longer than 14 days draws the year-style calendar (wlLongView, as the DAG
     page; a day → that day, an hour → that hour, a crumb back); "只看需要关注的" (state wlAttn) keeps only the lines that
     need you (需要你决定 > 失败 > 受阻 > 待核对), taken into the order like the grouping and the window; a closed group's line
     says "本段 n 条，最多同时在做 k 条" as the DAG page; a bar of a line with one Session has no 记录 row. */
  tpLanes(s, o) {
    const set = (p) => this.setState(p); const noop = () => {};
    if (!o || !o.show) { this._wlFz = null; return null; }
    const on = o.on || {}; const RES = this.tlRes(); const W = o.src || this; const WL = W.workLines();
    const r1 = (v) => Math.round(v * 100) / 100;
    const by = ['role', 'module', 'task'].indexOf(s.wlBy) >= 0 ? s.wlBy : 'role';
    const win = s.wlWin || 'today'; const pins = by === 'task' ? [] : s.wlPins || []; const attn = !!s.wlAttn;
    const mo = Object.assign({}, o.model || {}, { goal: o.goal || 'g1' });
    const M = W.tlModel(mo); const now = M.now;
    const long = win === 'all' && this.tlDayOf(now) - this.tlDayOf(M.first) + 1 > 14;
    const day = long && s.wlDay ? s.wlDay : null; const cell = !long || day ? s.wlCell || null : null;
    const Wn = this.tpWin(M, win, cell, false, day); const X = Wn.X;
    /* goal 1's states now; a task the board's map does not hold (600: the 40-task story's tasks) keeps std40's */
    const std = Object.assign({}, WL.std, o.states || {});
    const U = W.tpUnits(M, by, std, o.plan || []);
    const uById = {}; U.units.forEach((u) => { uById[u.id] = u; });
    /* groups: 角色 (secretary, advisor, scribe, reviewer, executor — executors packed); 模块 (the area of the task's first file,
       packed, then the conversation, consultations and the goal's acceptance); 任务 (the plan's stages, then the talks) */
    let groups;
    if (by === 'task') {
      const stages = (o.model && o.model.stages) || WL.stages || [];
      groups = stages.map((x, i) => ({ key: x.id, name: x.name, base: i, packed: false, unit: ['个任务', '个'] }))
        .concat([{ key: 'talk', name: '对话（不属于任务）', base: 99, packed: false, unit: ['条工作线', '条'] }]);
    } else if (by === 'module') {
      groups = this.semAreas().filter((a) => U.units.some((u) => u.group === a.name)).map((a, i) => ({ key: a.name, name: a.name, base: i, packed: true, unit: ['条工作线', '条'] }));
      if (U.units.some((u) => u.group === '其它')) groups.push({ key: '其它', name: '其它', base: 97, packed: true, unit: ['条工作线', '条'] });
      groups.push({ key: 'conv', name: '对话、咨询与验收', base: 98, packed: false, unit: ['条工作线', '条'] });
    } else {
      groups = [['secretary', '秘书'], ['advisor', '参谋'], ['scribe', '书记'], ['reviewer', '审阅者'], ['executor', '执行者']]
        .map((g, i) => ({ key: g[0], name: g[1], base: i, packed: g[0] === 'executor', unit: ['条工作线', '条'] }));
    }
    /* the order: pinned → 需要你决定 > 失败 > 受阻 > 待核对 → most recent activity (任务: the plan's order). It is taken once —
       when the view opens or the grouping, the window, the archive switch, the filter or the pins change — and kept while
       you look; when the data moves under it, "顺序已变 · 重新排序" offers the new one. A picked day shows the lines that
       worked then even when they are archived now (as the DAG page); 只看需要关注的 keeps the lines that need you */
    const inWinU = (u) => u.bars.some((b) => Wn.inWin(b.s0, Math.max(b.e0, b.s0 + 0.5))) || (!!u.waitTo && Wn.inWin(u.last, u.waitTo));
    const visible = U.units.filter((u) => (s.wlArch || !u.archived || (!!day && inWinU(u))) && (!attn || u.attn < 9));
    const rank = (u) => (by === 'task' ? [0, u.ord, 0] : [pins.indexOf(u.id) >= 0 ? 0 : 1, u.attn, -u.last]);
    const cmp = (a, b) => { const p = rank(a); const q = rank(b); for (let i = 0; i < 3; i += 1) if (p[i] !== q[i]) return p[i] - q[i]; return 0; };
    const freshU = visible.slice().sort(cmp).map((u) => u.id);
    const gs = groups.filter((g) => visible.some((u) => u.group === g.key));
    const best = (g) => visible.filter((u) => u.group === g.key).sort(cmp)[0];
    const freshG = gs.slice().sort((a, b) => (by === 'task' ? a.base - b.base : cmp(best(a), best(b)) || a.base - b.base)).map((g) => g.key);
    const key = [o.goal || 'g1', by, win, day || '', cell || '', s.wlArch ? 1 : 0, attn ? 1 : 0, pins.join(','), s.wlSort || 0].join('|');
    if (!this._wlFz || this._wlFz.key !== key) this._wlFz = { key: key, units: freshU, groups: freshG };
    const arrange = (fresh, frozen) => { const known = frozen.filter((id) => fresh.indexOf(id) >= 0); return known.concat(fresh.filter((id) => known.indexOf(id) < 0)); };
    const uOrder = arrange(freshU, this._wlFz.units); const gOrder = arrange(freshG, this._wlFz.groups);
    const stale = uOrder.join() !== freshU.join() || gOrder.join() !== freshG.join();
    /* lit: the hovered bar's unit and the selected task's unit; the rest fades (.tl.focus) */
    const hovRun = o.hover && String(o.hover).indexOf('b:') === 0 ? String(o.hover).slice(2) : null;
    const hovUnit = hovRun ? U.unitOfRun[hovRun] : null;
    const lit = (u) => u.id === hovUnit || (!!o.sel && u.task === o.sel);
    const focus = !!hovUnit || (!!o.sel && visible.some((u) => u.task === o.sel));
    const goneOn = {}; M.runs.forEach((r) => { if (r.prev) goneOn[r.prev] = true; });
    const resOf = (r) => (r.res === 'paused' && goneOn[r.id] ? ['已暂停'].concat(RES.paused.slice(1)) : RES[r.res]);
    const nameOfRun = (b) => (b.task && b.task !== 'GOAL' ? ((std[b.task] && std[b.task].name) || (WL.std[b.task] || {}).name || b.task) : b.kind === 'talk' ? '对话回合' : b.kind === 'query' ? '咨询（只读副本）' : '目标验收');
    /* one unit's bars, links and stop marks in the window (rows: a bar prefers its predecessor's row; at most three) */
    const tracks = {};
    const track = (u) => {
      if (tracks[u.id]) return tracks[u.id];
      const mine = u.bars.filter((b) => Wn.inWin(b.s0, Math.max(b.e0, b.s0 + 0.5))).sort((a, b) => a.s0 - b.s0 || (a.kind === 'check') - (b.kind === 'check'));
      const ends = []; const rowOf = {};
      mine.forEach((r) => {
        const want = r.prev && rowOf[r.prev] !== undefined ? rowOf[r.prev] : null;
        let row = want !== null && ends[want] <= r.s0 + 0.01 ? want : ends.findIndex((e) => e <= r.s0 + 0.01);
        if (row < 0) row = ends.length < 3 ? ends.length : 2;
        rowOf[r.id] = row; ends[row] = Math.max(ends[row] || 0, r.e0);
      });
      const L = lit(u); const onc = L ? ' on' : '';
      const bars = mine.map((b) => {
        const R0 = resOf(b); const x = X(Wn.mode === 'span' ? Math.max(b.s0, Wn.w0) : b.s0); const x2 = X(Wn.mode === 'span' ? Math.min(b.e0, Wn.w1) : b.e0);
        return { id: b.id, row: rowOf[b.id], x: r1(x), w: r1(Math.max(0, x2 - x)), task: b.task,
          cls: 'tl-b k-' + b.kind + ' ' + R0[1] + ' w' + rowOf[b.id] + (b.live ? ' is-live' : '') + onc,
          tip: nameOfRun(b) + '，' + R0[0] + '，' + this.tlHM(b.s0) + '–' + (b.live ? '现在' : this.tlHM(b.e0)) };
      });
      const links = []; const marks = [];
      mine.forEach((b) => {
        const p = b.prev ? M.byId[b.prev] : null;
        if (p && rowOf[p.id] !== undefined) { const a = X(p.e0); const c = X(b.s0); if (c - a > 0.05) links.push({ cls: 'tl-link w' + rowOf[b.id] + onc, x: r1(a), w: r1(c - a) }); }
        if (!Wn.inWin(b.e0 - 0.1, b.e0)) return;
        if (['interrupted', 'paused', 'unknown', 'cancelled'].indexOf(b.res) >= 0 && !b.live && (b.kind === 'run' || ['paused', 'cancelled'].indexOf(b.res) >= 0)) marks.push({ cls: 'tl-mark w' + rowOf[b.id] + ' ' + RES[b.res][1] + onc, x: r1(X(b.e0)), tip: resOf(b)[0] });
      });
      if (u.task && u.st !== 'satisfied' && u.st !== 'cancelled') {
        const tb = mine.filter((b) => b.task === u.task); const lb = tb[tb.length - 1];
        const mk = M.marks.filter((m) => m.task === u.task && m.kind === 'decide' && !m.done && Wn.inWin(m.at, m.at + 0.1))[0];
        if (lb && lb.kind === 'check' && lb.res === 'incomplete' && !lb.live && !M.runs.some((x) => x.task === u.task && x.s0 > lb.s0)) {
          marks.push({ cls: 'tl-mark w' + rowOf[lb.id] + ' s-blocked' + onc, x: r1(X(lb.e0)), tip: '检查不完整，等重新检查' + (lb.why ? '：' + lb.why : '') });
          const a = X(lb.e0); const c = X(now); if (c - a > 0.05) links.push({ cls: 'tl-link wait w' + rowOf[lb.id] + onc, x: r1(a), w: r1(c - a) });
        }
        if (mk) {
          const row = lb ? rowOf[lb.id] : 0;
          marks.push({ cls: 'tl-mark w' + row + ' s-decide' + onc, x: r1(X(mk.at)), tip: mk.label });
          if (!M.runs.some((x) => x.task === u.task && x.s0 > mk.at)) { const a = X(mk.at); const c = X(now); if (c - a > 0.05) links.push({ cls: 'tl-link wait w' + row + onc, x: r1(a), w: r1(c - a) }); }
        }
      }
      tracks[u.id] = { bars: bars, links: links, marks: marks, n: Math.max(1, Math.min(3, ends.length)), lit: L };
      return tracks[u.id];
    };
    const pinIt = (id) => () => { const st = this.state || {}; const p = st.wlPins || []; set({ wlPins: p.indexOf(id) >= 0 ? p.filter((x) => x !== id) : p.concat([id]), hover: null }); };
    /* rows: at most o.max (8) rows of lines — a line, a packed row, a closed group's concurrency row, a quiet group or fold
       row. The rows with something in the window are taken first, in the order; quiet ones only while room is left; the rest
       is counted in "另 n 条 · 整页查看", and the archived row stays at the bottom */
    const MAX = o.max || 8;
    const rows = []; let y = 0; const barAt = {};
    const rowH = (n) => (n >= 3 ? 60 : n === 2 ? 44 : 28);
    const blank = { isGrp: false, isLine: false, isFold: false, isArch: false, isMore: false, closed: false, ex: null, chev: '', sub: '', hasSub: false, title: '',
      name: '', more: '', hasMore: false, canPin: false, pinned: false, pinCls: '', pinLabel: '', pin: noop, toggle: noop, conc: [], links: [], bars: [], marks: [], href: '' };
    const push = (r) => { r.top = y; rows.push(r); y += r.h; };
    const rowName = (units) => {
      const at = (u) => uOrder.indexOf(u.id); const byRank = units.slice().sort((p, q) => at(p) - at(q));
      const p = byRank.filter((u) => u.bars.some((b) => this.barAt(b, now)))[0] || byRank[0];
      const others = units.length - 1;
      return { name: p.short, more: others ? '+ ' + others + ' 条已结束' : '' };
    };
    const lineRow = (units, inPacked, quietSub) => {
      const packed = units.length > 1;
      const T = units.map(track); const n0 = T.reduce((a, t) => Math.max(a, t.n), 1);
      const act = units.some((u) => u.bars.some((b) => this.barAt(b, now))); const L = T.some((t) => t.lit); const u0 = units[0];
      const nm = inPacked ? rowName(units) : { name: by === 'task' ? u0.short : u0.name, more: '' };
      const n = Math.max(n0, nm.more ? 2 : 1);
      const pinned = pins.indexOf(u0.id) >= 0;
      const r = Object.assign({}, blank, { isLine: true, h: rowH(n),
        cls: 'lane r' + n + ' wl-row' + (act ? ' is-act' : '') + (L ? ' is-lit' : '') + (units.every((u) => u.archived) ? ' is-arch' : '') + (packed ? ' is-packed' : ''),
        name: nm.name, more: nm.more, hasMore: !!nm.more, hasSub: !!quietSub, sub: quietSub || '',
        title: units.map((u) => u.name + (u.line && u.line.sessions > 1 ? '（工作记录 ' + u.line.sessions + ' 段）' : '')).join('；'),
        canPin: !packed && by !== 'task', pinned: pinned, pinCls: 'btn btn-icon btn-xs wl-pin' + (pinned ? ' is-on' : ''),
        pinLabel: pinned ? '取消固定这条工作线' : '固定这条工作线（排在最前）', pin: pinIt(u0.id), bars: [], links: [], marks: [] });
      units.forEach((u, i) => {
        const t = T[i];
        if (packed && t.bars.length) r.marks.push({ cls: 'wl-start', x: t.bars.reduce((a, b) => Math.min(a, b.x), 100), tip: '工作线：' + u.name });
        t.bars.forEach((b) => r.bars.push(Object.assign({}, b, {
          hover: () => { if ((this.state || {}).hover !== 'b:' + b.id) (on.hover || noop)('b:' + b.id); },
          pick: b.task && b.task !== 'GOAL' && on.pick ? () => on.pick(b.task) : u.task && on.pick ? () => on.pick(u.task) : noop })));
        t.links.forEach((k) => r.links.push(k)); t.marks.forEach((k) => r.marks.push(k));
      });
      push(r);
      units.forEach((u) => track(u).bars.forEach((b) => { barAt[b.id] = { top: r.top, h: r.h, x: b.x, u: u }; }));
    };
    /* each group's rows (items), before any is drawn */
    const plan = gOrder.map((gk) => {
      const g = groups.filter((x) => x.key === gk)[0];
      const gu = uOrder.map((id) => uById[id]).filter((u) => u && u.group === gk);
      if (!g || !gu.length) return null;
      const act = gu.filter(inWinU); const quiet = gu.filter((u) => !inWinU(u));
      /* a long-lived role with one line (角色: 秘书, 参谋, 审阅者): its row is the group, no header */
      const single = by === 'role' && !g.packed && U.units.filter((u) => u.group === gk).length === 1;
      const closed = !single && !!(s.wlShut || {})[gk];
      /* packing (executors): lines that never overlap share a row (first bar → last bar, to now while waiting), so the rows
         equal the peak number of lines alive at once; rows are ordered by the best-ranked line they hold */
      const prow = [];
      if (g.packed) {
        act.slice().sort((a, b) => a.first - b.first).forEach((u) => {
          let i = -1; prow.forEach((pr, k) => { const end = pr[pr.length - 1].end; if (end <= u.first && (i < 0 || end > prow[i][prow[i].length - 1].end)) i = k; });
          if (i < 0) { prow.push([]); i = prow.length - 1; }
          prow[i].push(u);
        });
        const at = (u) => uOrder.indexOf(u.id);
        prow.sort((p, q) => Math.min.apply(null, p.map(at)) - Math.min.apply(null, q.map(at)));
      }
      const C = this.tpConc(act, Wn); const none = !act.length;
      const sub = none ? '这段时间没有活动（' + quiet.length + ' ' + g.unit[0] + '）'
        : g.packed && prow.length ? '本段 ' + act.length + ' ' + g.unit[0] + '，最多同时 ' + prow.length + ' ' + g.unit[1] + '，在做的最多 ' + C.k + ' ' + g.unit[1]
        : '本段 ' + act.length + ' ' + g.unit[0] + '，最多同时在做 ' + C.k + ' ' + g.unit[1];
      /* closed, the sentence sits under the name in the narrow name column: the DAG page's short form (one meaning of
         "最多同时": at work at once; final fix 2026-10-06), on two lines (it breaks after the comma) rather than cut; the whole
         sentence in the title */
      const subShort = none ? '这段时间没有活动' : '本段 ' + act.length + ' ' + g.unit[1] + '，\n最多同时在做 ' + C.k + ' ' + g.unit[1];
      const items = [];
      if (closed) items.push({ kind: 'closed', n: gu.length, quiet: none });
      else if (single) items.push({ kind: 'line', units: gu, packed: false, n: 1, quiet: none });
      else if (none) items.push({ kind: 'quietgrp', n: quiet.length, quiet: true });
      else {
        if (g.packed) prow.forEach((pr) => items.push({ kind: 'line', units: pr, packed: true, n: pr.length, quiet: false }));
        else act.forEach((u) => items.push({ kind: 'line', units: [u], packed: false, n: 1, quiet: false }));
        if (quiet.length) items.push({ kind: 'fold', n: quiet.length, quiet: true, list: quiet });
      }
      return { gk: gk, g: g, single: single, closed: closed, C: C, none: none, sub: sub, subShort: subShort, quiet: quiet, items: items };
    }).filter(Boolean);
    let room = MAX;
    [false, true].forEach((q) => plan.forEach((p) => p.items.forEach((it) => { if (it.quiet === q && room > 0) { it.take = true; room -= 1; } })));
    let counted = 0; let hiddenLines = 0;
    plan.forEach((p) => {
      p.items.forEach((it) => { if (it.take) counted += 1; else hiddenLines += it.n; });
      if (!p.items.some((it) => it.take)) return;
      const gk = p.gk; const g = p.g;
      const toggle = () => { const st = this.state || {}; set({ wlShut: Object.assign({}, st.wlShut || {}, { [gk]: !(st.wlShut || {})[gk] }), hover: null }); };
      if (p.closed) {
        /* the short line sits under the name in the 132px column on two lines of its own (a 56px row) */
        const wrap = p.subShort.indexOf('\n') >= 0;
        push(Object.assign({}, blank, { isGrp: true, h: wrap ? 56 : 40, cls: 'lane wl-grp is-closed' + (wrap ? ' is-wrap' : ''), name: g.name, sub: p.subShort, title: p.sub, closed: true, ex: false,
          chev: 'm6 4 4 4-4 4', conc: p.C.segs, hasSub: false, toggle: toggle }));
        return;
      }
      if (!p.single) push(Object.assign({}, blank, { isGrp: true, h: 26, cls: 'lane wl-grp', name: g.name, sub: p.sub, title: p.none ? p.quiet.map((u) => u.name).join('、') : p.sub, closed: false, ex: true,
        chev: 'm4 6 4 4 4-4', hasSub: true, toggle: toggle }));
      p.items.forEach((it) => {
        if (!it.take || it.kind === 'quietgrp') return;
        if (it.kind === 'line') lineRow(it.units, it.packed, it.quiet ? (cell ? '这一小时没有活动' : '这段时间没有活动') : '');
        else push(Object.assign({}, blank, { isFold: true, h: 26, cls: 'lane wl-fold', name: '另 ' + it.n + ' ' + g.unit[0] + '这段时间没有活动', title: it.list.map((u) => u.name).join('、') }));
      });
    });
    /* 只看需要关注的 with nothing that needs you: one quiet row says so */
    if (attn && !visible.length) push(Object.assign({}, blank, { isFold: true, h: 26, cls: 'lane wl-fold', name: by === 'task' ? '没有需要关注的任务' : '没有需要关注的工作线', title: '需要你决定、失败、受阻或待核对的都没有' }));
    if (hiddenLines) push(Object.assign({}, blank, { isMore: true, h: 28, cls: 'lane wl-more', name: '另 ' + hiddenLines + (by === 'task' ? ' 个' : ' 条') + ' · 整页查看', href: o.full || 'TaskMap.dc.html',
      title: '右栏最多 ' + MAX + ' 行；整页的轨道画出全部工作线' }));
    /* the archived row (archived lines never need you, so 只看需要关注的 leaves it out); a picked day draws the archived lines
       that worked then and says how many */
    const nArch = U.units.filter((u) => u.archived).length;
    const archIn = s.wlArch || !day ? 0 : U.units.filter((u) => u.archived && inWinU(u)).length;
    if (nArch && !attn) push(Object.assign({}, blank, { isArch: true, h: 28, cls: 'lane wl-archrow', ex: !!s.wlArch,
      name: s.wlArch ? '收起已归档的 ' + nArch + (by === 'task' ? ' 个任务' : ' 条') : '已归档 ' + nArch + (by === 'task' ? ' 个任务（已满足超过一天）' : ' 条（任务已满足超过一天）')
        + (archIn ? '；' + (cell ? '这一小时' : '这一天') + '做过事的 ' + archIn + (by === 'task' ? ' 个' : ' 条') + '照常画在上面' : ''),
      title: s.wlArch ? '' : '点一下显示已归档的' + (by === 'task' ? '任务' : '工作线') + '（它们按顺序排进各组）', toggle: () => set({ wlArch: !(this.state || {}).wlArch, hover: null }) }));
    /* the approved calendar, ticks, Host restarts, now line and sum line (timeView, verbatim) on the same window — or, for
       全部 longer than 14 days, the year-style calendar, its day row, crumbs, ticks and sum (wlLongView, the DAG page's) */
    const cellHover = o.hover && String(o.hover).indexOf('cell:') === 0 ? o.hover : null;
    const tv = long ? null : W.timeView(Object.assign({}, mo, { by: 'member', win: win, cell: cell, hover: cellHover, full: false, memberWords: {},
      on: { win: (w) => set({ wlWin: w, wlCell: null, wlDay: null, hover: null }), cell: (k) => set({ wlCell: k, hover: null }), hover: on.hover || noop, unhover: on.unhover || noop } }));
    const LG = long ? this.wlLongView(W, s, Wn, { win: win, day: day, cell: cell, full: false, set: set, tasks: mo.tasks || {}, hk: 'hover', calX: 74 }) : null;
    const nowIn = tv ? tv.hasNow : Wn.mode === 'days' || (now >= Wn.w0 && now <= Wn.w1);
    const nowX = tv ? tv.nowX : r1(X(now)); const nowLabel = tv ? tv.nowLabel : '现在 ' + this.tlHM(now);
    const nowCls = tv ? tv.nowCls : 'tl-now' + (X(now) > 88 ? ' at-end' : '');
    const nowRow = tv ? tv.cls.indexOf('now-row') >= 0 : Wn.mode === 'days';
    /* 今天 / one hour: the tick labels the "现在" label would cover step out (本周 / 全部 give it a row of its own) */
    let ticks = tv ? tv.ticks : LG.ticks;
    if (nowIn && !nowRow && o.trackPx) {
      const tw = (t) => this.tpTextW(t) + 8; const at = (v) => v / 100 * o.trackPx; const n = at(nowX); const nw = tw(nowLabel);
      const NL = /at-end/.test(nowCls) ? [n - nw, n] : [n - nw / 2, n + nw / 2];
      ticks = ticks.filter((k) => { const c = at(k.x); const w = tw(k.label); const r = /day/.test(k.cls) ? [c, c + w] : /last/.test(k.cls) ? [c - w, c] : [c - w / 2, c + w / 2]; return r[1] < NL[0] - 4 || r[0] > NL[1] + 4; });
    }
    /* the calendar card names the work lines active in its hour (timeView's own row names the old members), at most three;
       its tasks' squares follow sqAt too (a task that has not started is hollow); the year view's cards already do */
    let ccard = LG ? LG.ccard : Object.assign({}, tv.ccard, { tasks: (tv.ccard.tasks || []).map((t) => Object.assign({}, t, { sq: String(t.sq || '').replace(/\bs-pending\b/, 's-notyet') })) });
    if (tv && ccard.show && cellHover) {
      const t0 = this.tlMin(String(cellHover).slice(5) + ':00'); const t1 = t0 + 60;
      const LU = by === 'task' ? W.tpUnits(M, 'role', std, o.plan || []).units : U.units;
      const names = LU.filter((u) => u.bars.some((b) => b.s0 < t1 && Math.max(b.e0, b.s0 + 0.5) > t0)).sort((a, b) => b.last - a.last).map((u) => u.name);
      ccard = Object.assign(ccard, { mem: names.slice(0, 3).join('、') + (names.length > 3 ? '，另 ' + (names.length - 3) + ' 条' : ''), hasMem: names.length > 0 });
    }
    /* the bar card: its work line, and its Session when the line has more than one (a line of one Session has no 记录 row:
       "工作记录第 1 段" suggested more); under the bar's row (the axis is 22px, 40px with the now row) */
    let card = { show: false, x: 0, top: 'auto', sq: '', name: '', word: '', tx: '', why: '', rows: [], hint: '' };
    if (hovRun && barAt[hovRun] && M.byId[hovRun]) {
      const b = M.byId[hovRun]; const at = barAt[hovRun]; const R0 = resOf(b); const base = String(b.id).replace(/\+\d+$/, '');
      const L = at.u.line || WL.byId[WL.lineOfRun[base]] || null; const seg = WL.segOf[base] || (L ? L.sessions : 1) || 1;
      const rowsC = [{ k: '工作线', v: L ? L.name : at.u.name }];
      if (L && L.sessions > 1) rowsC.push({ k: '记录', v: '工作记录第 ' + seg + ' 段' + (L.segWhy && L.segWhy[seg] ? '（' + L.segWhy[seg] + '）' : '') + '，共 ' + L.sessions + ' 段' });
      if (b.kind === 'check') rowsC.push({ k: '尝试', v: '第 ' + (b.round || 1) + ' 轮正式检查' });
      else if (b.kind === 'run') rowsC.push({ k: '尝试', v: '第 ' + (b.att || 1) + ' 次尝试' + (b.gap ? ' · ' + b.gap : '') });
      else rowsC.push({ k: '类型', v: b.kind === 'query' ? '只读副本回答，不写回工作记录' : b.m === 'SC' ? '主对话里的一轮' : '工作记录里的一轮，不属于任务' });
      rowsC.push({ k: '时间', v: this.stamp(b.s0) + (b.live ? ' 起，已 ' + this.tlDur(b.s0, now) : '–' + this.tlHM(b.e0) + ' · ' + this.tlDur(b.s0, b.e0)) });
      const actTxt = [b.n.st ? '步骤 ' + b.n.st : '', b.n.ed ? '编辑 ' + b.n.ed : '', b.n.ck ? '检查 ' + b.n.ck + ' 项' : ''].filter(Boolean).join(' · ');
      if (actTxt) rowsC.push({ k: '活动', v: actTxt });
      card = { show: true, x: at.x, top: (at.top + at.h + 2) + 'px', sq: 'sq z10 ' + R0[1], name: nameOfRun(b), word: R0[0], tx: R0[2],
        why: b.why ? '：' + this.wlLabel(b) : '', rows: rowsC, hint: b.task && b.task !== 'GOAL' && on.pick ? '点一下在任务图里选中它' : '' };
    }
    const BYL = { role: '角色', module: '模块', task: '任务' };
    const nAttn = U.units.filter((u) => !u.archived && u.attn < 9).length;
    return {
      bys: ['role', 'module', 'task'].map((k) => ({ label: BYL[k], on: by === k, cls: 'seg-btn' + (by === k ? ' is-on' : ''), go: () => set({ wlBy: k, hover: null }) })),
      wins: LG ? LG.wins : tv.wins, hasCell: !!tv && tv.hasCell, cellLabel: tv ? tv.cellLabel : '', clearCell: () => set({ wlCell: null, hover: null }),
      hasCrumb: !!LG && LG.crumbs.length > 0, crumbs: LG ? LG.crumbs : [],
      attnOn: attn, attnCls: 'seg-btn' + (attn ? ' is-on' : ''), toggleAttn: () => set({ wlAttn: !attn, hover: null }),
      attnTip: (attn ? '再点一次显示全部' : '只留下需要你决定、失败、受阻或待核对的') + '（现在 ' + nAttn + (by === 'task' ? ' 个' : ' 条') + '）',
      stale: stale, resort: () => { const st = this.state || {}; this._wlFz = null; set({ wlSort: (st.wlSort || 0) + 1, hover: null }); },
      hasCal: !LG || !!day, calCls: tv ? tv.calCls : 'cal', cal: tv ? tv.cal : LG.cal, ccard: ccard,
      hasYr: !!LG, yr: LG ? LG.yr : { cls: 'cal yr', wdays: [], weeks: [], card: { show: false, x: 0, top: '0px', sq: '', name: '', word: '', tx: '', tasks: [], hasTasks: false, more: '', hasMore: false, mem: '', hasMem: false, hint: '' } },
      sum: tv ? tv.sum : LG.sum, hasNote: !!tv && !!tv.hasNote, note: tv ? tv.note || '' : '', hasSynth: !!o.synth, synth: o.synth || '',
      cls: 'tl wl tp-lanes' + (nowRow ? ' now-row' : '') + (focus ? ' focus' : ''), axName: by === 'task' ? '每行一个任务' : '工作线 · 按' + BYL[by],
      ticks: ticks, evs: tv ? tv.evs : LG.evs, hasNow: nowIn, nowCls: nowCls, nowX: nowX, nowLabel: nowLabel, nowTagCls: 'tp-now' + (/at-end/.test(nowCls) ? ' at-end' : ''),
      rows: rows, height: y, card: card, unhover: on.unhover || noop, legend: !!o.legend,
      counts: { rows: counted, hidden: hiddenLines, archived: nArch, units: U.units.length }
    };
  }
