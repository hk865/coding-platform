export type Cleanup = () => void | Promise<void>;

export class ResourceScope {
  readonly #cleanups: Cleanup[] = [];
  #disposed = false;

  defer(cleanup: Cleanup): void {
    if (this.#disposed) throw new Error("ResourceScope 已清理，不能再注册资源");
    this.#cleanups.push(cleanup);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    const failures: unknown[] = [];

    for (const cleanup of this.#cleanups.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(failures, "一个或多个测试资源清理失败");
    }
  }
}
