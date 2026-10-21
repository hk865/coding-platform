// Rebuild the probe files a structure-round run wrote under /tmp/s85-scratch/<run>/ from its decompressed DSH session
// logs (all sessions of the run, coordinator and subagents, replayed in time order). Replays the write and edit tool
// calls that succeeded and `cat >`/`cat >>` heredocs inside bash calls; lists every other bash command that names the
// scratch directory and looks like a write (cp, mv, sed -i, tee, python/node writing, >) for review. Large logs,
// copies of the repository (base/, result*/) and node_modules are skipped. (lead, 2026-10-21)
// usage: node recover.mjs <dir of decompressed *.jsonl> <run, e.g. S1> <out dir>
import { readFileSync, readdirSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const [dir, run, out] = process.argv.slice(2);
const ROOT = `/tmp/s85-scratch/${run}/`;
const SKIP = /^(base[^/]*|result[^/]*|logs?|.*node_modules)\//;
const calls = [];
const results = new Map();
for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
  for (const l of readFileSync(join(dir, f), 'utf8').split('\n')) {
    if (!l) continue;
    const e = JSON.parse(l);
    if (e.type === 'tool/call') calls.push({ time: e.time, seq: e.seq, session: f, name: e.data.name, callId: e.data.callId, args: e.data.arguments });
    if (e.type === 'tool/result') {
      const m = e.data.message;
      const text = (m.content || []).map((c) => c.text || '').join('');
      results.set(m.toolCallId, { text, isError: m.isError === true || e.data.meta?.isError === true });
    }
  }
}
calls.sort((a, b) => a.time - b.time || a.seq - b.seq);
const files = new Map();
const how = new Map();
const review = [];
const note = (p, k) => { const h = how.get(p) || {}; h[k] = (h[k] || 0) + 1; how.set(p, h); };
const rel = (p) => (p.startsWith(ROOT) ? p.slice(ROOT.length) : null);
for (const c of calls) {
  let a;
  try { a = JSON.parse(c.args); } catch { continue; }
  const r = results.get(c.callId);
  const failed = r === undefined || r.isError || /^(error|Error)|EACCES|not found in file|No such file/.test(r.text.slice(0, 200));
  if ((c.name === 'write' || c.name === 'edit') && a.file_path) {
    const p = rel(a.file_path);
    if (p === null || SKIP.test(p)) continue;
    if (failed) { note(p, c.name + '-failed'); continue; }
    if (c.name === 'write') { files.set(p, a.content); note(p, 'write'); continue; }
    const cur = files.get(p);
    if (cur === undefined) { note(p, 'edit-unknown-base'); review.push({ session: c.session, time: c.time, kind: 'edit on a file not rebuilt', path: p }); continue; }
    const i = cur.indexOf(a.old_string);
    if (i < 0) { note(p, 'edit-no-match'); review.push({ session: c.session, time: c.time, kind: 'edit old_string not found', path: p }); continue; }
    files.set(p, cur.slice(0, i) + a.new_string + cur.slice(i + a.old_string.length));
    note(p, 'edit');
    continue;
  }
  if (c.name === 'bash' && typeof a.command === 'string' && a.command.includes('s85-scratch')) {
    const cmd = a.command;
    const re = /cat\s+(>>?)\s*("?)([^\s"<>]+)\2\s*<<-?\s*(['"]?)(\w+)\4[^\n]*\n([\s\S]*?)\n\5(?=\n|$)/g;
    let m; let any = false;
    while ((m = re.exec(cmd)) !== null) {
      const target = m[3].replace(/^\$S\//, ROOT).replace(/^\$\{S\}\//, ROOT);
      const p = rel(target);
      if (p === null || SKIP.test(p)) continue;
      any = true;
      if (failed) { note(p, 'heredoc-maybe-failed'); }
      const body = m[6] + '\n';
      files.set(p, m[1] === '>>' ? (files.get(p) || '') + body : body);
      note(p, m[1] === '>>' ? 'heredoc-append' : 'heredoc');
    }
    // A `cd <scratch dir> && python3 - <<'EOF' … EOF` that only reads and rewrites files through pathlib
    // (`Path(…).read_text()` / `.write_text(…)`): rerun it on the rebuilt files, in order.
    const py = /^\s*cd\s+("?)([^\s"&;]+)\1\s*&&\s*python3\s+-\s*<<-?\s*(['"]?)(\w+)\3[^\n]*\n([\s\S]*?)\n\4(?=\n|$)/.exec(cmd);
    // Also a `cd <scratch dir> && sed -i <expr> <file>`.
    const sed = /^\s*cd\s+("?)([^\s"&;]+)\1\s*&&\s*sed\s+-i\s+("(?:[^"\\]|\\.)*"|'[^']*')\s+([^\s&;|]+)/.exec(cmd);
    const isPy = py && /write_text\(|\.write\(/.test(py[5]) && !/subprocess|os\.system|shutil|glob/.test(py[5]);
    if (!failed && (isPy || sed)) {
      const cwd = rel((isPy ? py[2] : sed[2]).replace(/\/$/, '') + '/');
      if (cwd !== null && !SKIP.test(cwd)) {
        const tmp = mkdtempSync(join(tmpdir(), 's85py-'));
        for (const [p, t] of files) { mkdirSync(dirname(join(tmp, p)), { recursive: true }); writeFileSync(join(tmp, p), t); }
        mkdirSync(join(tmp, cwd), { recursive: true });
        const r = isPy
          ? spawnSync('python3', ['-I', '-'], { cwd: join(tmp, cwd), input: py[5] + '\n', encoding: 'utf8' })
          : spawnSync('bash', ['-c', `sed -i ${sed[3]} ${sed[4]}`], { cwd: join(tmp, cwd), encoding: 'utf8' });
        // The run's own call succeeded; a replay that fails (it also touched a copy that is not rebuilt) keeps the
        // changes it made to the rebuilt files before it failed, and is listed.
        if (r.status !== 0) review.push({ session: c.session, time: c.time, kind: 'patch failed part-way on the rebuilt files', command: cmd.slice(0, 1500), stderr: r.stderr.slice(-600) });
        const tag = (isPy ? 'python-patch' : 'sed-patch') + (r.status !== 0 ? '-partial' : '');
        for (const [p, t] of [...files]) { const now = readFileSync(join(tmp, p), 'utf8'); if (now !== t) { files.set(p, now); note(p, tag); } }
        rmSync(tmp, { recursive: true, force: true });
        continue;
      }
    }
    const rest = cmd.replace(re, '');
    if (/\b(cp|mv|tee|sed\s+-i|python3?|node|perl)\b|[^2]>\s*\S/.test(rest) && /s85-scratch|\$S\b/.test(rest) && !/^\s*(cat|ls|head|tail|wc|grep|diff|cmp|sha256sum)\b/.test(rest)) {
      review.push({ session: c.session, time: c.time, kind: any ? 'bash with heredoc and more' : 'bash that may write', command: cmd.length > 1500 ? cmd.slice(0, 1500) + ' …' : cmd });
    }
  }
}
mkdirSync(out, { recursive: true });
const manifest = [];
for (const [p, text] of [...files].sort()) {
  mkdirSync(dirname(join(out, 'files', p)), { recursive: true });
  writeFileSync(join(out, 'files', p), text);
  manifest.push({ path: p, bytes: Buffer.byteLength(text), how: how.get(p) });
}
for (const [p, h] of how) if (!files.has(p)) manifest.push({ path: p, bytes: null, how: h });
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
writeFileSync(join(out, 'review.json'), JSON.stringify(review, null, 1));
console.log(`${run}: ${calls.length} tool calls; rebuilt ${files.size} files; ${review.length} commands to review`);
for (const m of manifest) console.log(`  ${m.path} ${m.bytes} ${JSON.stringify(m.how)}`);
