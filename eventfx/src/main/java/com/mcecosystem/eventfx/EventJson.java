package com.mcecosystem.eventfx;

import com.google.gson.JsonObject;

import java.time.Instant;
import java.util.UUID;

/** Esqueleto común del catálogo. Los eventos de EventFX son de servidor
 *  (player_uuid = NULL), así que aquí no hay jugador. */
final class EventJson {

    private EventJson() {}

    static JsonObject base(String type) {
        JsonObject json = new JsonObject();
        json.addProperty("event_uuid", UUID.randomUUID().toString());
        json.addProperty("type", type);
        json.addProperty("v", 1);
        json.addProperty("ts", Instant.now().toString()); // UTC, ISO-8601
        return json;
    }

    static String eventUuid(JsonObject json) {
        return json.get("event_uuid").getAsString();
    }
}
