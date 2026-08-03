import { Outlet } from "react-router-dom";
import { AppLayout, Page, Content } from "./layout";
import { Container } from "./components";

// App shell (D2). Envuelve la ruta activa en el esqueleto minimo
// del Design System:
//   AppLayout   -> fondo + color base
//     Page      -> landmark <main>
//       Container (wide)  -> centrado + max-width + padding responsive
//         Content         -> gap uniforme entre bloques
//           <Outlet/>     -> la pagina activa
//
// D2 no incluye sidebar / header / navegacion. Llegan cuando D4+ lo
// requiera. El proof-of-life de D1 (`<pre>` con JSON) sigue vivo
// como hijo de Outlet.

export function App() {
  return (
    <AppLayout>
      <Page>
        <Container size="wide">
          <Content>
            <Outlet />
          </Content>
        </Container>
      </Page>
    </AppLayout>
  );
}
