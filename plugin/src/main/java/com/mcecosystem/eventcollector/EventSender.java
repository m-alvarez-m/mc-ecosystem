package com.mcecosystem.eventcollector;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.logging.Logger;

/**
 * Envía eventos a la API por HTTP POST de forma asíncrona.
 * Si la entrega falla (red, timeout, o respuesta no exitosa), el evento
 * se guarda en el buffer local; una tarea periódica lo reintentará.
 */
public final class EventSender {

    private final HttpClient http;
    private final URI endpoint;
    private final EventBuffer buffer;
    private final Logger logger;

    public EventSender(String endpointUrl, EventBuffer buffer, Logger logger) {
        this.endpoint = URI.create(endpointUrl);
        this.buffer = buffer;
        this.logger = logger;
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();
    }

    private HttpRequest buildRequest(String jsonBody) {
        return HttpRequest.newBuilder(endpoint)
                .header("Content-Type", "application/json")
                .timeout(Duration.ofSeconds(10))
                .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
                .build();
    }

    /** 2xx = aceptado; 409 = ya estaba en la DB (reintento benigno). */
    private static boolean isDelivered(int statusCode) {
        return statusCode / 100 == 2 || statusCode == 409;
    }

    /** Camino normal: asíncrono, jamás bloquea al llamante. */
    public void send(String eventUuid, String jsonBody) {
        http.sendAsync(buildRequest(jsonBody), HttpResponse.BodyHandlers.ofString())
                .whenComplete((response, error) -> {
                    if (error != null) {
                        buffer.store(eventUuid, jsonBody);
                        logger.warning("API inalcanzable (" + error.getMessage()
                                + "). Evento guardado en buffer local ("
                                + buffer.count() + " pendientes).");
                    } else if (!isDelivered(response.statusCode())) {
                        buffer.store(eventUuid, jsonBody);
                        logger.warning("La API rechazó el evento (HTTP " + response.statusCode()
                                + "). Guardado en buffer local. Respuesta: " + response.body());
                    }
                });
    }

    /**
     * Camino de reintento: bloqueante a propósito. Solo se llama desde el
     * hilo asíncrono del scheduler, nunca desde el hilo principal.
     */
    public boolean sendBlocking(String jsonBody) {
        try {
            HttpResponse<String> response =
                    http.send(buildRequest(jsonBody), HttpResponse.BodyHandlers.ofString());
            return isDelivered(response.statusCode());
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Escribe directo al buffer sin intentar la red. Para eventos emitidos
     * durante el apagado del servidor: se entregan en el próximo arranque.
     */
    public void storeDurable(String eventUuid, String jsonBody) {
        buffer.store(eventUuid, jsonBody);
    }

    public void shutdown() {
        // HttpClient no requiere cierre explícito en Java 21+.
    }
}
