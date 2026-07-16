#!/bin/bash
# Inicializa el repositorio restic una sola vez y deja crond en primer plano.
set -euo pipefail

if ! restic cat config >/dev/null 2>&1; then
    echo "Repositorio restic vacío: inicializando en $RESTIC_REPOSITORY"
    restic init
fi

echo "Backups programados: DB cada hora, mundo cada 6 h. Retención: 30 días."
exec crond -f -l 8
