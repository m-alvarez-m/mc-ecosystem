// Icono placeholder sin librerias externas (D2 no instala nada de
// iconos). Cuadrado con el borde y centro del color actual — sirve
// hasta que se elija una libreria o se pinte set propio.
//
// El SVG hereda color via `currentColor` para que el consumidor lo
// tinte via `color` en el contenedor (patron estandar).

export interface PlaceholderIconProps {
  size?: number;
  title?: string;
}

export function PlaceholderIcon({
  size = 16,
  title,
}: PlaceholderIconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      role={title !== undefined ? "img" : undefined}
      aria-hidden={title === undefined}
      aria-label={title}
    >
      {title !== undefined ? <title>{title}</title> : null}
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}
