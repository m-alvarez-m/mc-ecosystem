import { useCallback, useId, useState } from "react";
import {
  Card,
  EmptyState,
  ErrorState,
  Heading,
  LoadingState,
} from "../../components";
import { useActivityHourly } from "../../hooks/useActivityHourly";
import { useActivityDaily } from "../../hooks/useActivityDaily";
import { HourlyHeatmap } from "./HourlyHeatmap";
import { DailyChart } from "./DailyChart";
import styles from "./ActivityAnalytics.module.css";

// ActivityAnalytics · quinta sección del Dashboard (D7).
//
// Sección puramente visual sobre la actividad del ecosistema —
// no interpreta (los Insights ya lo hacen), sólo REPRESENTA:
//   - HourlyHeatmap  ← /insight/activity/hourly?from=&to=
//   - DailyChart     ← /insight/activity/daily?from=&to=
//
// Cada gráfico tiene su propio Card contenedor con título y subtítulo
// explicativos. Los estados de loading/error/empty se coordinan a
// nivel sección para no fragmentar la UX cuando ambas queries
// arrancan al mismo tiempo. El bloque interno con las dos Cards
// sólo se pinta cuando AMBAS resolvieron con éxito.
//
// Ventanas:
//   - Hourly: from = ADR-007 cutoff, to = now (histograma de todo
//     el mundo real, 0..23 UTC).
//   - Daily: últimos 30 días respecto a `to` — 30 barras que caben
//     bien en desktop y mantienen densidad visual.

const CUTOFF_ISO = "2026-07-26T23:25:52Z";
const DAILY_WINDOW_DAYS = 30;

export function ActivityAnalytics(): JSX.Element {
  const headingId = useId();
  const [range] = useState(() => {
    const now = new Date();
    const dailyFrom = new Date(
      now.getTime() - DAILY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    return {
      to: now.toISOString(),
      hourlyFrom: CUTOFF_ISO,
      dailyFrom: dailyFrom.toISOString(),
    };
  });

  const hourly = useActivityHourly({ from: range.hourlyFrom, to: range.to });
  const daily = useActivityDaily({ from: range.dailyFrom, to: range.to });

  const isLoading = hourly.isLoading || daily.isLoading;
  const isError = hourly.isError || daily.isError;
  const errorMessage =
    hourly.error?.message ?? daily.error?.message ?? undefined;
  const bothSuccess = hourly.isSuccess && daily.isSuccess;
  const isEmpty =
    bothSuccess &&
    hourly.data.length === 0 &&
    daily.data.length === 0;

  const retry = useCallback(() => {
    if (hourly.isError) void hourly.refetch();
    if (daily.isError) void daily.refetch();
  }, [hourly, daily]);

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <header className={styles.header}>
        <Heading id={headingId} level={2} visualSize="lg">
          Activity Analytics
        </Heading>
        <span className={styles.subtitle}>
          Distribución horaria (UTC) e histograma diario de los últimos {DAILY_WINDOW_DAYS} días.
        </span>
      </header>

      {isLoading ? <LoadingState label="Cargando actividad…" /> : null}

      {isError ? (
        <ErrorState
          title="No se pudo cargar la actividad"
          {...(errorMessage !== undefined ? { message: errorMessage } : {})}
          onRetry={retry}
        />
      ) : null}

      {bothSuccess && isEmpty ? (
        <EmptyState
          title="Sin actividad para graficar"
          body="La API no devolvió muestras horarias ni diarias en la ventana seleccionada."
        />
      ) : null}

      {bothSuccess && !isEmpty ? (
        <div className={styles.cardStack} data-testid="activity-cards">
          <Card variant="surface">
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>Actividad por hora (UTC)</h3>
                <span className={styles.cardSubtitle}>
                  Cada celda es una hora del día. Mayor intensidad = más eventos acumulados.
                </span>
              </div>
              <HourlyHeatmap buckets={hourly.data} />
            </div>
          </Card>

          <Card variant="surface">
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>Actividad diaria</h3>
                <span className={styles.cardSubtitle}>
                  Una barra por día. Altura proporcional al total del día.
                </span>
              </div>
              <DailyChart
                buckets={daily.data}
                from={range.dailyFrom}
                to={range.to}
              />
            </div>
          </Card>
        </div>
      ) : null}
    </section>
  );
}
