package com.mcecosystem.eventfx.haunt;

import com.github.retrooper.packetevents.PacketEvents;
import com.github.retrooper.packetevents.protocol.entity.type.EntityTypes;
import com.github.retrooper.packetevents.protocol.player.GameMode;
import com.github.retrooper.packetevents.protocol.player.TextureProperty;
import com.github.retrooper.packetevents.protocol.player.UserProfile;
import com.github.retrooper.packetevents.util.Vector3d;
import com.github.retrooper.packetevents.wrapper.PacketWrapper;
import com.github.retrooper.packetevents.wrapper.play.server.WrapperPlayServerDestroyEntities;
import com.github.retrooper.packetevents.wrapper.play.server.WrapperPlayServerEntityHeadLook;
import com.github.retrooper.packetevents.wrapper.play.server.WrapperPlayServerPlayerInfoRemove;
import com.github.retrooper.packetevents.wrapper.play.server.WrapperPlayServerPlayerInfoUpdate;
import com.github.retrooper.packetevents.wrapper.play.server.WrapperPlayServerSpawnEntity;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

/**
 * La secuencia del fantasma, SOLO al canal del objetivo:
 * 1. PLAYER_INFO_UPDATE (ADD_PLAYER): presenta el perfil con la skin firmada.
 * 2. SPAWN_ENTITY (player): materializa el cuerpo orientado al objetivo.
 * 3. ENTITY_HEAD_LOOK: la cabeza también lo mira (el cuerpo solo no basta).
 * 4. PLAYER_INFO_REMOVE (~2 s después): lo borra del TAB; el cuerpo persiste.
 * 5. DESTROY_ENTITIES: la desaparición.
 */
public final class PacketGhostPresenter implements GhostPresenter {

    private final Plugin plugin;
    // entityId -> uuid del perfil, para el DESTROY + limpieza.
    private final Map<Integer, UUID> ghosts = new HashMap<>();

    public PacketGhostPresenter(Plugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public int showGhost(Player target, Location where, float yaw, float pitch, GhostSkin skin) {
        // Ids altos y aleatorios: jamás chocan con los incrementales del server.
        int entityId = 1_500_000_000 + ThreadLocalRandom.current().nextInt(500_000_000);
        UUID uuid = UUID.randomUUID();

        UserProfile profile = new UserProfile(uuid, "Herobrine", List.of(
                new TextureProperty("textures", skin.value(), skin.signature())));
        send(target, new WrapperPlayServerPlayerInfoUpdate(
                EnumSet.of(WrapperPlayServerPlayerInfoUpdate.Action.ADD_PLAYER),
                new WrapperPlayServerPlayerInfoUpdate.PlayerInfo(
                        profile, false, 0, GameMode.SURVIVAL, null, null)));
        send(target, new WrapperPlayServerSpawnEntity(entityId, Optional.of(uuid),
                EntityTypes.PLAYER,
                new Vector3d(where.getX(), where.getY(), where.getZ()),
                pitch, yaw, yaw, 0, Optional.empty()));
        send(target, new WrapperPlayServerEntityHeadLook(entityId, yaw));

        // Fuera del TAB tras 2 s: para entonces el cliente ya cacheó la skin.
        plugin.getServer().getScheduler().runTaskLater(plugin, () -> {
            if (target.isOnline()) {
                send(target, new WrapperPlayServerPlayerInfoRemove(List.of(uuid)));
            }
        }, 40L);

        ghosts.put(entityId, uuid);
        return entityId;
    }

    @Override
    public void removeGhost(Player target, int entityId) {
        UUID uuid = ghosts.remove(entityId);
        if (!target.isOnline()) {
            return; // el cliente que veía al fantasma ya no está: nada que limpiar
        }
        send(target, new WrapperPlayServerDestroyEntities(entityId));
        if (uuid != null) {
            // Por si el despawn llegó antes que la limpieza de TAB programada.
            send(target, new WrapperPlayServerPlayerInfoRemove(List.of(uuid)));
        }
    }

    private void send(Player target, PacketWrapper<?> packet) {
        PacketEvents.getAPI().getPlayerManager().sendPacket(target, packet);
    }
}
