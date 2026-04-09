@echo off
echo ===================================
echo    Weekly Todo - Data Viewer
echo ===================================
echo.

cd /d C:\Users\LiChengyou\PyCharmMiscProject\weekly-todo-backend

echo Loading data...
echo.

if not exist "C:\Program Files\nodejs\node.exe" (
    echo ERROR: Node.js not found at C:\Program Files\nodejs\node.exe
    echo Please check your Node.js installation path
    pause
    exit /b 1
)

if not exist "view-data.js" (
    echo ERROR: view-data.js not found
    pause
    exit /b 1
)

if not exist "database.db" (
    echo WARNING: database.db not found
    echo Creating new database...
)

"C:\Program Files\nodejs\node.exe" view-data.js

if errorlevel 1 (
    echo.
    echo ERROR: Script failed to run
    pause
) else (
    echo.
    pause
)
