FROM alpine:3.22

# postgresql16-client: pg_dump/pg_restore de la MISMA major que el servidor.
# util-linux: uuidgen para el event_uuid de backup.done.
RUN apk add --no-cache bash restic postgresql16-client curl util-linux tzdata

# rcon-cli: save-off/save-on del servidor durante el backup del mundo.
ARG RCON_CLI_VERSION=1.7.6
RUN wget -qO- "https://github.com/itzg/rcon-cli/releases/download/${RCON_CLI_VERSION}/rcon-cli_${RCON_CLI_VERSION}_linux_amd64.tar.gz" \
    | tar xz -C /usr/local/bin rcon-cli

COPY backup.sh restore-drill.sh entrypoint.sh /scripts/
COPY crontab /etc/crontabs/root
RUN chmod +x /scripts/*.sh

ENTRYPOINT ["/scripts/entrypoint.sh"]
