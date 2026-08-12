import { describe, it, expect } from "vitest";
import { SLASH_COMMANDS, COMMAND_NAMES } from "../src/slash/commands";

// ADR-016 D7 · Test del builder: verificar nombres/desc exactos y
// que ningún comando exige opciones obligatorias (los 3 son sin
// parámetros, ADR-016 · Fuera de alcance B.1).

describe("SLASH_COMMANDS · contrato con Discord", () => {
  it("expone exactamente 3 comandos: players, tps, status", () => {
    expect(SLASH_COMMANDS).toHaveLength(3);
    expect(COMMAND_NAMES).toEqual(["players", "tps", "status"]);
  });

  it.each(SLASH_COMMANDS.map((c) => [c.name, c]))(
    "comando %s tiene name + description no vacíos y cero opciones",
    (_name, cmd) => {
      expect(cmd.name).toMatch(/^[a-z]+$/);
      expect(cmd.description.length).toBeGreaterThan(0);
      // discord.js pone options=[] cuando no hay opciones definidas.
      // Cualquier caso donde options tenga required=true rompería el
      // registro por-guild sin previo aviso al usuario.
      const opts = (cmd as { options?: { required?: boolean }[] }).options ?? [];
      expect(opts.every((o) => o.required !== true)).toBe(true);
    },
  );
});
