import { formatDateTime } from "../overview";
import type { PlayerNameHistoryEntry } from "../../api/playerInsight";
import styles from "./PlayerNameHistory.module.css";

export interface PlayerNameHistoryProps {
  entries: readonly PlayerNameHistoryEntry[];
}

// Historial de nombres (transiciones canónicas guardadas en la tabla
// `player_names` de la API). La lista llega ASC por seen_at; se
// invierte para mostrar el nombre más reciente arriba — el patrón
// mental "de lo actual hacia lo antiguo" que usan los usuarios.

export function PlayerNameHistory({
  entries,
}: PlayerNameHistoryProps): JSX.Element {
  const desc = [...entries].reverse();
  return (
    <ol className={styles.root} aria-label="Historial de nombres">
      {desc.map((entry) => (
        <li
          key={`${entry.seen_at}-${entry.name}`}
          className={styles.item}
          data-name={entry.name}
        >
          <span className={styles.name}>{entry.name}</span>
          <time className={styles.date} dateTime={entry.seen_at}>
            {formatDateTime(entry.seen_at)}
          </time>
        </li>
      ))}
    </ol>
  );
}
