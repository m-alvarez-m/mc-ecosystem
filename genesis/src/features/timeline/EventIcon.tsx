import { cn } from "../../utils";
import { eventCategory, type EventCategory } from "./eventFormatters";
import styles from "./EventIcon.module.css";

export interface EventIconProps {
  /** Tipo crudo del evento (ej. "server.start"). */
  type: string;
  /** Tamaño interno del SVG en px. Contenedor sigue siendo 32×32. */
  size?: number;
}

// Icono decorativo del TimelineItem. SVG local — sin librerías.
//
// El contenedor (32×32, redondeado, con bg tintado según categoría)
// da el "chip" visual; el SVG interior es un glyph simple que
// insinúa la categoría. `aria-hidden` porque el texto del title
// ya comunica la información — el icono es puramente decorativo.
//
// Cada categoría (definida en eventFormatters) mapea a un glyph.

const CATEGORY_CLASS: Record<EventCategory, string | undefined> = {
  server: styles.server,
  session: styles.session,
  world: styles.world,
  block: styles.block,
  combat: styles.combat,
  progress: styles.progress,
  economy: styles.economy,
  chat: styles.chat,
  backup: styles.backup,
  event: styles.event,
  unknown: undefined,
};

export function EventIcon({ type, size = 18 }: EventIconProps): JSX.Element {
  const category = eventCategory(type);
  return (
    <span
      className={cn(styles.root, CATEGORY_CLASS[category])}
      data-category={category}
      aria-hidden="true"
    >
      <Glyph category={category} size={size} />
    </span>
  );
}

// ------------------------------------------------------------------
// Glyphs por categoría (SVG paths locales, currentColor)
// ------------------------------------------------------------------

function Glyph({
  category,
  size,
}: {
  category: EventCategory;
  size: number;
}): JSX.Element {
  const commonProps = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (category) {
    case "server":
      // Botón de power.
      return (
        <svg {...commonProps}>
          <path d="M12 3v9" />
          <path d="M6 8a7 7 0 1 0 12 0" />
        </svg>
      );
    case "session":
      // Silueta humana.
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      );
    case "combat":
      // Espadas cruzadas simplificadas.
      return (
        <svg {...commonProps}>
          <path d="M4 4l16 16" />
          <path d="M20 4L4 20" />
        </svg>
      );
    case "block":
      // Cubo isométrico.
      return (
        <svg {...commonProps}>
          <path d="M12 3l8 4v10l-8 4-8-4V7z" />
          <path d="M4 7l8 4 8-4" />
          <path d="M12 11v10" />
        </svg>
      );
    case "world":
      // Brújula/globo.
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a13 13 0 0 1 0 18a13 13 0 0 1 0-18z" />
        </svg>
      );
    case "progress":
      // Trofeo.
      return (
        <svg {...commonProps}>
          <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
          <path d="M12 13v4" />
          <path d="M8 19h8" />
          <path d="M6 5h2v3a2 2 0 0 1-2-2z" />
          <path d="M18 5h-2v3a2 2 0 0 0 2-2z" />
        </svg>
      );
    case "economy":
      // Bolsa.
      return (
        <svg {...commonProps}>
          <path d="M6 8h12l-1 12H7z" />
          <path d="M9 8V6a3 3 0 0 1 6 0v2" />
        </svg>
      );
    case "chat":
      // Bocadillo.
      return (
        <svg {...commonProps}>
          <path d="M4 5h16v11H9l-5 4z" />
        </svg>
      );
    case "backup":
      // Disco.
      return (
        <svg {...commonProps}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M8 4v6h8V4" />
          <path d="M8 20v-6h8v6" />
        </svg>
      );
    case "event":
      // Estrella.
      return (
        <svg {...commonProps}>
          <path d="M12 3l2.5 6h6l-5 4 2 6l-5.5-4l-5.5 4l2-6l-5-4h6z" />
        </svg>
      );
    case "unknown":
    default:
      // Dot.
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="3" fill="currentColor" />
        </svg>
      );
  }
}
