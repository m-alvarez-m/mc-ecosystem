package com.mcecosystem.eventcollector;

import com.google.gson.JsonObject;
import io.papermc.paper.event.player.AsyncChatEvent;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * session.start / session.end según docs/event-catalog.md, más el reenvío
 * de señales de actividad al ActivityTracker para la detección de AFK.
 */
public final class SessionListener implements Listener {

    private final EventOutput sender;
    private final ActivityTracker tracker;
    private final Map<UUID, Long> joinTimes = new ConcurrentHashMap<>();

    public SessionListener(EventOutput sender, ActivityTracker tracker) {
        this.sender = sender;
        this.tracker = tracker;
    }

    /**
     * Cierre síncrono de TODAS las sesiones aún abiertas, para onDisable.
     * En el apagado de Paper los plugins se deshabilitan ANTES de expulsar a
     * los jugadores, así que onQuit ya no corre para ellos: sin este flush
     * sus session.end se pierden. joinTimes solo contiene sesiones sin
     * cerrar (onQuit elimina la suya), de modo que no hay duplicados y el
     * método es idempotente. Todo va directo al buffer: durante el apagado
     * un POST async no tiene garantía de completarse.
     */
    public void flushForShutdown() {
        for (Map.Entry<UUID, Long> entry : Map.copyOf(joinTimes).entrySet()) {
            UUID uuid = entry.getKey();
            joinTimes.remove(uuid);
            // Orden lógico de la sesión: primero se cierra el tramo AFK.
            tracker.handleShutdown(uuid);

            JsonObject data = new JsonObject();
            data.addProperty("duration_s",
                    (System.currentTimeMillis() - entry.getValue()) / 1000);
            data.addProperty("reason", "server_stop");
            JsonObject json = EventJson.base("session.end", uuid);
            json.add("data", data);
            sender.storeDurable(EventJson.eventUuid(json), json.toString());
        }
    }

    // ---------- sesión ----------

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        UUID uuid = player.getUniqueId();
        joinTimes.put(uuid, System.currentTimeMillis());
        tracker.touch(uuid);

        JsonObject data = new JsonObject();
        String ipHash = hashAddress(player.getAddress());
        if (ipHash != null) {
            data.addProperty("ip_hash", ipHash);
        }
        JsonObject json = EventJson.base("session.start", uuid);
        json.add("data", data);
        sender.send(EventJson.eventUuid(json), json.toString());
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        UUID uuid = event.getPlayer().getUniqueId();
        // Cerrar primero el tramo AFK si estaba abierto: orden lógico de la sesión.
        tracker.handleQuit(uuid);

        Long joinedAt = joinTimes.remove(uuid);
        long durationSeconds = joinedAt == null
                ? 0
                : (System.currentTimeMillis() - joinedAt) / 1000;

        boolean stopping = Bukkit.isStopping();
        String reason = stopping ? "server_stop"
                : event.getReason() == PlayerQuitEvent.QuitReason.KICKED ? "kick"
                : "quit";

        JsonObject data = new JsonObject();
        data.addProperty("duration_s", durationSeconds);
        data.addProperty("reason", reason);
        JsonObject json = EventJson.base("session.end", uuid);
        json.add("data", data);

        if (stopping) {
            // Durante el apagado no hay garantía de que un POST async termine:
            // directo al buffer SQLite; se entregará en el próximo arranque.
            sender.storeDurable(EventJson.eventUuid(json), json.toString());
        } else {
            sender.send(EventJson.eventUuid(json), json.toString());
        }
    }

    // ---------- señales de actividad para el AFK ----------

    @EventHandler(ignoreCancelled = true)
    public void onMove(PlayerMoveEvent event) {
        tracker.touch(event.getPlayer().getUniqueId());
    }

    @EventHandler(ignoreCancelled = true)
    public void onInteract(PlayerInteractEvent event) {
        tracker.touch(event.getPlayer().getUniqueId());
    }

    @EventHandler(ignoreCancelled = true)
    public void onChat(AsyncChatEvent event) {
        // Hilo async: touch() solo usa mapas concurrentes, es seguro.
        tracker.touch(event.getPlayer().getUniqueId());
    }

    @EventHandler(ignoreCancelled = true)
    public void onCommand(PlayerCommandPreprocessEvent event) {
        tracker.touch(event.getPlayer().getUniqueId());
    }

    // ---------- util ----------

    /** SHA-256 de la IP. La IP en claro jamás sale del proceso. */
    private static String hashAddress(InetSocketAddress address) {
        if (address == null || address.getAddress() == null) {
            return null;
        }
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(
                    address.getAddress().getHostAddress().getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            return null; // SHA-256 siempre existe en la JVM; por completitud.
        }
    }
}
