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
