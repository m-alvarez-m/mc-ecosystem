import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { queryClient } from "./api/queryClient";
import { router } from "./router";

// Estilos globales: tokens (CSS custom props) + reset minimo + reglas
// base (body, focus-visible). Cada componente aporta su .module.css
// propio; nada de estilos globales fuera de estos tres archivos.
import "./theme/theme.css";
import "./styles/reset.css";
import "./styles/global.css";

// Entry point de Genesis (D1 + D2).
//
// StrictMode intencional: la doble-invocacion en dev ayuda a detectar
// side effects impuros en efectos de React durante el desarrollo.

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("#root no existe en index.html");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
