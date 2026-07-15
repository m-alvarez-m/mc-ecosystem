package com.mcecosystem.eventcollector;

/**
 * Destino de los eventos generados por los listeners.
 * En producción lo implementa EventSender (HTTP + buffer SQLite);
 * en tests, un fake que captura los JSON en memoria.
 */
public interface EventOutput {

    /** Entrega asíncrona; jamás bloquea al llamante. */
    void send(String eventUuid, String jsonBody);

    /** Persistencia directa sin red (p. ej. durante el apagado). */
    void storeDurable(String eventUuid, String jsonBody);
}
