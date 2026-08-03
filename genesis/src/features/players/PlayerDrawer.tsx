import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import {
  Button,
  ErrorState,
  LoadingState,
} from "../../components";
import { formatCount } from "../summary";
import { formatDateTime } from "../overview";
import { usePlayerInsight } from "../../hooks/usePlayerInsight";
import { PlayerNameHistory } from "./PlayerNameHistory";
import { PlayerEventsBreakdown } from "./PlayerEventsBreakdown";
import styles from "./PlayerDrawer.module.css";

export interface PlayerDrawerProps {
  /** UUID del jugador seleccionado. null = drawer cerrado. */
  uuid: string | null;
  onClose: () => void;
}

// PlayerDrawer (D6).
//
// Vive dentro de la misma página: es un overlay `role="dialog"
// aria-modal="true"` que se despliega desde la derecha. Sin routing
// nuevo, sin ventana modal centrada (los dashboards tienden a
// preferir side panels — el contexto de la lista queda visible al
// costado).
//
// Accesibilidad:
//   - role=dialog + aria-modal=true.
//   - aria-labelledby apunta al título dentro del panel.
//   - Focus inicial: botón de cierre (siempre accesible con Enter/
//     Space desde el momento en que se abre).
//   - Escape cierra.
//   - Clic en overlay cierra (Escape via UI).
//   - Tab trap: se ciclan los focusables del panel con Tab / Shift+Tab.
//   - Body scroll lock mientras está abierto.
//
// Estados internos:
//   - loading: LoadingState (compartido con el resto de features).
//   - error: ErrorState + Reintentar.
//   - success: pinta el bloque completo.
//
// La query sólo dispara cuando `uuid !== null` — usePlayerInsight
// tiene enabled=false hasta que el drawer se abre.

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function PlayerDrawer({ uuid, onClose }: PlayerDrawerProps): JSX.Element | null {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  const isOpen = uuid !== null;
  const query = usePlayerInsight(uuid);

  // Escape para cerrar (global).
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen, onClose]);

  // Focus inicial al abrir + body scroll lock.
  useEffect(() => {
    if (!isOpen) return;
    closeBtnRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Tab trap dentro del panel: al llegar al último focusable, Tab
  // vuelve al primero; Shift+Tab desde el primero salta al último.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (panel === null) return;
    const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onOverlayClick(): void {
    onClose();
  }

  function stopPanelClick(e: MouseEvent<HTMLDivElement>): void {
    e.stopPropagation();
  }

  return (
    <div
      className={styles.overlay}
      onClick={onOverlayClick}
      data-testid="player-drawer-overlay"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.panel}
        tabIndex={-1}
        onClick={stopPanelClick}
        onKeyDown={onKeyDown}
        data-testid="player-drawer-panel"
      >
        <header className={styles.header}>
          <div className={styles.headerText}>
            <h2 id={titleId} className={styles.title}>
              {query.isSuccess ? query.data.name : "Detalle de jugador"}
            </h2>
            <span className={styles.uuid} title={uuid}>
              {uuid}
            </span>
          </div>
          <Button
            ref={closeBtnRef}
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Cerrar detalle"
          >
            Cerrar
          </Button>
        </header>

        <div className={styles.body}>
          {query.isLoading ? (
            <LoadingState label="Cargando jugador…" />
          ) : null}

          {query.isError ? (
            <ErrorState
              title="No se pudo cargar el jugador"
              message={query.error.message}
              onRetry={() => {
                void query.refetch();
              }}
            />
          ) : null}

          {query.isSuccess ? (
            <>
              <section className={styles.block} aria-label="Totales">
                <p className={styles.blockLabel}>Total de eventos</p>
                <div className={styles.totalRow}>
                  <span className={styles.totalValue}>
                    {formatCount(query.data.totalEvents)}
                  </span>
                </div>
              </section>

              <section className={styles.block} aria-label="Primer evento">
                <p className={styles.blockLabel}>Primer evento</p>
                {query.data.firstEvent !== null ? (
                  <div className={styles.eventRef}>
                    <span className={styles.eventType}>
                      {query.data.firstEvent.type}
                    </span>
                    <time
                      className={styles.eventTs}
                      dateTime={query.data.firstEvent.ts}
                    >
                      {formatDateTime(query.data.firstEvent.ts)}
                    </time>
                  </div>
                ) : (
                  <span className={styles.eventTs}>—</span>
                )}
              </section>

              <section className={styles.block} aria-label="Último evento">
                <p className={styles.blockLabel}>Último evento</p>
                {query.data.lastEvent !== null ? (
                  <div className={styles.eventRef}>
                    <span className={styles.eventType}>
                      {query.data.lastEvent.type}
                    </span>
                    <time
                      className={styles.eventTs}
                      dateTime={query.data.lastEvent.ts}
                    >
                      {formatDateTime(query.data.lastEvent.ts)}
                    </time>
                  </div>
                ) : (
                  <span className={styles.eventTs}>—</span>
                )}
              </section>

              <section className={styles.block} aria-label="Historial de nombres">
                <p className={styles.blockLabel}>Historial de nombres</p>
                {query.data.nameHistory.length > 0 ? (
                  <PlayerNameHistory entries={query.data.nameHistory} />
                ) : (
                  <span className={styles.eventTs}>—</span>
                )}
              </section>

              <section
                className={styles.block}
                aria-label="Distribución por tipo"
              >
                <p className={styles.blockLabel}>Distribución por tipo</p>
                {query.data.eventsByType.length > 0 ? (
                  <PlayerEventsBreakdown entries={query.data.eventsByType} />
                ) : (
                  <span className={styles.eventTs}>—</span>
                )}
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
