/** 本机 Web UI 的单页资源；不依赖外部 CDN，避免把工作区信息发送到第三方。 */
export const WEB_PAGE = String.raw`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>Coding Agent · 本机工作台</title>
    <style>
      :root {
        --ink:#17211f; --muted:#687572; --paper:#f7f5ee; --line:#d9ded8;
        --brand:#176c5b; --brand-strong:#0c4c40; --accent:#e58d52;
        --shadow:0 24px 70px rgba(35,56,51,.12);
      }
      * { box-sizing:border-box; }
      body {
        margin:0; min-height:100vh; color:var(--ink);
        background:radial-gradient(circle at 12% 8%,rgba(229,141,82,.13),transparent 28rem),
          radial-gradient(circle at 88% 92%,rgba(23,108,91,.12),transparent 32rem),var(--paper);
        font-family:Inter,"Noto Sans SC","Microsoft YaHei",system-ui,sans-serif;
      }
      button,input,select,textarea { font:inherit; }
      .shell {
        width:min(1500px,calc(100% - 32px)); min-height:calc(100vh - 32px); margin:16px auto;
        display:grid; grid-template-columns:330px minmax(0,1fr); overflow:hidden;
        background:rgba(255,255,255,.78); border:1px solid rgba(255,255,255,.9);
        border-radius:24px; box-shadow:var(--shadow); backdrop-filter:blur(20px);
      }
      .rail { padding:26px 23px; overflow:auto; border-right:1px solid var(--line); background:rgba(244,242,234,.72); }
      .brand { display:flex; align-items:center; gap:12px; margin-bottom:25px; }
      .brand-mark { width:38px; height:38px; display:grid; place-items:center; border-radius:13px; color:#fff; background:var(--brand); font:700 18px/1 ui-monospace,monospace; }
      .brand strong,.brand span { display:block; } .brand strong { font-size:15px; } .brand span { color:var(--muted); font-size:12px; }
      .section-title { margin:21px 0 9px; color:var(--muted); font-size:10px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; }
      label { display:block; margin:10px 0; color:var(--muted); font-size:12px; }
      input,select,textarea { width:100%; margin-top:6px; padding:9px 11px; color:var(--ink); border:1px solid var(--line); border-radius:10px; outline:none; background:rgba(255,255,255,.88); }
      input:focus,select:focus,textarea:focus { border-color:var(--brand); box-shadow:0 0 0 3px rgba(23,108,91,.11); }
      .inline-fields { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
      .secret-row { position:relative; } .secret-row input { padding-right:58px; }
      .secret-row button { position:absolute; right:7px; bottom:5px; padding:5px 7px; border:0; color:var(--brand); background:transparent; cursor:pointer; }
      .resume-button,.cancel-button { padding:8px 11px; border:1px solid var(--line); border-radius:10px; color:var(--muted); background:rgba(255,255,255,.72); cursor:pointer; font-size:12px; }
      .resume-button { width:100%; } .cancel-button { color:#8c3933; } .cancel-button[hidden] { display:none; }
      .safety-note { margin-top:21px; padding:13px 14px; border:1px solid rgba(23,108,91,.18); border-radius:13px; color:#4d625d; background:rgba(23,108,91,.06); font-size:12px; line-height:1.65; }
      .workspace { min-width:0; display:grid; grid-template-rows:auto auto 1fr auto; }
      .topbar { display:flex; align-items:center; justify-content:space-between; gap:20px; padding:21px 30px; border-bottom:1px solid var(--line); }
      .eyebrow { color:var(--muted); font-size:12px; } h1 { margin:3px 0 0; font:650 23px/1.25 Georgia,"Noto Serif SC",serif; }
      .top-actions { display:flex; align-items:center; gap:9px; }
      .status { display:inline-flex; align-items:center; gap:8px; padding:8px 12px; border-radius:99px; color:var(--brand-strong); background:rgba(23,108,91,.08); font-size:12px; font-weight:700; }
      .status::before { content:""; width:7px; height:7px; border-radius:50%; background:#4aa68e; }
      .status[data-state="running"]::before { animation:pulse 1.2s infinite; }
      .status[data-state="approval"] { color:#82491f; background:rgba(229,141,82,.14); } .status[data-state="approval"]::before { background:var(--accent); }
      .status[data-state="error"] { color:#8c3933; background:rgba(164,71,63,.11); } .status[data-state="error"]::before { background:#b95750; }
      @keyframes pulse { 50% { opacity:.35; transform:scale(.72); } }
      .metrics { display:grid; grid-template-columns:repeat(9,minmax(82px,1fr)); gap:1px; border-bottom:1px solid var(--line); background:var(--line); }
      .metric { min-width:0; padding:10px 11px; background:rgba(250,249,244,.93); }
      .metric dt { margin:0 0 5px; color:var(--muted); font-size:9px; font-weight:800; letter-spacing:.07em; white-space:nowrap; }
      .metric dd { margin:0; overflow:hidden; color:var(--ink); font:700 11px/1.2 ui-monospace,"Cascadia Code",monospace; white-space:nowrap; text-overflow:ellipsis; }
      .conversation { overflow:auto; padding:38px clamp(24px,6vw,90px) 30px; }
      .welcome { max-width:760px; margin:8vh auto 0; } .welcome-kicker { color:var(--accent); font-size:12px; font-weight:800; letter-spacing:.15em; }
      .welcome h2 { margin:14px 0; font:600 clamp(32px,5vw,54px)/1.12 Georgia,"Noto Serif SC",serif; } .welcome p { max-width:680px; margin:0; color:var(--muted); line-height:1.8; }
      .suggestions { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-top:30px; }
      .suggestion { min-height:94px; padding:16px; text-align:left; cursor:pointer; border:1px solid var(--line); border-radius:15px; color:var(--ink); background:rgba(255,255,255,.62); }
      .suggestion small { display:block; margin-bottom:8px; color:var(--brand); font-weight:750; }
      .thread { max-width:940px; margin:0 auto; } .message { margin:0 0 25px; } .message-role { margin-bottom:8px; color:var(--muted); font-size:11px; font-weight:800; letter-spacing:.12em; }
      .message-body { padding:18px 20px; border:1px solid var(--line); border-radius:16px; background:rgba(255,255,255,.72); line-height:1.75; overflow-wrap:anywhere; }
      .message.user .message-body { border-color:rgba(23,108,91,.22); background:rgba(23,108,91,.065); white-space:pre-wrap; }
      .message.assistant { margin:14px 0; color:var(--ink); font-size:14px; }
      .message.assistant .message-role { display:flex; align-items:center; gap:8px; margin-left:3px; color:var(--brand-strong); }
      .message.assistant .message-role::before { content:""; width:7px; height:7px; border-radius:50%; background:var(--brand); }
      .message.assistant[data-phase="progress"] .message-body { border-left:3px solid rgba(229,141,82,.7); }
      .message.assistant[data-phase="final"] { margin-top:20px; }
      .message.assistant[data-phase="final"] .message-body { border-color:rgba(23,108,91,.3); background:rgba(255,255,255,.9); box-shadow:0 12px 28px rgba(35,56,51,.07); }
      .message.assistant[data-empty="true"] .message-body { color:#8b5b37; background:rgba(229,141,82,.08); font-style:italic; }
      .message.assistant .message-body[data-streaming="true"]::after { content:""; display:inline-block; width:7px; height:1em; margin-left:4px; vertical-align:-2px; background:var(--brand); animation:pulse 1s infinite; }
      .markdown > :first-child { margin-top:0; } .markdown > :last-child { margin-bottom:0; }
      .markdown p { margin:.55em 0; } .markdown h1,.markdown h2,.markdown h3,.markdown h4,.markdown h5,.markdown h6 { margin:1.15em 0 .45em; line-height:1.3; }
      .markdown h1 { font-size:1.55em; } .markdown h2 { font-size:1.35em; } .markdown h3 { font-size:1.18em; }
      .markdown ul,.markdown ol { margin:.55em 0; padding-left:1.7em; } .markdown li + li { margin-top:.25em; }
      .markdown blockquote { margin:.7em 0; padding:.15em 0 .15em 1em; border-left:3px solid rgba(23,108,91,.3); color:#52635f; }
      .markdown code { padding:.12em .38em; border-radius:5px; color:#7b3f1f; background:rgba(229,141,82,.11); font:12px/1.55 ui-monospace,"Cascadia Code",monospace; }
      .markdown pre { margin:.8em 0; padding:14px 16px; overflow:auto; border:1px solid #d8ddd7; border-radius:10px; background:#f1f2ed; }
      .markdown pre code { padding:0; color:#26332f; background:transparent; white-space:pre; }
      .markdown a { color:var(--brand); text-underline-offset:3px; } .markdown img { display:block; max-width:100%; height:auto; margin:.7em 0; border-radius:10px; }
      .markdown hr { margin:1.2em 0; border:0; border-top:1px solid var(--line); }
      .markdown table { width:100%; margin:.8em 0; border-collapse:collapse; font-size:13px; } .markdown th,.markdown td { padding:7px 9px; border:1px solid var(--line); text-align:left; } .markdown th { background:#f1f2ed; }
      .activity { margin:8px 0 24px; color:var(--muted); font-size:12px; } .trace-heading { margin:22px 0 12px; color:var(--ink); font-size:11px; font-weight:850; letter-spacing:.12em; }
      .activity-note { margin:8px 0 8px 18px; padding-left:18px; border-left:1px solid var(--line); } .activity-note::before { content:""; display:inline-block; width:6px; height:6px; margin:0 9px 1px -22px; border-radius:50%; background:var(--brand); }
      .trace-card,.trace-row { margin:8px 0; overflow:hidden; border:1px solid var(--line); border-radius:12px; background:rgba(255,255,255,.64); }
      .trace-card summary { min-height:44px; display:grid; grid-template-columns:auto minmax(0,auto) minmax(0,1fr) auto; align-items:center; gap:9px; padding:9px 12px; cursor:pointer; list-style:none; }
      .trace-card summary::-webkit-details-marker { display:none; } .trace-card summary::before { content:">"; color:var(--muted); font:700 11px/1 ui-monospace,monospace; transition:transform .15s; } .trace-card[open] summary::before { transform:rotate(90deg); }
      .trace-title { color:var(--ink); font-weight:800; } .trace-summary { min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; } .trace-meta { color:var(--muted); font:11px/1 ui-monospace,monospace; white-space:nowrap; }
      .trace-card[data-status="started"] summary { background:rgba(23,108,91,.045); } .trace-card[data-status="failed"],.trace-row[data-status="failed"] { border-color:rgba(185,87,80,.4); } .trace-card[data-status="cancelled"] { border-color:rgba(190,143,64,.45); } .trace-card[data-status="cancelled"] summary { background:rgba(190,143,64,.06); } .trace-card[data-status="outcome_unknown"] { border-color:rgba(120,82,157,.5); } .trace-card[data-status="outcome_unknown"] summary { background:rgba(120,82,157,.08); }
      .reasoning-card { border-color:rgba(95,82,157,.28); } .reasoning-card summary { background:rgba(95,82,157,.055)!important; } .reasoning-card .trace-title { color:#55498d; }
      .config-card { border-color:rgba(23,108,91,.25); }
      .trace-body { border-top:1px solid var(--line); background:#f5f4ed; } .trace-section { padding:12px 14px; } .trace-section + .trace-section { border-top:1px solid var(--line); }
      .trace-section strong { display:block; margin-bottom:7px; color:var(--muted); font-size:9px; letter-spacing:.12em; }
      .trace-section pre { max-height:380px; margin:0; overflow:auto; color:#26332f; font:11px/1.55 ui-monospace,"Cascadia Code",monospace; white-space:pre-wrap; overflow-wrap:anywhere; }
      .trace-row { display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:10px; padding:10px 12px; }
      .trace-kind { padding:3px 6px; border-radius:6px; color:var(--brand-strong); background:rgba(23,108,91,.08); font:800 9px/1 ui-monospace,monospace; }
      .trace-copy { min-width:0; } .trace-copy .trace-title { margin-right:8px; } .trace-row .trace-summary { display:inline; }
      .composer { padding:17px clamp(24px,6vw,90px) 22px; border-top:1px solid var(--line); background:rgba(250,249,244,.72); }
      .composer-box { max-width:940px; margin:0 auto; padding:10px; display:grid; grid-template-columns:1fr auto; align-items:end; gap:12px; border:1px solid var(--line); border-radius:17px; background:#fff; box-shadow:0 12px 30px rgba(34,48,45,.08); }
      .composer textarea { min-height:58px; max-height:180px; resize:vertical; margin:0; border:0; box-shadow:none; }
      .run-button { min-width:112px; padding:13px 18px; border:0; border-radius:12px; color:#fff; background:var(--brand); cursor:pointer; font-weight:750; } .run-button:disabled { opacity:.55; cursor:not-allowed; }
      .composer-hint { max-width:940px; margin:9px auto 0; color:var(--muted); font-size:11px; text-align:center; }
      .approval-backdrop { position:fixed; inset:0; z-index:10; display:grid; place-items:center; padding:20px; background:rgba(19,31,28,.46); backdrop-filter:blur(7px); } .approval-backdrop[hidden] { display:none; }
      .approval-card { width:min(680px,100%); padding:24px; border-radius:20px; background:#fffef9; box-shadow:0 28px 80px rgba(0,0,0,.23); } .approval-kicker { color:var(--accent); font-size:11px; font-weight:850; letter-spacing:.14em; }
      .approval-card h2 { margin:8px 0 6px; font:600 27px/1.25 Georgia,"Noto Serif SC",serif; } .approval-card p { margin:0 0 16px; color:var(--muted); line-height:1.6; }
      .approval-details { max-height:300px; overflow:auto; padding:14px; border:1px solid var(--line); border-radius:12px; background:#f5f4ed; } .approval-details dt { margin-top:10px; color:var(--muted); font-size:11px; font-weight:800; } .approval-details dt:first-child { margin-top:0; } .approval-details dd { margin:4px 0 0; font:12px/1.55 ui-monospace,monospace; white-space:pre-wrap; overflow-wrap:anywhere; }
      .approval-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:10px; margin-top:18px; } .approval-actions button { padding:10px 15px; border-radius:10px; cursor:pointer; font-weight:750; }
      .deny { border:1px solid var(--line); color:#8c3933; background:#fff; } .allow-run { border:1px solid var(--brand); color:var(--brand); background:#fff; } .allow { border:0; color:#fff; background:var(--brand); }
      @media (max-width:900px) { .shell { width:100%; min-height:100vh; margin:0; grid-template-columns:1fr; border-radius:0; } .rail { border-right:0; border-bottom:1px solid var(--line); } .settings { display:grid; grid-template-columns:1fr 1fr; gap:0 14px; } .metrics { grid-template-columns:repeat(3,1fr); } .suggestions { grid-template-columns:1fr; } }
      @media (max-width:560px) { .settings { display:block; } .topbar { padding:18px 20px; } .metrics { grid-template-columns:repeat(2,1fr); } .composer-box { grid-template-columns:1fr; } .run-button { width:100%; } .trace-card summary { grid-template-columns:auto minmax(0,1fr) auto; } .trace-card .trace-summary { display:none; } }
    </style>
  </head>
  <body>
    <main class="shell">
      <aside class="rail">
        <div class="brand"><div class="brand-mark">CA</div><div><strong>Coding Agent</strong><span>可观察的本机工作台</span></div></div>
        <div class="settings">
          <div class="section-title">工作空间</div>
          <label>项目目录<input id="workspace" value="${process.cwd()}" /></label>
          <label>Session<input id="session" placeholder="留空则自动生成" /></label>
          <label>一致性模式<select id="consistency-mode"><option value="session">Session 路径（最快）</option><option value="workspace">Git 工作区</option><option value="strict">严格对账</option></select></label>
          <button class="resume-button" id="resume" type="button">恢复这个 Session</button>
          <div class="section-title">模型连接</div>
          <label>Provider<select id="provider"><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option></select></label>
          <label>模型<input id="model" value="deepseek-v4-flash" /></label>
          <label class="secret-row">API Key<input id="api-key" type="password" autocomplete="off" placeholder="只保留在本机进程" /><button id="reveal" type="button">显示</button></label>
          <div class="section-title">推理与预算</div>
          <div class="inline-fields">
            <label>推理<select id="thinking"><option value="enabled">开启</option><option value="disabled">关闭</option></select></label>
            <label>推理强度<select id="reasoning-effort"><option value="">Provider 默认</option><option value="low">Low</option><option value="high">High</option><option value="max">Max</option></select></label>
          </div>
          <div class="inline-fields">
            <label>模型轮次上限<input id="max-model" type="number" min="1" value="64" /></label>
            <label>工具调用上限<input id="max-tools" type="number" min="1" value="128" /></label>
          </div>
          <label>单轮输出上限<input id="max-output" type="number" min="1" value="8192" /></label>
        </div>
        <div class="safety-note"><strong>三层权限保持启用</strong><br />Policy 先判定允许 / 询问 / 拒绝；询问可选允许一次或本任务内允许同一工具；Sandbox 与工作区边界始终复核，敏感路径和越界操作不能被授权绕过。</div>
      </aside>
      <section class="workspace">
        <header class="topbar"><div><div class="eyebrow">当前任务</div><h1>看得见每一轮模型与工具交互</h1></div><div class="top-actions"><button class="cancel-button" id="cancel" type="button" hidden>取消任务</button><div class="status" id="status">准备就绪</div></div></header>
        <section class="metrics" aria-label="运行指标">
          <dl class="metric"><dt>Turn</dt><dd id="metric-turns">—</dd></dl>
          <dl class="metric"><dt>模型轮次 / 上限</dt><dd id="metric-model">—</dd></dl>
          <dl class="metric"><dt>工具调用 / 上限</dt><dd id="metric-tools">—</dd></dl>
          <dl class="metric"><dt>输入 Token</dt><dd id="metric-input">—</dd></dl>
          <dl class="metric"><dt>输出 Token</dt><dd id="metric-output">—</dd></dl>
          <dl class="metric"><dt>缓存 Token</dt><dd id="metric-cache">—</dd></dl>
          <dl class="metric"><dt>TPS（整轮）</dt><dd id="metric-tps">—</dd></dl>
          <dl class="metric"><dt>总耗时</dt><dd id="metric-elapsed">—</dd></dl>
          <dl class="metric"><dt>上下文 / 1M</dt><dd id="metric-context">—</dd></dl>
        </section>
        <div class="conversation">
          <div class="welcome"><div class="welcome-kicker">OBSERVABLE CODING</div><h2>模型想了什么、调用了什么，都在这里。</h2><p>每个模型轮次会展示 Provider 返回的 reasoning_content；每次工具调用会展示名称、输入、输出、耗时和审批依据。系统提示词、启用的工具与 Skill 也会随任务公开。</p><div class="suggestions">
            <button class="suggestion" data-prompt="先阅读 README 和相关源码，说明这个项目的入口和核心数据流，不要修改文件。"><small>理解项目</small>阅读入口并解释数据流</button>
            <button class="suggestion" data-prompt="检查当前项目中最明显的一个小问题，先说明原因，再做最小修改并运行相关测试。"><small>修复问题</small>最小修改并验证</button>
            <button class="suggestion" data-prompt="运行与当前项目相符的测试，汇总失败项和建议，不要在未经批准时修改文件。"><small>运行验证</small>执行测试并汇总结果</button>
          </div></div>
        </div>
        <footer class="composer"><div class="composer-box"><textarea id="prompt" placeholder="例如：阅读失败测试，找到原因并修复……"></textarea><button class="run-button" id="run" type="button">开始任务</button></div><div class="composer-hint">推理内容来自 Provider 的公开字段 · 风险操作分层审批 · 服务仅监听本机</div></footer>
      </section>
    </main>
    <div class="approval-backdrop" id="approval" hidden>
      <section class="approval-card" role="dialog" aria-modal="true" aria-labelledby="approval-title"><div class="approval-kicker">POLICY · APPROVAL · SANDBOX</div><h2 id="approval-title">确认风险操作</h2><p>“允许一次”只批准当前操作；“本任务允许”会自动批准本任务后续同名工具，但每次仍经过硬拒绝规则、工作区与 Sandbox 校验。</p><dl class="approval-details" id="approval-details"></dl><div class="approval-actions"><button class="deny" id="deny" type="button">拒绝</button><button class="allow-run" id="allow-run" type="button">本任务允许此工具</button><button class="allow" id="allow" type="button">允许一次</button></div></section>
    </div>
    <script>
      const byId = (id) => document.getElementById(id);
      const prompt = byId('prompt');
      const conversation = document.querySelector('.conversation');
      const runButton = byId('run');
      const resumeButton = byId('resume');
      const cancelButton = byId('cancel');
      const statusBadge = byId('status');
      const approvalDialog = byId('approval');
      let activeRunId = null;
      let currentApprovalId = null;
      let eventSource = null;
      let activity = null;
      let toolCards = new Map();
      let modelRows = new Map();
      let reasoningCards = new Map();
      let assistantMessages = new Map();

      document.querySelectorAll('.suggestion').forEach((button) => button.addEventListener('click', () => { prompt.value = button.dataset.prompt; prompt.focus(); }));
      byId('reveal').addEventListener('click', (event) => { const input = byId('api-key'); input.type = input.type === 'password' ? 'text' : 'password'; event.currentTarget.textContent = input.type === 'password' ? '显示' : '隐藏'; });
      byId('thinking').addEventListener('change', () => { byId('reasoning-effort').disabled = byId('thinking').value === 'disabled'; if (byId('thinking').value === 'disabled') byId('reasoning-effort').value = ''; });
      byId('provider').addEventListener('change', () => { const deepseek = byId('provider').value === 'deepseek'; byId('thinking').disabled = !deepseek; byId('reasoning-effort').disabled = !deepseek || byId('thinking').value === 'disabled'; });

      function setStatus(label, state) { statusBadge.textContent = label; statusBadge.dataset.state = state || ''; }
      function appendActivity(label) { const item = document.createElement('div'); item.className = 'activity-note'; item.textContent = label; activity.appendChild(item); conversation.scrollTop = conversation.scrollHeight; }
      function formatTokens(value) { if (!Number.isFinite(value)) return '—'; if (value < 1000) return String(value); if (value < 1000000) return (Math.round(value / 100) / 10) + 'K'; return (Math.round(value / 100000) / 10) + 'M'; }
      function formatDuration(value) { if (!Number.isFinite(value)) return '—'; if (value < 60000) return (Math.round(value / 100) / 10) + 's'; const seconds = Math.round(value / 1000); return Math.floor(seconds / 60) + 'm' + (seconds % 60) + 's'; }
      function renderMetrics(metrics) {
        if (!metrics) return;
        byId('metric-turns').textContent = String(metrics.turns);
        byId('metric-model').textContent = String(metrics.modelRequests) + ' / ' + String(metrics.maxModelRequests) + (metrics.modelMs ? ' · ' + formatDuration(metrics.modelMs) : '');
        byId('metric-tools').textContent = String(metrics.toolCalls) + ' / ' + String(metrics.maxToolCalls) + (metrics.toolMs ? ' · ' + formatDuration(metrics.toolMs) : '');
        byId('metric-input').textContent = formatTokens(metrics.inputTokens);
        byId('metric-output').textContent = formatTokens(metrics.outputTokens);
        byId('metric-cache').textContent = formatTokens(metrics.cachedInputTokens);
        byId('metric-tps').textContent = metrics.tokensPerSecond === null ? '—' : String(metrics.tokensPerSecond);
        byId('metric-elapsed').textContent = formatDuration(metrics.elapsedMs);
        byId('metric-context').textContent = metrics.contextPercent + '% · ' + formatTokens(metrics.latestInputTokens) + '/' + formatTokens(metrics.contextWindowTokens);
      }
      function traceSection(label, text) { const section = document.createElement('section'); section.className = 'trace-section'; const title = document.createElement('strong'); title.textContent = label; const body = document.createElement('pre'); body.textContent = text; section.append(title, body); return section; }
      function createTraceCard(className) { const card = document.createElement('details'); card.className = 'trace-card ' + (className || ''); card.innerHTML = '<summary><span class="trace-title"></span><span class="trace-summary"></span><span class="trace-meta"></span></summary><div class="trace-body"></div>'; return card; }

      const BACKTICK = String.fromCharCode(96);
      function appendText(parent, value) { if (value) parent.appendChild(document.createTextNode(value)); }
      function safeMarkdownUrl(value) {
        if (value.startsWith('#')) return value;
        try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:' ? url.href : null; }
        catch { return null; }
      }
      function appendDecoratedInline(parent, text) {
        const pattern = /(!?\[[^\]\n]*\]\([^\)\n]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_)/g;
        let cursor = 0; let match;
        while ((match = pattern.exec(text)) !== null) {
          appendText(parent, text.slice(cursor, match.index)); const token = match[0];
          const link = token.match(/^(!?)\[([^\]]*)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)$/);
          if (link) {
            const href = safeMarkdownUrl(link[3]);
            if (!href) appendText(parent, token);
            else if (link[1] === '!') { const image = document.createElement('img'); image.src = href; image.alt = link[2]; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; if (link[4]) image.title = link[4]; parent.appendChild(image); }
            else { const anchor = document.createElement('a'); anchor.href = href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; if (link[4]) anchor.title = link[4]; appendInline(anchor, link[2]); parent.appendChild(anchor); }
          } else {
            const strong = token.startsWith('**') || token.startsWith('__'); const strike = token.startsWith('~~'); const element = document.createElement(strong ? 'strong' : strike ? 'del' : 'em'); const width = strong || strike ? 2 : 1; appendInline(element, token.slice(width, -width)); parent.appendChild(element);
          }
          cursor = pattern.lastIndex;
        }
        appendText(parent, text.slice(cursor));
      }
      function appendInline(parent, text) {
        let cursor = 0;
        while (cursor < text.length) {
          const open = text.indexOf(BACKTICK, cursor);
          if (open < 0) { appendDecoratedInline(parent, text.slice(cursor)); break; }
          const close = text.indexOf(BACKTICK, open + 1);
          if (close < 0) { appendDecoratedInline(parent, text.slice(cursor)); break; }
          appendDecoratedInline(parent, text.slice(cursor, open)); const code = document.createElement('code'); code.textContent = text.slice(open + 1, close); parent.appendChild(code); cursor = close + 1;
        }
      }
      function splitTableRow(line) { const value = line.trim().replace(/^\|/, '').replace(/\|$/, ''); return value.split('|').map((cell) => cell.trim()); }
      function isTableStart(lines, index) { if (index + 1 >= lines.length || !lines[index].includes('|')) return false; const cells = splitTableRow(lines[index + 1]); return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell)); }
      function isBlockStart(lines, index) {
        const trimmed = lines[index].trim();
        return trimmed.startsWith(BACKTICK.repeat(3)) || trimmed.startsWith('~~~') || /^(#{1,6})\s+/.test(trimmed) || /^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed) || /^>\s?/.test(trimmed) || /^[-+*]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed) || isTableStart(lines, index);
      }
      function renderMarkdown(target, source, streaming) {
        const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n'); const fragment = document.createDocumentFragment(); let index = 0;
        while (index < lines.length) {
          const line = lines[index]; const trimmed = line.trim();
          if (!trimmed) { index += 1; continue; }
          const fence = trimmed.startsWith(BACKTICK.repeat(3)) ? BACKTICK.repeat(3) : trimmed.startsWith('~~~') ? '~~~' : null;
          if (fence) {
            const language = trimmed.slice(fence.length).trim(); const body = []; index += 1;
            while (index < lines.length && !lines[index].trim().startsWith(fence)) { body.push(lines[index]); index += 1; }
            if (index < lines.length) index += 1;
            const pre = document.createElement('pre'); const code = document.createElement('code'); code.textContent = body.join('\n'); if (/^[a-z0-9_+.-]{1,32}$/i.test(language)) code.className = 'language-' + language; pre.appendChild(code); fragment.appendChild(pre); continue;
          }
          const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
          if (heading) { const element = document.createElement('h' + heading[1].length); appendInline(element, heading[2]); fragment.appendChild(element); index += 1; continue; }
          if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { fragment.appendChild(document.createElement('hr')); index += 1; continue; }
          if (/^>\s?/.test(trimmed)) { const quoted = []; while (index < lines.length && /^\s*>\s?/.test(lines[index])) { quoted.push(lines[index].replace(/^\s*>\s?/, '')); index += 1; } const quote = document.createElement('blockquote'); renderMarkdown(quote, quoted.join('\n'), streaming); fragment.appendChild(quote); continue; }
          const unordered = trimmed.match(/^[-+*]\s+(.*)$/); const ordered = trimmed.match(/^\d+[.)]\s+(.*)$/);
          if (unordered || ordered) { const list = document.createElement(ordered ? 'ol' : 'ul'); const matcher = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-+*]\s+(.*)$/; while (index < lines.length) { const itemMatch = lines[index].match(matcher); if (!itemMatch) break; const item = document.createElement('li'); appendInline(item, itemMatch[1]); list.appendChild(item); index += 1; } fragment.appendChild(list); continue; }
          if (isTableStart(lines, index)) { const headers = splitTableRow(lines[index]); const table = document.createElement('table'); const thead = document.createElement('thead'); const headerRow = document.createElement('tr'); headers.forEach((value) => { const cell = document.createElement('th'); appendInline(cell, value); headerRow.appendChild(cell); }); thead.appendChild(headerRow); table.appendChild(thead); index += 2; const tbody = document.createElement('tbody'); while (index < lines.length && lines[index].includes('|') && lines[index].trim()) { const row = document.createElement('tr'); splitTableRow(lines[index]).forEach((value) => { const cell = document.createElement('td'); appendInline(cell, value); row.appendChild(cell); }); tbody.appendChild(row); index += 1; } table.appendChild(tbody); fragment.appendChild(table); continue; }
          const paragraphLines = [line]; index += 1; while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) { paragraphLines.push(lines[index]); index += 1; } const paragraph = document.createElement('p'); appendInline(paragraph, paragraphLines.join('\n')); fragment.appendChild(paragraph);
        }
        target.replaceChildren(fragment); target.dataset.streaming = streaming ? 'true' : 'false';
      }

      function ensureAssistantMessage(requestId) {
        const key = requestId || 'unbound'; let entry = assistantMessages.get(key);
        if (!entry) { const card = document.createElement('article'); card.className = 'message assistant'; card.dataset.phase = 'streaming'; card.innerHTML = '<div class="message-role">CODING AGENT · 流式回复</div><div class="message-body markdown" data-streaming="true"></div>'; activity.appendChild(card); entry = { card, role:card.querySelector('.message-role'), body:card.querySelector('.message-body'), source:'', complete:false, scheduled:false }; assistantMessages.set(key, entry); }
        return entry;
      }
      function scheduleAssistantRender(entry) {
        if (entry.scheduled) return; entry.scheduled = true;
        const render = () => { entry.scheduled = false; if (entry.source) renderMarkdown(entry.body, entry.source, !entry.complete); conversation.scrollTop = conversation.scrollHeight; };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(render); else render();
      }
      function appendAssistantDelta(requestId, delta, chunkIndex) { const entry = ensureAssistantMessage(requestId); entry.source += delta; if (Number.isFinite(chunkIndex)) entry.role.textContent = 'CODING AGENT · 流式回复 · CHUNK ' + String(chunkIndex); scheduleAssistantRender(entry); }
      function completeAssistant(data) {
        const entry = ensureAssistantMessage(data.requestId); if (typeof data.assistantText === 'string') entry.source = data.assistantText; entry.complete = true; const phase = data.assistantPhase === 'progress' ? 'progress' : 'final'; entry.card.dataset.phase = phase; entry.card.querySelector('.message-role').textContent = phase === 'progress' ? 'CODING AGENT · 中间进度' : 'CODING AGENT · 最终回答';
        if (!entry.source) { entry.card.dataset.empty = 'true'; entry.body.dataset.streaming = 'false'; entry.body.textContent = phase === 'progress' ? '本轮模型直接请求了工具，但 Provider 未返回用户可见的进度文本。' : '本轮模型未返回用户可见的最终正文。'; }
        else { delete entry.card.dataset.empty; scheduleAssistantRender(entry); }
      }
      function appendFailureMessage(message) { const entry = ensureAssistantMessage('run-failure'); entry.source = '**任务未完成**\n\n' + message; entry.complete = true; entry.card.dataset.phase = 'final'; entry.card.dataset.status = 'failed'; entry.card.querySelector('.message-role').textContent = 'CODING AGENT · 失败说明'; scheduleAssistantRender(entry); }

      function renderConfiguration(data) {
        const card = createTraceCard('config-card');
        card.querySelector('.trace-title').textContent = '运行配置 · ' + data.systemPromptVersion;
        card.querySelector('.trace-summary').textContent = data.provider + ' / ' + data.model + ' · tools ' + data.tools.length + ' · skills ' + data.skills.length;
        card.querySelector('.trace-meta').textContent = 'CONTEXT ' + formatTokens(data.contextWindowTokens);
        const body = card.querySelector('.trace-body');
        body.appendChild(traceSection('SYSTEM PROMPT', data.systemPrompt));
        const toolText = data.tools.map((tool) => tool.name + '\n' + tool.description + '\n' + JSON.stringify(tool.inputSchema, null, 2)).join('\n\n---\n\n');
        const skillText = data.skills.map((skill) => skill.id + ' · ' + skill.kind + ' · ' + skill.title + '\n' + skill.content).join('\n\n---\n\n');
        body.appendChild(traceSection('TOOL PROMPTS & JSON SCHEMA', toolText));
        body.appendChild(traceSection('SKILL CONTENT', skillText + '\n\nresource: ' + data.skillResourceRoot));
        body.appendChild(traceSection('MODEL & BUDGET', JSON.stringify({ provider:data.provider, model:data.model, thinking:data.thinking, reasoningEffort:data.reasoningEffort, contextWindowTokens:data.contextWindowTokens, maxOutputTokens:data.maxOutputTokens, maxModelRequests:data.maxModelRequests, maxToolCalls:data.maxToolCalls }, null, 2)));
        body.appendChild(traceSection('WORKSPACE CONSISTENCY', JSON.stringify(data.workspaceConsistency, null, 2)));
        activity.appendChild(card);
      }
      function ensureReasoningCard(requestId, title) {
        const key = requestId || 'unbound';
        let card = reasoningCards.get(key);
        if (!card) {
          card = createTraceCard('reasoning-card'); card.open = true; card.dataset.status = 'started';
          card.querySelector('.trace-title').textContent = '推理过程 · ' + (title || '模型轮次');
          card.querySelector('.trace-summary').textContent = '正在接收 Provider reasoning_content';
          card.querySelector('.trace-meta').textContent = 'STREAMING';
          card.querySelector('.trace-body').appendChild(traceSection('REASONING_CONTENT', ''));
          activity.appendChild(card); reasoningCards.set(key, card);
        }
        return card;
      }
      function appendReasoning(requestId, delta, chunkIndex) { const card = ensureReasoningCard(requestId, '当前轮次'); const pre = card.querySelector('pre'); pre.textContent += delta; if (Number.isFinite(chunkIndex)) card.querySelector('.trace-meta').textContent = 'STREAM · CHUNK ' + String(chunkIndex); conversation.scrollTop = conversation.scrollHeight; }
      function completeReasoning(data) {
        const card = reasoningCards.get(data.requestId) || (data.reasoningText ? ensureReasoningCard(data.requestId, data.title) : null);
        if (!card) return;
        const pre = card.querySelector('pre'); if (!pre.textContent && data.reasoningText) pre.textContent = data.reasoningText;
        card.dataset.status = 'completed'; card.open = Boolean(pre.textContent);
        card.querySelector('.trace-summary').textContent = pre.textContent ? '已保存并将在 ToolResult 后回传给模型' : '本轮未返回 reasoning_content';
        card.querySelector('.trace-meta').textContent = data.durationMs === null ? '完成' : formatDuration(data.durationMs);
      }
      function renderToolEvent(data) {
        let card = toolCards.get(data.callId);
        if (!card) { card = createTraceCard(''); activity.appendChild(card); toolCards.set(data.callId, card); }
        card.dataset.status = data.status; card.querySelector('.trace-title').textContent = data.toolName || data.title; card.querySelector('.trace-summary').textContent = data.summary;
        const toolStatusText =
          data.status === 'started' ? '运行中'
          : data.status === 'completed' ? '完成'
          : data.status === 'failed' ? '失败'
          : data.status === 'cancelled' ? '已取消'
          : data.status === 'outcome_unknown' ? '结果未知'
          : '完成';
        card.querySelector('.trace-meta').textContent = toolStatusText + (data.durationMs === null ? '' : ' · ' + formatDuration(data.durationMs));
        const body = card.querySelector('.trace-body'); body.innerHTML = ''; if (data.input) body.appendChild(traceSection('INPUT', data.input)); if (data.output) body.appendChild(traceSection('OUTPUT', data.output));
        if (data.status === 'failed' || data.status === 'outcome_unknown') card.open = true; conversation.scrollTop = conversation.scrollHeight;
      }
      function renderRuntimeRow(data) {
        const key = data.kind === 'model' && data.requestId ? data.requestId : data.sourceType + ':' + data.eventSequence;
        let row = data.kind === 'model' ? modelRows.get(key) : null;
        if (!row) { row = document.createElement('div'); row.className = 'trace-row'; row.innerHTML = '<span class="trace-kind"></span><div class="trace-copy"><span class="trace-title"></span><span class="trace-summary"></span></div><span class="trace-meta"></span>'; activity.appendChild(row); if (data.kind === 'model' && data.requestId) modelRows.set(key, row); }
        row.dataset.status = data.status; row.querySelector('.trace-kind').textContent = data.kind === 'model' ? 'MODEL' : 'RUN'; row.querySelector('.trace-title').textContent = data.title; row.querySelector('.trace-summary').textContent = data.summary; row.querySelector('.trace-meta').textContent = data.durationMs === null ? formatDuration(data.elapsedMs) : formatDuration(data.durationMs);
      }
      function renderRuntimeEvent(data) {
        renderMetrics(data.metrics);
        if (data.sourceType === 'model.usage_recorded') return;
        if (data.sourceType === 'model.request_started') { renderRuntimeRow(data); ensureReasoningCard(data.requestId, data.title); conversation.scrollTop = conversation.scrollHeight; return; }
        if (data.sourceType === 'assistant.message_completed') { completeReasoning(data); completeAssistant(data); renderRuntimeRow(data); conversation.scrollTop = conversation.scrollHeight; return; }
        if (data.kind === 'tool') renderToolEvent(data); else renderRuntimeRow(data);
        conversation.scrollTop = conversation.scrollHeight;
      }
      function prepareThread(userText, mode) {
        conversation.innerHTML = ''; const thread = document.createElement('div'); thread.className = 'thread';
        if (mode === 'run') { const user = document.createElement('article'); user.className = 'message user'; user.innerHTML = '<div class="message-role">你</div><div class="message-body"></div>'; user.querySelector('.message-body').textContent = userText; thread.appendChild(user); }
        activity = document.createElement('div'); activity.className = 'activity'; const heading = document.createElement('div'); heading.className = 'trace-heading'; heading.textContent = '运行时间线 · 模型 / 推理 / 回复 / 工具 / 权限'; activity.appendChild(heading);
        toolCards = new Map(); modelRows = new Map(); reasoningCards = new Map(); assistantMessages = new Map(); thread.appendChild(activity); conversation.appendChild(thread);
      }
      async function api(path, body) { const response = await fetch(path, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body || {}) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.message || '请求失败'); return payload; }
      function finish(label, state) { setStatus(label, state); runButton.disabled = false; resumeButton.disabled = false; cancelButton.hidden = true; approvalDialog.hidden = true; currentApprovalId = null; if (eventSource) eventSource.close(); eventSource = null; activeRunId = null; }
      function listen(runId) {
        eventSource = new EventSource('/api/runs/' + encodeURIComponent(runId) + '/events');
        eventSource.addEventListener('run_started', () => appendActivity('任务已创建，正在装配安全运行环境'));
        eventSource.addEventListener('configuration', (event) => renderConfiguration(JSON.parse(event.data)));
        eventSource.addEventListener('reasoning_delta', (event) => { const data = JSON.parse(event.data); appendReasoning(data.requestId, data.delta, data.chunkIndex); });
        eventSource.addEventListener('text_delta', (event) => { const data = JSON.parse(event.data); appendAssistantDelta(data.requestId, data.delta, data.chunkIndex); });
        eventSource.addEventListener('runtime_event', (event) => renderRuntimeEvent(JSON.parse(event.data)));
        eventSource.addEventListener('approval_requested', (event) => {
          const data = JSON.parse(event.data); currentApprovalId = data.approvalId; setStatus('等待审批', 'approval'); const details = byId('approval-details'); details.innerHTML = '';
          const rows = [['工具',data.tool],['效果类型',data.effectClass],['Policy 原因',data.policyReasonCode],['Policy 版本',data.policyVersion],['路径',Array.isArray(data.paths) && data.paths.length ? data.paths.join('\n') : '—'],['工作目录',data.cwd || '—'],['命令 / 参数',data.commandPreview || data.argumentsPreview || '—'],['工作区 Revision',data.workspaceRevision],['审批失效时间',data.expiresAt]];
          for (const row of rows) { const term = document.createElement('dt'); const value = document.createElement('dd'); term.textContent = row[0]; value.textContent = row[1] || '—'; details.append(term,value); }
          approvalDialog.hidden = false; byId('allow').focus(); appendActivity('Policy 要求审批：' + data.tool + ' · ' + data.policyReasonCode);
        });
        eventSource.addEventListener('approval_resolved', (event) => {
          const data = JSON.parse(event.data); if (!data.automatic) { approvalDialog.hidden = true; currentApprovalId = null; } setStatus('运行中','running');
          const label = data.decision === 'deny' ? '已拒绝操作，结果将返回 Agent' : data.decision === 'allow_for_run' ? (data.automatic ? '任务级授权已自动允许 ' + data.tool : '已允许本任务内使用 ' + data.tool) : '已允许一次，继续执行'; appendActivity(label);
        });
        eventSource.addEventListener('run_finished', (event) => { const data = JSON.parse(event.data); appendActivity('任务结束：' + data.status); finish(data.status === 'completed' ? '已完成' : data.status, data.status === 'completed' ? '' : 'error'); });
        eventSource.addEventListener('run_failed', (event) => { const data = JSON.parse(event.data); appendFailureMessage(data.message); appendActivity('任务未完成：' + data.message); finish(data.status === 'cancelled' ? '已取消' : '失败','error'); });
      }
      async function start(mode) {
        const workspaceRoot = byId('workspace').value.trim(); const sessionId = byId('session').value.trim(); const provider = byId('provider').value; const model = byId('model').value.trim(); const apiKey = byId('api-key').value.trim(); const input = prompt.value.trim();
        const maxModelRequests = Number(byId('max-model').value); const maxToolCalls = Number(byId('max-tools').value); const maxOutputTokens = Number(byId('max-output').value); const thinking = byId('thinking').value; const effort = byId('reasoning-effort').value; const consistencyMode = byId('consistency-mode').value;
        if (!workspaceRoot || !model || !apiKey || !Number.isInteger(maxModelRequests) || !Number.isInteger(maxToolCalls) || !Number.isInteger(maxOutputTokens) || (mode === 'run' && !input) || (mode === 'resume' && !sessionId)) { setStatus('请补全必填项','error'); return; }
        prepareThread(input,mode); runButton.disabled = true; resumeButton.disabled = true; cancelButton.hidden = false; setStatus(mode === 'resume' ? '恢复中' : '启动中','running');
        try { const result = await api('/api/runs', { mode, workspaceRoot, sessionId:sessionId || undefined, provider, model, apiKey, input, thinking, reasoningEffort:effort || undefined, maxModelRequests, maxToolCalls, maxOutputTokens, consistencyMode }); activeRunId = result.runId; byId('session').value = result.sessionId; byId('api-key').value = ''; setStatus('运行中','running'); listen(result.runId); }
        catch (error) { appendFailureMessage(error.message); finish('启动失败','error'); }
      }
      async function answer(decision) { if (!activeRunId || !currentApprovalId) return; const buttons = [byId('allow'),byId('allow-run'),byId('deny')]; buttons.forEach((button) => { button.disabled = true; }); try { await api('/api/runs/' + encodeURIComponent(activeRunId) + '/approvals/' + encodeURIComponent(currentApprovalId), { decision }); } catch (error) { setStatus(error.message,'error'); } finally { buttons.forEach((button) => { button.disabled = false; }); } }
      runButton.addEventListener('click', () => start('run')); resumeButton.addEventListener('click', () => start('resume'));
      cancelButton.addEventListener('click', async () => { if (!activeRunId) return; cancelButton.disabled = true; try { await api('/api/runs/' + encodeURIComponent(activeRunId) + '/cancel'); } finally { cancelButton.disabled = false; } });
      byId('allow').addEventListener('click', () => answer('allow_once')); byId('allow-run').addEventListener('click', () => answer('allow_for_run')); byId('deny').addEventListener('click', () => answer('deny'));
    </script>
  </body>
</html>`;
