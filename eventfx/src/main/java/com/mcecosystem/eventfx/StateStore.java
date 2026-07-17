package com.mcecosystem.eventfx;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Logger;

/**
 * Persistencia del evento activo (active-event.json). Si el servidor muere
 * a mitad de un evento, este archivo permite restaurar las skins en el
 * próximo arranque — mismo espíritu durable que el server.stop del collector.
 */
public final class StateStore {

    /** Estado serializable del evento activo. savedSkins: null = sin override. */
    public record State(String name, long startedAtMillis,
                        Map<UUID, SavedSkin> savedSkins,
                        List<EventManager.Assignment> assignments) {}

    private static final Gson GSON = new GsonBuilder().serializeNulls().create();
    private final File file;
    private final Logger logger;

    public StateStore(File dataFolder, Logger logger) {
        this.file = new File(dataFolder, "active-event.json");
        this.logger = logger;
    }

    public void save(State state) {
        try {
            Files.createDirectories(file.getParentFile().toPath());
            Files.writeString(file.toPath(), GSON.toJson(state), StandardCharsets.UTF_8);
        } catch (IOException e) {
            logger.severe("No se pudo persistir el estado del evento: " + e.getMessage());
        }
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
}
