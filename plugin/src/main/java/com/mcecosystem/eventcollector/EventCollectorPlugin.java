package com.mcecosystem.eventcollector;

import org.bukkit.plugin.java.JavaPlugin;

import java.sql.SQLException;
import java.util.List;

public final class EventCollectorPlugin extends JavaPlugin {

    private static final long RETRY_PERIOD_TICKS = 20L * 30; // 30 segundos
    private static final int RETRY_BATCH_SIZE = 100;

    private EventBuffer buffer;
    private EventSender eventSender;

    @Override
    public void onEnable() {
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
        getServer().getPluginManager().registerEvents(new BlockBreakListener(eventSender), this);

        // Reintento periódico en un hilo ASÍNCRONO: ahí sí podemos bloquear.
        getServer().getScheduler().runTaskTimerAsynchronously(
                this, this::flushBuffer, RETRY_PERIOD_TICKS, RETRY_PERIOD_TICKS);

        getLogger().info("EventCollector activo. Endpoint: " + apiUrl);
        int pending = buffer.count();
        if (pending > 0) {
            getLogger().info(pending + " eventos pendientes de una sesión anterior; se reintentarán.");
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
