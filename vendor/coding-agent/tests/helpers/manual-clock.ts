export class ManualClock {
  readonly #initialTime: number;
  #currentTime: number;

  constructor(initialTime: Date | number = 0) {
    const epochMilliseconds = initialTime instanceof Date ? initialTime.getTime() : initialTime;
    if (!Number.isFinite(epochMilliseconds)) {
      throw new TypeError("initialTime 必须是有效时间");
    }
    this.#initialTime = epochMilliseconds;
    this.#currentTime = epochMilliseconds;
  }

  now(): Date {
    return new Date(this.#currentTime);
  }

  advance(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new RangeError("milliseconds 必须是非负有限数");
    }
    this.#currentTime += milliseconds;
  }

  reset(): void {
    this.#currentTime = this.#initialTime;
  }
}
