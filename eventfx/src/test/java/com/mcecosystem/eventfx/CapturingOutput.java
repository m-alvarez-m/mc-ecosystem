package com.mcecosystem.eventfx;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** Fake de EventOutput: captura los JSON en memoria (patrón del collector). */
final class CapturingOutput implements EventOutput {

    final List<JsonObject> events = new CopyOnWriteArrayList<>();

    @Override
    public void send(String eventUuid, String jsonBody) {
        events.add(JsonParser.parseString(jsonBody).getAsJsonObject());
    }

    JsonObject single(String type) {
        List<JsonObject> matches = events.stream()
                .filter(e -> e.get("type").getAsString().equals(type))
                .toList();
        assertEquals(1, matches.size(),
                "se esperaba exactamente un evento " + type + ", hubo " + matches.size());
        return matches.get(0);
    }
}
