@echo off
title Dijital Ikizler - Replay Validation Mode
echo ========================================================
echo Dijital Ikizler - REPLAY VALIDATION MODE (real_rig_data.csv)
echo ========================================================

echo.
echo [1/3] Telemetry Replay Engine (real_rig_data.csv) baslatiliyor...
start "Telemetry Replay & Validation" cmd /k "py replay_mode.py"

echo [2/3] API (FastAPI) Sunucusu baslatiliyor...
start "API Sunucusu" cmd /k "py server.py"

echo [3/3] Dashboard (Vite+React) baslatiliyor...
cd dashboard
start "Dashboard Arayuzu" cmd /k "npm run dev"

echo.
echo Replay ve dogrulama sistemi basariyla calistirildi!
echo Lutfen tarayicinizdan su adrese gidin: http://localhost:5173/
echo.
pause
