@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   dsh-weread  -  one-click update
echo ============================================
echo.

echo [1/3] git pull ...
git -c http.sslBackend=openssl pull --ff-only
if errorlevel 1 goto fail
echo.

echo [2/3] npm install ...
call npm install --no-audit --no-fund --prefer-offline
if errorlevel 1 goto fail
echo.

echo [3/3] build host + client ...
node scripts/build.mjs
if errorlevel 1 goto fail
echo.

echo ============================================
echo   DONE. Go back to the dsh page, press Ctrl+R.
echo   If host-side code changed, also restart dsh
echo   (or toggle dsh-weread off/on in Plugins).
echo ============================================
pause
exit /b 0

:fail
echo.
echo --------------------------------------------
echo   FAILED. The existing lib/ is untouched,
echo   so the plugin keeps running the old build.
echo --------------------------------------------
pause
exit /b 1
