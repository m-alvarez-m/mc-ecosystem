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

   *Registro histórico de rotaciones (staging):*
   | Fecha | Clave | Motivo |
   |---|---|---|
   | 2026-07-22 | `restic-prod-2` (reemplaza a la original) | La original pasó por chat de desarrollo |

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

4. **Borrar el mundo de staging.** El mundo real nace limpio, no hereda las
   pruebas. Con el servidor parado: borrar `infra/staging-data/world*`
   (o empezar con un `staging-data/` nuevo). Ojo: esto también resetea
   `haunting.json` y los datos locales del plugin — es lo deseado.

5. **Verificar la whitelist definitiva.** Repoblar `whitelist.json` con los
   nombres reales de los jugadores, EXACTOS y por rcon (nunca por env, que
   resuelve UUIDs premium y rompe el modo offline — ver la sección de
   whitelist). Confirmar con `whitelist list` que están todos y solo ellos.

6. **Config de EventFX en valores de producción.** Confirmar en
   `infra/configs/plugins/EventFX/config.yml` que NO quedaron valores de
   prueba: haunting con relojes reales (apariciones ~105 min, sonidos 20-40
   min, turnaround ~90 min), y decidir conscientemente `exempt` y las reglas
   de no-crueldad para el mundo real (en staging quedaron: exempt vacío,
   no-crueldad desactivada). Arrancar y confirmar que EventFX no emite
   `[haunting config]` warnings.

## Tareas recurrentes

| Frecuencia | Tarea | Cómo |
|---|---|---|
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
