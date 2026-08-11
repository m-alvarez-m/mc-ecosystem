// Monitor de saturación de la DLQ (ADR-013 D7).
//
// Warn cuando `count(*) FROM dead_letter_events WHERE replayed_at IS
// NULL > 100`. No es un healthcheck fail — sólo un log WARN con
// estructura estable que un futuro sistema de alertas puede grep.
//
// Se dispara:
//   - una vez al arrancar el bot (independiente del cron).
//   - cada `intervalMs` ms (default: 1 h) mientras el bot esté vivo.
//
// Diseñar la alarma real (paging, dashboards, etc.) queda fuera de
// scope del ADR-013 · post-A.3.

import type { Logger } from "pino";
import type { DlqClient } from "./dlq-client.js";

export interface DlqMonitorOptions {
  client: Pick<DlqClient, "countPending">;
  logger: Pick<Logger, "info" | "warn" | "error">;
  intervalMs?: number;
  threshold?: number;
  /** setInterval inyectable para tests. */
  setIntervalImpl?: (fn: () => void, ms: number) => NodeJS.Timeout;
}

const DEFAULTS = {
  intervalMs: 60 * 60 * 1000, // 1 h
  threshold: 100,
};

export class DlqMonitor {
  private readonly client: Pick<DlqClient, "countPending">;
  private readonly logger: Pick<Logger, "info" | "warn" | "error">;
  private readonly intervalMs: number;
  private readonly threshold: number;
  private readonly setIv: (fn: () => void, ms: number) => NodeJS.Timeout;
  private handle: NodeJS.Timeout | null = null;

  constructor(opts: DlqMonitorOptions) {
    this.client = opts.client;
    this.logger = opts.logger;
    this.intervalMs = opts.intervalMs ?? DEFAULTS.intervalMs;
    this.threshold = opts.threshold ?? DEFAULTS.threshold;
    this.setIv = opts.setIntervalImpl ?? setInterval;
  }

  /** Chequeo puntual — se llama al arranque y cada intervalMs. */
  async check(): Promise<{ pending: number; warned: boolean }> {
    try {
      const pending = await this.client.countPending();
      if (pending > this.threshold) {
        this.logger.warn(
          { pending, threshold: this.threshold, adr: "ADR-013 D7" },
          "resilience.dlq_saturated",
        );
        return { pending, warned: true };
      }
      this.logger.info(
        { pending, threshold: this.threshold },
        "resilience.dlq_healthy",
      );
      return { pending, warned: false };
    } catch (err) {
      // Fallo del monitor NO debe tumbar el bot. Se loguea y se sigue.
      this.logger.error({ err }, "resilience.dlq_monitor_check_failed");
      return { pending: -1, warned: false };
    }
  }

  start(): void {
    if (this.handle !== null) return;
    // Chequeo inmediato al arranque (fire-and-forget).
    void this.check();
    this.handle = this.setIv(() => {
      void this.check();
    }, this.intervalMs);
    if (typeof (this.handle as NodeJS.Timeout).unref === "function") {
      (this.handle as NodeJS.Timeout).unref();
    }
  }

  stop(): void {
    if (this.handle !== null) {
      clearInterval(this.handle);
      this.handle = null;
    }
  }
}
