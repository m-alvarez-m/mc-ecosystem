package com.mcecosystem.eventfx;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.title.Title;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.scheduler.BukkitTask;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Ciclo de vida del Modo Evento: skins del pool + secuencia dramática +
 * buffs + banda sonora + ráfagas automáticas + event.start/event.end del
 * catálogo. NO captura datos: eso es de EventCollector.
 */
public final class EventManager {

    /** Quién recibió qué skin; va tal cual al data de event.start. */
    public record Assignment(String player, String skin) {}

    /** Toda la configuración del evento (config.yml). */
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
            int burstImmunitySeconds) {}

    private static final long SEQUENCE_TICKS = 100L; // 5 s hasta ¡PODER MÁXIMO!

    private final Plugin plugin;
    private final SkinService skins;
    private final EventOutput output;
    private final StateStore stateStore;
    private final Settings settings;
    // Inyectado para que los tests corran la fase de skins de forma
    // determinista (en producción: scheduler async de Bukkit).
    private final java.util.concurrent.Executor asyncExecutor;

    private StateStore.State active;
    private BukkitTask autoEndTask;
    private BukkitTask feedTask;
    private BukkitTask musicTask;
    private BukkitTask burstTask;
    private int burstCount;

    public EventManager(Plugin plugin, SkinService skins, EventOutput output,
                        StateStore stateStore, Settings settings,
                        java.util.concurrent.Executor asyncExecutor) {
        this.plugin = plugin;
        this.skins = skins;
        this.output = output;
        this.stateStore = stateStore;
        this.settings = settings;
        this.asyncExecutor = asyncExecutor;
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
                    + "). Amplía skin_pool en config.yml.");
            return false;
        }

        // Aleatorias y DISTINTAS: pool barajado, una entrada por jugador.
        List<String> shuffled = new ArrayList<>(settings.skinPool());
        Collections.shuffle(shuffled);
        Map<UUID, String> assignedSkin = new LinkedHashMap<>();
        List<Assignment> assignments = new ArrayList<>();
        for (int i = 0; i < players.size(); i++) {
            UUID uuid = players.get(i).getUniqueId();
            assignedSkin.put(uuid, shuffled.get(i));
            assignments.add(new Assignment(uuid.toString(), shuffled.get(i)));
        }

        active = new StateStore.State(name, System.currentTimeMillis(),
                new HashMap<>(), assignments);
        burstCount = 0;

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

        scheduleSequence(players, name);
        scheduleRecurringTasks();
        autoEndTask = plugin.getServer().getScheduler().runTaskLater(
                plugin, this::end, SEQUENCE_TICKS + settings.durationSeconds() * 20L);
        feedback.sendMessage("Evento '" + name + "' iniciado con "
                + players.size() + " participantes.");
        return true;
    }

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
                    Component.text("¡PODER MÁXIMO!", NamedTextColor.GOLD, TextDecoration.BOLD),
                    Component.text("⚡⚡⚡", NamedTextColor.YELLOW),
                    Title.Times.times(Duration.ofMillis(200),
                            Duration.ofMillis(2500), Duration.ofMillis(600)));
            for (Player p : players) {
                if (!p.isOnline()) {
                    continue;
                }
                // Efectos primero: un id de sonido inválido en config no
                // debe dejar a nadie sin buffs.
                for (PotionEffect effect : buffs()) {
                    p.addPotionEffect(effect);
                }
                feed(p);
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

    /** Tareas periódicas de la ventana del evento: comida, música y ráfagas. */
    private void scheduleRecurringTasks() {
        // Issue #1: sin comida no se puede correr y la Speed "no se siente".
        feedTask = plugin.getServer().getScheduler().runTaskTimer(plugin,
                () -> forEachParticipant(this::feed), SEQUENCE_TICKS, 20L * 30);

        // Loop de música: si la canción es más corta que el evento, se
        // relanza cada music_loop_seconds para los que siguen conectados.
        if (!settings.musicSound().isEmpty() && settings.musicLoopSeconds() > 0) {
            long loopTicks = settings.musicLoopSeconds() * 20L;
            musicTask = plugin.getServer().getScheduler().runTaskTimer(plugin,
                    () -> forEachParticipant(this::playMusic),
                    SEQUENCE_TICKS + loopTicks, loopTicks);
        }

        // Ráfagas automáticas: mini-eventos de poder, alternando velocidad
        // ultra y salto celestial (salto SIEMPRE con inmunidad de aterrizaje).
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
            }, SEQUENCE_TICKS + intervalTicks, intervalTicks);
        }
    }

    private void burst(Player p, boolean speedTurn) {
        Title title;
        if (speedTurn) {
            // Nivel-1 = amplifier de Bukkit. Sin partículas: se vea limpio.
            p.addPotionEffect(new PotionEffect(PotionEffectType.SPEED,
                    settings.burstSpeedSeconds() * 20,
                    settings.burstSpeedLevel() - 1, false, false));
            title = Title.title(
                    Component.text("⚡ RÁFAGA DE KI ⚡", NamedTextColor.AQUA, TextDecoration.BOLD),
                    Component.text("velocidad imposible", NamedTextColor.GRAY),
                    Title.Times.times(Duration.ofMillis(150),
                            Duration.ofMillis(1200), Duration.ofMillis(300)));
        } else {
            // El salto y su inmunidad van JUNTOS: la protección dura más que
            // el salto porque la caída continúa cuando el efecto ya expiró.
            p.addPotionEffect(new PotionEffect(PotionEffectType.JUMP_BOOST,
                    settings.burstJumpSeconds() * 20,
                    settings.burstJumpLevel() - 1, false, false));
            p.addPotionEffect(new PotionEffect(PotionEffectType.RESISTANCE,
                    settings.burstImmunitySeconds() * 20, 4, false, false));
            title = Title.title(
                    Component.text("🦘 SALTO CELESTIAL 🦘", NamedTextColor.GREEN, TextDecoration.BOLD),
                    Component.text("aterrizaje garantizado", NamedTextColor.GRAY),
                    Title.Times.times(Duration.ofMillis(150),
                            Duration.ofMillis(1200), Duration.ofMillis(300)));
        }
        p.showTitle(title);
        try {
            p.playSound(p.getLocation(), "minecraft:entity.player.levelup", 1.0f, 0.6f);
        } catch (Exception ignored) {
            // sin sonido de aviso no se cae la ráfaga
        }
    }

    /** Ejecuta una acción sobre los participantes del evento aún online. */
    private void forEachParticipant(java.util.function.Consumer<Player> action) {
        synchronized (this) {
            if (active == null) {
                return;
            }
            for (Assignment assignment : active.assignments()) {
                Player p = plugin.getServer()
                        .getPlayer(UUID.fromString(assignment.player()));
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

    private List<PotionEffect> buffs() {
        int ticks = settings.durationSeconds() * 20;
        return List.of(
                new PotionEffect(PotionEffectType.SPEED, ticks, 3),        // IV
                new PotionEffect(PotionEffectType.STRENGTH, ticks, 1),     // II
                new PotionEffect(PotionEffectType.JUMP_BOOST, ticks, 2),   // III
                new PotionEffect(PotionEffectType.HEALTH_BOOST, ticks, 3), // IV
                new PotionEffect(PotionEffectType.REGENERATION, ticks, 1), // II
                new PotionEffect(PotionEffectType.RESISTANCE, ticks, 0));  // I
    }

    /** Comida y saturación al máximo: un dios del ki no pasa hambre. */
    private void feed(Player p) {
        p.setFoodLevel(20);
        p.setSaturation(20f);
    }

    /** Banda sonora del evento (resource pack); canal MUSIC para que el
     *  volumen lo controle el slider de música del cliente. */
    private void playMusic(Player p) {
        if (settings.musicSound().isEmpty()) {
            return;
        }
        try {
            // Silencia la música vanilla que estuviera sonando: el evento
            // tiene UNA banda sonora, sin C418 de fondo compitiendo.
            p.stopSound(org.bukkit.SoundCategory.MUSIC);
            p.playSound(p.getLocation(), settings.musicSound(),
                    org.bukkit.SoundCategory.MUSIC, 1.0f, 1.0f);
        } catch (Exception e) {
            plugin.getLogger().warning("Música '" + settings.musicSound()
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
            plugin.getLogger().warning("No se pudo detener la música para "
                    + p.getName() + ": " + e.getMessage());
        }
    }

    // ---------- fin ----------

    /** Cierre manual, por expiración o desde la recuperación post-reinicio. */
    public synchronized boolean end() {
        if (active == null) {
            return false;
        }
        StateStore.State ended = active;
        active = null;
        for (BukkitTask task : new BukkitTask[]{autoEndTask, feedTask, musicTask, burstTask}) {
            if (task != null) {
                task.cancel();
            }
        }
        autoEndTask = feedTask = musicTask = burstTask = null;
        long durationSecondsReal =
                (System.currentTimeMillis() - ended.startedAtMillis()) / 1000;

        Title closing = Title.title(
                Component.text("EL PODER SE DESVANECE...", NamedTextColor.GRAY),
                Component.text(ended.name(), NamedTextColor.DARK_GRAY),
                Title.Times.times(Duration.ofMillis(300),
                        Duration.ofMillis(2000), Duration.ofMillis(800)));
        for (Assignment assignment : ended.assignments()) {
            Player p = plugin.getServer().getPlayer(UUID.fromString(assignment.player()));
            if (p != null) {
                p.showTitle(closing);
                for (PotionEffect effect : buffs()) {
                    p.removePotionEffect(effect.getType());
                }
                stopMusic(p); // corte en seco: el silencio es parte del drama
                try {
                    p.playSound(p.getLocation(), settings.endSound(), 1.0f, 1.0f);
                } catch (Exception e) {
                    plugin.getLogger().warning("Sonido '" + settings.endSound()
                            + "' no reproducible: " + e.getMessage());
                }
            }
        }

        // Restauración a nivel storage: cubre igual a conectados y
        // desconectados (a estos SkinsRestorer les aplica al volver).
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

    /**
     * Al arrancar el plugin: si quedó un evento a medias (crash/reinicio),
     * restaurar skins y cerrar el evento con su duración real.
     */
    public synchronized void recoverIfPending() {
        StateStore.State pending = stateStore.load();
        if (pending == null) {
            return;
        }
        plugin.getLogger().warning("Evento '" + pending.name()
                + "' interrumpido por un reinicio: restaurando skins de "
                + pending.assignments().size() + " participantes.");
        active = pending;
        end();
    }

    public synchronized boolean isActive() {
        return active != null;
    }

    // ---------- catálogo ----------

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
