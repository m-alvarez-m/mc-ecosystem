@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM Reservado para un futuro argumento --verbose. No altera la salida actual.
set "MC_VERBOSE=0"

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
    REM pause ^>nul: suprimir el "Press any key to continue . . ." propio
    REM de pause; ya tenemos nuestro echo arriba, evitamos doble prompt.
    pause >nul
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
    REM timeout.exe explicito: si el .bat se lanza desde Git Bash, PATH
    REM puede resolver "timeout" al binario GNU (coreutils) que ignora /t
    REM y trata "3 /nobreak" como argumento invalido. .exe fuerza cmd.
    timeout.exe /t 3 /nobreak >nul
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
REM 2) Preflight Docker. Debe terminar ANTES de cualquier compose up.
REM    Solo inspecciona: nunca detiene, borra ni repara recursos.
REM ============================================================
call :preflight
if errorlevel 1 goto :err

REM ============================================================
REM 3) Stack ya sano? Idempotencia.
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
REM 4) Arranque completo, orden del runbook:
REM    base (postgres, api, backup, playit) -> publish-pack-url.sh
REM    (que levanta packserver + cloudflared -> verifica URL -> minecraft)
REM ============================================================
echo Levantando servicios base ^(postgres, api, backup, playit, bot^)...
REM --build evita reutilizar una imagen local anterior al codigo actual.
docker compose -f infra\docker-compose.dev.yml -f !MC_COMPOSE! -p mc-ecosystem up -d --build postgres api backup playit bot
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

REM ============================================================
REM 5) Espera activa: docker compose up devuelve cuando los
REM    contenedores arrancan, NO cuando estan healthy. Sin esta
REM    espera hay ventana ciega en la que el .bat dice "listo" pero
REM    minecraft-prod aun esta cargando el mundo (~30-90s) y los
REM    clientes que intentan conectar ven "server offline". Timeout
REM    120s: mundos de 220 MB en Paper 26 tardan ~76s en healthy.
REM ============================================================
echo.
echo Esperando a que los servicios queden listos (max 120s)...
set /a wait_elapsed=0
:wait_loop
call :check_svc !MC_CONTAINER!             healthy MC_ST
call :check_svc mc-ecosystem-postgres-1    healthy PG_ST
call :check_svc mc-ecosystem-api-1         healthy API_ST
call :check_svc mc-ecosystem-packserver-1  running PACK_ST
call :check_svc mc-ecosystem-cloudflared-1 running CLOUD_ST
call :check_svc mc-ecosystem-bot-1         healthy BOT_ST
echo   [!wait_elapsed!s]  mc:!MC_ST!  pg:!PG_ST!  api:!API_ST!  pack:!PACK_ST!  cloud:!CLOUD_ST!  bot:!BOT_ST!
if "!MC_ST!"=="OK" if "!PG_ST!"=="OK" if "!API_ST!"=="OK" if "!PACK_ST!"=="OK" if "!CLOUD_ST!"=="OK" if "!BOT_ST!"=="OK" (
    echo Todos los servicios listos tras !wait_elapsed!s.
    goto :show_state
)
if !wait_elapsed! geq 120 (
    echo.
    echo ERROR: timeout esperando servicios listos (^>120s).
    echo Estados finales arriba. Revisar logs:
    echo   docker compose -p mc-ecosystem logs --tail 100
    if not "!BOT_ST!"=="OK" (
        echo.
        echo   x Discord Bot no alcanzo estado healthy.
        echo     Ejecute:  docker compose -p mc-ecosystem logs bot
        echo     para diagnosticar ^(token invalido, gateway Discord caido,
        echo     api inalcanzable, permisos del canal, ...^).
    )
    goto :err
)
timeout.exe /t 3 /nobreak >nul
set /a wait_elapsed+=3
goto :wait_loop

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

REM ============================================================
REM Subrutina: comprueba el estado de un contenedor.
REM   %1 = nombre del contenedor
REM   %2 = estado esperado: healthy | running
REM   %3 = variable de salida (recibe "OK" o el estado actual)
REM Estrategia: intentar Health.Status primero; si esta vacio (el
REM servicio no declara healthcheck), caer a State.Status. Compara
REM contra el esperado y setea la salida.
REM ============================================================
:check_svc
set "st_result="
for /f %%h in ('docker inspect --format "{{.State.Health.Status}}" %1 2^>nul') do set "st_result=%%h"
if not defined st_result (
    for /f %%s in ('docker inspect --format "{{.State.Status}}" %1 2^>nul') do set "st_result=%%s"
)
if not defined st_result set "st_result=missing"
if "!st_result!"=="%2" (set "%3=OK") else (set "%3=!st_result!")
exit /b 0

REM ============================================================
REM Docker preflight: subrutinas pequenas e independientes.
REM Los labels se consultan con templates Go y raw strings (backticks),
REM compatibles con CMD sin depender de nombres de contenedor.
REM ============================================================
:preflight
set "PF_START=!time: =0!"
set "PF_ERROR=0"
set "PF_PROJECT_STATE=OK"
set "PF_PORTS=OK"
set "PF_EXTERNAL_PROJECTS=ninguno"
set "PF_ORPHAN_NETWORKS=0"
set "PF_VOLUMES=OK"

call :pf_project
call :pf_ports
call :pf_external
call :pf_networks
call :pf_volumes
call :pf_summary

if "!PF_ERROR!"=="1" exit /b 1
exit /b 0

:pf_project
set "PF_INCOMPLETE_FOUND=0"
for /f %%C in ('docker ps -aq --filter "label=com.docker.compose.project=mc-ecosystem" 2^>nul') do (
    set "PF_STATE="
    for /f %%S in ('docker inspect --format "{{.State.Status}}" %%C 2^>nul') do set "PF_STATE=%%S"
    if /i "!PF_STATE!"=="created" call :pf_incomplete %%C
    if /i "!PF_STATE!"=="restarting" call :pf_incomplete %%C
    if /i "!PF_STATE!"=="dead" call :pf_incomplete %%C
)
if "!PF_INCOMPLETE_FOUND!"=="1" (
    set "PF_PROJECT_STATE=ERROR"
    set "PF_ERROR=1"
    echo.
    echo ERROR: existe un arranque anterior incompleto de mc-ecosystem.
    echo Para limpiarlo manualmente, ejecuta:
    echo   docker compose -p mc-ecosystem down
)
exit /b 0

:pf_incomplete
set "PF_INCOMPLETE_FOUND=1"
call :pf_details %1
echo.
echo Contenedor incompleto detectado:
echo   Contenedor: !PF_NAME!
echo   Servicio:   !PF_SERVICE!
echo   Imagen:     !PF_IMAGE!
echo   Estado:     !PF_STATE!
exit /b 0

:pf_ports
for %%P in (3000 5432 25565) do (
    for /f %%C in ('docker ps -q --filter "publish=%%P" 2^>nul') do (
        call :pf_details %%C
        if /i not "!PF_PROJECT!"=="mc-ecosystem" call :pf_port_error %%P
    )
)
exit /b 0

:pf_port_error
set "PF_PORTS=ERROR"
set "PF_ERROR=1"
if defined PF_PROJECT (
    set "PF_EXTERNAL_PROJECTS=!PF_PROJECT!"
    set "PF_REMEDIATION=docker compose -p !PF_PROJECT! down"
) else (
    set "PF_PROJECT=sin proyecto Compose"
    set "PF_SERVICE=sin servicio Compose"
    set "PF_REMEDIATION=docker stop !PF_NAME!"
)
echo.
echo ERROR: puerto %1 ocupado por otro proyecto.
echo   Puerto:      %1
echo   Contenedor:  !PF_NAME!
echo   Proyecto:    !PF_PROJECT!
echo   Servicio:    !PF_SERVICE!
echo   Estado:      !PF_STATE!
echo   Imagen:      !PF_IMAGE!
echo Para liberarlo manualmente, ejecuta:
echo   !PF_REMEDIATION!
exit /b 0

:pf_external
REM Recorre de nuevo los puertos criticos para que esta decision se base
REM explicitamente en labels Compose, no en nombres de contenedor.
for %%P in (3000 5432 25565) do (
    for /f %%C in ('docker ps -q --filter "publish=%%P" 2^>nul') do (
        call :pf_details %%C
        if defined PF_PROJECT if /i not "!PF_PROJECT!"=="mc-ecosystem" set "PF_EXTERNAL_PROJECTS=!PF_PROJECT!"
    )
)
if /i not "!PF_EXTERNAL_PROJECTS!"=="ninguno" set "PF_ERROR=1"
exit /b 0

:pf_networks
for /f %%N in ('docker network ls -q --filter "label=com.docker.compose.project" 2^>nul') do (
    set "PF_NETWORK_CONTAINERS="
    for /f %%K in ('docker network inspect --format "{{len .Containers}}" %%N 2^>nul') do set "PF_NETWORK_CONTAINERS=%%K"
    if "!PF_NETWORK_CONTAINERS!"=="0" call :pf_orphan %%N
)
exit /b 0

:pf_orphan
set /a PF_ORPHAN_NETWORKS+=1
set "PF_NETWORK_NAME="
set "PF_NETWORK_PROJECT="
for /f %%V in ('docker network inspect --format "{{.Name}}" %1 2^>nul') do set "PF_NETWORK_NAME=%%V"
for /f %%V in ('docker network inspect --format "{{index .Labels `com.docker.compose.project`}}" %1 2^>nul') do set "PF_NETWORK_PROJECT=%%V"
echo WARNING: red Compose sin contenedores: !PF_NETWORK_NAME! ^(proyecto: !PF_NETWORK_PROJECT!^)
exit /b 0

:pf_volumes
REM El stack usa bind mounts. No se modifica ni elimina ningun volumen.
exit /b 0

:pf_details
set "PF_NAME="
set "PF_PROJECT="
set "PF_SERVICE="
set "PF_STATE="
set "PF_IMAGE="
for /f %%V in ('docker inspect --format "{{.Name}}" %1 2^>nul') do set "PF_NAME=%%V"
set "PF_NAME=!PF_NAME:/=!"
for /f %%V in ('docker inspect --format "{{index .Config.Labels `com.docker.compose.project`}}" %1 2^>nul') do set "PF_PROJECT=%%V"
for /f %%V in ('docker inspect --format "{{index .Config.Labels `com.docker.compose.service`}}" %1 2^>nul') do set "PF_SERVICE=%%V"
for /f %%V in ('docker inspect --format "{{.State.Status}}" %1 2^>nul') do set "PF_STATE=%%V"
for /f %%V in ('docker inspect --format "{{.Config.Image}}" %1 2^>nul') do set "PF_IMAGE=%%V"
exit /b 0

:pf_summary
set "PF_END=!time: =0!"
call :pf_elapsed
echo.
echo ====================================
echo Docker Preflight
echo ====================================
echo Docker Desktop ............ OK
echo Proyecto actual ........... mc-ecosystem
echo Proyecto incompleto ....... !PF_PROJECT_STATE!
echo Puertos criticos .......... !PF_PORTS!
echo Otros proyectos ........... !PF_EXTERNAL_PROJECTS!
if "!PF_ORPHAN_NETWORKS!"=="0" (
    echo Redes huerfanas ........ ninguna
) else (
    echo Redes huerfanas ........ !PF_ORPHAN_NETWORKS! warning
)
echo Volumenes ................. !PF_VOLUMES!
if "!PF_ERROR!"=="1" (
    echo Resultado .............. ABORT
) else (
    echo Resultado .............. READY
)
echo Tiempo .................... !PF_SECONDS!.!PF_TENTHS! s
echo ====================================
echo.
exit /b 0

:pf_elapsed
for /f "tokens=1-4 delims=:,." %%A in ("!PF_START!") do set /a PF_START_CS=(1%%A-100)*360000+(1%%B-100)*6000+(1%%C-100)*100+(1%%D-100)
for /f "tokens=1-4 delims=:,." %%A in ("!PF_END!") do set /a PF_END_CS=(1%%A-100)*360000+(1%%B-100)*6000+(1%%C-100)*100+(1%%D-100)
set /a PF_ELAPSED_CS=PF_END_CS-PF_START_CS
if !PF_ELAPSED_CS! lss 0 set /a PF_ELAPSED_CS+=8640000
set /a PF_SECONDS=PF_ELAPSED_CS/100
set /a PF_TENTHS=(PF_ELAPSED_CS%%100)/10
exit /b 0
