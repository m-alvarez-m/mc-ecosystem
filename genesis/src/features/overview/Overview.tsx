import { useState } from "react";
import { Heading, EmptyState, ErrorState, LoadingState } from "../../components";
import { useInsights } from "../../hooks/useInsights";
import { InsightCard } from "./InsightCard";
import { formatDateTime } from "./formatters";
import styles from "./Overview.module.css";

// Overview · pantalla inicial del Dashboard (D3).
//
// Consume EXCLUSIVAMENTE GET /insight/insights (via useInsights).
// No hay polling, no hay refresh automatico: TanStack Query
// revalida on-window-focus con staleTime 60s (configurado en
// api/queryClient.ts).
//
// La ventana temporal es fija por vida de la pantalla: desde el
// cutoff oficial del mundo real (ADR-007) hasta el instante del
// PRIMER render. useState(() => ...) evita que StrictMode dispare
// una nueva query por cada re-render (misma leccion aprendida en
// D1 con el proof-of-life).

const CUTOFF_ISO = "2026-07-26T23:25:52Z";

export function Overview(): JSX.Element {
  const [to] = useState(() => new Date().toISOString());
  const query = useInsights({ from: CUTOFF_ISO, to });

  return (
    <>
      <header className={styles.header}>
        <Heading level={1} visualSize="xl">
          Overview
        </Heading>
        <p className={styles.subtitle}>
          Ventana: {formatDateTime(CUTOFF_ISO)} → {formatDateTime(to)}
        </p>
      </header>

      {query.isLoading ? <LoadingState label="Cargando insights…" /> : null}

      {query.isError ? (
        <ErrorState
          title="No se pudieron cargar los insights"
          message={query.error.message}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : null}

      {query.isSuccess && query.data.length === 0 ? (
        <EmptyState
          title="Aún no hay insights"
          body="El Insight Engine no encontró datos suficientes en la ventana seleccionada. Vuelve más tarde o amplía el rango."
        />
      ) : null}

      {query.isSuccess && query.data.length > 0 ? (
        <div
          className={styles.grid}
          role="list"
          aria-label="Insights del ecosistema"
        >
          {query.data.map((insight) => (
            <div role="listitem" key={insight.id}>
              <InsightCard insight={insight} />
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
