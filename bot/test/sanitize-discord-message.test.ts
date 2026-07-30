import { describe, it, expect } from "vitest";
import { sanitizeDiscordMessage } from "../src/discord/sanitize-discord-message";

// Zero-width space real (U+200B). Se declara aqui una vez para no
// repetir el literal en cada aserción.
const ZWSP = "​";

// Regex que reproduce EXACTAMENTE lo que Discord considera mención
// del lado del cliente. Sirve como oracle: si tras sanitizar sigue
// matcheando, es que Discord aun lo interpretaria como ping.
const DISCORD_MENTION_REGEX = /@everyone|@here|<@[!&]?\d+>/g;

describe("sanitizeDiscordMessage", () => {
  it("mensaje normal permanece exactamente igual", () => {
    const input = "hola mundo minecraft, cómo va todo";
    expect(sanitizeDiscordMessage(input)).toBe(input);
  });

  it("mensaje con caracteres especiales sin menciones permanece igual", () => {
    const input = "envío 100% del stack; item 3/4 <listo> [ok] {si}";
    expect(sanitizeDiscordMessage(input)).toBe(input);
  });

  it("@everyone queda neutralizado con ZWSP", () => {
    const out = sanitizeDiscordMessage("hola @everyone que tal");
    expect(out).toBe(`hola @${ZWSP}everyone que tal`);
    expect(out).not.toMatch(DISCORD_MENTION_REGEX);
  });

  it("@here queda neutralizado con ZWSP", () => {
    const out = sanitizeDiscordMessage("@here ping test");
    expect(out).toBe(`@${ZWSP}here ping test`);
    expect(out).not.toMatch(DISCORD_MENTION_REGEX);
  });

  it("<@123> (mención de usuario) queda neutralizada", () => {
    const out = sanitizeDiscordMessage("mira <@123456789>");
    expect(out).toBe(`mira <@${ZWSP}123456789>`);
    expect(out).not.toMatch(DISCORD_MENTION_REGEX);
  });

  it("<@!123> (mención de usuario con nick) queda neutralizada", () => {
    const out = sanitizeDiscordMessage("hola <@!987654321>");
    expect(out).toBe(`hola <@${ZWSP}!987654321>`);
    expect(out).not.toMatch(DISCORD_MENTION_REGEX);
  });

  it("<@&123> (mención de rol) queda neutralizada", () => {
    const out = sanitizeDiscordMessage("rol <@&111222333>");
    expect(out).toBe(`rol <@${ZWSP}&111222333>`);
    expect(out).not.toMatch(DISCORD_MENTION_REGEX);
  });

  it("múltiples menciones distintas en un mismo mensaje", () => {
    const input =
      "@everyone urgente, @here miren, <@1> tu turno, <@!2> revisa, <@&3> reunion";
    const out = sanitizeDiscordMessage(input);
    expect(out).toBe(
      `@${ZWSP}everyone urgente, @${ZWSP}here miren, <@${ZWSP}1> tu turno, <@${ZWSP}!2> revisa, <@${ZWSP}&3> reunion`,
    );
    // Ninguna sobrevive como mención parseable.
    expect(out).not.toMatch(DISCORD_MENTION_REGEX);
  });

  it("misma mención repetida se neutraliza en todas sus apariciones", () => {
    const out = sanitizeDiscordMessage("@everyone @everyone @everyone");
    expect(out).toBe(
      `@${ZWSP}everyone @${ZWSP}everyone @${ZWSP}everyone`,
    );
    expect(out).not.toMatch(DISCORD_MENTION_REGEX);
  });

  it("mensaje vacío devuelve string vacío", () => {
    expect(sanitizeDiscordMessage("")).toBe("");
  });

  it("mensaje muy largo NO se trunca; sólo se neutralizan las menciones", () => {
    const filler = "x".repeat(5000);
    const input = `${filler}@everyone${filler}`;
    const out = sanitizeDiscordMessage(input);

    expect(out).toBe(`${filler}@${ZWSP}everyone${filler}`);
    // Longitud crece exactamente en la longitud del ZWSP insertado.
    expect(out.length).toBe(input.length + ZWSP.length);
    expect(out).not.toMatch(DISCORD_MENTION_REGEX);
  });

  it("el resto del contenido es idéntico: sólo la sintaxis de la mención cambia", () => {
    const input =
      "antes @everyone después: revisa https://example.com y `código` y **negrita**";
    const out = sanitizeDiscordMessage(input);

    expect(out).toContain("antes ");
    expect(out).toContain(" después: revisa https://example.com y `código` y **negrita**");
    // El único cambio es el ZWSP metido en la mención.
    expect(out.replace(ZWSP, "")).toBe(input);
  });

  it("no confunde texto que contiene @ o < sin cumplir el patrón de mención", () => {
    // @ suelto, <@abc> (no dígitos), <#123>, </cmd:1>: nada se toca.
    const input = "email test@example.com, <@notdigits>, <#456>, </hola:1>";
    expect(sanitizeDiscordMessage(input)).toBe(input);
  });

  it("mención pegada a texto sin espacios sigue neutralizándose", () => {
    const out = sanitizeDiscordMessage("hola<@42>mundo");
    expect(out).toBe(`hola<@${ZWSP}42>mundo`);
    expect(out).not.toMatch(DISCORD_MENTION_REGEX);
  });
});
