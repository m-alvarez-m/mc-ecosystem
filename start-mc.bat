@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo === MC Ecosystem: arranque ===
echo.

REM ============================================================
REM 1) Verificar daemon de Docker.
REM ============================================================
docker info >nul 2>&1
if errorlevel 1 (
    echo Docker daemon no responde. Intentando arrancar Docker Desktop...
    if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
        start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    ) else (
        echo ERROR: no encontre Docker Desktop en la ruta estandar.
        echo Abrelo tu manualmente y vuelve a correr este script.
        goto :err
    )
    echo Esperando hasta 60s a que el daemon responda...
    set /a c=0
    :wait_docker
    timeout /t 3 /nobreak >nul
    docker info >nul 2>&1
    if not errorlevel 1 goto docker_ok
    set /a c+=3
    if !c! lss 60 goto wait_docker
    echo.
    echo ERROR: Docker sigue sin responder despues de 60s.
    echo   - Si Docker Desktop esta abierto pero el motor WSL esta caido,
    echo     abre otra terminal y prueba:   wsl --shutdown
    echo     luego relanza Docker Desktop desde el menu inicio.
    echo   - Logs de Docker Desktop: %%LOCALAPPDATA%%\Docker\log\host\
    goto :err
    :docker_ok
    echo Docker daemon OK.
    echo.
)

REM ============================================================
REM 2) Stack ya sano? Idempotencia.
REM ============================================================
set "MC_HEALTH="
for /f %%i in ('docker inspect --format "{{.State.Health.Status}}" mc-ecosystem-minecraft-staging-1 2^>nul') do set "MC_HEALTH=%%i"
if "!MC_HEALTH!"=="healthy" (
    echo Stack ya esta sano ^(minecraft-staging: healthy^).
    goto :show_state
)

REM ============================================================
REM 3) Arranque completo, orden del runbook:
REM    base (postgres, api, backup, playit) -> publish-pack-url.sh
REM    (que levanta packserver + cloudflared -> verifica URL -> minecraft)
REM ============================================================
echo Levantando servicios base ^(postgres, api, backup, playit^)...
docker compose -f mc-ecosystem\infra\docker-compose.dev.yml -f mc-ecosystem\infra\docker-compose.staging.yml -p mc-ecosystem up -d postgres api backup playit
if errorlevel 1 (
    echo.
    echo ERROR: no se pudieron levantar los servicios base.
    echo Logs: docker compose -p mc-ecosystem logs
    goto :err
)
echo.

where bash >nul 2>&1
if errorlevel 1 (
    echo ERROR: 'bash' no esta en el PATH. Instala Git for Windows
    echo ^(publish-pack-url.sh es un script de bash^).
    goto :err
)

echo Publicando URL del pack y arrancando minecraft-staging...
bash mc-ecosystem/infra/publish-pack-url.sh
if errorlevel 1 (
    echo.
    echo ERROR: publish-pack-url.sh fallo. Mira sus mensajes arriba
    echo ^(tipicamente: URL no aparecio, o el edge de Cloudflare tardo en enrutar^).
    goto :err
)

:show_state
echo.
echo === Estado ===
docker compose -p mc-ecosystem ps --format "table {{.Service}}\t{{.Status}}"
echo.

REM URL del pack desde infra/.env (fuente de verdad tras publish-pack-url.sh).
set "PACK_URL="
if exist "mc-ecosystem\infra\.env" (
    for /f "usebackq tokens=1,* delims==" %%A in ("mc-ecosystem\infra\.env") do (
        if /i "%%A"=="RESOURCE_PACK_URL" set "PACK_URL=%%B"
    )
)
if defined PACK_URL (
    echo URL del pack: !PACK_URL!
    <nul set /p "=!PACK_URL!" | clip
    echo ^(copiada al portapapeles^)
) else (
    echo AVISO: RESOURCE_PACK_URL no encontrada en infra\.env
)

echo.
echo Recuerda: si tu router filtra trycloudflare.com, tu adaptador
echo necesita DNS 1.1.1.1 para descargar el pack.
echo.
pause
exit /b 0

:err
echo.
pause
exit /b 1
