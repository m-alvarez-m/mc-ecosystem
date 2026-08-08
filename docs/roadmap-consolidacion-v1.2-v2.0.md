Plan Consolidado — Cierre de v1.2 + v2.0 + Regreso al Roadmap
Objetivo: consolidar los cimientos operacionales de Pulso, cerrar Genesis honestamente como v2.0 Insight, y volver al camino ordenado del roadmap original.
Duración estimada: 3-4 semanas de trabajo constante para llegar a v2.0 en producción.
FASE A — Cimientos operacionales
Objetivo: convertir Pulso de "funciona" a "es robusto". Cerrar las 4 tareas críticas de v1.2.

* A.1 · P2-4 CI (GitHub Actions). Alcance chico (~50-100 líneas YAML). Duración: 30-45 min. ✅ 2026-08-08 · commit `7d5a56a` · Actions run #109 verde (5 jobs OK, 1m 9s).
* A.2 · P1-6 Retention policy + ADR-012. Alcance mediano (SQL + endpoint/cron + ADR + tests). Duración: 60-90 min.
* A.3 · P1-5 Retry con circuit breaker + P2-5 Dead-letter queue. Alcance mediano combinado (~300-500 LOC). Duración: 90-120 min.

Al cerrar Fase A: el bot resiste fallos silenciosos, la tabla events no crece infinita, cada commit posterior está validado por CI.
FASE B — Slash commands

* B.1 · P2-1 Slash commands (`/players`, `/tps`, `/status`). Alcance grande (~500-800 LOC). Duración: 2-3 sesiones.

Al cerrar Fase B: el bot deja de ser 100% reactivo. Se pueden pedir datos bajo demanda desde Discord.
FASE C — Higiene institucional

* C.1 · Tag `v1.2` + actualizar runbook con secciones de operación del bot. Duración: 30-45 min.
* C.2 · Actualizar `bot/README.md` y handoff v1.2 → v2.0. Duración: 30 min.

Al cerrar Fase C: v1.2 firmada oficialmente. Runbook al día.
FASE D — Cierre de Genesis como v2.0
Genesis se implementó por adelantado bajo el número v4.0 en el roadmap original. Se reconoce ese trabajo, se termina, se despliega a producción como v2.0 Insight, y se renumera el roadmap.

* D.1 · ADR-013: v4.0 (Genesis) se convierte en v2.0 (Insight). Renumeración del roadmap documentada. Duración: 20-30 min.
* D.2 · Terminar las features faltantes del dashboard según handoff. Duración: 2-3 sesiones.
* D.3 · Autenticación básica (BasicAuth o token en URL) antes de exponer. Duración: 60-90 min.
* D.4 · Añadir Genesis al `docker-compose.prod.yml`. Duración: 45 min.
* D.5 · Runbook: sección "operación de Genesis (v2.0 Insight)". Duración: 30 min.
* D.6 · Verificación humana en vivo. Duración: 30 min.
* D.7 · Tag `v2.0`. Duración: 15 min.

Al cerrar Fase D: Genesis vive en producción como v2.0 Insight con auth, runbook y tag firmado.
FASE E — Regreso al roadmap ordenado
Desde aquí el proyecto sigue el camino planeado, con el roadmap renumerado por ADR-013:

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
