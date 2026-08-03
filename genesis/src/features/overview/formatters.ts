import type {
  BadgeVariant,
} from "../../components";
import type {
  Confidence,
  InsightCategory,
  InsightId,
  Severity,
} from "../../api/insights";

// Formatters de la vista Overview.
//
// Toda la traduccion "id/enum -> etiqueta humana" vive aqui, en un
// solo archivo. Cuando el catalogo del Insight Engine crezca o se
// internacionalice, este es el unico punto que hay que actualizar.

// ------------------------------------------------------------------
// Titulos por Insight
// ------------------------------------------------------------------

const insightTitles: Record<InsightId, string> = {
  "activity-trend": "Tendencia de actividad",
  "exploration-trend": "Tendencia de exploración",
  "economy-focus": "Foco económico",
  "player-engagement": "Compromiso de jugadores",
};

/** Titulo humano del insight; fallback al id crudo si aparece uno nuevo. */
export function insightTitle(id: string): string {
  return (insightTitles as Record<string, string | undefined>)[id] ?? id;
}

// ------------------------------------------------------------------
// Categoria
// ------------------------------------------------------------------

const categoryLabels: Record<InsightCategory, string> = {
  activity: "Actividad",
  exploration: "Exploración",
  economy: "Economía",
  players: "Jugadores",
};

export function categoryLabel(category: string): string {
  return (
    (categoryLabels as Record<string, string | undefined>)[category] ??
    category
  );
}

// ------------------------------------------------------------------
// Severity — color semantico + etiqueta
// ------------------------------------------------------------------

export type SeverityTone = "success" | "info" | "warning" | "danger";

export interface SeverityView {
  label: string;
  tone: SeverityTone;
  /** BadgeVariant equivalente para representarla como Badge si se prefiere. */
  badgeVariant: BadgeVariant;
}

const severityViews: Record<Severity, SeverityView> = {
  normal: { label: "Normal", tone: "success", badgeVariant: "success" },
  low: { label: "Bajo", tone: "info", badgeVariant: "info" },
  high: { label: "Alto", tone: "warning", badgeVariant: "warning" },
  critical: { label: "Crítico", tone: "danger", badgeVariant: "danger" },
};

export function severityView(severity: Severity): SeverityView {
  return severityViews[severity];
}

// ------------------------------------------------------------------
// Confidence — como Badge (no como porcentaje, per requisitos D3)
// ------------------------------------------------------------------

export interface ConfidenceView {
  label: string;
  badgeVariant: BadgeVariant;
}

const confidenceViews: Record<Confidence, ConfidenceView> = {
  low: { label: "Confianza baja", badgeVariant: "neutral" },
  medium: { label: "Confianza media", badgeVariant: "info" },
  high: { label: "Confianza alta", badgeVariant: "success" },
};

export function confidenceView(confidence: Confidence): ConfidenceView {
  return confidenceViews[confidence];
}

// ------------------------------------------------------------------
// Fechas
// ------------------------------------------------------------------

// Zona horaria del navegador para no obligar al usuario a hacer
// aritmetica UTC. El sufijo se anota aparte para dejar claro que la
// hora esta en local (`hh:mm loc`) — evita ambiguedad con logs de API
// que siempre estan en UTC.

const dateFmt = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * Formatea un ISO a "d mmm yyyy, hh:mm" en la zona local del
 * navegador. Devuelve `iso` sin cambios si no parsea (defensivo).
 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return dateFmt.format(d);
}

// ------------------------------------------------------------------
// Facts (key/value genericos)
// ------------------------------------------------------------------

/**
 * `camelCase` -> `Title Case`. Ej: `currentEvents` -> "Current events".
 * Deliberadamente en ingles: los facts del Insight Engine ya vienen
 * en ingles (currentEvents, totalEventsRatio, dominantShare, etc.);
 * traducirlos requeria mapping per-insight, lo cual rompe la simetria
 * del contrato uniforme. Se traducen en D4+ si el proyecto lo pide.
 */
export function humanizeKey(key: string): string {
  const spaced = key.replace(/([A-Z])/g, " $1").toLowerCase().trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Convierte un valor arbitrario de `facts` a string presentable.
 * - numeros: se preservan
 * - strings: se preservan
 * - null / undefined -> "—" (unicode em-dash)
 * - objetos / arrays -> JSON compacto (raro, pero defensivo)
 */
export function formatFactValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    // Numeros con muchos decimales (ratios) se truncan a 3 significativos
    // para no romper el layout. Enteros se muestran tal cual.
    if (!Number.isFinite(value)) return String(value);
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(3).replace(/\.?0+$/, "");
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}
