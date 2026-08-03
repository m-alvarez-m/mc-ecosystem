import { describe, it, expect, vi } from "vitest";
import {
  BackupHandler,
  InvalidBackupPayloadError,
} from "../src/handlers/backup-handler";
import type { DispatchContext } from "../src/context";
import type { Publisher, PublishPayload } from "../src/publisher";
import type { EventRecord } from "../src/eventstore";

// Tests de BackupHandler.
// Sin Discord, sin red: publisher fake y contexto minimo.

function fakePublisher(): Publisher & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn(async () => undefined) };
}

const NEVER_CALLED_RESOLVER = {
  resolve: vi.fn(async () => {
    throw new Error("PlayerNameResolver no debe usarse en backup.done");
  }),
} as unknown as import("../src/players").PlayerNameResolver;

function fakeContext(publisher: Publisher): DispatchContext {
  return { publisher, playerNameResolver: NEVER_CALLED_RESOLVER, logger: { warn: () => undefined }, freshnessThresholdMs: 120000 };
}

function backupEvent(
  data: Record<string, unknown>,
  uuid = "aaaa",
): EventRecord {
  return {
    id: "42",
    event_uuid: `00000000-0000-4000-8000-${uuid.padStart(12, "0")}`,
    type: "backup.done",
    v: 1,
    ts: "2026-07-27T00:00:00.000Z",
    received_at: "2026-07-27T00:00:00.010Z",
    player_uuid: null,
    world: null,
    x: null,
    y: null,
    z: null,
    data,
  };
}

describe("BackupHandler", () => {
  it("supports('backup.done') true; otros false", () => {
    const h = new BackupHandler();
    expect(h.supports("backup.done")).toBe(true);
    expect(h.supports("server.tps_sample")).toBe(false);
    expect(h.supports("server.start")).toBe(false);
    expect(h.supports("")).toBe(false);
    expect(h.supports("BACKUP.DONE")).toBe(false);
  });

  it("publicacion correcta con ok=true", async () => {
    const publisher = fakePublisher();
    const h = new BackupHandler();
    await h.handle(
      fakeContext(publisher),
      backupEvent({ kind: "world", size_mb: 220, ok: true }),
    );

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Respaldo completado",
      body: "Tipo: world. Tamaño: 220 MB. Estado: exitoso.",
      kind: "backup",
    });
  });

  it("publicacion correcta con ok=false", async () => {
    const publisher = fakePublisher();
    const h = new BackupHandler();
    await h.handle(
      fakeContext(publisher),
      backupEvent({ kind: "db", size_mb: 5, ok: false }),
    );

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Respaldo completado",
      body: "Tipo: db. Tamaño: 5 MB. Estado: fallido.",
      kind: "backup",
    });
  });

  it("trimea kind pero conserva el resto tal cual", async () => {
    const publisher = fakePublisher();
    const h = new BackupHandler();
    await h.handle(
      fakeContext(publisher),
      backupEvent({ kind: "  world  ", size_mb: 100, ok: true }),
    );

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Respaldo completado",
      body: "Tipo: world. Tamaño: 100 MB. Estado: exitoso.",
      kind: "backup",
    });
  });

  it("acepta size_mb = 0 (backup vacio, tecnicamente valido)", async () => {
    const publisher = fakePublisher();
    const h = new BackupHandler();
    await h.handle(
      fakeContext(publisher),
      backupEvent({ kind: "db", size_mb: 0, ok: true }),
    );

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Respaldo completado",
      body: "Tipo: db. Tamaño: 0 MB. Estado: exitoso.",
      kind: "backup",
    });
  });

  it("data.kind ausente o vacio: InvalidBackupPayloadError y NO publica", async () => {
    const publisher = fakePublisher();
    const h = new BackupHandler();

    await expect(
      h.handle(fakeContext(publisher), backupEvent({ size_mb: 10, ok: true })),
    ).rejects.toBeInstanceOf(InvalidBackupPayloadError);
    await expect(
      h.handle(
        fakeContext(publisher),
        backupEvent({ kind: "", size_mb: 10, ok: true }),
      ),
    ).rejects.toBeInstanceOf(InvalidBackupPayloadError);
    await expect(
      h.handle(
        fakeContext(publisher),
        backupEvent({ kind: "   ", size_mb: 10, ok: true }),
      ),
    ).rejects.toBeInstanceOf(InvalidBackupPayloadError);
    await expect(
      h.handle(
        fakeContext(publisher),
        backupEvent({ kind: 42, size_mb: 10, ok: true }),
      ),
    ).rejects.toBeInstanceOf(InvalidBackupPayloadError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.size_mb ausente, no numerico, no entero, o infinito: InvalidBackupPayloadError", async () => {
    const publisher = fakePublisher();
    const h = new BackupHandler();

    await expect(
      h.handle(fakeContext(publisher), backupEvent({ kind: "world", ok: true })),
    ).rejects.toBeInstanceOf(InvalidBackupPayloadError);
    await expect(
      h.handle(
        fakeContext(publisher),
        backupEvent({ kind: "world", size_mb: "220", ok: true }),
      ),
    ).rejects.toBeInstanceOf(InvalidBackupPayloadError);
    await expect(
      h.handle(
        fakeContext(publisher),
        backupEvent({ kind: "world", size_mb: 12.5, ok: true }),
      ),
    ).rejects.toBeInstanceOf(InvalidBackupPayloadError);
    await expect(
      h.handle(
        fakeContext(publisher),
        backupEvent({
          kind: "world",
          size_mb: Number.POSITIVE_INFINITY,
          ok: true,
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidBackupPayloadError);
    await expect(
      h.handle(
        fakeContext(publisher),
        backupEvent({ kind: "world", size_mb: Number.NaN, ok: true }),
      ),
    ).rejects.toBeInstanceOf(InvalidBackupPayloadError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.ok ausente o no boolean (rechaza coerciones): InvalidBackupPayloadError", async () => {
    const publisher = fakePublisher();
    const h = new BackupHandler();

    await expect(
      h.handle(
        fakeContext(publisher),
        backupEvent({ kind: "world", size_mb: 10 }),
      ),
    ).rejects.toBeInstanceOf(InvalidBackupPayloadError);
    // No aceptamos coerciones truthy/falsy; ok debe ser boolean explicito.
    await expect(
      h.handle(
        fakeContext(publisher),
        backupEvent({ kind: "world", size_mb: 10, ok: 1 }),
      ),
    ).rejects.toBeInstanceOf(InvalidBackupPayloadError);
    await expect(
      h.handle(
        fakeContext(publisher),
        backupEvent({ kind: "world", size_mb: 10, ok: "true" }),
      ),
    ).rejects.toBeInstanceOf(InvalidBackupPayloadError);
    await expect(
      h.handle(
        fakeContext(publisher),
        backupEvent({ kind: "world", size_mb: 10, ok: null }),
      ),
    ).rejects.toBeInstanceOf(InvalidBackupPayloadError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("InvalidBackupPayloadError incluye eventUuid, reason y menciona backup.done", async () => {
    const h = new BackupHandler();
    const event = backupEvent(
      { size_mb: 10, ok: true },
      "cafecafecafe",
    );
    const err = await h
      .handle(fakeContext(fakePublisher()), event)
      .catch((e) => e);
    expect(err).toBeInstanceOf(InvalidBackupPayloadError);
    expect((err as InvalidBackupPayloadError).eventUuid).toBe(event.event_uuid);
    expect((err as InvalidBackupPayloadError).code).toBe("INVALID_BACKUP_PAYLOAD");
    expect((err as InvalidBackupPayloadError).reason).toContain("data.kind");
    expect((err as InvalidBackupPayloadError).message).toContain("backup.done");
  });

  it("publisher llamado exactamente una vez en caso feliz", async () => {
    const publisher = fakePublisher();
    const h = new BackupHandler();
    await h.handle(
      fakeContext(publisher),
      backupEvent({ kind: "world", size_mb: 220, ok: true }),
    );
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it("error del publisher se propaga tal cual", async () => {
    const boom = new Error("publish boom");
    const publisher: Publisher = {
      publish: vi.fn(async () => {
        throw boom;
      }),
    };
    const h = new BackupHandler();
    await expect(
      h.handle(
        fakeContext(publisher),
        backupEvent({ kind: "world", size_mb: 220, ok: true }),
      ),
    ).rejects.toBe(boom);
  });

  it("funciona con cualquier Publisher fake (no depende de Discord)", async () => {
    const seen: PublishPayload[] = [];
    const publisher: Publisher = {
      publish: async (p) => {
        seen.push(p);
      },
    };
    const h = new BackupHandler();
    await h.handle(
      fakeContext(publisher),
      backupEvent({ kind: "world", size_mb: 223, ok: true }),
    );
    expect(seen).toEqual([
      {
        title: "Respaldo completado",
        body: "Tipo: world. Tamaño: 223 MB. Estado: exitoso.",
      kind: "backup",
      },
    ]);
  });
});
