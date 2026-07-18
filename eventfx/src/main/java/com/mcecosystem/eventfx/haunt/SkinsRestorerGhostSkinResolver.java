package com.mcecosystem.eventfx.haunt;

import net.skinsrestorer.api.SkinsRestorer;
import net.skinsrestorer.api.property.SkinVariant;

import java.util.Optional;
import java.util.logging.Logger;

/** Reutiliza el storage de SkinsRestorer: convierte URL/nombre en propiedad
 *  firmada (vía MineSkin/Mojang) y la cachea entre usos. */
public final class SkinsRestorerGhostSkinResolver implements GhostSkinResolver {

    private final SkinsRestorer sr;
    private final Logger logger;

    public SkinsRestorerGhostSkinResolver(SkinsRestorer sr, Logger logger) {
        this.sr = sr;
        this.logger = logger;
    }

    @Override
    public Optional<GhostSkin> resolve(String poolEntry) {
        try {
            return (poolEntry.startsWith("http")
                    ? sr.getSkinStorage().findOrCreateSkinData(poolEntry, SkinVariant.CLASSIC)
                    : sr.getSkinStorage().findOrCreateSkinData(poolEntry))
                    .map(result -> new GhostSkin(
                            result.getProperty().getValue(),
                            result.getProperty().getSignature()));
        } catch (Exception e) {
            logger.warning("Skin de haunting no resuelta '" + poolEntry + "': " + e.getMessage());
            return Optional.empty();
        }
    }
}
