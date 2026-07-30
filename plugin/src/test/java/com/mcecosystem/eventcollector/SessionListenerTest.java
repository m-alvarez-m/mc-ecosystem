package com.mcecosystem.eventcollector;

import com.google.gson.JsonObject;
import org.bukkit.event.player.PlayerQuitEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SessionListenerTest {

    private ServerMock server;
    private CapturingOutput output;
    private ActivityTracker tracker;
    private SessionListener listener;

    @BeforeEach
    void setUp() {
        server = MockBukkit.mock();
        output = new CapturingOutput();
        // Umbral 0: cualquier jugador sin input desde hace >0 ms es AFK.
        tracker = new ActivityTracker(output, 0);
        listener = new SessionListener(output, tracker);
        server.getPluginManager().registerEvents(listener, MockBukkit.createMockPlugin());
    }

    @AfterEach
    void tearDown() {
        MockBukkit.unmock();
    }

    @Test
    void sessionStartIncludesPlayerNameInData() {
        PlayerMock player = server.addPlayer("Vancorbus");

        JsonObject start = output.single("session.start");
        JsonObject data = start.getAsJsonObject("data");
        assertEquals("Vancorbus", data.get("name").getAsString(),
                "session.start.data.name debe reflejar player.getName() para poblar players");
        assertEquals(player.getUniqueId().toString(),
                start.get("player_uuid").getAsString(),
                "player_uuid a nivel raíz sigue siendo la identidad canónica del evento");
    }

    @Test
    void sessionStartRawJsonMatchesApiContract() throws java.io.IOException {
        // Verificación empírica: el JSON crudo que el plugin serializaría
        // por HTTP debe pasar la validación AJV del api sin modificaciones.
        // Este test extrae los bytes exactos y los deja en build/ para
        // que un curl externo los envíe al api sin re-serializar en medio.
        server.addPlayer("Vancorbus");

        String rawJson = output.rawBodies.stream()
                .filter(s -> s.contains("\"type\":\"session.start\""))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no se capturó session.start"));

        // Validación de shape en el propio plugin, contra el schema del api:
        //   required: event_uuid, type, v, ts
        //   opcionales tipados: player_uuid (uuid), data (object)
        //   additionalProperties: false → todo campo debe estar en la lista
        JsonObject json = com.google.gson.JsonParser.parseString(rawJson).getAsJsonObject();
        java.util.UUID.fromString(json.get("event_uuid").getAsString()); // format:"uuid"
        assertEquals("session.start", json.get("type").getAsString());
        assertEquals(1, json.get("v").getAsInt());                        // integer >= 1
        java.time.Instant.parse(json.get("ts").getAsString());            // format:"date-time"
        java.util.UUID.fromString(json.get("player_uuid").getAsString()); // format:"uuid"
        JsonObject data = json.getAsJsonObject("data");
        assertEquals("Vancorbus", data.get("name").getAsString());

        // Ningún campo prohibido por additionalProperties:false del api.
        java.util.Set<String> allowedTopLevel = java.util.Set.of(
                "event_uuid", "type", "v", "ts",
                "player_uuid", "world", "x", "y", "z", "data");
        for (String key : json.keySet()) {
            assertTrue(allowedTopLevel.contains(key),
                    "campo top-level '" + key + "' no está permitido por el schema del api");
        }

        // Volcado del JSON crudo para verificación end-to-end con curl.
        java.nio.file.Path out = java.nio.file.Path.of("build", "plugin-emitted-session-start.json");
        java.nio.file.Files.createDirectories(out.getParent());
        java.nio.file.Files.writeString(out, rawJson);
    }

    @Test
    void flushForShutdownClosesOpenSessionsDurablyWithAfkFirst() throws InterruptedException {
        PlayerMock afkPlayer = server.addPlayer("Afk");
        PlayerMock quitter = server.addPlayer("Quitter");
        assertEquals(2, output.ofType("session.start").size());

        // Afk cruza el umbral (0 s) en el siguiente poll.
        Thread.sleep(5);
        tracker.poll(List.of(afkPlayer));
        assertTrue(tracker.isAfk(afkPlayer.getUniqueId()));
        output.single("session.afk_start");

        // Quitter se va por el camino normal ANTES del apagado.
        server.getPluginManager().callEvent(new PlayerQuitEvent(
                quitter, (net.kyori.adventure.text.Component) null,
                PlayerQuitEvent.QuitReason.DISCONNECTED));
        assertEquals("quit", output.single("session.end")
                .getAsJsonObject("data").get("reason").getAsString());

        listener.flushForShutdown();

        // Solo la sesión de Afk seguía abierta: un session.end nuevo, no dos.
        List<JsonObject> ends = output.ofType("session.end");
        assertEquals(2, ends.size(), "el quit normal no debe re-emitirse en el flush");
        JsonObject shutdownEnd = ends.get(1);
        assertEquals(afkPlayer.getUniqueId().toString(),
                shutdownEnd.get("player_uuid").getAsString());
        assertEquals("server_stop",
                shutdownEnd.getAsJsonObject("data").get("reason").getAsString());
        assertTrue(shutdownEnd.getAsJsonObject("data").get("duration_s").getAsLong() >= 0);

        // Su tramo AFK se cerró, y ANTES que su session.end.
        JsonObject afkEnd = output.single("session.afk_end");
        assertEquals(afkPlayer.getUniqueId().toString(),
                afkEnd.get("player_uuid").getAsString());
        assertTrue(output.events.indexOf(afkEnd) < output.events.indexOf(shutdownEnd),
                "el afk_end debe emitirse antes que el session.end");

        // Ambos por el camino durable: la red no existe durante el apagado.
        assertTrue(output.durable.contains(afkEnd), "afk_end debe ir al buffer");
        assertTrue(output.durable.contains(shutdownEnd), "session.end debe ir al buffer");

        // Idempotente: un segundo flush no encuentra sesiones abiertas.
        int total = output.events.size();
        listener.flushForShutdown();
        assertEquals(total, output.events.size(), "el flush debe ser idempotente");
    }
}
