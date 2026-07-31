# Deuda técnica del ecosistema

Registro vivo de decisiones aplazadas y trabajos pendientes que
cumplen el objetivo funcional actual pero comprometen mantenibilidad,
consistencia o robustez a largo plazo.

Cada item lleva un ID `TD-<nnn>` correlativo. Los items no se borran;
cuando uno se resuelve se marca su estado como `Resolved` con
referencia al commit / PR que lo cerró.

---

## TD-001 · Sincronizar catálogos de Minecraft con recursos oficiales

**Descripción**

El catálogo actual de advancements
(`bot/src/minecraft/advancement-catalog.ts`, introducido en el commit
`fa6e3b0 feat(minecraft): translate vanilla advancements` como parte
de Pulso v1.1) fue construido manualmente utilizando conocimiento
previo de las traducciones oficiales de Mojang, **no** mediante los
archivos oficiales de traducción de Minecraft Java Edition
(`es_es.json`, `es_mx.json`, etc.).

Los dos ejemplos que motivaron la funcionalidad
(`minecraft:story/mine_stone` → "Edad de Piedra" y
`minecraft:story/enter_the_end` → "El End... ¿Otra vez?") coinciden
con la traducción oficial. El resto de las 77 entradas puede tener
divergencias menores de puntuación, orden de palabras o registro
respecto a la fuente canónica de Mojang, y no han sido verificadas
contra el resource pack oficial.

**Objetivo futuro**

Cuando el proyecto incorpore un proceso de generación de recursos o
una etapa de build, sustituir los catálogos manuales por generación
automática a partir de los archivos oficiales de Mojang
(`es_es.json` / `es_mx.json` o el idioma que adopte el proyecto).

Alcance esperable del ticket futuro:

- extraer los strings de advancement del resource pack oficial;
- extraer los strings de las demás categorías cuando se añadan sus
  catálogos hermanos previstos en `bot/src/minecraft/`
  (entity-catalog, dimension-catalog, biome-catalog,
  enchantment-catalog, effect-catalog);
- proceso reproducible y automatizable por versión de Minecraft.

**Motivación**

- Evitar diferencias de traducción respecto al cliente oficial.
- Mantener compatibilidad entre versiones de Minecraft.
- Facilitar la actualización cuando Mojang publique nuevas versiones
  con advancements/entidades nuevas.
- Evitar mantenimiento manual entrada por entrada.

**Estado**

Deferred. Se acepta el catálogo manual actual como aproximación
funcionalmente correcta para Pulso v1.1. No requiere acción hasta
que se planifique el trabajo mencionado.

**Referencias**

- Commit del catálogo manual: `fa6e3b0`.
- Módulo afectado: `bot/src/minecraft/`.

---

## TD-002 · Narrativas contextuales para Death Chronicle

**Descripción**

El motor narrativo actual de Death Chronicle
(`bot/src/minecraft/death-catalog.ts`, introducido en el commit
`b150f17 feat(minecraft): introduce death chronicle catalog` como
parte de Pulso v1.1) selecciona una frase basándose únicamente en
dos señales del evento: la `cause` de daño (`DamageCause` de Bukkit)
y opcionalmente el `killer_mob` (namespaced key). El resto del
contexto del evento se descarta.

El flujo actual es:

```
cause (+ killer_mob)
    ↓
categoría (lookup)
    ↓
pool de frases
    ↓
selección aleatoria uniforme
    ↓
frase
```

Esto produce narraciones correctas y con personalidad, pero planas:
todas las muertes por lava se cuentan igual independientemente de si
ocurrieron en el Overworld o el Nether, de día o de noche, con
diamante o desnudo, en una base o explorando; todas las muertes por
Creeper se cuentan igual sin distinguir si el jugador estaba huyendo
de una horda de zombies o construyendo tranquilamente.

**Objetivo futuro**

En Insight (v2) el motor narrativo deberá construir la narración
utilizando el contexto completo del evento, no sólo la causa. La
arquitectura debe evolucionar hacia:

```
DeathContext (evento + contexto enriquecido)
    ↓
Narrative Engine (reglas + selección contextual)
    ↓
Narrative (frase construida a partir del contexto real)
```

Señales a incorporar al `DeathContext` (subset esperado, ampliable):

- dimensión (Overworld / Nether / End)
- asesino (jugador / mob / entorno)
- arma o proyectil concreto que remató
- tipo de entidad y variante (baby zombie ≠ husk ≠ drowned)
- dificultad del servidor
- coordenadas (bioma "reconocible", altura Y, distancia al spawn)
- tiempo del mundo (día / noche / amanecer)
- clima (lluvia, tormenta)
- bioma concreto
- estadísticas del jugador (equipamiento, salud previa,
  encantamientos, efectos activos)
- historial reciente del jugador (racha de muertes, tiempo desde el
  último respawn, actividad previa)

El nuevo motor deberá:

- reemplazar la selección uniforme por un ranking o composición
  basada en el contexto;
- permitir plantillas paramétricas (no sólo frases cerradas);
- mantener la política de fidelidad al evento (no inventar
  entidades, causas ni jugadores);
- mantener el fallback a `data.message` vanilla cuando el contexto
  no alcanza a producir una narración.

**Motivación**

- Elevar la calidad narrativa: menos repetición percibida, mayor
  variedad efectiva por evento.
- Diferenciar situaciones que hoy colapsan en la misma frase.
- Aprovechar el contexto que el plugin ya emite (o puede emitir) y
  que el catálogo actual descarta.
- Preparar el terreno para Insight (v2), donde el motor narrativo
  será un componente de primera clase reutilizado por varios
  productos del ecosistema.

**Estado**

Deferred. Se acepta el catálogo actual con selección por causa como
solución funcionalmente correcta para Pulso v1.1. No requiere acción
hasta que se planifique Insight (v2).

**Referencias**

- Commit del catálogo actual: `b150f17`.
- Módulo afectado: `bot/src/minecraft/death-catalog.ts`.
- Handler afectado: `bot/src/handlers/player-death-handler.ts`.
