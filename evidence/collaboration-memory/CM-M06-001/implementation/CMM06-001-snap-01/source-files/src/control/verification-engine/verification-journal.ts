import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeAtomicFile } from '../../storage/atomic-file.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import type { VerificationScope as Scope, VerificationCandidate, VerificationAttempt } from '../../contracts/verification-import.js';
import type { CommandCheckRecord, VerificationRunView } from '../../contracts/verification-service.js';
import { digest, vScope } from './verification-input.js';
import type { VerificationRoundRecord } from '../../contracts/verification-round.js';
import type { ReviewJournalRecord } from './reviewer-record.js';
/** File names and serialized identities are the existing durable import/check protocol. */
export class VerificationJournal {
  readonly checks: CommandCheckRecord[] = [];
  readonly rounds: VerificationRoundRecord[] = [];
  readonly reviews: ReviewJournalRecord[] = [];
  readonly candidates: VerificationCandidate[] = [];
  readonly attempts: VerificationAttempt[] = [];
  readonly pending = new Map<string, VerificationCandidate>();
  private readonly checkFiles = new WeakMap<CommandCheckRecord, string>();
  constructor(readonly directory: string) { }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const name of (await readdir(this.directory)).sort()) {
      if (/^review-[a-f0-9]{64}\.json$/.test(name)) {
        const stored = JSON.parse(await readFile(join(this.directory, name), 'utf8')) as ReviewJournalRecord;
        // 早于本字段的记录没有 plan 绑定：保留其事实，但把缺失显式表达为 null，
        // 让读投影标为 unknown 而不是猜一个 revision。
        this.reviews.push({ ...stored, planRef: stored.planRef ?? null });
      }
      if (/^round-[a-f0-9]{64}\.json$/.test(name)) {
        const round = JSON.parse(await readFile(join(this.directory, name), 'utf8')) as VerificationRoundRecord;
        if (round.status === 'running') {
          round.status = 'interrupted';
          round.gaps.push({ code: 'restart', message: '轮次中断；显式恢复只对账已存报告并继续未开始项，未知副作用不会重跑。' });
          await this.save('round', name.slice(6, -5), round);
        }
        this.rounds.push(round);
      }
      if (/^check-[a-f0-9]{64}\.json$/.test(name)) {
        const stored = JSON.parse(await readFile(join(this.directory, name), 'utf8')) as CommandCheckRecord;
        const check: CommandCheckRecord = {
          ...stored,
          command: stored.command ?? null,
          kind: stored.kind ?? null,
          timeoutMs: stored.timeoutMs ?? null,
          startedAt: stored.startedAt ?? null,
          finishedAt: stored.finishedAt ?? null
        };
        this.rememberCheck(check, name.slice(6, -5));
        if (check.status === 'running' || (check.leaseId && check.lifecycle !== 'lease_released' && !(check.lifecycle === 'acquisition_rejected' && check.acquisitionRejection))) {
          if (check.status === 'running')
            check.status = 'interrupted';
          check.finishedAt = check.finishedAt ?? new Date().toISOString();
          check.recovery = {
            reason: check.progress?.phase === 'report_stored' ? '报告正文已保存；验证结果登记未完成，需对账，未重新执行命令。' : '检查中断；工具副作用和租约状态需对账，未重新执行命令。',
            commandReplayAllowed: false
          };
          if (check.result)
            check.recovery.reason = '验证结果已保存；租约释放未确认，需对账，未重新执行命令。';
          check.lifecycle = 'reconciliation_required';
          await this.save('check', name.slice(6, -5), check);
        }
        this.checks.push(check);
      }
      if (/^pending-[a-f0-9]{64}\.json$/.test(name)) {
        const candidate = JSON.parse(await readFile(join(this.directory, name), 'utf8')) as VerificationCandidate;
        this.pending.set(candidate.candidateId, candidate);
      }
      if (/^candidate-[a-f0-9]{64}\.json$/.test(name))
        this.candidates.push(JSON.parse(await readFile(join(this.directory, name), 'utf8')) as VerificationCandidate);
      if (/^verification-[a-f0-9]{64}\.json$/.test(name))
        this.attempts.push(JSON.parse(await readFile(join(this.directory, name), 'utf8')) as VerificationAttempt);
    }
  }
  forRun(scope: Scope): VerificationRunView {
    const match = (v: Scope) => canonicalJson(vScope(v)) === canonicalJson(vScope(scope));
    return {
      reviews: this.reviews.filter(r => match(r.scope)).map(r => structuredClone({ requestId: r.requestId, reviewId: r.reviewId,
        scope: r.scope, roundRequestId: r.roundRequestId, workRef: r.workRef, phase: r.phase })),
      rounds: this.rounds.filter(round => canonicalJson(vScope(round.scope)) === canonicalJson(vScope(scope))).map(round => structuredClone(round)),
      commandChecks: this.checks.filter(match).map(c => structuredClone(c)),
      candidates: this.candidates.filter(match).map(({ patch: _patch, benchmark: b, fingerprint: _fp, ...c }) => ({ ...c, benchmark: { instanceId: b.instanceId, datasetRevision: b.datasetRevision } })),
      verifications: this.attempts.filter(match).sort((a, b) => a.sequence - b.sequence).map(({ reportBody: _body, fingerprint: _fp, ...a }) => structuredClone(a))
    };
  }
  async save(kind: string, id: string, value: unknown) {
    await writeAtomicFile(join(this.directory, kind + '-' + id + '.json'), JSON.stringify(value));
  }
  rememberCheck(check: CommandCheckRecord, id: string) { this.checkFiles.set(check, id); }
  /** Loaded historical records keep their actual file identity when saved again. */
  checkId(check: CommandCheckRecord) {
    return this.checkFiles.get(check) ?? digest(canonicalJson([vScope(check), check.requestId]));
  }
}
