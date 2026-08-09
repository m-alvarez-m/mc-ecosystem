// Pool dedicado al prune. Se conecta como `mc_pruner` (ADR-012 D2 ·
// least privilege): SELECT + DELETE en events, SELECT+INSERT+UPDATE
// en events_archive_log. Distinto del pool general (mc_app) para
// preservar la garantía append-only del ADR-009 sobre la identidad
// que sirve el resto de la API.
//
// Si DATABASE_URL_PRUNE no está definida el módulo NO se instancia y
// el orquestador falla al arrancar el cron/endpoint — deliberado:
// preferimos error visible a un fallback silencioso a mc_app.

import { Pool } from "pg";

export function createPrunePool(url = process.env.DATABASE_URL_PRUNE): Pool {
  if (!url) {
    throw new Error("DATABASE_URL_PRUNE no definida (ADR-012 requiere rol mc_pruner separado)");
  }
  return new Pool({ connectionString: url });
}
