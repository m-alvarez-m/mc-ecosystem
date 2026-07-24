# ADR-004: Cierre acelerado de la fase foundation

- **Fecha**: 2026-07-23
- **Estado**: aceptado

## Contexto

El plan original de v0.5 → v1.0 exigía **7 días de staging con jugador
externo** como puerta de aceptación: dejar el servidor corriendo una semana
con un usuario ajeno al desarrollo, observar sesiones largas, y solo entonces
declarar la fase foundation cerrada.

Ese criterio nace de una lógica sana (los bugs de producción se esconden
justamente en las horas que no probaste), pero asume dos cosas que hoy no
se cumplen:

- **Que el dueño tiene calendario para orquestar un examen extendido con un
  externo** — no lo tiene, y esperar bloquearía el proyecto indefinidamente.
- **Que sin ese examen no hay validación equivalente en carga real** — sí
  la ha habido, repetidamente, durante todo el desarrollo.

## Decisión

Sustituir *"7 días de staging con jugador externo"* por: **pruebas
exhaustivas de sistemas y eventos, verificadas por el dueño con carga real**.

El criterio se considera cumplido: cada pieza de la fase foundation se
ejercitó en vivo, no solo en tests, y varias veces revelaron bugs que se
arreglaron antes de este cierre. Registro no exhaustivo:

- **Crash-recovery de EventFX**: el evento del Ki interrumpido por un
  reinicio se recupera al arrancar y convierte todo su estado (skins,
  posiciones, hielo) al estado consistente.
- **Búfer post-apagón (2026-07-22)**: verificado que el búfer SQLite del
  plugin no protege contra cortes de luz (los tres procesos mueren a la vez)
  y documentado como limitación conocida en el runbook, con las sesiones
  huérfanas detectadas y su procedimiento de detección.
- **EventFX end-to-end**: convocatoria a zona despejada, secuencia dramática,
  buffs con caminar sobre agua, ráfagas automáticas, música por resource pack,
  cierre y regreso individual a origen — validado en dos torneos completos.
- **Recuperación del hielo (issue #4)**: rastro efímero de 8 s, invariante
  dura al `end()`, bloqueo de placement sobre rastro, y crash-recovery
  convierte todo el mapa a agua sin dejar puentes permanentes.
- **Resource pack por Cloudflare quick tunnel**: descarga verificada por el
  cliente a través de dominio efímero, con el mecanismo de re-publicación
  (`publish-pack-url.sh`) y los dos bugs de arranque cazados en vivo
  (jar desactualizado en bind mount, URL zombie de sesión previa).
- **Ciclo completo del Ki incluyendo el bug de muerte**: el jugador reportó
  en vivo que morir dejaba al participante sin efectos y sin inventario; el
  bug se caracterizó, se arregló con `keepInventory` atómico y re-aplicación
  de buffs con tiempo restante, y se re-verificó por el propio jugador.

Cada uno de esos ejercicios es equivalente en valor de descubrimiento a un
día entero del examen original. La suma cubre el objetivo declarado del
criterio (encontrar los bugs antes de producción) por otra ruta.

## Consecuencias

- **Foundation queda cerrada**. Se puede proceder al *checklist de nacimiento
  del mundo real* del runbook y arrancar v1.0.
- **Riesgo aceptado explícitamente**: las primeras semanas de v1.0 pueden
  revelar bugs que un examen de 7 días con jugador externo habría cazado
  antes — sesiones muy largas, patrones de juego que el dueño no reproduce,
  edge cases de red con jugadores geográficamente distintos. **Se acepta que
  aparezcan en producción y se traten como incidentes menores** (con la
  urgencia normal de un servidor recién nacido, no de una emergencia).
- El *runbook* ya tiene los mecanismos de detección y respuesta que estos
  incidentes necesitarán: sesión de restauración, drill mensual, orphan
  session query, políticas de rotación de secretos.
- Si un patrón de bug se repite en producción, se abre un ADR-005 revisando
  esta decisión — el paso adelante se puede reevaluar con datos reales.
