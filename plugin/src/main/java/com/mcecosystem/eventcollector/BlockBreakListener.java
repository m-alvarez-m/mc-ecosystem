package com.mcecosystem.eventcollector;

import com.google.gson.JsonObject;
import org.bukkit.block.Block;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.inventory.ItemStack;

import java.time.Instant;
import java.util.UUID;

/**
 * block.break v1 según docs/event-catalog.md:
 * data = { block, tool, silk, fortune }
 */
public final class BlockBreakListener implements Listener {

    private final EventSender sender;

    public BlockBreakListener(EventSender sender) {
        this.sender = sender;
    }

    @EventHandler(ignoreCancelled = true)
    public void onBlockBreak(BlockBreakEvent event) {
        // Todo lo que toca la API de Bukkit se lee AQUÍ, en el hilo principal.
        // Al hilo de red solo viaja el String JSON ya construido.
        Player player = event.getPlayer();
        Block block = event.getBlock();
        ItemStack tool = player.getInventory().getItemInMainHand();

        JsonObject data = new JsonObject();
        data.addProperty("block", block.getType().getKey().toString());
        data.addProperty("tool", tool.getType().getKey().toString());
        data.addProperty("silk", tool.containsEnchantment(Enchantment.SILK_TOUCH));
        data.addProperty("fortune", tool.getEnchantmentLevel(Enchantment.FORTUNE));

        String eventUuid = UUID.randomUUID().toString();
        JsonObject json = new JsonObject();
        json.addProperty("event_uuid", eventUuid);
        json.addProperty("type", "block.break");
        json.addProperty("v", 1);
        json.addProperty("ts", Instant.now().toString()); // UTC, ISO-8601
        json.addProperty("player_uuid", player.getUniqueId().toString());
        json.addProperty("world", block.getWorld().getName());
        json.addProperty("x", block.getX());
        json.addProperty("y", block.getY());
        json.addProperty("z", block.getZ());
        json.add("data", data);

        sender.send(eventUuid, json.toString());
    }
}
