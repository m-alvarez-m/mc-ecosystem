import { Overview } from "../features/overview";

// Home = Overview desde D3. La ruta `/` renderiza el primer dashboard
// visual real, reemplazando el proof-of-life JSON de D1.
//
// La delgadez intencional de este archivo es la union entre routing
// (react-router) y features: cuando lleguen otras rutas
// (`/players`, `/insights/:id`, etc.), cada una tendra su propia
// pagina fina que monta una feature independiente.

export function Home(): JSX.Element {
  return <Overview />;
}
