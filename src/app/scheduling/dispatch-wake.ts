import type { DispatchDriveResult, DispatchDriveTrigger } from '../../contracts/ports.js';

/** Host wake lifecycle. Durable outbox facts decide what may run; timers only
 * arrange another scan. Concurrent requests share the injected dispatch owner. */
export class DispatchWake {
  private readonly active = new Set<Promise<void>>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private timerAt: number | undefined;
  private closing = false;

  constructor(private readonly deps: {
    drive: (trigger: DispatchDriveTrigger) => Promise<DispatchDriveResult>;
    afterDrive: () => Promise<unknown>;
    now: () => string;
    onError: (error: unknown) => void;
  }) {}

  request(reason: string): Promise<void> {
    if (this.closing) return Promise.resolve();
    const work = this.advance(reason);
    this.active.add(work);
    void work.catch(this.deps.onError);
    void work.finally(() => this.active.delete(work)).catch(() => {});
    return work;
  }

  private async advance(reason: string): Promise<void> {
    try {
      for (let page = 0; page < 4 && !this.closing; page++) {
        const result = await this.deps.drive({ reason, maxIntents: 64 });
        if (result.backlog?.nextAvailableAt) this.schedule(result.backlog.nextAvailableAt);
        const c = result.coordination;
        if (!result.started && !(c && (c.deliveries || c.admissions || c.waitAdmissionsEnsured || c.claimed))) break;
      }
    } finally { await this.deps.afterDrive(); }
  }

  private schedule(at: string): void {
    if (this.closing) return;
    const now = Date.parse(this.deps.now());
    const target = Math.max(now + 1000, Date.parse(at));
    if (!Number.isFinite(target) || (this.timerAt !== undefined && this.timerAt <= target)) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timerAt = target;
    this.timer = setTimeout(() => {
      this.timer = undefined; this.timerAt = undefined;
      void this.request('dispatch-retry-deadline').catch(() => {});
    }, Math.min(2_147_483_647, target - now));
    this.timer.unref?.();
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined; this.timerAt = undefined;
    while (this.active.size) await Promise.allSettled([...this.active]);
  }
}
