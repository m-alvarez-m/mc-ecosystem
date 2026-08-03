// Formatter numérico del SummaryDashboard (D4).
//
// Los conteos del Insight Engine viajan como STRING (BIGINT-safe:
// `totalEvents`, `totalPlayers`, etc.). Un Number.parse ingenuo
// perdería precisión más allá de 2^53. Se parsea a BigInt y se pasa
// a Intl.NumberFormat, que sí acepta BigInt como entrada.
//
// El formatter es defensivo:
//   - null / undefined → em-dash "—"
//   - strings no numéricas → se devuelven tal cual
//   - números ordinarios (Number) → grouping normal

// useGrouping="always" fuerza separador de miles incluso en numeros
// de 4 digitos. Sin esto, la regla RAE del `es-ES` deja "1234" sin
// puntuar (agrupa solo desde 5 digitos: "12.345"). Preferimos
// grouping consistente para que un KPI no cambie de forma cuando
// cruza el umbral de 10000.
const groupFmt = new Intl.NumberFormat("es-ES", { useGrouping: "always" });

export function formatCount(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    return Number.isFinite(value) ? groupFmt.format(value) : String(value);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return "—";
  if (!/^-?\d+$/.test(trimmed)) return trimmed;
  try {
    return groupFmt.format(BigInt(trimmed));
  } catch {
    return trimmed;
  }
}
