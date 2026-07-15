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
