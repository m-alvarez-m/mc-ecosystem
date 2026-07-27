import {
  HttpError,
  InvalidJsonError,
  NetworkError,
  TimeoutError,
  UnexpectedResponseError,
} from "./errors";
import type {
  EventRecord,
  GetEventsParams,
  GetEventsResponse,
} from "./types";

// Cliente HTTP del Event Store.
//
// Encapsula toda la comunicacion contra la api (ADR-009). Ninguna
// otra pieza del bot debe hacer fetch al Event Store: si se necesita
// una operacion nueva, se agrega aqui, no en el consumidor.
//
// Diseno:
// - fetch nativo de Node.js LTS (undici). Sin axios ni otras deps.
// - Timeout via AbortController; cancela la request si la api no
//   responde a tiempo.
// - fetch inyectable via options para tests (mock aislado, sin red).
// - Validacion runtime del schema de respuesta: si la api cambia el
//   contrato incompatiblemente, se detecta como UnexpectedResponseError
//   y no se propaga JSON malformado al consumidor.

export interface EventStoreClientOptions {
  /**
   * Base URL de la api (sin trailing slash necesario; se normaliza).
   * Ejemplos: "http://api:3000" en el compose network, o
   * "http://localhost:3000" en dev local.
   */
  baseUrl: string;

  /**
   * Timeout por request en milisegundos. Se cancela la request y se
   * lanza TimeoutError si la api tarda mas.
   */
  timeoutMs: number;

  /**
   * fetch inyectable para tests. En produccion se usa el global. Se
   * expone como option en lugar de import por dependency injection
   * pura: el test no necesita mockear el modulo global.
   */
  fetch?: typeof fetch;
}

export class EventStoreClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: EventStoreClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetch ?? fetch;
  }

  /**
   * GET /events con los parametros de ADR-010 (cursor por `id`,
   * limit, filtro por tipos).
   *
   * Contrato de errores (todos derivan de EventStoreError):
   * - TimeoutError: no hubo respuesta antes de timeoutMs.
   * - NetworkError: fallo previo a recibir status (DNS, conexion, TLS).
   * - HttpError: la api respondio 4xx/5xx.
   * - InvalidJsonError: la respuesta no era JSON parseable.
   * - UnexpectedResponseError: el JSON no cumple el schema esperado.
   */
  async getEvents(params: GetEventsParams = {}): Promise<GetEventsResponse> {
    const url = new URL(`${this.baseUrl}/events`);
    if (params.after_id !== undefined) {
      url.searchParams.set("after_id", params.after_id);
    }
    if (params.limit !== undefined) {
      url.searchParams.set("limit", String(params.limit));
    }
    if (params.types !== undefined && params.types.length > 0) {
      url.searchParams.set("types", params.types.join(","));
    }

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
      // fetch nativo emite AbortError (name === "AbortError") cuando
      // el signal se cancela. El resto son fallos de red.
      if (err instanceof Error && err.name === "AbortError") {
        throw new TimeoutError(this.timeoutMs, { cause: err });
      }
      const message = err instanceof Error ? err.message : String(err);
      const cause = err instanceof Error ? err : undefined;
      throw new NetworkError(message, cause ? { cause } : undefined);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // Leemos el body para el mensaje de error (util al depurar). Si
      // la lectura misma falla, degradamos a string vacio: el status
      // ya es suficiente para clasificar el error.
      const body = await response.text().catch(() => "");
      throw new HttpError(response.status, body);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const cause = err instanceof Error ? err : undefined;
      throw new InvalidJsonError(message, cause ? { cause } : undefined);
    }

    return validateGetEventsResponse(payload);
  }
}

// --------------------------------------------------------------------
// Validacion runtime del schema
// --------------------------------------------------------------------
// Type guards manuales sobre `unknown`. Alternativas: zod, io-ts,
// ajv. Se prefiere manual aqui por: (a) evita dependencia extra en el
// bootstrap, (b) el schema es pequeno y estable, (c) los errores son
// mas explicativos con validacion custom que con mensajes genericos
// de una libreria.

function validateGetEventsResponse(payload: unknown): GetEventsResponse {
  if (!isObject(payload)) {
    throw new UnexpectedResponseError("la respuesta no es un objeto");
  }

  const rawEvents = payload["events"];
  if (!Array.isArray(rawEvents)) {
    throw new UnexpectedResponseError("`events` no es un array");
  }

  const events: EventRecord[] = [];
  for (let i = 0; i < rawEvents.length; i++) {
    const raw = rawEvents[i];
    if (!isEventRecord(raw)) {
      throw new UnexpectedResponseError(`events[${i}] no cumple el schema del catalogo`);
    }
    events.push(raw);
  }

  const rawLastId = payload["last_id"];
  if (rawLastId !== null && typeof rawLastId !== "string") {
    throw new UnexpectedResponseError("`last_id` no es string ni null");
  }

  return { events, last_id: rawLastId };
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isEventRecord(x: unknown): x is EventRecord {
  if (!isObject(x)) return false;

  return (
    typeof x["id"] === "string" &&
    typeof x["event_uuid"] === "string" &&
    typeof x["type"] === "string" &&
    typeof x["v"] === "number" &&
    typeof x["ts"] === "string" &&
    typeof x["received_at"] === "string" &&
    (x["player_uuid"] === null || typeof x["player_uuid"] === "string") &&
    (x["world"] === null || typeof x["world"] === "string") &&
    (x["x"] === null || typeof x["x"] === "number") &&
    (x["y"] === null || typeof x["y"] === "number") &&
    (x["z"] === null || typeof x["z"] === "number") &&
    isObject(x["data"])
  );
}
