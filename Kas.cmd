@echo off
setlocal

rem ---------------------------------------------------------------------------
rem  Kas - khoi dong ung dung (double-click file nay)
rem
rem  Chay production runner trong server\dist\service\runner.js. Runner se:
rem    - kiem tra Node, cong, ban build, thu muc ghi duoc va cau hinh
rem    - khoi dong may chu Kas (mot tien trinh duy nhat, co khoa chong trung)
rem    - cho may chu san sang roi mo trinh duyet tai http://localhost:3001
rem    - theo doi suc khoe va ghi nhat ky vao thu muc logs\
rem
rem  Dong cua so nay de tat ung dung (tat an toan, khong cat ngang yeu cau).
rem
rem  Neu Kas da duoc cai dat de chay nen cung Windows thi file nay chi mo trinh
rem  duyet toi ban dang chay - no KHONG khoi dong them tien trinh thu hai.
rem
rem  ASCII-only: cua so cmd.exe mac dinh dung code page 437 va se hien thi sai
rem  neu tep nay chua dau tieng Viet. Moi thong bao co dau do runner in ra.
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

if not exist "server\dist\service\runner.js" (
  echo.
  echo   CHUA BUILD UNG DUNG
  echo.
  echo   Mo PowerShell tai thu muc nay va chay:  npm run build
  echo.
  pause
  exit /b 1
)

node "server\dist\service\runner.js"
set EXITCODE=%ERRORLEVEL%

rem Chi giu cua so lai khi co loi, de nguoi dung doc duoc chan doan.
if not "%EXITCODE%"=="0" (
  echo.
  pause
)

exit /b %EXITCODE%
