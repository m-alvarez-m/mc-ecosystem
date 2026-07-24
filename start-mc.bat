@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM ============================================================
REM Modo de arranque: prod (default) o staging.
REM   - Doble-click              -> prod (nacimiento del mundo real)
REM   - start-mc.bat staging     -> staging (pruebas)
REM   - start-mc.bat prod        -> prod (explicito)
REM Default prod desde ADR-004/005: staging queda como opcion
REM secundaria que hay que pedir a mano.
REM ============================================================
set "MC_MODE=%~1"
if not defined MC_MODE set "MC_MODE=prod"

if /i "!MC_MODE!"=="prod" (
    set "MC_COMPOSE=infra\docker-compose.prod.yml"
    set "MC_SERVICE=minecraft-prod"
    set "MC_CONTAINER=mc-ecosystem-minecraft-prod-1"
) else if /i "!MC_MODE!"=="staging" (
    set "MC_COMPOSE=infra\docker-compose.staging.yml"
    set "MC_SERVICE=minecraft-staging"
    set "MC_CONTAINER=mc-ecosystem-minecraft-staging-1"
) else (
    echo ERROR: MC_MODE debe ser "prod" o "staging" ^(recibido: !MC_MODE!^)
    echo Uso: start-mc.bat [prod^|staging]
    pause
    exit /b 1
)

echo === MC Ecosystem: arranque ^(modo: !MC_MODE!^) ===
echo.

REM Confirmacion humana obligatoria antes de tocar produccion.
REM No se pide en staging (por definicion, es desechable).
if /i "!MC_MODE!"=="prod" (
    echo Este arranque va a levantar PRODUCCION ^(mundo real^).
    echo Compose:   !MC_COMPOSE!
    echo Servicio:  !MC_SERVICE!
    echo.
    echo Presiona ENTER para continuar, o Ctrl+C para cancelar.
    pause
    echo.
)

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
REM    Requerimos running Y healthy: un contenedor 'exited' puede
REM    mantener 'healthy' del ultimo check, no cuenta como sano.
REM ============================================================
set "MC_STATUS="
for /f %%i in ('docker inspect --format "{{.State.Status}}" !MC_CONTAINER! 2^>nul') do set "MC_STATUS=%%i"
if "!MC_STATUS!"=="running" (
    set "MC_HEALTH="
    for /f %%i in ('docker inspect --format "{{.State.Health.Status}}" !MC_CONTAINER! 2^>nul') do set "MC_HEALTH=%%i"
    if "!MC_HEALTH!"=="healthy" (
        echo Stack ya esta sano ^(!MC_SERVICE!: running + healthy^).
        goto :show_state
    )
)

REM ============================================================
REM 3) Arranque completo, orden del runbook:
REM    base (postgres, api, backup, playit) -> publish-pack-url.sh
REM    (que levanta packserver + cloudflared -> verifica URL -> minecraft)
REM ============================================================
echo Levantando servicios base ^(postgres, api, backup, playit^)...
docker compose -f infra\docker-compose.dev.yml -f !MC_COMPOSE! -p mc-ecosystem up -d postgres api backup playit
if errorlevel 1 (
    echo.
    echo ERROR: no se pudieron levantar los servicios base.
    echo Logs: docker compose -p mc-ecosystem logs
    goto :err
)
echo.

REM Descubrir Git bash por ruta absoluta: al hacer doble-click en un .bat
REM Windows arranca CMD con el PATH del SISTEMA, y ahi C:\Windows\System32
REM \bash.exe (el proxy de WSL) gana. Sin distro Linux instalada eso da
REM "execvpe(/bin/bash) failed". Ir directo al bash de Git evita la trampa.
set "BASH_EXE="
if exist "C:\Program Files\Git\bin\bash.exe" set "BASH_EXE=C:\Program Files\Git\bin\bash.exe"
if not defined BASH_EXE if exist "C:\Program Files\Git\usr\bin\bash.exe" set "BASH_EXE=C:\Program Files\Git\usr\bin\bash.exe"
if not defined BASH_EXE if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" set "BASH_EXE=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not defined BASH_EXE (
    echo ERROR: no encontre Git Bash en las rutas estandar.
    echo Instala Git for Windows desde https://git-scm.com/download/win
    echo ^(publish-pack-url.sh es un script de bash^).
    goto :err
)

REM MC_MODE ya esta en el env del proceso via set arriba; publish-pack-url.sh
REM lo recoge y selecciona el compose + servicio correspondiente.
echo Publicando URL del pack y arrancando !MC_SERVICE!...
"!BASH_EXE!" infra/publish-pack-url.sh
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
if exist "infra\.env" (
    for /f "usebackq tokens=1,* delims==" %%A in ("infra\.env") do (
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
