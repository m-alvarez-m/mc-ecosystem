import type { Publisher } from "../publisher";
import type { PlayerNameResolver } from "../players";

// Contexto compartido que el dispatcher entrega a cada handler.
//
// Agrupa los servicios disponibles para la logica de un handler.
// Diseno para crecer sin romper:
// - Extender el contexto anadiendo campos NUEVOS (opcionales o
//   requeridos) es seguro: handlers existentes ignoran lo que no
//   consumen.
// - Cambiar el TIPO de un campo existente rompe handlers. Cuando
//   ocurra, tratarlo como cambio arquitectonico y documentar via
//   ADR + commit propio.
//
// v1.1:
// - `publisher`: sink de mensajes (Discord u otro).
// - `playerNameResolver`: unica via de resolucion UUID → nombre.
//   Anadido para desbloquear los 5 handlers de player (Etapa 4 del
//   plan P0-2). Los handlers de server / tps / backup no lo consumen
//   pero lo reciben igual: es responsabilidad del handler acceder solo
//   a los campos que necesita.

export interface DispatchContext {
  publisher: Publisher;
  playerNameResolver: PlayerNameResolver;
}
