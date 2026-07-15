package com.mcecosystem.eventcollector;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.player.PlayerAdvancementDoneEvent;

/** advancement.done y boss.kill (con sus hitos ender_dragon/wither). */
public final class ProgressListener implements Listener {

    private static final double PARTICIPANT_RADIUS_SQ = 128 * 128;

    private final EventOutput sender;
    private final MilestoneTracker milestones;

    public ProgressListener(EventOutput sender, MilestoneTracker milestones) {
        this.sender = sender;
        this.milestones = milestones;
    }

    @EventHandler
    public void onAdvancement(PlayerAdvancementDoneEvent event) {
        String key = event.getAdvancement().getKey().toString();
        if (key.startsWith("minecraft:recipes/")) {
            return; // desbloqueos de recetas: ruido, no progreso real
        }
        JsonObject data = new JsonObject();
        data.addProperty("advancement", key);

        JsonObject json = EventJson.base("advancement.done", event.getPlayer().getUniqueId());
        EventJson.position(json, event.getPlayer().getLocation());
        json.add("data", data);
        sender.send(EventJson.eventUuid(json), json.toString());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onBossDeath(EntityDeathEvent event) {
        LivingEntity boss = event.getEntity();
        String bossName;
        if (boss.getType() == EntityType.ENDER_DRAGON) {
            bossName = "ender_dragon";
        } else if (boss.getType() == EntityType.WITHER) {
            bossName = "wither";
        } else {
            return;
        }

        Player killer = boss.getKiller();
        JsonArray participants = new JsonArray();
        for (Player player : boss.getWorld().getPlayers()) {
            if (player.getLocation().distanceSquared(boss.getLocation()) <= PARTICIPANT_RADIUS_SQ) {
                participants.add(player.getUniqueId().toString());
            }
        }

        JsonObject data = new JsonObject();
        data.addProperty("boss", bossName);
        data.add("participants", participants);

        JsonObject json = EventJson.base("boss.kill",
                killer != null ? killer.getUniqueId() : null);
        EventJson.position(json, boss.getLocation());
        json.add("data", data);
        sender.send(EventJson.eventUuid(json), json.toString());

        milestones.claim(bossName, killer);
    }
}
