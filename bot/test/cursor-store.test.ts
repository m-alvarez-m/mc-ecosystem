import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { FileCursorStore } from "../src/cursor/cursor-store";
import {
  CorruptCursorError,
  PermissionError,
  WriteError,
} from "../src/cursor/errors";

// Tests del cursor store basado en filesystem.
// Cada test aisla su propio directorio temporal para no depender de
// estado entre corridas ni entre sistemas operativos.

describe("FileCursorStore", () => {
  let tmpDir: string;
  let cursorPath: string;
  let store: FileCursorStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulso-cursor-"));
    cursorPath = path.join(tmpDir, "cursor.json");
    store = new FileCursorStore({ filePath: cursorPath });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("archivo inexistente: exists() false y load() null", async () => {
    expect(await store.exists()).toBe(false);
    expect(await store.load()).toBeNull();
  });

  it("save() persiste y load() lo lee de vuelta con updated_at", async () => {
    await store.save("42");
    expect(await store.exists()).toBe(true);

    const data = await store.load();
    expect(data).not.toBeNull();
    expect(data!.event_id).toBe("42");
    expect(typeof data!.updated_at).toBe("string");
    // updated_at es ISO 8601 UTC valido.
    expect(new Date(data!.updated_at).toString()).not.toBe("Invalid Date");
  });

  it("save() sobre archivo existente sobrescribe el valor previo", async () => {
    await store.save("1");
    await store.save("2");
    const data = await store.load();
    expect(data!.event_id).toBe("2");
  });

  it("archivo con JSON invalido: load() lanza CorruptCursorError", async () => {
    await fs.writeFile(cursorPath, "{ esto no es json valido", "utf8");
    await expect(store.load()).rejects.toBeInstanceOf(CorruptCursorError);
  });

  it("archivo vacio: load() lanza CorruptCursorError (no null)", async () => {
    // Enmascarar como null arriesga a un consumidor que arranque desde
    // cero por error. Preferimos que estalle explicitamente.
    await fs.writeFile(cursorPath, "", "utf8");
    await expect(store.load()).rejects.toBeInstanceOf(CorruptCursorError);
  });

  it("JSON parseable pero schema incorrecto: CorruptCursorError", async () => {
    await fs.writeFile(cursorPath, JSON.stringify({ foo: "bar" }), "utf8");
    await expect(store.load()).rejects.toBeInstanceOf(CorruptCursorError);
  });

  it("reset() elimina el archivo persistido", async () => {
    await store.save("42");
    expect(await store.exists()).toBe(true);
    await store.reset();
    expect(await store.exists()).toBe(false);
  });

  it("reset() sobre archivo inexistente es no-op (no lanza)", async () => {
    expect(await store.exists()).toBe(false);
    await expect(store.reset()).resolves.toBeUndefined();
  });

  it("escritura atomica: no deja archivos .tmp huerfanos tras save() exitoso", async () => {
    await store.save("42");
    const files = await fs.readdir(tmpDir);
    const tmpFiles = files.filter((f) => f.includes(".tmp-"));
    expect(tmpFiles).toEqual([]);
  });

  it("si rename() falla, el .tmp se limpia y se propaga WriteError", async () => {
    // Simular fallo en el paso final del write-atomico. Verificamos
    // (a) que se lanza WriteError y (b) que no queda basura .tmp.
    const renameSpy = vi
      .spyOn(fs, "rename")
      .mockRejectedValueOnce(new Error("fallo simulado del rename"));

    await expect(store.save("42")).rejects.toBeInstanceOf(WriteError);

    const files = await fs.readdir(tmpDir);
    const tmpFiles = files.filter((f) => f.includes(".tmp-"));
    expect(tmpFiles).toEqual([]);

    renameSpy.mockRestore();
  });

  it("EACCES en write se mapea a PermissionError con operation='write'", async () => {
    // Simulacion cross-platform: EACCES real es dificil de forzar en
    // Windows sin ACLs complejas. Mockeamos writeFile para inyectar
    // el error node estandar; validamos que el store lo clasifica.
    const eaccesErr: NodeJS.ErrnoException = Object.assign(new Error("EACCES"), {
      code: "EACCES",
    });
    const writeSpy = vi
      .spyOn(fs, "writeFile")
      .mockRejectedValueOnce(eaccesErr);

    const err = await store.save("42").catch((e) => e);
    expect(err).toBeInstanceOf(PermissionError);
    expect((err as PermissionError).operation).toBe("write");

    writeSpy.mockRestore();
  });

  it("EACCES en read se mapea a PermissionError con operation='read'", async () => {
    const eaccesErr: NodeJS.ErrnoException = Object.assign(new Error("EACCES"), {
      code: "EACCES",
    });
    const readSpy = vi
      .spyOn(fs, "readFile")
      .mockRejectedValueOnce(eaccesErr);

    const err = await store.load().catch((e) => e);
    expect(err).toBeInstanceOf(PermissionError);
    expect((err as PermissionError).operation).toBe("read");

    readSpy.mockRestore();
  });

  it("save() crea directorios intermedios si no existen", async () => {
    const nestedPath = path.join(tmpDir, "sub", "dir", "cursor.json");
    const nestedStore = new FileCursorStore({ filePath: nestedPath });

    await nestedStore.save("42");
    expect(await nestedStore.exists()).toBe(true);
    const data = await nestedStore.load();
    expect(data!.event_id).toBe("42");
  });
});
