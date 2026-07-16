FROM alpine:3.22

# postgresql16-client: pg_dump/pg_restore de la MISMA major que el servidor.
# util-linux: uuidgen para el event_uuid de backup.done.
RUN apk add --no-cache bash restic postgresql16-client curl util-linux tzdata

COPY backup.sh restore-drill.sh entrypoint.sh /scripts/
COPY crontab /etc/crontabs/root
RUN chmod +x /scripts/*.sh

ENTRYPOINT ["/scripts/entrypoint.sh"]
