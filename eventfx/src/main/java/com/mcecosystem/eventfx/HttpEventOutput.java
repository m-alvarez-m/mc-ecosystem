package com.mcecosystem.eventfx;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.logging.Logger;

/** POST asíncrono a la API de eventos; los fallos solo se loguean. */
public final class HttpEventOutput implements EventOutput {

    private final HttpClient http;
    private final URI endpoint;
    private final Logger logger;

    public HttpEventOutput(String endpointUrl, Logger logger) {
        this.endpoint = URI.create(endpointUrl);
        this.logger = logger;
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();
    }

    @Override
    public void send(String eventUuid, String jsonBody) {
        HttpRequest request = HttpRequest.newBuilder(endpoint)
                .header("Content-Type", "application/json")
                .timeout(Duration.ofSeconds(10))
                .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
                .build();
        http.sendAsync(request, HttpResponse.BodyHandlers.ofString())
                .whenComplete((response, error) -> {
                    if (error != null) {
                        logger.warning("No se pudo emitir " + eventUuid + ": " + error.getMessage());
                    } else if (response.statusCode() / 100 != 2 && response.statusCode() != 409) {
                        logger.warning("La API rechazó " + eventUuid + " (HTTP "
                                + response.statusCode() + "): " + response.body());
                    }
                });
    }
}
