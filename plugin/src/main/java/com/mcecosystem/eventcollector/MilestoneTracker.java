package com.mcecosystem.eventcollector;

import com.google.gson.JsonObject;
import org.bukkit.entity.Player;

/**
 * milestone.first: primera vez EN EL SERVIDOR (no por jugador).
 * La unicidad histórica la garantiza la tabla milestones de SQLite
 * (claim por INSERT atómico); sobrevive reinicios y crashes.
 */
public final class MilestoneTracker {

    private final EventOutput sender;
    private final EventBuffer buffer;

    public MilestoneTracker(EventOutput sender, EventBuffer buffer) {
        this.sender = sender;
        this.buffer = buffer;
    }

    public void claim(String what, Player player) {
        if (!buffer.claimMilestone(what)) {
            return; // ya lo logró alguien en el pasado
        }
        JsonObject data = new JsonObject();
        data.addProperty("what", what);
        JsonObject json = EventJson.base("milestone.first",
                player != null ? player.getUniqueId() : null);
        if (player != null) {
            EventJson.position(json, player.getLocation());
        }
        json.add("data", data);
        sender.send(EventJson.eventUuid(json), json.toString());
    }
}
