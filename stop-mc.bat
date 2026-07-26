@echo off
setlocal
cd /d "%~dp0"

echo === MC Ecosystem: apagado ===
echo.
echo Se detendran los contenedores del stack ^(stop, NO down: los
echo volumenes de datos se conservan intactos^).
echo.
echo Presiona ENTER para continuar, o Ctrl+C para cancelar.
REM pause ^>nul: suprime "Press any key to continue . . ." propio de
REM pause; ya tenemos nuestro echo arriba, evitamos doble prompt.
pause >nul

echo.
docker info >nul 2>&1
if errorlevel 1 (
    echo Docker daemon no responde: los contenedores probablemente ya
    echo estaban apagados. Nada que hacer.
    goto :done
)

docker compose -p mc-ecosystem stop
if errorlevel 1 (
    echo.
    echo ERROR: docker compose stop fallo.
    echo   - Estado:  docker compose -p mc-ecosystem ps -a
    echo   - Logs:    docker compose -p mc-ecosystem logs --tail 50
    pause
    exit /b 1
)

:done
echo.
echo Stack detenido. Ya es seguro apagar Windows.
echo.
pause
