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

export { narrateDimension } from "./dimension-catalog";
export type { DimensionChronicleInput } from "./dimension-catalog";

export { narrateServerMilestone } from "./server-milestone-catalog";
export type { ServerMilestoneInput } from "./server-milestone-catalog";

export { narrateBossKill } from "./boss-catalog";
export type { BossKillInput } from "./boss-catalog";

export { narratePvpKill } from "./pvp-catalog";
export type { PvpKillInput } from "./pvp-catalog";

export { narrateCraft } from "./craft-catalog";
export type { CraftInput } from "./craft-catalog";

export { narrateVillagerTrade } from "./villager-trade-catalog";
export type { VillagerTradeInput } from "./villager-trade-catalog";

export { narrateProgress } from "./progress-catalog";
export type { ProgressInput, EnchantEntry } from "./progress-catalog";

export { narrateTechnology } from "./technology-catalog";
export type { TechnologyInput } from "./technology-catalog";

export { narrateExploration } from "./exploration-catalog";
export type { ExplorationInput } from "./exploration-catalog";
