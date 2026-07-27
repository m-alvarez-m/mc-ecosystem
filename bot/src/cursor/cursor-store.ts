import { promises as fs } from "node:fs";
import path from "node:path";
import type { CursorData, CursorStore } from "./types";
import {
  CorruptCursorError,
  PermissionError,
  ReadError,
  WriteError,
} from "./errors";

// Implementacion de CursorStore basada en un archivo JSON local.
//
// Diseno:
// - fs/promises unicamente. Sin SQLite, sin bases de datos, sin deps.
// - Escritura atomica via write-a-temporal + rename. rename es atomico
//   en POSIX (mismo FS) y bajo condiciones normales en NTFS: garantiza
//   que un crash a mitad de save() nunca deje el archivo destino
//   truncado ni con JSON parcial. Como maximo puede haber un temporal
//   huerfano al reiniciar, que se limpia solo en el siguiente save().
// - Errores tipados: distinguimos permisos (EACCES), IO generico y
//   corrupcion (parse/schema). ENOENT no es error: es "no existe aun".
// - No loguea. Propaga.

export interface CursorStoreOptions {
  /** Ruta absoluta o relativa al archivo JSON del cursor. */
  filePath: string;
}

export class FileCursorStore implements CursorStore {
  private readonly filePath: string;

  constructor(options: CursorStoreOptions) {
    this.filePath = options.filePath;
  }

  async exists(): Promise<boolean> {
    try {
      await fs.access(this.filePath);
      return true;
    } catch (err: unknown) {
      if (isErrno(err, "ENOENT")) return false;
      if (isErrno(err, "EACCES")) throw new PermissionError("read", causeOpt(err));
      throw new ReadError(errMessage(err), causeOpt(err));
    }
  }

  async load(): Promise<CursorData | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (err: unknown) {
      if (isErrno(err, "ENOENT")) return null;
      if (isErrno(err, "EACCES")) throw new PermissionError("read", causeOpt(err));
      throw new ReadError(errMessage(err), causeOpt(err));
    }

    if (raw.trim().length === 0) {
      // Archivo vacio: caso patologico de una escritura no-atomica
      // previa o truncado manual. Corrupt, no null: enmascarar esto
      // como "sin cursor" arriesga a que el consumidor arranque como
      // si fuera fresco y reproduzca historia por error.
      throw new CorruptCursorError("archivo vacio");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err: unknown) {
      throw new CorruptCursorError(`JSON invalido: ${errMessage(err)}`, causeOpt(err));
    }

    if (!isCursorData(parsed)) {
      throw new CorruptCursorError(
        "schema no cumple {event_id: string, updated_at: string}",
      );
    }

    return parsed;
  }

  async save(eventId: string): Promise<void> {
    const data: CursorData = {
      event_id: eventId,
      updated_at: new Date().toISOString(),
    };
    const body = JSON.stringify(data, null, 2) + "\n";

    const dir = path.dirname(this.filePath);
    // Temporal en el MISMO directorio: rename cross-filesystem no es
    // atomico. `.<name>.tmp-<pid>-<ts>` reduce colisiones si varios
    // procesos escriben al mismo cursor (no deberia pasar, pero por
    // higiene).
    const tmpPath = path.join(
      dir,
      `.${path.basename(this.filePath)}.tmp-${process.pid}-${Date.now()}`,
    );

    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (err: unknown) {
      if (isErrno(err, "EACCES")) throw new PermissionError("write", causeOpt(err));
      throw new WriteError(
        `no se pudo crear directorio ${dir}: ${errMessage(err)}`,
        causeOpt(err),
      );
    }

    try {
      await fs.writeFile(tmpPath, body, { encoding: "utf8" });
    } catch (err: unknown) {
      if (isErrno(err, "EACCES")) throw new PermissionError("write", causeOpt(err));
      throw new WriteError(
        `no se pudo escribir el temporal: ${errMessage(err)}`,
        causeOpt(err),
      );
    }

    try {
      await fs.rename(tmpPath, this.filePath);
    } catch (err: unknown) {
      // Best-effort: dejar basura en el disco es peor que enmascarar
      // un fallo secundario aqui. El error original (rename) es lo que
      // vamos a lanzar.
      await fs.unlink(tmpPath).catch(() => {
        /* ignore cleanup failure */
      });
      if (isErrno(err, "EACCES")) throw new PermissionError("write", causeOpt(err));
      throw new WriteError(`no se pudo hacer rename: ${errMessage(err)}`, causeOpt(err));
    }
  }

  async reset(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
    } catch (err: unknown) {
      // reset() sobre archivo inexistente = no-op. Simplifica el
      // consumidor: puede llamar reset() sin comprobar antes.
      if (isErrno(err, "ENOENT")) return;
      if (isErrno(err, "EACCES")) throw new PermissionError("write", causeOpt(err));
      throw new WriteError(errMessage(err), causeOpt(err));
    }
  }
}

// --------------------------------------------------------------------
// Helpers de errores y validacion
// --------------------------------------------------------------------

interface NodeErrno extends Error {
  code?: string;
}

function isErrno(err: unknown, code: string): err is NodeErrno {
  return err instanceof Error && (err as NodeErrno).code === code;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function causeOpt(err: unknown): ErrorOptions | undefined {
  return err instanceof Error ? { cause: err } : undefined;
}

function isCursorData(x: unknown): x is CursorData {
  if (typeof x !== "object" || x === null) return false;
  const obj = x as Record<string, unknown>;
  return typeof obj["event_id"] === "string" && typeof obj["updated_at"] === "string";
}
