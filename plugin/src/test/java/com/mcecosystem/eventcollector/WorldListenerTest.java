package com.mcecosystem.eventcollector;

import com.google.gson.JsonObject;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.world.ChunkLoadEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

import java.io.File;
import java.sql.SQLException;
import java.util.logging.Logger;

import static org.junit.jupiter.api.Assertions.assertEquals;

class WorldListenerTest {

    private static final Logger TEST_LOGGER = Logger.getLogger("test");

    @TempDir
    File tempDir;

    private ServerMock server;
    private CapturingOutput output;
    private EventBuffer buffer;
    private WorldMock world;
    private PlayerMock player;

    @BeforeEach
    void setUp() throws SQLException {
        server = MockBukkit.mock();
        output = new CapturingOutput();
        buffer = new EventBuffer(tempDir, TEST_LOGGER);
        server.getPluginManager().registerEvents(
                new WorldListener(output, new MilestoneTracker(output, buffer)),
                MockBukkit.createMockPlugin());
        world = server.addSimpleWorld("world");
        player = server.addPlayer("Explorer");
        player.teleport(new Location(world, 100, 64, 100));
    }

    @AfterEach
    void tearDown() {
        buffer.close();
        MockBukkit.unmock();
    }

    private void breakDiamondAt(int x, int z) {
        Block block = world.getBlockAt(x, 60, z);
        block.setType(Material.DIAMOND_ORE);
        server.getPluginManager().callEvent(new BlockBreakEvent(block, player));
    }

    @Test
    void milestoneFirstIsEmittedOnlyOnceEvenAcrossRestarts() throws SQLException {
        // Dos diamantes seguidos: un único milestone.first.
        breakDiamondAt(10, 10);
        breakDiamondAt(11, 10);

        JsonObject milestone = output.single("milestone.first");
        assertEquals("diamond", milestone.getAsJsonObject("data").get("what").getAsString());
        assertEquals(player.getUniqueId().toString(),
                milestone.get("player_uuid").getAsString());

        // "Reinicio del servidor": nuevo buffer sobre el MISMO archivo SQLite
        // y nuevo tracker. El claim debe seguir denegado.
        buffer.close();
        buffer = new EventBuffer(tempDir, TEST_LOGGER);
        new MilestoneTracker(output, buffer).claim("diamond", player);

        assertEquals(1, output.ofType("milestone.first").size(),
                "el hito no debe re-emitirse tras un reinicio");
    }

    @Test
    void chunkFirstLoadAttributesDiscovererAndIgnoresReloads() {
        // El jugador está en (100, 64, 100); el chunk (6,6) tiene centro en (104, 104).
        ChunkLoadEvent firstLoad = new ChunkLoadEvent(world.getChunkAt(6, 6), true);
        server.getPluginManager().callEvent(firstLoad);

        JsonObject event = output.single("chunk.first_load");
        assertEquals(6, event.getAsJsonObject("data").get("chunk_x").getAsInt());
        assertEquals(6, event.getAsJsonObject("data").get("chunk_z").getAsInt());
        assertEquals(player.getUniqueId().toString(),
                event.get("player_uuid").getAsString());
        assertEquals("world", event.get("world").getAsString());

        // Recarga del mismo chunk (isNewChunk = false): no debe emitir nada.
        server.getPluginManager().callEvent(new ChunkLoadEvent(world.getChunkAt(6, 6), false));
        assertEquals(1, output.ofType("chunk.first_load").size(),
                "una recarga de chunk no es un descubrimiento");
    }
}
