#!/bin/bash
# Inicializa el repositorio restic una sola vez, hace un backup fresco al
# arrancar (cierra el gap "crond solo corre con el stack up") y deja crond
# en primer plano.
set -euo pipefail

if ! restic cat config >/dev/null 2>&1; then
    echo "Repositorio restic vacío: inicializando en $RESTIC_REPOSITORY"
    restic init
fi

# Repo offsite (B2): mismos parámetros de chunking para que restic copy
# deduplique entre repos.
if [ -n "${RESTIC_REPOSITORY_OFFSITE:-}" ]; then
    if ! restic -r "$RESTIC_REPOSITORY_OFFSITE" cat config >/dev/null 2>&1; then
        echo "Repositorio offsite vacío: inicializando en $RESTIC_REPOSITORY_OFFSITE"
        RESTIC_FROM_PASSWORD="$RESTIC_PASSWORD" restic -r "$RESTIC_REPOSITORY_OFFSITE" \
            init --copy-chunker-params --from-repo "$RESTIC_REPOSITORY"
    fi
fi

# Backup al arrancar. Motivación: crond corre DENTRO del container, así
# que si el dueño juega en sprints y hace stop-mc.bat entre sesiones, los
# ticks programados (DB cada hora, world cada 6 h) NO se ejecutan durante
# los períodos con el stack apagado. Un snapshot al inicio garantiza un
# restore point fresco por cada sesión, aunque la anterior haya sido hace
# semanas. Ver runbook sección "Backups - limitación crítica".
#
# Consistencia: si minecraft-prod aún no está arriba, backup.sh cae al
# fallback "sin save-off" (copia sin flush por rcon). Como MC aún no
# escribe al mundo, la copia es igualmente consistente. Si MC ya está
# arriba, backup.sh hace save-off/on como en un tick normal.
#
# Errores no bloqueantes: si el backup inicial falla (B2 caído, rcon en
# transición, etc.) SEGUIMOS al crond. Un backup fallido en el arranque
# es una alerta, no un motivo para no tener crond corriendo.
echo "Backup inicial (world + db) para cerrar gap 'crond apagado'..."
/scripts/backup.sh world || echo "AVISO: backup inicial de world falló - crond sigue"
/scripts/backup.sh db    || echo "AVISO: backup inicial de db falló - crond sigue"

echo "Backups programados: DB cada hora, mundo cada 6 h. Retención: 30 días."
exec crond -f -l 8
