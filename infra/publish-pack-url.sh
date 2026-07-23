#!/usr/bin/env bash
# publish-pack-url.sh [--watch]
#
# El quick tunnel de Cloudflare entrega una URL EFIMERA distinta en cada
# arranque de cloudflared. Este script la descubre, la VERIFICA y la publica
# en el staging, en un orden que elimina la condicion de carrera:
#
#     packserver + cloudflared  ->  URL verificada  ->  .env  ->  minecraft
#
# depends_on de compose NO sirve para esto: solo espera a que el contenedor
# arranque, no a que la URL exista. Por eso el orden lo impone este script.
# Minecraft arranca UNICAMENTE cuando la URL ya sirve pack.zip de verdad; si
# no aparece o no responde, se aborta SIN arrancar Minecraft (mejor un
# servidor sin pack que uno anunciando una descarga rota).
#
#   --watch : queda vigilando. Si cloudflared se reinicia solo, su URL cambia
#             y la publicada queda muerta; en ese caso re-publica automatico.
#             Ojo: recrear Minecraft desconecta a los jugadores unos segundos,
#             por eso solo actua cuando la URL REALMENTE cambio.

set -uo pipefail

BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BASE"

COMPOSE_ARGS=(-f infra/docker-compose.dev.yml -f infra/docker-compose.staging.yml -p mc-ecosystem)
ENV_FILE="infra/.env"
PACK="infra/resourcepack/pack.zip"
CF_CONTAINER="mc-ecosystem-cloudflared-1"
URL_TIMEOUT=120          # segundos esperando que la URL aparezca en los logs
VERIFY_TIMEOUT=90        # segundos esperando que el edge enrute pack.zip
URL_RE='https://[a-z0-9][a-z0-9.-]*\.trycloudflare\.com'

log() { echo "[pack-url] $*"; }
die() { echo "[pack-url] ERROR: $*" >&2; exit 1; }
compose() { docker compose "${COMPOSE_ARGS[@]}" "$@"; }

# Ultima URL anunciada por cloudflared en sus logs, filtrando SOLO la
# sesion actual: docker compose stop+start conserva los logs, y cada
# arranque de cloudflared imprime una URL nueva. Sin --since $StartedAt
# el tail devolveria una URL de una sesion anterior que Cloudflare ya
# dejo morir (bug real, cazado en vivo el 2026-07-23).
current_tunnel_url() {
    local started
    started="$(docker inspect --format '{{.State.StartedAt}}' "$CF_CONTAINER" 2>/dev/null)"
    if [ -n "$started" ]; then
        docker logs --since "$started" "$CF_CONTAINER" 2>&1 | grep -oE "$URL_RE" | tail -1
    else
        docker logs "$CF_CONTAINER" 2>&1 | grep -oE "$URL_RE" | tail -1
    fi
}

wait_for_url() {
    local deadline=$(( SECONDS + URL_TIMEOUT )) url=""
    while [ "$SECONDS" -lt "$deadline" ]; do
        url="$(current_tunnel_url)"
        if [ -n "$url" ]; then
            echo "$url"
            return 0
        fi
        sleep 2
    done
    return 1
}

# Que la URL este impresa no basta: el edge de Cloudflare tarda en enrutar.
# Exigimos que pack.zip llegue de verdad antes de tocar nada.
#
# Se verifica con DNS-over-HTTPS (1.1.1.1) a proposito: muchos routers/ISP
# filtran *.trycloudflare.com (los tuneles se abusan para phishing) y
# devuelven NXDOMAIN. Verificar con el resolutor local daria un falso
# negativo aunque el tunel este perfecto para el resto de internet, que es
# la vista que de verdad importa. Fallback a DNS normal si curl no soporta
# --doh-url.
probe_pack() {  # probe_pack URL -> imprime "codigo content-type"
    local url="$1" out
    out="$(curl --doh-url https://1.1.1.1/dns-query -sS -o /dev/null \
          -w '%{http_code} %{content_type}' "${url}/pack.zip" 2>/dev/null)" || out=""
    if [ "${out%% *}" != "200" ]; then
        out="$(curl -sS -o /dev/null -w '%{http_code} %{content_type}' \
              "${url}/pack.zip" 2>/dev/null)" || out=""
    fi
    echo "$out"
}

verify_url() {
    local url="$1" deadline=$(( SECONDS + VERIFY_TIMEOUT )) out code ctype
    while [ "$SECONDS" -lt "$deadline" ]; do
        out="$(probe_pack "$url")"
        code="${out%% *}"
        ctype="${out#* }"
        if [ "$code" = "200" ]; then
            log "verificado a traves del tunel: HTTP 200, content-type ${ctype:-?}"
            case "${ctype:-}" in
                application/zip*) : ;;
                *) log "AVISO: content-type inesperado (${ctype:-vacio})" ;;
            esac
            return 0
        fi
        sleep 3
    done
    return 1
}

set_env_var() {  # set_env_var CLAVE VALOR
    local key="$1" value="$2" tmp
    tmp="$(mktemp)"
    grep -v "^${key}=" "$ENV_FILE" > "$tmp" 2>/dev/null || true
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
    mv "$tmp" "$ENV_FILE"
}

publish() {
    local url="$1" sha1
    [ -f "$PACK" ] || die "falta $PACK (genera el pack con infra/resourcepack/build-pack.ps1)"
    sha1="$(sha1sum "$PACK" | cut -d' ' -f1)"

    set_env_var RESOURCE_PACK_URL "${url}/pack.zip"
    set_env_var RESOURCE_PACK_SHA1 "$sha1"
    log "URL publicada: ${url}/pack.zip"
    log "SHA-1 del pack: $sha1"

    # up -d, NO restart: restart reusa el contenedor con su env viejo. Hay que
    # recrear para que la imagen de itzg reescriba server.properties.
    compose up -d minecraft-staging >/dev/null 2>&1 \
        || die "no se pudo recrear minecraft-staging"
    log "minecraft-staging recreado con la URL y el SHA-1 nuevos"
}

main() {
    docker info >/dev/null 2>&1 || die "Docker no esta corriendo"
    [ -f "$ENV_FILE" ] || die "falta $ENV_FILE"

    log "levantando packserver + cloudflared (Minecraft todavia NO)"
    compose up -d packserver cloudflared >/dev/null 2>&1 \
        || die "no se pudieron levantar packserver/cloudflared"

    log "esperando la URL efimera del quick tunnel (max ${URL_TIMEOUT}s)..."
    local url
    url="$(wait_for_url)" \
        || die "la URL no aparecio en los logs de cloudflared; Minecraft NO se arranco"
    log "URL detectada: $url"

    verify_url "$url" \
        || die "la URL no sirve pack.zip todavia; Minecraft NO se arranco"

    publish "$url"

    if [ "${1:-}" = "--watch" ]; then
        log "modo watch activo: vigilando cambios de URL (Ctrl-C para salir)"
        local seen="$url" now
        while sleep 30; do
            now="$(current_tunnel_url)"
            if [ -n "$now" ] && [ "$now" != "$seen" ]; then
                log "cloudflared cambio de URL: $now"
                if verify_url "$now"; then
                    publish "$now"
                    seen="$now"
                else
                    log "AVISO: la URL nueva aun no responde; se reintentara"
                fi
            fi
        done
    fi
}

main "$@"
