// Pool dedicado al rol mc_dlq (ADR-013 D5 · least privilege).
//
// Distinto del pool general (mc_app) para preservar la separación
// SELECT-only de mc_app sobre dead_letter_events. mc_dlq puede
// SELECT + INSERT + UPDATE de dead_letter_events; no puede DELETE
// (retención infinita del D7).
//
// Si DATABASE_URL_DLQ no está definida, el módulo NO se instancia y
// el orquestador de la api NO registra los endpoints — deliberado
// (preferimos endpoints ausentes a un fallback silencioso al pool
// principal, que no tiene los privilegios adecuados).

import { Pool } from "pg";

export function createDlqPool(url = process.env.DATABASE_URL_DLQ): Pool {
  if (!url) {
    throw new Error("DATABASE_URL_DLQ no definida (ADR-013 requiere rol mc_dlq separado)");
  }
  return new Pool({ connectionString: url });
}
