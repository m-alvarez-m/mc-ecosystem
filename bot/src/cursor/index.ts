// Barrel export del modulo Cursor Store.
// Un solo punto de import para consumidores:
//   import { FileCursorStore, CursorData, CorruptCursorError } from "../cursor";

export type { CursorData, CursorStore } from "./types";

export { FileCursorStore } from "./cursor-store";
export type { CursorStoreOptions } from "./cursor-store";

export {
  CursorStoreError,
  CorruptCursorError,
  ReadError,
  WriteError,
  PermissionError,
} from "./errors";
