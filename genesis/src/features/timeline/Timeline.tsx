import { useId, useState } from "react";
import {
  EmptyState,
  ErrorState,
  Heading,
  LoadingState,
} from "../../components";
import { useTimeline } from "../../hooks/useTimeline";
import { TimelineItem } from "./TimelineItem";
import styles from "./Timeline.module.css";

// Timeline · tercera sección del Dashboard (D5).
//
// NO es un Event Store, NO es un log viewer, NO pagina, NO refresca
// automáticamente. Muestra hasta 20 eventos de las últimas 24 horas,
// del más reciente al más antiguo.
//
// La ventana temporal se congela en el primer render (useState-
// initializer) para no re-disparar la query cada frame en StrictMode.
// El API devuelve `ORDER BY ts ASC`; el cliente invierte la lista
// para presentar "más reciente arriba".
//
// Endpoint permitido y consumido: GET /insight/events/timeline.

const WINDOW_HOURS = 24;
const LIMIT = 20;

export function Timeline(): JSX.Element {
  const headingId = useId();
  const [range] = useState(() => {
    const now = new Date();
    const from = new Date(now.getTime() - WINDOW_HOURS * 60 * 60 * 1000);
    return { from: from.toISOString(), to: now.toISOString() };
  });

  const query = useTimeline({ ...range, limit: LIMIT });

  // El API entrega ASC (más antiguo primero). Invertimos para pintar
  // el más reciente arriba, sin `.reverse()` mutante.
  const reversed =
    query.data !== undefined ? [...query.data].reverse() : undefined;

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <header className={styles.header}>
        <Heading id={headingId} level={2} visualSize="lg">
          Timeline
        </Heading>
        <span className={styles.subtitle}>
          Hasta {LIMIT} eventos de las últimas {WINDOW_HOURS} horas.
        </span>
      </header>

      {query.isLoading ? <LoadingState label="Cargando timeline…" /> : null}

      {query.isError ? (
        <ErrorState
          title="No se pudo cargar el timeline"
          message={query.error.message}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : null}

      {query.isSuccess && reversed !== undefined && reversed.length === 0 ? (
        <EmptyState
          title="Sin actividad reciente"
          body="El servidor no ha registrado eventos en las últimas horas. Vuelve más tarde."
        />
      ) : null}

      {query.isSuccess && reversed !== undefined && reversed.length > 0 ? (
        <ol
          className={styles.list}
          aria-label="Eventos recientes del ecosistema"
          data-testid="timeline-list"
        >
          {reversed.map((event) => (
            <TimelineItem key={event.event_uuid} event={event} />
          ))}
        </ol>
      ) : null}
    </section>
  );
}
