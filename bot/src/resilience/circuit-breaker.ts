// Circuit breaker con sliding window (ADR-013 D2).
//
// Estados: closed (default) · open · half_open.
//
// Transiciones:
//   closed → open: >= N fallos dentro de la ventana rodante de W ms.
//   open → half_open: al cumplirse W ms desde que se abrió.
//   half_open → closed: el próximo intento real fue éxito.
//   half_open → open: el próximo intento real fue fallo (arranca otros W ms).
//
// El breaker NO agenda timers propios — sólo consulta `now()` cada vez
// que se le pregunta el estado. Diseño puramente reactivo: cero
// interferencia con el event loop, testeable inyectando un reloj.

import type { CircuitState } from "./types.js";

export interface CircuitBreakerOptions {
  /** Fallos en la ventana rodante que disparan open. Default 5. */
  failureThreshold?: number;
  /** Duración de la ventana rodante (ms). Default 60000 (60 s). */
  windowMs?: number;
  /** Tiempo que el breaker permanece open (ms). Default 60000 (60 s). */
  openDurationMs?: number;
  /** Reloj inyectable. Default: Date.now. */
  now?: () => number;
}

const DEFAULTS = {
  failureThreshold: 5,
  windowMs: 60_000,
  openDurationMs: 60_000,
};

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly windowMs: number;
  private readonly openDurationMs: number;
  private readonly now: () => number;

  private failures: number[] = []; // timestamps ms
  private openedAt: number | null = null;
  private probeInFlight = false; // true durante el intento half-open

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? DEFAULTS.failureThreshold;
    this.windowMs = options.windowMs ?? DEFAULTS.windowMs;
    this.openDurationMs = options.openDurationMs ?? DEFAULTS.openDurationMs;
    this.now = options.now ?? Date.now;
  }

  /**
   * Estado actual. `now()` se consulta una vez por llamada.
   *
   * Transición implícita open → half_open cuando pasa `openDurationMs`.
   */
  state(): CircuitState {
    if (this.openedAt === null) return "closed";
    const elapsed = this.now() - this.openedAt;
    if (elapsed >= this.openDurationMs) return "half_open";
    return "open";
  }

  /**
   * Debe el caller intentar la operación?
   *
   * - closed: sí.
   * - open: no. El caller manda el evento directo a DLQ con
   *   reason='circuit_open' (D3).
   * - half_open: sí, pero SÓLO una petición a la vez actúa como probe.
   *   Si ya hay una en vuelo, el resto se comporta como open y va a
   *   DLQ. Esto respeta el diseño "probe = próximo evento REAL" del D2
   *   sin permitir avalanchas concurrentes al downstream que se está
   *   recuperando.
   */
  shouldAttempt(): boolean {
    const s = this.state();
    if (s === "closed") return true;
    if (s === "open") return false;
    // half_open
    if (this.probeInFlight) return false;
    this.probeInFlight = true;
    return true;
  }

  /**
   * Reportar el resultado de la operación al breaker. `success=true`
   * cierra el breaker si estaba half_open y limpia la ventana.
   * `success=false` añade el timestamp al array de fallos; si ya
   * había 5 en la ventana, dispara open.
   */
  record(success: boolean): void {
    const t = this.now();
    if (success) {
      // Éxito en half_open cierra el breaker y limpia la ventana.
      if (this.openedAt !== null) {
        this.openedAt = null;
        this.failures = [];
      }
      this.probeInFlight = false;
      return;
    }

    // Fallo en half_open re-abre el breaker (nuevo ciclo de W ms).
    if (this.openedAt !== null && this.state() === "half_open") {
      this.openedAt = t;
      this.probeInFlight = false;
      // No reseteamos failures — la ventana es rodante, no ligada al
      // ciclo del breaker.
      return;
    }

    // Fallo en closed: acumular en la ventana y evaluar trigger.
    this.failures.push(t);
    this.pruneWindow(t);
    if (this.failures.length >= this.failureThreshold) {
      this.openedAt = t;
      this.probeInFlight = false;
    }
  }

  /**
   * Resetea el breaker a closed limpiando ventana y probe. Útil para
   * intervenciones manuales y para setup de tests.
   */
  reset(): void {
    this.failures = [];
    this.openedAt = null;
    this.probeInFlight = false;
  }

  /** Snapshot inspectable para tests y logging. */
  snapshot(): {
    state: CircuitState;
    failuresInWindow: number;
    openedAt: number | null;
    probeInFlight: boolean;
  } {
    const t = this.now();
    this.pruneWindow(t);
    return {
      state: this.state(),
      failuresInWindow: this.failures.length,
      openedAt: this.openedAt,
      probeInFlight: this.probeInFlight,
    };
  }

  private pruneWindow(now: number): void {
    const cutoff = now - this.windowMs;
    // Buscar el primer índice con ts >= cutoff. Como failures[] es
    // monótono creciente, un splice desde el inicio es correcto.
    let i = 0;
    while (i < this.failures.length && this.failures[i]! < cutoff) i++;
    if (i > 0) this.failures.splice(0, i);
  }
}
