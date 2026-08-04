@echo off
setlocal

rem ---------------------------------------------------------------------------
rem  Kas - khoi dong ung dung (double-click file nay)
rem
rem  Chay launcher trong server\dist\launcher\cli.js. Launcher se:
rem    - kiem tra Node, cong, ban build va cau hinh
rem    - khoi dong may chu Kas (mot tien trinh duy nhat)
rem    - mo trinh duyet tai http://localhost:3001
rem
rem  Dong cua so nay de tat ung dung.
rem
rem  ASCII-only: cua so cmd.exe mac dinh dung code page 437 va se hien thi sai
rem  neu tep nay chua dau tieng Viet. Moi thong bao co dau do launcher in ra.
rem ---------------------------------------------------------------------------

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   KHONG TIM THAY NODE.JS
  echo.
  echo   Kas can Node.js de chay. Hay cai dat ban LTS tai https://nodejs.org
  echo   roi chay lai tep nay.
  echo.
  pause
  exit /b 1
)

if not exist "server\dist\launcher\cli.js" (
  echo.
  echo   CHUA BUILD UNG DUNG
  echo.
  echo   Mo PowerShell tai thu muc nay va chay:  npm run build
  echo.
  pause
  exit /b 1
)

node "server\dist\launcher\cli.js"
set EXITCODE=%ERRORLEVEL%

rem Chi giu cua so lai khi co loi, de nguoi dung doc duoc chan doan.
if not "%EXITCODE%"=="0" (
  echo.
  pause
)

exit /b %EXITCODE%
