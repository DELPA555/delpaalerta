@echo off
REM ============================================================================
REM  Compila AlertaPantalla.exe (standalone, sin consola) con PyInstaller.
REM  Requiere Python en ESTA maquina de compilacion (no en las PCs destino).
REM  Salida: dist\AlertaPantalla.exe
REM ============================================================================
setlocal
cd /d "%~dp0"

echo [1/3] Instalando dependencias...
python -m pip install --upgrade pip >nul
python -m pip install -r requirements.txt pyinstaller
if errorlevel 1 goto :error

echo [2/3] Compilando el .exe (onefile, windowed)...
python -m PyInstaller --noconfirm --clean --onefile --windowed ^
  --name AlertaPantalla ^
  --paths src ^
  src\alerta_pantalla.py
if errorlevel 1 goto :error

echo [3/3] Listo.
echo.
echo   Ejecutable: %~dp0dist\AlertaPantalla.exe
echo.
echo   Para instalar en una PC: copia ese .exe y hace doble click
echo   (te va a preguntar si instalar; requiere permisos de administrador).
echo.
goto :eof

:error
echo.
echo  *** Hubo un error en la compilacion. Revisa el mensaje de arriba. ***
exit /b 1
