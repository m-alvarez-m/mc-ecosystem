package com.mcecosystem.eventfx;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Fake de SkinService: un mapa uuid -> skin. Trabaja "a nivel storage"
 * como el real: acepta operaciones sobre jugadores desconectados.
 */
final class FakeSkinService implements SkinService {

    final Map<UUID, SavedSkin> storage = new HashMap<>();

    void preset(UUID player, String skinValue) {
        storage.put(player, new SavedSkin(skinValue, null, "PLAYER"));
    }

    @Override
    public Optional<SavedSkin> getCurrentSkin(UUID player) {
        return Optional.ofNullable(storage.get(player));
    }

    @Override
    public boolean setSkin(UUID player, String poolEntry) {
        storage.put(player, new SavedSkin(poolEntry, null, "PLAYER"));
        return true;
    }

    @Override
    public void restoreSkin(UUID player, SavedSkin saved) {
        if (saved == null) {
            storage.remove(player);
        } else {
            storage.put(player, saved);
        }
    }
}
