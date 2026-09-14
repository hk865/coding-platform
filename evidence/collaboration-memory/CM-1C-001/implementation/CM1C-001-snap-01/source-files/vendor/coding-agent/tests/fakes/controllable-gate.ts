export type GateWaitResult = "released" | "aborted";

export class ControllableGate {
  #released = false;
  readonly #releasedPromise: Promise<void>;
  readonly #releasePromise: () => void;

  constructor() {
    let releasePromise: (() => void) | undefined;
    this.#releasedPromise = new Promise<void>((resolve) => {
      releasePromise = resolve;
    });
    this.#releasePromise = () => releasePromise?.();
  }

  get released(): boolean {
    return this.#released;
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.#releasePromise();
  }

  async wait(signal: AbortSignal): Promise<GateWaitResult> {
    if (signal.aborted) return "aborted";
    if (this.#released) return "released";

    return new Promise<GateWaitResult>((resolve) => {
      const finish = (result: GateWaitResult) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const onAbort = () => finish("aborted");
      signal.addEventListener("abort", onAbort, { once: true });
      void this.#releasedPromise.then(() => finish("released"));
    });
  }
}
