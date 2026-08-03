import { describe, it, expect } from "vitest";
import {
  eventTitle,
  eventCategory,
  shortPlayerId,
} from "../src/features/timeline";

describe("eventTitle", () => {
  it("traduce tipos conocidos al titulo humano en español", () => {
    expect(eventTitle("server.start")).toBe("Servidor iniciado");
    expect(eventTitle("server.stop")).toBe("Servidor detenido");
    expect(eventTitle("session.start")).toBe("Jugador se conectó");
    expect(eventTitle("session.end")).toBe("Jugador se desconectó");
    expect(eventTitle("player.death")).toBe("Jugador murió");
    expect(eventTitle("backup.done")).toBe("Respaldo completado");
    expect(eventTitle("chunk.first_load")).toBe("Nuevo chunk explorado");
    expect(eventTitle("chat.message")).toBe("Mensaje de chat");
  });

  it("fallback: si el tipo no tiene entrada, devuelve el propio type", () => {
    expect(eventTitle("tipo.desconocido")).toBe("tipo.desconocido");
    expect(eventTitle("")).toBe("");
  });
});

describe("eventCategory", () => {
  it("agrupa por dominio del tipo", () => {
    expect(eventCategory("server.start")).toBe("server");
    expect(eventCategory("session.end")).toBe("session");
    expect(eventCategory("player.death")).toBe("combat");
    expect(eventCategory("mob.kill")).toBe("combat");
    expect(eventCategory("damage.minute")).toBe("combat");
    expect(eventCategory("boss.kill")).toBe("combat");
    expect(eventCategory("block.break")).toBe("block");
    expect(eventCategory("block.place")).toBe("block");
    expect(eventCategory("chunk.first_load")).toBe("world");
    expect(eventCategory("dimension.enter")).toBe("world");
    expect(eventCategory("position.sample")).toBe("world");
    expect(eventCategory("advancement.done")).toBe("progress");
    expect(eventCategory("milestone.first")).toBe("progress");
    expect(eventCategory("villager.trade")).toBe("economy");
    expect(eventCategory("item.craft")).toBe("economy");
    expect(eventCategory("fishing.catch")).toBe("economy");
    expect(eventCategory("chat.message")).toBe("chat");
    expect(eventCategory("backup.done")).toBe("backup");
    expect(eventCategory("event.start")).toBe("event");
    expect(eventCategory("haunt.appearance")).toBe("event");
  });

  it("dominio desconocido → 'unknown'", () => {
    expect(eventCategory("foo.bar")).toBe("unknown");
    expect(eventCategory("")).toBe("unknown");
    expect(eventCategory("nodot")).toBe("unknown");
  });
});

describe("shortPlayerId", () => {
  it("null → null (evento server-level)", () => {
    expect(shortPlayerId(null)).toBeNull();
  });

  it("string vacia tras strip → null (defensivo)", () => {
    expect(shortPlayerId("")).toBeNull();
    expect(shortPlayerId("----")).toBeNull();
  });

  it("UUID valido → primeros 8 chars sin guiones, con prefijo #", () => {
    expect(shortPlayerId("71804e99-f2aa-32dc-bfcb-0ea5cfdda708")).toBe(
      "#71804e99",
    );
    expect(shortPlayerId("00000000-0000-4000-8000-000000000001")).toBe(
      "#00000000",
    );
  });
});
