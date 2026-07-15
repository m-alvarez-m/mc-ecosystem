package com.mcecosystem.eventcollector;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Acumulador de daño por jugador para damage.minute (decisión C del catálogo).
 *
 * SOLO el hilo principal escribe y hace swap(): por eso basta un HashMap
 * sin sincronización. El mapa devuelto por swap() queda huérfano (nadie
 * más lo escribe) y puede procesarse tranquilamente en un hilo async.
 */
final class DamageAggregator {

    static final class Stats {
        double dealt;
        double taken;
        int hitsDealt;
        int hitsTaken;
    }

    private Map<UUID, Stats> current = new HashMap<>();

    void addDealt(UUID playerUuid, double amount) {
        Stats s = current.computeIfAbsent(playerUuid, k -> new Stats());
        s.dealt += amount;
        s.hitsDealt++;
    }

    void addTaken(UUID playerUuid, double amount) {
        Stats s = current.computeIfAbsent(playerUuid, k -> new Stats());
        s.taken += amount;
        s.hitsTaken++;
    }

    /** Llamar SOLO desde el hilo principal. */
    Map<UUID, Stats> swap() {
        Map<UUID, Stats> old = current;
        current = new HashMap<>();
        return old;
    }
}
