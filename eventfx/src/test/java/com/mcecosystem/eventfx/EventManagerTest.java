package com.mcecosystem.eventfx;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.bukkit.potion.PotionEffectType;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.plugin.PluginMock;

import java.io.File;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.logging.Logger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class EventManagerTest {

    private static final List<String> POOL = List.of("Goku", "Vegeta", "Piccolo");

    @TempDir
    File tempDir;

    private ServerMock server;
    private PluginMock plugin;
    private FakeSkinService skins;
    private CapturingOutput output;
    private EventManager manager;

    @BeforeEach
    void setUp() {
        server = MockBukkit.mock();
        plugin = MockBukkit.createMockPlugin();
        skins = new FakeSkinService();
        output = new CapturingOutput();
        // Executor inline: la fase async corre determinista en el test.
        manager = new EventManager(plugin, skins, output,
                new StateStore(tempDir, Logger.getLogger("test")),
                POOL, 300, "minecraft:entity.wither.spawn",
                "minecraft:block.beacon.deactivate",
                "mcecosystem:evento.musica", 0, Runnable::run);
    }

    @AfterEach
    void tearDown() {
        MockBukkit.unmock();
    }

    @Test
    void fullCycleAssignsDistinctSkinsAndRestoresThemEvenForDisconnected() {
        PlayerMock ana = server.addPlayer("Ana");
        PlayerMock beto = server.addPlayer("Beto");
        // Ana tenía una skin custom; Beto no tenía override (premium pura).
        skins.preset(ana.getUniqueId(), "skin-original-de-ana");
        // Issue #1: Ana llega con hambre (no podría correr).
        ana.setFoodLevel(4);

        assertTrue(manager.start("torneo de prueba", server.getConsoleSender()));
        // Deja correr la secuencia dramática (5 s = 100 ticks).
        server.getScheduler().performTicks(110);

        // Skins asignadas: aleatorias, del pool y DISTINTAS entre sí.
        String skinAna = skins.storage.get(ana.getUniqueId()).value();
        String skinBeto = skins.storage.get(beto.getUniqueId()).value();
        assertTrue(POOL.contains(skinAna) && POOL.contains(skinBeto));
        assertEquals(2, Set.of(skinAna, skinBeto).size(), "las skins deben ser distintas");

        // Buffs aplicados tras el ¡PODER MÁXIMO!
        assertTrue(ana.hasPotionEffect(PotionEffectType.STRENGTH));
        assertTrue(beto.hasPotionEffect(PotionEffectType.HEALTH_BOOST));

        // Issue #1: comida llena al iniciar, y refill durante el evento.
        assertEquals(20, ana.getFoodLevel(), "la comida debe llenarse al iniciar");
        ana.setFoodLevel(3);
        server.getScheduler().performTicks(20 * 30 + 5);
        assertEquals(20, ana.getFoodLevel(), "el refill periódico debe rellenar");

        // event.start con el data del catálogo.
        JsonObject start = output.single("event.start").getAsJsonObject("data");
        assertEquals("torneo de prueba", start.get("name").getAsString());
        assertEquals("torneo_ki", start.get("kind").getAsString());
        assertEquals(2, start.getAsJsonArray("participants").size());
        JsonArray assignments = start.getAsJsonArray("assignments");
        Set<String> assignedSkins = new HashSet<>();
        assignments.forEach(a -> assignedSkins.add(
                a.getAsJsonObject().get("skin").getAsString()));
        assertEquals(Set.of(skinAna, skinBeto), assignedSkins);

        // Caso borde: Beto se desconecta A MITAD del evento.
        beto.disconnect();

        assertTrue(manager.end());

        // Ambos restaurados, incluido el desconectado (nivel storage).
        assertEquals("skin-original-de-ana",
                skins.storage.get(ana.getUniqueId()).value());
        assertNull(skins.storage.get(beto.getUniqueId()),
                "Beto no tenía override: su entrada debe desaparecer");
        // Efectos limpiados para quien sigue online.
        assertFalse(ana.hasPotionEffect(PotionEffectType.STRENGTH));

        // event.end con duración real.
        JsonObject end = output.single("event.end").getAsJsonObject("data");
        assertEquals("torneo de prueba", end.get("name").getAsString());
        assertTrue(end.get("duration_s").getAsLong() >= 0);

        // Tras terminar, el refill de comida deja de actuar.
        ana.setFoodLevel(5);
        server.getScheduler().performTicks(20 * 60);
        assertEquals(5, ana.getFoodLevel(), "sin evento no debe haber refill");

        // Y el manager queda libre para el siguiente evento.
        assertFalse(manager.isActive());
        assertFalse(manager.end(), "sin evento activo, end() debe devolver false");
    }

    @Test
    void refusesToStartWhenPoolIsSmallerThanOnlinePlayers() {
        for (int i = 0; i < 4; i++) {
            server.addPlayer("Jugador" + i); // 4 jugadores, pool de 3
        }
        assertFalse(manager.start("torneo imposible", server.getConsoleSender()));
        assertFalse(manager.isActive());
        assertEquals(0, output.events.size());
    }
}
