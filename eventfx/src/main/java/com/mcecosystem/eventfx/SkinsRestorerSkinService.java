package com.mcecosystem.eventfx;

import net.skinsrestorer.api.SkinsRestorer;
import net.skinsrestorer.api.property.InputDataResult;
import net.skinsrestorer.api.property.SkinIdentifier;
import net.skinsrestorer.api.property.SkinType;
import net.skinsrestorer.api.property.SkinVariant;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

import java.util.Optional;
import java.util.UUID;
import java.util.logging.Logger;

/**
 * Implementación real sobre la API de SkinsRestorer.
 * Llamar SIEMPRE desde un hilo async: resolver skins toca red/disco.
 */
public final class SkinsRestorerSkinService implements SkinService {

    private final SkinsRestorer sr;
    private final Logger logger;

    public SkinsRestorerSkinService(SkinsRestorer sr, Logger logger) {
        this.sr = sr;
        this.logger = logger;
    }

    @Override
    public Optional<SavedSkin> getCurrentSkin(UUID player) {
        return sr.getPlayerStorage().getSkinIdOfPlayer(player)
                .map(id -> new SavedSkin(
                        id.getIdentifier(),
                        id.getSkinVariant() == null ? null : id.getSkinVariant().name(),
                        id.getSkinType().name()));
    }

    @Override
    public boolean setSkin(UUID player, String poolEntry) {
        try {
            Optional<InputDataResult> result = poolEntry.startsWith("http")
                    ? sr.getSkinStorage().findOrCreateSkinData(poolEntry, SkinVariant.CLASSIC)
                    : sr.getSkinStorage().findOrCreateSkinData(poolEntry);
            if (result.isEmpty()) {
                logger.warning("Skin del pool no resuelta: " + poolEntry);
                return false;
            }
            sr.getPlayerStorage().setSkinIdOfPlayer(player, result.get().getIdentifier());
            applyIfOnline(player);
            return true;
        } catch (Exception e) {
            logger.warning("Error aplicando skin '" + poolEntry + "': " + e.getMessage());
            return false;
        }
    }

    @Override
    public void restoreSkin(UUID player, SavedSkin saved) {
        if (saved == null) {
            sr.getPlayerStorage().removeSkinIdOfPlayer(player);
        } else {
            sr.getPlayerStorage().setSkinIdOfPlayer(player, SkinIdentifier.of(
                    saved.value(),
                    saved.variant() == null ? null : SkinVariant.valueOf(saved.variant()),
                    SkinType.valueOf(saved.type())));
        }
        applyIfOnline(player);
    }

    /** Los desconectados no necesitan apply: SR aplica el storage al entrar. */
    private void applyIfOnline(UUID player) {
        Player online = Bukkit.getPlayer(player);
        if (online != null) {
            try {
                sr.getSkinApplier(Player.class).applySkin(online);
            } catch (Exception e) {
                logger.warning("No se pudo re-aplicar la skin de " + online.getName()
                        + ": " + e.getMessage());
            }
        }
    }
}
