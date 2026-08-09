// Scheduler in-process del prune (ADR-012 D3).
//
// Cadencia: día 1 del mes, 04:00 UTC (madrugada local, mínimo tráfico).
// Implementación: tick horario que evalúa "¿ya es la hora y no lo hice
// este mes?". Motivación de NO usar node-cron:
//   - Cero dependencias npm nuevas para una cadencia trivial.
//   - Testeo por control de tiempo (`now()` inyectable).
//   - El overhead de un tick/hora es despreciable.
//
// La memoria del último disparo vive en memoria del proceso. Un
// restart del contenedor entre 04:00 y 04:59 UTC del día 1 podría
// disparar dos veces; el guardián `periodAlreadyArchived` dentro del
// prune hace la ejecución idempotente contra ese caso.

import type { PrunePool, PruneRunOptions } from "./prune.js";
import { runPrune } from "./prune.js";

export interface SchedulerOptions {
  pool: PrunePool;
  runOptions: Omit<PruneRunOptions, "now" | "period">;
  /** Inyectable en tests. */
  now?: () => Date;
  /** Inyectable en tests: reemplaza setInterval. */
  setIntervalImpl?: (fn: () => void, ms: number) => NodeJS.Timeout;
  /** Callback opcional para logging o instrumentación de tests. */
  onTick?: (info: { firedAt: Date; ran: boolean; results?: unknown }) => void;
  onError?: (err: unknown) => void;
}

export interface ScheduledPrune {
  /** Dispara la evaluación de forma manual (útil para tests). */
  tick: (nowOverride?: Date) => Promise<{ ran: boolean }>;
  stop: () => void;
}

const HOUR_MS = 60 * 60 * 1000;

// Trigger: día 1, hora 04 UTC. Cualquier tick que caiga en esa ventana
// horaria del día 1 dispara — pero sólo si no lo hizo ya para el mes
// en curso (memoria in-process).
function isTriggerWindow(d: Date): boolean {
  return d.getUTCDate() === 1 && d.getUTCHours() === 4;
}

function periodOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function startScheduler(opts: SchedulerOptions): ScheduledPrune {
  const now = opts.now ?? (() => new Date());
  const setIv = opts.setIntervalImpl ?? setInterval;
  let lastFiredPeriod: string | null = null;

  async function tick(nowOverride?: Date): Promise<{ ran: boolean }> {
    const t = nowOverride ?? now();
    const period = periodOf(t);
    if (!isTriggerWindow(t)) {
      opts.onTick?.({ firedAt: t, ran: false });
      return { ran: false };
    }
    if (lastFiredPeriod === period) {
      opts.onTick?.({ firedAt: t, ran: false });
      return { ran: false };
    }
    lastFiredPeriod = period;
    try {
      const results = await runPrune(opts.pool, { ...opts.runOptions, now: t });
      opts.onTick?.({ firedAt: t, ran: true, results });
      return { ran: true };
    } catch (err) {
      opts.onError?.(err);
      return { ran: true }; // marcar como intentado para no reintentar en el próximo tick
    }
  }

  const handle = setIv(() => {
    void tick();
  }, HOUR_MS);
  // Los tests inyectan un fake que no requiere `.unref()`; en producción
  // el timer real de Node sí soporta unref para no bloquear el shutdown.
  if (typeof (handle as NodeJS.Timeout).unref === "function") {
    (handle as NodeJS.Timeout).unref();
  }

  return {
    tick,
    stop: () => clearInterval(handle),
  };
}
