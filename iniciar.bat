@echo off
chcp 65001 >nul
cd /d "C:\Users\Luis Giannasi\.antigravity\extensions\CRM Modular"

if not exist ".env" (
  if exist "..\.env" (
    echo [INFO] No hay .env en CRM Modular; Vite leerá variables desde extensions\.env ^(carpeta padre^).
    echo.
  ) else (
    echo Creando .env desde .env.example...
    copy /Y ".env.example" ".env" >nul
    echo Editá .env en esta carpeta con AIRTABLE_TOKEN y AIRTABLE_BASE_ID, o creá ..\ .env en extensions.
    echo.
  )
)

if not exist "node_modules\" (
  echo Instalando dependencias ^(npm install^)...
  call npm install
  if errorlevel 1 exit /b 1
  echo.
)

echo Iniciando servidor de desarrollo...
echo Abrí la URL que muestre Vite ^(suele ser http://localhost:5173^)
echo.
call npm run dev

pause
