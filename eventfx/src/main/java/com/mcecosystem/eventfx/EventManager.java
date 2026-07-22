package com.mcecosystem.eventfx;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.title.Title;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.data.Levelled;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.plugin.Plugin;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.scheduler.BukkitTask;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Ciclo de vida del Modo Evento: convocatoria a la zona mas despejada,
 * skins del pool, secuencia dramatica, buffs, banda sonora, rafagas,
 * caminar sobre el agua y event.start/event.end del catalogo.
 * NO captura datos: eso es de EventCollector.
 */
public final class EventManager implements Listener {

    /** Quien recibio que skin; va tal cual al data de event.start. */
    public record Assignment(String player, String skin) {}

    /** Toda la configuracion del evento (config.yml). */
    public record Settings(
            List<String> skinPool,
            int durationSeconds,
            String startSound,
            String endSound,
            String musicSound,
            int musicLoopSeconds,
            boolean burstsEnabled,
            int burstIntervalSeconds,
            int burstMaxCount,
            int burstSpeedLevel,
            int burstSpeedSeconds,
            int burstJumpLevel,
            int burstJumpSeconds,
            int burstImmunitySeconds,
            // Convocatoria: TP de todos a la zona mas despejada.
            boolean summonEnabled,
            int summonCountdownSeconds,
            int venueScanRadius,
            int venueHeadroomCap,
            // Caminar sobre el agua (tipo Frost Walker, con hielo escarchado).
            boolean iceWalkEnabled,
            int iceWalkRadius) {}

    private static final long SEQUENCE_TICKS = 100L; // 5 s hasta PODER MAXIMO
    /** Tope duro del radio de hielo: nadie puede configurar "congela el oceano". */
    private static final int ICE_RADIUS_MAX = 3;

    private final Plugin plugin;
    private final SkinService skins;
    private final EventOutput output;
    private final StateStore stateStore;
    private final Settings settings;
    // Inyectado para que los tests corran la fase de skins de forma
    // determinista (en produccion: scheduler async de Bukkit).
    private final java.util.concurrent.Executor asyncExecutor;

    private StateStore.State active;
    private BukkitTask autoEndTask;
    private BukkitTask musicTask;
    private BukkitTask burstTask;
    private int burstCount;
    /** Lookup O(1) de participantes vivos del evento en curso. */
    private final Set<UUID> activeParticipants = new HashSet<>();
    /** Participantes offline al terminar: al reconectar hay que limpiarlos. */
    private final Map<UUID, StateStore.SavedLocation> pendingCleanup = new HashMap<>();
    /** Momento en que expira el evento (para re-aplicar el tiempo RESTANTE). */
    private long endsAtMillis;

    public EventManager(Plugin plugin, SkinService skins, EventOutput output,
                        StateStore stateStore, Settings settings,
                        java.util.concurrent.Executor asyncExecutor) {
        this.plugin = plugin;
        this.skins = skins;
        this.output = output;
        this.stateStore = stateStore;
        this.settings = settings;
        this.asyncExecutor = asyncExecutor;
        this.pendingCleanup.putAll(stateStore.loadPendingCleanup());
    }

    // ---------- inicio ----------

    public synchronized boolean start(String name, CommandSender feedback) {
        if (active != null) {
            feedback.sendMessage("Ya hay un evento activo: " + active.name());
            return false;
        }
        List<Player> players = List.copyOf(plugin.getServer().getOnlinePlayers());
        if (players.isEmpty()) {
            feedback.sendMessage("No hay jugadores conectados.");
            return false;
        }
        if (settings.skinPool().size() < players.size()) {
            feedback.sendMessage("El pool de skins (" + settings.skinPool().size()
                    + ") es menor que los jugadores online (" + players.size()
                    + "). Amplia skin_pool en config.yml.");
            return false;
        }

        // La sede solo puede estar en el Overworld: en el Nether el techo de
        // bedrock hace absurdo el "cielo abierto", y convocar al End arriesga
        // muertes por vacio que la cascada de retorno no puede prevenir en la
        // ida. Sin nadie en Overworld, el evento NO empieza.
        Player venue = null;
        if (settings.summonEnabled()) {
            venue = chooseVenue(players);
            if (venue == null) {
                feedback.sendMessage("Nadie esta en el Overworld: el evento no puede iniciar.");
                Title aviso = Title.title(
                        Component.text("⚠ El Ki necesita cielo abierto", NamedTextColor.GOLD),
                        Component.text("reunanse en el Overworld", NamedTextColor.YELLOW),
                        Title.Times.times(Duration.ofMillis(300),
                                Duration.ofMillis(3000), Duration.ofMillis(500)));
                players.forEach(p -> p.showTitle(aviso));
                return false;
            }
        }

        // Aleatorias y DISTINTAS: pool barajado, una entrada por jugador.
        List<String> shuffled = new ArrayList<>(settings.skinPool());
        Collections.shuffle(shuffled);
        Map<UUID, String> assignedSkin = new LinkedHashMap<>();
        List<Assignment> assignments = new ArrayList<>();
        Map<UUID, StateStore.SavedLocation> origins = new HashMap<>();
        for (int i = 0; i < players.size(); i++) {
            Player p = players.get(i);
            UUID uuid = p.getUniqueId();
            assignedSkin.put(uuid, shuffled.get(i));
            assignments.add(new Assignment(uuid.toString(), shuffled.get(i)));
            // Cada quien guarda SU origen: al terminar vuelve a su sitio, no
            // todos al mismo.
            origins.put(uuid, toSaved(p.getLocation()));
        }

        active = new StateStore.State(name, System.currentTimeMillis(),
                new HashMap<>(), assignments, origins);
        activeParticipants.clear();
        assignedSkin.keySet().forEach(activeParticipants::add);
        burstCount = 0;

        long summonTicks = settings.summonEnabled()
                ? settings.summonCountdownSeconds() * 20L : 0L;
        endsAtMillis = System.currentTimeMillis()
                + (summonTicks + SEQUENCE_TICKS) * 50L
                + settings.durationSeconds() * 1000L;

        // Fase de skins en async: la API de skins hace red/disco.
        asyncExecutor.execute(() -> {
            Map<UUID, SavedSkin> saved = new HashMap<>();
            for (Map.Entry<UUID, String> entry : assignedSkin.entrySet()) {
                saved.put(entry.getKey(),
                        skins.getCurrentSkin(entry.getKey()).orElse(null));
                skins.setSkin(entry.getKey(), entry.getValue());
            }
            synchronized (this) {
                if (active == null) {
                    return; // lo terminaron antes de acabar la fase de skins
                }
                active.savedSkins().putAll(saved);
                stateStore.save(active);
            }
            emitStart(name, assignments);
        });

        if (settings.summonEnabled()) {
            scheduleSummon(players, venue.getLocation());
        }
        // La secuencia dramatica arranca DESPUES de la convocatoria.
        plugin.getServer().getScheduler().runTaskLater(plugin,
                () -> scheduleSequence(players, name), summonTicks);
        scheduleRecurringTasks(summonTicks);
        autoEndTask = plugin.getServer().getScheduler().runTaskLater(
                plugin, this::end,
                summonTicks + SEQUENCE_TICKS + settings.durationSeconds() * 20L);
        feedback.sendMessage("Evento '" + name + "' iniciado con "
                + players.size() + " participantes"
                + (settings.summonEnabled() ? " (convocando a la zona mas despejada)" : "") + ".");
        return true;
    }

    /** Cuenta atras dramatica y TP colectivo a la sede. */
    private void scheduleSummon(List<Player> players, Location venue) {
        int secs = settings.summonCountdownSeconds();
        Title aviso = Title.title(
                Component.text("⚡ SERAS CONVOCADO... ⚡", NamedTextColor.AQUA, TextDecoration.BOLD),
                Component.text("preparate", NamedTextColor.GRAY),
                Title.Times.times(Duration.ofMillis(200),
                        Duration.ofMillis(1200), Duration.ofMillis(200)));
        players.forEach(p -> { if (p.isOnline()) p.showTitle(aviso); });

        for (int i = secs; i >= 1; i--) {
            final int n = i;
            plugin.getServer().getScheduler().runTaskLater(plugin, () -> {
                Title t = Title.title(
                        Component.text(String.valueOf(n), NamedTextColor.AQUA, TextDecoration.BOLD),
                        Component.empty(),
                        Title.Times.times(Duration.ofMillis(100),
                                Duration.ofMillis(700), Duration.ofMillis(100)));
                players.forEach(p -> { if (p.isOnline()) p.showTitle(t); });
            }, (secs - i) * 20L);
        }

        plugin.getServer().getScheduler().runTaskLater(plugin, () -> {
            for (Player p : players) {
                if (p.isOnline()) {
                    p.teleport(venue);
                }
            }
        }, secs * 20L);
    }

    // ---------- seleccion de sede ----------

    /** Mejor sede entre los participantes; null si nadie esta en Overworld. */
    private Player chooseVenue(List<Player> players) {
        Player best = null;
        double bestScore = -1;
        for (Player p : players) {
            if (p.getWorld().getEnvironment() != World.Environment.NORMAL) {
                continue;
            }
            double score = openness(p.getLocation());
            if (score > bestScore
                    || (score == bestScore && best != null
                        && p.getLocation().getY() > best.getLocation().getY())) {
                bestScore = score;
                best = p;
            }
        }
        return best;
    }

    /**
     * Puntua lo despejado de una zona: 0.5 techo libre + 0.5 aire horizontal.
     * El techo se mide como altura despejada TOPADA a venueHeadroomCap (que no
     * es arbitrario: es lo que suben las rafagas de salto). Asi una caverna
     * enorme puntua como cielo abierto, una cueva baja no, y una colina pegada
     * a un muro cae por el aire horizontal aunque tenga cielo.
     * 24 muestras: 3 anillos x 8 direcciones.
     */
    private double openness(Location loc) {
        World w = loc.getWorld();
        int baseY = loc.getBlockY();
        int[] rings = {7, 14, Math.max(15, settings.venueScanRadius())};
        double headSum = 0, airSum = 0;
        int n = 0;
        for (int ring : rings) {
            for (int dir = 0; dir < 8; dir++) {
                double a = Math.toRadians(dir * 45.0);
                int x = loc.getBlockX() + (int) Math.round(Math.cos(a) * ring);
                int z = loc.getBlockZ() + (int) Math.round(Math.sin(a) * ring);
                headSum += headroom(w, x, baseY, z);
                airSum += horizontalAir(w, x, baseY, z);
                n++;
            }
        }
        return n == 0 ? 0 : 0.5 * (headSum / n) + 0.5 * (airSum / n);
    }

    private double headroom(World w, int x, int y, int z) {
        int cap = Math.max(1, settings.venueHeadroomCap());
        int clear = 0;
        for (int i = 1; i <= cap; i++) {
            int yy = y + i;
            if (yy >= w.getMaxHeight()) {
                clear = cap; // cielo abierto: nada puede taparlo
                break;
            }
            if (isSolid(w, x, yy, z)) {
                break;
            }
            clear++;
        }
        return (double) clear / cap;
    }

    private double horizontalAir(World w, int x, int y, int z) {
        int free = 0;
        for (int i = 0; i < 5; i++) {
            if (!isSolid(w, x, y + i, z)) {
                free++;
            }
        }
        return free / 5.0;
    }

    private static boolean isSolid(World w, int x, int y, int z) {
        try {
            return w.getBlockAt(x, y, z).getType().isSolid();
        } catch (Exception e) {
            return false; // fuera de mundo / chunk raro: tratar como aire
        }
    }

    // ---------- secuencia dramatica ----------

    private void scheduleSequence(List<Player> players, String name) {
        titleAt(0, players, Component.text("⚡ ELEVANDO EL KI ⚡", NamedTextColor.YELLOW),
                Component.text(name, NamedTextColor.GRAY));
        titleAt(40, players, Component.text("3", NamedTextColor.RED, TextDecoration.BOLD),
                Component.empty());
        titleAt(60, players, Component.text("2", NamedTextColor.GOLD, TextDecoration.BOLD),
                Component.empty());
        titleAt(80, players, Component.text("1", NamedTextColor.YELLOW, TextDecoration.BOLD),
                Component.empty());
        plugin.getServer().getScheduler().runTaskLater(plugin, () -> {
            Title max = Title.title(
                    Component.text("¡PODER MAXIMO!", NamedTextColor.GOLD, TextDecoration.BOLD),
                    Component.text("⚡⚡⚡", NamedTextColor.YELLOW),
                    Title.Times.times(Duration.ofMillis(200),
                            Duration.ofMillis(2500), Duration.ofMillis(600)));
            for (Player p : players) {
                if (!p.isOnline()) {
                    continue;
                }
                // Efectos primero: un id de sonido invalido en config no debe
                // dejar a nadie sin buffs.
                for (PotionEffect effect : buffs(settings.durationSeconds())) {
                    p.addPotionEffect(effect);
                }
                p.showTitle(max);
                try {
                    p.playSound(p.getLocation(), settings.startSound(), 1.0f, 1.0f);
                } catch (Exception e) {
                    plugin.getLogger().warning("Sonido '" + settings.startSound()
                            + "' no reproducible: " + e.getMessage());
                }
                playMusic(p);
            }
        }, SEQUENCE_TICKS);
    }

    /** Tareas periodicas de la ventana del evento: musica y rafagas.
     *  (El refill de comida murio con #1: el efecto SATURATION lo cubre.) */
    private void scheduleRecurringTasks(long offsetTicks) {
        long start = offsetTicks + SEQUENCE_TICKS;

        if (!settings.musicSound().isEmpty() && settings.musicLoopSeconds() > 0) {
            long loopTicks = settings.musicLoopSeconds() * 20L;
            musicTask = plugin.getServer().getScheduler().runTaskTimer(plugin,
                    () -> forEachParticipant(this::playMusic),
                    start + loopTicks, loopTicks);
        }

        if (settings.burstsEnabled() && settings.burstIntervalSeconds() > 0
                && settings.burstMaxCount() > 0) {
            long intervalTicks = settings.burstIntervalSeconds() * 20L;
            burstTask = plugin.getServer().getScheduler().runTaskTimer(plugin, () -> {
                boolean speedTurn;
                synchronized (this) {
                    if (active == null) {
                        return;
                    }
                    if (burstCount >= settings.burstMaxCount()) {
                        if (burstTask != null) {
                            burstTask.cancel();
                            burstTask = null;
                        }
                        return;
                    }
                    speedTurn = burstCount % 2 == 0;
                    burstCount++;
                }
                forEachParticipant(p -> burst(p, speedTurn));
            }, start + intervalTicks, intervalTicks);
        }
    }

    private void burst(Player p, boolean speedTurn) {
        Title title;
        if (speedTurn) {
            p.addPotionEffect(new PotionEffect(PotionEffectType.SPEED,
                    settings.burstSpeedSeconds() * 20,
                    settings.burstSpeedLevel() - 1, false, false));
            title = Title.title(
                    Component.text("⚡ RAFAGA DE KI ⚡", NamedTextColor.AQUA, TextDecoration.BOLD),
                    Component.text("velocidad imposible", NamedTextColor.GRAY),
                    Title.Times.times(Duration.ofMillis(150),
                            Duration.ofMillis(1200), Duration.ofMillis(300)));
        } else {
            // El salto y su inmunidad van JUNTOS: la proteccion dura mas que
            // el salto porque la caida continua cuando el efecto ya expiro.
            p.addPotionEffect(new PotionEffect(PotionEffectType.JUMP_BOOST,
                    settings.burstJumpSeconds() * 20,
                    settings.burstJumpLevel() - 1, false, false));
            p.addPotionEffect(new PotionEffect(PotionEffectType.RESISTANCE,
                    settings.burstImmunitySeconds() * 20, 4, false, false));
            title = Title.title(
                    Component.text("🦘 SALTO CELESTIAL", NamedTextColor.GREEN, TextDecoration.BOLD),
                    Component.text("aterrizaje garantizado", NamedTextColor.GRAY),
                    Title.Times.times(Duration.ofMillis(150),
                            Duration.ofMillis(1200), Duration.ofMillis(300)));
        }
        p.showTitle(title);
        try {
            p.playSound(p.getLocation(), "minecraft:entity.player.levelup", 1.0f, 0.6f);
        } catch (Exception ignored) {
            // sin sonido de aviso no se cae la rafaga
        }
    }

    private void forEachParticipant(java.util.function.Consumer<Player> action) {
        synchronized (this) {
            if (active == null) {
                return;
            }
            for (UUID uuid : activeParticipants) {
                Player p = plugin.getServer().getPlayer(uuid);
                if (p != null) {
                    action.accept(p);
                }
            }
        }
    }

    private void titleAt(long ticks, List<Player> players, Component main, Component sub) {
        Title title = Title.title(main, sub, Title.Times.times(
                Duration.ofMillis(150), Duration.ofMillis(900), Duration.ofMillis(150)));
        plugin.getServer().getScheduler().runTaskLater(plugin,
                () -> players.forEach(p -> {
                    if (p.isOnline()) {
                        p.showTitle(title);
                    }
                }), ticks);
    }

    /** Buffs del Ki por N segundos. Usado tambien al respawn con el RESTANTE. */
    private List<PotionEffect> buffs(int seconds) {
        int ticks = Math.max(20, seconds * 20);
        return List.of(
                new PotionEffect(PotionEffectType.SPEED, ticks, 3),          // IV
                new PotionEffect(PotionEffectType.STRENGTH, ticks, 1),       // II
                new PotionEffect(PotionEffectType.JUMP_BOOST, ticks, 2),     // III
                new PotionEffect(PotionEffectType.HEALTH_BOOST, ticks, 3),   // IV
                new PotionEffect(PotionEffectType.REGENERATION, ticks, 1),   // II
                new PotionEffect(PotionEffectType.RESISTANCE, ticks, 0),     // I
                new PotionEffect(PotionEffectType.DOLPHINS_GRACE, ticks, 1), // II
                new PotionEffect(PotionEffectType.NIGHT_VISION, ticks, 0),
                new PotionEffect(PotionEffectType.FIRE_RESISTANCE, ticks, 0),
                new PotionEffect(PotionEffectType.SATURATION, ticks, 0),
                new PotionEffect(PotionEffectType.SLOW_FALLING, ticks, 0));
    }

    private void playMusic(Player p) {
        if (settings.musicSound().isEmpty()) {
            return;
        }
        try {
            p.stopSound(org.bukkit.SoundCategory.MUSIC);
            p.playSound(p.getLocation(), settings.musicSound(),
                    org.bukkit.SoundCategory.MUSIC, 1.0f, 1.0f);
        } catch (Exception e) {
            plugin.getLogger().warning("Musica '" + settings.musicSound()
                    + "' no reproducible: " + e.getMessage());
        }
    }

    private void stopMusic(Player p) {
        if (settings.musicSound().isEmpty()) {
            return;
        }
        try {
            p.stopSound(settings.musicSound(), org.bukkit.SoundCategory.MUSIC);
        } catch (Exception e) {
            plugin.getLogger().warning("No se pudo detener la musica para "
                    + p.getName() + ": " + e.getMessage());
        }
    }

    // ---------- fin ----------

    public synchronized boolean end() {
        if (active == null) {
            return false;
        }
        StateStore.State ended = active;
        active = null;
        for (BukkitTask task : new BukkitTask[]{autoEndTask, musicTask, burstTask}) {
            if (task != null) {
                task.cancel();
            }
        }
        autoEndTask = musicTask = burstTask = null;
        activeParticipants.clear();
        long durationSecondsReal =
                (System.currentTimeMillis() - ended.startedAtMillis()) / 1000;

        Title closing = Title.title(
                Component.text("EL PODER SE DESVANECE...", NamedTextColor.GRAY),
                Component.text(ended.name(), NamedTextColor.DARK_GRAY),
                Title.Times.times(Duration.ofMillis(300),
                        Duration.ofMillis(2000), Duration.ofMillis(800)));
        for (Assignment assignment : ended.assignments()) {
            UUID uuid = UUID.fromString(assignment.player());
            Player p = plugin.getServer().getPlayer(uuid);
            StateStore.SavedLocation origin = ended.origins() == null
                    ? null : ended.origins().get(uuid);
            if (p != null) {
                p.showTitle(closing);
                for (PotionEffect effect : buffs(1)) {
                    p.removePotionEffect(effect.getType());
                }
                stopMusic(p);
                try {
                    p.playSound(p.getLocation(), settings.endSound(), 1.0f, 1.0f);
                } catch (Exception e) {
                    plugin.getLogger().warning("Sonido '" + settings.endSound()
                            + "' no reproducible: " + e.getMessage());
                }
                if (origin != null) {
                    safeReturn(p, origin);
                }
            } else if (origin != null) {
                // Offline al terminar: no se le puede quitar el Ki ni moverlo
                // ahora. Queda apuntado y se resuelve en su PlayerJoinEvent.
                pendingCleanup.put(uuid, origin);
            }
        }
        stateStore.savePendingCleanup(pendingCleanup);

        asyncExecutor.execute(() -> {
            for (Assignment assignment : ended.assignments()) {
                UUID uuid = UUID.fromString(assignment.player());
                skins.restoreSkin(uuid, ended.savedSkins().get(uuid));
            }
            stateStore.clear();
            emitEnd(ended.name(), durationSecondsReal);
        });
        return true;
    }

    public synchronized void recoverIfPending() {
        StateStore.State pending = stateStore.load();
        if (pending == null) {
            return;
        }
        plugin.getLogger().warning("Evento '" + pending.name()
                + "' interrumpido por un reinicio: restaurando "
                + pending.assignments().size() + " participantes.");
        active = pending;
        activeParticipants.clear();
        pending.assignments().forEach(a -> activeParticipants.add(UUID.fromString(a.player())));
        end();
    }

    public synchronized boolean isActive() {
        return active != null;
    }

    // ---------- retorno seguro ----------

    private static StateStore.SavedLocation toSaved(Location l) {
        return new StateStore.SavedLocation(l.getWorld().getName(),
                l.getX(), l.getY(), l.getZ(), l.getYaw(), l.getPitch());
    }

    /**
     * Devuelve al jugador a SU origen, con cascada de seguridad: el mundo
     * pudo cambiar mientras estuvo fuera (alguien tapo el hueco, entro lava).
     */
    private void safeReturn(Player p, StateStore.SavedLocation origin) {
        World w = plugin.getServer().getWorld(origin.world());
        if (w == null) {
            p.sendMessage("Tu mundo de origen ya no existe; te dejamos en el spawn.");
            p.teleport(p.getWorld().getSpawnLocation());
            return;
        }
        int x = (int) Math.floor(origin.x());
        int z = (int) Math.floor(origin.z());
        int y0 = (int) Math.floor(origin.y());

        Integer y = null;
        if (isSafeSpot(w, x, y0, z)) {                 // 1. sitio exacto
            y = y0;
        }
        for (int i = 1; y == null && i <= 10; i++) {   // 2. hacia arriba
            if (isSafeSpot(w, x, y0 + i, z)) {
                y = y0 + i;
            }
        }
        for (int i = 1; y == null && i <= 5; i++) {    // 3. hacia abajo
            if (isSafeSpot(w, x, y0 - i, z)) {
                y = y0 - i;
            }
        }
        if (y == null) {                               // 4. superficie
            int surface = w.getHighestBlockYAt(x, z) + 1;
            if (isSafeSpot(w, x, surface, z)) {
                y = surface;
            }
        }
        if (y == null) {                               // 5. ultimo recurso
            p.sendMessage("Tu origen ya no era habitable; te dejamos en el spawn.");
            p.teleport(w.getSpawnLocation());
            return;
        }
        if (y != y0) {
            p.sendMessage("Tu origen ya no era seguro; te dejamos cerca.");
        }
        p.teleport(new Location(w, x + 0.5, y, z + 0.5, origin.yaw(), origin.pitch()));
    }

    private boolean isSafeSpot(World w, int x, int y, int z) {
        if (y < w.getMinHeight() + 1 || y >= w.getMaxHeight() - 1) {
            return false;
        }
        Block feet = w.getBlockAt(x, y, z);
        Block head = w.getBlockAt(x, y + 1, z);
        Block below = w.getBlockAt(x, y - 1, z);
        if (feet.getType().isSolid() || head.getType().isSolid()) {
            return false;
        }
        if (!below.getType().isSolid()) {
            return false;
        }
        return !isDeadly(feet) && !isDeadly(head) && !isDeadly(below);
    }

    private static boolean isDeadly(Block b) {
        Material m = b.getType();
        return m == Material.LAVA || m == Material.FIRE || m == Material.SOUL_FIRE
                || m == Material.MAGMA_BLOCK || m == Material.CAMPFIRE
                || m == Material.SOUL_CAMPFIRE;
    }

    // ---------- listeners: muerte, respawn, reconexion, agua ----------

    /**
     * Morir en un evento no debe costarte el inventario real: el Ki es un
     * espectaculo de minutos, no una partida survival. keepInventory + limpiar
     * drops es ATOMICO (si pones keepInventory y NO limpias drops, duplicas).
     */
    @EventHandler(ignoreCancelled = true)
    public void onDeath(PlayerDeathEvent event) {
        synchronized (this) {
            if (active == null
                    || !activeParticipants.contains(event.getEntity().getUniqueId())) {
                return;
            }
        }
        event.setKeepInventory(true);
        event.getDrops().clear();
        event.setKeepLevel(true);
        event.setDroppedExp(0);
    }

    /**
     * Morir no te expulsa del evento: te devolvemos el Ki con el tiempo que
     * le quedaba, para que el final siga siendo comun a todos.
     */
    @EventHandler
    public void onRespawn(PlayerRespawnEvent event) {
        UUID uuid = event.getPlayer().getUniqueId();
        int remaining;
        synchronized (this) {
            if (active == null || !activeParticipants.contains(uuid)) {
                return;
            }
            remaining = (int) ((endsAtMillis - System.currentTimeMillis()) / 1000);
        }
        if (remaining <= 0) {
            return;
        }
        // 1 tick despues: en PlayerRespawnEvent el jugador aun no esta
        // plenamente materializado y los efectos se perderian.
        plugin.getServer().getScheduler().runTaskLater(plugin, () -> {
            Player p = plugin.getServer().getPlayer(uuid);
            if (p == null || !isActive()) {
                return;
            }
            for (PotionEffect effect : buffs(remaining)) {
                p.addPotionEffect(effect);
            }
        }, 1L);
    }

    /** Limpieza de quien estaba desconectado cuando el evento termino. */
    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        UUID uuid = event.getPlayer().getUniqueId();
        StateStore.SavedLocation origin;
        synchronized (this) {
            origin = pendingCleanup.remove(uuid);
            if (origin == null) {
                return;
            }
            stateStore.savePendingCleanup(pendingCleanup);
        }
        plugin.getServer().getScheduler().runTaskLater(plugin, () -> {
            Player p = plugin.getServer().getPlayer(uuid);
            if (p == null) {
                return;
            }
            for (PotionEffect effect : buffs(1)) {
                p.removePotionEffect(effect.getType());
            }
            safeReturn(p, origin);
        }, 1L);
    }

    /**
     * Caminar sobre el agua. Guardas ordenadas de la mas barata a la mas cara
     * para que PlayerMoveEvent (que se dispara hasta al girar la camara) no
     * cueste nada fuera de evento ni congele oceanos:
     *   1. hay evento activo   2. es participante vivo
     *   3. cambio de BLOQUE (descarta la mayoria de invocaciones)
     *   4. esta en superficie, no buceando   5. area acotada y solo agua
     */
    @EventHandler(ignoreCancelled = true)
    public void onMove(PlayerMoveEvent event) {
        if (!settings.iceWalkEnabled()) {
            return;
        }
        UUID uuid = event.getPlayer().getUniqueId();
        synchronized (this) {
            if (active == null || !activeParticipants.contains(uuid)) {
                return;
            }
        }
        Player p = event.getPlayer();
        if (p.isDead()) {
            return;
        }
        Location from = event.getFrom();
        Location to = event.getTo();
        if (to == null
                || (from.getBlockX() == to.getBlockX()
                    && from.getBlockY() == to.getBlockY()
                    && from.getBlockZ() == to.getBlockZ())) {
            return; // solo giro de camara / micro-movimiento
        }
        freezeUnder(to);
    }

    private void freezeUnder(Location to) {
        World w = to.getWorld();
        int fx = to.getBlockX(), fy = to.getBlockY(), fz = to.getBlockZ();
        // Si los pies estan DENTRO del agua esta buceando/nadando: no congelar
        // (critico ahora que el Ki da dolphins_grace y nadan mucho).
        if (w.getBlockAt(fx, fy, fz).getType() == Material.WATER) {
            return;
        }
        int r = Math.min(ICE_RADIUS_MAX, Math.max(0, settings.iceWalkRadius()));
        for (int dx = -r; dx <= r; dx++) {
            for (int dz = -r; dz <= r; dz++) {
                Block b = w.getBlockAt(fx + dx, fy - 1, fz + dz);
                if (b.getType() != Material.WATER) {
                    continue; // JAMAS se reemplaza un bloque que no sea agua
                }
                if (b.getBlockData() instanceof Levelled lv && lv.getLevel() != 0) {
                    continue; // agua corriente: solo congelamos fuentes
                }
                if (w.getBlockAt(b.getX(), b.getY() + 1, b.getZ()).getType().isSolid()) {
                    continue; // no es superficie
                }
                // FROSTED_ICE (no ICE): se derrite solo, cero grief permanente.
                b.setType(Material.FROSTED_ICE, false);
            }
        }
    }

    // ---------- catalogo ----------

    private void emitStart(String name, List<Assignment> assignments) {
        JsonObject data = new JsonObject();
        data.addProperty("name", name);
        data.addProperty("kind", "torneo_ki");
        JsonArray participants = new JsonArray();
        JsonArray assignmentsJson = new JsonArray();
        for (Assignment assignment : assignments) {
            participants.add(assignment.player());
            JsonObject a = new JsonObject();
            a.addProperty("player", assignment.player());
            a.addProperty("skin", assignment.skin());
            assignmentsJson.add(a);
        }
        data.add("participants", participants);
        data.add("assignments", assignmentsJson);

        JsonObject json = EventJson.base("event.start");
        json.add("data", data);
        output.send(EventJson.eventUuid(json), json.toString());
    }

    private void emitEnd(String name, long durationSecondsReal) {
        JsonObject data = new JsonObject();
        data.addProperty("name", name);
        data.addProperty("duration_s", durationSecondsReal);
        JsonObject json = EventJson.base("event.end");
        json.add("data", data);
        output.send(EventJson.eventUuid(json), json.toString());
    }
}
