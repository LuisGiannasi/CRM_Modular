@echo off
chcp 65001 >nul
cd /d "%~dp0"

if exist ".env" (
  echo El archivo .env ya existe en esta carpeta.
  echo No se sobrescribe. Abrilo y editá AIRTABLE_TOKEN y AIRTABLE_BASE_ID si hace falta.
  start "" notepad ".env"
  exit /b 0
)

if not exist ".env.example" (
  echo No se encontró .env.example en: %cd%
  exit /b 1
)

copy /Y ".env.example" ".env" >nul
echo Listo: se creó .env desde .env.example
echo Reemplazá pat_reemplazar_con_tu_token por tu token real de Airtable.
echo.
start "" notepad ".env"
exit /b 0
