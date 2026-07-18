package com.mcecosystem.eventfx.haunt;

import java.util.Optional;

/** Resuelve una entrada del pool (nombre premium o URL) a una skin firmada.
 *  Llamar desde async: puede tocar red la primera vez. */
public interface GhostSkinResolver {

    Optional<GhostSkin> resolve(String poolEntry);
}
