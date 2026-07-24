# ADR-006: Paper 26 usa formato unified, no Bukkit split

- **Fecha**: 2026-07-24
- **Estado**: aceptado
- **Supersede**: ADR-005

## Contexto

ADR-005 se escribió sobre una premisa que resultó ser falsa: *"Paper
26.1.2 necesita el mundo en formato Bukkit split (`world/`,
`world_nether/DIM-1/`, `world_the_end/DIM1/`)"*. Con esa premisa se
descartó el export de Chunker (formato unified) y se reorganizó a mano.

En el primer arranque de v1.0 (2026-07-24, ~01:46 local) el mundo se
cargó a medias:

- **Overworld ignorado**: Paper leyó `world/dimensions/minecraft/overworld/`
  (vacío) en lugar de `world/region/` (donde estaban nuestros 184 MB de
  overworld reorganizado). Al no encontrar chunks generó **un mundo
  nuevo desde cero** en la ruta unified. Vancorbus spawneó en `(4.5,
  123.0, 0.5)` — spawn calculado sobre terreno fresco, no en su base.
- **Nether y End sí migraron**: Paper 26 detecta las carpetas legacy
  `world_nether/` y `world_the_end/` como export a migrar y las copia
  al layout unified (`world/dimensions/minecraft/the_nether/` y
  `.../the_end/`), borrando el original al terminar. Los archivos .mca
  del nether importado quedaron con el mismo tamaño y timestamp que la
  copia manual — Paper respetó los datos, sólo cambió su ubicación.
- **Playerdata en ruta muerta**: `world/playerdata/00000000-...dat`
  (el Bukkit split legacy) nunca lo leyó Paper. El estado activo de
  Vancorbus vive en `world/players/data/71804e99-...dat` (ruta unified)
  con inventario vacío — jugador nuevo desde la perspectiva del servidor.

## Decisión

1. El formato del mundo real es **unified** (el que exporta Chunker por
   defecto), sin reorganización manual. Layout definitivo montado en
   `/data` del contenedor:

   ```
   /data/
   ├── world/
   │   ├── level.dat
   │   ├── data/                       ← world-scoped
   │   ├── dimensions/
   │   │   └── minecraft/
   │   │       ├── overworld/{region,poi,data,entities}
   │   │       ├── the_nether/{region,poi,data}
   │   │       └── the_end/{data}
   │   └── players/
   │       └── data/<uuid>.dat         ← playerdata unified
   ├── plugins/                        ← itzg
   ├── whitelist.json                  ← itzg
   └── ...
   ```

2. El mount de prod pasa de
   `C:\Users\ADMIN\Documents\world-genesis-v1-paper-bukkit\` (roto,
   archivado con sufijo `-BROKEN`) a
   `C:\Users\ADMIN\Documents\world-genesis-v1-prod\`. Dentro hay una
   sola subcarpeta `world/` con el contenido íntegro del backup Chunker
   (`world-genesis-v1-paper/`).

3. El `.dat` de Vancorbus se renombra **antes** del primer arranque, de
   `00000000-0000-0000-0000-000000000000.dat` (el que Chunker guardó)
   a `71804e99-f2aa-32dc-bfcb-0ea5cfdda708.dat` (su UUID offline). Así
   Paper carga su inventario y posición desde el primer login, sin tocar
   `/kill` para saltar de posición ni perder items.

4. `world-genesis-v1-paper-bukkit-BROKEN/` se preserva hasta el primer
   backup exitoso de prod al sub-repo B2 `world-real/`. Después se
   archiva o borra.

## Cómo se calcula el UUID offline

Paper (Bukkit) deriva UUID en modo offline como:

```java
UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(UTF_8))
```

Equivalente en bash (validado contra el UUID que Paper puso en los logs
del primer arranque):

```bash
name="Vancorbus"
hex=$(printf "OfflinePlayer:%s" "$name" | md5sum | awk '{print $1}')
c=${hex:16:1}
case "$c" in
  0|4|8|c) y=8;; 1|5|9|d) y=9;; 2|6|a|e) y=a;; 3|7|b|f) y=b;;
esac
uuid="${hex:0:8}-${hex:8:4}-3${hex:13:3}-${y}${hex:17:3}-${hex:20:12}"
# → 71804e99-f2aa-32dc-bfcb-0ea5cfdda708
```

Guardar este cómputo en el runbook: cuando un jugador nuevo necesite
recuperar playerdata externo, es el paso obligatorio antes del rename.

## Consecuencias

- **v1.0 arranca por segunda vez** con mount limpio. La sesión anterior
  (01:52 → 02:05 UTC) queda en `-BROKEN/`, no cuenta como histórica.
- Ningún dato original perdido: el backup Chunker (`world-genesis-v1-paper/`)
  se conserva y es el origen de la copia. La única sesión de juego
  ocurrida en el mundo Paper-regenerado fueron ~13 min de Vancorbus
  spawneando y muriéndose una vez — todo descartado con el `-BROKEN`.
- **Pérdida mental aceptada**: la fecha inaugural del mundo real ya no
  es "el primer login que hicimos", es este segundo arranque. El
  `FIRST_LOGIN_DATE` del `.env` se puede mantener en `24-07-2026` porque
  sigue siendo el mismo día.
- **Aprendizaje operativo**: la próxima vez que llegue un mundo desde
  Chunker (o cualquier export externo), **arrancar Paper directamente
  sobre el layout unificado tal cual sale del exporter**, sin
  reorganizar. Si Paper no lo carga, mirar los logs del primer arranque
  ANTES de tocar el disco — Paper es explícito sobre qué rutas espera
  y qué está migrando.
- **Aprendizaje sobre asistente**: ADR-005 se escribió con confianza
  excesiva sobre el formato de Paper (no verificado contra docs
  oficiales ni contra un primer arranque real). El patrón a evitar:
  documentar como decisión lo que en realidad es una hipótesis no
  probada. Regla nueva: cambios estructurales sobre datos migrados se
  validan con un arranque de sacrificio ANTES de escribir el ADR.

## Verificación

Antes del segundo arranque, verificar en `world-genesis-v1-prod/`:

```
world/
├── level.dat                                             (existe)
├── data/minecraft/                                       (existe)
├── dimensions/minecraft/overworld/region/*.mca           (30 archivos, 184 MB)
├── dimensions/minecraft/the_nether/region/*.mca          (16 archivos, 37 MB)
├── dimensions/minecraft/the_end/data/                    (existe, sin region)
└── players/data/71804e99-...dat                          (renombrado, 737 bytes)
```

Después del segundo arranque, verificar en logs de Paper:

- **`UUID of player Vancorbus is 71804e99-f2aa-32dc-bfcb-0ea5cfdda708`**
  (mismo UUID, para que el rename tenga efecto).
- **`logged in with entity id X at (...)`** — coordenadas del singleplayer,
  NO cerca de `(4.5, 123.0, 0.5)` (spawn del mundo regenerado).
- Sin warnings de tipo `Failed to load chunk` o `Regenerating region`.
