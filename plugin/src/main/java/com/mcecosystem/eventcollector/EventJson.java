package com.mcecosystem.eventcollector;

import com.google.gson.JsonObject;

import java.time.Instant;
import java.util.UUID;

/** Construye el esqueleto común de todo evento del catálogo (v1). */
final class EventJson {

    private EventJson() {}

    static JsonObject base(String type, UUID playerUuid) {
        JsonObject json = new JsonObject();
        json.addProperty("event_uuid", UUID.randomUUID().toString());
        json.addProperty("type", type);
        json.addProperty("v", 1);
        json.addProperty("ts", Instant.now().toString()); // UTC, ISO-8601
        if (playerUuid != null) {
            json.addProperty("player_uuid", playerUuid.toString());
        }
        return json;
    }

    static String eventUuid(JsonObject json) {
        return json.get("event_uuid").getAsString();
    }

    static void position(JsonObject json, org.bukkit.Location loc) {
        json.addProperty("world", loc.getWorld().getName());
        json.addProperty("x", loc.getBlockX());
        json.addProperty("y", loc.getBlockY());
        json.addProperty("z", loc.getBlockZ());
    }
}
