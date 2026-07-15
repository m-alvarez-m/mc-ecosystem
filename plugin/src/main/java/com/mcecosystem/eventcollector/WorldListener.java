package com.mcecosystem.eventcollector;

import com.google.gson.JsonObject;
import org.bukkit.Chunk;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.world.ChunkLoadEvent;

/**
 * block.place, dimension.enter, chunk.first_load, y los disparadores
 * de hitos ligados al mundo (nether, end, diamond, elytra).
 */
public final class WorldListener implements Listener {

    private final EventOutput sender;
    private final MilestoneTracker milestones;

    public WorldListener(EventOutput sender, MilestoneTracker milestones) {
        this.sender = sender;
        this.milestones = milestones;
    }

    @EventHandler(ignoreCancelled = true)
    public void onBlockPlace(BlockPlaceEvent event) {
        JsonObject data = new JsonObject();
        data.addProperty("block", event.getBlockPlaced().getType().getKey().toString());

        JsonObject json = EventJson.base("block.place", event.getPlayer().getUniqueId());
        EventJson.position(json, event.getBlockPlaced().getLocation());
        json.add("data", data);
        sender.send(EventJson.eventUuid(json), json.toString());
    }

    @EventHandler
    public void onChangedWorld(PlayerChangedWorldEvent event) {
        Player player = event.getPlayer();
        String dimension = dimensionName(player.getWorld());

        JsonObject data = new JsonObject();
        data.addProperty("dimension", dimension);
        JsonObject json = EventJson.base("dimension.enter", player.getUniqueId());
        EventJson.position(json, player.getLocation());
        json.add("data", data);
        sender.send(EventJson.eventUuid(json), json.toString());

        if ("the_nether".equals(dimension)) {
            milestones.claim("nether", player);
        } else if ("the_end".equals(dimension)) {
            milestones.claim("end", player);
        }
    }

    @EventHandler(ignoreCancelled = true)
    public void onBlockBreak(BlockBreakEvent event) {
        Material type = event.getBlock().getType();
        if (type == Material.DIAMOND_ORE || type == Material.DEEPSLATE_DIAMOND_ORE) {
            milestones.claim("diamond", event.getPlayer());
        }
    }

    @EventHandler(ignoreCancelled = true)
    public void onPickup(EntityPickupItemEvent event) {
        if (event.getEntity() instanceof Player player
                && event.getItem().getItemStack().getType() == Material.ELYTRA) {
            milestones.claim("elytra", player);
        }
    }

    @EventHandler
    public void onChunkLoad(ChunkLoadEvent event) {
        if (!event.isNewChunk()) {
            return; // solo chunks generados por primera vez
        }
        Chunk chunk = event.getChunk();
        Player discoverer = nearestPlayer(chunk);
        if (discoverer == null) {
            return; // generación sin jugador cerca (spawn inicial): sin atribución
        }
        JsonObject data = new JsonObject();
        data.addProperty("chunk_x", chunk.getX());
        data.addProperty("chunk_z", chunk.getZ());

        JsonObject json = EventJson.base("chunk.first_load", discoverer.getUniqueId());
        json.addProperty("world", chunk.getWorld().getName());
        json.addProperty("x", chunk.getX() * 16);
        json.addProperty("z", chunk.getZ() * 16);
        json.add("data", data);
        sender.send(EventJson.eventUuid(json), json.toString());
    }

    private static Player nearestPlayer(Chunk chunk) {
        double centerX = chunk.getX() * 16 + 8;
        double centerZ = chunk.getZ() * 16 + 8;
        Player nearest = null;
        double best = Double.MAX_VALUE;
        for (Player player : chunk.getWorld().getPlayers()) {
            double dx = player.getLocation().getX() - centerX;
            double dz = player.getLocation().getZ() - centerZ;
            double distSq = dx * dx + dz * dz;
            if (distSq < best) {
                best = distSq;
                nearest = player;
            }
        }
        return nearest;
    }

    static String dimensionName(World world) {
        return switch (world.getEnvironment()) {
            case NETHER -> "the_nether";
            case THE_END -> "the_end";
            case NORMAL -> "overworld";
            default -> world.getName();
        };
    }
}
