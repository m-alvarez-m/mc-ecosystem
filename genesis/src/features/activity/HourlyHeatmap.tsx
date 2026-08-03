import { cn } from "../../utils";
import type { ActivityHourBucket } from "../../api/activity";
import { HeatmapCell } from "./HeatmapCell";
import styles from "./HourlyHeatmap.module.css";

export interface HourlyHeatmapProps {
  buckets: readonly ActivityHourBucket[];
}

// HourlyHeatmap · 24 celdas fijas (0..23 UTC).
//
// El API devuelve SOLO horas con eventos. Aquí se rellenan las 24
// posiciones con 0 para las que no aparecen — la forma del día se
// lee mejor cuando la grilla está completa.
//
// Intensidad: count[h] / max(counts). Si max === 0, todas quedan
// en 0 (celda mínima visible por HeatmapCell).

function fillHourly(buckets: readonly ActivityHourBucket[]): {
  hour: number;
  count: string;
}[] {
  const map = new Map<number, string>();
  for (const b of buckets) map.set(b.hour, b.count);
  const out: { hour: number; count: string }[] = [];
  for (let h = 0; h < 24; h++) out.push({ hour: h, count: map.get(h) ?? "0" });
  return out;
}

function toNumberSafe(count: string): number {
  const n = Number(count);
  return Number.isFinite(n) ? n : 0;
}

// Ejes X: marcamos 0, 6, 12, 18 (cuartos de día UTC) para orientación.
const AXIS_TICKS = new Set([0, 6, 12, 18]);
const LABEL = (h: number) => `${String(h).padStart(2, "0")}:00`;

export function HourlyHeatmap({ buckets }: HourlyHeatmapProps): JSX.Element {
  const filled = fillHourly(buckets);
  const max = filled.reduce((m, c) => Math.max(m, toNumberSafe(c.count)), 0);

  return (
    <div className={styles.root} data-testid="hourly-heatmap">
      <div className={styles.gridWrap}>
        <div
          className={styles.grid}
          role="list"
          aria-label="Actividad por hora del día (UTC)"
        >
          {filled.map(({ hour, count }) => {
            const intensity = max === 0 ? 0 : toNumberSafe(count) / max;
            return (
              <div key={hour} role="listitem">
                <HeatmapCell hour={hour} count={count} intensity={intensity} />
              </div>
            );
          })}
        </div>
        <div className={styles.axis} aria-hidden="true">
          {filled.map(({ hour }) => (
            <span
              key={hour}
              className={cn(
                styles.axisTick,
                !AXIS_TICKS.has(hour) && styles.axisTickHidden,
              )}
            >
              {LABEL(hour)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
