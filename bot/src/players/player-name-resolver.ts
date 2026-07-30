import {
  PlayerLookupHttpError,
  PlayerLookupInvalidJsonError,
  PlayerLookupNetworkError,
  PlayerLookupTimeoutError,
  PlayerLookupUnexpectedResponseError,
  PlayerNotFoundError,
} from "./errors";

// PlayerNameResolver: resuelve player_uuid → nombre canonico via
// GET /players/:uuid del api del ecosistema.
//
// Diseno (aprobado en Etapa 4):
// - Cache in-memory por instancia del proceso. Sin TTL, sin
//   expiracion. En modo offline (ADR-001) el UUID es funcion
//   deterministica del nombre → cache jamas queda stale.
// - Lazy loading: primera consulta hace HTTP, guarda en cache;
//   siguientes consultas del mismo uuid devuelven cache sin red.
// - Sin negative cache: un 404 se propaga en cada llamada. Cuando el
//   jugador se loguee, el api lo persiste y el proximo lookup del
//   mismo uuid ya devolvera nombre.
// - Sin prefetch, sin warm-up, sin bulk fetch.
// - Sin retries, sin circuit breaker, sin fallback a UUID: el caller
//   decide que hacer con el error.
// - Sin config nueva: reusa API_BASE_URL + HTTP_TIMEOUT_MS ya cargados
//   en Config para el EventStoreClient.
//
// La superficie publica es una unica clase con `resolve(uuid)`.
// Errores tipados en ./errors, todos con `.code` estable.

export interface PlayerNameResolverOptions {
  /**
   * Base URL de la api (sin trailing slash necesario; se normaliza).
   * Misma URL que usa EventStoreClient — resuelve UUID contra el
   * mismo servicio que sirve los eventos.
   */
  baseUrl: string;

  /**
   * Timeout por request en milisegundos. Se cancela la request y se
   * lanza PlayerLookupTimeoutError si la api tarda mas.
   */
  timeoutMs: number;

  /**
   * fetch inyectable para tests. En produccion se usa el global.
   * Mismo patron que EventStoreClient (ADR-005 §3.16 del handoff).
   */
  fetch?: typeof fetch;
}

export class PlayerNameResolver {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly cache = new Map<string, string>();

  constructor(options: PlayerNameResolverOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetch ?? fetch;
  }

  /**
   * Devuelve el nombre canonico del jugador cuyo `uuid` se indica.
   *
   * Primer lookup: HTTP GET a la api, guarda en cache y devuelve.
   * Lookups posteriores del mismo uuid: cache hit, sin red.
   *
   * Errores (todos derivan de PlayerNameResolverError):
   * - PlayerNotFoundError: api respondio 404.
   * - PlayerLookupTimeoutError: la api no respondio a tiempo.
   * - PlayerLookupNetworkError: fallo previo a respuesta (DNS, conn).
   * - PlayerLookupHttpError: 4xx/5xx distinto de 404.
   * - PlayerLookupInvalidJsonError: respuesta no era JSON parseable.
   * - PlayerLookupUnexpectedResponseError: JSON sin `name` string.
   */
  async resolve(uuid: string): Promise<string> {
    const cached = this.cache.get(uuid);
    if (cached !== undefined) {
      return cached;
    }
    const name = await this.fetchName(uuid);
    this.cache.set(uuid, name);
    return name;
  }

  private async fetchName(uuid: string): Promise<string> {
    const url = `${this.baseUrl}/players/${encodeURIComponent(uuid)}`;
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
      if (err instanceof Error && err.name === "AbortError") {
        throw new PlayerLookupTimeoutError(uuid, this.timeoutMs, { cause: err });
      }
      const message = err instanceof Error ? err.message : String(err);
      const cause = err instanceof Error ? err : undefined;
      throw new PlayerLookupNetworkError(
        uuid,
        message,
        cause ? { cause } : undefined,
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 404) {
      throw new PlayerNotFoundError(uuid);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new PlayerLookupHttpError(uuid, response.status, body);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const cause = err instanceof Error ? err : undefined;
      throw new PlayerLookupInvalidJsonError(
        uuid,
        message,
        cause ? { cause } : undefined,
      );
    }

    if (!isObject(payload)) {
      throw new PlayerLookupUnexpectedResponseError(uuid, "no es un objeto");
    }
    const name = payload["name"];
    if (typeof name !== "string" || name.length === 0) {
      throw new PlayerLookupUnexpectedResponseError(
        uuid,
        "campo `name` ausente, no-string o vacio",
      );
    }
    return name;
  }
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
