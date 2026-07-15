package com.mcecosystem.eventcollector;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** Fake de EventOutput para tests: captura los JSON en memoria. */
final class CapturingOutput implements EventOutput {

    final List<JsonObject> events = new ArrayList<>();

    @Override
    public void send(String eventUuid, String jsonBody) {
        events.add(JsonParser.parseString(jsonBody).getAsJsonObject());
    }

    @Override
    public void storeDurable(String eventUuid, String jsonBody) {
        send(eventUuid, jsonBody);
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
