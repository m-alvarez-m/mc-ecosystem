package com.mcecosystem.eventfx;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.reflect.TypeToken;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Logger;

/**
 * Persistencia del evento activo (active-event.json) y de la limpieza
 * pendiente (pending-cleanup.json). Si el servidor muere a mitad de un
 * evento, esto permite restaurar skins y posiciones en el proximo arranque
 * — mismo espiritu durable que el server.stop del collector.
 */
public final class StateStore {

    /** Posicion serializable (Location de Bukkit no es serializable a JSON). */
    public record SavedLocation(String world, double x, double y, double z,
                                float yaw, float pitch) {}

    /** Estado serializable del evento activo. savedSkins: null = sin override. */
    public record State(String name, long startedAtMillis,
                        Map<UUID, SavedSkin> savedSkins,
                        List<EventManager.Assignment> assignments,
                        Map<UUID, SavedLocation> origins) {}

    private static final Gson GSON = new GsonBuilder().serializeNulls().create();
    private final File file;
    private final File pendingFile;
    private final Logger logger;

    public StateStore(File dataFolder, Logger logger) {
        this.file = new File(dataFolder, "active-event.json");
        this.pendingFile = new File(dataFolder, "pending-cleanup.json");
        this.logger = logger;
    }

    public void save(State state) {
        write(file, GSON.toJson(state), "el estado del evento");
    }

    /** null si no hay evento pendiente. */
    public State load() {
        if (!file.exists()) {
            return null;
        }
        try {
            return GSON.fromJson(
                    Files.readString(file.toPath(), StandardCharsets.UTF_8), State.class);
        } catch (Exception e) {
            logger.severe("Estado de evento ilegible (" + e.getMessage() + "); se descarta.");
            return null;
        }
    }

    public void clear() {
        if (file.exists() && !file.delete()) {
            logger.warning("No se pudo borrar " + file.getName());
        }
    }

    // ---------- limpieza pendiente ----------
    // Participantes que estaban DESCONECTADOS cuando el evento termino: hay
    // que quitarles los efectos del Ki cuando vuelvan. Persistido para que
    // sobreviva a reinicios del servidor.

    public Map<UUID, SavedLocation> loadPendingCleanup() {
        if (!pendingFile.exists()) {
            return new HashMap<>();
        }
        try {
            Map<UUID, SavedLocation> loaded = GSON.fromJson(
                    Files.readString(pendingFile.toPath(), StandardCharsets.UTF_8),
                    new TypeToken<Map<UUID, SavedLocation>>() {}.getType());
            return loaded == null ? new HashMap<>() : loaded;
        } catch (Exception e) {
            logger.warning("Limpieza pendiente ilegible; se descarta: " + e.getMessage());
            return new HashMap<>();
        }
    }

    public void savePendingCleanup(Map<UUID, SavedLocation> pending) {
        if (pending.isEmpty()) {
            if (pendingFile.exists() && !pendingFile.delete()) {
                logger.warning("No se pudo borrar " + pendingFile.getName());
            }
            return;
        }
        write(pendingFile, GSON.toJson(pending), "la limpieza pendiente");
    }

    private void write(File target, String json, String what) {
        try {
            Files.createDirectories(target.getParentFile().toPath());
            Files.writeString(target.toPath(), json, StandardCharsets.UTF_8);
        } catch (IOException e) {
            logger.severe("No se pudo persistir " + what + ": " + e.getMessage());
        }
    }
}
