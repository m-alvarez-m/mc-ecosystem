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
 * efectos + event.start/event.end del catálogo. NO captura datos: eso es
 * responsabilidad exclusiva de EventCollector.
 */
public final class EventManager {

    /** Quién recibió qué skin; va tal cual al data de event.start. */
    public record Assignment(String player, String skin) {}

    private static final long SEQUENCE_TICKS = 100L; // 5 s hasta ¡PODER MÁXIMO!

    private final Plugin plugin;
    private final SkinService skins;
    private final EventOutput output;
    private final StateStore stateStore;
    private final List<String> pool;
    private final int durationSeconds;
    private final String startSound;
    private final String endSound;
    // Inyectado para que los tests corran la fase de skins de forma
    // determinista (en producción: scheduler async de Bukkit).
    private final java.util.concurrent.Executor asyncExecutor;

    private StateStore.State active;
    private BukkitTask autoEndTask;
    private BukkitTask feedTask;

    public EventManager(Plugin plugin, SkinService skins, EventOutput output,
                        StateStore stateStore, List<String> pool,
                        int durationSeconds, String startSound, String endSound,
                        java.util.concurrent.Executor asyncExecutor) {
        this.plugin = plugin;
        this.skins = skins;
        this.output = output;
        this.stateStore = stateStore;
        this.pool = pool;
        this.durationSeconds = durationSeconds;
        this.startSound = startSound;
        this.endSound = endSound;
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
        if (pool.size() < players.size()) {
            feedback.sendMessage("El pool de skins (" + pool.size()
                    + ") es menor que los jugadores online (" + players.size()
                    + "). Amplía skin_pool en config.yml.");
            return false;
        }

        // Aleatorias y DISTINTAS: pool barajado, una entrada por jugador.
        List<String> shuffled = new ArrayList<>(pool);
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
        autoEndTask = plugin.getServer().getScheduler().runTaskLater(
                plugin, this::end, SEQUENCE_TICKS + durationSeconds * 20L);
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
                    p.playSound(p.getLocation(), startSound, 1.0f, 1.0f);
                } catch (Exception e) {
                    plugin.getLogger().warning("Sonido '" + startSound
                            + "' no reproducible: " + e.getMessage());
                }
            }
        }, SEQUENCE_TICKS);

        // Issue #1: sin comida no se puede correr y la Speed "no se siente".
        // Refill periódico durante toda la ventana del evento.
        feedTask = plugin.getServer().getScheduler().runTaskTimer(plugin, () -> {
            synchronized (this) {
                if (active == null) {
                    return;
                }
                for (Assignment assignment : active.assignments()) {
                    Player p = plugin.getServer()
                            .getPlayer(UUID.fromString(assignment.player()));
                    if (p != null) {
                        feed(p);
                    }
                }
            }
        }, SEQUENCE_TICKS, 20L * 30);
    }

    /** Comida y saturación al máximo: un dios del ki no pasa hambre. */
    private void feed(Player p) {
        p.setFoodLevel(20);
        p.setSaturation(20f);
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
        int ticks = durationSeconds * 20;
        return List.of(
                new PotionEffect(PotionEffectType.SPEED, ticks, 1),        // II
                new PotionEffect(PotionEffectType.STRENGTH, ticks, 1),     // II
                new PotionEffect(PotionEffectType.JUMP_BOOST, ticks, 2),   // III
                new PotionEffect(PotionEffectType.HEALTH_BOOST, ticks, 3), // IV
                new PotionEffect(PotionEffectType.REGENERATION, ticks, 1), // II
                new PotionEffect(PotionEffectType.RESISTANCE, ticks, 0));  // I
    }

    // ---------- fin ----------

    /** Cierre manual, por expiración o desde la recuperación post-reinicio. */
    public synchronized boolean end() {
        if (active == null) {
            return false;
        }
        StateStore.State ended = active;
        active = null;
        if (autoEndTask != null) {
            autoEndTask.cancel();
            autoEndTask = null;
        }
        if (feedTask != null) {
            feedTask.cancel();
            feedTask = null;
        }
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
                try {
                    p.playSound(p.getLocation(), endSound, 1.0f, 1.0f);
                } catch (Exception e) {
                    plugin.getLogger().warning("Sonido '" + endSound
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
