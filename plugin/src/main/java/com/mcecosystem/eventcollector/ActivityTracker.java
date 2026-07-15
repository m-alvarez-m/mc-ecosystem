package com.mcecosystem.eventcollector;

import com.google.gson.JsonObject;
import org.bukkit.entity.Player;

import java.util.Collection;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Detección de AFK por ausencia de input.
 *
 * - touch(): cada señal de actividad actualiza lastActivity. Si el jugador
 *   estaba AFK, emite session.afk_end en ese mismo instante.
 * - poll(): un tick periódico (síncrono) marca AFK a quien supere el umbral
 *   y emite session.afk_start.
 *
 * touch() puede llegar desde hilos async (chat), por eso los mapas son
 * concurrentes y aquí no se toca la API de Bukkit más allá del UUID.
 */
public final class ActivityTracker {

    private final Map<UUID, Long> lastActivity = new ConcurrentHashMap<>();
    private final Map<UUID, Long> afkSince = new ConcurrentHashMap<>();
    private final EventSender sender;
    private final long thresholdMillis;

    public ActivityTracker(EventSender sender, int thresholdSeconds) {
        this.sender = sender;
        this.thresholdMillis = thresholdSeconds * 1000L;
    }

    public void touch(UUID playerUuid) {
        long now = System.currentTimeMillis();
        lastActivity.put(playerUuid, now);
        Long since = afkSince.remove(playerUuid);
        if (since != null) {
            emitAfkEnd(playerUuid, (now - since) / 1000);
        }
    }

    /** Llamar desde una tarea síncrona periódica. */
    public void poll(Collection<? extends Player> onlinePlayers) {
        long now = System.currentTimeMillis();
        for (Player player : onlinePlayers) {
            UUID uuid = player.getUniqueId();
            Long last = lastActivity.get(uuid);
            if (last == null || afkSince.containsKey(uuid)) {
                continue;
            }
            if (now - last > thresholdMillis) {
                afkSince.put(uuid, now);
                JsonObject json = EventJson.base("session.afk_start", uuid);
                json.add("data", new JsonObject());
                sender.send(EventJson.eventUuid(json), json.toString());
            }
        }
    }

    /** Al desconectarse: limpia estado y cierra el tramo AFK si estaba abierto. */
    public void handleQuit(UUID playerUuid) {
        lastActivity.remove(playerUuid);
        Long since = afkSince.remove(playerUuid);
        if (since != null) {
            emitAfkEnd(playerUuid, (System.currentTimeMillis() - since) / 1000);
        }
    }

    private void emitAfkEnd(UUID playerUuid, long afkDurationSeconds) {
        JsonObject data = new JsonObject();
        data.addProperty("afk_duration_s", afkDurationSeconds);
        JsonObject json = EventJson.base("session.afk_end", playerUuid);
        json.add("data", data);
        sender.send(EventJson.eventUuid(json), json.toString());
    }
}
