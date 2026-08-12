import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { attachSlashRouter } from "../src/slash/router";

// Mock del Discord Client como EventEmitter — suficiente para
// verificar que interactionCreate se despacha correctamente. Cero
// dependencia de discord.js real.

class FakeClient extends EventEmitter {}

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeInteraction(commandName: string) {
  return {
    isChatInputCommand: () => true,
    commandName,
    replied: false,
    deferred: false,
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

describe("attachSlashRouter", () => {
  it("despacha al handler correspondiente por commandName", async () => {
    const client = new FakeClient();
    const players = vi.fn().mockResolvedValue(undefined);
    const tps = vi.fn().mockResolvedValue(undefined);
    attachSlashRouter({
      client: client as never,
      handlers: { players, tps },
      logger: silentLogger(),
    });

    const interaction = makeInteraction("players");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.emit("interactionCreate", interaction as any);
    // Esperar microtask del handler async
    await new Promise((r) => setImmediate(r));
    expect(players).toHaveBeenCalledOnce();
    expect(tps).not.toHaveBeenCalled();
  });

  it("commandName sin handler → warn + reply ephemeral 'Comando desconocido'", async () => {
    const client = new FakeClient();
    const logger = silentLogger();
    attachSlashRouter({ client: client as never, handlers: {}, logger });

    const interaction = makeInteraction("ghost");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.emit("interactionCreate", interaction as any);
    await new Promise((r) => setImmediate(r));

    expect(logger.warn).toHaveBeenCalledWith(
      { commandName: "ghost" },
      "Slash command sin handler registrado",
    );
    expect(interaction.reply).toHaveBeenCalledOnce();
    const arg = interaction.reply.mock.calls[0]![0] as {
      content: string;
      ephemeral: boolean;
    };
    expect(arg.ephemeral).toBe(true);
    expect(arg.content).toContain("Comando desconocido");
  });

  it("handler que lanza → error logged + reply ephemeral de error interno", async () => {
    const client = new FakeClient();
    const logger = silentLogger();
    const failing = vi.fn().mockRejectedValue(new Error("boom"));
    attachSlashRouter({
      client: client as never,
      handlers: { players: failing },
      logger,
    });

    const interaction = makeInteraction("players");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.emit("interactionCreate", interaction as any);
    await new Promise((r) => setImmediate(r));

    expect(logger.error).toHaveBeenCalled();
    // reply se llama con el mensaje de error interno (interaction.replied
    // era false; no había reply previo).
    expect(interaction.reply).toHaveBeenCalledOnce();
    const arg = interaction.reply.mock.calls[0]![0] as {
      content: string;
      ephemeral: boolean;
    };
    expect(arg.content).toContain("Error interno");
    expect(arg.ephemeral).toBe(true);
  });

  it("interacción que no es ChatInputCommand → no-op silencioso", async () => {
    const client = new FakeClient();
    const players = vi.fn();
    const logger = silentLogger();
    attachSlashRouter({
      client: client as never,
      handlers: { players },
      logger,
    });

    const nonChat = { isChatInputCommand: () => false };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.emit("interactionCreate", nonChat as any);
    await new Promise((r) => setImmediate(r));
    expect(players).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
