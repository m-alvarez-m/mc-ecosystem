import { Heading } from "../components";
import { SummaryDashboard } from "../features/summary";
import { Overview } from "../features/overview";
import { Timeline } from "../features/timeline";

// Home · Dashboard raíz (D5).
//
// Estructura de la página:
//   <h1> Dashboard             ← page-level heading
//   <SummaryDashboard/>        ← D4, KPIs
//   <Overview/>                ← D3, Insight Cards
//   <Timeline/>                ← D5, eventos recientes
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
      <Timeline />
    </>
  );
}
