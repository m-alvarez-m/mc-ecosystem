// TTL cache in-memory para /players (ADR-016 D3 · TTL 10s).
//
// Dedup entre ejecuciones cercanas: si dos usuarios ejecutan
// /players con <10s de diferencia, la segunda no re-consulta al api.
//
// `now` inyectable: tests deterministas sin Date.now real
// (ADR-016 D6 anti-flakiness).

export class TtlCache<T> {
  private entry: { value: T; expiresAt: number } | null = null;

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(): T | null {
    if (this.entry === null) return null;
    if (this.now().getTime() >= this.entry.expiresAt) {
      this.entry = null;
      return null;
    }
    return this.entry.value;
  }

  set(value: T): void {
    this.entry = {
      value,
      expiresAt: this.now().getTime() + this.ttlMs,
    };
  }

  async getOrCompute(compute: () => Promise<T>): Promise<T> {
    const cached = this.get();
    if (cached !== null) return cached;
    const value = await compute();
    this.set(value);
    return value;
  }

  invalidate(): void {
    this.entry = null;
  }
}
