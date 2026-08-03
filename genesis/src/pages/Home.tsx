import { Heading } from "../components";
import { SummaryDashboard } from "../features/summary";
import { Overview } from "../features/overview";

// Home · Dashboard raíz (D4).
//
// Estructura de la página:
//   <h1> Dashboard             ← page-level heading (aquí)
//   <SummaryDashboard/>        ← D4, sección Summary con KPIs
//   <Overview/>                ← D3, sección Overview con Insight Cards
//
// El gap entre secciones lo aporta `<Content>` (D2), no este archivo.

export function Home(): JSX.Element {
  return (
    <>
      <Heading level={1} visualSize="xl">
        Dashboard
      </Heading>
      <SummaryDashboard />
      <Overview />
    </>
  );
}
