@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   dsh-weread  -  one-click update
echo ============================================
echo.

echo [0/4] checking working tree ...
for /f %%i in ('git status --porcelain') do set DIRTY=1
if defined DIRTY goto dirty

echo [1/4] fetching upstream ...
git -c http.sslBackend=openssl fetch upstream --prune
if errorlevel 1 goto fail
echo.

echo [2/4] rebasing onto upstream/master ...
git rebase upstream/master
if errorlevel 1 goto conflict
echo.

echo [3/4] npm install ...
call npm install --no-audit --no-fund --prefer-offline
if errorlevel 1 goto fail
echo.

echo [4/4] build host + client ...
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

:dirty
echo.
echo Working tree has uncommitted changes. Commit them first:
echo     git add -A ^&^& git commit -m "wip"
echo Nothing was updated.
echo.
pause
exit /b 1

:conflict
echo.
echo Rebase hit a conflict. Rolling back so the repo stays usable ...
git rebase --abort
echo.
echo Nothing changed. Ask the assistant to resolve this one.
pause
exit /b 1

:fail
echo.
echo --------------------------------------------
echo   FAILED. The existing lib/ is untouched,
echo   so the plugin keeps running the old build.
echo --------------------------------------------
pause
exit /b 1
