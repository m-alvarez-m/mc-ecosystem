import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Genesis · Dashboard del ecosistema Minecraft (D1).
//
// Configuracion unica para dev, build y test. Vitest reusa la misma
// definicion (importada desde `vitest/config`) — evita divergencias
// entre plugins aplicados en runtime y en test.
//
// Dev server:
//   - Escucha en 5173 (default de Vite). No expuesto en compose (dev
//     Docker sirve el build compilado por nginx en el puerto 8080).
//   - Proxy /api/* -> http://localhost:3000 solo para desarrollo local
//     fuera del compose. Dentro del contenedor de produccion, el mismo
//     proxy lo hace nginx contra el servicio `api` de la red compose.
//
// Build:
//   - Salida en dist/. Se sirve estatica desde nginx:alpine en el
//     stage 2 del Dockerfile.

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
