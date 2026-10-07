/* =====================================================================
   worklines-long.js — long records (user decision 25; final fix 2026-10-06, the final critic's first finding). Paste every
   method into the logic class of the boards that paste data/worklines.js (Main, TaskMap), VERBATIM
   (sketch/consistency/verbatim-all.mjs checks it). Moved here from TaskMap's own.js so that both boards read ONE model at
   600 tasks: before, TaskMap counted the 600 example's synthetic lines ("21 条工作线工作中", "已归档 280 条") while Main's rail
   and goal bar counted goal 1's real lines only ("3 条工作线工作中", "合成任务的工作线不计入").
   - hist600(): the 600-task example's synthetic run record (08-10 → 10-04 14:15), from big600() itself (never the board's
     task model, so a board's own pause, cancel or decision never rewrites the history; those apply at the read, as at 40).
   - wlSrc() / wl6(): the work-line model a board reads — at 40 tasks the board itself (data/worklines.js on goal 1's runs);
     at 600 the SAME shared code run on the 600 record (a proxy of the board whose tlModel() adds the synthetic rows and marks
     and whose std40() names the 600 map's tasks). Read with W = this.wlSrc(): W.wlRail(), W.wlOwner(), W.wlGroupOwner(),
     W.workLines(), W.tlModel() … — never call setState on W (handlers stay the board's).
   - wlActs(W) / wlLongView(W, s, Wn, o): 轨道's year-style calendar when 全部 spans more than 14 days (decision 25): columns
     are weeks, cells are days; a day → its 24 hours, an hour → its 10-minute ticks, a crumb goes back. Used by the DAG
     page's 轨道 (TaskMap wlView) and the right panel's 轨道 (data/taskpanel.snippet.js tpLanes, Main).
   Needs: data/timeline.js (tlData, tlModel, tlMin, tlDayOf, tlDateLabel, tlWeekday, tlHM), data/worklines.js (runIndex,
   workLines), data/squares.js (sqAt), the board's big600(), std40() and isBig().
   ===================================================================== */
  /* ------------------------------------------------------------ 600 tasks: a synthetic run history (demo data)
     Decision 25's year-style calendar needs a span of more than 14 days; goal 1's real record spans three. The 600-task
     example is synthetic, and so is its record: it starts on Monday 08-10 and agrees with big600()'s states at 10-04 14:15 —
     已满足 tasks ran and passed their check (about one in eight after one rework), the moving ones run, wait or stopped in
     the last days (running and checking ones started after the Host restart of 14:02), the rest never ran. The six named
     tasks keep goal 1's real runs, and the 40-task sample's other runs stay as before. Rows are tlData()'s shape, so
     tlModel() / timeView() read them as extraRuns; marks are the 需要你决定 marks of tasks whose rework reached its limit.
     Not a claim about any real goal: the real backend gives the runs (DESIGN §20.8). Read from big600() (the map's tree
     order: stage → batch → task), so Main's pause, cancel and decisions never change the history. */
  hist600() {
    if (this._h6) return this._h6;
    const B = this.big600(); const R = this.runIndex(); const now = R.now; const today = this.tlDayOf(now);
    const rnd = (i) => (Math.imul(i * 7 + 13, 2654435761) >>> 0) / 4294967296;
    const stampOf = (min) => this.tlDateLabel(this.tlDayOf(min)) + ' ' + this.tlHM(min);
    const rows = []; const marks = []; let seq = 0;
    const add = (m, t, att, kind, s, e, res, why, prev, gap) => {
      seq += 1; const r = rnd(seq * 3 + 1); const id = 'x' + String(seq).padStart(4, '0');
      const n = kind === 'run' ? { st: 12 + Math.round(r * 30), ed: 1 + Math.round(r * 5), ck: 0, rq: 3 + Math.round(r * 8) } : { st: 0, ed: 0, ck: 8 + Math.round(r * 8), rq: 0 };
      rows.push({ id: id, m: m, task: t.id, att: att, kind: kind, s: stampOf(Math.round(s)), e: stampOf(Math.round(e)), res: res, why: why, prev: prev, gap: gap, n: n, p: null, v: null, g: null });
      return id;
    };
    const syn = B.tasks.filter((t) => !R.any[t.id]);
    /* 规格与验收 is the reviewer's (one long-lived line); every other task opens its own 执行者 line */
    const memberOf = (t) => (t.stage === 'S1' ? 'RV' : 'X');
    /* a lunch hour: work that would start between 12:00 and 13:00 starts after it */
    const lunch = (t) => { const m = t % 1440; return m >= 720 && m < 780 ? t - m + 780 + Math.round(rnd(t) * 15) : t; };
    /* one 已满足 task from t0: run → handoff → check passed; about one in eight fails its first check and is requeued */
    const finish = (t, t0, i) => {
      const m = memberOf(t); let s = lunch(t0); let prev = null; const tries = rnd(i * 3 + 7) < 0.12 ? 2 : 1;
      for (let a = 1; a <= tries; a += 1) {
        const len = (a === 1 ? 45 : 25) + Math.round(rnd(i * 5 + a) * (a === 1 ? 95 : 45));
        const run = add(m, t, a, 'run', s, s + len, 'handoff', '', prev, a > 1 ? '系统自动重新入队（1/3）：检查未通过' : null);
        const cs = s + len + 3 + Math.round(rnd(i * 7 + a) * 17); const ce = cs + 6 + Math.round(rnd(i * 11 + a) * 8);
        prev = add(m, t, a, 'check', cs, ce, a === tries ? 'passed' : 'failed', a === tries ? '' : ['lint 1 项', '回放测试 1 项', '边界检查 2 项'][i % 3], run, null);
        s = lunch(ce + 8 + Math.round(rnd(i * 13 + a) * 27));
      }
      return s;
    };
    /* the 已满足 ones in the order the stages were worked on (规格与验收 first and short, 写入收口 from early on, the later
       stages side by side, 会话恢复 last), spread over the days from 08-10 to 10-03 by a weekly rhythm (weekdays, a light
       Saturday, Sundays mostly off); each day the reviewer's line and two 执行者 slots (three on a busy day) work from about
       09:00. pos = a task's place in its stage (stage → batch → task, big600()'s own order) */
    const pos = {}; B.stages.forEach((st) => { const ts = B.tasks.filter((x) => x.stage === st.id); ts.forEach((x, i) => { pos[x.id] = i / ts.length; }); });
    const SPAN = { S1: [0, 0.22], S2: [0.04, 0.4], S3: [0.3, 0.66], S4: [0.36, 0.62], S5: [0.2, 0.56], S6: [0.56, 0.44], S7: [0.42, 0.56], S8: [0.82, 0.18] };
    const when = (t) => { const p = SPAN[t.stage] || [0.9, 0.1]; return p[0] + pos[t.id] * p[1]; };
    const sat = syn.filter((t) => t.st === 'satisfied').sort((a, b) => when(a) - when(b) || (a.id < b.id ? -1 : 1));
    const d0 = this.tlDayOf(this.tlMin('08-10 09:00'));
    const wts = []; for (let d = d0; d < today; d += 1) { const wd = (new Date(d * 86400000).getUTCDay() + 6) % 7; const r = rnd(d); wts.push(wd < 5 ? 0.55 + r : wd === 5 ? (r < 0.5 ? 0.3 : 0) : (r < 0.25 ? 0.12 : 0)); }
    const sum = wts.reduce((a, b) => a + b, 0); let acc = 0; let i0 = 0;
    wts.forEach((w, j) => {
      const d = d0 + j; acc += w; const upto = Math.round(sat.length * acc / sum); const todays = sat.slice(i0, upto);
      const clocks = { RV: [d * 1440 + 540 + Math.round(rnd(d * 3) * 30)], X: (todays.length > 9 ? [0, 1, 2] : [0, 1]).map((q) => d * 1440 + 540 + Math.round(rnd(d * 5 + q) * 45)) };
      todays.forEach((t, q) => { const cl = clocks[memberOf(t)]; let b = 0; cl.forEach((c, z) => { if (c < cl[b]) b = z; }); cl[b] = finish(t, cl[b], d * 31 + q); });
      i0 = upto;
    });
    /* the moving ones, in the last days */
    syn.filter((t) => ['running', 'verifying', 'failed', 'blocked', 'decide'].indexOf(t.st) >= 0).forEach((t, q) => {
      const m = memberOf(t); const r = (k) => rnd(q * 19 + k);
      const live0 = now - 12 + Math.round(r(1) * 9);                           /* 14:03–14:12, after the restart */
      const morning = today * 1440 + 600 + Math.round(r(2) * 170);             /* 10:00–12:50 today */
      const yday = (today - 1) * 1440 + 600 + Math.round(r(3) * 360);          /* yesterday 10:00–16:00 */
      if (t.st === 'running') {
        let prev = null; let gap = null;
        if (t.att > 1) { const a = add(m, t, 1, 'run', yday, yday + 50, 'handoff', '', null, null); prev = add(m, t, 1, 'check', yday + 55, yday + 63, 'failed', 'lint 2 项', a, null); gap = '系统自动重新入队（1/3）：检查未通过'; }
        add(m, t, t.att, 'run', live0, now + 60, 'handoff', '', prev, gap);
      } else if (t.st === 'verifying') {
        const a = add(m, t, 1, 'run', morning, morning + 55, 'handoff', '', null, null);
        add(m, t, 1, 'check', live0, now + 20, 'passed', '', a, null);
      } else if (t.st === 'failed') {
        const a = add(m, t, 1, 'run', yday, yday + 60, 'handoff', '', null, null);
        const c = add(m, t, 1, 'check', yday + 64, yday + 72, 'failed', '回放测试 1 项', a, null);
        if (/执行失败/.test(t.why || '')) add(m, t, 2, 'run', morning, morning + 40, 'execfail', '工具调用连续失败 3 次', c, '系统自动重新入队（1/3）：检查未通过');
      } else if (t.st === 'blocked') {
        const a = add(m, t, 1, 'run', morning, morning + 50, 'handoff', '', null, null);
        add(m, t, 1, 'check', morning + 54, morning + 61, 'incomplete', '回放测试超时，报告不完整', a, null);
      } else if (/上限/.test(t.why || '')) {
        let prev = null; let s = (today - 2) * 1440 + 600 + Math.round(r(5) * 120);
        for (let a = 1; a <= 4; a += 1) {
          const run = add(m, t, a, 'run', s, s + 45, 'handoff', '', prev, a > 1 ? '系统自动重新入队（' + (a - 1) + '/3）：检查未通过' : null);
          prev = add(m, t, a, 'check', s + 49, s + 57, 'failed', ['lint 2 项', '回放测试 1 项', '边界检查 1 项', 'lint 1 项'][a - 1], run, null);
          if (a === 4) marks.push({ t: stampOf(s + 57), m: m, task: t.id, kind: 'decide', label: '自动返工已达上限（3/3），需要你决定', at: s + 57 });
          s += 57 + 300 + Math.round(r(6 + a) * 200);
        }
      } else add(m, t, 1, 'run', today * 1440 + 790 + Math.round(r(4) * 20), this.tlMin('10-04 14:02'), 'unknown', 'Host 14:02 重启时这次执行没有结束记录', null, null);
    });
    this._h6 = { rows: rows, marks: marks };
    return this._h6;
  }
  /* the work-line model the board reads: at 40 tasks the shared one (worklines.js on goal 1's runs); at 600 the SAME shared
     code run on the 600 record — so 轨道, 负责, 参与, the rail, the goal bar and the counts read one model at both scales and
     on both boards ("21 条工作线工作中" at 600) */
  wlSrc() { return this.isBig() ? this.wl6() : this; }
  /* the proxy at 600: a child of the board whose tlModel() adds the synthetic rows (after the board's own extra runs: Main's
     turns) and, for goal 1, the synthetic marks, and whose std40() names the 600 map's tasks (a batch's first file stands for
     the tasks of the batch that name none, so 模块 can group them) and then the 40-task sample's tasks that ran but are not
     drawn at 600; fresh caches (runIndex _ri, workLines _wls, wlUnits _wu). States come from big600() (as std40() at 40); a
     board's pause, cancel or decision applies at the read (wlNowStates). */
  wl6() {
    if (this._p6) return this._p6;
    const H = this.hist600(); const self = this; const P = Object.create(this);
    P._ri = null; P._wls = null; P._wu = null; P._wlFz = null;
    const memo = new Map();
    P.tlModel = (o) => {
      const M = self.tlModel(Object.assign({}, o, { extraRuns: ((o && o.extraRuns) || []).concat(H.rows) }));
      if (!memo.has(M)) memo.set(M, (o && o.goal) !== 'g1' ? M : Object.assign({}, M, { marks: M.marks.concat(H.marks.filter((m) => m.at <= M.now)) }));
      return memo.get(M);
    };
    const B = this.big600();
    const bfile = {}; B.tasks.forEach((t) => { if (t.batch && !bfile[t.batch] && (t.files || []).length) bfile[t.batch] = t.files[0]; });
    const has = {}; B.tasks.forEach((t) => { has[t.id] = true; });
    const tasks = B.tasks.map((t) => ({ id: t.id, name: t.name, st: t.st, why: t.why, stage: t.stage, att: t.att, agent: t.agent, files: (t.files || []).length ? t.files : bfile[t.batch] ? [bfile[t.batch]] : [] }))
      .concat(this.std40().tasks.filter((t) => !has[t.id]));
    const stages = B.stages.map((k) => ({ id: k.id, name: k.name }));
    P.std40 = () => ({ stages: stages, tasks: tasks });
    this._p6 = P;
    return P;
  }
  /* activity per hour and per day of a work-line source W: timeView()'s own rule (a run's steps and edits spread over its
     hours with the totals kept; a check counts once, in the hour it starts), repeated so the year-style calendar and its
     day row read the same numbers as the approved calendar (TaskMap's harness compares them with timeView() at 40), plus
     the work lines active in each hour and day, for the cards */
  wlActs(W) {
    const R = W.runIndex(); const M = R.M; const WL = W.workLines();
    if (this._wa && this._wa.M === M) return this._wa;
    const cells = {}; const days = {};
    const cellAt = (h) => cells[h] || (cells[h] = { st: 0, ed: 0, ck: 0, tasks: [], lines: [] });
    M.runs.forEach((r) => {
      const span = r.e0 - r.s0; const parts = [];
      for (let h = Math.floor(r.s0 / 60) * 60; h < r.e0; h += 60) parts.push([h, Math.max(0, Math.min(r.e0, h + 60) - Math.max(r.s0, h)) / (span || 1)]);
      if (!parts.length) parts.push([Math.floor(r.s0 / 60) * 60, 1]);
      ['st', 'ed', 'ck'].forEach((k) => {
        const total = k === 'ck' ? (r.kind === 'check' && String(r.id).indexOf('+') < 0 ? 1 : 0) : r.n[k] || 0; if (!total) return;
        if (k === 'ck') { cellAt(Math.floor(r.s0 / 60) * 60).ck += 1; return; }
        const raw = parts.map((p) => p[1] * total); const fl = raw.map(Math.floor); let left = total - fl.reduce((a, b) => a + b, 0);
        raw.map((v, i) => [v - fl[i], i]).sort((a, b) => b[0] - a[0]).forEach((p) => { if (left > 0) { fl[p[1]] += 1; left -= 1; } });
        parts.forEach((p, i) => { if (!fl[i]) return; cellAt(p[0])[k] += fl[i]; });
      });
      const lid = WL.lineOfRun[r.id];
      parts.forEach((p) => { const c = cellAt(p[0]); if (r.task && r.task !== 'GOAL' && c.tasks.indexOf(r.task) < 0) c.tasks.push(r.task); if (lid && c.lines.indexOf(lid) < 0) c.lines.push(lid); });
    });
    Object.keys(cells).forEach((h) => {
      const c = cells[h]; const d = this.tlDayOf(+h); const x = days[d] || (days[d] = { st: 0, ed: 0, ck: 0, tasks: [], lines: [] });
      x.st += c.st; x.ed += c.ed; x.ck += c.ck;
      c.tasks.forEach((t) => { if (x.tasks.indexOf(t) < 0) x.tasks.push(t); }); c.lines.forEach((l) => { if (x.lines.indexOf(l) < 0) x.lines.push(l); });
    });
    this._wa = { M: M, cells: cells, days: days };
    return this._wa;
  }
  /* 全部 longer than 14 days (decision 25): the year-style calendar — columns are weeks (Monday on top), cells are days, on
     the calendar's neutral ramp — and, once a day is picked, that day's 24 hours as the approved calendar row (the picked
     day ringed; again = back to 全部). An hour of that row narrows the lanes to the hour (ringed; again = back to the day).
     A crumb 全部 › day › hour goes back. Also the ticks (a week per tick, then hours, then 10 minutes), the Host restarts,
     the window buttons and the sum line of these levels. Cells, levels, card rows and the sum use the approved calendar's
     numbers (wlActs); a day's level is ten hours of the hour scale (150 / 300 / 450).
     o = { win, day ('MM-DD' or null), cell ('MM-DD HH' or null), full (the page: 2-hour ticks up to 12 hours), set (the
     board's setState), tasks ({ id: { name, st } }, for the cards and 未排期), hk (the state key of the hover: 'wHover' on
     the DAG page, 'hover' in the panel), calX (where the hour row's first cell starts: 90 on the page, 74 in the panel),
     clampFor (the DAG page's time cursor: clampFor(win, cell, day) → t; omitted in the panel) } */
  wlLongView(W, s, Wn, o) {
    const A = this.wlActs(W); const R = W.runIndex(); const M = R.M; const now = R.now; const WL = W.workLines();
    const today = this.tlDayOf(now); const first = this.tlDayOf(M.first); const set = o.set; const noop = () => {};
    const hk = o.hk || 'wHover'; const hv = s[hk] || null; const calX = o.calX === undefined ? 90 : o.calX;
    /* a click clears the hover; on the DAG page it also keeps the time cursor inside the new window */
    const go = (p, w, c, d) => set(Object.assign(p, { [hk]: null }, o.clampFor ? { t: o.clampFor(w, c, d) } : {}));
    const r1 = (v) => Math.round(v * 100) / 100; const X = Wn.X; const p2 = (n) => String(n).padStart(2, '0');
    const tot = (c) => (c ? c.st + c.ed + c.ck : 0);
    const words = (c) => '步骤 ' + c.st + ' · 编辑 ' + c.ed + ' · 检查 ' + c.ck + ' 次';
    const lvl = (n) => (!n ? 0 : n < 15 ? 1 : n < 30 ? 2 : n < 45 ? 3 : 4);
    const dlvl = (n) => (!n ? 0 : n < 150 ? 1 : n < 300 ? 2 : n < 450 ? 3 : 4);
    const wd = (d) => (new Date(d * 86400000).getUTCDay() + 6) % 7;
    const dayLabel = (d) => this.tlDateLabel(d) + ' ' + this.tlWeekday(d);
    const lineRows = (ids) => { const ns = ids.map((l) => WL.byId[l]).filter(Boolean).sort((a, b) => b.last - a.last).map((L) => L.name); return { mem: ns.slice(0, 3).join('、') + (ns.length > 3 ? '，另 ' + (ns.length - 3) + ' 条' : ''), hasMem: ns.length > 0 }; };
    const taskRows = (ids) => {
      const ts = ids.filter((id) => o.tasks[id]);
      return { tasks: ts.slice(0, 3).map((id) => ({ name: o.tasks[id].name, sq: 'sq z8 ' + this.sqAt(o.tasks[id].st) })), hasTasks: ts.length > 0, more: ts.length > 3 ? '另有 ' + (ts.length - 3) + ' 个任务' : '', hasMore: ts.length > 3 };
    };
    const empty = { show: false, x: 0, top: '0px', sq: '', name: '', word: '', tx: '', why: '', tasks: [], hasTasks: false, more: '', hasMore: false, mem: '', hasMem: false, hint: '' };
    const hov = (key) => () => { if ((this.state || {})[hk] !== key) set({ [hk]: key }); };
    const pickedDay = o.day ? this.tlDayOf(this.tlMin(o.day + ' 00:00')) : null;
    /* the year: weeks from the Monday on or before the first run to today */
    const mon0 = first - wd(first); const nw = Math.ceil((today - mon0 + 1) / 7);
    const hovDay = hv && hv.indexOf('day:') === 0 ? hv.slice(4) : null;
    let ycard = empty; let lastMo = null; const weeks = [];
    for (let w = 0; w < nw; w += 1) {
      let label = ''; const days = [];
      for (let i = 0; i < 7; i += 1) {
        const d = mon0 + w * 7 + i; const key = this.tlDateLabel(d);
        if (d < first || d > today) { days.push({ on: false, off: true, key: key, cls: 'cal-c is-future', tip: '', pick: noop, hover: noop }); continue; }
        const mo = +key.slice(0, 2); if (mo !== lastMo) { label = mo + ' 月'; lastMo = mo; }
        const c = A.days[d]; const n = tot(c); const isOn = pickedDay === d;
        if (hovDay === key) {
          ycard = Object.assign({}, empty, { show: true, x: Math.max(0, 30 + w * 14 - 8), top: (18 + (i + 1) * 14 + 4) + 'px', sq: 'sq z10 cal-l' + dlvl(n), name: dayLabel(d) + (d === today ? '（今天）' : ''),
            word: n ? words(c) : '这一天没有活动', tx: 'tx-plain', hint: !n ? '' : isOn ? '再点一次回到全部' : '点一下看这一天：它的 24 小时和那天的轨道' }, taskRows(c ? c.tasks : []), lineRows(c ? c.lines : []));
        }
        days.push({ on: true, off: false, key: key, cls: 'cal-c cal-l' + dlvl(n) + (isOn ? ' is-on' : ''), tip: dayLabel(d) + '，' + (n ? '步骤 ' + c.st + '，编辑 ' + c.ed + '，检查 ' + c.ck + ' 次' : '没有活动'),
          pick: !n ? noop : isOn ? () => set({ wlDay: null, wlCell: null, [hk]: null }) : () => go({ wlDay: key, wlCell: null }, 'all', null, key), hover: hov('day:' + key) });
      }
      weeks.push({ label: label, days: days });
    }
    const yr = { cls: 'cal yr full', wdays: ['周一', '', '周三', '', '周五', '', '周日'].map((x) => ({ label: x })), weeks: weeks, card: ycard };
    /* a picked day: its 24 hours, the approved calendar row (an hour picked = ringed) */
    let cal = { cls: 'cal full', head: [], rows: [] }; let ccard = empty;
    if (pickedDay !== null) {
      const hovCell = hv && hv.indexOf('cell:') === 0 ? hv.slice(5) : null;
      const cells = Array.from({ length: 24 }, (_, h) => {
        const at = pickedDay * 1440 + h * 60; const c = A.cells[at]; const n = tot(c); const key = o.day + ' ' + p2(h); const future = at >= now; const isOn = o.cell === key;
        if (hovCell === key) {
          ccard = Object.assign({}, empty, { show: true, x: calX + h * 14 - 8, top: (18 + 14 + 4) + 'px', sq: 'sq z10 cal-l' + lvl(n), name: dayLabel(pickedDay) + ' ' + p2(h) + ':00–' + p2(h + 1) + ':00',
            word: future ? '还没到这个时间' : n ? words(c) : '这一小时没有活动', tx: 'tx-plain', hint: future || !n ? '' : isOn ? '再点一次取消，回到这一天' : '点一下只看这一小时' }, taskRows(c ? c.tasks : []), lineRows(c ? c.lines : []));
        }
        return { key: key, cls: 'cal-c cal-l' + lvl(n) + (future ? ' is-future' : '') + (isOn ? ' is-on' : ''), tip: key + ':00，' + (future ? '还没到' : n ? '步骤 ' + c.st + '，编辑 ' + c.ed + '，检查 ' + c.ck + ' 次' : '没有活动'),
          pick: future || !n ? noop : () => go({ wlCell: isOn ? null : key }, 'all', isOn ? null : key, o.day), hover: hov('cell:' + key) };
      });
      cal = { cls: 'cal full', head: Array.from({ length: 24 }, (_, h) => ({ label: h % 6 === 0 ? String(h) : '' })), rows: [{ label: dayLabel(pickedDay), cells: cells }] };
    }
    /* ticks: a week per tick over the year (Mondays), then hours over a day, 10 minutes over an hour */
    const ticks = [];
    if (Wn.mode === 'days') { for (let d = Wn.d0; d < Wn.d0 + Wn.nd; d += 1) if (d === Wn.d0 || wd(d) === 0) ticks.push({ x: r1(X(d * 1440 + 480)), label: this.tlDateLabel(d), cls: 'tl-tick day' + (d <= today && today < d + 7 ? ' is-today' : '') }); }
    else {
      const step = o.cell ? 10 : Wn.w1 - Wn.w0 <= (o.full ? 720 : 480) ? 60 : 120;
      for (let t = Math.ceil(Wn.w0 / step) * step; t < Wn.w1; t += step) { const x = r1(X(t)); ticks.push({ x: x, label: this.tlHM(t), cls: 'tl-tick' + (x > 94 ? ' last' : '') }); }
    }
    /* Host restarts: unlabelled over weeks (they would collide), named over a day or an hour */
    const evs = M.events.filter((e) => Wn.inWin(e.at, e.at + 0.1)).map((e) => ({ x: r1(X(e.at)), label: Wn.mode === 'days' ? '' : e.label + ' ' + this.tlHM(e.at) }));
    const wins = [['today', '今天'], ['week', '本周'], ['all', '全部']].map((p) => { const on = pickedDay === null && o.win === p[0];
      return { label: p[1], on: on, cls: 'seg-btn' + (on ? ' is-on' : ''), go: () => go({ wlWin: p[0], wlCell: null, wlDay: null }, p[0], null, null) }; });
    const crumbs = [];
    if (pickedDay !== null) {
      crumbs.push({ label: '全部', sep: false, link: true, here: false, cls: 'c', go: () => set({ wlDay: null, wlCell: null, [hk]: null }) });
      crumbs.push({ label: dayLabel(pickedDay), sep: true, link: !!o.cell, here: !o.cell, cls: 'c' + (o.cell ? '' : ' is-on'), go: o.cell ? () => set({ wlCell: null, [hk]: null }) : noop });
      if (o.cell) crumbs.push({ label: o.cell.slice(-2) + ':00–' + p2(+o.cell.slice(-2) + 1) + ':00', sep: true, link: false, here: true, cls: 'c is-on', go: noop });
    }
    /* the sum line: the hour, else the day, else everything since the first run (timeView's words), and 未排期 n */
    const inSum = (h) => (o.cell ? h === Wn.w0 : pickedDay !== null ? this.tlDayOf(h) === pickedDay : true);
    const S1 = Object.keys(A.cells).filter((h) => inSum(+h)).reduce((a, h) => { const c = A.cells[h]; return { st: a.st + c.st, ed: a.ed + c.ed, ck: a.ck + c.ck }; }, { st: 0, ed: 0, ck: 0 });
    const ran = {}; M.runs.forEach((r) => { if (r.task) ran[r.task] = true; });
    const u0 = Object.keys(o.tasks).filter((id) => !ran[id] && ['satisfied', 'cancelled'].indexOf(o.tasks[id].st) < 0).length;
    const winWord = o.cell ? o.cell + ':00 这一小时' : pickedDay !== null ? dayLabel(pickedDay) : '全部（' + this.tlDateLabel(first) + ' 起，' + nw + ' 周）';
    return { yr: yr, cal: cal, ccard: ccard, ticks: ticks, evs: evs, wins: wins, crumbs: crumbs,
      sum: winWord + '：步骤 ' + S1.st + ' · 编辑 ' + S1.ed + ' · 检查 ' + S1.ck + ' 次' + (u0 ? ' · 未排期 ' + u0 : '') };
  }
