# Runbook

Procedimientos operativos para desplegar, monitorear y recuperar el sistema ante incidentes.

## Tareas recurrentes

| Frecuencia | Tarea | Cómo |
|---|---|---|
| **Semanal** (lunes) | Revisar si CoreProtect ya soporta la versión de MC a la que queremos subir (hoy: 26.2, ver ADR-002) | `https://modrinth.com/plugin/coreprotect/versions` (muestra las versiones de MC soportadas por cada release). Si ya está: probar la subida en staging según ADR-002 |
| **Mensual** (día 1) | Simulacro de restauración, local Y offsite | `restore-drill.sh` y `restore-drill.sh --offsite`; anotar resultado en la tabla de la sección de restauración |

Para no depender de la memoria: en GitHub, entrar a
`https://github.com/PlayPro/CoreProtect` → Watch → Custom → **Releases** —
llega notificación/correo con cada release nuevo (el detalle de versiones de
MC soportadas se confirma en Modrinth).

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
