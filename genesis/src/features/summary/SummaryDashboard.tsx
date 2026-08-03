import { useId, useState } from "react";
import {
  EmptyState,
  ErrorState,
  Heading,
  LoadingState,
} from "../../components";
import { useServerInsight } from "../../hooks/useServerInsight";
import { usePlayersSummary } from "../../hooks/usePlayersSummary";
import { formatDateTime } from "../overview";
import { KpiCard } from "./KpiCard";
import { formatCount } from "./formatters";
import styles from "./SummaryDashboard.module.css";

// SummaryDashboard · capa ejecutiva del Dashboard (D4).
//
// Vive SOBRE el Overview de D3, sin sustituirlo. Consume EXCLUSIVA-
// mente los dos endpoints permitidos:
//   - GET /insight/server   → totales + primer/último evento
//   - GET /insight/players?from → conteos por segmento
//
// La ventana `from` de /insight/players se fija en el cutoff oficial
// del mundo real (ADR-007) — coherente con el rango que usa el
// Overview y con la política editorial del ecosistema.
//
// Estados (reutilizando componentes de D3):
//   - loading: LoadingState mientras cualquiera de las 2 queries
//     está resolviendo.
//   - error: ErrorState (rojo suave + botón Reintentar) si CUALQUIERA
//     de las 2 falla. Reintentar re-lanza ambas.
//   - empty: EmptyState cuando el server no tiene ni un solo evento
//     (`totalEvents == 0`). Un servidor recién nacido antes del
//     primer login se ve así.
//   - success: grid de 8 KpiCard.

const CUTOFF_ISO = "2026-07-26T23:25:52Z";

export function SummaryDashboard(): JSX.Element {
  const headingId = useId();
  const [from] = useState(() => CUTOFF_ISO);

  const server = useServerInsight();
  const players = usePlayersSummary({ from });

  const isLoading = server.isLoading || players.isLoading;
  const isError = server.isError || players.isError;
  const errorMessage =
    server.error?.message ?? players.error?.message ?? undefined;

  const bothSuccess = server.isSuccess && players.isSuccess;
  const isEmpty = bothSuccess && (server.data?.totalEvents ?? "0") === "0";

  const retry = (): void => {
    if (server.isError) void server.refetch();
    if (players.isError) void players.refetch();
  };

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <header className={styles.header}>
        <Heading id={headingId} level={2} visualSize="lg">
          Summary
        </Heading>
        <span className={styles.subtitle}>
          Segmentos de jugadores relativos al cutoff oficial ({formatDateTime(CUTOFF_ISO)}).
        </span>
      </header>

      {isLoading ? <LoadingState label="Cargando resumen…" /> : null}

      {isError ? (
        <ErrorState
          title="No se pudo cargar el resumen"
          {...(errorMessage !== undefined ? { message: errorMessage } : {})}
          onRetry={retry}
        />
      ) : null}

      {bothSuccess && isEmpty ? (
        <EmptyState
          title="Sin datos aún"
          body="El servidor todavía no ha registrado eventos. Cuando llegue el primero, este resumen aparecerá aquí."
        />
      ) : null}

      {bothSuccess && !isEmpty ? (
        <div className={styles.grid} data-testid="summary-grid">
          <KpiCard
            label="Total events"
            value={formatCount(server.data.totalEvents)}
          />
          <KpiCard
            label="Distinct event types"
            value={formatCount(server.data.distinctTypes)}
          />
          <KpiCard
            label="First event"
            valueSize="compact"
            value={
              server.data.firstEvent !== null
                ? formatDateTime(server.data.firstEvent.ts)
                : "—"
            }
            {...(server.data.firstEvent !== null
              ? { hint: server.data.firstEvent.type }
              : {})}
          />
          <KpiCard
            label="Last event"
            valueSize="compact"
            value={
              server.data.lastEvent !== null
                ? formatDateTime(server.data.lastEvent.ts)
                : "—"
            }
            {...(server.data.lastEvent !== null
              ? { hint: server.data.lastEvent.type }
              : {})}
          />
          <KpiCard
            label="Total players"
            value={formatCount(players.data.totalPlayers)}
          />
          <KpiCard
            label="Active players"
            value={formatCount(players.data.activePlayers)}
          />
          <KpiCard
            label="New players"
            value={formatCount(players.data.newPlayers)}
          />
          <KpiCard
            label="Returning players"
            value={formatCount(players.data.returningPlayers)}
          />
        </div>
      ) : null}
    </section>
  );
}
