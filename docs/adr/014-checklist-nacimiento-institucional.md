# ADR-014: Checklist de nacimiento del mundo real — ampliación institucional

- **Fecha**: 2026-08-10
- **Estado**: aceptado

## Contexto

Tres incidentes registrados en el runbook comparten la misma causa
estructural: **algo que "debía estar" en el mundo de producción no
lo estaba**, y nadie lo notó hasta que un flujo posterior lo
requirió y falló.

- **ADR-007 · EventCollector no desplegado en el nacimiento (v1.0,
  2026-07-24)**. El plugin es local al monorepo (no se resuelve por
  la variable `PLUGINS:` del compose); nadie lo copió al volumen de
  prod antes del primer arranque. ~63 h de gameplay histórico sin
  telemetría — pérdida cero práctica sólo porque no hubo actividad
  real en ese intervalo.
- **Incidente 002 · EventFX no cargado en prod (2026-08-09)**. El
  `.jar` de EventFX generado por `./gradlew :eventfx:jar` nunca
  entró al bind mount de `plugins/`. El comando `/evento` devolvía
  `Unknown command` porque el plugin no existía en runtime, no
  porque el usuario careciera de permisos. Diagnóstico inicial se
  fue por la rama equivocada (permisos) antes de verificar
  presencia del artefacto.
- **Incidente 003 · Vancorbus no era OP en prod (2026-08-09,
  retroactivo desde 2026-07-26)**. `ops.json` estuvo con contenido
  `[]` durante ~44 días desde el nacimiento del mundo real. Todo el
  juego cotidiano funciona sin OP, así que el hueco fue invisible
  hasta que el dueño intentó ejecutar un comando administrativo del
  módulo propio (`/evento iniciar ki`).

El patrón compartido es "**olvido institucional**": la checklist de
nacimiento del mundo real (sección `## Checklist de nacimiento del
mundo real` del runbook) no codificó estos pasos como requisitos
verificables. La checklist heredó implícitamente lo que se hacía en
staging (donde muchos de estos ítems se cubren de facto por
repeticiones frecuentes de reset del mundo) y sumó añadidos ad-hoc
tras cada incidente, en vez de reescribirse una sola vez como
documento normativo del "estado esperado" del mundo de producción
al momento de nacer.

**ADR-011** ya estableció el principio general: "ningún fix de
código se considera resuelto hasta que un comando lea del artefacto
en runtime y confirme que ejecuta el output del último commit". El
presente ADR aplica el mismo principio al **nacimiento del mundo**:
no basta con que el commit-cero exista; hay que verificar que el
runtime del primer arranque efectivamente contiene todo lo que el
código declara.

## Problema

La checklist actual (7 pasos) cubre:

1. Rotación de la App Key de B2.
2. Guardado de secretos en gestor de contraseñas.
3. Simulacro de restauración offsite.
4. Borrado del mundo de staging (N/A desde v1.0 por ADR-005).
5. Whitelist definitiva vía rcon.
6. Config de EventFX en valores de producción.
7. Copia del jar de EventCollector al mundo.

Los tres incidentes revelan **cuatro huecos verificables** que la
checklist actual no cubre o cubre parcialmente:

- El paso 7 sólo menciona **EventCollector** de forma específica.
  Cualquier futuro `.jar` propio del monorepo (`:eventfx:jar`,
  `:plugin:jar`, o subproyectos Gradle que aún no existen) puede
  caer en el mismo hueco. El paso debe generalizarse.
- Ningún paso verifica que el **dueño esté en `ops.json`** con
  `level: 4`. La whitelist (paso 5) sólo controla quién puede
  entrar; no dice nada de quién puede administrar.
- Ningún paso verifica que **todos los secretos declarados** en
  `infra/.env` estén presentes con la sintaxis correcta. El
  incidente durante FASE A.3 (rebuild del api con `MC_DLQ_PASSWORD`
  y `ADMIN_DLQ_TOKEN` mal formateados) mostró que un `.env` puede
  parecer correcto y quemar horas de diagnóstico cuando falta un
  igual o sobra un espacio.
- Ningún paso obliga a **verificación de runtime tras cualquier
  fase posterior** que toque volúmenes, plugins, o `.env`. El
  principio de ADR-011 aplica al ciclo de vida completo, no sólo al
  nacimiento.

## Decisión

La sección `## Checklist de nacimiento del mundo real` del runbook
gana **cuatro checkpoints obligatorios** adicionales. Cada uno es
un comando concreto y reproducible con un criterio de "pasó/no pasó"
verificable, no un heurístico:

### CP-A. Todos los `.jar` propios del monorepo en el volumen de prod

Por cada subproyecto Gradle del monorepo que emita un `.jar`
destinado al server (`:plugin:jar`, `:eventfx:jar`, y cualquier
futuro submódulo equivalente), el `.jar` correspondiente debe estar
presente en el bind mount `plugins/` del mundo de prod.

Verificación:

```bash
# Listar los .jar esperados (fuente de verdad: el output de Gradle).
./gradlew :plugin:jar :eventfx:jar
ls plugin/build/libs/*.jar eventfx/build/libs/*.jar

# Verificar presencia en el volumen de prod.
MSYS_NO_PATHCONV=1 docker exec mc-ecosystem-minecraft-prod-1 \
    ls /data/plugins/ | grep -E '(EventCollector|EventFX)-.*\.jar'

# Verificación runtime (autoritativa) — el server declara qué cargó.
MSYS_NO_PATHCONV=1 docker exec mc-ecosystem-minecraft-prod-1 \
    rcon-cli plugins
```

Criterio: cada `.jar` presente en `*/build/libs/` está presente en
`/data/plugins/`, y `rcon plugins` lista su nombre en verde (sin
prefijo rojo de "disabled"). Este checkpoint absorbe y generaliza
el paso 7 actual (que quedará como caso particular para
`EventCollector`).

### CP-B. Dueño con OP `level: 4` en `ops.json`

El dueño del servidor (Vancorbus) debe estar en `ops.json` con
`level: 4`. La whitelist (paso 5) no cubre esto — un jugador puede
estar en whitelist y no ser OP, o viceversa.

Verificación:

```bash
MSYS_NO_PATHCONV=1 docker exec mc-ecosystem-minecraft-prod-1 \
    rcon-cli op Vancorbus
# Esperado en primer arranque: "Made Vancorbus a server operator".
# Esperado en verificaciones posteriores: "Nothing changed. The
# player already is an operator".

MSYS_NO_PATHCONV=1 docker exec mc-ecosystem-minecraft-prod-1 \
    cat /data/ops.json
# Debe listar exactamente una entrada con:
#   uuid: 71804e99-f2aa-32dc-bfcb-0ea5cfdda708
#   name: Vancorbus
#   level: 4
```

Criterio: `ops.json` contiene a Vancorbus con UUID canónico y
`level: 4`. Cualquier otro nombre en la lista (por ejemplo el
ghost `list` del Incidente 003) es un error a corregir con
`rcon deop <nombre>`.

**Cero OP para jugadores no-dueños.** La decisión de dueño
registrada en el Incidente 003 del runbook establece que los
amigos futuros (Pacman26, Elrid, etc.) NO reciben OP; se les da
permisos granulares por rol si un flujo específico lo requiere.
Este checkpoint también actúa como auditoría: si `ops.json` alguna
vez contiene más de una entrada, el motivo debe estar documentado
como decisión explícita del dueño.

### CP-C. Todos los secretos de `infra/.env` presentes con formato correcto

El `.env` de producción debe contener cada variable declarada como
requerida por los servicios del compose. La verificación debe
comprobar **presencia y longitud plausible** sin leer los valores
(regla anti-quemar-keys, ya documentada en la memoria del asistente
y en el paso 1 de la checklist).

Verificación (ejemplo con las variables críticas de FASE A):

```bash
# Cuenta cuántas variables de la lista esperada están presentes.
# La cuenta debe ser exactamente el número de variables esperadas.
for var in RESTIC_PASSWORD B2_ACCOUNT_ID B2_ACCOUNT_KEY \
           MC_APP_PASSWORD RCON_PASSWORD PLAYIT_SECRET_KEY \
           ADMIN_TOKEN ADMIN_DLQ_TOKEN MC_DLQ_PASSWORD; do
    count=$(grep -c "^${var}=" infra/.env || echo 0)
    if [ "$count" -ne 1 ]; then
        echo "FAIL: $var aparece $count veces (esperado: 1)"
    fi
done

# Verificación de longitud plausible (sin exponer valor):
# awk -F= 'NF>=2 { print $1, length($0) - length($1) - 1 }' infra/.env
# Comparar contra tabla esperada (tokens típicos: 32-64 chars;
# claves B2: ~25/40 chars; passwords: >=16 chars).
```

Criterio: cada variable esperada aparece **exactamente una vez**
con `^VAR=` (no comentada, sin espacios antes del `=`, no
duplicada) y su longitud cae en el rango plausible para su tipo.
El asistente **nunca** lee el valor mismo (regla ya guardada en
memoria persistente y en el paso 1 de la checklist).

### CP-D. Verificación de runtime tras cualquier fase que toque volúmenes, plugins o `.env`

El principio de ADR-011 ("el runtime siempre debe coincidir con el
código") aplica al ciclo de vida completo, no sólo al nacimiento.
Cualquier fase posterior (A.x, B.x, D.x, etc.) que modifique:

- Un bind mount o volumen del compose (`configs-prod/`, `plugins/`,
  `world-genesis-v1-paper-bukkit/`, etc.).
- Un `.jar` de plugin propio.
- Una variable en `infra/.env`.
- La imagen Docker de un servicio propio (`bot`, `api`, `genesis`).

…debe cerrar con la verificación runtime que corresponda al tipo
de artefacto tocado, según la tabla de comandos de ADR-011
(sección "Comandos por tipo de artefacto"). Ejemplos concretos ya
documentados en el runbook:

- FASE A.3 cerró con `docker exec mc-ecosystem-bot-1 sh -c 'grep -c
  ADR-013 /app/dist/index.js'` para probar que el bot en runtime
  ejecuta el código de resiliencia.
- Incidente 002 se resolvió sólo tras un `rcon plugins` que
  enumeró EventFX en la lista de plugins cargados.
- Incidente 003 se resolvió sólo tras un `cat /data/ops.json` que
  mostró la entrada de Vancorbus.

Criterio: la fase no se declara ✅ en el roadmap hasta que existe
evidencia de runtime en el commit de cierre (log del contenedor,
output de rcon, checksum de config, etc.), no sólo tests verdes o
CI verde.

## Consecuencias

**Positivas.**

- La checklist se convierte en el **único documento normativo del
  "estado esperado"** del mundo de producción al nacer. Ya no hay
  conocimiento tácito sobre "cosas que deberían estar y no se
  chequean".
- Cierra estructuralmente los tres incidentes existentes (007, 002,
  003) y previene reincidencias del mismo patrón para futuros
  submódulos Gradle o futuras variables de `.env`.
- Refuerza y hace concreto el principio de ADR-011 en un contexto
  operativo (nacimiento + ciclo de vida), no sólo en fixes de
  código puntuales.
- Compatible con la disciplina existente: cada checkpoint es un
  comando reproducible que puede aparecer en un `commit` como
  "evidencia de verificación" sin depender de scripts externos.

**Negativas / costes.**

- La checklist crece de 7 a 11 pasos. Aumenta la fricción del
  nacimiento del mundo real — pero el nacimiento es una operación
  que sucede **una sola vez por versión mayor** (ADR-002), así que
  el coste amortizado es despreciable.
- CP-A depende de que el equipo mantenga actualizada la lista de
  submódulos Gradle esperados. Mitigación futura: una tarea
  Gradle `:listExpectedPlugins` que renderice la lista desde los
  outputs de `:plugin:jar` + `:eventfx:jar` + resto, y que la
  checklist compare contra esa lista automáticamente. Fuera del
  alcance de este ADR (queda como potencial ADR posterior).
- CP-D no está automatizado por CI (los checkpoints corren en el
  host del dueño, contra containers vivos). No es realista mover
  eso a Actions sin infra adicional; queda como disciplina humana
  del cierre de fase. Precedente idéntico al de ADR-011.

## Alternativas consideradas

- **(A) Script `scripts/nacimiento-checklist.sh` que corre los 11
  pasos automáticamente.** Descartada como primera iteración: es
  útil como evolución futura, pero introduciría un nuevo artefacto
  a mantener antes de haber validado que los 4 checkpoints nuevos
  cubren efectivamente los huecos. Se puede volver a considerar
  cuando la próxima versión mayor de mundo real (v2.0 en la
  planeación actual) dispare un nacimiento nuevo.
- **(B) Mover los `.jar` propios a `PLUGINS:` del compose sirviendo
  desde `packserver` local.** Cerraría CP-A con configuración
  declarativa en vez de checklist manual. Alternativa mencionada en
  el diagnóstico del Incidente 002 en el runbook. Descartada por
  ahora: cambio arquitectónico de mayor alcance que merece su
  propio ADR y prueba en staging antes de tocar producción.
- **(C) Un rol de "config linter" en CI que valide `.env.example`
  vs `.env` (sin leer valores).** Cubriría CP-C parcialmente
  (presencia, no longitud) pero requiere sincronizar un
  `.env.example` que no existe hoy. Puede llegar como iteración
  futura.

Ninguna alternativa desplaza la decisión del ADR — todas son
posibles refuerzos posteriores a un checklist ya normativa.

## Corrección de numeración: ADR-013 aparecía dos veces

El documento `docs/roadmap-consolidacion-v1.2-v2.0.md` mencionaba
"ADR-013" en dos ubicaciones que refieren a decisiones distintas:

- **FASE A.3** (línea 9 del roadmap actual, ya cerrada): ADR-013 de
  resiliencia del bot (retry + circuit breaker + DLQ). Este ADR
  está firmado (`docs/adr/013-resiliencia-bot.md`, 2026-08-10) y
  cerrado con commit `3fbc223`.
- **FASE D.1** (línea 26 del roadmap actual, pendiente): "ADR-013:
  v4.0 (Genesis) se convierte en v2.0 (Insight). Renumeración del
  roadmap documentada." Este ADR **no existe todavía** y no puede
  llevar el número 013 porque ya está tomado.

Se decide: **FASE D.1 recibirá el número ADR-015 cuando llegue el
momento de escribirla**. El presente ADR-014 ya toma el hueco
inmediatamente posterior a 013, y ADR-015 queda reservado para la
renumeración de Genesis → v2.0 Insight. El roadmap se actualiza en
el mismo commit que este ADR para reflejar la corrección.

Registro de la colisión detectada: 2026-08-10, previa a arrancar
FASE B, junto con la ampliación de la checklist de nacimiento.
