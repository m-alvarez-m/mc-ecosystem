#!/bin/bash
# restore-drill.sh [--offsite] — simulacro de restauración del ÚLTIMO backup.
# No basta con que los snapshots existan: el dump tiene que CARGAR en un
# PostgreSQL real y el mundo tiene que contener su level.dat.
# --offsite: restaura desde el repositorio B2 en vez del local.
set -uo pipefail

if [ "${1:-}" = "--offsite" ]; then
    if [ -z "${RESTIC_REPOSITORY_OFFSITE:-}" ]; then
        echo "No hay RESTIC_REPOSITORY_OFFSITE configurado" >&2
        exit 2
    fi
    export RESTIC_REPOSITORY="$RESTIC_REPOSITORY_OFFSITE"
    echo "(drill contra el repositorio OFFSITE: $RESTIC_REPOSITORY)"
fi

tmp=$(mktemp -d /tmp/restore-drill.XXXXXX)
drill_db=restore_drill
fail=0

check() { # check <PASS|FAIL> <mensaje>
    echo "[$1] $2"
    [ "$1" = FAIL ] && fail=1
}

cleanup() {
    dropdb --if-exists "$drill_db" 2>/dev/null
    rm -rf "$tmp"
}
trap cleanup EXIT

echo "=== Simulacro de restauración ($(date -u +%Y-%m-%dT%H:%M:%SZ)) ==="

# ---------- base de datos ----------
if restic restore latest --tag db --target "$tmp/db" --quiet; then
    check PASS "snapshot db restaurado"
else
    check FAIL "no se pudo restaurar el snapshot db"
fi

dump=$(find "$tmp/db" -name '*.dump' -type f | head -1)
if [ -n "$dump" ]; then
    dropdb --if-exists "$drill_db"
    if createdb "$drill_db" && pg_restore -d "$drill_db" "$dump"; then
        events=$(psql -d "$drill_db" -tA -c "SELECT count(*) FROM events" 2>/dev/null)
        if [ -n "$events" ] && [ "$events" -ge 0 ] 2>/dev/null; then
            check PASS "el dump carga: $events eventos en la tabla restaurada"
        else
            check FAIL "el dump cargó pero la tabla events no responde"
        fi
    else
        check FAIL "pg_restore no pudo cargar el dump"
    fi
else
    check FAIL "el snapshot db no contiene ningún .dump"
fi

# ---------- mundo ----------
if restic restore latest --tag world --target "$tmp/world" --quiet; then
    check PASS "snapshot world restaurado"
else
    check FAIL "no se pudo restaurar el snapshot world"
fi

level=$(find "$tmp/world" -path '*/world/level.dat' -type f | head -1)
if [ -n "$level" ] && [ -s "$level" ]; then
    check PASS "level.dat presente y no vacío ($(du -h "$level" | cut -f1))"
else
    check FAIL "level.dat no encontrado en el mundo restaurado"
fi

echo "==================================="
if [ "$fail" -eq 0 ]; then
    echo "SIMULACRO OK: el último backup es restaurable"
else
    echo "SIMULACRO FALLIDO: revisa los FAIL de arriba"
fi
exit "$fail"
