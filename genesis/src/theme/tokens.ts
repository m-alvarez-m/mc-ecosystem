// Design tokens de Genesis (D2 · Design System foundation).
//
// Fuente unica de verdad de TODOS los valores visuales. Cada token
// se expone tambien como CSS custom property en `theme.css` para que
// los CSS Modules de componentes lo consuman sin re-declarar valores.
//
// Regla no negociable: ningun componente hardcodea un color, spacing,
// radius, tamaño de fuente, tiempo o z-index — todo viene de aqui.
// Cambios de identidad visual futuros se hacen en este archivo y en
// theme.css, no en los componentes.
//
// Los valores de la v1 son intencionalmente neutrales (paleta que
// cumple contraste WCAG AA sobre background/surface, sin buscar
// todavia identidad grafica final).

// ------------------------------------------------------------------
// Colores
// ------------------------------------------------------------------

// Escala neutral (gris azulado). 50 = casi blanco, 900 = casi negro.
// Se usa para background, surface, border, text-muted y estados
// intermedios. Cualquier gris del proyecto sale de aqui.
const neutral = {
  50: "#f7f8fa",
  100: "#eef0f4",
  200: "#e2e5eb",
  300: "#c9cfd8",
  400: "#9aa3b1",
  500: "#6b7280",
  600: "#4b5563",
  700: "#374151",
  800: "#1f2937",
  900: "#111827",
} as const;

// Semanticos v1. Elegidos por contraste sobre neutral-50 (background)
// y neutral-100 (surface elevada); cada uno tiene su bg suave.
const semantic = {
  primary: "#2563eb",       // azul (info/acciones primarias)
  primaryHover: "#1d4ed8",
  success: "#16a34a",
  warning: "#d97706",
  danger: "#dc2626",
  info: "#0ea5e9",
} as const;

// Roles de superficie / texto / borde. Se derivan de neutral.
const roles = {
  background: neutral[50],   // superficie base (body)
  surface: "#ffffff",        // tarjetas, contenedores elevados
  surfaceMuted: neutral[100],
  border: neutral[200],
  borderStrong: neutral[300],
  text: neutral[900],
  textMuted: neutral[600],
  textInverse: "#ffffff",
  focusRing: semantic.primary,
} as const;

export const colors = {
  neutral,
  semantic,
  ...roles,
} as const;

// ------------------------------------------------------------------
// Spacing (escala 4 → 64)
// ------------------------------------------------------------------
// Escala fija (no lineal). Todo padding/margin/gap del proyecto usa
// una de estas claves — evita valores "de compromiso" tipo 13px que
// generan drift visual con el tiempo.
export const spacing = {
  0: "0",
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
  8: "32px",
  10: "40px",
  12: "48px",
  16: "64px",
} as const;

export type SpacingKey = keyof typeof spacing;

// ------------------------------------------------------------------
// Radius
// ------------------------------------------------------------------
export const radius = {
  none: "0",
  sm: "4px",
  md: "8px",
  lg: "12px",
  full: "9999px",
} as const;

// ------------------------------------------------------------------
// Typography
// ------------------------------------------------------------------
export const typography = {
  fontFamily: {
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  },
  fontSize: {
    xs: "12px",
    sm: "14px",
    md: "16px",
    lg: "18px",
    xl: "20px",
    "2xl": "24px",
    "3xl": "30px",
  },
  fontWeight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.75,
  },
} as const;

export type FontSizeKey = keyof typeof typography.fontSize;
export type FontWeightKey = keyof typeof typography.fontWeight;

// ------------------------------------------------------------------
// zIndex
// ------------------------------------------------------------------
// Nombrado por rol para que un cambio en una capa no requiera
// negociar numeros magicos con el resto.
export const zIndex = {
  base: 0,
  content: 1,
  header: 10,
  overlay: 50,
  modal: 100,
  toast: 200,
} as const;

// ------------------------------------------------------------------
// Transitions
// ------------------------------------------------------------------
export const transitions = {
  duration: {
    fast: "120ms",
    normal: "180ms",
    slow: "240ms",
  },
  easing: {
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    emphasized: "cubic-bezier(0.2, 0, 0, 1.2)",
  },
} as const;

// ------------------------------------------------------------------
// Breakpoints
// ------------------------------------------------------------------
// Desktop-first pero soportando desde 480. Cada breakpoint es el
// ancho MINIMO al que aplica (`min-width`). No hay `max-width` porque
// desktop-first suele leerse mejor con reglas por tamaño mayor.
export const breakpoints = {
  xs: "480px",
  sm: "768px",
  md: "1024px",
  lg: "1280px",
} as const;

export type BreakpointKey = keyof typeof breakpoints;

// Helpers para usar en CSS-in-JS futuro (no en D2). Se exportan por
// completitud, coste cero.
export const media = {
  xs: `(min-width: ${breakpoints.xs})`,
  sm: `(min-width: ${breakpoints.sm})`,
  md: `(min-width: ${breakpoints.md})`,
  lg: `(min-width: ${breakpoints.lg})`,
} as const;

// ------------------------------------------------------------------
// Bundle unificado
// ------------------------------------------------------------------
export const tokens = {
  colors,
  spacing,
  radius,
  typography,
  zIndex,
  transitions,
  breakpoints,
  media,
} as const;

export type Tokens = typeof tokens;
