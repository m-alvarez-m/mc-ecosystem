import type { Publisher } from "../publisher";

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
// v1: solo `publisher`. Sin logger, sin metricas, sin clock, sin
// config, sin nada mas. Cuando aparezcan casos reales que justifiquen
// nuevos campos (metricas para observabilidad, clock inyectable para
// tests deterministas de tiempo, etc.) se anaden aqui con racional
// en el commit correspondiente.

export interface DispatchContext {
  publisher: Publisher;
}
