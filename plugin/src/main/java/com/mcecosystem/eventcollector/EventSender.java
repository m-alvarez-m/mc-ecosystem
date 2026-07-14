package com.mcecosystem.eventcollector;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.logging.Logger;

/**
 * Envía eventos a la API por HTTP POST de forma asíncrona.
 * sendAsync usa el executor interno del HttpClient: la red jamás
 * bloquea el hilo principal del servidor.
 */
public final class EventSender {

    private final HttpClient http;
    private final URI endpoint;
    private final Logger logger;

    public EventSender(String endpointUrl, Logger logger) {
        this.endpoint = URI.create(endpointUrl);
        this.logger = logger;
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();
    }

    public void send(String jsonBody) {
        HttpRequest request = HttpRequest.newBuilder(endpoint)
                .header("Content-Type", "application/json")
                .timeout(Duration.ofSeconds(10))
                .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
                .build();

        http.sendAsync(request, HttpResponse.BodyHandlers.ofString())
                .whenComplete((response, error) -> {
                    if (error != null) {
                        // TODO: buffer local con reintentos (próxima iteración).
                        logger.warning("No se pudo enviar el evento a la API: " + error.getMessage());
                    } else if (response.statusCode() != 201 && response.statusCode() != 409) {
                        // 409 = evento duplicado (reintento benigno), no es un fallo.
                        logger.warning("La API rechazó el evento (HTTP " + response.statusCode()
                                + "): " + response.body());
                    }
                });
    }

    public void shutdown() {
        // HttpClient no requiere cierre explícito en Java 21; el método queda
        // como punto de extensión para cuando exista el buffer local.
    }
}
