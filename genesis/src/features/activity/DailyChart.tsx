import type { ActivityDayBucket } from "../../api/activity";
import { ChartBar } from "./ChartBar";
import styles from "./DailyChart.module.css";

export interface DailyChartProps {
  /** Buckets tal cual devueltos por el API (sólo días con eventos). */
  buckets: readonly ActivityDayBucket[];
  /**
   * Ventana temporal usada para la query — se rellenan con 0 los
   * huecos entre `from` y `to`.
   */
  from: string;
  to: string;
}

// DailyChart · barras verticales por día en la ventana [from, to].
//
// El API sólo entrega días con eventos; aquí se rellena para que
// la línea del tiempo sea continua (sin saltos visuales). Máximo
// razonable de días esperado: 30-60. Fuera de ese rango la
// visualización se vuelve estrecha — el consumidor debe reducir la
// ventana.

function toDayKey(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fillDaily(
  buckets: readonly ActivityDayBucket[],
  from: string,
  to: string,
): { date: string; count: string }[] {
  const map = new Map<string, string>();
  for (const b of buckets) map.set(b.date, b.count);

  const start = new Date(`${from.slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${to.slice(0, 10)}T00:00:00Z`);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start > end
  ) {
    return [...buckets];
  }

  const out: { date: string; count: string }[] = [];
  const cursor = new Date(start);
  // Cap defensivo: no producir más de 366 barras.
  for (let i = 0; i < 366 && cursor <= end; i++) {
    const key = toDayKey(cursor);
    out.push({ date: key, count: map.get(key) ?? "0" });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function toNumberSafe(count: string): number {
  const n = Number(count);
  return Number.isFinite(n) ? n : 0;
}

// Etiqueta corta para el eje X: "26 jul" (día + mes abreviado).
const dayLabelFmt = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function shortLabel(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateKey;
  return dayLabelFmt.format(d).replace(".", "");
}

export function DailyChart({
  buckets,
  from,
  to,
}: DailyChartProps): JSX.Element {
  const filled = fillDaily(buckets, from, to);
  const max = filled.reduce((m, b) => Math.max(m, toNumberSafe(b.count)), 0);

  return (
    <div className={styles.root} data-testid="daily-chart">
      <div className={styles.gridWrap}>
        <div
          className={styles.grid}
          role="list"
          aria-label="Actividad diaria en la ventana temporal"
        >
          {filled.map(({ date, count }) => {
            const intensity = max === 0 ? 0 : toNumberSafe(count) / max;
            const aria = `${date} · ${count} eventos`;
            return (
              <div key={date} role="listitem">
                <ChartBar
                  date={date}
                  count={count}
                  label={shortLabel(date)}
                  ariaLabel={aria}
                  intensity={intensity}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
