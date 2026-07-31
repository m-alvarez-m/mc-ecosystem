// Barrel del módulo `minecraft/`.
//
// Alberga catálogos estáticos de traducciones oficiales de Minecraft
// (nombres legibles a partir de identificadores internos). Cada
// catálogo vive en su propio archivo `<concepto>-catalog.ts`. Añadir
// un nuevo catálogo (entities, dimensions, biomes, enchantments,
// effects…) = añadir un archivo hermano + su export aquí. Sin
// reorganización necesaria.
//
// Este módulo es fuente para todos los consumers del ecosistema que
// necesiten mostrar nombres humanos a partir de IDs de Minecraft:
// Pulso (v1.1), Insight (v2.0), Genesis (v4.0). Todos leen del mismo
// diccionario canónico.

export { ADVANCEMENT_CATALOG } from "./advancement-catalog";
export type { Advancement } from "./advancement-catalog";

export { narrateDeath } from "./death-catalog";
export type { DeathInput } from "./death-catalog";
