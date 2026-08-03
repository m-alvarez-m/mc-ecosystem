import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Cleanup automatico entre tests para evitar fuga de DOM (unmount
// completo tras cada test) — patron estandar de Testing Library
// con Vitest en modo jsdom.
afterEach(() => {
  cleanup();
});
