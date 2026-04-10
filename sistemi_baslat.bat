@echo off
title Dijital Ikizler
echo ========================================================
echo Dijital Ikizler - Dashboard Sistemi Baslatiliyor...
echo ========================================================

echo.
echo [1/3] Veri uretici simulator arka planda baslatiliyor...
start "Veri Uretici" cmd /k "py mock_data_gen.py"

echo [2/3] API (FastAPI) Sunucusu baslatiliyor...
start "API Sunucusu" cmd /k "py server.py"

echo [3/3] Dashboard (Vite+React) baslatiliyor...
cd dashboard
start "Dashboard Arayuzu" cmd /k "npm run dev"

echo.
echo Sistem basariyla calistirildi! Kurulumun tamamlanmasi bi kac saniye surebilir.
echo Lutfen tarayicinizdan su adrese gidin: http://localhost:5173/
echo.
pause
