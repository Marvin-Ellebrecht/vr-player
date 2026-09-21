@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

set "ROOT_DIR=%~dp0"
set "NODE_DIR=%ROOT_DIR%node"
set "NODE_EXE=%NODE_DIR%\node.exe"
set "NODE_MODULES=%ROOT_DIR%node_modules"
set "PLAYER_DIST=%ROOT_DIR%packages\player\dist"

echo ==============================
echo VRPlayer
echo ==============================
echo.

REM ==========================================
REM 1. Check portable Node.js
REM ==========================================

echo Checking portable Node.js...
echo.

if exist "%NODE_EXE%" (

    echo [OK] Portable Node.js found.

    set "CURRENT_VERSION="

    for /f "tokens=*" %%A in (
        '"%NODE_EXE%" --version 2^>nul'
    ) do set "CURRENT_VERSION=%%A"

    echo     Version: !CURRENT_VERSION!
    echo.

) else (

    echo [MISSING] Portable Node.js not found.
    echo.
    echo Internet connection is required for the initial setup.
    echo.

    REM ==========================================
    REM Determine latest Node.js version
    REM ==========================================

    echo Determining latest Node.js version...

    for /f "delims=" %%A in (
        'powershell -NoProfile -ExecutionPolicy Bypass -Command ^
            "try { $response = Invoke-WebRequest -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing | ConvertFrom-Json; $latest = $response[0].version -replace 'v',''; Write-Output $latest } catch { Write-Output 'error' }"'
    ) do set "NODE_VERSION=%%A"

    if "!NODE_VERSION!"=="error" (
        echo.
        echo ERROR: Could not determine the latest Node.js version.
        echo.
        echo Please check your internet connection.
        echo.
        pause
        exit /b 1
    )

    echo Latest version found: !NODE_VERSION!
    echo.

    REM ==========================================
    REM Download Node.js
    REM ==========================================

    echo Downloading Node.js !NODE_VERSION!...
    echo.

    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "$url='https://nodejs.org/dist/v!NODE_VERSION!/node-v!NODE_VERSION!-win-x64.zip';" ^
        "$out='%TEMP%\node-v!NODE_VERSION!-win-x64.zip';" ^
        "Write-Host 'Downloading from: ' $url;" ^
        "Invoke-WebRequest -Uri $url -OutFile $out;" ^
        "Write-Host 'Extracting archive...';" ^
        "Expand-Archive -Path $out -DestinationPath '%TEMP%' -Force;" ^
        "if (Test-Path '%NODE_DIR%') { Remove-Item '%NODE_DIR%' -Recurse -Force };" ^
        "Move-Item '%TEMP%\node-v!NODE_VERSION!-win-x64' '%NODE_DIR%';" ^
        "Remove-Item $out -Force;" ^
        "Write-Host 'Installation completed.'"

    if errorlevel 1 (
        echo.
        echo ERROR: Node.js could not be downloaded.
        echo.
        pause
        exit /b 1
    )

    echo.
    echo Node.js !NODE_VERSION! successfully installed.
    echo.
)

REM ==========================================
REM 2. Use portable Node.js
REM ==========================================

set "PATH=%NODE_DIR%;%PATH%"

echo ==============================
echo Node.js
echo ==============================
echo.

node --version

echo.
echo npm:
call npm --version

if errorlevel 1 (
    echo.
    echo ERROR: npm could not be started.
    echo.
    pause
    exit /b 1
)

REM ==========================================
REM 3. Check and repair workspace dependencies
REM ==========================================

echo.
echo ==============================
echo Checking dependencies...
echo ==============================
echo.

set "PLAYER_LINK=%NODE_MODULES%\@vr-viewer\player"

if exist "%PLAYER_LINK%\." (
    echo Removing stale @vr-viewer/player directory...
    rmdir /s /q "%PLAYER_LINK%"
)

echo Installing/verifying npm workspaces...
call npm install

if errorlevel 1 (
    echo.
    echo ERROR: npm install failed.
    echo.
    pause
    exit /b 1
)

if not exist "%PLAYER_LINK%\package.json" (
    echo.
    echo ERROR: @vr-viewer/player workspace was not linked.
    echo Check the root package.json workspaces configuration.
    echo.
    pause
    exit /b 1
)

echo [OK] @vr-viewer/player workspace found.


REM ==========================================
REM 4. Check player build
REM ==========================================

echo.
echo ==============================
echo Checking player build...
echo ==============================
echo.

if exist "%PLAYER_DIST%\." (

    echo [OK] Player build found.
    echo.
    echo Using existing player build.
    echo No build required.
    echo.

) else (

    echo [MISSING] Player build not found.
    echo.
    echo Building player...
    echo.

    call npm run --prefix packages/player build

    if errorlevel 1 (
        echo.
        echo ERROR: Player build failed.
        echo.
        pause
        exit /b 1
    )

    echo.
    echo Player successfully built.
    echo.
)

REM ==========================================
REM 5. Start Vite
REM ==========================================

echo.
echo ==============================
echo Starting Vite...
echo ==============================
echo.

start "" cmd /c "npm start"

timeout /t 3 /nobreak >nul

start "" "http://localhost:5173"

echo.
echo ==============================
echo VRPlayer started
echo ==============================
echo.
echo http://localhost:5173
echo.

exit /b 0