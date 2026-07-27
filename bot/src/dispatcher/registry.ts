import type { EventHandler } from "./handler";
import { DuplicateHandlerError, InvalidHandlerError } from "./errors";

// Registro interno del dispatcher: mantiene el mapping
// eventType -> handler. Extraido en su propio modulo para separar la
// responsabilidad de "mantener la tabla" de "iterar y enrutar el
// lote" (esta ultima vive en dispatcher.ts).
//
// Estructura: Map<string, EventHandler>. Lookup O(1), sin cadenas de
// if ni switch. No expone iteracion sobre handlers para no invitar a
// consumidores a inspeccionar el estado interno.

export class HandlerRegistry {
  private readonly handlers = new Map<string, EventHandler>();

  /**
   * Registra `handler` bajo `eventType`. Rechaza:
   * - un handler que no cumple la interfaz EventHandler (typeof check
   *   defensivo sobre `.supports` y `.handle`);
   * - un handler cuyo supports() devuelve false sobre `eventType`
   *   (guardra contra typos: registrar SessionStartHandler bajo
   *   "sesion.start" cuando el tipo real es "session.start" se detecta
   *   aqui si supports() esta bien implementado);
   * - un `eventType` que ya tiene handler registrado (ver
   *   DuplicateHandlerError para el racional).
   */
  register(eventType: string, handler: EventHandler): void {
    if (
      typeof handler !== "object" ||
      handler === null ||
      typeof handler.supports !== "function" ||
      typeof handler.handle !== "function"
    ) {
      throw new InvalidHandlerError("el objeto no implementa {supports, handle}");
    }
    if (!handler.supports(eventType)) {
      throw new InvalidHandlerError(
        `el handler no soporta el tipo "${eventType}" segun su supports()`,
      );
    }
    if (this.handlers.has(eventType)) {
      throw new DuplicateHandlerError(eventType);
    }
    this.handlers.set(eventType, handler);
  }

  /**
   * Elimina el handler asociado a `eventType`. Devuelve true si habia
   * uno registrado, false si no habia nada que quitar (idempotente).
   */
  unregister(eventType: string): boolean {
    return this.handlers.delete(eventType);
  }

  /** Vacia el registro por completo. Util en shutdown o tests. */
  clear(): void {
    this.handlers.clear();
  }

  /**
   * Localiza el handler para `eventType`, o undefined si no hay
   * ninguno registrado. Metodo primario que consume el dispatcher.
   */
  find(eventType: string): EventHandler | undefined {
    return this.handlers.get(eventType);
  }

  /** Cantidad de handlers registrados. Util para tests y sanity checks. */
  size(): number {
    return this.handlers.size;
  }
}
