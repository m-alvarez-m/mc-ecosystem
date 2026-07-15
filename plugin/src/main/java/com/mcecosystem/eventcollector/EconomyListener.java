package com.mcecosystem.eventcollector;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import io.papermc.paper.event.player.PlayerTradeEvent;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.AbstractVillager;
import org.bukkit.entity.Item;
import org.bukkit.entity.Player;
import org.bukkit.entity.Villager;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.enchantment.EnchantItemEvent;
import org.bukkit.event.inventory.CraftItemEvent;
import org.bukkit.event.player.PlayerFishEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.MerchantRecipe;

import java.util.Map;

/** villager.trade, item.craft, item.enchant y fishing.catch. */
public final class EconomyListener implements Listener {

    private final EventOutput sender;

    public EconomyListener(EventOutput sender) {
        this.sender = sender;
    }

    @EventHandler(ignoreCancelled = true)
    public void onTrade(PlayerTradeEvent event) {
        AbstractVillager villager = event.getVillager();
        MerchantRecipe trade = event.getTrade();
        ItemStack result = trade.getResult();

        JsonObject data = new JsonObject();
        data.addProperty("profession", villager instanceof Villager v
                ? v.getProfession().getKey().getKey()
                : villager.getType().getKey().getKey());
        data.addProperty("input", trade.getIngredients().isEmpty()
                ? "minecraft:air"
                : trade.getIngredients().get(0).getType().getKey().toString());
        data.addProperty("output", result.getType().getKey().toString());
        data.addProperty("count", result.getAmount());

        JsonObject json = EventJson.base("villager.trade", event.getPlayer().getUniqueId());
        EventJson.position(json, villager.getLocation());
        json.add("data", data);
        sender.send(EventJson.eventUuid(json), json.toString());
    }

    @EventHandler(ignoreCancelled = true)
    public void onCraft(CraftItemEvent event) {
        if (!(event.getWhoClicked() instanceof Player player)) {
            return;
        }
        ItemStack result = event.getRecipe().getResult();
        JsonObject data = new JsonObject();
        data.addProperty("item", result.getType().getKey().toString());
        data.addProperty("count", result.getAmount());

        JsonObject json = EventJson.base("item.craft", player.getUniqueId());
        EventJson.position(json, player.getLocation());
        json.add("data", data);
        sender.send(EventJson.eventUuid(json), json.toString());
    }

    @EventHandler(ignoreCancelled = true)
    public void onEnchant(EnchantItemEvent event) {
        JsonArray enchants = new JsonArray();
        for (Map.Entry<Enchantment, Integer> entry : event.getEnchantsToAdd().entrySet()) {
            JsonObject e = new JsonObject();
            e.addProperty("id", entry.getKey().getKey().toString());
            e.addProperty("lvl", entry.getValue());
            enchants.add(e);
        }
        JsonObject data = new JsonObject();
        data.addProperty("item", event.getItem().getType().getKey().toString());
        data.add("enchants", enchants);
        data.addProperty("cost_levels", event.getExpLevelCost());

        JsonObject json = EventJson.base("item.enchant", event.getEnchanter().getUniqueId());
        EventJson.position(json, event.getEnchanter().getLocation());
        json.add("data", data);
        sender.send(EventJson.eventUuid(json), json.toString());
    }

    @EventHandler(ignoreCancelled = true)
    public void onFish(PlayerFishEvent event) {
        if (event.getState() != PlayerFishEvent.State.CAUGHT_FISH
                || !(event.getCaught() instanceof Item caught)) {
            return;
        }
        JsonObject data = new JsonObject();
        data.addProperty("item", caught.getItemStack().getType().getKey().toString());

        JsonObject json = EventJson.base("fishing.catch", event.getPlayer().getUniqueId());
        EventJson.position(json, event.getPlayer().getLocation());
        json.add("data", data);
        sender.send(EventJson.eventUuid(json), json.toString());
    }
}
