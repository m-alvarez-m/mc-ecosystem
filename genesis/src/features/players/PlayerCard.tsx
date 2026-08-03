import { Button, Card } from "../../components";
import { formatCount } from "../summary";
import { shortPlayerId } from "../timeline";
import type { TopPlayer } from "../../api/topPlayers";
import styles from "./PlayerCard.module.css";

export interface PlayerCardProps {
  player: TopPlayer;
  /**
   * Handler del botón "Ver detalles". Al invocarse, la sección
   * PlayersExplorer abre el Drawer con este uuid.
   */
  onOpen: (uuid: string) => void;
}

// Card de jugador (D6).
//
// Muestra los datos disponibles en TopPlayer (nombre canónico + uuid
// + count en la ventana). "Primer/Último evento" no viven aquí — se
// requerirían N llamadas a /player/:uuid para pintarlos por card.
// En su lugar se exponen dentro del Drawer al abrir un jugador.

export function PlayerCard({ player, onOpen }: PlayerCardProps): JSX.Element {
  const short = shortPlayerId(player.uuid) ?? "#";
  return (
    <Card variant="surface" data-player-uuid={player.uuid}>
      <div className={styles.root}>
        <h3 className={styles.name}>{player.name}</h3>

        <div className={styles.meta}>
          <span className={styles.uuid} title={player.uuid}>
            {short}
          </span>
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Eventos en ventana</span>
            <span className={styles.metaValue}>
              {formatCount(player.count)}
            </span>
          </div>
        </div>

        <div className={styles.footer}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpen(player.uuid)}
            aria-label={`Ver detalles de ${player.name}`}
          >
            Ver detalles
          </Button>
        </div>
      </div>
    </Card>
  );
}
