/* =====================================================================
   lineview.snippet.js — a work line's own conversation in the centre (user decision 33, 2026-10-06; repo HANDOFF decision
   33, UI-WORKBENCH §0 item 13; the older direction UI-WORKBENCH §1 item 2: the centre is a classic Session view that switches
   between the project's main conversation and a named Agent's conversation). Paste every method VERBATIM into the logic class
   of a board with a work-line rail (Main, Plan, Decide, Done, Chain, Member); `...this.lvState()` into the constructor's
   state. Markup: data/lineview.snippet.html (pieces [1]–[3]); CSS: kit.css §19. Worked example: sketch/lineview/demo/
   (make-demo.mjs turns Main into LineDemo.dc.html with exactly the edits a board agent makes). Checked by
   sketch/consistency/verbatim-all.mjs ("lineview.snippet.js: whole, 17/17 methods").
   - A click on ANY work line in the rail (state `line`) switches the centre to that line's conversation: a back row
     (回到主对话; 秘书（主对话）'s own row also goes back), the line's facts and the controls that apply (暂停 / 继续 / 取消 /
     重新入队, each with the approved hover card; only while a run of the line goes on, none while the goal is stopped; a
     long-lived role's line has no task to cancel, so it gets 暂停 / 继续 only), its record — the runs, checks, read-only
     consultations and turns of its Session and of the Sessions that continued it (wlRecord() of data/worklines.js or
     data/worklines-snap.js) — as the conversation's rows, newest at the bottom and in view, and a composer addressed to the
     line: 问一问（只读） (a read-only copy branched from its context answers; "正在建立咨询…" while the copy is made) or 直接干预
     (a message to the line itself, 已排队 → 已送达 at its next safe point → 已生效 / 被拒绝; it also sets an idle line to
     work; a line that waits for your decision keeps it queued until you decide). An archived or ended line (its task 已满足)
     is read-only: 问一问 only, from its saved record. Every conversation you open starts on 问一问（只读）.
   - The summary a click used to expand (负责 · 正在做 / 原因 · 最近一步) is the row's hover / focus card.
   - Everything runs on the board's own clock (o.stamp) and state; no timers. The approved Member page keeps its own page;
     整页查看 links to it (执行者 · SSE 推送) and to Chain (执行者 · 重新入队与失败类别) only.
   - Integration 2026-10-07 (DESIGN §22.4): what the six boards had added round this file after the independent verification is
     in it now — the card's direction measured (lvCardUp), every conversation opening on 问一问 (lvLeave, lvRail's pick), the
     hold of a line that waits for your decision (lvView's 'decide'), a refused message sending a busy line back to its task
     (advance), the 任务 fact as a button, a link or plain text (o.hasTask, o.taskHref), an archived line's 正在做 row, and the
     quotes of 引用到草稿 kept per conversation (lvSwapTo) and taken along by what you send.
   - Final fix 2026-10-07 (DESIGN §22.9, the final critic): a paused line's 正在做 by Main's rule on every board (lvDoing: the
     run you started, live or stopped by your pause, else the step it was on), and its copy's "暂停时…" the same (lvAnswer's
     before); the copy's 最近一步 is the card's; a line the goal's 暂停 / 取消 holds reads 原因 and its record ends with where to go on; the back row's words
     and title (o.backLabel, o.backTip); 「需要你决定」 as a button or link for a line that waits for your decision (o.decide,
     o.decideHref); the direct interventions of the record (R.acts) as your messages.
   Board inputs (renderVals): lvr = this.lvRail(lines, archived, s, { set, upFrom }) and lv = this.lvView(s, { set, line, rec,
   rich, goal, goalCtl, stamp, back | backHref, backLabel, backTip, togglePanel, showThink, full, autoOpen, selTask, hasTask,
   noTaskTip, taskHref, taskSq, rejects, rejectReply, decide | decideHref }) — see lvView(). A board recounts its rail head
   over lvRowOf(row, s) and merges lvLeave() into every action that goes to the main conversation (a decision card, 问秘书, a
   goal row, 在对话里问).
   ===================================================================== */
  /* the state keys: line = the work line whose conversation is in the centre (null: the main conversation); lvHover = the rail
     row under the pointer, lvHoverUp = { id, up }: which way its card opens, measured (lvCardUp); lvMode = 'ask' (问一问（只读）)
     | 'act' (直接干预); lvDrafts = { '<line>|<mode>': text }; lvLog = { <line>: what you did in its view, in order (questions,
     interventions, controls, the runs they started) }; lvCtl = { <line>: { st: 'pausing' | 'paused' | 'cancelling' |
     'cancelled' | 'working', att, cut, stopT, stopWhere } }; lvOpen = the runs you opened or closed; lvTip = the control card
     shown; lvConfirm = the line whose 取消 asks first; lvSeq = ids; lvKeep = { <line> | 'main': the quotes waiting in the
     draft of each conversation that is not in the centre } (lvSwapTo) */
  lvState() {
    return { line: null, lvHover: null, lvHoverUp: null, lvMode: 'ask', lvDrafts: {}, lvLog: {}, lvCtl: {}, lvOpen: {}, lvTip: null, lvConfirm: null, lvSeq: 0, lvKeep: {} };
  }
  /* merge into any action that goes back to the main conversation (read at click time): it opens on 问一问（只读） again next
     time, a question whose read-only copy was being made is answered (lvCur: coming back never replays "正在建立咨询…"), and
     the quotes of the main conversation's draft come back (lvSwapTo) */
  lvLeave() {
    const s = this.state || {};
    return Object.assign({ line: null, lvHover: null, lvHoverUp: null, lvTip: null, lvConfirm: null, lvMode: 'ask' }, s.line ? { lvLog: this.lvCur().lvLog || {} } : {}, this.lvSwapTo(null));
  }
  /* the quotes waiting in a draft (引用到草稿 from a file page: state.quotes of data/auxtabs.snippet.js) belong to the
     conversation in the centre, as each conversation keeps its own draft (lvDrafts): switching (to = a line id, or null for
     the main conversation) keeps the ones you leave in lvKeep and brings back the ones of the conversation you open. Read at
     click time (this.state); a board without quotes gets nothing */
  lvSwapTo(to) {
    const s = this.state || {}; const from = s.line || 'main'; const t = to || 'main';
    if (from === t || !Array.isArray(s.quotes)) return {};
    const keep = Object.assign({}, s.lvKeep || {}); keep[from] = s.quotes; const back = Array.isArray(keep[t]) ? keep[t] : []; delete keep[t];
    return { lvKeep: keep, quotes: back };
  }
  /* which way a rail row's card opens, read from where the row is when it is hovered or focused (the rail scrolls, so a row's
     index says nothing about its place on screen). def = lvRail's own choice (above for the last o.upFrom rows and the
     archived names); it stands while the card fits there, else the card opens on the side with room. 240px is just above
     the tallest card (221px). null: no box to read (a static page) — lvRail's rule stands */
  lvCardUp(ev, def) {
    try {
      const t = ev && ev.currentTarget; const rl = t && t.closest ? t.closest('.rail') : null;
      if (!rl || !t.getBoundingClientRect) return null;
      const b = t.getBoundingClientRect(); const R = rl.getBoundingClientRect(); const H = 240;
      const below = R.bottom - b.bottom; const above = b.top - R.top;
      return def ? !(above < H && below > above) : below < H && above > below;
    } catch (e) { return null; }
  }
  /* the state as a click sees it: a question whose read-only copy was being made is answered (its spinner is a CSS delay; the
     next click settles it in state, so a re-mount never replays it — Member's settle()) */
  lvCur() {
    const st = this.state || {}; const lg = st.lvLog || {}; let any = false; const out = {};
    Object.keys(lg).forEach((k) => { out[k] = lg[k].map((e) => { if (e.k === 'ask' && e.st === 'creating') { any = true; return Object.assign({}, e, { st: 'done' }); } return e; }); });
    return any ? Object.assign({}, st, { lvLog: out }) : st;
  }
  /* a rail row (or a board's line object) after what you did in the line's own view: 已暂停 / 待命 after 暂停 / 取消 there, 工作中
     while a run you started goes on (继续, 重新入队, a direct intervention that set an idle line to work). The goal's own pause
     or cancel wins. The board recounts its head over these rows (wlHeadOf). */
  lvRowOf(r, s) {
    if (!r) return r;
    const st = s || this.state || {}; const C = (st.lvCtl || {})[r.id]; const lg = (st.lvLog || {})[r.id] || [];
    if (r.why === '你暂停了目标' || /目标已取消/.test(r.why || '')) return r;
    if (C && C.st === 'paused') return Object.assign({}, r, { state: 'waiting', word: '已暂停', dot: 'dot s-waiting', why: '你暂停了这条工作线' });
    if (C && C.st === 'cancelled') return Object.assign({}, r, { state: 'idle', word: '待命', dot: 'dot s-idle', why: '你取消了这次执行，可重新入队' });
    const live = lg.filter((e) => e.k === 'run' && e.live).pop();
    if (live && r.state !== 'doing') return Object.assign({}, r, { state: 'doing', word: '工作中', dot: 'dot s-running', why: live.label });
    return r;
  }
  /* 正在做 / 原因 of a line (the card and the view): the board's approved words while nothing changed it in its view — its live
     line ("正在运行命令：…") rides on the state word, 正在做 keeps the board's text; once you acted in its view, what that left:
     the run you started, or the reason of its stop. A paused line keeps what it was doing (Main's rule, final fix 2026-10-07 —
     every board): the run you started, live or stopped by your pause; else, when you paused it in its view, the step it was
     on (its live line without 正在: "运行命令：SSE 推送相关测试", or the board's 正在做 text, never another key's text such as
     Done's 完成); a line the goal's pause holds keeps the board's approved row (version 14). was = what it was doing when it
     stopped, for its read-only copy ("你暂停了它；暂停时…", lvAnswer) */
  lvDoing(L, r, s) {
    const st = s || this.state || {}; const C = (st.lvCtl || {})[r.id]; const lg = (st.lvLog || {})[r.id] || [];
    const runs = lg.filter((e) => e.k === 'run'); const run = runs.filter((e) => e.live).pop();
    const held = runs.length && !runs[runs.length - 1].live && runs[runs.length - 1].res === 'paused' ? runs[runs.length - 1] : null;
    const step = L.live ? String(L.live).replace(/^正在/, '') : !L.doingKey || L.doingKey === '正在做' ? L.doing || '' : '';
    if (run) return { k: '正在做', v: run.label, live: '', was: run.label };
    if (r.word === '已暂停') {
      if (held) return { k: '正在做', v: held.label, live: '', was: held.label };
      if (r.why === '你暂停了目标') return { k: L.doingKey || '正在做', v: L.doing || r.why || '', live: '', was: step || L.doing || '' };
      return step ? { k: '正在做', v: step, live: '', was: step } : { k: '原因', v: r.why || '', live: '', was: '' };
    }
    if (C && r.state !== 'doing') return { k: '原因', v: r.why || '', live: '', was: '' };
    return { k: L.doingKey || '正在做', v: L.doing || r.why || '', live: r.state === 'doing' && L.live ? L.live : '', was: L.doing || '' };
  }
  /* the state word's colour (DESIGN §4): the dot's family, the stops in red, 等你决定 yellow */
  lvTx(r) {
    if (r.state === 'doing') return 'tx-running';
    if (r.word === '等你决定') return 'tx-decide';
    if (r.state === 'waiting') return 'tx-waiting';
    if (r.word === '停下（失败）') return 'tx-failed';
    if (r.word === '停下（受阻）') return 'tx-blocked';
    return 'tx-plain';
  }
  /* the rail's rows. lines / archived = the board's line objects in its order: { id, name, role, task, short, state, word,
     dot, why, recent, duty, doingKey, doing, last, live } (archived ones may leave doing empty; where a board gives one, the
     card keeps it). A click opens the line in the centre on 问一问（只读） (秘书（主对话）: back to the main conversation); the
     row of the conversation in the centre is current (aria-current, kit §19.1); hover and focus show the card the click used
     to expand (负责 · 正在做 / 原因 · 最近一步), under the row, or above it where the rail has no room under it (lvCardUp); a
     static page has no box to measure: above for the last o.upFrom rows (default: the last three) and the archived names */
  lvRail(lines, archived, s, o) {
    const cur = s.line || null; const hv = s.lvHover || null; const n = lines.length;
    const upFrom = o.upFrom === undefined ? n - 3 : o.upFrom;
    const hvUp = s.lvHoverUp && s.lvHoverUp.id === hv ? s.lvHoverUp : null;
    const set = (p) => o.set(Object.assign({ lvLog: this.lvCur().lvLog || {} }, p));
    const one = (L, i, arch) => {
      const r = this.lvRowOf(L, s); const main = r.role === 'secretary'; const on = main ? !cur : cur === r.id;
      const d = arch ? { k: L.doingKey || '正在做', v: L.doing || '', live: '' } : this.lvDoing(L, r, s);
      const rows = [{ k: '负责', v: L.duty || (r.task ? '任务：' + (r.short || r.name) : '') }];
      if (d.v) rows.push({ k: d.k, v: d.v });
      rows.push({ k: '最近一步', v: L.last || r.recent || '没有记录' });
      const live = d.live ? '，' + d.live : '';
      const hint = main ? (on ? '你正在主对话里' : '点一下回到主对话') : on ? '它的对话在中间' : '点一下在中间打开它的对话';
      const def = arch || i >= upFrom; const up = hvUp && hvUp.id === r.id ? !!hvUp.up : def;
      return { id: r.id, name: r.name, word: r.word, dot: r.dot, current: on ? 'true' : null,
        cls: (arch ? 'rail-arch-ln lv-line' : 'row wl-row lv-line') + (on ? ' is-current' : ''),
        pick: () => set(main ? this.lvLeave() : cur === r.id ? { lvHover: null, lvTip: null, lvConfirm: null }
          : Object.assign({ line: r.id, lvHover: null, lvHoverUp: null, lvTip: null, lvConfirm: null, lvMode: 'ask' }, this.lvSwapTo(r.id))),
        hover: (ev) => { const u = this.lvCardUp(ev, def); const y = this.state || {}; const h = y.lvHoverUp || {};
          if (y.lvHover !== r.id || (u !== null && (h.id !== r.id || h.up !== u))) o.set({ lvHover: r.id, lvHoverUp: u === null ? null : { id: r.id, up: u } }); },
        unhover: () => { if ((this.state || {}).lvHover) o.set({ lvHover: null }); },
        card: hv === r.id, cardCls: 'hcard lv-card' + (up ? ' is-up' : ''),
        c: { dot: r.dot, tx: arch ? 'tx-plain' : this.lvTx(r), word: arch ? '已归档' : r.word, live: live, rows: rows, hint: hint } };
    };
    return { rows: lines.map((L, i) => one(L, i, false)), archived: (archived || []).map((L, i) => one(L, i, true)) };
  }
  /* what a line's read-only copy says about now — never the state word twice (DESIGN §10); Main's lineSays() rule, plus a
     line you paused in its own view ("你暂停了它；暂停时…") */
  lvSays(word, why, before) {
    if (word === '已暂停' && why === '你暂停了目标') return '你暂停了目标' + (before && before !== why ? '；暂停时' + before : '') + '。';
    if (word === '已暂停' && why === '你暂停了这条工作线') return '你暂停了它' + (before && before !== why ? '；暂停时' + before : '') + '。';
    if (!why) return '现在' + word + '。';
    const core = { '正式检查中': '正式检查', '停下（失败）': '失败', '停下（受阻）': '受阻', '等你决定': '决定', '工作中': '工作', '已暂停': '暂停', '等回复': '回复', '待命': '待命', '已做完': '做完' }[word];
    if (core && why.indexOf(core) >= 0) return (/^停下/.test(word) ? '现在停下了：' : '现在') + why + '。';
    return '现在' + word + '：' + why + '。';
  }
  /* the read-only copy's answer, frozen when you ask: the board's approved answer for the line (rich.reply, its "（只读分支）"
     prefix dropped — the answer's from-line says it) while nothing has changed since the board's moment; else from the line's
     facts. An ended line's copy answers from its saved record and never reopens it. Final fix 2026-10-07: its 最近一步 is the
     card's (L.last before the read API's recent), and "暂停时…" says what the view says it was doing (before = lvDoing's was) */
  lvAnswer(L, row, rich, changed, before) {
    if (rich && rich.reply && !changed) return String(rich.reply).replace(/^（只读分支）/, '');
    const task = L.task ? L.short || String(L.name).replace(/^执行者 · /, '') : '';
    const recent = L.last || row.recent || '';
    if (row.state === 'archived' || (!!L.task && row.word === '已做完')) {
      return '这条工作线只做“' + task + '”，' + (row.state === 'archived' ? '任务已满足超过一天，工作已结束' : '任务已满足，工作已结束') + '。' + (recent ? '最近一步：' + recent + '。' : '') + '这份副本从它保存的工作记录回答，不会重新打开它。';
    }
    const says = this.lvSays(row.word, row.why, before === undefined ? L.doing : before);
    return (task ? '这条工作线只做“' + task + '”' + (says.charAt(0) === '现' ? '，' : '。') : '') + says + (recent ? '最近一步：' + recent + '。' : '') + '回答不写回它的工作记录。';
  }
  /* when the next safe point comes and where a stop lands, read from the step that runs now (Member's safePoint()) */
  lvSafe(p) {
    const cmd = !!p && p.ic === 'cmd';
    return { when: cmd ? '“' + p.obj + '”这条命令结束后' : '当前这一步结束后', stop: p ? '“' + p.verb + ' · ' + p.obj + '”' + (cmd ? '结束后' : '这一步之后') : '当前这一步之后' };
  }
  /* 'MM-DD' → 周日 … (the sample's year, 2026, as timeline.js) */
  lvWeekday(d) { const m = /^(\d\d)-(\d\d)$/.exec(String(d)); return m ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(Date.UTC(2026, +m[1] - 1, +m[2])).getUTCDay()] : ''; }
  /* minutes of 'HH:MM' (or 'MM-DD HH:MM'), for a duration on the board's clock */
  lvMin(t) { const m = /(\d\d):(\d\d)$/.exec(String(t)); return m ? +m[1] * 60 + +m[2] : 0; }
  /* steps in Member's shape: { ic: 'think' | 'file' | 'edit' | 'cmd' | 'int', verb, obj, path, meta, detail, prose, live, fail } */
  lvSteps(arr, isLive, showThink, full) {
    return (arr || []).filter((p) => showThink || p.ic !== 'think').map((p) => {
      const meta = p.live ? (isLive ? '进行中' : '停在安全点') : p.meta || ''; const diff = /^\+\d+ −\d+$/.test(meta);
      return { cls: 'step' + (p.fail ? ' is-fail' : ''), isThink: p.ic === 'think', isFile: p.ic === 'file', isEdit: p.ic === 'edit', isCmd: p.ic === 'cmd', isInt: p.ic === 'int',
        verb: p.verb, obj: p.obj, objCls: 'step-obj' + (p.path ? ' is-path' : ''), hasMeta: !!meta && !diff, meta: meta, isDiff: diff, add: diff ? meta.split(' ')[0] : '', del: diff ? meta.split(' ')[1] : '',
        hasDetail: !!full && !!p.detail, detail: p.detail || '', detCls: 'step-detail' + (p.prose ? ' is-prose' : '') };
    });
  }
  /* the hover / focus cards of the controls and of the two ways of sending: what each really does (Member's approved cards;
     问一问's answer lands in this conversation instead of the right panel) */
  lvTipCard(kind, x) {
    const C = {
      pause: ['暂停', '到下一个安全点停下', [['何时', x.sp.when + '生效；在那之前它还在做'], ['保留', '改动和工作记录都保留；任务显示“已暂停，可继续”'], ['之后', '只有你能继续，系统不会自动继续']], '点一下请求暂停'],
      resume: ['继续', '从停下的安全点接着做', [['尝试', '仍是第 ' + x.att + ' 次尝试，接着用这份工作记录'], ['重启', 'Host 重启过时，开一次新的执行，带上接续说明'], ['消息', '排队中的直接干预在第一个安全点送达']], '点一下继续'],
      cancel: ['取消', '停下这次执行', [['何时', x.st === 'paused' ? '已停在安全点，立即生效' : '下一个安全点生效：' + x.sp.when], ['任务', '记为“已取消”，失败类别：已取消'], ['之后', '只有你能重新入队；改动和工作记录保留']], '点一下会先问你确认'],
      requeue: ['重新入队', '开第 ' + (x.att + 1) + ' 次尝试 · 接续', [['带上', '接续说明：上次停在哪里、为什么停，只用已保存的事实组装'], ['记录', '还在这条工作线上，接着用这份工作记录，原来的历史保留'], ['计数', '自动返工计数从 0 开始']], '点一下重新入队'],
      arrive: [x.st === 'cancelling' ? '已请求取消' : '已请求暂停', '等安全点', [['何时', x.sp.when + '生效'], ['现在', '它还在做；你可以接着发消息，会排队']], '点一下，看到达安全点后的样子'],
      ask: ['问一问（只读）', '不打扰它', x.ended
        ? [['做法', '从它保存的工作记录复制一份只读副本来回答，不改文件、不运行命令'], ['何时', '马上开始；它已经不再工作，不会被重新打开'], ['回答', '在这里；不写回它的工作记录']]
        : [['做法', '从它当前的上下文复制一份只读副本来回答，不改文件、不运行命令'], ['何时', '马上开始，和它正在做的事并行'], ['回答', '在这里，挂在它的工作记录下；不写回它']], x.isAsk ? '正在用这种方式' : '点一下改用这种方式'],
      act: x.ended
        ? ['直接干预', '这条工作线已结束', [['为何', '它的任务已满足，不再接新的工作'], ['要改', '在主对话里交给秘书：开新的任务或返工']], '只能问一问（只读）']
        : ['直接干预', '交给它本人，可能改变它接下来的做法', [['何时', x.intWhen], ['状态', '已排队 → 已送达 → 已生效 / 被拒绝'], ['为何', '它能改负责范围里的文件、运行命令；中途插话会打断正在写的东西，所以等安全点']], x.isAsk ? '点一下改用这种方式' : '正在用这种方式']
    };
    const d = C[kind] || C.pause;
    return { name: d[0], tx: 'tx-plain', word: d[1], why: '', rows: d[2].map((r) => ({ k: r[0], v: r[1] })), hint: d[3] };
  }
  /* the centre while a line is open (lv.show), from:
     o.set          the board's setState
     o.line         the board's line object of s.line (the shape lvRail takes; its duty, doing and live are the board's approved texts)
     o.rec          W.wlRecord(s.line, <moment>, <goal ctl>) — data/worklines.js or data/worklines-snap.js; its acts (the
                    direct interventions you sent the line before the moment, final fix 2026-10-07) are drawn as your messages
     o.rich         optional, per line: { reply (the board's approved read-only answer), liveStep ({ ic, verb, obj, path }: the
                    step running now, from the approved live line), steps: { <entry id>: [steps] } (approved steps of a run),
                    page: 'member' | 'chain' (整页查看) }
     o.goal         the head's second line ("目标 1 · 状态机可靠性改造")
     o.goalCtl      null | 'paused' | 'cancelled' (the goal's 暂停 / 取消 hold every line: no line controls then; the view says
                    so in the record's newest row and where to go on, and a line the stop holds reads 原因, final fix)
     o.stamp(st)    the board's clock → { t: 'HH:MM', patch } (the patch moves the clock)
     o.back         a handler (button) — or o.backHref: true for a link to Main.dc.html (boards other than Main); o.backLabel,
                    o.backTip (its words and title; default 回到主对话 / 回到 秘书（主对话）) — a board whose centre is not the main
                    conversation goes back to what it showed (final fix 2026-10-07: Decide's queue, Chain's and Member's page)
     o.togglePanel  the head's panel button (omit on boards without one)
     o.showThink, o.full, o.autoOpen   the board's density (思考 rows, step details, runs open by default)
     o.selTask(id), o.taskSq(id)       the 任务 fact: select the task in the map; its square class ('sq z8 s-…')
     o.hasTask(id), o.noTaskTip        optional: whether the map shown has the task; when it has not, the fact is plain text
                                       (its name and square) with this title — Main's 600-task map leaves out the story tasks
     o.taskHref     true on a page without a task map (Chain, Member): the fact links to the task map on Main.dc.html. With
                    neither selTask nor taskHref the fact is the task's name only (Plan: its maps hold goal 2)
     o.rejects(text, line) → reason    optional: a direct intervention the line refuses (Member's out-of-scope rule); '' = none
     o.rejectReply(text, line)         optional: its answer then
     o.decide(line) → handler | null   optional: where 「需要你决定」 takes a line that waits for your decision (the item of its
                                       task, as the rail's 需要你决定 row opens it); or o.decideHref: true — a link to Main.dc.html
                                       (the boards whose 需要你决定 row is one). The record's 需要你决定 mark and the held
                                       message's 「需要你决定」 become that button or link (final fix 2026-10-07)
     A line whose word is 等你决定 holds a direct intervention (已排队) until you decide in 「需要你决定」 (st 'decide'); a refused
     one sends a busy line back to its own task (a run "接着做 <task>" with the step it was doing, rich.liveStep). The quotes
     waiting in the draft (state.quotes, lvSwapTo) show over the composer and go with what you send. */
  lvView(s, o) {
    const id = s.line || null; const L0 = id ? o.line || null : null;
    if (!L0) return { show: false, hide: true };
    const noop = () => {};
    const cur = () => this.lvCur();
    const set = (p) => o.set(Object.assign({ lvLog: cur().lvLog || {} }, p));
    const put = (map, k, v) => Object.assign({}, map || {}, { [k]: v });
    const R = o.rec || { entries: [], segs: [], attempt: null, sessions: 1, first: '', last: '' };
    /* the board's line object, with the read API's task, short name and last step where the board left them out */
    const L = Object.assign({}, L0, { task: L0.task || R.task || null, short: L0.short || R.short || '', recent: L0.recent || R.recent || '' });
    const rich = o.rich || {}; const showThink = o.showThink !== false; const full = !!o.full;
    const ctlOf = (st) => (st.lvCtl || {})[id] || null; const logOf = (st) => (st.lvLog || {})[id] || [];
    const C = ctlOf(s); const log = logOf(s);
    /* changed: the board's approved texts of the line (its answer) no longer hold — you acted in its view, or the goal stopped */
    const row = this.lvRowOf(L, s); const changed = row !== L || !!C || log.some((e) => e.k === 'run') || !!o.goalCtl;
    const isExec = !!L.task; const archived = row.state === 'archived'; const ended = archived || (isExec && row.word === '已做完');
    /* 正在做 / 原因 under the facts and what its copy says it was doing when it stopped (lvDoing) */
    const dg = this.lvDoing(L, row, s);
    const recLive = R.entries.filter((e) => e.kind === 'run' && e.live).pop() || null;
    const logLive = log.filter((e) => e.k === 'run' && e.live).pop() || null;
    const cut = C && C.cut ? C.cut : null;
    const liveRun = logLive || (recLive && !cut ? recLive : null);
    const att = (C && C.att) || R.attempt || 1;
    /* "第 2 次尝试 · 接续" only where the attempt went on from a stop (its first execution says 接续, or you requeued it here) */
    const relay = (n) => (!!C && C.att === n && n > (R.attempt || 1)) || R.entries.some((e) => (e.kind === 'run' || e.kind === 'check') && e.att === n && /^接续/.test(e.gap || ''));
    const attWords = (n) => '第 ' + n + ' 次尝试' + (n > 1 && relay(n) ? ' · 接续' : '');
    const span = (a, b) => (String(a).slice(0, 5) === String(b).slice(0, 5) ? a + '–' + String(b).slice(6) : a + '–' + b);
    const step = logLive ? (logLive.steps || []).slice(-1)[0] || null : rich.liveStep || null;
    const sp = this.lvSafe(step);
    const cst = C ? C.st : null;
    const liveCheck = R.entries.some((e) => e.kind === 'check' && e.live);
    /* 'decide': the line waits for your decision (等你决定, e.g. 自动返工已达上限 3/3) — not idle: a direct intervention stays
       queued until you decide in 「需要你决定」, as one waits for a formal check, instead of starting a run round the decision */
    const st = o.goalCtl ? 'goal' : cst === 'paused' || cst === 'cancelled' || cst === 'pausing' || cst === 'cancelling' ? cst : liveRun ? 'working' : liveCheck ? 'checking' : row.word === '等你决定' ? 'decide' : 'idle';
    const canDeliver = !ended && (st === 'working' || st === 'idle');
    const T = (x) => o.stamp(x);
    const tip = s.lvTip || null;
    const tipTo = (k) => () => { if ((this.state || {}).lvTip !== k) o.set({ lvTip: k }); };
    const untip = () => { if ((this.state || {}).lvTip) o.set({ lvTip: null }); };
    /* the run going on now ends at t (a stop, or the safe point an intervention waited for): the last run you started, else
       the record's own run (kept as a cut in lvCtl) */
    const endLive = (x, t, res, why) => {
      const lg = logOf(x); const c0 = ctlOf(x) || { att: att };
      const has = lg.some((e) => e.k === 'run' && e.live);
      const lg2 = lg.map((e) => (e.k === 'run' && e.live ? Object.assign({}, e, { live: false, endT: t, res: res, why: why || '' }) : e));
      return { log: lg2, ctl: !has && recLive && !c0.cut ? Object.assign({}, c0, { cut: { t: t, res: res, why: why || '' } }) : c0 };
    };
    const ctlPut = (x, c) => put(x.lvCtl, id, c); const logPut = (x, lg) => put(x.lvLog, id, lg);

    /* ---- controls (Member's state machine: a stop waits for the next safe point; 取消 asks first) */
    const pause = () => { const x = cur(); const tt = T(x);
      set(Object.assign({}, tt.patch, { lvTip: null, lvCtl: ctlPut(x, Object.assign({ att: att }, ctlOf(x) || {}, { st: 'pausing' })),
        lvLog: logPut(x, logOf(x).concat([{ k: 'sys', ic: 'pause', text: '已请求暂停：等安全点，' + sp.when + '生效', t: tt.t }])) })); };
    const arrive = () => { const x = cur(); const c0 = ctlOf(x); if (!c0 || (c0.st !== 'pausing' && c0.st !== 'cancelling')) return; const tt = T(x);
      const p = c0.st === 'pausing'; const E = endLive(x, tt.t, p ? 'paused' : 'cancelled');
      set(Object.assign({}, tt.patch, { lvTip: null, lvCtl: ctlPut(x, Object.assign({}, E.ctl, { st: p ? 'paused' : 'cancelled', stopT: tt.t, stopWhere: sp.stop })),
        lvLog: logPut(x, E.log.concat([{ k: 'sys', ic: p ? 'pause' : 'stop', text: p ? '已暂停，可继续：停在' + sp.stop + '，改动已保存' : '你取消了这次执行：任务记为已取消，可重新入队；改动和工作记录保留', t: tt.t }])) })); };
    const resume = () => { const x = cur(); const tt = T(x); const n = (x.lvSeq || 0) + 1;
      set(Object.assign({}, tt.patch, { lvSeq: n, lvTip: null, lvCtl: ctlPut(x, Object.assign({}, ctlOf(x) || {}, { st: 'working' })),
        lvLog: logPut(x, logOf(x).concat([{ k: 'sys', ic: 'play', text: '已继续：从停下的安全点接着做，仍是第 ' + att + ' 次尝试', t: tt.t },
          { k: 'run', id: 'lvr' + n, label: '从安全点接着做', t: tt.t, live: true, att: att, steps: [{ ic: 'think', verb: '思考', obj: '从停下的地方接着做', live: true }] }])) })); };
    const requeue = () => { const x = cur(); const c0 = ctlOf(x) || {}; const tt = T(x); const k = att + 1; const n = (x.lvSeq || 0) + 1;
      set(Object.assign({}, tt.patch, { lvSeq: n, lvTip: null, lvCtl: ctlPut(x, Object.assign({}, c0, { st: 'working', att: k })),
        lvLog: logPut(x, logOf(x).concat([{ k: 'sys', ic: 'requeue', text: '已重新入队：' + (L.short || L.name) + '，第 ' + k + ' 次尝试；自动返工计数从 0 开始', t: tt.t },
          { k: 'sep', text: '第 ' + k + ' 次尝试 · 接续' },
          { k: 'brief', rows: [['上次停在', c0.stopWhere || sp.stop], ['停下原因', '你取消了这次执行（' + (c0.stopT || tt.t) + '），失败类别：已取消']] },
          { k: 'run', id: 'lvr' + n, label: '第 ' + k + ' 次尝试', t: tt.t, live: true, att: k, steps: [{ ic: 'file', verb: '读取', obj: '接续说明', live: true }] }])) })); };
    const askCancel = () => set({ lvConfirm: id, lvTip: null });
    const keep = () => set({ lvConfirm: null });
    const confirmCancel = () => { const x = cur(); const c0 = ctlOf(x) || { att: att }; const tt = T(x);
      if (st === 'paused') {
        set(Object.assign({}, tt.patch, { lvConfirm: null, lvCtl: ctlPut(x, Object.assign({}, c0, { st: 'cancelled', stopT: tt.t, stopWhere: c0.stopWhere || sp.stop })),
          lvLog: logPut(x, logOf(x).concat([{ k: 'sys', ic: 'stop', text: '你取消了这次执行：任务记为已取消，可重新入队；改动和工作记录保留', t: tt.t }])) }));
        return;
      }
      set(Object.assign({}, tt.patch, { lvConfirm: null, lvCtl: ctlPut(x, Object.assign({ att: att }, c0, { st: 'cancelling' })),
        lvLog: logPut(x, logOf(x).concat([{ k: 'sys', ic: 'stop', text: '已请求取消：等安全点，' + sp.when + '生效', t: tt.t }])) })); };

    /* ---- the composer: 问一问（只读） for every line; 直接干预 for a line that is not ended. The quotes waiting in its draft
       (引用到草稿 while this conversation is in the centre) show over it, as in the main conversation, and go with what you send */
    const mode = ended ? 'ask' : s.lvMode === 'act' ? 'act' : 'ask'; const isAsk = mode === 'ask';
    const dkey = id + '|' + mode; const draft = String((s.lvDrafts || {})[dkey] || '');
    const qLines = (q) => (q.a === null || q.a === undefined ? '整个文件' : q.a === q.b ? '第 ' + q.a + ' 行' : '第 ' + q.a + '–' + q.b + ' 行');
    const qs = Array.isArray(s.quotes) ? s.quotes : [];
    const send = () => { const x = cur(); const text = String((x.lvDrafts || {})[dkey] || '').trim(); const qx = Array.isArray(x.quotes) ? x.quotes : [];
      if (!text && !qx.length) return; const tt = T(x); const n = (x.lvSeq || 0) + 1;
      const took = qx.map((q) => ({ path: q.path, a: q.a, b: q.b, snap: !!q.snap, text: q.text || '' }));
      const item = isAsk ? { k: 'ask', id: 'lvq' + n, q: text, quotes: took, t: tt.t, st: 'creating', a: this.lvAnswer(L, row, rich, changed, dg.was) }
        : { k: 'act', id: 'lva' + n, text: text, quotes: took, t: tt.t, stage: 0, out: o.rejects ? o.rejects(text, L) || '' : '' };
      set(Object.assign({}, tt.patch, { lvSeq: n, lvTip: null, lvDrafts: put(x.lvDrafts, dkey, ''), lvLog: logPut(x, logOf(x).concat([item])) }, qx.length ? { quotes: [] } : {})); };
    /* 已排队 → 已送达 → 已生效 / 被拒绝: each click is the next safe point (no timers); on an idle line the delivery starts a run */
    const advance = (mid) => () => {
      const x = cur(); const lg = logOf(x); const m = lg.filter((e) => e.id === mid)[0];
      if (!m || m.stage >= 2 || !canDeliver || (m.stage === 1 && st !== 'working')) return;
      const tt = T(x);
      if (m.stage === 0) {
        const busy = st === 'working'; const E = busy ? endLive(x, tt.t, 'ended', '到安全点，转去处理你的直接干预') : { log: lg, ctl: ctlOf(x) };
        const run = { k: 'run', id: 'lvr' + mid, label: '处理你的直接干预', t: tt.t, live: true, att: att, steps: [{ ic: 'int', verb: '读到', obj: '你的直接干预', live: true }] };
        const lg2 = E.log.map((e) => (e.id === mid ? Object.assign({}, e, { stage: 1, t1: tt.t, where: busy ? sp.stop : '', woke: !busy }) : e)).concat([run]);
        set(Object.assign({}, tt.patch, E.ctl ? { lvCtl: ctlPut(x, E.ctl) } : {}, { lvLog: logPut(x, lg2) }));
        return;
      }
      const reply = m.out ? (o.rejectReply ? o.rejectReply(m.text, L) : '这条我不做：' + m.out + '。需要的话在主对话里交给秘书安排。') : '收到，照这个做；接下来的步骤按你说的调整。';
      /* 被拒绝: the run that handled the message ends — on a line you had set to work with it ("没有照做"), or on a busy line,
         which goes back to its own task ("不改，接着做原来的任务", then a run "接着做 <task>" with the step it was doing) */
      let done = false; let att2 = att;
      const lg2 = lg.slice().reverse().map((e) => {
        if (done || e.k !== 'run' || !e.live) return e;
        done = true; att2 = e.att || 1;
        const steps = (e.steps || []).map((p) => Object.assign({}, p, { live: false }))
          .concat([m.out ? { ic: 'think', verb: '思考', obj: '不在负责范围里，不改：' + m.out } : { ic: 'think', verb: '思考', obj: '按你说的调整接下来的步骤', live: true }]);
        const endIt = !!m.out;
        return Object.assign({}, e, { label: m.out ? e.label : '按你的直接干预调整', steps: steps, live: !endIt, endT: endIt ? tt.t : e.endT, res: endIt ? 'ended' : e.res, why: endIt ? (m.woke ? '没有照做' : '不改，接着做原来的任务') : e.why });
      }).reverse().map((e) => (e.id === mid ? Object.assign({}, e, { stage: 2, t2: tt.t, reply: reply }) : e));
      const goOn = !!m.out && !m.woke && done
        ? [{ k: 'run', id: 'lvk' + mid, label: '接着做 ' + (L.short || String(L.name).replace(/^执行者 · /, '')), t: tt.t, live: true, att: att2,
          steps: [rich.liveStep ? Object.assign({}, rich.liveStep, { live: true }) : { ic: 'think', verb: '思考', obj: '接着做原来的任务', live: true }] }] : [];
      set(Object.assign({}, tt.patch, { lvLog: logPut(x, lg2.concat(goOn)) }));
    };

    /* ---- the record as the conversation's rows */
    const B = { isDay: false, isSep: false, isSys: false, isMark: false, isBrief: false, isRun: false, isRow: false, isAsk: false, isAct: false, quotes: [],
      noGo: true, goBtn: false, goLink: false, go: noop, goTip: '', noteOnly: true, noteGo: false, noteLink: false, noteA: '', noteB: '' };
    /* 「需要你决定」 of a line that waits for your decision (final fix 2026-10-07): the record's newest 需要你决定 mark and the held
       message's words take you there — a button to the item (o.decide), or a link to Main (o.decideHref) — as the rail's
       需要你决定 row does on that board */
    const waitsYou = !ended && row.word === '等你决定';
    const decGo = waitsYou && o.decide ? o.decide(L) || null : null; const decLink = waitsYou && !decGo && !!o.decideHref;
    const decMark = decGo || decLink ? (R.entries.filter((e) => e.kind === 'mark' && e.res === 'decide').pop() || {}).id || null : null;
    const toDec = { go: decGo || noop, goTip: '去「需要你决定」处理这一条' };
    const openOf = (k, d) => { const v = (s.lvOpen || {})[k]; return v === undefined || v === null ? d : !!v; };
    const toggle = (k, open) => () => { const x = cur(); set({ lvOpen: put(x.lvOpen, k, !open) }); };
    /* the quotes a message took along: one reference line each in your bubble; the quoted lines, where the board's quote
       keeps them (Main), fold open under it on a click (Main's .bq) */
    const bq = (list, mid) => (list || []).map((q, j) => {
      const k = 'q:' + id + ':' + mid + ':' + j; const on = !!q.text && openOf(k, false);
      return { path: q.path, lines: qLines(q), snap: !!q.snap, canOpen: !!q.text, cantOpen: !q.text, open: on, chevCls: on ? 'is-open' : '', text: q.text || '',
        tip: on ? '收起引用的内容' : '展开引用的内容' + (q.snap ? '（发送时的草稿快照）' : ''), toggle: toggle(k, on) };
    });
    const ic = (k) => ({ icPause: k === 'pause', icPlay: k === 'play', icStop: k === 'stop', icRequeue: k === 'requeue', icCheck: k === 'check' });
    const sys = (k, text, t) => Object.assign({}, B, ic(k), { isSys: true, text: text, t: t || '' });
    const sep = (text) => Object.assign({}, B, { isSep: true, text: text });
    const hm = (stamp) => String(stamp || '').slice(-5);
    const counts = (e) => '步骤 ' + e.steps + ' · 编辑 ' + e.edits;
    const noteOf = (e, hasRich) => (hasRich ? '' : counts(e) + (rich.page ? '；每一步在整页查看' : '；每一步的记录在原型里没有收录'));
    const goneOn = log.some((e) => e.k === 'run');
    const stopWord = (res, later) => (res === 'paused' ? (later ? ['已暂停', 'tx-waiting'] : ['已暂停，可继续', 'tx-waiting']) : res === 'cancelled' ? ['已取消', 'tx-cancelled'] : ['已结束', 'tx-plain']);
    const pre = (e) => (!isExec && e.taskName ? e.taskName + '：' : '');
    const runItem = (k, o2) => {
      const open = openOf(k, o2.live || !!o.autoOpen);
      return Object.assign({}, B, { isRun: true, open: open, toggle: toggle(k, open), cls: 'run lv-run' + (open ? ' is-open' : '') + (o2.live ? ' is-live' : ''),
        head: o2.head, headCls: 'lv-rt' + (o2.live ? ' live-tx' : ''), hasWord: !!o2.word, word: o2.word || '', wordCls: 'lv-w ' + (o2.tx || 'tx-plain'), time: o2.time,
        steps: this.lvSteps(o2.steps, o2.live, showThink, full), hasNote: !!o2.note, note: o2.note || '' });
    };
    const flat = (e, kind, head, word, tx) => Object.assign({}, B, { isRow: true, icCheck: kind === 'check', icAsk: kind === 'query', icTalk: kind === 'talk',
      head: head, hasWord: !!word, word: word || '', wordCls: 'lv-w ' + (tx || 'tx-plain'), time: e.time });
    const items = [];
    const segWhy = {}; (R.segs || []).forEach((x) => { segWhy[x.seg] = x.why; });
    let day = ''; let seg = (R.segs && R.segs[0] ? R.segs[0].seg : 1); let lastAtt = null;
    const dayRow = (d) => { if (d !== day) { day = d; items.push(Object.assign({}, B, { isDay: true, text: d + ' ' + this.lvWeekday(d) })); } };
    /* a direct intervention you sent the line before the moment (R.acts, final fix 2026-10-07): your message as you would send
       it now — the bubble, its track 已排队 → 已送达 → 被拒绝 / 已生效, the reason and the line's reply — in time order */
    const acts = (R.acts || []).slice();
    const recAct = (a) => {
      const words = ['已排队', '已送达', a.res === 'rejected' ? '被拒绝' : '已生效'];
      return Object.assign({}, B, { isAct: true, text: a.text, t: a.time, track: words.map((w, j) => ({ word: w, sep: j > 0, cls: j === 2 ? 'on' : '' })),
        canAdv: false, noAdv: true, advance: noop, dvCls: 'deliv' + (a.res === 'rejected' ? ' is-rejected' : ''), dvLabel: '消息状态：' + words[2],
        note: a.res === 'rejected' ? '原因：' + a.why : a.why || '已生效：它按你说的调整了接下来的做法', hasReply: !!a.reply, reply: a.reply || '' });
    };
    const actsBefore = (start) => { while (acts.length && (start === null || acts[0].start < start)) { const a = acts.shift(); dayRow(a.day); items.push(recAct(a)); } };
    R.entries.forEach((e, i) => {
      actsBefore(e.start);
      dayRow(e.day);
      if (e.seg !== seg) { seg = e.seg; items.push(sep('工作记录第 ' + seg + ' 段' + (segWhy[seg] ? ' · ' + segWhy[seg] : ''))); }
      const work = e.kind === 'run' || e.kind === 'check';
      if (work && isExec && e.att && lastAtt !== null && e.att !== lastAtt) items.push(sep('第 ' + e.att + ' 次尝试' + (e.gap ? ' · ' + e.gap : '')));
      else if (work && e.gap) items.push(sys('requeue', e.gap, hm(e.start)));
      if (work && e.att) lastAtt = e.att;
      if (e.kind === 'mark') {
        items.push(Object.assign({}, B, { isMark: true, sq: 'sq z8 s-' + (e.res === 'decide' ? 'decide' : e.res === 'defer' ? 'deferred' : 'waiting'), text: pre(e) + e.label, t: e.time },
          decMark && e.id === decMark ? Object.assign({ noGo: false, goBtn: !!decGo, goLink: decLink }, toDec) : {}));
        return;
      }
      if (e.kind === 'run') {
        const isCut = !!cut && !!recLive && e.id === recLive.id; const live = e.live && !isCut;
        const rs = (rich.steps || {})[e.id] || null;
        const steps = rs || (live && rich.liveStep ? [Object.assign({}, rich.liveStep, { live: true })] : []);
        const sw = isCut ? stopWord(cut.res, goneOn) : e.res === 'paused' ? stopWord('paused', R.entries.slice(i + 1).some((w) => w.kind === 'run' || w.kind === 'check')) : [e.word, e.tx];
        const dur = isCut ? Math.max(1, this.lvMin(cut.t) - this.lvMin(e.start)) + ' 分' : e.dur;
        items.push(runItem('r:' + id + ':' + e.id, { live: live,
          head: live ? '正在执行：' + pre(e) + (e.label || attWords(e.att)) : pre(e) + '用时 ' + dur + (e.label ? '：' + e.label : '，' + counts(e)) + (isCut && cut.why ? '，' + cut.why : ''),
          word: live ? '' : sw[0], tx: sw[1], time: live ? e.time : isCut ? hm(e.start) + '–' + cut.t : e.time, steps: steps, note: noteOf(e, !!rs) }));
        return;
      }
      if (e.kind === 'check') {
        items.push(flat(e, 'check', pre(e) + '正式检查第 ' + e.round + ' 轮' + (e.live ? '，已完成 ' + e.checks + ' 项' : e.label ? '：' + e.label : '，' + e.checks + ' 项'), e.word, e.tx));
        return;
      }
      if (e.kind === 'query') { items.push(flat(e, 'query', e.label || '咨询（只读副本）', e.word, e.tx)); return; }
      items.push(flat(e, 'talk', e.label || '对话回合', '', ''));
    });
    actsBefore(null);
    /* what you did in this view, after the record, on the board's clock */
    const laterRun = (i) => log.slice(i + 1).some((e) => e.k === 'run');
    log.forEach((e, i) => {
      if (e.k === 'sys') { items.push(sys(e.ic, e.text, e.t)); return; }
      if (e.k === 'sep') { items.push(sep(e.text)); return; }
      if (e.k === 'brief') { items.push(Object.assign({}, B, { isBrief: true, rows: e.rows.map((r) => ({ k: r[0], v: r[1] })) })); return; }
      if (e.k === 'run') {
        const sw = e.live ? ['', ''] : e.res ? stopWord(e.res, laterRun(i)) : ['', ''];
        items.push(runItem('r:' + id + ':' + e.id, { live: !!e.live, head: e.live ? '正在执行：' + e.label : e.label + '，' + (e.why || '已停在安全点'), word: e.res === 'ended' ? '' : sw[0], tx: sw[1],
          time: e.live ? e.t + ' 起' : e.t + '–' + (e.endT || e.t), steps: e.steps || [], note: '' }));
        return;
      }
      if (e.k === 'ask') {
        const making = e.st === 'creating';
        items.push(Object.assign({}, B, { isAsk: true, q: e.q, quotes: bq(e.quotes, e.id), t: e.t, creating: making, ansCls: 'lv-ans', aCls: 'msg-agent' + (making ? ' lv-after' : ''), from: L.name + '（只读副本）', a: e.a }));
        return;
      }
      /* a direct intervention: 已排队 → 已送达 → 已生效 / 被拒绝 (Member's track and notes) */
      const S = e.stage; const words = ['已排队', '已送达', e.out ? '被拒绝' : '已生效'].slice(0, S + 1);
      const canAdv = S < 2 && canDeliver && (S === 0 || st === 'working');
      let note;
      if (S === 0) {
        note = { working: '等下一个安全点：' + sp.when + '送达', checking: '正式检查进行中：检查结束后，在第一个安全点送达', idle: ended ? '这条工作线已结束，不再送达' : '它现在没有在做的事：送达后开始一次新的执行',
          pausing: '暂停在路上：到安全点后先暂停，你点继续后再送达', paused: '已暂停：你点继续后，在第一个安全点送达',
          cancelling: '取消在路上：重新入队后，在第一个安全点送达', cancelled: '这次执行已取消：重新入队后，在第一个安全点送达',
          decide: '等你决定：你在「需要你决定」里处理后，在第一个安全点送达',
          goal: o.goalCtl === 'paused' ? '目标已暂停：你在目标栏点继续后，在第一个安全点送达' : '目标已取消：目标重新入队后，在第一个安全点送达' }[st];
      } else if (S === 1) note = e.woke ? e.t1 + ' 已交给它，它开始了一次新的执行' : e.t1 + ' 已在安全点交给它' + (e.where ? '（' + e.where + '）' : '') + '，等它处理';
      else note = e.out ? '原因：' + e.out : e.t2 + ' 已生效：它按你说的调整了接下来的做法';
      items.push(Object.assign({}, B, { isAct: true, text: e.text, quotes: bq(e.quotes, e.id), t: e.t, track: words.map((w, j) => ({ word: w, sep: j > 0, cls: j === S ? 'on' : '' })),
        canAdv: canAdv, noAdv: !canAdv, dvCls: 'deliv' + (S === 2 && e.out ? ' is-rejected' : ''), dvLabel: '消息状态：' + words[S] + (canAdv ? '。点一下看下一步' : ''),
        advance: advance(e.id), note: note, hasReply: S === 2, reply: S === 2 ? e.reply || '' : '' },
        S === 0 && st === 'decide' && (decGo || decLink) ? Object.assign({ noteOnly: false, noteGo: !!decGo, noteLink: decLink, noteA: '等你决定：你在「', noteB: '」里处理后，在第一个安全点送达' }, toDec) : {}));
    });

    /* ---- head, facts, controls, composer */
    const intWhen = { working: '下一个安全点交给它：' + sp.when, checking: '正式检查进行中：检查结束后交给它', idle: '它现在没有在做的事：送达后开始一次新的执行', pausing: '暂停在路上：到安全点先暂停，你点继续后再交给它',
      paused: '你点继续后，在第一个安全点交给它', cancelling: '取消在路上：重新入队后交给它', cancelled: '重新入队后交给它', decide: '它在等你决定：你在「需要你决定」里处理后交给它',
      goal: o.goalCtl === 'paused' ? '目标已暂停：你在目标栏点继续后交给它' : '目标已取消：目标重新入队后交给它' }[st];
    const tipIn = { sp: sp, att: att, st: st, ended: ended, isAsk: isAsk, intWhen: intWhen };
    const tc = this.lvTipCard(tip || 'pause', tipIn);
    const lastAsk = log.filter((e) => e.k === 'ask').pop() || null; const lastAct = log.filter((e) => e.k === 'act').pop() || null;
    const foot = isAsk ? (lastAsk && lastAsk.st === 'creating' ? '已开只读副本，回答在上面' : ended ? '从它保存的工作记录复制一份来回答，不会重新打开它' : '复制一份上下文来回答，不改文件，也不打扰它')
      : lastAct && lastAct.stage === 0 && canDeliver ? '已排队：点消息下面的状态看下一步' : lastAct && lastAct.stage === 1 && st === 'working' ? '已送达，等它处理' : intWhen;
    /* the 任务 fact: a button that selects the task in the map shown, a link to Main's task map from a page without one, or
       plain text (its name, and its square where the board gives one) where nothing can show it */
    const canSel = isExec && !!o.selTask && (!o.hasTask || !!o.hasTask(L.task));
    /* the line under the facts: 正在做 / 原因 (lvDoing; its live line without the repeated 正在), or 最近一步 for an ended line (the
       card's, L.last). A line the goal's 暂停 / 取消 holds says why (原因 你暂停了目标 / 目标已取消，记录保留), not the step it stopped
       on; the record's newest row says where to go on (the goal bar is in the main conversation, final fix 2026-10-07): a
       sys-line at the end of the record, so it is in view when the view opens at its newest rows (a banner at the top of a long
       record is scrolled away) */
    const goalHeld = !!o.goalCtl && (row.why === '你暂停了目标' || /目标已取消/.test(row.why || ''));
    const why = ended ? { has: !!(L.last || row.recent), k: '最近一步', v: L.last || row.recent || '' } : goalHeld ? { has: true, k: '原因', v: row.why }
      : dg.live ? { has: true, k: '正在做', v: String(dg.live).replace(/^正在/, '') } : { has: !!dg.v, k: dg.k, v: dg.v };
    const facts = [];
    if (isExec) facts.push({ k: '尝试', v: attWords(att) });
    facts.push({ k: '工作记录', v: (R.sessions > 1 ? R.sessions + ' 段，' : '') + (ended ? span(R.first, R.last) : R.first + ' 起') });
    const goalNote = o.goalCtl === 'paused' ? (goalHeld ? '目标已暂停：这条工作线跟着目标停下。要它接着做，回到主对话在目标栏点继续。' : '目标已暂停：发给它的直接干预会排队，你回到主对话在目标栏点继续后送达。')
      : o.goalCtl === 'cancelled' ? (goalHeld ? '目标已取消：这条工作线跟着目标停下，记录保留。要它接着做，回到主对话在目标栏点重新入队。' : '目标已取消：发给它的直接干预会排队，你回到主对话在目标栏点重新入队后送达。') : '';
    const banner = archived ? '已归档：任务“' + (L.short || L.name) + '”在 ' + R.last + ' 已满足，超过一天。只能问一问（只读）：副本从它保存的工作记录回答，不会重新打开它。'
      : ended ? '工作已结束：任务“' + (L.short || L.name) + '”在 ' + R.last + ' 已满足。只能问一问（只读）；要改它做完的东西，在主对话里交给秘书。' : '';
    if (goalNote && !ended) items.push(sys(o.goalCtl === 'paused' ? 'pause' : 'stop', goalNote, ''));
    const confirmOpen = s.lvConfirm === id && isExec && (st === 'working' || st === 'pausing' || st === 'paused');
    return {
      show: true, hide: false, id: id, name: L.name, dot: row.dot, sub: o.goal || '',
      isBackBtn: !o.backHref, isBackLink: !!o.backHref, back: o.back || (() => set(this.lvLeave())), backLabel: o.backLabel || '回到主对话', backTip: o.backTip || '回到 秘书（主对话）',
      pageMember: rich.page === 'member', pageChain: rich.page === 'chain', hasPanel: !!o.togglePanel, togglePanel: o.togglePanel || noop,
      st: { isLive: (st === 'working' || st === 'checking') && row.state === 'doing', isAdv: st === 'pausing' || st === 'cancelling', isStill: !((st === 'working' || st === 'checking') && row.state === 'doing') && st !== 'pausing' && st !== 'cancelling',
        word: row.word, advText: st === 'cancelling' ? '已请求取消，等安全点' : '已请求暂停，等安全点', arrive: arrive, tip: tipTo('arrive') },
      task: isExec ? { has: true, name: L.short || String(L.name).replace(/^执行者 · /, ''), sq: o.taskSq ? o.taskSq(L.task) : 'sq z8 s-pending', hasSq: !!o.taskSq,
        isBtn: canSel, isLink: !canSel && !!o.taskHref, isPlain: !canSel && !o.taskHref, tip: !canSel && !o.taskHref && o.selTask ? o.noTaskTip || '' : '', go: canSel ? () => o.selTask(L.task) : noop }
        : { has: false, name: '', sq: '', hasSq: false, isBtn: false, isLink: false, isPlain: false, tip: '', go: noop },
      duty: { has: !isExec && !!L.duty, text: L.duty || '' }, facts: facts, why: why,
      acts: { canPause: st === 'working', canResume: st === 'paused', canCancel: isExec && (st === 'working' || st === 'pausing' || st === 'paused'), canRequeue: isExec && st === 'cancelled',
        pause: pause, resume: resume, askCancel: askCancel, requeue: requeue, tipPause: tipTo('pause'), tipResume: tipTo('resume'), tipCancel: tipTo('cancel'), tipRequeue: tipTo('requeue') },
      tipAt: { acts: ['pause', 'resume', 'cancel', 'requeue'].indexOf(tip) >= 0, state: tip === 'arrive', mode: tip === 'ask' || tip === 'act' }, tc: tc, untip: untip,
      banner: { has: !!banner, text: banner }, items: items,
      confirm: { show: confirmOpen, line: (st === 'paused' ? '它已停在安全点，取消立即生效' : '它会在下一个安全点停下（' + sp.when + '），然后取消生效') + '：任务记为“已取消”，之后只有你能重新入队；改动和工作记录保留。', keep: keep, go: confirmCancel },
      cm: { show: !confirmOpen, isAsk: isAsk, isAct: !isAsk, actOff: ended, groupLabel: '怎么发给 ' + L.name,
        askCls: 'mode-btn lv-mb' + (isAsk ? ' is-on' : ''), actCls: 'mode-btn lv-mb' + (!isAsk ? ' is-on' : '') + (ended ? ' is-off' : ''),
        pickAsk: () => set({ lvMode: 'ask' }), pickAct: () => { if (!ended) set({ lvMode: 'act' }); }, tipAsk: tipTo('ask'), tipAct: tipTo('act'),
        label: isAsk ? '问一问 ' + L.name + '（只读副本回答）' : '直接干预 ' + L.name, ph: isAsk ? '问点什么…' : '要它改什么…', draft: draft,
        onDraft: (ev) => { const v = ev && ev.target ? ev.target.value : ''; const y = this.state || {}; o.set({ lvDrafts: put(y.lvDrafts, dkey, v) }); },
        quotes: qs.map((q) => ({ path: q.path, lines: qLines(q), snap: !!q.snap, snip: q.snip || '', hasSnip: !!q.snip,
          remove: () => { const y = this.state || {}; o.set({ quotes: (y.quotes || []).filter((z) => z.id !== q.id) }); } })),
        foot: qs.length ? '已引用到草稿，还没有发送' : foot, sendCls: 'send' + (draft.trim() || qs.length ? '' : ' is-off'), sendOff: !draft.trim() && !qs.length, send: send,
        sendLabel: isAsk ? '开只读副本来问' : '发出直接干预' }
    };
  }
