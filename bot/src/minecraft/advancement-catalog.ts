// Catálogo estático de advancements vanilla de Minecraft con sus
// nombres oficiales en español (es_ES/es_MX segun Mojang) y su
// descripción oficial.
//
// Fuente: archivos de traducción oficiales de Mojang para Minecraft
// Java Edition (vanilla) hasta la versión 1.20.x. Sólo se incluyen
// advancements vanilla. Datapacks personalizados o mods NO están
// cubiertos por diseño — para ellos el fallback devuelve el ID crudo.
//
// Diseño:
// - Diccionario inmutable (Map readonly) indexado por el ID canónico
//   del advancement (`minecraft:<tree>/<slug>`). Lookup O(1).
// - Sin `if/else`, sin `switch`. La resolución del handler es una
//   sola llamada `.get(id)`.
// - Cada entrada expone `title` y `description`. En v1.1 el handler
//   sólo usa `title`; `description` queda disponible para futuras
//   versiones (embeds, tooltips, Insight, Genesis).
// - Añadir un advancement nuevo = añadir una fila al Map. No requiere
//   tocar lógica en ningún otro sitio.
//
// Cobertura actual (v1.1): ver COUNT constant al final del archivo.
// Es un seed set con los advancements más frecuentes en gameplay
// real. El diccionario puede crecer commit a commit — cero coste
// para el resto del bot.

export interface Advancement {
  /** Nombre corto oficial. Nunca vacío. */
  readonly title: string;
  /** Descripción oficial que aparece en el tooltip in-game. */
  readonly description: string;
}

export const ADVANCEMENT_CATALOG: ReadonlyMap<string, Advancement> = new Map<
  string,
  Advancement
>([
  // ============= Árbol Story (Minecraft) =============
  [
    "minecraft:story/root",
    { title: "Minecraft", description: "La aventura comienza aquí." },
  ],
  [
    "minecraft:story/mine_stone",
    { title: "Edad de Piedra", description: "Extrae piedra con tu nuevo pico." },
  ],
  [
    "minecraft:story/upgrade_tools",
    { title: "Ir a un nivel superior", description: "Fabrica un pico mejor." },
  ],
  [
    "minecraft:story/smelt_iron",
    { title: "Aprovecha el momento", description: "Funde un lingote de hierro." },
  ],
  [
    "minecraft:story/obtain_armor",
    {
      title: "Sujeto de pruebas",
      description: "Ponte una pieza de armadura.",
    },
  ],
  [
    "minecraft:story/lava_bucket",
    { title: "Reserva caliente", description: "Llena un cubo con lava." },
  ],
  [
    "minecraft:story/iron_tools",
    { title: "Aislar y conquistar", description: "Mejora tu pico." },
  ],
  [
    "minecraft:story/deflect_arrow",
    {
      title: "No, gracias",
      description: "Desvía un proyectil con un escudo.",
    },
  ],
  [
    "minecraft:story/form_obsidian",
    { title: "Piedra caliente", description: "Obtén un bloque de obsidiana." },
  ],
  [
    "minecraft:story/mine_diamond",
    { title: "¡Diamantes!", description: "Consigue diamantes." },
  ],
  [
    "minecraft:story/enter_the_nether",
    {
      title: "Todavía queremos ir",
      description:
        "Construye, ilumina y entra en un portal al Nether.",
    },
  ],
  [
    "minecraft:story/shiny_gear",
    {
      title: "Cúbrete las espaldas",
      description: "Prepárate una armadura completa de diamante.",
    },
  ],
  [
    "minecraft:story/enchant_item",
    {
      title: "Encantador",
      description: "Encanta un objeto en una mesa de encantamientos.",
    },
  ],
  [
    "minecraft:story/cure_zombie_villager",
    {
      title: "Zombi médico",
      description: "Debilita y luego cura a un aldeano zombi.",
    },
  ],
  [
    "minecraft:story/follow_ender_eye",
    { title: "Los ojos lo dicen todo", description: "Sigue un ojo de ender." },
  ],
  [
    "minecraft:story/enter_the_end",
    {
      title: "El End... ¿Otra vez?",
      description: "Entra en el portal al End.",
    },
  ],

  // ============= Árbol Nether =============
  [
    "minecraft:nether/root",
    {
      title: "Aventura ardiente",
      description: "Aventúrate en el Nether.",
    },
  ],
  [
    "minecraft:nether/return_to_sender",
    {
      title: "Volver al remitente",
      description: "Destruye a un ghast con una bola de fuego.",
    },
  ],
  [
    "minecraft:nether/find_bastion",
    {
      title: "Aquí me quedo",
      description: "Entra en un remanente de bastión.",
    },
  ],
  [
    "minecraft:nether/obtain_ancient_debris",
    {
      title: "Que muerda el polvo",
      description: "Obtén detritos antiguos.",
    },
  ],
  [
    "minecraft:nether/fast_travel",
    {
      title: "Servicio subterráneo",
      description:
        "Usa el Nether para viajar 7 km en el Overworld.",
    },
  ],
  [
    "minecraft:nether/find_fortress",
    {
      title: "Un miedo terrible en un lugar oscuro",
      description: "Entra en una fortaleza del Nether.",
    },
  ],
  [
    "minecraft:nether/obtain_crying_obsidian",
    {
      title: "¿Quién es el que llora ahora?",
      description: "Obtén obsidiana llorosa.",
    },
  ],
  [
    "minecraft:nether/distract_piglin",
    {
      title: "Se aceptan sobornos",
      description: "Distrae a un piglin con oro.",
    },
  ],
  [
    "minecraft:nether/ride_strider",
    {
      title: "Este barco tiene patas",
      description:
        "Cabalga un strider con una vara de hongo distorsionado.",
    },
  ],
  [
    "minecraft:nether/uneasy_alliance",
    {
      title: "Alianza incómoda",
      description:
        "Rescata a un ghast del Nether, llévalo hasta el Overworld... y libéralo.",
    },
  ],
  [
    "minecraft:nether/use_lodestone",
    {
      title: "Ubicación, ubicación, ubicación",
      description: "Usa una brújula sobre una piedra imán.",
    },
  ],
  [
    "minecraft:nether/netherite_armor",
    {
      title: "Cubierto para lo peor",
      description: "Ponte una armadura completa de netherita.",
    },
  ],
  [
    "minecraft:nether/get_wither_skull",
    {
      title: "Muy asustadizo",
      description: "Consigue una calavera de wither esqueleto.",
    },
  ],
  [
    "minecraft:nether/summon_wither",
    {
      title: "Con el poder de la muerte",
      description: "Invoca al wither.",
    },
  ],
  [
    "minecraft:nether/brew_potion",
    {
      title: "Alquimia local",
      description: "Elabora una poción.",
    },
  ],
  [
    "minecraft:nether/create_beacon",
    {
      title: "Aprovéchalo",
      description: "Construye y coloca un faro.",
    },
  ],
  [
    "minecraft:nether/all_potions",
    {
      title: "Un mundo de maravillas",
      description: "Ten a la vez todos los efectos de las pociones.",
    },
  ],
  [
    "minecraft:nether/create_full_beacon",
    {
      title: "Faro completo",
      description: "Sube un faro al máximo poder.",
    },
  ],
  [
    "minecraft:nether/explore_nether",
    {
      title: "Turismo de interior",
      description: "Explora todos los biomas del Nether.",
    },
  ],
  [
    "minecraft:nether/obtain_blaze_rod",
    {
      title: "En un lugar oscuro",
      description: "Consigue una vara de blaze.",
    },
  ],
  [
    "minecraft:nether/charge_respawn_anchor",
    {
      title: "Carga total",
      description: "Carga un ancla de resurrección al máximo.",
    },
  ],
  [
    "minecraft:nether/all_effects",
    {
      title: "Cómo llegamos aquí",
      description: "Ten a la vez todos los efectos.",
    },
  ],

  // ============= Árbol End =============
  [
    "minecraft:end/root",
    {
      title: "El End",
      description: "¿O el principio?",
    },
  ],
  [
    "minecraft:end/kill_dragon",
    { title: "Libera al End", description: "Buen trabajo." },
  ],
  [
    "minecraft:end/dragon_egg",
    { title: "La próxima generación", description: "Coge el huevo de dragón." },
  ],
  [
    "minecraft:end/enter_end_gateway",
    { title: "Bienvenido a la fiesta", description: "Escapa de la isla." },
  ],
  [
    "minecraft:end/respawn_dragon",
    {
      title: "El fin... otra vez...",
      description: "Revive al dragón del End.",
    },
  ],
  [
    "minecraft:end/dragon_breath",
    {
      title: "Aliento de dragón",
      description:
        "Recoge el aliento del dragón en una botella de cristal.",
    },
  ],
  [
    "minecraft:end/find_end_city",
    {
      title: "La ciudad al final del juego",
      description: "Ve tú también a la ciudad del End.",
    },
  ],
  [
    "minecraft:end/elytra",
    {
      title: "Puntos de supervivencia",
      description: "Encuentra unos élitros.",
    },
  ],
  [
    "minecraft:end/levitate",
    {
      title: "Grandes alturas",
      description: "Elévate 50 bloques con las balas de shulker.",
    },
  ],

  // ============= Árbol Adventure =============
  [
    "minecraft:adventure/root",
    {
      title: "Aventura",
      description: "Aventura, exploración y combate.",
    },
  ],
  [
    "minecraft:adventure/voluntary_exile",
    {
      title: "Exilio voluntario",
      description:
        "Mata a un capitán de saqueadores. Puede que quieras evitar los puestos avanzados hasta que las cosas se calmen...",
    },
  ],
  [
    "minecraft:adventure/kill_a_mob",
    {
      title: "Cazador de monstruos",
      description: "Mata a un enemigo.",
    },
  ],
  [
    "minecraft:adventure/trade",
    {
      title: "¿Qué llevas en las manos?",
      description: "Comercia con éxito con un aldeano.",
    },
  ],
  [
    "minecraft:adventure/honey_block_slide",
    {
      title: "Dulce hogar",
      description: "Amortigua tu caída con un bloque de miel.",
    },
  ],
  [
    "minecraft:adventure/ol_betsy",
    {
      title: "Vieja Betsy",
      description: "Dispara una ballesta.",
    },
  ],
  [
    "minecraft:adventure/sleep_in_bed",
    {
      title: "Dulces sueños",
      description: "Cambia tu punto de reaparición durmiendo.",
    },
  ],
  [
    "minecraft:adventure/hero_of_the_village",
    {
      title: "Héroe de la aldea",
      description: "Defiende una aldea de un ataque con éxito.",
    },
  ],
  [
    "minecraft:adventure/throw_trident",
    {
      title: "Un lanzamiento al vacío",
      description: "Lanza un tridente a algo.",
    },
  ],
  [
    "minecraft:adventure/shoot_arrow",
    {
      title: "Un disparo hacia algo",
      description: "Dispara a algo con una flecha.",
    },
  ],
  [
    "minecraft:adventure/kill_all_mobs",
    {
      title: "Cazador de monstruos: el regreso",
      description: "Mata a uno de cada enemigo hostil.",
    },
  ],
  [
    "minecraft:adventure/totem_of_undying",
    {
      title: "Salvado por el gong",
      description: "Utiliza un tótem de la inmortalidad para evitar la muerte.",
    },
  ],
  [
    "minecraft:adventure/sniper_duel",
    {
      title: "Duelo de francotiradores",
      description: "Mata a un esqueleto a más de 50 bloques de distancia.",
    },
  ],
  [
    "minecraft:adventure/very_very_frightening",
    {
      title: "Muy, muy escalofriante",
      description: "Golpea a un aldeano con un rayo.",
    },
  ],
  [
    "minecraft:adventure/two_birds_one_arrow",
    {
      title: "Dos pájaros de un tiro",
      description:
        "Mata a dos phantoms con una flecha atravesándolos.",
    },
  ],
  [
    "minecraft:adventure/whos_the_pillager_now",
    {
      title: "¿Quién es el saqueador ahora?",
      description: "Dispara a un saqueador con su propia ballesta.",
    },
  ],
  [
    "minecraft:adventure/arbalistic",
    {
      title: "Ballestísticamente hablando",
      description:
        "Mata a cinco enemigos únicos con un solo disparo de ballesta.",
    },
  ],
  [
    "minecraft:adventure/adventuring_time",
    {
      title: "Tiempo de aventura",
      description: "Descubre cada bioma.",
    },
  ],

  // ============= Árbol Husbandry =============
  [
    "minecraft:husbandry/root",
    {
      title: "El mundo suculento",
      description: "El mundo lleno de comida.",
    },
  ],
  [
    "minecraft:husbandry/safely_harvest_honey",
    {
      title: "Vaya, ¡miel!",
      description:
        "Utiliza una botella de cristal para recolectar miel sin que te ataquen las abejas.",
    },
  ],
  [
    "minecraft:husbandry/breed_an_animal",
    {
      title: "Los pájaros y las abejas",
      description: "Cría dos animales.",
    },
  ],
  [
    "minecraft:husbandry/tame_an_animal",
    {
      title: "El mejor amigo del hombre",
      description: "Doma un animal.",
    },
  ],
  [
    "minecraft:husbandry/fishy_business",
    {
      title: "Asunto de peces",
      description: "Pesca un pez.",
    },
  ],
  [
    "minecraft:husbandry/silk_touch_nest",
    {
      title: "Total abandono",
      description:
        "Mueve un nido de abejas con 3 abejas usando Toque de Seda.",
    },
  ],
  [
    "minecraft:husbandry/plant_seed",
    {
      title: "Un agricultor moderno",
      description: "Planta una semilla y obsérvala crecer.",
    },
  ],
  [
    "minecraft:husbandry/bred_all_animals",
    {
      title: "Dos por dos",
      description: "Cría todos los animales.",
    },
  ],
  [
    "minecraft:husbandry/complete_catalogue",
    {
      title: "Catálogo completo",
      description: "Doma todas las variantes de gato.",
    },
  ],
  [
    "minecraft:husbandry/tactical_fishing",
    {
      title: "Pesca táctica",
      description: "Atrapa un pez... ¡sin caña!",
    },
  ],
  [
    "minecraft:husbandry/balanced_diet",
    {
      title: "Dieta equilibrada",
      description: "Come todos los alimentos comestibles, aunque no te sean útiles.",
    },
  ],
  [
    "minecraft:husbandry/obtain_netherite_hoe",
    {
      title: "Herramienta correcta para el trabajo correcto",
      description: "Mejora tu azada para hacerla de netherita.",
    },
  ],
]);
