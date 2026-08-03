import { useState } from "react";
import { useInsights } from "../hooks/useInsights";

// Home · proof-of-life de D1.
//
// Renderiza el JSON crudo de /insight/insights sin estilos, tablas,
// ni componentes. Prueba solo la cadena completa:
//   Browser -> nginx (/api/*) -> API -> Insight Engine -> JSON
//
// Ventana temporal: desde ADR-007 (cutoff oficial del mundo real,
// 2026-07-26T23:25:52Z) hasta el instante del PRIMER render (fijado
// via useState inicializador → estable entre renders y compatible
// con StrictMode). Sin esto, `new Date().toISOString()` en el cuerpo
// del componente re-computa en cada render y TanStack Query dispara
// una query nueva por cada uno (queryKey distinto) — loop infinito.

const CUTOFF_ISO = "2026-07-26T23:25:52Z";

export function Home() {
  const [to] = useState(() => new Date().toISOString());
  const query = useInsights({ from: CUTOFF_ISO, to });

  if (query.isLoading) {
    return <pre>Cargando insights…</pre>;
  }
  if (query.isError) {
    return <pre>Error: {String(query.error)}</pre>;
  }
  return <pre>{JSON.stringify(query.data, null, 2)}</pre>;
}
