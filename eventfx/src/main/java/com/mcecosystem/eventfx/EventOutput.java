package com.mcecosystem.eventfx;

/**
 * Destino de los eventos del catálogo (mismo patrón que EventCollector:
 * en producción HTTP, en tests un fake que captura en memoria).
 * event.start/event.end son raros y no ameritan búfer local: si la API
 * está caída se registra el fallo en consola y ya.
 */
public interface EventOutput {

    void send(String eventUuid, String jsonBody);
}
