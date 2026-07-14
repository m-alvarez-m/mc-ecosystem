package com.mcecosystem.eventcollector;

import org.bukkit.plugin.java.JavaPlugin;

public final class EventCollectorPlugin extends JavaPlugin {

    private EventSender eventSender;

    @Override
    public void onEnable() {
        // TODO: mover la URL a config.yml cuando haya más opciones.
        // En Docker, localhost es el contenedor: se sobreescribe con EVENTS_API_URL.
        String apiUrl = System.getenv().getOrDefault("EVENTS_API_URL", "http://localhost:3000/events");
        eventSender = new EventSender(apiUrl, getLogger());
        getLogger().info("Endpoint de eventos: " + apiUrl);
        getServer().getPluginManager().registerEvents(new BlockBreakListener(eventSender), this);
        getLogger().info("EventCollector activo. Enviando eventos a la API local.");
    }

    @Override
    public void onDisable() {
        if (eventSender != null) {
            eventSender.shutdown();
        }
    }
}
