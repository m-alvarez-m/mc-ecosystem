package com.mcecosystem.eventfx;

import java.util.Optional;
import java.util.UUID;

/**
 * Abstracción sobre el sistema de skins (mismo patrón que EventOutput:
 * en producción SkinsRestorer, en tests un fake en memoria).
 * Todas las operaciones trabajan a nivel de STORAGE por UUID: funcionan
 * aunque el jugador esté desconectado (la skin se aplica en su próximo
 * login) — es la base del diseño de restauración al terminar el evento.
 */
public interface SkinService {

    /** Skin actualmente almacenada; vacío si el jugador no tiene override. */
    Optional<SavedSkin> getCurrentSkin(UUID player);

    /**
     * Aplica una entrada del pool (nombre premium o URL http...).
     * @return false si la skin no pudo resolverse.
     */
    boolean setSkin(UUID player, String poolEntry);

    /** Restaura lo guardado; null = el jugador no tenía override (se quita). */
    void restoreSkin(UUID player, SavedSkin saved);
}
