// Helper minimo para concatenar className. Sustituye a la libreria
// `clsx` porque:
//   - solo necesitamos strings condicionales
//   - <300 bytes, sin dependencias
//   - tipos estrictos: rechaza undefined implicito.
//
// Acepta strings, undefined y false (patron condicional idiomatico
// `flag && "class"`). Filtra falsy y espacia el resto.

export type ClassValue = string | false | undefined | null;

export function cn(...values: ClassValue[]): string {
  return values.filter((v): v is string => typeof v === "string").join(" ");
}
