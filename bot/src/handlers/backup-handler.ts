import type { EventHandler } from "../dispatcher";
import type { DispatchContext } from "../context";
import type { EventRecord } from "../eventstore";

// BackupHandler: publica el resultado de un backup del servidor.
//
// Consume tres campos REQUERIDOS del payload:
// - `data.kind`: tipo de respaldo (p. ej. "world", "db").
// - `data.size_mb`: tamano en megabytes (entero).
// - `data.ok`: si el proceso termino correctamente (boolean).
//
// El title es fijo ("Respaldo completado") y describe que el ciclo
// de backup TERMINO — no que fue exitoso. El resultado real (exito
// o fallo) viaja en el body, junto con tipo y tamano. No se
// interpreta ni transforma nada mas alla de eso.

const EVENT_TYPE = "backup.done";

const TITLE = "Respaldo completado";

/**
 * Error del handler cuando el payload de server.backup no cumple el
 * schema esperado. `reason` describe cual campo fallo (util para
 * debugging sin necesidad de reproducir el evento).
 */
export class InvalidBackupPayloadError extends Error {
  readonly code = "INVALID_BACKUP_PAYLOAD";

  constructor(
    public readonly eventUuid: string,
    public readonly reason: string,
  ) {
    super(
      `backup.done con payload invalido (${reason}, event_uuid=${eventUuid})`,
    );
    this.name = "InvalidBackupPayloadError";
  }
}

export class BackupHandler implements EventHandler {
  supports(eventType: string): boolean {
    return eventType === EVENT_TYPE;
  }

  async handle(context: DispatchContext, event: EventRecord): Promise<void> {
    const { kind, sizeMb, ok } = extractBackupFields(event);
    const estado = ok ? "exitoso" : "fallido";

    await context.publisher.publish({
      title: TITLE,
      body: `Tipo: ${kind}. Tamaño: ${String(sizeMb)} MB. Estado: ${estado}.`,
    });
  }
}

interface BackupFields {
  kind: string;
  sizeMb: number;
  ok: boolean;
}

/**
 * Extrae y valida los tres campos requeridos. Todos deben existir con
 * el tipo correcto. Politica de validacion:
 * - `kind`: string no vacio (trimeado). Identificador.
 * - `size_mb`: entero finito (Number.isFinite + Number.isInteger).
 *   Aceptamos negativos por si algun productor los emite; no es
 *   nuestra funcion clasificar valores sensatos vs raros.
 * - `ok`: boolean estricto (typeof === "boolean"). Coerciones
 *   silenciosas (truthy strings, 0/1) se rechazan — el evento debe
 *   ser explicito.
 */
function extractBackupFields(event: EventRecord): BackupFields {
  const rawKind = event.data["kind"];
  if (typeof rawKind !== "string" || rawKind.trim().length === 0) {
    throw new InvalidBackupPayloadError(
      event.event_uuid,
      "data.kind faltante o no es string no vacio",
    );
  }

  const rawSize = event.data["size_mb"];
  if (
    typeof rawSize !== "number" ||
    !Number.isFinite(rawSize) ||
    !Number.isInteger(rawSize)
  ) {
    throw new InvalidBackupPayloadError(
      event.event_uuid,
      "data.size_mb faltante o no es entero finito",
    );
  }

  const rawOk = event.data["ok"];
  if (typeof rawOk !== "boolean") {
    throw new InvalidBackupPayloadError(
      event.event_uuid,
      "data.ok faltante o no es boolean",
    );
  }

  return { kind: rawKind.trim(), sizeMb: rawSize, ok: rawOk };
}
