package com.mcecosystem.eventfx.haunt;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mcecosystem.eventfx.EventOutput;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

import java.io.File;
import java.util.List;
import java.util.Optional;
import java.util.Random;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HauntManagerTest {

    static final class FakePresenter implements GhostPresenter {
        final List<Location> shown = new CopyOnWriteArrayList<>();
        final List<Integer> removed = new CopyOnWriteArrayList<>();
        int nextId = 1;

        @Override
        public int showGhost(Player target, Location where, float yaw, float pitch, GhostSkin skin) {
            shown.add(where);
            return nextId++;
        }

        @Override
        public void removeGhost(Player target, int entityId) {
            removed.add(entityId);
        }
    }

    static final class FakeResolver implements GhostSkinResolver {
        @Override
        public Optional<GhostSkin> resolve(String poolEntry) {
            return Optional.of(new GhostSkin("v", "s"));
        }
    }

    static final class Capturing implements EventOutput {
        final List<JsonObject> events = new CopyOnWriteArrayList<>();

        @Override
        public void send(String eventUuid, String jsonBody) {
            events.add(JsonParser.parseString(jsonBody).getAsJsonObject());
        }

        List<JsonObject> ofType(String type) {
            return events.stream()
                    .filter(e -> e.get("type").getAsString().equals(type)).toList();
        }
    }

    @TempDir
    File tempDir;

    private ServerMock server;
    private WorldMock world;
    private FakePresenter presenter;
    private Capturing output;
    private HauntManager manager;

    // Intervalos mínimos para test: aparición 1 min, sonido 1-2 min.
    private HauntManager.Settings settings(List<String> exempt) {
        return new HauntManager.Settings(exempt, 40,
                0, 0, 0, 0, // sin gracias: elegible al instante
                2,
                1, 0, 1, 15, 0, 35, 50, 15, 25, 40, 35,
                1, 999, 0, 4, 1, 2,
                1, 2, 0.4, List.of("minecraft:ambient.cave"),
                List.of(), 1.8, "",
                List.of("http://skin/herobrine"));
    }

    @BeforeEach
    void setUp() {
        server = MockBukkit.mock();
        var plugin = MockBukkit.createMockPlugin();
        world = server.addSimpleWorld("world");
        presenter = new FakePresenter();
        output = new Capturing();
        manager = new HauntManager(plugin, presenter, new FakeResolver(), output,
                settings(List.of("Exento")), () -> false, new Random(7));
        // dataFolder del mock plugin apunta a un temp propio de MockBukkit
        manager.startTasks();
        manager.setEnabled(true);
    }

    @AfterEach
    void tearDown() {
        MockBukkit.unmock();
    }

    private PlayerMock join(String name) {
        PlayerMock p = server.addPlayer(name);
        p.teleport(new Location(world, 0, 5, 0));
        return p;
    }

    @Test
    void ambientSoundFiresInSolitudeAndEmitsHauntSound() {
        PlayerMock solo = join("Solitario");
        // sonido: target 1-2 min => máx 24 ticks gruesos de 5 s = 2400 ticks.
        server.getScheduler().performTicks(2600);
        assertTrue(output.ofType("haunt.sound").size() >= 1,
                "en soledad debe sonar al menos un ambiental");
        JsonObject data = output.ofType("haunt.sound").get(0).getAsJsonObject("data");
        assertEquals(solo.getUniqueId().toString(), data.get("target").getAsString());
    }

    @Test
    void validateAcceptsProductionLikeConfig() {
        // night_min 15 == close_despawn 15: sobrevive al spawn, sin warning.
        assertTrue(HauntManager.validate(settings(List.of())).isEmpty(),
                "una config sana no debe producir advertencias");
    }

    @Test
    void validateFlagsGhostBornInsideFleeRadius() {
        // La regla de oro: night_min 10 < close_despawn 15 => nace muerto.
        HauntManager.Settings bad = new HauntManager.Settings(List.of(), 40,
                10, 20, 15, 6.0, 2,
                120, 30, 6, 15, 2,
                35, 50, 10, 25, 40, 35,
                1, 90, 40, 4, 1, 2,
                20, 40, 0.4, List.of("minecraft:ambient.cave"),
                List.of(), 1.8, "",
                List.of("http://skin/herobrine"));
        assertTrue(HauntManager.validate(bad).stream()
                        .anyMatch(m -> m.contains("night_min_distance")),
                "debe advertir cuando night_min < close_despawn");
    }

    @Test
    void validateFlagsInvertedRanges() {
        // night_min 25 > night_max 15: rango invertido.
        HauntManager.Settings bad = new HauntManager.Settings(List.of(), 40,
                10, 20, 15, 6.0, 2,
                120, 30, 6, 15, 2,
                35, 50, 25, 15, 40, 35,
                1, 90, 40, 4, 1, 2,
                20, 40, 0.4, List.of("minecraft:ambient.cave"),
                List.of(), 1.8, "",
                List.of("http://skin/herobrine"));
        assertTrue(HauntManager.validate(bad).stream()
                        .anyMatch(m -> m.contains("invertido")),
                "debe advertir un rango min>max");
    }

    @Test
    void companyPausesAllClocks() {
        join("Solitario");
        join("Vecino"); // a 0 bloques: jamás hay soledad
        server.getScheduler().performTicks(3000);
        assertEquals(0, output.events.size(), "con compañía no pasa nada");
        assertEquals(0, presenter.shown.size());
    }

    @Test
    void exemptPlayersAreNeverHaunted() {
        join("Exento");
        server.getScheduler().performTicks(3000);
        assertEquals(0, output.events.size(), "los exentos no reciben sustos");
    }

    @Test
    void ambientAppearanceSpawnsDespawnsAndEmitsCatalogEvent() throws InterruptedException {
        PlayerMock solo = join("Solitario");
        // aparición: target 60 s = 12 ticks gruesos = 1200 ticks; luego la
        // vida del fantasma (1 s REAL + gracia 0) y la emisión en tick fino.
        server.getScheduler().performTicks(1300);
        assertEquals(1, presenter.shown.size(), "debe aparecer un fantasma");
        Thread.sleep(1100); // la vida del fantasma corre en tiempo de pared
        server.getScheduler().performTicks(100);
        assertEquals(1, presenter.removed.size(), "y desvanecerse tras su vida");

        List<JsonObject> apps = output.ofType("haunt.appearance");
        assertEquals(1, apps.size());
        JsonObject data = apps.get(0).getAsJsonObject("data");
        assertEquals(solo.getUniqueId().toString(), data.get("target").getAsString());
        assertEquals("ambient", data.get("trigger").getAsString());
        assertTrue(data.has("time_of_day") && data.has("seen")
                && data.has("distance") && data.has("duration_s"));

        // Tope de sesión (2): una segunda puede llegar, la tercera jamás.
        server.getScheduler().performTicks(1300);
        server.getScheduler().performTicks(1300);
        assertTrue(presenter.shown.size() <= 2,
                "máximo 2 apariciones por sesión");
    }
}
