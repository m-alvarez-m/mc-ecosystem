// Retry con backoff exponencial + jitter independiente (ADR-013 D1).
//
// Contrato:
//   - hasta N intentos (default 5 → 1 inicial + 4 retries).
//   - delays base: 200 · 400 · 800 · 1600 · 3200 ms (doblan cada paso).
//   - cap duro de 30_000 ms.
//   - jitter ±25% independiente por intento: cada delay se sortea en
//     [base·0.75, base·1.25] cada vez que se calcula. La
//     INDEPENDENCIA es la propiedad clave: dos requests que fallan
//     simultáneamente no coinciden en sus reintentos porque cada uno
//     sortea aparte.
//
// Este módulo NO clasifica errores, NO habla con la DLQ, NO llama al
// circuit breaker. Es un pequeño helper puro que envuelve una función
// async y la reintenta. La política de "qué contar como fallo" y
// "qué hacer si se agota" vive en el ejecutor de mayor nivel.

export interface RetryOptions {
  /** Intentos totales, incluyendo el primero. Default 5. */
  maxAttempts?: number;
  /** Delay base del primer retry en ms. Default 200. */
  baseDelayMs?: number;
  /** Cap duro de cada delay individual en ms. Default 30000. */
  capMs?: number;
  /** Amplitud del jitter (fracción del delay). Default 0.25 (±25%). */
  jitterRatio?: number;
  /**
   * Callback pre-retry: recibe (attempt, delayMs, err). Se usa para
   * emitir el log estructurado del D4. Se ejecuta ANTES del sleep,
   * NO se espera (fire-and-forget) para no distorsionar el timing.
   */
  onRetry?: (info: { attempt: number; delayMs: number; err: unknown }) => void;
  /**
   * Función de sleep inyectable — los tests pasan una que resuelve al
   * instante. Default: setTimeout envuelto en Promise.
   */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Fuente de aleatoriedad inyectable — los tests pasan una determinista
   * (ej. `() => 0.5` para desactivar jitter). Default: Math.random.
   */
  random?: () => number;
}

const DEFAULTS = {
  maxAttempts: 5,
  baseDelayMs: 200,
  capMs: 30_000,
  jitterRatio: 0.25,
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calcula el delay del intento N-ésimo (1-indexado; el primer retry
 * = attempt 1, es decir 200ms base). Aplica cap ANTES del jitter para
 * que la variación no ampute la meseta superior.
 *
 * Fórmula: base · 2^(attempt-1), capado a `cap`, luego jitter
 * ±ratio uniforme.
 *
 * Exportado para tests.
 */
export function computeDelayMs(
  attempt: number,
  opts: {
    baseDelayMs?: number;
    capMs?: number;
    jitterRatio?: number;
    random?: () => number;
  } = {},
): number {
  const baseDelayMs = opts.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const capMs = opts.capMs ?? DEFAULTS.capMs;
  const jitterRatio = opts.jitterRatio ?? DEFAULTS.jitterRatio;
  const random = opts.random ?? Math.random;

  const exp = baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
  const capped = Math.min(exp, capMs);
  // random() ∈ [0, 1) → [-1, 1)
  const signedFrac = random() * 2 - 1;
  const jittered = capped * (1 + jitterRatio * signedFrac);
  return Math.max(0, Math.round(jittered));
}

export interface RetryResult<T> {
  ok: true;
  value: T;
  attempts: number;
}
export interface RetryFailure {
  ok: false;
  err: unknown;
  attempts: number;
}

/**
 * Ejecuta `fn` hasta `maxAttempts` veces. Devuelve el valor si alguno
 * tuvo éxito; devuelve el ÚLTIMO error si se agotaron. No lanza — el
 * caller decide qué hacer (mandar a DLQ, propagar, ignorar).
 */
export async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryResult<T> | RetryFailure> {
  const maxAttempts = options.maxAttempts ?? DEFAULTS.maxAttempts;
  const sleep = options.sleep ?? defaultSleep;
  let lastErr: unknown = undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const value = await fn(attempt);
      return { ok: true, value, attempts: attempt };
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      const delayMs = computeDelayMs(attempt, options);
      if (options.onRetry !== undefined) {
        try {
          options.onRetry({ attempt, delayMs, err });
        } catch {
          /* swallow: la observabilidad no debe romper el retry */
        }
      }
      await sleep(delayMs);
    }
  }

  return { ok: false, err: lastErr, attempts: maxAttempts };
}
