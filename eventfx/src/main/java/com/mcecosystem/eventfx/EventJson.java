package com.mcecosystem.eventfx;

import com.google.gson.JsonObject;

import java.time.Instant;
import java.util.UUID;

/** Esqueleto común del catálogo. Los eventos de EventFX son de servidor
 *  (player_uuid = NULL), así que aquí no hay jugador. */
public final class EventJson {

    private EventJson() {}

    public static JsonObject base(String type) {
        JsonObject json = new JsonObject();
        json.addProperty("event_uuid", UUID.randomUUID().toString());
        json.addProperty("type", type);
        json.addProperty("v", 1);
        json.addProperty("ts", Instant.now().toString()); // UTC, ISO-8601
        return json;
    }

    public static String eventUuid(JsonObject json) {
        return json.get("event_uuid").getAsString();
    }

    public static void position(JsonObject json, org.bukkit.Location loc) {
        json.addProperty("world", loc.getWorld().getName());
        json.addProperty("x", loc.getBlockX());
        json.addProperty("y", loc.getBlockY());
        json.addProperty("z", loc.getBlockZ());
    }
}
