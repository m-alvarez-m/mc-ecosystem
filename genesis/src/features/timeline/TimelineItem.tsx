import { formatDateTime } from "../overview";
import { EventIcon } from "./EventIcon";
import { eventTitle, shortPlayerId } from "./eventFormatters";
import type { TimelineEvent } from "../../api/timeline";
import styles from "./TimelineItem.module.css";

export interface TimelineItemProps {
  event: TimelineEvent;
}

// Un ítem del Timeline (D5). Es un <li> — el <ol> vive en `Timeline`.
// Muestra ÚNICAMENTE:
//   - icono decorativo (aria-hidden)
//   - título humano del evento
//   - subtítulo opcional: prefijo #<uuid_8> si hay player_uuid
//   - fecha formateada (formatDateTime de D3)
//
// NO se renderiza `data`, ni `world`, ni coordenadas, ni severity,
// ni confidence, ni badges — D5 es lo mínimo legible.

export function TimelineItem({ event }: TimelineItemProps): JSX.Element {
  const title = eventTitle(event.type);
  const subtitle = shortPlayerId(event.player_uuid);
  const dateLabel = formatDateTime(event.ts);

  return (
    <li
      className={styles.root}
      data-event-type={event.type}
      data-event-id={event.id}
    >
      <EventIcon type={event.type} />
      <div className={styles.body}>
        <div className={styles.headerRow}>
          <span className={styles.title}>{title}</span>
          <time className={styles.date} dateTime={event.ts}>
            {dateLabel}
          </time>
        </div>
        {subtitle !== null ? (
          <span className={styles.subtitle}>{subtitle}</span>
        ) : null}
      </div>
    </li>
  );
}
