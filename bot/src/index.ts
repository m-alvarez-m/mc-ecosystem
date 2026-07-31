import pino, { type Logger } from "pino";
import type { Server } from "node:http";
import { loadConfig } from "./config/env";
import { composeApp, type App } from "./bootstrap";
import { startHealthServer } from "./health/server";

// Entry point del servicio Pulso.
//
// Responsabilidad: cargar config, componer la app via composeApp(),
// exponer el health endpoint que ya existia, registrar handlers de
// senal, y arrancar. Los detalles de la app compuesta viven en el
// modulo bootstrap; aqui solo orquestamos el ciclo de vida del proceso.
//
// El health server permanece en este entry point (no en composeApp)
// porque tecnicamente es infraestructura de proceso, no del "bot" en
// si — Docker healthcheck depende de el aunque la app compuesta
// tuviera un fallo severo.
//
// main() se exporta para permitir tests con dependencias inyectadas;
// el auto-run al final del archivo solo dispara cuando el proceso
// ejecuta directamente este modulo, no cuando lo importa un test.

/**
 * Dependencias inyectables de main(). Todas opcionales: en produccion
 * se resuelven a las implementaciones reales; los tests inyectan
 * fakes para verificar comportamiento sin tocar Discord, filesystem,
 * red, ni el proceso real.
 */
export interface MainDependencies {
  loadConfig?: typeof loadConfig;
  composeApp?: typeof composeApp;
  startHealthServer?: typeof startHealthServer;
  logger?: Logger;
  processExit?: (code: number) => never;
  registerSignal?: (
    signal: "SIGINT" | "SIGTERM",
    handler: () => void,
  ) => void;
}

/**
 * Resultado exitoso de main(). Se devuelve para tests que quieran
 * inspeccionar la app y el server tras el arranque. En produccion,
 * despues de que main() resuelve, el proceso se queda vivo por el
 * event loop (polling engine + HTTP server + Discord client).
 */
export interface RunningApp {
  app: App;
  server: Server;
}

/**
 * Orquesta el ciclo de vida completo: config -> compose -> health ->
 * signals -> start. Devuelve el handle en exito; llama processExit(1)
 * y no vuelve nunca en fallo (config invalida o start rechazado).
 */
export async function main(
  deps: MainDependencies = {},
): Promise<RunningApp | never> {
  const logger = deps.logger ?? pino({ name: "pulso" });
  const loadConfigFn = deps.loadConfig ?? loadConfig;
  const composeAppFn = deps.composeApp ?? composeApp;
  const startHealthServerFn = deps.startHealthServer ?? startHealthServer;
  const exit =
    deps.processExit ??
    ((code: number): never => {
      process.exit(code);
    });
  const registerSignal =
    deps.registerSignal ??
    ((signal, handler): void => {
      process.once(signal, handler);
    });

  logger.info("Inicio del bot Pulso");

  // 1) Config. Si falla: exit(1) sin componer nada mas.
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfigFn();
    logger.info("Configuracion valida");
  } catch (err) {
    logger.fatal({ err }, "Configuracion invalida, abortando");
    return exit(1);
  }

  // 2) Composicion del grafo. Puro y sincronico: no toca IO.
  const app = composeAppFn(config);

  // 3) Health server. Usa el MISMO Discord client y el MISMO runtime
  //    state que la app compuesta (via app.services). GET /health
  //    incluye runtimeState.snapshot() (T7): metricas y ultimos
  //    errores estan expuestos sin re-instrumentar.
  const server = startHealthServerFn({
    client: app.services.client,
    port: config.server.port,
    logger,
    runtimeState: app.services.runtimeState,
  });

  // 4) Shutdown: SIGINT / SIGTERM -> app.stop() + server.close() -> exit(0).
  //    Inline aqui porque el ciclo depende de app + server (el modulo
  //    lifecycle/shutdown fue disenado para el bootstrap previo con
  //    solo client + server; adaptarlo esta fuera de scope de esta sesion).
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Senal recibida, cerrando ordenadamente");
    try {
      await app.stop();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      logger.info("Shutdown limpio completado");
      exit(0);
    } catch (err) {
      logger.error({ err }, "Error durante shutdown");
      exit(1);
    }
  };
  registerSignal("SIGINT", () => {
    void shutdown("SIGINT");
  });
  registerSignal("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  // 5) Arranque. Si login Discord o polling.start() fallan, cerramos
  //    el health server (best effort) y exit(1).
  try {
    await app.start();
    logger.info("Bot Pulso arrancado");
    return { app, server };
  } catch (err) {
    logger.fatal({ err }, "Fallo el arranque de la app");
    try {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    } catch {
      /* best effort: shutdown de emergencia */
    }
    return exit(1);
  }
}

// Auto-run cuando este archivo se ejecuta directamente por Node (o
// tsx). Cuando un test lo IMPORTA, require.main es el runner de
// vitest, no este modulo, y main() no se dispara — el test lo llama
// explicitamente con sus dependencias inyectadas.
if (require.main === module) {
  void main();
}
