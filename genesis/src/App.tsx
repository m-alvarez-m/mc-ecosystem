import { Outlet } from "react-router-dom";

// App layout raiz. En D1 es solo un shell: renderiza la ruta activa
// via <Outlet />. El layout visual (sidebar, header, etc.) llegara
// en D2 con el Design System.

export function App() {
  return <Outlet />;
}
