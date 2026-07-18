package com.mcecosystem.eventfx;

import net.skinsrestorer.api.SkinsRestorerProvider;
import org.bukkit.command.PluginCommand;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.List;

public final class EventFXPlugin extends JavaPlugin {

    private EventManager manager;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        EventManager.Settings settings = new EventManager.Settings(
                getConfig().getStringList("skin_pool"),
                getConfig().getInt("duration_seconds", 300),
                getConfig().getString("start_sound", "minecraft:entity.wither.spawn"),
                getConfig().getString("end_sound", "minecraft:block.beacon.deactivate"),
                getConfig().getString("music_sound", ""),
                getConfig().getInt("music_loop_seconds", 0),
                getConfig().getBoolean("bursts.enabled", true),
                getConfig().getInt("bursts.interval_seconds", 50),
                getConfig().getInt("bursts.max_count", 5),
                getConfig().getInt("bursts.speed_level", 100),
                getConfig().getInt("bursts.speed_seconds", 12),
                getConfig().getInt("bursts.jump_level", 25),
                getConfig().getInt("bursts.jump_seconds", 10),
                getConfig().getInt("bursts.immunity_seconds", 60));

        // Mismo contrato que EventCollector: en Docker se inyecta EVENTS_API_URL.
        String apiUrl = System.getenv().getOrDefault("EVENTS_API_URL",
                "http://localhost:3000/events");

        manager = new EventManager(
                this,
                new SkinsRestorerSkinService(SkinsRestorerProvider.get(), getLogger()),
                new HttpEventOutput(apiUrl, getLogger()),
                new StateStore(getDataFolder(), getLogger()),
                settings,
                task -> getServer().getScheduler().runTaskAsynchronously(this, task));

        PluginCommand command = getCommand("evento");
        EventoCommand executor = new EventoCommand(manager);
        command.setExecutor(executor);
        command.setTabCompleter(executor);

        // Si un reinicio interrumpió un evento, restaurar y cerrar.
        manager.recoverIfPending();

        getLogger().info("EventFX activo. Pool de skins: " + settings.skinPool().size()
                + " | duración: " + settings.durationSeconds() + "s"
                + " | ráfagas: " + (settings.burstsEnabled()
                        ? "cada " + settings.burstIntervalSeconds() + "s" : "off")
                + " | endpoint: " + apiUrl);
    }

    @Override
    public void onDisable() {
        // Apagado con evento en curso: cerrar ordenadamente restaura las
        // skins ya (si diera tiempo); si no, active-event.json queda en
        // disco y recoverIfPending() lo resuelve en el próximo arranque.
        if (manager != null && manager.isActive()) {
            manager.end();
        }
    }
}
