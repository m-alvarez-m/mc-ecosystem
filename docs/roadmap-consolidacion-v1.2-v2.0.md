Plan Consolidado — Cierre de v1.2 + v2.0 + Regreso al Roadmap
Objetivo: consolidar los cimientos operacionales de Pulso, cerrar Genesis honestamente como v2.0 Insight, y volver al camino ordenado del roadmap original.
Duración estimada: 3-4 semanas de trabajo constante para llegar a v2.0 en producción.
FASE A ✅ — Cimientos operacionales (cerrada 2026-08-10)
Objetivo: convertir Pulso de "funciona" a "es robusto". Cerrar las 4 tareas críticas de v1.2.

* A.1 ✅ · P2-4 CI (GitHub Actions). Alcance chico (~50-100 líneas YAML). Duración: 30-45 min. **Cierre 2026-08-08 · commit `7d5a56a` · Actions run #109** verde (5 jobs OK, 1m 9s).
* A.2 ✅ · P1-6 Retention policy + ADR-012. Alcance mediano (SQL + endpoint/cron + ADR + tests). Duración: 60-90 min. **Cierre 2026-08-08 · commit `c43d4ee`** · ADR-012 aprobado; migración `002_events_archive_log.sql`, módulo `src/prune/*`, endpoint `POST /admin/events/prune`, scheduler in-process (día 1 · 04:00 UTC), 24 tests nuevos (12 prune + 8 admin + 4 scheduler), deploy en modo `EVENTS_PRUNE_DRY_RUN=true` hasta ~2028-07.
* A.3 ✅ · P1-5 Retry con circuit breaker + P2-5 Dead-letter queue. Alcance mediano combinado (~300-500 LOC). Duración: 90-120 min. **Cierre 2026-08-10 · commit `3fbc223` · Actions run 31460451382** verde (5 jobs OK). ADR-013 aprobado; migración `003_dead_letter_events.sql` (rol `mc_dlq` least-privilege + snapshot completo del payload que protege contra la purga ADR-012), `bot/src/resilience/*` (retry con jitter independiente + circuit breaker sliding window + logging estructurado de 14 campos + monitor de saturación >100), endpoint `POST /admin/dlq/replay` con token separado `ADMIN_DLQ_TOKEN`. Cierra estructuralmente el patrón del Incidente 001. Tests: bot 1123/1123 + api 218/218.

**FASE A completa ✅ — Cimientos operacionales de Pulso completos.** El bot resiste fallos silenciosos (retry + breaker + DLQ), la tabla `events` no crece infinita (retención 24m + archivado B2 verificado), cada commit posterior está validado por CI (5 gates en push a `main`). Los 3 sub-hitos suman 4 ADRs firmados (011, 012, 013 + los que vinieran) y 3 incidentes documentados con retrospectiva (001 · cursor atascado, 002 · EventFX no desplegado, 003 · Vancorbus no era OP). Próximo hito: FASE B (slash commands).
FASE B — Slash commands

* B.1 ✅ · P2-1 Slash commands (`/players`, `/tps`, `/status`). Alcance grande (~500-800 LOC). Duración: 2-3 sesiones. **Cierre oficial 2026-08-12** · ADR-016 firmado en `65d0bff` · implementación en `c50ca79` · regression fix en `f7314d9` · CI verde en run `31569178263` (5/5 gates, 55 s). Los 3 comandos ephemeral con TTL cache 10s (/players), freshness 90s (/tps), 9 líneas de salud incluyendo DLQ pendientes (/status). Endpoints nuevos api: `GET /players/online` + `GET /events/latest_by_type`. Script `register-commands` por-guild con fail-fast + log de evidencia + idempotencia. Regla anti-flakiness promovida a estándar del bot (ADR-016 D6). Bot pasa de "100% reactivo" a "consultable bajo demanda". **Cerrada con verificación humana CP-6 (screenshots de los 3 comandos ephemeral en Discord) + Incidente 004 documentado** (rol Postgres `mc_dlq` sin flag LOGIN desde A.3, descubierto durante CP-4/5, fix `ALTER ROLE ... WITH LOGIN`, motiva extensión CP-D₂ del ADR-014 en próximo ADR).

Al cerrar Fase B: el bot deja de ser 100% reactivo. Se pueden pedir datos bajo demanda desde Discord.
FASE C — Higiene institucional

* C.1 · Tag `v1.2` + actualizar runbook con secciones de operación del bot. Duración: 30-45 min.
* C.2 · Actualizar `bot/README.md` y handoff v1.2 → v2.0. Duración: 30 min.

Al cerrar Fase C: v1.2 firmada oficialmente. Runbook al día.
FASE D — Cierre de Genesis como v2.0
Genesis se implementó por adelantado bajo el número v4.0 en el roadmap original. Se reconoce ese trabajo, se termina, se despliega a producción como v2.0 Insight, y se renumera el roadmap.

* D.1 · ADR-015: v4.0 (Genesis) se convierte en v2.0 (Insight). Renumeración del roadmap documentada. Duración: 20-30 min. **Nota**: hasta 2026-08-10 este ADR aparecía como "ADR-013" en el roadmap, colisionando con ADR-013 de resiliencia del bot (FASE A.3, ya firmado). Corregido a ADR-015 en el mismo commit que firma ADR-014 (checklist institucional).
* D.2 · Terminar las features faltantes del dashboard según handoff. Duración: 2-3 sesiones.
* D.3 · Autenticación básica (BasicAuth o token en URL) antes de exponer. Duración: 60-90 min.
* D.4 · Añadir Genesis al `docker-compose.prod.yml`. Duración: 45 min.
* D.5 · Runbook: sección "operación de Genesis (v2.0 Insight)". Duración: 30 min.
* D.6 · Verificación humana en vivo. Duración: 30 min.
* D.7 · Tag `v2.0`. Duración: 15 min.

Al cerrar Fase D: Genesis vive en producción como v2.0 Insight con auth, runbook y tag firmado.
FASE E — Regreso al roadmap ordenado
Desde aquí el proyecto sigue el camino planeado, con el roadmap renumerado por ADR-015 (ver D.1):

* v1.3 BlueMap — Mapa web + cementerio de muertes. ~1 semana.
* v2.1 Memoria — Récords, rachas, "un día como hoy". ~1-2 semanas.
* v3.0 Legacy — Motor de títulos, Rey Minero, destronamientos. ~1-2 semanas.
* v3.1-3.2 Interactive — Vinculación cuentas, TP web, gestión de proyectos. ~2-3 semanas.
* v4.0 (renumerada) Genesis IA — IA cronista con RAG sobre la DB. ~2-4 semanas.
* v4.1 Cronista + Mascotas con LLM y moral — Wrapped + mascotas. ~2 semanas.

Estimación total del roadmap completo: 4-5 meses de trabajo constante.
Disciplina de ejecución

* Una sesión = una tarea del plan. No mezclar fases.
* Cada tarea cerrada con: commit atómico, push, evidencia de verificación humana cuando aplique.
* Fases se cierran con tag git firmado o con ADR según corresponda.
* Este documento se actualiza al cerrar cada fase (marcando `✅` los items completados).

Estado inicial

* Última fase cerrada: v1.1 Pulso (tag `v1.1`, septiembre 2026).
* Cutoff oficial de captura del mundo real: 2026-07-26 23:25:52 UTC (ADR-007).
* Bugs cerrados: BUG-02 completo con lección institucional (ADR-011).
* Bugs pendientes: ninguno urgente detectado.
* Trabajo en curso: Fase A.1 arranca en la próxima sesión.
