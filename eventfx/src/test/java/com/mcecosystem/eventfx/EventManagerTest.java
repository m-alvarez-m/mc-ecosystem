package com.mcecosystem.eventfx;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.potion.PotionEffectType;
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
import java.util.UUID;
import java.util.logging.Logger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class EventManagerTest {

    private static final List<String> POOL = List.of("Goku", "Vegeta", "Piccolo");
    /** convocatoria 1s + secuencia 5s = 120 ticks hasta PODER MAXIMO. */
    private static final int TICKS_HASTA_PODER = 130;

    @TempDir
    File tempDir;

    private ServerMock server;
    private WorldMock world;
    private FakeSkinService skins;
    private CapturingOutput output;
    private EventManager manager;

    private EventManager.Settings settings(boolean iceWalk) {
        return new EventManager.Settings(POOL, 300,
                "minecraft:entity.wither.spawn",
                "minecraft:block.beacon.deactivate",
                "", 0,
                false, 50, 5, 100, 12, 25, 10, 60,
                true, 1, 20, 30,   // convocatoria: countdown de 1s en tests
                iceWalk, 1);
    }

    @BeforeEach
    void setUp() {
        server = MockBukkit.mock();
        var plugin = MockBukkit.createMockPlugin();
        world = server.addSimpleWorld("world");
        skins = new FakeSkinService();
        output = new CapturingOutput();
        manager = new EventManager(plugin, skins, output,
                new StateStore(tempDir, Logger.getLogger("test")),
                settings(true), Runnable::run);
        server.getPluginManager().registerEvents(manager, plugin);
    }

    @AfterEach
    void tearDown() {
        MockBukkit.unmock();
    }

    private PlayerMock join(String name, int x, int z) {
        PlayerMock p = server.addPlayer(name);
        p.teleport(new Location(world, x, 5, z));
        return p;
    }

    // ---------- (a) ciclo completo: convocatoria, TP y regreso al origen ----------

    @Test
    void cicloCompletoConvocaYDevuelveACadaUnoASuOrigen() {
        PlayerMock ana = join("Ana", 100, 100);
        PlayerMock beto = join("Beto", -200, -200);
        Location origenAna = ana.getLocation().clone();
        Location origenBeto = beto.getLocation().clone();

        assertTrue(manager.start("torneo", server.getConsoleSender()));
        server.getScheduler().performTicks(TICKS_HASTA_PODER);

        // Convocados: ambos al MISMO sitio (la sede elegida).
        assertEquals(ana.getLocation().getBlockX(), beto.getLocation().getBlockX(),
                "la convocatoria debe reunir a todos en la sede");
        assertEquals(ana.getLocation().getBlockZ(), beto.getLocation().getBlockZ());
        // Y con el Ki puesto, incluidos los efectos nuevos.
        assertTrue(ana.hasPotionEffect(PotionEffectType.SPEED));
        assertTrue(ana.hasPotionEffect(PotionEffectType.DOLPHINS_GRACE));
        assertTrue(ana.hasPotionEffect(PotionEffectType.SLOW_FALLING));
        assertTrue(ana.hasPotionEffect(PotionEffectType.SATURATION),
                "saturation reemplaza al refill periodico del Issue #1");

        assertTrue(manager.end());
        server.getScheduler().performTicks(5);

        // Cada uno vuelve a SU origen individual, no todos al mismo sitio.
        assertEquals(origenAna.getBlockX(), ana.getLocation().getBlockX(),
                "Ana debe volver a SU origen");
        assertEquals(origenBeto.getBlockX(), beto.getLocation().getBlockX(),
                "Beto debe volver a SU origen");
        assertFalse(ana.getLocation().getBlockX() == beto.getLocation().getBlockX(),
                "no deben terminar todos en el mismo sitio");
        // Y sin Ki.
        assertFalse(ana.hasPotionEffect(PotionEffectType.SPEED));
        assertFalse(ana.hasPotionEffect(PotionEffectType.DOLPHINS_GRACE));
    }

    // ---------- (b) muerte durante el evento ----------

    @Test
    void muerteDuranteEventoReaplicaElKiAlRespawn() {
        PlayerMock ana = join("Ana", 50, 50);
        assertTrue(manager.start("torneo", server.getConsoleSender()));
        server.getScheduler().performTicks(TICKS_HASTA_PODER);
        assertTrue(ana.hasPotionEffect(PotionEffectType.SPEED));

        // Minecraft limpia TODOS los efectos al morir: lo simulamos.
        ana.getActivePotionEffects()
                .forEach(e -> ana.removePotionEffect(e.getType()));
        assertFalse(ana.hasPotionEffect(PotionEffectType.SPEED),
                "tras morir el jugador queda sin efectos (vanilla)");

        server.getPluginManager().callEvent(
                new PlayerRespawnEvent(ana, ana.getLocation(), false));
        server.getScheduler().performTicks(5);

        // El Ki vuelve: morir no te expulsa del evento.
        assertTrue(ana.hasPotionEffect(PotionEffectType.SPEED),
                "el Ki debe re-aplicarse al respawn");
        assertTrue(ana.hasPotionEffect(PotionEffectType.FIRE_RESISTANCE));
        // Con el tiempo RESTANTE (incluye los ~6s de convocatoria+secuencia),
        // nunca mas que la ventana total del evento.
        int primero = ana.getPotionEffect(PotionEffectType.SPEED).getDuration();
        assertTrue(primero > 0 && primero <= (300 + 10) * 20,
                "el Ki re-aplicado se acota a la ventana del evento");

        // Y decrece de verdad: tras esperar, un segundo respawn da menos.
        try {
            Thread.sleep(1200);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        ana.getActivePotionEffects().forEach(e -> ana.removePotionEffect(e.getType()));
        server.getPluginManager().callEvent(
                new PlayerRespawnEvent(ana, ana.getLocation(), false));
        server.getScheduler().performTicks(5);
        int segundo = ana.getPotionEffect(PotionEffectType.SPEED).getDuration();
        assertTrue(segundo < primero,
                "debe re-aplicarse con el RESTANTE, no reiniciarse desde cero");
    }

    // ---------- (c) desconexion durante el evento ----------

    @Test
    void desconectarDuranteEventoSeLimpiaYRestauraAlReconectar() {
        PlayerMock ana = join("Ana", 70, 70);
        Location origenAna = ana.getLocation().clone();
        UUID id = ana.getUniqueId();

        assertTrue(manager.start("torneo", server.getConsoleSender()));
        server.getScheduler().performTicks(TICKS_HASTA_PODER);
        assertTrue(ana.hasPotionEffect(PotionEffectType.SPEED));

        // Se desconecta con el Ki puesto y el evento termina sin el.
        ana.disconnect();
        assertTrue(manager.end());
        server.getScheduler().performTicks(5);

        // Reconecta con el MISMO UUID (MockBukkit no lo reusa por nombre, hay
        // que construirlo), y sigue con los efectos colgados.
        PlayerMock vuelve = new PlayerMock(server, "Ana", id);
        server.addPlayer(vuelve);
        assertEquals(id, vuelve.getUniqueId());
        vuelve.addPotionEffect(new org.bukkit.potion.PotionEffect(
                PotionEffectType.SPEED, 20 * 60, 3));
        server.getPluginManager().callEvent(new PlayerJoinEvent(vuelve, ""));
        server.getScheduler().performTicks(5);

        assertFalse(vuelve.hasPotionEffect(PotionEffectType.SPEED),
                "al reconectar se le quita el Ki que quedo colgado");
        assertEquals(origenAna.getBlockX(), vuelve.getLocation().getBlockX(),
                "y se le devuelve a su origen individual");
    }

    // ---------- (c') crash con evento activo: recuperacion no deja huerfanos ----------

    @Test
    void crashConEventoActivoRecuperaYLimpiaAlReconectar() {
        // Nuevo StateStore compartido: simulamos el ciclo crash/reinicio
        // creando un manager, iniciando evento, y creando OTRO manager sobre
        // el mismo disco -- es lo que hace onEnable tras un crash real.
        File shared = new File(tempDir, "crash");
        shared.mkdirs();
        StateStore store = new StateStore(shared, Logger.getLogger("test"));

        var m1 = new EventManager(server.getPluginManager().getPlugins()[0],
                skins, output, store, settings(false), Runnable::run);
        server.getPluginManager().registerEvents(m1, server.getPluginManager().getPlugins()[0]);

        PlayerMock ana = join("Ana", 30, 30);
        Location origenAna = ana.getLocation().clone();
        UUID id = ana.getUniqueId();
        assertTrue(m1.start("crash-test", server.getConsoleSender()));
        server.getScheduler().performTicks(TICKS_HASTA_PODER);
        assertTrue(ana.hasPotionEffect(PotionEffectType.SPEED));

        // "Crash": el proceso muere. Ana estaba online, pero el manager
        // nuevo no la ve (nadie esta online al arrancar). Simulamos su
        // desconexion antes de recovery para que getPlayer devuelva null.
        ana.disconnect();

        // Nuevo manager sobre el MISMO disco: es el arranque post-crash.
        var m2 = new EventManager(server.getPluginManager().getPlugins()[0],
                skins, output, store, settings(false), Runnable::run);
        m2.recoverIfPending();
        assertFalse(m2.isActive(), "recovery debe cerrar el evento pendiente");
        server.getPluginManager().registerEvents(m2, server.getPluginManager().getPlugins()[0]);

        // Ana reconecta con el Ki colgado (asi quedaria en el mundo real).
        PlayerMock vuelve = new PlayerMock(server, "Ana", id);
        server.addPlayer(vuelve);
        vuelve.addPotionEffect(new org.bukkit.potion.PotionEffect(
                PotionEffectType.SPEED, 20 * 60, 3));
        server.getPluginManager().callEvent(new PlayerJoinEvent(vuelve, ""));
        server.getScheduler().performTicks(5);

        assertFalse(vuelve.hasPotionEffect(PotionEffectType.SPEED),
                "tras crash+recovery+join: no puede quedar huerfano con Ki");
        assertEquals(origenAna.getBlockX(), vuelve.getLocation().getBlockX(),
                "y vuelve a SU origen (el que guardo antes del crash)");
    }

    // ---------- (d) caminar sobre el agua ----------

    @Test
    void caminarSobreAguaCongelaSoloLaSuperficieYNoAlBucear() {
        PlayerMock ana = join("Ana", 10, 10);
        assertTrue(manager.start("torneo", server.getConsoleSender()));
        server.getScheduler().performTicks(TICKS_HASTA_PODER);

        Location pies = ana.getLocation().clone();
        int x = pies.getBlockX(), y = pies.getBlockY(), z = pies.getBlockZ();
        world.getBlockAt(x, y - 1, z).setType(Material.WATER);
        world.getBlockAt(x, y, z).setType(Material.AIR);

        Location destino = pies.clone().add(1, 0, 0);
        world.getBlockAt(destino.getBlockX(), destino.getBlockY() - 1,
                destino.getBlockZ()).setType(Material.WATER);
        server.getPluginManager().callEvent(new PlayerMoveEvent(ana, pies, destino));

        assertEquals(Material.FROSTED_ICE,
                world.getBlockAt(destino.getBlockX(), destino.getBlockY() - 1,
                        destino.getBlockZ()).getType(),
                "caminando sobre agua debe congelarse hielo escarchado (no ICE)");

        // Buceando (pies DENTRO del agua) NO debe congelar: critico con
        // dolphins_grace, si no irian dejando hielo dentro del oceano.
        Location buceo = pies.clone().add(0, 0, 5);
        int bx = buceo.getBlockX(), by = buceo.getBlockY(), bz = buceo.getBlockZ();
        world.getBlockAt(bx, by, bz).setType(Material.WATER);      // pies en agua
        world.getBlockAt(bx, by - 1, bz).setType(Material.WATER);  // agua debajo
        server.getPluginManager().callEvent(
                new PlayerMoveEvent(ana, pies, buceo));
        assertEquals(Material.WATER, world.getBlockAt(bx, by - 1, bz).getType(),
                "buceando NO debe congelar: solo se camina sobre la superficie");
    }
}
