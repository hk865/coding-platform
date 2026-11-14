// The evidence writers (spec §5.6, `slice-9-SPEC.md:749-762`): result.json (the eight scenario rows only),
// README.md (the three-word summary, never "partial"), checks/{http.jsonl, model-calls.jsonl, commands.txt, notes.md}.
// Nothing here ever receives the platform token or a provider key.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The seven uncovered reason codes (`slice-9-SPEC.md:747`); nothing else goes into `uncovered[]`. */
export const UNCOVERED_CODES = ['prereq-slice-missing', 'entry-missing', 'capability-unsupported',
  'provider-rejected', 'env-unavailable', 'ui-not-built', 'not-run'];

/** A stop that leaves the scenario's remaining rows `uncovered (<code>)`. */
export class Abort extends Error {
  constructor(code, reason) {
    super(reason);
    if (!UNCOVERED_CODES.includes(code)) throw new Error(`not an uncovered reason code: ${code}`);
    this.code = code;
  }
}

/**
 * The wall table's category (draft :238-240; lead ruling 11-14 on the second review #15): only a named basis files a
 * row. 协调 when the code itself is single-writer / version / lease (`CoreError`, `results.ts:16`); 安全 when the reason
 * names an irreversible, external or secret basis; 产品规则 when the reason names a rule; otherwise 无理由. Nothing
 * defaults to 产品规则 or 安全; the reason text is always there verbatim for the lead to re-file.
 */
const COORDINATION = new Set(['busy', 'revision_conflict', 'idempotency_conflict', 'source_stale', 'capacity']);
const SAFETY_BASIS = /secret|credential|token|key|sandbox|irreversib|external|不可逆|外部|秘密|密钥|凭据|沙箱/i;
const RULE_BASIS = /\brules?\b|requires?|must|not allowed|may not|cannot|规则|必须|只能|不允许|不能|需要/i;
export function categoryOf(code, reason) {
  if (COORDINATION.has(code)) return '协调';
  if (typeof reason !== 'string' || reason.trim() === '' || reason.trim() === code) return '无理由';
  if (SAFETY_BASIS.test(reason)) return '安全';
  return RULE_BASIS.test(reason) ? '产品规则' : '无理由';
}

export class Report {
  constructor(dir) {
    this.dir = dir;
    this.checks = join(dir, 'checks');
    mkdirSync(this.checks, { recursive: true });
    for (const file of ['http.jsonl', 'model-calls.jsonl', 'commands.txt']) writeFileSync(join(this.checks, file), '');
    this.current = null;
    this.walls = [];
    this.toolWallKeys = new Set();
    this.rows = [];
    this.rowNotes = {};
    this.cells = {};
    this.attached = [];
    this.b06 = null;
    this.compaction = null;
    this.hosts = [];
    this.notes = [];
    this.budget = null;
    this.tokenNotes = [];
  }

  http(entry) {
    appendFileSync(join(this.checks, 'http.jsonl'), `${JSON.stringify({ scenario: this.current?.id ?? null, ...entry })}\n`);
    if (this.current !== null) {
      this.current.httpSequence.push({ route: entry.route, commandId: entry.commandId ?? null, status: entry.http,
        code: entry.code ?? entry.status ?? null, refs: entry.refs ?? null, ...(entry.repeat ? { repeat: entry.repeat } : {}) });
    }
  }

  /** One refusal, one row, recorded when it happens (never folded); an expected one is flagged `expected`. */
  wall(entry) {
    this.walls.push({ at: entry.at, scenario: this.current?.id ?? '-', step: `${entry.route} ${entry.commandId ?? ''}`.trim(),
      code: entry.code, reason: entry.reason ?? '', expected: entry.expected, category: categoryOf(entry.code, entry.reason), pkg: '待定' });
  }

  /** A tool refusal found in a public history (second review #15): one row per call identity, at its own time. */
  toolWall(unit, refusal) {
    if (this.toolWallKeys.has(refusal.key)) return;
    this.toolWallKeys.add(refusal.key);
    this.walls.push({ at: refusal.at, scenario: unit, step: `tool ${refusal.tool ?? '?'} (call ${refusal.callId})`,
      code: refusal.code ?? '-', reason: refusal.reason ?? '', expected: false, category: categoryOf(refusal.code, refusal.reason), pkg: '待定' });
  }

  modelCall(entry) {
    appendFileSync(join(this.checks, 'model-calls.jsonl'), `${JSON.stringify(entry)}\n`);
  }

  command(line) {
    appendFileSync(join(this.checks, 'commands.txt'), `${new Date().toISOString()} ${line}\n`);
  }

  note(text) {
    this.notes.push(`${new Date().toISOString()} ${this.current?.id ?? '-'}: ${text}`);
  }

  /** Writes result.json, README.md and checks/notes.md from what the run recorded. */
  writeAll(meta) {
    const rows = this.rows.map(row => ({ ...row, reportPath: 'README.md', resultJson: 'result.json' }));
    writeFileSync(join(this.dir, 'result.json'), `${JSON.stringify({ schemaVersion: 1, runId: meta.runId, scenarios: rows }, null, 2)}\n`);
    const count = verdict => rows.filter(row => row.verdict === verdict).length;
    const table = rows.map(row => `| ${row.scenario} | ${row.verdict} | ${row.checklistRows.join(', ')} | ${
      row.uncovered.map(item => `${item.item} (${item.code})`).join('; ') || '-'} |`);
    const cell = (name, value) => value === undefined ? [`### ${name}`, '', '没跑：`uncovered (not-run)`。', '']
      : [`### ${name}：${value.verdict}`, '', ...value.lines.map(line => `- ${line}`), ''];
    const readme = [
      `# 第 9 片真实验收（G6）${meta.date}`,
      '',
      `- 树：\`${meta.tree}\`（${meta.dirty ? '有未提交改动' : '干净'}）；运行号 \`${meta.runId}\`；${meta.startedAt} → ${meta.endedAt}。`,
      `- 授权原文（逐场景同样记在 result.json 的 \`authorization\`）：${meta.authorization}`,
      `- 令牌：${this.tokenNotes.length === 0 ? '没有起 Host' : this.tokenNotes.join('；')}。`,
      '',
      `## 八个场景：total=8 / pass=${count('pass')} / fail=${count('fail')} / uncovered=${count('uncovered')}`,
      '',
      '| 场景 | 判定 | C 行 | 未覆盖 |',
      '|---|---|---|---|',
      ...table,
      '',
      '每行的逐条判据、证据和原因见 `checks/notes.md`；没跑到的判据记 `uncovered`，不因场景其余判据通过而通过。',
      '',
      '## A/B 两格（不进 result.json）',
      '',
      ...cell('A1（1M → 131072）', this.cells.A1),
      ...cell('B1（128k → 64000）', this.cells.B1),
      '## 压缩场景（单列，不算第 9 个场景）',
      '',
      ...cell('压缩', this.compaction ?? undefined),
      '## 附加格（八个场景之后的附加 Goal）',
      '',
      ...(this.attached.length === 0 ? ['没跑：C-216、C-221、C-222 记 `uncovered (not-run)`。', '']
        : this.attached.flatMap(item => cell(item.id, item))),
      '## B06',
      '',
      ...cell('B06 关闭格', this.b06 ?? undefined),
      '## 撞墙表',
      '',
      `共 ${this.walls.length} 行（其中场景预期的拒绝 ${this.walls.filter(wall => wall.expected).length} 行），每次拒绝一行，原文见 \`checks/notes.md\`。`,
      '',
      '## 预算',
      '',
      ...(this.budget === null ? ['没有用量记录。'] : this.budget.lines.map(line => `- ${line}`)),
      '',
      '## 延迟探针（只记录）',
      '',
      ...(this.hosts.length === 0 ? ['没有 Host。'] : this.hosts.map(host =>
        `- ${host.name}#${host.start}：${host.lag === null ? '没有探针读数' : `p50 ${host.lag.p50Ms} ms，p95 ${host.lag.p95Ms} ms，max ${host.lag.maxMs} ms（${host.lag.samples} 个样本）`}；关闭方式 ${host.closed ?? '未关'}`)),
      '',
      '## 证据',
      '',
      '- `result.json`：八行，字段照 `slice-9-SPEC.md:729-745`。',
      '- `checks/http.jsonl`：每次 HTTP（只有成功的同一读口连续同样答复合成一行带 `repeat`；每次拒绝单独一行）；预算计量的成功读不逐条记，只计数。',
      '- `checks/model-calls.jsonl`：从公开读口取的每次 Query 请求用量和每个结束的 Work Run 合计，带归属的场景/格（`unit`，按项目归属，不按读到的时间）。',
      '- `checks/commands.txt`：驱动起的命令（Host 起停、git、provider 探测）和退出码。',
      '- `checks/notes.md`：逐条判据、撞墙表、A/B、压缩、B06、预算、延迟探针。',
      '',
    ].join('\n');
    writeFileSync(join(this.dir, 'README.md'), readme);

    const detail = rows.flatMap(row => [
      `### ${row.scenario}：${row.verdict}`,
      '',
      `- C 行：${row.checklistRows.join(', ')}；自治档 \`${row.autonomy ?? '-'}\`；provider \`${row.provider ?? '-'}\` / \`${row.model ?? '-'}\`。`,
      `- 用量：输入 ${row.inputTokens ?? '-'}（含缓存命中），输出 ${row.outputTokens ?? '-'}，缓存命中 ${row.cachedInputTokens ?? '-'}，Query 请求 ${row.modelRequests ?? '-'}。`,
      '',
      '| 判据 | C 行 | 结果 | 说明 |',
      '|---|---|---|---|',
      ...row.checks.map(check => `| ${check.id} | ${check.rows.join(', ')} | ${check.status}${check.code ? ` (${check.code})` : ''} | ${(check.note ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`),
      '',
      ...(this.rowNotes[row.scenario] ?? []).map(line => `- ${line}`), '',
    ]);
    const cellText = text => String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const walls = [...this.walls].sort((left, right) => String(left.at).localeCompare(String(right.at))).map(wall => `| ${wall.at} | ${wall.scenario} | ${cellText(wall.step)} | ${cellText(`${wall.code}: ${wall.reason}`)} | ${
      wall.category} | ${wall.expected ? 'expected' : '-'} | ${wall.pkg} |`);
    const notes = [
      `# G6 notes ${meta.date}（运行号 ${meta.runId}）`,
      '',
      '## 逐场景判据',
      '',
      ...detail,
      '## 撞墙表',
      '',
      '| 时间 | 场景 | 哪一步 | 看到的拒绝原文和理由 | 类别 | 预期 | 建议包 |',
      '|---|---|---|---|---|---|---|',
      ...walls,
      '',
      '每次拒绝一行：HTTP 拒绝（预期的也记，标 expected）和公开原历史里的每次工具拒绝（按调用身份去重），原文不截断。类别只认依据：busy/revision_conflict/idempotency_conflict/source_stale/capacity 记协调；理由点到不可逆、外部或秘密的记安全；理由点到规则的记产品规则；其余记“无理由”。',
      '',
      '## A/B、压缩、附加格、B06',
      '',
      ...['A1', 'B1'].flatMap(name => cell(name, this.cells[name])),
      ...cell('压缩', this.compaction ?? undefined),
      ...this.attached.flatMap(item => cell(item.id, item)),
      ...cell('B06', this.b06 ?? undefined),
      '## 预算',
      '',
      ...(this.budget === null ? ['没有用量记录。'] : this.budget.lines.map(line => `- ${line}`)),
      '',
      '## 延迟探针',
      '',
      ...this.hosts.map(host => `- ${host.name}#${host.start}：${JSON.stringify(host.lag)}；关闭 ${host.closed ?? '未关'}`),
      '',
      '## 其它记录',
      '',
      ...this.notes.map(line => `- ${line}`),
      '',
    ].join('\n');
    writeFileSync(join(this.checks, 'notes.md'), notes);
  }
}
