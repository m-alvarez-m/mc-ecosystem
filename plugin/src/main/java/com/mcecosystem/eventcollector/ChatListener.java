package com.mcecosystem.eventcollector;

import com.google.gson.JsonObject;
import io.papermc.paper.event.player.AsyncChatEvent;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;

/**
 * chat.message: CONTENIDO completo (decisión A del catálogo, con
 * consentimiento explícito de todos los jugadores, julio 2026).
 * Evento async: aquí no se toca la API de Bukkit más allá del UUID,
 * por eso no lleva posición.
 */
public final class ChatListener implements Listener {

    private final EventOutput sender;

    public ChatListener(EventOutput sender) {
        this.sender = sender;
    }

    @EventHandler(ignoreCancelled = true)
    public void onChat(AsyncChatEvent event) {
        String content = PlainTextComponentSerializer.plainText().serialize(event.message());

        JsonObject data = new JsonObject();
        data.addProperty("content", content);
        data.addProperty("length", content.length());

        JsonObject json = EventJson.base("chat.message", event.getPlayer().getUniqueId());
        json.add("data", data);
        sender.send(EventJson.eventUuid(json), json.toString());
    }
}
