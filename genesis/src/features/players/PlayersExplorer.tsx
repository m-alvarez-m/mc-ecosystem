import { useCallback, useId, useState } from "react";
import {
  EmptyState,
  ErrorState,
  Heading,
  LoadingState,
} from "../../components";
import { useTopPlayers } from "../../hooks/useTopPlayers";
import { PlayerCard } from "./PlayerCard";
import { PlayerDrawer } from "./PlayerDrawer";
import styles from "./PlayersExplorer.module.css";

// PlayersExplorer · cuarta sección del Dashboard (D6).
//
// Descubre jugadores conocidos (top-N por actividad desde el
// cutoff oficial) y permite abrir un Drawer con el detalle
// completo del jugador seleccionado.
//
// Endpoints consumidos (ambos autorizados en D6):
//   - GET /insight/players/top?from=<ADR-007>&to=<now>&limit=20
//     — descubre jugadores + nombre canónico + count en la ventana.
//   - GET /insight/player/:uuid
//     — dispara cuando el usuario abre un PlayerCard (Drawer).
//
// Sin routing nuevo — el Drawer vive dentro de esta misma página.

const CUTOFF_ISO = "2026-07-26T23:25:52Z";
const LIMIT = 20;

export function PlayersExplorer(): JSX.Element {
  const headingId = useId();
  const [range] = useState(() => ({
    from: CUTOFF_ISO,
    to: new Date().toISOString(),
  }));
  const query = useTopPlayers({ ...range, limit: LIMIT });

  const [openUuid, setOpenUuid] = useState<string | null>(null);
  const openDrawer = useCallback((uuid: string) => {
    setOpenUuid(uuid);
  }, []);
  const closeDrawer = useCallback(() => {
    setOpenUuid(null);
  }, []);

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <header className={styles.header}>
        <Heading id={headingId} level={2} visualSize="lg">
          Players
        </Heading>
        <span className={styles.subtitle}>
          Hasta {LIMIT} jugadores con actividad registrada desde el cutoff oficial.
        </span>
      </header>

      {query.isLoading ? <LoadingState label="Cargando jugadores…" /> : null}

      {query.isError ? (
        <ErrorState
          title="No se pudo cargar la lista de jugadores"
          message={query.error.message}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : null}

      {query.isSuccess && query.data.length === 0 ? (
        <EmptyState
          title="Sin jugadores conocidos aún"
          body="La API no registra jugadores en la ventana seleccionada. Aparecerán aquí en cuanto un jugador ingrese por primera vez."
        />
      ) : null}

      {query.isSuccess && query.data.length > 0 ? (
        <ul
          className={styles.grid}
          aria-label="Jugadores conocidos"
          data-testid="players-grid"
        >
          {query.data.map((player) => (
            <li key={player.uuid} className={styles.gridItem}>
              <PlayerCard player={player} onOpen={openDrawer} />
            </li>
          ))}
        </ul>
      ) : null}

      <PlayerDrawer uuid={openUuid} onClose={closeDrawer} />
    </section>
  );
}
