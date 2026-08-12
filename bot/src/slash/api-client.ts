// Cliente HTTP mínimo para los endpoints usados por los slash
// commands de B.1 (ADR-016 · ADR-009 disciplina "bot → api, nunca
// bot → DB").
//
// Endpoints:
//   - GET /players/online          (nuevo, sin auth)
//   - GET /events/latest_by_type   (nuevo, sin auth)
//   - GET /events/latest_id        (ya existente)
//
// Diseño: `fetch` inyectable para tests (mismo patrón que
// EventStoreClient); timeout por AbortController; errores tipados
// para que el handler pueda distinguir "api down" vs "shape
// inesperado".

export interface OnlinePlayer {
  uuid: string;
  name: string;
  session_start_ts: string;
}

export interface LatestByTypeEvent {
  id: string;
  event_uuid: string;
  type: string;
  v: number;
  ts: string;
  received_at: string;
  player_uuid: string | null;
  world: string | null;
  x: number | null;
  y: number | null;
  z: number | null;
  data: Record<string, unknown>;
}

export class SlashApiError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SlashApiError";
  }
}

export interface SlashApiClientOptions {
  baseUrl: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

export class SlashApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SlashApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async getPlayersOnline(): Promise<OnlinePlayer[]> {
    const payload = await this.getJson<{ players: OnlinePlayer[] }>(
      `${this.baseUrl}/players/online`,
    );
    if (!Array.isArray(payload.players)) {
      throw new SlashApiError("/players/online: shape inesperado (players no es array)");
    }
    return payload.players;
  }

  async getLatestByType(
    type: string,
    limit = 1,
  ): Promise<LatestByTypeEvent[]> {
    const url = new URL(`${this.baseUrl}/events/latest_by_type`);
    url.searchParams.set("type", type);
    url.searchParams.set("limit", String(limit));
    const payload = await this.getJson<{ events: LatestByTypeEvent[] }>(
      url.toString(),
    );
    if (!Array.isArray(payload.events)) {
      throw new SlashApiError("/events/latest_by_type: shape inesperado (events no es array)");
    }
    return payload.events;
  }

  async getLatestEventId(): Promise<string | null> {
    const payload = await this.getJson<{ latest_id: string | null }>(
      `${this.baseUrl}/events/latest_id`,
    );
    return payload.latest_id ?? null;
  }

  private async getJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (err: unknown) {
      throw new SlashApiError(
        err instanceof Error ? err.message : String(err),
        err,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new SlashApiError(`HTTP ${response.status}: ${body}`);
    }
    try {
      return (await response.json()) as T;
    } catch (err) {
      throw new SlashApiError(
        err instanceof Error ? err.message : String(err),
        err,
      );
    }
  }
}
