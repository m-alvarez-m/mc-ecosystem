// Formateo temporal de B.1 (ADR-016 D3 · /players y /status).
//
// Bifurcación por umbral 24h:
//   - hace < 24h  → tiempo relativo español ("hace 3h 12m", "hace 45m")
//   - hace ≥ 24h  → fecha absoluta en America/Monterrey via Intl
//                   ("vier 8 nov a las 21:32")
//
// `now` inyectable: los tests fijan un reloj determinista
// (ADR-016 D6 anti-flakiness — cero dependencia de Date.now real).

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TZ = "America/Monterrey";

export function formatRelativeOrAbsolute(
  instant: Date,
  now: Date,
  timeZone: string = DEFAULT_TZ,
): string {
  const diffMs = now.getTime() - instant.getTime();
  if (diffMs < DAY_MS) {
    return formatRelative(diffMs);
  }
  return formatAbsolute(instant, timeZone);
}

export function formatRelative(diffMs: number): string {
  if (diffMs < 0) return "en el futuro";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `hace ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (remMin === 0) return `hace ${hours}h`;
  return `hace ${hours}h ${remMin}m`;
}

export function formatAbsolute(
  instant: Date,
  timeZone: string = DEFAULT_TZ,
): string {
  const dow = new Intl.DateTimeFormat("es-MX", {
    weekday: "short",
    timeZone,
  }).format(instant);
  const day = new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    timeZone,
  }).format(instant);
  const month = new Intl.DateTimeFormat("es-MX", {
    month: "short",
    timeZone,
  }).format(instant);
  const time = new Intl.DateTimeFormat("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(instant);
  const dowTrim = dow.replace(/\.$/, "");
  const monthTrim = month.replace(/\.$/, "");
  return `${dowTrim} ${day} ${monthTrim} a las ${time}`;
}

export function formatDurationMs(ms: number): string {
  if (ms < 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (hours < 24) {
    if (remMin === 0) return `${hours}h`;
    return `${hours}h ${remMin}m`;
  }
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  if (remH === 0) return `${days}d`;
  return `${days}d ${remH}h`;
}
