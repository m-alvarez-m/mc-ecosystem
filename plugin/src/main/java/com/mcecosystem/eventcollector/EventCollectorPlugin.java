package com.mcecosystem.eventcollector;

import com.google.gson.JsonObject;
import org.bukkit.plugin.java.JavaPlugin;

import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class EventCollectorPlugin extends JavaPlugin {

    private static final long RETRY_PERIOD_TICKS = 20L * 30;   // 30 segundos
    private static final long AFK_POLL_PERIOD_TICKS = 20L;     // 1 segundo
    private static final long DAMAGE_FLUSH_TICKS = 20L * 60;   // 1 minuto
    private static final int RETRY_BATCH_SIZE = 100;

    private EventBuffer buffer;
    private EventSender eventSender;
    private ActivityTracker activityTracker;
    private DamageAggregator damageAggregator;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        int afkThreshold = getConfig().getInt("afk_threshold_seconds", 300);

        // TODO: mover la URL a config.yml cuando haya más opciones.
        // En Docker, localhost es el contenedor: se sobreescribe con EVENTS_API_URL.
        String apiUrl = System.getenv().getOrDefault("EVENTS_API_URL", "http://localhost:3000/events");

        try {
            buffer = new EventBuffer(getDataFolder(), getLogger());
        } catch (SQLException e) {
            getLogger().severe("No se pudo abrir el buffer local: " + e.getMessage());
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        eventSender = new EventSender(apiUrl, buffer, getLogger());
        activityTracker = new ActivityTracker(eventSender, afkThreshold);
        damageAggregator = new DamageAggregator();
        getServer().getPluginManager().registerEvents(new BlockBreakListener(eventSender), this);
        getServer().getPluginManager().registerEvents(
                new SessionListener(eventSender, activityTracker), this);
        getServer().getPluginManager().registerEvents(
                new CombatListener(eventSender, damageAggregator), this);

        // Poller de AFK: síncrono (lee jugadores online), 1 vez por segundo.
        getServer().getScheduler().runTaskTimer(this,
                () -> activityTracker.poll(getServer().getOnlinePlayers()),
                AFK_POLL_PERIOD_TICKS, AFK_POLL_PERIOD_TICKS);

        // damage.minute: swap síncrono O(1) del acumulador (mismo hilo que
        // escribe = sin carreras) y construcción/envío en un hilo async.
        getServer().getScheduler().runTaskTimer(this, () -> {
            Map<UUID, DamageAggregator.Stats> minute = damageAggregator.swap();
            if (!minute.isEmpty()) {
                getServer().getScheduler().runTaskAsynchronously(
                        this, () -> emitDamageMinute(minute));
            }
        }, DAMAGE_FLUSH_TICKS, DAMAGE_FLUSH_TICKS);

        // Reintento periódico en un hilo ASÍNCRONO: ahí sí podemos bloquear.
        getServer().getScheduler().runTaskTimerAsynchronously(
                this, this::flushBuffer, RETRY_PERIOD_TICKS, RETRY_PERIOD_TICKS);

        getLogger().info("EventCollector activo. Endpoint: " + apiUrl
                + " | umbral AFK: " + afkThreshold + "s");
        int pending = buffer.count();
        if (pending > 0) {
            getLogger().info(pending + " eventos pendientes de una sesión anterior; se reintentarán.");
        }
    }

    /** Corre en hilo async; el mapa ya es huérfano y solo contiene primitivos. */
    private void emitDamageMinute(Map<UUID, DamageAggregator.Stats> minute) {
        for (Map.Entry<UUID, DamageAggregator.Stats> entry : minute.entrySet()) {
            DamageAggregator.Stats s = entry.getValue();
            JsonObject data = new JsonObject();
            data.addProperty("dealt", Math.round(s.dealt * 100.0) / 100.0);
            data.addProperty("taken", Math.round(s.taken * 100.0) / 100.0);
            data.addProperty("hits_dealt", s.hitsDealt);
            data.addProperty("hits_taken", s.hitsTaken);

            JsonObject json = EventJson.base("damage.minute", entry.getKey());
            json.add("data", data);
            eventSender.send(EventJson.eventUuid(json), json.toString());
        }
    }

    private void flushBuffer() {
        while (true) {
            List<EventBuffer.Pending> pending = buffer.loadPending(RETRY_BATCH_SIZE);
            if (pending.isEmpty()) {
                return;
            }
            getLogger().info("Reintentando " + pending.size() + " eventos del buffer local...");
            for (EventBuffer.Pending p : pending) {
                if (eventSender.sendBlocking(p.json())) {
                    buffer.delete(p.id());
                } else {
                    // API sigue caída: preservar orden y esperar al próximo ciclo.
                    getLogger().warning("API aún no disponible. "
                            + buffer.count() + " eventos siguen en el buffer.");
                    return;
                }
            }
            if (pending.size() < RETRY_BATCH_SIZE) {
                getLogger().info("Buffer local drenado por completo.");
                return;
            }
        }
    }

    @Override
    public void onDisable() {
        if (eventSender != null) {
            eventSender.shutdown();
        }
        if (buffer != null) {
            buffer.close();
        }
    }
}
