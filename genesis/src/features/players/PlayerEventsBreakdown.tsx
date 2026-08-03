import { formatCount } from "../summary";
import type { PlayerEventsByType } from "../../api/playerInsight";
import styles from "./PlayerEventsBreakdown.module.css";

export interface PlayerEventsBreakdownProps {
  entries: readonly PlayerEventsByType[];
}

// Distribución del jugador por tipo de evento. Sin gráficos, sin
// barras: <dl> semántica con key (type técnico) y value (count
// formateado). La API entrega DESC por count; se conserva el orden.

export function PlayerEventsBreakdown({
  entries,
}: PlayerEventsBreakdownProps): JSX.Element {
  return (
    <dl className={styles.root} aria-label="Distribución de eventos por tipo">
      {entries.map((entry) => (
        <Row key={entry.type} type={entry.type} count={entry.count} />
      ))}
    </dl>
  );
}

function Row({
  type,
  count,
}: {
  type: string;
  count: string;
}): JSX.Element {
  return (
    <>
      <dt className={styles.type} data-type={type}>
        {type}
      </dt>
      <dd className={styles.count}>{formatCount(count)}</dd>
    </>
  );
}
