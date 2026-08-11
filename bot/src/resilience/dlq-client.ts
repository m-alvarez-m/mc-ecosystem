// DLQ client · POSTea entradas a la api (ADR-013 D5 + D8).
//
// El bot NO tiene acceso directo a Postgres (ADR-009 · API HTTP como
// única superficie). Este cliente mantiene esa invariante: llama a
// `POST /admin/dlq` de la API, que sí usa el rol mc_dlq.
//
// El endpoint devuelve 201 en éxito. La UNIQUE(event_uuid, reason)
// del schema neutraliza duplicados via `ON CONFLICT DO NOTHING` — el
// cliente NO trata 409/conflict como error, pero la api tampoco lo
// devuelve (el INSERT es no-op y responde 201).

import type { DlqReason, ErrorType } from "./types.js";

export interface DlqInsertRequest {
  event_id: string;
  event_uuid: string;
  event_type: string;
  event_payload: Record<string, unknown>;
  reason: DlqReason;
  error_type: ErrorType;
  error_message: string;
  attempts: number;
  first_failed_at: string; // ISO
  last_failed_at: string; // ISO
}

export interface DlqClientOptions {
  baseUrl: string;
  adminToken: string;
  /** Fetch inyectable — los tests pasan una implementación fake. */
  fetchImpl?: typeof fetch;
  /** Timeout HTTP en ms. Default 10_000. */
  timeoutMs?: number;
}

export class DlqClient {
  private readonly baseUrl: string;
  private readonly adminToken: string;
  private readonly doFetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: DlqClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.adminToken = opts.adminToken;
    this.doFetch = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  async insert(entry: DlqInsertRequest): Promise<void> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await this.doFetch(`${this.baseUrl}/admin/dlq`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Token": this.adminToken,
        },
        body: JSON.stringify(entry),
        signal: ac.signal,
      });
      if (!res.ok && res.status !== 201) {
        // 400/401/500 son fallos reales — el caller (executor
        // resiliente) los propaga para que el polling engine no
        // avance el cursor y reintente el batch entero.
        const text = await res.text().catch(() => "");
        throw new Error(`DLQ insert: HTTP ${res.status} ${text}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async countPending(): Promise<number> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await this.doFetch(`${this.baseUrl}/admin/dlq/pending-count`, {
        headers: { "X-Admin-Token": this.adminToken },
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`DLQ count: HTTP ${res.status}`);
      const body = (await res.json()) as { pending: number };
      return body.pending;
    } finally {
      clearTimeout(timer);
    }
  }
}
