// Crónicas de Boss (T11 v1.1).
//
// Convierte los eventos `boss.kill` en crónicas de batalla del
// servidor. A diferencia de Server Chronicle (T10, hitos históricos
// server-first) y Death Chronicle (T8, per-death per-player), aquí
// narramos el ACONTECIMIENTO — una batalla concreta con
// participantes concretos. Cada Wither derrotado es un evento
// distinto; el catálogo elige una variante y adjunta la lista de
// participantes.
//
// Reglas del producto:
//   1. Fidelidad al evento: nunca inventa bosses ni participantes.
//   2. Tono épico contenido: "cayó", "derrotado", "batalla" — sin
//      exageración innecesaria.
//   3. Los participantes se listan aparte del narrador (sección
//      "Participaron:") con tope de 5 + "... y N más." si sobra.
//
// Extensibilidad: añadir un boss nuevo = (a) añadir su clave a
// `BossCategory` y a `VARIANTS`; (b) mapear su nombre canónico en
// `BOSS_TO_CATEGORY`. Bosses no reconocidos caen en el fallback.

/**
 * Entrada del narrador.
 *
 * `participants` viene ya resuelto a nombres canónicos (el handler
 * llama al PlayerNameResolver); el catálogo no hace IO ni conoce
 * UUIDs. `extraCount` es el número de participantes que se
 * omitieron del listado por exceder el tope de 5 (0 si todos caben).
 */
export interface BossKillInput {
  /** Identificador del boss emitido por el plugin (`"wither"` / `"ender_dragon"` / futuros). */
  readonly boss: string;
  /**
   * Nombres canónicos ya resueltos de los primeros N participantes
   * (N ≤ 5). El handler garantiza el orden estable de `data.participants`.
   * Puede ser array vacío — el plugin envía `participants: []` cuando
   * el boss cae sin jugadores dentro de 128 blk.
   */
  readonly participants: readonly string[];
  /**
   * Cantidad de participantes que exceden el tope de listado. 0 si
   * `data.participants.length <= 5`.
   */
  readonly extraCount: number;
}

/**
 * Categorías reconocidas por el catálogo — 1:1 con los `boss` que hoy
 * emite `ProgressListener.onBossDeath` (ver plugin).
 */
type BossCategory = "wither" | "ender_dragon";

/** Función de variante: narración pura sin datos externos. */
type Variant = () => string;

// --------------------------------------------------------------------
// Catálogo narrativo
// --------------------------------------------------------------------

const WITHER: readonly Variant[] = [
  () => "☠️ El Wither finalmente cayó.",
  () => "☠️ El caos terminó.",
  () => "☠️ Una amenaza menos para el servidor.",
  () => "☠️ El primer monstruo definitivo fue derrotado.",
  () => "☠️ El Wither dejó de ser un problema.",
  () => "☠️ La oscuridad fue contenida.",
];

const ENDER_DRAGON: readonly Variant[] = [
  () => "🐉 El Dragón del End fue derrotado.",
  () => "🐉 El cielo del End quedó en silencio.",
  () => "🐉 Una era acaba de terminar.",
  () => "🐉 El enemigo final cayó.",
  () => "🐉 El End jamás volverá a ser el mismo.",
  () => "🐉 La batalla terminó con victoria.",
];

const VARIANTS: Readonly<Record<BossCategory, readonly Variant[]>> = {
  wither: WITHER,
  ender_dragon: ENDER_DRAGON,
};

// --------------------------------------------------------------------
// Clasificación: raw `boss` del plugin → categoría del catálogo
// --------------------------------------------------------------------

const BOSS_TO_CATEGORY: ReadonlyMap<string, BossCategory> = new Map<
  string,
  BossCategory
>([
  ["wither", "wither"],
  ["ender_dragon", "ender_dragon"],
]);

function classify(boss: string): BossCategory | null {
  return BOSS_TO_CATEGORY.get(boss) ?? null;
}

// --------------------------------------------------------------------
// Selección aleatoria de variante
// --------------------------------------------------------------------

function pickVariant(variants: readonly Variant[]): Variant {
  const idx = Math.floor(Math.random() * variants.length);
  return variants[idx]!;
}

// --------------------------------------------------------------------
// Formato del bloque de participantes
// --------------------------------------------------------------------

/**
 * Devuelve la sección "Participaron:" con hasta N nombres + cola
 * "... y X más." si aplicaba truncar. Devuelve `null` si no hay
 * participantes que mostrar — el handler debe omitir la sección
 * en ese caso.
 */
function formatParticipantsSection(
  names: readonly string[],
  extraCount: number,
): string | null {
  if (names.length === 0) {
    return null;
  }
  const lines: string[] = ["Participaron:"];
  for (const name of names) {
    lines.push(`• ${name}`);
  }
  if (extraCount > 0) {
    lines.push(`... y ${extraCount} más.`);
  }
  return lines.join("\n");
}

// --------------------------------------------------------------------
// API pública
// --------------------------------------------------------------------

/**
 * Devuelve el body final a publicar como embed de un `boss.kill`.
 * Contrato:
 *
 *   - Si `boss` es reconocido → una variante del pool + (si aplica)
 *     sección "Participaron:" separada por línea en blanco.
 *   - Si no → fallback "⚔️ Un gran enemigo fue derrotado: <boss>."
 *     + (si aplica) sección de participantes.
 *
 * Nunca falla, nunca pierde información.
 */
export function narrateBossKill(input: BossKillInput): string {
  const category = classify(input.boss);
  const narrative =
    category !== null
      ? pickVariant(VARIANTS[category])()
      : `⚔️ Un gran enemigo fue derrotado: ${input.boss}.`;

  const participants = formatParticipantsSection(
    input.participants,
    input.extraCount,
  );
  if (participants === null) {
    return narrative;
  }
  return `${narrative}\n\n${participants}`;
}

// --------------------------------------------------------------------
// Introspección para tests
// --------------------------------------------------------------------

export const _INTERNAL = {
  VARIANTS,
  BOSS_TO_CATEGORY,
} as const;
