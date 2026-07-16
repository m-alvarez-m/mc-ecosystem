# ADR-001: Modo offline con AuthMe y whitelist obligatoria

- **Fecha**: 2026-07-16
- **Estado**: aceptado

## Contexto

No todos los jugadores de la comunidad tienen cuenta premium de Minecraft. Con
`online-mode=true` (verificación contra Mojang) esos jugadores no pueden entrar.

## Decisión

1. El servidor corre con `online-mode=false`.
2. La autenticación la aporta **AuthMe**: registro obligatorio en el primer
   login (`/register`), y sesiones por IP (8 h) para que reconectar desde la
   misma IP no vuelva a pedir `/login`.
3. **Whitelist siempre activa** (`enforce-whitelist=true`): en modo offline
   cualquiera puede presentarse con cualquier nombre, así que solo entran
   nombres dados de alta explícitamente.
4. **CoreProtect** registra todas las acciones de bloques/ítems/chat para
   poder investigar y revertir griefing (en modo offline el riesgo de
   suplantación e incidentes es mayor).

## Consecuencia crítica: la regla de hierro del nombre

En modo offline el UUID del jugador se **deriva del nombre**
(`UUID(md5("OfflinePlayer:" + nombre))`). Por tanto **el nombre ES la
identidad**: cambiar de nombre = jugador nuevo (se pierden inventario,
estadísticas, whitelist, cuenta AuthMe y la continuidad del historial de
eventos). Nadie cambia de nombre, jamás. Si alguien necesita renombrarse,
es una migración manual documentada, no un cambio de launcher.

Nota histórica: los eventos previos a este ADR llevan UUIDs premium
(p. ej. Vancorbus = `1556f592-…`). Tras el cambio, cada jugador emite con su
UUID offline. En staging se acepta la discontinuidad; para producción, si se
quiere unificar historia, será con eventos nuevos (jamás UPDATE, ver catálogo).
