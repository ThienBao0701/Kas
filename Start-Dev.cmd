@echo off
setlocal

rem ---------------------------------------------------------------------------
rem  Start-Dev - khoi dong moi truong PHAT TRIEN (development)
rem
rem  Chay backend :3002 va frontend :5173 cung luc, chi tren localhost.
rem  Mo trinh duyet tai http://localhost:5173
rem
rem  KHONG PHAI PRODUCTION. Production la C:\Kas, cong 3001, do Kas.cmd khoi
rem  dong. Hai moi truong chay song song duoc va khong dung chung cong hay
rem  du lieu.
rem
rem  Dong cua so nay de tat moi truong phat trien.
rem
rem  WHY THE GUARDS BELOW EXIST
rem
rem  A development frontend proxies /api to whatever port it is told. Pointed at
rem  3001 while the production service is listening, it serves a local-looking
rem  UI backed by LIVE data - and the dev backend does not even have to be
rem  running for that to happen. Nothing on screen would look wrong. So this
rem  script refuses to start rather than let a misconfigured .env reach the
rem  production port or the production database.
rem
rem  ASCII-only: cmd.exe mac dinh dung code page 437 va se hien thi sai neu tep
rem  nay chua dau tieng Viet.
rem ---------------------------------------------------------------------------

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   KHONG TIM THAY NODE.JS
  echo.
  echo   Cai dat ban LTS tai https://nodejs.org roi chay lai tep nay.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  echo.
  echo   CHUA CO TEP .env
  echo.
  echo   Chay:  copy .env.example .env
  echo   roi dat SESSION_SECRET va INITIAL_ADMIN_*.
  echo.
  pause
  exit /b 1
)

rem --- Guard 1: never bind the production port -------------------------------
findstr /B /C:"PORT=3001" .env >nul 2>&1
if not errorlevel 1 (
  echo.
  echo   DUNG LAI - .env DANG DAT PORT=3001
  echo.
  echo   3001 la cong PRODUCTION. Moi truong phat trien phai dung 3002.
  echo   Sua .env:  PORT=3002
  echo.
  pause
  exit /b 1
)

rem --- Guard 2: never point development at a production database -------------
rem  kas_dev_cn1 is the only database development may touch. kas_d1_test and
rem  kas_production are both production, whatever their names suggest.
findstr /C:"kas_dev_cn1" .env >nul 2>&1
if errorlevel 1 (
  echo.
  echo   DUNG LAI - DATABASE_URL KHONG TRO TOI kas_dev_cn1
  echo.
  echo   Moi truong phat trien chi duoc dung co so du lieu kas_dev_cn1.
  echo   Kiem tra DATABASE_URL trong .env.
  echo.
  pause
  exit /b 1
)

echo.
echo   Moi truong PHAT TRIEN
echo   ---------------------
echo   Backend   http://localhost:3002
echo   Frontend  http://localhost:5173     ^<-- mo trang nay
echo   Database  kas_dev_cn1
echo.
echo   Production (C:\Kas, cong 3001) khong bi anh huong.
echo   Dong cua so nay de tat.
echo.

call npm run dev
exit /b %ERRORLEVEL%
