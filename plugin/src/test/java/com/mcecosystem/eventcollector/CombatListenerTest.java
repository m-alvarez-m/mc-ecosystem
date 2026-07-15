package com.mcecosystem.eventcollector;

import com.google.gson.JsonObject;
import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

class CombatListenerTest {

    private ServerMock server;
    private CapturingOutput output;

    @BeforeEach
    void setUp() {
        server = MockBukkit.mock();
        output = new CapturingOutput();
        server.getPluginManager().registerEvents(
                new CombatListener(output, new DamageAggregator()),
                MockBukkit.createMockPlugin());
    }

    @AfterEach
    void tearDown() {
        MockBukkit.unmock();
    }

    @Test
    void pvpKillGeneratesCrossReferencedDeathAndKillEvents() {
        PlayerMock attacker = server.addPlayer("Attacker");
        PlayerMock victim = server.addPlayer("Victim");
        attacker.getInventory().setItemInMainHand(new ItemStack(Material.DIAMOND_SWORD));

        // MockBukkit no atribuye killer automáticamente al simular daño
        // (eso lo hace la lógica interna del servidor real): se fija con
        // la API de Paper. El golpe letal dispara el pipeline real de
        // eventos (daño -> muerte -> PlayerDeathEvent) dentro del ServerMock.
        victim.setKiller(attacker);
        victim.damage(1000.0, attacker);

        JsonObject death = output.single("player.death");
        JsonObject kill = output.single("player.kill");

        // player.death: el muerto es la víctima, el killer_uuid es el atacante.
        assertEquals(victim.getUniqueId().toString(),
                death.get("player_uuid").getAsString());
        assertEquals(attacker.getUniqueId().toString(),
                death.getAsJsonObject("data").get("killer_uuid").getAsString());

        // player.kill: el actor es el atacante, la victim_uuid es la víctima,
        // y el arma es la espada que tenía en la mano.
        assertEquals(attacker.getUniqueId().toString(),
                kill.get("player_uuid").getAsString());
        assertEquals(victim.getUniqueId().toString(),
                kill.getAsJsonObject("data").get("victim_uuid").getAsString());
        assertEquals("minecraft:diamond_sword",
                kill.getAsJsonObject("data").get("weapon").getAsString());

        // El cruce: cada evento referencia al protagonista del otro.
        assertEquals(death.getAsJsonObject("data").get("killer_uuid").getAsString(),
                kill.get("player_uuid").getAsString());
        assertEquals(kill.getAsJsonObject("data").get("victim_uuid").getAsString(),
                death.get("player_uuid").getAsString());

        // Y ambos llevan sus campos comunes del catálogo.
        assertNotNull(death.get("event_uuid"));
        assertNotNull(kill.get("event_uuid"));
        assertNotNull(death.get("ts"));
    }
}
