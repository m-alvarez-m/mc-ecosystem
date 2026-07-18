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
        List<String> pool = getConfig().getStringList("skin_pool");
        int duration = getConfig().getInt("duration_seconds", 300);
        String sound = getConfig().getString("start_sound", "minecraft:entity.wither.spawn");
        String endSound = getConfig().getString("end_sound", "minecraft:block.beacon.deactivate");
        String musicSound = getConfig().getString("music_sound", "");
        int musicLoop = getConfig().getInt("music_loop_seconds", 0);

        // Mismo contrato que EventCollector: en Docker se inyecta EVENTS_API_URL.
        String apiUrl = System.getenv().getOrDefault("EVENTS_API_URL",
                "http://localhost:3000/events");

        manager = new EventManager(
                this,
                new SkinsRestorerSkinService(SkinsRestorerProvider.get(), getLogger()),
                new HttpEventOutput(apiUrl, getLogger()),
                new StateStore(getDataFolder(), getLogger()),
                pool, duration, sound, endSound, musicSound, musicLoop,
                task -> getServer().getScheduler().runTaskAsynchronously(this, task));

        PluginCommand command = getCommand("evento");
        EventoCommand executor = new EventoCommand(manager);
        command.setExecutor(executor);
        command.setTabCompleter(executor);

        // Si un reinicio interrumpió un evento, restaurar y cerrar.
        manager.recoverIfPending();

        getLogger().info("EventFX activo. Pool de skins: " + pool.size()
                + " | duración: " + duration + "s | endpoint: " + apiUrl);
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
