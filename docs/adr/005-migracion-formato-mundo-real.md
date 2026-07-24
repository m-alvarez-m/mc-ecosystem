# ADR-005: Migración del mundo real al formato Bukkit split

- **Fecha**: 2026-07-24
- **Estado**: **superseded por ADR-006** (2026-07-24, mismo día). La
  premisa central ("Paper 26.1.2 necesita Bukkit split") era falsa; Paper
  26 usa formato unified. La reorganización manual descrita aquí produjo
  un mount que Paper cargó sólo parcialmente (nether y end migrados
  correctamente por Paper al arrancar, overworld ignorado y regenerado
  desde cero). Ver ADR-006 para el diagnóstico y la ruta correcta.

## Contexto

El mundo real de v1.0 nació en el cliente vanilla del dueño (Minecraft
Java 26.2) y viajó al servidor a través de Chunker. Paper 26.1.2 (ADR-002)
necesita el mundo en **formato Bukkit split** (`world/`, `world_nether/DIM-1/`,
`world_the_end/DIM1/`), pero Chunker sólo sabe exportar al **formato unified**
oficial de Minecraft Java (desde 1.18: `dimensions/minecraft/{overworld,the_nether,the_end}/`
en un único árbol con `level.dat` raíz y `players/` en la raíz). Paper es
la excepción que conserva el split legacy.

Este mismatch se descubrió en vivo el 2026-07-24. La secuencia real de
intentos fue:

1. **Chunker export #1** → `world-genesis-v1.zip` (168 MB, descomprimido
   como `world-genesis-v1/`). Formato Forge unified (`serverconfig/forge-server.toml`,
   `dimensions/`, `players/`).
2. **Diagnóstico erróneo del asistente**: recomendó re-exportar en Chunker
   *"seleccionando la opción Java Server (Paper/Bukkit)"*. **Esa opción no
   existe** en Chunker.
3. **Chunker export #2** → `world-genesis-v1-paper/` (220 MB). Sigue siendo
   unified: sólo se removió `forge-server.toml`. El asistente admitió el
   error y propuso reorganización manual.
4. **Reorganización manual** (dry-run + copia aprobada por el dueño en
   dos preguntas explícitas) → `world-genesis-v1-paper-bukkit/` (220 MB).
   Origen `world-genesis-v1-paper/` **no se tocó**: la operación fue una
   copia con reubicación, no un mv.

## Decisión

1. El mundo real que monta `docker-compose.prod.yml` es
   `C:\Users\ADMIN\Documents\world-genesis-v1-paper-bukkit\` (formato
   Bukkit split, validado a mano).
2. `world-genesis-v1-paper/` **se conserva intacto** como red de seguridad
   hasta el primer backup exitoso de prod a B2 (`world-real/` sub-repo).
   Después se puede archivar/borrar sin riesgo.
3. `world-genesis-v1.zip` (export #1) **se conserva permanentemente**:
   es la única semilla desde la que se puede reconstruir el mundo si el
   directorio Bukkit se corrompe antes del primer backup.
4. En el futuro, cualquier nuevo mundo que venga de Chunker pasa por el
   mismo proceso de reorganización manual antes de tocar el compose. Si
   este patrón se repite más de una vez, se automatiza como script en
   `infra/tools/chunker-to-paper.sh`.

## Mapeo de la reorganización

```
world-genesis-v1-paper/                world-genesis-v1-paper-bukkit/
(unified/Chunker)                      (Bukkit split/Paper)

level.dat                          →   world/level.dat
data/                              →   world/data/           (fusionado con overworld)
dimensions/minecraft/overworld/    →   world/
  ├── region/                          ├── region/           (30 .mca, 184 MB)
  ├── poi/                             ├── poi/
  └── data/                            └── data/             (fusionado con raíz)
dimensions/minecraft/the_nether/   →   world_nether/DIM-1/
  ├── region/                          ├── region/           (16 .mca, 37 MB)
  ├── poi/                             ├── poi/
  └── data/                            └── data/
dimensions/minecraft/the_end/      →   world_the_end/DIM1/
  └── data/                            └── data/             (vacío: End nunca cargado)
players/{owner.dat}                →   world/playerdata/{owner.dat}
```

Total: 220 MB → 220 MB (paridad esperada, sólo cambia el layout).

## Consecuencias

- **Pérdidas irrecuperables aceptadas por escrito** (el dueño no tiene
  backup previo a Chunker): `advancements/` per-player, `stats/`
  per-player, `icon.png`. `entities/` como directorio separado desapareció
  entre el zip original y el export #2 de Chunker (probable rebote de
  entidades hacia `region/`); el dueño lo asume.
- **`itzg/minecraft-server` poblará el directorio en el primer arranque**
  con `plugins/`, `whitelist.json`, `ops.json`, `server.properties`,
  `banned-players.json`, etc. El mundo pasa a ser un directorio de
  servidor completo, no sólo datos de mundo.
- **`world-genesis-v1-paper-bukkit/` deja de ser sólo mundo**: tras el
  primer arranque contiene también config de servidor. Cambiar el mundo
  ya no es "swap del directorio"; hay que preservar los archivos
  auxiliares.
- **El bucket B2 sub-repo `world-real/`** se convierte en la única red
  de seguridad efectiva tras el primer arranque. Antes del arranque, la
  red es `world-genesis-v1-paper/` + `world-genesis-v1.zip`.

## Aprendizajes

- **Chunker no tiene opción "Paper/Bukkit"**: exporta unified format y
  Paper es la excepción. La documentación oficial del proyecto (Modrinth,
  wiki de Chunker) no explicita esto; el asistente lo asumió por
  extrapolación y perdió una re-conversión del dueño.
- **Diagnósticos ambiguos se verifican en un archivo real antes de
  pedir una re-conversión de 30 minutos**: el asistente aceptó como
  hipótesis lo que era comprobable con un `ls` de 3 directorios.
- **Backups locales antes de tocar formato**: hacer copia (no mv) es
  obligatorio hasta confirmar que el destino arranca. Aquí se cumplió,
  aunque por casualidad — el patrón se explicita ahora en el runbook.
