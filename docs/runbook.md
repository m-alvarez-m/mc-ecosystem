# Runbook

Procedimientos operativos para desplegar, monitorear y recuperar el sistema ante incidentes.

## Checklist de nacimiento del mundo real

El staging fue el laboratorio; el mundo real nace UNA sola vez y no migra
hacia atrás (ADR-002). Recorrer esta lista COMPLETA antes de que entre el
primer jugador de verdad. Marcar cada punto solo tras verificarlo.

1. **Rotar la App Key de Backblaze B2.** Cualquier clave que haya pasado por
   chat, correo o logs es una clave quemada. En el panel de Backblaze: crear
   una App Key NUEVA restringida al bucket, ponerla en `infra/.env`
   (`B2_ACCOUNT_ID` / `B2_ACCOUNT_KEY`), lanzar un backup de prueba
   (`docker exec mc-ecosystem-backup-1 /scripts/backup.sh db`) y confirmar
   que sube a B2. Además, correr `restore-drill.sh --offsite` con la clave
   nueva antes de borrar la vieja: la escritura y la lectura usan la misma
   clave, pero la ruta de restauración toca chunks aleatorios que un backup
   simple no ejercita. **Solo con ambas verdes** borrar la App Key vieja.
   Verificar → borrar, nunca al revés.

   **Regla para el asistente**: nunca leer `infra/.env` para verificar
   ediciones del dueño — una sola lectura quema la clave (ver rotación
   del 2026-07-24). Alternativas: `grep -c '^VAR='` (sólo cuenta líneas,
   no expone el valor), o pedirle al dueño confirmación explícita.

   *Registro histórico de rotaciones:*
   | Fecha | Clave | Motivo |
   |---|---|---|
   | 2026-07-22 | `restic-prod-2` (reemplaza a la original) | La original pasó por chat de desarrollo |
   | 2026-07-24 | `restic-prod-3` (reemplaza a `restic-prod-2`) | La anterior pasó por chat: el asistente leyó `.env` para verificar edits del dueño (ver regla anti-quemar-keys arriba) |

2. **Guardar los secretos de producción en el gestor de contraseñas.**
   `RESTIC_PASSWORD` es irremplazable: perderla = backups irrecuperables
   (restic no tiene recuperación de contraseña). Guardar en el gestor:
   `RESTIC_PASSWORD` y una copia íntegra del `infra/.env` de producción
   (contraseñas de Postgres, `MC_APP_PASSWORD`, `RCON_PASSWORD`, credenciales
   B2, `PLAYIT_SECRET_KEY`). El `.env` está gitignorado: si se pierde el disco
   sin copia, no está en ningún commit.

3. **Simulacro de restauración offsite final.** Antes de confiar el mundo real
   a los backups, un último drill DESDE la nube:
   `docker exec mc-ecosystem-backup-1 /scripts/restore-drill.sh --offsite`.
   Debe terminar en `SIMULACRO OK`. Anotarlo en la tabla de restauración.

4. **Borrar el mundo de staging.** *N/A a partir de v1.0*: prod monta un
   directorio propio (bind mount absoluto a
   `C:\Users\ADMIN\Documents\world-genesis-v1-paper-bukkit`, ver ADR-005)
   en vez de heredar `staging-data/`. Este item queda satisfecho por la
   propia arquitectura de `docker-compose.prod.yml` — no hay mundo que
   borrar. Si en el futuro un mundo naciera desde `staging-data/`, este
   item vuelve a aplicar.

5. **Verificar la whitelist definitiva.** Repoblar `whitelist.json` con los
   nombres reales de los jugadores, EXACTOS y por rcon (nunca por env, que
   resuelve UUIDs premium y rompe el modo offline — ver la sección de
   whitelist). Confirmar con `whitelist list` que están todos y solo ellos.

6. **Config de EventFX en valores de producción.** Desde v1.0 los configs
   de prod viven en `infra/configs-prod/` (separados de `infra/configs/`,
   que quedó como el de staging). Confirmar en
   `infra/configs-prod/plugins/EventFX/config.yml` que NO quedaron valores
   de prueba: haunting con relojes reales (apariciones 120 ±30 min en
   prod, sonidos 20-40 min, turnaround ~90 min), y decidir conscientemente
   `exempt` y las reglas de no-crueldad para el mundo real (v1.0 nació con
   `exempt: [Vancorbus]` — dueño exento — y no-crueldad desactivada,
   idéntico a staging). Arrancar y confirmar que EventFX no emite
   `[haunting config]` warnings.

7. **Copiar el jar de EventCollector al mundo.** El plugin es local (no
   está en `PLUGINS` del compose) — hay que compilarlo y copiarlo a mano
   antes del primer arranque, o toda la telemetría de gameplay va al
   vacío. Se aprendió en el nacimiento de v1.0 el 2026-07-24, cuando el
   plugin quedó sin desplegar y se corrigió 3 días después (ver
   "Despliegue inicial de EventCollector en prod" más abajo).

   Pasos:
   ```bash
   cd plugin && ./gradlew build
   cp plugin/build/libs/EventCollector-*.jar <world-dir>/plugins/
   ```
   Y versionar la config en `infra/configs-prod/plugins/EventCollector/config.yml`
   (itzg la interpola a `/data/plugins/EventCollector/config.yml` al
   arranque). Verificar en logs post-arranque:
   `EventCollector activo. Endpoint: ... | umbral AFK: 300s`.

## Backups — limitación crítica: crond depende del stack up

El servicio `backup` corre **crond dentro del contenedor**. Cuando el
stack se apaga (`stop-mc.bat`, `docker compose stop`, apagar Windows),
crond deja de correr y **ningún tick de backup ocurre**. Si el dueño
juega en sprints y apaga entre sesiones, pueden pasar días sin backup
aunque el schedule teórico sea cada hora / cada 6 h.

**Incidente 2026-07-26**: primer chequeo post-nacimiento. Snapshots
en `world-real`: 0 de `world`, 1 de `db` con fecha 2026-07-24 08:00 UTC
(capturado durante la sesión de diagnóstico del mundo BROKEN — dato
inválido). Entre el 2026-07-24 (fin sesión nacimiento) y hoy el stack
estuvo apagado; ningún tick de crond corrió. **RPO real desde el
nacimiento: infinito** hasta que el primer `world` haga snapshot.

**Ritual defensivo obligatorio al inicio de cada sesión**:

```bash
MSYS_NO_PATHCONV=1 docker exec mc-ecosystem-backup-1 \
    sh -c 'restic -r "$RESTIC_REPOSITORY_OFFSITE" snapshots'
```

Si el snapshot más reciente de `world` tiene >24 h, el gap es real y hay
que actuar (backup manual o dejar el stack up hasta que corra el próximo
tick automático — `15 */6 * * *`).

**Fix arquitectónico aplicado (2026-07-26)**:

- **Backup inmediato al arrancar**: `backup/entrypoint.sh` ejecuta
  `/scripts/backup.sh world` y `db` tras inicializar los repos, antes de
  arrancar crond. Cada `docker start` del servicio backup dispara un
  snapshot fresco (ambos en local y en offsite vía `restic copy`), así
  cada sesión abre con un restore point actualizado aunque la anterior
  haya sido hace semanas. Coste: +1-3 min al arranque del stack. Errores
  del backup inicial NO bloquean crond (fail-open por diseño; un backup
  inicial fallado es alerta, no razón para no tener crond corriendo).

Alternativa **no aplicada**, documentada por si más adelante conviene:

- **Scheduling externo**: mover el schedule a Windows Task Scheduler o
  a un cron del host, que arranque un contenedor one-shot para hacer el
  backup aunque el stack principal esté apagado. Independizaría los
  backups del ciclo de vida del stack, pero añade moving parts fuera
  del proyecto y complica el versionado.

## Tareas recurrentes

| Frecuencia | Tarea | Cómo |
|---|---|---|
| **Cada sesión** (al arrancar el stack) | Verificar snapshots frescos en offsite | Comando de arriba; si >24 h de gap en `world`, actuar |
| **Semanal** (lunes) | Revisar si CoreProtect ya soporta la versión de MC a la que queremos subir (hoy: 26.2, ver ADR-002) | `https://modrinth.com/plugin/coreprotect/versions` (muestra las versiones de MC soportadas por cada release). Si ya está: probar la subida en staging según ADR-002 |
| **Mensual** (día 1) | Simulacro de restauración, local Y offsite | `restore-drill.sh` y `restore-drill.sh --offsite`; anotar resultado en la tabla de la sección de restauración |

Para no depender de la memoria: en GitHub, entrar a
`https://github.com/PlayPro/CoreProtect` → Watch → Custom → **Releases** —
llega notificación/correo con cada release nuevo (el detalle de versiones de
MC soportadas se confirma en Modrinth).

## Acceso público (túnel playit.gg)

La dirección que usan los jugadores es:

```
work-framework.gl.joinmc.link
```

(sin puerto; usa el 25565 por defecto). Cómo funciona: el servicio `playit`
del compose (`infra/docker-compose.staging.yml`) mantiene un túnel saliente
hacia playit.gg — no hay puertos abiertos en el router. El secreto del agente
vive en `infra/.env` (`PLAYIT_SECRET_KEY`); el túnel se administra en el
dashboard de playit.gg (cuenta del admin) y su **Local Address debe ser
`minecraft-staging:25565`** — NO `127.0.0.1`: el agente corre en su propio
contenedor y localhost ahí no es el servidor (error clásico: "Connection
refused" en los logs del agente con conexiones llegando).

Verificado el 2026-07-17: conexión completa por el túnel, AuthMe rechazando
contraseña incorrecta, y whitelist rebotando a un jugador no listado.

**Ojo**: los OP están EXENTOS de la whitelist (comportamiento vanilla). Para
probar el rebote de whitelist con un jugador que es OP hay que quitarle
también el OP temporalmente.

## Resource pack público (quick tunnel de Cloudflare)

Los jugadores remotos no pueden descargar el pack de `localhost`: necesita una
URL pública. Lo sirve el servicio **`packserver`** (nginx) expuesto por un
**quick tunnel de Cloudflare** (`cloudflared`), sin cuenta, token ni dominio.

Se expone `packserver` y NADA más (mínimo privilegio): tunelizar la API
dejaría público `POST /events`, o sea inyección libre de eventos falsos.

### ⚠️ LIMITACIÓN CRÍTICA: la URL es EFÍMERA

El quick tunnel entrega una URL `https://xxx.trycloudflare.com` **distinta en
cada arranque de `cloudflared`**. No se puede fijar (para eso haría falta un
named tunnel, que exige un dominio propio en Cloudflare).

Consecuencias, sin rodeos:
- **Cada arranque ordenado del compose regenera la URL del pack.** La anterior
  muere en el acto.
- Si `cloudflared` se reinicia solo (crash), la URL publicada en
  `server.properties` queda muerta: los clientes fallan al descargar el pack
  y se quedan **sin música ni sonidos de haunting** (el juego sigue jugable).

### Orden correcto de arranque (NO levantar el compose a mano)

`depends_on` no ayuda: espera a que el contenedor arranque, no a que la URL
exista. Por eso hay un script que impone el orden:

```bash
bash infra/publish-pack-url.sh
```

Hace, en este orden estricto:
1. Levanta **solo** `packserver` + `cloudflared` (Minecraft todavía NO)
2. Espera a que la URL aparezca en los logs de `cloudflared`
3. **Verifica** con `curl` que `<url>/pack.zip` devuelve HTTP 200 (una URL
   registrada no garantiza que el edge ya esté enrutando)
4. Escribe `RESOURCE_PACK_URL` y `RESOURCE_PACK_SHA1` en `infra/.env`
5. **Recién entonces** recrea `minecraft-staging`

Si la URL no aparece o no responde, **aborta sin arrancar Minecraft**: mejor
un servidor sin pack que uno anunciando una descarga rota.

Los demás servicios (postgres, api, backup, playit) se pueden levantar antes
sin problema: son independientes del pack.

```bash
docker compose -p mc-ecosystem up -d postgres api backup playit
bash infra/publish-pack-url.sh
```

### ⚠️ Routers/ISP que filtran `trycloudflare.com`

Descubierto en vivo el 2026-07-22: el router de casa devolvía **NXDOMAIN**
para el hostname del túnel, mientras `1.1.1.1` y `8.8.8.8` lo resolvían
perfectamente. Es filtrado de DNS (los quick tunnels se abusan para phishing,
así que varios ISP/routers bloquean el dominio entero).

Síntoma: el pack **no se descarga** aunque el túnel esté impecable. El
servidor y el resto de internet lo ven bien; solo esa red no.

- **Verificación**: `publish-pack-url.sh` prueba con **DNS-over-HTTPS**
  (`--doh-url https://1.1.1.1/dns-query`) justamente para no dar un falso
  negativo por el resolutor local. La vista que importa es la de internet.
- **Arreglo para el jugador afectado**: poner DNS `1.1.1.1` o `8.8.8.8` en su
  adaptador de red (o en su router). Sin eso, ese jugador no recibirá el pack.
- Diagnóstico rápido:
  `nslookup <host>.trycloudflare.com 1.1.1.1` (si resuelve aquí pero no sin
  el `1.1.1.1`, es filtrado local).

Es un costo inherente del quick tunnel; un named tunnel con dominio propio
no sufre esto (ver ADR/decisión de no comprar dominio hoy).

### Si cloudflared se reinicia (URL nueva)

El script one-shot **no se re-dispara solo**. Dos opciones:
- Volver a correr `bash infra/publish-pack-url.sh` (idempotente).
- Dejarlo vigilando: `bash infra/publish-pack-url.sh --watch` — re-publica
  automáticamente cuando detecta que la URL cambió. Ojo: recrear Minecraft
  desconecta a los jugadores unos segundos, por eso solo actúa ante un cambio
  real de URL.

### Actualizar el pack (nuevo contenido → nuevo hash)

El SHA-1 es lo que hace que los clientes **re-descarguen solos** cuando el
pack cambia: Minecraft compara el hash declarado con el de su caché.

1. Cambiar los assets en `infra/resourcepack/` (añadir/reemplazar `.ogg`,
   editar `sounds.json`).
2. Regenerar el zip: `infra/resourcepack/build-pack.ps1` (usa .NET, no
   `Compress-Archive`: PowerShell 5.1 escribe rutas con `\` que Minecraft no
   sabe leer). El script imprime el SHA-1 nuevo.
3. Republicar: `bash infra/publish-pack-url.sh` — recalcula el SHA-1 solo,
   lo escribe en `.env` y recrea el servidor.
4. Verificar: entrar al servidor; el cliente debe re-descargar el pack (el
   hash cambió) y el pack debe aparecer **en blanco**, no en rojo. Si sale en
   rojo, es incompatibilidad de `pack_format` en `pack.mcmeta` (se lee del
   `version.json` del jar del cliente).

## Alta de un jugador nuevo

El servidor es offline-mode con whitelist + AuthMe (ver ADR-001). Para dar de
alta a alguien hacen falta DOS pasos y UN sermón:

1. **Whitelist** (consola o rcon), con el nombre EXACTO (mayúsculas incluidas):

   ```
   docker exec mc-ecosystem-minecraft-staging-1 rcon-cli "whitelist add <Nombre>"
   ```

   La whitelist vive en `whitelist.json` del volumen (`infra/staging-data/`)
   y sobrevive reinicios. NO se gestiona por env del compose: el
   sincronizador del contenedor resuelve nombres contra Mojang (UUIDs
   premium) y en modo offline eso escribe UUIDs equivocados que dejan a
   todo el mundo fuera. Siempre por rcon/consola, que genera el UUID
   offline correcto.

2. **Registro AuthMe**: en su primer login el jugador tiene 60 s para
   registrarse él mismo: `/register <contraseña> <contraseña>` (mínimo 8
   caracteres). No hace falta nada del lado del operador. Reconexiones desde
   la misma IP no piden `/login` durante 8 h (sesión).

3. **El sermón — regla de hierro del nombre**: díselo SIEMPRE al nuevo:
   *"Tu nombre es tu identidad. Si cambias el nombre en el launcher, para el
   servidor eres otra persona: pierdes inventario, progreso, whitelist y
   cuenta. No cambies de nombre, jamás."* (Motivo técnico en ADR-001.)

## Rituales de apagado

Los scripts `start-mc.bat` y `stop-mc.bat` (raíz del repo) son la vía normal
de arranque/apagado. `start-mc.bat` es idempotente: si el stack ya está sano
no hace nada, solo muestra estado y copia la URL del pack al portapapeles.

**Preferir doble-click desde el Explorador de Windows** en vez de invocarlos
desde Git Bash (`./start-mc.bat`). Motivo: son scripts `.bat` que corren
bajo `cmd.exe`, y ese entorno es el que se prueba en cada release. Desde
Bash pueden aparecer *warnings inofensivos* (mintty renderiza el `pause`
distinto, alguna línea de salida se buffea antes de tiempo) que no rompen
nada — el script termina en el mismo estado — pero confunden. Si Bash es
la única opción a mano, se puede invocar sin problemas y esos warnings se
ignoran; los fallos reales siempre se reflejan en `errorlevel` y aborto
explícito, no en el ruido de mintty.

Tres reglas duras:

1. **Ejecuta `stop-mc.bat` antes de apagar Windows.** El `stop` da a Paper
   la oportunidad de guardar el mundo y a EventFX de disparar
   `flushForShutdown` — es la diferencia entre un `session.end` limpio y
   una sesión huérfana como las que documenta la sección "Corte de luz".
2. **Nunca cierres Windows con contenedores vivos.** Windows corta a WSL
   sin cortesía y equivale a un corte de luz: mundos posiblemente medio
   guardados, eventos en vuelo perdidos y potencial corrupción de chunks.
   Si el `stop-mc.bat` falla, investígalo antes de apagar.
3. **UPS pequeño como plan a futuro.** Un SAI de ~500 VA da varios minutos
   de margen y permite un `stop-mc.bat` ordenado ante un apagón real. Es
   la única defensa real contra cortes; el búfer SQLite del plugin no
   protege contra apagados abruptos (lo aprendimos el 2026-07-22).

## Re-verificacion humana de features (registro)

Regla: un issue **no se considera cerrado del todo** hasta ejercitarlo en
vivo en el staging, aunque GitHub lo marque CLOSED. Los tests de MockBukkit
son necesarios pero no suficientes.

| Fecha | Issue | Cases verificados | Notas |
|---|---|---|---|
| 2026-07-23 | #4 (hielo Ki) | rastro efimero 8s, anti-puente al terminar, place bloqueado sobre rastro, crash-recovery convierte a agua | Bug de despliegue capturado: el jar en `infra/staging-data/plugins/` no siempre coincide con `build/libs/`. Al re-verificar, forzar el copy antes de reiniciar |

## Contenido comunitario del pack

Política de qué se acepta añadir al servidor (plugins, datapacks, assets del
resource pack). Vale por igual para mobiliario, minijuegos, mecánicas nuevas
o cualquier cosa que amplíe el mundo.

**1. Cero migración a Forge/Fabric, bajo ninguna circunstancia.** Es la línea
más gruesa. Todo el ecosistema (CoreProtect, AuthMe, SkinsRestorer,
PacketEvents, EventCollector, EventFX) son plugins de Paper; mover el server
a otro loader significa reescribir y republicar todo — no hay atajo. Si una
idea de contenido "sólo existe en Forge", la idea se descarta o se busca
alternativa; nunca se descarta el stack. Esto vetó a MrCrayfish's Furniture
el 2026-07-23: es mod de Forge/Fabric y su port aparente en formato
"datapack" no existe.

**2. Solo se aceptan datapacks + resource packs vanilla-compatibles.** Se
integran al `pack.zip` del repo (o al mundo, si es datapack) y viajan al
cliente por el flujo que ya tenemos (URL pública anunciada en
`server.properties`). Cero plugin adicional para "contenido decorativo",
cero requisito extra del cliente (nada de instalar mods).

**3. Antes de instalar, se evalúan opciones concretas.** No se acepta una
categoría abstracta ("mobiliario", "minijuegos") y se elige después: se
listan candidatos reales con enlace, se comparan contra los criterios
(no rompe balance, no requiere cliente especial, se descarga con el pack o
va al mundo como datapack, mantenimiento activo) y se decide. Los ADR
existen para dejar registro de este tipo de decisión cuando pesan.

*Backlog v1.1*: mobiliario decorativo (sillas, mesas, iluminación) →
issue #5, con criterios y antecedente ya escritos.

## Skins en modo offline (SkinsRestorer)

**Verificación de launcher: no aplica en modo offline.** SkinsRestorer muestra
por defecto un aviso de "estás usando Minecraft pirateado / cracked" a los
jugadores en modo offline. En nuestro servidor es un **falso positivo**:
corremos offline por diseño (ADR-001) y el plugin **no puede distinguir** una
cuenta original de una no oficial — su propia documentación lo admite
("SkinsRestorer cannot detect the exact launcher"), así que se lo muestra a
todo el mundo por igual.

Como no existe forma de silenciarlo selectivamente (solo el jugador puede
descartarlo a mano con `/skin notification ignore-cracked-client`), está
**desactivado globalmente** en `infra/configs/plugins/SkinsRestorer/config.yml`:

```yaml
login:
  offlineModeWarning:
    enabled: false
```

Consecuencia asumida: un jugador cuyo launcher SÍ rompa las skins tampoco verá
la pista. Si alguien reporta que su skin no se aplica, el diagnóstico manual
está en `https://skinsrestorer.net/docs/troubleshooting/launcher-issues`
(TLauncher y SKLauncher son los culpables habituales).

En modo offline Mojang no aplica skins: las gestiona SkinsRestorer. El
procedimiento depende del tipo de cuenta del jugador:

**Cuentas originales (premium):** no tienen que hacer nada — al entrar,
SkinsRestorer resuelve la skin premium del MISMO nombre automáticamente.
Si el jugador cambió su skin en minecraft.net y no se refleja, que ejecute
`/skin update` (la caché de skins expira sola cada 15 min).

**Cuentas no oficiales:** dos opciones en el juego:
- `/skin set <usuario-premium>` — copia la skin pública de cualquier cuenta
  original (ej. `/skin set Notch`).
- `/skin url <enlace>` — usa una skin propia desde un PNG accesible por URL
  (formato skin de Minecraft, 64x64). Pasa por el servicio MineSkin, y por
  defecto esas skins aparecen en su galería pública — no subir nada privado.

Otros útiles: `/skin clear` (volver a la skin por defecto), `/skins` (GUI
con recomendadas), `/sr` (admin: aplicar skins a otros, p. ej.
`/sr skin set <jugador> <skin>` desde consola).

## Restauración de backups

Los backups los toma el servicio `backup` del compose (`infra/backup/`): dump de
PostgreSQL cada hora en punto y mundo cada 6 h (a los :15), a un repositorio
restic con retención de 30 días. Cada ejecución emite un evento `backup.done`
a la API — **un `ok: false` o la ausencia del evento esperado es un incidente**.

### Simulacro de restauración (drill)

Con el entorno levantado:

```
docker exec mc-ecosystem-backup-1 /scripts/restore-drill.sh
```

El drill restaura el último snapshot de cada tag y verifica de verdad:
- **db**: el dump carga en una base temporal (`restore_drill`) con `pg_restore`
  y la tabla `events` responde a un `SELECT count(*)`.
- **world**: el mundo restaurado contiene `world/level.dat` no vacío.

Termina con `SIMULACRO OK` y exit code 0, o con los `[FAIL]` que encuentre y
exit code 1. Limpia solo la base temporal y el directorio de restauración.

### Regla: simulacro mensual obligatorio

**El primer día de cada mes se ejecuta el drill y se anota aquí el resultado.**
Un backup que nunca se ha restaurado no es un backup, es una esperanza. Si el
drill falla, arreglarlo es la prioridad operativa número uno: no hay ninguna
tarea del proyecto más importante que volver a tener backups restaurables.

| Fecha | Resultado | Notas |
|---|---|---|
| 2026-07-16 | OK | Drill inicial: dump con 2371 eventos cargado; level.dat presente |
| 2026-07-22 | OK offsite | Con `restic-prod-2` (rotacion B2): 12,509 eventos; level.dat 89.8 MiB |
| 2026-07-26 | OK offsite | Post-nacimiento: primer drill contra `world-real/` con `restic-prod-3` (rotacion B2), tras aplicar fix de backup-al-arrancar. Dump 13,334 eventos; world 222.343 MiB restaurado en 12s desde B2 (~19 MB/s); level.dat 4.0 KiB. Item 3 del checklist de nacimiento cerrado. |

### Restauración real (incidente)

Mismos pasos que el drill pero sobre el destino real:

1. `docker exec mc-ecosystem-backup-1 restic snapshots` — elegir snapshot
   (por defecto `latest`; ante corrupción, el último snapshot sano).
2. **DB**: restaurar el dump a un directorio temporal con
   `restic restore <id> --tag db --target /tmp/r` y cargarlo con
   `pg_restore -d mc_ecosystem --clean --if-exists <dump>` (o a una base
   nueva y renombrar, que es más seguro).
3. **Mundo**: parar el servidor (`docker compose -p mc-ecosystem stop
   minecraft-staging`), restaurar con `restic restore <id> --tag world
   --target /tmp/w`, reemplazar los directorios `world*` en
   `infra/staging-data/` y volver a arrancar.
4. Verificar: API `healthy`, el plugin conecta, y los eventos nuevos fluyen.

### Pérdida máxima de datos (RPO)

Arquitectura de dos líneas: repo restic **local** (`infra/backup-repo/`,
restauración rápida) + **offsite en Backblaze B2** (`b2:mc-ecosystem-backups`).
Cada backup se copia a B2 inmediatamente después de crearse en local
(`restic copy`); si la copia a la nube falla, el `backup.done` sale con
`ok: false` — tratarlo como incidente.

- **Desastre lógico** (borrado, corrupción, grief): restaurar del repo local.
  RPO: hasta **60 min** de eventos (+ búfer SQLite sin entregar) y **6 h** de
  mundo.
- **Muerte física del disco**: restaurar desde B2. RPO: **el mismo — hasta
  60 min de historia y 6 h de mundo** (lo que aún no viajaba en la copia
  horaria/6-horaria más reciente). Ya NO es "todo": el punto único de fallo
  se eliminó el 2026-07-16.
- Drill contra la nube: `restore-drill.sh --offsite` (mismas verificaciones,
  restaurando desde B2). Recomendado incluirlo en el simulacro mensual.

## Corte de luz: qué protege el búfer y qué no (limitación conocida)

Verificado en un corte real el **2026-07-22**.

**El búfer SQLite del plugin NO protege contra un corte de luz, y no puede.**
El búfer solo guarda eventos que el plugin *intentó* enviar y **fallaron**
(API caída con el servidor vivo). En un apagón mueren plugin, API y Postgres
**a la vez**: no existe esa ventana, y los eventos en vuelo simplemente nunca
llegaron a ninguna forma durable.

Evidencia del corte del 2026-07-22:
- Los últimos eventos (`03:36:32`) tienen `received_at ≈ ts` (~20 ms): fluían
  en tiempo real hasta el instante del corte.
- **No hay `server.stop`** de ese apagado → `onDisable` nunca corrió, prueba
  de que fue abrupto.
- Al arrancar, el plugin **no reportó eventos pendientes**: búfer vacío.

Que el mecanismo sí funciona se ve en los `server.stop` de reinicios
*ordenados*, que llevan la firma clásica: `ts` del apagado y `received_at`
~90-120 s después (esperaron en SQLite al siguiente arranque).

### `session.start` sin `session.end` (huérfanas)

El fix de `flushForShutdown` (commit 4824fdf) cierra las sesiones en apagados
**ordenados**, pero un corte de luz no da oportunidad de ejecutar nada. Queda
una `session.start` huérfana por cada jugador conectado en ese momento.

Detectarlas:

```sql
WITH s AS (
  SELECT id, player_uuid, ts, type,
         LEAD(type) OVER (PARTITION BY player_uuid ORDER BY ts) AS siguiente
  FROM events WHERE type IN ('session.start','session.end')
)
SELECT id, ts, COALESCE(siguiente,'(nada despues)') AS evento_siguiente
FROM s WHERE type='session.start' AND (siguiente IS NULL OR siguiente <> 'session.end')
ORDER BY ts;
```

Huérfanas conocidas a la fecha: `id 385` (2026-07-15, anterior al fix, de los
crashloops del desarrollo temprano) e `id 7921` (2026-07-22, el corte de luz).

**Implicación para Insight**: el cálculo de tiempo jugado **debe tolerar
sesiones sin cierre** (ignorarlas, o cerrarlas con el último evento conocido
de ese jugador). Nunca asumir que toda `session.start` tiene su `session.end`.
Y jamás "arreglarlas" con UPDATE: el catálogo es append-only; si algún día se
quiere corregir, se hace con eventos nuevos.

## Warnings de prod — estado

Los logs de arranque de `minecraft-prod` emiten warnings que ya se han
diagnosticado uno por uno. Esta tabla es su bitácora: cuando en 6 meses
vuelvas a leer un log y veas uno de estos, sabrás si es intencional o
un problema.

| Warning | Fecha 1ª detección | Estado | Notas |
|---|---|---|---|
| `resource-pack-id missing, using default of 3c563052-...` | 2026-07-26 | **Resuelto** | Se pinó ese mismo UUID como `RESOURCE_PACK_ID` en `docker-compose.prod.yml`. Rotar sólo si el pack cambia radicalmente. |
| `[AuthMe] No supported permissions system found!` | 2026-07-26 | **Aceptado** | AuthMe busca LuckPerms / PermissionsEx / GroupManager para grupos jerárquicos y cae al `permissions.yml` nativo de Bukkit cuando no encuentra ninguno. Con el modelo actual (1-3 jugadores, 1 OP, `permissions.yml` cubre SkinsRestorer) no hay caso de uso para grupos. Instalar LuckPerms sólo por callar el warning suma un plugin más que mantener y version-lockear — más frágil sin beneficio real. **Re-evaluar si** el server pasa de ~10 jugadores, o si aparece necesidad de roles diferenciados (moderador, admin distinto de OP, etc.). Mismo criterio que aplicamos con GeoIP: threat/complejidad no justifica hoy. |
| `[AuthMe] GeoIp protections will be disabled` | 2026-07-26 | **Deferido, opt-in** | Requiere cuenta MaxMind (gratis con GeoLite2) → license key + account ID en `.env` como `MAXMIND_LICENSE_KEY` / `MAXMIND_ACCOUNT_ID`. Sin cuenta, se acepta como warning informativo. Para nuestra threat model (3 amigos whitelisted, offline mode, IP filtering) el valor es marginal. Ver "Activar GeoIP" abajo si un día conviene. |

### Activar GeoIP en AuthMe (opt-in)

Prerrequisito: cuenta MaxMind (gratis en <https://www.maxmind.com/en/geolite2/signup>).
Genera una license key desde tu cuenta y anota tu account ID numérico.

Pasos:

1. Añadir a `infra/.env`:
   ```
   MAXMIND_LICENSE_KEY=<tu-key>
   MAXMIND_ACCOUNT_ID=<tu-id>
   ```

2. Habilitar substitución de env vars en `docker-compose.prod.yml`
   añadiendo al environment de `minecraft-prod`:
   ```yaml
   REPLACE_ENV_VARIABLES: "TRUE"
   REPLACE_ENV_VARIABLES_PREFIX: "MAXMIND_"
   ```

3. Añadir a `infra/configs-prod/plugins/AuthMe/config.yml`:
   ```yaml
   Security:
     GeoLiteAPI:
       licenseKey: '${MAXMIND_LICENSE_KEY}'
       accountId: ${MAXMIND_ACCOUNT_ID}
   ```
   (verificar el path exacto contra el `config.yml` que AuthMe deja en
   `/data/plugins/AuthMe/` tras el primer arranque; puede haber cambiado
   entre versiones).

4. Recrear el contenedor: `docker compose -f infra/docker-compose.dev.yml
   -f infra/docker-compose.prod.yml -p mc-ecosystem up -d --force-recreate
   minecraft-prod`.

5. Verificar en logs: el warning debe desaparecer y aparecer un mensaje
   estilo *"GeoLite2 database updated"*. Si aparece *"invalid MaxMind
   credentials"*, revisar key/id.

## Verificación de runtime tras un fix

Regla institucional (ver **ADR-011**): ningún fix se considera cerrado
hasta que un comando lea del artefacto en runtime y confirme que
ejecuta el output del último commit. El código fuente no es
autoritativo por sí solo — sólo lo que ya está cargado en el proceso
determina el comportamiento observable.

Origen de la regla: **BUG-02** tuvo tres intentos de corrección
(02A/02B/02C) porque el fix mergeado en git nunca se rebuild en la
imagen Docker del bot. La auditoría de 02C reveló que el runtime
ejecutaba código anterior al fix. Mismo patrón que **ADR-007** con
el plugin EventCollector, 3 semanas antes.

Comandos exactos por tipo de servicio:

### Servicios TS/Node en Docker (bot, api, futuros workers)

```
# Confirma que la imagen del contenedor corresponde al último build.
docker image inspect <imagen> --format '{{.Created}} {{.Id}}'
docker inspect <container> --format '{{.Image}}'
# → los dos IDs deben coincidir.

# Verifica que un símbolo del fix vive en el artefacto compilado.
docker exec <container> sh -c 'grep -c <simbolo-del-fix> /app/dist/<ruta>'
# → debe ser >= 1.
```

Ejemplo real (BUG-02C, verificación final):

```
$ docker exec mc-ecosystem-bot-1 sh -c \
    'grep -c isFreshEvent /app/dist/handlers/server-stopped-handler.js'
1
$ docker image inspect mc-ecosystem-bot --format '{{.Created}}'
2026-08-03T06:22:11Z
```

### SPA en Docker con nginx (genesis, dashboards)

Vite hashea los assets por contenido. Si el hash del bundle no cambia
tras un fix, el runtime sigue sirviendo el bundle anterior.

```
# Bundle activo en el navegador.
curl -sI http://<host>:<puerto>/ | grep -i etag
curl -s http://<host>:<puerto>/ | grep -oE 'assets/index-[^"]+\.js'

# Confirma un símbolo del fix dentro del bundle servido.
curl -s http://<host>:<puerto>/assets/<hash>.js | grep -c '<simbolo>'
```

### Plugin Java en Minecraft server

El `.jar` copiado a `plugins/` no garantiza que el servidor lo cargó —
Paper puede rechazar el jar (versión API incompatible, dependencia
faltante) y seguir corriendo con el anterior o sin plugin.

```
# Fecha y presencia del jar en el filesystem del server.
docker exec mc-ecosystem-minecraft-prod-1 ls -la /data/plugins/ | grep -i <plugin>

# Versión que el server realmente cargó (via RCON).
docker exec mc-ecosystem-minecraft-prod-1 rcon-cli plugins
docker exec mc-ecosystem-minecraft-prod-1 rcon-cli version <PluginName>
```

### Config estática montada por bind mount

```
docker exec <container> md5sum /path/inside/container
md5sum /path/on/host
# → deben coincidir. Si difieren, el bind mount está sirviendo una
#   ruta distinta o el archivo se editó dentro del contenedor.
```

### Regla operacional

Al terminar un fix, incluir la línea de evidencia en el commit
message o reporte final:

```
Runtime verification:
  <comando exacto>
  → <output que confirma el marcador>
```

Su ausencia es el olor que delata un fix "cerrado" que en realidad
nunca corrió. Ver también **`start-mc.bat`** — usa
`docker compose up -d --build` para el bot y demás servicios con
código vivo del repo (aplicación operacional de ADR-011).

## CI · gates automáticos

Definido en `.github/workflows/ci.yml`. Ampliación de la sección
anterior: la **verificación de runtime** captura deploy drift
(código correcto que no se cargó en el contenedor); **CI captura
regresiones a nivel fuente** (código nuevo que rompe algo). Las
dos son complementarias y ninguna sustituye a la otra.

### Cuándo corre

En cada `push` a la rama `main`. No se dispara por push a ramas
secundarias ni por pull requests — el proyecto opera linealmente
sobre `main`. Ampliar el trigger es one-liner en el YAML el día que
se adopte flujo de branches.

### Qué corre (5 jobs paralelos)

| Job | Working dir | Comando(s) | Falla si |
|---|---|---|---|
| **plugin** | `plugin/` | `./gradlew build` | Compilación Java, tests MockBukkit, o Spotless fallan. |
| **eventfx** | `eventfx/` | `./gradlew build` | Igual que plugin. |
| **api** | `api/` | `npm ci` + `npm run typecheck` + `npm test` | `tsc --noEmit` reporta error, o `vitest run` falla. |
| **bot** | `bot/` | `npm ci` + `npm run typecheck` + `npm test` | Igual que api. |
| **genesis** | `genesis/` | `npm ci` + `npm run typecheck` + `npm test` | Igual, con `tsc -b --noEmit` (project references). |

Los 5 corren en paralelo sobre `ubuntu-latest`. Duración típica:
~2-4 min para el más lento (plugin/eventfx por Gradle). Cache de
`~/.npm` y del wrapper de Gradle activo entre runs — segundos runs
del mismo commit son mucho más rápidos.

### Cómo interpretar fallos

1. **Encontrar el run**: Actions tab del repo GitHub → columna
   "CI" del commit rojo. La URL es
   `https://github.com/<owner>/<repo>/actions/runs/<id>`.
2. **Job en rojo**: click al job fallido. La UI muestra los pasos
   con ✓/✗; el primer ✗ es la causa raíz.
3. **Logs del step**: click al step ✗ → panel de output completo.
   Los mensajes de `tsc` incluyen fichero:línea:columna; los de
   `vitest` incluyen el describe/it y el assertion diff.

### Reglas de higiene

- **No mergees a `main` con CI en rojo.** El proyecto no tiene
  branch protection habilitado hoy — depende de disciplina manual.
  Si un push queda rojo, el siguiente commit debe arreglarlo antes
  de continuar con features.
- **CI no reemplaza el test local.** `npm test` en tu máquina
  atrapa fallos en 2 s; CI tarda 3 min y consume minutos de
  Actions gratis. Corre local primero, empuja segundo.
- **CI no reemplaza la verificación de runtime.** Un run verde
  significa "el código fuente compila y sus tests pasan". No
  significa "la imagen Docker en prod ejecuta ese código". Ver la
  sección **"Verificación de runtime tras un fix"** para el paso
  complementario obligatorio.
- **Actions minutes**: repos privados tienen cuota mensual limitada
  (2.000 min/mes gratis). Con trigger `push: main` únicamente, el
  gasto real es ≤1 ejecución por commit — muy holgado.

### Añadir un job nuevo

Cuando llegue un servicio nuevo con código vivo (worker de Insight,
backend del dashboard, plugin adicional):

1. Copiar uno de los jobs `api`/`bot`/`genesis` como plantilla.
2. Ajustar `working-directory`, `cache-dependency-path` y el
   comando de test.
3. Correr `npm run typecheck && npm test` en local primero para
   confirmar que los scripts existen y pasan.
4. Añadir sección al runbook si el servicio tiene reglas de
   operación propias (ver **"Operación de \<servicio\>"** cuando se
   creen).

## Despliegues iniciales

### Despliegue inicial de EventCollector en prod — 2026-07-26

El nacimiento del mundo real (2026-07-24, ver ADR-006) **NO incluyó el
plugin EventCollector**. Se corrige 3 días después, con historia de
gameplay perdida entre esas fechas — aceptado como fecha real de inicio
de captura.

**Diagnóstico** (query a `events` el 2026-07-26 antes del despliegue):
- 2026-07-15 → 07-23: **13 253 eventos** (23 tipos) de gameplay en
  staging. Es todo el histórico "de reporte" que hemos venido consultando.
- 2026-07-24: 114 eventos, sólo `server.*`, `event.end` (cierre de torneo)
  y `backup.done`. Coletazos del último día de staging + primer arranque
  broken de prod. Cero gameplay.
- 2026-07-25 → 2026-07-26 pre-arranque: cero eventos del plugin, sólo
  `backup.done` del script `backup.sh` (que no depende del plugin).

**Causa raíz**: EventCollector no está en el `PLUGINS` list del compose
(el plugin es local, no publicado — se compila desde `plugin/` y se
copia a mano). Al nacer prod desde el mount limpio de Chunker, la
carpeta `plugins/` no tenía `EventCollector*.jar`. Nadie hizo el copy.

**Pasos aplicados**:

1. Build local: `cd plugin && ./gradlew build` → `plugin/build/libs/EventCollector-0.1.0.jar`
2. Config versionado: nuevo `infra/configs-prod/plugins/EventCollector/config.yml`
   con `afk_threshold_seconds: 300` y `position_sample_seconds: 60`
   (idénticos al default de `plugin/src/main/resources/config.yml`).
3. Copy manual del jar a `C:\Users\ADMIN\Documents\world-genesis-v1-prod\plugins\`.
4. Force-recreate de `minecraft-prod` (vía `start-mc.bat` con doble-click,
   que además publica URL fresca del pack y ejercita el health-check loop).
5. Verificación en logs: `EventCollector activo. Endpoint:
   http://api:3000/events | umbral AFK: 300s | muestreo posicion: 60s`.
6. Verificación end-to-end en vivo por el dueño: entró 34 s, colocó y
   rompió 5 bloques, envió un mensaje de chat, salió. Todos los eventos
   capturados con UUID correcto (`71804e99-...`), coords coherentes,
   tool detectada, chat con contenido (decisión A), duración exacta,
   IP hasheada.

**Pérdida aceptada**: **~63 h de "el mundo real existía pero nadie lo
miraba en telemetría"** (2026-07-24 08:17 UTC → 2026-07-26 23:25:52 UTC).
En la práctica pérdida cero: no hubo gameplay real en ese intervalo,
sólo arranques + verificaciones + drills. Pero conceptualmente marca el
**cutoff de la captura del mundo real: 2026-07-26 23:25:52 UTC** (primer
`server.start` con EventCollector cargado). Todo lo anterior en la tabla
`events` es staging histórico o coletazos administrativos.

**Preventivo para próximos despliegues** (v1.1+, otros mundos): añadir
el copy del jar EventCollector a `plugins/` como **paso obligatorio del
checklist de nacimiento**. Si en el futuro el plugin se publica en
Modrinth o similar, migrarlo al `PLUGINS` list del compose y retirar
esta rugosidad manual.

## Retención de events (política ADR-012)

La tabla `events` está sujeta a la política de retención definida en
`docs/adr/012-politica-retencion-events.md`. Ventana rodante de 24 meses,
export mensual a Backblaze B2 con checkpoint SHA-256, purga sólo tras
checksum verificado, 8 tipos de evento perpetuos. **Todo el subsistema
está desplegado desde el 2026-08-08 en modo `EVENTS_PRUNE_DRY_RUN=true`**
y así se mantiene hasta que el primer batch real esté por vencer
(~2028-07). Durante ese tiempo el cron se ejercita mensualmente para
prevenir bit-rot pero no sube nada ni borra nada.

### Verificación de runtime tras deploy (ADR-011)

Después de cualquier rebuild del contenedor `api`, verificar que el
subsistema quedó cargado con las señales esperadas:

```bash
docker exec mc-ecosystem-api-1 sh -c \
  'grep -c PERPETUAL_EVENT_TYPES /app/dist/prune/perpetual-types.js'
# → 1 (constante presente en runtime)

docker exec mc-ecosystem-api-1 printenv EVENTS_PRUNE_DRY_RUN
# → true (default operativo del ADR-012 D5)

docker exec mc-ecosystem-api-1 printenv DATABASE_URL_PRUNE | grep -o 'mc_pruner'
# → mc_pruner (rol dedicado del ADR-012 D2)

# Logs del scheduler al arrancar el api:
docker logs mc-ecosystem-api-1 2>&1 | grep -i 'ADR-012'
# → "ADR-012 · scheduler de retención activo"
```

Si el `printenv EVENTS_PRUNE_DRY_RUN` devuelve vacío o "false" sin que
haya habido una decisión explícita del dueño, el deploy quedó
desconfigurado: revertir antes de dejarlo correr solo.

### Ejecución manual del prune (dry-run)

El endpoint `POST /admin/events/prune` NO está expuesto al exterior
(no hay ruta en cloudflared/playit hacia `/admin/*`). Se invoca
desde dentro de la red interna de compose:

```bash
docker exec mc-ecosystem-api-1 sh -c \
  'curl -s -X POST http://localhost:3000/admin/events/prune \
     -H "X-Admin-Token: $ADMIN_PRUNE_TOKEN" \
     -H "Content-Type: application/json" \
     -d "{}"'
```

Respuesta esperada en dry-run:

```json
{
  "dry_run": true,
  "results": [
    { "period": "2024-08", "status": "dry_run", "row_count": 12345,
      "size_bytes": 234567, "sha256_local": "…", "b2_object_key": "archive/events/events-2024-08.jsonl.gz" }
  ]
}
```

Para forzar un mes concreto (útil en tests): `-d '{"period":"2024-08"}'`.

### Consultar la bitácora del archivado

```bash
docker exec mc-ecosystem-postgres-1 psql -U mc -d mc_ecosystem -c \
  "SELECT period, status, row_count, size_bytes, archived_at, purged_at
     FROM events_archive_log
     ORDER BY archived_at DESC LIMIT 20;"
```

Los meses con `status='ok'` y `purged_at IS NOT NULL` están fuera de
la base caliente. Los `status='dry_run'` son ejercitaciones sin
efecto — presentes durante toda la ventana de activación segura.

### Apagar dry-run cuando llegue el primer vencimiento real (~2028-07)

1. Confirmar que `events_archive_log` tiene ≥12 filas con `status='dry_run'`
   correlativas (código ejercitado mensualmente sin fallos).
2. Confirmar que las credenciales B2 (`B2_ACCOUNT_ID`, `B2_ACCOUNT_KEY`)
   siguen válidas — correr un backup regular y verificar en el panel B2.
3. Editar `infra/.env` y cambiar `EVENTS_PRUNE_DRY_RUN=false`.
4. `docker compose up -d --build api` (regla ADR-011 para propagar cambio
   de env al runtime).
5. Verificar con `printenv EVENTS_PRUNE_DRY_RUN → false`.
6. Invocar el endpoint manualmente una vez ANTES de esperar al cron:
   verifica el flujo completo real bajo supervisión humana.
7. Revisar `events_archive_log` — debe aparecer una fila `status='ok'`
   por cada mes vencido, y `SELECT count(*) FROM events` debe caer
   proporcionalmente.

Si algún paso falla, revertir a `EVENTS_PRUNE_DRY_RUN=true` y rebuild
antes de investigar. La tabla `events_archive_log` es la fuente de
verdad para diagnóstico — muestra qué se intentó y por qué falló.

## Historial de incidentes

Registro de incidentes en producción. Cada entrada captura contexto,
causa raíz, detección y fix — y la lección estructural que motiva
cambios en el sistema para evitar recurrencia. **Preferir escribir aquí
poco pero útil** a escribir mucho y ritual: cada incidente que se
documenta debe cambiar algo (proceso, código o arquitectura).

### Incidente 001 · cursor del bot atascado por permisos Discord (2026-08-03 → 2026-08-09)

**Contexto.** El `cursor.json` del bot Pulso (`infra/bot-data/cursor.json`)
no avanzó del `event_id=14172` durante 6 días naturales. Los primeros
5 días (2026-08-03 06:35 UTC → 2026-08-08 13:00 UTC) fueron **servidor
Minecraft parado** — no entraron eventos nuevos, el cursor no tenía
nada que procesar; el `updated_at` del cursor quedó estampado en el
2026-08-03 porque fue la última vez que efectivamente avanzó. El
**atasco real** empezó el 2026-08-08 13:05:35 UTC cuando llegó el
`event_id=14173` (`type=backup.done`, `event_uuid=b6e93a41-1e9d-4dd0-9719-443caf701dbe`).

**Causa raíz.** `DiscordAPIError[50013] Missing Permissions` del bot en
el canal donde `BackupHandler` publica los eventos `backup.done`. El
consumer lanzaba `PublishError` en cada intento; el `PollingEngine`,
respetando su invariante at-least-once documentado
(ver [bot/src/polling/polling-engine.ts](../bot/src/polling/polling-engine.ts),
paso 5 de la secuencia y comentario "El cursor jamas se actualiza antes
de que el callback termine OK"), **correctamente** no avanzaba el
cursor. Reintentos cada ~5-30s durante ~28 horas: **500+ eventos**
acumulados detrás del 14173. **No es bug de código; es configuración
Discord** (permisos del bot en el canal target).

**Detección.** Aparición **durante el diagnóstico previo a la
implementación de ADR-013** (Fase A.3 del roadmap). Fue el propio
chequeo de "¿cuál es el volumen del bot?" el que reveló que el cursor
llevaba días congelado. El healthcheck del contenedor bot (`GET /health
→ 200` cuando el cliente Discord está `ready`) reportó `healthy` todo
el tiempo porque **el atasco ocurría en el consumer, invisible para el
healthcheck actual** — que sólo mide conectividad con Discord, no
capacidad efectiva de publicar en canales.

**Fix aplicado (2026-08-09).**
1. **Permisos corregidos por el dueño** en Discord: `Send Messages` +
   `Embed Links` + `View Channel` en los canales target del bot.
2. **Auto-recuperación**: al arreglar los permisos, el bot procesó los
   ~500 pendientes en cadena sin intervención — el at-least-once del
   engine se comportó como se esperaba y avanzó el cursor de `14172`
   → `14832` (último id en el momento del fix). Los canales de Discord
   recibieron una ráfaga de mensajes viejos (ruido efímero aceptable).
3. **Skip clean del cursor**: descartado por innecesario tras la
   auto-recuperación. Se registró como opción de contingencia en el
   runbook por si volviera a hacer falta (`docker compose stop bot` →
   editar `infra/bot-data/cursor.json` con `event_id` y `updated_at`
   ISO-8601 → `docker compose start bot`).
4. **Republicado selectivo**: no aplicado. Los eventos se republicaron
   todos como parte de la auto-recuperación; no hubo pérdida de datos
   (la tabla `events` es append-only por ADR-009, íntegra).

**Aprendizaje que motiva ADR-013 (FASE A.3).** El patrón
**retry-eterno-sin-backoff-ni-DLQ = atasco silencioso** que este
incidente encarna es exactamente lo que ADR-013 va a cerrar. Cambios
concretos derivados:

- **Retry acotado con backoff exponencial + jitter**: cada evento
  fallido reintenta N veces con delays crecientes; tras el tope, va a
  la DLQ. Nunca más un evento monopolizando el consumer indefinidamente.
- **Circuit breaker**: si un handler falla en tanda (N fallos en T
  segundos), se abre el circuit y los eventos nuevos van a DLQ sin
  intentar publicar. Se cierra automáticamente cuando pasa la ventana.
- **Dead-letter queue** (`dead_letter_events` en Postgres): registro
  auditable de qué se descartó y por qué. Endpoint `POST /admin/dlq/replay`
  para reproducir manualmente cuando la causa raíz esté arreglada.
- **Observabilidad estructurada**: cada intento fallido emite JSON line
  con `correlation_id`, `attempt`, `error_type`, `circuit_state`. Un
  `grep` sobre logs habría contado 500+ instancias del mismo `event_uuid`
  y detectado el atasco en segundos, no en días.
- **Nota abierta sobre healthchecks**: el `GET /health` actual del bot
  mide conectividad con Discord, no capacidad de publicar. Un
  healthcheck futuro debería incorporar "¿el cursor avanzó en las
  últimas N horas de actividad esperada?" — queda anotado como
  potencial trabajo post-A.3, no dentro de ADR-013 para no ampliar
  scope.

## Historial de retiros

Registro de componentes decommissioned tras alcanzar v1.0. La política es
**preservar antes de borrar** hasta tener la red de seguridad equivalente
en su lugar (backup en B2, ADR que la reemplace, etc.); las fechas aquí
son las de la eliminación efectiva, posterior a la validación.

| Fecha | Componente | Motivo y red de seguridad |
|---|---|---|
| 2026-07-26 | Container `mc-ecosystem-minecraft-staging-1` (`docker rm`) | Deployment secuencial: staging permanentemente atrás desde el nacimiento del 2026-07-24 (ADR-004). El bind mount `infra/staging-data/` en el host se conserva por si en el futuro se reactiva staging para pruebas de subida de versión (ADR-002); el container en sí no aportaba valor apagado. |
| 2026-07-26 | Carpeta `C:\Users\ADMIN\Documents\world-genesis-v1-paper-bukkit-BROKEN\` (497 MB) | Intento fallido de reorganización manual a Bukkit split (ADR-005, superseded por ADR-006). Reemplazada por `world-genesis-v1-prod/` en formato unified. Redes de seguridad al borrar: `world-genesis-v1-paper/` (backup Chunker íntegro, 220 MB) + `world-genesis-v1.zip` (export original, 169 MB) + snapshot fresco de `world-real/` en B2 (222 MiB, drill verificado el 2026-07-26). |
