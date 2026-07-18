package com.mcecosystem.eventfx.haunt;

import org.bukkit.Location;
import org.bukkit.entity.Player;

/**
 * Materializa/desvanece el NPC fantasma para UN solo cliente.
 * En producción: paquetes crudos vía PacketEvents. En tests: fake en memoria.
 * El NPC no existe en el servidor: sin colisión, sin interacción posible
 * (los packets de interact del cliente referirán un entity id que el
 * servidor no conoce y descartará).
 */
public interface GhostPresenter {

    /** Spawnea el fantasma orientado con yaw/pitch; devuelve su entity id. */
    int showGhost(Player target, Location where, float yaw, float pitch, GhostSkin skin);

    void removeGhost(Player target, int entityId);
}
