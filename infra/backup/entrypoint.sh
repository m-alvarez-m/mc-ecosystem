#!/bin/bash
# Inicializa el repositorio restic una sola vez y deja crond en primer plano.
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

echo "Backups programados: DB cada hora, mundo cada 6 h. Retención: 30 días."
exec crond -f -l 8
