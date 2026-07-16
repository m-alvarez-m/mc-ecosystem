#!/bin/bash
# backup.sh db|world — un backup con restic + retención 30 días + backup.done.
# El evento se emite SIEMPRE (ok:false si algo falló): un backup que falla
# en silencio es el peor fallo posible de un sistema de backups.
set -uo pipefail

kind="${1:?uso: backup.sh db|world}"
ok=true
size_mb=0

case "$kind" in
    db)
        dump=/tmp/mc_ecosystem.dump
        # -Fc: formato custom, comprimido y restaurable con pg_restore.
        if pg_dump -Fc -f "$dump"; then
            size_mb=$(du -m "$dump" | cut -f1)
            restic backup --quiet --tag db "$dump" || ok=false
        else
            ok=false
        fi
        rm -f "$dump"
        ;;
    world)
        # save-off + save-all flush: copia consistente. Si el servidor está
        # apagado no hay escrituras en curso, así que se copia igual.
        rcon() {
            rcon-cli --host "${RCON_HOST}" --port "${RCON_PORT:-25575}" \
                --password "${RCON_PASSWORD}" "$@"
        }
        saves_off=false
        if rcon save-off >/dev/null 2>&1 && rcon save-all flush >/dev/null 2>&1; then
            saves_off=true
            sleep 3 # margen para que el flush termine de tocar disco
        else
            echo "AVISO: rcon inalcanzable (¿servidor apagado?); copia sin save-off" >&2
        fi

        shopt -s nullglob
        worlds=(/data/staging/world*)
        if [ ${#worlds[@]} -gt 0 ]; then
            size_mb=$(du -cm "${worlds[@]}" | tail -1 | cut -f1)
            restic backup --quiet --tag world "${worlds[@]}" || ok=false
        else
            echo "No hay directorios world* que respaldar" >&2
            ok=false
        fi

        # Pase lo que pase con restic, el autosave vuelve a quedar activo.
        if [ "$saves_off" = true ]; then
            rcon save-on >/dev/null 2>&1 \
                || echo "CRITICO: no se pudo reactivar save-on" >&2
        fi
        ;;
    *)
        echo "kind desconocido: $kind" >&2
        exit 2
        ;;
esac

# Retención por tag: DB y mundo se conservan/expiran por separado.
if [ "$ok" = true ]; then
    restic forget --quiet --tag "$kind" --keep-within 30d --prune \
        || echo "AVISO: la poda de retención falló (el backup sí se guardó)" >&2
else
    size_mb=0
fi

# backup.done según docs/event-catalog.md (evento de servidor: sin player).
json=$(printf '{"event_uuid":"%s","type":"backup.done","v":1,"ts":"%s","data":{"kind":"%s","size_mb":%s,"ok":%s}}' \
    "$(uuidgen)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$kind" "$size_mb" "$ok")

if ! curl -sf -X POST -H 'Content-Type: application/json' \
        -d "$json" "$EVENTS_API_URL" >/dev/null; then
    echo "AVISO: no se pudo emitir backup.done a $EVENTS_API_URL" >&2
fi

echo "backup $kind: ok=$ok size_mb=$size_mb"
[ "$ok" = true ]
