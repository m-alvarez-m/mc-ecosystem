# ADR-002: Versión de nacimiento del mundo real — Paper 26.1.2

- **Fecha**: 2026-07-16
- **Estado**: aceptado

## Contexto

CoreProtect 24.0 (nuestra herramienta de auditoría anti-grief, ver ADR-001)
tiene chequeo duro de versión y rechaza Minecraft 26.2; su versión más nueva
soporta hasta 26.1.2. Lo comprobamos en staging: el plugin se deshabilita
solo al arrancar en 26.2 ("Minecraft 26.2 is not supported").

Los mundos de Minecraft **solo migran hacia adelante**: subir de versión
conserva el mundo; bajar no es posible (nos costó regenerar el mundo de
staging el 2026-07-16).

## Decisión

1. El mundo real (producción) **nace en Paper 26.1.2**: la versión más nueva
   que TODAS nuestras herramientas soportan. Nunca se estrena un mundo en una
   versión que obligaría a elegir entre bajar (imposible) o jugar sin
   auditoría.
2. Cuando CoreProtect publique soporte para 26.2 (o la versión vigente que
   sea), **subimos**: el mundo migra hacia adelante sin pérdida.
3. Toda subida de versión se **prueba primero en staging** (mismo
   procedimiento del runbook: cambiar `VERSION` del compose + URLs de
   plugins, verificar los tres plugins en verde y el pipeline de eventos)
   antes de tocar producción. Y backup completo antes de migrar.

## Consecuencias

- La versión del servidor la marca el plugin MÁS lento en actualizar
  (hoy: CoreProtect), no la última versión de Minecraft.
- Hay que vigilar activamente los releases de CoreProtect (tarea recurrente
  semanal en el runbook) para no quedarnos atrás sin darnos cuenta.
- El `api-version` del plugin EventCollector se mantiene en la versión mínima
  soportada (26.1) para que un mismo jar sirva en staging y producción.
