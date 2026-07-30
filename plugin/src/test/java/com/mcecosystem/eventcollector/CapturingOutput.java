package com.mcecosystem.eventcollector;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** Fake de EventOutput para tests: captura los JSON en memoria. */
final class CapturingOutput implements EventOutput {

    final List<JsonObject> events = new ArrayList<>();
    /** Subconjunto de events que entró por storeDurable (camino de apagado). */
    final List<JsonObject> durable = new ArrayList<>();
    /** JSON crudos tal cual salen del plugin (mismos bytes que iría por HTTP). */
    final List<String> rawBodies = new ArrayList<>();

    @Override
    public void send(String eventUuid, String jsonBody) {
        rawBodies.add(jsonBody);
        events.add(JsonParser.parseString(jsonBody).getAsJsonObject());
    }

    @Override
    public void storeDurable(String eventUuid, String jsonBody) {
        rawBodies.add(jsonBody);
        JsonObject json = JsonParser.parseString(jsonBody).getAsJsonObject();
        events.add(json);
        durable.add(json);
    }

    List<JsonObject> ofType(String type) {
        return events.stream()
                .filter(e -> e.get("type").getAsString().equals(type))
                .toList();
    }

    JsonObject single(String type) {
        List<JsonObject> matches = ofType(type);
        assertEquals(1, matches.size(),
                "se esperaba exactamente un evento " + type + ", hubo " + matches.size());
        return matches.get(0);
    }
}
