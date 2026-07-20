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

        // ---------- Haunting ----------
        var hauntSettings = new com.mcecosystem.eventfx.haunt.HauntManager.Settings(
                getConfig().getStringList("haunting.exempt"),
                getConfig().getInt("haunting.solitude_radius", 40),
                getConfig().getInt("haunting.min_session_minutes", 10),
                getConfig().getInt("haunting.death_grace_minutes", 20),
                getConfig().getInt("haunting.combat_grace_seconds", 15),
                getConfig().getDouble("haunting.min_health_hearts", 6),
                getConfig().getInt("haunting.max_per_session", 2),
                getConfig().getInt("haunting.appearance.interval_minutes", 120),
                getConfig().getInt("haunting.appearance.jitter_minutes", 30),
                getConfig().getInt("haunting.appearance.duration_seconds", 6),
                getConfig().getInt("haunting.appearance.close_despawn_distance", 15),
                getConfig().getInt("haunting.appearance.center_grace_seconds", 2),
                getConfig().getInt("haunting.appearance.day_min_distance", 35),
                getConfig().getInt("haunting.appearance.day_max_distance", 50),
                getConfig().getInt("haunting.appearance.night_min_distance", 15),
                getConfig().getInt("haunting.appearance.night_max_distance", 25),
                getConfig().getInt("haunting.appearance.min_angle_separation", 40),
                getConfig().getInt("haunting.appearance.view_cone_degrees", 35),
                getConfig().getInt("haunting.turnaround.max_per_night", 1),
                getConfig().getInt("haunting.turnaround.interval_minutes", 90),
                getConfig().getInt("haunting.turnaround.jitter_minutes", 40),
                getConfig().getInt("haunting.turnaround.turn_window_seconds", 4),
                getConfig().getInt("haunting.turnaround.duration_min_seconds", 1),
                getConfig().getInt("haunting.turnaround.duration_max_seconds", 2),
                getConfig().getInt("haunting.sounds.interval_min_minutes", 20),
                getConfig().getInt("haunting.sounds.interval_max_minutes", 40),
                getConfig().getDouble("haunting.sounds.volume", 0.4),
                getConfig().getStringList("haunting.sounds.pool"),
                getConfig().getStringList("haunting.sounds.storm_pool"),
                getConfig().getDouble("haunting.sounds.storm_volume_multiplier", 1.8),
                getConfig().getString("haunting.appearance.sound", ""),
                getConfig().getDouble("haunting.appearance.sound_volume", 1.4),
                getConfig().getString("haunting.turnaround.cue_sound", ""),
                getConfig().getDouble("haunting.turnaround.cue_volume", 1.0),
                getConfig().getDouble("haunting.appearance.seen_min_seconds", 1.0),
                getConfig().getStringList("haunting.skin_pool"));
        var hauntManager = new com.mcecosystem.eventfx.haunt.HauntManager(
                this,
                new com.mcecosystem.eventfx.haunt.PacketGhostPresenter(this),
                new com.mcecosystem.eventfx.haunt.SkinsRestorerGhostSkinResolver(
                        SkinsRestorerProvider.get(), getLogger()),
                new HttpEventOutput(apiUrl, getLogger()),
                hauntSettings,
                () -> manager.isActive(),
                new java.util.Random());
        hauntManager.startTasks();
        var hauntCommand = new com.mcecosystem.eventfx.haunt.HauntCommand(hauntManager);
        PluginCommand haunt = getCommand("haunt");
        haunt.setExecutor(hauntCommand);
        haunt.setTabCompleter(hauntCommand);
        getLogger().info("Haunting: " + (hauntManager.isEnabled() ? "ACTIVO" : "apagado")
                + " (persistente; /haunt on|off)");

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
