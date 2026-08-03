import { Badge, Card, Divider } from "../../components";
import type { Insight } from "../../api/insights";
import { SeverityDot } from "./SeverityDot";
import {
  categoryLabel,
  confidenceView,
  formatDateTime,
  formatFactValue,
  humanizeKey,
  insightTitle,
} from "./formatters";
import styles from "./InsightCard.module.css";

export interface InsightCardProps {
  insight: Insight;
}

// Card por Insight (D3).
//
// Estructura fija — igual para los 4 insights actuales y para
// cualquier futuro. Sin ramas per-id: el contrato uniforme del
// Insight Engine ya garantiza el shape, y las diferencias visuales
// las cubre el mapeo generico de facts (key: value).
//
// Regiones (accesibilidad):
//   <article aria-labelledby>       -> region autocontenida
//     <header>                       -> titulo + subtitulo + confidence
//     <dl.factsList>                 -> facts como definition list
//     <footer role="group">          -> evidence como grupo de badges

export function InsightCard({ insight }: InsightCardProps): JSX.Element {
  const titleId = `insight-${insight.id}-title`;
  const confidence = confidenceView(insight.confidence);

  return (
    <Card variant="surface" data-insight-id={insight.id}>
      <article
        className={styles.root}
        aria-labelledby={titleId}
        data-severity={insight.severity}
      >
        <header className={styles.header}>
          <div className={styles.headerText}>
            <h3 id={titleId} className={styles.title}>
              {insightTitle(insight.id)}
            </h3>
            <div className={styles.subtle}>
              {categoryLabel(insight.category)} · {formatDateTime(insight.generatedAt)}
            </div>
            <div className={styles.subtle}>
              Ventana: {formatDateTime(insight.window.from)} → {formatDateTime(insight.window.to)}
            </div>
          </div>
          <Badge variant={confidence.badgeVariant} size="sm">
            {confidence.label}
          </Badge>
        </header>

        <SeverityDot severity={insight.severity} />

        <Divider />

        <dl className={styles.factsList}>
          {Object.entries(insight.facts).map(([key, value]) => (
            <FactRow key={key} label={humanizeKey(key)} value={formatFactValue(value)} />
          ))}
        </dl>

        {insight.evidence.length > 0 ? (
          <>
            <Divider />
            <footer role="group" aria-label="Signals que sustentan este insight">
              <div className={styles.evidenceLabel}>Basado en</div>
              <div className={styles.evidenceList}>
                {insight.evidence.map((signal) => (
                  <Badge key={signal} variant="neutral" size="sm">
                    {signal}
                  </Badge>
                ))}
              </div>
            </footer>
          </>
        ) : null}
      </article>
    </Card>
  );
}

// Sub-render para forzar semantica dt/dd correcta (React exige que
// ambos sean hijos directos del <dl>, asi que se usa Fragment).
function FactRow({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <>
      <dt className={styles.factKey}>{label}</dt>
      <dd className={styles.factValue}>{value}</dd>
    </>
  );
}
