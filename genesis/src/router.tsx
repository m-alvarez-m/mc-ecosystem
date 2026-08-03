import { createBrowserRouter } from "react-router-dom";
import { App } from "./App";
import { Home } from "./pages/Home";

// Router raiz. D1 solo registra la ruta `/` (proof-of-life).
// El resto de rutas llegan en D2+ conforme se materialicen los
// modulos (overview, insights, players, etc.).

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [{ index: true, element: <Home /> }],
  },
]);
