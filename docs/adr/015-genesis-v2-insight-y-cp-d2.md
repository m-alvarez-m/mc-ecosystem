# ADR-015: Genesis → v2.0 Insight + extensión CP-D₂ del ADR-014

- **Fecha**: 2026-08-13
- **Estado**: aceptado
- **Fase del roadmap**: D.1 (ver `docs/roadmap-consolidacion-v1.2-v2.0.md`)

## Contexto

### Trazabilidad de la numeración

El roadmap consolidado nació con una colisión de números. En su commit
inicial `a806752` (*docs: roadmap consolidacion v1.2 -> v2.0*) la
etiqueta "ADR-013" aparecía dos veces refiriéndose a decisiones
distintas: una vez asociada al cierre de FASE A.3 (resiliencia del
bot — retry + circuit breaker + DLQ) y otra vez a FASE D.1 (Genesis
convertido en v2.0). El número quedó ocupado por A.3 al firmarse el
`docs/adr/013-resiliencia-bot.md` (commit `3fbc223`, 2026-08-10) y
D.1 quedó sin número asignado.

El commit `69ede32` (*docs: incidente 003 · Vancorbus OP + ADR-014
checklist institucional + renumeración D.1*) corrigió el roadmap y
dejó reservado explícitamente el número **015** para D.1. La sección
"Corrección de numeración: ADR-013 aparecía dos veces" del
`docs/adr/014-checklist-nacimiento-institucional.md` documenta la
reserva. **Este ADR ejecuta esa reserva.** No se renumera nada
retroactivamente — los ADRs firmados 011–014 y 016 conservan sus
números y sus referencias cruzadas quedan intactas.

### Punto en el ciclo

FASE A (cimientos operacionales) + FASE B.1 (slash commands del bot) +
FASE C (higiene institucional) están cerradas con evidencia dura. La
tag `v1.2` está firmada en el commit `d812204` con CI verde en el run
`31629841290`. Cinco ADRs firmados (011, 012, 013, 014, 016) y cuatro
incidentes documentados en el runbook (001, 002, 003, 004).

Antes de arrancar FASE A del roadmap consolidado, existía trabajo
hecho por adelantado bajo el número "v4.0 (Genesis)": un dashboard
web parcial diseñado durante la fase caótica previa a la
consolidación institucional. Ese trabajo sobrevive; no fue
descartado. FASE D institucionaliza qué se hace con él, cómo se
termina y bajo qué disciplina se despliega — y absorbe también una
lección operativa del Incidente 004 que hasta hoy vivía sólo en el
runbook.

## Problema

Tres decisiones acumuladas necesitan quedar firmadas antes de tocar
código en D.2. Ninguna es implementación; las tres son contratos
institucionales que si se dejan implícitos se vuelven a re-litigar por
fase, o peor, se olvidan y reintroducen los mismos huecos que
motivaron ADRs anteriores.

1. **Renumeración documentada.** Sin registrar por escrito la
   trayectoria "013 reservado para D.1 → colisión con A.3 → reservado
   como 015 por ADR-014 → ejecutado por este ADR", cualquier lector
   futuro tropieza con la pregunta "¿por qué 015 y no 013? ¿se perdió
   un número?" y no encuentra respuesta salvo leer commits antiguos.
2. **Aceptación formal de Genesis como v2.0 Insight con criterios
   duros de "listo para tag".** Sin criterios firmados, "cuándo
   tageamos v2.0" queda como juicio subjetivo por sub-fase y el
   trabajo hecho fuera de orden convive en un limbo entre "existe"
   y "no cuenta".
3. **Extensión CP-D₂ del ADR-014 heredada del Incidente 004.** El
   CP-D actual acepta "log del contenedor" como evidencia de runtime.
   El Incidente 004 demostró que el bot puede loguear
   `resilience.executor_activo` (var presente + código compilado) y
   aun así tener rota la cadena `bot → api → Postgres` durante 30 h
   sin que nadie lo note. Sin firmar la extensión, el hueco depende
   de disciplina no documentada.

## Decisión

### D1 · Renumeración: ADR-015 nace explícito, sin renumeración retroactiva

Este documento toma el número 015 en cumplimiento de la reserva del
ADR-014. La sección "Trazabilidad de la numeración" del *Contexto*
arriba deja escrita la trayectoria completa con referencia en prosa
al commit `a806752` (origen de la colisión) y al commit `69ede32`
(donde ADR-014 corrigió el roadmap y reservó 015).

**Regla firmada para casos análogos futuros.** Cuando un roadmap
mencione un número de ADR antes de que ese ADR se escriba y ese
número colisione con otro ADR firmado primero, la resolución
correcta es: (a) el que se firmó primero conserva el número, (b) el
segundo recibe el siguiente número libre, (c) la reasignación se
documenta en el ADR que ocupa el nuevo número — no como nota al pie
del roadmap ni como comentario en el commit. El roadmap es documento
vivo; los ADRs son documentos firmados. La traza pertenece a los
documentos firmados.

### D2 · Genesis → v2.0 Insight, formal; criterios en ADR, lista en backlog

Lo que el roadmap original llamaba "v4.0 (Genesis)" pasa formalmente
a llamarse **v2.0 Insight**. El renombrado es reconocimiento de
hecho: v4.0 nunca existió como tag ni como release; alinear el número
con el trabajo real hecho evita mantener dos taxonomías paralelas
("lo que decía el roadmap original" vs "lo que está en git").

**Aceptación del trabajo hecho fuera de orden.** El dashboard parcial
existente construido antes de la consolidación institucional no se
descarta. Rehacerlo "por orden correcto" cuesta semanas sin ganancia
de seguridad si tiene tests o aceptación manual. Requisitos mínimos
para admitir cada feature aceptada fuera de orden:

1. **Smoke test en CI o aceptación manual documentada.** Sin evidencia
   de que la feature funciona hoy, no cuenta como "aceptada"; cuenta
   como "hay que validarla o descartarla".
2. **Anotada como deuda de orden en el backlog.** No borrada, no
   maquillada — visible como "esta feature se construyó fuera de su
   fase formal, se acepta con smoke test X del commit Y".

**Separación criterios ↔ lista de features.** El ADR fija los
criterios ("qué convierte al dashboard actual en listo para tag
v2.0"). La lista concreta de features vive en un documento vivo
aparte: `docs/v2.0-backlog.md`. Motivo: un ADR es contrato firmado y
la lista de features cambia semana a semana; si van juntas, o se toca
el ADR firmado cada vez (lo degrada) o la lista se queda obsoleta
dentro del ADR (miente por escrito).

**Los 5 criterios firmados para "listo para tag v2.0"**:

1. **Auth básica funcionando.** El mecanismo concreto (login por
   Discord OAuth, tokens firmados, otro) se decide en D.3, no aquí.
   Este criterio fija sólo que existe autenticación real y no un
   placeholder abierto al mundo.
2. **Todas las features del backlog sección 1 con smoke test en CI
   verde.** "Sección 1" = features aceptadas fuera de orden con
   smoke test; el smoke test debe correr en el pipeline de CI del
   monorepo, no sólo en local del dueño.
3. **Dashboard en `docker-compose.prod.yml` desplegado con evidencia
   runtime.** Aplicación literal de ADR-011: un comando concreto
   (`docker exec … grep`, `curl` al bundle, `docker image inspect`)
   debe confirmar que el runtime ejecuta el código del commit del
   tag. Un merge verde no es evidencia; el runtime lo es.
4. **Runbook con sección operacional del dashboard.** Cómo se
   arranca, cómo se apaga, cómo se ve un fallo desde afuera, cómo
   se rota su secreto principal. Mismo estándar que las secciones
   operacionales de `api`, `bot` e `infra` ya existentes.
5. **CI 5/5 gates verdes en el commit del tag v2.0.** El commit que
   recibe el tag debe tener el pipeline completo verde (todos los
   jobs, no sólo el subset relevante al dashboard). Precedente
   directo del cierre de v1.2 con el run `31629841290`.

**Estructura obligatoria de `docs/v2.0-backlog.md`** (a crear en D.2,
fuera del alcance de este ADR). El documento tiene tres secciones
explícitas:

- **Sección 1 · Features aceptadas fuera de orden CON smoke test.**
  Listas para v2.0. Cada entrada nombra la feature, el commit donde
  vive, y la ruta del smoke test.
- **Sección 2 · Features aceptadas fuera de orden pendientes de
  validar.** Deben pasar smoke test antes del tag v2.0. Cada entrada
  nombra la feature y el gap concreto (falta test, falta cobertura
  runtime, etc.).
- **Sección 3 · Features aún no comenzadas.** Cada entrada declara
  destino v2.0 o v2.1 según prioridad. Las de v2.1 no bloquean el
  tag v2.0.

Cualquier feature que aparezca en un PR de D.2..D.7 sin estar
clasificada en una de las tres secciones debe rebotarse o clasificarse
antes de merge.

### D3 · CP-D₂ · verificación end-to-end contra sistemas dependientes

Se extiende el checkpoint CP-D del ADR-014 con un segundo nivel,
**obligatorio para todas las fases D.2..D.7**, en orden **secuencial
explícito**, no simultáneo:

- **CP-D₁ · presencia de variable** (comportamiento actual de CP-D
  del ADR-014, ejercido en la práctica en CP-1 del ADR-016 y en las
  verificaciones de FASE A.3). Comando canónico:
  `grep -c '^VAR=' <archivo>` devuelve `1`. Falla con mensaje literal
  "variable ausente en `<archivo>`" o "variable duplicada en
  `<archivo>`". Si CP-D₁ falla, la fase se bloquea aquí y CP-D₂ no se
  ejecuta.
- **CP-D₂ · end-to-end contra el servicio real** (nuevo). Solo si
  CP-D₁ pasa. Ejecuta una prueba mínima real contra el sistema
  dependiente usando la credencial exacta del runtime. Falla con
  mensaje literal "credencial no válida para `<servicio>`" o
  "servicio `<servicio>` no alcanzable desde el contenedor".

Esta secuencia explícita — no simultánea — es deliberada. Los dos
mensajes de fallo apuntan a causas raíz distintas: CP-D₁ acusa
`.env` roto o archivo equivocado; CP-D₂ acusa credencial equivocada,
rol sin login (caso 0 del Incidente 004), red del contenedor mal
ruteada, o servicio caído. Un chequeo combinado devolvería un mismo
error para varias causas y perdería la señal de diagnóstico que
Incidente 004 pagó ~15 minutos por aprender.

**Los cuatro detalles no negociables de CP-D₂**:

1. **Misma fuente de credencial que el runtime.** La prueba lee la
   credencial del `.env` (o secret store) real que consume el
   servicio, no de un valor re-tipeado. Copiar la contraseña a mano
   en un test no valida propagación desde el `.env` — valida
   solamente alcance de red.
2. **Misma posición de red que el runtime.** La prueba corre desde el
   mismo contenedor y la misma network de Docker Compose que el
   servicio real. "Alcanzable desde el host" no garantiza "alcanzable
   desde el contenedor" (bridge distinto, DNS interno distinto,
   política de firewall distinta).
3. **Timeout 5 s por probe.** Un servicio caído no puede bloquear
   indefinidamente el cierre de la fase. Fallo por timeout se
   clasifica como "servicio no alcanzable" (segundo mensaje de
   arriba), no como "credencial no válida".
4. **Fallo bloquea la fase.** No se registra y se sigue. La fase queda
   ✗ hasta que CP-D₂ pasa o hasta que se firma un waiver explícito
   con el mismo peso institucional que un ADR (esto último es
   excepcional y no forma parte del flujo normal).

**Ejemplos concretos por tipo de dependencia** (patrones, no lista
cerrada — cada fase D.x nombra sus probes específicas en su ADR o en
su commit de cierre):

| Dependencia | Probe CP-D₂ mínima |
|---|---|
| Rol PostgreSQL | `PGPASSWORD=<v> psql -U <rol> -d <db> -c 'SELECT 1'` con la password leída del `.env` del servicio, ejecutado desde dentro del contenedor consumidor. Debe devolver `1`. |
| Endpoint api que requiere token | `curl -sS -H "X-Admin-Token: $TOKEN"` a la ruta afectada. Debe devolver `2xx` con la shape esperada. |
| Discord API | `curl` a `/applications/{app}/guilds/{guild}/commands` con el token del bot. Debe devolver la lista de comandos registrados sin `401`. |
| B2 (backups) | `restic snapshots` con `RESTIC_PASSWORD` + credenciales B2. Debe listar snapshots sin `signature does not match`. |

**Alcance vinculante.** CP-D₂ aplica a **todas las fases D.2..D.7**
del roadmap consolidado desde este ADR en adelante. Cualquier fase
que declare cierre sin evidencia CP-D₁ + CP-D₂ pegada al commit de
cierre no se considera cerrada en el roadmap.

## Verificación de runtime

Este ADR es una decisión meta-institucional; su verificación de
runtime es documental y estructural, no ejecución de código. Aun
así, ADR-011 aplica: el cierre de D.1 requiere evidencia concreta
con criterio pasado/no-pasado.

**CP-1 · el ADR existe con la forma esperada.**

```bash
test -f docs/adr/015-genesis-v2-insight-y-cp-d2.md && \
  grep -c "^## " docs/adr/015-genesis-v2-insight-y-cp-d2.md
```

Salida esperada: número ≥ 7 (Contexto, Problema, Decisión,
Verificación de runtime, Consecuencias, Alternativas descartadas,
Referencias cruzadas — como mínimo).

**CP-2 · las 3 decisiones están firmadas y numeradas.**

```bash
grep -E "^### D[123] · " docs/adr/015-genesis-v2-insight-y-cp-d2.md | wc -l
```

Salida esperada: `3` (D1, D2, D3 nombradas exactamente una vez cada
una).

**CP-3 · trazabilidad hash a los commits mencionados.**

```bash
git log --oneline a806752 -1
git log --oneline 69ede32 -1
```

Ambos comandos devuelven una línea válida. Si alguno responde
`unknown revision`, el ADR está referenciando un commit inexistente
y hay que corregir antes de firmar.

**CP-4 · aplicación diferida a D.2..D.7.** Este ADR no crea código.
Su verificación runtime end-to-end vive en el primer commit de D.2
que ejercite CP-D₁ + CP-D₂ contra Postgres (probablemente el commit
que crea el `docs/v2.0-backlog.md` y el primer smoke test del
dashboard). Ese commit debe pegar en su descripción:

- Salida de CP-D₁: `grep -c '^VAR=' <archivo>` → `1`.
- Salida de CP-D₂: `psql -c 'SELECT 1'` (o el probe que corresponda)
  → `1` (o shape esperada).
- Tiempo de cada probe: `< 5 s`.

Si el commit inicial de D.2 no incluye esa evidencia, el checkpoint
D.2 no se cierra y la fase queda abierta hasta que se añada.

## Consecuencias

**Positivas.**

- **Traza de la renumeración congelada por escrito.** Cualquier
  lector futuro que se pregunte "¿por qué 015 y no 013?" encuentra
  respuesta en el propio documento sin necesidad de arqueología de
  commits.
- **Criterios "listo para v2.0" firmados.** Los cinco criterios de
  D2 hacen que el tag v2.0 sea una operación mecánica ("¿pasan los
  5?") en vez de un juicio subjetivo por fase. Precedente idéntico
  al de v1.2 donde la definición de "listo" quedó documentada en
  handoff antes del tag.
- **CP-D₂ cierra estructuralmente el gap del Incidente 004.**
  Cualquier fase D.2..D.7 que introduzca o modifique una dependencia
  externa está obligada a demostrar end-to-end que la cadena
  funciona con la credencial real. La "luz roja invisible" del
  Incidente 004 durante 30 h no puede repetirse sin violar un
  checkpoint firmado.
- **Aceptación formal del trabajo fuera de orden sin coste
  arqueológico.** El dashboard existente entra al ciclo institucional
  con requisitos claros (smoke test + entrada en backlog) en vez de
  quedar en limbo. Reduce el riesgo de "rehagamos esto por orden
  correcto" que costaría semanas.
- **Separación ADR ↔ backlog vivo.** El ADR queda inmutable y el
  backlog puede evolucionar semanalmente sin degradar el contrato
  firmado. Reusable como patrón para futuros ADRs que necesiten
  referenciar listas dinámicas.

**Negativas / costes.**

- **CP-D₁ + CP-D₂ suma ~5–30 s por dependencia al cierre de cada
  fase D.x.** Coste real, aceptado. La alternativa observada
  (Incidente 004) fue 30 h de "luz roja invisible" y ~15 min de
  diagnóstico por un error de Postgres genérico. Compensa.
- **`docs/v2.0-backlog.md` requiere mantenimiento continuo.**
  Cualquier feature nueva o completada mueve entradas entre las tres
  secciones. Mitigación: la actualización del backlog es paso
  obligatorio de cierre de cualquier PR de D.2..D.7 que toque el
  dashboard, del mismo modo que `git status` + tests verdes son
  pasos obligatorios hoy.
- **CP-D₂ no está automatizado por CI.** Corre en el host del dueño
  contra containers vivos, igual que CP-D en ADR-014 y CP-6 en
  ADR-016. Queda como disciplina humana del cierre de fase.
  Precedente heredado, no regresión.
- **Los criterios de D2 son mínimos, no aspiracionales.** Un
  dashboard técnicamente "listo para v2.0" bajo los 5 criterios
  puede seguir teniendo áreas cosméticas incompletas (temas
  visuales, animaciones, i18n). Aceptado: v2.0 es "Insight
  funcional", no "Insight pulido". La disciplina de alcance del
  roadmap consolidado exige esta austeridad.

## Alternativas descartadas

- **Renumeración retroactiva** (renumerar ADR-013 de resiliencia
  bot a otro número para "liberar" 013 para D.1). Rompe referencias
  cruzadas en ADRs firmados 014 y 016 y en el runbook. La política
  correcta es que quien firmó primero conserva el número — ADR-013
  bot ya cerró FASE A.3 y sus referencias son inmutables.
- **Rehacer Genesis desde cero bajo orden formal correcto.** Costaría
  semanas de reconstrucción sin ganancia de seguridad frente a
  aceptar el trabajo actual con smoke test + entrada en backlog. La
  ganancia hipotética ("código escrito con conocimiento del roadmap
  consolidado desde el día 1") no compensa el coste real.
- **Meter la lista de features pendientes dentro del propio ADR.**
  Rompe la naturaleza inmutable del ADR: cada feature completada
  obligaría a editar el ADR firmado, o la lista quedaría obsoleta
  dentro del ADR. Separación en `docs/v2.0-backlog.md` resuelve
  ambos problemas.
- **CP-D₂ como reemplazo de CP-D₁ en vez de superconjunto.** La
  lógica sería "si el `SELECT 1` funciona, la var obviamente está
  presente". Descartada porque un chequeo end-to-end fallido no
  distingue entre "var ausente" y "credencial mala" y "servicio
  caído". CP-D₁ acusa la primera con mensaje específico en menos de
  100 ms; sin él, todo se colapsa al mismo error genérico y se
  pierde señal de diagnóstico (el mismo error genérico costó ~15
  min en el Incidente 004).
- **CP-D₂ como recomendación soft en el runbook.** Descartada
  porque exactamente eso es lo que existía hasta hoy — el runbook
  documentó el aprendizaje del Incidente 004 pero sin peso
  institucional obligatorio. Firmar CP-D₂ en un ADR es la única
  manera de convertir el aprendizaje en gate no saltable.
- **Diferir la firma de CP-D₂ hasta que caiga otro incidente
  similar.** Descartada por el patrón mismo del Incidente 004: la
  "luz roja invisible" duró 30 h y salió a la luz por casualidad
  durante CP-4/5 de FASE B.1. Otro incidente análogo puede tardar
  meses en manifestarse y para entonces ya se habrán cerrado
  fases D.x sin la disciplina.
- **Backlog con más de 3 secciones** (por ejemplo separando
  "aceptado con smoke test" vs "aceptado con aceptación manual").
  Descartada por sobrediseño — la distinción interesante es
  "validado / pendiente de validar / no comenzado". Cómo se validó
  concretamente cada feature vive en su propia entrada del backlog,
  no como estructura de secciones.

## Referencias cruzadas

- **ADR-011 · runtime siempre coincide con código.** CP-D₂ es
  aplicación literal del principio a dependencias externas: no basta
  con que el código y la variable existan; el runtime end-to-end
  contra el sistema real debe demostrar que la cadena funciona.
- **ADR-013 · resiliencia del bot.** Su rol Postgres `mc_dlq` fue
  el caso 0 del Incidente 004. Sin CP-D₂, el patrón que ADR-013
  supuestamente cerraba ("cursor atascado silencioso") reaparece
  disfrazado de "rol NOLOGIN silencioso".
- **ADR-014 · checklist de nacimiento institucional.** Este ADR
  extiende directamente su CP-D. La sección "Corrección de
  numeración: ADR-013 aparecía dos veces" del ADR-014 es la que
  reservó el número 015 que este documento ejecuta.
- **ADR-016 · slash commands B.1.** Sus checkpoints CP-4 y CP-5
  fueron los que detectaron el Incidente 004 al ejercitar
  `bot → api → Postgres` end-to-end por primera vez desde el cierre
  de A.3. CP-D₂ formaliza esa disciplina de detección como
  requisito de cierre de fase, no como afortunado descubrimiento.
- **`docs/roadmap-consolidacion-v1.2-v2.0.md`.** El roadmap
  consolidado del que D.1 forma parte. Este ADR institucionaliza
  las tres decisiones acumuladas que D.1 tenía pendientes.
- **`docs/handoff-v1.2-a-v2.0.md`.** Documento vivo del traspaso de
  v1.2 a v2.0; sus criterios operativos se alinean con los 5
  criterios firmados en D2.
- **`docs/runbook.md` · Incidente 004** (líneas 1571-1695). Caso 0
  motivador de D3. La sección del runbook queda como narrativa del
  incidente; este ADR queda como el gate institucional que cierra
  su clase.
- **Commit `a806752`** — commit inicial del roadmap consolidado,
  origen de la colisión ADR-013.
- **Commit `69ede32`** — commit que firmó ADR-014 y en el mismo
  cambio reservó el número 015 para D.1, corrigiendo el roadmap.
- **Commit `d812204`** — tag `v1.2`, punto desde el que arranca FASE
  D del roadmap consolidado.
