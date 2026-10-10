@echo off
echo ============================================
echo AI Travel Planning Agent - Setup
echo ============================================
echo.

echo [1/4] Checking Python...
python --version
if errorlevel 1 (
    echo ERROR: "python" command not found. Install Python from python.org and try again.
    pause
    exit /b 1
)

echo.
echo [2/4] Creating virtual environment in .\venv ...
if exist venv (
    echo venv folder already exists, deleting it first for a clean setup...
    rmdir /s /q venv
)
python -m venv venv

if not exist venv\Scripts\python.exe (
    echo ERROR: venv was not created properly. venv\Scripts\python.exe is missing.
    echo This usually means "python -m venv venv" failed above - scroll up to see why.
    pause
    exit /b 1
)
echo venv created successfully.

echo.
echo [3/4] Installing dependencies into the venv (this takes a few minutes)...
venv\Scripts\python.exe -m pip install --upgrade pip --quiet
venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: pip install failed. Scroll up to see which package failed.
    pause
    exit /b 1
)

echo Verifying install landed inside venv (not system Python)...
venv\Scripts\python.exe -c "import langchain_ollama, sys; print('OK - using:', sys.executable)"
if errorlevel 1 (
    echo ERROR: dependencies did not install correctly into the venv.
    pause
    exit /b 1
)

echo.
echo [4/4] Setting up .env ...
if not exist .env (
    copy .env.example .env
    echo Created .env from .env.example
) else (
    echo .env already exists, leaving it as-is.
)

echo.
echo ============================================
echo Setup complete! venv is at: %cd%\venv
echo ============================================
echo NEXT STEPS:
echo 1. Open .env in Notepad and set GEMINI_API_KEY=your_key_here
echo    (get a free key at https://aistudio.google.com/apikey)
echo 2. Double-click run_ingest.bat  (builds the attraction data index)
echo 3. Double-click run_server.bat  (starts the API)
echo ============================================
pause
